import { app, BrowserWindow, webContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AGENT_TOOLS, type AgentToolDef, ToolCall, ToolResult } from '../agent/agentTools.js';
import type { BotInboundAttachment, BotStreamChannel } from './platforms/common.js';
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
import type { BotTodoListItem } from './platforms/common.js';
import {
	awaitBrowserCommandResult,
	closeBrowserWindowForHostId,
} from '../browser/browserController.js';

export type BotInboundMessage = {
	conversationKey: string;
	text: string;
	senderId?: string;
	senderName?: string;
	attachments?: BotInboundAttachment[];
};

export type BotSessionState = {
	integrationId: string;
	conversationKey: string;
	workspaceRoot: string | null;
	modelId: string;
	mode: BotComposerMode;
	threadIdsByWorkspace: Record<string, string>;
	leaderMessages: ChatMessage[];
	leaderSummary?: string;
	leaderSummaryCoversCount?: number;
	lastUserId?: string;
	lastUserName?: string;
	browserHostWebContentsId?: number | null;
	pendingQrLogin?: BotPendingQrLoginState;
};

export type BotPendingQrLoginState = {
	requestedAt: number;
	hostWebContentsId: number;
	screenshotPath: string;
	tabId?: string;
	pageUrl?: string;
	replyText: string;
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

let headlessBotWindow: BrowserWindow | null = null;

function getOrCreateHeadlessBotWindow(): BrowserWindow | null {
	if (headlessBotWindow && !headlessBotWindow.isDestroyed()) {
		return headlessBotWindow;
	}
	try {
		headlessBotWindow = new BrowserWindow({
			show: false,
			width: 1280,
			height: 800,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				offscreen: false,
			},
		});
		headlessBotWindow.on('closed', () => {
			headlessBotWindow = null;
		});
		void headlessBotWindow.loadURL('about:blank').catch(() => {});
		return headlessBotWindow;
	} catch (error) {
		console.warn('[bots] headless host window create failed', error instanceof Error ? error.message : error);
		return null;
	}
}

function resolveBotHostWebContentsId(): number | null {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && !focused.isDestroyed()) {
		return focused.webContents.id;
	}
	const fallback = BrowserWindow.getAllWindows().find(
		(win) => !win.isDestroyed() && win !== headlessBotWindow
	);
	if (fallback) {
		return fallback.webContents.id;
	}
	const headless = getOrCreateHeadlessBotWindow();
	return headless?.webContents.id ?? null;
}

function isLiveWebContentsId(id: number | null | undefined): id is number {
	if (!Number.isInteger(id) || Number(id) <= 0) {
		return false;
	}
	try {
		const contents = webContents.fromId(Number(id));
		return Boolean(contents && !contents.isDestroyed());
	} catch {
		return false;
	}
}

function resolveSessionBotHostWebContentsId(session: BotSessionState): number | null {
	if (isLiveWebContentsId(session.browserHostWebContentsId)) {
		return session.browserHostWebContentsId;
	}
	if (session.browserHostWebContentsId != null) {
		session.browserHostWebContentsId = null;
	}
	if (isLiveWebContentsId(session.pendingQrLogin?.hostWebContentsId)) {
		const pendingId = Number(session.pendingQrLogin?.hostWebContentsId);
		session.browserHostWebContentsId = pendingId;
		return pendingId;
	}
	return resolveBotHostWebContentsId();
}

function parsePngDataUrl(dataUrl: string): Buffer {
	const match = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl ?? '').trim());
	if (!match?.[1]) {
		throw new Error('浏览器截图未返回 PNG 数据。');
	}
	return Buffer.from(match[1], 'base64');
}

function buildBotBrowserAttachmentDir(session: BotSessionState): string {
	if (session.workspaceRoot) {
		return path.join(session.workspaceRoot, '.async', 'bot-attachments');
	}
	return path.join(app.getPath('userData'), 'async', 'bot-attachments');
}

function buildBotBrowserScreenshotPath(session: BotSessionState, prefix: string): string {
	const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}.png`;
	return path.join(buildBotBrowserAttachmentDir(session), fileName);
}

async function captureBrowserScreenshotForBot(params: {
	hostWebContentsId: number;
	session: BotSessionState;
	tabId?: string;
	timeoutMs?: number;
}): Promise<{
	path: string;
	pageUrl: string;
	title: string;
	width: number;
	height: number;
}> {
	const timeoutMs = Math.max(3_000, Math.min(60_000, Math.floor(params.timeoutMs ?? 25_000)));
	const result = await awaitBrowserCommandResult(
		params.hostWebContentsId,
		{
			commandId: `bot-browser-shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			type: 'screenshotPage',
			tabId: params.tabId,
			waitForLoad: true,
		},
		timeoutMs
	);
	if (!result.ok) {
		throw new Error(result.error || '浏览器截图失败。');
	}
	const payload =
		result.result && typeof result.result === 'object' ? (result.result as Record<string, unknown>) : {};
	const png = parsePngDataUrl(String(payload.dataUrl ?? ''));
	const outputPath = buildBotBrowserScreenshotPath(params.session, 'qr-login');
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, png);
	return {
		path: outputPath,
		pageUrl: String(payload.url ?? ''),
		title: String(payload.title ?? ''),
		width: Number(payload.width ?? 0) || 0,
		height: Number(payload.height ?? 0) || 0,
	};
}

const QR_LOGIN_CONFIRM_PATTERNS = [
	/\b(?:logged\s*in|login\s*(?:done|complete|completed|ok)|qr\s*(?:done|complete|completed))\b/i,
	/(已登录|登录完成|登录好了|我已登录|已经登录|扫码完成|扫码好了|我已扫码|已经扫码|扫好了|扫完了)/,
];

const QR_LOGIN_RESEND_PATTERNS = [
	/\b(?:qr|code|resend|send again|show again)\b/i,
	/(二维码|再发|重发|重新发|看不到|发一下|再来一张)/,
];

export function looksLikeQrLoginConfirmation(text: string): boolean {
	const trimmed = String(text ?? '').trim();
	if (!trimmed) {
		return false;
	}
	return QR_LOGIN_CONFIRM_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function looksLikeQrLoginScreenshotResendRequest(text: string): boolean {
	const trimmed = String(text ?? '').trim();
	if (!trimmed) {
		return false;
	}
	return QR_LOGIN_RESEND_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function defaultQrLoginReplyText(language: ShellSettings['language']): string {
	return language === 'en'
		? 'The QR login page has been sent. Please scan it with your phone, then reply "logged in" here and I will continue.'
		: '二维码登录页面已经发给你了，请用手机扫码登录；完成后在这里回复“已登录”，我会继续执行。';
}

export function buildQrLoginResumeUserTurn(
	pending: BotPendingQrLoginState,
	userText: string,
	language: ShellSettings['language']
): string {
	const followup = String(userText ?? '').trim() || (language === 'en' ? 'logged in' : '已登录');
	const lines =
		language === 'en'
			? [
					'[System] QR login was previously paused for manual user confirmation.',
					`Screenshot path: ${pending.screenshotPath}`,
					pending.pageUrl ? `Last page URL: ${pending.pageUrl}` : '',
					'The user has now confirmed the QR login step is complete. Continue from the existing browser session instead of reopening the login page.',
			  ]
			: [
					'[系统] 之前已经因为二维码登录而暂停。',
					`截图路径：${pending.screenshotPath}`,
					pending.pageUrl ? `上次页面 URL：${pending.pageUrl}` : '',
					'用户现在已经确认二维码登录完成。请继续使用现有浏览器会话，不要重新打开登录页。',
			  ];
	return `${lines.filter(Boolean).join('\n')}\n\n[User follow-up]\n${followup}`;
}

function trimBotLeaderMessages(messages: ChatMessage[], maxMessages = 24): ChatMessage[] {
	if (messages.length <= maxMessages) {
		return messages;
	}
	return messages.slice(messages.length - maxMessages);
}

function buildUserTurnContentWithAttachments(inbound: BotInboundMessage): string {
	const attachments = inbound.attachments ?? [];
	const baseText = inbound.text ?? '';
	if (attachments.length === 0) {
		return baseText;
	}
	const descriptions = attachments
		.map((att) => {
			const label = att.kind === 'image' ? 'image' : 'file';
			const name = att.name ? ` (${att.name})` : '';
			return `- ${label}${name}: ${att.localPath}`;
		})
		.join('\n');
	const header = `[User attached ${attachments.length} item(s); read them with Read or pass their paths to run_async_task]`;
	return `${header}\n${descriptions}\n\n${baseText}`.trim();
}

function workerThreadMapKey(root: string | null | undefined, mode: BotComposerMode): string {
	return `${normalizeWorkspaceKey(root)}::${mode}`;
}

function extractBotTodosFromArgs(args: Record<string, unknown>): BotTodoListItem[] {
	const rawTodos = args.todos;
	if (!Array.isArray(rawTodos)) {
		return [];
	}
	return rawTodos
		.map((todo) => {
			const item = todo && typeof todo === 'object' ? (todo as Record<string, unknown>) : {};
			const statusRaw = String(item.status ?? '').trim();
			const status =
				statusRaw === 'completed' || statusRaw === 'in_progress' || statusRaw === 'pending'
					? statusRaw
					: 'pending';
			return {
				content: String(item.content ?? '').trim(),
				status,
				activeForm: String(item.activeForm ?? '').trim() || undefined,
			} satisfies BotTodoListItem;
		})
		.filter((todo) => todo.content);
}

function describeBotToolActivity(name: string, args: Record<string, unknown>): string | undefined {
	switch (name) {
		case 'TodoWrite': {
			const todos = extractBotTodosFromArgs(args);
			const active = todos.find((todo) => todo.status === 'in_progress');
			return active?.activeForm || active?.content || `更新任务列表（${todos.length} 项）`;
		}
		case 'Browser': {
			const action = String(args.action ?? '').trim();
			return action ? `浏览器：${action}` : '正在操作内置浏览器';
		}
		case 'BrowserCapture': {
			const action = String(args.action ?? '').trim();
			return action ? `浏览器抓包：${action}` : '正在抓取浏览器网络请求';
		}
		case 'Bash': {
			const command = String(args.command ?? '').trim();
			return command ? `执行命令：${command.slice(0, 80)}` : '执行命令';
		}
		case 'run_async_task': {
			const task = String(args.task ?? '').trim();
			const mode = String(args.mode ?? '').trim();
			if (mode) {
				return `派发内部会话（${mode}）`;
			}
			return task ? `派发内部会话：${task.slice(0, 60)}` : '派发内部会话';
		}
		case 'send_local_attachment':
			return '发送本地附件给用户';
		case 'pause_for_qr_login':
			return '发送二维码登录截图并等待用户扫码';
		default:
			return undefined;
	}
}

function resolveBotLocalAttachmentPath(session: BotSessionState, requested: string): string {
	const raw = requested.trim();
	if (!raw) {
		throw new Error('file_path 不能为空。');
	}
	if (path.isAbsolute(raw)) {
		if (!fs.existsSync(raw) || !fs.statSync(raw).isFile()) {
			throw new Error('目标附件不存在，或不是文件。');
		}
		return raw;
	}
	if (!session.workspaceRoot) {
		throw new Error('当前没有工作区，无法解析相对附件路径。');
	}
	const resolved = path.resolve(session.workspaceRoot, raw);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
		throw new Error('目标附件不存在，或不是文件。');
	}
	return resolved;
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
		mode: integration.defaultMode ?? ('agent' as BotComposerMode),
		threadIdsByWorkspace: {},
		leaderMessages: [],
		lastUserId: senderId,
		lastUserName: senderName,
		browserHostWebContentsId: null,
	};
}

type RunBotOrchestratorArgs = {
	settings: ShellSettings;
	integration: BotIntegrationConfig;
	session: BotSessionState;
	inbound: BotInboundMessage;
	workspaceLspManager: WorkspaceLspManager;
	signal: AbortSignal;
	onStreamDelta?: (fullText: string, channel?: BotStreamChannel) => void;
	onToolStatus?: (name: string, state: 'running' | 'completed' | 'error', detail?: string) => void;
	onTodoUpdate?: (todos: BotTodoListItem[]) => void;
	onSendAttachment?: (filePath: string) => Promise<string>;
	onLeaderMessagesPersist?: (session: BotSessionState) => void;
};

type RunBotAsyncTaskArgs = {
	settings: ShellSettings;
	integration: BotIntegrationConfig;
	session: BotSessionState;
	task: string;
	modeOverride?: BotComposerMode;
	startNewThread?: boolean;
	workspaceLspManager: WorkspaceLspManager;
	signal: AbortSignal;
	onInnerTextDelta?: (fullText: string, channel?: BotStreamChannel) => void;
	onInnerToolStatus?: (name: string, state: 'running' | 'completed' | 'error', detail?: string) => void;
	onInnerTodoUpdate?: (todos: BotTodoListItem[]) => void;
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
		description: 'Start a fresh internal Async worker thread for the current workspace. Use this before run_async_task when you intentionally want a clean worker context.',
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
			'Launch an internal Async worker session when you intentionally want a detached worker or specialist workflow. Prefer using your own tools directly unless you explicitly want a worker session. Choose mode automatically: agent for direct execution, ask for lightweight Q&A, plan for planning-only work, team for delegated multi-role work.',
		parameters: {
			type: 'object',
			properties: {
				task: { type: 'string', description: 'The task or user request to execute.' },
				mode: {
					type: 'string',
					enum: ['agent', 'ask', 'plan', 'team'],
					description: 'Optional worker mode override. Omit to use the current default worker mode.',
				},
				new_thread: {
					type: 'boolean',
					description: 'When true, force a fresh internal worker thread for this run. Recommended when delegating a brand-new task.',
				},
			},
			required: ['task'],
		},
	},
	{
		name: 'send_local_attachment',
		description: 'Send a local image or file from disk back to the external user chat. Use this after you produce or locate a file the user wants to receive.',
		parameters: {
			type: 'object',
			properties: {
				file_path: {
					type: 'string',
					description: 'Absolute file path, or a path relative to the current workspace.',
				},
			},
			required: ['file_path'],
		},
	},
	{
		name: 'pause_for_qr_login',
		description:
			'Capture the current built-in browser page, send the screenshot to the external user for QR-code or other manual login steps, and pause the browser session until the user confirms login is complete. After calling this tool, stop and wait for the user to reply.',
		parameters: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					description:
						'Optional short user-facing instruction. If omitted, Async sends a default "scan the QR and reply when done" message.',
				},
				tab_id: {
					type: 'string',
					description: 'Optional browser tab id. Omit to use the active tab.',
				},
				timeout_ms: {
					type: 'number',
					description: 'Optional timeout for the screenshot capture. Default about 25 seconds.',
				},
			},
			required: [],
		},
	},
];

const BOT_LEADER_NATIVE_TOOL_NAMES = new Set([
	'Browser',
	'BrowserCapture',
	'TodoWrite',
	'Read',
	'Grep',
	'Glob',
]);


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
				defaultWorkerMode: session.mode,
				leaderContextTurns: Math.floor((session.leaderMessages?.length ?? 0) / 2),
				browserHostWebContentsId: session.browserHostWebContentsId ?? null,
				qrLoginPending: Boolean(session.pendingQrLogin),
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
			? 'You are the Async global leader bot. You directly manage the Async app, its tools, and its worker sessions.'
			: '你是 Async 的全局 Leader Bot。你直接管理整个 Async 应用、它的工具能力以及内部 worker 会话。',
		language === 'en'
			? 'This leader loop is for app-level orchestration. It can directly use app/browser controls plus the custom bot session tools below.'
			: '这个 Leader 循环用于应用级调度。它可以直接使用应用/浏览器控制工具，以及下面的 bot 会话工具。',
		language === 'en'
			? 'Your priority is fast, direct answers. Default to using your own tools (Read, Grep, Glob, Browser, BrowserCapture, TodoWrite) to answer the user without spawning a worker.'
			: '你的首要目标是快速、直接地回答用户。默认优先使用自己的工具（Read、Grep、Glob、Browser、BrowserCapture、TodoWrite）直接回答，不要动不动就派 worker。',
		language === 'en'
			? 'Use run_async_task ONLY when the task requires Writes/Edits, shell commands, builds/tests, multi-file refactors, or long-running workflows. Simple reads, searches, status questions, and lookups must be answered directly by you.'
			: '只有在任务需要写文件、改文件、执行 shell、跑构建/测试、多文件重构、或长链路流程时，才使用 run_async_task。简单的读文件、搜索、状态问询、查询必须你自己直接答。',
		language === 'en'
			? 'If the user asks about current model, workspace, browser state, git state, or other app state, inspect and answer directly.'
			: '如果用户在问当前模型、工作区、浏览器状态、Git 状态或其他应用状态，直接检查并回答。',
		language === 'en'
			? 'When delegating via run_async_task, choose mode automatically: agent for direct project implementation/debugging, plan for plan-only analysis, team for larger or cross-cutting project work, and ask for lightweight Q&A that still needs a recorded worker conversation.'
			: '使用 run_async_task 时，自动判断模式：直接项目实现/调试用 agent，只做方案分析用 plan，较大或跨领域工作用 team，需要保留记录的轻量问答可用 ask。',
		language === 'en'
			? 'When the user asks to search the web, open a page, read a webpage, interact with a login form, take a screenshot, or close the built-in browser, use Browser and BrowserCapture directly (for example: navigate, input_text, click_element, screenshot_page, list_requests, get_request).'
			: '当用户要求搜索网页、打开页面、与登录表单交互、读取网页内容、截屏或抓取浏览器网络请求时，直接使用 Browser 和 BrowserCapture 工具（例如：navigate、input_text、click_element、screenshot_page、list_requests、get_request）。',
		language === 'en'
			? 'If a site switches to QR-code login or another manual mobile confirmation step, do not ask the user for passwords. Use pause_for_qr_login to send the current browser screenshot to the user, keep the browser session open, and wait for the user to confirm login is complete.'
			: '如果网站切换到二维码登录或其他需要用户手机确认的登录步骤，不要向用户索要密码。请使用 pause_for_qr_login，把当前浏览器截图发给用户，保持浏览器会话不关闭，并等待用户确认登录完成。',
		language === 'en'
			? 'If the user wants the screenshot or a local file to appear in the chat, do not stop at saving it locally. Use send_local_attachment to send the produced or located file back to the user.'
			: '如果用户希望截图或本地文件直接出现在聊天窗口里，不要只停留在本地保存；拿到文件后继续调用 send_local_attachment 发回给用户。',
		language === 'en'
			? 'For user-visible replies on external platforms like Feishu, be explicit and reasonably detailed. For substantial work, summarize what was checked, what was done, key findings, affected areas, and the next step.'
			: '在飞书这类外部平台上给用户回复时，要明确且信息量充足。只要工作不算特别轻，就总结：检查了什么、做了什么、关键发现、影响范围，以及下一步建议。',
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

const READONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Browser', 'BrowserCapture', 'TodoWrite', 'pause_for_qr_login']);

function resolveBotPermissionPolicy(integration: BotIntegrationConfig): 'strict' | 'readonly_auto' | 'permissive' {
	const raw = String(integration.permissionPolicy ?? '').trim().toLowerCase();
	if (raw === 'permissive' || raw === 'readonly_auto' || raw === 'strict') {
		return raw;
	}
	return 'readonly_auto';
}

function createHeadlessBeforeExecuteTool(
	settings: ShellSettings,
	integration: BotIntegrationConfig,
	opts?: { hasPendingQrLogin?: () => boolean }
) {
	const policy = resolveBotPermissionPolicy(integration);
	return async (call: ToolCall) => {
		if (
			opts?.hasPendingQrLogin?.() &&
			call.name !== 'pause_for_qr_login' &&
			call.name !== 'get_async_session'
		) {
			return {
				proceed: false as const,
				rejectionMessage: '二维码登录等待中，请先等待用户扫码并确认完成。',
			};
		}
		const agent = settings.agent;
		const permission = resolveToolPermissionFromRules(call, agent, { avoidPermissionPrompts: true });
		if (permission === 'deny') {
			return { proceed: false as const, rejectionMessage: '工具调用被当前权限规则拒绝。' };
		}

		if (READONLY_TOOLS.has(call.name) && policy !== 'strict') {
			return { proceed: true as const };
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
			if (policy === 'permissive' && isSafeShellCommandForAutoApprove(command)) {
				return { proceed: true as const };
			}
			return { proceed: false as const, rejectionMessage: '当前机器人会话不会弹出 shell 执行确认，请在桌面端放宽权限后重试。' };
		}

		if (call.name === 'Write' || call.name === 'Edit') {
			if (permission === 'allow' || settings.agent?.confirmWritesBeforeExecute !== true) {
				return { proceed: true as const };
			}
			if (policy === 'permissive') {
				return { proceed: true as const };
			}
			return { proceed: false as const, rejectionMessage: '当前机器人会话不会弹出写入确认，请关闭写入确认或改在桌面端执行。' };
		}

		return { proceed: true as const };
	};
}

function ensureThreadForSession(session: BotSessionState, mode: BotComposerMode, forceNewThread = false): string {
	const key = workerThreadMapKey(session.workspaceRoot, mode);
	const existing = session.threadIdsByWorkspace[key];
	if (!forceNewThread && existing && getThread(existing)) {
		return existing;
	}
	const created = createThread(session.workspaceRoot, { select: false });
	session.threadIdsByWorkspace[key] = created.id;
	return created.id;
}

async function runBotAsyncTask(args: RunBotAsyncTaskArgs): Promise<string> {
	const { settings, integration, session, task, workspaceLspManager, signal } = args;
	const mode = args.modeOverride ?? session.mode;
	const threadId = ensureThreadForSession(session, mode, args.startNewThread === true);
	const hostWebContentsId = resolveSessionBotHostWebContentsId(session);
	try {
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
				let teamStreamFull = '';
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
					hostWebContentsId,
					emit: (evt) => {
						if (evt.type === 'delta') {
							teamStreamFull += evt.text;
							args.onInnerTextDelta?.(teamStreamFull, 'worker');
							return;
						}
						if (evt.type === 'tool_call') {
							let parsedArgs: Record<string, unknown> = {};
							try {
								parsedArgs = JSON.parse(evt.args) as Record<string, unknown>;
							} catch {
								parsedArgs = {};
							}
							if (evt.name === 'TodoWrite') {
								args.onInnerTodoUpdate?.(extractBotTodosFromArgs(parsedArgs));
							}
							args.onInnerToolStatus?.(evt.name, 'running', describeBotToolActivity(evt.name, parsedArgs));
							return;
						}
						if (evt.type === 'tool_progress') {
							args.onInnerToolStatus?.(evt.name, 'running', evt.detail || evt.phase);
							return;
						}
						if (evt.type === 'tool_result') {
							args.onInnerToolStatus?.(evt.name, evt.success ? 'completed' : 'error');
						}
					},
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
						beforeExecuteTool: createHeadlessBeforeExecuteTool(effectiveSettings, integration, {
							hasPendingQrLogin: () => Boolean(session.pendingQrLogin),
						}),
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
							args.onInnerTextDelta?.(innerStreamFull, 'worker');
						},
						onToolProgress: (payload) => {
							args.onInnerToolStatus?.(payload.name, 'running', payload.detail || payload.phase);
						},
						onToolCall: (name, toolArgs) => {
							if (name === 'TodoWrite') {
								args.onInnerTodoUpdate?.(extractBotTodosFromArgs(toolArgs));
							}
							args.onInnerToolStatus?.(name, 'running', describeBotToolActivity(name, toolArgs));
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
							args.onInnerTextDelta?.(askStreamFull, 'worker');
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
	} finally {
		if (hostWebContentsId != null) {
			if (session.pendingQrLogin?.hostWebContentsId === hostWebContentsId) {
				session.browserHostWebContentsId = hostWebContentsId;
			} else {
				closeBrowserWindowForHostId(hostWebContentsId);
				if (session.browserHostWebContentsId === hostWebContentsId) {
					session.browserHostWebContentsId = null;
				}
			}
		}
	}
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
			session.threadIdsByWorkspace[workerThreadMapKey(session.workspaceRoot, session.mode)] = created.id;
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
				const rawMode = String(call.arguments.mode ?? '').trim();
				const modeOverride =
					rawMode === 'agent' || rawMode === 'ask' || rawMode === 'plan' || rawMode === 'team'
						? rawMode
						: undefined;
				const result = await runBotAsyncTask({
					settings,
					integration,
					session,
					task,
					modeOverride,
					startNewThread: call.arguments.new_thread === true,
					workspaceLspManager,
					signal,
					onInnerTextDelta: args.onStreamDelta,
					onInnerToolStatus: args.onToolStatus,
					onInnerTodoUpdate: args.onTodoUpdate,
				});
				return {
					toolCallId: call.id,
					name: call.name,
					content: [
						`workspace=${session.workspaceRoot ?? '(none)'}`,
						`mode=${modeOverride ?? session.mode}`,
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
		send_local_attachment: async (call) => {
			if (!args.onSendAttachment) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: '当前平台不支持发送附件。',
					isError: true,
				};
			}
			try {
				const resolvedPath = resolveBotLocalAttachmentPath(
					session,
					String(call.arguments.file_path ?? '').trim()
				);
				const result = await args.onSendAttachment(resolvedPath);
				return {
					toolCallId: call.id,
					name: call.name,
					content: result,
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
		pause_for_qr_login: async (call) => {
			if (!args.onSendAttachment) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: '当前平台不支持发送图片，无法执行二维码登录等待流程。',
					isError: true,
				};
			}
			const currentHostId = resolveSessionBotHostWebContentsId(session);
			if (!currentHostId) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: '当前没有可用的浏览器宿主窗口，无法发送二维码截图。',
					isError: true,
				};
			}
			try {
				const screenshot = await captureBrowserScreenshotForBot({
					hostWebContentsId: currentHostId,
					session,
					tabId: typeof call.arguments.tab_id === 'string' ? String(call.arguments.tab_id).trim() : undefined,
					timeoutMs: Number(call.arguments.timeout_ms ?? 25_000),
				});
				await args.onSendAttachment(screenshot.path);
				const replyText =
					String(call.arguments.message ?? '').trim() || defaultQrLoginReplyText(settings.language);
				session.browserHostWebContentsId = currentHostId;
				session.pendingQrLogin = {
					requestedAt: Date.now(),
					hostWebContentsId: currentHostId,
					screenshotPath: screenshot.path,
					tabId: typeof call.arguments.tab_id === 'string' ? String(call.arguments.tab_id).trim() || undefined : undefined,
					pageUrl: screenshot.pageUrl || undefined,
					replyText,
				};
				return {
					toolCallId: call.id,
					name: call.name,
					content:
						settings.language === 'en'
							? `QR login screenshot sent to the user at ${screenshot.path}. Stop now and wait for the user to confirm login is complete.`
							: `已将二维码登录截图发送给用户：${screenshot.path}。现在请停止后续操作，等待用户确认“已登录”。`,
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
	const hostWebContentsId = resolveSessionBotHostWebContentsId(session);
	let full = '';
	let errorMessage = '';
	let streamFull = '';
	const leaderToolPool = [
		...AGENT_TOOLS.filter((tool) => BOT_LEADER_NATIVE_TOOL_NAMES.has(tool.name)),
		...BOT_TOOL_DEFS,
	];
	const userTurnContent = buildUserTurnContentWithAttachments(inbound);
	const baseLeaderMessages = [
		...session.leaderMessages,
		{ role: 'user', content: userTurnContent } satisfies ChatMessage,
	];
	const leaderCompress = await compressForSend(
		baseLeaderMessages,
		settings,
		{
			mode: 'agent',
			signal,
			requestModelId: resolved.requestModelId,
			paradigm: resolved.paradigm,
			requestApiKey: resolved.apiKey,
			requestBaseURL: resolved.baseURL,
			requestProxyUrl: resolved.proxyUrl,
			maxOutputTokens: resolved.maxOutputTokens,
			thinkingLevel,
		},
		session.leaderSummary,
		session.leaderSummaryCoversCount
	).catch(() => ({ messages: baseLeaderMessages } as { messages: ChatMessage[]; newSummary?: string; newSummaryCoversCount?: number }));
	if (leaderCompress.newSummary && leaderCompress.newSummaryCoversCount !== undefined) {
		session.leaderSummary = leaderCompress.newSummary;
		session.leaderSummaryCoversCount = leaderCompress.newSummaryCoversCount;
	}
	const leaderMessages = leaderCompress.messages;

	try {
		await runAgentLoop(
			settings,
			leaderMessages,
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
				hostWebContentsId,
				toolPoolOverride: leaderToolPool,
				customToolHandlers: handlers,
				agentSystemAppend: systemAppend,
				beforeExecuteTool: createHeadlessBeforeExecuteTool(settings, integration, {
					hasPendingQrLogin: () => Boolean(session.pendingQrLogin),
				}),
				mistakeLimitEnabled: settings.agent?.mistakeLimitEnabled,
				maxConsecutiveMistakes: settings.agent?.maxConsecutiveMistakes,
			},
			{
				onTextDelta: (text) => {
					streamFull += text;
					full = streamFull;
					args.onStreamDelta?.(streamFull, 'leader');
				},
				onToolProgress: (payload) => {
					args.onToolStatus?.(payload.name, 'running', payload.detail || payload.phase);
				},
				onToolCall: (name, toolArgs) => {
					if (name === 'TodoWrite') {
						args.onTodoUpdate?.(extractBotTodosFromArgs(toolArgs));
					}
					args.onToolStatus?.(name, 'running', describeBotToolActivity(name, toolArgs));
				},
				onToolResult: (name, _result, success) => {
					args.onToolStatus?.(name, success ? 'completed' : 'error');
				},
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
	} finally {
		if (hostWebContentsId != null) {
			if (session.pendingQrLogin?.hostWebContentsId === hostWebContentsId) {
				session.browserHostWebContentsId = hostWebContentsId;
			} else {
				closeBrowserWindowForHostId(hostWebContentsId);
				if (session.browserHostWebContentsId === hostWebContentsId) {
					session.browserHostWebContentsId = null;
				}
			}
		}
	}

	if (errorMessage) {
		args.onLeaderMessagesPersist?.(session);
		throw new Error(errorMessage);
	}
	session.leaderMessages = trimBotLeaderMessages([
		...baseLeaderMessages,
		{ role: 'assistant', content: full.trim() } satisfies ChatMessage,
	]);
	args.onLeaderMessagesPersist?.(session);
	return full.trim();
}

export function createBotWorkspaceLspManager(getSettings: () => ShellSettings): WorkspaceLspManager {
	return new WorkspaceLspManager(getSettings, () => app.getAppPath());
}
