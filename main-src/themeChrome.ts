import { BrowserWindow } from 'electron';

/** Keep native window chrome aligned with renderer theme tokens. */
export const THEME_CHROME = {
	light: {
		backgroundColor: '#e8edf5',
		titleBarOverlay: {
			color: '#EFF3F9',
			symbolColor: '#18202e',
			height: 44,
		},
	},
	dark: {
		backgroundColor: '#111111',
		titleBarOverlay: {
			color: '#161D24',
			symbolColor: '#BBBBBB',
			height: 44,
		},
	},
} as const;

export type ThemeChromeScheme = keyof typeof THEME_CHROME;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export type NativeChromeOverride = {
	backgroundColor: string;
	titleBarColor: string;
	symbolColor: string;
};

function isHex6(s: unknown): s is string {
	return typeof s === 'string' && HEX6.test(s.trim());
}

/** Apply window background + Windows titleBarOverlay; optional hex override from renderer appearance. */
export function applyThemeChromeToWindow(
	win: BrowserWindow,
	scheme: ThemeChromeScheme,
	override?: NativeChromeOverride | null
): void {
	const c = THEME_CHROME[scheme];
	if (win.isDestroyed()) {
		return;
	}
	const bg =
		override && isHex6(override.backgroundColor) ? override.backgroundColor.trim() : c.backgroundColor;
	const barColor = override && isHex6(override.titleBarColor) ? override.titleBarColor.trim() : c.titleBarOverlay.color;
	const symColor = override && isHex6(override.symbolColor) ? override.symbolColor.trim() : c.titleBarOverlay.symbolColor;
	win.setBackgroundColor(bg);
	if (process.platform === 'win32') {
		try {
			win.setTitleBarOverlay({
				color: barColor,
				symbolColor: symColor,
				height: c.titleBarOverlay.height,
			});
		} catch {
			/* ignore */
		}
	}
}

export function applyThemeChromeToAllWindows(scheme: ThemeChromeScheme): void {
	for (const win of BrowserWindow.getAllWindows()) {
		applyThemeChromeToWindow(win, scheme);
	}
}
