import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setWorkspaceRoot, getWorkspaceRoot, resolveWorkspacePath, isPathInsideRoot } from '../workspace.js';
import { listWorkspaceRelativeFiles } from '../workspaceFileIndex.js';
import { getSettings, patchSettings, getRecentWorkspaces, rememberWorkspace } from '../settingsStore.js';
import {
	appendMessage,
	createThread,
	deleteThread,
	ensureDefaultThread,
	getCurrentThreadId,
	getThread,
	listThreads,
	replaceFromUserVisibleIndex,
	selectThread,
	setThreadTitle,
	updateLastAssistant,
	appendToLastAssistant,
	type ChatMessage,
} from '../threadStore.js';
import * as gitService from '../gitService.js';
import { parseComposerMode } from '../llm/composerMode.js';
import { resolveChatModel, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import { buildWorkspaceTreeSummary } from '../llm/workspaceContextExpand.js';
import {
	listAgentDiffChunks,
	applyAgentDiffChunk,
	applyAgentPatchItems,
	formatAgentApplyFooter,
	formatAgentApplyIncremental,
} from '../agent/applyAgentDiffs.js';
import { runAgentLoop } from '../agent/agentLoop.js';
import { prepareUserTurnForChat } from '../llm/agentMessagePrep.js';
import { summarizeThreadForSidebar, isTimestampToday } from '../threadListSummary.js';

const execFileAsync = promisify(execFile);

const abortByThread = new Map<string, AbortController>();
const agentRevertSnapshotsByThread = new Map<string, Map<string, string | null>>();

function runChatStream(
	win: BrowserWindow,
	threadId: string,
	messages: ChatMessage[],
	mode: ReturnType<typeof parseComposerMode>,
	modelSelection: string,
	agentSystemAppend?: string
): void {
	const send = (obj: unknown) => win.webContents.send('async-shell:chat', obj);
	const prev = abortByThread.get(threadId);
	prev?.abort();
	agentRevertSnapshotsByThread.set(threadId, new Map());
	const ac = new AbortController();
	abortByThread.set(threadId, ac);

	void (async () => {
		try {
			const settings = getSettings();
			const thinkingLevel = resolveThinkingLevelForSelection(settings, modelSelection);
			const resolved = resolveChatModel(settings, modelSelection);
			if (!resolved) {
				send({
					threadId,
					type: 'error',
					message:
						'无法解析当前模型：请在 Models 中至少添加并启用一条模型，填写「请求名称」并选择请求范式；若选 Auto，请确保已启用列表中有可用项。',
				});
				return;
			}

			if (mode === 'agent' && resolved.paradigm !== 'gemini') {
				await runAgentLoop(
					settings,
					messages,
					{
						requestModelId: resolved.requestModelId,
						paradigm: resolved.paradigm,
						signal: ac.signal,
						thinkingLevel,
						toolHooks: {
							beforeWrite: ({ path, previousContent }) => {
								const snapshots = agentRevertSnapshotsByThread.get(threadId);
								if (!snapshots || snapshots.has(path)) {
									return;
								}
								snapshots.set(path, previousContent);
							},
						},
						...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
					},
					{
						onTextDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
						onToolInputDelta: (p) =>
							send({ threadId, type: 'tool_input_delta', name: p.name, partialJson: p.partialJson, index: p.index }),
						onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
						onToolCall: (name, args) => send({ threadId, type: 'tool_call', name, args: JSON.stringify(args) }),
						onToolResult: (name, result, success) => send({ threadId, type: 'tool_result', name, result, success }),
						onDone: (full) => {
							updateLastAssistant(threadId, full);
							send({ threadId, type: 'done', text: full });
						},
						onError: (message) => send({ threadId, type: 'error', message }),
					}
				);
				return;
			}

			await streamChatUnified(
				settings,
				messages,
				{
					mode,
					signal: ac.signal,
					requestModelId: resolved.requestModelId,
					paradigm: resolved.paradigm,
					thinkingLevel,
					...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
				},
				{
					onDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
					onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
					onDone: (full) => {
						updateLastAssistant(threadId, full);
						if (mode === 'agent') {
							const listed = listAgentDiffChunks(full);
							if (listed.length > 0) {
								send({
									threadId,
									type: 'done',
									text: full,
									pendingAgentPatches: listed.map((p, i) => ({
										id: `p-${i}`,
										relPath: p.relPath,
										chunk: p.chunk,
									})),
								});
								return;
							}
						}
						send({ threadId, type: 'done', text: full });
					},
					onError: (message) => send({ threadId, type: 'error', message }),
				}
			);
		} catch (e) {
			try {
				send({ threadId, type: 'error', message: e instanceof Error ? e.message : String(e) });
			} catch { /* window may be destroyed */ }
		} finally {
			abortByThread.delete(threadId);
		}
	})();
}

export function registerIpc(): void {
	ipcMain.handle('async-shell:ping', () => ({ ok: true, message: 'pong' }));

	ipcMain.handle('app:getPaths', () => ({
		userData: app.getPath('userData'),
		home: app.getPath('home'),
	}));

	ipcMain.handle('workspace:pickFolder', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const r = await dialog.showOpenDialog(win!, {
			properties: ['openDirectory', 'createDirectory'],
		});
		if (r.canceled || !r.filePaths[0]) {
			return { ok: false as const };
		}
		const picked = r.filePaths[0];
		setWorkspaceRoot(picked);
		rememberWorkspace(picked);
		return { ok: true as const, path: picked };
	});

	ipcMain.handle('workspace:openPath', (_e, dirPath: string) => {
		try {
			const resolved = path.resolve(String(dirPath ?? ''));
			if (!fs.existsSync(resolved)) {
				return { ok: false as const, error: '路径不存在' };
			}
			if (!fs.statSync(resolved).isDirectory()) {
				return { ok: false as const, error: '不是文件夹' };
			}
			setWorkspaceRoot(resolved);
			rememberWorkspace(resolved);
			return { ok: true as const, path: resolved };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('workspace:listRecents', () => ({
		paths: getRecentWorkspaces().filter((p) => {
			try {
				return fs.existsSync(p) && fs.statSync(p).isDirectory();
			} catch {
				return false;
			}
		}),
	}));

	ipcMain.handle('workspace:get', () => ({ root: getWorkspaceRoot() }));

	ipcMain.handle('workspace:listFiles', () => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		try {
			const paths = listWorkspaceRelativeFiles(root);
			return { ok: true as const, paths };
		} catch {
			return { ok: false as const, error: 'read-failed' as const };
		}
	});

	ipcMain.handle('settings:get', () => getSettings());

	ipcMain.handle('settings:set', (_e, partial: Record<string, unknown>) => {
		return patchSettings(partial as Parameters<typeof patchSettings>[0]);
	});

	ipcMain.handle('threads:list', () => {
		ensureDefaultThread();
		const now = Date.now();
		return {
			threads: listThreads().map((t) => {
				const sum = summarizeThreadForSidebar(t);
				return {
					id: t.id,
					title: t.title,
					updatedAt: t.updatedAt,
					createdAt: t.createdAt,
					previewCount: t.messages.filter((m) => m.role !== 'system').length,
					isToday: isTimestampToday(t.updatedAt, now),
					...sum,
				};
			}),
			currentId: getCurrentThreadId(),
		};
	});

	ipcMain.handle('threads:messages', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return {
			ok: true as const,
			messages: t.messages.filter((m) => m.role !== 'system'),
		};
	});

	ipcMain.handle('threads:create', () => {
		const t = createThread();
		return { id: t.id };
	});

	ipcMain.handle('threads:select', (_e, id: string) => {
		const t = selectThread(id);
		return { ok: !!t };
	});

	ipcMain.handle('threads:delete', (_e, id: string) => {
		deleteThread(id);
		ensureDefaultThread();
		return { ok: true as const, currentId: getCurrentThreadId() };
	});

	ipcMain.handle('threads:rename', (_e, id: string, title: string) => {
		const ok = setThreadTitle(String(id ?? ''), String(title ?? ''));
		return { ok };
	});

	ipcMain.handle('agent:applyDiffChunk', (_e, payload: { threadId?: string; chunk?: string }) => {
		const threadId = String(payload?.threadId ?? '');
		const chunk = typeof payload?.chunk === 'string' ? payload.chunk : '';
		if (!threadId || !chunk) {
			return { applied: [] as string[], failed: [{ path: '(invalid)', reason: '参数无效' }] };
		}
		const ar = applyAgentDiffChunk(chunk);
		const inc = formatAgentApplyIncremental(ar);
		if (inc) {
			appendToLastAssistant(threadId, inc);
		}
		return ar;
	});

	ipcMain.handle(
		'agent:applyDiffChunks',
		(_e, payload: { threadId?: string; items?: { id?: string; chunk?: string }[] }) => {
			const threadId = String(payload?.threadId ?? '');
			const raw = Array.isArray(payload?.items) ? payload!.items : [];
			const items = raw
				.map((x) => ({
					id: typeof x?.id === 'string' ? x.id : '',
					chunk: typeof x?.chunk === 'string' ? x.chunk : '',
				}))
				.filter((x) => x.id && x.chunk);
			if (!threadId || items.length === 0) {
				return {
					applied: [] as string[],
					failed: [{ path: '(invalid)', reason: '参数无效' }],
					succeededIds: [] as string[],
				};
			}
			const ar = applyAgentPatchItems(items);
			const { succeededIds, ...rest } = ar;
			const foot = formatAgentApplyFooter(rest);
			if (foot) {
				appendToLastAssistant(threadId, foot);
			}
			return ar;
		}
	);

	ipcMain.handle(
		'chat:send',
		(event, payload: { threadId: string; text: string; mode?: string; modelId?: string }) => {
			const { threadId, text } = payload;
			const mode = parseComposerMode(payload.mode);
			const modelSelection = typeof payload.modelId === 'string' ? payload.modelId : 'auto';
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) {
				return { ok: false as const };
			}

			const settings = getSettings();
			const root = getWorkspaceRoot();
			let workspaceFiles: string[] = [];
			if (root) {
				try {
					workspaceFiles = listWorkspaceRelativeFiles(root);
				} catch {
					workspaceFiles = [];
				}
			}
			const { userText, agentSystemAppend } = prepareUserTurnForChat(text, settings.agent, root, workspaceFiles);

			let finalSystemAppend = agentSystemAppend;
			if (mode === 'plan' && workspaceFiles.length > 0) {
				const tree = buildWorkspaceTreeSummary(workspaceFiles);
				if (tree) {
					finalSystemAppend = finalSystemAppend
						? `${finalSystemAppend}\n\n---\n${tree}`
						: tree;
				}
			}

			const t = appendMessage(threadId, { role: 'user', content: userText });
			runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend);

			return { ok: true as const };
		}
	);

	ipcMain.handle(
		'chat:editResend',
		(
			event,
			payload: { threadId: string; visibleIndex: number; text: string; mode?: string; modelId?: string }
		) => {
			const { threadId, visibleIndex, text } = payload;
			const mode = parseComposerMode(payload.mode);
			const modelSelection = typeof payload.modelId === 'string' ? payload.modelId : 'auto';
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			const trimmed = typeof text === 'string' ? text.trim() : '';
			if (!trimmed) {
				return { ok: false as const, error: 'empty-text' as const };
			}
			if (!Number.isInteger(visibleIndex) || visibleIndex < 0) {
				return { ok: false as const, error: 'bad-index' as const };
			}
			try {
				const settings = getSettings();
				const root = getWorkspaceRoot();
				let workspaceFiles: string[] = [];
				if (root) {
					try {
						workspaceFiles = listWorkspaceRelativeFiles(root);
					} catch {
						workspaceFiles = [];
					}
				}
				const { userText, agentSystemAppend } = prepareUserTurnForChat(trimmed, settings.agent, root, workspaceFiles);

				let finalSystemAppend = agentSystemAppend;
				if (mode === 'plan' && workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = finalSystemAppend
							? `${finalSystemAppend}\n\n---\n${tree}`
							: tree;
					}
				}

				const t = replaceFromUserVisibleIndex(threadId, visibleIndex, userText);
				runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend);
				return { ok: true as const };
			} catch {
				return { ok: false as const, error: 'replace-failed' as const };
			}
		}
	);

	ipcMain.handle('chat:abort', (_e, threadId: string) => {
		abortByThread.get(threadId)?.abort();
		abortByThread.delete(threadId);
		return { ok: true };
	});

	ipcMain.handle('fs:readFile', (_e, relPath: string) => {
		const full = resolveWorkspacePath(relPath);
		return { ok: true as const, content: fs.readFileSync(full, 'utf8') };
	});

	ipcMain.handle('fs:writeFile', (_e, relPath: string, content: string) => {
		const full = resolveWorkspacePath(relPath);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, 'utf8');
		return { ok: true as const };
	});

	ipcMain.handle('agent:keepLastTurn', (_e, threadId: string) => {
		agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const };
	});

	ipcMain.handle('agent:revertLastTurn', (_e, threadId: string) => {
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots || snapshots.size === 0) {
			return { ok: true as const, reverted: 0 };
		}

		for (const [relPath, previousContent] of Array.from(snapshots.entries()).reverse()) {
			const full = resolveWorkspacePath(relPath);
			if (previousContent === null) {
				if (fs.existsSync(full)) {
					fs.unlinkSync(full);
				}
				continue;
			}
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, previousContent, 'utf8');
		}

		agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const, reverted: snapshots.size };
	});

	ipcMain.handle('agent:keepFile', (_e, threadId: string, relPath: string) => {
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots) return { ok: true as const };
		snapshots.delete(relPath);
		if (snapshots.size === 0) agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const };
	});

	ipcMain.handle('agent:revertFile', (_e, threadId: string, relPath: string) => {
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots || !snapshots.has(relPath)) {
			return { ok: true as const, reverted: false };
		}
		const previousContent = snapshots.get(relPath)!;
		const full = resolveWorkspacePath(relPath);
		if (previousContent === null) {
			if (fs.existsSync(full)) fs.unlinkSync(full);
		} else {
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, previousContent, 'utf8');
		}
		snapshots.delete(relPath);
		if (snapshots.size === 0) agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const, reverted: true };
	});

	ipcMain.handle('fs:listDir', (_e, relPath: string) => {
		try {
			const root = getWorkspaceRoot();
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const normalized = typeof relPath === 'string' ? relPath.trim() : '';
			const full = normalized ? resolveWorkspacePath(normalized) : root;
			if (!isPathInsideRoot(full, root) && full !== root) {
				return { ok: false as const, error: 'Bad path' };
			}
			const entries = fs.readdirSync(full, { withFileTypes: true });
			const list = entries
				.map((ent) => {
					const joined = normalized ? path.join(normalized, ent.name) : ent.name;
					const relSlash = joined.split(path.sep).join('/');
					return { name: ent.name, isDirectory: ent.isDirectory(), rel: relSlash };
				})
				.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
				});
			return { ok: true as const, entries: list };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:status', async () => {
		try {
			const root = getWorkspaceRoot();
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const [porcelain, branch] = await Promise.all([
				gitService.gitStatusPorcelain(),
				gitService.gitBranch(),
			]);
			const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
			const pathStatus = gitService.parseGitPathStatus(lines);
			const changedPaths = gitService.listPorcelainPaths(lines);
			return { ok: true as const, branch, lines, pathStatus, changedPaths };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:stageAll', async () => {
		try {
			await gitService.gitStageAll();
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:commit', async (_e, message: string) => {
		try {
			await gitService.gitCommit(message);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:push', async () => {
		try {
			await gitService.gitPush();
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:diffPreviews', async (_e, relPaths: string[]) => {
		try {
			const root = getWorkspaceRoot();
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const list = Array.isArray(relPaths) ? relPaths : [];
			const previews: Record<string, gitService.DiffPreview> = {};
			for (const p of list) {
				try {
					previews[p] = await gitService.getDiffPreview(p);
				} catch {
					previews[p] = { diff: '', isBinary: false, additions: 0, deletions: 0 };
				}
			}
			return { ok: true as const, previews };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle(
		'plan:save',
		(_e, payload: { filename: string; content: string }) => {
			try {
				const dir = path.join(app.getPath('userData'), '.async', 'plans');
				fs.mkdirSync(dir, { recursive: true });
				const safe = String(payload.filename ?? 'plan.md')
					.replace(/[<>:"/\\|?*]/g, '_')
					.slice(0, 120);
				const full = path.join(dir, safe);
				fs.writeFileSync(full, String(payload.content ?? ''), 'utf8');
				return { ok: true as const, path: full };
			} catch (e) {
				return { ok: false as const, error: String(e) };
			}
		}
	);

	ipcMain.handle('terminal:execLine', async (_e, line: string) => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		const trimmed = line.trim();
		if (!trimmed) {
			return { ok: true as const, stdout: '', stderr: '' };
		}
		try {
			const isWin = process.platform === 'win32';
			const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/bash';
			const args = isWin ? ['/d', '/s', '/c', trimmed] : ['-lc', trimmed];
			const { stdout, stderr } = await execFileAsync(shell, args, {
				cwd: root,
				windowsHide: true,
				maxBuffer: 5 * 1024 * 1024,
				timeout: 120_000,
			});
			return { ok: true as const, stdout: stdout || '', stderr: stderr || '' };
		} catch (e: unknown) {
			const err = e as { stdout?: string; stderr?: string; message?: string };
			return {
				ok: false as const,
				error: err.message ?? String(e),
				stdout: err.stdout ?? '',
				stderr: err.stderr ?? '',
			};
		}
	});
}
