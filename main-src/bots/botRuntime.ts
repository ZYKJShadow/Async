import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentToolDef, ToolCall, ToolResult } from '../agent/agentTools.js';
import { runAgentLoop } from '../agent/agentLoop.js';
import { compressForSend } from '../agent/conversationCompress.js';
import { type ToolExecutionContext, type ToolExecutionHooks } from '../agent/toolExecutor.js';
import { runTeamSession } from '../agent/teamOrchestrator.js';
import type { BotComposerMode, BotIntegrationConfig } from '../botSettingsTypes.js';
import { getGitContextBlock } from '../gitContext.js';
import { streamChatUnified } from '../llm/llmRouter.js';
import { buildAgentGlobalRuleAppend, prepareUserTurnForChat } from '../llm/agentMessagePrep.js';
import { formatLlmSdkError } from '../llm/formatLlmSdkError.js';
import { resolveModelRequest, resolveThinkingLevelForSelection } from '../llm/modelResolve.js';
import { buildWorkspaceTreeSummary, cloneMessagesWithExpandedLastUser, modeExpandsWorkspaceFileContext } from '../llm/workspaceContextExpand.js';
import type { ComposerMode } from '../llm/composerMode.js';
import { buildRelevantMemoryContextBlock } from '../memdir/findRelevantMemories.js';
import { loadMemoryPrompt } from '../memdir/memdir.js';
import { type ShellSettings, getRecentWorkspaces } from '../settingsStore.js';
import { queueExtractMemories } from '../services/extractMemories/extractMemories.js';
import {
	appendMessage,
	accumulateTokenUsage,
	createThread,
	getThread,
	incrementThreadAgentToolCallCount,
	saveSummary,
	saveTeamSession,
	touchFileInThread,
	updateLastAssistant,
	type ChatMessage,
} from '../threadStore.js';
import { ensureWorkspaceFileIndex } from '../workspaceFileIndex.js';
import { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import { mergeAgentWithProjectSlice, readWorkspaceAgentProjectSlice } from '../workspaceAgentStore.js';
import { resolveToolPermissionFromRules } from '../agent/toolPermissionModel.js';
import { isSafeShellCommandForAutoApprove } from '../agent/toolApprovalGate.js';
import { getShellPermissionMode } from '../../src/shellPermissionMode.js';

export type BotInboundMessage = {
	conversationKey: string;
	text: string;
	senderId?: string;
	senderName?: string;
};

export type BotSessionState = {
	integrationId: string;
	conversationKey: string;
	workspaceRoot: string | null;
	modelId: string;
	mode: BotComposerMode;
	threadIdsByWorkspace: Record<string, string>;
	lastUserId?: string;
	lastUserName?: string;
};

export type BotAvailableModel = {
	id: string;
	label: string;
	paradigm: 'openai-compatible' | 'anthropic';
};

function appendSystemBlock(base: string | undefined, block: string): string {
	const trimmed = block.trim();
	if (!trimmed) {
		return base ?? '';
	}
	return base && base.trim() ? `${base}\n\n---\n${trimmed}` : trimmed;
}

function buildEnrichedQuery(userText: string, threadMessages: ChatMessage[]): string {
	const recentUserTexts = threadMessages
		.filter((m) => m.role === 'user')
		.slice(-3)
		.map((m) => m.content.slice(0, 200))
		.join(' ');
	return `${userText} ${recentUserTexts}`.slice(0, 1000);
}

async function appendMemoryAndRetrievalContext(params: {
	base: string | undefined;
	mode: ComposerMode;
	settings: ShellSettings;
	root: string | null;
	threadId: string;
	userText: string;
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

function normalizeWorkspaceRoot(value: string | null | undefined): string | null {
	if (!value || !String(value).trim()) {
		return null;
	}
	try {
		return path.resolve(String(value).trim());
	} catch {
		return null;
	}
}

function normalizeWorkspaceKey(root: string | null | undefined): string {
	return (normalizeWorkspaceRoot(root) ?? '__global__').replace(/\\/g, '/').toLowerCase();
}

function resolveBotHostWebContentsId(): number | null {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && !focused.isDestroyed()) {
		return focused.webContents.id;
	}
	const fallback = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
	return fallback?.webContents.id ?? null;
}

function collectAvailableWorkspaceRoots(integration: BotIntegrationConfig): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of [integration.defaultWorkspaceRoot, ...(integration.workspaceRoots ?? []), ...getRecentWorkspaces()]) {
		const normalized = normalizeWorkspaceRoot(raw);
		if (!normalized) {
			continue;
		}
		if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
			continue;
		}
		const key = normalizeWorkspaceKey(normalized);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(normalized);
	}
	return out;
}

export function getAvailableBotModels(settings: ShellSettings): BotAvailableModel[] {
	const providerById = new Map((settings.models?.providers ?? []).map((item) => [item.id, item]));
	const enabledIds = new Set(settings.models?.enabledIds ?? []);
	const rawEntries = settings.models?.entries ?? [];
	const entries = enabledIds.size > 0 ? rawEntries.filter((item) => enabledIds.has(item.id)) : rawEntries;
	return entries
		.map((entry) => {
			const provider = providerById.get(entry.providerId);
			const paradigm = provider?.paradigm;
			if (paradigm !== 'openai-compatible' && paradigm !== 'anthropic') {
				return null;
			}
			return {
				id: entry.id,
				label: entry.displayName.trim() || entry.requestName || entry.id,
				paradigm,
			} satisfies BotAvailableModel;
		})
		.filter((item): item is BotAvailableModel => item != null);
}

export function createInitialBotSession(
	integration: BotIntegrationConfig,
	settings: ShellSettings,
	conversationKey: string,
	senderId?: string,
	senderName?: string
): BotSessionState {
	const models = getAvailableBotModels(settings);
	const modelId =
		(integration.defaultModelId && models.some((item) => item.id === integration.defaultModelId)
			? integration.defaultModelId
			: null) ??
		(settings.defaultModel && models.some((item) => item.id === settings.defaultModel)
			? settings.defaultModel
			: null) ??
		models[0]?.id ??
		'';
	const workspaces = collectAvailableWorkspaceRoots(integration);
	const defaultWorkspace = normalizeWorkspaceRoot(integration.defaultWorkspaceRoot);
	const workspaceRoot =
		(defaultWorkspace &&
		workspaces.some((item) => normalizeWorkspaceKey(item) === normalizeWorkspaceKey(defaultWorkspace))
			? defaultWorkspace
			: null) ??
		workspaces[0] ??
		null;
	return {
		integrationId: integration.id,
		conversationKey,
		workspaceRoot,
		modelId,
		mode: 'agent' as BotComposerMode,
		threadIdsByWorkspace: {},
		lastUserId: senderId,
		lastUserName: senderName,
	};
}

type RunBotOrchestratorArgs = {
	settings: ShellSettings;
	integration: BotIntegrationConfig;
	session: BotSessionState;
	inbound: BotInboundMessage;
	workspaceLspManager: WorkspaceLspManager;
	signal: AbortSignal;
	onStreamDelta?: (fullText: string) => void;
	onToolStatus?: (name: string, state: 'running' | 'completed' | 'error') => void;
};

type RunBotAsyncTaskArgs = {
	settings: ShellSettings;
	integration: BotIntegrationConfig;
	session: BotSessionState;
	task: string;
	workspaceLspManager: WorkspaceLspManager;
	signal: AbortSignal;
	onInnerTextDelta?: (fullText: string) => void;
	onInnerToolStatus?: (name: string, state: 'running' | 'completed' | 'error') => void;
};

const BOT_TOOL_DEFS: AgentToolDef[] = [
	{
		name: 'get_async_session',
		description: 'Get the current bot session context, including active workspace, model, and available switch targets.',
		parameters: { type: 'object', properties: {}, required: [] },
	},
	{
		name: 'switch_workspace',
		description: 'Switch the active Async workspace for this conversation. Use a value returned by get_async_session.availableWorkspaces.',
		parameters: {
			type: 'object',
			properties: {
				workspace: { type: 'string', description: 'Absolute workspace path, or "none" to clear the current workspace.' },
			},
			required: ['workspace'],
		},
	},
	{
		name: 'switch_model',
		description: 'Switch the active Async model for this conversation. Use a model id returned by get_async_session.availableModels.',
		parameters: {
			type: 'object',
			properties: {
				model_id: { type: 'string', description: 'Configured model id.' },
			},
			required: ['model_id'],
		},
	},
	{
		name: 'new_async_thread',
		description: 'Start a new Async thread in the current workspace while keeping the current workspace, model, and mode.',
		parameters: {
			type: 'object',
			properties: {
				reason: { type: 'string', description: 'Optional short note about why a new thread is being started.' },
			},
			required: [],
		},
	},
	{
		name: 'run_async_task',
		description:
			'Run the actual Async task in the current workspace/model/mode using the same capabilities as the desktop app, then return the result.',
		parameters: {
			type: 'object',
			properties: {
				task: { type: 'string', description: 'The task or user request to execute.' },
			},
			required: ['task'],
		},
	},
];


function renderSessionSnapshot(
	settings: ShellSettings,
	integration: BotIntegrationConfig,
	session: BotSessionState
): string {
	const models = getAvailableBotModels(settings);
	const workspaces = collectAvailableWorkspaceRoots(integration);
	return JSON.stringify(
		{
			integration: {
				id: integration.id,
				name: integration.name || integration.platform,
				platform: integration.platform,
			},
			current: {
				workspaceRoot: session.workspaceRoot,
				modelId: session.modelId,
				mode: session.mode,
			},
			availableModels: models,
			availableWorkspaces: workspaces,
		},
		null,
		2
	);
}

export function buildBotOrchestratorPrompt(
	settings: ShellSettings,
	integration: BotIntegrationConfig,
	session: BotSessionState,
	inbound: BotInboundMessage
): string {
	const language = settings.language === 'en' ? 'en' : 'zh-CN';
	const sessionBlock = renderSessionSnapshot(settings, integration, session);
	const userName = inbound.senderName?.trim() || inbound.senderId?.trim() || 'user';
	const extraPrompt = integration.systemPrompt?.trim();
	const globalRuleAppend = buildAgentGlobalRuleAppend(settings.agent, language);
	const lines = [
		language === 'en'
			? 'You are the Async bot bridge. You orchestrate the user conversation by switching Async session state and then calling run_async_task.'
			: '你是 Async 机器人桥接层。你的职责是先切换 Async 会话状态，再调用 run_async_task 执行真正的工作。',
		language === 'en'
			? 'Only the custom bot tools are available in this loop. Do not pretend to have already executed Async work unless run_async_task returned it.'
			: '当前循环里只有机器人会话工具。没有调用 run_async_task 之前，不要假装已经执行了 Async 内部任务。',
		language === 'en'
			? 'When the user wants a different workspace or model, call the matching switch tool first. If the user asks to reset context, call new_async_thread.'
			: '当用户要求切换工作区或模型时，先调用对应的 switch 工具；如果用户要求开启新话题或清空上下文，调用 new_async_thread。',
		language === 'en'
			? 'After changing session state, call run_async_task in the same turn whenever the user also expects actual execution or an answer from Async.'
			: '切换完会话状态后，只要用户还期待 Async 继续执行任务或给出结果，就在同一轮里调用 run_async_task。',
		language === 'en'
			? `Current bot user: ${userName}`
			: `当前外部用户：${userName}`,
		'',
		'## Async Session',
		sessionBlock,
	];
	if (extraPrompt) {
		lines.push('', '## Integration Prompt', extraPrompt);
	}
	if (globalRuleAppend.trim()) {
		lines.push(
			'',
			language === 'en' ? '## Global Reply Rules' : '## 全局回复规则',
			language === 'en'
				? 'Follow these rules whenever you produce user-visible text, including short confirmations and direct replies.'
				: '只要你输出任何面向用户的文本，包括简短确认和直接回复，也必须遵守以下规则。',
			'',
			globalRuleAppend
		);
	}
	return lines.join('\n');
}

function resolveSessionWorkspace(
	integration: BotIntegrationConfig,
	session: BotSessionState,
	requested: string
): { ok: true; workspaceRoot: string | null } | { ok: false; error: string } {
	const raw = requested.trim();
	if (!raw || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'null') {
		session.workspaceRoot = null;
		return { ok: true, workspaceRoot: null };
	}
	const available = collectAvailableWorkspaceRoots(integration);
	const normalized = normalizeWorkspaceRoot(raw);
	if (!normalized) {
		return { ok: false, error: '工作区路径无效。' };
	}
	const match = available.find((item) => normalizeWorkspaceKey(item) === normalizeWorkspaceKey(normalized));
	if (!match) {
		return { ok: false, error: '目标工作区不在当前机器人可访问列表中。' };
	}
	session.workspaceRoot = match;
	return { ok: true, workspaceRoot: match };
}

function createHeadlessBeforeExecuteTool(settings: ShellSettings) {
	return async (call: ToolCall) => {
		const agent = settings.agent;
		const permission = resolveToolPermissionFromRules(call, agent, { avoidPermissionPrompts: true });
		if (permission === 'deny') {
			return { proceed: false as const, rejectionMessage: '工具调用被当前权限规则拒绝。' };
		}

		if (call.name === 'Bash') {
			const mode = getShellPermissionMode(agent);
			const command = String(call.arguments.command ?? '').trim();
			if (permission === 'allow') {
				return mode === 'ask_every_time'
					? { proceed: false as const, rejectionMessage: '当前机器人会话无法处理 shell 执行确认。' }
					: { proceed: true as const };
			}
			if (mode === 'always') {
				return { proceed: true as const };
			}
			if (mode === 'rules' && isSafeShellCommandForAutoApprove(command)) {
				return { proceed: true as const };
			}
			return { proceed: false as const, rejectionMessage: '当前机器人会话不会弹出 shell 执行确认，请在桌面端放宽权限后重试。' };
		}

		if (call.name === 'Write' || call.name === 'Edit') {
			if (permission === 'allow' || settings.agent?.confirmWritesBeforeExecute !== true) {
				return { proceed: true as const };
			}
			return { proceed: false as const, rejectionMessage: '当前机器人会话不会弹出写入确认，请关闭写入确认或改在桌面端执行。' };
		}

		return { proceed: true as const };
	};
}

function ensureThreadForSession(session: BotSessionState): string {
	const key = normalizeWorkspaceKey(session.workspaceRoot);
	const existing = session.threadIdsByWorkspace[key];
	if (existing && getThread(existing)) {
		return existing;
	}
	const created = createThread(session.workspaceRoot, { select: false });
	session.threadIdsByWorkspace[key] = created.id;
	return created.id;
}

async function runBotAsyncTask(args: RunBotAsyncTaskArgs): Promise<string> {
	const { settings, integration, session, task, workspaceLspManager, signal } = args;
	const threadId = ensureThreadForSession(session);
	const hostWebContentsId = resolveBotHostWebContentsId();
	const mode = session.mode;
	const modelSelection = session.modelId.trim();
	if (!modelSelection) {
		throw new Error('当前机器人会话没有可用的模型。请先在设置里为该机器人配置可用模型。');
	}
	const resolved = resolveModelRequest(settings, modelSelection);
	if (!resolved.ok) {
		throw new Error(resolved.message);
	}

	const effectiveSettings: ShellSettings = {
		...settings,
		team: {
			...(settings.team ?? {}),
			requirePlanApproval: false,
		},
	};

	let workspaceFiles: string[] = [];
	if (session.workspaceRoot) {
		try {
			workspaceFiles = await ensureWorkspaceFileIndex(session.workspaceRoot, signal);
		} catch {
			workspaceFiles = [];
		}
	}

	const projectAgent = readWorkspaceAgentProjectSlice(session.workspaceRoot);
	const agentForTurn = mergeAgentWithProjectSlice(effectiveSettings.agent, projectAgent);
	const uiLanguage = effectiveSettings.language === 'en' ? 'en' : 'zh-CN';
	const prepared = prepareUserTurnForChat(task, agentForTurn, session.workspaceRoot, workspaceFiles, uiLanguage);
	let finalSystemAppend = prepared.agentSystemAppend;
	if (session.workspaceRoot && (mode === 'plan' || mode === 'ask' || mode === 'team')) {
		const wsLine = `## Current workspace\nWorkspace root (absolute): \`${session.workspaceRoot.replace(/\\/g, '/')}\`\nUser file references with \`@\` are relative to this root.`;
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
		settings: effectiveSettings,
		root: session.workspaceRoot,
		threadId,
		userText: prepared.userText,
		modelSelection,
		signal,
	});

	const updatedThread = appendMessage(threadId, { role: 'user', content: prepared.userText });
	const thinkingLevel = resolveThinkingLevelForSelection(effectiveSettings, modelSelection);
	const thread = getThread(threadId);
	const compressResult = await compressForSend(
		updatedThread.messages,
		effectiveSettings,
		{
			mode,
			signal,
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			maxOutputTokens: resolved.maxOutputTokens,
			...(resolved.contextWindowTokens != null ? { contextWindowTokens: resolved.contextWindowTokens } : {}),
			thinkingLevel,
		},
		thread?.summary,
		thread?.summaryCoversMessageCount
	);
	let sendMessages = compressResult.messages;
	if (compressResult.newSummary && compressResult.newSummaryCoversCount !== undefined) {
		saveSummary(threadId, compressResult.newSummary, compressResult.newSummaryCoversCount);
	}

	const finish = (full: string, usage?: { inputTokens?: number; outputTokens?: number }) => {
		updateLastAssistant(threadId, full);
		accumulateTokenUsage(threadId, usage?.inputTokens, usage?.outputTokens);
		queueExtractMemories({
			threadId,
			workspaceRoot: session.workspaceRoot,
			settings: effectiveSettings,
			modelSelection,
		});
	};

	if (mode === 'team') {
		return await new Promise<string>(async (resolve, reject) => {
			try {
				await runTeamSession({
					settings: effectiveSettings,
					threadId,
					messages: sendMessages,
					modelSelection,
					resolvedModel: resolved,
					agentSystemAppend: finalSystemAppend,
					signal,
					thinkingLevel,
					workspaceRoot: session.workspaceRoot,
					workspaceLspManager,
					emit: () => {},
					onDone: (full, usage, teamSnapshot) => {
						finish(full, usage);
						if (teamSnapshot) {
							saveTeamSession(threadId, teamSnapshot);
						}
						resolve(full);
					},
					onError: (message) => reject(new Error(message)),
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	if ((mode === 'agent' || mode === 'plan') && resolved.paradigm !== 'gemini') {
		const messagesForAgent = modeExpandsWorkspaceFileContext(mode)
			? cloneMessagesWithExpandedLastUser(sendMessages, session.workspaceRoot)
			: sendMessages;
		let innerStreamFull = '';
		return await new Promise<string>(async (resolve, reject) => {
			try {
				await runAgentLoop(
					effectiveSettings,
					messagesForAgent,
					{
						modelSelection,
						requestModelId: resolved.requestModelId,
						paradigm: resolved.paradigm,
						requestApiKey: resolved.apiKey,
						requestBaseURL: resolved.baseURL,
						requestProxyUrl: resolved.proxyUrl,
						maxOutputTokens: resolved.maxOutputTokens,
						signal,
						composerMode: mode,
						thinkingLevel,
						beforeExecuteTool: createHeadlessBeforeExecuteTool(effectiveSettings),
						maxConsecutiveMistakes: effectiveSettings.agent?.maxConsecutiveMistakes,
						mistakeLimitEnabled: effectiveSettings.agent?.mistakeLimitEnabled,
						workspaceRoot: session.workspaceRoot,
						workspaceLspManager,
						threadId,
						hostWebContentsId,
						toolHooks: {
							beforeWrite: ({ path: relPath, previousContent }) => {
								touchFileInThread(
									threadId,
									relPath,
									previousContent === null ? 'created' : 'modified',
									previousContent === null
								);
							},
						},
						...(finalSystemAppend?.trim() ? { agentSystemAppend: finalSystemAppend.trim() } : {}),
					},
					{
						onTextDelta: (text) => {
							innerStreamFull += text;
							args.onInnerTextDelta?.(innerStreamFull);
						},
						onToolCall: (name) => {
							args.onInnerToolStatus?.(name, 'running');
						},
						onToolResult: (name, _result, success) => {
							incrementThreadAgentToolCallCount(threadId);
							args.onInnerToolStatus?.(name, success ? 'completed' : 'error');
						},
						onDone: (full, usage) => {
							finish(full, usage);
							resolve(full);
						},
						onError: (message) => reject(new Error(message)),
					}
				);
			} catch (error) {
				reject(error);
			}
		});
	}

	let askStreamFull = '';
	return await new Promise<string>(async (resolve, reject) => {
		try {
			await streamChatUnified(
				effectiveSettings,
				sendMessages,
				{
					mode,
					signal,
					requestModelId: resolved.requestModelId,
					paradigm: resolved.paradigm,
					requestApiKey: resolved.apiKey,
					requestBaseURL: resolved.baseURL,
					requestProxyUrl: resolved.proxyUrl,
					maxOutputTokens: resolved.maxOutputTokens,
					thinkingLevel,
					workspaceRoot: session.workspaceRoot,
					...(finalSystemAppend?.trim() ? { agentSystemAppend: finalSystemAppend.trim() } : {}),
				},
				{
					onDelta: (text) => {
							askStreamFull += text;
							args.onInnerTextDelta?.(askStreamFull);
						},
					onThinkingDelta: () => {},
					onDone: (full, usage) => {
						finish(full, usage);
						resolve(full);
					},
					onError: (message) => reject(new Error(message)),
				}
			);
		} catch (error) {
			reject(error);
		}
	});
}

export async function runBotOrchestratorTurn(args: RunBotOrchestratorArgs): Promise<string> {
	const { settings, integration, session, inbound, workspaceLspManager, signal } = args;
	session.lastUserId = inbound.senderId;
	session.lastUserName = inbound.senderName;
	if (!session.modelId.trim()) {
		throw new Error('当前没有可用于机器人会话的模型。请先在设置里配置 OpenAI 兼容或 Anthropic 模型。');
	}
	const resolved = resolveModelRequest(settings, session.modelId.trim());
	if (!resolved.ok) {
		throw new Error(resolved.message);
	}
	if (resolved.paradigm === 'gemini') {
		throw new Error('当前机器人桥接层需要支持工具调用的模型。请为机器人切换到 OpenAI 兼容或 Anthropic 模型。');
	}

	const handlers: Record<
		string,
		(call: ToolCall, _hooks: ToolExecutionHooks, _execCtx: ToolExecutionContext) => Promise<ToolResult>
	> = {
		get_async_session: async (call) => ({
			toolCallId: call.id,
			name: call.name,
			content: renderSessionSnapshot(settings, integration, session),
			isError: false,
		}),
		switch_workspace: async (call) => {
			const requested = String(call.arguments.workspace ?? '').trim();
			const resolvedWorkspace = resolveSessionWorkspace(integration, session, requested);
			return resolvedWorkspace.ok
				? {
						toolCallId: call.id,
						name: call.name,
						content: resolvedWorkspace.workspaceRoot
							? `已切换到工作区：${resolvedWorkspace.workspaceRoot}`
							: '已清空当前工作区上下文。',
						isError: false,
				  }
				: {
						toolCallId: call.id,
						name: call.name,
						content: resolvedWorkspace.error,
						isError: true,
				  };
		},
		switch_model: async (call) => {
			const requested = String(call.arguments.model_id ?? '').trim();
			const model = getAvailableBotModels(settings).find((item) => item.id === requested);
			if (!model) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: '目标模型不存在，或当前不支持 bot 工具调用。',
					isError: true,
				};
			}
			session.modelId = model.id;
			return {
				toolCallId: call.id,
				name: call.name,
				content: `已切换模型：${model.label} (${model.id})`,
				isError: false,
			};
		},
		new_async_thread: async (call) => {
			const created = createThread(session.workspaceRoot, { select: false });
			session.threadIdsByWorkspace[normalizeWorkspaceKey(session.workspaceRoot)] = created.id;
			const reason = String(call.arguments.reason ?? '').trim();
			return {
				toolCallId: call.id,
				name: call.name,
				content: reason
					? `已创建新线程：${created.id}。原因：${reason}`
					: `已创建新线程：${created.id}`,
				isError: false,
			};
		},
		run_async_task: async (call) => {
			const task = String(call.arguments.task ?? '').trim();
			if (!task) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: 'task 不能为空。',
					isError: true,
				};
			}
			try {
				const result = await runBotAsyncTask({
					settings,
					integration,
					session,
					task,
					workspaceLspManager,
					signal,
					onInnerTextDelta: args.onStreamDelta,
					onInnerToolStatus: args.onToolStatus,
				});
				return {
					toolCallId: call.id,
					name: call.name,
					content: [
						`workspace=${session.workspaceRoot ?? '(none)'}`,
						`mode=${session.mode}`,
						`model=${session.modelId}`,
						'',
						result,
					].join('\n'),
					isError: false,
				};
			} catch (error) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: error instanceof Error ? error.message : String(error),
					isError: true,
				};
			}
		},
	};

	const thinkingLevel = resolveThinkingLevelForSelection(settings, session.modelId.trim());
	const systemAppend = buildBotOrchestratorPrompt(settings, integration, session, inbound);
	let full = '';
	let errorMessage = '';

	try {
		await runAgentLoop(
			settings,
			[{ role: 'user', content: inbound.text }],
			{
				modelSelection: session.modelId.trim(),
				requestModelId: resolved.requestModelId,
				paradigm: resolved.paradigm,
				requestApiKey: resolved.apiKey,
				requestBaseURL: resolved.baseURL,
				requestProxyUrl: resolved.proxyUrl,
				maxOutputTokens: resolved.maxOutputTokens,
				signal,
				composerMode: 'agent',
				thinkingLevel,
				workspaceRoot: session.workspaceRoot,
				workspaceLspManager,
				toolPoolOverride: BOT_TOOL_DEFS,
				customToolHandlers: handlers,
				agentSystemAppend: systemAppend,
				beforeExecuteTool: async () => ({ proceed: true }),
				mistakeLimitEnabled: false,
			},
			{
				onTextDelta: (text) => {
					full += text;
				},
				onToolCall: () => {},
				onToolResult: () => {},
				onDone: (text) => {
					full = text;
				},
				onError: (message) => {
					errorMessage = message;
				},
			}
		);
	} catch (error) {
		errorMessage = formatLlmSdkError(error);
	}

	if (errorMessage) {
		throw new Error(errorMessage);
	}
	return full.trim();
}

export function createBotWorkspaceLspManager(getSettings: () => ShellSettings): WorkspaceLspManager {
	return new WorkspaceLspManager(getSettings, () => app.getAppPath());
}
