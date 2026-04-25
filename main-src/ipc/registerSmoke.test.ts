import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IPC handler smoke tests.
 *
 * Why this file exists: register.ts and the handler files in ./handlers/ wire
 * up ~130 ipcMain.handle('...', fn) calls. Several of those handlers reference
 * cross-cutting helpers (`senderWorkspaceRoot`, `workspaceRootsEqual`,
 * `runChatStream`, `abortByThread`, …) that live in agentRuntime.ts /
 * chatRuntime.ts. When we extract one of those helpers to a sibling module
 * but forget to add the import back to register.ts, esbuild does not catch
 * it (free identifiers in JS are only resolved at runtime) and tsc does not
 * catch it either (main-src is currently outside `tsconfig.json` `include`).
 * The bug only surfaces the first time the actual IPC channel fires —
 * exactly how a `ReferenceError: workspaceRootsEqual is not defined`
 * shipped in `ref/app`.
 *
 * This test loads every IPC handler module and invokes its `register*`
 * function with a stubbed `electron` module. ipcMain.handle is captured
 * into an array; we assert no throw, and that each module registers at
 * least one handler. We then invoke every captured handler with a stub
 * event so any free identifier inside the body surfaces as ReferenceError
 * at test time rather than at first IPC call in production.
 */

type CapturedHandler = { channel: string; fn: (...args: unknown[]) => unknown };
let capturedHandlers: CapturedHandler[] = [];

vi.mock('electron', () => {
	const ipcMain = {
		handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
			capturedHandlers.push({ channel, fn });
		},
		on: () => {},
		removeAllListeners: () => {},
	};
	const noop = () => {};
	const app = {
		getPath: () => '/tmp/async-shell-smoke',
		getVersion: () => '0.0.0-test',
		setBadgeCount: noop,
		quit: noop,
	};
	const BrowserWindow = Object.assign(
		function BrowserWindow() {
			throw new Error('BrowserWindow constructor should not run during smoke test');
		},
		{
			getAllWindows: () => [],
			fromWebContents: () => null,
		}
	);
	const dialog = {
		showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
		showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
	};
	const shell = {
		openPath: async () => '',
		openExternal: async () => {},
		showItemInFolder: noop,
	};
	const clipboard = { writeText: noop, readText: () => '' };
	const webContents = { fromId: () => null };
	const nativeImage = {
		createFromDataURL: () => ({}),
		createEmpty: () => ({}),
	};
	const nativeTheme = { shouldUseDarkColors: false, on: noop };
	return {
		ipcMain,
		app,
		BrowserWindow,
		dialog,
		shell,
		clipboard,
		webContents,
		nativeImage,
		nativeTheme,
		default: {
			ipcMain,
			app,
			BrowserWindow,
			dialog,
			shell,
			clipboard,
			webContents,
			nativeImage,
			nativeTheme,
		},
	};
});

beforeEach(() => {
	capturedHandlers = [];
});

const handlerCases: Array<{ name: string; load: () => Promise<{ register: () => void }> }> = [
	{
		name: 'appHandlers',
		load: async () => ({ register: (await import('./handlers/appHandlers.js')).registerAppHandlers }),
	},
	{
		name: 'workspaceHandlers',
		load: async () => ({ register: (await import('./handlers/workspaceHandlers.js')).registerWorkspaceHandlers }),
	},
	{
		name: 'fsHandlers',
		load: async () => ({ register: (await import('./handlers/fsHandlers.js')).registerFsHandlers }),
	},
	{
		name: 'shellHandlers',
		load: async () => ({ register: (await import('./handlers/shellHandlers.js')).registerShellHandlers }),
	},
	{
		name: 'gitHandlers',
		load: async () => ({ register: (await import('./handlers/gitHandlers.js')).registerGitHandlers }),
	},
	{
		name: 'browserHandlers',
		load: async () => ({ register: (await import('./handlers/browserHandlers.js')).registerBrowserHandlers }),
	},
	{
		name: 'mcpHandlers',
		load: async () => ({ register: (await import('./handlers/mcpHandlers.js')).registerMcpHandlers }),
	},
	{
		name: 'pluginsHandlers',
		load: async () => ({ register: (await import('./handlers/pluginsHandlers.js')).registerPluginsHandlers }),
	},
	{
		name: 'settingsHandlers',
		load: async () => ({ register: (await import('./handlers/settingsHandlers.js')).registerSettingsHandlers }),
	},
	{
		name: 'terminalExecHandlers',
		load: async () => ({ register: (await import('./handlers/terminalExecHandlers.js')).registerTerminalExecHandlers }),
	},
	{
		name: 'clipboardHandlers',
		load: async () => ({ register: (await import('./handlers/clipboardHandlers.js')).registerClipboardHandlers }),
	},
	{
		name: 'lspHandlers',
		load: async () => ({ register: (await import('./handlers/lspHandlers.js')).registerLspHandlers }),
	},
	{
		name: 'usageStatsHandlers',
		load: async () => ({ register: (await import('./handlers/usageStatsHandlers.js')).registerUsageStatsHandlers }),
	},
	{
		name: 'autoUpdateHandlers',
		load: async () => ({ register: (await import('./handlers/autoUpdateHandlers.js')).registerAutoUpdateHandlers }),
	},
	{
		// register.ts is the central dispatcher; its IPC handlers reference
		// helpers from agentRuntime.ts and chatRuntime.ts that have repeatedly
		// been the source of "forgot to add the import back" bugs. The whole
		// reason this smoke test exists is the workspaceRootsEqual ReferenceError
		// that shipped from a register.ts handler.
		name: 'register (full registerIpc)',
		load: async () => ({ register: (await import('./register.js')).registerIpc }),
	},
];

describe('IPC register smoke', () => {
	for (const { name, load } of handlerCases) {
		it(`${name} registers handlers without ReferenceError`, async () => {
			const { register } = await load();
			expect(() => register()).not.toThrow();
			expect(capturedHandlers.length).toBeGreaterThan(0);
			for (const { channel, fn } of capturedHandlers) {
				expect(typeof channel).toBe('string');
				expect(typeof fn).toBe('function');
			}
		});
	}

	/**
	 * Invoke every captured handler with a stub event + sentinel args. Any
	 * `ReferenceError: X is not defined` inside a handler body — the exact
	 * shape of the bug this file exists to catch — surfaces here even though
	 * the handler's downstream effects are mocked.
	 *
	 * We do NOT validate handler return values; downstream services are
	 * mocked aggressively, and most handlers will return `{ ok: false, ... }`.
	 * The only assertion that matters is "did the function body evaluate
	 * without throwing a ReferenceError".
	 *
	 * Some handlers short-circuit when there is no workspace bound to the
	 * sender. To make sure we still execute the *interesting* branch (the
	 * one that historically referenced `workspaceRootsEqual`), we bind the
	 * fake sender to a real directory (process.cwd()) and pass payloads that
	 * push the handler past the early `if (!root) return ...` guard.
	 */
	it('every handler body evaluates without ReferenceError', async () => {
		const { bindWorkspaceRootToWebContents } = await import('../workspace.js');
		const cwd = process.cwd();

		// Per-channel payload nudges: these are channels whose interesting code
		// path only runs when given non-empty input (e.g. threads:listAgentSidebar
		// has to be given an array of paths to even try `workspaceRootsEqual`).
		// Add new entries here whenever a handler grows a branch that early-out
		// on default empty args.
		const channelPayloads: Record<string, unknown[]> = {
			'threads:listAgentSidebar': [[cwd]],
		};

		for (const { load } of handlerCases) {
			const { register } = await load();
			capturedHandlers = [];
			register();
			const sender = {
				id: 1,
				send: () => {},
				isDestroyed: () => false,
			};
			const fakeEvent = { sender };
			for (const { channel, fn } of capturedHandlers) {
				// Re-bind workspace root before every call: some handlers
				// (e.g. workspace:closeFolder) intentionally clear the binding.
				bindWorkspaceRootToWebContents(sender as never, cwd);
				const extraArgs = channelPayloads[channel] ?? ['', '', '', ''];
				try {
					await Promise.resolve(fn(fakeEvent, ...extraArgs));
				} catch (err) {
					if (err instanceof ReferenceError) {
						throw new Error(
							`Handler '${channel}' threw ReferenceError: ${err.message}`
						);
					}
					/* other errors are expected — downstream services are mocked */
				}
			}
			bindWorkspaceRootToWebContents(sender as never, null);
		}
	});
});
