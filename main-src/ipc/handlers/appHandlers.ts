import { app, ipcMain, BrowserWindow, nativeImage } from 'electron';
import {
	createAppWindow,
	findAppWindowBySurface,
	focusAppWindow,
} from '../../appWindow.js';
import { parseAppWindowSurface, senderWorkspaceRoot } from '../agentRuntime.js';

function createWindowsUnreadOverlayIcon(count: number) {
	const label = count > 99 ? '99+' : String(count);
	const fontSize = label.length >= 3 ? 54 : label.length === 2 ? 66 : 78;
	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <circle cx="160" cy="96" r="92" fill="#ef4444"/>
  <circle cx="160" cy="96" r="82" fill="#ef4444" stroke="white" stroke-width="14"/>
  <text x="160" y="118" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="white">${label}</text>
</svg>`;
	return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function applyUnreadBadgeToWindow(win: BrowserWindow, count: number): void {
	const safeCount = Math.max(0, Math.min(999, Math.floor(Number.isFinite(count) ? count : 0)));
	if (process.platform === 'win32') {
		win.setOverlayIcon(safeCount > 0 ? createWindowsUnreadOverlayIcon(safeCount) : null, safeCount > 0 ? `${safeCount} unread replies` : '');
		return;
	}
	app.setBadgeCount(safeCount);
}

/**
 * `app:*`、`async-shell:ping` IPC：版本/路径/未读 badge、窗口生命周期、surface 切换。
 * 行为与原 register.ts 一致。
 */
export function registerAppHandlers(): void {
	ipcMain.handle('async-shell:ping', () => ({ ok: true, message: 'pong' }));

	ipcMain.handle('app:getPaths', () => ({
		userData: app.getPath('userData'),
		home: app.getPath('home'),
	}));

	ipcMain.handle('app:getVersion', () => ({
		version: app.getVersion(),
		electron: process.versions.electron ?? '',
		chrome: process.versions.chrome ?? '',
		node: process.versions.node ?? '',
	}));

	ipcMain.handle('app:setUnreadBadgeCount', (event, rawCount: unknown) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || win.isDestroyed()) {
			return { ok: false as const };
		}
		const count = typeof rawCount === 'number' ? rawCount : Number(rawCount ?? 0);
		applyUnreadBadgeToWindow(win, count);
		return { ok: true as const };
	});

	ipcMain.handle('app:newWindow', () => {
		createAppWindow({ blank: true, surface: 'agent' });
		return { ok: true as const };
	});

	ipcMain.handle('app:newEditorWindow', () => {
		createAppWindow({ blank: true, surface: 'editor' });
		return { ok: true as const };
	});

	ipcMain.handle('app:windowSurfaceStatus', (event, rawSurface: unknown) => {
		const surface = parseAppWindowSurface(rawSurface);
		if (!surface) {
			return { ok: false as const, error: 'invalid-surface' as const };
		}
		const existing = findAppWindowBySurface(surface, {
			workspaceRoot: senderWorkspaceRoot(event),
			excludeWebContentsId: event.sender.id,
		});
		return { ok: true as const, exists: !!existing };
	});

	ipcMain.handle('app:openOrFocusWindowSurface', (event, rawSurface: unknown) => {
		const surface = parseAppWindowSurface(rawSurface);
		if (!surface) {
			return { ok: false as const, error: 'invalid-surface' as const };
		}
		const initialWorkspace = senderWorkspaceRoot(event);
		const existing = findAppWindowBySurface(surface, {
			workspaceRoot: initialWorkspace,
			excludeWebContentsId: event.sender.id,
		});
		if (existing) {
			focusAppWindow(existing);
			return { ok: true as const, action: 'focused' as const };
		}
		createAppWindow({
			surface,
			initialWorkspace,
		});
		return { ok: true as const, action: 'created' as const };
	});

	ipcMain.handle('app:windowGetState', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		return { ok: true as const, maximized: win.isMaximized() };
	});

	ipcMain.handle('app:windowMinimize', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		win.minimize();
		return { ok: true as const };
	});

	ipcMain.handle('app:windowToggleMaximize', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		if (win.isMaximized()) {
			win.unmaximize();
		} else {
			win.maximize();
		}
		return { ok: true as const };
	});

	ipcMain.handle('app:windowClose', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		win.close();
		return { ok: true as const };
	});

	ipcMain.handle('app:quit', () => {
		app.quit();
		return { ok: true as const };
	});
}
