// Optional DOM smoke checks in a clean Chromium profile, no npm browser packages.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const realExtension = process.env.SUR3AA_REAL_EXTENSION === '1';
let localServer;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sur3aa-chromium-'));
const browser = spawn(process.env.CHROME_BIN || 'chromium', [...(realExtension ? ['--load-extension=' + path.resolve(__dirname, '../../extension'), '--disable-extensions-except=' + path.resolve(__dirname, '../../extension')] : []), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
browser.stderr.on('data', chunk => { stderr += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let socket;
  try {
    if (realExtension) {
      localServer = require('../index').createApp().listen(3333, '127.0.0.1');
      await Promise.race([once(localServer, 'listening'), once(localServer, 'error').then(([error]) => { throw error; })]);
    }
    let address;
    for (let i = 0; i < 100; i++) {
      if (browser.exitCode !== null) throw new Error(stderr);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { address = match[1]; break; }
      await delay(100);
    }
    if (!address) throw new Error('Chromium did not start');
    const port = new URL(address).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let id = 0;
    const pending = new Map();
    const events = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const callback = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
      } else if (events.has(message.method)) events.get(message.method)(message.params);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    // Serve a tiny video page through interception while preserving a YouTube origin.
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document' }] });
    events.set('Fetch.requestPaused', event => {
      call('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><html><head></head><body><div id="above-the-fold"><div id="top-row"></div></div><video></video></body></html>').toString('base64') }).catch(console.error);
    });
    const contexts = [];
    events.set('Runtime.executionContextCreated', event => contexts.push(event.context));
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Page.navigate', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
    for (let i = 0; i < 100 && !(await evaluate("!!document.querySelector('#top-row')")); i++) await delay(50);
    if (realExtension) {
      let context;
      for (let i = 0; i < 100; i++) {
        context = contexts.find(item => item.origin.startsWith('chrome-extension://'));
        if (context) break;
        await delay(100);
      }
      assert.ok(context, 'Extension content script did not load: ' + JSON.stringify(contexts));
      const result = await call('Runtime.evaluate', {
        contextId: context.id, expression: "serverFetch('http://127.0.0.1:3333/download/jobs').then(response => response.json())",
        awaitPromise: true, returnByValue: true,
      });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      assert.ok(Array.isArray(result.result.value.jobs), JSON.stringify(result.result));
      assert.equal(await evaluate("document.querySelectorAll('#sur3aa-btn').length"), 1);
      console.log('PASS: loaded MV3 extension, actual content script → service worker → guarded local API');
      return;
    }
    await evaluate(`
      window.requests = [];
      window.jobs = [];
      window.picker = '/home/test/Downloads';
      window.chrome = { runtime: { sendMessage: async message => {
        requests.push(message);
        if (message.path.startsWith('/download/formats?')) return { ok: true, status: 200, data: { formats: [
          { type: 'video', label: '720p', format_id: 'bestvideo[height<=720]+bestaudio/best[height<=720]' },
          { type: 'audio', label: 'Audio only (mp3)', format_id: 'bestaudio/best' }
        ] } };
        if (message.path === '/download/pick-folder') return { ok: true, status: 202, data: { pickerId: 'fixture-picker' } };
        if (message.path === '/download/pick-folder/fixture-picker') return { ok: true, status: 200, data: picker ? { status: 'done', path: picker } : { status: 'cancelled' } };
        if (message.path === '/download' && message.method === 'POST') {
          const job = { jobId: 'job-' + jobs.length, status: 'pending', percent: 25, url: JSON.parse(message.body).url };
          jobs.push(job); return { ok: true, status: 200, data: job };
        }
        if (message.method === 'DELETE') { jobs.find(job => message.path.endsWith(job.jobId)).status = 'cancelled'; return { ok: true, status: 200, data: { status: 'cancelled' } }; }
        if (message.path === '/download/jobs') return { ok: true, status: 200, data: { jobs } };
        if (message.path.startsWith('/download/status/')) return { ok: true, status: 200, data: jobs.find(job => message.path.endsWith(job.jobId)) };
        throw new Error('Unexpected route: ' + message.path);
      } } };
      Object.defineProperty(document.querySelector('video'), 'duration', { value: 120 });
    `);
    await evaluate(fs.readFileSync(path.join(__dirname, '../../extension/content_script.js'), 'utf8'));
    await delay(100);
    assert.equal(await evaluate("document.querySelectorAll('#sur3aa-btn').length"), 1);
    await evaluate("document.querySelector('#sur3aa-btn').click()");
    await delay(50);
    assert.equal(await evaluate("document.querySelectorAll('#sur3aa-panel-content button').length"), 2);
    await evaluate("document.querySelector('[aria-label=\"Segment end\"]').value = 10; document.querySelector('[aria-label=\"Segment end\"]').dispatchEvent(new Event('input')); document.querySelector('#sur3aa-panel-content button').click()");
    await delay(100);
    assert.equal(await evaluate("JSON.parse(requests.find(request => request.method === 'POST').body).endTime"), '00:00:10');
    assert.equal(await evaluate("document.querySelector('#sur3aa-btn').disabled"), false);
    assert.equal(await evaluate("!!document.querySelector('#sur3aa-progress-panel')"), true);
    // Another download can start on the same page while the first is active.
    await evaluate("document.querySelector('#sur3aa-btn').click(); document.querySelectorAll('#sur3aa-panel-content button')[1].click()");
    await delay(100);
    assert.equal(await evaluate('jobs.length'), 2);
    await evaluate("history.pushState({}, '', '/watch?v=aqz-KE-bpKQ'); window.dispatchEvent(new Event('yt-navigate-finish'))");
    await delay(100);
    assert.equal(await evaluate("document.querySelectorAll('#sur3aa-btn').length"), 1);
    assert.equal(await evaluate("document.querySelector('#sur3aa-btn').disabled"), false);
    await evaluate("document.querySelector('#sur3aa-progress-content button').click()");
    await delay(100);
    assert.equal(await evaluate('jobs[0].status'), 'cancelled');
    await evaluate("history.pushState({}, '', '/'); window.dispatchEvent(new Event('yt-navigate-finish'))");
    assert.equal(await evaluate("!!document.querySelector('#sur3aa-btn')"), false);
    await evaluate("history.pushState({}, '', '/watch?v=jNQXAC9IVRw'); window.dispatchEvent(new Event('yt-navigate-finish'))");
    await delay(100);
    assert.equal(await evaluate("!!document.querySelector('#sur3aa-progress-panel')"), true);
    await evaluate("picker = null; document.querySelector('#sur3aa-btn').click(); document.querySelector('#sur3aa-panel-content button').click()");
    await delay(100);
    assert.equal(await evaluate('jobs.length'), 2);
    assert.equal(await evaluate("document.querySelector('#sur3aa-btn').disabled"), false);
    console.log('PASS: Chromium injection, format menu, trimming, concurrent downloads, cancellation, navigation, resumed progress, picker cancellation');
    await call('Page.navigate', { url: 'about:blank' });
    await delay(100);
    const popup = fs.readFileSync(path.join(__dirname, '../../extension/popup/popup.html'), 'utf8').replace(/<script[^>]*>.*?<\/script>/gs, '');
    const tree = await call('Page.getFrameTree');
    await call('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html: popup });
    await evaluate(`
      window.popupJobs = [
        { jobId: 'pending', status: 'pending', percent: 40, speed: '1MiB/s', eta: '00:10', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
        { jobId: 'failed', status: 'failed', error: 'ERROR: Fixture extraction failure', url: '' },
        { jobId: 'done', status: 'done', percent: 100, url: '' }
      ];
      window.apiOk = true;
      window.fetch = async (url, options = {}) => {
        if (options.method === 'DELETE') popupJobs[0].status = 'cancelled';
        return { ok: apiOk, json: async () => ({ jobs: popupJobs }) };
      };
    `);
    await evaluate(fs.readFileSync(path.join(__dirname, '../../extension/popup/popup.js'), 'utf8'));
    await delay(50);
    assert.equal(await evaluate("document.querySelectorAll('.job-card').length"), 3);
    assert.equal(await evaluate("document.querySelectorAll('.job-detail')[1].title"), 'ERROR: Fixture extraction failure');
    await evaluate("document.querySelector('.cancel-btn').click()");
    await delay(50);
    assert.equal(await evaluate("document.querySelector('.job-status').textContent"), 'Cancelled');
    await evaluate('apiOk = false; fetchAndRender()');
    assert.match(await evaluate("document.querySelector('#job-list').textContent"), /Server unavailable/);
    assert.match(await evaluate("document.querySelector('#job-list').textContent"), /Run \.\/setup\.sh/);
    console.log('PASS: popup jobs, progress, error tooltip, cancellation and HTTP failure');
  } finally {
    localServer?.close();
    socket?.close();
    browser.kill();
    await Promise.race([once(browser, 'exit'), delay(3000)]);
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
