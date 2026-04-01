import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { createAppWindow } from '../appWindow.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { windowsCmdUtf8Prefix } from '../winUtf8.js';
import { setWorkspaceRoot, getWorkspaceRoot, resolveWorkspacePath, isPathInsideRoot } from '../workspace.js';
import {
	ensureWorkspaceFileIndex,
	stopWorkspaceFileIndex,
	getWorkspaceFileIndexLiveStats,
	registerKnownWorkspaceRelPath,
} from '../workspaceFileIndex.js';
import {
	getSettings,
	patchSettings,
	getRecentWorkspaces,
	rememberWorkspace,
	getMcpServerConfigs,
	patchMcpServerConfigs,
	removeMcpServerConfig,
} from '../settingsStore.js';
import { getMcpManager, destroyMcpManager } from '../mcp/index.js';
import type { McpServerConfig, McpServerStatus } from '../mcp/mcpTypes.js';
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
	accumulateTokenUsage,
	touchFileInThread,
	saveSummary,
	savePlan,
	getExecutedPlanFileKeys,
	markPlanFileExecuted,
	type ChatMessage,
	type ThreadPlan,
} from '../threadStore.js';
import { compressForSend } from '../agent/conversationCompress.js';
import { flattenAssistantTextPartsForSearch } from '../../src/agentStructuredMessage.js';
import * as gitService from '../gitService.js';
import { parseComposerMode } from '../llm/composerMode.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import {
	buildWorkspaceTreeSummary,
	cloneMessagesWithExpandedLastUser,
	modeExpandsWorkspaceFileContext,
} from '../llm/workspaceContextExpand.js';
import {
	listAgentDiffChunks,
	applyAgentDiffChunk,
	applyAgentPatchItems,
	formatAgentApplyFooter,
	formatAgentApplyIncremental,
} from '../agent/applyAgentDiffs.js';
import { runAgentLoop } from '../agent/agentLoop.js';
import {
	createMistakeLimitReachedHandler,
	resolveMistakeLimitRecovery,
	type MistakeLimitDecision,
} from '../agent/mistakeLimitGate.js';
import { createToolApprovalBeforeExecute, resolveToolApproval } from '../agent/toolApprovalGate.js';
import { setPlanQuestionRuntime } from '../agent/planQuestionRuntime.js';
import {
	abortPlanQuestionWaitersForThread,
	resolvePlanQuestionTool,
} from '../agent/planQuestionTool.js';
import { loadClaudeWorkspaceSkills, prepareUserTurnForChat } from '../llm/agentMessagePrep.js';
import {
	buildSkillCreatorSystemAppend,
	formatSkillCreatorUserBubble,
	type SkillCreatorScope,
} from '../skillCreatorPrompt.js';
import {
	mergeAgentWithProjectSlice,
	readWorkspaceAgentProjectSlice,
	writeWorkspaceAgentProjectSlice,
	type WorkspaceAgentProjectSlice,
} from '../workspaceAgentStore.js';
import { summarizeThreadForSidebar, isTimestampToday } from '../threadListSummary.js';
import { registerTerminalPtyIpc } from '../terminalPty.js';
import { TsLspSession } from '../lsp/tsLspSession.js';
import { setToolLspSession, setDelegateContext, clearDelegateContext } from '../agent/toolExecutor.js';
import {
	searchWorkspaceSymbols,
	clearWorkspaceSymbolIndex,
	getWorkspaceSymbolIndexStats,
	scheduleWorkspaceSymbolFullRebuild,
} from '../workspaceSymbolIndex.js';
import {
	buildSemanticContextBlock,
	clearWorkspaceSemanticIndex,
	getWorkspaceSemanticIndexStats,
	scheduleWorkspaceSemanticRebuild,
} from '../workspaceSemanticIndex.js';
import { getGitContextBlock, clearGitContextCache } from '../gitContext.js';

const execFileAsync = promisify(execFile);

const tsLspSession = new TsLspSession();
setToolLspSession(tsLspSession);

/**
 * 融合当前用户输入与最近几轮历史 user 消息，构建更丰富的语义检索 query。
 * 多轮对话场景下，仅用当前 userText 检索可能遗漏与历史上下文相关的代码片段。
 */
function buildEnrichedQuery(userText: string, threadMessages: ChatMessage[]): string {
	const recentUserTexts = threadMessages
		.filter((m) => m.role === 'user')
		.slice(-3)
		.map((m) => m.content.slice(0, 200))
		.join(' ');
	return `${userText} ${recentUserTexts}`.slice(0, 1000);
}

const abortByThread = new Map<string, AbortController>();
const agentRevertSnapshotsByThread = new Map<string, Map<string, string | null>>();
/** 工具执行前用户确认：approvalId → resolve(allowed) */
const toolApprovalWaiters = new Map<string, (approved: boolean) => void>();
/** 连续失败后恢复：recoveryId → resolve(decision) */
const mistakeLimitWaiters = new Map<string, (d: MistakeLimitDecision) => void>();

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
			const resolved = resolveModelRequest(settings, modelSelection);
			if (!resolved.ok) {
				send({ threadId, type: 'error', message: resolved.message });
				return;
			}

			// 发送端压缩：超长线程仅压缩发给 LLM 的副本，磁盘保留完整历史
			const thread = getThread(threadId);
			const compressOptions = {
				mode: mode as import('../llm/composerMode.js').ComposerMode,
				signal: ac.signal,
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				maxOutputTokens: resolved.maxOutputTokens,
				thinkingLevel,
			};
			const compressResult = await compressForSend(
				messages,
				settings,
				compressOptions,
				thread?.summary,
				thread?.summaryCoversMessageCount
			);
			let sendMessages = compressResult.messages;
			if (compressResult.newSummary && compressResult.newSummaryCoversCount !== undefined) {
				saveSummary(threadId, compressResult.newSummary, compressResult.newSummaryCoversCount);
			}

			if ((mode === 'agent' || mode === 'plan') && resolved.paradigm !== 'gemini') {
				const beforeExecuteTool = createToolApprovalBeforeExecute(
					send,
					threadId,
					ac.signal,
					() => getSettings().agent,
					toolApprovalWaiters
				);
				const onMistakeLimitReached = createMistakeLimitReachedHandler(
					send,
					threadId,
					ac.signal,
					mistakeLimitWaiters
				);
				const ag = getSettings().agent;
			const agentOptions = {
					requestModelId: resolved.requestModelId,
					paradigm: resolved.paradigm,
					requestApiKey: resolved.apiKey,
					requestBaseURL: resolved.baseURL,
					maxOutputTokens: resolved.maxOutputTokens,
					signal: ac.signal,
					composerMode: mode,
					thinkingLevel,
					beforeExecuteTool,
					maxConsecutiveMistakes: ag?.maxConsecutiveMistakes,
					mistakeLimitEnabled: ag?.mistakeLimitEnabled,
					onMistakeLimitReached,
				};
			try {
				setDelegateContext(
					settings,
					agentOptions,
					ac.signal,
					(evt) => send({ threadId, ...evt }),
					threadId,
					(payload) =>
						send({
							threadId,
							type: 'sub_agent_background_done',
							parentToolCallId: payload.parentToolCallId,
							result: payload.result,
							success: payload.success,
						})
				);
				if (mode === 'plan') {
					setPlanQuestionRuntime({
						threadId,
						signal: ac.signal,
						emit: (evt) => send({ threadId, ...evt }),
					});
				}
				const messagesForAgent = modeExpandsWorkspaceFileContext(
					mode as import('../llm/composerMode.js').ComposerMode
				)
					? cloneMessagesWithExpandedLastUser(sendMessages)
					: sendMessages;
				await runAgentLoop(
					settings,
					messagesForAgent,
					{
						requestModelId: resolved.requestModelId,
						paradigm: resolved.paradigm,
						requestApiKey: resolved.apiKey,
						requestBaseURL: resolved.baseURL,
						maxOutputTokens: resolved.maxOutputTokens,
						signal: ac.signal,
						composerMode: mode,
						thinkingLevel,
						beforeExecuteTool,
						maxConsecutiveMistakes: ag?.maxConsecutiveMistakes,
						mistakeLimitEnabled: ag?.mistakeLimitEnabled,
						onMistakeLimitReached,
						toolHooks: {
							beforeWrite: ({ path, previousContent }) => {
								const snapshots = agentRevertSnapshotsByThread.get(threadId);
								if (!snapshots || snapshots.has(path)) {
									touchFileInThread(threadId, path, 'modified', false);
									return;
								}
								snapshots.set(path, previousContent);
								touchFileInThread(
									threadId,
									path,
									previousContent === null ? 'created' : 'modified',
									previousContent === null
								);
							},
						},
						...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
					},
					{
						onTextDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
						onToolInputDelta: (p) =>
							send({ threadId, type: 'tool_input_delta', name: p.name, partialJson: p.partialJson, index: p.index }),
						onToolProgress: (p) =>
							send({ threadId, type: 'tool_progress', name: p.name, phase: p.phase, detail: p.detail }),
						onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
						onToolCall: (name, args, toolCallId) =>
							send({ threadId, type: 'tool_call', name, args: JSON.stringify(args), toolCallId }),
						onToolResult: (name, result, success, toolCallId) =>
							send({ threadId, type: 'tool_result', name, result, success, toolCallId }),
						onDone: (full, usage) => {
							updateLastAssistant(threadId, full);
							accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
							send({ threadId, type: 'done', text: full, usage });
						},
						onError: (message) => send({ threadId, type: 'error', message }),
					}
				);
			} finally {
				clearDelegateContext();
				if (mode === 'plan') {
					setPlanQuestionRuntime(null);
				}
			}
			return;
		}

		await streamChatUnified(
			settings,
			sendMessages,
			{
				mode,
				signal: ac.signal,
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				maxOutputTokens: resolved.maxOutputTokens,
				thinkingLevel,
				...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
			},
			{
				onDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
				onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
				onDone: (full, usage) => {
					updateLastAssistant(threadId, full);
					accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
					if (mode === 'agent') {
						const listed = listAgentDiffChunks(flattenAssistantTextPartsForSearch(full));
						if (listed.length > 0) {
							send({
								threadId,
								type: 'done',
								text: full,
								usage,
								pendingAgentPatches: listed.map((p, i) => ({
									id: `p-${i}`,
									relPath: p.relPath,
									chunk: p.chunk,
								})),
							});
							return;
						}
					}
					send({ threadId, type: 'done', text: full, usage });
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

const MAX_PLAN_EXECUTE_INJECT_CHARS = 200_000;

function readPlanFileForExecute(absPath: string): string | null {
	let resolved: string;
	try {
		resolved = path.resolve(absPath);
	} catch {
		return null;
	}
	const userPlansDir = path.join(app.getPath('userData'), '.async', 'plans');
	const root = getWorkspaceRoot();
	const wsPlansDir = root ? path.join(root, '.async', 'plans') : null;
	const allowed =
		isPathInsideRoot(resolved, userPlansDir) ||
		(wsPlansDir != null && isPathInsideRoot(resolved, wsPlansDir));
	if (!allowed) {
		return null;
	}
	try {
		if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			return null;
		}
		let t = fs.readFileSync(resolved, 'utf8');
		if (t.length > MAX_PLAN_EXECUTE_INJECT_CHARS) {
			t = `${t.slice(0, MAX_PLAN_EXECUTE_INJECT_CHARS)}\n\n… (truncated)`;
		}
		return t;
	} catch {
		return null;
	}
}

function appendPlanExecuteToSystem(
	base: string | undefined,
	exec: { fromAbsPath?: string; inlineMarkdown?: string; planTitle?: string } | undefined
): string {
	if (!exec) {
		return base ?? '';
	}
	let body: string | null = null;
	if (exec.fromAbsPath) {
		body = readPlanFileForExecute(exec.fromAbsPath);
	}
	const inline = typeof exec.inlineMarkdown === 'string' ? exec.inlineMarkdown.trim() : '';
	if ((body == null || !body.trim()) && inline) {
		body =
			inline.length > MAX_PLAN_EXECUTE_INJECT_CHARS
				? `${inline.slice(0, MAX_PLAN_EXECUTE_INJECT_CHARS)}\n\n… (truncated)`
				: inline;
	}
	if (body == null || !body.trim()) {
		return base ?? '';
	}
	const title = String(exec.planTitle ?? 'Plan').trim() || 'Plan';
	const block = [
		'## Saved plan document (execute strictly; the visible user message is only a trigger)',
		`Plan title: ${title}`,
		'',
		body,
	].join('\n');
	const trimmedBase = base?.trim() ?? '';
	return trimmedBase ? `${trimmedBase}\n\n---\n${block}` : block;
}

export function registerIpc(): void {
	registerTerminalPtyIpc();

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
		void ensureWorkspaceFileIndex(picked).catch(() => {});
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
			void ensureWorkspaceFileIndex(resolved).catch(() => {});
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

	ipcMain.handle('workspace:searchSymbols', (_e, query: string) => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: true as const, hits: [] as { name: string; path: string; line: number; kind: string }[] };
		}
		const hits = searchWorkspaceSymbols(String(query ?? ''), 80);
		return { ok: true as const, hits };
	});

	ipcMain.handle('lsp:ts:start', async (_e, workspaceRoot: string) => {
		const dir = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
		if (!dir) {
			return { ok: false as const, error: 'empty-root' as const };
		}
		try {
			await tsLspSession.start(dir);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('lsp:ts:stop', async () => {
		await tsLspSession.dispose();
		return { ok: true as const };
	});

	ipcMain.handle('lsp:ts:definition', async (_e, payload: unknown) => {
		const p = payload as { uri?: string; line?: number; column?: number; text?: string };
		const uri = typeof p?.uri === 'string' ? p.uri : '';
		const text = typeof p?.text === 'string' ? p.text : '';
		const line = typeof p?.line === 'number' && Number.isFinite(p.line) ? p.line : 1;
		const column = typeof p?.column === 'number' && Number.isFinite(p.column) ? p.column : 1;
		if (!uri || !text) {
			return { ok: false as const, error: 'bad-args' as const };
		}
		try {
			const result = await tsLspSession.definition(uri, line, column, text);
			return { ok: true as const, result };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('lsp:ts:diagnostics', async (_e, payload: unknown) => {
		const p = payload as { relPath?: string };
		const relPath = typeof p?.relPath === 'string' ? p.relPath : '';
		if (!relPath) {
			return { ok: false as const, error: 'bad-args' as const };
		}
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const absPath = path.join(root, relPath);
		if (!fs.existsSync(absPath)) {
			return { ok: false as const, error: 'file-not-found' as const };
		}
		const text = fs.readFileSync(absPath, 'utf-8');
		const uri = pathToFileURL(absPath).href;
		try {
			const items = await tsLspSession.diagnostics(uri, text);
			if (items === null) {
				return { ok: false as const, error: 'not-supported' as const };
			}
			return { ok: true as const, diagnostics: items };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('workspace:closeFolder', async () => {
		stopWorkspaceFileIndex();
		await tsLspSession.dispose();
		setWorkspaceRoot(null);
		clearGitContextCache();
		return { ok: true as const };
	});

	ipcMain.handle('app:newWindow', () => {
		createAppWindow({ blank: true });
		return { ok: true as const };
	});

	ipcMain.handle('app:quit', () => {
		app.quit();
		return { ok: true as const };
	});

	ipcMain.handle('fs:pickOpenFile', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const r = await dialog.showOpenDialog(win ?? undefined, {
			properties: ['openFile'],
			defaultPath: root,
		});
		if (r.canceled || !r.filePaths[0]) {
			return { ok: false as const, canceled: true as const };
		}
		const picked = path.resolve(r.filePaths[0]);
		if (!isPathInsideRoot(picked, root)) {
			return { ok: false as const, error: 'outside-workspace' as const };
		}
		const rel = path.relative(root, picked).split(path.sep).join('/');
		return { ok: true as const, relPath: rel };
	});

	ipcMain.handle(
		'fs:pickSaveFile',
		async (event, opts?: { defaultName?: string; title?: string }) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			const root = getWorkspaceRoot();
			if (!root) {
				return { ok: false as const, error: 'no-workspace' as const };
			}
			const defaultName = typeof opts?.defaultName === 'string' ? opts.defaultName : 'Untitled.txt';
			const r = await dialog.showSaveDialog(win ?? undefined, {
				title: typeof opts?.title === 'string' ? opts.title : 'Save',
				defaultPath: path.join(root, path.basename(defaultName)),
			});
			if (r.canceled || !r.filePath) {
				return { ok: false as const, canceled: true as const };
			}
			const picked = path.resolve(r.filePath);
			if (!isPathInsideRoot(picked, root)) {
				return { ok: false as const, error: 'outside-workspace' as const };
			}
			const rel = path.relative(root, picked).split(path.sep).join('/');
			return { ok: true as const, relPath: rel };
		}
	);

	ipcMain.handle('workspace:listFiles', async () => {
		const root = getWorkspaceRoot();
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

	const COMPOSER_ATTACH_MAX_BYTES = 8 * 1024 * 1024;

	ipcMain.handle(
		'workspace:saveComposerAttachment',
		async (
			_e,
			payload: { base64?: string; fileName?: string }
		): Promise<
			| { ok: true; relPath: string }
			| { ok: false; error: 'no-workspace' | 'empty' | 'too-large' | 'write-failed' }
		> => {
			const root = getWorkspaceRoot();
			if (!root) {
				return { ok: false as const, error: 'no-workspace' as const };
			}
			const rawName =
				typeof payload?.fileName === 'string' && payload.fileName.trim()
					? path.basename(payload.fileName)
					: 'attachment';
			const safe =
				rawName.replace(/[^\w.\u4e00-\u9fff-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'file';
			let buf: Buffer;
			try {
				buf = Buffer.from(String(payload?.base64 ?? ''), 'base64');
			} catch {
				return { ok: false as const, error: 'empty' as const };
			}
			if (buf.length === 0) {
				return { ok: false as const, error: 'empty' as const };
			}
			if (buf.length > COMPOSER_ATTACH_MAX_BYTES) {
				return { ok: false as const, error: 'too-large' as const };
			}
			const dirRel = '.async/composer-drops';
			const dirAbs = path.join(root, dirRel);
			try {
				fs.mkdirSync(dirAbs, { recursive: true });
				const id = randomUUID();
				const relPath = `${dirRel}/${id}-${safe}`;
				fs.writeFileSync(path.join(root, relPath), buf);
				registerKnownWorkspaceRelPath(relPath);
				return { ok: true as const, relPath };
			} catch {
				return { ok: false as const, error: 'write-failed' as const };
			}
		}
	);

	ipcMain.handle('settings:get', () => getSettings());

	ipcMain.handle('settings:set', (_e, partial: Record<string, unknown>) => {
		const next = patchSettings(partial as Parameters<typeof patchSettings>[0]);
		const idx = next.indexing;
		if (idx?.symbolIndexEnabled === false) {
			clearWorkspaceSymbolIndex();
		}
		if (idx?.semanticIndexEnabled === false) {
			clearWorkspaceSemanticIndex();
		}
		if (idx?.tsLspEnabled === false) {
			void tsLspSession.dispose();
		}
		return next;
	});

	ipcMain.handle('workspaceAgent:get', () => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: true as const, slice: { rules: [], skills: [], subagents: [] } satisfies WorkspaceAgentProjectSlice };
		}
		return { ok: true as const, slice: readWorkspaceAgentProjectSlice(root) };
	});

	ipcMain.handle('workspaceAgent:set', (_e, slice: WorkspaceAgentProjectSlice) => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		writeWorkspaceAgentProjectSlice(root, slice);
		return { ok: true as const };
	});

	ipcMain.handle('workspace:listDiskSkills', () => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: true as const, skills: [] };
		}
		return { ok: true as const, skills: loadClaudeWorkspaceSkills(root) };
	});

	/** 删除工作区内技能目录（`.cursor|claude|async/skills/<slug>/` 整夹），参数为其中 `SKILL.md` 的相对路径 */
	ipcMain.handle('workspace:deleteSkillFromDisk', (_e, skillMdRel: string) => {
		if (!getWorkspaceRoot()) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const norm = String(skillMdRel ?? '').trim().replace(/\\/g, '/');
		if (!norm.endsWith('/SKILL.md')) {
			return { ok: false as const, error: 'not-skill-file' as const };
		}
		const dirRel = norm.slice(0, -'/SKILL.md'.length).replace(/\/$/, '');
		const parts = dirRel.split('/').filter(Boolean);
		const rootSeg = parts[0];
		if (
			parts.length !== 3 ||
			parts[1] !== 'skills' ||
			!rootSeg ||
			!['.cursor', '.claude', '.async'].includes(rootSeg) ||
			!parts[2] ||
			parts[2].includes('..')
		) {
			return { ok: false as const, error: 'invalid-path' as const };
		}
		try {
			const dirFull = resolveWorkspacePath(dirRel);
			if (fs.existsSync(dirFull)) {
				fs.rmSync(dirFull, { recursive: true, force: true });
			}
			return { ok: true as const };
		} catch {
			return { ok: false as const, error: 'io-failed' as const };
		}
	});

	ipcMain.handle('workspace:indexing:stats', () => {
		const w = getWorkspaceFileIndexLiveStats();
		const sym = getWorkspaceSymbolIndexStats();
		const sem = getWorkspaceSemanticIndexStats();
		return {
			ok: true as const,
			workspaceRoot: w.root,
			fileCount: w.fileCount,
			symbolUniqueNames: sym.uniqueNames,
			symbolIndexedFiles: sym.filesWithSymbols,
			semanticChunks: sem.chunks,
			semanticBusy: sem.busy,
		};
	});

	ipcMain.handle('workspace:indexing:rebuild', async (_e, payload: { target?: 'symbols' | 'semantic' | 'all' }) => {
		const root = getWorkspaceRoot();
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const files = await ensureWorkspaceFileIndex(root);
		const t = payload?.target ?? 'all';
		if (t === 'symbols' || t === 'all') {
			scheduleWorkspaceSymbolFullRebuild(root, files);
		}
		if (t === 'semantic' || t === 'all') {
			scheduleWorkspaceSemanticRebuild(root, files);
		}
		return { ok: true as const };
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
					tokenUsage: t.tokenUsage,
					fileStateCount: t.fileStates ? Object.keys(t.fileStates).length : 0,
					...sum,
				};
			}),
			currentId: getCurrentThreadId(),
		};
	});

	ipcMain.handle('threads:fileStates', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return { ok: true as const, fileStates: t.fileStates ?? {} };
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

	ipcMain.handle('threads:getExecutedPlanKeys', (_e, threadId: string) => {
		const id = String(threadId ?? '');
		if (!id) {
			return { ok: false as const };
		}
		return { ok: true as const, keys: getExecutedPlanFileKeys(id) };
	});

	ipcMain.handle(
		'threads:markPlanExecuted',
		(_e, payload: { threadId?: string; pathKey?: string }) => {
			const threadId = String(payload?.threadId ?? '');
			const pathKey = String(payload?.pathKey ?? '');
			if (!threadId || !pathKey) {
				return { ok: false as const };
			}
			markPlanFileExecuted(threadId, pathKey);
			return { ok: true as const };
		}
	);

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
		async (
			event,
			payload: {
				threadId: string;
				text: string;
				mode?: string;
				modelId?: string;
				skillCreator?: { userNote: string; scope: SkillCreatorScope };
				/** Plan Build：完整计划写入系统上下文，可见用户气泡仅短触发语 */
				planExecute?: { fromAbsPath?: string; inlineMarkdown?: string; planTitle?: string };
			}
		) => {
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
					workspaceFiles = await ensureWorkspaceFileIndex(root);
				} catch {
					workspaceFiles = [];
				}
			}
			const projectAgent = readWorkspaceAgentProjectSlice(root);
			const agentForTurn = mergeAgentWithProjectSlice(settings.agent, projectAgent);

			const skillIn = payload.skillCreator;
			if (skillIn && typeof skillIn.userNote === 'string') {
				const scope: SkillCreatorScope = skillIn.scope === 'project' ? 'project' : 'user';
				if (scope === 'project' && !root) {
					return { ok: false as const, error: 'no-workspace' as const };
				}
				const prepared = prepareUserTurnForChat(skillIn.userNote, agentForTurn, root, workspaceFiles);
				const lang = settings.language === 'en' ? 'en' : 'zh-CN';
				const visible = formatSkillCreatorUserBubble(scope, lang, skillIn.userNote);
				const skillBlock = buildSkillCreatorSystemAppend(scope, lang, root);
				let finalSystemAppend = prepared.agentSystemAppend
					? `${prepared.agentSystemAppend}\n\n---\n\n${skillBlock}`
					: skillBlock;
				if (root && (mode === 'plan' || mode === 'ask')) {
					const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
				}
				if ((mode === 'plan' || mode === 'ask') && workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = finalSystemAppend
							? `${finalSystemAppend}\n\n---\n${tree}`
							: tree;
					}
				}
				if (modeExpandsWorkspaceFileContext(mode) && prepared.userText.trim().length > 8) {
					const recentPaths = Object.keys(getThread(threadId)?.fileStates ?? {});
					const enrichedQuery = buildEnrichedQuery(
						prepared.userText,
						getThread(threadId)?.messages ?? []
					);
					const sem = buildSemanticContextBlock(
						enrichedQuery,
						6,
						recentPaths,
						prepared.atPaths.length > 0 ? prepared.atPaths : undefined
					);
					if (sem) {
						finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${sem}` : sem;
					}
				}
				if (modeExpandsWorkspaceFileContext(mode) && root && settings.indexing?.gitContextEnabled !== false) {
					const gitBlock = await getGitContextBlock(root);
					if (gitBlock) {
						finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${gitBlock}` : gitBlock;
					}
				}
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend);
				return { ok: true as const };
			}

			const { userText, agentSystemAppend, atPaths } = prepareUserTurnForChat(
				text,
				agentForTurn,
				root,
				workspaceFiles
			);

			let finalSystemAppend = agentSystemAppend;
			if (root && (mode === 'plan' || mode === 'ask')) {
				const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
				finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
			}
			if ((mode === 'plan' || mode === 'ask') && workspaceFiles.length > 0) {
				const tree = buildWorkspaceTreeSummary(workspaceFiles);
				if (tree) {
					finalSystemAppend = finalSystemAppend
						? `${finalSystemAppend}\n\n---\n${tree}`
						: tree;
				}
			}

			if (modeExpandsWorkspaceFileContext(mode) && userText.trim().length > 8) {
				const recentPaths = Object.keys(getThread(threadId)?.fileStates ?? {});
				const enrichedQuery = buildEnrichedQuery(userText, getThread(threadId)?.messages ?? []);
				const sem = buildSemanticContextBlock(enrichedQuery, 6, recentPaths, atPaths.length > 0 ? atPaths : undefined);
				if (sem) {
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${sem}` : sem;
				}
			}

			if (modeExpandsWorkspaceFileContext(mode) && root && settings.indexing?.gitContextEnabled !== false) {
				const gitBlock = await getGitContextBlock(root);
				if (gitBlock) {
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${gitBlock}` : gitBlock;
				}
			}

			finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute);

			const t = appendMessage(threadId, { role: 'user', content: userText });
			runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend);

			return { ok: true as const };
		}
	);

	ipcMain.handle(
		'chat:editResend',
		async (
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
						workspaceFiles = await ensureWorkspaceFileIndex(root);
					} catch {
						workspaceFiles = [];
					}
				}
				const projectAgent = readWorkspaceAgentProjectSlice(root);
				const agentForTurn = mergeAgentWithProjectSlice(settings.agent, projectAgent);
				const { userText, agentSystemAppend, atPaths } = prepareUserTurnForChat(trimmed, agentForTurn, root, workspaceFiles);

				let finalSystemAppend = agentSystemAppend;
				if (root && (mode === 'plan' || mode === 'ask')) {
					const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
				}
				if ((mode === 'plan' || mode === 'ask') && workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = finalSystemAppend
							? `${finalSystemAppend}\n\n---\n${tree}`
							: tree;
					}
				}

				if (modeExpandsWorkspaceFileContext(mode) && userText.trim().length > 8) {
					const recentPaths = Object.keys(getThread(threadId)?.fileStates ?? {});
					const enrichedQuery = buildEnrichedQuery(userText, getThread(threadId)?.messages ?? []);
					const sem = buildSemanticContextBlock(enrichedQuery, 6, recentPaths, atPaths.length > 0 ? atPaths : undefined);
					if (sem) {
						finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${sem}` : sem;
					}
				}

				if (modeExpandsWorkspaceFileContext(mode) && root && getSettings().indexing?.gitContextEnabled !== false) {
					const gitBlock = await getGitContextBlock(root);
					if (gitBlock) {
						finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${gitBlock}` : gitBlock;
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
		abortPlanQuestionWaitersForThread(threadId);
		abortByThread.get(threadId)?.abort();
		abortByThread.delete(threadId);
		const prefix = `ta-${threadId}-`;
		for (const [id, fn] of [...toolApprovalWaiters.entries()]) {
			if (id.startsWith(prefix)) {
				toolApprovalWaiters.delete(id);
				fn(false);
			}
		}
		const prefixMl = `ml-${threadId}-`;
		for (const [id, fn] of [...mistakeLimitWaiters.entries()]) {
			if (id.startsWith(prefixMl)) {
				mistakeLimitWaiters.delete(id);
				fn({ action: 'stop' });
			}
		}
		return { ok: true };
	});

	ipcMain.handle(
		'agent:toolApprovalRespond',
		(_e, payload: { approvalId: string; approved: boolean }) => {
			const id = String(payload?.approvalId ?? '');
			if (!id) return { ok: false as const, error: 'missing id' };
			resolveToolApproval(toolApprovalWaiters, id, Boolean(payload.approved));
			return { ok: true as const };
		}
	);

	ipcMain.handle(
		'plan:toolQuestionRespond',
		(
			_e,
			payload: { requestId?: string; skipped?: boolean; answerText?: string }
		) => {
			const requestId = String(payload?.requestId ?? '');
			if (!requestId) return { ok: false as const, error: 'missing requestId' as const };
			const ok = resolvePlanQuestionTool(requestId, {
				skipped: Boolean(payload?.skipped),
				answerText: typeof payload?.answerText === 'string' ? payload.answerText : undefined,
			});
			return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'unknown request' as const });
		}
	);

	ipcMain.handle(
		'agent:mistakeLimitRespond',
		(
			_e,
			payload: {
				recoveryId?: string;
				action?: string;
				hint?: string;
			}
		) => {
			const id = String(payload?.recoveryId ?? '');
			if (!id) return { ok: false as const, error: 'missing id' as const };
			const act = String(payload?.action ?? 'continue');
			let decision: MistakeLimitDecision;
			if (act === 'stop') {
				decision = { action: 'stop' };
			} else if (act === 'hint') {
				const h = String(payload?.hint ?? '').trim();
				decision = h ? { action: 'hint', userText: h } : { action: 'continue' };
			} else {
				decision = { action: 'continue' };
			}
			resolveMistakeLimitRecovery(mistakeLimitWaiters, id, decision);
			return { ok: true as const };
		}
	);

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
				const safe = String(payload.filename ?? 'plan.md')
					.replace(/[<>:"/\\|?*]/g, '_')
					.slice(0, 120);
				const content = String(payload.content ?? '');
				const wsRoot = getWorkspaceRoot();
				if (wsRoot) {
					const dir = path.join(wsRoot, '.async', 'plans');
					fs.mkdirSync(dir, { recursive: true });
					const full = path.join(dir, safe);
					fs.writeFileSync(full, content, 'utf8');
					const relPath = path.join('.async', 'plans', safe).replace(/\\/g, '/');
					return { ok: true as const, path: full, relPath };
				}
				const dir = path.join(app.getPath('userData'), '.async', 'plans');
				fs.mkdirSync(dir, { recursive: true });
				const full = path.join(dir, safe);
				fs.writeFileSync(full, content, 'utf8');
				return { ok: true as const, path: full };
			} catch (e) {
				return { ok: false as const, error: String(e) };
			}
		}
	);

	ipcMain.handle('plan:saveStructured', (_e, payload: { threadId: string; plan: import('../threadStore.js').ThreadPlan }) => {
		try {
			savePlan(payload.threadId, payload.plan);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('threads:getPlan', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return { ok: true as const, plan: t.plan ?? null };
	});

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
			const cmdLine = isWin ? windowsCmdUtf8Prefix(trimmed) : trimmed;
			const args = isWin ? ['/d', '/s', '/c', cmdLine] : ['-lc', cmdLine];
			const { stdout, stderr } = await execFileAsync(shell, args, {
				cwd: root,
				windowsHide: true,
				maxBuffer: 5 * 1024 * 1024,
				timeout: 120_000,
				encoding: 'utf8',
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

	// ─── MCP IPC handlers ─────────────────────────────────────────────────────

	/** 获取所有 MCP 服务器配置 */
	ipcMain.handle('mcp:getServers', () => {
		return { ok: true as const, servers: getMcpServerConfigs() };
	});

	/** 获取所有 MCP 服务器配置（别名） */
	ipcMain.handle('mcp:listServers', () => {
		return { ok: true as const, servers: getMcpServerConfigs() };
	});

	/** 获取所有 MCP 服务器状态 */
	ipcMain.handle('mcp:getStatuses', () => {
		const manager = getMcpManager();
		manager.loadConfigs(getMcpServerConfigs());
		return { ok: true as const, statuses: manager.getServerStatuses() };
	});

	/** 添加或更新 MCP 服务器配置 */
	ipcMain.handle('mcp:saveServer', (_e, config: McpServerConfig) => {
		try {
			patchMcpServerConfigs([config]);
			const manager = getMcpManager();
			manager.loadConfigs(getMcpServerConfigs());
			return { ok: true as const, server: config };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 删除 MCP 服务器配置 */
	ipcMain.handle('mcp:deleteServer', (_e, id: string) => {
		try {
			removeMcpServerConfig(id);
			const manager = getMcpManager();
			manager.removeServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 启动 MCP 服务器 */
	ipcMain.handle('mcp:startServer', async (_e, id: string) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getMcpServerConfigs());
			await manager.startServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 停止 MCP 服务器 */
	ipcMain.handle('mcp:stopServer', (_e, id: string) => {
		try {
			const manager = getMcpManager();
			manager.stopServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 重启 MCP 服务器 */
	ipcMain.handle('mcp:restartServer', async (_e, id: string) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getMcpServerConfigs());
			await manager.restartServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 启动所有已启用的 MCP 服务器 */
	ipcMain.handle('mcp:startAll', async () => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getMcpServerConfigs());
			await manager.startAll();
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 获取 MCP 工具列表（供 Agent 使用） */
	ipcMain.handle('mcp:getTools', () => {
		const manager = getMcpManager();
		manager.loadConfigs(getMcpServerConfigs());
		return { ok: true as const, tools: manager.getAgentTools() };
	});

	/** 调用 MCP 工具 */
	ipcMain.handle('mcp:callTool', async (_e, name: string, args: Record<string, unknown>) => {
		try {
			const manager = getMcpManager();
			const result = await manager.callTool(name, args);
			return { ok: true as const, result };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 销毁 MCP 管理器（应用退出时调用） */
	ipcMain.handle('mcp:destroy', () => {
		destroyMcpManager();
		return { ok: true as const };
	});
}
