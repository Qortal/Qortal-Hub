// scripts/afterPack.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log, warn } = require('./logger');

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  const plat = (electronPlatformName || '').toLowerCase();

  const rnsd = path.join(appOutDir, 'resources', 'reticulum', 'rnsd');
  if (
    fs.existsSync(rnsd) &&
    (plat.includes('linux') || plat.includes('mac') || plat.includes('darwin'))
  ) {
    log('🔧 Marking reticulum/rnsd executable…');
    try {
      execSync(`chmod 755 "${rnsd}"`, { stdio: 'inherit' });
      log('✅ reticulum/rnsd permissions set.');
    } catch (e) {
      warn('⚠️ chmod reticulum/rnsd failed:', e.message);
    }
  }

  if (!plat.includes('linux')) return;

  const chromeSandbox = path.join(appOutDir, 'chrome-sandbox');
  if (!fs.existsSync(chromeSandbox)) {
    log('ℹ️ chrome-sandbox not found, skipping.');
    return;
  }

  log('🔧 Fixing chrome-sandbox permissions...');
  try {
    execSync(`chmod 4755 "${chromeSandbox}"`, { stdio: 'inherit' });
    log('✅ chrome-sandbox permissions fixed.');
  } catch (e) {
    warn('⚠️ Failed to set chrome-sandbox permissions:', e.message);
  }
};
