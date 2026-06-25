const { Router } = require('express');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const config = require('../config');

const router = Router();

// In-memory job tracker — resets on server restart
const jobs = {};

// Cap on simultaneous yt-dlp processes
let activeDownloads = 0;
const MAX_CONCURRENT = 3;

router.get('/formats', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    execFile('yt-dlp', ['--dump-json', '--skip-download', '--no-playlist', url], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
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

      // YouTube serves video and audio as separate DASH streams — keep the
      // video-only streams (no merged audio) so we see every real resolution
      const videoStreams = formats.filter(f =>
        f.vcodec && f.vcodec !== 'none' &&
        (!f.acodec || f.acodec === 'none') &&
        f.height
      );

      // Deduplicate by height — keep only the first entry per height value
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
        label: f.height >= 2160 ? `4K — video + audio` : `${f.height}p — video + audio`,
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

router.post('/', (req, res) => {
  const { url, format } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  // Reject anything that isn't a recognizable YouTube watch URL
  const youtubeUrlPattern = /^https?:\/\/(www\.)?(youtube\.com\/watch\?.*v=|youtu\.be\/).+/;
  if (!youtubeUrlPattern.test(url)) {
    return res.status(400).json({ error: 'invalid YouTube URL' });
  }

  if (activeDownloads >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'too many concurrent downloads' });
  }
  activeDownloads++;

  const jobId = randomUUID();
  jobs[jobId] = { status: 'pending', percent: 0, size: null, speed: null, eta: null, url };

  // Respond immediately — yt-dlp runs in the background
  res.json({ jobId, status: 'pending' });

  const outputTemplate = config.downloadPath + '/%(title)s.%(ext)s';

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

  let stderrOutput = '';
  const proc = spawn('yt-dlp', args);
  // Keep a handle on the process so the DELETE route can cancel it
  jobs[jobId].process = proc;
  proc.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

  // Parse yt-dlp's [download] progress lines off stdout into the job record
  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
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
    // A killed (cancelled) process stays cancelled — don't overwrite its status
    if (jobs[jobId].status === 'cancelled') {
      activeDownloads--;
      setTimeout(() => delete jobs[jobId], 5 * 60 * 1000);
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
    activeDownloads--;
    // Clean up after 5 minutes to prevent memory leaks
    setTimeout(() => delete jobs[jobId], 5 * 60 * 1000);
  });
});

module.exports = router;
