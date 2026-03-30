require('dotenv').config();
const { notarize } = require('@electron/notarize');
const { log } = require('./logger');

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

  return notarize({
    appBundleId: packager.appInfo.id,
    appPath: `${appOutDir}/${appName}.app`,
    tool: 'notarytool',
    teamId: APPLETEAMID,
    appleId: APPLEID,
    appleIdPassword: APPLEIDPASS,
  });
};