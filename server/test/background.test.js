const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('worker relays authorized API requests, preserves 204 and rejects arbitrary routes', async () => {
  let handler;
  const requests = [];
  const chrome = { runtime: { id: 'a'.repeat(32), onMessage: { addListener: fn => { handler = fn; } } } };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: url.endsWith('pick-folder') ? 204 : 200, json: async () => ({ jobId: 'fixture' }) };
  };
  new Function('chrome', 'fetch', fs.readFileSync(path.join(__dirname, '../../extension/background.js'), 'utf8'))(chrome, fetch);
  const sender = { id: chrome.runtime.id, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' };
  const send = (message, from = sender) => new Promise(resolve => handler({ type: 'sur3aa-request', ...message }, from, resolve));
  assert.equal((await send({ path: '/download', method: 'POST', body: '{}' })).status, 200);
  assert.equal(requests[0].url, 'http://127.0.0.1:3333/download');
  assert.equal(requests[0].options.body, '{}');
  assert.equal((await send({ path: '/download/pick-folder' })).data, null);
  for (const route of ['https://evil.example', '//evil.example', '/download/../ping', '/ping', '/download?anything']) {
    assert.ok((await send({ path: route })).error);
  }
  assert.ok((await send({ path: '/download/jobs' }, { ...sender, url: 'https://evil.example/' })).error);
  assert.ok((await send({ path: '/download/jobs' }, { ...sender, id: 'b'.repeat(32) })).error);
  assert.equal(requests.length, 2);
});

test('worker reports unreachable server to content scripts', async () => {
  let handler;
  const chrome = { runtime: { id: 'a'.repeat(32), onMessage: { addListener: fn => { handler = fn; } } } };
  new Function('chrome', 'fetch', fs.readFileSync(path.join(__dirname, '../../extension/background.js'), 'utf8'))(chrome, async () => { throw new Error('offline'); });
  const result = await new Promise(resolve => handler({ type: 'sur3aa-request', path: '/download/jobs' }, { id: chrome.runtime.id, url: 'https://www.youtube.com/' }, resolve));
  assert.match(result.error, /Start the local server/);
});
