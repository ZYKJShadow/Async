import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { initWindowsConsoleUtf8 } from './winUtf8.js';
import { initSettingsStore, getRestorableWorkspace, getSettings } from './settingsStore.js';
import { ensureDefaultThread, flushPendingSave, initThreadStore } from './threadStore.js';
import { registerIpc } from './ipc/register.js';
import { configureAppWindowIcon, createAppWindow } from './appWindow.js';
import { initAutoUpdate } from './autoUpdate.js';
import { disposeBotController, initBotController, syncBotControllerFromSettings } from './bots/botController.js';

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

// Intercept webview new-window requests and forward to host renderer
// (Electron 12+ deprecated the new-window event; use setWindowOpenHandler instead)
app.on('web-contents-created', (_event, contents) => {
	if (contents.getType() !== 'webview') {
		return;
	}
	contents.setWindowOpenHandler(({ url, disposition }) => {
		const host = contents.hostWebContents;
		if (host && !host.isDestroyed()) {
			host.send('async-shell:browserNewWindow', { url, disposition });
		}
		return { action: 'deny' };
	});
});

let quittingAfterThreadStoreFlush = false;
app.on('before-quit', (e) => {
	if (quittingAfterThreadStoreFlush) {
		return;
	}
	quittingAfterThreadStoreFlush = true;
	e.preventDefault();
	void Promise.allSettled([flushPendingSave(), disposeBotController()]).finally(() => {
		app.quit();
	});
});

app.whenReady().then(() => {
	// 仅在显式 debug 开关下安装 React DevTools，保持 dev / dev:debug 语义与现有脚本一致。
	const installReactDevTools =
		process.env.ASYNC_SHELL_DEVTOOLS === '1' || process.env.VOID_SHELL_DEVTOOLS === '1';
	if (installReactDevTools) {
		const { default: installExtension, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer');

		installExtension(REACT_DEVELOPER_TOOLS, { loadExtension: true })
			.then(() => console.log('✅ React DevTools 已安装'))
			.catch((err: unknown) => console.log('安装失败:', err));
	}

	const t0 = Date.now();
	const lap = (label: string) => console.log(`[startup] ${label}: +${Date.now() - t0}ms`);

	const appIconPath = resolveAppIconPath();
	configureAppWindowIcon(appIconPath);
	if (process.platform === 'darwin' && appIconPath) {
		app.dock?.setIcon(appIconPath);
	}
	lap('icon configured');

	const userData = app.getPath('userData');
	initSettingsStore(userData);
	lap('settingsStore init');
	initBotController(getSettings);
	void syncBotControllerFromSettings(getSettings());
	lap('botController init');

	const restored = getRestorableWorkspace();
	lap('restorableWorkspace resolved');

	const restoredUsable = restored && existsSync(restored) ? restored : null;
	initThreadStore(userData, restoredUsable);
	lap('threadStore init');

	ensureDefaultThread(restoredUsable);
	lap('defaultThread ensured');

	registerIpc();
	lap('IPC registered');

	createAppWindow({
		surface: 'agent',
		initialWorkspace: restoredUsable,
	});
	lap('window created');

	// 初始化自动更新（获取刚创建的窗口）
	const [mainWin] = BrowserWindow.getAllWindows();
	if (mainWin) {
		initAutoUpdate(mainWin);
		lap('autoUpdate initialized');
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createAppWindow({ surface: 'agent' });
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
