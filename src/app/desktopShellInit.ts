import type { Dispatch, SetStateAction } from 'react';
import { hideBootSplash } from '../bootSplash';
import { normalizeAppearanceSettings, type AppAppearanceSettings } from '../appearanceSettings';
import {
	readPrefersDark,
	readStoredColorMode,
	resolveEffectiveScheme,
	writeStoredColorMode,
	type AppColorMode,
} from '../colorMode';
import { normalizeLocale, type AppLocale, type TFunction } from '../i18n';
import type { LoadedSettingsSnapshot } from '../hooks/useSettings';
import type { McpServerConfig, McpServerStatus } from '../mcpTypes';
import {
	clampSidebarLayout,
	readSidebarLayout,
	syncDesktopShellLayoutMode,
	syncDesktopSidebarLayout,
	writeStoredShellLayoutMode,
	type ShellLayoutMode,
} from './shellLayoutStorage';

type SettingsGetPayload = LoadedSettingsSnapshot & {
	language?: string;
	ui?: {
		sidebarLayout?: { left?: unknown; right?: unknown };
		colorMode?: string;
		fontPreset?: unknown;
		uiFontPreset?: unknown;
		codeFontPreset?: unknown;
		themePresetId?: unknown;
		accentColor?: unknown;
		backgroundColor?: unknown;
		foregroundColor?: unknown;
		translucentSidebar?: unknown;
		contrast?: unknown;
		usePointerCursors?: unknown;
		uiFontSize?: unknown;
		codeFontSize?: unknown;
		layoutMode?: string;
	};
};

export type DesktopShellInitContext = {
	shell: NonNullable<Window['asyncShell']>;
	t: TFunction;
	layoutPinnedBySurface: boolean;
	shellLayoutStorageKey: string;
	sidebarLayoutStorageKey: string;
	refreshThreads: () => Promise<string | null>;
	refreshGit: () => void | Promise<void>;
	setLocale: (locale: AppLocale) => void;
	setIpcOk: (message: string) => void;
	setWorkspace: (root: string | null) => void;
	setHomePath: (home: string) => void;
	setRailWidths: (next: { left: number; right: number }) => void;
	setLayoutMode: (mode: ShellLayoutMode) => void;
	applyLoadedSettings: (st: LoadedSettingsSnapshot | undefined) => void;
	setColorMode: (m: AppColorMode) => void;
	setAppearanceSettings: Dispatch<SetStateAction<AppAppearanceSettings>>;
	setMcpServers: (list: McpServerConfig[]) => void;
	setMcpStatuses: (list: McpServerStatus[]) => void;
};

/**
 * 桌面壳首启：并行 IPC 拉 workspace/settings/threads，应用侧栏与布局、设置、主题，并延迟拉 MCP。
 * 从 App 拆出以便维护与单测（逻辑与原先 useEffect 内联一致）。
 */
export async function runDesktopShellInit(ctx: DesktopShellInitContext): Promise<void> {
	const {
		shell,
		t,
		layoutPinnedBySurface,
		shellLayoutStorageKey,
		sidebarLayoutStorageKey,
		refreshThreads,
		refreshGit,
		setLocale,
		setIpcOk,
		setWorkspace,
		setHomePath,
		setRailWidths,
		setLayoutMode,
		applyLoadedSettings,
		setColorMode,
		setAppearanceSettings,
		setMcpServers,
		setMcpStatuses,
	} = ctx;

	try {
	const _t0 = performance.now();
	const _lap = (label: string) => console.log(`[renderer-init] ${label}: +${Math.round(performance.now() - _t0)}ms`);

	const isBlankWindow =
		typeof window !== 'undefined' &&
		(window.location.search.includes('blank=1') || window.location.hash.includes('blank'));

	const [p, w, paths, st] = await Promise.all([
		shell.invoke('async-shell:ping') as Promise<{ ok: boolean; message: string }>,
		isBlankWindow
			? Promise.resolve({ root: null } as { root: string | null })
			: (shell.invoke('workspace:get') as Promise<{ root: string | null }>),
		shell.invoke('app:getPaths') as Promise<{ home?: string }>,
		shell.invoke('settings:get') as Promise<SettingsGetPayload>,
	]);
	_lap('batch1 (ping/workspace/paths/settings)');
	setIpcOk(p.ok ? t('app.ipcReady', { message: p.message }) : t('app.ipcError'));
	if (!isBlankWindow) {
		setWorkspace(w.root);
	}
	if (paths.home) {
		setHomePath(paths.home);
	}

	setLocale(normalizeLocale(st.language));
	const sl = st.ui?.sidebarLayout;
	const left = typeof sl?.left === 'number' && Number.isFinite(sl.left) ? sl.left : null;
	const right = typeof sl?.right === 'number' && Number.isFinite(sl.right) ? sl.right : null;
	if (left !== null && right !== null) {
		const rw = clampSidebarLayout(left, right);
		setRailWidths(rw);
		try {
			localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(rw));
		} catch {
			/* ignore */
		}
	} else {
		const s0 = readSidebarLayout(sidebarLayoutStorageKey);
		syncDesktopSidebarLayout(shell, clampSidebarLayout(s0.left, s0.right));
	}
	if (!layoutPinnedBySurface) {
		setLayoutMode('agent');
		writeStoredShellLayoutMode('agent', shellLayoutStorageKey);
		syncDesktopShellLayoutMode(shell, 'agent');
	}
	applyLoadedSettings(st);
	const cmRaw = st.ui?.colorMode;
	const nextColorMode: AppColorMode =
		cmRaw === 'light' || cmRaw === 'dark' || cmRaw === 'system' ? cmRaw : readStoredColorMode();
	setColorMode(nextColorMode);
	writeStoredColorMode(nextColorMode);
	const appearanceScheme = resolveEffectiveScheme(nextColorMode, readPrefersDark());
	setAppearanceSettings(normalizeAppearanceSettings(st.ui, appearanceScheme));
	_lap('settings state applied');

	void refreshThreads().catch((err) => {
		console.warn('[renderer-init] refreshThreads failed after settings load', err);
	});

	hideBootSplash();

	const deferNonCritical = (fn: () => void) => {
		if (typeof requestIdleCallback === 'function') {
			requestIdleCallback(() => fn(), { timeout: 4000 });
		} else {
			window.setTimeout(fn, 0);
		}
	};
	deferNonCritical(() => {
		void (async () => {
			try {
				const [mcpSt, mcpStatusRes] = await Promise.all([
					shell.invoke('mcp:getServers') as Promise<{ servers?: McpServerConfig[] } | undefined>,
					shell.invoke('mcp:getStatuses') as Promise<{ statuses?: McpServerStatus[] } | undefined>,
				]);
				setMcpServers(mcpSt?.servers ?? []);
				setMcpStatuses(mcpStatusRes?.statuses ?? []);
				_lap('mcp (deferred)');
			} catch {
				/* optional */
			}
		})();
	});
	void refreshGit();
	_lap('init complete');
	} catch (e) {
		hideBootSplash();
		setIpcOk(String(e));
	}
}
