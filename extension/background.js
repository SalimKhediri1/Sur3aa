const SERVER = 'http://127.0.0.1:3333';

// Content scripts cannot reliably fetch local HTTP from YouTube's HTTPS context.
// Relay only our own API routes, never a caller-supplied host or arbitrary URL.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'sur3aa-request') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith('https://www.youtube.com/')) {
    sendResponse({ error: 'Unauthorized request' });
    return;
  }
  const method = message.method || 'GET';
  const route = message.path;
  const permitted = typeof route === 'string' && (
    (method === 'GET' && (/^\/download\/(jobs|pick-folder)$/.test(route) || /^\/download\/(status|pick-folder)\/[\w-]+$/.test(route) || /^\/download\/formats\?url=[^&]+$/.test(route))) ||
    (method === 'POST' && route === '/download') ||
    (method === 'DELETE' && /^\/download\/[\w-]+$/.test(route))
  );
  if (!permitted) {
    sendResponse({ error: 'Unsupported request' });
    return;
  }
  (async () => {
    try {
      const response = await fetch(SERVER + route, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? message.body : undefined,
        signal: AbortSignal.timeout(route.startsWith('/download/formats?') ? 28000 : 10000),
      });
      const data = response.status === 204 ? null : await response.json();
      sendResponse({ ok: response.ok, status: response.status, data });
    } catch {
      sendResponse({ error: 'Cannot reach Sur3aa. Start the local server and try again.' });
    }
  })();
  return true;
});
