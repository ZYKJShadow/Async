import { randomUUID } from 'node:crypto';

import type { ShellSettings, ProviderOAuthAuthRecord } from '../settingsStore.js';
import type { StreamHandlers, TurnTokenUsage, UnifiedChatOptions } from './types.js';
import type { SendableMessage } from './sendResolved.js';
import { userMessageTextForSend } from './sendResolved.js';
import { composeSystem, temperatureForMode } from './modePrompts.js';
import {
	openAIReasoningEffort,
	resolveRequestedTemperature,
} from './thinkingLevel.js';
import { CODEX_EMULATED_VERSION, CODEX_ORIGINATOR } from '../../src/providerIdentitySettings.js';
import { buildCodexUserAgent } from './codexUserAgent.js';
import { ensureFreshOAuthAuthForRequest } from './providerOAuthLogin.js';
import { prependProviderIdentitySystemPrompt } from './providerIdentity.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function buildResponsesInput(messages: SendableMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
	return messages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.map((m) => ({
			role: m.role as 'user' | 'assistant',
			content: m.role === 'user' ? userMessageTextForSend(m) : m.content,
		}))
		.filter((m) => m.content.trim().length > 0);
}

function extractUsageFromCompleted(data: Record<string, unknown>): TurnTokenUsage | undefined {
	const response = data.response;
	if (!response || typeof response !== 'object') {
		return undefined;
	}
	const usage = (response as Record<string, unknown>).usage;
	if (!usage || typeof usage !== 'object') {
		return undefined;
	}
	const record = usage as Record<string, unknown>;
	const inputTokens = typeof record.input_tokens === 'number' ? record.input_tokens : undefined;
	const outputTokens = typeof record.output_tokens === 'number' ? record.output_tokens : undefined;
	return inputTokens != null || outputTokens != null ? { inputTokens, outputTokens } : undefined;
}

function extractCompletedText(data: Record<string, unknown>): string {
	const response = data.response;
	if (!response || typeof response !== 'object') {
		return '';
	}
	const output = (response as Record<string, unknown>).output;
	if (!Array.isArray(output)) {
		return '';
	}
	let text = '';
	for (const item of output) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const content = (item as Record<string, unknown>).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const part of content) {
			if (!part || typeof part !== 'object') {
				continue;
			}
			const record = part as Record<string, unknown>;
			const value = record.text ?? record.output_text;
			if (typeof value === 'string') {
				text += value;
			}
		}
	}
	return text;
}

function parseSsePayload(line: string): Record<string, unknown> | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) {
		return undefined;
	}
	const data = trimmed.slice(5).trim();
	if (!data || data === '[DONE]') {
		return undefined;
	}
	try {
		return JSON.parse(data) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export async function streamCodexOAuth(
	settings: ShellSettings,
	messages: SendableMessage[],
	options: UnifiedChatOptions,
	handlers: StreamHandlers,
	auth: ProviderOAuthAuthRecord
): Promise<void> {
	const freshAuth = await ensureFreshOAuthAuthForRequest(options.requestProviderId, auth);
	const token = freshAuth.accessToken.trim();
	if (!token) {
		handlers.onError('Codex OAuth token 为空，请重新登录 Codex。');
		return;
	}
	const model = options.requestModelId.trim();
	if (!model) {
		handlers.onError('模型请求名称为空。请在 Models 中编辑该模型的「请求名称」。');
		return;
	}

	const storedSystem = messages.find((m) => m.role === 'system');
	const systemContent = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend),
		options.requestProviderIdentity
	);
	const requestedTemperature = resolveRequestedTemperature(
		temperatureForMode(options.mode),
		options.temperatureMode,
		options.temperature
	);
	const effort = openAIReasoningEffort(options.thinkingLevel ?? 'off');
	const body = {
		model,
		instructions: systemContent,
		input: buildResponsesInput(messages),
		stream: true,
		temperature: requestedTemperature,
		max_output_tokens: options.maxOutputTokens,
		...(effort ? { reasoning: { effort } } : {}),
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
		const response = await fetch(`${(options.requestBaseURL?.trim() || CODEX_BASE_URL).replace(/\/$/, '')}/responses`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				Connection: 'Keep-Alive',
				'User-Agent': buildCodexUserAgent(CODEX_EMULATED_VERSION),
				Originator: CODEX_ORIGINATOR,
				Session_id: randomUUID(),
				...(freshAuth.accountId ? { 'Chatgpt-Account-Id': freshAuth.accountId } : {}),
			},
			body: JSON.stringify(body),
			signal: timeoutAc.signal,
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			handlers.onError(`Codex OAuth request failed with ${response.status}: ${text.trim() || response.statusText}`);
			return;
		}
		if (!response.body) {
			handlers.onError('Codex OAuth response body is empty.');
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
				const type = typeof data.type === 'string' ? data.type : '';
				if (type === 'response.output_text.delta' && typeof data.delta === 'string') {
					full += data.delta;
					handlers.onDelta(data.delta);
				} else if (type === 'response.reasoning_summary_text.delta' && typeof data.delta === 'string') {
					handlers.onThinkingDelta?.(data.delta);
				} else if (type === 'response.completed') {
					usage = extractUsageFromCompleted(data) ?? usage;
					if (!full) {
						const completedText = extractCompletedText(data);
						if (completedText) {
							full = completedText;
							handlers.onDelta(completedText);
						}
					}
				} else if (type === 'response.failed' || type === 'error') {
					const error = data.error;
					const message =
						error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string'
							? String((error as Record<string, unknown>).message)
							: JSON.stringify(data);
					handlers.onError(message);
					return;
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
