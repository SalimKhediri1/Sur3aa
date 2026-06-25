const { Router } = require('express');
const { spawn } = require('child_process');
const config = require('../config');

const router = Router();

router.post('/', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const outputTemplate = config.downloadPath + '/%(title)s.%(ext)s';

  let proc;
  try {
    proc = spawn('yt-dlp', [
      url,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
    ]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to start yt-dlp' });
  }

  let stderrOutput = '';
  proc.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

  proc.on('close', (code) => {
    if (code === 0) {
      res.json({ status: 'ok', message: 'Download complete' });
    } else {
      res.status(500).json({ error: 'yt-dlp failed', detail: stderrOutput });
    }
  });
});

module.exports = router;
