import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content } from '@google/generative-ai';
import type { ChatMessage } from '../threadStore.js';
import type { ShellSettings } from '../settingsStore.js';
import { composeSystem, temperatureForMode } from './modePrompts.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import { llmSdkResponseHeadTimeoutMs } from './sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from './llmTransportRetry.js';
import { formatLlmSdkError } from './formatLlmSdkError.js';
import { prependProviderIdentitySystemPrompt } from './providerIdentity.js';

function toGeminiContents(messages: ChatMessage[]): Content[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const contents: Content[] = [];
	for (const m of nonSystem) {
		const role = m.role === 'user' ? 'user' : 'model';
		const last = contents[contents.length - 1];
		if (last && last.role === role) {
			const prev = last.parts[0];
			if (prev && 'text' in prev && typeof prev.text === 'string') {
				last.parts = [{ text: `${prev.text}\n\n${m.content}` }];
			}
		} else {
			contents.push({ role, parts: [{ text: m.content }] });
		}
	}
	return contents;
}

export async function streamGemini(
	settings: ShellSettings,
	messages: ChatMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	const key = options.requestApiKey.trim();
	if (!key) {
		handlers.onError('未配置 Google Gemini API Key。请在设置 → 模型中填写全局密钥或该模型的独立密钥。');
		return;
	}

	const storedSystem = messages.find((m) => m.role === 'system');
	const systemInstruction = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend)
	);
	const modelId = options.requestModelId.trim();
	if (!modelId) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}
	const temperature = temperatureForMode(options.mode);

	const genAI = new GoogleGenerativeAI(key);
	const model = genAI.getGenerativeModel({
		model: modelId,
		systemInstruction,
		generationConfig: { temperature, maxOutputTokens: options.maxOutputTokens },
	});

	const contents = toGeminiContents(messages);
	if (contents.length === 0) {
		handlers.onError('没有可发送的对话消息。');
		return;
	}

	let full = '';
	let usage: TurnTokenUsage | undefined;
	try {
		const streamResult = await withLlmTransportRetry(
			async () => {
				const connectAc = new AbortController();
				const onUserAbort = () => connectAc.abort();
				if (options.signal.aborted) {
					connectAc.abort();
				} else {
					options.signal.addEventListener('abort', onUserAbort, { once: true });
				}
				const connectTimer = setTimeout(() => connectAc.abort(), llmSdkResponseHeadTimeoutMs());
				try {
					return await model.generateContentStream({ contents }, { signal: connectAc.signal });
				} finally {
					clearTimeout(connectTimer);
					options.signal.removeEventListener('abort', onUserAbort);
				}
			},
			{ signal: options.signal }
		);

		for await (const chunk of streamResult.stream) {
			if (options.signal.aborted) {
				break;
			}
			const text = chunk.text();
			if (text) {
				full += text;
				handlers.onDelta(text);
			}
			if (chunk.usageMetadata) {
				usage = {
					inputTokens: chunk.usageMetadata.promptTokenCount,
					outputTokens: chunk.usageMetadata.candidatesTokenCount,
				};
			}
		}
		handlers.onDone(full, usage);
	} catch (e: unknown) {
		if (options.signal.aborted) {
			handlers.onDone(full, usage);
			return;
		}
		if (e instanceof Error && e.name === 'AbortError') {
			handlers.onError('连接超时：无法在限定时间内建立与 Gemini 的响应。请检查网络后重试。');
			return;
		}
		handlers.onError(formatLlmSdkError(e));
	}
}
