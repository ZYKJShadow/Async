/**
 * 多轮 Agent 工具循环 — 核心引擎。
 *
 * 历史中的结构化助手消息经 `structuredAssistantToApi.ts` 展开为 OpenAI/Anthropic 原生 tool 序列；
 * 随后 `messageNormalizeForApi.ts` 做相邻 user 合并、纯文本 assistant 回溯合并、assistant 内孤儿 server/mcp tool_use 剥离（对齐 CC `normalizeMessagesForAPI` 子集），
 * 再由 `apiConversationRepair.ts` 做跨消息配对修复（孤儿 tool、缺失 tool 响应补全、Anthropic 侧孤儿 tool_result user 等），
 * 随后在发送前做 tool 配对修复；无法安全展开时仍回退单条 legacy XML。配对修复后再合并一次相邻 user，避免 repair 产生连续 user。
 *
 * 当前实现方式：
 * 1. 将对话消息 + 工具定义发给 LLM
 * 2. 如果 LLM 返回工具调用 → 执行 → 把结果加入对话 → 再次调用 LLM
 * 3. 如果 LLM 只返回文本 → 结束循环
 * 4. 工具循环轮次：默认不限制；可通过 `ASYNC_AGENT_MAX_ROUNDS` 或 `settings.agent.maxToolRounds` 设上限。
 */

import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { DeferredToolState } from '../threadStore.js';
import type { ShellSettings, ModelRequestParadigm, ThinkingLevel } from '../settingsStore.js';
import {
	assembleAgentToolPool,
	assembleVisibleAgentToolPool,
	filterMcpToolsByDenyPrefixes,
	isDeferredAgentTool,
} from './agentToolPool.js';
import type { ProviderOAuthAuthRecord } from '../settingsStore.js';
import type { TurnTokenUsage } from '../llm/types.js';
import { llmSdkResponseHeadTimeoutMs } from '../llm/sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from '../llm/llmTransportRetry.js';
import { formatLlmSdkError } from '../llm/formatLlmSdkError.js';
import { composeSystem, composeSystemSections, temperatureForMode } from '../llm/modePrompts.js';
import {
	anthropicEffectiveMaxTokens,
	anthropicEffectiveTemperature,
	anthropicThinkingBudget,
	openAICompatibleEffectiveTemperature,
	openAIReasoningEffort,
	resolveRequestedTemperature,
} from '../llm/thinkingLevel.js';
import {
	addAnthropicCacheBreakpoints,
	type AnthropicCacheBreakpointDecision,
	buildAnthropicSystemForApi,
	isAnthropicPromptCachingEnabled,
	observeAnthropicPromptCacheUsage,
} from '../llm/anthropicPromptCache.js';
import type { AnthropicToolResultBlock, AnthropicToolSchema } from '../llm/anthropicBeta.js';
import type { ComposerMode } from '../llm/composerMode.js';
import {
	isReadOnlyAgentTool,
	toOpenAITools,
	toAnthropicTools,
	type AgentToolDef,
	type ToolCall,
	type ToolResult,
} from './agentTools.js';
import type { TeamPlanQuestionRoleScope } from './planQuestionTool.js';
import { executeTool, type ToolExecutionContext, type ToolExecutionHooks } from './toolExecutor.js';
import type { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import { getMcpManager } from '../mcp/index.js';
import { getEffectiveMcpServerConfigs } from '../plugins/pluginRuntimeService.js';
import {
	applyAnthropicProviderIdentity,
	applyOpenAIProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
	providerIdentityForOAuthAuth,
} from '../llm/providerIdentity.js';
import {
	resolveProviderIdentityWithOverride,
	type ProviderIdentitySettings,
} from '../../src/providerIdentitySettings.js';
import {
	buildAnthropicUserBlocks,
	buildOpenAIUserContent,
} from '../llm/resolvedUserSerialize.js';
import type { SendableMessage } from '../llm/sendResolved.js';
import { userMessageTextForSend } from '../llm/sendResolved.js';
import { repairAgentThreadMessagesForApi } from './agentToolProtocolRepair.js';
import { StructuredAssistantBuilder } from './structuredAssistantBuilder.js';
import { parseAgentAssistantPayload } from '../../src/agentStructuredMessage.js';
import { repairAnthropicToolPairing, repairOpenAIToolPairing } from './apiConversationRepair.js';
import { createToolSearchToolHandler } from './toolSearchTool.js';
import {
	mergeAdjacentAnthropicUserMessages,
	mergeAdjacentOpenAIUserMessages,
	normalizeAnthropicMessagesForApi,
	normalizeOpenAIMessagesForApi,
} from './messageNormalizeForApi.js';
import {
	expandStructuredAssistantPayloadToAnthropic,
	expandStructuredAssistantPayloadToOpenAI,
} from './structuredAssistantToApi.js';
import type { MistakeLimitContext, MistakeLimitDecision } from './mistakeLimitGate.js';
import { resolveStreamTimeouts, createStreamTimeoutManager } from '../llm/streamTimeouts.js';
import { applyTurnToolResultBudget, normalizeToolResultReplacementState, type ToolResultReplacementState } from './toolResultBudget.js';
import { analyzeToolContext, shouldEnableAnthropicNativeDefer } from './toolContextAnalysis.js';
import {
	compactAnthropicConversationForContext,
	compactOpenAIConversationForContext,
	type AgentContextCompactState,
} from './agentConversationContext.js';
import { streamCodexOAuth } from '../llm/codexOAuthAdapter.js';
import { ensureFreshOAuthAuthForRequest } from '../llm/providerOAuthLogin.js';

export type { MistakeLimitContext, MistakeLimitDecision } from './mistakeLimitGate.js';

/** 执行工具前闸门；返回 proceed:false 时不调用 executeTool，结果写入对话为失败 tool_result */
export type BeforeExecuteToolResult = { proceed: true } | { proceed: false; rejectionMessage: string };

const DEFAULT_MAX_CONSECUTIVE_MISTAKES = 5;

/** 只读类工具：不向 UI 发送 tool_input_delta，避免参数 JSON 流式刷新；完成后由活动行渐入展示 */
const READ_TOOLS_SKIP_INPUT_DELTA = new Set([
	'Read',
	'view_image',
	'Glob',
	'Grep',
	'list_dir',
	'LSP',
	'ToolSearch',
	'ListMcpResourcesTool',
	'ReadMcpResourceTool',
	'ask_plan_question',
	'request_user_input',
	'plan_submit_draft',
	'team_plan_decide',
	'team_escalate_to_lead',
	'team_request_from_peer',
	'team_reply_to_peer',
	'Agent',
	'Task',
]);

function shouldEmitToolInputDelta(toolName: string): boolean {
	return !READ_TOOLS_SKIP_INPUT_DELTA.has(toolName);
}

/** 写入类工具：每发一帧参数增量后让出 Node 事件循环，便于 Electron 先把 IPC 交给渲染进程绘制 */
const WRITE_TOOLS_STREAM_YIELD = new Set(['Edit', 'Write']);

function yieldForToolInputStreamUi(toolName: string): Promise<void> {
	if (!WRITE_TOOLS_STREAM_YIELD.has(toolName)) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

const DEFAULT_MAX_STREAMING_TOOL_ARG_CHARS = 2_000_000;

function maxStreamingToolArgChars(): number {
	const raw = process.env.ASYNC_MAX_STREAMING_TOOL_ARG_CHARS?.trim();
	const n = raw ? Number.parseInt(raw, 10) : NaN;
	return Number.isFinite(n) && n > 10_000 ? n : DEFAULT_MAX_STREAMING_TOOL_ARG_CHARS;
}

/**
 * 未配置时为 `null`（不限制）。
 */
function resolveAgentMaxRounds(settings: ShellSettings): number | null {
	const raw = process.env.ASYNC_AGENT_MAX_ROUNDS?.trim();
	if (raw !== undefined && raw !== '') {
		const lower = raw.toLowerCase();
		if (lower === '0' || lower === 'unlimited' || lower === 'off' || lower === 'infinity') {
			return null;
		}
		const n = parseInt(raw, 10);
		if (Number.isFinite(n) && n > 0) {
			return n;
		}
	}
	const s = settings.agent?.maxToolRounds;
	if (typeof s === 'number' && Number.isFinite(s) && s > 0) {
		return Math.floor(s);
	}
	return null;
}

export type ToolInputDeltaPayload = { name: string; partialJson: string; index: number };

/**
 * tool_input_delta 即时下发。
 *
 * 曾用 queueMicrotask 合并「同一事件循环内」多次 queue，只发最后一帧。
 * 但部分流式实现会在**一个** turn 里连续多次 resolve（多段 arguments 同步到达），
 * 合并后 UI 只收到一帧，编辑卡片会像「写完全部才出现」。
 *
 * 只读类工具在调用方已跳过（READ_TOOLS_SKIP_INPUT_DELTA），此处不会因 read/search 产生 IPC 风暴。
 */
function createToolInputDeltaBatcher(
	emit: (p: ToolInputDeltaPayload) => void
): { queue: (p: ToolInputDeltaPayload) => void; flush: () => void } {
	return {
		queue(p: ToolInputDeltaPayload) {
			emit(p);
		},
		flush() {
			// 兼容流结束处仍调用 flush；即时模式下已无挂起帧
		},
	};
}

export type ToolProgressPayload = { name: string; phase: 'executing' | 'awaiting_approval'; detail?: string };

export type AgentLoopHandlers = {
	onTextDelta: (text: string) => void;
	/** 模型边生成工具 JSON 参数时流式回调（便于 UI 实时预览写入内容） */
	onToolInputDelta?: (payload: ToolInputDeltaPayload) => void;
	/** Anthropic extended thinking 流式片段（不写入持久化 assistant 正文） */
	onThinkingDelta?: (text: string) => void;
	/** 工具执行阶段（全过程可见） */
	onToolProgress?: (payload: ToolProgressPayload) => void;
	onToolCall: (name: string, args: Record<string, unknown>, toolUseId: string) => void;
	onToolResult: (name: string, result: string, success: boolean, toolUseId: string) => void;
	onDone: (fullContent: string, usage?: TurnTokenUsage) => void;
	onError: (message: string) => void;
};

export type AgentLoopOptions = {
	/** UI 里实际选中的模型条目 id；用于 memory recall/extraction 等旁路调用 */
	modelSelection?: string;
	requestModelId: string;
	paradigm: ModelRequestParadigm;
	/** 与 UnifiedChatOptions 一致：已由 modelResolve 解析 */
	requestApiKey: string;
	requestBaseURL?: string;
	/** OpenAI 兼容：提供商级代理 */
	requestProxyUrl?: string;
	/** 当前提供商 id（来自 modelResolve）。 */
	requestProviderId?: string;
	/** 当前提供商对全局「模型提供商标识」的覆盖。 */
	requestProviderIdentity?: ProviderIdentitySettings;
	/** 当前提供商的 OAuth 凭据（Codex / Claude Code / Antigravity）。 */
	requestOAuthAuth?: ProviderOAuthAuthRecord;
	maxOutputTokens: number;
	contextWindowTokens?: number;
	temperatureMode?: 'auto' | 'custom';
	temperature?: number;
	signal: AbortSignal;
	/** 与主界面 Composer 模式一致；Plan 仅注册只读工具 */
	composerMode: ComposerMode;
	/** 子 Agent 等场景覆盖默认工具池（非空则跳过 assembleAgentToolPool） */
	toolPoolOverride?: AgentToolDef[];
	agentSystemAppend?: string;
	toolHooks?: ToolExecutionHooks;
	customToolHandlers?: Record<
		string,
		(
			call: ToolCall,
			hooks: ToolExecutionHooks,
			execCtx: ToolExecutionContext
		) => Promise<ToolResult> | ToolResult
	>;
	/** 线程级延迟工具发现状态（优先于旧的 discoveredDeferredToolNames 传递）。 */
	deferredToolState?: DeferredToolState;
	/** 兼容旧调用方：若未提供 deferredToolState，则退回使用此字段。 */
	discoveredDeferredToolNames?: string[];
	/** 当 ToolSearch 加载了新工具后回调，用于把状态持久化到线程。 */
	onDeferredToolStateChange?: (state: DeferredToolState) => void;
	/** 兼容旧调用方：若设置，会在 deferred state 更新后同步回调 discoveredToolNames。 */
	onDiscoveredDeferredToolsChange?: (names: string[]) => void;
	toolResultReplacementState?: ToolResultReplacementState;
	onToolResultReplacementStateChange?: (state: ToolResultReplacementState) => void;
	contextCompactState?: AgentContextCompactState;
	onContextCompactStateChange?: (state: AgentContextCompactState) => void;
	/** 在 executeTool 之前调用；用于 shell 写入等需用户确认的闸门 */
	beforeExecuteTool?: (call: ToolCall) => Promise<BeforeExecuteToolResult>;
	thinkingLevel?: ThinkingLevel;
	/** 连续工具失败（含用户拒绝执行）达到阈值时回调；未设置则达到阈值后仅重置计数并继续 */
	onMistakeLimitReached?: (ctx: MistakeLimitContext) => Promise<MistakeLimitDecision>;
	maxConsecutiveMistakes?: number;
	/** 默认 true */
	mistakeLimitEnabled?: boolean;
	/**
	 * 当前嵌套深度：根循环为 0；子 Agent 内为 1。用于禁止多层 Agent 而不依赖全局状态。
	 */
	delegateExecutionDepth?: number;
	/** 发起 Agent 的窗口当前工作区根 */
	workspaceRoot?: string | null;
	/** 与 workspaceRoot 同窗的多语言 LSP 路由（插件 `.lsp.json` + 可选 settings.lsp 迁移 + 若存在则探测 typescript-language-server） */
	workspaceLspManager?: WorkspaceLspManager | null;
	/** 当前会话线程 ID，用于 TodoWrite 等按线程隔离状态的工具 */
	threadId?: string | null;
	/** 发起本轮 Agent 的宿主渲染进程 webContents id，用于控制当前窗口的内置浏览器等 UI 能力 */
	hostWebContentsId?: number | null;
	/**
	 * Team 子循环：与流式 `teamRoleScope` 对齐，供 `ask_plan_question` 把澄清题挂到对应角色工作流。
	 */
	teamToolRoleScope?: TeamPlanQuestionRoleScope;
	/**
	 * Called before each LLM round. Use this to inject additional user/assistant messages into a running loop.
	 */
	beforeRoundMessages?: () => Promise<SendableMessage[]>;
	/**
	 * Anthropic：prompt cache 断点挂在倒数第二条消息，避免无后续读取的尾部写入 KVCC。
	 */
	skipAnthropicPromptCacheWrite?: boolean;
};

/**
 * Some OpenAI-compatible gateways wrap the final assistant text as:
 * `{ "content": "...", "input_tokens": 123, "output_tokens": 456 }`
 * In Agent mode we want the actual assistant markdown, not the transport envelope.
 */
function unwrapAssistantContentEnvelope(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
		return text;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return text;
		}
		const content = (parsed as { content?: unknown }).content;
		if (typeof content !== 'string' || !content.trim()) {
			return text;
		}
		return content;
	} catch {
		return text;
	}
}

/**
 * 许多 OpenAI 兼容网关会先流式下发 `function.arguments`，`function.name` 晚几帧才到。
 * 若仅在 `name` 已有时才触发 `onToolInputDelta`，则整段参数流式阶段 UI 完全收不到增量，代码卡片会像「一次性出现」。
 * 根据已出现的 JSON 键名猜测工具（与 agentTools 名称一致）；正式 `name` 到达后下一轮 chunk 会纠正。
 * `Read` / `Glob` / `Grep` / `list_dir` 等只读工具不发 `onToolInputDelta`（见 READ_TOOLS_SKIP_INPUT_DELTA）。**Bash** 会发增量（命令参数流式展示）。
 */
function inferOpenAIToolNameFromPartialArguments(partial: string): string {
	const c = partial.replace(/\s+/g, '');
	if (!c) return '';
	if (c.includes('"old_str"') || c.includes('"new_str"') || c.includes('"old_string"') || c.includes('"new_string"'))
		return 'Edit';
	if (c.includes('"content"')) return 'Write';
	if (c.includes('"pattern"')) return 'Grep';
	if (
		/\"operation\"\s*:\s*\"(goToDefinition|findReferences|hover|documentSymbol|workspaceSymbol|goToImplementation|prepareCallHierarchy|incomingCalls|outgoingCalls|getDiagnostics)\"/.test(
			c
		)
	)
		return 'LSP';
	if (c.includes('"filePath"')) return 'LSP';
	if (c.includes('"command"')) return 'Bash';
	if (c.includes('"run_in_background"')) return 'Agent';
	if (c.includes('"prompt"') || c.includes('"subagent_type"')) return 'Agent';
	if (c.includes('"questions"') && c.includes('"header"') && c.includes('"description"')) return 'request_user_input';
	if (c.includes('"offset"') || c.includes('"limit"') || c.includes('"start_line"') || c.includes('"end_line"')) return 'Read';
	if (c.includes('"file_path"')) return 'Read';
	if (c.includes('"path"')) return 'Read';
	if (c.includes('"question"') && c.includes('"options"')) return 'ask_plan_question';
	return '';
}

/**
 * 组装本轮回合的工具表：
 * - Plan：仅只读内置工具 + List/Read MCP 资源工具；不注册动态 `mcp__*` 工具。
 * - Agent：内置 + 过滤后的动态 MCP 工具；同名以内置为准。
 */
function agentToolDefsForLoop(
	composerMode: ComposerMode,
	settings: ShellSettings,
	override?: AgentToolDef[]
): AgentToolDef[] {
	if (override && override.length > 0) {
		return override;
	}
	return assembleAgentToolPool(composerMode, {
		mcpToolDenyPrefixes: settings.mcpToolDenyPrefixes,
	});
}

function normalizeToolNameList(values: Iterable<string>): string[] {
	return [...new Set(Array.from(values).map((value) => String(value ?? '').trim()).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b)
	);
}

function normalizeDeferredToolStateForLoop(
	state?: DeferredToolState | null,
	discoveredDeferredToolNames?: string[]
): DeferredToolState {
	return {
		discoveredToolNames: normalizeToolNameList([
			...(state?.discoveredToolNames ?? []),
			...(discoveredDeferredToolNames ?? []),
		]),
		...(state?.providerLoadedToolNames
			? {
					providerLoadedToolNames: {
						...(state.providerLoadedToolNames.anthropic?.length
							? { anthropic: normalizeToolNameList(state.providerLoadedToolNames.anthropic) }
							: {}),
						...(state.providerLoadedToolNames.openai?.length
							? { openai: normalizeToolNameList(state.providerLoadedToolNames.openai) }
							: {}),
					},
				}
			: {}),
	};
}

function emitDeferredToolStateChange(
	options: AgentLoopOptions,
	state: DeferredToolState
): void {
	options.onDeferredToolStateChange?.(state);
	options.onDiscoveredDeferredToolsChange?.(state.discoveredToolNames);
}

function visibleAgentToolDefsForLoop(
	composerMode: ComposerMode,
	settings: ShellSettings,
	discoveredDeferredToolNames: Iterable<string>,
	override?: AgentToolDef[],
	nativeDeferEnabled?: boolean
): AgentToolDef[] {
	return assembleVisibleAgentToolPool(composerMode, {
		mcpToolDenyPrefixes: settings.mcpToolDenyPrefixes,
		discoveredDeferredToolNames,
		override,
		nativeDeferEnabled,
	});
}

function appendMcpToolsSystemHint(
	systemContent: string,
	composerMode: ComposerMode,
	settings: ShellSettings
): string {
	if (composerMode !== 'agent' && composerMode !== 'team') {
		return systemContent;
	}
	const mcpTools = filterMcpToolsByDenyPrefixes(
		getMcpManager().getAgentTools(),
		settings.mcpToolDenyPrefixes
	);
	const n = mcpTools.length;
	if (n === 0) {
		return systemContent;
	}
	const hint = [
		`## MCP tools (${n})`,
		'Additional tools from configured Model Context Protocol servers use names prefixed `mcp__`.',
		'Most MCP tools are loaded on demand. Use `ToolSearch` to discover and load the relevant MCP tool before calling it directly.',
		'Use `ListMcpResourcesTool` / `ReadMcpResourceTool` to browse MCP resources when needed.',
		'Use them when the user needs integrations beyond the built-in workspace tools (e.g. web, APIs, databases). Follow each tool\'s description and parameter schema.',
	].join('\n');
	if (!systemContent.trim()) {
		return hint;
	}
	return [
		systemContent,
		'',
		hint,
	].join('\n');
}

function appendMessagesToOpenAIConversation(conversation: OAIMsg[], messages: SendableMessage[]): OAIMsg[] {
	let next = [...conversation];
	for (const message of messages) {
		if (message.role === 'system') {
			continue;
		}
		if (message.role === 'assistant') {
			const payload = parseAgentAssistantPayload(message.content);
			if (payload) {
				next.push(...expandStructuredAssistantPayloadToOpenAI(payload));
			} else {
				next.push({ role: 'assistant', content: message.content });
			}
			continue;
		}
		next.push({
			role: 'user',
			content:
				message.resolved && message.resolved.hasImages
					? buildOpenAIUserContent(message.resolved)
					: userMessageTextForSend(message),
		});
	}
	return mergeAdjacentOpenAIUserMessages(next);
}

function appendMessagesToAnthropicConversation(
	conversation: MessageParam[],
	messages: SendableMessage[]
): MessageParam[] {
	let next = [...conversation];
	for (const message of messages) {
		if (message.role === 'system') {
			continue;
		}
		if (message.role === 'assistant') {
			const payload = parseAgentAssistantPayload(message.content);
			if (payload) {
				next.push(...expandStructuredAssistantPayloadToAnthropic(payload));
			} else {
				next.push({ role: 'assistant', content: message.content });
			}
			continue;
		}
		next.push({
			role: 'user',
			content:
				message.resolved && message.resolved.hasImages
					? buildAnthropicUserBlocks(message.resolved)
					: userMessageTextForSend(message),
		});
	}
	return mergeAdjacentAnthropicUserMessages(next);
}

/**
 * 为工具会话准备 MCP 配置与已连客户端视图。
 * 不在发送前自动拉起未连接 MCP，避免非已连接服务拖慢对话发送。
 */
async function prepareMcpConnectionsForSession(
	composerMode: ComposerMode,
	userMcpServers: ShellSettings['mcpServers'],
	workspaceRoot: string | null
): Promise<void> {
	if (composerMode !== 'agent' && composerMode !== 'plan' && composerMode !== 'team') {
		return;
	}
	const mcpT0 = Date.now();
	const mgr = getMcpManager();
	mgr.loadConfigs(getEffectiveMcpServerConfigs(userMcpServers, workspaceRoot));
	console.log(
		`[AgentLoop] MCP prepare done (${Date.now() - mcpT0}ms) mode=${composerMode} connected=${mgr.getConnectedClients().length} — disconnected MCP servers are not auto-started during send`
	);
}

export async function runAgentLoop(
	settings: ShellSettings,
	threadMessages: SendableMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
	const loopT0 = Date.now();
	const tid = options.threadId ?? 'n/a';
	console.log(
		`[AgentLoop] runAgentLoop enter thread=${tid} paradigm=${options.paradigm} mode=${options.composerMode} msgCount=${threadMessages.length}`
	);
	const repairStart = Date.now();
	const messagesForApi = repairAgentThreadMessagesForApi(threadMessages);
	console.log(`[AgentLoop] repairAgentThreadMessagesForApi (${Date.now() - repairStart}ms) thread=${tid}`);
	await prepareMcpConnectionsForSession(options.composerMode, settings.mcpServers, options.workspaceRoot ?? null);
	console.log(
		`[AgentLoop] after MCP prepare, before ${options.paradigm === 'anthropic' ? 'Anthropic' : 'OpenAI'} loop (${Date.now() - loopT0}ms since runAgentLoop enter) thread=${tid}`
	);
	switch (options.paradigm) {
		case 'anthropic':
			return runAnthropicLoop(settings, messagesForApi, options, handlers);
		case 'openai-compatible':
		default:
			return runOpenAILoop(settings, messagesForApi, options, handlers);
	}
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** 最大只读工具并发数，避免大批量 Read/Glob 同时打盘 */
const MAX_TOOL_CONCURRENCY = 10;

/**
 * 带并发上限的批量执行，保证结果顺序与输入一致。
 */
async function runBatchWithLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
	const results: T[] = new Array(tasks.length);
	let nextIdx = 0;
	async function worker(): Promise<void> {
		while (nextIdx < tasks.length) {
			const i = nextIdx++;
			results[i] = await tasks[i]!();
		}
	}
	const workerCount = Math.min(limit, tasks.length);
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
}

/**
 * 当 assistant 消息已写入 conversation 但工具执行被中断时，
 * 为每个未收到 tool_result 的 tool_call 补充合成的失败结果，
 * 避免下一轮 API 调用因 unmatched tool_use_id 报错。
 */
function synthesizeMissingOpenAIToolResults(
	conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
	turnToolCalls: { id: string; name: string; arguments: string }[],
	reason: string
): void {
	const named = turnToolCalls.filter((tc) => tc.name && tc.id);
	if (named.length === 0) return;
	// 检查最后一条 assistant 消息是否已包含这些 tool_calls（才需要补全）
	const last = conversation[conversation.length - 1];
	if (!last || last.role !== 'assistant') return;
	for (const tc of named) {
		conversation.push({
			role: 'tool',
			tool_call_id: tc.id,
			content: `Tool execution aborted: ${reason}`,
		});
	}
}

function synthesizeMissingAnthropicToolResults(
	conversation: import('@anthropic-ai/sdk/resources/messages').MessageParam[],
	turnToolUses: { id: string; name: string; input: string }[],
	reason: string
): void {
	if (turnToolUses.length === 0) return;
	const last = conversation[conversation.length - 1];
	if (!last || last.role !== 'assistant') return;
	const results: import('@anthropic-ai/sdk/resources/messages').ToolResultBlockParam[] = turnToolUses.map((tu) => ({
		type: 'tool_result' as const,
		tool_use_id: tu.id,
		content: `Tool execution aborted: ${reason}`,
		is_error: true,
	}));
	conversation.push({ role: 'user', content: results });
}

// ─── OpenAI-compatible agent loop ───────────────────────────────────────────

type OAIMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function anthropicImageDataUrlFromStructuredToolResult(content: ToolResult['structuredContent']): string | null {
	if (!Array.isArray(content)) {
		return null;
	}
	for (const block of content) {
		if (
			block &&
			typeof block === 'object' &&
			(block as { type?: unknown }).type === 'image'
		) {
			const source = (block as { source?: { type?: unknown; media_type?: unknown; data?: unknown } }).source;
			if (
				source?.type === 'base64' &&
				typeof source.media_type === 'string' &&
				typeof source.data === 'string' &&
				source.data.length > 0
			) {
				return `data:${source.media_type};base64,${source.data}`;
			}
		}
	}
	return null;
}

function buildOpenAIViewImageFollowupMessage(results: ToolResult[]): OAIMsg | null {
	const imageUrls = results
		.map((result) => anthropicImageDataUrlFromStructuredToolResult(result.structuredContent))
		.filter((value): value is string => typeof value === 'string' && value.length > 0);
	if (imageUrls.length === 0) {
		return null;
	}
	return {
		role: 'user',
		content: [
			{
				type: 'text',
				text: '[Tool context] The previous view_image tool loaded local workspace image(s) for inspection. Use them as tool context, not as a new user request.',
			},
			...imageUrls.map((url) => ({
				type: 'image_url' as const,
				image_url: { url },
			})),
		],
	};
}

function threadToOpenAI(
	messages: SendableMessage[],
	systemContent: string
): OAIMsg[] {
	const out: OAIMsg[] = [{ role: 'system', content: systemContent }];
	for (const m of messages) {
		if (m.role === 'system') continue;
		if (m.role === 'assistant') {
			const p = parseAgentAssistantPayload(m.content);
			if (p) {
				out.push(...expandStructuredAssistantPayloadToOpenAI(p));
			} else {
				out.push({ role: 'assistant', content: m.content });
			}
		} else {
			out.push({
				role: 'user',
				content:
					m.resolved && m.resolved.hasImages
						? buildOpenAIUserContent(m.resolved)
						: userMessageTextForSend(m),
			});
		}
	}
	return out;
}

async function runOpenAILoop(
	settings: ShellSettings,
	threadMessages: SendableMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
	if (options.requestOAuthAuth?.provider === 'codex') {
		await streamCodexOAuth(
			settings,
			threadMessages,
			{
				mode: options.composerMode,
				signal: options.signal,
				requestModelId: options.requestModelId,
				paradigm: options.paradigm,
				requestApiKey: options.requestApiKey,
				requestBaseURL: options.requestBaseURL,
				requestProxyUrl: options.requestProxyUrl,
				requestProviderId: options.requestProviderId,
				requestProviderIdentity: options.requestProviderIdentity,
				requestOAuthAuth: options.requestOAuthAuth,
				maxOutputTokens: options.maxOutputTokens,
				contextWindowTokens: options.contextWindowTokens,
				temperatureMode: options.temperatureMode,
				temperature: options.temperature,
				agentSystemAppend: options.agentSystemAppend,
				thinkingLevel: options.thinkingLevel,
				workspaceRoot: options.workspaceRoot,
			},
			{
				onDelta: handlers.onTextDelta,
				onThinkingDelta: handlers.onThinkingDelta,
				onDone: handlers.onDone,
				onError: handlers.onError,
			},
			options.requestOAuthAuth
		);
		return;
	}

	const key = options.requestApiKey.trim();
	if (!key) { handlers.onError('未配置 OpenAI 兼容 API Key。请在设置 → 模型中填写。'); return; }

	const baseURL = options.requestBaseURL?.trim() || undefined;
	const model = options.requestModelId.trim();
	if (!model) { handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。'); return; }

	const openaiSyncPrepStart = Date.now();

	const proxyRaw = (options.requestProxyUrl?.trim() || settings.openAI?.proxyUrl?.trim()) ?? '';
	let httpAgent: InstanceType<typeof HttpsProxyAgent> | undefined;
	if (proxyRaw) {
		try { httpAgent = new HttpsProxyAgent(proxyRaw); } catch {
			handlers.onError('代理地址无效。'); return;
		}
	}

	const client = new OpenAI(
		applyOpenAIProviderIdentity(settings, {
			apiKey: key,
			baseURL,
			httpAgent,
			dangerouslyAllowBrowser: false,
			timeout: llmSdkResponseHeadTimeoutMs(),
			maxRetries: 0,
		}, options.requestProviderIdentity)
	);
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const systemContent = appendMcpToolsSystemHint(
		prependProviderIdentitySystemPrompt(
			settings,
			composeSystem(storedSystem?.content, options.composerMode, options.agentSystemAppend),
			options.requestProviderIdentity
		),
		options.composerMode,
		settings
	);
	const requestedTemperature = resolveRequestedTemperature(
		temperatureForMode(options.composerMode),
		options.temperatureMode,
		options.temperature
	);
	const temperature =
		options.temperatureMode === 'custom' && options.temperature != null
			? requestedTemperature
			: openAICompatibleEffectiveTemperature(model, requestedTemperature);
	let deferredToolState = normalizeDeferredToolStateForLoop(
		options.deferredToolState,
		options.discoveredDeferredToolNames
	);
	const discoveredDeferredToolNames = new Set(deferredToolState.discoveredToolNames);
	const markDeferredToolsDiscovered = (names: string[]): string[] => {
		const added: string[] = [];
		for (const name of names) {
			const trimmed = String(name ?? '').trim();
			if (!trimmed || discoveredDeferredToolNames.has(trimmed)) {
				continue;
			}
			discoveredDeferredToolNames.add(trimmed);
			added.push(trimmed);
		}
		if (added.length > 0) {
			deferredToolState = normalizeDeferredToolStateForLoop({
				...deferredToolState,
				discoveredToolNames: [...discoveredDeferredToolNames],
				providerLoadedToolNames: {
					...(deferredToolState.providerLoadedToolNames ?? {}),
					openai: normalizeToolNameList([
						...(deferredToolState.providerLoadedToolNames?.openai ?? []),
						...added,
					]),
				},
			});
			emitDeferredToolStateChange(options, deferredToolState);
		}
		return added;
	};
	const resolveFullToolPool = () =>
		agentToolDefsForLoop(options.composerMode, settings, options.toolPoolOverride);
	const resolveVisibleToolPool = () =>
		visibleAgentToolDefsForLoop(
			options.composerMode,
			settings,
			discoveredDeferredToolNames,
			options.toolPoolOverride
		);
	const resolveToolDefsByName = () => new Map(resolveFullToolPool().map((tool) => [tool.name, tool] as const));
	const mergedCustomToolHandlers = {
		ToolSearch: createToolSearchToolHandler({
			resolveFullToolPool,
			discoverTools: markDeferredToolsDiscovered,
		}),
		...(options.customToolHandlers ?? {}),
	};

	let conversation: OAIMsg[] = normalizeOpenAIMessagesForApi(threadToOpenAI(threadMessages, systemContent));
	conversation = repairOpenAIToolPairing(conversation);
	conversation = mergeAdjacentOpenAIUserMessages(conversation);
	const structured = new StructuredAssistantBuilder();
	const effort = openAIReasoningEffort(options.thinkingLevel ?? 'off');
	let accUsage: TurnTokenUsage | undefined;

	const mistakeLimitEnabled = options.mistakeLimitEnabled !== false;
	const threshold = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
	let consecutiveToolFailures = 0;
	let toolResultReplacementState = normalizeToolResultReplacementState(
		options.toolResultReplacementState
	);

	const MAX_OUTPUT_RECOVERY_LIMIT = 3;
	let outputRecoveryCount = 0;

	type TurnTc = { id: string; name: string; arguments: string };
	type OpenAIToolExecution = {
		call: TurnTc;
		args: Record<string, unknown>;
		result: ToolResult;
	};

	const toolDeltaBatcher = createToolInputDeltaBatcher((p) => handlers.onToolInputDelta?.(p));
	const maxToolArgChars = maxStreamingToolArgChars();
	const toolExecCtx: ToolExecutionContext = {
		delegateExecutionDepth: options.delegateExecutionDepth ?? 0,
		workspaceRoot: options.workspaceRoot ?? null,
		workspaceLspManager: options.workspaceLspManager ?? null,
		threadId: options.threadId ?? null,
		hostWebContentsId: options.hostWebContentsId ?? null,
		signal: options.signal,
		teamToolRoleScope: options.teamToolRoleScope,
		customToolHandlers: mergedCustomToolHandlers,
	};
	async function handleMistakeLimitBeforeRound(): Promise<boolean> {
		if (!mistakeLimitEnabled || consecutiveToolFailures < threshold) {
			return false;
		}
		if (options.onMistakeLimitReached) {
			const d = await options.onMistakeLimitReached({
				consecutiveFailures: consecutiveToolFailures,
				threshold,
			});
			if (d.action === 'stop') {
				handlers.onDone(structured.serialize());
				return true;
			}
			if (d.action === 'continue') {
				consecutiveToolFailures = 0;
			} else if (d.action === 'hint') {
				consecutiveToolFailures = 0;
				conversation.push({
					role: 'user',
					content: `[User feedback after repeated tool failures]\n${d.userText}`,
				});
			}
			return false;
		}
		consecutiveToolFailures = 0;
		return false;
	}

	async function runOneOpenAITool(tc: TurnTc): Promise<OpenAIToolExecution> {
		let args: Record<string, unknown>;
		try {
			args = JSON.parse(tc.arguments || '{}');
		} catch (parseErr) {
			const msg = `工具参数 JSON 无效：${parseErr instanceof Error ? parseErr.message : String(parseErr)}。请提供合法的 JSON。`;
			if (mistakeLimitEnabled) consecutiveToolFailures++;
			return {
				call: tc,
				args: {},
				result: { toolCallId: tc.id, name: tc.name, content: msg, isError: true },
			};
		}

		const toolCall: ToolCall = { id: tc.id, name: tc.name, arguments: args };

		handlers.onToolCall(tc.name, args, tc.id);
		await new Promise<void>((r) => setTimeout(r, 0));

		const gateStart = Date.now();
		console.log(`[AgentLoop] tool=${tc.name} — beforeExecuteTool start`);
		let gate: BeforeExecuteToolResult = { proceed: true };
		if (options.beforeExecuteTool) {
			try {
				gate = await options.beforeExecuteTool(toolCall);
			} catch (e) {
				gate = {
					proceed: false,
					rejectionMessage: e instanceof Error ? e.message : String(e),
				};
			}
		}
		console.log(`[AgentLoop] tool=${tc.name} — beforeExecuteTool done (${Date.now() - gateStart}ms, proceed=${gate.proceed})`);
		if (!gate.proceed) {
			const msg = gate.rejectionMessage;
			if (mistakeLimitEnabled) consecutiveToolFailures++;
			return {
				call: tc,
				args,
				result: { toolCallId: tc.id, name: tc.name, content: msg, isError: true },
			};
		}

		handlers.onToolProgress?.({ name: tc.name, phase: 'executing' });
		const execStart = Date.now();
		console.log(`[AgentLoop] tool=${tc.name} — executeTool start`);
		const result = await executeTool(toolCall, options.toolHooks, toolExecCtx);
		console.log(`[AgentLoop] tool=${tc.name} — executeTool done (${Date.now() - execStart}ms, error=${result.isError})`);
		if (mistakeLimitEnabled) {
			if (result.isError) {
				consecutiveToolFailures++;
			} else {
				consecutiveToolFailures = 0;
			}
		}

		return { call: tc, args, result };
	}

	async function flushOpenAIToolsInOrder(
		turnToolCalls: TurnTc[]
	): Promise<OAIMsg[]> {
		const withNames = turnToolCalls.filter((tc) => tc.name);
		const executed: OpenAIToolExecution[] = [];
		let i = 0;
		while (i < withNames.length) {
			const cur = withNames[i]!;
			if (isReadOnlyAgentTool(cur.name)) {
				let j = i;
				while (j < withNames.length && isReadOnlyAgentTool(withNames[j]!.name)) {
					j++;
				}
				const batch = withNames.slice(i, j);
				const outs = await runBatchWithLimit(
					batch.map((b) => () => runOneOpenAITool(b)),
					MAX_TOOL_CONCURRENCY
				);
				executed.push(...outs);
				i = j;
			} else {
				executed.push(await runOneOpenAITool(cur));
				i++;
			}
		}
		if (executed.length === 0) {
			return [];
		}
		const budgeted = await applyTurnToolResultBudget(
			executed.map((item) => item.result),
			resolveToolDefsByName(),
			toolResultReplacementState,
			toolExecCtx
		);
		toolResultReplacementState = budgeted.state;
		options.onToolResultReplacementStateChange?.(toolResultReplacementState);
		const toolMessages: OAIMsg[] = executed.map((item, index) => {
			const adjusted = budgeted.results[index]!;
			structured.pushTool(
				item.call.id,
				item.call.name,
				item.args,
				adjusted.content,
				!adjusted.isError,
				adjusted.structuredContent
			);
			handlers.onToolResult(
				item.call.name,
				adjusted.content,
				!adjusted.isError,
				item.call.id
			);
			return {
				role: 'tool',
				tool_call_id: item.call.id,
				content: adjusted.content,
			};
		});
		const followup = buildOpenAIViewImageFollowupMessage(budgeted.results);
		return followup ? [...toolMessages, followup] : toolMessages;
	}

	const streamTimeoutConfig = resolveStreamTimeouts(settings);
	const maxRounds = resolveAgentMaxRounds(settings);
	console.log(
		`[AgentLoop] OpenAI sync prep done (${Date.now() - openaiSyncPrepStart}ms) convMsgs=${conversation.length} deferredLoaded=${discoveredDeferredToolNames.size} thread=${options.threadId ?? 'n/a'}`
	);
	console.log(
		`[AgentLoop] OpenAI loop start — idleMs=${streamTimeoutConfig.idleMs} hardMs=${streamTimeoutConfig.hardMs} watchdog=${streamTimeoutConfig.idleWatchdogEnabled} maxRounds=${maxRounds ?? '∞'}`
	);

	for (let round = 0; maxRounds == null || round < maxRounds; round++) {
		if (options.signal.aborted) { console.log(`[AgentLoop] round ${round} — aborted before start`); break; }

		if (await handleMistakeLimitBeforeRound()) {
			return;
		}
		if (options.beforeRoundMessages) {
			const injected = await options.beforeRoundMessages();
			if (injected.length > 0) {
				conversation = appendMessagesToOpenAIConversation(conversation, injected);
			}
		}
		const compactedForContext = compactOpenAIConversationForContext(conversation, {
			model,
			apiKey: key,
			baseURL,
			proxyUrl: proxyRaw || undefined,
			providerIdentity: resolveProviderIdentityWithOverride(settings.providerIdentity, options.requestProviderIdentity),
			contextWindowTokens: options.contextWindowTokens,
			maxOutputTokens: options.maxOutputTokens,
			state: options.contextCompactState,
			onStateChange: options.onContextCompactStateChange,
			signal: options.signal,
		});
		const compactedForContextResolved = await compactedForContext;
		if (compactedForContextResolved.changed) {
			conversation = compactedForContextResolved.messages;
			console.log(
				`[AgentLoop] round ${round} — context compacted provider=openai mode=${compactedForContextResolved.mode} before=${compactedForContextResolved.estimatedTokensBefore} after=${compactedForContextResolved.estimatedTokensAfter} compactedMessages=${compactedForContextResolved.compactedMessages} clearedToolResults=${compactedForContextResolved.clearedToolResults}${compactedForContextResolved.error ? ` error=${compactedForContextResolved.error}` : ''}`
			);
		}

		console.log(`[AgentLoop] round ${round} — starting LLM call`);
		const roundStartAt = Date.now();
		const tools = toOpenAITools(resolveVisibleToolPool());
		let turnText = '';
		const turnToolCalls: TurnTc[] = [];
		let turnFinishReason: string | null = null;

		// 每轮创建独立 AbortController，叠加在外部 signal 之上，用于超时自动中止
		const roundAc = new AbortController();
		const roundSignal = roundAc.signal;
		let activeStream: { controller?: { abort?: () => void } } | null = null;
		const onOuterAbort = () => {
			roundAc.abort();
			try {
				activeStream?.controller?.abort?.();
			} catch {
				/* ignore */
			}
		};
		// 修复竞态：若 signal 已 aborted，直接同步 abort roundAc
		if (options.signal.aborted) {
			roundAc.abort();
		} else {
			options.signal.addEventListener('abort', onOuterAbort, { once: true });
		}

		const timeoutMgr = createStreamTimeoutManager(streamTimeoutConfig, () => roundAc.abort());
		timeoutMgr.start();

		try {
			const stream = await withLlmTransportRetry(
				() =>
					client.chat.completions.create(
						{
							model,
							messages: conversation,
							tools,
							stream: true,
							stream_options: { include_usage: true },
							temperature,
							max_completion_tokens: options.maxOutputTokens,
							...(effort ? { reasoning_effort: effort } : {}),
						},
						{ signal: roundSignal }
					),
				{ signal: options.signal }
			);
			activeStream = stream as { controller?: { abort?: () => void } };

			for await (const chunk of stream) {
				if (roundSignal.aborted) break;
				timeoutMgr.onChunk();

				if (chunk.usage) {
					accUsage = {
						inputTokens: (accUsage?.inputTokens ?? 0) + (chunk.usage.prompt_tokens ?? 0),
						outputTokens: (accUsage?.outputTokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
					};
				}

				const choice = chunk.choices[0];
				if (!choice) continue;

				if (choice.finish_reason) {
					turnFinishReason = choice.finish_reason;
				}

				const delta = choice.delta;
				if (!delta) continue;

				if (delta.content) {
					turnText += delta.content;
					handlers.onTextDelta(delta.content);
				}

				// OpenAI 兼容：部分网关提供 reasoning_content（如 DeepSeek）
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const reasoningPiece = (delta as any)?.reasoning_content;
				if (typeof reasoningPiece === 'string' && reasoningPiece) {
					handlers.onThinkingDelta?.(reasoningPiece);
				}

				if (delta.tool_calls) {
					for (const tc of delta.tool_calls) {
						const idx = tc.index;
						while (turnToolCalls.length <= idx) {
							turnToolCalls.push({ id: '', name: '', arguments: '' });
						}
						const row = turnToolCalls[idx]!;
						if (tc.id) row.id = tc.id;
						if (tc.function?.name) row.name = tc.function.name;
						if (tc.function?.arguments) {
							row.arguments += tc.function.arguments;
							const effectiveToolName = row.name || inferOpenAIToolNameFromPartialArguments(row.arguments) || '(pending)';
							if (row.arguments.length > maxToolArgChars) {
								throw new Error(
									`Streaming tool arguments exceeded safe limit (${maxToolArgChars} chars) for ${effectiveToolName}.`
								);
							}
						}
						if (!row.arguments || !handlers.onToolInputDelta) continue;
						const effectiveName = row.name || inferOpenAIToolNameFromPartialArguments(row.arguments);
						if (effectiveName && shouldEmitToolInputDelta(effectiveName)) {
							toolDeltaBatcher.queue({ name: effectiveName, partialJson: row.arguments, index: idx });
							await yieldForToolInputStreamUi(effectiveName);
						}
					}
				}
			}
			toolDeltaBatcher.flush();
		} catch (e: unknown) {
			toolDeltaBatcher.flush();
			timeoutMgr.stop();
			if (options.signal.aborted) {
				synthesizeMissingOpenAIToolResults(conversation, turnToolCalls, '已中止生成');
				break;
			}
			if (roundSignal.aborted && !options.signal.aborted) {
				// 超时中止：保留已生成内容，以 onDone 结束而非 onError 丢弃
				const partialText = unwrapAssistantContentEnvelope(turnText);
				structured.appendText(partialText);
				handlers.onDone(structured.serialize(), accUsage);
				return;
			}
			const errText = formatLlmSdkError(e);
			synthesizeMissingOpenAIToolResults(conversation, turnToolCalls, errText);
			handlers.onError(errText);
			return;
		} finally {
			activeStream = null;
			options.signal.removeEventListener('abort', onOuterAbort);
		}
		timeoutMgr.stop();
		console.log(`[AgentLoop] round ${round} — stream done (${Date.now() - roundStartAt}ms), finishReason=${turnFinishReason}, toolCalls=${turnToolCalls.filter(tc => tc.name).length}, textLen=${turnText.length}`);

		if (options.signal.aborted || roundSignal.aborted) {
			console.log(`[AgentLoop] round ${round} — aborted after stream`);
			synthesizeMissingOpenAIToolResults(conversation, turnToolCalls, '已中止生成');
			break;
		}

		turnText = unwrapAssistantContentEnvelope(turnText);
		structured.appendText(turnText);

		if (turnToolCalls.length === 0 || turnToolCalls.every((tc) => !tc.name)) {
			// 检测 max_output_tokens 截断，尝试自动续写
			if (
				turnFinishReason === 'length' &&
				outputRecoveryCount < MAX_OUTPUT_RECOVERY_LIMIT
			) {
				outputRecoveryCount++;
				conversation.push({ role: 'assistant', content: turnText });
				conversation.push({
					role: 'user',
					content:
						'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
						'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
				});
				continue;
			}
			conversation.push({ role: 'assistant', content: turnText });
			break;
		}

		const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
			role: 'assistant',
			content: turnText || null,
			tool_calls: turnToolCalls
				.filter((tc) => tc.name)
				.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: tc.arguments },
				})),
		};
		conversation.push(assistantMsg);

		console.log(`[AgentLoop] round ${round} — executing ${turnToolCalls.filter(tc => tc.name).length} tool(s)`);
		const toolsStart = Date.now();
		const toolMessages = await flushOpenAIToolsInOrder(turnToolCalls);
		conversation.push(...toolMessages);
		console.log(`[AgentLoop] round ${round} — tools done (${Date.now() - toolsStart}ms)`);

		if (maxRounds != null && round === maxRounds - 1) {
			console.warn(`[AgentLoop] max tool rounds (${maxRounds}) exhausted — ending loop`);
			const warn = `\n\n---\n⚠ 已达到单次对话最大工具轮次 (${maxRounds})，自动停止。请发送新消息继续。`;
			structured.appendText(warn);
			handlers.onTextDelta(warn);
		}
	}

	console.log(`[AgentLoop] OpenAI loop ended — calling onDone`);
	handlers.onDone(structured.serialize(), accUsage);
}

// ─── Anthropic agent loop ───────────────────────────────────────────────────

function threadToAnthropic(messages: SendableMessage[]): MessageParam[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const out: MessageParam[] = [];
	type Pending = { role: 'user' | 'assistant'; blocks: ContentBlockParam[] };
	let current: Pending | null = null;

	const flush = () => {
		if (current && current.blocks.length > 0) {
			out.push({ role: current.role, content: current.blocks });
		}
		current = null;
	};

	for (const m of nonSystem) {
		if (m.role === 'assistant') {
			const p = parseAgentAssistantPayload(m.content);
			if (p) {
				flush();
				out.push(...expandStructuredAssistantPayloadToAnthropic(p));
				continue;
			}
		}

		const role = m.role as 'user' | 'assistant';
		const blocks: ContentBlockParam[] =
			role === 'user' && m.resolved && m.resolved.hasImages
				? buildAnthropicUserBlocks(m.resolved)
				: [{ type: 'text', text: role === 'user' ? userMessageTextForSend(m) : m.content }];
		if (current && current.role === role) {
			current.blocks.push(...blocks);
		} else {
			flush();
			current = { role, blocks: [...blocks] };
		}
	}
	flush();
	return out;
}

async function runAnthropicLoop(
	settings: ShellSettings,
	threadMessages: SendableMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
	const oauthAuth =
		options.requestOAuthAuth?.provider === 'claude'
			? await ensureFreshOAuthAuthForRequest(options.requestProviderId, options.requestOAuthAuth)
			: undefined;
	const key = (oauthAuth?.accessToken ?? options.requestApiKey).trim();
	if (!key) { handlers.onError('未配置 Anthropic API Key。请在设置 → 模型中填写。'); return; }

	const baseURL = options.requestBaseURL?.trim() || undefined;
	const requestProviderIdentity = providerIdentityForOAuthAuth(oauthAuth) ?? options.requestProviderIdentity;
	const proxyRaw = (options.requestProxyUrl?.trim() || settings.openAI?.proxyUrl?.trim()) ?? '';
	let httpAgent: InstanceType<typeof HttpsProxyAgent> | undefined;
	if (proxyRaw) {
		try { httpAgent = new HttpsProxyAgent(proxyRaw); } catch {
			handlers.onError('代理地址无效。'); return;
		}
	}
	const client = new Anthropic(
		applyAnthropicProviderIdentity(settings, {
			...(oauthAuth ? { authToken: key, apiKey: null } : { apiKey: key }),
			baseURL: baseURL || undefined,
			...(httpAgent ? { httpAgent } : {}),
			timeout: llmSdkResponseHeadTimeoutMs(),
			maxRetries: 0,
		}, requestProviderIdentity)
	);
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const model = options.requestModelId.trim();
	if (!model) { handlers.onError('模型请求名称为空。'); return; }
	const anthropicPromptCaching = isAnthropicPromptCachingEnabled(model);
	const systemSectionsBase = composeSystemSections(
		storedSystem?.content,
		options.composerMode,
		options.agentSystemAppend
	);
	const staticSystemText = prependProviderIdentitySystemPrompt(
		settings,
		systemSectionsBase.staticText,
		requestProviderIdentity
	);
	const dynamicSystemText = appendMcpToolsSystemHint(
		systemSectionsBase.dynamicText,
		options.composerMode,
		settings
	);
	const system = buildAnthropicSystemForApi(
		{
			staticText: staticSystemText,
			dynamicText: dynamicSystemText,
			fullText: [staticSystemText, dynamicSystemText].filter(Boolean).join('\n\n---\n'),
		},
		anthropicPromptCaching
	);
	let conversation: MessageParam[] = normalizeAnthropicMessagesForApi(threadToAnthropic(threadMessages));
	conversation = repairAnthropicToolPairing(conversation);
	conversation = mergeAdjacentAnthropicUserMessages(conversation);
	if (conversation.length === 0) { handlers.onError('没有可发送的对话消息。'); return; }
	let deferredToolState = normalizeDeferredToolStateForLoop(
		options.deferredToolState,
		options.discoveredDeferredToolNames
	);
	const discoveredDeferredToolNames = new Set(deferredToolState.discoveredToolNames);
	let toolResultReplacementState = normalizeToolResultReplacementState(
		options.toolResultReplacementState
	);
	const markDeferredToolsDiscovered = (names: string[]): string[] => {
		const added: string[] = [];
		for (const name of names) {
			const trimmed = String(name ?? '').trim();
			if (!trimmed || discoveredDeferredToolNames.has(trimmed)) {
				continue;
			}
			discoveredDeferredToolNames.add(trimmed);
			added.push(trimmed);
		}
		if (added.length > 0) {
			deferredToolState = normalizeDeferredToolStateForLoop({
				...deferredToolState,
				discoveredToolNames: [...discoveredDeferredToolNames],
				providerLoadedToolNames: {
					...(deferredToolState.providerLoadedToolNames ?? {}),
					anthropic: normalizeToolNameList([
						...(deferredToolState.providerLoadedToolNames?.anthropic ?? []),
						...added,
					]),
				},
			});
			emitDeferredToolStateChange(options, deferredToolState);
		}
		return added;
	};
	const resolveFullToolPool = () =>
		agentToolDefsForLoop(options.composerMode, settings, options.toolPoolOverride);
	const resolveToolDefsByName = () => new Map(resolveFullToolPool().map((tool) => [tool.name, tool] as const));
	const countAnthropicDeferredToolTokensExact = async (
		tools: AgentToolDef[]
	): Promise<number | null> => {
		if (tools.length === 0) {
			return 0;
		}
		try {
			const response = await client.messages.countTokens({
				model,
				messages: [{ role: 'user', content: '' }],
				tools: toAnthropicTools(tools) as unknown as Anthropic.Messages.MessageCountTokensTool[],
			});
			const baseline = await client.messages.countTokens({
				model,
				messages: [{ role: 'user', content: '' }],
			});
			return Math.max(0, response.input_tokens - baseline.input_tokens);
		} catch {
			return null;
		}
	};
	const initialFullToolPool = resolveFullToolPool();
	const initialDeferredToolPool = initialFullToolPool.filter((tool) => isDeferredAgentTool(tool));
	const initialVisibleToolPool = visibleAgentToolDefsForLoop(
		options.composerMode,
		settings,
		discoveredDeferredToolNames,
		options.toolPoolOverride
	);
	const toolContextAnalysis = await analyzeToolContext({
		provider: 'anthropic',
		fullToolPool: initialFullToolPool,
		visibleToolPool: initialVisibleToolPool,
		deferredToolPool: initialDeferredToolPool,
		exactDeferredTokenCounter: countAnthropicDeferredToolTokensExact,
	});
	const nativeAnthropicDeferEnabled = shouldEnableAnthropicNativeDefer({
		model,
		baseURL,
		contextWindowTokens: options.contextWindowTokens,
		analysis: toolContextAnalysis,
	});
	const resolveVisibleToolPool = () =>
		visibleAgentToolDefsForLoop(
			options.composerMode,
			settings,
			discoveredDeferredToolNames,
			options.toolPoolOverride,
			nativeAnthropicDeferEnabled
		);
	const resolveAnthropicApiTools = (): AnthropicToolSchema[] => {
		const visibleToolPool = resolveVisibleToolPool();
		if (!nativeAnthropicDeferEnabled) {
			return toAnthropicTools(visibleToolPool);
		}
		const deferToolNames = new Set(
			resolveFullToolPool()
				.filter((tool) => isDeferredAgentTool(tool) && !discoveredDeferredToolNames.has(tool.name))
				.map((tool) => tool.name)
		);
		return toAnthropicTools(visibleToolPool, {
			deferToolNames,
			includeExperimentalBetaFields: nativeAnthropicDeferEnabled,
		});
	};
	const mergedCustomToolHandlers = {
		ToolSearch: createToolSearchToolHandler({
			resolveFullToolPool,
			discoverTools: markDeferredToolsDiscovered,
			nativeAnthropicToolReference: nativeAnthropicDeferEnabled,
		}),
		...(options.customToolHandlers ?? {}),
	};
	const structured = new StructuredAssistantBuilder();
	const anthropicMetadata = buildAnthropicProviderIdentityMetadata(settings, requestProviderIdentity);
	const thinkBudget = anthropicThinkingBudget(options.thinkingLevel ?? 'off');
	const requestedTemperature = resolveRequestedTemperature(
		temperatureForMode(options.composerMode),
		options.temperatureMode,
		options.temperature
	);
	const temperature = anthropicEffectiveTemperature(requestedTemperature, thinkBudget);
	let accUsage: TurnTokenUsage | undefined;

	const mistakeLimitEnabled = options.mistakeLimitEnabled !== false;
	const threshold = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
	let consecutiveToolFailures = 0;

	const MAX_OUTPUT_RECOVERY_LIMIT_A = 3;
	let outputRecoveryCountA = 0;

	type TurnTu = { id: string; name: string; input: string };
	type AnthropicToolExecution = {
		call: TurnTu;
		args: Record<string, unknown>;
		result: ToolResult;
	};
	const maxToolArgChars = maxStreamingToolArgChars();
	const toolExecCtx: ToolExecutionContext = {
		delegateExecutionDepth: options.delegateExecutionDepth ?? 0,
		workspaceRoot: options.workspaceRoot ?? null,
		workspaceLspManager: options.workspaceLspManager ?? null,
		threadId: options.threadId ?? null,
		hostWebContentsId: options.hostWebContentsId ?? null,
		signal: options.signal,
		teamToolRoleScope: options.teamToolRoleScope,
		customToolHandlers: mergedCustomToolHandlers,
	};

	async function handleMistakeLimitBeforeRoundAnthropic(): Promise<boolean> {
		if (!mistakeLimitEnabled || consecutiveToolFailures < threshold) {
			return false;
		}
		if (options.onMistakeLimitReached) {
			const d = await options.onMistakeLimitReached({
				consecutiveFailures: consecutiveToolFailures,
				threshold,
			});
			if (d.action === 'stop') {
				handlers.onDone(structured.serialize());
				return true;
			}
			if (d.action === 'continue') {
				consecutiveToolFailures = 0;
			} else if (d.action === 'hint') {
				consecutiveToolFailures = 0;
				conversation.push({
					role: 'user',
					content: `[User feedback after repeated tool failures]\n${d.userText}`,
				});
			}
			return false;
		}
		consecutiveToolFailures = 0;
		return false;
	}

	async function runOneAnthropicTool(tu: TurnTu): Promise<AnthropicToolExecution> {
		let args: Record<string, unknown>;
		try {
			args = JSON.parse(tu.input || '{}');
		} catch (parseErr) {
			const msg = `工具参数 JSON 无效：${parseErr instanceof Error ? parseErr.message : String(parseErr)}。请提供合法的 JSON。`;
			if (mistakeLimitEnabled) consecutiveToolFailures++;
			return {
				call: tu,
				args: {},
				result: { toolCallId: tu.id, name: tu.name, content: msg, isError: true },
			};
		}

		const toolCall: ToolCall = { id: tu.id, name: tu.name, arguments: args };

		handlers.onToolCall(tu.name, args, tu.id);
		await new Promise<void>((r) => setTimeout(r, 0));

		const gateStart = Date.now();
		console.log(`[AgentLoop/A] tool=${tu.name} — beforeExecuteTool start`);
		let gate: BeforeExecuteToolResult = { proceed: true };
		if (options.beforeExecuteTool) {
			try {
				gate = await options.beforeExecuteTool(toolCall);
			} catch (e) {
				gate = {
					proceed: false,
					rejectionMessage: e instanceof Error ? e.message : String(e),
				};
			}
		}
		console.log(`[AgentLoop/A] tool=${tu.name} — beforeExecuteTool done (${Date.now() - gateStart}ms, proceed=${gate.proceed})`);
		if (!gate.proceed) {
			const msg = gate.rejectionMessage;
			if (mistakeLimitEnabled) consecutiveToolFailures++;
			return {
				call: tu,
				args,
				result: { toolCallId: tu.id, name: tu.name, content: msg, isError: true },
			};
		}

		handlers.onToolProgress?.({ name: tu.name, phase: 'executing' });
		const execStart = Date.now();
		console.log(`[AgentLoop/A] tool=${tu.name} — executeTool start`);
		const result = await executeTool(toolCall, options.toolHooks, toolExecCtx);
		console.log(`[AgentLoop/A] tool=${tu.name} — executeTool done (${Date.now() - execStart}ms, error=${result.isError})`);
		if (mistakeLimitEnabled) {
			if (result.isError) {
				consecutiveToolFailures++;
			} else {
				consecutiveToolFailures = 0;
			}
		}

		return { call: tu, args, result };
	}

	async function flushAnthropicToolsInOrder(turnToolUses: TurnTu[]): Promise<AnthropicToolResultBlock[]> {
		const executed: AnthropicToolExecution[] = [];
		let i = 0;
		while (i < turnToolUses.length) {
			const cur = turnToolUses[i]!;
			if (isReadOnlyAgentTool(cur.name)) {
				let j = i;
				while (j < turnToolUses.length && isReadOnlyAgentTool(turnToolUses[j]!.name)) {
					j++;
				}
				const batch = turnToolUses.slice(i, j);
				const batchResults = await runBatchWithLimit(
					batch.map((b) => () => runOneAnthropicTool(b)),
					MAX_TOOL_CONCURRENCY
				);
				executed.push(...batchResults);
				i = j;
			} else {
				executed.push(await runOneAnthropicTool(cur));
				i++;
			}
		}
		if (executed.length === 0) {
			return [];
		}
		const budgeted = await applyTurnToolResultBudget(
			executed.map((item) => item.result),
			resolveToolDefsByName(),
			toolResultReplacementState,
			toolExecCtx
		);
		toolResultReplacementState = budgeted.state;
		options.onToolResultReplacementStateChange?.(toolResultReplacementState);
		return executed.map((item, index) => {
			const adjusted = budgeted.results[index]!;
			structured.pushTool(
				item.call.id,
				item.call.name,
				item.args,
				adjusted.content,
				!adjusted.isError,
				adjusted.structuredContent
			);
			handlers.onToolResult(
				item.call.name,
				adjusted.content,
				!adjusted.isError,
				item.call.id
			);
			return {
				type: 'tool_result',
				tool_use_id: item.call.id,
				content: adjusted.structuredContent ?? adjusted.content,
				is_error: adjusted.isError,
			};
		});
	}

	const toolDeltaBatcherA = createToolInputDeltaBatcher((p) => handlers.onToolInputDelta?.(p));
	const streamTimeoutConfigA = resolveStreamTimeouts(settings);
	const maxRoundsA = resolveAgentMaxRounds(settings);
	console.log(
		`[AgentLoop] Anthropic loop start — idleMs=${streamTimeoutConfigA.idleMs} hardMs=${streamTimeoutConfigA.hardMs} watchdog=${streamTimeoutConfigA.idleWatchdogEnabled} maxRounds=${maxRoundsA ?? '∞'}`
	);

	for (let round = 0; maxRoundsA == null || round < maxRoundsA; round++) {
		if (options.signal.aborted) { console.log(`[AgentLoop/A] round ${round} — aborted before start`); break; }

		if (await handleMistakeLimitBeforeRoundAnthropic()) {
			return;
		}
		if (options.beforeRoundMessages) {
			const injected = await options.beforeRoundMessages();
			if (injected.length > 0) {
				conversation = appendMessagesToAnthropicConversation(conversation, injected);
			}
		}
		const compactedForContextA = compactAnthropicConversationForContext(conversation, {
			model,
			apiKey: key,
			baseURL,
			proxyUrl: proxyRaw || undefined,
			providerIdentity: resolveProviderIdentityWithOverride(settings.providerIdentity, options.requestProviderIdentity),
			contextWindowTokens: options.contextWindowTokens,
			maxOutputTokens: options.maxOutputTokens,
			state: options.contextCompactState,
			onStateChange: options.onContextCompactStateChange,
			signal: options.signal,
		});
		const compactedForContextAResolved = await compactedForContextA;
		if (compactedForContextAResolved.changed) {
			conversation = compactedForContextAResolved.messages;
			console.log(
				`[AgentLoop/A] round ${round} — context compacted provider=anthropic mode=${compactedForContextAResolved.mode} before=${compactedForContextAResolved.estimatedTokensBefore} after=${compactedForContextAResolved.estimatedTokensAfter} compactedMessages=${compactedForContextAResolved.compactedMessages} clearedToolResults=${compactedForContextAResolved.clearedToolResults}${compactedForContextAResolved.error ? ` error=${compactedForContextAResolved.error}` : ''}`
			);
		}

		console.log(`[AgentLoop/A] round ${round} — starting LLM call`);
		const roundStartAtA = Date.now();
		const tools = resolveAnthropicApiTools();
		let turnText = '';
		let turnThinking = '';
		let turnThinkingSignature = '';
		const turnToolUses: { id: string; name: string; input: string }[] = [];
		let currentBlockType: 'text' | 'tool_use' | 'thinking' | null = null;
		let currentBlockIdx = -1;
		let turnStopReason: string | null = null;

		const maxTokens = anthropicEffectiveMaxTokens(thinkBudget, options.maxOutputTokens);
		const thinkingParam =
			thinkBudget !== null
				? ({ type: 'enabled' as const, budget_tokens: thinkBudget })
				: undefined;

		const roundAcA = new AbortController();
		const roundSignalA = roundAcA.signal;
		let activeStreamA: { abort?: () => void } | null = null;
		const onOuterAbortA = () => {
			roundAcA.abort();
			try {
				activeStreamA?.abort?.();
			} catch {
				/* ignore */
			}
		};
		if (options.signal.aborted) {
			roundAcA.abort();
		} else {
			options.signal.addEventListener('abort', onOuterAbortA, { once: true });
		}

		const timeoutMgrA = createStreamTimeoutManager(streamTimeoutConfigA, () => roundAcA.abort());
		timeoutMgrA.start();

		let cacheDecision: AnthropicCacheBreakpointDecision | undefined;
		try {
			const messagesForApi = addAnthropicCacheBreakpoints(
				conversation,
				anthropicPromptCaching,
				{
					skipCacheWrite: options.skipAnthropicPromptCacheWrite === true,
					strategy: 'stable-prefix',
					onDecision: (decision) => { cacheDecision = decision; },
				}
			);
			const stream = await withLlmTransportRetry(
				async () => {
					const s = client.messages.stream(
						{
						model,
						max_tokens: maxTokens,
						system,
						messages: messagesForApi,
						tools: tools as Anthropic.Messages.Tool[],
						temperature,
						...(anthropicMetadata ? { metadata: anthropicMetadata } : {}),
						...(thinkingParam ? { thinking: thinkingParam } : {}),
					},
						{ signal: roundSignalA }
					);
					await s.withResponse();
					return s;
				},
				{ signal: options.signal }
			);
			activeStreamA = stream as { abort?: () => void };

			for await (const ev of stream) {
				if (roundSignalA.aborted) break;
				timeoutMgrA.onChunk();

				if (ev.type === 'message_start' && ev.message.usage) {
					accUsage = {
						inputTokens: (accUsage?.inputTokens ?? 0) + (ev.message.usage.input_tokens ?? 0),
						outputTokens: (accUsage?.outputTokens ?? 0) + (ev.message.usage.output_tokens ?? 0),
						cacheReadTokens: (accUsage?.cacheReadTokens ?? 0) + (((ev.message.usage as any).cache_read_input_tokens) ?? 0),
						cacheWriteTokens: (accUsage?.cacheWriteTokens ?? 0) + (((ev.message.usage as any).cache_creation_input_tokens) ?? 0),
					};
			} else if (ev.type === 'message_delta' && ev.usage) {
				accUsage = {
					...(accUsage ?? {}),
					outputTokens: (accUsage?.outputTokens ?? 0) + (ev.usage.output_tokens ?? 0),
				};
				if ((ev as any).delta?.stop_reason) {
					turnStopReason = (ev as any).delta.stop_reason;
				}
			} else if (ev.type === 'content_block_start') {
					if (ev.content_block.type === 'text') {
						currentBlockType = 'text';
					} else if (ev.content_block.type === 'tool_use') {
						currentBlockType = 'tool_use';
						currentBlockIdx = turnToolUses.length;
						turnToolUses.push({ id: ev.content_block.id, name: ev.content_block.name, input: '' });
					} else if (ev.content_block.type === 'thinking') {
						currentBlockType = 'thinking';
					} else {
						currentBlockType = null;
					}
				} else if (ev.type === 'content_block_delta') {
					if (currentBlockType === 'text' && ev.delta.type === 'text_delta') {
						turnText += ev.delta.text;
						handlers.onTextDelta(ev.delta.text);
					} else if (currentBlockType === 'thinking' && ev.delta.type === 'thinking_delta') {
						const piece = ev.delta.thinking;
						if (piece) {
							turnThinking += piece;
							handlers.onThinkingDelta?.(piece);
						}
					} else if (currentBlockType === 'thinking' && ev.delta.type === 'signature_delta') {
						turnThinkingSignature += ev.delta.signature;
					} else if (currentBlockType === 'tool_use' && ev.delta.type === 'input_json_delta') {
						if (currentBlockIdx >= 0 && turnToolUses[currentBlockIdx]) {
							turnToolUses[currentBlockIdx]!.input += ev.delta.partial_json;
							const tu = turnToolUses[currentBlockIdx]!;
							if (tu.input.length > maxToolArgChars) {
								throw new Error(
									`Streaming tool arguments exceeded safe limit (${maxToolArgChars} chars) for ${tu.name || '(pending)'}.`
								);
							}
							if (tu.name && shouldEmitToolInputDelta(tu.name)) {
								toolDeltaBatcherA.queue({
									name: tu.name,
									partialJson: tu.input,
									index: currentBlockIdx,
								});
								await yieldForToolInputStreamUi(tu.name);
							}
						}
					}
			} else if (ev.type === 'content_block_stop') {
				currentBlockType = null;
			}
		}
			toolDeltaBatcherA.flush();
		} catch (e: unknown) {
			toolDeltaBatcherA.flush();
			timeoutMgrA.stop();
			if (options.signal.aborted) {
				synthesizeMissingAnthropicToolResults(conversation, turnToolUses, '已中止生成');
				break;
			}
			if (roundSignalA.aborted && !options.signal.aborted) {
				// 超时中止：保留已生成内容，以 onDone 结束而非 onError 丢弃
				const partialTextA = unwrapAssistantContentEnvelope(turnText);
				structured.appendText(partialTextA);
				handlers.onDone(structured.serialize(), accUsage);
				return;
			}
			const errTextA = formatLlmSdkError(e);
			synthesizeMissingAnthropicToolResults(conversation, turnToolUses, errTextA);
			handlers.onError(errTextA);
			return;
		} finally {
			activeStreamA = null;
			options.signal.removeEventListener('abort', onOuterAbortA);
		}
		timeoutMgrA.stop();
		observeAnthropicPromptCacheUsage({
			source: `agent:${options.threadId ?? 'ephemeral'}`,
			model,
			usage: accUsage,
			decision: cacheDecision,
			system,
			toolNames: tools.map((tool) => tool.name),
		});
		console.log(`[AgentLoop/A] round ${round} — stream done (${Date.now() - roundStartAtA}ms), stopReason=${turnStopReason}, toolUses=${turnToolUses.length}, textLen=${turnText.length}`);

		if (options.signal.aborted || roundSignalA.aborted) {
			console.log(`[AgentLoop/A] round ${round} — aborted after stream`);
			synthesizeMissingAnthropicToolResults(conversation, turnToolUses, '已中止生成');
			break;
		}

		turnText = unwrapAssistantContentEnvelope(turnText);
		structured.appendText(turnText);

		if (turnToolUses.length === 0) {
			// 检测 max_tokens 截断，尝试自动续写
			if (
				turnStopReason === 'max_tokens' &&
				outputRecoveryCountA < MAX_OUTPUT_RECOVERY_LIMIT_A
			) {
				outputRecoveryCountA++;
				conversation.push({ role: 'assistant', content: turnText });
				conversation.push({
					role: 'user',
					content:
						'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
						'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
				});
				continue;
			}
			conversation.push({ role: 'assistant', content: turnText });
			break;
		}

		const assistantContent: ContentBlockParam[] = [];
		if (turnThinking.trim()) {
			assistantContent.push({
				type: 'thinking',
				thinking: turnThinking,
				signature: turnThinkingSignature || '',
			});
		}
		if (turnText) {
			assistantContent.push({ type: 'text', text: turnText });
		}
		for (const tu of turnToolUses) {
			let input: Record<string, unknown> = {};
			try { input = JSON.parse(tu.input || '{}'); } catch { input = {}; }
			assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input });
		}
		conversation.push({ role: 'assistant', content: assistantContent });

		console.log(`[AgentLoop/A] round ${round} — executing ${turnToolUses.length} tool(s)`);
		const toolsStartA = Date.now();
		const toolResults = await flushAnthropicToolsInOrder(turnToolUses);
		console.log(`[AgentLoop/A] round ${round} — tools done (${Date.now() - toolsStartA}ms)`);

		conversation.push({ role: 'user', content: toolResults as unknown as ContentBlockParam[] });

		if (maxRoundsA != null && round === maxRoundsA - 1) {
			console.warn(`[AgentLoop/A] max tool rounds (${maxRoundsA}) exhausted — ending loop`);
			const warnA = `\n\n---\n⚠ 已达到单次对话最大工具轮次 (${maxRoundsA})，自动停止。请发送新消息继续。`;
			structured.appendText(warnA);
			handlers.onTextDelta(warnA);
		}
	}

	console.log(`[AgentLoop/A] Anthropic loop ended — calling onDone`);
	handlers.onDone(structured.serialize(), accUsage);
}
