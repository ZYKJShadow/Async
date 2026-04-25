import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from '../i18n';

vi.mock('../bootSplash', () => ({
	hideBootSplash: vi.fn(),
}));

import { runDesktopShellInit } from './desktopShellInit';

describe('runDesktopShellInit', () => {
	const store: Record<string, string> = {};
	let previousWindow: unknown;
	let previousLocalStorage: unknown;
	let previousRequestIdleCallback: unknown;

	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		previousWindow = (globalThis as { window?: unknown }).window;
		previousLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
		previousRequestIdleCallback = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		const memory: Storage = {
			get length() {
				return Object.keys(store).length;
			},
			clear() {
				for (const key of Object.keys(store)) {
					delete store[key];
				}
			},
			getItem(key) {
				return Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null;
			},
			key(index) {
				return Object.keys(store)[index] ?? null;
			},
			removeItem(key) {
				delete store[key];
			},
			setItem(key, value) {
				store[key] = String(value);
			},
		};
		Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true });
		Object.defineProperty(globalThis, 'window', {
			value: {
				innerWidth: 1280,
				location: { search: '', hash: '' },
				matchMedia: () => ({ matches: true }),
				setTimeout,
				clearTimeout,
			},
			configurable: true,
		});
		Object.defineProperty(globalThis, 'requestIdleCallback', {
			value: (cb: IdleRequestCallback) => {
				cb({ didTimeout: true, timeRemaining: () => 0 } as IdleDeadline);
				return 1;
			},
			configurable: true,
		});
	});

	afterEach(() => {
		if (previousWindow === undefined) {
			delete (globalThis as { window?: unknown }).window;
		} else {
			Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true });
		}
		if (previousLocalStorage === undefined) {
			delete (globalThis as { localStorage?: unknown }).localStorage;
		} else {
			Object.defineProperty(globalThis, 'localStorage', { value: previousLocalStorage, configurable: true });
		}
		if (previousRequestIdleCallback === undefined) {
			delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
		} else {
			Object.defineProperty(globalThis, 'requestIdleCallback', {
				value: previousRequestIdleCallback,
				configurable: true,
			});
		}
		vi.restoreAllMocks();
	});

	it('still applies model settings when the initial thread refresh fails', async () => {
		const settings = {
			language: 'zh-CN',
			defaultModel: 'model-1',
			models: {
				providers: [{ id: 'provider-1', displayName: 'Provider', paradigm: 'openai-compatible' }],
				entries: [{ id: 'model-1', providerId: 'provider-1', displayName: 'Model 1', requestName: 'model-1' }],
				enabledIds: ['model-1'],
				thinkingByModelId: { 'model-1': 'medium' },
			},
			ui: { sidebarLayout: { left: 280, right: 360 }, colorMode: 'dark' },
		};
		const shell = {
			invoke: vi.fn(async (channel: string) => {
				if (channel === 'async-shell:ping') return { ok: true, message: 'pong' };
				if (channel === 'workspace:get') return { root: 'D:/work/app' };
				if (channel === 'app:getPaths') return { home: 'D:/Users/me' };
				if (channel === 'settings:get') return settings;
				if (channel === 'mcp:getServers') return { servers: [] };
				if (channel === 'mcp:getStatuses') return { statuses: [] };
				if (channel === 'settings:set') return settings;
				return {};
			}),
		} as unknown as NonNullable<Window['asyncShell']>;
		const applyLoadedSettings = vi.fn();
		const refreshThreads = vi.fn(async () => {
			throw new Error('thread list unavailable');
		});

		await runDesktopShellInit({
			shell,
			t: ((key: string, vars?: Record<string, unknown>) => String(vars?.message ?? key)) as TFunction,
			layoutPinnedBySurface: false,
			shellLayoutStorageKey: 'test-layout-mode',
			sidebarLayoutStorageKey: 'test-sidebar-layout',
			refreshThreads,
			refreshGit: vi.fn(),
			setLocale: vi.fn(),
			setIpcOk: vi.fn(),
			setWorkspace: vi.fn(),
			setHomePath: vi.fn(),
			setRailWidths: vi.fn(),
			setLayoutMode: vi.fn(),
			applyLoadedSettings,
			setColorMode: vi.fn(),
			setAppearanceSettings: vi.fn(),
			setMcpServers: vi.fn(),
			setMcpStatuses: vi.fn(),
		});

		expect(refreshThreads).toHaveBeenCalledTimes(1);
		expect(applyLoadedSettings).toHaveBeenCalledWith(settings);
	});
});
