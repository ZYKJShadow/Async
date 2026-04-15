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
import type { MessageParam, ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings, ModelRequestParadigm, ThinkingLevel } from '../settingsStore.js';
import { assembleAgentToolPool, filterMcpToolsByDenyPrefixes } from './agentToolPool.js';
import type { TurnTokenUsage } from '../llm/types.js';
import { llmSdkResponseHeadTimeoutMs } from '../llm/sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from '../llm/llmTransportRetry.js';
import { formatLlmSdkError } from '../llm/formatLlmSdkError.js';
import { composeSystem, temperatureForMode } from '../llm/modePrompts.js';
import {
	anthropicEffectiveMaxTokens,
	anthropicEffectiveTemperature,
	anthropicThinkingBudget,
	openAIReasoningEffort,
} from '../llm/thinkingLevel.js';
import {
	addAnthropicCacheBreakpoints,
	buildAnthropicSystemForApi,
	isAnthropicPromptCachingEnabled,
} from '../llm/anthropicPromptCache.js';
import type { ComposerMode } from '../llm/composerMode.js';
import {
	agentToolsForComposerMode,
	isReadOnlyAgentTool,
	toOpenAITools,
	toAnthropicTools,
	type AgentToolDef,
	type ToolCall,
} from './agentTools.js';
import type { TeamPlanQuestionRoleScope } from './planQuestionTool.js';
import { executeTool, type ToolExecutionHooks } from './toolExecutor.js';
import type { WorkspaceLspManager } from '../lsp/workspaceLspManager.js';
import { getMcpManager } from '../mcp/index.js';
import { getMcpServerConfigs } from '../settingsStore.js';
import { repairAgentThreadMessagesForApi } from './agentToolProtocolRepair.js';
import { StructuredAssistantBuilder } from './structuredAssistantBuilder.js';
import { parseAgentAssistantPayload } from '../../src/agentStructuredMessage.js';
import { repairAnthropicToolPairing, repairOpenAIToolPairing } from './apiConversationRepair.js';
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

export type { MistakeLimitContext, MistakeLimitDecision } from './mistakeLimitGate.js';

/** 执行工具前闸门；返回 proceed:false 时不调用 executeTool，结果写入对话为失败 tool_result */
export type BeforeExecuteToolResult = { proceed: true } | { proceed: false; rejectionMessage: string };

const DEFAULT_MAX_CONSECUTIVE_MISTAKES = 5;

/** 只读类工具：不向 UI 发送 tool_input_delta，避免参数 JSON 流式刷新；完成后由活动行渐入展示 */
const READ_TOOLS_SKIP_INPUT_DELTA = new Set([
	'Read',
	'Glob',
	'Grep',
	'list_dir',
	'LSP',
	'ListMcpResourcesTool',
	'ReadMcpResourceTool',
	'ask_plan_question',
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
	maxOutputTokens: number;
	signal: AbortSignal;
	/** 与主界面 Composer 模式一致；Plan 仅注册只读工具 */
	composerMode: ComposerMode;
	/** 子 Agent 等场景覆盖默认工具池（非空则跳过 assembleAgentToolPool） */
	toolPoolOverride?: AgentToolDef[];
	agentSystemAppend?: string;
	toolHooks?: ToolExecutionHooks;
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
	beforeRoundMessages?: () => Promise<ChatMessage[]>;
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
	return [
		systemContent,
		'',
		`## MCP tools (${n})`,
		'Additional tools from configured Model Context Protocol servers are registered with names prefixed `mcp__`.',
		'Use `ListMcpResourcesTool` / `ReadMcpResourceTool` to browse MCP resources when needed.',
		'Use them when the user needs integrations beyond the built-in workspace tools (e.g. web, APIs, databases). Follow each tool\'s description and parameter schema.',
	].join('\n');
}

function appendMessagesToOpenAIConversation(conversation: OAIMsg[], messages: ChatMessage[]): OAIMsg[] {
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
		next.push({ role: 'user', content: message.content });
	}
	return mergeAdjacentOpenAIUserMessages(next);
}

function appendMessagesToAnthropicConversation(conversation: MessageParam[], messages: ChatMessage[]): MessageParam[] {
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
		next.push({ role: 'user', content: message.content });
	}
	return mergeAdjacentAnthropicUserMessages(next);
}

/**
 * 为工具会话准备 MCP 连接：Agent 需要动态工具；Plan 仅需连接以便 ListMcpResourcesTool / ReadMcpResourceTool。
 */
async function prepareMcpConnectionsForSession(composerMode: ComposerMode): Promise<void> {
	if (composerMode !== 'agent' && composerMode !== 'plan' && composerMode !== 'team') {
		return;
	}
	const mcpT0 = Date.now();
	const mgr = getMcpManager();
	mgr.loadConfigs(getMcpServerConfigs());
	await mgr.startAll().catch((e) => {
		console.warn('[AgentLoop] MCP startAll:', e instanceof Error ? e.message : e);
	});
	console.log(
		`[AgentLoop] MCP prepare done (${Date.now() - mcpT0}ms) mode=${composerMode} — slow here usually means MCP servers starting or timing out`
	);
}

export async function runAgentLoop(
	settings: ShellSettings,
	threadMessages: ChatMessage[],
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
	await prepareMcpConnectionsForSession(options.composerMode);
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

function threadToOpenAI(
	messages: ChatMessage[],
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
			out.push({ role: 'user', content: m.content });
		}
	}
	return out;
}

async function runOpenAILoop(
	settings: ShellSettings,
	threadMessages: ChatMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
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

	const client = new OpenAI({
		apiKey: key,
		baseURL,
		httpAgent,
		dangerouslyAllowBrowser: false,
		timeout: llmSdkResponseHeadTimeoutMs(),
		maxRetries: 0,
	});
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const systemContent = appendMcpToolsSystemHint(
		composeSystem(storedSystem?.content, options.composerMode, options.agentSystemAppend),
		options.composerMode,
		settings
	);
	const temperature = temperatureForMode(options.composerMode);

	const tools = toOpenAITools(
		agentToolDefsForLoop(options.composerMode, settings, options.toolPoolOverride)
	);

	let conversation: OAIMsg[] = normalizeOpenAIMessagesForApi(threadToOpenAI(threadMessages, systemContent));
	conversation = repairOpenAIToolPairing(conversation);
	conversation = mergeAdjacentOpenAIUserMessages(conversation);
	const structured = new StructuredAssistantBuilder();
	const effort = openAIReasoningEffort(options.thinkingLevel ?? 'off');
	let accUsage: TurnTokenUsage | undefined;

	const mistakeLimitEnabled = options.mistakeLimitEnabled !== false;
	const threshold = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
	let consecutiveToolFailures = 0;

	const MAX_OUTPUT_RECOVERY_LIMIT = 3;
	let outputRecoveryCount = 0;

	type TurnTc = { id: string; name: string; arguments: string };

	const toolDeltaBatcher = createToolInputDeltaBatcher((p) => handlers.onToolInputDelta?.(p));
	const maxToolArgChars = maxStreamingToolArgChars();

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

	async function runOneOpenAITool(tc: TurnTc): Promise<OpenAI.Chat.ChatCompletionToolMessageParam> {
		let args: Record<string, unknown>;
		try {
			args = JSON.parse(tc.arguments || '{}');
		} catch (parseErr) {
			const msg = `工具参数 JSON 无效：${parseErr instanceof Error ? parseErr.message : String(parseErr)}。请提供合法的 JSON。`;
			if (mistakeLimitEnabled) consecutiveToolFailures++;
			structured.pushTool(tc.id, tc.name, {}, msg, false);
			handlers.onToolResult(tc.name, msg, false, tc.id);
			return { role: 'tool', tool_call_id: tc.id, content: msg };
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
			structured.pushTool(tc.id, tc.name, args, msg, false);
			handlers.onToolResult(tc.name, msg, false, tc.id);
			return { role: 'tool', tool_call_id: tc.id, content: msg };
		}

		handlers.onToolProgress?.({ name: tc.name, phase: 'executing' });
		const execStart = Date.now();
		console.log(`[AgentLoop] tool=${tc.name} — executeTool start`);
		const result = await executeTool(toolCall, options.toolHooks, {
			delegateExecutionDepth: options.delegateExecutionDepth ?? 0,
			workspaceRoot: options.workspaceRoot ?? null,
			workspaceLspManager: options.workspaceLspManager ?? null,
			threadId: options.threadId ?? null,
			hostWebContentsId: options.hostWebContentsId ?? null,
			signal: options.signal,
			teamToolRoleScope: options.teamToolRoleScope,
		});
		console.log(`[AgentLoop] tool=${tc.name} — executeTool done (${Date.now() - execStart}ms, error=${result.isError})`);
		if (mistakeLimitEnabled) {
			if (result.isError) {
				consecutiveToolFailures++;
			} else {
				consecutiveToolFailures = 0;
			}
		}

		structured.pushTool(tc.id, tc.name, args, result.content, !result.isError);
		handlers.onToolResult(tc.name, result.content, !result.isError, tc.id);

		return { role: 'tool', tool_call_id: tc.id, content: result.content };
	}

	async function flushOpenAIToolsInOrder(turnToolCalls: TurnTc[]): Promise<void> {
		const withNames = turnToolCalls.filter((tc) => tc.name);
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
				for (const msg of outs) {
					conversation.push(msg);
				}
				i = j;
			} else {
				const msg = await runOneOpenAITool(cur);
				conversation.push(msg);
				i++;
			}
		}
	}

	const streamTimeoutConfig = resolveStreamTimeouts(settings);
	const maxRounds = resolveAgentMaxRounds(settings);
	console.log(
		`[AgentLoop] OpenAI sync prep done (${Date.now() - openaiSyncPrepStart}ms) convMsgs=${conversation.length} tools=${tools.length} thread=${options.threadId ?? 'n/a'}`
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

		console.log(`[AgentLoop] round ${round} — starting LLM call`);
		const roundStartAt = Date.now();
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
		await flushOpenAIToolsInOrder(turnToolCalls);
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

function threadToAnthropic(messages: ChatMessage[]): MessageParam[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const out: MessageParam[] = [];
	let mergeBuf = '';
	let mergeRole: 'user' | 'assistant' | null = null;

	const flushMerge = () => {
		if (mergeRole !== null && mergeBuf !== '') {
			out.push({ role: mergeRole, content: mergeBuf });
		}
		mergeBuf = '';
		mergeRole = null;
	};

	for (const m of nonSystem) {
		if (m.role === 'assistant') {
			const p = parseAgentAssistantPayload(m.content);
			if (p) {
				flushMerge();
				out.push(...expandStructuredAssistantPayloadToAnthropic(p));
				continue;
			}
		}

		const role = m.role as 'user' | 'assistant';
		const piece = m.content;
		if (mergeRole === role) {
			mergeBuf += (mergeBuf ? '\n\n' : '') + piece;
		} else {
			flushMerge();
			mergeBuf = piece;
			mergeRole = role;
		}
	}
	flushMerge();
	return out;
}

async function runAnthropicLoop(
	settings: ShellSettings,
	threadMessages: ChatMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
	const key = options.requestApiKey.trim();
	if (!key) { handlers.onError('未配置 Anthropic API Key。请在设置 → 模型中填写。'); return; }

	const baseURL = options.requestBaseURL?.trim() || undefined;
	const client = new Anthropic({
		apiKey: key,
		baseURL: baseURL || undefined,
		timeout: llmSdkResponseHeadTimeoutMs(),
		maxRetries: 0,
	});
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const systemText = appendMcpToolsSystemHint(
		composeSystem(storedSystem?.content, options.composerMode, options.agentSystemAppend),
		options.composerMode,
		settings
	);
	const model = options.requestModelId.trim();
	if (!model) { handlers.onError('模型请求名称为空。'); return; }
	const anthropicPromptCaching = isAnthropicPromptCachingEnabled(model);
	const system = buildAnthropicSystemForApi(systemText, anthropicPromptCaching);
	let conversation: MessageParam[] = normalizeAnthropicMessagesForApi(threadToAnthropic(threadMessages));
	conversation = repairAnthropicToolPairing(conversation);
	conversation = mergeAdjacentAnthropicUserMessages(conversation);
	if (conversation.length === 0) { handlers.onError('没有可发送的对话消息。'); return; }

	const tools = toAnthropicTools(
		agentToolDefsForLoop(options.composerMode, settings, options.toolPoolOverride)
	);
	const structured = new StructuredAssistantBuilder();
	const thinkBudget = anthropicThinkingBudget(options.thinkingLevel ?? 'off');
	const temperature = anthropicEffectiveTemperature(temperatureForMode(options.composerMode), thinkBudget);
	let accUsage: TurnTokenUsage | undefined;

	const mistakeLimitEnabled = options.mistakeLimitEnabled !== false;
	const threshold = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
	let consecutiveToolFailures = 0;

	const MAX_OUTPUT_RECOVERY_LIMIT_A = 3;
	let outputRecoveryCountA = 0;

	type TurnTu = { id: string; name: string; input: string };
	const maxToolArgChars = maxStreamingToolArgChars();

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

	async function runOneAnthropicTool(tu: TurnTu): Promise<ToolResultBlockParam> {
		let args: Record<string, unknown>;
		try {
			args = JSON.parse(tu.input || '{}');
		} catch (parseErr) {
			const msg = `工具参数 JSON 无效：${parseErr instanceof Error ? parseErr.message : String(parseErr)}。请提供合法的 JSON。`;
			if (mistakeLimitEnabled) consecutiveToolFailures++;
			structured.pushTool(tu.id, tu.name, {}, msg, false);
			handlers.onToolResult(tu.name, msg, false, tu.id);
			return { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true };
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
			structured.pushTool(tu.id, tu.name, args, msg, false);
			handlers.onToolResult(tu.name, msg, false, tu.id);
			return { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true };
		}

		handlers.onToolProgress?.({ name: tu.name, phase: 'executing' });
		const execStart = Date.now();
		console.log(`[AgentLoop/A] tool=${tu.name} — executeTool start`);
		const result = await executeTool(toolCall, options.toolHooks, {
			delegateExecutionDepth: options.delegateExecutionDepth ?? 0,
			workspaceRoot: options.workspaceRoot ?? null,
			workspaceLspManager: options.workspaceLspManager ?? null,
			threadId: options.threadId ?? null,
			hostWebContentsId: options.hostWebContentsId ?? null,
			signal: options.signal,
			teamToolRoleScope: options.teamToolRoleScope,
		});
		console.log(`[AgentLoop/A] tool=${tu.name} — executeTool done (${Date.now() - execStart}ms, error=${result.isError})`);
		if (mistakeLimitEnabled) {
			if (result.isError) {
				consecutiveToolFailures++;
			} else {
				consecutiveToolFailures = 0;
			}
		}

		structured.pushTool(tu.id, tu.name, args, result.content, !result.isError);
		handlers.onToolResult(tu.name, result.content, !result.isError, tu.id);

		return {
			type: 'tool_result',
			tool_use_id: tu.id,
			content: result.content,
			is_error: result.isError,
		};
	}

	async function flushAnthropicToolsInOrder(turnToolUses: TurnTu[]): Promise<ToolResultBlockParam[]> {
		const out: ToolResultBlockParam[] = [];
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
				out.push(...batchResults);
				i = j;
			} else {
				out.push(await runOneAnthropicTool(cur));
				i++;
			}
		}
		return out;
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

		console.log(`[AgentLoop/A] round ${round} — starting LLM call`);
		const roundStartAtA = Date.now();
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

		try {
			const messagesForApi = addAnthropicCacheBreakpoints(
				conversation,
				anthropicPromptCaching,
				options.skipAnthropicPromptCacheWrite === true
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

		conversation.push({ role: 'user', content: toolResults });

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
