const express = require('express');
const config = require('./config');

const app = express();

app.use(express.json());

app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(config.port, () => {
  console.log('Sur3aa server running on http://localhost:3333');
});
