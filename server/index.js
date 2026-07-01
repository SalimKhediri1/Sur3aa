const express = require('express');
const cors = require('cors');
const config = require('./config');
const downloadRouter = require('./routes/download');

const app = express();

// The only legitimate callers are the YouTube content script
// (Origin https://www.youtube.com) and the extension popup (chrome-extension://…).
function isAllowedOrigin(origin) {
  return origin === 'https://www.youtube.com' ||
    (typeof origin === 'string' && origin.startsWith('chrome-extension://'));
}

// Set CORS headers so the browser lets the real extension read our responses.
// A disallowed origin simply gets no CORS header, so the browser blocks its read.
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  }
}));

// Anti DNS-rebinding: only serve requests addressed to the loopback host.
// A rebinding attack reaches us with the attacker's domain in the Host header,
// so anything that isn't localhost/127.0.0.1 on our port is rejected outright.
const allowedHosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`]);
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (allowedHosts.has(host)) return next();
  return res.status(403).json({ error: 'forbidden' });
});

// Anti-CSRF: a cross-site page's fetch always carries its own Origin header.
// Reject any request that presents an Origin we don't recognize. Requests with
// no Origin (or an allowed one) from the extension itself pass through.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'forbidden origin' });
  }
  next();
});

app.use(express.json());

app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/download', downloadRouter);

// Any error thrown in a route lands here and returns clean JSON instead of an
// HTML stack trace. Keeps responses consistent and avoids leaking internals.
app.use((err, req, res, next) => {
  console.error('Sur3aa request error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal error' });
});

// Last-resort guards: log and keep running rather than letting one stray error
// kill the whole server (which would drop every in-flight download).
process.on('uncaughtException', (err) => {
  console.error('Sur3aa uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Sur3aa unhandled rejection:', reason);
});

// When launched by systemd socket activation, LISTEN_FDS=1 and the
// pre-bound listening socket is passed as file descriptor 3.
const listenFds = parseInt(process.env.LISTEN_FDS) || 0;
if (listenFds >= 1) {
  app.listen({ fd: 3 }, () => {
    console.log('Sur3aa server running (socket activation)');
  });
} else {
  // Bind to loopback only so the server is never reachable from the local network.
  app.listen(config.port, '127.0.0.1', () => {
    console.log('Sur3aa server running on http://localhost:3333');
  });
}
