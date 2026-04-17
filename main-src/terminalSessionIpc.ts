/**
 * Shared terminal-session IPC — 给"全能终端"窗口与 agent Terminal tool 复用。
 * 会话本身由 terminalSessionService.ts 管理；这里只暴露 IPC 面。
 */

import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { getWorkspaceRootForWebContents, resolveWorkspacePath } from './workspace.js';
import {
	createTerminalSession,
	getTerminalBuffer,
	getTerminalSession,
	killTerminalSession,
	listTerminalSessions,
	renameTerminalSession,
	resizeTerminalSession,
	subscribeToSession,
	unsubscribeFromSession,
	writeTerminalSession,
	type TerminalSessionCreateOpts,
} from './terminalSessionService.js';

const openPromisesByHost = new Map<number, Promise<number | null>>();
const terminalWindowRendererByHost = new Map<number, number>();
const terminalWindowHostByRenderer = new Map<number, number>();

function resolveHostId(sender: WebContents): number {
	return terminalWindowHostByRenderer.get(sender.id) ?? sender.id;
}

function cleanupTerminalWindowMapping(rendererId: number): void {
	const host = terminalWindowHostByRenderer.get(rendererId);
	if (host != null && terminalWindowRendererByHost.get(host) === rendererId) {
		terminalWindowRendererByHost.delete(host);
	}
	terminalWindowHostByRenderer.delete(rendererId);
}

function resolveCwdForSender(sender: WebContents, cwdRaw?: unknown): string | undefined {
	if (typeof cwdRaw !== 'string' || !cwdRaw.trim()) {
		const root = getWorkspaceRootForWebContents(sender);
		return root && existsSync(root) ? root : undefined;
	}
	const root = getWorkspaceRootForWebContents(sender);
	const raw = cwdRaw.trim();
	try {
		if (path.isAbsolute(raw)) {
			if (existsSync(raw)) {
				const st = statSync(raw);
				return st.isDirectory() ? raw : path.dirname(raw);
			}
		} else if (root) {
			const full = resolveWorkspacePath(raw, root);
			if (existsSync(full)) {
				const st = statSync(full);
				return st.isDirectory() ? full : path.dirname(full);
			}
		}
	} catch {
		/* fall through */
	}
	return root && existsSync(root) ? root : undefined;
}

async function ensureTerminalWindowForHostId(hostId: number): Promise<number | null> {
	const existing = terminalWindowRendererByHost.get(hostId);
	if (existing != null) {
		try {
			const { webContents } = await import('electron');
			const contents = webContents.fromId(existing);
			if (contents && !contents.isDestroyed()) {
				return existing;
			}
		} catch {
			/* ignore */
		}
		cleanupTerminalWindowMapping(existing);
	}
	const pending = openPromisesByHost.get(hostId);
	if (pending) {
		return await pending;
	}
	const promise = (async () => {
		try {
			const { webContents } = await import('electron');
			const source = webContents.fromId(hostId);
			if (!source || source.isDestroyed()) {
				return null;
			}
			const initialWorkspace = getWorkspaceRootForWebContents(source);
			const { createAppWindow } = await import('./appWindow.js');
			const win = createAppWindow({
				blank: true,
				surface: 'agent',
				initialWorkspace,
				queryParams: { terminalWindow: '1' },
			});
			const rendererId = win.webContents.id;
			terminalWindowRendererByHost.set(hostId, rendererId);
			terminalWindowHostByRenderer.set(rendererId, hostId);
			win.webContents.once('destroyed', () => cleanupTerminalWindowMapping(rendererId));
			win.once('closed', () => cleanupTerminalWindowMapping(rendererId));
			return rendererId;
		} catch {
			return null;
		} finally {
			openPromisesByHost.delete(hostId);
		}
	})();
	openPromisesByHost.set(hostId, promise);
	return await promise;
}

export async function openTerminalWindowForHostId(hostId: number): Promise<boolean> {
	const rendererId = await ensureTerminalWindowForHostId(hostId);
	if (rendererId == null) {
		return false;
	}
	try {
		const { webContents } = await import('electron');
		const contents = webContents.fromId(rendererId);
		if (!contents || contents.isDestroyed()) {
			return false;
		}
		const win = BrowserWindow.fromWebContents(contents);
		if (!win || win.isDestroyed()) {
			return false;
		}
		if (win.isMinimized()) {
			win.restore();
		}
		win.show();
		win.focus();
		return true;
	} catch {
		return false;
	}
}

export function registerTerminalSessionIpc(): void {
	ipcMain.handle('terminalWindow:open', async (event) => {
		const hostId = resolveHostId(event.sender);
		const ok = await openTerminalWindowForHostId(hostId);
		return { ok };
	});

	ipcMain.handle('term:sessionCreate', (event, rawOpts: unknown) => {
		const opts = (rawOpts && typeof rawOpts === 'object' ? rawOpts : {}) as Record<string, unknown>;
		let args: string[] | undefined;
		if (Array.isArray(opts.args)) {
			args = (opts.args as unknown[]).filter((v) => typeof v === 'string') as string[];
			if (args.length === 0) {
				args = undefined;
			}
		}
		let env: Record<string, string> | undefined;
		if (opts.env && typeof opts.env === 'object') {
			const entries = Object.entries(opts.env as Record<string, unknown>).filter(
				([k, v]) => typeof k === 'string' && typeof v === 'string'
			) as [string, string][];
			if (entries.length) {
				env = Object.fromEntries(entries);
			}
		}
		const createOpts: TerminalSessionCreateOpts = {
			cwd: resolveCwdForSender(event.sender, opts.cwd),
			shell: typeof opts.shell === 'string' && opts.shell.trim() ? opts.shell.trim() : undefined,
			args,
			env,
			cols: typeof opts.cols === 'number' ? opts.cols : undefined,
			rows: typeof opts.rows === 'number' ? opts.rows : undefined,
			title: typeof opts.title === 'string' ? opts.title : undefined,
		};
		try {
			const info = createTerminalSession(createOpts);
			return { ok: true as const, session: info };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('term:sessionWrite', (_event, id: unknown, data: unknown) => {
		if (typeof id !== 'string' || typeof data !== 'string') {
			return { ok: false as const };
		}
		return { ok: writeTerminalSession(id, data) };
	});

	ipcMain.handle('term:sessionResize', (_event, id: unknown, cols: unknown, rows: unknown) => {
		if (typeof id !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') {
			return { ok: false as const };
		}
		return { ok: resizeTerminalSession(id, cols, rows) };
	});

	ipcMain.handle('term:sessionKill', (_event, id: unknown) => {
		if (typeof id !== 'string') {
			return { ok: false as const };
		}
		return { ok: killTerminalSession(id) };
	});

	ipcMain.handle('term:sessionRename', (_event, id: unknown, title: unknown) => {
		if (typeof id !== 'string' || typeof title !== 'string') {
			return { ok: false as const };
		}
		return { ok: renameTerminalSession(id, title) };
	});

	ipcMain.handle('term:sessionList', () => {
		return { ok: true as const, sessions: listTerminalSessions() };
	});

	ipcMain.handle('term:sessionInfo', (_event, id: unknown) => {
		if (typeof id !== 'string') {
			return { ok: false as const };
		}
		const info = getTerminalSession(id);
		return info ? { ok: true as const, session: info } : { ok: false as const };
	});

	ipcMain.handle('term:sessionBuffer', (_event, id: unknown, maxBytes?: unknown) => {
		if (typeof id !== 'string') {
			return { ok: false as const };
		}
		const slice = getTerminalBuffer(id, typeof maxBytes === 'number' ? maxBytes : undefined);
		return slice ? { ok: true as const, slice } : { ok: false as const };
	});

	ipcMain.handle('term:sessionSubscribe', (event, id: unknown) => {
		if (typeof id !== 'string') {
			return { ok: false as const };
		}
		const slice = subscribeToSession(id, event.sender);
		return slice ? { ok: true as const, slice } : { ok: false as const };
	});

	ipcMain.handle('term:sessionUnsubscribe', (event, id: unknown) => {
		if (typeof id !== 'string') {
			return { ok: false as const };
		}
		unsubscribeFromSession(id, event.sender);
		return { ok: true as const };
	});
}
