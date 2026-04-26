import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ShellSettings } from '../settingsStore.js';
import { composeSystemSections, temperatureForMode } from './modePrompts.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import {
	anthropicEffectiveMaxTokens,
	anthropicEffectiveTemperature,
	anthropicThinkingBudget,
	resolveRequestedTemperature,
} from './thinkingLevel.js';
import { resolveStreamTimeouts, createStreamTimeoutManager } from './streamTimeouts.js';
import {
	addAnthropicCacheBreakpoints,
	type AnthropicCacheBreakpointDecision,
	buildAnthropicSystemForApi,
	isAnthropicPromptCachingEnabled,
	observeAnthropicPromptCacheUsage,
} from './anthropicPromptCache.js';
import { llmSdkResponseHeadTimeoutMs } from './sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from './llmTransportRetry.js';
import { formatLlmSdkError } from './formatLlmSdkError.js';
import {
	applyAnthropicProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
	providerIdentityForOAuthAuth,
} from './providerIdentity.js';
import type { SendableMessage } from './sendResolved.js';
import { userMessageTextForSend } from './sendResolved.js';
import { buildAnthropicUserBlocks } from './resolvedUserSerialize.js';
import { ensureFreshOAuthAuthForRequest } from './providerOAuthLogin.js';

function toAnthropicMessages(messages: SendableMessage[]): MessageParam[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const out: MessageParam[] = [];
	type Pending = { role: 'user' | 'assistant'; blocks: ContentBlockParam[] };
	let cur: Pending | null = null;
	const flush = () => {
		if (cur && cur.blocks.length > 0) {
			out.push({ role: cur.role, content: cur.blocks });
		}
		cur = null;
	};
	for (const m of nonSystem) {
		const role = m.role as 'user' | 'assistant';
		const blocks: ContentBlockParam[] =
			role === 'user' && m.resolved && m.resolved.hasImages
				? buildAnthropicUserBlocks(m.resolved)
				: [{ type: 'text', text: role === 'user' ? userMessageTextForSend(m) : m.content }];
		if (cur && cur.role === role) {
			cur.blocks.push(...blocks);
		} else {
			flush();
			cur = { role, blocks: [...blocks] };
		}
	}
	flush();
	return out;
}

export async function streamAnthropic(
	settings: ShellSettings,
	messages: SendableMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	const oauthAuth =
		options.requestOAuthAuth?.provider === 'claude'
			? await ensureFreshOAuthAuthForRequest(options.requestProviderId, options.requestOAuthAuth)
			: undefined;
	const key = (oauthAuth?.accessToken ?? options.requestApiKey).trim();
	if (!key) {
		handlers.onError('未配置 Anthropic API Key。请在设置 → 模型中填写全局密钥或该模型的独立密钥。');
		return;
	}

	const baseURL = options.requestBaseURL?.trim() || undefined;
	const requestProviderIdentity = providerIdentityForOAuthAuth(oauthAuth) ?? options.requestProviderIdentity;
// maxRetries: 0，避免流式请求自动重试拉长等待
	const client = new Anthropic(
		applyAnthropicProviderIdentity(settings, {
			...(oauthAuth ? { authToken: key, apiKey: null } : { apiKey: key }),
			baseURL: baseURL || undefined,
			timeout: llmSdkResponseHeadTimeoutMs(),
			maxRetries: 0,
		}, requestProviderIdentity)
	);

	const storedSystem = messages.find((m) => m.role === 'system');
	const model = options.requestModelId.trim();
	if (!model) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}
	const promptCaching = isAnthropicPromptCachingEnabled(model);
	const systemSections = composeSystemSections(
		storedSystem?.content,
		options.mode,
		options.agentSystemAppend
	);
	const system = buildAnthropicSystemForApi(
		{
			...systemSections,
			staticText: prependProviderIdentitySystemPrompt(settings, systemSections.staticText, requestProviderIdentity),
			fullText: prependProviderIdentitySystemPrompt(settings, systemSections.fullText, requestProviderIdentity),
		},
		promptCaching
	);
	let cacheDecision: AnthropicCacheBreakpointDecision | undefined;
	const anthropicMessages = addAnthropicCacheBreakpoints(
		toAnthropicMessages(messages),
		promptCaching,
		{
			strategy: 'stable-prefix',
			onDecision: (decision) => { cacheDecision = decision; },
		}
	);
	const anthropicMetadata = buildAnthropicProviderIdentityMetadata(settings, requestProviderIdentity);
	const thinkBudget = anthropicThinkingBudget(options.thinkingLevel ?? 'off');
	const requestedTemperature = resolveRequestedTemperature(
		temperatureForMode(options.mode),
		options.temperatureMode,
		options.temperature
	);
	const temperature = anthropicEffectiveTemperature(requestedTemperature, thinkBudget);
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
		observeAnthropicPromptCacheUsage({
			source: `chat:${options.mode}`,
			model,
			usage,
			decision: cacheDecision,
			system,
		});
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
