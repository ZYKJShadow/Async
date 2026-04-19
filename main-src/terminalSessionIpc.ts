/**
 * Shared terminal-session IPC — 给"全能终端"窗口与 agent Terminal tool 复用。
 * 会话本身由 terminalSessionService.ts 管理；这里只暴露 IPC 面。
 */

import {
	BrowserWindow,
	dialog,
	ipcMain,
	nativeTheme,
	type FileFilter,
	type WebContents,
} from 'electron';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { getWorkspaceRootForWebContents, resolveWorkspacePath } from './workspace.js';
import {
	clearTerminalSessionAuthPrompt,
	createTerminalSession,
	getTerminalBuffer,
	getTerminalSession,
	killTerminalSession,
	listTerminalSessions,
	renameTerminalSession,
	respondToTerminalSessionAuthPrompt,
	resizeTerminalSession,
	subscribeToSession,
	unsubscribeFromSession,
	writeTerminalSession,
	type TerminalSessionCreateOpts,
} from './terminalSessionService.js';
import {
	closeTerminalSftpConnection,
	createTerminalSftpDirectory,
	deleteTerminalSftpPath,
	downloadTerminalSftpDirectory,
	downloadTerminalSftpFile,
	listTerminalSftpDirectory,
	openTerminalSftpConnection,
	renameTerminalSftpPath,
	resolveTerminalSftpRealPath,
	startTerminalSftpEditSession,
	statTerminalSftpPath,
	uploadTerminalSftpDirectory,
	uploadTerminalSftpFile,
} from './terminalSftpService.js';
import { listBuiltinTerminalProfiles } from './terminalBuiltinProfiles.js';
import {
	clearTerminalProfilePassword,
	getTerminalProfilePassword,
	hasTerminalProfilePassword,
	setTerminalProfileRuntimePassword,
	setTerminalProfilePassword,
} from './terminalProfileSecrets.js';
import { syncTerminalSettings } from './terminalProfileStore.js';
import { getSettings } from './settingsStore.js';
import {
	nativeWindowChromeFromAppearance,
	normalizeAppearanceSettings,
} from '../src/appearanceSettings.js';
import {
	INITIAL_WINDOW_THEME_QUERY_PARAM,
	serializeInitialWindowThemePayload,
} from '../src/initialWindowTheme.js';
import type { ThemeChromeScheme } from './themeChrome.js';

const openPromisesByHost = new Map<number, Promise<number | null>>();
const terminalWindowRendererByHost = new Map<number, number>();
const terminalWindowHostByRenderer = new Map<number, number>();

type OpenTerminalWindowOptions = {
	startPage?: boolean;
};

function resolveInitialTerminalWindowTheme(): {
	queryValue: string;
	scheme: ThemeChromeScheme;
	chromeOverride: ReturnType<typeof nativeWindowChromeFromAppearance>;
} {
	const settings = getSettings();
	const ui = (settings.ui ?? {}) as Partial<Record<string, unknown>>;
	const colorMode =
		ui.colorMode === 'light' || ui.colorMode === 'dark' || ui.colorMode === 'system'
			? ui.colorMode
			: 'dark';
	const scheme: ThemeChromeScheme =
		colorMode === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : colorMode;
	const appearance = normalizeAppearanceSettings(ui, scheme);
	return {
		queryValue: serializeInitialWindowThemePayload({
			colorMode,
			scheme,
			ui,
		}),
		scheme,
		chromeOverride: nativeWindowChromeFromAppearance(appearance, scheme),
	};
}

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

async function ensureTerminalWindowForHostId(hostId: number, options: OpenTerminalWindowOptions = {}): Promise<number | null> {
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
			const initialTheme = resolveInitialTerminalWindowTheme();
			const win = createAppWindow({
				blank: true,
				surface: 'agent',
				initialWorkspace,
				initialThemeChrome: {
					scheme: initialTheme.scheme,
					override: initialTheme.chromeOverride,
				},
				queryParams: {
					terminalWindow: '1',
					[INITIAL_WINDOW_THEME_QUERY_PARAM]: initialTheme.queryValue,
					...(options.startPage ? { startPage: '1' } : {}),
				},
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

export async function openTerminalWindowForHostId(
	hostId: number,
	options: OpenTerminalWindowOptions = {}
): Promise<boolean> {
	const rendererId = await ensureTerminalWindowForHostId(hostId, options);
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
	ipcMain.handle('terminalWindow:open', async (event, rawOptions: unknown) => {
		const hostId = resolveHostId(event.sender);
		const options =
			rawOptions && typeof rawOptions === 'object'
				? { startPage: (rawOptions as Record<string, unknown>).startPage === true }
				: {};
		const ok = await openTerminalWindowForHostId(hostId, options);
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
			passwordAutofill:
				typeof opts.profileId === 'string' &&
				(typeof opts.sshAuthMode !== 'string' || opts.sshAuthMode === 'auto' || opts.sshAuthMode === 'password')
					? getTerminalProfilePassword(opts.profileId) || undefined
					: undefined,
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

	ipcMain.handle('term:sessionRespondToPrompt', (_event, id: unknown, data: unknown) => {
		if (typeof id !== 'string' || typeof data !== 'string') {
			return { ok: false as const };
		}
		return { ok: respondToTerminalSessionAuthPrompt(id, data) };
	});

	ipcMain.handle('term:sessionClearPrompt', (_event, id: unknown) => {
		if (typeof id !== 'string') {
			return { ok: false as const };
		}
		return { ok: clearTerminalSessionAuthPrompt(id) };
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

	ipcMain.handle('term:settingsSync', (_event, rawSettings: unknown) => {
		try {
			const result = syncTerminalSettings(rawSettings);
			return { ok: true as const, profileCount: result.profileCount };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('term:listBuiltinProfiles', async () => {
		try {
			return { ok: true as const, profiles: await listBuiltinTerminalProfiles() };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('term:profilePasswordState', (_event, profileId: unknown) => {
		if (typeof profileId !== 'string') {
			return { ok: false as const };
		}
		return {
			ok: true as const,
			hasPassword: hasTerminalProfilePassword(profileId),
		};
	});

	ipcMain.handle('term:profilePasswordSet', (_event, profileId: unknown, password: unknown) => {
		if (typeof profileId !== 'string' || typeof password !== 'string') {
			return { ok: false as const };
		}
		return {
			ok: setTerminalProfilePassword(profileId, password),
		};
	});

	ipcMain.handle('term:profilePasswordCacheSet', (_event, profileId: unknown, password: unknown) => {
		if (typeof profileId !== 'string' || typeof password !== 'string') {
			return { ok: false as const };
		}
		return {
			ok: setTerminalProfileRuntimePassword(profileId, password),
		};
	});

	ipcMain.handle('term:profilePasswordClear', (_event, profileId: unknown) => {
		if (typeof profileId !== 'string') {
			return { ok: false as const };
		}
		return {
			ok: clearTerminalProfilePassword(profileId),
		};
	});

	ipcMain.handle('term:pickPath', async (event, rawOpts: unknown) => {
		const opts = (rawOpts && typeof rawOpts === 'object' ? rawOpts : {}) as Record<string, unknown>;
		const kind = opts.kind === 'directory' ? 'directory' : 'file';
		const multi = opts.multi === true;
		const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : undefined;
		const filters = Array.isArray(opts.filters)
			? (opts.filters
					.map((item) => {
						if (!item || typeof item !== 'object') {
							return null;
						}
						const record = item as Record<string, unknown>;
						const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '';
						const extensions = Array.isArray(record.extensions)
							? record.extensions.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
							: [];
						if (!name || extensions.length === 0) {
							return null;
						}
						return {
							name,
							extensions,
						} satisfies FileFilter;
					})
					.filter((item): item is FileFilter => Boolean(item)))
			: undefined;
		const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
		const result = await dialog.showOpenDialog(win, {
			title,
			properties:
				kind === 'directory'
					? (multi ? ['openDirectory', 'multiSelections', 'createDirectory'] : ['openDirectory', 'createDirectory'])
					: (multi ? ['openFile', 'multiSelections'] : ['openFile']),
			filters: kind === 'file' && filters?.length ? filters : undefined,
		});
		if (result.canceled || !result.filePaths.length) {
			return { ok: false as const, canceled: true as const };
		}
		return {
			ok: true as const,
			path: result.filePaths[0],
			paths: result.filePaths,
		};
	});

	ipcMain.handle('term:pickSavePath', async (event, rawOpts: unknown) => {
		const opts = (rawOpts && typeof rawOpts === 'object' ? rawOpts : {}) as Record<string, unknown>;
		const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : undefined;
		const defaultPath =
			typeof opts.defaultPath === 'string' && opts.defaultPath.trim() ? opts.defaultPath.trim() : undefined;
		const filters = Array.isArray(opts.filters)
			? (opts.filters
					.map((item) => {
						if (!item || typeof item !== 'object') {
							return null;
						}
						const record = item as Record<string, unknown>;
						const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '';
						const extensions = Array.isArray(record.extensions)
							? record.extensions.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
							: [];
						if (!name || extensions.length === 0) {
							return null;
						}
						return { name, extensions } satisfies FileFilter;
					})
					.filter((item): item is FileFilter => Boolean(item)))
			: undefined;
		const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
		const result = await dialog.showSaveDialog(win, {
			title,
			defaultPath,
			filters: filters?.length ? filters : undefined,
		});
		if (result.canceled || !result.filePath) {
			return { ok: false as const, canceled: true as const };
		}
		return {
			ok: true as const,
			path: result.filePath,
		};
	});

	ipcMain.handle('term:sftpConnect', async (_event, rawProfile: unknown, rawOptions: unknown) => {
		const profile =
			rawProfile && typeof rawProfile === 'object' ? (rawProfile as Parameters<typeof openTerminalSftpConnection>[0]) : null;
		if (!profile) {
			return { ok: false as const, error: 'invalid-profile' };
		}
		const options =
			rawOptions && typeof rawOptions === 'object'
				? { passwordOverride: typeof (rawOptions as Record<string, unknown>).passwordOverride === 'string'
						? String((rawOptions as Record<string, unknown>).passwordOverride)
						: null }
				: undefined;
		return await openTerminalSftpConnection(profile, options);
	});

	ipcMain.handle('term:sftpDisconnect', async (_event, connectionId: unknown) => {
		if (typeof connectionId !== 'string') {
			return { ok: false as const };
		}
		return { ok: await closeTerminalSftpConnection(connectionId) };
	});

	ipcMain.handle('term:sftpList', async (_event, connectionId: unknown, remotePath: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			return { ok: true as const, entries: await listTerminalSftpDirectory(connectionId, remotePath) };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpStat', async (_event, connectionId: unknown, remotePath: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			return { ok: true as const, entry: await statTerminalSftpPath(connectionId, remotePath) };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpRealPath', async (_event, connectionId: unknown, remotePath: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			return { ok: true as const, path: await resolveTerminalSftpRealPath(connectionId, remotePath) };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpMkdir', async (_event, connectionId: unknown, remotePath: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await createTerminalSftpDirectory(connectionId, remotePath);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpDelete', async (_event, connectionId: unknown, remotePath: unknown, recursive: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await deleteTerminalSftpPath(connectionId, remotePath, recursive === true);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpRename', async (_event, connectionId: unknown, fromPath: unknown, toPath: unknown) => {
		if (typeof connectionId !== 'string' || typeof fromPath !== 'string' || typeof toPath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await renameTerminalSftpPath(connectionId, fromPath, toPath);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpUploadFile', async (_event, connectionId: unknown, localPath: unknown, remotePath: unknown) => {
		if (typeof connectionId !== 'string' || typeof localPath !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await uploadTerminalSftpFile(connectionId, localPath, remotePath);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpUploadDirectory', async (_event, connectionId: unknown, localPath: unknown, remotePath: unknown) => {
		if (typeof connectionId !== 'string' || typeof localPath !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await uploadTerminalSftpDirectory(connectionId, localPath, remotePath);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpDownloadFile', async (_event, connectionId: unknown, remotePath: unknown, localPath: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string' || typeof localPath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await downloadTerminalSftpFile(connectionId, remotePath, localPath);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpDownloadDirectory', async (_event, connectionId: unknown, remotePath: unknown, localPath: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string' || typeof localPath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			await downloadTerminalSftpDirectory(connectionId, remotePath, localPath);
			return { ok: true as const };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle('term:sftpEditLocal', async (_event, connectionId: unknown, remotePath: unknown, mode: unknown) => {
		if (typeof connectionId !== 'string' || typeof remotePath !== 'string') {
			return { ok: false as const, error: 'invalid-args' };
		}
		try {
			const result = await startTerminalSftpEditSession(
				connectionId,
				remotePath,
				typeof mode === 'number' ? mode : null
			);
			return { ok: true as const, ...result };
		} catch (error) {
			return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
		}
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
