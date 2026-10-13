const os = require('os');
const path = require('path');
const fs = require('fs');

// Setup records absolute tool paths so Windows login does not depend on a stale PATH.
const toolsFile = path.join(__dirname, 'tools.json');
let tools = {};
if (fs.existsSync(toolsFile)) tools = JSON.parse(fs.readFileSync(toolsFile, 'utf8'));
module.exports = {
  port: 3333,
  home: os.homedir(),
  downloadPath: path.join(os.homedir(), 'Downloads'),
  ytDlp: tools.ytDlp || 'yt-dlp',
  ffmpeg: tools.ffmpeg || 'ffmpeg',
  retentionMs: 5 * 60 * 1000,
  formatTimeoutMs: 25000,
  maxJobs: 100,
};
