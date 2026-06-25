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

      const raw = parsed.formats || [];

      // Keep only formats that have both video and audio tracks
      const combined = raw.filter(
        (f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'
      );

      // Deduplicate by height, keeping first occurrence
      const seenHeights = new Set();
      const deduped = combined.filter((f) => {
        const key = f.height ?? 'unknown';
        if (seenHeights.has(key)) return false;
        seenHeights.add(key);
        return true;
      });

      // Sort by height descending
      deduped.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      const videoFormats = deduped.map((f) => ({
        format_id: f.format_id,
        label: (f.height ? `${f.height}p` : 'Unknown resolution') + ' — video + audio',
        type: 'video',
      }));

      const audioFormat = {
        format_id: 'bestaudio/best',
        label: 'Audio only (mp3)',
        type: 'audio',
      };

      res.json({ formats: [...videoFormats, audioFormat] });
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
  res.json({ status: jobs[jobId].status, error: jobs[jobId].error || null });
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
  jobs[jobId] = { status: 'pending' };

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
  proc.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

  proc.on('close', (code) => {
    if (code === 0) {
      jobs[jobId].status = 'done';
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
