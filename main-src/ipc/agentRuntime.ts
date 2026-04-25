import { BrowserWindow, type WebContents } from 'electron';
import { getWorkspaceRootForWebContents } from '../workspace.js';
import type { AppWindowSurface } from '../appWindow.js';
import * as path from 'node:path';

/**
 * IPC handler 之间共享的运行时入口。register.ts 拆分后，
 * 各个 namespace 的 handler 文件统一从此处取共享 helper，
 * 避免循环依赖到 register.ts。
 */

export function senderWorkspaceRoot(event: { sender: WebContents }): string | null {
	return getWorkspaceRootForWebContents(event.sender);
}

export function parseAppWindowSurface(raw: unknown): AppWindowSurface | null {
	return raw === 'agent' || raw === 'editor' ? raw : null;
}

export function workspaceRootsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) {
		return false;
	}
	const na = path.resolve(a).replace(/\\/g, '/').toLowerCase();
	const nb = path.resolve(b).replace(/\\/g, '/').toLowerCase();
	return na === nb;
}

export function broadcastPluginsChanged(): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) {
			continue;
		}
		try {
			win.webContents.send('async-shell:pluginsChanged');
		} catch {
			/* ignore */
		}
	}
}
