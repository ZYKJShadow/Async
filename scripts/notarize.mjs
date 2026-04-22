import { notarize } from '@electron/notarize';
import { join } from 'path';

/**
 * afterSign hook for electron-builder.
 * Notarizes the macOS app when Apple credentials are available.
 */
export default async function notarizeApp(context) {
	const { electronPlatformName, appOutDir } = context;

	if (electronPlatformName !== 'darwin') {
		return;
	}

	const appName = context.packager.appInfo.productFilename;
	const appPath = join(appOutDir, `${appName}.app`);

	const appleId = process.env.APPLE_ID;
	const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
	const teamId = process.env.APPLE_TEAM_ID;

	if (!appleId || !appleIdPassword || !teamId) {
		console.log('[Notarize] Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set');
		return;
	}

	console.log(`[Notarize] Notarizing ${appPath} ...`);

	try {
		await notarize({
			appPath,
			appleId,
			appleIdPassword,
			teamId,
		});
		console.log('[Notarize] Notarization completed successfully');
	} catch (error) {
		console.error('[Notarize] Notarization failed:', error.message);
		throw error;
	}
}
