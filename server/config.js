const os = require('os');
const path = require('path');

module.exports = {
  port: 3333,
  downloadPath: path.join(os.homedir(), 'Downloads'),
};
