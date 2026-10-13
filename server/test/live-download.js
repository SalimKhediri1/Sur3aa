// Opt-in network check: npm run test:live. It downloads a small public test video.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = require('../config');
const output = fs.mkdtempSync(path.join(__dirname, 'sur3aa-live-'));
config.downloadPath = output;
const router = require('../routes/download');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/download', router);
const server = app.listen(0, '127.0.0.1');
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
(async () => {
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/download`;
    const formats = await (await fetch(base + '/formats?url=' + encodeURIComponent(url))).json();
    assert.ok(formats.formats?.some(format => format.type === 'video'), JSON.stringify(formats));
    console.log('PASS: live YouTube formats');
    const variants = [
      { name: 'video', format: formats.formats.find(format => format.type === 'video' && format.label.startsWith('144p')) || formats.formats.filter(format => format.type === 'video').at(-1) },
      { name: 'audio', format: { type: 'audio' } },
      { name: 'clip', format: formats.formats.filter(format => format.type === 'video').at(-1), startTime: '00:00:02', endTime: '00:00:04' },
    ];
    for (const variant of variants) {
      const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...variant }) });
      const job = await response.json();
      assert.equal(response.status, 200, JSON.stringify(job));
      let status;
      for (let attempt = 0; attempt < 240; attempt++) {
        status = await (await fetch(base + '/status/' + job.jobId)).json();
        if (status.status !== 'pending') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      assert.equal(status.status, 'done', JSON.stringify(status));
      console.log(`PASS: live ${variant.name} download`);
    }
    const files = fs.readdirSync(output).filter(file => !file.endsWith('.part') && !file.endsWith('.ytdl'));
    assert.equal(files.length, 3, files.join(', '));
    const ffprobe = path.isAbsolute(config.ffmpeg) ? path.join(path.dirname(config.ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe';
    for (const file of files) {
      const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(output, file)], { encoding: 'utf8' });
      assert.equal(probe.status, 0, probe.stderr);
      const data = JSON.parse(probe.stdout);
      assert.ok(data.streams.some(stream => stream.codec_type === 'audio'), file);
      if (file.includes('[2-4]')) {
        assert.ok(data.streams.some(stream => stream.codec_type === 'video'));
        assert.ok(Math.abs(Number(data.format.duration) - 2) < 0.5, 'clip duration ' + data.format.duration);
      }
    }
    console.log('PASS: downloaded files contain audio, clip contains video and lasts about 2 seconds');
  } finally {
    router.shutdown();
    server.close();
    fs.rmSync(output, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
