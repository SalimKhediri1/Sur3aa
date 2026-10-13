const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { spawnSync } = require('node:child_process');

async function harness(t, platform = process.platform) {
  let clockOffset = 0;
  const children = [];
  const lookups = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sur3aa-test-'));
  const config = { port: 3333, downloadPath: home, home, ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg', retentionMs: 10000, formatTimeoutMs: 100, maxJobs: 100 };
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 12345;
    child.kill = () => { child.killed = true; return true; };
    Object.assign(child, { command, args, options });
    children.push(child);
    return child;
  };
  const execFile = (command, args, options, callback) => {
    const child = spawn(command, args, options);
    lookups.push({ child, callback });
    return child;
  };
  const source = fs.readFileSync(path.join(__dirname, '../routes/download.js'), 'utf8');
  const module = { exports: {} };
  const context = {
    require(name) {
      if (name === 'child_process') return { spawn, execFile };
      if (name === '../config') return config;
      if (name === 'os') return { ...os, homedir: () => home, tmpdir: () => home };
      return require(name);
    },
    module, exports: module.exports, process: { platform, execPath: process.execPath, env: {} },
    console, Buffer, URL, Promise, Date: { now: () => Date.now() + clockOffset }, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
  };
  new Function(...Object.keys(context), source)(...Object.values(context));
  const app = express();
  app.use(express.json());
  app.use('/download', module.exports);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });
  const request = async (route = '', body, method) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/download${route}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data };
  };
  return { request, children, lookups, home, advanceTime: ms => { clockOffset += ms; } };
}
const url = 'https://www.youtube.com/watch?v=BaW_jenozKc';

test('reuses prefetched video information without another extraction, respects expiry and removes private metadata', async t => {
  const h = await harness(t);
  const pending = h.request('/formats?url=' + encodeURIComponent(url));
  while (!h.lookups.length) await new Promise(resolve => setTimeout(resolve, 1));
  const info = { id: 'BaW_jenozKc', title: 'Fixture', webpage_url: url, formats: [{ format_id: '18', height: 360, vcodec: 'h264', acodec: 'aac', url: 'https://example.invalid/private-media' }] };
  h.lookups[0].callback(null, JSON.stringify(info));
  const response = await pending;
  assert.deepEqual(Object.keys(response.data), ['formats']);
  const format = response.data.formats[0];
  await h.request('', { url, format });
  const child = h.children[1];
  assert.ok(child.args.includes('--load-info-json'), 'download must reuse the completed format extraction');
  assert.ok(!child.args.includes(url), 'do not also download the original URL');
  assert.equal(child.args[child.args.indexOf('-f') + 1], format.format_id);
  const infoPath = child.args[child.args.indexOf('--load-info-json') + 1];
  assert.deepEqual(JSON.parse(fs.readFileSync(infoPath, 'utf8')), info);
  child.emit('close', 0);
  assert.equal(fs.existsSync(infoPath), false);
  h.advanceTime(6 * 60 * 1000);
  await h.request('', { url, format });
  assert.ok(!h.children[2].args.includes('--load-info-json'), 'expired media URLs must be re-extracted');
  assert.ok(h.children[2].args.includes(url));
  h.children[2].emit('close', 0);
});

test('temporary media stays on the destination filesystem and is cleaned after cancellation', async t => {
  const h = await harness(t);
  const folder = path.join(h.home, 'chosen folder');
  fs.mkdirSync(folder);
  const { data } = await h.request('', { url, outputPath: folder });
  const child = h.children[0];
  const tempDir = child.args.find(arg => arg.startsWith('temp:')).slice(5);
  assert.equal(path.dirname(tempDir), folder, 'finishing a large file must not require a cross-filesystem copy');
  await h.request('/' + data.jobId, undefined, 'DELETE');
  child.emit('close', 1);
  assert.equal(fs.existsSync(tempDir), false);
});

test('expired cached links retry extraction once, keep the job, and never retry after cancellation', async t => {
  const h = await harness(t, 'linux');
  const pending = h.request('/formats?url=' + encodeURIComponent(url));
  while (!h.lookups.length) await new Promise(resolve => setTimeout(resolve, 1));
  h.lookups[0].callback(null, JSON.stringify({ id: 'BaW_jenozKc', formats: [{ height: 360, vcodec: 'h264', acodec: 'aac' }] }));
  await pending;
  const { data } = await h.request('', { url });
  h.children[1].stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\n');
  h.children[1].emit('close', 1);
  assert.equal(h.children.length, 3, 'expired cache must trigger a fresh extraction');
  assert.ok(h.children[2].args.includes(url));
  assert.ok(!h.children[2].args.includes('--load-info-json'));
  assert.equal((await h.request('/status/' + data.jobId)).data.status, 'pending');
  h.children[2].stderr.write('ERROR: HTTP Error 403: Forbidden\n');
  h.children[2].emit('close', 1);
  assert.equal(h.children.length, 3, 'retry must be bounded');
  assert.equal((await h.request('/status/' + data.jobId)).data.status, 'failed');

  const second = (await h.request('', { url })).data;
  assert.ok(!h.children[3].args.includes('--load-info-json'), 'bad cached media must be invalidated');
  await h.request('/' + second.jobId, undefined, 'DELETE');
  h.children[3].stderr.write('ERROR: HTTP Error 403: Forbidden\n');
  h.children[3].emit('close', 1);
  assert.equal(h.children.length, 4);
  assert.equal((await h.request('/status/' + second.jobId)).data.status, 'cancelled');

  h.advanceTime(6 * 60 * 1000);
  const refresh = h.request('/formats?url=' + encodeURIComponent(url));
  while (h.lookups.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
  h.lookups[1].callback(null, JSON.stringify({ id: 'BaW_jenozKc', formats: [{ height: 360, vcodec: 'h264', acodec: 'aac' }] }));
  await refresh;
  const third = (await h.request('', { url })).data;
  assert.ok(h.children[5].args.includes('--load-info-json'));
  await h.request('/' + third.jobId, undefined, 'DELETE');
  h.children[5].stderr.write('ERROR: HTTP Error 403: Forbidden\n');
  h.children[5].emit('close', 1);
  assert.equal(h.children.length, 6, 'cancelling a cached download must not start another process');
  assert.equal((await h.request('/status/' + third.jobId)).data.status, 'cancelled');
});

test('live and oversized extractor results use fresh extraction instead of cached media', async t => {
  for (const extra of [{ is_live: true }, { live_status: 'is_upcoming' }, { description: 'x'.repeat(2 * 1024 * 1024) }]) {
    const h = await harness(t);
    const pending = h.request('/formats?url=' + encodeURIComponent(url));
    while (!h.lookups.length) await new Promise(resolve => setTimeout(resolve, 1));
    h.lookups[0].callback(null, JSON.stringify({ id: 'BaW_jenozKc', formats: [{ height: 360, vcodec: 'h264', acodec: 'aac' }], ...extra }));
    await pending;
    await h.request('', { url });
    assert.ok(!h.children[1].args.includes('--load-info-json'));
    assert.ok(h.children[1].args.includes(url));
    h.children[1].emit('close', 0);
  }
});

test('rejects malformed request types and invalid trim ranges before starting a child', async t => {
  const h = await harness(t);
  for (const body of [{ url, startTime: 1 }, { url, endTime: 'banana' }, { url, startTime: '9'.repeat(100) + ':00:00' }, { url, startTime: '00:02:00', endTime: '00:01:00' }, { url, format: { type: 'video', format_id: '--exec evil' } }, { url: [url] }]) {
    assert.equal((await h.request('', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(h.children.length, 0);
});

test('validates complete YouTube URL rather than accepting a prefix', async t => {
  const h = await harness(t);
  for (const bad of ['https://youtube.com/watch?notv=abc', 'https://youtu.be/abc/extra', url + '\nhttps://evil.example', 'https://youtube.com/watch?v=x']) {
    assert.equal((await h.request('', { url: bad })).status, 400, bad);
  }
});

test('buffers progress lines split across chunks', async t => {
  const h = await harness(t);
  const { data } = await h.request('', { url });
  h.children[0].stdout.write('[download]  42.0% of ~12.00');
  h.children[0].stdout.write('MiB at 1.00MiB/s ETA 00:07\n');
  const job = (await h.request('/status/' + data.jobId)).data;
  assert.equal(job.percent, 42);
  assert.equal(job.speed, '1.00MiB/s');
  h.children[0].emit('close', 0);
});

test('picker returns immediately, assembles UTF-8 before removing newline, and reports exit failure', async t => {
  const h = await harness(t, 'win32');
  const pending = await h.request('/pick-folder');
  assert.equal(pending.status, 202);
  const route = '/pick-folder/' + pending.data.pickerId;
  assert.equal((await h.request(route)).data.status, 'pending');
  h.children[0].stdout.write('C:\\Users\\Salim ');
  h.children[0].stdout.write('Khediri\\Downloads\n');
  h.children[0].emit('close', 0);
  assert.equal((await h.request(route)).data.path, 'C:\\Users\\Salim Khediri\\Downloads');
  const failed = await h.request('/pick-folder');
  h.children[1].emit('close', 2);
  assert.equal((await h.request('/pick-folder/' + failed.data.pickerId)).data.status, 'failed');
});

test('Windows picker activates a topmost owner and cleans up after select, cancel and failure', async t => {
  const powershell = process.env.SUR3AA_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : null);
  if (!powershell) return t.skip('Requires PowerShell; also runs in Windows CI');
  const h = await harness(t, 'win32');
  await h.request('/pick-folder');
  const child = h.children[0];
  assert.ok(child.args.includes('-STA'));
  const scriptFile = path.join(h.home, 'picker-command.ps1');
  fs.writeFileSync(scriptFile, child.args[child.args.indexOf('-Command') + 1]);
  for (const outcome of ['OK', 'Cancel', 'Throw']) {
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows-picker.ps1'), '-PickerScriptFile', scriptFile, '-Outcome', outcome], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(lines, outcome === 'OK' ? ['C:\\Users\\testé\\Downloads', 'PASS: OK'] : ['PASS: ' + outcome]);
  }
  child.emit('close', 0);
});

test('format discovery includes videos which already have audio', async t => {
  const h = await harness(t);
  const pending = h.request('/formats?url=' + encodeURIComponent(url));
  while (!h.lookups.length) await new Promise(resolve => setTimeout(resolve, 1));
  h.lookups[0].callback(null, JSON.stringify({ formats: [{ height: 360, vcodec: 'h264', acodec: 'aac' }] }));
  assert.equal((await pending).data.formats[0].type, 'video');
});

test('full video, audio and clips produce correct arguments and preserve completion', async t => {
  const h = await harness(t);
  const video = await h.request('', { url, format: { type: 'video', format_id: 'bestvideo[height<=720]+bestaudio/best[height<=720]' } });
  assert.equal(video.status, 200);
  assert.ok(h.children[0].args.includes('--concurrent-fragments'));
  assert.ok(h.children[0].args.includes(`node:${process.execPath}`));
  assert.ok(h.children[0].args.includes('--windows-filenames'));
  h.children[0].emit('close', 0);
  assert.equal((await h.request('/status/' + video.data.jobId)).data.percent, 100);
  assert.equal((await h.request('/' + video.data.jobId, undefined, 'DELETE')).data.status, 'done');
  const audio = await h.request('', { url, format: { type: 'audio' } });
  assert.ok(h.children[1].args.includes('mp3'));
  h.children[1].emit('close', 0);
  const clip = await h.request('', { url, endTime: '00:00:10' });
  assert.ok(h.children[2].args.includes('*0-10'));
  assert.ok(h.children[2].args.includes('--force-keyframes-at-cuts'));
  assert.ok(!h.children[2].args.includes('--concurrent-fragments'));
  h.children[2].stderr.write('frame=20 time=00:00:');
  h.children[2].stderr.write('05.00 speed=2.00x\r');
  assert.equal((await h.request('/status/' + clip.data.jobId)).data.percent, 50);
  h.children[2].emit('close', 0);
});

test('caps concurrency and releases a missing-tool slot once after error and close', async t => {
  const h = await harness(t);
  for (let i = 0; i < 3; i++) assert.equal((await h.request('', { url: url.slice(0, -1) + i })).status, 200);
  assert.equal((await h.request('', { url })).status, 429);
  h.children[0].emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
  h.children[0].emit('close', -2);
  assert.equal((await h.request('', { url })).status, 200);
  assert.equal((await h.request('', { url: url.slice(0, -1) + '9' })).status, 429);
  const list = (await h.request('/jobs')).data.jobs;
  assert.ok(list[0].error.includes('not found'));
  assert.ok(!('process' in list[1]));
  for (const child of h.children) child.emit('close', 0);
});

test('Windows cancellation kills the process tree and completion cannot overwrite cancellation', async t => {
  const h = await harness(t, 'win32');
  const job = (await h.request('', { url })).data;
  assert.equal((await h.request('/' + job.jobId, undefined, 'DELETE')).data.status, 'cancelled');
  assert.equal(h.children[1].command, 'taskkill.exe');
  assert.deepEqual(Array.from(h.children[1].args), ['/PID', '12345', '/T', '/F']);
  h.children[0].emit('close', 0);
  assert.equal((await h.request('/status/' + job.jobId)).data.status, 'cancelled');
});

test('rejects directories outside home, files, relative paths and escaping symlinks', async t => {
  const h = await harness(t);
  fs.writeFileSync(path.join(h.home, 'file'), 'fixture');
  for (const outputPath of [os.tmpdir(), path.join(h.home, 'file'), 'Downloads', 42]) {
    assert.equal((await h.request('', { url, outputPath })).status, 400);
  }
  if (process.platform !== 'win32') {
    fs.symlinkSync(os.tmpdir(), path.join(h.home, 'escape'));
    assert.equal((await h.request('', { url, outputPath: path.join(h.home, 'escape') })).status, 400);
  }
  const folder = path.join(h.home, 'with spaces é سرعة');
  fs.mkdirSync(folder);
  assert.equal((await h.request('', { url, outputPath: folder })).status, 200);
  assert.ok(h.children[0].args.includes(folder) && h.children[0].args.includes('%(title).150B [%(id)s] [%(height)sp].%(ext)s'));
  h.children[0].emit('close', 0);
});

test('shares in-flight format requests, caches results and bounds lookup lifetime', async t => {
  const h = await harness(t);
  const a = h.request('/formats?url=' + encodeURIComponent(url));
  const b = h.request('/formats?url=' + encodeURIComponent(url));
  while (!h.lookups.length) await new Promise(resolve => setTimeout(resolve, 1));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.lookups.length, 1);
  assert.equal(h.children[0].options.timeout, 100);
  h.lookups[0].callback(null, JSON.stringify({ formats: [{ height: 720, vcodec: 'vp9', acodec: 'none' }, { height: 720, vcodec: 'h264', acodec: 'aac' }] }));
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
  assert.equal((await h.request('/formats?url=' + encodeURIComponent(url))).data.formats.length, 2);
  assert.equal(h.lookups.length, 1);
});

test('picker locks, cancellation and error-close events release the lock exactly once', async t => {
  const h = await harness(t, 'linux');
  const a = await h.request('/pick-folder');
  assert.equal((await h.request('/pick-folder')).status, 429);
  h.children[0].emit('close', 1);
  assert.equal((await h.request('/pick-folder/' + a.data.pickerId)).data.status, 'cancelled');
  const b = await h.request('/pick-folder');
  h.children[1].emit('error', new Error('missing'));
  h.children[1].emit('close', -2);
  assert.equal((await h.request('/pick-folder/' + b.data.pickerId)).data.status, 'failed');
  const c = await h.request('/pick-folder');
  const encoded = Buffer.from('/home/é/سرعة \n');
  h.children[2].stdout.write(encoded.subarray(0, 7));
  h.children[2].stdout.write(encoded.subarray(7));
  h.children[2].emit('close', 0);
  assert.equal((await h.request('/pick-folder/' + c.data.pickerId)).data.path, '/home/é/سرعة ');
});

test('isolates audio and video filenames, protects percent-containing folders and duplicate downloads', async t => {
  const h = await harness(t);
  const folder = path.join(h.home, '100% download');
  fs.mkdirSync(folder);
  const first = (await h.request('', { url, outputPath: folder })).data;
  assert.equal((await h.request('', { url, outputPath: folder })).status, 409);
  assert.equal((await h.request('', { url, outputPath: folder, format: { type: 'audio' } })).status, 200);
  const video = h.children[0].args;
  const audio = h.children[1].args;
  assert.ok(video.includes(folder));
  assert.ok(video[video.indexOf('-o') + 1].includes('[%(height)sp]'));
  assert.ok(audio[audio.indexOf('-o') + 1].includes('[audio]'));
  assert.notEqual(video.find(arg => arg.startsWith('temp:')), audio.find(arg => arg.startsWith('temp:')));
  h.children[0].emit('close', 0);
  h.children[1].emit('close', 0);
  assert.equal((await h.request('/status/' + first.jobId)).data.status, 'done');
  assert.equal((await h.request('', { url, outputPath: folder })).status, 200);
  h.children[2].emit('close', 0);
});
