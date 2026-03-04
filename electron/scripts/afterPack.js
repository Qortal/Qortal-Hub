// scripts/afterPack.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log, warn } = require('./logger');

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;

  if (!electronPlatformName.toLowerCase().includes('linux')) return;

  const chromeSandbox = path.join(appOutDir, 'chrome-sandbox');
  if (!fs.existsSync(chromeSandbox)) {
    log('ℹ️ chrome-sandbox not found, skipping.');
    return;
  }

  log('🔧 Fixing chrome-sandbox permissions...');
  try {
    // Set setuid bit (rwsr-xr-x)
    execSync(`chmod 4755 "${chromeSandbox}"`, { stdio: 'inherit' });

    // // Needs root to succeed; if not root, we warn but continue
    // try {
    //   execSync(`chown root:root "${chromeSandbox}"`, { stdio: 'inherit' });
    // } catch (e) {
    //   warn(
    //     '⚠️ chown root:root failed (not running as root?). AppImage may refuse to run the sandbox.'
    //   );
    // }

    log('✅ chrome-sandbox permissions fixed.');
  } catch (e) {
    warn('⚠️ Failed to set chrome-sandbox permissions:', e.message);
  }
};
