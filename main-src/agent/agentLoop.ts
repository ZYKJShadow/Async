/**
 * 多轮 Agent 工具循环 — 核心引擎。
 *
 * 类似 Cursor / Claude Code 的实现方式：
 * 1. 将对话消息 + 工具定义发给 LLM
 * 2. 如果 LLM 返回工具调用 → 执行 → 把结果加入对话 → 再次调用 LLM
 * 3. 如果 LLM 只返回文本 → 结束循环
 * 4. 循环最多 MAX_ROUNDS 轮
 */

import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings, ModelRequestParadigm, ThinkingLevel } from '../settingsStore.js';
import type { TurnTokenUsage } from '../llm/types.js';
import { composeSystem, temperatureForMode } from '../llm/modePrompts.js';
import {
	anthropicEffectiveMaxTokens,
	anthropicThinkingBudget,
	openAIReasoningEffort,
} from '../llm/thinkingLevel.js';
import type { ComposerMode } from '../llm/composerMode.js';
import {
	agentToolsForComposerMode,
	isReadOnlyAgentTool,
	toOpenAITools,
	toAnthropicTools,
	type ToolCall,
} from './agentTools.js';
import { executeTool, type ToolExecutionHooks } from './toolExecutor.js';
import { repairAgentThreadMessagesForApi } from './agentToolProtocolRepair.js';
import type { MistakeLimitContext, MistakeLimitDecision } from './mistakeLimitGate.js';
import { resolveStreamTimeouts, createStreamTimeoutManager } from '../llm/streamTimeouts.js';

export type { MistakeLimitContext, MistakeLimitDecision } from './mistakeLimitGate.js';

/** 执行工具前闸门；返回 proceed:false 时不调用 executeTool，结果写入对话为失败 tool_result */
export type BeforeExecuteToolResult = { proceed: true } | { proceed: false; rejectionMessage: string };

const MAX_ROUNDS = 80;
const DEFAULT_MAX_CONSECUTIVE_MISTAKES = 5;

export type ToolInputDeltaPayload = { name: string; partialJson: string; index: number };

/**
 * 合并同一事件循环内的高频 tool_input_delta（只发最后一帧），避免 IPC 风暴；
 * 使用 queueMicrotask 而非 setTimeout，避免人为 48ms 延迟导致首帧/收尾丢更新。
 */
function createToolInputDeltaBatcher(
	emit: (p: ToolInputDeltaPayload) => void
): { queue: (p: ToolInputDeltaPayload) => void; flush: () => void } {
	let pending: ToolInputDeltaPayload | null = null;
	let scheduled = false;
	return {
		queue(p: ToolInputDeltaPayload) {
			pending = p;
			if (scheduled) return;
			scheduled = true;
			queueMicrotask(() => {
				scheduled = false;
				if (pending) {
					emit(pending);
					pending = null;
				}
			});
		},
		flush() {
			if (pending) {
				emit(pending);
				pending = null;
			}
			scheduled = false;
		},
	};
}

export type AgentLoopHandlers = {
	onTextDelta: (text: string) => void;
	/** 模型边生成工具 JSON 参数时流式回调（便于 UI 实时预览写入内容） */
	onToolInputDelta?: (payload: ToolInputDeltaPayload) => void;
	/** Anthropic extended thinking 流式片段（不写入持久化 assistant 正文） */
	onThinkingDelta?: (text: string) => void;
	onToolCall: (name: string, args: Record<string, unknown>) => void;
	onToolResult: (name: string, result: string, success: boolean) => void;
	onDone: (fullContent: string, usage?: TurnTokenUsage) => void;
	onError: (message: string) => void;
};

export type AgentLoopOptions = {
	requestModelId: string;
	paradigm: ModelRequestParadigm;
	/** 与 UnifiedChatOptions 一致：已由 modelResolve 解析 */
	requestApiKey: string;
	requestBaseURL?: string;
	maxOutputTokens: number;
	signal: AbortSignal;
	/** 与主界面 Composer 模式一致；Plan 仅注册只读工具 */
	composerMode: ComposerMode;
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
};

/**
 * 在每个工具调用/结果处插入标记以便前端渲染。
 */
function toolCallMarker(name: string, args: Record<string, unknown>): string {
	const safeArgs = JSON.stringify(args);
	return `\n<tool_call tool="${name}">${safeArgs}</tool_call>\n`;
}

/** 避免正文里出现字面量 `</tool_result>` 时破坏解析（与渲染端 agentChatSegments 一致）。 */
function escapeToolResultForMarker(raw: string): string {
	return raw.split('</tool_result>').join('</tool\u200c_result>');
}

function toolResultMarker(name: string, result: string, success: boolean): string {
	const truncated = result.length > 3000 ? result.slice(0, 3000) + '\n... (truncated)' : result;
	const safe = escapeToolResultForMarker(truncated);
	return `<tool_result tool="${name}" success="${success}">${safe}</tool_result>\n`;
}

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
 */
function inferOpenAIToolNameFromPartialArguments(partial: string): string {
	const c = partial.replace(/\s+/g, '');
	if (!c) return '';
	if (c.includes('"old_str"') || c.includes('"new_str"')) return 'str_replace';
	if (c.includes('"content"')) return 'write_to_file';
	if (c.includes('"pattern"')) return 'search_files';
	if (c.includes('"command"')) return 'execute_command';
	// read_file 常带行号；仅有 path 的片段多是 write_to_file 正在流出 path，content 尚未到
	if (c.includes('"start_line"') || c.includes('"end_line"')) return 'read_file';
	if (c.includes('"path"')) return 'write_to_file';
	return '';
}

export async function runAgentLoop(
	settings: ShellSettings,
	threadMessages: ChatMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
	const messagesForApi = repairAgentThreadMessagesForApi(threadMessages);
	switch (options.paradigm) {
		case 'anthropic':
			return runAnthropicLoop(settings, messagesForApi, options, handlers);
		case 'openai-compatible':
		default:
			return runOpenAILoop(settings, messagesForApi, options, handlers);
	}
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** 最大只读工具并发数，避免大批量 read_file 同时打盘 */
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
		out.push({ role: m.role as 'user' | 'assistant', content: m.content });
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

	const proxyRaw = settings.openAI?.proxyUrl?.trim();
	let httpAgent: InstanceType<typeof HttpsProxyAgent> | undefined;
	if (proxyRaw) {
		try { httpAgent = new HttpsProxyAgent(proxyRaw); } catch {
			handlers.onError('代理地址无效。'); return;
		}
	}

	const client = new OpenAI({ apiKey: key, baseURL, httpAgent, dangerouslyAllowBrowser: false });
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const systemContent = composeSystem(storedSystem?.content, options.composerMode, options.agentSystemAppend);
	const temperature = temperatureForMode(options.composerMode);

	const toolMode = options.composerMode === 'plan' ? 'plan' : 'agent';
	const tools = toOpenAITools(agentToolsForComposerMode(toolMode));

	const conversation: OAIMsg[] = threadToOpenAI(threadMessages, systemContent);
	let fullContent = '';
	const effort = openAIReasoningEffort(options.thinkingLevel ?? 'off');
	let accUsage: TurnTokenUsage | undefined;

	const mistakeLimitEnabled = options.mistakeLimitEnabled !== false;
	const threshold = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
	let consecutiveToolFailures = 0;

	const MAX_OUTPUT_RECOVERY_LIMIT = 3;
	let outputRecoveryCount = 0;

	type TurnTc = { id: string; name: string; arguments: string };

	const toolDeltaBatcher = createToolInputDeltaBatcher((p) => handlers.onToolInputDelta?.(p));

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
				handlers.onDone(fullContent);
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
			fullContent += toolResultMarker(tc.name, msg, false);
			handlers.onToolResult(tc.name, msg, false);
			return { role: 'tool', tool_call_id: tc.id, content: msg };
		}

		const toolCall: ToolCall = { id: tc.id, name: tc.name, arguments: args };

		fullContent += toolCallMarker(tc.name, args);
		handlers.onToolCall(tc.name, args);
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
			fullContent += toolResultMarker(tc.name, msg, false);
			handlers.onToolResult(tc.name, msg, false);
			return { role: 'tool', tool_call_id: tc.id, content: msg };
		}

		const execStart = Date.now();
		console.log(`[AgentLoop] tool=${tc.name} — executeTool start`);
		const result = await executeTool(toolCall, options.toolHooks);
		console.log(`[AgentLoop] tool=${tc.name} — executeTool done (${Date.now() - execStart}ms, error=${result.isError})`);
		if (mistakeLimitEnabled) {
			if (result.isError) {
				consecutiveToolFailures++;
			} else {
				consecutiveToolFailures = 0;
			}
		}

		fullContent += toolResultMarker(tc.name, result.content, !result.isError);
		handlers.onToolResult(tc.name, result.content, !result.isError);

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
	console.log(`[AgentLoop] OpenAI loop start — idleMs=${streamTimeoutConfig.idleMs} hardMs=${streamTimeoutConfig.hardMs} watchdog=${streamTimeoutConfig.idleWatchdogEnabled}`);

	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (options.signal.aborted) { console.log(`[AgentLoop] round ${round} — aborted before start`); break; }

		if (await handleMistakeLimitBeforeRound()) {
			return;
		}

		console.log(`[AgentLoop] round ${round} — starting LLM call`);
		const roundStartAt = Date.now();
		let turnText = '';
		const turnToolCalls: TurnTc[] = [];
		let turnFinishReason: string | null = null;

		// 每轮创建独立 AbortController，叠加在外部 signal 之上，用于超时自动中止
		const roundAc = new AbortController();
		const roundSignal = roundAc.signal;
		options.signal.addEventListener('abort', () => roundAc.abort(), { once: true });

		const timeoutMgr = createStreamTimeoutManager(streamTimeoutConfig, () => roundAc.abort());
		timeoutMgr.start();

		try {
			const stream = await client.chat.completions.create(
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
			);

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
						}
						if (!row.arguments || !handlers.onToolInputDelta) continue;
						const effectiveName = row.name || inferOpenAIToolNameFromPartialArguments(row.arguments);
						if (effectiveName) {
							toolDeltaBatcher.queue({ name: effectiveName, partialJson: row.arguments, index: idx });
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
				fullContent += partialText;
				handlers.onDone(fullContent, accUsage);
				return;
			}
			synthesizeMissingOpenAIToolResults(conversation, turnToolCalls, e instanceof Error ? e.message : String(e));
			handlers.onError(e instanceof Error ? e.message : String(e));
			return;
		}
		timeoutMgr.stop();
		console.log(`[AgentLoop] round ${round} — stream done (${Date.now() - roundStartAt}ms), finishReason=${turnFinishReason}, toolCalls=${turnToolCalls.filter(tc => tc.name).length}, textLen=${turnText.length}`);

		if (options.signal.aborted || roundSignal.aborted) {
			console.log(`[AgentLoop] round ${round} — aborted after stream`);
			synthesizeMissingOpenAIToolResults(conversation, turnToolCalls, '已中止生成');
			break;
		}

		turnText = unwrapAssistantContentEnvelope(turnText);
		fullContent += turnText;

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

		if (round === MAX_ROUNDS - 1) {
			console.warn(`[AgentLoop] MAX_ROUNDS (${MAX_ROUNDS}) exhausted — ending loop`);
			fullContent += `\n\n---\n⚠ 已达到单次对话最大工具轮次 (${MAX_ROUNDS})，自动停止。请发送新消息继续。`;
			handlers.onTextDelta(`\n\n---\n⚠ 已达到单次对话最大工具轮次 (${MAX_ROUNDS})，自动停止。请发送新消息继续。`);
		}
	}

	console.log(`[AgentLoop] OpenAI loop ended — calling onDone`);
	handlers.onDone(fullContent, accUsage);
}

// ─── Anthropic agent loop ───────────────────────────────────────────────────

function threadToAnthropic(messages: ChatMessage[]): MessageParam[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const out: MessageParam[] = [];
	let buf = '';
	let lastRole: 'user' | 'assistant' | null = null;
	for (const m of nonSystem) {
		const role = m.role as 'user' | 'assistant';
		if (lastRole === role) {
			buf += (buf ? '\n\n' : '') + m.content;
		} else {
			if (lastRole && buf) out.push({ role: lastRole, content: buf });
			buf = m.content;
			lastRole = role;
		}
	}
	if (lastRole && buf) out.push({ role: lastRole, content: buf });
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
	const client = new Anthropic({ apiKey: key, baseURL: baseURL || undefined });
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const system = composeSystem(storedSystem?.content, options.composerMode, options.agentSystemAppend);
	const model = options.requestModelId.trim();
	if (!model) { handlers.onError('模型请求名称为空。'); return; }
	const temperature = temperatureForMode(options.composerMode);

	const conversation: MessageParam[] = threadToAnthropic(threadMessages);
	if (conversation.length === 0) { handlers.onError('没有可发送的对话消息。'); return; }

	const toolMode = options.composerMode === 'plan' ? 'plan' : 'agent';
	const tools = toAnthropicTools(agentToolsForComposerMode(toolMode));
	let fullContent = '';
	const thinkBudget = anthropicThinkingBudget(options.thinkingLevel ?? 'off');
	let accUsage: TurnTokenUsage | undefined;

	const mistakeLimitEnabled = options.mistakeLimitEnabled !== false;
	const threshold = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
	let consecutiveToolFailures = 0;

	const MAX_OUTPUT_RECOVERY_LIMIT_A = 3;
	let outputRecoveryCountA = 0;

	type TurnTu = { id: string; name: string; input: string };

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
				handlers.onDone(fullContent);
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
			fullContent += toolResultMarker(tu.name, msg, false);
			handlers.onToolResult(tu.name, msg, false);
			return { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true };
		}

		const toolCall: ToolCall = { id: tu.id, name: tu.name, arguments: args };

		fullContent += toolCallMarker(tu.name, args);
		handlers.onToolCall(tu.name, args);
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
			fullContent += toolResultMarker(tu.name, msg, false);
			handlers.onToolResult(tu.name, msg, false);
			return { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true };
		}

		const execStart = Date.now();
		console.log(`[AgentLoop/A] tool=${tu.name} — executeTool start`);
		const result = await executeTool(toolCall, options.toolHooks);
		console.log(`[AgentLoop/A] tool=${tu.name} — executeTool done (${Date.now() - execStart}ms, error=${result.isError})`);
		if (mistakeLimitEnabled) {
			if (result.isError) {
				consecutiveToolFailures++;
			} else {
				consecutiveToolFailures = 0;
			}
		}

		fullContent += toolResultMarker(tu.name, result.content, !result.isError);
		handlers.onToolResult(tu.name, result.content, !result.isError);

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
	console.log(`[AgentLoop] Anthropic loop start — idleMs=${streamTimeoutConfigA.idleMs} hardMs=${streamTimeoutConfigA.hardMs} watchdog=${streamTimeoutConfigA.idleWatchdogEnabled}`);

	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (options.signal.aborted) { console.log(`[AgentLoop/A] round ${round} — aborted before start`); break; }

		if (await handleMistakeLimitBeforeRoundAnthropic()) {
			return;
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
		options.signal.addEventListener('abort', () => roundAcA.abort(), { once: true });

		const timeoutMgrA = createStreamTimeoutManager(streamTimeoutConfigA, () => roundAcA.abort());
		timeoutMgrA.start();

		try {
			const stream = client.messages.stream(
				{
					model,
					max_tokens: maxTokens,
					system,
					messages: conversation,
					tools: tools as Anthropic.Messages.Tool[],
					temperature,
					...(thinkingParam ? { thinking: thinkingParam } : {}),
				},
				{ signal: roundSignalA }
			);

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
							toolDeltaBatcherA.queue({
								name: tu.name,
								partialJson: tu.input,
								index: currentBlockIdx,
							});
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
				fullContent += partialTextA;
				handlers.onDone(fullContent, accUsage);
				return;
			}
			synthesizeMissingAnthropicToolResults(conversation, turnToolUses, e instanceof Error ? e.message : String(e));
			handlers.onError(e instanceof Error ? e.message : String(e));
			return;
		}
		timeoutMgrA.stop();
		console.log(`[AgentLoop/A] round ${round} — stream done (${Date.now() - roundStartAtA}ms), stopReason=${turnStopReason}, toolUses=${turnToolUses.length}, textLen=${turnText.length}`);

		if (options.signal.aborted || roundSignalA.aborted) {
			console.log(`[AgentLoop/A] round ${round} — aborted after stream`);
			synthesizeMissingAnthropicToolResults(conversation, turnToolUses, '已中止生成');
			break;
		}

		turnText = unwrapAssistantContentEnvelope(turnText);
		fullContent += turnText;

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

		if (round === MAX_ROUNDS - 1) {
			console.warn(`[AgentLoop/A] MAX_ROUNDS (${MAX_ROUNDS}) exhausted — ending loop`);
			fullContent += `\n\n---\n⚠ 已达到单次对话最大工具轮次 (${MAX_ROUNDS})，自动停止。请发送新消息继续。`;
			handlers.onTextDelta(`\n\n---\n⚠ 已达到单次对话最大工具轮次 (${MAX_ROUNDS})，自动停止。请发送新消息继续。`);
		}
	}

	console.log(`[AgentLoop/A] Anthropic loop ended — calling onDone`);
	handlers.onDone(fullContent, accUsage);
}
