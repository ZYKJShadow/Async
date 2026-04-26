import { createHash, randomUUID } from 'node:crypto';

import type { Content, Part } from '@google/generative-ai';
import type { ShellSettings, ProviderOAuthAuthRecord } from '../settingsStore.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import type { SendableMessage } from './sendResolved.js';
import { userMessageTextForSend } from './sendResolved.js';
import { buildGeminiUserParts } from './resolvedUserSerialize.js';
import { composeSystem, temperatureForMode } from './modePrompts.js';
import { resolveRequestedTemperature } from './thinkingLevel.js';
import { prependProviderIdentitySystemPrompt } from './providerIdentity.js';
import { ANTIGRAVITY_USER_AGENT } from '../../src/providerIdentitySettings.js';
import { ensureFreshOAuthAuthForRequest } from './providerOAuthLogin.js';
import { electronNetFetch } from './electronNetFetch.js';

const ANTIGRAVITY_BASE_URL = 'https://cloudcode-pa.googleapis.com';

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

function stableSessionId(contents: Content[]): string {
	const firstUser = contents.find((content) => content.role === 'user');
	const firstText = firstUser?.parts.find((part) => 'text' in part && typeof part.text === 'string');
	const text = firstText && 'text' in firstText ? firstText.text : randomUUID();
	const hash = createHash('sha256').update(text).digest();
	const value = hash.readBigUInt64BE(0) & BigInt('0x7fffffffffffffff');
	return `-${value.toString(10)}`;
}

function parseSsePayload(line: string): Record<string, unknown> | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) {
		return undefined;
	}
	const raw = trimmed.slice(5).trim();
	if (!raw || raw === '[DONE]') {
		return undefined;
	}
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function responseObject(data: Record<string, unknown>): Record<string, unknown> {
	const response = data.response;
	return response && typeof response === 'object' ? response as Record<string, unknown> : data;
}

function extractParts(response: Record<string, unknown>): Array<Record<string, unknown>> {
	const candidates = response.candidates;
	if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== 'object') {
		return [];
	}
	const content = (candidates[0] as Record<string, unknown>).content;
	if (!content || typeof content !== 'object') {
		return [];
	}
	const parts = (content as Record<string, unknown>).parts;
	return Array.isArray(parts)
		? parts.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object'))
		: [];
}

function extractUsage(response: Record<string, unknown>): TurnTokenUsage | undefined {
	const usage = response.usageMetadata;
	if (!usage || typeof usage !== 'object') {
		return undefined;
	}
	const record = usage as Record<string, unknown>;
	const inputTokens = typeof record.promptTokenCount === 'number' ? record.promptTokenCount : undefined;
	const outputTokens = typeof record.candidatesTokenCount === 'number' ? record.candidatesTokenCount : undefined;
	return inputTokens != null || outputTokens != null ? { inputTokens, outputTokens } : undefined;
}

export async function streamAntigravityOAuth(
	settings: ShellSettings,
	messages: SendableMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers,
	auth: ProviderOAuthAuthRecord
): Promise<void> {
	const freshAuth = await ensureFreshOAuthAuthForRequest(options.requestProviderId, auth);
	const token = freshAuth.accessToken.trim();
	if (!token) {
		handlers.onError('Antigravity OAuth token 为空，请重新登录 Antigravity。');
		return;
	}
	const model = options.requestModelId.trim();
	if (!model) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}
	const storedSystem = messages.find((m) => m.role === 'system');
	const systemInstruction = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend),
		options.requestProviderIdentity
	);
	const temperature = resolveRequestedTemperature(
		temperatureForMode(options.mode),
		options.temperatureMode,
		options.temperature
	);
	const contents = toGeminiContents(messages);
	if (contents.length === 0) {
		handlers.onError('没有可发送的对话消息。');
		return;
	}

	const request = {
		contents,
		generationConfig: {
			temperature,
			maxOutputTokens: options.maxOutputTokens,
		},
		sessionId: stableSessionId(contents),
		...(systemInstruction.trim()
			? { systemInstruction: { role: 'user', parts: [{ text: systemInstruction }] } }
			: {}),
	};
	const body = {
		model,
		userAgent: 'antigravity',
		requestType: model.includes('image') ? 'image_gen' : 'agent',
		project: freshAuth.projectId || `async-${randomUUID().slice(0, 8)}`,
		requestId: `agent-${randomUUID()}`,
		request,
	};

	const timeoutAc = new AbortController();
	const onAbort = () => timeoutAc.abort();
	if (options.signal.aborted) {
		timeoutAc.abort();
	} else {
		options.signal.addEventListener('abort', onAbort, { once: true });
	}

	let full = '';
	let usage: TurnTokenUsage | undefined;
	try {
		const baseURL = (options.requestBaseURL?.trim() || ANTIGRAVITY_BASE_URL).replace(/\/$/, '');
		const response = await electronNetFetch(`${baseURL}/v1internal:streamGenerateContent?alt=sse`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': ANTIGRAVITY_USER_AGENT,
			},
			body: JSON.stringify(body),
			signal: timeoutAc.signal,
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			handlers.onError(`Antigravity request failed with ${response.status}: ${text.trim() || response.statusText}`);
			return;
		}
		if (!response.body) {
			handlers.onError('Antigravity response body is empty.');
			return;
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const data = parseSsePayload(line);
				if (!data) {
					continue;
				}
				const responseData = responseObject(data);
				usage = extractUsage(responseData) ?? usage;
				for (const part of extractParts(responseData)) {
					if (typeof part.text === 'string' && part.text) {
						if (part.thought === true) {
							handlers.onThinkingDelta?.(part.text);
						} else {
							full += part.text;
							handlers.onDelta(part.text);
						}
					}
				}
			}
		}
		handlers.onDone(full, usage);
	} catch (error) {
		if (options.signal.aborted || timeoutAc.signal.aborted) {
			handlers.onDone(full, usage);
			return;
		}
		handlers.onError(error instanceof Error ? error.message : String(error));
	} finally {
		options.signal.removeEventListener('abort', onAbort);
	}
}
