import { BrowserWindow, app, screen, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	applyThemeChromeToWindow,
	THEME_CHROME,
	type NativeChromeOverride,
	type ThemeChromeScheme,
} from './themeChrome.js';
import {
	bindWorkspaceRootToWebContents,
	getWorkspaceRootForWebContents,
	onWebContentsDestroyed,
} from './workspace.js';
import { acquireWorkspaceFileIndexRef, releaseWorkspaceFileIndexRef } from './workspaceFileIndex.js';

const isDev = !app.isPackaged;
const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const loadDistFlag =
	process.env.ASYNC_SHELL_LOAD_DIST === '1' || process.env.VOID_SHELL_LOAD_DIST === '1';
const openDevTools =
	process.env.ASYNC_SHELL_DEVTOOLS === '1' || process.env.VOID_SHELL_DEVTOOLS === '1';

let appIconPath: string | undefined;

export function configureAppWindowIcon(icon: string | undefined): void {
	appIconPath = icon;
}

export type AppWindowSurface = 'agent' | 'editor';

const surfaceByWebContentsId = new Map<number, AppWindowSurface>();

function normalizeWorkspaceRoot(root: string | null | undefined): string | null {
	const trimmed = typeof root === 'string' ? root.trim() : '';
	return trimmed ? path.resolve(trimmed) : null;
}

export function getAppWindowSurfaceForWebContents(
	webContents: WebContents | null | undefined
): AppWindowSurface | null {
	if (!webContents || webContents.isDestroyed()) {
		return null;
	}
	return surfaceByWebContentsId.get(webContents.id) ?? null;
}

export function findAppWindowBySurface(
	surface: AppWindowSurface,
	opts?: { workspaceRoot?: string | null; excludeWebContentsId?: number }
): BrowserWindow | null {
	const targetRoot = normalizeWorkspaceRoot(opts?.workspaceRoot);
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) {
			continue;
		}
		if (opts?.excludeWebContentsId === win.webContents.id) {
			continue;
		}
		if (getAppWindowSurfaceForWebContents(win.webContents) !== surface) {
			continue;
		}
		const candidateRoot = normalizeWorkspaceRoot(getWorkspaceRootForWebContents(win.webContents));
		if (candidateRoot === targetRoot) {
			return win;
		}
	}
	return null;
}

export function focusAppWindow(win: BrowserWindow): void {
	if (win.isDestroyed()) {
		return;
	}
	if (win.isMinimized()) {
		win.restore();
	}
	if (!win.isVisible()) {
		win.show();
	}
	win.focus();
}

export function createAppWindow(opts?: {
	blank?: boolean;
	surface?: AppWindowSurface;
	initialWorkspace?: string | null;
	initialThemeChrome?: {
		scheme: ThemeChromeScheme;
		override?: NativeChromeOverride | null;
	};
	queryParams?: Record<string, string | number | boolean | null | undefined>;
}): BrowserWindow {
	const preloadPath = path.join(__dirname, 'preload.cjs');
	const primary = screen.getPrimaryDisplay();
	const wa = primary.workArea;
	const DEFAULT_WIN_W = 1920;
	const DEFAULT_WIN_H = 1080;
	const w = Math.max(800, Math.min(DEFAULT_WIN_W, wa.width));
	const h = Math.max(600, Math.min(DEFAULT_WIN_H, wa.height));
	const x = wa.x + Math.round((wa.width - w) / 2);
	const y = wa.y + Math.round((wa.height - h) / 2);

	const initialThemeChrome = opts?.initialThemeChrome ?? { scheme: 'dark' as const, override: null };
	const initialChromeTokens = THEME_CHROME[initialThemeChrome.scheme];
	const initialBackgroundColor =
		initialThemeChrome.override?.backgroundColor ?? initialChromeTokens.backgroundColor;
	const initialTitleBarColor =
		initialThemeChrome.override?.titleBarColor ?? initialChromeTokens.titleBarOverlay.color;
	const initialSymbolColor =
		initialThemeChrome.override?.symbolColor ?? initialChromeTokens.titleBarOverlay.symbolColor;
	const titleBarOptions =
		process.platform === 'darwin'
			? { titleBarStyle: 'hiddenInset' as const }
			: process.platform === 'win32'
				? {
						titleBarStyle: 'hidden' as const,
						titleBarOverlay: {
							color: initialTitleBarColor,
							symbolColor: initialSymbolColor,
							height: initialChromeTokens.titleBarOverlay.height,
						},
					}
				: {};

	const win = new BrowserWindow({
		x,
		y,
		width: w,
		height: h,
		minWidth: 800,
		minHeight: 600,
		backgroundColor: initialBackgroundColor,
		...(appIconPath ? { icon: appIconPath } : {}),
		...titleBarOptions,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webviewTag: true,
		},
		show: false,
	});
	applyThemeChromeToWindow(win, initialThemeChrome.scheme, initialThemeChrome.override);

	const surface: AppWindowSurface = opts?.surface ?? 'agent';
	const webContentsId = win.webContents.id;
	surfaceByWebContentsId.set(webContentsId, surface);
	const initial = opts?.initialWorkspace?.trim();
	if (initial) {
		const resolvedInitial = path.resolve(initial);
		bindWorkspaceRootToWebContents(win.webContents, resolvedInitial);
		acquireWorkspaceFileIndexRef(resolvedInitial);
	}

	onWebContentsDestroyed(win.webContents, (releasedRoot) => {
		surfaceByWebContentsId.delete(webContentsId);
		if (releasedRoot) {
			releaseWorkspaceFileIndexRef(releasedRoot);
		}
	});

	const notifyLayout = () => {
		if (!win.isDestroyed()) {
			win.webContents.send('async-shell:layout');
		}
	};
	win.on('resize', notifyLayout);
	win.on('move', notifyLayout);

	win.once('ready-to-show', () => win.show());

	const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
	const useViteDevServer = isDev && !loadDistFlag;

	const params = new URLSearchParams();
	if (opts?.blank) {
		params.set('blank', '1');
	}
	params.set('surface', surface);
	for (const [key, value] of Object.entries(opts?.queryParams ?? {})) {
		if (value === null || value === undefined || value === false) {
			continue;
		}
		params.set(key, value === true ? '1' : String(value));
	}
	const qs = params.toString();
	const urlSuffix = qs ? `?${qs}` : '';

	if (useViteDevServer) {
		void win.loadURL(devUrl + urlSuffix);
		if (openDevTools) {
			win.webContents.openDevTools({ mode: 'detach' });
		}
	} else {
		const fileUrl = pathToFileURL(htmlPath).href + urlSuffix;
		void win.loadURL(fileUrl);
	}
	return win;
}
