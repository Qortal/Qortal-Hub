require('dotenv').config();
const { spawnSync } = require('child_process');
const { notarize } = require('@electron/notarize');
const { log, warn } = require('./logger');

function hasDeveloperIdSignature(appPath) {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', appPath], {
    encoding: 'utf8',
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) {
    warn(`Skipping macOS notarization: failed to inspect code signature for ${appPath}.`);
    return false;
  }

  if (output.includes('Signature=adhoc')) {
    log('Skipping macOS notarization: app is only ad-hoc signed.');
    return false;
  }

  if (!output.includes('Authority=Developer ID Application:')) {
    log('Skipping macOS notarization: app is not signed with a Developer ID Application certificate.');
    return false;
  }

  return true;
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const { APPLEID, APPLEIDPASS, APPLETEAMID } = process.env;
  if (!APPLEID || !APPLEIDPASS || !APPLETEAMID) {
    log('Skipping macOS notarization: Apple notarization credentials are not configured.');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  if (!hasDeveloperIdSignature(appPath)) {
    return;
  }

  return notarize({
    appBundleId: packager.appInfo.id,
    appPath,
    tool: 'notarytool',
    teamId: APPLETEAMID,
    appleId: APPLEID,
    appleIdPassword: APPLEIDPASS,
  });
};