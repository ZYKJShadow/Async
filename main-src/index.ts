import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { initWindowsConsoleUtf8 } from './winUtf8.js';
import { initSettingsStore, getRestorableWorkspace } from './settingsStore.js';
import { ensureDefaultThread, initThreadStore } from './threadStore.js';
import { registerIpc } from './ipc/register.js';
import { setWorkspaceRoot } from './workspace.js';
import { ensureWorkspaceFileIndex } from './workspaceFileIndex.js';
import { configureAppWindowIcon, createAppWindow } from './appWindow.js';

function resolveAppIconPath(): string | undefined {
	const iconsDir = path.join(app.getAppPath(), 'resources', 'icons');
	const names =
		process.platform === 'win32'
			? ['icon.ico', 'icon.png']
			: process.platform === 'darwin'
				? ['icon.icns', 'icon.png']
				: ['icon.png'];
	for (const name of names) {
		const full = path.join(iconsDir, name);
		if (existsSync(full)) {
			return full;
		}
	}
	return undefined;
}

initWindowsConsoleUtf8();

app.whenReady().then(() => {
	const t0 = Date.now();
	const lap = (label: string) => console.log(`[startup] ${label}: +${Date.now() - t0}ms`);

	const appIconPath = resolveAppIconPath();
	configureAppWindowIcon(appIconPath);
	if (process.platform === 'darwin' && appIconPath) {
		app.dock.setIcon(appIconPath);
	}
	lap('icon configured');

	const userData = app.getPath('userData');
	initSettingsStore(userData);
	lap('settingsStore init');

	const restored = getRestorableWorkspace();
	lap('restorableWorkspace resolved');

	if (restored) {
		setWorkspaceRoot(restored);
		void ensureWorkspaceFileIndex(restored)
			.then(() => lap('workspaceFileIndex ready'))
			.catch(() => {});
	}
	initThreadStore(userData, restored ?? null);
	lap('threadStore init');

	ensureDefaultThread(restored ?? null);
	lap('defaultThread ensured');

	registerIpc();
	lap('IPC registered');

	createAppWindow();
	lap('window created');

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createAppWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
