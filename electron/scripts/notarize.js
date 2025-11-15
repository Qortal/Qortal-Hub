const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { notarize } = require('@electron/notarize');

module.exports = async function notarizeMac(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;

  console.log('Notarize env check (inside hook):', {
    APPLEID: process.env.APPLEID,
    APPLETEAMID: process.env.APPLETEAMID,
    APPLEIDPASS_SET: !!process.env.APPLEIDPASS,
  });

  if (!process.env.APPLEID || !process.env.APPLEIDPASS || !process.env.APPLETEAMID) {
    console.warn('Notarization skipped: APPLEID / APPLEIDPASS / APPLETEAMID not set correctly');
    return;
  }

  console.log('Submitting Qortal Hub for notarization via notarytool...');

  await notarize({
    tool: 'notarytool',
    appBundleId: 'org.qortal.Qortal-Hub',
    appPath: `${appOutDir}/${appName}.app`,
    teamId: process.env.APPLETEAMID,
    appleId: process.env.APPLEID,
    appleIdPassword: process.env.APPLEIDPASS,
  });

  console.log('Notarization complete.');
};

