const { Router } = require('express');
const { spawn, execFile } = require('child_process');
const config = require('../config');

const router = Router();

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

router.post('/', (req, res) => {
  const { url, format } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const outputTemplate = config.downloadPath + '/%(title)s.%(ext)s';

  let args;
  if (format && format.type === 'audio') {
    args = [url, '--no-playlist', '-x', '--audio-format', 'mp3', '-o', outputTemplate];
  } else if (format && format.type === 'video') {
    args = [url, '--no-playlist', '-f', format.format_id, '-o', outputTemplate];
  } else {
    // Default: best merged mp4
    args = [
      url,
      '--no-playlist',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
    ];
  }

  try {
    // Fire and forget — respond immediately, let yt-dlp run in the background
    spawn('yt-dlp', args, { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to start yt-dlp' });
  }

  res.json({ status: 'download started', url });
});

module.exports = router;
