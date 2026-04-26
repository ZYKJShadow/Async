import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

const HANDLER_SMOKE_TIMEOUT_MS = 1_000;

// This smoke test cares about immediate ReferenceErrors, not completion of
// long-running IPC side effects such as login flows or network operations.
async function invokeHandlerWithTimeout(
	channel: string,
	fn: (...args: unknown[]) => unknown,
	args: unknown[],
	timeoutMs = HANDLER_SMOKE_TIMEOUT_MS
): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			reject(new Error(`Handler '${channel}' did not settle within ${timeoutMs}ms`));
		}, timeoutMs);
	});
	try {
		await Promise.race([Promise.resolve(fn(...args)), timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

function createSmokeWorkspace(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'async-shell-ipc-smoke-'));
}

function removeSmokeWorkspace(workspaceRoot: string): void {
	try {
		fs.rmSync(workspaceRoot, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 50,
		});
	} catch {
		// Best effort only; Windows can briefly hold handles after mocked IPC flows.
	}
}

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

vi.mock('../appWindow.js', () => {
	const fakeWindow = {
		webContents: { id: 999, once: () => {} },
		once: () => {},
		isDestroyed: () => false,
		close: () => {},
	};
	return {
		createAppWindow: vi.fn(() => fakeWindow),
		findAppWindowBySurface: vi.fn(() => null),
		focusAppWindow: vi.fn(),
	};
});

vi.mock('../autoUpdate.js', () => ({
	checkForUpdates: vi.fn(async () => ({ state: 'idle' })),
	downloadUpdate: vi.fn(async () => {}),
	getStatus: vi.fn(() => ({ state: 'idle' })),
	quitAndInstall: vi.fn(),
	openUpdateFolder: vi.fn(),
}));

vi.mock('../gitService.js', () => ({
	withGitWorkspaceRootAsync: vi.fn(async (_root: string, fn: () => Promise<unknown>) => await fn()),
	gitProbeContext: vi.fn(async () => ({ ok: true, topLevel: process.cwd() })),
	gitStatusPorcelain: vi.fn(async () => ''),
	gitBranch: vi.fn(async () => 'main'),
	parseGitPathStatus: vi.fn(() => ({})),
	listPorcelainPaths: vi.fn(() => []),
	workspaceRelativeFromRepoRelative: vi.fn((repoRel: string) => repoRel),
	gitDiffHeadUnified: vi.fn(async () => ''),
	buildDiffPreviewsMap: vi.fn(async () => ({})),
	gitStageAll: vi.fn(async () => {}),
	gitCommit: vi.fn(async () => {}),
	gitPush: vi.fn(async () => {}),
	getDiffPreview: vi.fn(async () => null),
	gitListLocalBranches: vi.fn(async () => ({ branches: ['main'], current: 'main' })),
	gitSwitchBranch: vi.fn(async () => {}),
	gitCreateBranchAndSwitch: vi.fn(async () => {}),
	normalizeGitFailureMessage: vi.fn((error: unknown, fallback = 'Git command failed') =>
		error instanceof Error ? error.message : fallback
	),
}));

vi.mock('../llm/providerOAuthLogin.js', () => ({
	cancelActiveProviderOAuthLogin: vi.fn(() => true),
	discoverProviderOAuthModels: vi.fn(async () => []),
	ensureFreshOAuthAuthForRequest: vi.fn(async (_providerId: string, auth: unknown) => auth),
	fetchProviderOAuthUsageSummary: vi.fn(async () => undefined),
	providerOAuthLabel: vi.fn((provider: string) => provider),
	runProviderOAuthLogin: vi.fn(async () => {
		throw new Error('OAuth login is disabled in IPC smoke tests.');
	}),
}));

vi.mock('../workspaceFileIndex.js', () => ({
	ensureWorkspaceFileIndex: vi.fn(async () => []),
	searchWorkspaceFiles: vi.fn(async () => []),
	acquireWorkspaceFileIndexRef: vi.fn(),
	releaseWorkspaceFileIndexRef: vi.fn(),
	registerKnownWorkspaceRelPath: vi.fn(),
	setWorkspaceFileIndexReadyBroadcaster: vi.fn(),
	setWorkspaceFsTouchNotifier: vi.fn(),
}));

vi.mock('../workspaceSymbolIndex.js', () => ({
	ensureSymbolIndexLoaded: vi.fn(async () => {}),
	searchWorkspaceSymbols: vi.fn(() => []),
}));

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
		const workspaceRoot = createSmokeWorkspace();

		// Per-channel payload nudges: these are channels whose interesting code
		// path only runs when given non-empty input (e.g. threads:listAgentSidebar
		// has to be given an array of paths to even try `workspaceRootsEqual`).
		// Add new entries here whenever a handler grows a branch that early-out
		// on default empty args.
		const channelPayloads: Record<string, unknown[]> = {
			'threads:listAgentSidebar': [[workspaceRoot]],
			'workspace:openPath': [workspaceRoot],
		};

		try {
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
					bindWorkspaceRootToWebContents(sender as never, workspaceRoot);
					const extraArgs = channelPayloads[channel] ?? ['', '', '', ''];
					try {
						await invokeHandlerWithTimeout(channel, fn, [fakeEvent, ...extraArgs]);
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
		} finally {
			removeSmokeWorkspace(workspaceRoot);
		}
	}, 15_000);
});
