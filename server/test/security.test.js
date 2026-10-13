const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../index');

test('local API restricts hosts and origins and returns JSON errors', async t => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + route, { ...options, headers: { Host: '127.0.0.1:3333', ...options.headers } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: key => res.headers[key] }, json: async () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  const ping = await request('/ping');
  assert.deepEqual(await ping.json(), { status: 'ok', app: 'sur3aa' });
  assert.equal((await request('/ping', { headers: { Host: 'evil.example:3333' } })).status, 403);
  for (const origin of ['https://www.youtube.com', 'https://evil.example', 'chrome-extension://garbage']) {
    assert.equal((await request('/ping', { headers: { Origin: origin } })).status, 403);
  }
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  const allowed = await request('/ping', { headers: { Origin: origin } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
  assert.equal((await request('/download/pick-folder', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/missing')).status, 404);
  const invalid = await request('/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid JSON body');
  assert.equal((await request('/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(17000) }) })).status, 413);
});
