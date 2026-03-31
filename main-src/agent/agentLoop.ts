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
import { composeSystem, temperatureForMode } from '../llm/modePrompts.js';
import {
	anthropicMaxTokensWithThinking,
	anthropicThinkingBudget,
	openAIReasoningEffort,
} from '../llm/thinkingLevel.js';
import { AGENT_TOOLS, toOpenAITools, toAnthropicTools, type ToolCall } from './agentTools.js';

/** 执行工具前闸门；返回 proceed:false 时不调用 executeTool，结果写入对话为失败 tool_result */
export type BeforeExecuteToolResult = { proceed: true } | { proceed: false; rejectionMessage: string };
import { executeTool, type ToolExecutionHooks } from './toolExecutor.js';

const MAX_ROUNDS = 25;
const AGENT_MAX_TOKENS = 16384;

export type ToolInputDeltaPayload = { name: string; partialJson: string; index: number };

export type AgentLoopHandlers = {
	onTextDelta: (text: string) => void;
	/** 模型边生成工具 JSON 参数时流式回调（便于 UI 实时预览写入内容） */
	onToolInputDelta?: (payload: ToolInputDeltaPayload) => void;
	/** Anthropic extended thinking 流式片段（不写入持久化 assistant 正文） */
	onThinkingDelta?: (text: string) => void;
	onToolCall: (name: string, args: Record<string, unknown>) => void;
	onToolResult: (name: string, result: string, success: boolean) => void;
	onDone: (fullContent: string) => void;
	onError: (message: string) => void;
};

export type AgentLoopOptions = {
	requestModelId: string;
	paradigm: ModelRequestParadigm;
	signal: AbortSignal;
	agentSystemAppend?: string;
	toolHooks?: ToolExecutionHooks;
	/** 在 executeTool 之前调用；用于 shell 写入等需用户确认的闸门 */
	beforeExecuteTool?: (call: ToolCall) => Promise<BeforeExecuteToolResult>;
	thinkingLevel?: ThinkingLevel;
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

export async function runAgentLoop(
	settings: ShellSettings,
	threadMessages: ChatMessage[],
	options: AgentLoopOptions,
	handlers: AgentLoopHandlers
): Promise<void> {
	switch (options.paradigm) {
		case 'anthropic':
			return runAnthropicLoop(settings, threadMessages, options, handlers);
		case 'openai-compatible':
		default:
			return runOpenAILoop(settings, threadMessages, options, handlers);
	}
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
	const key = settings.openAI?.apiKey?.trim();
	if (!key) { handlers.onError('未配置 OpenAI 兼容 API Key。请在设置 → Models → API Keys 中填写。'); return; }

	const baseURL = settings.openAI?.baseURL?.trim() || undefined;
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
	const systemContent = composeSystem(storedSystem?.content, 'agent', options.agentSystemAppend);
	const temperature = temperatureForMode('agent');

	const conversation: OAIMsg[] = threadToOpenAI(threadMessages, systemContent);
	const tools = toOpenAITools(AGENT_TOOLS);
	let fullContent = '';
	const effort = openAIReasoningEffort(options.thinkingLevel ?? 'off');

	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (options.signal.aborted) break;

		let turnText = '';
		const turnToolCalls: { id: string; name: string; arguments: string }[] = [];

		try {
			const stream = await client.chat.completions.create(
				{
					model,
					messages: conversation,
					tools,
					stream: true,
					temperature,
					max_tokens: AGENT_MAX_TOKENS,
					...(effort ? { reasoning_effort: effort } : {}),
				},
				{ signal: options.signal }
			);

			for await (const chunk of stream) {
				if (options.signal.aborted) break;

				const delta = chunk.choices[0]?.delta;
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
						if (tc.id) turnToolCalls[idx]!.id = tc.id;
						if (tc.function?.name) turnToolCalls[idx]!.name = tc.function.name;
						if (tc.function?.arguments) {
							turnToolCalls[idx]!.arguments += tc.function.arguments;
							const row = turnToolCalls[idx]!;
							if (row.name) {
								handlers.onToolInputDelta?.({ name: row.name, partialJson: row.arguments, index: idx });
							}
						}
					}
				}
			}
		} catch (e: unknown) {
			if (options.signal.aborted) break;
			handlers.onError(e instanceof Error ? e.message : String(e));
			return;
		}

		turnText = unwrapAssistantContentEnvelope(turnText);
		fullContent += turnText;

		if (turnToolCalls.length === 0 || turnToolCalls.every((tc) => !tc.name)) {
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

		for (const tc of turnToolCalls) {
			if (!tc.name) continue;
			let args: Record<string, unknown> = {};
			try { args = JSON.parse(tc.arguments || '{}'); } catch { /* use empty */ }

			const toolCall: ToolCall = { id: tc.id, name: tc.name, arguments: args };

			fullContent += toolCallMarker(tc.name, args);
			handlers.onToolCall(tc.name, args);
			// Yield to the event loop so the IPC tool_call message is flushed to the
			// renderer before we execute the tool and immediately send tool_result.
			// Without this, synchronous tools (write_to_file, str_replace) cause both
			// messages to be batched together and the frontend never sees the pending state.
			await new Promise<void>((r) => setTimeout(r, 0));

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
			if (!gate.proceed) {
				const msg = gate.rejectionMessage;
				fullContent += toolResultMarker(tc.name, msg, false);
				handlers.onToolResult(tc.name, msg, false);
				conversation.push({
					role: 'tool' as const,
					tool_call_id: tc.id,
					content: msg,
				});
				continue;
			}

			const result = await executeTool(toolCall, options.toolHooks);

			fullContent += toolResultMarker(tc.name, result.content, !result.isError);
			handlers.onToolResult(tc.name, result.content, !result.isError);

			conversation.push({
				role: 'tool' as const,
				tool_call_id: tc.id,
				content: result.content,
			});
		}
	}

	handlers.onDone(fullContent);
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
	const key = settings.anthropic?.apiKey?.trim();
	if (!key) { handlers.onError('未配置 Anthropic API Key。请在设置 → Models → API Keys 中填写。'); return; }

	const baseURL = settings.anthropic?.baseURL?.trim() || undefined;
	const client = new Anthropic({ apiKey: key, baseURL: baseURL || undefined });
	const storedSystem = threadMessages.find((m) => m.role === 'system');
	const system = composeSystem(storedSystem?.content, 'agent', options.agentSystemAppend);
	const model = options.requestModelId.trim();
	if (!model) { handlers.onError('模型请求名称为空。'); return; }
	const temperature = temperatureForMode('agent');

	const conversation: MessageParam[] = threadToAnthropic(threadMessages);
	if (conversation.length === 0) { handlers.onError('没有可发送的对话消息。'); return; }

	const tools = toAnthropicTools(AGENT_TOOLS);
	let fullContent = '';
	const thinkBudget = anthropicThinkingBudget(options.thinkingLevel ?? 'off');

	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (options.signal.aborted) break;

		let turnText = '';
		let turnThinking = '';
		let turnThinkingSignature = '';
		const turnToolUses: { id: string; name: string; input: string }[] = [];
		let currentBlockType: 'text' | 'tool_use' | 'thinking' | null = null;
		let currentBlockIdx = -1;

		const maxTokens =
			thinkBudget !== null ? anthropicMaxTokensWithThinking(thinkBudget) : AGENT_MAX_TOKENS;
		const thinkingParam =
			thinkBudget !== null
				? ({ type: 'enabled' as const, budget_tokens: thinkBudget })
				: undefined;

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
				{ signal: options.signal }
			);

			for await (const ev of stream) {
				if (options.signal.aborted) break;

				if (ev.type === 'content_block_start') {
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
							handlers.onToolInputDelta?.({
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
		} catch (e: unknown) {
			if (options.signal.aborted) break;
			handlers.onError(e instanceof Error ? e.message : String(e));
			return;
		}

		turnText = unwrapAssistantContentEnvelope(turnText);
		fullContent += turnText;

		if (turnToolUses.length === 0) {
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
			try { input = JSON.parse(tu.input || '{}'); } catch { /* use empty */ }
			assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input });
		}
		conversation.push({ role: 'assistant', content: assistantContent });

		const toolResults: ToolResultBlockParam[] = [];
		for (const tu of turnToolUses) {
			let args: Record<string, unknown> = {};
			try { args = JSON.parse(tu.input || '{}'); } catch { /* use empty */ }

			const toolCall: ToolCall = { id: tu.id, name: tu.name, arguments: args };

			fullContent += toolCallMarker(tu.name, args);
			handlers.onToolCall(tu.name, args);
			await new Promise<void>((r) => setTimeout(r, 0));

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
			if (!gate.proceed) {
				const msg = gate.rejectionMessage;
				fullContent += toolResultMarker(tu.name, msg, false);
				handlers.onToolResult(tu.name, msg, false);
				toolResults.push({
					type: 'tool_result',
					tool_use_id: tu.id,
					content: msg,
					is_error: true,
				});
				continue;
			}

			const result = await executeTool(toolCall, options.toolHooks);

			fullContent += toolResultMarker(tu.name, result.content, !result.isError);
			handlers.onToolResult(tu.name, result.content, !result.isError);

			toolResults.push({
				type: 'tool_result',
				tool_use_id: tu.id,
				content: result.content,
				is_error: result.isError,
			});
		}

		conversation.push({ role: 'user', content: toolResults });
	}

	handlers.onDone(fullContent);
}
