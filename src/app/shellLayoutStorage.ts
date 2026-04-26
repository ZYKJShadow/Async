/** 侧栏宽度、Agent/Editor 布局模式在 localStorage / settings 的读写与校验 */

export type ShellLayoutMode = 'agent' | 'editor';

export const DEFAULT_SIDEBAR_LAYOUT_KEY = 'async:sidebar-widths-v1';
export const DEFAULT_SHELL_LAYOUT_MODE_KEY = 'async:shell-layout-mode-v1';

export const RESIZE_HANDLE_PX = 5;
export const AGENT_RESIZE_HANDLE_PX = 1;
const LEFT_RAIL_MIN = 200;
const LEFT_RAIL_MAX = 960;
const RIGHT_RAIL_MIN = 260;
const RIGHT_RAIL_MAX = 1280;
const CENTER_MIN_PX = 320;

export function clampSidebarLayout(left: number, right: number): { left: number; right: number } {
	const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
	let l = Math.min(Math.max(left, LEFT_RAIL_MIN), LEFT_RAIL_MAX);
	let r = Math.min(Math.max(right, RIGHT_RAIL_MIN), RIGHT_RAIL_MAX);
	const maxPair = w - 2 * RESIZE_HANDLE_PX - CENTER_MIN_PX;
	if (l + r > maxPair) {
		r = Math.max(RIGHT_RAIL_MIN, maxPair - l);
		if (r < RIGHT_RAIL_MIN || l + r > maxPair) {
			r = RIGHT_RAIL_MIN;
			l = Math.max(LEFT_RAIL_MIN, Math.min(LEFT_RAIL_MAX, maxPair - r));
		}
	}
	return { left: l, right: r };
}

/** 左、右各约 25% 视口，中间列用 1fr 占剩余约 50%（已扣除两条拖拽条宽度） */
export function defaultQuarterRailWidths(): { left: number; right: number } {
	const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
	const usable = Math.max(0, w - 2 * RESIZE_HANDLE_PX);
	const quarter = Math.round(usable * 0.25);
	return clampSidebarLayout(quarter, quarter);
}

export function syncDesktopSidebarLayout(
	shell: NonNullable<Window['asyncShell']> | undefined,
	c: { left: number; right: number }
): void {
	if (!shell) {
		return;
	}
	void shell.invoke('settings:set', {
		ui: { sidebarLayout: { left: c.left, right: c.right } },
	});
}

export function readStoredShellLayoutModeFromKey(storageKey: string): ShellLayoutMode {
	try {
		if (typeof window !== 'undefined') {
			const v = localStorage.getItem(storageKey);
			if (v === 'agent' || v === 'editor') {
				return v;
			}
		}
	} catch {
		/* ignore */
	}
	return 'agent';
}

export function writeStoredShellLayoutMode(m: ShellLayoutMode, storageKey: string): void {
	try {
		localStorage.setItem(storageKey, m);
	} catch {
		/* ignore */
	}
}

export function syncDesktopShellLayoutMode(
	shell: NonNullable<Window['asyncShell']> | undefined,
	m: ShellLayoutMode
): void {
	if (!shell) {
		return;
	}
	void shell.invoke('settings:set', { ui: { layoutMode: m } });
}

export function readSidebarLayout(storageKey: string = DEFAULT_SIDEBAR_LAYOUT_KEY): { left: number; right: number } {
	try {
		if (typeof window !== 'undefined') {
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const j = JSON.parse(raw) as { left?: unknown; right?: unknown };
				if (
					typeof j.left === 'number' &&
					typeof j.right === 'number' &&
					Number.isFinite(j.left) &&
					Number.isFinite(j.right)
				) {
					return { left: j.left, right: j.right };
				}
			}
		}
	} catch {
		/* ignore */
	}
	return defaultQuarterRailWidths();
}
