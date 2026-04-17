import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, webContents, type WebContents } from 'electron';
import { createAppWindow } from '../appWindow.js';
import { applyThemeChromeToWindow, type NativeChromeOverride, type ThemeChromeScheme } from '../themeChrome.js';
import { applyPatch, formatPatch, parsePatch, reversePatch } from 'diff';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { windowsCmdUtf8Prefix } from '../winUtf8.js';
import {
	bindWorkspaceRootToWebContents,
	getWorkspaceRootForWebContents,
	resolveWorkspacePath,
	isPathInsideRoot,
} from '../workspace.js';
import {
	ensureWorkspaceFileIndex,
	searchWorkspaceFiles,
	setWorkspaceFileIndexReadyBroadcaster,
	acquireWorkspaceFileIndexRef,
	releaseWorkspaceFileIndexRef,
	registerKnownWorkspaceRelPath,
	setWorkspaceFsTouchNotifier,
} from '../workspaceFileIndex.js';

setWorkspaceFileIndexReadyBroadcaster((rootNorm) => {
	for (const w of BrowserWindow.getAllWindows()) {
		if (w.isDestroyed()) {
			continue;
		}
		try {
			w.webContents.send('async-shell:workspaceFileIndexReady', rootNorm);
		} catch {
			/* ignore */
		}
	}
});
import {
	getSettings,
	patchSettings,
	resolveUsageStatsDataDir,
	getRecentWorkspaces,
	rememberWorkspace,
	removeRecentWorkspace,
	getMcpServerConfigs,
	patchMcpServerConfigs,
	removeMcpServerConfig,
} from '../settingsStore.js';
import {
	addMarketplaceFromInput,
	getPluginPanelState,
	installMarketplacePlugin,
	removeMarketplaceByName,
	refreshMarketplaceByName,
	setConfiguredUserPluginsRoot,
	setInstalledPluginEnabled,
	uninstallInstalledPlugin,
} from '../plugins/pluginMarketplaceService.js';
import {
	getEffectiveMcpServerConfigs,
	getPluginRuntimeState,
	mergeAgentWithPluginRuntime,
} from '../plugins/pluginRuntimeService.js';
import { checkForUpdates, downloadUpdate, quitAndInstall, getStatus, type AutoUpdateStatus } from '../autoUpdate.js';
import { getMcpManager, destroyMcpManager } from '../mcp';
import type { McpServerConfig } from '../mcp';
import { syncBotControllerFromSettings } from '../bots/botController.js';
import { testBotIntegrationConnection } from '../bots/botConnectivity.js';
import type { BotIntegrationConfig } from '../botSettingsTypes.js';
import {
	appendMessage,
	createThread,
	deleteThread,
	ensureDefaultThread,
	getCurrentThreadId,
	getThread,
	listThreads,
	threadHasUserMessages,
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
	incrementThreadAgentToolCallCount,
	getDeferredToolState,
	saveDeferredToolState,
	getToolResultReplacementState,
	saveToolResultReplacementState,
	saveTeamSession,
	getAgentSession,
	type ChatMessage,
} from '../threadStore.js';
import { compressForSend } from '../agent/conversationCompress.js';
import { flattenAssistantTextPartsForSearch } from '../../src/agentStructuredMessage.js';
import * as gitService from '../gitService.js';
import { parseComposerMode, type ComposerMode } from '../llm/composerMode.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { preconnectLlmBaseUrlIfEligible } from '../llm/apiPreconnect.js';
import { scheduleRefreshOpenAiModelCapabilitiesIfStale } from '../llm/modelContext.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import { formatLlmSdkError } from '../llm/formatLlmSdkError.js';
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
import { countLineChangesBetweenTexts, countDiffLinesInChunk } from '../diffLineCount.js';
import { recordAgentLineDelta, recordTokenUsageEvent, getUsageStatsForDataDir } from '../workspaceUsageStats.js';
import { runAgentLoop } from '../agent/agentLoop.js';
import { runTeamSession } from '../agent/teamOrchestrator.js';
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
import {
	abortRequestUserInputWaitersForThread,
	createRequestUserInputToolHandler,
	resolveRequestUserInput,
} from '../agent/requestUserInputTool.js';
import { setPlanDraftRuntime } from '../agent/planDraftTool.js';
import {
	abortTeamPlanApprovalForThread,
	resolveTeamPlanApproval,
} from '../agent/teamPlanApprovalTool.js';
import { loadClaudeWorkspaceSkills, prepareUserTurnForChat } from '../llm/agentMessagePrep.js';
import {
	buildSkillCreatorSystemAppend,
	formatSkillCreatorUserBubble,
	type SkillCreatorScope,
} from '../skillCreatorPrompt.js';
import {
	buildRuleCreatorSystemAppend,
	formatRuleCreatorUserBubble,
	appendRuleCreatorPathLock,
} from '../ruleCreatorPrompt.js';
import {
	buildSubagentCreatorSystemAppend,
	formatSubagentCreatorUserBubble,
	type SubagentCreatorScope,
} from '../subagentCreatorPrompt.js';
import type { AgentRuleScope } from '../agentSettingsTypes.js';
import {
	mergeAgentWithProjectSlice,
	readWorkspaceAgentProjectSlice,
	writeWorkspaceAgentProjectSlice,
	type WorkspaceAgentProjectSlice,
} from '../workspaceAgentStore.js';
import { summarizeThreadForSidebar, isTimestampToday, pruneSummaryCache } from '../threadListSummary.js';
import { registerTerminalPtyIpc } from '../terminalPty.js';
import { registerTerminalSessionIpc } from '../terminalSessionIpc.js';

import {
	getWorkspaceLspManagerForWebContents,
	disposeTsLspSessionForWebContents,
} from '../lspSessionsByWebContents.js';
import { setDelegateContext, clearDelegateContext } from '../agent/toolExecutor.js';
import {
	attachManagedAgentEmitter,
	closeManagedAgent,
	getManagedAgentSession,
	getManagedAgentTranscriptPath,
	resumeManagedAgent,
	sendInputToManagedAgent,
	waitForManagedAgents,
} from '../agent/managedSubagents.js';
import {
	searchWorkspaceSymbols,
	ensureSymbolIndexLoaded,
} from '../workspaceSymbolIndex.js';
import { getGitContextBlock, clearGitContextCacheForRoot } from '../gitContext.js';
import { buildRelevantMemoryContextBlock } from '../memdir/findRelevantMemories.js';
import { ensureMemoryDirExists, loadMemoryPrompt } from '../memdir/memdir.js';
import { scanMemoryFiles } from '../memdir/memoryScan.js';
import { getAutoMemEntrypoint } from '../memdir/paths.js';
import { buildMemoryEntrypoint, queueExtractMemories } from '../services/extractMemories/extractMemories.js';
import {
	browserPartitionForHostId,
	getBrowserSidebarConfigPayloadForHostId,
	setBrowserSidebarConfigForHostId,
	sendApplyConfigToDetachedBrowserWindowIfOpen,
	updateBrowserRuntimeStateForHostId,
	getBrowserRuntimeStateForHostId,
	resolveBrowserCommandResultForHostId,
	resolveBrowserHostIdForSenderId,
	markBrowserWindowReadyForSenderId,
	openBrowserWindowForHostId,
} from '../browser/browserController.js';
import { syncBrowserCaptureBindingsForHostId } from '../browser/browserCapture.js';

const execFileAsync = promisify(execFile);

function senderWorkspaceRoot(event: { sender: WebContents }): string | null {
	return getWorkspaceRootForWebContents(event.sender);
}

function broadcastPluginsChanged(): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) {
			continue;
		}
		try {
			win.webContents.send('async-shell:pluginsChanged');
		} catch {
			/* ignore */
		}
	}
}

function workspaceRootsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) {
		return false;
	}
	const na = path.resolve(a).replace(/\\/g, '/').toLowerCase();
	const nb = path.resolve(b).replace(/\\/g, '/').toLowerCase();
	return na === nb;
}

/** 可选覆盖工作区根路径（须为已存在目录），否则使用当前窗口绑定的工作区 */
function resolveWorkspaceScopeForThreads(
	event: { sender: WebContents },
	workspaceRootOverride?: unknown
): string | null {
	if (typeof workspaceRootOverride === 'string' && workspaceRootOverride.trim()) {
		try {
			const resolved = path.resolve(workspaceRootOverride.trim());
			if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
				return resolved;
			}
		} catch {
			/* ignore */
		}
	}
	return senderWorkspaceRoot(event);
}

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

function appendSystemBlock(base: string | undefined, block: string): string {
	const trimmed = block.trim();
	if (!trimmed) {
		return base ?? '';
	}
	return base && base.trim() ? `${base}\n\n---\n${trimmed}` : trimmed;
}

function logChatPipelineLatency(
	_channel: string,
	_threadId: string,
	_epochMs: number,
	_phase: string,
	_extra?: Record<string, string | number | boolean | null | undefined>
): void {
	/* intentionally quiet — was used for main-process chat pipeline latency tracing */
}

function startThreadMemDiag(
	_threadId: string,
	_signal: AbortSignal,
	_phaseRef: { current: string }
): () => void {
	return () => {};
}

function throwIfAbortRequested(signal: AbortSignal | undefined, _threadId: string, _phase: string): void {
	if (!signal?.aborted) {
		return;
	}
	throw new DOMException('Aborted', 'AbortError');
}

async function appendMemoryAndRetrievalContext(params: {
	base: string | undefined;
	mode: ComposerMode;
	settings: ReturnType<typeof getSettings>;
	root: string | null;
	threadId: string;
	userText: string;
	atPaths: string[];
	modelSelection: string;
	signal?: AbortSignal;
}): Promise<string> {
	let next = params.base ?? '';
	if (params.signal?.aborted) {
		return next;
	}

	if ((params.mode === 'agent' || params.mode === 'debug') && params.root) {
		const memoryPrompt = await loadMemoryPrompt(params.root);
		if (memoryPrompt) {
			next = appendSystemBlock(next, memoryPrompt);
		}
	}

	if (modeExpandsWorkspaceFileContext(params.mode) && params.userText.trim().length > 8) {
		const recentPaths = Object.keys(getThread(params.threadId)?.fileStates ?? {});
		const enrichedQuery = buildEnrichedQuery(params.userText, getThread(params.threadId)?.messages ?? []);
		if (params.root) {
			const relevantMemories = await buildRelevantMemoryContextBlock({
				query: enrichedQuery,
				settings: params.settings,
				modelSelection: params.modelSelection,
				workspaceRoot: params.root,
				signal: params.signal,
			});
			if (relevantMemories) {
				next = appendSystemBlock(next, relevantMemories);
			}
		}
	}

	if (modeExpandsWorkspaceFileContext(params.mode) && params.root) {
		const gitBlock = await getGitContextBlock(params.root);
		if (gitBlock) {
			next = appendSystemBlock(next, gitBlock);
		}
	}

	return next;
}

const abortByThread = new Map<string, AbortController>();
const preflightAbortByThread = new Map<string, AbortController>();
const agentRevertSnapshotsByThread = new Map<string, Map<string, string | null>>();
/** 工具执行前用户确认：approvalId → resolve(allowed) */
const toolApprovalWaiters = new Map<string, (approved: boolean) => void>();
/** 连续失败后恢复：recoveryId → resolve(decision) */
const mistakeLimitWaiters = new Map<string, (d: MistakeLimitDecision) => void>();
function activeUsageStatsDir(): string | null {
	return resolveUsageStatsDataDir(getSettings());
}

function resolveManagedAgentLoopOptions(
	settings: ReturnType<typeof getSettings>,
	workspaceRoot: string | null,
	workspaceLspManager: ReturnType<typeof getWorkspaceLspManagerForWebContents>,
	hostWebContentsId: number | null
): Omit<import('../agent/agentLoop.js').AgentLoopOptions, 'signal'> | null {
	const modelSelection = String(settings.defaultModel ?? '').trim();
	if (!modelSelection) {
		return null;
	}
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) {
		return null;
	}
	const thinkingLevel = resolveThinkingLevelForSelection(settings, modelSelection);
	return {
		modelSelection,
		requestModelId: resolved.requestModelId,
		paradigm: resolved.paradigm,
		requestApiKey: resolved.apiKey,
		requestBaseURL: resolved.baseURL,
		requestProxyUrl: resolved.proxyUrl,
		maxOutputTokens: resolved.maxOutputTokens,
		...(resolved.contextWindowTokens != null
			? { contextWindowTokens: resolved.contextWindowTokens }
			: {}),
		composerMode: 'agent',
		thinkingLevel,
		workspaceRoot,
		workspaceLspManager,
		hostWebContentsId,
	};
}

function readWorkspaceTextFileIfExists(relPath: string, workspaceRoot: string | null): string | null {
	if (!workspaceRoot) {
		return null;
	}
	try {
		const full = resolveWorkspacePath(relPath, workspaceRoot);
		if (!fs.existsSync(full)) {
			return null;
		}
		return fs.readFileSync(full, 'utf8');
	} catch {
		return null;
	}
}

function contentsEqual(a: string | null, b: string | null): boolean {
	return (a ?? null) === (b ?? null);
}

function normalizePatchChunk(chunk: string): string {
	return String(chunk ?? '').replace(/\r\n/g, '\n').trim();
}

function reverseUnifiedPatch(chunk: string): string | null {
	const normalized = normalizePatchChunk(chunk);
	if (!normalized) {
		return null;
	}
	try {
		const patches = parsePatch(normalized);
		const first = patches[0];
		if (!first) {
			return null;
		}
		return formatPatch(reversePatch(first)).trim();
	} catch {
		return null;
	}
}

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
	workspaceRoot: string
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
	await spawnDetachedLaunch(resolved.command, ['-n', workspaceRoot], {
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

function recordTurnTokenUsageStats(
	modelSelection: string,
	mode: ComposerMode,
	usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
): void {
	recordTokenUsageEvent(activeUsageStatsDir(), {
		modelId: modelSelection,
		mode,
		input: usage?.inputTokens,
		output: usage?.outputTokens,
		cacheRead: usage?.cacheReadTokens,
		cacheWrite: usage?.cacheWriteTokens,
	});
}

function persistAssistantStreamError(threadId: string, message: string): void {
	try {
		const lang = getSettings().language;
		const prefix = lang === 'en' ? 'Error: ' : '错误：';
		appendMessage(threadId, { role: 'assistant', content: `${prefix}${message}` });
	} catch (e) {
		console.warn('[chat:stream] persist assistant error failed:', e instanceof Error ? e.message : e);
	}
}

function runChatStream(
	win: BrowserWindow,
	threadId: string,
	messages: ChatMessage[],
	mode: ReturnType<typeof parseComposerMode>,
	modelSelection: string,
	agentSystemAppend?: string,
	streamNonce?: number
): void {
	const send = (obj: unknown) => {
		const o = (typeof obj === 'object' && obj !== null ? obj : {}) as Record<string, unknown>;
		win.webContents.send(
			'async-shell:chat',
			streamNonce !== undefined ? { ...o, streamNonce } : o
		);
	};
	const emitStreamError = (message: string) => {
		console.error('[chat:stream]', threadId, message);
		persistAssistantStreamError(threadId, message);
		send({ threadId, type: 'error', message });
	};
	const prev = abortByThread.get(threadId);
	prev?.abort();
	agentRevertSnapshotsByThread.set(threadId, new Map());
	const ac = new AbortController();
	abortByThread.set(threadId, ac);

	void (async () => {
		const streamLatencyT0 = Date.now();
		const phaseRef = { current: 'bootstrap' };
		const stopMemDiag = startThreadMemDiag(threadId, ac.signal, phaseRef);
		try {
			logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'runChatStream async entered', {
				mode: String(mode),
				msgCount: messages.length,
			});
			phaseRef.current = 'resolveModelRequest';
			const settings = getSettings();
			const workspaceRoot = getWorkspaceRootForWebContents(win.webContents);
			const workspaceLspManager = getWorkspaceLspManagerForWebContents(win.webContents);
			const thinkingLevel = resolveThinkingLevelForSelection(settings, modelSelection);
			const resolved = resolveModelRequest(settings, modelSelection);
			if (!resolved.ok) {
				emitStreamError(resolved.message);
				return;
			}
			logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'after resolveModelRequest', {
				paradigm: String(resolved.paradigm),
			});

// 首条对话前预热到当前模型 API 基址的 TCP/TLS（无代理时）
			preconnectLlmBaseUrlIfEligible({
				paradigm: resolved.paradigm,
				baseURL: resolved.baseURL,
				appProxyUrl: resolved.proxyUrl?.trim() || settings.openAI?.proxyUrl?.trim() || undefined,
			});
			logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'after preconnectLlm (fire-and-forget HEAD)');

			// 发送端压缩：超长线程仅压缩发给 LLM 的副本，磁盘保留完整历史
			const thread = getThread(threadId);
			if (resolved.paradigm === 'openai-compatible') {
				scheduleRefreshOpenAiModelCapabilitiesIfStale({
					baseURL: resolved.baseURL,
					apiKey: resolved.apiKey,
					proxyUrl: resolved.proxyUrl,
				});
			}
			const compressOptions = {
				mode: mode as import('../llm/composerMode.js').ComposerMode,
				signal: ac.signal,
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				requestProxyUrl: resolved.proxyUrl,
				maxOutputTokens: resolved.maxOutputTokens,
				...(resolved.contextWindowTokens != null
					? { contextWindowTokens: resolved.contextWindowTokens }
					: {}),
				thinkingLevel,
			};
			if (mode === 'team') {
				setPlanQuestionRuntime({
					threadId,
					signal: ac.signal,
					emit: (evt) => send({ threadId, ...evt }),
				});
				phaseRef.current = 'runTeamSession';
				try {
					await runTeamSession({
						settings,
						threadId,
						messages,
						modelSelection,
						resolvedModel: resolved,
						agentSystemAppend,
						signal: ac.signal,
						thinkingLevel,
						workspaceRoot,
						workspaceLspManager,
						hostWebContentsId: win.webContents.id,
						deferredToolState: getDeferredToolState(threadId),
						onDeferredToolStateChange: (state) =>
							saveDeferredToolState(threadId, state),
						toolResultReplacementState: getToolResultReplacementState(threadId),
						onToolResultReplacementStateChange: (state) =>
							saveToolResultReplacementState(threadId, state),
						emit: (evt) => send(evt),
						onDone: (full, usage, teamSnapshot) => {
							updateLastAssistant(threadId, full);
							accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
							recordTurnTokenUsageStats(modelSelection, mode, usage);
							if (teamSnapshot) {
								saveTeamSession(threadId, teamSnapshot);
							}
							queueExtractMemories({
								threadId,
								workspaceRoot,
								settings,
								modelSelection,
							});
							send({ threadId, type: 'done', text: full, usage });
						},
						onError: (message) => emitStreamError(message),
					});
				} finally {
					setPlanQuestionRuntime(null);
				}
				return;
			}

			const compressStarted = Date.now();
			phaseRef.current = 'compressForSend';
			const compressResult = await compressForSend(
				messages,
				settings,
				compressOptions,
				thread?.summary,
				thread?.summaryCoversMessageCount
			);
			logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'after compressForSend', {
				compressMs: Date.now() - compressStarted,
				triggeredNewSummary: Boolean(compressResult.newSummary),
				outMsgCount: compressResult.messages.length,
			});
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
			const deferredToolState = getDeferredToolState(threadId);
			const toolResultReplacementState = getToolResultReplacementState(threadId);
			const customToolHandlers = {
					request_user_input: createRequestUserInputToolHandler({
						threadId,
						signal: ac.signal,
						emit: (evt) => send({ threadId, ...evt }),
						agentId: 'root',
						agentTitle: mode === 'plan' ? 'Plan Assistant' : 'Root Agent',
					}),
				};
			const agentOptions = {
					modelSelection,
					requestModelId: resolved.requestModelId,
					paradigm: resolved.paradigm,
					requestApiKey: resolved.apiKey,
					requestBaseURL: resolved.baseURL,
					requestProxyUrl: resolved.proxyUrl,
					maxOutputTokens: resolved.maxOutputTokens,
					...(resolved.contextWindowTokens != null
						? { contextWindowTokens: resolved.contextWindowTokens }
						: {}),
					signal: ac.signal,
					composerMode: mode,
					thinkingLevel,
					beforeExecuteTool,
					maxConsecutiveMistakes: ag?.maxConsecutiveMistakes,
					mistakeLimitEnabled: ag?.mistakeLimitEnabled,
					onMistakeLimitReached,
					customToolHandlers,
					workspaceRoot,
					workspaceLspManager,
					hostWebContentsId: win.webContents.id,
					deferredToolState,
					onDeferredToolStateChange: (state) =>
						saveDeferredToolState(threadId, state),
					toolResultReplacementState,
					onToolResultReplacementStateChange: (state) =>
						saveToolResultReplacementState(threadId, state),
				};
			try {
				setDelegateContext(
					settings,
					agentOptions,
					ac.signal,
					(evt) => send({ threadId, ...evt }),
					threadId,
					(evt) => send(evt),
					(payload) =>
						send({
							threadId,
							type: 'sub_agent_background_done',
							parentToolCallId: payload.parentToolCallId,
							agentId: payload.agentId,
							result: payload.result,
							success: payload.success,
						}),
					messages
				);
				if (mode === 'plan') {
					setPlanQuestionRuntime({
						threadId,
						signal: ac.signal,
						emit: (evt) => send({ threadId, ...evt }),
					});
					setPlanDraftRuntime(threadId, {
						onDraft: () => {
							// Renderer persists the visible draft from tool arguments and keeps the review UI in sync.
						},
					});
				}
				const expandMode = mode as import('../llm/composerMode.js').ComposerMode;
				const doAtExpand = modeExpandsWorkspaceFileContext(expandMode);
				const expandStarted = Date.now();
				phaseRef.current = 'expandWorkspaceRefs';
				const messagesForAgent = doAtExpand
					? cloneMessagesWithExpandedLastUser(sendMessages, workspaceRoot)
					: sendMessages;
				logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'after @-workspace expand', {
					expandMs: Date.now() - expandStarted,
					didExpand: doAtExpand,
				});
				logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'before runAgentLoop');
				phaseRef.current = 'runAgentLoop';
				await runAgentLoop(
					settings,
					messagesForAgent,
					{
						modelSelection,
						requestModelId: resolved.requestModelId,
						paradigm: resolved.paradigm,
						requestApiKey: resolved.apiKey,
						requestBaseURL: resolved.baseURL,
						requestProxyUrl: resolved.proxyUrl,
						maxOutputTokens: resolved.maxOutputTokens,
						...(resolved.contextWindowTokens != null
							? { contextWindowTokens: resolved.contextWindowTokens }
							: {}),
						signal: ac.signal,
						composerMode: mode,
						thinkingLevel,
						beforeExecuteTool,
						maxConsecutiveMistakes: ag?.maxConsecutiveMistakes,
						mistakeLimitEnabled: ag?.mistakeLimitEnabled,
						onMistakeLimitReached,
						customToolHandlers,
						workspaceRoot,
						workspaceLspManager,
						threadId,
						hostWebContentsId: win.webContents.id,
						deferredToolState,
						onDeferredToolStateChange: (state) =>
							saveDeferredToolState(threadId, state),
						toolResultReplacementState,
						onToolResultReplacementStateChange: (state) =>
							saveToolResultReplacementState(threadId, state),
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
							...(mode === 'agent' && activeUsageStatsDir()
								? {
										afterWrite: ({ previousContent, nextContent }) => {
											const { additions, deletions } = countLineChangesBetweenTexts(previousContent, nextContent);
											recordAgentLineDelta(activeUsageStatsDir(), { add: additions, del: deletions });
										},
									}
								: {}),
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
						onToolResult: (name, result, success, toolCallId) => {
							incrementThreadAgentToolCallCount(threadId);
							send({ threadId, type: 'tool_result', name, result, success, toolCallId });
						},
						onDone: (full, usage) => {
							updateLastAssistant(threadId, full);
							accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
							recordTurnTokenUsageStats(modelSelection, mode, usage);
							queueExtractMemories({
								threadId,
								workspaceRoot,
								settings,
								modelSelection,
							});
							send({ threadId, type: 'done', text: full, usage });
						},
						onError: (message) => emitStreamError(message),
					}
				);
			} finally {
				clearDelegateContext();
				if (mode === 'plan') {
					setPlanQuestionRuntime(null);
					setPlanDraftRuntime(threadId, null);
				}
			}
			return;
		}

			logChatPipelineLatency('chat:stream', threadId, streamLatencyT0, 'before streamChatUnified (non-agent path)');
			phaseRef.current = 'streamChatUnified';
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
				requestProxyUrl: resolved.proxyUrl,
				maxOutputTokens: resolved.maxOutputTokens,
				thinkingLevel,
				workspaceRoot,
				...(agentSystemAppend?.trim() ? { agentSystemAppend: agentSystemAppend.trim() } : {}),
			},
			{
				onDelta: (piece) => send({ threadId, type: 'delta', text: piece }),
				onThinkingDelta: (text) => send({ threadId, type: 'thinking_delta', text }),
				onDone: (full, usage) => {
					updateLastAssistant(threadId, full);
					accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
					recordTurnTokenUsageStats(modelSelection, mode, usage);
					queueExtractMemories({
						threadId,
						workspaceRoot,
						settings,
						modelSelection,
					});
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
				onError: (message) => emitStreamError(message),
			}
		);
		} catch (e) {
			phaseRef.current = 'error';
			try {
				emitStreamError(formatLlmSdkError(e));
			} catch { /* window may be destroyed */ }
		} finally {
			stopMemDiag();
			abortByThread.delete(threadId);
		}
	})();
}

const MAX_PLAN_EXECUTE_INJECT_CHARS = 200_000;

function readPlanFileForExecute(absPath: string, windowWorkspaceRoot: string | null): string | null {
	let resolved: string;
	try {
		resolved = path.resolve(absPath);
	} catch {
		return null;
	}
	const userPlansDir = path.join(app.getPath('userData'), '.async', 'plans');
	const root = windowWorkspaceRoot;
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
	exec: { fromAbsPath?: string; inlineMarkdown?: string; planTitle?: string } | undefined,
	windowWorkspaceRoot: string | null
): string {
	if (!exec) {
		return base ?? '';
	}
	let body: string | null = null;
	if (exec.fromAbsPath) {
		body = readPlanFileForExecute(exec.fromAbsPath, windowWorkspaceRoot);
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
	registerTerminalSessionIpc();

	setWorkspaceFsTouchNotifier(() => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send('async-shell:workspaceFsTouched');
			}
		}
	});

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
		const tool = (payload as { tool?: unknown } | null | undefined)?.tool;
		if (!isExternalWorkspaceTool(tool)) {
			return { ok: false as const, code: 'unsupported-tool' as const, error: 'unsupported tool' };
		}
		try {
			if (tool === 'explorer') {
				const err = await shell.openPath(root);
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
			const ok = await launchWorkspaceInExternalEditor(tool, root);
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
		const paths = getRecentWorkspaces().filter((p) => {
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

	ipcMain.handle('lsp:ts:start', async (_event, workspaceRootArg: string) => {
		const dir = typeof workspaceRootArg === 'string' ? workspaceRootArg.trim() : '';
		if (!dir) {
			return { ok: false as const, error: 'empty-root' as const };
		}
		/* LSP 子进程按需在首次 definition/diagnostics/Agent 工具调用时启动；此处保留通道以兼容旧前端 */
		return { ok: true as const };
	});

	ipcMain.handle('lsp:ts:stop', async (event) => {
		await disposeTsLspSessionForWebContents(event.sender);
		return { ok: true as const };
	});

	ipcMain.handle('lsp:ts:definition', async (event, payload: unknown) => {
		const p = payload as { uri?: string; line?: number; column?: number; text?: string };
		const uri = typeof p?.uri === 'string' ? p.uri : '';
		const text = typeof p?.text === 'string' ? p.text : '';
		const line = typeof p?.line === 'number' && Number.isFinite(p.line) ? p.line : 1;
		const column = typeof p?.column === 'number' && Number.isFinite(p.column) ? p.column : 1;
		if (!uri || !text) {
			return { ok: false as const, error: 'bad-args' as const };
		}
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		let absPath: string;
		try {
			absPath = uri.startsWith('file:') ? fileURLToPath(uri) : '';
		} catch {
			absPath = '';
		}
		if (!absPath) {
			return { ok: false as const, error: 'bad-uri' as const };
		}
		try {
			const mgr = getWorkspaceLspManagerForWebContents(event.sender);
			const session = await mgr.sessionForFile(absPath, root);
			if (!session) {
				return { ok: false as const, error: 'no-lsp-server' as const };
			}
			const result = await session.definition(uri, line, column, text);
			return { ok: true as const, result };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('lsp:ts:diagnostics', async (event, payload: unknown) => {
		const p = payload as { relPath?: string };
		const relPath = typeof p?.relPath === 'string' ? p.relPath : '';
		if (!relPath) {
			return { ok: false as const, error: 'bad-args' as const };
		}
		const root = senderWorkspaceRoot(event);
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
			const mgr = getWorkspaceLspManagerForWebContents(event.sender);
			const session = await mgr.sessionForFile(absPath, root);
			if (!session) {
				return { ok: false as const, error: 'no-lsp-server' as const };
			}
			const items = await session.diagnostics(uri, text);
			if (items === null) {
				return { ok: false as const, error: 'not-supported' as const };
			}
			return { ok: true as const, diagnostics: items };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
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

	ipcMain.handle('app:newWindow', () => {
		createAppWindow({ blank: true, surface: 'agent' });
		return { ok: true as const };
	});

	ipcMain.handle('app:newEditorWindow', () => {
		createAppWindow({ blank: true, surface: 'editor' });
		return { ok: true as const };
	});

	ipcMain.handle('app:windowGetState', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		return { ok: true as const, maximized: win.isMaximized() };
	});

	ipcMain.handle('app:windowMinimize', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		win.minimize();
		return { ok: true as const };
	});

	ipcMain.handle('app:windowToggleMaximize', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		if (win.isMaximized()) {
			win.unmaximize();
		} else {
			win.maximize();
		}
		return { ok: true as const };
	});

	ipcMain.handle('app:windowClose', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) {
			return { ok: false as const, error: 'no-window' as const };
		}
		win.close();
		return { ok: true as const };
	});

	ipcMain.handle('app:quit', () => {
		app.quit();
		return { ok: true as const };
	});

	ipcMain.handle('fs:pickOpenFile', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const root = senderWorkspaceRoot(event);
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
			const root = senderWorkspaceRoot(event);
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

	ipcMain.handle('browser:getConfig', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const partition = browserPartitionForHostId(hostId);
		const payload = await getBrowserSidebarConfigPayloadForHostId(hostId);
		return {
			ok: true as const,
			partition,
			config: payload.config,
			defaultUserAgent: payload.defaultUserAgent,
		};
	});

	ipcMain.handle('browser:setConfig', async (event, rawConfig: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const result = await setBrowserSidebarConfigForHostId(hostId, rawConfig);
		if (result.ok) {
			sendApplyConfigToDetachedBrowserWindowIfOpen(hostId, result.config, result.defaultUserAgent);
		}
		return result;
	});

	const SETTINGS_OPEN_NAV_IDS = new Set([
		'general',
		'appearance',
		'editor',
		'plan',
		'team',
		'bots',
		'agents',
		'models',
		'plugins',
		'rules',
		'tools',
		'indexing',
		'autoUpdate',
		'browser',
	]);

	ipcMain.handle('app:requestOpenSettings', async (event, payload: unknown) => {
		const navRaw =
			payload && typeof payload === 'object' && typeof (payload as { nav?: unknown }).nav === 'string'
				? String((payload as { nav: string }).nav).trim()
				: '';
		const nav = navRaw || 'general';
		if (!SETTINGS_OPEN_NAV_IDS.has(nav)) {
			return { ok: false as const, error: 'invalid-nav' as const };
		}
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		const mainContents = webContents.fromId(hostId);
		if (!mainContents || mainContents.isDestroyed()) {
			return { ok: false as const, error: 'no-host' as const };
		}
		mainContents.send('async-shell:openSettingsNav', nav);
		const win = BrowserWindow.fromWebContents(mainContents);
		if (win && !win.isDestroyed()) {
			if (win.isMinimized()) {
				win.restore();
			}
			win.show();
			win.focus();
		}
		return { ok: true as const };
	});

	ipcMain.handle('browser:syncState', async (event, rawState: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		syncBrowserCaptureBindingsForHostId(hostId, rawState);
		const state = updateBrowserRuntimeStateForHostId(hostId, rawState);
		return {
			ok: true as const,
			state,
		};
	});

	ipcMain.handle('browser:getState', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: true as const,
			state: getBrowserRuntimeStateForHostId(hostId),
		};
	});

	ipcMain.handle('browser:commandResult', async (event, payload: unknown) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return {
			ok: resolveBrowserCommandResultForHostId(hostId, payload),
		};
	});

	ipcMain.handle('browser:windowReady', async (event) => {
		markBrowserWindowReadyForSenderId(event.sender.id);
		return { ok: true as const };
	});

	ipcMain.handle('browser:openWindow', async (event) => {
		const hostId = resolveBrowserHostIdForSenderId(event.sender.id);
		return { ok: await openBrowserWindowForHostId(hostId) };
	});

	const COMPOSER_ATTACH_MAX_BYTES = 8 * 1024 * 1024;

	ipcMain.handle(
		'workspace:saveComposerAttachment',
		async (
			event,
			payload: { base64?: string; fileName?: string }
		): Promise<
			| { ok: true; relPath: string }
			| { ok: false; error: 'no-workspace' | 'empty' | 'too-large' | 'write-failed' }
		> => {
			const root = senderWorkspaceRoot(event);
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
				registerKnownWorkspaceRelPath(relPath, root);
				return { ok: true as const, relPath };
			} catch {
				return { ok: false as const, error: 'write-failed' as const };
			}
		}
	);

	ipcMain.handle('settings:get', () => getSettings());

	ipcMain.handle('settings:set', (_e, partial: Record<string, unknown>) => {
		const next = patchSettings(partial as Parameters<typeof patchSettings>[0]);
		void syncBotControllerFromSettings(next);
		const syncedColorMode = next.ui?.colorMode;
		if (syncedColorMode === 'light' || syncedColorMode === 'dark' || syncedColorMode === 'system') {
			for (const win of BrowserWindow.getAllWindows()) {
				if (!win.isDestroyed()) {
					win.webContents.send('async-shell:themeMode', { colorMode: syncedColorMode });
				}
			}
		}
		return next;
	});

	ipcMain.handle('plugins:getState', async (event) => {
		return await getPluginPanelState(senderWorkspaceRoot(event));
	});

	ipcMain.handle('plugins:getRuntimeState', async (event) => {
		return getPluginRuntimeState(senderWorkspaceRoot(event));
	});

	ipcMain.handle('plugins:pickUserDirectory', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const result = await dialog.showOpenDialog(win ?? undefined, {
			properties: ['openDirectory', 'createDirectory'],
		});
		if (result.canceled || !result.filePaths[0]) {
			return { ok: false as const };
		}
		return { ok: true as const, path: path.resolve(result.filePaths[0]) };
	});

	ipcMain.handle('plugins:setUserDirectory', async (_event, payload: unknown) => {
		const nextPath =
			payload && typeof payload === 'object' && typeof (payload as { path?: unknown }).path === 'string'
				? String((payload as { path: string }).path)
				: null;
		const reset =
			payload && typeof payload === 'object' && (payload as { reset?: unknown }).reset === true;
		try {
			const result = {
				ok: true as const,
				...setConfiguredUserPluginsRoot(reset ? null : nextPath),
			};
			broadcastPluginsChanged();
			return result;
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:addMarketplace', async (_event, payload: unknown) => {
		const input =
			payload && typeof payload === 'object' && typeof (payload as { input?: unknown }).input === 'string'
				? String((payload as { input: string }).input)
				: '';
		try {
			return {
				ok: true as const,
				...(await addMarketplaceFromInput(input)),
			};
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:refreshMarketplace', async (_event, payload: unknown) => {
		const name =
			payload && typeof payload === 'object' && typeof (payload as { name?: unknown }).name === 'string'
				? String((payload as { name: string }).name).trim()
				: '';
		if (!name) {
			return { ok: false as const, error: 'Marketplace name is required.' };
		}
		try {
			await refreshMarketplaceByName(name);
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:removeMarketplace', async (_event, payload: unknown) => {
		const name =
			payload && typeof payload === 'object' && typeof (payload as { name?: unknown }).name === 'string'
				? String((payload as { name: string }).name).trim()
				: '';
		if (!name) {
			return { ok: false as const, error: 'Marketplace name is required.' };
		}
		try {
			await removeMarketplaceByName(name);
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:install', async (event, payload: unknown) => {
		const marketplaceName =
			payload && typeof payload === 'object' && typeof (payload as { marketplaceName?: unknown }).marketplaceName === 'string'
				? String((payload as { marketplaceName: string }).marketplaceName).trim()
				: '';
		const pluginName =
			payload && typeof payload === 'object' && typeof (payload as { pluginName?: unknown }).pluginName === 'string'
				? String((payload as { pluginName: string }).pluginName).trim()
				: '';
		const scope =
			payload && typeof payload === 'object' && (payload as { scope?: unknown }).scope === 'project'
				? 'project'
				: 'user';
		if (!marketplaceName || !pluginName) {
			return { ok: false as const, error: 'Marketplace name and plugin name are required.' };
		}
		try {
			const result = {
				ok: true as const,
				...(await installMarketplacePlugin(marketplaceName, pluginName, scope, senderWorkspaceRoot(event))),
			};
			broadcastPluginsChanged();
			return result;
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:uninstall', async (event, payload: unknown) => {
		const installDir =
			payload && typeof payload === 'object' && typeof (payload as { installDir?: unknown }).installDir === 'string'
				? String((payload as { installDir: string }).installDir).trim()
				: '';
		if (!installDir) {
			return { ok: false as const, error: 'Plugin install directory is required.' };
		}
		try {
			await uninstallInstalledPlugin(installDir, senderWorkspaceRoot(event));
			broadcastPluginsChanged();
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('plugins:setEnabled', async (event, payload: unknown) => {
		const installDir =
			payload && typeof payload === 'object' && typeof (payload as { installDir?: unknown }).installDir === 'string'
				? String((payload as { installDir: string }).installDir).trim()
				: '';
		const enabled =
			payload && typeof payload === 'object' && typeof (payload as { enabled?: unknown }).enabled === 'boolean'
				? Boolean((payload as { enabled: boolean }).enabled)
				: true;
		if (!installDir) {
			return { ok: false as const, error: 'Plugin install directory is required.' };
		}
		try {
			await setInstalledPluginEnabled(installDir, enabled, senderWorkspaceRoot(event));
			broadcastPluginsChanged();
			return { ok: true as const };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle('settings:testBotConnection', async (_e, rawIntegration: unknown) => {
		const integration = rawIntegration as BotIntegrationConfig | null | undefined;
		if (!integration || typeof integration !== 'object' || typeof integration.id !== 'string' || typeof integration.platform !== 'string') {
			return { ok: false as const, message: 'Invalid bot integration payload.' };
		}
		const lang = getSettings().language === 'en' ? 'en' : 'zh-CN';
		return await testBotIntegrationConnection(integration, lang);
	});

	ipcMain.handle(
		'theme:applyChrome',
		(
			e,
			payload: {
				scheme?: string;
				backgroundColor?: string;
				titleBarColor?: string;
				symbolColor?: string;
			}
		) => {
			const s = payload?.scheme;
			if (s !== 'light' && s !== 'dark') {
				return { ok: false as const, error: 'bad-scheme' as const };
			}
			const win = BrowserWindow.fromWebContents(e.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			const hex = /^#[0-9a-fA-F]{6}$/;
			const hasCustom =
				typeof payload?.backgroundColor === 'string' &&
				typeof payload?.titleBarColor === 'string' &&
				typeof payload?.symbolColor === 'string' &&
				hex.test(payload.backgroundColor.trim()) &&
				hex.test(payload.titleBarColor.trim()) &&
				hex.test(payload.symbolColor.trim());
			const override: NativeChromeOverride | null = hasCustom
				? {
						backgroundColor: payload!.backgroundColor!.trim(),
						titleBarColor: payload!.titleBarColor!.trim(),
						symbolColor: payload!.symbolColor!.trim(),
					}
				: null;
			applyThemeChromeToWindow(win, s as ThemeChromeScheme, override);
			return { ok: true as const };
		}
	);

	ipcMain.handle('workspaceAgent:get', (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: true as const, slice: { rules: [], skills: [], subagents: [] } satisfies WorkspaceAgentProjectSlice };
		}
		return { ok: true as const, slice: readWorkspaceAgentProjectSlice(root) };
	});

	ipcMain.handle('workspaceAgent:set', (event, slice: WorkspaceAgentProjectSlice) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		writeWorkspaceAgentProjectSlice(root, slice);
		return { ok: true as const };
	});

	ipcMain.handle('workspace:listDiskSkills', (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: true as const, skills: [] };
		}
		return { ok: true as const, skills: loadClaudeWorkspaceSkills(root) };
	});

	/** 删除工作区内技能目录（`.cursor|claude|async/skills/<slug>/` 整夹），参数为其中 `SKILL.md` 的相对路径 */
	ipcMain.handle('workspace:deleteSkillFromDisk', (event, skillMdRel: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
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
			const dirFull = resolveWorkspacePath(dirRel, root);
			if (fs.existsSync(dirFull)) {
				fs.rmSync(dirFull, { recursive: true, force: true });
			}
			return { ok: true as const };
		} catch {
			return { ok: false as const, error: 'io-failed' as const };
		}
	});

	ipcMain.handle('workspace:memory:stats', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const memoryDir = await ensureMemoryDirExists(root);
		const entrypointPath = getAutoMemEntrypoint(root);
		const headers = memoryDir ? await scanMemoryFiles(memoryDir) : [];
		let entryCount = 0;
		let entrypointExists = false;
		if (entrypointPath && fs.existsSync(entrypointPath) && fs.statSync(entrypointPath).isFile()) {
			entrypointExists = true;
			try {
				const raw = fs.readFileSync(entrypointPath, 'utf8');
				entryCount = raw
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean).length;
			} catch {
				entryCount = 0;
			}
		}
		return {
			ok: true as const,
			workspaceRoot: root,
			memoryDir,
			entrypointPath,
			entrypointExists,
			topicFiles: headers.length,
			entryCount,
		};
	});

	ipcMain.handle('workspace:memory:rebuild', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const memoryDir = await ensureMemoryDirExists(root);
		const entrypointPath = getAutoMemEntrypoint(root);
		if (!memoryDir || !entrypointPath) {
			return { ok: false as const, error: 'memory-unavailable' as const };
		}
		const headers = await scanMemoryFiles(memoryDir);
		await fs.promises.writeFile(entrypointPath, buildMemoryEntrypoint(headers), 'utf8');
		return {
			ok: true as const,
			memoryDir,
			entrypointPath,
			topicFiles: headers.length,
		};
	});

	// 每处理 BATCH_SIZE 条 thread 后通过 setImmediate 让出一次主进程事件循环，
	// 防止 summarizeThreadForSidebar 对大量/长消息的 thread 进行批量 diff 扫描时
	// 阻塞主进程，导致 Electron 窗口拖动等原生事件无法响应。
	const THREAD_SUMMARIZE_BATCH = 8;
	function yieldToEventLoop(): Promise<void> {
		return new Promise((resolve) => setImmediate(resolve));
	}

	ipcMain.handle('threads:list', async (event) => {
		const t0 = performance.now();
		const scope = senderWorkspaceRoot(event);
		ensureDefaultThread(scope);
		const now = Date.now();
		const raw = listThreads(scope);
		console.log(`[perf][main] threads:list listThreads=${(performance.now() - t0).toFixed(1)}ms count=${raw.length}`);
		const threads = [];
		for (let i = 0; i < raw.length; i++) {
			const t = raw[i]!;
			const sum = summarizeThreadForSidebar(t);
			threads.push({
				id: t.id,
				title: t.title,
				updatedAt: t.updatedAt,
				createdAt: t.createdAt,
				previewCount: t.messages.filter((m) => m.role !== 'system').length,
				hasUserMessages: threadHasUserMessages(t),
				isToday: isTimestampToday(t.updatedAt, now),
				tokenUsage: t.tokenUsage,
				fileStateCount: t.fileStates ? Object.keys(t.fileStates).length : 0,
				...sum,
			});
			if ((i + 1) % THREAD_SUMMARIZE_BATCH === 0) {
				await yieldToEventLoop();
			}
		}
		console.log(`[perf][main] threads:list total=${(performance.now() - t0).toFixed(1)}ms summarized=${threads.length}`);
		// Prune cached summaries for threads that no longer exist in this workspace.
		pruneSummaryCache(new Set(raw.map((t) => t.id)));
		return { threads, currentId: getCurrentThreadId(scope) };
	});

	ipcMain.handle('threads:listAgentSidebar', async (event, rawPaths: unknown) => {
		const activeRoot = senderWorkspaceRoot(event);
		const paths = Array.isArray(rawPaths)
			? rawPaths.map((p) => String(p ?? '').trim()).filter((p) => p.length > 0)
			: [];
		const now = Date.now();
		const workspaces = [];
		for (const dirPath of paths) {
			let resolved: string;
			try {
				resolved = path.resolve(dirPath);
				if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
					workspaces.push({ requestedPath: dirPath, resolvedPath: null as string | null, threads: [], currentId: null as string | null });
					continue;
				}
			} catch {
				workspaces.push({ requestedPath: dirPath, resolvedPath: null, threads: [], currentId: null });
				continue;
			}
			if (activeRoot && workspaceRootsEqual(resolved, activeRoot)) {
				ensureDefaultThread(activeRoot);
			}
			const raw = listThreads(resolved);
			const threads = [];
			for (let i = 0; i < raw.length; i++) {
				const t = raw[i]!;
				const sum = summarizeThreadForSidebar(t);
				threads.push({
					id: t.id,
					title: t.title,
					updatedAt: t.updatedAt,
					createdAt: t.createdAt,
					previewCount: t.messages.filter((m) => m.role !== 'system').length,
					hasUserMessages: threadHasUserMessages(t),
					isToday: isTimestampToday(t.updatedAt, now),
					tokenUsage: t.tokenUsage,
					fileStateCount: t.fileStates ? Object.keys(t.fileStates).length : 0,
					...sum,
				});
				if ((i + 1) % THREAD_SUMMARIZE_BATCH === 0) {
					await yieldToEventLoop();
				}
			}
			workspaces.push({ requestedPath: dirPath, resolvedPath: resolved, threads, currentId: getCurrentThreadId(resolved) });
		}
		return { workspaces };
	});

	ipcMain.handle('threads:fileStates', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return { ok: true as const, fileStates: t.fileStates ?? {} };
	});

	ipcMain.handle('usageStats:get', () => {
		const s = getSettings();
		if (!s.usageStats?.enabled) {
			return { ok: false as const, reason: 'disabled' as const };
		}
		const dir = resolveUsageStatsDataDir(s);
		if (!dir) {
			return { ok: false as const, reason: 'no-directory' as const };
		}
		return getUsageStatsForDataDir(dir);
	});

	ipcMain.handle('usageStats:pickDirectory', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const r = await dialog.showOpenDialog(win ?? undefined, {
			properties: ['openDirectory', 'createDirectory'],
		});
		if (r.canceled || !r.filePaths[0]) {
			return { ok: false as const };
		}
		return { ok: true as const, path: r.filePaths[0] };
	});

	ipcMain.handle('threads:messages', (_e, threadId: string) => {
		const t = getThread(threadId);
		if (!t) {
			return { ok: false as const };
		}
		return {
			ok: true as const,
			messages: t.messages.filter((m) => m.role !== 'system'),
			teamSession: t.teamSession ?? null,
			agentSession: getManagedAgentSession(threadId) ?? getAgentSession(threadId),
		};
	});

	ipcMain.handle('threads:create', (event) => {
		const t = createThread(senderWorkspaceRoot(event));
		return { id: t.id };
	});

	ipcMain.handle('threads:select', (event, id: string, workspaceRootOverride?: unknown) => {
		const scope = resolveWorkspaceScopeForThreads(event, workspaceRootOverride);
		const t = selectThread(scope, id);
		return { ok: !!t };
	});

	ipcMain.handle('threads:delete', (event, id: string, workspaceRootOverride?: unknown) => {
		const scope = resolveWorkspaceScopeForThreads(event, workspaceRootOverride);
		deleteThread(scope, id);
		ensureDefaultThread(scope);
		return { ok: true as const, currentId: getCurrentThreadId(scope) };
	});

	ipcMain.handle('threads:rename', (event, id: string, title: string, workspaceRootOverride?: unknown) => {
		const scope = resolveWorkspaceScopeForThreads(event, workspaceRootOverride);
		const ok = setThreadTitle(scope, String(id ?? ''), String(title ?? ''));
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

	ipcMain.handle('agent:applyDiffChunk', (event, payload: { threadId?: string; chunk?: string }) => {
		const threadId = String(payload?.threadId ?? '');
		const chunk = typeof payload?.chunk === 'string' ? payload.chunk : '';
		if (!threadId || !chunk) {
			return { applied: [] as string[], failed: [{ path: '(invalid)', reason: '参数无效' }] };
		}
		const ar = applyAgentDiffChunk(chunk, senderWorkspaceRoot(event));
		const statsDir = activeUsageStatsDir();
		if (statsDir && ar.applied.length > 0) {
			const { add, del } = countDiffLinesInChunk(chunk);
			recordAgentLineDelta(statsDir, { add, del });
		}
		const inc = formatAgentApplyIncremental(ar);
		if (inc) {
			appendToLastAssistant(threadId, inc);
		}
		return ar;
	});

	ipcMain.handle(
		'agent:applyDiffChunks',
		(event, payload: { threadId?: string; items?: { id?: string; chunk?: string }[] }) => {
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
			const ar = applyAgentPatchItems(items, senderWorkspaceRoot(event));
			const statsDir = activeUsageStatsDir();
			if (statsDir && ar.succeededIds.length > 0) {
				const ok = new Set(ar.succeededIds);
				for (const it of items) {
					if (ok.has(it.id)) {
						const { add, del } = countDiffLinesInChunk(it.chunk);
						recordAgentLineDelta(statsDir, { add, del });
					}
				}
			}
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
				streamNonce?: number;
				skillCreator?: { userNote: string; scope: SkillCreatorScope };
				ruleCreator?: { userNote: string; ruleScope: AgentRuleScope; globPattern?: string };
				subagentCreator?: { userNote: string; scope: SubagentCreatorScope };
				/** Plan Build：完整计划写入系统上下文，可见用户气泡仅短触发语 */
				planExecute?: { fromAbsPath?: string; inlineMarkdown?: string; planTitle?: string };
			}
		) => {
			const { threadId, text } = payload;
			const streamNonce = typeof payload.streamNonce === 'number' ? payload.streamNonce : undefined;
			const mode = parseComposerMode(payload.mode);
			const rawMid = payload.modelId;
			const modelSelection = typeof rawMid === 'string' ? rawMid.trim() : '';
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			if (!modelSelection || modelSelection.toLowerCase() === 'auto') {
				return { ok: false as const, error: 'no-model' as const };
			}

			const chatSendLatencyT0 = Date.now();
			logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'chat:send entered', {
				mode: String(mode),
				streamNonce: typeof streamNonce === 'number' ? streamNonce : -1,
			});
			const preflightAc = new AbortController();
			preflightAbortByThread.get(threadId)?.abort();
			preflightAbortByThread.set(threadId, preflightAc);

			try {
				const settings = getSettings();
				const root = senderWorkspaceRoot(event);
				let workspaceFiles: string[] = [];
				if (root) {
					try {
						workspaceFiles = await ensureWorkspaceFileIndex(root, preflightAc.signal);
					} catch {
						workspaceFiles = [];
					}
				}
				throwIfAbortRequested(preflightAc.signal, threadId, 'ensureWorkspaceFileIndex');
				logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'after ensureWorkspaceFileIndex', {
					fileCount: workspaceFiles.length,
					hasRoot: Boolean(root),
				});
				const projectAgent = readWorkspaceAgentProjectSlice(root);
				const agentForTurn = mergeAgentWithPluginRuntime(
					mergeAgentWithProjectSlice(settings.agent, projectAgent),
					root
				);

			const skillIn = payload.skillCreator;
			if (skillIn && typeof skillIn.userNote === 'string') {
				/** Slash /create-skill：固定 Agent，否则 Plan 无写盘工具、Ask 无工具 */
				const creatorAgentMode: ComposerMode = 'agent';
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
				if (root) {
					const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
				}
				if (workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = appendSystemBlock(finalSystemAppend, tree);
					}
				}
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode: creatorAgentMode,
					settings,
					root,
					threadId,
					userText: prepared.userText,
					atPaths: prepared.atPaths,
					modelSelection,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'skillCreator preflight');
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				runChatStream(win, threadId, t.messages, creatorAgentMode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			}

			const ruleIn = payload.ruleCreator;
			if (ruleIn && typeof ruleIn.userNote === 'string') {
				const creatorAgentMode: ComposerMode = 'agent';
				const ruleScope: AgentRuleScope =
					ruleIn.ruleScope === 'glob' || ruleIn.ruleScope === 'manual' ? ruleIn.ruleScope : 'always';
				const prepared = prepareUserTurnForChat(ruleIn.userNote, agentForTurn, root, workspaceFiles);
				const lang = settings.language === 'en' ? 'en' : 'zh-CN';
				const visible = formatRuleCreatorUserBubble(ruleScope, ruleIn.globPattern, lang, ruleIn.userNote);
				const ruleBlock = buildRuleCreatorSystemAppend(ruleScope, ruleIn.globPattern, lang, root);
				let finalSystemAppend = prepared.agentSystemAppend
					? `${prepared.agentSystemAppend}\n\n---\n\n${ruleBlock}`
					: ruleBlock;
				if (root) {
					const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
				}
				if (workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = appendSystemBlock(finalSystemAppend, tree);
					}
				}
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode: creatorAgentMode,
					settings,
					root,
					threadId,
					userText: prepared.userText,
					atPaths: prepared.atPaths,
					modelSelection,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'ruleCreator preflight');
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);
				finalSystemAppend = appendRuleCreatorPathLock(
					finalSystemAppend,
					settings.language === 'en' ? 'en' : 'zh-CN',
					Boolean(root)
				);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				runChatStream(win, threadId, t.messages, creatorAgentMode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			}

			const subIn = payload.subagentCreator;
			if (subIn && typeof subIn.userNote === 'string') {
				const creatorAgentMode: ComposerMode = 'agent';
				const scope: SubagentCreatorScope = subIn.scope === 'project' ? 'project' : 'user';
				if (scope === 'project' && !root) {
					return { ok: false as const, error: 'no-workspace' as const };
				}
				const prepared = prepareUserTurnForChat(subIn.userNote, agentForTurn, root, workspaceFiles);
				const lang = settings.language === 'en' ? 'en' : 'zh-CN';
				const visible = formatSubagentCreatorUserBubble(scope, lang, subIn.userNote);
				const subBlock = buildSubagentCreatorSystemAppend(scope, lang, root);
				let finalSystemAppend = prepared.agentSystemAppend
					? `${prepared.agentSystemAppend}\n\n---\n\n${subBlock}`
					: subBlock;
				if (root) {
					const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
				}
				if (workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = appendSystemBlock(finalSystemAppend, tree);
					}
				}
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode: creatorAgentMode,
					settings,
					root,
					threadId,
					userText: prepared.userText,
					atPaths: prepared.atPaths,
					modelSelection,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'subagentCreator preflight');
				finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);
				const t = appendMessage(threadId, { role: 'user', content: visible });
				runChatStream(win, threadId, t.messages, creatorAgentMode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			}

			const { userText, agentSystemAppend, atPaths } = prepareUserTurnForChat(
				text,
				agentForTurn,
				root,
				workspaceFiles
			);

			let finalSystemAppend = agentSystemAppend;
			if (root && (mode === 'plan' || mode === 'ask' || mode === 'team')) {
				const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
				finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
			}
			if ((mode === 'plan' || mode === 'ask' || mode === 'team') && workspaceFiles.length > 0) {
				const tree = buildWorkspaceTreeSummary(workspaceFiles);
				if (tree) {
					finalSystemAppend = appendSystemBlock(finalSystemAppend, tree);
				}
			}
			finalSystemAppend = await appendMemoryAndRetrievalContext({
				base: finalSystemAppend,
				mode,
				settings,
				root,
				threadId,
				userText,
				atPaths,
				modelSelection,
				signal: preflightAc.signal,
			});
			throwIfAbortRequested(preflightAc.signal, threadId, 'chat preflight');
			logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'after appendMemoryAndRetrievalContext', {
				mode: String(mode),
			});

			finalSystemAppend = appendPlanExecuteToSystem(finalSystemAppend, payload.planExecute, root);

			const t = appendMessage(threadId, { role: 'user', content: userText });
			logChatPipelineLatency('chat:ipc', threadId, chatSendLatencyT0, 'before runChatStream (IPC returns soon)', {
				persistedMsgCount: t.messages.length,
			});
			runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend, streamNonce);

			return { ok: true as const };
			} catch (e) {
				if (preflightAc.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
					return { ok: false as const, error: 'aborted' as const };
				}
				throw e;
			} finally {
				if (preflightAbortByThread.get(threadId) === preflightAc) {
					preflightAbortByThread.delete(threadId);
				}
			}
		}
	);

	ipcMain.handle(
		'chat:editResend',
		async (
			event,
			payload: {
				threadId: string;
				visibleIndex: number;
				text: string;
				mode?: string;
				modelId?: string;
				streamNonce?: number;
			}
		) => {
			const { threadId, visibleIndex, text } = payload;
			const streamNonce = typeof payload.streamNonce === 'number' ? payload.streamNonce : undefined;
			const mode = parseComposerMode(payload.mode);
			const rawMid = payload.modelId;
			const modelSelection = typeof rawMid === 'string' ? rawMid.trim() : '';
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) {
				return { ok: false as const, error: 'no-window' as const };
			}
			if (!modelSelection || modelSelection.toLowerCase() === 'auto') {
				return { ok: false as const, error: 'no-model' as const };
			}
			const trimmed = typeof text === 'string' ? text.trim() : '';
			if (!trimmed) {
				return { ok: false as const, error: 'empty-text' as const };
			}
			if (!Number.isInteger(visibleIndex) || visibleIndex < 0) {
				return { ok: false as const, error: 'bad-index' as const };
			}
			const preflightAc = new AbortController();
			preflightAbortByThread.get(threadId)?.abort();
			preflightAbortByThread.set(threadId, preflightAc);
			try {
				const settings = getSettings();
				const root = senderWorkspaceRoot(event);
				let workspaceFiles: string[] = [];
				if (root) {
					try {
						workspaceFiles = await ensureWorkspaceFileIndex(root, preflightAc.signal);
					} catch {
						workspaceFiles = [];
					}
				}
				throwIfAbortRequested(preflightAc.signal, threadId, 'editResend ensureWorkspaceFileIndex');
				const projectAgent = readWorkspaceAgentProjectSlice(root);
				const agentForTurn = mergeAgentWithPluginRuntime(
					mergeAgentWithProjectSlice(settings.agent, projectAgent),
					root
				);
				const { userText, agentSystemAppend, atPaths } = prepareUserTurnForChat(trimmed, agentForTurn, root, workspaceFiles);

				let finalSystemAppend = agentSystemAppend;
				if (root && (mode === 'plan' || mode === 'ask' || mode === 'team')) {
					const wsLine = `## Current workspace\nWorkspace root (absolute): \`${root.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
					finalSystemAppend = finalSystemAppend ? `${finalSystemAppend}\n\n---\n${wsLine}` : wsLine;
				}
				if ((mode === 'plan' || mode === 'ask' || mode === 'team') && workspaceFiles.length > 0) {
					const tree = buildWorkspaceTreeSummary(workspaceFiles);
					if (tree) {
						finalSystemAppend = appendSystemBlock(finalSystemAppend, tree);
					}
				}
				finalSystemAppend = await appendMemoryAndRetrievalContext({
					base: finalSystemAppend,
					mode,
					settings,
					root,
					threadId,
					userText,
					atPaths,
					modelSelection,
					signal: preflightAc.signal,
				});
				throwIfAbortRequested(preflightAc.signal, threadId, 'editResend preflight');

				const t = replaceFromUserVisibleIndex(threadId, visibleIndex, userText);
				runChatStream(win, threadId, t.messages, mode, modelSelection, finalSystemAppend, streamNonce);
				return { ok: true as const };
			} catch (e) {
				if (preflightAc.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
					return { ok: false as const, error: 'aborted' as const };
				}
				return { ok: false as const, error: 'replace-failed' as const };
			} finally {
				if (preflightAbortByThread.get(threadId) === preflightAc) {
					preflightAbortByThread.delete(threadId);
				}
			}
		}
	);

	ipcMain.handle('chat:abort', (_e, threadId: string) => {
		abortPlanQuestionWaitersForThread(threadId);
		abortRequestUserInputWaitersForThread(threadId);
		abortTeamPlanApprovalForThread(threadId);
		preflightAbortByThread.get(threadId)?.abort();
		preflightAbortByThread.delete(threadId);
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

	ipcMain.handle('agent:getSession', (event, threadId: string) => {
		const session =
			getManagedAgentSession(String(threadId ?? '').trim()) ??
			getAgentSession(String(threadId ?? '').trim()) ??
			null;
		if (session) {
			attachManagedAgentEmitter(String(threadId ?? '').trim(), (evt) => {
				event.sender.send('async-shell:chat', evt);
			});
		}
		return { ok: true as const, session };
	});

	ipcMain.handle('agent:sendInput', async (event, payload: { threadId?: string; agentId?: string; message?: string; interrupt?: boolean }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentId = String(payload?.agentId ?? '').trim();
		const message = String(payload?.message ?? '').trim();
		if (!threadId || !agentId || !message) {
			return { ok: false as const, error: 'missing agent input payload' };
		}
		const workspaceRoot = senderWorkspaceRoot(event);
		const settings = getSettings();
		const options = resolveManagedAgentLoopOptions(
			settings,
			workspaceRoot,
			getWorkspaceLspManagerForWebContents(event.sender),
			event.sender.id
		);
		if (!options) {
			return { ok: false as const, error: 'no-model' };
		}
		options.deferredToolState = getDeferredToolState(threadId);
		options.onDeferredToolStateChange = (state) => saveDeferredToolState(threadId, state);
		options.toolResultReplacementState = getToolResultReplacementState(threadId);
		options.onToolResultReplacementStateChange = (state) =>
			saveToolResultReplacementState(threadId, state);
		const send = (evt: import('../agent/managedSubagents.js').ManagedAgentUiEvent) =>
			event.sender.send('async-shell:chat', evt);
		const result = await sendInputToManagedAgent({
			threadId,
			agentId,
			message,
			interrupt: payload?.interrupt === true,
			settings,
			options,
			emit: send,
		});
		return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
	});

	ipcMain.handle('agent:wait', async (_event, payload: { threadId?: string; agentIds?: string[]; timeoutMs?: number }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentIds = Array.isArray(payload?.agentIds)
			? payload.agentIds.map((value) => String(value ?? '').trim()).filter(Boolean)
			: [];
		if (!threadId || agentIds.length === 0) {
			return { ok: false as const, error: 'missing wait payload' };
		}
		const timeoutMsRaw = Number(payload?.timeoutMs ?? 30000);
		const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 30000;
		const statuses = await waitForManagedAgents(threadId, agentIds, timeoutMs);
		return {
			ok: true as const,
			statuses,
			timedOut: Object.keys(statuses).length < agentIds.length,
		};
	});

	ipcMain.handle('agent:resume', async (event, payload: { threadId?: string; agentId?: string }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentId = String(payload?.agentId ?? '').trim();
		if (!threadId || !agentId) {
			return { ok: false as const, error: 'missing resume payload' };
		}
		const workspaceRoot = senderWorkspaceRoot(event);
		const settings = getSettings();
		const options = resolveManagedAgentLoopOptions(
			settings,
			workspaceRoot,
			getWorkspaceLspManagerForWebContents(event.sender),
			event.sender.id
		);
		if (!options) {
			return { ok: false as const, error: 'no-model' };
		}
		options.deferredToolState = getDeferredToolState(threadId);
		options.onDeferredToolStateChange = (state) => saveDeferredToolState(threadId, state);
		options.toolResultReplacementState = getToolResultReplacementState(threadId);
		options.onToolResultReplacementStateChange = (state) =>
			saveToolResultReplacementState(threadId, state);
		const send = (evt: import('../agent/managedSubagents.js').ManagedAgentUiEvent) =>
			event.sender.send('async-shell:chat', evt);
		const result = await resumeManagedAgent({
			threadId,
			agentId,
			settings,
			options,
			emit: send,
		});
		return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
	});

	ipcMain.handle('agent:close', (event, payload: { threadId?: string; agentId?: string }) => {
		const threadId = String(payload?.threadId ?? '').trim();
		const agentId = String(payload?.agentId ?? '').trim();
		if (!threadId || !agentId) {
			return { ok: false as const, error: 'missing close payload' };
		}
		const send = (evt: import('../agent/managedSubagents.js').ManagedAgentUiEvent) =>
			event.sender.send('async-shell:chat', evt);
		const result = closeManagedAgent({ threadId, agentId, emit: send });
		return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
	});

	ipcMain.handle(
		'agent:userInputRespond',
		(_e, payload: { requestId?: string; answers?: Record<string, unknown> }) => {
			const requestId = String(payload?.requestId ?? '');
			if (!requestId) {
				return { ok: false as const, error: 'missing requestId' as const };
			}
			const ok = resolveRequestUserInput(requestId, {
				answers: payload?.answers,
			});
			return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'unknown request' as const });
		}
	);

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
		'team:planApprovalRespond',
		(
			_e,
			payload: { proposalId?: string; approved?: boolean; feedbackText?: string }
		) => {
			const proposalId = String(payload?.proposalId ?? '');
			if (!proposalId) return { ok: false as const, error: 'missing proposalId' as const };
			const ok = resolveTeamPlanApproval(proposalId, {
				approved: Boolean(payload?.approved),
				feedbackText: typeof payload?.feedbackText === 'string' ? payload.feedbackText : undefined,
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

	ipcMain.handle('fs:readFile', (event, relPath: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const full = resolveWorkspacePath(relPath, root);
		return { ok: true as const, content: fs.readFileSync(full, 'utf8') };
	});

	ipcMain.handle('fs:writeFile', (event, relPath: string, content: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const full = resolveWorkspacePath(relPath, root);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, 'utf8');
		return { ok: true as const };
	});

	ipcMain.handle('agent:keepLastTurn', (_e, threadId: string) => {
		agentRevertSnapshotsByThread.delete(threadId);
		return { ok: true as const };
	});

	ipcMain.handle('agent:revertLastTurn', (event, threadId: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots || snapshots.size === 0) {
			return { ok: true as const, reverted: 0 };
		}

		for (const [relPath, previousContent] of Array.from(snapshots.entries()).reverse()) {
			const full = resolveWorkspacePath(relPath, root);
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

ipcMain.handle('agent:getFileSnapshot', (_e, threadId: string, relPath: string) => {
	const snapshots = agentRevertSnapshotsByThread.get(String(threadId ?? ''));
	if (!snapshots || !snapshots.has(relPath)) {
		return { ok: true as const, hasSnapshot: false as const };
	}
		return {
			ok: true as const,
			hasSnapshot: true as const,
		previousContent: snapshots.get(relPath) ?? null,
	};
});

ipcMain.handle(
	'agent:seedFileSnapshot',
	(_e, payload: { threadId?: string; relPath?: string; content?: string; diff?: string }) => {
		const threadId = String(payload?.threadId ?? '');
		const relPath = String(payload?.relPath ?? '');
		const diff = normalizePatchChunk(payload?.diff ?? '');
		const currentContent = typeof payload?.content === 'string' ? payload.content : '';
		if (!threadId || !relPath || !diff) {
			return { ok: false as const, error: 'invalid-payload' as const };
		}
		const reversed = reverseUnifiedPatch(diff);
		if (!reversed) {
			return { ok: false as const, error: 'reverse-failed' as const };
		}
		const baseline = applyPatch(currentContent, reversed, { fuzzFactor: 3 });
		if (baseline === false) {
			return { ok: false as const, error: 'apply-failed' as const };
		}
		const previousContent =
			/^new file mode\s/m.test(diff) || /^---\s+\/dev\/null$/m.test(diff)
				? null
				: baseline;
		const snapshots = agentRevertSnapshotsByThread.get(threadId) ?? new Map<string, string | null>();
		snapshots.set(relPath, previousContent);
		agentRevertSnapshotsByThread.set(threadId, snapshots);
		return {
			ok: true as const,
			seeded: true as const,
			previousLength: (previousContent ?? '').length,
		};
	}
);

	ipcMain.handle(
	'agent:acceptFileHunk',
	(event, payload: { threadId?: string; relPath?: string; chunk?: string }) => {
			const wr = senderWorkspaceRoot(event);
			const threadId = String(payload?.threadId ?? '');
			const relPath = String(payload?.relPath ?? '');
			const chunk = normalizePatchChunk(payload?.chunk ?? '');
			const snapshots = agentRevertSnapshotsByThread.get(threadId);
			if (!threadId || !relPath || !chunk || !snapshots || !snapshots.has(relPath)) {
				return { ok: false as const, error: 'missing-snapshot' as const };
			}
			if (!wr) {
				return { ok: false as const, error: 'no-workspace' as const };
			}

			const previousContent = snapshots.get(relPath) ?? null;
			const baseline = previousContent ?? '';
			const nextBaseline = applyPatch(baseline, chunk, { fuzzFactor: 3 });
			if (nextBaseline === false) {
				return { ok: false as const, error: 'apply-failed' as const };
			}

			const currentContent = readWorkspaceTextFileIfExists(relPath, wr);
			if (contentsEqual(nextBaseline, currentContent)) {
				snapshots.delete(relPath);
			} else {
				snapshots.set(relPath, nextBaseline);
			}
			if (snapshots.size === 0) {
				agentRevertSnapshotsByThread.delete(threadId);
			}
			return { ok: true as const, cleared: !snapshots.has(relPath) };
		}
	);

	ipcMain.handle(
		'agent:revertFileHunk',
		(event, payload: { threadId?: string; relPath?: string; chunk?: string }) => {
			const wr = senderWorkspaceRoot(event);
			const threadId = String(payload?.threadId ?? '');
			const relPath = String(payload?.relPath ?? '');
			const chunk = normalizePatchChunk(payload?.chunk ?? '');
			const snapshots = agentRevertSnapshotsByThread.get(threadId);
			if (!threadId || !relPath || !chunk || !snapshots || !snapshots.has(relPath)) {
				return { ok: false as const, error: 'missing-snapshot' as const };
			}
			if (!wr) {
				return { ok: false as const, error: 'no-workspace' as const };
			}

			const reversed = reverseUnifiedPatch(chunk);
			if (!reversed) {
				return { ok: false as const, error: 'reverse-failed' as const };
			}

			const previousContent = snapshots.get(relPath) ?? null;
			const currentContent = readWorkspaceTextFileIfExists(relPath, wr);
			const currentText = currentContent ?? '';
			const reverted = applyPatch(currentText, reversed, { fuzzFactor: 3 });
			if (reverted === false) {
				return { ok: false as const, error: 'apply-failed' as const };
			}

			const full = resolveWorkspacePath(relPath, wr);
			if (previousContent === null && reverted === '') {
				if (fs.existsSync(full)) {
					fs.unlinkSync(full);
				}
			} else {
				fs.mkdirSync(path.dirname(full), { recursive: true });
				fs.writeFileSync(full, reverted, 'utf8');
			}

			const nextContent = readWorkspaceTextFileIfExists(relPath, wr);
			if (contentsEqual(previousContent, nextContent)) {
				snapshots.delete(relPath);
			}
			if (snapshots.size === 0) {
				agentRevertSnapshotsByThread.delete(threadId);
			}
			return { ok: true as const, cleared: !snapshots.has(relPath) };
		}
	);

	ipcMain.handle('agent:revertFile', (event, threadId: string, relPath: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'no-workspace' as const };
		}
		const snapshots = agentRevertSnapshotsByThread.get(threadId);
		if (!snapshots || !snapshots.has(relPath)) {
			return { ok: true as const, reverted: false };
		}
		const previousContent = snapshots.get(relPath)!;
		const full = resolveWorkspacePath(relPath, root);
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

	ipcMain.handle('fs:listDir', (event, relPath: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const normalized = typeof relPath === 'string' ? relPath.trim() : '';
			const full = normalized ? resolveWorkspacePath(normalized, root) : root;
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

	ipcMain.handle('shell:revealInFolder', (event, relPath: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const rel = String(relPath ?? '').trim();
			if (!rel) {
				return { ok: false as const, error: 'empty path' };
			}
			const full = resolveWorkspacePath(rel, root);
			if (!fs.existsSync(full)) {
				return { ok: false as const, error: 'not found' };
			}
			const st = fs.statSync(full);
			if (st.isDirectory()) {
				void shell.openPath(full);
			} else {
				shell.showItemInFolder(full);
			}
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:revealAbsolutePath', async (_e, rawPath: string) => {
		try {
			const target = String(rawPath ?? '').trim();
			if (!target) {
				return { ok: false as const, error: 'empty path' };
			}
			const full = path.resolve(target);
			if (!fs.existsSync(full)) {
				return { ok: false as const, error: 'not found' };
			}
			const st = fs.statSync(full);
			if (process.platform === 'win32') {
				try {
					const args = st.isDirectory() ? [full] : [`/select,${full}`];
					const child = spawn('explorer.exe', args, {
						detached: true,
						stdio: 'ignore',
						windowsHide: false,
					});
					child.unref();
					return { ok: true as const };
				} catch {
					/* fall through */
				}
			}
			if (process.platform === 'darwin' && !st.isDirectory()) {
				try {
					await execFileAsync('open', ['-R', full], { windowsHide: true });
					return { ok: true as const };
				} catch {
					/* fall through */
				}
			}
			if (st.isDirectory()) {
				const err = await shell.openPath(full);
				return err ? ({ ok: false as const, error: err } as const) : ({ ok: true as const } as const);
			}
			shell.showItemInFolder(full);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:openDefault', async (event, relPath: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			const rel = String(relPath ?? '').trim();
			if (!rel) {
				return { ok: false as const, error: 'empty path' };
			}
			let full = rel;
			if (!path.isAbsolute(full)) {
				if (!root) {
					return { ok: false as const, error: 'No workspace' };
				}
				full = resolveWorkspacePath(rel, root);
			}
			if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
				return { ok: false as const, error: 'not a file' };
			}
			const err = await shell.openPath(full);
			return err ? ({ ok: false as const, error: err } as const) : ({ ok: true as const } as const);
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('shell:openInBrowser', async (event, relPath: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const rel = String(relPath ?? '').trim();
			if (!rel) {
				return { ok: false as const, error: 'empty path' };
			}
			const full = resolveWorkspacePath(rel, root);
			if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
				return { ok: false as const, error: 'not a file' };
			}
			const ext = path.extname(full).toLowerCase();
			if (!['.html', '.htm', '.svg'].includes(ext)) {
				return { ok: false as const, error: 'unsupported type' };
			}
			await shell.openExternal(pathToFileURL(full).href);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('clipboard:writeText', (_e, text: string) => {
		try {
			clipboard.writeText(String(text ?? ''));
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('clipboard:readText', () => {
		try {
			return { ok: true as const, text: clipboard.readText() };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('fs:renameEntry', (event, relPath: string, newName: string) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const fromRel = String(relPath ?? '').trim();
			if (!fromRel) {
				return { ok: false as const, error: 'empty path' };
			}
			const fromFull = resolveWorkspacePath(fromRel, root);
			if (!fs.existsSync(fromFull)) {
				return { ok: false as const, error: 'not found' };
			}
			const base = path.basename(String(newName ?? '').trim());
			if (!base || base === '.' || base === '..' || base.includes('/') || base.includes('\\')) {
				return { ok: false as const, error: 'bad name' };
			}
			const toFull = path.join(path.dirname(fromFull), base);
			if (!isPathInsideRoot(toFull, root)) {
				return { ok: false as const, error: 'escapes workspace' };
			}
			if (fs.existsSync(toFull)) {
				return { ok: false as const, error: 'destination exists' };
			}
			fs.renameSync(fromFull, toFull);
			const newRel = path.relative(root, toFull).split(path.sep).join('/');
			return { ok: true as const, newRel };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('fs:removeEntry', (event, relPath: string, recursive?: unknown) => {
		try {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const rel = String(relPath ?? '').trim();
			if (!rel) {
				return { ok: false as const, error: 'empty path' };
			}
			const full = resolveWorkspacePath(rel, root);
			if (!fs.existsSync(full)) {
				return { ok: false as const, error: 'not found' };
			}
			const st = fs.statSync(full);
			if (st.isDirectory()) {
				if (recursive === true) {
					fs.rmSync(full, { recursive: true, force: true });
				} else {
					fs.rmdirSync(full);
				}
			} else {
				fs.unlinkSync(full);
			}
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
		}
	});

	ipcMain.handle('git:status', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return await gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const gitTop = probe.topLevel;
				const [porcelain, branch] = await Promise.all([
					gitService.gitStatusPorcelain(),
					gitService.gitBranch(),
				]);
				const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
				const rawPathStatus = gitService.parseGitPathStatus(lines);
				const rawOrdered = gitService.listPorcelainPaths(lines);
				const pathStatus: Record<string, gitService.PathStatusEntry> = {};
				for (const [repoRel, entry] of Object.entries(rawPathStatus)) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel) {
						pathStatus[wsRel] = entry;
					}
				}
				const changedPaths: string[] = [];
				const seen = new Set<string>();
				for (const repoRel of rawOrdered) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel && !seen.has(wsRel)) {
						seen.add(wsRel);
						changedPaths.push(wsRel);
					}
				}
				return { ok: true as const, branch, lines, pathStatus, changedPaths };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Failed to load changes'),
				};
			}
		});
	});

	ipcMain.handle('git:fullStatus', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return await gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const gitTop = probe.topLevel;
				const [porcelain, branchListPack] = await Promise.all([
					gitService.gitStatusPorcelain(),
					gitService.gitListLocalBranches(),
				]);
				const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
				const rawPathStatus = gitService.parseGitPathStatus(lines);
				const rawOrdered = gitService.listPorcelainPaths(lines);
				const pathStatus: Record<string, gitService.PathStatusEntry> = {};
				for (const [repoRel, entry] of Object.entries(rawPathStatus)) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel) {
						pathStatus[wsRel] = entry;
					}
				}
				const changedPaths: string[] = [];
				const seen = new Set<string>();
				for (const repoRel of rawOrdered) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel && !seen.has(wsRel)) {
						seen.add(wsRel);
						changedPaths.push(wsRel);
					}
				}
				const branch = branchListPack.current?.trim() ? branchListPack.current : 'master';
				const branches = branchListPack.branches;
				const current = branchListPack.current;
				let previews: Record<string, gitService.DiffPreview> = {};
				if (changedPaths.length > 0) {
					const fullDiffRaw = await gitService.gitDiffHeadUnified(root);
					previews = await gitService.buildDiffPreviewsMap(
						changedPaths,
						fullDiffRaw,
						root,
						gitTop,
						{ maxChars: 4_000 }
					);
				}
				return {
					ok: true as const,
					branch,
					lines,
					pathStatus,
					changedPaths,
					branches,
					current,
					previews,
				};
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Failed to load changes'),
				};
			}
		});
	});

	ipcMain.handle('git:stageAll', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				await gitService.gitStageAll();
				return { ok: true as const };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:commit', async (event, message: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				await gitService.gitCommit(message);
				return { ok: true as const };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:push', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				await gitService.gitPush();
				return { ok: true as const };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:diffPreviews', async (event, relPaths: string[]) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		const list = Array.isArray(relPaths) ? relPaths : [];
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const fullDiffRaw = await gitService.gitDiffHeadUnified(root);
				const previews = await gitService.buildDiffPreviewsMap(list, fullDiffRaw, root, probe.topLevel, { maxChars: 4_000 });
				return { ok: true as const, previews };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle(
		'git:diffPreview',
		async (event, payload: { relPath?: string; full?: boolean; maxChars?: number | null }) => {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const relPath = String(payload?.relPath ?? '').trim();
			if (!relPath) {
				return { ok: false as const, error: 'Bad path' };
			}
			try {
				const preview = await gitService.getDiffPreview(
					relPath,
					{
						maxChars: payload?.full ? null : payload?.maxChars,
					},
					root
				);
				return { ok: true as const, preview };
			} catch (e) {
				return { ok: false as const, error: String(e) };
			}
		}
	);

	ipcMain.handle('git:listBranches', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return await gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const { branches, current } = await gitService.gitListLocalBranches();
				return { ok: true as const, branches, current };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Could not load branches'),
				};
			}
		});
	});

	ipcMain.handle('git:checkoutBranch', async (event, branch: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				await gitService.gitSwitchBranch(typeof branch === 'string' ? branch : '');
				return { ok: true as const };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Could not switch branch'),
				};
			}
		});
	});

	ipcMain.handle('git:createBranch', async (event, name: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				await gitService.gitCreateBranchAndSwitch(typeof name === 'string' ? name : '');
				return { ok: true as const };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Could not create branch'),
				};
			}
		});
	});

	ipcMain.handle(
		'plan:save',
		(event, payload: { filename: string; content: string }) => {
			try {
				const safe = String(payload.filename ?? 'plan.md')
					.replace(/[<>:"/\\|?*]/g, '_')
					.slice(0, 120);
				const content = String(payload.content ?? '');
				const wsRoot = senderWorkspaceRoot(event);
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

	ipcMain.handle('terminal:execLine', async (event, line: string) => {
		const root = senderWorkspaceRoot(event);
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
	ipcMain.handle('mcp:getStatuses', (event) => {
		const manager = getMcpManager();
		manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
		return { ok: true as const, statuses: manager.getServerStatuses() };
	});

	/** 添加或更新 MCP 服务器配置 */
	ipcMain.handle('mcp:saveServer', (event, config: McpServerConfig) => {
		try {
			patchMcpServerConfigs([config]);
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			return { ok: true as const, server: config };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 删除 MCP 服务器配置 */
	ipcMain.handle('mcp:deleteServer', (event, id: string) => {
		try {
			removeMcpServerConfig(id);
			const manager = getMcpManager();
			manager.removeServer(id);
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 启动 MCP 服务器 */
	ipcMain.handle('mcp:startServer', async (event, id: string) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
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
	ipcMain.handle('mcp:restartServer', async (event, id: string) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			await manager.restartServer(id);
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 启动所有已启用的 MCP 服务器 */
	ipcMain.handle('mcp:startAll', async (event) => {
		try {
			const manager = getMcpManager();
			manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
			await manager.startAll();
			return { ok: true as const };
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	/** 获取 MCP 工具列表（供 Agent 使用） */
	ipcMain.handle('mcp:getTools', (event) => {
		const manager = getMcpManager();
		manager.loadConfigs(getEffectiveMcpServerConfigs(getMcpServerConfigs(), senderWorkspaceRoot(event)));
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

	/** 自动更新：检查更新 */
	ipcMain.handle('auto-update:check', async (): Promise<AutoUpdateStatus> => {
		try {
			return await checkForUpdates();
		} catch (e) {
			return { state: 'error', message: String(e) };
		}
	});

	/** 自动更新：下载更新 */
	ipcMain.handle('auto-update:download', async (): Promise<{ ok: boolean; error?: string }> => {
		try {
			await downloadUpdate();
			return { ok: true };
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	});

	/** 自动更新：重启并安装 */
	ipcMain.handle('auto-update:install', (): Promise<{ ok: boolean; error?: string }> => {
		try {
			quitAndInstall();
			return Promise.resolve({ ok: true });
		} catch (e) {
			return Promise.resolve({ ok: false, error: String(e) });
		}
	});

	/** 自动更新：获取当前状态 */
	ipcMain.handle('auto-update:get-status', (): AutoUpdateStatus => {
		return getStatus();
	});
}
