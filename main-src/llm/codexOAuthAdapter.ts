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
import {
	prependProviderIdentitySystemPrompt,
	providerIdentityForOAuthAuth,
} from './providerIdentity.js';
import { electronNetFetch } from './electronNetFetch.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

type CodexResponseInput = Array<{ role: 'user' | 'assistant'; content: string }>;

type CodexOutputItemStore = {
	byIndex: Map<number, Record<string, unknown>>;
	fallback: Record<string, unknown>[];
};

export type CodexOAuthTextRequest = {
	auth: ProviderOAuthAuthRecord;
	providerId?: string;
	model: string;
	baseURL?: string;
	instructions: string;
	input: string | CodexResponseInput;
	temperature?: number;
	maxOutputTokens?: number;
	reasoningEffort?: string;
	signal?: AbortSignal;
};

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

function extractTextFromOutput(output: unknown): string {
	if (!Array.isArray(output)) {
		return '';
	}
	let text = '';
	for (const item of output) {
		text += extractTextFromOutputItem(item);
	}
	return text;
}

function extractTextFromOutputItem(item: unknown): string {
	if (!item || typeof item !== 'object') {
		return '';
	}
	const content = (item as Record<string, unknown>).content;
	if (!Array.isArray(content)) {
		return '';
	}
	let text = '';
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
	return text;
}

function extractCompletedText(data: Record<string, unknown>): string {
	const response = data.response;
	if (!response || typeof response !== 'object') {
		return '';
	}
	return extractTextFromOutput((response as Record<string, unknown>).output);
}

function collectOutputItemDone(data: Record<string, unknown>, store: CodexOutputItemStore): void {
	const item = data.item;
	if (!item || typeof item !== 'object' || Array.isArray(item)) {
		return;
	}
	const outputIndex = data.output_index;
	if (typeof outputIndex === 'number' && Number.isFinite(outputIndex)) {
		store.byIndex.set(outputIndex, item as Record<string, unknown>);
		return;
	}
	store.fallback.push(item as Record<string, unknown>);
}

function extractCollectedOutputText(store: CodexOutputItemStore): string {
	const indexed = [...store.byIndex.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, item]) => item);
	return extractTextFromOutput([...indexed, ...store.fallback]);
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

function codexResponsesUrl(baseURL: string | undefined): string {
	return `${(baseURL?.trim() || CODEX_BASE_URL).replace(/\/$/, '')}/responses`;
}

function buildCodexOAuthHeaders(
	freshAuth: ProviderOAuthAuthRecord,
	stream: boolean
): Record<string, string> {
	return {
		Authorization: `Bearer ${freshAuth.accessToken.trim()}`,
		'Content-Type': 'application/json',
		Accept: stream ? 'text/event-stream' : 'application/json',
		Connection: 'Keep-Alive',
		'User-Agent': buildCodexUserAgent(CODEX_EMULATED_VERSION),
		Originator: CODEX_ORIGINATOR,
		Session_id: randomUUID(),
		...(freshAuth.accountId ? { 'Chatgpt-Account-Id': freshAuth.accountId } : {}),
	};
}

function normalizeCodexInput(input: string | CodexResponseInput): CodexResponseInput {
	if (Array.isArray(input)) {
		return input.filter((item) => item.content.trim().length > 0);
	}
	const content = input.trim();
	return content ? [{ role: 'user', content }] : [];
}

export async function runCodexOAuthResponseText(options: CodexOAuthTextRequest): Promise<string> {
	const freshAuth = await ensureFreshOAuthAuthForRequest(options.providerId, options.auth);
	const token = freshAuth.accessToken.trim();
	if (!token) {
		throw new Error('Codex OAuth token is empty. Please sign in to Codex again.');
	}
	const model = options.model.trim();
	if (!model) {
		throw new Error('Codex model request name is empty.');
	}
	const body = {
		model,
		instructions: options.instructions,
		input: normalizeCodexInput(options.input),
		stream: true,
		store: false,
		temperature: options.temperature ?? 0,
		...(options.maxOutputTokens != null ? { max_output_tokens: options.maxOutputTokens } : {}),
		...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
	};

	const response = await electronNetFetch(codexResponsesUrl(options.baseURL), {
		method: 'POST',
		headers: buildCodexOAuthHeaders(freshAuth, true),
		body: JSON.stringify(body),
		signal: options.signal,
	});
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Codex OAuth request failed with ${response.status}: ${text.trim() || response.statusText}`);
	}
	if (!response.body) {
		throw new Error('Codex OAuth response body is empty.');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';
	let completedText = '';
	const outputItems: CodexOutputItemStore = { byIndex: new Map(), fallback: [] };
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
			} else if (type === 'response.output_item.done') {
				collectOutputItemDone(data, outputItems);
			} else if (type === 'response.completed') {
				completedText = extractCompletedText(data) || completedText;
			} else if (type === 'response.failed' || type === 'error') {
				const error = data.error;
				const message =
					error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string'
						? String((error as Record<string, unknown>).message)
						: JSON.stringify(data);
				throw new Error(message);
			}
		}
	}
	return full || completedText || extractCollectedOutputText(outputItems);
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
	const requestProviderIdentity = providerIdentityForOAuthAuth(freshAuth) ?? options.requestProviderIdentity;

	const storedSystem = messages.find((m) => m.role === 'system');
	const systemContent = prependProviderIdentitySystemPrompt(
		settings,
		composeSystem(storedSystem?.content, options.mode, options.agentSystemAppend),
		requestProviderIdentity
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
		store: false,
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
	const outputItems: CodexOutputItemStore = { byIndex: new Map(), fallback: [] };
	try {
		const response = await electronNetFetch(codexResponsesUrl(options.requestBaseURL), {
			method: 'POST',
			headers: buildCodexOAuthHeaders(freshAuth, true),
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
				} else if (type === 'response.output_item.done') {
					collectOutputItemDone(data, outputItems);
				} else if (type === 'response.completed') {
					usage = extractUsageFromCompleted(data) ?? usage;
					if (!full) {
						const completedText = extractCompletedText(data) || extractCollectedOutputText(outputItems);
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
