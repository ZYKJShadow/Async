import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { bindWorkspaceRootToWebContents } from '../../workspace.js';
import {
	ensureWorkspaceFileIndex,
	searchWorkspaceFiles,
	acquireWorkspaceFileIndexRef,
	releaseWorkspaceFileIndexRef,
} from '../../workspaceFileIndex.js';
import {
	getRecentWorkspaces,
	rememberWorkspace,
	removeRecentWorkspace,
} from '../../settingsStore.js';
import {
	listThreadWorkspaceRoots,
} from '../../threadStore.js';
import {
	searchWorkspaceSymbols,
	ensureSymbolIndexLoaded,
} from '../../workspaceSymbolIndex.js';
import { clearGitContextCacheForRoot } from '../../gitContext.js';
import { disposeTsLspSessionForWebContents } from '../../lspSessionsByWebContents.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

const execFileAsync = promisify(execFile);

type ExternalWorkspaceTool = 'vscode' | 'cursor' | 'antigravity' | 'explorer' | 'terminal';

function isExternalWorkspaceTool(value: unknown): value is ExternalWorkspaceTool {
	return (
		value === 'vscode' ||
		value === 'cursor' ||
		value === 'antigravity' ||
		value === 'explorer' ||
		value === 'terminal'
	);
}

async function commandOnPath(command: string): Promise<boolean> {
	try {
		if (process.platform === 'win32') {
			await execFileAsync('where.exe', [command], { windowsHide: true });
		} else {
			await execFileAsync('which', [command], { windowsHide: true });
		}
		return true;
	} catch {
		return false;
	}
}

function windowsEditorExecutableFallbacks(tool: Extract<ExternalWorkspaceTool, 'vscode' | 'cursor' | 'antigravity'>): string[] {
	if (process.platform !== 'win32') {
		return [];
	}
	const localAppData = process.env.LOCALAPPDATA;
	const programFiles = process.env.ProgramFiles;
	const programFilesX86 = process.env['ProgramFiles(x86)'];
	switch (tool) {
		case 'vscode':
			return [
				localAppData ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
				programFiles ? path.join(programFiles, 'Microsoft VS Code', 'Code.exe') : null,
				programFilesX86 ? path.join(programFilesX86, 'Microsoft VS Code', 'Code.exe') : null,
			].filter((candidate): candidate is string => Boolean(candidate));
		case 'cursor':
			return [
				localAppData ? path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe') : null,
				programFiles ? path.join(programFiles, 'Cursor', 'Cursor.exe') : null,
				programFilesX86 ? path.join(programFilesX86, 'Cursor', 'Cursor.exe') : null,
			].filter((candidate): candidate is string => Boolean(candidate));
		case 'antigravity':
			return [
				localAppData ? path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe') : null,
				programFiles ? path.join(programFiles, 'Antigravity', 'Antigravity.exe') : null,
				programFilesX86 ? path.join(programFilesX86, 'Antigravity', 'Antigravity.exe') : null,
			].filter((candidate): candidate is string => Boolean(candidate));
		default:
			return [];
	}
}

type LaunchCommand = {
	command: string;
	useShell: boolean;
};

async function resolveLaunchCommand(candidates: string[]): Promise<LaunchCommand | null> {
	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		if (path.isAbsolute(candidate)) {
			if (fs.existsSync(candidate)) {
				return { command: candidate, useShell: /\.(cmd|bat)$/i.test(candidate) };
			}
			continue;
		}
		if (await commandOnPath(candidate)) {
			return { command: candidate, useShell: process.platform === 'win32' };
		}
	}
	return null;
}

async function spawnDetachedLaunch(
	command: string,
	args: string[],
	opts?: { cwd?: string; useShell?: boolean; windowsHide?: boolean }
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: opts?.cwd,
			detached: true,
			stdio: 'ignore',
			shell: opts?.useShell ?? false,
			windowsHide: opts?.windowsHide ?? true,
		});
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

async function launchWorkspaceInExternalEditor(
	tool: Extract<ExternalWorkspaceTool, 'vscode' | 'cursor' | 'antigravity'>,
	workspaceRoot: string,
	targetPath?: string,
	revealLine?: number
): Promise<boolean> {
	const commandCandidates = {
		vscode: ['code'],
		cursor: ['cursor'],
		antigravity: ['antigravity'],
	}[tool];
	const resolved = await resolveLaunchCommand([
		...commandCandidates,
		...windowsEditorExecutableFallbacks(tool),
	]);
	if (!resolved) {
		return false;
	}
	const target = targetPath ?? workspaceRoot;
	const targetArg = targetPath && Number.isFinite(revealLine) && revealLine! > 0 ? `${targetPath}:${Math.floor(revealLine!)}` : target;
	await spawnDetachedLaunch(resolved.command, ['-n', targetArg], {
		cwd: workspaceRoot,
		useShell: resolved.useShell,
		windowsHide: true,
	});
	return true;
}

function escapePowerShellLiteral(value: string): string {
	return value.replace(/'/g, "''");
}

async function launchWorkspaceInExternalTerminal(workspaceRoot: string): Promise<boolean> {
	if (process.platform === 'win32') {
		const wt = await resolveLaunchCommand(['wt']);
		if (wt) {
			await spawnDetachedLaunch(wt.command, ['-d', workspaceRoot], {
				cwd: workspaceRoot,
				useShell: wt.useShell,
				windowsHide: true,
			});
			return true;
		}
		await spawnDetachedLaunch(
			'powershell.exe',
			['-NoExit', '-Command', `Set-Location -LiteralPath '${escapePowerShellLiteral(workspaceRoot)}'`],
			{
				cwd: workspaceRoot,
				useShell: false,
				windowsHide: false,
			}
		);
		return true;
	}
	if (process.platform === 'darwin') {
		await spawnDetachedLaunch('open', ['-a', 'Terminal', workspaceRoot], {
			cwd: workspaceRoot,
			useShell: false,
			windowsHide: true,
		});
		return true;
	}
	const candidates: Array<{ command: string; args: string[] }> = [
		{ command: 'x-terminal-emulator', args: ['--working-directory', workspaceRoot] },
		{ command: 'gnome-terminal', args: [`--working-directory=${workspaceRoot}`] },
		{ command: 'konsole', args: ['--workdir', workspaceRoot] },
		{ command: 'xfce4-terminal', args: ['--working-directory', workspaceRoot] },
	];
	for (const candidate of candidates) {
		const resolved = await resolveLaunchCommand([candidate.command]);
		if (!resolved) {
			continue;
		}
		await spawnDetachedLaunch(resolved.command, candidate.args, {
			cwd: workspaceRoot,
			useShell: resolved.useShell,
			windowsHide: true,
		});
		return true;
	}
	return false;
}

/**
 * 与原 register.ts 一致的"简单" workspace IPC：
 * pickFolder / openPath / openInExternalTool / listRecents / removeRecent /
 * get / searchSymbols / closeFolder / listFiles / searchFiles。
 *
 * 复杂的 composer / skill / memory 相关 workspace handler 仍留在 register.ts
 * 因为它们与 thread / extractMemories 等运行时有较深耦合。
 */
export function registerWorkspaceHandlers(): void {
	ipcMain.handle('workspace:pickFolder', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const r = await dialog.showOpenDialog(win!, {
			properties: ['openDirectory', 'createDirectory'],
		});
		if (r.canceled || !r.filePaths[0]) {
			return { ok: false as const };
		}
		const picked = r.filePaths[0];
		const resolvedPick = path.resolve(picked);
		const prev = bindWorkspaceRootToWebContents(event.sender, resolvedPick);
		if (prev && prev !== resolvedPick) {
			releaseWorkspaceFileIndexRef(prev);
		}
		if (prev !== resolvedPick) {
			acquireWorkspaceFileIndexRef(resolvedPick);
		}
		rememberWorkspace(resolvedPick);
		return { ok: true as const, path: resolvedPick };
	});

	ipcMain.handle('workspace:openPath', (event, dirPath: string) => {
		const t0 = performance.now();
		try {
			const resolved = path.resolve(String(dirPath ?? ''));
			if (!fs.existsSync(resolved)) {
				return { ok: false as const, error: '路径不存在' };
			}
			if (!fs.statSync(resolved).isDirectory()) {
				return { ok: false as const, error: '不是文件夹' };
			}
			const prev = bindWorkspaceRootToWebContents(event.sender, resolved);
			if (prev && prev !== resolved) {
				releaseWorkspaceFileIndexRef(prev);
			}
			if (prev !== resolved) {
				acquireWorkspaceFileIndexRef(resolved);
			}
			rememberWorkspace(resolved);
			console.log(`[perf][main] workspace:openPath done in ${(performance.now() - t0).toFixed(1)}ms`);
			return { ok: true as const, path: resolved };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('workspace:openInExternalTool', async (event, payload: unknown) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, code: 'no-workspace' as const };
		}
		const input = payload as
			| { tool?: unknown; relPath?: unknown; revealLine?: unknown; revealEndLine?: unknown }
			| null
			| undefined;
		const tool = input?.tool;
		if (!isExternalWorkspaceTool(tool)) {
			return { ok: false as const, code: 'unsupported-tool' as const, error: 'unsupported tool' };
		}
		const relPath = typeof input?.relPath === 'string' ? input.relPath.trim() : '';
		let targetPath: string | undefined;
		if (relPath) {
			const normalizedRel = relPath.replace(/\\/g, '/');
			const resolvedTarget = path.resolve(root, normalizedRel);
			const relativeToRoot = path.relative(root, resolvedTarget);
			if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
				return { ok: false as const, code: 'outside-workspace' as const, error: 'path is outside workspace' };
			}
			targetPath = resolvedTarget;
		}
		const revealLine = typeof input?.revealLine === 'number' ? input.revealLine : undefined;
		try {
			if (tool === 'explorer') {
				const err = await shell.openPath(targetPath ?? root);
				return err
					? ({ ok: false as const, code: 'launch-failed' as const, error: err } as const)
					: ({ ok: true as const } as const);
			}
			if (tool === 'terminal') {
				const ok = await launchWorkspaceInExternalTerminal(root);
				return ok
					? ({ ok: true as const } as const)
					: ({ ok: false as const, code: 'tool-unavailable' as const } as const);
			}
			const ok = await launchWorkspaceInExternalEditor(tool, root, targetPath, revealLine);
			return ok
				? ({ ok: true as const } as const)
				: ({ ok: false as const, code: 'tool-unavailable' as const } as const);
		} catch (e) {
			return {
				ok: false as const,
				code: 'launch-failed' as const,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	});

	ipcMain.handle('workspace:listRecents', () => {
		const t0 = performance.now();
		const seen = new Set<string>();
		const candidates = [
			...getRecentWorkspaces(),
			...listThreadWorkspaceRoots({ onlyWithUserMessages: true }),
		];
		const paths = candidates.filter((p) => {
			const key = path.resolve(p).replace(/\\/g, '/').toLowerCase();
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			try {
				return fs.existsSync(p) && fs.statSync(p).isDirectory();
			} catch {
				return false;
			}
		});
		console.log(`[perf][main] workspace:listRecents done in ${(performance.now() - t0).toFixed(1)}ms, count=${paths.length}`);
		return { paths };
	});

	ipcMain.handle('workspace:removeRecent', (_e, dirPath: string) => {
		try {
			const resolved = path.resolve(String(dirPath ?? ''));
			removeRecentWorkspace(resolved);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('workspace:get', (event) => ({ root: senderWorkspaceRoot(event) }));

	ipcMain.handle('workspace:searchSymbols', async (event, query: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: true as const, hits: [] as { name: string; path: string; line: number; kind: string }[] };
		}
		const rootNorm = path.resolve(root);
		await ensureSymbolIndexLoaded(rootNorm);
		const hits = searchWorkspaceSymbols(String(query ?? ''), 80, rootNorm);
		return { ok: true as const, hits };
	});

	ipcMain.handle('workspace:closeFolder', async (event) => {
		const root = senderWorkspaceRoot(event);
		bindWorkspaceRootToWebContents(event.sender, null);
		if (root) {
			releaseWorkspaceFileIndexRef(root);
			clearGitContextCacheForRoot(root);
		}
		await disposeTsLspSessionForWebContents(event.sender);
		return { ok: true as const };
	});

	ipcMain.handle('workspace:listFiles', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		try {
			const paths = await ensureWorkspaceFileIndex(root);
			return { ok: true as const, paths };
		} catch {
			return { ok: false as const, error: 'read-failed' as const };
		}
	});

	ipcMain.handle(
		'workspace:searchFiles',
		async (event, opts: { query?: string; gitChangedPaths?: string[]; limit?: number } | undefined) => {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, items: [] };
			}
			try {
				const items = await searchWorkspaceFiles(
					root,
					opts?.query ?? '',
					opts?.gitChangedPaths ?? [],
					opts?.limit ?? 60
				);
				return { ok: true as const, items };
			} catch {
				return { ok: false as const, items: [] };
			}
		}
	);
}
