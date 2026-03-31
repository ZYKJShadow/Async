import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
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

app.whenReady().then(() => {
	const appIconPath = resolveAppIconPath();
	configureAppWindowIcon(appIconPath);
	if (process.platform === 'darwin' && appIconPath) {
		app.dock.setIcon(appIconPath);
	}

	const userData = app.getPath('userData');
	initSettingsStore(userData);
	const restored = getRestorableWorkspace();
	if (restored) {
		setWorkspaceRoot(restored);
		void ensureWorkspaceFileIndex(restored).catch(() => {});
	}
	initThreadStore(userData);
	ensureDefaultThread();
	registerIpc();
	createAppWindow();

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
