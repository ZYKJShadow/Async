import {
	normalizeAppearanceSettings,
	type AppAppearanceSettings,
} from './appearanceSettings';
import {
	normalizeColorMode,
	readPrefersDark,
	resolveEffectiveScheme,
	type AppColorMode,
	type EffectiveColorScheme,
} from './colorMode';

export const INITIAL_WINDOW_THEME_QUERY_PARAM = 'initialWindowTheme';
export const INITIAL_WINDOW_THEME_STORAGE_KEY = 'async:initial-window-theme-v1';

type InitialWindowThemePayload = {
	colorMode?: unknown;
	scheme?: unknown;
	ui?: Partial<Record<string, unknown>> | null;
};

export type InitialWindowThemeSnapshot = {
	colorMode: AppColorMode;
	effectiveScheme: EffectiveColorScheme;
	appearanceSettings: AppAppearanceSettings;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function serializeInitialWindowThemePayload(payload: InitialWindowThemePayload): string {
	return JSON.stringify({
		colorMode: payload.colorMode,
		scheme: payload.scheme,
		ui: payload.ui ?? null,
	});
}

function parseInitialWindowThemePayload(raw: string | null): InitialWindowThemePayload | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as InitialWindowThemePayload;
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

function readInitialWindowThemePayloadFromStorage(storage: StorageLike | undefined): InitialWindowThemePayload | null {
	if (!storage) {
		return null;
	}
	try {
		return parseInitialWindowThemePayload(storage.getItem(INITIAL_WINDOW_THEME_STORAGE_KEY));
	} catch {
		return null;
	}
}

export function readInitialWindowThemeSnapshot(
	search: string,
	options?: { prefersDark?: boolean; storage?: StorageLike }
): InitialWindowThemeSnapshot | null {
	try {
		const params = new URLSearchParams(search);
		const payload =
			parseInitialWindowThemePayload(params.get(INITIAL_WINDOW_THEME_QUERY_PARAM)) ??
			readInitialWindowThemePayloadFromStorage(
				options?.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
			);
		if (!payload) {
			return null;
		}
		const colorMode = normalizeColorMode(payload.colorMode);
		const prefersDark = options?.prefersDark ?? readPrefersDark();
		const effectiveScheme =
			payload.scheme === 'light' || payload.scheme === 'dark'
				? payload.scheme
				: resolveEffectiveScheme(colorMode, prefersDark);
		return {
			colorMode,
			effectiveScheme,
			appearanceSettings: normalizeAppearanceSettings(payload.ui, effectiveScheme),
		};
	} catch {
		return null;
	}
}

export function persistInitialWindowThemeSnapshot(
	snapshot: InitialWindowThemeSnapshot,
	storage: StorageLike | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
): void {
	if (!storage) {
		return;
	}
	try {
		storage.setItem(
			INITIAL_WINDOW_THEME_STORAGE_KEY,
			serializeInitialWindowThemePayload({
				colorMode: snapshot.colorMode,
				scheme: snapshot.effectiveScheme,
				ui: snapshot.appearanceSettings,
			})
		);
	} catch {
		/* ignore */
	}
}
