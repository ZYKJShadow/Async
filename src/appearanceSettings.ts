export type UiFontPresetId = 'apple' | 'inter' | 'segoe';
export type CodeFontPresetId = 'sfmono' | 'monospace' | 'jetbrains';
export type ThemePresetId = 'async' | 'cursor' | 'graphite' | 'forest' | 'sunset';
export type ThemePresetSelectionId = ThemePresetId | 'custom';

type AppearanceChromeSeed = {
	accentColor: string;
	backgroundColor: string;
	foregroundColor: string;
	contrast: number;
	translucentSidebar: boolean;
};

export type AppAppearanceSettings = {
	accentColor: string;
	backgroundColor: string;
	foregroundColor: string;
	themePresetId: ThemePresetSelectionId;
	uiFontPreset: UiFontPresetId;
	codeFontPreset: CodeFontPresetId;
	translucentSidebar: boolean;
	contrast: number;
	usePointerCursors: boolean;
	uiFontSize: number;
	codeFontSize: number;
};

export const APPLE_UI_FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif';
export const INTER_UI_FONT_STACK =
	'"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const SEGOE_UI_FONT_STACK =
	'"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

export const SFMONO_CODE_FONT_STACK =
	'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
export const MONOSPACE_CODE_FONT_STACK =
	'ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace';
export const JETBRAINS_CODE_FONT_STACK =
	'"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace';

export const THEME_PRESET_IDS: readonly ThemePresetId[] = ['async', 'cursor', 'graphite', 'forest', 'sunset'];

/**
 * 与 `styles/theme-dark.css` / `theme-light.css` 中 mac-codex 的 `--void-*` 一致（另补 `--void-accent` = `--void-ring`）。
 * 仅用于设置页内局部预览；document 上内置配色时应 **清除** 这些变量的内联覆盖，让主题表生效。
 */
function macCodexBuiltinPreviewVarsDark(): Record<string, string> {
	const accent = '#37d6d4';
	return {
		'--void-bg-0': '#11171c',
		'--void-bg-1': '#151c22',
		'--void-bg-2': '#1e2831',
		'--void-bg-3': '#293743',
		'--void-fg-0': '#f3f7f8',
		'--void-fg-1': '#ced7dc',
		'--void-fg-2': '#94a3af',
		'--void-fg-3': '#657582',
		'--void-accent': accent,
		'--void-accent-contrast': accentContrast(accent),
		'--void-accent-glow': 'rgba(55, 214, 212, 0.18)',
		'--void-accent-soft': 'rgba(55, 214, 212, 0.1)',
		'--void-border': 'rgba(205, 217, 224, 0.14)',
		'--void-border-soft': 'rgba(205, 217, 224, 0.07)',
		'--void-ring': '#37d6d4',
		'--void-scrollbar-track': 'rgba(17, 23, 28, 0.66)',
		'--void-scrollbar-thumb': 'rgba(108, 122, 134, 0.42)',
		'--void-scrollbar-thumb-hover': 'rgba(132, 148, 162, 0.56)',
		'--void-scrollbar-thumb-active': 'rgba(164, 178, 191, 0.64)',
		'--ref-menubar-chrome-bg': '#161d24',
		'--void-sidebar-fill': 'rgba(19, 25, 31, 0.98)',
		'--void-accent-cool': '#37d6d4',
		'--void-accent-warm': '#ff9d59',
		'--void-accent-assist': '#8aa8ff',
		'--void-accent-cool-soft': 'rgba(55, 214, 212, 0.16)',
		'--void-accent-warm-soft': 'rgba(255, 157, 89, 0.16)',
		'--surface-tint-soft': 'rgba(55, 214, 212, 0.05)',
		'--surface-tint-strong': 'rgba(55, 214, 212, 0.09)',
		'--app-backdrop':
			'radial-gradient(circle at top center, rgba(55, 214, 212, 0.08) 0%, transparent 28%), radial-gradient(circle at 84% 12%, rgba(255, 157, 89, 0.08) 0%, transparent 22%), radial-gradient(circle at 14% 18%, rgba(58, 122, 147, 0.06) 0%, transparent 24%), linear-gradient(180deg, #171f26 0%, #11171c 100%)',
	};
}

function macCodexBuiltinPreviewVarsLight(): Record<string, string> {
	const accent = '#418eff';
	return {
		'--void-bg-0': '#e8edf5',
		'--void-bg-1': '#f5f7fb',
		'--void-bg-2': '#edf2f8',
		'--void-bg-3': '#dfe6f0',
		'--void-fg-0': '#18202e',
		'--void-fg-1': '#354055',
		'--void-fg-2': '#5f6d86',
		'--void-fg-3': '#8b98ad',
		'--void-accent': accent,
		'--void-accent-contrast': accentContrast(accent),
		'--void-accent-glow': 'rgba(78, 146, 255, 0.2)',
		'--void-accent-soft': 'rgba(78, 146, 255, 0.1)',
		'--void-border': 'rgba(93, 109, 136, 0.18)',
		'--void-border-soft': 'rgba(79, 93, 122, 0.09)',
		'--void-ring': '#418eff',
		'--void-scrollbar-track': 'rgba(229, 235, 245, 0.78)',
		'--void-scrollbar-thumb': 'rgba(123, 137, 160, 0.38)',
		'--void-scrollbar-thumb-hover': 'rgba(98, 113, 139, 0.5)',
		'--void-scrollbar-thumb-active': 'rgba(82, 96, 120, 0.58)',
		'--ref-menubar-chrome-bg': 'rgba(240, 244, 250, 0.86)',
		'--void-sidebar-fill': 'rgba(245, 247, 251, 0.78)',
		'--void-accent-cool': '#418eff',
		'--void-accent-warm': '#f97316',
		'--void-accent-assist': '#3d62c4',
		'--void-accent-cool-soft': 'rgba(78, 146, 255, 0.16)',
		'--void-accent-warm-soft': 'rgba(249, 115, 22, 0.14)',
		'--surface-tint-soft': 'rgba(65, 142, 255, 0.08)',
		'--surface-tint-strong': 'rgba(65, 142, 255, 0.13)',
		'--app-backdrop':
			'radial-gradient(circle at top center, rgba(65, 142, 255, 0.1) 0%, transparent 34%), radial-gradient(circle at 10% 18%, rgba(56, 189, 248, 0.08) 0%, transparent 22%), radial-gradient(circle at 86% 12%, rgba(249, 115, 22, 0.08) 0%, transparent 24%), linear-gradient(180deg, #f0f4fa 0%, #e8edf5 48%, #e4eaf3 100%)',
	};
}

/** 写入 html 内联的 chrome 变量名（清除时用） */
const APPEARANCE_CHROME_CSS_VAR_KEYS: string[] = [
	'--void-bg-0',
	'--void-bg-1',
	'--void-bg-2',
	'--void-bg-3',
	'--void-fg-0',
	'--void-fg-1',
	'--void-fg-2',
	'--void-fg-3',
	'--void-accent',
	'--void-accent-contrast',
	'--void-accent-glow',
	'--void-accent-soft',
	'--void-border',
	'--void-border-soft',
	'--void-ring',
	'--void-scrollbar-track',
	'--void-scrollbar-thumb',
	'--void-scrollbar-thumb-hover',
	'--void-scrollbar-thumb-active',
	'--ref-menubar-chrome-bg',
	'--void-sidebar-fill',
	'--void-accent-cool',
	'--void-accent-warm',
	'--void-accent-assist',
	'--void-accent-cool-soft',
	'--void-accent-warm-soft',
	'--surface-tint-soft',
	'--surface-tint-strong',
	'--app-backdrop',
	'--surface-panel-bg',
	'--surface-panel-bg-strong',
	'--surface-panel-bg-soft',
	'--surface-glass-stroke',
	'--surface-search-bg',
	'--shadow-floating',
	'--shadow-toolbar',
	'--shadow-pressed',
	'--shadow-popover',
	'--shadow-accent',
	'--surface-popover-bg',
	'--surface-control-bg',
	'--surface-control-bg-hover',
	'--surface-control-bg-active',
	'--surface-code-bg',
	'--surface-bubble-user',
	'--surface-card-bg',
	'--surface-card-bg-soft',
	'--void-agent-shell-glow',
	'--void-agent-sidebar-bg',
	'--void-agent-center-bg',
	'--void-settings-backdrop-bg',
	'--void-settings-root-bg',
	'--void-settings-sidebar-bg',
	'--void-settings-main-bg',
	'--void-btn-primary-bg',
	'--void-btn-primary-border',
	'--void-btn-primary-shadow',
	'--void-btn-primary-hover-bg',
	'--void-btn-primary-hover-filter',
	'--void-btn-primary-hover-transform',
	'--void-input-bg',
	'--void-input-border',
	'--void-input-shadow',
	'--void-input-focus-border',
	'--void-input-focus-shadow',
	'--void-appearance-shell-bg',
	'--void-appearance-shell-border',
	'--void-appearance-shell-shadow',
	'--void-shadow-card',
	'--void-shadow-soft',
	'--void-thought-meta',
	'--void-thought-body',
	'--void-thought-detail',
	'--void-git-untracked',
	'--void-git-modified',
	'--void-git-added',
	'--void-git-deleted',
	'--void-git-ignored',
	'--void-agent-shell-bg',
	'--void-agent-right-bg',
	'--void-menubar-bg',
	'--void-titlebar-symbol-color',
	'--void-composer-send-bg',
	'--void-composer-send-color',
	'--void-composer-send-hover-bg',
	'--void-composer-send-hover-color',
	'--void-composer-send-border',
	'--void-composer-send-shadow',
	'--void-composer-send-hover-filter',
	'--void-composer-send-hover-transform',
];

/** Cursor 暗色：对话区、侧栏、输入框与用户消息气泡（与 Cursor 客户端对齐） */
const CURSOR_DARK_CHAT_BG = '#181818';
const CURSOR_DARK_SIDEBAR_BG = '#141414';
const CURSOR_DARK_COMPOSER_USER_BUBBLE_BG = '#1F1F1F';
/** 顶栏与 Windows 标题栏按钮符号、发送按钮（未禁用）图标色 */
const CURSOR_DARK_CHROME_MUTED_FG = '#BBBBBB';

/** Cursor 明亮：侧栏/顶栏、输入区、发送钮、设置项卡片 */
const CURSOR_LIGHT_SIDEBAR_MENUBAR_BG = '#F3F3F3';
const CURSOR_LIGHT_COMPOSER_INPUT_BG = '#FCFCFC';
const CURSOR_LIGHT_SEND_BTN_BG = '#222222';
const CURSOR_LIGHT_SETTINGS_OPTION_BG = '#EFEFEF';

/**
 * 与 mac-codex `theme-dark` / `theme-light` 的 bg0、fg0、强调色（ring）一致，作为内置种子与「恢复默认」。
 */
export const BUILTIN_COLOR_SCHEME_APPEARANCE: Record<'light' | 'dark', AppearanceChromeSeed> = {
	dark: {
		backgroundColor: '#11171C',
		foregroundColor: '#F3F7F8',
		accentColor: '#37D6D4',
		contrast: 58,
		translucentSidebar: true,
	},
	light: {
		backgroundColor: '#E8EDF5',
		foregroundColor: '#18202E',
		accentColor: '#418EFF',
		contrast: 54,
		translucentSidebar: true,
	},
};

export const APPEARANCE_THEME_PRESETS: Record<ThemePresetId, Record<'light' | 'dark', AppearanceChromeSeed>> = {
	async: BUILTIN_COLOR_SCHEME_APPEARANCE,
	/** 对齐 codex-theme-v1（codeThemeId: codex）：surface / ink / accent / contrast 与 semantic diff、skill */
	cursor: {
		dark: {
			backgroundColor: CURSOR_DARK_CHAT_BG,
			foregroundColor: '#FCFCFC',
			accentColor: '#0169CC',
			contrast: 60,
			translucentSidebar: true,
		},
		light: {
			backgroundColor: '#FFFFFF',
			foregroundColor: '#0D0D0D',
			accentColor: '#339CFF',
			contrast: 45,
			translucentSidebar: true,
		},
	},
	graphite: {
		dark: {
			backgroundColor: '#161A20',
			foregroundColor: '#F5F7FA',
			accentColor: '#7AA2FF',
			contrast: 56,
			translucentSidebar: true,
		},
		light: {
			backgroundColor: '#EEF2F7',
			foregroundColor: '#202734',
			accentColor: '#4F7BFF',
			contrast: 52,
			translucentSidebar: true,
		},
	},
	forest: {
		dark: {
			backgroundColor: '#111915',
			foregroundColor: '#EEF8F1',
			accentColor: '#56C987',
			contrast: 55,
			translucentSidebar: true,
		},
		light: {
			backgroundColor: '#EDF7F0',
			foregroundColor: '#183126',
			accentColor: '#2F9E5C',
			contrast: 50,
			translucentSidebar: true,
		},
	},
	sunset: {
		dark: {
			backgroundColor: '#1A1513',
			foregroundColor: '#FFF4EE',
			accentColor: '#FF9D5C',
			contrast: 57,
			translucentSidebar: true,
		},
		light: {
			backgroundColor: '#FFF1E8',
			foregroundColor: '#3E2617',
			accentColor: '#E97A2F',
			contrast: 52,
			translucentSidebar: true,
		},
	},
};

/** 旧版 index 内置暗色（紫系），切换亮暗时应视为「未自定义」并迁移 */
const LEGACY_INDEX_BUILTIN_DARK: Pick<
	AppAppearanceSettings,
	'accentColor' | 'backgroundColor' | 'foregroundColor' | 'contrast' | 'translucentSidebar'
> = {
	backgroundColor: '#08080A',
	foregroundColor: '#F4F4F5',
	accentColor: '#8B93FF',
	contrast: 58,
	translucentSidebar: true,
};

const LEGACY_INDEX_BUILTIN_LIGHT: Pick<
	AppAppearanceSettings,
	'accentColor' | 'backgroundColor' | 'foregroundColor' | 'contrast' | 'translucentSidebar'
> = {
	backgroundColor: '#F5F5F7',
	foregroundColor: '#1D1D1F',
	accentColor: '#0A84FF',
	contrast: 54,
	translucentSidebar: true,
};

/** 历史「Codex」预设三色（无主题选择器后仍用于识别旧配置并参与亮暗迁移） */
const LEGACY_CODEX_CHROME_SEED: AppearanceChromeSeed = {
	accentColor: '#0169CC',
	backgroundColor: '#111111',
	foregroundColor: '#FCFCFC',
	contrast: 60,
	translucentSidebar: true,
};

/** 与当前亮/暗模式一致的内置默认外观（配色与主题表同源） */
export function defaultAppearanceSettingsForScheme(colorScheme: 'light' | 'dark'): AppAppearanceSettings {
	const seed = BUILTIN_COLOR_SCHEME_APPEARANCE[colorScheme];
	return {
		accentColor: seed.accentColor,
		backgroundColor: seed.backgroundColor,
		foregroundColor: seed.foregroundColor,
		themePresetId: 'async',
		uiFontPreset: 'apple',
		codeFontPreset: 'sfmono',
		translucentSidebar: seed.translucentSidebar,
		contrast: seed.contrast,
		usePointerCursors: false,
		uiFontSize: 13,
		codeFontSize: 12,
	};
}

/** 首屏与未持久化场景：与历史行为一致，按暗色内置默认 */
export function defaultAppearanceSettings(): AppAppearanceSettings {
	return defaultAppearanceSettingsForScheme('dark');
}

/** 是否与当前亮/暗下的内置默认一致（含配色、字体与字号等） */
export function isAppearanceFactoryDefault(appearance: AppAppearanceSettings, colorScheme: 'light' | 'dark'): boolean {
	const n = normalizeAppearanceSettings(appearance, colorScheme);
	const d = defaultAppearanceSettingsForScheme(colorScheme);
	const keys: (keyof AppAppearanceSettings)[] = [
		'accentColor',
		'backgroundColor',
		'foregroundColor',
		'themePresetId',
		'uiFontPreset',
		'codeFontPreset',
		'translucentSidebar',
		'contrast',
		'usePointerCursors',
		'uiFontSize',
		'codeFontSize',
	];
	return keys.every((k) => n[k] === d[k]);
}

export function normalizeUiFontPreset(raw: unknown): UiFontPresetId {
	if (raw === 'apple' || raw === 'inter' || raw === 'segoe') {
		return raw;
	}
	return 'apple';
}

export function normalizeCodeFontPreset(raw: unknown): CodeFontPresetId {
	if (raw === 'sfmono' || raw === 'monospace' || raw === 'jetbrains') {
		return raw;
	}
	return 'sfmono';
}

function isThemePresetId(raw: unknown): raw is ThemePresetId {
	return typeof raw === 'string' && THEME_PRESET_IDS.includes(raw as ThemePresetId);
}

export function normalizeThemePresetId(raw: unknown): ThemePresetSelectionId {
	if (raw === 'custom') {
		return 'custom';
	}
	return isThemePresetId(raw) ? raw : 'custom';
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(Math.max(n, min), max);
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
	return typeof raw === 'boolean' ? raw : fallback;
}

function normalizeNumber(raw: unknown, fallback: number, min: number, max: number): number {
	return typeof raw === 'number' && Number.isFinite(raw) ? clamp(Math.round(raw), min, max) : fallback;
}

function normalizeHexColor(raw: unknown, fallback: string): string {
	const s = String(raw ?? '').trim();
	if (/^#[0-9a-fA-F]{6}$/.test(s)) {
		return s.toUpperCase();
	}
	if (/^#[0-9a-fA-F]{3}$/.test(s)) {
		const digits = s.slice(1).split('');
		return (`#${digits.map((d) => d + d).join('')}`).toUpperCase();
	}
	return fallback.toUpperCase();
}

export function inferThemePresetIdForScheme(
	appearance: Pick<AppAppearanceSettings, 'accentColor' | 'backgroundColor' | 'foregroundColor' | 'contrast' | 'translucentSidebar'>,
	scheme: 'light' | 'dark'
): ThemePresetSelectionId {
	const normalized = {
		accentColor: normalizeHexColor(appearance.accentColor, '#000000'),
		backgroundColor: normalizeHexColor(appearance.backgroundColor, '#000000'),
		foregroundColor: normalizeHexColor(appearance.foregroundColor, '#FFFFFF'),
		contrast: clamp(Math.round(appearance.contrast), 0, 100),
		translucentSidebar: Boolean(appearance.translucentSidebar),
	};
	for (const presetId of THEME_PRESET_IDS) {
		const preset = APPEARANCE_THEME_PRESETS[presetId][scheme];
		if (
			normalized.accentColor === preset.accentColor &&
			normalized.backgroundColor === preset.backgroundColor &&
			normalized.foregroundColor === preset.foregroundColor &&
			normalized.contrast === preset.contrast &&
			normalized.translucentSidebar === preset.translucentSidebar
		) {
			return presetId;
		}
	}
	return 'custom';
}

export function normalizeAppearanceSettings(
	raw?: Partial<Record<string, unknown>> | null,
	colorScheme: 'light' | 'dark' = 'dark'
): AppAppearanceSettings {
	const defaults = defaultAppearanceSettingsForScheme(colorScheme);
	const normalized = {
		accentColor: normalizeHexColor(raw?.accentColor, defaults.accentColor),
		backgroundColor: normalizeHexColor(raw?.backgroundColor, defaults.backgroundColor),
		foregroundColor: normalizeHexColor(raw?.foregroundColor, defaults.foregroundColor),
		themePresetId: 'custom' as ThemePresetSelectionId,
		uiFontPreset: normalizeUiFontPreset(raw?.uiFontPreset ?? raw?.fontPreset),
		codeFontPreset: normalizeCodeFontPreset(raw?.codeFontPreset),
		translucentSidebar: normalizeBoolean(raw?.translucentSidebar, defaults.translucentSidebar),
		contrast: normalizeNumber(raw?.contrast, defaults.contrast, 0, 100),
		usePointerCursors: normalizeBoolean(raw?.usePointerCursors, defaults.usePointerCursors),
		uiFontSize: normalizeNumber(raw?.uiFontSize, defaults.uiFontSize, 11, 18),
		codeFontSize: normalizeNumber(raw?.codeFontSize, defaults.codeFontSize, 11, 18),
	};
	const explicitThemePresetId = normalizeThemePresetId(raw?.themePresetId);
	return {
		...normalized,
		themePresetId:
			explicitThemePresetId !== 'custom'
				? explicitThemePresetId
				: raw?.themePresetId === 'custom'
					? 'custom'
					: inferThemePresetIdForScheme(normalized, colorScheme),
	};
}

export function appearanceMatchesThemePreset(
	appearance: AppAppearanceSettings,
	presetId: ThemePresetId,
	scheme: 'light' | 'dark'
): boolean {
	return inferThemePresetIdForScheme(appearance, scheme) === presetId;
}

export function applyThemePresetToAppearance(
	current: AppAppearanceSettings,
	presetId: ThemePresetId,
	scheme: 'light' | 'dark'
): AppAppearanceSettings {
	const preset = APPEARANCE_THEME_PRESETS[presetId][scheme];
	return {
		...current,
		accentColor: preset.accentColor,
		backgroundColor: preset.backgroundColor,
		foregroundColor: preset.foregroundColor,
		themePresetId: presetId,
		translucentSidebar: preset.translucentSidebar,
		contrast: preset.contrast,
	};
}

export function resolveUiFontFamily(preset: UiFontPresetId): string {
	switch (preset) {
		case 'inter':
			return INTER_UI_FONT_STACK;
		case 'segoe':
			return SEGOE_UI_FONT_STACK;
		case 'apple':
		default:
			return APPLE_UI_FONT_STACK;
	}
}

export function resolveCodeFontFamily(preset: CodeFontPresetId): string {
	switch (preset) {
		case 'monospace':
			return MONOSPACE_CODE_FONT_STACK;
		case 'jetbrains':
			return JETBRAINS_CODE_FONT_STACK;
		case 'sfmono':
		default:
			return SFMONO_CODE_FONT_STACK;
	}
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = normalizeHexColor(hex, '#000000').slice(1);
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
	return `#${[rgb.r, rgb.g, rgb.b]
		.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
		.join('')}`.toUpperCase();
}

function mixHex(base: string, target: string, targetWeight: number): string {
	const a = hexToRgb(base);
	const b = hexToRgb(target);
	const w = Math.min(Math.max(targetWeight, 0), 1);
	return rgbToHex({
		r: a.r * (1 - w) + b.r * w,
		g: a.g * (1 - w) + b.g * w,
		b: a.b * (1 - w) + b.b * w,
	});
}

function hexToRgba(hex: string, alpha: number): string {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${Math.min(Math.max(alpha, 0), 1).toFixed(3)})`;
}

function relativeLuminance(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	const linear = [r, g, b].map((v) => {
		const channel = v / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function accentContrast(hex: string): string {
	return relativeLuminance(hex) > 0.45 ? '#111111' : '#FCFCFC';
}

/** 与主色搭配的「暖色」高光（用于 mac-codex 多光晕背景，避免换主题后仍残留青/橙固定色） */
function accentWarmCompanion(accentHex: string): string {
	return mixHex(accentHex, '#ea580c', 0.26);
}

function buildAppBackdropLayers(bg0: string, bg1: string, accent: string, warm: string): string {
	const mid = mixHex(bg0, bg1, 0.38);
	return [
		`radial-gradient(circle at top center, ${hexToRgba(accent, 0.12)} 0%, transparent 30%)`,
		`radial-gradient(circle at 84% 12%, ${hexToRgba(warm, 0.1)} 0%, transparent 24%)`,
		`radial-gradient(circle at 14% 18%, ${hexToRgba(mixHex(accent, bg1, 0.45), 0.07)} 0%, transparent 26%)`,
		`linear-gradient(180deg, ${mid} 0%, ${bg0} 100%)`,
	].join(', ');
}

/**
 * mac-codex 布局大量依赖 --surface-* / --shadow-*；若只改 --void-bg-* 而不覆盖这些，换主题时侧栏/卡片仍像默认 Async。
 */
function macCodexSemanticSurfaceTokens(
	isLight: boolean,
	bg0: string,
	bg1: string,
	bg2: string,
	fg0: string,
	fg2: string,
	fg3: string,
	accent: string,
	warm: string,
	contrastBoost: number
): Record<string, string> {
	const a = contrastBoost * 0.04;
	if (!isLight) {
		const cardTop = mixHex(bg1, accent, 0.055 + a);
		const cardBot = mixHex(bg0, accent, 0.032 + a * 0.8);
		const shadowTint = mixHex(bg0, '#000000', 0.8);
		return {
			'--surface-panel-bg': hexToRgba(bg1, 0.96),
			'--surface-panel-bg-strong': hexToRgba(mixHex(bg0, bg1, 0.3), 0.985),
			'--surface-panel-bg-soft': hexToRgba(mixHex(bg2, accent, 0.09 + a), 0.98),
			'--surface-glass-stroke': hexToRgba(fg0, 0.08),
			'--surface-search-bg': hexToRgba(mixHex(bg1, accent, 0.16 + a), 0.97),
			'--shadow-floating': `0 18px 38px ${hexToRgba(shadowTint, 0.26)}`,
			'--shadow-toolbar': `0 1px 0 ${hexToRgba(fg0, 0.028)}`,
			'--shadow-pressed': `inset 0 1px 0 ${hexToRgba(fg0, 0.04)}`,
			'--shadow-popover': `0 22px 52px ${hexToRgba(shadowTint, 0.36)}`,
			'--shadow-accent': `0 14px 28px ${hexToRgba(accent, 0.22 + contrastBoost * 0.08)}`,
			'--surface-popover-bg': hexToRgba(mixHex(bg0, bg1, 0.38), 0.985),
			'--surface-control-bg': hexToRgba(mixHex(bg2, accent, 0.07 + a), 0.98),
			'--surface-control-bg-hover': hexToRgba(mixHex(bg2, accent, 0.12 + a), 0.98),
			'--surface-control-bg-active': hexToRgba(mixHex(bg2, accent, 0.16 + a), 0.98),
			'--surface-code-bg': hexToRgba(mixHex(bg0, fg0, 0.05), 0.96),
			'--surface-bubble-user': `linear-gradient(180deg, ${hexToRgba(mixHex(bg2, accent, 0.14 + a), 0.98)} 0%, ${hexToRgba(mixHex(bg1, accent, 0.08 + a), 0.98)} 100%)`,
			'--surface-card-bg': `linear-gradient(180deg, ${hexToRgba(cardTop, 0.98)} 0%, ${hexToRgba(cardBot, 0.98)} 100%)`,
			'--surface-card-bg-soft': `linear-gradient(180deg, ${hexToRgba(mixHex(bg2, accent, 0.06 + a), 0.98)} 0%, ${hexToRgba(mixHex(bg1, warm, 0.05 + a), 0.98)} 100%)`,
			'--void-shadow-card': `0 20px 44px ${hexToRgba(shadowTint, 0.3)}`,
			'--void-shadow-soft': `inset 0 1px 0 ${hexToRgba(fg0, 0.032)}`,
			'--void-thought-meta': mixHex(fg2, accent, 0.08),
			'--void-thought-body': mixHex(mixHex(fg0, bg0, 0.12), accent, 0.05),
			'--void-thought-detail': mixHex(fg2, accent, 0.06),
			'--void-git-untracked': mixHex('#4ade80', accent, 0.22),
			'--void-git-modified': mixHex('#fbbf24', warm, 0.28),
			'--void-git-added': mixHex('#4ade80', accent, 0.16),
			'--void-git-deleted': mixHex('#f87171', warm, 0.15),
			'--void-git-ignored': mixHex(fg3, accent, 0.1),
		};
	}
	const cardTopL = mixHex(bg1, accent, 0.09 + a);
	const cardBotL = mixHex(bg0, accent, 0.05 + a);
	const shadowBlue = mixHex(bg0, fg0, 0.4);
	return {
		'--surface-panel-bg': hexToRgba(mixHex(bg1, accent, 0.08 + a), 0.84),
		'--surface-panel-bg-strong': hexToRgba(mixHex(bg0, accent, 0.05 + a), 0.92),
		'--surface-panel-bg-soft': hexToRgba(mixHex(bg2, accent, 0.07 + a), 0.88),
		'--surface-glass-stroke': hexToRgba(fg0, 0.14),
		'--surface-search-bg': hexToRgba(mixHex(bg1, accent, 0.11 + a), 0.84),
		'--shadow-floating': `0 24px 70px ${hexToRgba(shadowBlue, 0.14)}`,
		'--shadow-toolbar': `0 1px 0 ${hexToRgba(fg0, 0.08)}, 0 16px 42px ${hexToRgba(shadowBlue, 0.12)}`,
		'--shadow-pressed': `inset 0 1px 0 ${hexToRgba(fg0, 0.12)}`,
		'--shadow-popover': `0 22px 52px ${hexToRgba(shadowBlue, 0.16)}`,
		'--shadow-accent': `0 14px 28px ${hexToRgba(accent, 0.2)}`,
		'--surface-popover-bg': hexToRgba(mixHex(bg1, fg0, 0.03), 0.95),
		'--surface-control-bg': hexToRgba(mixHex(bg2, accent, 0.08 + a), 0.94),
		'--surface-control-bg-hover': hexToRgba(mixHex(bg2, accent, 0.12 + a), 0.96),
		'--surface-control-bg-active': hexToRgba(mixHex(bg2, accent, 0.15 + a), 0.98),
		'--surface-code-bg': hexToRgba(mixHex(bg0, fg0, 0.03), 0.96),
		'--surface-bubble-user': `linear-gradient(180deg, ${hexToRgba(mixHex(bg1, accent, 0.09 + a), 0.96)} 0%, ${hexToRgba(mixHex(bg2, accent, 0.06 + a), 0.96)} 100%)`,
		'--surface-card-bg': `linear-gradient(180deg, ${hexToRgba(cardTopL, 0.96)} 0%, ${hexToRgba(cardBotL, 0.96)} 100%)`,
		'--surface-card-bg-soft': `linear-gradient(180deg, ${hexToRgba(mixHex(bg2, accent, 0.06 + a), 0.96)} 0%, ${hexToRgba(mixHex(bg1, warm, 0.06 + a), 0.96)} 100%)`,
		'--void-shadow-card': `0 24px 72px ${hexToRgba(shadowBlue, 0.14)}`,
		'--void-shadow-soft': `inset 0 1px 0 ${hexToRgba(fg0, 0.22)}`,
		'--void-thought-meta': mixHex(fg2, accent, 0.12),
		'--void-thought-body': mixHex(fg0, accent, 0.08),
		'--void-thought-detail': mixHex(fg2, accent, 0.1),
		'--void-git-untracked': mixHex('#15803d', accent, 0.22),
		'--void-git-modified': mixHex('#b45309', warm, 0.22),
		'--void-git-added': mixHex('#15803d', accent, 0.16),
		'--void-git-deleted': mixHex('#dc2626', warm, 0.14),
		'--void-git-ignored': mixHex(fg3, accent, 0.12),
	};
}

/**
 * 将 CSS 颜色转为 Electron 可用的 #RRGGBB（rgba 按给定底色做不透明度混合）。
 */
function opaqueHexForNativeChrome(cssColor: string, blendOntoHex: string): string {
	const t = cssColor.trim();
	if (/^#[0-9a-fA-F]{6}$/i.test(t)) {
		return normalizeHexColor(t, blendOntoHex);
	}
	const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
	if (m) {
		const r = Number(m[1]);
		const g = Number(m[2]);
		const b = Number(m[3]);
		const a = m[4] !== undefined ? Number(m[4]) : 1;
		const base = hexToRgb(normalizeHexColor(blendOntoHex, '#111111'));
		const aa = Math.min(Math.max(a, 0), 1);
		return rgbToHex({
			r: Math.round(base.r * (1 - aa) + r * aa),
			g: Math.round(base.g * (1 - aa) + g * aa),
			b: Math.round(base.b * (1 - aa) + b * aa),
		});
	}
	return normalizeHexColor(blendOntoHex, '#111111');
}

/**
 * Windows 标题栏叠加层与窗口底色（与当前外观 token 对齐）。
 */
export function nativeWindowChromeFromAppearance(
	settings: AppAppearanceSettings,
	colorScheme: 'light' | 'dark'
): { backgroundColor: string; titleBarColor: string; symbolColor: string } {
	const vars = resolveAppearanceChromeColorVars(settings, colorScheme);
	const bg0 = vars['--void-bg-0'] ?? '#11171c';
	const menubar = vars['--ref-menubar-chrome-bg'] ?? bg0;
	const fg1 = vars['--void-fg-1'] ?? '#ced7dc';
	const bg0Hex = opaqueHexForNativeChrome(bg0, bg0);
	const titleHex = opaqueHexForNativeChrome(menubar, bg0Hex);
	const symbolToken = vars['--void-titlebar-symbol-color']?.trim() ?? '';
	const symbolHex =
		/^#[0-9a-fA-F]{6}$/i.test(symbolToken) ? normalizeHexColor(symbolToken, titleHex) : opaqueHexForNativeChrome(fg1, titleHex);
	return {
		backgroundColor: bg0Hex,
		titleBarColor: titleHex,
		symbolColor: symbolHex,
	};
}

/**
 * 由外观配色推导出的 CSS 变量（与 applyAppearanceSettingsToDom 中颜色部分一致）。
 * 可用于局部作用域（例如设置里「导入前」预览）而不污染 document。
 */
export function appearanceSettingsColorVars(settings: AppAppearanceSettings): Record<string, string> {
	const contrastBoost = settings.contrast / 100;
	const bg0 = normalizeHexColor(settings.backgroundColor, '#111111');
	const fg0 = normalizeHexColor(settings.foregroundColor, '#FCFCFC');
	const accent = normalizeHexColor(settings.accentColor, '#0169CC');
	const isLightChrome = relativeLuminance(bg0) > 0.44;
	const scheme: 'light' | 'dark' = isLightChrome ? 'light' : 'dark';
	const inferredPreset = inferThemePresetIdForScheme(settings, scheme);
	const isCursorPreset = settings.themePresetId === 'cursor' || inferredPreset === 'cursor';
	const warm = isCursorPreset
		? scheme === 'dark'
			? '#E02E2A'
			: '#BA2623'
		: accentWarmCompanion(accent);
	const accentBias = 0.022 + contrastBoost * 0.045;
	const elevationRef = isLightChrome ? '#FFFFFF' : fg0;
	const baseB1 = mixHex(bg0, elevationRef, 0.05 + contrastBoost * 0.035);
	const baseB2 = mixHex(bg0, elevationRef, 0.09 + contrastBoost * 0.055);
	const baseB3 = mixHex(bg0, elevationRef, 0.15 + contrastBoost * 0.075);
	const bg1 = mixHex(baseB1, accent, accentBias);
	const bg2 = mixHex(baseB2, accent, accentBias * 1.45);
	const bg3 = mixHex(baseB3, accent, accentBias * 1.85);
	const fg1 = mixHex(fg0, bg0, 0.14 + (1 - contrastBoost) * 0.03);
	const fg2 = mixHex(fg0, bg0, 0.34 + (1 - contrastBoost) * 0.08);
	const fg3 = mixHex(fg0, bg0, 0.54 + (1 - contrastBoost) * 0.08);
	const border = hexToRgba(fg0, 0.14 + contrastBoost * 0.06);
	const borderSoft = hexToRgba(fg0, 0.07 + contrastBoost * 0.05);
	const sidebarAlpha = settings.translucentSidebar ? 0.74 : 0.98;
	const semantic = macCodexSemanticSurfaceTokens(
		isLightChrome,
		bg0,
		bg1,
		bg2,
		fg0,
		fg2,
		fg3,
		accent,
		warm,
		contrastBoost
	);
	const cursorCodexSemantic: Record<string, string> = isCursorPreset
		? scheme === 'dark'
			? {
					'--void-bg-0': CURSOR_DARK_CHAT_BG,
					'--void-bg-1': CURSOR_DARK_SIDEBAR_BG,
					'--void-bg-2': CURSOR_DARK_COMPOSER_USER_BUBBLE_BG,
					'--void-bg-3': mixHex(CURSOR_DARK_COMPOSER_USER_BUBBLE_BG, '#FFFFFF', 0.07),
					'--void-git-added': '#00A240',
					'--void-git-deleted': '#E02E2A',
					'--void-git-untracked': mixHex('#00A240', accent, 0.22),
					'--void-git-modified': mixHex('#FBBF24', warm, 0.32),
					'--void-sidebar-fill': hexToRgba(CURSOR_DARK_SIDEBAR_BG, sidebarAlpha),
					'--void-agent-shell-glow': 'none',
					'--void-agent-shell-bg': CURSOR_DARK_CHAT_BG,
					'--void-agent-sidebar-bg': CURSOR_DARK_SIDEBAR_BG,
					'--void-agent-center-bg': CURSOR_DARK_CHAT_BG,
					'--void-agent-right-bg': CURSOR_DARK_CHAT_BG,
					'--void-settings-backdrop-bg': CURSOR_DARK_CHAT_BG,
					'--void-settings-root-bg': CURSOR_DARK_CHAT_BG,
					'--void-settings-sidebar-bg': CURSOR_DARK_SIDEBAR_BG,
					'--void-settings-main-bg': CURSOR_DARK_CHAT_BG,
					'--void-btn-primary-bg': accent,
					'--void-btn-primary-border': 'none',
					'--void-btn-primary-shadow': 'none',
					'--void-btn-primary-hover-bg': mixHex(accent, '#FFFFFF', 0.1),
					'--void-btn-primary-hover-filter': 'none',
					'--void-btn-primary-hover-transform': 'none',
					'--void-input-bg': CURSOR_DARK_COMPOSER_USER_BUBBLE_BG,
					'--void-input-border': hexToRgba(fg0, 0.12),
					'--void-input-shadow': 'none',
					'--void-input-focus-border': mixHex(CURSOR_DARK_COMPOSER_USER_BUBBLE_BG, accent, 0.42),
					'--void-input-focus-shadow': 'none',
					'--surface-panel-bg': hexToRgba(CURSOR_DARK_SIDEBAR_BG, 0.96),
					'--surface-panel-bg-strong': hexToRgba(CURSOR_DARK_CHAT_BG, 0.99),
					'--surface-popover-bg': hexToRgba(CURSOR_DARK_SIDEBAR_BG, 0.98),
					'--surface-glass-stroke': hexToRgba(fg0, 0.1),
					'--shadow-floating': `0 10px 28px ${hexToRgba('#000000', 0.32)}`,
					'--shadow-popover': `0 14px 36px ${hexToRgba('#000000', 0.38)}`,
					'--shadow-accent': 'none',
					'--void-appearance-shell-bg': hexToRgba(mixHex(CURSOR_DARK_CHAT_BG, fg0, 0.05), 1),
					'--void-appearance-shell-border': hexToRgba(fg0, 0.12),
					'--void-appearance-shell-shadow': `0 8px 22px ${hexToRgba('#000000', 0.28)}`,
					'--surface-bubble-user': CURSOR_DARK_COMPOSER_USER_BUBBLE_BG,
					'--surface-panel-bg-soft': hexToRgba(CURSOR_DARK_CHAT_BG, 0.92),
					'--surface-search-bg': hexToRgba(CURSOR_DARK_COMPOSER_USER_BUBBLE_BG, 0.96),
					'--surface-control-bg': CURSOR_DARK_COMPOSER_USER_BUBBLE_BG,
					'--surface-control-bg-hover': mixHex(CURSOR_DARK_COMPOSER_USER_BUBBLE_BG, '#FFFFFF', 0.06),
					'--surface-control-bg-active': mixHex(CURSOR_DARK_COMPOSER_USER_BUBBLE_BG, '#FFFFFF', 0.1),
					'--surface-card-bg-soft': CURSOR_DARK_COMPOSER_USER_BUBBLE_BG,
					'--surface-card-bg': CURSOR_DARK_COMPOSER_USER_BUBBLE_BG,
					'--void-thought-meta': mixHex(CURSOR_DARK_CHAT_BG, fg0, 0.45),
					'--void-thought-body': mixHex(CURSOR_DARK_CHAT_BG, fg0, 0.75),
					'--void-thought-detail': mixHex(CURSOR_DARK_CHAT_BG, fg0, 0.55),
					'--ref-menubar-chrome-bg': CURSOR_DARK_SIDEBAR_BG,
					'--void-menubar-bg': CURSOR_DARK_SIDEBAR_BG,
					'--void-titlebar-symbol-color': CURSOR_DARK_CHROME_MUTED_FG,
					'--void-composer-send-bg': '#BBBBBB',
					'--void-composer-send-color': CURSOR_DARK_CHAT_BG,
					'--void-composer-send-hover-bg': mixHex('#BBBBBB', '#000000', 0.12),
					'--void-composer-send-hover-color': CURSOR_DARK_CHAT_BG,
					'--void-composer-send-border': 'none',
					'--void-composer-send-shadow': 'none',
					'--void-composer-send-hover-filter': 'none',
					'--void-composer-send-hover-transform': 'none',
				}
			: {
					'--void-bg-0': '#FFFFFF',
					'--void-bg-1': CURSOR_LIGHT_SIDEBAR_MENUBAR_BG,
					'--void-bg-2': CURSOR_LIGHT_COMPOSER_INPUT_BG,
					'--void-bg-3': CURSOR_LIGHT_SETTINGS_OPTION_BG,
					'--void-git-added': '#00A240',
					'--void-git-deleted': '#BA2623',
					'--void-git-untracked': mixHex('#00A240', accent, 0.2),
					'--void-git-modified': mixHex('#F59E0B', accent, 0.38),
					'--void-sidebar-fill': hexToRgba(CURSOR_LIGHT_SIDEBAR_MENUBAR_BG, sidebarAlpha),
					'--void-agent-shell-glow': 'none',
					'--void-agent-shell-bg': '#FFFFFF',
					'--void-agent-sidebar-bg': CURSOR_LIGHT_SIDEBAR_MENUBAR_BG,
					'--void-agent-center-bg': '#FFFFFF',
					'--void-agent-right-bg': '#FFFFFF',
					'--void-settings-backdrop-bg': hexToRgba('#FFFFFF', 0.72),
					'--void-settings-root-bg': '#FFFFFF',
					'--void-settings-sidebar-bg': CURSOR_LIGHT_SIDEBAR_MENUBAR_BG,
					'--void-settings-main-bg': '#FFFFFF',
					'--void-btn-primary-bg': accent,
					'--void-btn-primary-border': 'none',
					'--void-btn-primary-shadow': 'none',
					'--void-btn-primary-hover-bg': mixHex(accent, '#000000', 0.1),
					'--void-btn-primary-hover-filter': 'none',
					'--void-btn-primary-hover-transform': 'none',
					'--void-input-bg': CURSOR_LIGHT_COMPOSER_INPUT_BG,
					'--void-input-border': hexToRgba(fg0, 0.12),
					'--void-input-shadow': 'none',
					'--void-input-focus-border': mixHex(CURSOR_LIGHT_COMPOSER_INPUT_BG, accent, 0.5),
					'--void-input-focus-shadow': 'none',
					'--surface-panel-bg': hexToRgba(CURSOR_LIGHT_SIDEBAR_MENUBAR_BG, 0.96),
					'--surface-panel-bg-strong': hexToRgba('#FFFFFF', 0.98),
					'--surface-popover-bg': hexToRgba('#FFFFFF', 0.98),
					'--surface-glass-stroke': hexToRgba(fg0, 0.1),
					'--shadow-floating': `0 12px 32px ${hexToRgba('#000000', 0.08)}`,
					'--shadow-popover': `0 16px 40px ${hexToRgba('#000000', 0.1)}`,
					'--shadow-accent': 'none',
					'--void-appearance-shell-bg': CURSOR_LIGHT_SETTINGS_OPTION_BG,
					'--void-appearance-shell-border': hexToRgba(fg0, 0.1),
					'--void-appearance-shell-shadow': `0 8px 24px ${hexToRgba('#000000', 0.06)}`,
					'--surface-bubble-user': CURSOR_LIGHT_COMPOSER_INPUT_BG,
					'--surface-panel-bg-soft': hexToRgba(CURSOR_LIGHT_SIDEBAR_MENUBAR_BG, 0.9),
					'--surface-search-bg': hexToRgba(CURSOR_LIGHT_SETTINGS_OPTION_BG, 0.95),
					'--surface-control-bg': CURSOR_LIGHT_SETTINGS_OPTION_BG,
					'--surface-control-bg-hover': mixHex(CURSOR_LIGHT_SETTINGS_OPTION_BG, '#000000', 0.04),
					'--surface-control-bg-active': mixHex(CURSOR_LIGHT_SETTINGS_OPTION_BG, '#000000', 0.07),
					'--surface-card-bg-soft': CURSOR_LIGHT_COMPOSER_INPUT_BG,
					'--surface-card-bg': CURSOR_LIGHT_COMPOSER_INPUT_BG,
					'--surface-code-bg': mixHex(CURSOR_LIGHT_SETTINGS_OPTION_BG, '#000000', 0.035),
					'--void-thought-meta': mixHex('#FFFFFF', fg0, 0.5),
					'--void-thought-body': mixHex('#FFFFFF', fg0, 0.8),
					'--void-thought-detail': mixHex('#FFFFFF', fg0, 0.6),
					'--ref-menubar-chrome-bg': CURSOR_LIGHT_SIDEBAR_MENUBAR_BG,
					'--void-menubar-bg': CURSOR_LIGHT_SIDEBAR_MENUBAR_BG,
					'--void-titlebar-symbol-color': fg0,
					'--void-composer-send-bg': CURSOR_LIGHT_SEND_BTN_BG,
					'--void-composer-send-color': '#FFFFFF',
					'--void-composer-send-hover-bg': mixHex(CURSOR_LIGHT_SEND_BTN_BG, '#FFFFFF', 0.12),
					'--void-composer-send-hover-color': '#FFFFFF',
					'--void-composer-send-border': 'none',
					'--void-composer-send-shadow': 'none',
					'--void-composer-send-hover-filter': 'none',
					'--void-composer-send-hover-transform': 'none',
				}
		: {};
	return {
		'--void-bg-0': bg0,
		'--void-bg-1': bg1,
		'--void-bg-2': bg2,
		'--void-bg-3': bg3,
		'--void-fg-0': fg0,
		'--void-fg-1': fg1,
		'--void-fg-2': fg2,
		'--void-fg-3': fg3,
		'--void-accent': accent,
		'--void-accent-contrast': accentContrast(accent),
		'--void-accent-glow': hexToRgba(accent, 0.22 + contrastBoost * 0.08),
		'--void-accent-soft': hexToRgba(accent, 0.1 + contrastBoost * 0.04),
		'--void-accent-cool': accent,
		'--void-accent-warm': warm,
		'--void-accent-assist': isCursorPreset
			? scheme === 'dark'
				? '#B06DFF'
				: '#924FF7'
			: mixHex('#7696f8', accent, isLightChrome ? 0.14 : 0.26),
		'--void-accent-cool-soft': hexToRgba(accent, 0.14 + contrastBoost * 0.03),
		'--void-accent-warm-soft': hexToRgba(warm, 0.12 + contrastBoost * 0.03),
		'--surface-tint-soft': hexToRgba(accent, 0.07 + contrastBoost * 0.035),
		'--surface-tint-strong': hexToRgba(accent, 0.12 + contrastBoost * 0.04),
		'--app-backdrop': buildAppBackdropLayers(bg0, bg1, accent, warm),
		'--void-border': border,
		'--void-border-soft': borderSoft,
		'--void-ring': accent,
		'--void-scrollbar-track': isLightChrome ? hexToRgba(bg1, 0.78) : hexToRgba(bg0, 0.66),
		'--void-scrollbar-thumb': hexToRgba(fg0, 0.2 + contrastBoost * 0.1),
		'--void-scrollbar-thumb-hover': hexToRgba(fg0, 0.26 + contrastBoost * 0.1),
		'--void-scrollbar-thumb-active': hexToRgba(fg0, 0.32 + contrastBoost * 0.1),
		'--void-sidebar-fill': hexToRgba(bg1, sidebarAlpha),
		'--ref-menubar-chrome-bg': mixHex(bg0, fg0, 0.07 + contrastBoost * 0.04),
		...semantic,
		...cursorCodexSemantic,
	};
}

/** 三色/对比度/侧栏与当前亮暗下的内置种子一致时，应使用样式表级 token（含青紫倾向的暗色层级）。 */
export function appearanceMatchesBuiltinChromeSeed(appearance: AppAppearanceSettings, scheme: 'light' | 'dark'): boolean {
	const n = normalizeAppearanceSettings(appearance, scheme);
	const b = defaultAppearanceSettingsForScheme(scheme);
	return (
		n.accentColor === b.accentColor &&
		n.backgroundColor === b.backgroundColor &&
		n.foregroundColor === b.foregroundColor &&
		n.contrast === b.contrast &&
		n.translucentSidebar === b.translucentSidebar
	);
}

/** 与历史 Codex 预设三色一致（常见「未改色」状态） */
export function appearanceUsesUnambiguousDarkAutoChrome(appearance: AppAppearanceSettings): boolean {
	const n = normalizeAppearanceSettings(appearance, 'dark');
	const p = LEGACY_CODEX_CHROME_SEED;
	return (
		n.accentColor === p.accentColor &&
		n.backgroundColor === p.backgroundColor &&
		n.foregroundColor === p.foregroundColor &&
		n.contrast === p.contrast &&
		n.translucentSidebar === p.translucentSidebar
	);
}

function matchesLegacyIndexBuiltin(appearance: AppAppearanceSettings, scheme: 'light' | 'dark'): boolean {
	const n = normalizeAppearanceSettings(appearance, scheme);
	const L = scheme === 'dark' ? LEGACY_INDEX_BUILTIN_DARK : LEGACY_INDEX_BUILTIN_LIGHT;
	return (
		n.accentColor === normalizeHexColor(L.accentColor, n.accentColor) &&
		n.backgroundColor === normalizeHexColor(L.backgroundColor, n.backgroundColor) &&
		n.foregroundColor === normalizeHexColor(L.foregroundColor, n.foregroundColor) &&
		n.contrast === L.contrast &&
		n.translucentSidebar === L.translucentSidebar
	);
}

/**
 * 离开某一亮暗模式时，若当前配色属于该模式下的「自动/内置」（含旧 index 紫系与 Codex），
 * 切换有效亮暗后应换成新模式内置色，避免仍用上一模式的种子。
 */
export function shouldMigrateChromeWhenLeavingScheme(appearance: AppAppearanceSettings, fromScheme: 'light' | 'dark'): boolean {
	if (appearanceMatchesBuiltinChromeSeed(appearance, fromScheme)) {
		return true;
	}
	// Cursor 主题也需要迁移
	if (appearanceMatchesThemePreset(appearance, 'cursor', fromScheme)) {
		return true;
	}
	if (fromScheme === 'dark') {
		return appearanceUsesUnambiguousDarkAutoChrome(appearance) || matchesLegacyIndexBuiltin(appearance, 'dark');
	}
	return matchesLegacyIndexBuiltin(appearance, 'light');
}

export function replaceBuiltinChromeColorsForScheme(
	current: AppAppearanceSettings,
	scheme: 'light' | 'dark'
): AppAppearanceSettings {
	const b = defaultAppearanceSettingsForScheme(scheme);
	return {
		...current,
		accentColor: b.accentColor,
		backgroundColor: b.backgroundColor,
		foregroundColor: b.foregroundColor,
		themePresetId: b.themePresetId,
		contrast: b.contrast,
		translucentSidebar: b.translucentSidebar,
	};
}

/** 设置页局部预览：内置 → mac-codex 主题表等价变量；否则按三色推导。 */
export function resolveAppearanceChromeColorVars(
	appearance: AppAppearanceSettings,
	scheme: 'light' | 'dark'
): Record<string, string> {
	if (appearanceMatchesBuiltinChromeSeed(appearance, scheme)) {
		return scheme === 'light' ? macCodexBuiltinPreviewVarsLight() : macCodexBuiltinPreviewVarsDark();
	}
	return appearanceSettingsColorVars(normalizeAppearanceSettings(appearance, scheme));
}

export function applyAppearanceSettingsToDom(settings: AppAppearanceSettings, colorScheme: 'light' | 'dark'): void {
	if (typeof document === 'undefined') {
		return;
	}

	const root = document.documentElement;
	if (appearanceMatchesBuiltinChromeSeed(settings, colorScheme)) {
		for (const key of APPEARANCE_CHROME_CSS_VAR_KEYS) {
			root.style.removeProperty(key);
		}
	} else {
		const vars = appearanceSettingsColorVars(normalizeAppearanceSettings(settings, colorScheme));
		for (const [key, val] of Object.entries(vars)) {
			root.style.setProperty(key, val);
		}
	}

	root.style.setProperty('--void-ui-font-family', resolveUiFontFamily(settings.uiFontPreset));
	root.style.setProperty('--void-code-font-family', resolveCodeFontFamily(settings.codeFontPreset));
	root.style.setProperty('--void-ui-font-size-px', `${settings.uiFontSize}px`);
	root.style.setProperty('--void-code-font-size-px', `${settings.codeFontSize}px`);
	root.setAttribute('data-ui-font', settings.uiFontPreset);
	root.setAttribute('data-code-font', settings.codeFontPreset);
	root.setAttribute('data-pointer-cursors', settings.usePointerCursors ? 'true' : 'false');
	root.setAttribute('data-translucent-sidebar', settings.translucentSidebar ? 'true' : 'false');
}
