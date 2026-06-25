const { Router } = require('express');
const { spawn } = require('child_process');
const config = require('../config');

const router = Router();

router.post('/', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const outputTemplate = config.downloadPath + '/%(title)s.%(ext)s';

  try {
    // Fire and forget — respond immediately, let yt-dlp run in the background
    spawn('yt-dlp', [
      url,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
    ], { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to start yt-dlp' });
  }

  res.json({ status: 'download started', url });
});

module.exports = router;
