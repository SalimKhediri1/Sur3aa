const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const downloadRouter = require('./routes/download');

function createApp() {
  const app = express();
  const allowedHosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`]);
  const allowedOrigin = origin => typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  // The extension worker makes local requests. YouTube itself has no API access.
  app.use((req, res, next) => {
    if (!allowedHosts.has((req.headers.host || '').toLowerCase())) return res.status(403).json({ error: 'forbidden host' });
    const origin = req.headers.origin;
    if (origin && !allowedOrigin(origin)) return res.status(403).json({ error: 'forbidden origin' });
    // Browser navigations and ordinary web fetches cannot invoke the local API.
    if (!origin && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none') {
      return res.status(403).json({ error: 'forbidden browser request' });
    }
    next();
  });
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigin(origin)) }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/ping', (req, res) => res.json({ status: 'ok', app: 'sur3aa' }));
  app.use('/download', downloadRouter);
  app.use((req, res) => res.status(404).json({ error: 'endpoint not found' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status === 400 || err.status === 413 ? err.status : 500;
    if (status === 500) console.error('Sur3aa request error:', err.message);
    res.status(status).json({ error: status === 400 ? 'invalid JSON body' : status === 413 ? 'request too large' : 'internal error' });
  });
  return app;
}

if (require.main === module) {
  const server = createApp().listen(config.port, '127.0.0.1', () => {
    const runtimePath = path.join(__dirname, 'runtime.json');
    fs.writeFileSync(runtimePath, JSON.stringify({ pid: process.pid, node: process.execPath }));
    process.once('exit', () => {
      try {
        if (JSON.parse(fs.readFileSync(runtimePath, 'utf8')).pid === process.pid) fs.unlinkSync(runtimePath);
      } catch {}
    });
    console.log(`Sur3aa server running on http://127.0.0.1:${config.port}`);
  });
  server.on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Check whether Sur3aa is already running.` : err.message);
    process.exitCode = 1;
  });
  const shutdown = () => {
    downloadRouter.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
module.exports = { createApp };
