require('dotenv').config()
const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
	const { electronPlatformName, appOutDir } = context

	if (electronPlatformName !== 'darwin') {
		return
	}

	const appName = context.packager.appInfo.productFilename

	return await notarize({
		appBundleId: 'org.qortal.Qortal-Hub',
		appPath: `${appOutDir}/${appName}.app`,
		tool: "notarytool",
		teamId: process.env.APPLETEAMID,
		appleId: process.env.APPLEID,
		appleIdPassword: process.env.APPLEIDPASS
	})
}