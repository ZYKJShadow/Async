import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { composeSystem, temperatureForMode } from './modePrompts.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import {
	anthropicEffectiveMaxTokens,
	anthropicEffectiveTemperature,
	anthropicThinkingBudget,
} from './thinkingLevel.js';
import { resolveStreamTimeouts, createStreamTimeoutManager } from './streamTimeouts.js';
import {
	addAnthropicCacheBreakpoints,
	buildAnthropicSystemForApi,
	isAnthropicPromptCachingEnabled,
} from './anthropicPromptCache.js';
import { llmSdkResponseHeadTimeoutMs } from './sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from './llmTransportRetry.js';
import { formatLlmSdkError } from './formatLlmSdkError.js';
import {
	applyAnthropicProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
} from './providerIdentity.js';

function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const out: MessageParam[] = [];
	let buf = '';
	let lastRole: 'user' | 'assistant' | null = null;
	for (const m of nonSystem) {
		const role = m.role as 'user' | 'assistant';
		if (lastRole === role) {
			buf += (buf ? '\n\n' : '') + m.content;
		} else {
			if (lastRole && buf) {
				out.push({ role: lastRole, content: buf });
			}
			buf = m.content;
			lastRole = role;
		}
	}
	if (lastRole && buf) {
		out.push({ role: lastRole, content: buf });
	}
	return out;
}

export async function streamAnthropic(
	settings: ShellSettings,
	messages: ChatMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	const key = options.requestApiKey.trim();
	if (!key) {
		handlers.onError('未配置 Anthropic API Key。请在设置 → 模型中填写全局密钥或该模型的独立密钥。');
		return;
	}

	const baseURL = options.requestBaseURL?.trim() || undefined;
// maxRetries: 0，避免流式请求自动重试拉长等待
	const client = new Anthropic(
		applyAnthropicProviderIdentity(settings, {
			apiKey: key,
			baseURL: baseURL || undefined,
			timeout: llmSdkResponseHeadTimeoutMs(),
			maxRetries: 0,
		})
	);

	const storedSystem = messages.find((m) => m.role === 'system');
	const systemText = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend)
	);
	const model = options.requestModelId.trim();
	if (!model) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}
	const promptCaching = isAnthropicPromptCachingEnabled(model);
	const system = buildAnthropicSystemForApi(systemText, promptCaching);
	const anthropicMessages = addAnthropicCacheBreakpoints(
		toAnthropicMessages(messages),
		promptCaching,
		false
	);
	const anthropicMetadata = buildAnthropicProviderIdentityMetadata(settings);
	const thinkBudget = anthropicThinkingBudget(options.thinkingLevel ?? 'off');
	const temperature = anthropicEffectiveTemperature(temperatureForMode(options.mode), thinkBudget);
	const maxTokens = anthropicEffectiveMaxTokens(thinkBudget, options.maxOutputTokens);
	const thinkingParam =
		thinkBudget !== null
			? ({ type: 'enabled' as const, budget_tokens: thinkBudget })
			: undefined;

	if (anthropicMessages.length === 0) {
		handlers.onError('没有可发送的对话消息。');
		return;
	}

	let full = '';
	let usage: TurnTokenUsage | undefined;
	let activeStream: { abort?: () => void } | null = null;

	const timeoutAc = new AbortController();
	const onAbort = () => {
		timeoutAc.abort();
		try {
			activeStream?.abort?.();
		} catch {
			/* ignore */
		}
	};
	if (options.signal.aborted) {
		timeoutAc.abort();
	} else {
		options.signal.addEventListener('abort', onAbort, { once: true });
	}

	const timeoutConfig = resolveStreamTimeouts(settings);
	const timeoutMgr = createStreamTimeoutManager(timeoutConfig, () => timeoutAc.abort());
	timeoutMgr.start();

	try {
		const stream = await withLlmTransportRetry(
			async () => {
				const s = client.messages.stream(
					{
						model,
						max_tokens: maxTokens,
						system,
						messages: anthropicMessages,
						temperature,
						...(anthropicMetadata ? { metadata: anthropicMetadata } : {}),
						...(thinkingParam ? { thinking: thinkingParam } : {}),
					},
					{ signal: timeoutAc.signal }
				);
				await s.withResponse();
				return s;
			},
			{ signal: options.signal }
		);
		activeStream = stream as { abort?: () => void };

		for await (const ev of stream) {
			if (timeoutAc.signal.aborted) {
				break;
			}
			timeoutMgr.onChunk();
			if (ev.type === 'message_start' && ev.message.usage) {
				usage = {
					inputTokens: ev.message.usage.input_tokens,
					outputTokens: ev.message.usage.output_tokens,
					cacheReadTokens: (ev.message.usage as any).cache_read_input_tokens,
					cacheWriteTokens: (ev.message.usage as any).cache_creation_input_tokens,
				};
			} else if (ev.type === 'message_delta' && ev.usage) {
				usage = {
					...(usage ?? {}),
					outputTokens: ev.usage.output_tokens,
				};
			} else if (ev.type === 'content_block_delta') {
				if (ev.delta.type === 'text_delta') {
					const piece = ev.delta.text;
					if (piece) {
						full += piece;
						handlers.onDelta(piece);
					}
				} else if (ev.delta.type === 'thinking_delta') {
					const piece = ev.delta.thinking;
					if (piece) {
						handlers.onThinkingDelta?.(piece);
					}
				}
			}
		}
		timeoutMgr.stop();
		handlers.onDone(full, usage);
	} catch (e: unknown) {
		timeoutMgr.stop();
		if (options.signal.aborted) {
			handlers.onDone(full, usage);
			return;
		}
		if (timeoutAc.signal.aborted) {
			handlers.onError('连接超时：LLM 响应过慢，已自动中止。请重试或检查网络。');
			return;
		}
		handlers.onError(formatLlmSdkError(e));
	} finally {
		activeStream = null;
		options.signal.removeEventListener('abort', onAbort);
	}
}
