/**
 * 工具执行引擎 — 接收工具调用并在工作区内安全执行。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveWorkspacePath, isPathInsideRoot } from '../workspace.js';
import { formatSymbolSearchResults, searchWorkspaceSymbols, ensureSymbolIndexLoaded } from '../workspaceSymbolIndex.js';
import type { ToolCall, ToolResult } from './agentTools.js';
import type { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import type { AgentLoopOptions, AgentLoopHandlers } from './agentLoop.js';
import type { ShellSettings } from '../settingsStore.js';
import { getMcpManager } from '../mcp/index.js';
import type { McpToolResult } from '../mcp/mcpTypes.js';
import type { NestedAgentStreamEmit } from '../ipc/nestedAgentStream.js';
import { appendSubagentTranscript } from '../threadStore.js';
import { assembleAgentToolPool } from './agentToolPool.js';
import { executeAskPlanQuestionTool, type TeamPlanQuestionRoleScope } from './planQuestionTool.js';
import { executePlanSubmitDraftTool } from './planDraftTool.js';
import { executeTeamPlanDecideTool } from './teamPlanDecideTool.js';
import { executeTeamEscalateToLeadTool } from './teamEscalateTool.js';
import { executeTeamPeerRequestTool } from './teamPeerRequestTool.js';
import { executeTeamReplyToPeerTool } from './teamReplyToPeerTool.js';
import type { ComposerMode } from '../llm/composerMode.js';
import { buildSubagentSystemAppend, findConfiguredSubagent, resolveSubagentProfile } from './subagentProfile.js';
import { shouldRunAgentInBackground } from './agentForkPolicy.js';
import { windowsPowerShellUtf8Command } from '../winUtf8.js';
import { ensureAgentMemoryDirExists, loadAgentMemoryPrompt } from './agentMemory.js';
import { buildRelevantMemoryContextBlock } from '../memdir/findRelevantMemories.js';
import { extractMemoriesToDir } from '../services/extractMemories/extractMemories.js';
import { setTodos, type TodoItem } from './todoStore.js';
import { minimatch } from 'minimatch';
import * as gitService from '../gitService.js';
import {
	awaitBrowserCommandResult,
	dispatchBrowserControlToHostId,
	getBrowserRuntimeStateForHostId,
	getBrowserSidebarConfigPayloadForHostId,
	getDefaultBrowserSidebarConfig,
	getOrCreateBrowserSidebarConfigForHostId,
	setBrowserSidebarConfigForHostId,
	browserSidebarConfigToPayload,
	type BrowserControlCommand,
	type BrowserSidebarConfigPayload,
} from '../browser/browserController.js';

/** @deprecated 已由 WorkspaceLspManager 取代 */
export function setToolLspSession(_session: unknown): void {
	/* no-op */
}

export type SubAgentBackgroundDonePayload = {
	parentToolCallId: string;
	result: string;
	success: boolean;
};

/** Agent / Task 嵌套子循环上下文（由 register.ts 注入）。 */
let _delegateContext: {
	settings: ShellSettings;
	options: Omit<AgentLoopOptions, 'signal'>;
	parentSignal: AbortSignal;
	nestedEmit?: (evt: NestedAgentStreamEmit) => void;
	threadId: string | null;
	onSubAgentBackgroundDone?: (payload: SubAgentBackgroundDonePayload) => void;
} | null = null;

export function setDelegateContext(
	settings: ShellSettings,
	options: Omit<AgentLoopOptions, 'signal'>,
	parentSignal: AbortSignal,
	nestedEmit?: (evt: NestedAgentStreamEmit) => void,
	threadId?: string | null,
	onSubAgentBackgroundDone?: (payload: SubAgentBackgroundDonePayload) => void
): void {
	_delegateContext = {
		settings,
		options,
		parentSignal,
		nestedEmit,
		threadId: threadId ?? null,
		onSubAgentBackgroundDone,
	};
}

export function clearDelegateContext(): void {
	_delegateContext = null;
}

/** 与 Claude `AgentTool` 一致：主名 `Agent`，兼容旧会话/权限里的 `Task`。 */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

function coerceAgentDelegateArgs(call: ToolCall): {
	task: string;
	context: string;
	subagentType?: string;
	runInBackground: boolean;
} {
	const a = call.arguments;
	const task = String(a.prompt ?? a.task ?? a.description ?? '').trim();
	const context = String(a.context ?? '').trim();
	const subagentType = typeof a.subagent_type === 'string' && a.subagent_type.trim() ? a.subagent_type.trim() : undefined;
	const runInBackground = a.run_in_background === true || a.run_in_background === 'true';
	return { task, context, subagentType, runInBackground };
}

const BACKGROUND_AGENT_TOOL_RESULT =
	'[Background] Sub-agent started. Nested activity streams above; you will get a UI notice when it finishes. / 后台子 Agent 已启动，过程见上方嵌套区域，结束后会弹出提示。';

const execFileAsync = promisify(execFile);

/** Single Read call: max lines returned. */
const MAX_READ_LINES_PER_CALL = 2000;
/** Refuse to load extremely large text files into memory in one shot. */
const MAX_READ_FILE_BYTES = 2 * 1024 * 1024;

const GLOB_MAX_RESULTS = 100;
const GLOB_IGNORE_DIR_NAMES = new Set(['.git', 'node_modules', '.hg', '.svn', '.jj']);
const MAX_SYMBOL_SEARCH_RESULTS = 80;
const DEFAULT_GREP_HEAD_LIMIT = 250;
const VCS_GREP_EXCLUDES = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'] as const;

export type ToolWriteSnapshot = {
	path: string;
	previousContent: string | null;
};

export type ToolAfterWriteSnapshot = {
	path: string;
	previousContent: string | null;
	nextContent: string;
};

export type ToolExecutionHooks = {
	beforeWrite?: (snapshot: ToolWriteSnapshot) => void | Promise<void>;
	afterWrite?: (snapshot: ToolAfterWriteSnapshot) => void | Promise<void>;
};

function formatMcpToolResultForAgent(result: McpToolResult): string {
	const parts: string[] = [];
	for (const block of result.content ?? []) {
		if (block.type === 'text' && block.text != null && block.text !== '') {
			parts.push(block.text);
		} else if (block.type === 'image') {
			parts.push(
				block.data
					? `[image${block.mimeType ? ` ${block.mimeType}` : ''}, base64 ${Math.min(block.data.length, 64)} chars…]`
					: '[image]'
			);
		} else if (block.type === 'resource') {
			parts.push('[resource]');
		} else {
			parts.push(JSON.stringify(block));
		}
	}
	const text = parts.join('\n\n').trim();
	return text || '(empty MCP result)';
}

const MAX_MCP_RESOURCE_LIST_CHARS = 100_000;
/** ReadMcpResource：与 Claude `ReadMcpResourceTool.maxResultSizeChars` 一致 */
const MAX_MCP_RESOURCE_READ_CHARS = 100_000;
/** Bash：与 Claude `BashTool.maxResultSizeChars` 一致 */
const MAX_BASH_OUTPUT_CHARS = 30_000;

function makeBrowserCommandId(): string {
	return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function looksLikeBrowserDirectUrl(raw: string): boolean {
	if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
		return true;
	}
	return /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(raw);
}

function normalizeBrowserNavigateTarget(raw: string): string {
	const text = raw.trim();
	if (!text) {
		return 'https://www.bing.com/';
	}
	if (looksLikeBrowserDirectUrl(text)) {
		return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text) ? text : `https://${text}`;
	}
	return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

function browserControlDeliveryNote(sent: boolean, mode: 'command-only' | 'config-persisted'): string {
	if (sent) {
		return '';
	}
	return mode === 'config-persisted'
		? ' The browser UI was not live in this window, but the config was saved and will apply next time the built-in browser opens.'
		: ' The browser UI was not live in this window, so the command could not be delivered.';
}

function hasOwnBrowserArg(args: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(args, key);
}

function firstBrowserArg(args: Record<string, unknown>, ...keys: string[]): unknown {
	for (const key of keys) {
		if (hasOwnBrowserArg(args, key)) {
			return args[key];
		}
	}
	return undefined;
}

function parseDataUrlPng(dataUrl: string): Buffer {
	const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl.trim());
	if (!match?.[1]) {
		throw new Error('Browser screenshot did not return a PNG data URL.');
	}
	return Buffer.from(match[1], 'base64');
}

function buildDefaultBrowserScreenshotPath(execCtx: ToolExecutionContext): { full: string; rel: string | null } {
	const fileName = `browser-${new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}.png`;
	if (execCtx.workspaceRoot) {
		const rel = path.posix.join('.async', 'browser-captures', fileName);
		const full = resolveWorkspacePath(rel, execCtx.workspaceRoot);
		return { full, rel };
	}
	const full = path.join(os.tmpdir(), 'async-browser-captures', fileName);
	return { full, rel: null };
}

async function executeBrowserTool(call: ToolCall, execCtx: ToolExecutionContext): Promise<ToolResult> {
	throwIfToolAbortRequested(execCtx.signal, call.name, 'browser:start');
	const hostId = execCtx.hostWebContentsId ?? null;
	if (!hostId) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Browser tool is unavailable because this run is not attached to an app window.',
			isError: true,
		};
	}

	const action = String(call.arguments.action ?? '').trim();
	if (!action) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: action is required',
			isError: true,
		};
	}

	const dispatch = (command: BrowserControlCommand): boolean => dispatchBrowserControlToHostId(hostId, command);

	switch (action) {
		case 'get_config': {
			const payload = await getBrowserSidebarConfigPayloadForHostId(hostId);
			return {
				toolCallId: call.id,
				name: call.name,
				content: JSON.stringify(
					{
						partition: payload.partition,
						defaultUserAgent: payload.defaultUserAgent,
						config: payload.config,
					},
					null,
					2
				),
				isError: false,
			};
		}
		case 'get_state': {
			const state = getBrowserRuntimeStateForHostId(hostId);
			return {
				toolCallId: call.id,
				name: call.name,
				content: JSON.stringify(
					state ?? {
						activeTabId: null,
						tabs: [],
						note: 'No live browser state has been synced yet. Open or use the built-in browser first.',
					},
					null,
					2
				),
				isError: false,
			};
		}
		case 'navigate': {
			const target = String(call.arguments.url ?? call.arguments.target ?? '').trim();
			if (!target) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: 'Error: url is required for navigate',
					isError: true,
				};
			}
			const resolvedUrl = normalizeBrowserNavigateTarget(target);
			const sent = dispatch({
				commandId: makeBrowserCommandId(),
				type: 'navigate',
				target,
				newTab: call.arguments.new_tab === true || call.arguments.newTab === true,
			});
			return {
				toolCallId: call.id,
				name: call.name,
				content: `Opened built-in browser at ${resolvedUrl}.${browserControlDeliveryNote(sent, 'command-only')}`.trim(),
				isError: false,
			};
		}
		case 'read_page': {
			const timeoutMsRaw = Number(firstBrowserArg(call.arguments, 'timeout_ms', 'timeoutMs'));
			const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 20_000;
			const result = await awaitBrowserCommandResult(
				hostId,
				{
					commandId: makeBrowserCommandId(),
					type: 'readPage',
					tabId:
						typeof firstBrowserArg(call.arguments, 'tab_id', 'tabId') === 'string'
							? String(firstBrowserArg(call.arguments, 'tab_id', 'tabId'))
							: undefined,
					selector:
						typeof firstBrowserArg(call.arguments, 'selector') === 'string'
							? String(firstBrowserArg(call.arguments, 'selector'))
							: undefined,
					includeHtml:
						firstBrowserArg(call.arguments, 'include_html', 'includeHtml') === true ||
						firstBrowserArg(call.arguments, 'include_html', 'includeHtml') === 'true',
					maxChars: Number(firstBrowserArg(call.arguments, 'max_chars', 'maxChars')) || undefined,
					waitForLoad:
						firstBrowserArg(call.arguments, 'wait_for_load', 'waitForLoad') === undefined
							? true
							: firstBrowserArg(call.arguments, 'wait_for_load', 'waitForLoad') === true ||
								firstBrowserArg(call.arguments, 'wait_for_load', 'waitForLoad') === 'true',
				},
				timeoutMs
			);
			if (!result.ok) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: `Browser read_page failed: ${result.error}`,
					isError: true,
				};
			}
			return {
				toolCallId: call.id,
				name: call.name,
				content: JSON.stringify(result.result, null, 2),
				isError: false,
			};
		}
		case 'screenshot_page': {
			const timeoutMsRaw = Number(firstBrowserArg(call.arguments, 'timeout_ms', 'timeoutMs'));
			const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 25_000;
			const result = await awaitBrowserCommandResult(
				hostId,
				{
					commandId: makeBrowserCommandId(),
					type: 'screenshotPage',
					tabId:
						typeof firstBrowserArg(call.arguments, 'tab_id', 'tabId') === 'string'
							? String(firstBrowserArg(call.arguments, 'tab_id', 'tabId'))
							: undefined,
					waitForLoad:
						firstBrowserArg(call.arguments, 'wait_for_load', 'waitForLoad') === undefined
							? true
							: firstBrowserArg(call.arguments, 'wait_for_load', 'waitForLoad') === true ||
								firstBrowserArg(call.arguments, 'wait_for_load', 'waitForLoad') === 'true',
				},
				timeoutMs
			);
			if (!result.ok) {
				return {
					toolCallId: call.id,
					name: call.name,
					content: `Browser screenshot_page failed: ${result.error}`,
					isError: true,
				};
			}
			const payload = result.result && typeof result.result === 'object' ? (result.result as Record<string, unknown>) : {};
			const png = parseDataUrlPng(String(payload.dataUrl ?? ''));
			let saveTarget: { full: string; rel: string | null };
			const rawFilePath = String(firstBrowserArg(call.arguments, 'file_path', 'filePath') ?? '').trim();
			if (rawFilePath) {
				const resolved = resolveAgentFilePath(rawFilePath, execCtx);
				saveTarget = { full: resolved.full, rel: resolved.rel };
			} else {
				saveTarget = buildDefaultBrowserScreenshotPath(execCtx);
			}
			fs.mkdirSync(path.dirname(saveTarget.full), { recursive: true });
			fs.writeFileSync(saveTarget.full, png);
			return {
				toolCallId: call.id,
				name: call.name,
				content: JSON.stringify(
					{
						path: saveTarget.full,
						relPath: saveTarget.rel,
						format: 'png',
						capture: 'viewport',
						sizeBytes: png.length,
						width: Number(payload.width ?? 0) || 0,
						height: Number(payload.height ?? 0) || 0,
						url: String(payload.url ?? ''),
						title: String(payload.title ?? ''),
					},
					null,
					2
				),
				isError: false,
			};
		}
		case 'close_sidebar': {
			const sent = dispatch({
				commandId: makeBrowserCommandId(),
				type: 'closeSidebar',
			});
			return {
				toolCallId: call.id,
				name: call.name,
				content: `Browser command "${action}" dispatched.${browserControlDeliveryNote(sent, 'command-only')}`.trim(),
				isError: false,
			};
		}
		case 'reload':
		case 'stop':
		case 'go_back':
		case 'go_forward':
		case 'close_tab': {
			const commandType =
				action === 'go_back'
					? 'goBack'
					: action === 'go_forward'
						? 'goForward'
						: action === 'close_tab'
							? 'closeTab'
							: (action as 'reload' | 'stop');
			const sent = dispatch({
				commandId: makeBrowserCommandId(),
				type: commandType,
				tabId:
					typeof firstBrowserArg(call.arguments, 'tab_id', 'tabId') === 'string'
						? String(firstBrowserArg(call.arguments, 'tab_id', 'tabId'))
						: undefined,
			});
			return {
				toolCallId: call.id,
				name: call.name,
				content: `Browser command "${action}" dispatched.${browserControlDeliveryNote(sent, 'command-only')}`.trim(),
				isError: false,
			};
		}
		case 'reset_config': {
			const nextConfig = browserSidebarConfigToPayload(getDefaultBrowserSidebarConfig());
			const result = await setBrowserSidebarConfigForHostId(hostId, nextConfig);
			if (!result.ok) {
				return {
					toolCallId: call.id,
					name: call.name,
					content:
						result.error === 'invalid-header-line'
							? `Invalid extra header format on line ${result.line}.`
							: 'Proxy rules are required when proxyMode is custom.',
					isError: true,
				};
			}
			const sent = dispatch({
				commandId: makeBrowserCommandId(),
				type: 'applyConfig',
				config: result.config,
				defaultUserAgent: result.defaultUserAgent,
			});
			return {
				toolCallId: call.id,
				name: call.name,
				content: `Browser config reset to defaults.${browserControlDeliveryNote(sent, 'config-persisted')}`.trim(),
				isError: false,
			};
		}
		case 'set_config': {
			const current = browserSidebarConfigToPayload(getOrCreateBrowserSidebarConfigForHostId(hostId));
			const next: BrowserSidebarConfigPayload = {
				...current,
			};
			if (hasOwnBrowserArg(call.arguments, 'userAgent') || hasOwnBrowserArg(call.arguments, 'user_agent')) {
				next.userAgent = String(firstBrowserArg(call.arguments, 'userAgent', 'user_agent') ?? '').trim();
			}
			if (hasOwnBrowserArg(call.arguments, 'acceptLanguage') || hasOwnBrowserArg(call.arguments, 'accept_language')) {
				next.acceptLanguage = String(firstBrowserArg(call.arguments, 'acceptLanguage', 'accept_language') ?? '').trim();
			}
			if (hasOwnBrowserArg(call.arguments, 'extraHeadersText') || hasOwnBrowserArg(call.arguments, 'extra_headers_text')) {
				next.extraHeadersText = String(firstBrowserArg(call.arguments, 'extraHeadersText', 'extra_headers_text') ?? '').replace(/\r/g, '');
			}
			if (hasOwnBrowserArg(call.arguments, 'proxyMode') || hasOwnBrowserArg(call.arguments, 'proxy_mode')) {
				const proxyMode = String(firstBrowserArg(call.arguments, 'proxyMode', 'proxy_mode') ?? '').trim();
				next.proxyMode =
					proxyMode === 'direct' || proxyMode === 'custom' || proxyMode === 'system' ? proxyMode : current.proxyMode;
			}
			if (hasOwnBrowserArg(call.arguments, 'proxyRules') || hasOwnBrowserArg(call.arguments, 'proxy_rules')) {
				next.proxyRules = String(firstBrowserArg(call.arguments, 'proxyRules', 'proxy_rules') ?? '').trim();
			}
			if (hasOwnBrowserArg(call.arguments, 'proxyBypassRules') || hasOwnBrowserArg(call.arguments, 'proxy_bypass_rules')) {
				next.proxyBypassRules = String(firstBrowserArg(call.arguments, 'proxyBypassRules', 'proxy_bypass_rules') ?? '').trim();
			}
			const result = await setBrowserSidebarConfigForHostId(hostId, next);
			if (!result.ok) {
				return {
					toolCallId: call.id,
					name: call.name,
					content:
						result.error === 'invalid-header-line'
							? `Invalid extra header format on line ${result.line}.`
							: 'Proxy rules are required when proxyMode is custom.',
					isError: true,
				};
			}
			const sent = dispatch({
				commandId: makeBrowserCommandId(),
				type: 'applyConfig',
				config: result.config,
				defaultUserAgent: result.defaultUserAgent,
			});
			return {
				toolCallId: call.id,
				name: call.name,
				content: `Browser config updated:\n${JSON.stringify(result.config, null, 2)}${browserControlDeliveryNote(sent, 'config-persisted')}`,
				isError: false,
			};
		}
		default:
			return {
				toolCallId: call.id,
				name: call.name,
				content:
					'Unknown Browser action. Supported actions: get_config, get_state, navigate, read_page, screenshot_page, close_sidebar, reload, stop, go_back, go_forward, close_tab, set_config, reset_config.',
				isError: true,
			};
	}
}

async function executeListMcpResources(call: ToolCall): Promise<ToolResult> {
	const filter = String(call.arguments.server ?? '').trim();
	const mgr = getMcpManager();
	const clients = mgr.getConnectedClients();
	let targets = clients;
	if (filter) {
		targets = clients.filter((c) => c.config.id === filter || c.config.name === filter);
		if (targets.length === 0) {
			return {
				toolCallId: call.id,
				name: call.name,
				content: `No connected MCP server matches "${filter}".`,
				isError: true,
			};
		}
	}
	const rows: Array<{
		uri: string;
		name: string;
		server: string;
		mimeType?: string;
		description?: string;
	}> = [];
	for (const c of targets) {
		const st = c.getServerStatus();
		for (const r of st.resources) {
			rows.push({
				uri: r.uri,
				name: r.name,
				server: c.config.name,
				mimeType: r.mimeType,
				description: r.description,
			});
		}
	}
	let text = JSON.stringify(rows, null, 2);
	if (text.length > MAX_MCP_RESOURCE_LIST_CHARS) {
		text = text.slice(0, MAX_MCP_RESOURCE_LIST_CHARS) + '\n... (truncated)';
	}
	return { toolCallId: call.id, name: call.name, content: text || '[]', isError: false };
}

async function executeReadMcpResource(call: ToolCall, execCtx: ToolExecutionContext): Promise<ToolResult> {
	throwIfToolAbortRequested(execCtx.signal, call.name, 'readMcpResource:start');
	const server = String(call.arguments.server ?? '').trim();
	const uri = String(call.arguments.uri ?? '').trim();
	if (!server || !uri) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: server and uri are required',
			isError: true,
		};
	}
	const client = getMcpManager().getClientByServerRef(server);
	if (!client) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP server not found: ${server}`,
			isError: true,
		};
	}
	if (client.getServerStatus().status !== 'connected') {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP server not connected: ${server}`,
			isError: true,
		};
	}
	try {
		const raw = await client.readResource(uri, execCtx.signal);
		const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
		const clipped =
			text.length > MAX_MCP_RESOURCE_READ_CHARS
				? text.slice(0, MAX_MCP_RESOURCE_READ_CHARS) + '\n... (truncated)'
				: text;
		return { toolCallId: call.id, name: call.name, content: clipped, isError: false };
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		const msg = e instanceof Error ? e.message : String(e);
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP resources/read failed: ${msg}`,
			isError: true,
		};
	}
}

async function executeMcpAgentTool(call: ToolCall, execCtx: ToolExecutionContext): Promise<ToolResult> {
	try {
		throwIfToolAbortRequested(execCtx.signal, call.name, 'mcpTool:start');
		const raw = await getMcpManager().callTool(call.name, call.arguments, execCtx.signal);
		const content = formatMcpToolResultForAgent(raw);
		return {
			toolCallId: call.id,
			name: call.name,
			content,
			isError: !!raw.isError,
		};
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		const msg = e instanceof Error ? e.message : String(e);
		return {
			toolCallId: call.id,
			name: call.name,
			content: `MCP tool error: ${msg}`,
			isError: true,
		};
	}
}

export type ToolExecutionContext = {
	delegateExecutionDepth?: number;
	workspaceRoot?: string | null;
	workspaceLspManager?: WorkspaceLspManager | null;
	threadId?: string | null;
	hostWebContentsId?: number | null;
	signal?: AbortSignal;
	/** Team 子循环：随 ask_plan_question 一并下发，供聊天区挂到对应角色 */
	teamToolRoleScope?: TeamPlanQuestionRoleScope;
	customToolHandlers?: Record<
		string,
		(call: ToolCall, hooks: ToolExecutionHooks, execCtx: ToolExecutionContext) => Promise<ToolResult> | ToolResult
	>;
};

function throwIfToolAbortRequested(signal: AbortSignal | undefined, toolName: string, phase: string): void {
	if (!signal?.aborted) {
		return;
	}
	throw new DOMException('Aborted', 'AbortError');
}

export async function executeTool(
	call: ToolCall,
	hooks: ToolExecutionHooks = {},
	execCtx: ToolExecutionContext = {}
): Promise<ToolResult> {
	try {
		throwIfToolAbortRequested(execCtx.signal, call.name, 'executeTool:start');
		const customHandler = execCtx.customToolHandlers?.[call.name];
		if (customHandler) {
			return await customHandler(call, hooks, execCtx);
		}
		switch (call.name) {
			case 'Read':
				return executeReadFile(call, execCtx);
			case 'Write':
				return executeWriteToFile(call, hooks, execCtx);
			case 'Edit':
				return executeStrReplace(call, hooks, execCtx);
			case 'Glob':
				return executeGlob(call, execCtx);
			case 'list_dir':
				return executeListDir(call, execCtx);
		case 'Grep':
			return await executeGrepTool(call, execCtx);
		case 'Bash':
			return await executeCommand(call, hooks, execCtx);
		case 'Browser':
			return await executeBrowserTool(call, execCtx);
		case 'LSP':
			return await executeLspTool(call, execCtx);
		case 'Agent':
		case 'Task':
			return await executeAgentDelegate(call, execCtx);
		case 'ListMcpResourcesTool':
			return await executeListMcpResources(call);
		case 'ReadMcpResourceTool':
			return await executeReadMcpResource(call, execCtx);
		case 'TodoWrite':
			return executeTodoWrite(call, execCtx);
		case 'ask_plan_question':
			return await executeAskPlanQuestionTool(
				call,
				execCtx.teamToolRoleScope ? { teamRoleScope: execCtx.teamToolRoleScope } : undefined
			);
		case 'plan_submit_draft':
			return await executePlanSubmitDraftTool(call, execCtx.threadId);
		case 'team_plan_decide':
			return await executeTeamPlanDecideTool(call, execCtx.teamToolRoleScope?.teamTaskId);
		case 'team_escalate_to_lead':
			return await executeTeamEscalateToLeadTool(call, execCtx.teamToolRoleScope?.teamTaskId);
		case 'team_request_from_peer':
			return await executeTeamPeerRequestTool(call, execCtx.teamToolRoleScope?.teamTaskId);
		case 'team_reply_to_peer':
			return await executeTeamReplyToPeerTool(call, execCtx.teamToolRoleScope?.teamTaskId);
		default:
			if (getMcpManager().isMcpTool(call.name)) {
				return await executeMcpAgentTool(call, execCtx);
			}
			return { toolCallId: call.id, name: call.name, content: `Unknown tool: ${call.name}`, isError: true };
		}
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		return { toolCallId: call.id, name: call.name, content: `Error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
	}
}

function requireWorkspace(execCtx: ToolExecutionContext): string {
	const root = execCtx.workspaceRoot ?? null;
	if (!root) throw new Error('No workspace folder open.');
	return root;
}

function safePath(relPath: string, execCtx: ToolExecutionContext): string {
	const root = requireWorkspace(execCtx);
	const full = resolveWorkspacePath(relPath, root);
	if (!isPathInsideRoot(full, root)) throw new Error('Path escapes workspace boundary.');
	return full;
}

function resolveAgentFilePath(raw: string, execCtx: ToolExecutionContext): { rel: string; full: string } {
	const root = requireWorkspace(execCtx);
	const trimmed = raw.trim();
	if (!trimmed) throw new Error('file_path is required');
	const full = path.isAbsolute(trimmed)
		? path.normalize(trimmed)
		: resolveWorkspacePath(trimmed.replace(/^[/\\]+/, ''), root);
	if (!isPathInsideRoot(full, root)) throw new Error('Path escapes workspace boundary.');
	const rel = path.relative(root, full).replace(/\\/g, '/') || '.';
	return { rel, full };
}

function readToolFileArg(call: ToolCall): string {
	return String(call.arguments.file_path ?? call.arguments.path ?? '').trim();
}

function executeReadFile(call: ToolCall, execCtx: ToolExecutionContext): ToolResult {
	const rawPath = readToolFileArg(call);
	if (!rawPath) return { toolCallId: call.id, name: call.name, content: 'Error: file_path is required', isError: true };

	let rel: string;
	let full: string;
	try {
		({ rel, full } = resolveAgentFilePath(rawPath, execCtx));
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Error: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}

	if (!fs.existsSync(full)) {
		return { toolCallId: call.id, name: call.name, content: `File not found: ${rel}`, isError: true };
	}
	if (!fs.statSync(full).isFile()) {
		return { toolCallId: call.id, name: call.name, content: `Not a file: ${rel}`, isError: true };
	}

	const st = fs.statSync(full);
	if (st.size > MAX_READ_FILE_BYTES) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `File too large (${st.size} bytes). Use Read with offset and limit to read a portion, or use Grep.`,
			isError: true,
		};
	}

	const buf = fs.readFileSync(full);
	if (buf.includes(0)) {
		return { toolCallId: call.id, name: call.name, content: `Skipped binary file: ${rel}`, isError: true };
	}

	let text = buf.toString('utf8').replace(/\r\n/g, '\n');
	const lines = text.split('\n');

	let offset = Math.max(1, Number(call.arguments.offset) || 1);
	let limit: number | undefined;
	if (call.arguments.limit !== undefined && call.arguments.limit !== null && String(call.arguments.limit) !== '') {
		const l = Number(call.arguments.limit);
		if (Number.isFinite(l) && l > 0) limit = Math.min(Math.floor(l), MAX_READ_LINES_PER_CALL);
	}
	const sl = call.arguments.start_line;
	const el = call.arguments.end_line;
	if (
		(call.arguments.offset === undefined || call.arguments.offset === null || !Number.isFinite(Number(call.arguments.offset))) &&
		Number(sl) > 0
	) {
		offset = Math.max(1, Math.floor(Number(sl)));
		if (Number(el) > 0) {
			const endL = Math.floor(Number(el));
			limit = Math.min(Math.max(1, endL - offset + 1), MAX_READ_LINES_PER_CALL);
		}
	}

	if (offset > lines.length) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `offset ${offset} is past end of file (${lines.length} lines).`,
			isError: true,
		};
	}

	const effectiveLimit = limit ?? Math.min(MAX_READ_LINES_PER_CALL, lines.length - offset + 1);
	const slice = lines.slice(offset - 1, offset - 1 + effectiveLimit);
	const numbered = slice.map((l, i) => `${String(offset + i).padStart(6)}|${l}`).join('\n');

	const totalLines = lines.length;
	const footer =
		offset + slice.length - 1 < totalLines
			? `\n\n(${totalLines} lines total; use offset=${offset + slice.length} to read more.)`
			: '';
	const header =
		effectiveLimit >= MAX_READ_LINES_PER_CALL && offset === 1 && totalLines > MAX_READ_LINES_PER_CALL
			? `(First ${MAX_READ_LINES_PER_CALL} of ${totalLines} lines; use offset and limit to paginate.)\n\n`
			: '';

	return { toolCallId: call.id, name: call.name, content: header + numbered + footer, isError: false };
}

function executeWriteToFile(call: ToolCall, hooks: ToolExecutionHooks, execCtx: ToolExecutionContext): ToolResult {
	const rawPath = readToolFileArg(call);
	const content = String(call.arguments.content ?? '');
	if (!rawPath) return { toolCallId: call.id, name: call.name, content: 'Error: file_path is required', isError: true };

	let relPath: string;
	let full: string;
	try {
		({ rel: relPath, full } = resolveAgentFilePath(rawPath, execCtx));
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Error: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}
	const existed = fs.existsSync(full);
	const previousContent = existed ? fs.readFileSync(full, 'utf8') : null;
	void hooks.beforeWrite?.({ path: relPath, previousContent });
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, 'utf8');
	void hooks.afterWrite?.({ path: relPath, previousContent, nextContent: content });

	const lineCount = content.split('\n').length;
	return {
		toolCallId: call.id,
		name: call.name,
		content: `${existed ? 'Updated' : 'Created'} ${relPath} (${lineCount} lines)`,
		isError: false,
	};
}

function executeStrReplace(call: ToolCall, hooks: ToolExecutionHooks, execCtx: ToolExecutionContext): ToolResult {
	const rawPath = readToolFileArg(call);
	const rawOldStr = String(call.arguments.old_string ?? call.arguments.old_str ?? '');
	const rawNewStr = String(call.arguments.new_string ?? call.arguments.new_str ?? '');
	const replaceAll =
		call.arguments.replace_all === true || call.arguments.replace_all === 'true' || call.arguments.replace_all === 1;
	if (!rawPath) return { toolCallId: call.id, name: call.name, content: 'Error: file_path is required', isError: true };
	if (!rawOldStr) {
		return { toolCallId: call.id, name: call.name, content: 'Error: old_string is required and must not be empty', isError: true };
	}
	if (rawOldStr === rawNewStr && !replaceAll) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: old_string and new_string are identical; nothing to change.',
			isError: true,
		};
	}

	let relPath: string;
	let full: string;
	try {
		({ rel: relPath, full } = resolveAgentFilePath(rawPath, execCtx));
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Error: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}
	if (!fs.existsSync(full)) {
		return { toolCallId: call.id, name: call.name, content: `File not found: ${relPath}`, isError: true };
	}

	const buf = fs.readFileSync(full);
	if (buf.includes(0)) {
		return { toolCallId: call.id, name: call.name, content: `Skipped binary file: ${relPath}`, isError: true };
	}

	const source = buf.toString('utf8');
	const fileHasCRLF = source.includes('\r\n');

	const oldStr = fileHasCRLF
		? rawOldStr.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
		: rawOldStr.replace(/\r\n/g, '\n');
	const newStr = fileHasCRLF
		? rawNewStr.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
		: rawNewStr.replace(/\r\n/g, '\n');

	if (replaceAll) {
		let patchedAll = source;
		let pos = 0;
		let count = 0;
		let firstLineNo = 1;
		while (true) {
			const found = patchedAll.indexOf(oldStr, pos);
			if (found === -1) break;
			if (count === 0) firstLineNo = patchedAll.slice(0, found).split('\n').length;
			patchedAll = patchedAll.slice(0, found) + newStr + patchedAll.slice(found + oldStr.length);
			pos = found + newStr.length;
			count++;
		}
		if (count === 0) {
			const preview = rawOldStr.length > 200 ? rawOldStr.slice(0, 200) + '...' : rawOldStr;
			const hint = fileHasCRLF ? ' (note: file uses CRLF line endings)' : '';
			return {
				toolCallId: call.id,
				name: call.name,
				content: `old_string not found in ${relPath}${hint}. Make sure the string matches exactly including whitespace and indentation.\nSearched for: ${preview}`,
				isError: true,
			};
		}
		void hooks.beforeWrite?.({ path: relPath, previousContent: source });
		fs.writeFileSync(full, patchedAll, 'utf8');
		void hooks.afterWrite?.({ path: relPath, previousContent: source, nextContent: patchedAll });
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Applied ${count} replacement(s) in ${relPath} (first at line ${firstLineNo})`,
			isError: false,
		};
	}

	let idx = source.indexOf(oldStr);
	let matchLen = oldStr.length;

	// Fallback 1: strip trailing whitespace per line
	if (idx === -1) {
		const stripped = stripTrailingSpacesPerLine(oldStr);
		const sourceStripped = stripTrailingSpacesPerLine(source);
		const fallbackIdx = sourceStripped.indexOf(stripped);
		if (fallbackIdx !== -1) {
			const secondFb = sourceStripped.indexOf(stripped, fallbackIdx + 1);
			if (secondFb === -1) {
				const origSlice = source.slice(fallbackIdx, fallbackIdx + stripped.length);
				const charDelta = source.length - sourceStripped.length;
				const adjustedIdx = charDelta === 0 ? fallbackIdx : source.indexOf(origSlice);
				if (adjustedIdx !== -1) idx = adjustedIdx;
			}
		}
	}

	// Fallback 2: LF-normalized search — handles CRLF/LF/mixed-ending mismatches
	if (idx === -1) {
		const srcLF = source.replace(/\r\n/g, '\n');
		const oldLF = rawOldStr.replace(/\r\n/g, '\n');
		const lfIdx = srcLF.indexOf(oldLF);
		if (lfIdx !== -1 && srcLF.indexOf(oldLF, lfIdx + 1) === -1) {
			idx = lfPosToOriginal(source, lfIdx);
			matchLen = lfPosToOriginal(source, lfIdx + oldLF.length) - idx;
		}
	}

	if (idx === -1) {
		const preview = rawOldStr.length > 200 ? rawOldStr.slice(0, 200) + '...' : rawOldStr;
		const hint = fileHasCRLF ? ' (note: file uses CRLF line endings)' : '';
		return {
			toolCallId: call.id,
			name: call.name,
			content: `old_string not found in ${relPath}${hint}. Make sure the string matches exactly including whitespace and indentation.\nSearched for: ${preview}`,
			isError: true,
		};
	}

	const verifySecond = source.indexOf(oldStr, idx + 1);
	if (verifySecond !== -1) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `old_string appears multiple times in ${relPath}. Set replace_all to true to replace every occurrence, or include more surrounding context to make a single match unique.`,
			isError: true,
		};
	}

	const lineNumber = source.slice(0, idx).split('\n').length;
	const patched = source.slice(0, idx) + newStr + source.slice(idx + matchLen);
	void hooks.beforeWrite?.({ path: relPath, previousContent: source });
	fs.writeFileSync(full, patched, 'utf8');
	void hooks.afterWrite?.({ path: relPath, previousContent: source, nextContent: patched });

	return {
		toolCallId: call.id,
		name: call.name,
		content: `Applied edit to ${relPath} at line ${lineNumber}`,
		isError: false,
	};
}

function stripTrailingSpacesPerLine(s: string): string {
	return s.replace(/[ \t]+(\r?\n)/g, '$1').replace(/[ \t]+$/, '');
}

/** Map a position in the LF-normalized string back to the original (potentially CRLF) string. */
function lfPosToOriginal(original: string, lfPos: number): number {
	let origIdx = 0;
	let lfIdx = 0;
	while (lfIdx < lfPos && origIdx < original.length) {
		if (original[origIdx] === '\r' && original[origIdx + 1] === '\n') {
			origIdx += 2;
		} else {
			origIdx += 1;
		}
		lfIdx += 1;
	}
	return origIdx;
}

function collectGlobFileRelPaths(scanRoot: string, workspaceRoot: string, out: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(scanRoot, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = path.join(scanRoot, e.name);
		if (e.isDirectory()) {
			if (GLOB_IGNORE_DIR_NAMES.has(e.name)) continue;
			collectGlobFileRelPaths(full, workspaceRoot, out);
		} else {
			out.push(path.relative(workspaceRoot, full).replace(/\\/g, '/'));
		}
	}
}

function executeGlob(call: ToolCall, execCtx: ToolExecutionContext): ToolResult {
	const pattern = String(call.arguments.pattern ?? '').trim();
	if (!pattern) {
		return { toolCallId: call.id, name: call.name, content: 'Error: pattern is required', isError: true };
	}
	const root = requireWorkspace(execCtx);
	const sub = String(call.arguments.path ?? '').trim();
	let scanRoot: string;
	try {
		scanRoot = sub ? safePath(sub, execCtx) : root;
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Error: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}
	if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
		return { toolCallId: call.id, name: call.name, content: `Not a directory: ${sub || '.'}`, isError: true };
	}
	const allRel: string[] = [];
	collectGlobFileRelPaths(scanRoot, root, allRel);
	const mmOpts = { dot: true, nocase: process.platform === 'win32' } as const;
	const matched = [...new Set(allRel)]
		.filter((rel) => minimatch(rel, pattern, mmOpts))
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	const truncated = matched.length > GLOB_MAX_RESULTS;
	const shown = truncated ? matched.slice(0, GLOB_MAX_RESULTS) : matched;
	if (shown.length === 0) {
		return { toolCallId: call.id, name: call.name, content: 'No files found', isError: false };
	}
	const header = truncated
		? `Found at least ${matched.length} files (showing first ${GLOB_MAX_RESULTS})\n`
		: `Found ${shown.length} file${shown.length === 1 ? '' : 's'}\n`;
	return {
		toolCallId: call.id,
		name: call.name,
		content: header + shown.join('\n'),
		isError: false,
	};
}

function executeListDir(call: ToolCall, execCtx: ToolExecutionContext): ToolResult {
	const root = requireWorkspace(execCtx);
	const relPath = String(call.arguments.path ?? '').trim();
	const full = relPath ? safePath(relPath, execCtx) : root;

	if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
		return { toolCallId: call.id, name: call.name, content: `Not a directory: ${relPath || '.'}`, isError: true };
	}

	const entries = fs.readdirSync(full, { withFileTypes: true });
	const sorted = entries
		.filter((e) => e.name !== '.' && e.name !== '..')
		.sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
		});

	const lines = sorted.map((e) => (e.isDirectory() ? `[dir]  ${e.name}/` : `[file] ${e.name}`));
	return { toolCallId: call.id, name: call.name, content: lines.join('\n') || '(empty directory)', isError: false };
}

function grepFormatLimitInfo(appliedLimit: number | undefined, appliedOffset: number | undefined): string {
	const parts: string[] = [];
	if (appliedLimit !== undefined) parts.push(`limit: ${appliedLimit}`);
	if (appliedOffset) parts.push(`offset: ${appliedOffset}`);
	return parts.join(', ');
}

function applyGrepHeadLimit<T>(
	items: T[],
	headLimit: number | undefined,
	offset: number
): { items: T[]; appliedLimit?: number; appliedOffset?: number } {
	const off = Math.max(0, Math.floor(Number(offset) || 0));
	if (headLimit === 0) {
		return { items: items.slice(off), appliedOffset: off > 0 ? off : undefined };
	}
	const effective = headLimit ?? DEFAULT_GREP_HEAD_LIMIT;
	const sliced = items.slice(off, off + effective);
	const truncated = items.length - off > effective;
	return {
		items: sliced,
		appliedLimit: truncated ? effective : undefined,
		appliedOffset: off > 0 ? off : undefined,
	};
}

function expandUserGlobPatterns(globField: string): string[] {
	const rawPatterns = globField.trim().split(/\s+/);
	const out: string[] = [];
	for (const raw of rawPatterns) {
		if (!raw) continue;
		if (raw.includes('{') && raw.includes('}')) {
			out.push(raw);
		} else {
			out.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
		}
	}
	return out;
}

async function runRipgrep(
	rgArgs: string[],
	cwd: string,
	signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const r = await execFileAsync('rg', rgArgs, {
			cwd,
			windowsHide: true,
			maxBuffer: 20 * 1024 * 1024,
			timeout: 30_000,
			encoding: 'utf8',
			signal,
		});
		return { stdout: (r.stdout as string) || '', stderr: (r.stderr as string) || '', code: 0 };
	} catch (e: unknown) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		const err = e as { stdout?: string; stderr?: string; code?: number };
		const code = typeof err.code === 'number' ? err.code : -1;
		return {
			stdout: err.stdout || '',
			stderr: err.stderr || '',
			code,
		};
	}
}

function sortGrepFilePathsByMtime(relPaths: string[], baseDir: string): string[] {
	const withT = relPaths.map((f) => {
		const full = path.join(baseDir, f);
		try {
			const st = fs.statSync(full);
			return { f, t: st.mtimeMs };
		} catch {
			return { f, t: 0 };
		}
	});
	withT.sort((a, b) => b.t - a.t || a.f.localeCompare(b.f, undefined, { sensitivity: 'base' }));
	return withT.map((x) => x.f);
}

async function executeGrepTool(call: ToolCall, execCtx: ToolExecutionContext): Promise<ToolResult> {
	throwIfToolAbortRequested(execCtx.signal, call.name, 'grep:start');
	const root = requireWorkspace(execCtx);
	const pattern = String(call.arguments.pattern ?? '');
	if (!pattern) return { toolCallId: call.id, name: call.name, content: 'Error: pattern is required', isError: true };

	const symbolMode =
		call.arguments.symbol === true ||
		call.arguments.search_symbols === true ||
		call.arguments.mode === 'symbol';
	if (symbolMode) {
		const rootNorm = path.resolve(root);
		await ensureSymbolIndexLoaded(rootNorm);
		const hits = searchWorkspaceSymbols(pattern, MAX_SYMBOL_SEARCH_RESULTS, rootNorm);
		return {
			toolCallId: call.id,
			name: call.name,
			content: formatSymbolSearchResults(hits),
			isError: false,
		};
	}

	let searchDirAbs: string;
	try {
		const subPath = String(call.arguments.path ?? '').trim();
		searchDirAbs = subPath ? safePath(subPath, execCtx) : root;
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Error: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}

	const outputModeRaw = call.arguments.output_mode;
	const output_mode =
		outputModeRaw === 'content' || outputModeRaw === 'files_with_matches' || outputModeRaw === 'count'
			? outputModeRaw
			: 'files_with_matches';

	const multiline = call.arguments.multiline === true;
	const caseInsensitive = call.arguments['-i'] === true;
	const ctxNum = (k: string) => {
		const v = call.arguments[k];
		if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
		return undefined;
	};
	const contextBefore = ctxNum('-B');
	const contextAfter = ctxNum('-A');
	const contextC = ctxNum('-C');
	const contextUnified = ctxNum('context');
	const showLineNumbers = call.arguments['-n'] !== false;
	const typeFilter = typeof call.arguments.type === 'string' && call.arguments.type.trim() ? call.arguments.type.trim() : '';
	const globField = typeof call.arguments.glob === 'string' ? call.arguments.glob : '';
	const globPatterns = globField ? expandUserGlobPatterns(globField) : [];

	let headLimit: number | undefined;
	if (call.arguments.head_limit === 0) headLimit = 0;
	else if (typeof call.arguments.head_limit === 'number' && Number.isFinite(call.arguments.head_limit)) {
		headLimit = Math.max(0, Math.floor(call.arguments.head_limit));
	} else headLimit = undefined;

	let offset = 0;
	if (typeof call.arguments.offset === 'number' && Number.isFinite(call.arguments.offset)) {
		offset = Math.max(0, Math.floor(call.arguments.offset));
	}

	const rgArgs: string[] = ['--hidden'];
	for (const d of VCS_GREP_EXCLUDES) {
		rgArgs.push('--glob', `!${d}`);
	}
	rgArgs.push('--max-columns', '500', '--color=never');
	if (multiline) rgArgs.push('-U', '--multiline-dotall');
	if (caseInsensitive) rgArgs.push('-i');

	if (output_mode === 'files_with_matches') rgArgs.push('-l');
	else if (output_mode === 'count') rgArgs.push('-c');

	if (output_mode === 'content') {
		if (showLineNumbers) rgArgs.push('-n');
		else rgArgs.push('--no-line-number');
		rgArgs.push('--no-heading');
		const ctxU = contextUnified;
		if (ctxU !== undefined) rgArgs.push('-C', String(ctxU));
		else if (contextC !== undefined) rgArgs.push('-C', String(contextC));
		else {
			if (contextBefore !== undefined) rgArgs.push('-B', String(contextBefore));
			if (contextAfter !== undefined) rgArgs.push('-A', String(contextAfter));
		}
	}

	if (pattern.startsWith('-')) rgArgs.push('-e', pattern);
	else rgArgs.push(pattern);

	if (typeFilter) rgArgs.push('--type', typeFilter);
	for (const g of globPatterns) {
		rgArgs.push('--glob', g);
	}
	rgArgs.push('.');

	const { stdout, stderr, code } = await runRipgrep(rgArgs, searchDirAbs, execCtx.signal);
	if (code === 2 || (code !== 0 && code !== 1)) {
		return { toolCallId: call.id, name: call.name, content: `Search failed: ${stderr || `exit ${code}`}`, isError: true };
	}

	const rawLines = stdout.split('\n').filter(Boolean);

	if (output_mode === 'count' && rawLines.length === 0) {
		return { toolCallId: call.id, name: call.name, content: 'No matches found.', isError: false };
	}

	if (output_mode === 'content') {
		const { items, appliedLimit, appliedOffset } = applyGrepHeadLimit(rawLines, headLimit, offset);
		const body = items.join('\n') || 'No matches found';
		const lim = grepFormatLimitInfo(appliedLimit, appliedOffset);
		const content = lim ? `${body}\n\n[Showing results with pagination = ${lim}]` : body;
		return { toolCallId: call.id, name: call.name, content, isError: false };
	}

	if (output_mode === 'count') {
		const normalized = rawLines.map((line) => {
			const i = line.lastIndexOf(':');
			if (i <= 0) return line;
			const filePath = line.slice(0, i);
			const rest = line.slice(i);
			const rel = path.isAbsolute(filePath) ? path.relative(searchDirAbs, filePath).replace(/\\/g, '/') : filePath.replace(/\\/g, '/');
			return rel + rest;
		});
		const { items, appliedLimit, appliedOffset } = applyGrepHeadLimit(normalized, headLimit, offset);
		let totalMatches = 0;
		let fileCount = 0;
		for (const line of items) {
			const i = line.lastIndexOf(':');
			if (i <= 0) continue;
			const n = parseInt(line.slice(i + 1), 10);
			if (!Number.isNaN(n)) {
				totalMatches += n;
				fileCount += 1;
			}
		}
		const rawContent = items.join('\n') || 'No matches found';
		const lim = grepFormatLimitInfo(appliedLimit, appliedOffset);
		const occ = totalMatches === 1 ? 'occurrence' : 'occurrences';
		const fs_ = fileCount === 1 ? 'file' : 'files';
		const summary = `\n\nFound ${totalMatches} total ${occ} across ${fileCount} ${fs_}.${lim ? ` with pagination = ${lim}` : ''}`;
		return { toolCallId: call.id, name: call.name, content: rawContent + summary, isError: false };
	}

	let files = rawLines.map((f) => f.replace(/\\/g, '/'));
	files = sortGrepFilePathsByMtime(files, searchDirAbs);
	const { items, appliedLimit, appliedOffset } = applyGrepHeadLimit(files, headLimit, offset);
	const lim = grepFormatLimitInfo(appliedLimit, appliedOffset);
	if (items.length === 0) {
		return { toolCallId: call.id, name: call.name, content: 'No files found', isError: false };
	}
	const fw = items.length === 1 ? 'file' : 'files';
	const prefix = `Found ${items.length} ${fw}${lim ? ` ${lim}` : ''}`;
	return { toolCallId: call.id, name: call.name, content: `${prefix}\n${items.join('\n')}`, isError: false };
}

const UNIX_INSPECT_RE = /^\s*(ls\b|cat\b|head\b|tail\b|wc\b|file\b|stat\b|less\b|more\b|sed\b|awk\b|find\s)/;
const UNIX_REDIRECT: Record<string, string> = {
	ls: 'Use Glob or Bash to list files; use Read to inspect a file.',
	cat: 'Use Read to read file contents.',
	head: 'Use Read with offset=1 and limit=N.',
	tail: 'Use Read with offset near the end and a limit.',
	wc: 'Use Read to get file content, then count in your response.',
	file: 'Use Read to inspect file contents.',
	stat: 'Use Glob or Read to check if a path exists.',
	less: 'Use Read to read file contents.',
	more: 'Use Read to read file contents.',
	sed: 'Use Edit to make targeted edits to files.',
	awk: 'Use Read then process the content in your response.',
	find: 'Use Glob or Grep instead.',
};

type BashGitDirtyState = {
	topLevel: string;
	orderedEntries: Array<{ repoRel: string; wsRel: string }>;
	dirtyContentByWsPath: Map<string, string | null>;
};

function decodeGitPorcelainPath(raw: string): string {
	let value = raw.trim();
	if (value.startsWith('"') && value.endsWith('"')) {
		value = value
			.slice(1, -1)
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');
	}
	return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function parseGitPorcelainEntriesForWorkspace(
	raw: string,
	workspaceRoot: string,
	gitTopLevel: string
): Array<{ repoRel: string; wsRel: string }> {
	const line = raw.trimEnd();
	if (line.length < 4 || line[2] !== ' ') {
		return [];
	}
	const rest = line.slice(3).trimEnd();
	const repoPaths = rest.includes(' -> ')
		? (() => {
				const idx = rest.lastIndexOf(' -> ');
				return [decodeGitPorcelainPath(rest.slice(0, idx)), decodeGitPorcelainPath(rest.slice(idx + 4))];
			})()
		: [decodeGitPorcelainPath(rest)];
	const out: Array<{ repoRel: string; wsRel: string }> = [];
	for (const repoRel of repoPaths) {
		if (!repoRel) {
			continue;
		}
		const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, workspaceRoot, gitTopLevel);
		if (wsRel) {
			out.push({ repoRel, wsRel });
		}
	}
	return out;
}

function readUtf8TextFileIfExists(fullPath: string): string | null {
	try {
		if (!fs.existsSync(fullPath)) {
			return null;
		}
		const buf = fs.readFileSync(fullPath);
		if (buf.includes(0)) {
			return null;
		}
		return buf.toString('utf8');
	} catch {
		return null;
	}
}

async function captureBashGitDirtyState(workspaceRoot: string): Promise<BashGitDirtyState | null> {
	try {
		const { stdout: gitRootStdout } = await execFileAsync(
			'git',
			['-c', 'core.quotepath=false', 'rev-parse', '--show-toplevel'],
			{
				cwd: workspaceRoot,
				windowsHide: true,
				maxBuffer: 1024 * 1024,
				encoding: 'utf8',
			}
		);
		const topLevel = path.resolve(String(gitRootStdout ?? '').trim());
		if (!topLevel) {
			return null;
		}
		const { stdout } = await execFileAsync(
			'git',
			['-c', 'core.quotepath=false', 'status', '--porcelain=v1'],
			{
				cwd: workspaceRoot,
				windowsHide: true,
				maxBuffer: 10 * 1024 * 1024,
				encoding: 'utf8',
			}
		);
		const orderedEntries: Array<{ repoRel: string; wsRel: string }> = [];
		const seen = new Set<string>();
		for (const line of String(stdout ?? '').split(/\r?\n/)) {
			for (const entry of parseGitPorcelainEntriesForWorkspace(line, workspaceRoot, topLevel)) {
				if (seen.has(entry.wsRel)) {
					continue;
				}
				seen.add(entry.wsRel);
				orderedEntries.push(entry);
			}
		}
		const dirtyContentByWsPath = new Map<string, string | null>();
		for (const entry of orderedEntries) {
			const fullPath = resolveWorkspacePath(entry.wsRel, workspaceRoot);
			dirtyContentByWsPath.set(entry.wsRel, readUtf8TextFileIfExists(fullPath));
		}
		return { topLevel, orderedEntries, dirtyContentByWsPath };
	} catch {
		return null;
	}
}

async function readGitHeadTextOrNull(gitTopLevel: string, repoRel: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['-c', 'core.quotepath=false', 'show', `HEAD:${repoRel}`],
			{
				cwd: gitTopLevel,
				windowsHide: true,
				maxBuffer: 10 * 1024 * 1024,
				encoding: 'utf8',
			}
		);
		const content = String(stdout ?? '');
		return content.includes('\u0000') ? null : content;
	} catch {
		return null;
	}
}

async function recordBashWorkspaceSnapshots(
	workspaceRoot: string,
	hooks: ToolExecutionHooks,
	beforeState: BashGitDirtyState | null
): Promise<void> {
	if (!hooks.beforeWrite && !hooks.afterWrite) {
		return;
	}
	const afterState = await captureBashGitDirtyState(workspaceRoot);
	const gitTopLevel = afterState?.topLevel ?? beforeState?.topLevel;
	if (!gitTopLevel) {
		return;
	}
	const orderedEntries: Array<{ repoRel: string; wsRel: string }> = [];
	const seen = new Set<string>();
	const pushUnique = (entry: { repoRel: string; wsRel: string }) => {
		if (seen.has(entry.wsRel)) {
			return;
		}
		seen.add(entry.wsRel);
		orderedEntries.push(entry);
	};
	for (const entry of afterState?.orderedEntries ?? []) {
		pushUnique(entry);
	}
	for (const entry of beforeState?.orderedEntries ?? []) {
		pushUnique(entry);
	}
	for (const entry of orderedEntries) {
		const previousContent = beforeState?.dirtyContentByWsPath.has(entry.wsRel)
			? (beforeState.dirtyContentByWsPath.get(entry.wsRel) ?? null)
			: await readGitHeadTextOrNull(gitTopLevel, entry.repoRel);
		const fullPath = resolveWorkspacePath(entry.wsRel, workspaceRoot);
		const nextContent = readUtf8TextFileIfExists(fullPath);
		if ((previousContent ?? null) === (nextContent ?? null)) {
			continue;
		}
		await hooks.beforeWrite?.({ path: entry.wsRel, previousContent });
		if (nextContent !== null) {
			await hooks.afterWrite?.({ path: entry.wsRel, previousContent, nextContent });
		} else if (previousContent !== null) {
			await hooks.afterWrite?.({ path: entry.wsRel, previousContent, nextContent: '' });
		}
	}
}

async function executeCommand(
	call: ToolCall,
	hooks: ToolExecutionHooks,
	execCtx: ToolExecutionContext
): Promise<ToolResult> {
	throwIfToolAbortRequested(execCtx.signal, call.name, 'command:start');
	const root = requireWorkspace(execCtx);
	const command = String(call.arguments.command ?? '').trim();
	if (!command) return { toolCallId: call.id, name: call.name, content: 'Error: command is required', isError: true };

	if (process.platform === 'win32') {
		const unixMatch = command.match(UNIX_INSPECT_RE);
		if (unixMatch) {
			const cmd = unixMatch[1]!.trim();
			const hint = UNIX_REDIRECT[cmd] ?? 'Use the dedicated tools (Read, Glob, Grep) instead.';
			return {
				toolCallId: call.id,
				name: call.name,
				content: `"${cmd}" is a Unix command and will not work on this Windows system. ${hint}`,
				isError: true,
			};
		}
	}

	const isWin = process.platform === 'win32';
	const shell = isWin ? 'powershell.exe' : '/bin/bash';
	const psCommand = isWin ? windowsPowerShellUtf8Command(command) : command;
	const args = isWin
		? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand]
		: ['-lc', command];
	const beforeGitState = await captureBashGitDirtyState(root);

	try {
		const { stdout, stderr } = await execFileAsync(shell, args, {
			cwd: root,
			windowsHide: true,
			maxBuffer: 5 * 1024 * 1024,
			timeout: 120_000,
			encoding: 'utf8',
			signal: execCtx.signal,
		});
		await recordBashWorkspaceSnapshots(root, hooks, beforeGitState);
		let output = '';
		if (stdout) output += stdout;
		if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;
		if (!output.trim()) output = '(command completed with no output)';
		if (output.length > MAX_BASH_OUTPUT_CHARS) {
			output = output.slice(0, MAX_BASH_OUTPUT_CHARS) + '\n... (truncated)';
		}
		return { toolCallId: call.id, name: call.name, content: output, isError: false };
	} catch (e: unknown) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		await recordBashWorkspaceSnapshots(root, hooks, beforeGitState);
		const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
		let output = '';
		if (err.stdout) output += err.stdout;
		if (err.stderr) output += (output ? '\n--- stderr ---\n' : '') + err.stderr;
		if (!output.trim()) output = err.message ?? String(e);
		if (output.length > MAX_BASH_OUTPUT_CHARS) {
			output = output.slice(0, MAX_BASH_OUTPUT_CHARS) + '\n... (truncated)';
		}
		return { toolCallId: call.id, name: call.name, content: `Exit code ${err.code ?? 'unknown'}\n${output}`, isError: true };
	}
}

const SEVERITY_LABEL: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

async function executeAgentDelegate(call: ToolCall, execCtx: ToolExecutionContext = {}): Promise<ToolResult> {
	throwIfToolAbortRequested(execCtx.signal, call.name, 'delegate:start');
	const { task, context, subagentType, runInBackground } = coerceAgentDelegateArgs(call);
	if (!task) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: `prompt` is required for the Agent tool.',
			isError: true,
		};
	}

	if (!_delegateContext) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Agent tool is not available in this context.',
			isError: true,
		};
	}

	const depth = execCtx.delegateExecutionDepth ?? 0;
	if (depth >= 1) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Nested Agent calls are not allowed (max nesting depth: 1).',
			isError: true,
		};
	}

	const { runAgentLoop } = await import('./agentLoop.js');
	const subMessages: import('../threadStore.js').ChatMessage[] = [
		{ role: 'user', content: context ? `${task}\n\nContext:\n${context}` : task },
	];

	const parentToolCallId = call.id;
	const nestingDepth = 1;
	const prevCtx = _delegateContext!;
	const emit = prevCtx.nestedEmit;
	const tid = prevCtx.threadId;
	const onBgDone = prevCtx.onSubAgentBackgroundDone;

	const profile = resolveSubagentProfile(subagentType);
	const subComposerMode: ComposerMode = profile === 'explore' ? 'plan' : prevCtx.options.composerMode;
	const subAppend = buildSubagentSystemAppend(prevCtx.settings, subagentType);
	const matchedSubagent = findConfiguredSubagent(prevCtx.settings, subagentType);

	let baseToolDefs = assembleAgentToolPool(subComposerMode, {
		mcpToolDenyPrefixes: prevCtx.settings.mcpToolDenyPrefixes,
	});
	baseToolDefs = baseToolDefs.filter((d) => !SUBAGENT_TOOL_NAMES.has(d.name));

	const childDepth = depth + 1;
	const useBackgroundFork = shouldRunAgentInBackground({
		backgroundForkAgentSetting: prevCtx.settings.agent?.backgroundForkAgent,
		envAsyncAgentBackgroundFork: process.env.ASYNC_AGENT_BACKGROUND_FORK,
		subagentType,
		runInBackground,
	});

	const logTranscript = (chunk: string) => {
		if (tid) {
			appendSubagentTranscript(tid, parentToolCallId, chunk);
		}
	};

	const runSubAgent = async (): Promise<{ output: string; errorMsg: string }> => {
		let output = '';
		let errorMsg = '';
		let agentMemoryAppend = '';
		let agentMemoryDir: string | null = null;
		throwIfToolAbortRequested(prevCtx.parentSignal, call.name, 'delegate:runSubAgent:start');
		if (matchedSubagent?.memoryScope && subagentType) {
			try {
				const subWs = prevCtx.options.workspaceRoot ?? null;
				agentMemoryDir = await ensureAgentMemoryDirExists(subagentType, matchedSubagent.memoryScope, subWs);
				agentMemoryAppend =
					loadAgentMemoryPrompt(subagentType, matchedSubagent.memoryScope, subWs)?.trim() ?? '';
			} catch {
				agentMemoryAppend = '';
				agentMemoryDir = null;
			}
		}
		let relevantAgentMemories = '';
		if (agentMemoryDir) {
			try {
				const agentQuery = `${task}\n\n${context}`.trim();
				relevantAgentMemories =
					(await buildRelevantMemoryContextBlock({
						query: agentQuery,
						settings: prevCtx.settings,
						modelSelection: prevCtx.options.modelSelection ?? '',
						memoryDirOverride: agentMemoryDir,
						label: 'Relevant agent memories',
						signal: prevCtx.parentSignal,
					})) ?? '';
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					throw e;
				}
				relevantAgentMemories = '';
			}
		}
		const mergedAppend = [
			prevCtx.options.agentSystemAppend?.trim(),
			subAppend?.trim(),
			agentMemoryAppend,
			relevantAgentMemories.trim(),
		]
			.filter(Boolean)
			.join('\n\n');
		const handlers: AgentLoopHandlers = {
			onTextDelta: (text) => {
				output += text;
				logTranscript(text);
				emit?.({
					type: 'delta',
					text,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolInputDelta: (p) => {
				emit?.({
					type: 'tool_input_delta',
					name: p.name,
					partialJson: p.partialJson,
					index: p.index,
					parentToolCallId,
					nestingDepth,
				});
			},
			onThinkingDelta: (text) => {
				logTranscript(text);
				emit?.({
					type: 'thinking_delta',
					text,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolCall: (name, args, toolUseId) => {
				const line = `\n[tool] ${name} ${JSON.stringify(args).slice(0, 200)}\n`;
				logTranscript(line);
				emit?.({
					type: 'tool_call',
					name,
					args: JSON.stringify(args),
					toolCallId: toolUseId,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolResult: (name, result, success, toolUseId) => {
				const line = `\n[result] ${name} success=${success}\n`;
				logTranscript(line);
				emit?.({
					type: 'tool_result',
					name,
					result,
					success,
					toolCallId: toolUseId,
					parentToolCallId,
					nestingDepth,
				});
			},
			onToolProgress: (p) => {
				emit?.({
					type: 'tool_progress',
					name: p.name,
					phase: p.phase,
					detail: p.detail,
					parentToolCallId,
					nestingDepth,
				});
			},
			onDone: () => {},
			onError: (msg) => {
				errorMsg = msg;
			},
		};

		try {
			const baseHooks = prevCtx.options.toolHooks;
			const hooksForSub =
				subComposerMode === 'agent' || !baseHooks
					? baseHooks
					: { ...baseHooks, afterWrite: undefined };
			await runAgentLoop(
				prevCtx.settings,
				subMessages,
				{
					...prevCtx.options,
					signal: prevCtx.parentSignal,
					composerMode: subComposerMode,
					toolPoolOverride: baseToolDefs,
					delegateExecutionDepth: childDepth,
					toolHooks: hooksForSub,
					...(mergedAppend ? { agentSystemAppend: mergedAppend } : {}),
				},
				handlers
			);
			if (!errorMsg && agentMemoryDir && !prevCtx.parentSignal.aborted) {
				await extractMemoriesToDir({
					memoryDir: agentMemoryDir,
					workspaceRootForEntrypoint: null,
					messages: [
						subMessages[0]!,
						{ role: 'assistant', content: output || '(sub-agent completed with no output)' },
					],
					runtimeModel: {
						requestModelId: prevCtx.options.requestModelId,
						paradigm: prevCtx.options.paradigm,
						requestApiKey: prevCtx.options.requestApiKey,
						requestBaseURL: prevCtx.options.requestBaseURL,
						requestProxyUrl: prevCtx.options.requestProxyUrl,
						thinkingLevel: prevCtx.options.thinkingLevel,
					},
				});
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				throw e;
			}
			errorMsg = String(e);
		}
		return { output, errorMsg };
	};

	if (useBackgroundFork) {
		void (async () => {
			const { output, errorMsg } = await runSubAgent();
			onBgDone?.({
				parentToolCallId,
				result: errorMsg ? `Sub-agent error: ${errorMsg}` : output || '(sub-agent completed with no output)',
				success: !errorMsg,
			});
		})();

		return {
			toolCallId: call.id,
			name: call.name,
			content: BACKGROUND_AGENT_TOOL_RESULT,
			isError: false,
		};
	}

	const { output, errorMsg } = await runSubAgent();
	if (errorMsg) {
		return { toolCallId: call.id, name: call.name, content: `Sub-agent error: ${errorMsg}`, isError: true };
	}
	return { toolCallId: call.id, name: call.name, content: output || '(sub-agent completed with no output)', isError: false };
}

function executeTodoWrite(call: ToolCall, execCtx: ToolExecutionContext): ToolResult {
	const rawTodos = call.arguments.todos;
	if (!Array.isArray(rawTodos)) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'Error: todos must be an array',
			isError: true,
		};
	}
	const todos: TodoItem[] = rawTodos.map((t: Record<string, unknown>) => ({
		content: String(t.content ?? ''),
		status: (['pending', 'in_progress', 'completed'].includes(String(t.status)) ? String(t.status) : 'pending') as TodoItem['status'],
		activeForm: String(t.activeForm ?? t.content ?? ''),
	}));

	const key = execCtx.threadId ?? execCtx.workspaceRoot ?? '_default';
	const { oldTodos, newTodos } = setTodos(key, todos);

	const completed = newTodos.filter((t) => t.status === 'completed').length;
	const inProgress = newTodos.filter((t) => t.status === 'in_progress').length;
	const pending = newTodos.filter((t) => t.status === 'pending').length;

	return {
		toolCallId: call.id,
		name: call.name,
		content: `Todo list updated: ${newTodos.length} tasks (${completed} done, ${inProgress} in progress, ${pending} pending)`,
		isError: false,
	};
}

const LSP_MAX_OUTPUT_CHARS = 100_000;

const LSP_OPERATION_SET = new Set([
	'goToDefinition',
	'findReferences',
	'hover',
	'documentSymbol',
	'workspaceSymbol',
	'goToImplementation',
	'prepareCallHierarchy',
	'incomingCalls',
	'outgoingCalls',
	'getDiagnostics',
]);

const LSP_POSITION_OPTIONAL = new Set(['getDiagnostics', 'workspaceSymbol']);

function clampLspText(s: string): string {
	if (s.length <= LSP_MAX_OUTPUT_CHARS) return s;
	return s.slice(0, LSP_MAX_OUTPUT_CHARS) + '\n... (truncated)';
}

function lspRelUriPath(uri: string, workspaceRoot: string): string {
	if (!uri.startsWith('file:')) return uri;
	try {
		const p = fileURLToPath(uri);
		return path.relative(workspaceRoot, p).replace(/\\/g, '/') || '.';
	} catch {
		return uri;
	}
}

function formatLspLocationish(res: unknown, workspaceRoot: string): string {
	if (res == null) return '(no results)';
	const arr = Array.isArray(res) ? res : [res];
	const lines: string[] = [];
	for (const item of arr) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const uri = (o.uri ?? o.targetUri) as string | undefined;
		const range = (o.range ?? o.targetSelectionRange ?? o.targetRange) as
			| { start?: { line: number; character: number } }
			| undefined;
		if (uri && range?.start) {
			const rel = lspRelUriPath(uri, workspaceRoot);
			const line = (range.start.line ?? 0) + 1;
			const col = (range.start.character ?? 0) + 1;
			lines.push(`${rel}:${line}:${col}`);
		}
	}
	if (lines.length === 0) return typeof res === 'object' ? JSON.stringify(res).slice(0, 12_000) : String(res);
	const cap = 500;
	return (
		lines.slice(0, cap).join('\n') + (lines.length > cap ? `\n... (${lines.length - cap} more locations)` : '')
	);
}

function formatLspHover(raw: unknown): string {
	if (raw == null) return '(no hover)';
	if (typeof raw !== 'object') return String(raw);
	const c = (raw as { contents?: unknown }).contents;
	if (typeof c === 'string') return c;
	if (c && typeof c === 'object' && 'value' in (c as object)) {
		return String((c as { value?: string }).value ?? '');
	}
	if (Array.isArray(c)) {
		return c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
	}
	return JSON.stringify(raw).slice(0, 12_000);
}

function formatLspDocumentSymbolsNode(s: unknown, indent: number, workspaceRoot: string): string[] {
	if (!s || typeof s !== 'object') return [];
	const o = s as Record<string, unknown>;
	const lines: string[] = [];
	const name = String(o.name ?? '?');
	const kind = o.kind != null ? String(o.kind) : '';
	let suffix = '';
	if (o.range && typeof o.range === 'object') {
		const st = (o.range as { start?: { line: number } }).start;
		if (st) suffix = ` L${(st.line ?? 0) + 1}`;
	}
	if (o.location && typeof o.location === 'object') {
		const loc = o.location as { uri: string; range?: { start: { line: number } } };
		const rel = lspRelUriPath(loc.uri, workspaceRoot);
		const ln = (loc.range?.start?.line ?? 0) + 1;
		suffix = ` ${rel}:${ln}`;
	}
	lines.push(`${'  '.repeat(indent)}${name}${kind ? ` [${kind}]` : ''}${suffix}`);
	const ch = o.children;
	if (Array.isArray(ch)) {
		for (const c of ch) lines.push(...formatLspDocumentSymbolsNode(c, indent + 1, workspaceRoot));
	}
	return lines;
}

function formatLspDocumentSymbolsResult(res: unknown, workspaceRoot: string): string {
	if (!Array.isArray(res) || res.length === 0) return '(no symbols)';
	const parts: string[] = [];
	for (const s of res) parts.push(...formatLspDocumentSymbolsNode(s, 0, workspaceRoot));
	const cap = 400;
	return (
		parts.slice(0, cap).join('\n') + (parts.length > cap ? '\n... (truncated)' : '')
	);
}

function formatLspWorkspaceSymbols(res: unknown, workspaceRoot: string): string {
	if (!Array.isArray(res) || res.length === 0) return '(no symbols)';
	const lines: string[] = [];
	for (const s of res as Array<{ name?: string; location?: { uri: string; range?: { start: { line: number } } } }>) {
		if (!s?.location?.uri) continue;
		const rel = lspRelUriPath(s.location.uri, workspaceRoot);
		const line = (s.location.range?.start?.line ?? 0) + 1;
		lines.push(`${s.name ?? '?'} — ${rel}:${line}`);
		if (lines.length >= 300) break;
	}
	return lines.join('\n') || '(no symbols)';
}

function formatLspCallHierarchyPrepare(res: unknown, workspaceRoot: string): string {
	if (res == null) return '(no items)';
	const arr = Array.isArray(res) ? res : [res];
	const lines: string[] = [];
	for (const item of arr) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const name = String(o.name ?? '?');
		const uri = o.uri as string | undefined;
		const range = o.range as { start?: { line: number } } | undefined;
		if (!uri) continue;
		const rel = lspRelUriPath(uri, workspaceRoot);
		const ln = (range?.start?.line ?? 0) + 1;
		lines.push(`${name} — ${rel}:${ln}`);
	}
	return lines.join('\n') || '(no items)';
}

function formatLspCallHierarchyCalls(res: unknown, workspaceRoot: string, op: 'incomingCalls' | 'outgoingCalls'): string {
	if (res == null || (Array.isArray(res) && res.length === 0)) return '(no calls)';
	if (!Array.isArray(res)) return JSON.stringify(res).slice(0, 12_000);
	const lines: string[] = [];
	if (op === 'incomingCalls') {
		for (const row of res as Array<{
			from?: { name?: string; uri?: string; range?: { start: { line: number } } };
		}>) {
			const from = row.from;
			if (!from?.uri) continue;
			const rel = lspRelUriPath(from.uri, workspaceRoot);
			const ln = (from.range?.start?.line ?? 0) + 1;
			lines.push(`from ${from.name ?? '?'} @ ${rel}:${ln}`);
		}
	} else {
		for (const row of res as Array<{ to?: { name?: string; uri?: string; range?: { start: { line: number } } } }>) {
			const to = row.to;
			if (!to?.uri) continue;
			const rel = lspRelUriPath(to.uri, workspaceRoot);
			const ln = (to.range?.start?.line ?? 0) + 1;
			lines.push(`to ${to.name ?? '?'} @ ${rel}:${ln}`);
		}
	}
	return lines.slice(0, 400).join('\n') || JSON.stringify(res).slice(0, 12_000);
}

async function executeLspTool(call: ToolCall, execCtx: ToolExecutionContext): Promise<ToolResult> {
	throwIfToolAbortRequested(execCtx.signal, call.name, 'lsp:start');
	const args = call.arguments;
	const op = String(args.operation ?? '').trim();
	const filePathRaw = String(args.filePath ?? args.path ?? '').trim();
	if (!op) {
		return { toolCallId: call.id, name: call.name, content: 'Error: operation is required', isError: true };
	}
	if (!LSP_OPERATION_SET.has(op)) {
		return { toolCallId: call.id, name: call.name, content: `Error: unknown LSP operation "${op}"`, isError: true };
	}
	if (!filePathRaw) {
		return { toolCallId: call.id, name: call.name, content: 'Error: filePath is required', isError: true };
	}

	let line = typeof args.line === 'number' ? args.line : Number(args.line);
	let character = typeof args.character === 'number' ? args.character : Number(args.character);
	if (!LSP_POSITION_OPTIONAL.has(op)) {
		if (!Number.isFinite(line) || !Number.isFinite(character) || line < 1 || character < 1) {
			return {
				toolCallId: call.id,
				name: call.name,
				content: 'Error: line and character must be positive integers (1-based, as shown in the editor).',
				isError: true,
			};
		}
	} else {
		if (!Number.isFinite(line) || line < 1) line = 1;
		if (!Number.isFinite(character) || character < 1) character = 1;
	}

	const root = requireWorkspace(execCtx);
	let rel: string;
	let full: string;
	try {
		({ rel, full } = resolveAgentFilePath(filePathRaw, execCtx));
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Error: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}

	if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
		return { toolCallId: call.id, name: call.name, content: `File not found or not a regular file: ${rel}`, isError: true };
	}

	const mgr = execCtx.workspaceLspManager;
	if (!mgr) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: 'LSP manager is not available in this context.',
			isError: true,
		};
	}

	let session: Awaited<ReturnType<WorkspaceLspManager['sessionForFile']>>;
	try {
		session = await mgr.sessionForFile(full, root);
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `Could not start language server: ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}
	if (!session) {
		const ext = path.extname(rel).toLowerCase() || '(none)';
		return {
			toolCallId: call.id,
			name: call.name,
			content: `No LSP server handles extension "${ext}". Add a plugin under <asyncData>/plugins/<name>/ or <workspace>/.async/plugins/<name>/ with .lsp.json (command + extensionToLanguage), or use legacy settings.json "lsp.servers". For TS/JS, install typescript-language-server in the project or register it explicitly.`,
			isError: false,
		};
	}

	const text = fs.readFileSync(full, 'utf-8');
	const uri = pathToFileURL(full).href;

	try {
		let out = '';
		switch (op) {
			case 'getDiagnostics': {
				const items = await session.diagnostics(uri, text);
				if (items === null) {
					out = 'Pull diagnostics not supported by the current language server. Try running tsc manually.';
				} else if (items.length === 0) {
					out = `No diagnostics in ${rel}.`;
				} else {
					out = items
						.map((d) => {
							const sev = SEVERITY_LABEL[d.severity ?? 1] ?? 'error';
							const ln = (d.range.start.line ?? 0) + 1;
							const col = (d.range.start.character ?? 0) + 1;
							return `[${sev}] ${rel}:${ln}:${col} — ${d.message}`;
						})
						.join('\n');
				}
				break;
			}
			case 'goToDefinition':
				out = formatLspLocationish(await session.definition(uri, line, character, text), root);
				break;
			case 'findReferences':
				out = formatLspLocationish(await session.references(uri, line, character, text), root);
				break;
			case 'hover':
				out = formatLspHover(await session.hover(uri, line, character, text));
				break;
			case 'documentSymbol':
				out = formatLspDocumentSymbolsResult(await session.documentSymbols(uri, text), root);
				break;
			case 'workspaceSymbol':
				await session.syncDocument(uri, text);
				out = formatLspWorkspaceSymbols(await session.workspaceSymbol(''), root);
				break;
			case 'goToImplementation':
				out = formatLspLocationish(await session.implementation(uri, line, character, text), root);
				break;
			case 'prepareCallHierarchy':
				out = formatLspCallHierarchyPrepare(await session.prepareCallHierarchy(uri, line, character, text), root);
				break;
			case 'incomingCalls': {
				const items = await session.prepareCallHierarchy(uri, line, character, text);
				const arr = Array.isArray(items) ? items : items ? [items] : [];
				if (arr.length === 0) out = 'No call hierarchy item at this position.';
				else out = formatLspCallHierarchyCalls(await session.incomingCalls(arr[0]), root, 'incomingCalls');
				break;
			}
			case 'outgoingCalls': {
				const items = await session.prepareCallHierarchy(uri, line, character, text);
				const arr = Array.isArray(items) ? items : items ? [items] : [];
				if (arr.length === 0) out = 'No call hierarchy item at this position.';
				else out = formatLspCallHierarchyCalls(await session.outgoingCalls(arr[0]), root, 'outgoingCalls');
				break;
			}
			default:
				out = `Unsupported operation: ${op}`;
		}
		return { toolCallId: call.id, name: call.name, content: clampLspText(out), isError: false };
	} catch (e) {
		return {
			toolCallId: call.id,
			name: call.name,
			content: `LSP error (${op}): ${e instanceof Error ? e.message : String(e)}`,
			isError: true,
		};
	}
}
