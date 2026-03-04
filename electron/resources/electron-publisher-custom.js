/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
const electronPublish = require('electron-publish');
const { log } = require('../scripts/logger');

class Publisher extends electronPublish.Publisher {
  async upload(task) {
    log('electron-publisher-custom', task.file);
  }
}
module.exports = Publisher;
