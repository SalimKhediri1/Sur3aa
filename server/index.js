const express = require('express');
const cors = require('cors');
const config = require('./config');
const downloadRouter = require('./routes/download');

const app = express();

// Allow requests only from the YouTube page (content script) or the extension popup
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === 'https://www.youtube.com' || origin.startsWith('chrome-extension://')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/download', downloadRouter);

// When launched by systemd socket activation, LISTEN_FDS=1 and the
// pre-bound listening socket is passed as file descriptor 3.
const listenFds = parseInt(process.env.LISTEN_FDS) || 0;
if (listenFds >= 1) {
  app.listen({ fd: 3 }, () => {
    console.log('Sur3aa server running (socket activation)');
  });
} else {
  app.listen(config.port, () => {
    console.log('Sur3aa server running on http://localhost:3333');
  });
}
