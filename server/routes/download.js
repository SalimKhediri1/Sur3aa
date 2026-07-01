const { Router } = require('express');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = Router();

// In-memory job tracker, resets on server restart
const jobs = {};

// Cap on simultaneous yt-dlp processes
let activeDownloads = 0;
const MAX_CONCURRENT = 3;

// Cap on simultaneous format lookups so /formats can't be used to spawn an
// unbounded number of yt-dlp processes and exhaust the machine.
let activeFormatFetches = 0;
const MAX_FORMAT_FETCHES = 3;

// Only one native folder picker may be open at a time — this stops a page from
// spamming dialogs onto the user's screen.
let pickerOpen = false;

router.get('/formats', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const youtubeUrlPattern = /^https?:\/\/(www\.)?(youtube\.com\/watch\?.*v=|youtu\.be\/).+/;
  if (!youtubeUrlPattern.test(url)) {
    return res.status(400).json({ error: 'invalid YouTube URL' });
  }

  if (activeFormatFetches >= MAX_FORMAT_FETCHES) {
    return res.status(429).json({ error: 'too many format requests' });
  }
  activeFormatFetches++;

  try {
    execFile('yt-dlp', ['--dump-json', '--skip-download', '--no-playlist', url], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      activeFormatFetches--;
      if (err) {
        return res.status(500).json({ error: 'failed to fetch formats' });
      }

      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return res.status(500).json({ error: 'failed to fetch formats' });
      }

      const formats = parsed.formats || [];

      // YouTube serves video and audio as separate DASH streams; keep the
      // video-only streams (no merged audio) so we see every real resolution
      const videoStreams = formats.filter(f =>
        f.vcodec && f.vcodec !== 'none' &&
        (!f.acodec || f.acodec === 'none') &&
        f.height
      );

      // Deduplicate by height, keep only the first entry per height value
      const seen = new Set();
      const unique = videoStreams.filter(f => {
        if (seen.has(f.height)) return false;
        seen.add(f.height);
        return true;
      });

      // Sort by height descending
      unique.sort((a, b) => b.height - a.height);

      // Use yt-dlp selector syntax so it merges with the best audio at download
      const videoFormats = unique.map(f => ({
        format_id: `bestvideo[height<=${f.height}]+bestaudio/best`,
        label: f.height >= 2160 ? `4K - video + audio` : `${f.height}p - video + audio`,
        type: 'video'
      }));

      // Always offer audio-only as the final option
      const result = [
        ...videoFormats,
        { format_id: 'bestaudio/best', label: 'Audio only (mp3)', type: 'audio' }
      ];

      return res.json({ formats: result });
    });
  } catch {
    // execFile threw before the callback could run — release the slot here
    activeFormatFetches--;
    res.status(500).json({ error: 'failed to fetch formats' });
  }
});

router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!jobs[jobId]) {
    return res.status(404).json({ error: 'job not found' });
  }
  res.json({
    status: jobs[jobId].status,
    percent: jobs[jobId].percent || 0,
    size: jobs[jobId].size || null,
    speed: jobs[jobId].speed || null,
    eta: jobs[jobId].eta || null,
    error: jobs[jobId].error || null,
  });
});

// Returns all tracked jobs so the popup can render a live download list
router.get('/jobs', (req, res) => {
  const jobList = Object.entries(jobs).map(([id, job]) => ({
    jobId: id,
    status: job.status,
    percent: job.percent || 0,
    size: job.size || null,
    speed: job.speed || null,
    eta: job.eta || null,
    url: job.url || null,
    error: job.error || null,
  }));
  res.json({ jobs: jobList });
});

// Cancels an in-progress download by killing its yt-dlp process
router.delete('/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!jobs[jobId]) return res.status(404).json({ error: 'job not found' });
  if (jobs[jobId].process) {
    jobs[jobId].process.kill();
    jobs[jobId].status = 'cancelled';
    delete jobs[jobId].process;
  }
  res.json({ status: 'cancelled' });
});

// Opens a native folder picker and returns the chosen path.
// Uses PowerShell on Windows and zenity on Linux.
router.get('/pick-folder', (req, res) => {
  const { spawn } = require('child_process');

  // Refuse to open a second dialog while one is already on screen
  if (pickerOpen) {
    return res.status(429).json({ error: 'a folder picker is already open' });
  }
  pickerOpen = true;

  // A child process can emit both 'error' and 'close'. finish() guarantees we
  // release the lock and send the HTTP response exactly once, so we never crash
  // with "headers already sent".
  let done = false;
  const finish = (send) => {
    if (done) return;
    done = true;
    pickerOpen = false;
    send();
  };

  if (process.platform === 'win32') {
    const ps = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      '[System.Reflection.Assembly]::LoadWithPartialName("System.windows.forms")|Out-Null;' +
      '$f=New-Object System.Windows.Forms.FolderBrowserDialog;' +
      '$f.Description="Sur3aa - Choose download folder";' +
      'if($f.ShowDialog() -eq "OK"){$f.SelectedPath}else{""}',
    ]);

    let selectedPath = '';

    ps.stdout.on('data', (data) => { selectedPath += data.toString().trim(); });

    ps.on('close', () => finish(() => {
      if (selectedPath) return res.json({ path: selectedPath });
      return res.status(204).end();
    }));

    ps.on('error', (err) => finish(() =>
      res.status(500).json({ error: 'powershell not found', detail: err.message })));
  } else {
    const zenity = spawn('zenity', ['--file-selection', '--directory', '--title=Sur3aa - Choose download folder']);

    let selectedPath = '';
    let stderrOutput = '';

    zenity.stdout.on('data', (data) => { selectedPath += data.toString().trim(); });
    zenity.stderr.on('data', (data) => { stderrOutput += data.toString(); });

    zenity.on('close', (code) => finish(() => {
      if (code === 0 && selectedPath) return res.json({ path: selectedPath });
      if (code === 1) return res.status(204).end();
      return res.status(500).json({ error: 'zenity failed', detail: stderrOutput });
    }));

    zenity.on('error', (err) => finish(() =>
      res.status(500).json({ error: 'zenity not found', detail: err.message })));
  }
});

router.post('/', (req, res) => {
  const { url, format } = req.body;
  const outputPath = req.body.outputPath || null;
  // Optional segment range, requires both to be present to trim the download
  const startTime = (req.body.startTime || '').trim();
  const endTime = (req.body.endTime || '').trim();

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  // Reject anything that isn't a recognizable YouTube watch URL
  const youtubeUrlPattern = /^https?:\/\/(www\.)?(youtube\.com\/watch\?.*v=|youtu\.be\/).+/;
  if (!youtubeUrlPattern.test(url)) {
    return res.status(400).json({ error: 'invalid YouTube URL' });
  }

  // Reject outputPath that escapes the user's home directory.
  // realpath resolves symlinks too, so a link inside home can't point outside it.
  if (outputPath) {
    try {
      const home = fs.realpathSync(os.homedir());
      const resolved = fs.realpathSync(path.resolve(outputPath));
      if (!resolved.startsWith(home + path.sep) && resolved !== home) {
        return res.status(400).json({ error: 'invalid output path' });
      }
    } catch {
      // Path doesn't exist or can't be resolved — reject it
      return res.status(400).json({ error: 'invalid output path' });
    }
  }

  if (activeDownloads >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'too many concurrent downloads' });
  }
  activeDownloads++;

  const jobId = randomUUID();
  jobs[jobId] = { status: 'pending', percent: 0, size: null, speed: null, eta: null, url };

  // Respond immediately; yt-dlp runs in the background
  res.json({ jobId, status: 'pending' });

  // Use the user-picked folder when provided, otherwise the configured default
  const downloadDir = outputPath || config.downloadPath;
  const outputTemplate = downloadDir + '/%(title)s.%(ext)s';

  let args;
  if (format && format.type === 'audio') {
    args = [url, '--no-playlist', '-x', '--audio-format', 'mp3', '-o', outputTemplate];
  } else if (format && format.type === 'video') {
    args = [url, '--no-playlist', '-f', format.format_id, '-o', outputTemplate];
  } else {
    args = [
      url,
      '--no-playlist',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
    ];
  }

  // NOTE: the web_safari client impersonation was removed. YouTube changed
  // and it now returns "No video formats found!", failing every download.
  // The default client works again; revisit only if throttling reappears.

  const isSegment = startTime || endTime;

  if (isSegment) {
    // --concurrent-fragments conflicts with --download-sections in yt-dlp;
    // skip it for segment downloads so the slice actually works.
    const start = startTime || '0';
    const end   = endTime   || 'inf';
    args.push('--download-sections', `*${start}-${end}`);
  } else {
    // Full downloads: 8 parallel fragments + larger read buffer for speed
    args.push('--concurrent-fragments', '8', '--buffer-size', '16K');
  }

  // Force yt-dlp to emit one progress line per update (newline) instead of
  // overwriting a terminal line with carriage returns (\r). Without this the
  // stdout chunks contain \r-delimited updates that never match the \n split
  // and progress stays stuck at 0%.
  args.push('--newline');

  let stderrOutput = '';
  const proc = spawn('yt-dlp', args);
  // Keep a handle on the process so the DELETE route can cancel it
  jobs[jobId].process = proc;
  proc.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

  // A missing yt-dlp fires both 'error' and 'close'; finalize only once so the
  // concurrency counter stays accurate and the cap keeps working.
  let finalized = false;
  function finalize() {
    if (finalized) return;
    finalized = true;
    activeDownloads--;
    // Clean up after 5 minutes to prevent memory leaks
    setTimeout(() => delete jobs[jobId], 5 * 60 * 1000);
  }

  // Handles the case where yt-dlp is not installed or not in PATH
  proc.on('error', (err) => {
    delete jobs[jobId].process;
    jobs[jobId].status = 'failed';
    jobs[jobId].error = err.code === 'ENOENT'
      ? 'yt-dlp not found — is it installed and in PATH?'
      : err.message;
    finalize();
  });

  // Parse yt-dlp's [download] progress lines off stdout into the job record.
  // Split on both \n and \r so progress updates aren't missed if a chunk
  // arrives with carriage returns (can happen even with --newline on some builds).
  proc.stdout.on('data', (data) => {
    const lines = data.toString().split(/[\n\r]+/);
    lines.forEach((line) => {
      // `~?` also matches yt-dlp's estimated-size lines (e.g. "of ~12.00MiB")
      const match = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\S+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
      if (match) {
        jobs[jobId].percent = parseFloat(match[1]);
        jobs[jobId].size = match[2];
        jobs[jobId].speed = match[3];
        jobs[jobId].eta = match[4];
      }
    });
  });

  proc.on('close', (code) => {
    delete jobs[jobId].process;
    // If the 'error' handler already recorded the outcome, don't overwrite its
    // (more descriptive) message with a generic one.
    if (finalized) return;
    // A killed (cancelled) process stays cancelled; don't overwrite its status
    if (jobs[jobId].status === 'cancelled') {
      finalize();
      return;
    }
    if (code === 0) {
      jobs[jobId].status = 'done';
      jobs[jobId].percent = 100;
    } else {
      jobs[jobId].status = 'failed';
      // Use the last non-empty stderr line as the error message
      const lastMeaningfulLine = stderrOutput
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .pop() || 'unknown error';
      jobs[jobId].error = lastMeaningfulLine;
    }
    finalize();
  });
});

module.exports = router;
