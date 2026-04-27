import { BrowserWindow, Menu, Tray } from 'electron';
import { checkForUpdates } from './autoUpdate.js';
import { createAppWindow, focusAppWindow, getAppWindowSurfaceForWebContents } from './appWindow.js';

let tray: Tray | null = null;

function getMainWindow(): BrowserWindow | null {
	const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
	const agentWindow = windows.find((win) => getAppWindowSurfaceForWebContents(win.webContents) === 'agent');
	if (agentWindow) {
		return agentWindow;
	}
	return windows.find((win) => getAppWindowSurfaceForWebContents(win.webContents) === 'editor') ?? null;
}

function ensureMainWindow(): BrowserWindow {
	const existing = getMainWindow();
	if (existing) {
		return existing;
	}
	return createAppWindow({ surface: 'agent' });
}

function showMainWindow(): BrowserWindow {
	const win = ensureMainWindow();
	focusAppWindow(win);
	return win;
}

function sendTrayCommand(command: 'newThread' | 'openSettings'): void {
	const win = showMainWindow();
	win.webContents.once('did-finish-load', () => {
		if (!win.isDestroyed()) {
			win.webContents.send('async-shell:trayCommand', { command });
		}
	});
	if (!win.webContents.isLoading()) {
		win.webContents.send('async-shell:trayCommand', { command });
	}
}

export function initAppTray(iconPath: string | undefined, quitApp: () => void): void {
	if (tray || process.platform === 'darwin') {
		return;
	}
	if (!iconPath) {
		return;
	}
	tray = new Tray(iconPath);
	tray.setToolTip('Async IDE');
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: '打开 Async IDE',
				click: () => showMainWindow(),
			},
			{
				label: '新建对话',
				click: () => sendTrayCommand('newThread'),
			},
			{
				label: '打开设置',
				click: () => sendTrayCommand('openSettings'),
			},
			{
				label: '检查更新',
				click: () => {
					showMainWindow();
					void checkForUpdates();
				},
			},
			{ type: 'separator' },
			{
				label: '退出',
				click: () => quitApp(),
			},
		])
	);
	tray.on('click', () => showMainWindow());
}

export function disposeAppTray(): void {
	tray?.destroy();
	tray = null;
}
