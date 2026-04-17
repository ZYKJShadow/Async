import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { composeSystem, temperatureForMode } from './modePrompts.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import { openAIReasoningEffort } from './thinkingLevel.js';
import { resolveStreamTimeouts, createStreamTimeoutManager } from './streamTimeouts.js';
import { llmSdkResponseHeadTimeoutMs } from './sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from './llmTransportRetry.js';
import { formatLlmSdkError } from './formatLlmSdkError.js';
import {
	applyOpenAIProviderIdentity,
	prependProviderIdentitySystemPrompt,
} from './providerIdentity.js';

export async function streamOpenAICompatible(
	settings: ShellSettings,
	messages: ChatMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	const key = options.requestApiKey.trim();
	if (!key) {
		handlers.onError('未配置 OpenAI 兼容 API Key。请在设置 → 模型中填写全局密钥或该模型的独立密钥。');
		return;
	}

	const baseURL = options.requestBaseURL?.trim() || undefined;
	const model = options.requestModelId.trim();
	if (!model) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}

	const proxyRaw = (options.requestProxyUrl?.trim() || settings.openAI?.proxyUrl?.trim()) ?? '';
	let httpAgent: InstanceType<typeof HttpsProxyAgent> | undefined;
	if (proxyRaw) {
		try {
			httpAgent = new HttpsProxyAgent(proxyRaw);
		} catch {
			handlers.onError('代理地址无效，请在设置 → 模型 → 提供商中检查 HTTP 代理格式（如 http://127.0.0.1:7890）。');
			return;
		}
	}

// maxRetries: 0，避免 SDK 对超时类失败自动重试拉长等待
	const client = new OpenAI(
		applyOpenAIProviderIdentity(settings, {
			apiKey: key,
			baseURL,
			httpAgent,
			dangerouslyAllowBrowser: false,
			timeout: llmSdkResponseHeadTimeoutMs(),
			maxRetries: 0,
		})
	);

	const apiMessages = messages
		.filter((m) => m.role !== 'system')
		.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

	const storedSystem = messages.find((m) => m.role === 'system');
	const systemContent = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend)
	);
	const temperature = temperatureForMode(options.mode);
	const effort = openAIReasoningEffort(options.thinkingLevel ?? 'off');

	let full = '';
	let buffer = '';
	let inThinking = false;
	let usage: TurnTokenUsage | undefined;
	let activeStream: { controller?: { abort?: () => void } } | null = null;

	const timeoutAc = new AbortController();
	const onAbort = () => {
		timeoutAc.abort();
		try {
			activeStream?.controller?.abort?.();
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
			() =>
				client.chat.completions.create(
					{
						model,
						messages: [{ role: 'system' as const, content: systemContent }, ...apiMessages],
						stream: true,
						stream_options: { include_usage: true },
						temperature,
						max_tokens: options.maxOutputTokens,
						...(effort ? { reasoning_effort: effort } : {}),
					},
					{ signal: timeoutAc.signal }
				),
			{ signal: options.signal }
		);
		activeStream = stream as { controller?: { abort?: () => void } };

		for await (const chunk of stream) {
			if (timeoutAc.signal.aborted) {
				break;
			}
			timeoutMgr.onChunk();

			// 提取 usage（通常在最后一个 chunk，choices 为空时携带）
			if (chunk.usage) {
				usage = {
					inputTokens: chunk.usage.prompt_tokens,
					outputTokens: chunk.usage.completion_tokens,
				};
			}

			// 1. natively supported reasoning_content (e.g. DeepSeek API)
			// eslint-disable-next  @typescript-eslint/no-explicit-any
			const reasoningPiece = (chunk.choices[0]?.delta as any)?.reasoning_content ?? '';
			if (reasoningPiece) {
				handlers.onThinkingDelta?.(reasoningPiece);
			}

			// 2. parse <think> tags in content
			const piece = chunk.choices[0]?.delta?.content ?? '';
			if (piece) {
				buffer += piece;

				while (buffer.length > 0) {
					if (!inThinking) {
						const openIdx = buffer.indexOf('<think>');
						if (openIdx !== -1) {
							const textBefore = buffer.slice(0, openIdx);
							if (textBefore) {
								full += textBefore;
								handlers.onDelta(textBefore);
							}
							inThinking = true;
							buffer = buffer.slice(openIdx + 7);
						} else {
							// Check for partial '<think>' at the end
							const partialOpen = ['<', '<t', '<th', '<thi', '<thin', '<think'].find((p) => buffer.endsWith(p));
							if (partialOpen) {
								const safeText = buffer.slice(0, buffer.length - partialOpen.length);
								if (safeText) {
									full += safeText;
									handlers.onDelta(safeText);
								}
								buffer = partialOpen;
								break; // wait for next chunk
							} else {
								full += buffer;
								handlers.onDelta(buffer);
								buffer = '';
							}
						}
					} else {
						const closeIdx = buffer.indexOf('</think>');
						if (closeIdx !== -1) {
							const thinkText = buffer.slice(0, closeIdx);
							if (thinkText) {
								handlers.onThinkingDelta?.(thinkText);
							}
							inThinking = false;
							buffer = buffer.slice(closeIdx + 8);
						} else {
							const partialClose = ['<', '</', '</t', '</th', '</thi', '</thin', '</think'].find((p) => buffer.endsWith(p));
							if (partialClose) {
								const safeText = buffer.slice(0, buffer.length - partialClose.length);
								if (safeText) {
									handlers.onThinkingDelta?.(safeText);
								}
								buffer = partialClose;
								break;
							} else {
								handlers.onThinkingDelta?.(buffer);
								buffer = '';
							}
						}
					}
				}
			}
		}

		if (buffer) {
			if (inThinking) {
				handlers.onThinkingDelta?.(buffer);
			} else {
				full += buffer;
				handlers.onDelta(buffer);
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
