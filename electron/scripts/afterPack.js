// scripts/afterPack.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log, warn } = require('./logger');

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  const plat = (electronPlatformName || '').toLowerCase();

  const reticulumDir = path.join(appOutDir, 'resources', 'reticulum');
  const reticulumExecutables = ['rnsd', 'presence_bridge'];
  if (plat.includes('linux') || plat.includes('mac') || plat.includes('darwin')) {
    for (const name of reticulumExecutables) {
      const exePath = path.join(reticulumDir, name);
      if (!fs.existsSync(exePath)) continue;
      log(`🔧 Marking reticulum/${name} executable…`);
      try {
        execSync(`chmod 755 "${exePath}"`, { stdio: 'inherit' });
        log(`✅ reticulum/${name} permissions set.`);
      } catch (e) {
        warn(`⚠️ chmod reticulum/${name} failed:`, e.message);
      }
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
