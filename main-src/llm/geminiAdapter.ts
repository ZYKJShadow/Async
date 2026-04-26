import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content, Part } from '@google/generative-ai';
import type { ShellSettings } from '../settingsStore.js';
import { composeSystem, temperatureForMode } from './modePrompts.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import { resolveRequestedTemperature } from './thinkingLevel.js';
import { llmSdkResponseHeadTimeoutMs } from './sdkResponseHeadTimeoutMs.js';
import { withLlmTransportRetry } from './llmTransportRetry.js';
import { formatLlmSdkError } from './formatLlmSdkError.js';
import { prependProviderIdentitySystemPrompt } from './providerIdentity.js';
import type { SendableMessage } from './sendResolved.js';
import { userMessageTextForSend } from './sendResolved.js';
import { buildGeminiUserParts } from './resolvedUserSerialize.js';
import { streamAntigravityOAuth } from './antigravityAdapter.js';

function appendTextToLastTextPart(last: Content, text: string): boolean {
	for (let i = last.parts.length - 1; i >= 0; i--) {
		const p = last.parts[i]!;
		if ('text' in p && typeof p.text === 'string') {
			last.parts[i] = { text: `${p.text}\n\n${text}` };
			return true;
		}
	}
	return false;
}

function toGeminiContents(messages: SendableMessage[]): Content[] {
	const nonSystem = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	const contents: Content[] = [];
	for (const m of nonSystem) {
		const role = m.role === 'user' ? 'user' : 'model';
		const parts: Part[] =
			role === 'user' && m.resolved && m.resolved.hasImages
				? buildGeminiUserParts(m.resolved)
				: [{ text: role === 'user' ? userMessageTextForSend(m) : m.content }];
		const last = contents[contents.length - 1];
		if (last && last.role === role) {
			if (parts.length === 1 && 'text' in parts[0]! && typeof parts[0]!.text === 'string') {
				if (appendTextToLastTextPart(last, parts[0]!.text)) {
					continue;
				}
			}
			last.parts.push(...parts);
		} else {
			contents.push({ role, parts });
		}
	}
	return contents;
}

export async function streamGemini(
	settings: ShellSettings,
	messages: SendableMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers
): Promise<void> {
	if (options.requestOAuthAuth?.provider === 'antigravity') {
		await streamAntigravityOAuth(settings, messages, options, handlers, options.requestOAuthAuth);
		return;
	}

	const key = options.requestApiKey.trim();
	if (!key) {
		handlers.onError('未配置 Google Gemini API Key。请在设置 → 模型中填写全局密钥或该模型的独立密钥。');
		return;
	}

	const storedSystem = messages.find((m) => m.role === 'system');
	const systemInstruction = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend),
		options.requestProviderIdentity
	);
	const modelId = options.requestModelId.trim();
	if (!modelId) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}
	const temperature = resolveRequestedTemperature(
		temperatureForMode(options.mode),
		options.temperatureMode,
		options.temperature
	);

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
