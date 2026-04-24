import { describe, expect, it } from 'vitest';
import {
	appearanceSettingsColorVars,
	applyAppearanceSettingsToDom,
	applyThemePresetToAppearance,
	defaultAppearanceSettingsForScheme,
	nativeWindowChromeFromAppearance,
} from './appearanceSettings';

function withFakeDocument(test: (style: Map<string, string>) => void): void {
	const previousDocument = globalThis.document;
	const style = new Map<string, string>();
	const fakeStyle = {
		setProperty: (key: string, value: string) => style.set(key, value),
		removeProperty: (key: string) => style.delete(key),
	};
	const attributes = new Map<string, string>();
	globalThis.document = {
		documentElement: {
			style: fakeStyle,
			setAttribute: (key: string, value: string) => attributes.set(key, value),
		},
	} as unknown as Document;
	try {
		test(style);
	} finally {
		globalThis.document = previousDocument;
	}
}

describe('appearanceSettingsColorVars', () => {
	it('keeps the Cursor dark appearance editor surfaces on the dark chat background', () => {
		const cursorDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'cursor', 'dark');
		const vars = appearanceSettingsColorVars(cursorDark);

		expect(vars['--void-appearance-theme-editor-head-bg']).toBe('#111111');
		expect(vars['--void-appearance-settings-seg-bg']).toBe('#111111');
	});

	it('resets the Cursor light appearance editor surfaces back to white after a scheme switch', () => {
		const cursorLight = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('light'), 'cursor', 'light');
		const vars = appearanceSettingsColorVars(cursorLight);

		expect(vars['--void-appearance-theme-editor-head-bg']).toBe('#FFFFFF');
		expect(vars['--void-appearance-settings-seg-bg']).toBe('#FFFFFF');
	});

	it('uses the settings surface for the native title bar when settings are open', () => {
		const cursorDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'cursor', 'dark');
		const cursorLight = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('light'), 'cursor', 'light');

		expect(nativeWindowChromeFromAppearance(cursorDark, 'dark', { settingsPageOpen: true }).titleBarColor).toBe('#111111');
		expect(nativeWindowChromeFromAppearance(cursorLight, 'light', { settingsPageOpen: true }).titleBarColor).toBe('#FFFFFF');
	});

	it('uses the Async settings root color for the native title bar when settings are open', () => {
		const asyncDark = defaultAppearanceSettingsForScheme('dark');
		const asyncLight = defaultAppearanceSettingsForScheme('light');

		expect(nativeWindowChromeFromAppearance(asyncDark, 'dark', { settingsPageOpen: true }).titleBarColor).toBe('#151C22');
		expect(nativeWindowChromeFromAppearance(asyncLight, 'light', { settingsPageOpen: true }).titleBarColor).toBe('#F5F7FA');
	});

	it('falls back to bg-1 for other presets when settings are open', () => {
		const graphiteDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'graphite', 'dark');
		const graphiteLight = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('light'), 'graphite', 'light');
		const forestDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'forest', 'dark');
		const forestLight = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('light'), 'forest', 'light');
		const sunsetDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'sunset', 'dark');
		const sunsetLight = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('light'), 'sunset', 'light');

		expect(nativeWindowChromeFromAppearance(graphiteDark, 'dark', { settingsPageOpen: true }).titleBarColor).toBe('#2A2F39');
		expect(nativeWindowChromeFromAppearance(graphiteLight, 'light', { settingsPageOpen: true }).titleBarColor).toBe('#E8EEF8');
		expect(nativeWindowChromeFromAppearance(forestDark, 'dark', { settingsPageOpen: true }).titleBarColor).toBe('#233029');
		expect(nativeWindowChromeFromAppearance(forestLight, 'light', { settingsPageOpen: true }).titleBarColor).toBe('#E6F4EA');
		expect(nativeWindowChromeFromAppearance(sunsetDark, 'dark', { settingsPageOpen: true }).titleBarColor).toBe('#342B25');
		expect(nativeWindowChromeFromAppearance(sunsetLight, 'light', { settingsPageOpen: true }).titleBarColor).toBe('#FEEDE2');
	});

	it('clears Cursor-only inline variables when switching to another preset', () => {
		withFakeDocument((style) => {
			const cursorDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'cursor', 'dark');
			const graphiteDark = applyThemePresetToAppearance(defaultAppearanceSettingsForScheme('dark'), 'graphite', 'dark');

			applyAppearanceSettingsToDom(cursorDark, 'dark');
			expect(style.get('--void-agent-shell-bg')).toBe('#111111');

			applyAppearanceSettingsToDom(graphiteDark, 'dark');
			expect(style.has('--void-agent-shell-bg')).toBe(false);
			expect(style.get('--void-bg-0')).toBe('#161A20');
		});
	});
});
