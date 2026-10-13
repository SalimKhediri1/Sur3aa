const { spawnSync } = require('child_process');
const config = require('./config');
const major = Number(process.versions.node.split('.')[0]);
let failed = major < 22;
console.log(`Node.js ${process.versions.node}${failed ? ' (22 or newer required)' : ''}`);
for (const [name, command, args] of [
  ['yt-dlp', config.ytDlp, ['--ignore-config', '--version']],
  ['ffmpeg', config.ffmpeg, ['-version']],
  ...(process.platform === 'linux' ? [['zenity', 'zenity', ['--version']]] : []),
]) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const ok = !result.error && result.status === 0;
  console.log(`${name}: ${ok ? result.stdout.trim().split('\n')[0] : 'unavailable, run setup or install it on PATH'}`);
  if (!ok) failed = true;
}
if (!failed) {
  const result = spawnSync(config.ytDlp, ['--ignore-config', '--js-runtimes', `node:${process.execPath}`, '--help'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0) { console.error('yt-dlp is too old. Update it to the current release.'); failed = true; }
}
process.exitCode = failed ? 1 : 0;
