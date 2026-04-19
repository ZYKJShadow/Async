import { describe, expect, it } from 'vitest';
import {
	INITIAL_WINDOW_THEME_STORAGE_KEY,
	readInitialWindowThemeSnapshot,
	persistInitialWindowThemeSnapshot,
	serializeInitialWindowThemePayload,
	INITIAL_WINDOW_THEME_QUERY_PARAM,
} from './initialWindowTheme';

describe('initialWindowTheme', () => {
	it('hydrates appearance settings from the serialized query payload', () => {
		const payload = serializeInitialWindowThemePayload({
			colorMode: 'light',
			scheme: 'light',
			ui: {
				accentColor: '#2255AA',
				backgroundColor: '#F6F7FB',
				foregroundColor: '#162033',
				uiFontPreset: 'segoe',
			},
		});
		const snapshot = readInitialWindowThemeSnapshot(
			`?${INITIAL_WINDOW_THEME_QUERY_PARAM}=${encodeURIComponent(payload)}`,
			{ prefersDark: true }
		);

		expect(snapshot).not.toBeNull();
		expect(snapshot?.colorMode).toBe('light');
		expect(snapshot?.effectiveScheme).toBe('light');
		expect(snapshot?.appearanceSettings.backgroundColor).toBe('#F6F7FB');
		expect(snapshot?.appearanceSettings.foregroundColor).toBe('#162033');
		expect(snapshot?.appearanceSettings.uiFontPreset).toBe('segoe');
	});

	it('falls back to prefersDark when the serialized payload omits scheme', () => {
		const payload = serializeInitialWindowThemePayload({
			colorMode: 'system',
			ui: {
				backgroundColor: '#131A23',
			},
		});
		const snapshot = readInitialWindowThemeSnapshot(
			`?${INITIAL_WINDOW_THEME_QUERY_PARAM}=${encodeURIComponent(payload)}`,
			{ prefersDark: true }
		);

		expect(snapshot).not.toBeNull();
		expect(snapshot?.effectiveScheme).toBe('dark');
		expect(snapshot?.appearanceSettings.backgroundColor).toBe('#131A23');
	});

	it('returns null for malformed payloads', () => {
		expect(
			readInitialWindowThemeSnapshot(`?${INITIAL_WINDOW_THEME_QUERY_PARAM}=%7Bnot-json%7D`, {
				prefersDark: false,
			})
		).toBeNull();
	});

	it('reads from storage when the query payload is absent', () => {
		const backing = new Map<string, string>();
		backing.set(
			INITIAL_WINDOW_THEME_STORAGE_KEY,
			serializeInitialWindowThemePayload({
				colorMode: 'dark',
				scheme: 'dark',
				ui: {
					backgroundColor: '#101820',
					foregroundColor: '#EEF3F8',
				},
			})
		);
		const storage = {
			getItem(key: string) {
				return backing.get(key) ?? null;
			},
			setItem(key: string, value: string) {
				backing.set(key, value);
			},
		};

		const snapshot = readInitialWindowThemeSnapshot('', {
			prefersDark: false,
			storage,
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot?.effectiveScheme).toBe('dark');
		expect(snapshot?.appearanceSettings.backgroundColor).toBe('#101820');
	});

	it('persists snapshots in the shared storage format', () => {
		const backing = new Map<string, string>();
		const storage = {
			getItem(key: string) {
				return backing.get(key) ?? null;
			},
			setItem(key: string, value: string) {
				backing.set(key, value);
			},
		};

		persistInitialWindowThemeSnapshot(
			{
				colorMode: 'light',
				effectiveScheme: 'light',
				appearanceSettings: {
					accentColor: '#3366AA',
					backgroundColor: '#F4F6FA',
					foregroundColor: '#182030',
					themePresetId: 'custom',
					uiFontPreset: 'inter',
					codeFontPreset: 'jetbrains',
					translucentSidebar: false,
					contrast: 42,
					usePointerCursors: true,
					uiFontSize: 14,
					codeFontSize: 13,
				},
			},
			storage
		);

		const roundTrip = readInitialWindowThemeSnapshot('', {
			prefersDark: true,
			storage,
		});
		expect(roundTrip).not.toBeNull();
		expect(roundTrip?.colorMode).toBe('light');
		expect(roundTrip?.appearanceSettings.codeFontPreset).toBe('jetbrains');
	});
});
