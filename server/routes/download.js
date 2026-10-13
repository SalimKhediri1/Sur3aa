const { Router } = require('express');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = Router();
const jobs = new Map();
const formatCache = new Map();
// Full extractor results stay server-side; cap both entry count and size.
const mediaInfoCache = new Map();
const formatRequests = new Map();
const lookupChildren = new Set();
const downloadKeys = new Set();
let pickerProcess = null;
const pickerResults = new Map();
let activeDownloads = 0;
let pickerOpen = false;
const MAX_CONCURRENT = 3;
const CACHE_MS = 5 * 60 * 1000;
const commonArgs = ['--ignore-config', '--no-playlist', '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '20'];
if (path.isAbsolute(config.ffmpeg)) commonArgs.push('--ffmpeg-location', config.ffmpeg);
const childOptions = { windowsHide: true };

function youtubeUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value) || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    let id;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else if (url.hostname === 'youtu.be' && /^\/[^/]+$/.test(url.pathname)) {
      id = url.pathname.slice(1);
    }
    return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

function timeSeconds(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{2,}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return NaN;
  const [h, m, s] = value.split(':').map(Number);
  return m < 60 && s < 60 && Number.isFinite(h) && h <= 9999 ? h * 3600 + m * 60 + s : NaN;
}

function insideHome(dir) {
  const home = fs.realpathSync(config.home);
  const resolved = fs.realpathSync(dir);
  const relative = path.relative(home, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('invalid output path');
  }
  fs.accessSync(resolved, fs.constants.W_OK);
  return resolved;
}

function describeError(err) {
  if (err.code === 'ENOENT') return 'yt-dlp not found. Run setup again or check your PATH.';
  if (err.killed) return 'Format lookup timed out. Please try again.';
  return (err.message || 'failed to fetch formats').slice(-2000);
}

router.get('/formats', async (req, res) => {
  const url = youtubeUrl(req.query.url);
  if (!url) return res.status(400).json({ error: 'invalid YouTube URL' });
  const cached = formatCache.get(url);
  if (cached && cached.expires > Date.now()) return res.json(cached.value);
  if (!formatRequests.has(url)) {
    if (formatRequests.size >= MAX_CONCURRENT) return res.status(429).json({ error: 'too many format requests' });
    const request = new Promise((resolve, reject) => {
      const child = execFile(config.ytDlp, [...commonArgs, '--dump-single-json', '--skip-download', url], {
        ...childOptions, maxBuffer: 10 * 1024 * 1024, timeout: config.formatTimeoutMs,
      }, (err, stdout) => {
        lookupChildren.delete(child);
        if (err) return reject(err);
        try {
          const parsed = JSON.parse(stdout);
          if (!Array.isArray(parsed.formats)) throw new Error('invalid formats response');
          const heights = [...new Set(parsed.formats.filter(f => f.vcodec && f.vcodec !== 'none' && Number.isInteger(f.height) && f.height > 0).map(f => f.height))].sort((a, b) => b - a);
          const formats = heights.map(height => ({
            format_id: `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
            label: `${height}p - video + audio`, type: 'video',
          }));
          formats.push({ format_id: 'bestaudio/best', label: 'Audio only (mp3)', type: 'audio' });
          if (parsed.id === new URL(url).searchParams.get('v') && !parsed.is_live &&
              parsed.live_status !== 'is_upcoming' && Buffer.byteLength(stdout) <= 2 * 1024 * 1024) {
            parsed.webpage_url = url;
            for (const [key, entry] of mediaInfoCache) {
              if (entry.expires <= Date.now()) mediaInfoCache.delete(key);
            }
            mediaInfoCache.delete(url);
            if (mediaInfoCache.size >= 8) mediaInfoCache.delete(mediaInfoCache.keys().next().value);
            mediaInfoCache.set(url, { json: JSON.stringify(parsed), expires: Date.now() + CACHE_MS });
          }
          resolve({ formats });
        } catch (error) { reject(error); }
      });
      lookupChildren.add(child);
    });
    formatRequests.set(url, request);
  }
  const request = formatRequests.get(url);
  try {
    const value = await request;
    if (formatCache.size >= 100) formatCache.delete(formatCache.keys().next().value);
    formatCache.set(url, { value, expires: Date.now() + CACHE_MS });
    res.json(value);
  } catch (err) {
    res.status(502).json({ error: describeError(err) });
  } finally {
    if (formatRequests.get(url) === request) formatRequests.delete(url);
  }
});

function publicJob(job) {
  const { process: child, ...data } = job;
  return data;
}
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(publicJob(job));
});
router.get('/jobs', (req, res) => res.json({ jobs: [...jobs.values()].map(publicJob) }));

function stopChild(child) {
  if (process.platform === 'win32') {
    // Killing yt-dlp alone leaves its ffmpeg child writing to disk on Windows.
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], childOptions);
    killer.on('error', () => child.kill());
    killer.on('close', code => { if (code !== 0) child.kill(); });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
}
router.delete('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (job.process && job.status === 'pending') {
    job.status = 'cancelled';
    stopChild(job.process);
  }
  res.json({ status: job.status });
});

router.get('/pick-folder/:pickerId', (req, res) => {
  const result = pickerResults.get(req.params.pickerId);
  if (!result) return res.status(404).json({ error: 'folder picker result expired' });
  res.json(result);
});

router.get('/pick-folder', (req, res) => {
  if (pickerOpen) return res.status(429).json({ error: 'a folder picker is already open' });
  pickerOpen = true;
  const pickerId = randomUUID();
  if (pickerResults.size >= 100) pickerResults.delete(pickerResults.keys().next().value);
  pickerResults.set(pickerId, { status: 'pending' });
  // A native dialog can stay open for minutes. Return immediately so Chrome's
  // worker never waits beyond its 30 second fetch response limit.
  res.status(202).json({ pickerId });
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'zenity';
  const args = windows ? ['-NoProfile', '-STA', '-Command',
    '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding;' +
    'Add-Type -AssemblyName System.Windows.Forms;' +
    // A background server has no foreground window. Give the dialog a topmost
    // owner so it appears above the browser rather than behind it.
    '$owner=New-Object System.Windows.Forms.Form;' +
    '$owner.TopMost=$true;$owner.ShowInTaskbar=$false;$owner.Opacity=0;' +
    '$owner.FormBorderStyle="None";$owner.Width=1;$owner.Height=1;' +
    '$owner.StartPosition="CenterScreen";' +
    '$f=New-Object System.Windows.Forms.FolderBrowserDialog;' +
    '$f.Description="Sur3aa - Choose download folder";' +
    'try{$owner.Show();$owner.Activate();if($f.ShowDialog($owner) -eq "OK"){[Console]::WriteLine($f.SelectedPath)}}finally{$f.Dispose();$owner.Dispose()}',
  ] : ['--file-selection', '--directory', '--title=Sur3aa - Choose download folder'];
  let child;
  let done = false;
  let output = '';
  let stderr = '';
  let timeout;
  const decoder = new StringDecoder('utf8');
  const finish = result => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    pickerOpen = false;
    pickerProcess = null;
    pickerResults.set(pickerId, result);
    setTimeout(() => pickerResults.delete(pickerId), config.retentionMs).unref();
  };
  try {
    child = spawn(command, args, childOptions);
    pickerProcess = child;
    child.stdout.on('data', chunk => { output += decoder.write(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', () => finish({ status: 'failed', error: `${command} unavailable. Run setup again.` }));
    child.on('close', code => {
      output += decoder.end();
      const selected = output.replace(/\r?\n$/, '');
      if (code === 0 && selected) return finish({ status: 'done', path: selected });
      if (code === 0 || (!windows && code === 1)) return finish({ status: 'cancelled' });
      finish({ status: 'failed', error: 'folder picker failed', detail: stderr });
    });
    timeout = setTimeout(() => { child.kill(); finish({ status: 'failed', error: 'folder picker timed out' }); }, 10 * 60 * 1000);
    timeout.unref();
  } catch { finish({ status: 'failed', error: 'folder picker unavailable' }); }
});

router.post('/', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'JSON object required' });
  const url = youtubeUrl(body.url);
  if (!url) return res.status(400).json({ error: 'invalid YouTube URL' });
  const { format, outputPath, startTime, endTime } = body;
  if (format !== undefined && format !== null && (!format || typeof format !== 'object' ||
      !['audio', 'video'].includes(format.type) ||
      (format.type === 'video' && (typeof format.format_id !== 'string' ||
        !/^bestvideo\[height<=\d{2,5}\]\+bestaudio\/best(?:\[height<=\d{2,5}\])?$/.test(format.format_id))))) {
    return res.status(400).json({ error: 'invalid format' });
  }
  const start = timeSeconds(startTime);
  const end = timeSeconds(endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || (end !== null && end <= (start || 0))) {
    return res.status(400).json({ error: 'invalid segment range, use HH:MM:SS with end after start' });
  }
  let downloadDir;
  try {
    if (outputPath !== undefined && outputPath !== null && (typeof outputPath !== 'string' || !path.isAbsolute(outputPath))) throw new Error();
    if (!outputPath) {
      // Check existing ancestors first so a Downloads symlink cannot escape home.
      insideHome(fs.existsSync(config.downloadPath) ? config.downloadPath : path.dirname(config.downloadPath));
      fs.mkdirSync(config.downloadPath, { recursive: true });
    }
    downloadDir = insideHome(outputPath || config.downloadPath);
  } catch { return res.status(400).json({ error: 'Choose an existing writable folder inside your home directory.' }); }
  if (activeDownloads >= MAX_CONCURRENT) return res.status(429).json({ error: 'too many concurrent downloads (maximum 3)' });
  if (jobs.size >= config.maxJobs) {
    const terminal = [...jobs].find(([, job]) => job.status !== 'pending' && !job.process);
    if (terminal) jobs.delete(terminal[0]);
    else return res.status(429).json({ error: 'job limit reached' });
  }
  const isSegment = start !== null || end !== null;
  const segmentDuration = end !== null ? end - (start || 0) : null;
  const suffix = isSegment ? ` [${start || 0}-${end === null ? 'end' : end}]` : '';
  // IDs prevent unrelated titles overwriting one another; clip ranges separate trims.
  const kind = format?.type === 'audio' ? 'audio' : 'video';
  const downloadKey = JSON.stringify([url, downloadDir, kind, start, end]);
  if (downloadKeys.has(downloadKey)) return res.status(409).json({ error: 'This download is already running in that folder.' });
  const typeLabel = kind === 'audio' ? ' [audio]' : ' [%(height)sp]';
  const template = `%(title).150B [%(id)s]${typeLabel}${suffix}.%(ext)s`;
  let tempDir;
  // Keep intermediates on the destination filesystem so the final move is a
  // rename, rather than copying the whole video out of /tmp or another drive.
  try { tempDir = fs.mkdtempSync(path.join(downloadDir, '.sur3aa-download-')); }
  catch { return res.status(500).json({ error: 'Cannot create a temporary download folder.' }); }
  const args = [...commonArgs, '--windows-filenames', '-P', downloadDir, '-P', `temp:${tempDir}`, '-o', template, '--newline'];
  if (format?.type === 'audio') args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
  else args.push('-f', format?.format_id || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
  if (isSegment) args.push('--download-sections', `*${start || 0}-${end === null ? 'inf' : end}`, '--force-keyframes-at-cuts');
  else args.push('--concurrent-fragments', '8');
  let inputArgs = [url];
  const mediaInfo = mediaInfoCache.get(url);
  if (mediaInfo && mediaInfo.expires > Date.now()) {
    const infoPath = path.join(tempDir, 'source.info.json');
    try {
      fs.writeFileSync(infoPath, mediaInfo.json, { mode: 0o600 });
      inputArgs = ['--load-info-json', infoPath];
    } catch {
      // A cache failure must not prevent the normal download path.
    }
  } else {
    mediaInfoCache.delete(url);
  }
  const jobId = randomUUID();
  const job = { jobId, status: 'pending', percent: 0, size: null, speed: null, eta: null, error: null, url };
  jobs.set(jobId, job);
  activeDownloads++;
  downloadKeys.add(downloadKey);
  let finalized = false;
  const finalize = (status, error = null) => {
    if (finalized) return;
    finalized = true;
    activeDownloads--;
    downloadKeys.delete(downloadKey);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    delete job.process;
    if (job.status !== 'cancelled') job.status = status;
    job.error = error;
    if (job.status === 'done') job.percent = 100;
    const timer = setTimeout(() => jobs.delete(jobId), config.retentionMs);
    timer.unref();
  };
  let stderrOutput = '';
  function lines(stream, onLine) {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    stream.on('data', chunk => {
      buffer += decoder.write(chunk);
      const parts = buffer.split(/[\r\n]+/);
      buffer = parts.pop().slice(-8192);
      parts.forEach(onLine);
    });
    stream.on('end', () => { buffer += decoder.end(); if (buffer) onLine(buffer); });
  }
  function startDownload(input, cached) {
    try {
      const child = spawn(config.ytDlp, [...args, ...input], { ...childOptions, detached: process.platform !== 'win32' });
      job.process = child;
      lines(child.stderr, line => {
        stderrOutput = (stderrOutput + '\n' + line).slice(-8192);
        if (job.status !== 'pending') return;
        const time = line.match(/time=(\d{2,}:\d{2}:\d{2}(?:\.\d+)?)/);
        if (isSegment && segmentDuration > 0 && time) {
          job.percent = Math.min(99, Math.round(timeSeconds(time[1]) / segmentDuration * 100));
          const speed = line.match(/speed=\s*([\d.]+x)/);
          if (speed) job.speed = speed[1];
        }
      });
      lines(child.stdout, line => {
        if (job.status !== 'pending') return;
        const progress = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\S+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
        if (progress) {
          job.percent = Math.min(99, Number(progress[1]));
          [job.size, job.speed, job.eta] = progress.slice(2);
        }
      });
      child.on('error', err => finalize('failed', describeError(err)));
      child.on('close', code => {
        if (finalized) return;
        // Signed media URLs can expire early. Refresh once without losing the job
        // or retrying disk/encoder failures that a new extraction cannot fix.
        if (code !== 0 && cached && job.status === 'pending' &&
            /(?:HTTP Error|Server returned)\s*(?:403|404|410)\b|Requested format is not available/i.test(stderrOutput)) {
          mediaInfoCache.delete(url);
          stderrOutput = '';
          Object.assign(job, { percent: 0, size: null, speed: null, eta: null });
          startDownload([url], false);
          return;
        }
        finalize(code === 0 ? 'done' : 'failed', code === 0 || job.status === 'cancelled' ? null : stderrOutput.trim().split(/[\r\n]+/).pop() || 'Download failed. Check yt-dlp and ffmpeg.');
      });
    } catch (err) { finalize('failed', describeError(err)); }
  }
  startDownload(inputArgs, inputArgs[0] === '--load-info-json');
  res.json({ jobId, status: job.status });
});

// Terminate download process trees when the server exits.
router.shutdown = () => {
  for (const job of jobs.values()) if (job.process) stopChild(job.process);
  for (const child of lookupChildren) child.kill();
  pickerProcess?.kill();
};
module.exports = router;
