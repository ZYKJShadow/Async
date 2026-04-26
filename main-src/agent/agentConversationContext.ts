import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getAutoCompactThresholdForSend, type ModelContextResolveOpts } from '../llm/modelContext.js';
import { withLlmTransportRetry } from '../llm/llmTransportRetry.js';
import { formatLlmSdkError } from '../llm/formatLlmSdkError.js';
import { anthropicEffectiveMaxTokens } from '../llm/thinkingLevel.js';
import type { ShellSettings } from '../settingsStore.js';
import type { ProviderIdentitySettings } from '../../src/providerIdentitySettings.js';
import {
	applyAnthropicProviderIdentity,
	applyOpenAIProviderIdentity,
	buildAnthropicProviderIdentityMetadata,
	prependProviderIdentitySystemPrompt,
} from '../llm/providerIdentity.js';

export type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type AnthropicMessage = MessageParam;

export type AgentContextCompactState = {
	lastBoundaryId?: string;
	lastSummary?: string;
	failureCount?: number;
	lastCompactedAt?: number;
};

export type AgentContextCompactStateChange = (state: AgentContextCompactState) => void;

export type AgentContextCompactionOptions = {
	provider: 'openai' | 'anthropic';
	model: string;
	apiKey: string;
	baseURL?: string;
	proxyUrl?: string;
	providerIdentity?: ProviderIdentitySettings;
	contextWindowTokens?: number;
	maxOutputTokens: number;
	state?: AgentContextCompactState;
	onStateChange?: AgentContextCompactStateChange;
	signal: AbortSignal;
};

export type AgentContextCompactionResult<T> = {
	messages: T[];
	changed: boolean;
	mode: 'none' | 'microcompact' | 'summary' | 'fallback';
	estimatedTokensBefore: number;
	estimatedTokensAfter: number;
	clearedToolResults: number;
	compactedMessages: number;
	error?: string;
};

type ApiGroup<T> = {
	id: string;
	messages: T[];
};

const SUMMARY_OUTPUT_TOKENS = 4_000;
const MIN_RECENT_GROUPS = 6;
const TARGET_CONTEXT_RATIO = 0.55;
const MAX_CONSECUTIVE_FAILURES = 3;
const SUMMARY_MAX_INPUT_CHARS = 80_000;
const SUMMARY_MAX_LINE_CHARS = 1_200;
const EXTRACTIVE_SUMMARY_MAX_CHARS = 24_000;
const CLEARED_TOOL_RESULT_MESSAGE = '[Old tool result content cleared for context budget]';

function roughTokenCount(value: unknown): number {
	if (value == null) {
		return 0;
	}
	if (typeof value === 'string') {
		return Math.ceil(value.length / 4);
	}
	try {
		return Math.ceil(JSON.stringify(value).length / 4);
	} catch {
		return Math.ceil(String(value).length / 4);
	}
}

function threshold(options: AgentContextCompactionOptions): number {
	const env = process.env.ASYNC_AGENT_CONTEXT_COMPACT_TOKENS?.trim();
	if (env) {
		const parsed = Number.parseInt(env, 10);
		if (Number.isFinite(parsed) && parsed > 1_000) {
			return parsed;
		}
	}
	const ctxOpts: ModelContextResolveOpts = {
		userContextWindowTokens: options.contextWindowTokens,
		paradigm: options.provider === 'anthropic' ? 'anthropic' : 'openai-compatible',
	};
	return getAutoCompactThresholdForSend(options.model, options.maxOutputTokens, ctxOpts);
}

function targetThreshold(options: AgentContextCompactionOptions): number {
	return Math.max(8_000, Math.floor(threshold(options) * TARGET_CONTEXT_RATIO));
}

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n... (${text.length - maxChars} chars omitted)`;
}

function messageTokens(messages: readonly unknown[]): number {
	return messages.reduce<number>((total, message) => total + roughTokenCount(message), 0);
}

export function estimateOpenAIConversationTokens(messages: OpenAIMessage[]): number {
	return messageTokens(messages);
}

export function estimateAnthropicConversationTokens(messages: AnthropicMessage[]): number {
	return messageTokens(messages);
}

function hasOpenAIToolCalls(
	message: OpenAIMessage
): message is OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
	tool_calls: NonNullable<OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam['tool_calls']>;
} {
	return message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function groupOpenAIByApiRound(messages: OpenAIMessage[]): ApiGroup<OpenAIMessage>[] {
	const groups: ApiGroup<OpenAIMessage>[] = [];
	let current: OpenAIMessage[] = [];
	let groupCounter = 0;
	let pendingToolIds = new Set<string>();
	const flush = () => {
		if (current.length === 0) {
			return;
		}
		groups.push({ id: `openai-round-${groupCounter++}`, messages: current });
		current = [];
	};
	for (const message of messages) {
		if (message.role === 'system') {
			continue;
		}
		if (message.role === 'assistant' && current.length > 0 && pendingToolIds.size === 0) {
			flush();
		}
		current.push(message);
		if (hasOpenAIToolCalls(message)) {
			pendingToolIds = new Set(message.tool_calls!.map((call) => call.id));
		} else if (message.role === 'tool') {
			pendingToolIds.delete(String(message.tool_call_id));
		}
	}
	flush();
	return groups;
}

function getAnthropicBlocks(message: AnthropicMessage): ContentBlockParam[] {
	return Array.isArray(message.content) ? message.content as ContentBlockParam[] : [];
}

function groupAnthropicByApiRound(messages: AnthropicMessage[]): ApiGroup<AnthropicMessage>[] {
	const groups: ApiGroup<AnthropicMessage>[] = [];
	let current: AnthropicMessage[] = [];
	let groupCounter = 0;
	let pendingToolIds = new Set<string>();
	const flush = () => {
		if (current.length === 0) {
			return;
		}
		groups.push({ id: `anthropic-round-${groupCounter++}`, messages: current });
		current = [];
	};
	for (const message of messages) {
		if (message.role === 'assistant' && current.length > 0 && pendingToolIds.size === 0) {
			flush();
		}
		current.push(message);
		if (message.role === 'assistant') {
			for (const block of getAnthropicBlocks(message)) {
				if (block.type === 'tool_use') {
					pendingToolIds.add(block.id);
				}
			}
		} else if (message.role === 'user') {
			for (const block of getAnthropicBlocks(message)) {
				if (block.type === 'tool_result') {
					pendingToolIds.delete(String(block.tool_use_id));
				}
			}
		}
	}
	flush();
	return groups;
}

function collectOpenAIToolIds(messages: OpenAIMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const message of messages) {
		if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
			for (const call of message.tool_calls) {
				ids.add(call.id);
			}
		}
	}
	return ids;
}

function collectAnthropicToolIds(messages: AnthropicMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const message of messages) {
		if (message.role !== 'assistant') {
			continue;
		}
		for (const block of getAnthropicBlocks(message)) {
			if (block.type === 'tool_use') {
				ids.add(block.id);
			}
		}
	}
	return ids;
}

function microcompactOpenAI(messages: OpenAIMessage[], keepToolIds: Set<string>): { messages: OpenAIMessage[]; cleared: number } {
	let cleared = 0;
	return {
		messages: messages.map((message) => {
			if (message.role !== 'tool' || keepToolIds.has(String(message.tool_call_id))) {
				return message;
			}
			if (message.content === CLEARED_TOOL_RESULT_MESSAGE) {
				return message;
			}
			cleared++;
			return { ...message, content: CLEARED_TOOL_RESULT_MESSAGE };
		}),
		cleared,
	};
}

function microcompactAnthropic(messages: AnthropicMessage[], keepToolIds: Set<string>): { messages: AnthropicMessage[]; cleared: number } {
	let cleared = 0;
	return {
		messages: messages.map((message) => {
			if (message.role !== 'user' || !Array.isArray(message.content)) {
				return message;
			}
			let touched = false;
			const content = (message.content as ContentBlockParam[]).map((block) => {
				if (block.type !== 'tool_result' || keepToolIds.has(String(block.tool_use_id))) {
					return block;
				}
				if (block.content === CLEARED_TOOL_RESULT_MESSAGE) {
					return block;
				}
				cleared++;
				touched = true;
				return { ...block, content: CLEARED_TOOL_RESULT_MESSAGE };
			});
			return touched ? { ...message, content } : message;
		}),
		cleared,
	};
}

function selectRecentGroups<T>(
	groups: ApiGroup<T>[],
	systemMessages: T[],
	estimator: (messages: T[]) => number,
	options: AgentContextCompactionOptions
): { old: ApiGroup<T>[]; recent: ApiGroup<T>[] } {
	let keepStart = Math.max(0, groups.length - MIN_RECENT_GROUPS);
	let recent = groups.slice(keepStart);
	while (keepStart > 0 && estimator([...systemMessages, ...recent.flatMap((group) => group.messages)]) < targetThreshold(options)) {
		keepStart--;
		recent = groups.slice(keepStart);
	}
	return { old: groups.slice(0, keepStart), recent };
}

function openAISummaryLine(message: OpenAIMessage): string | null {
	if (message.role === 'system') {
		return null;
	}
	if (message.role === 'assistant') {
		const toolCalls = Array.isArray(message.tool_calls)
			? message.tool_calls.map((call) => call.function?.name ?? 'tool').join(', ')
			: '';
		return `assistant${toolCalls ? ` tool_calls=[${toolCalls}]` : ''}: ${truncate(String(message.content ?? ''), SUMMARY_MAX_LINE_CHARS)}`;
	}
	if (message.role === 'tool') {
		return `tool_result ${message.tool_call_id}: ${truncate(String(message.content ?? ''), 600)}`;
	}
	return `${message.role}: ${truncate(typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''), SUMMARY_MAX_LINE_CHARS)}`;
}

function anthropicSummaryLine(message: AnthropicMessage): string | null {
	const blocks = getAnthropicBlocks(message);
	if (blocks.length === 0) {
		return `${message.role}: ${truncate(String(message.content ?? ''), SUMMARY_MAX_LINE_CHARS)}`;
	}
	const parts = blocks.map((block) => {
		if (block.type === 'text') {
			return truncate(block.text, SUMMARY_MAX_LINE_CHARS);
		}
		if (block.type === 'tool_use') {
			return `tool_use ${block.name}: ${truncate(JSON.stringify(block.input ?? {}), 600)}`;
		}
		if (block.type === 'tool_result') {
			return `tool_result ${block.tool_use_id}: ${truncate(typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''), 600)}`;
		}
		if (block.type === 'thinking') {
			return '[thinking omitted]';
		}
		return truncate(JSON.stringify(block), 600);
	});
	return `${message.role}: ${parts.join(' | ')}`;
}

function buildExtractiveSummary(lines: Array<string | null>, compactedMessages: number): string {
	const body = lines.filter(Boolean).join('\n');
	return [
		`[Conversation summary: ${compactedMessages} earlier API messages compressed for context budget]`,
		'This is an extractive fallback summary. Preserve user goals, files, decisions, tool outcomes, and unresolved work.',
		truncate(body, EXTRACTIVE_SUMMARY_MAX_CHARS),
	].filter(Boolean).join('\n\n');
}

function summaryPrompt(historyText: string): string {
	return [
		'You are compacting an agentic coding conversation for continued work.',
		'Summarize the prior history so another assistant can continue without losing important context.',
		'Include: user goals, constraints, files inspected/edited, important command/tool results, decisions, current plan, unresolved issues, and exact paths/names.',
		'Do not include apologies or meta commentary. Keep it dense and factual.',
		'',
		'<history>',
		historyText,
		'</history>',
	].join('\n');
}

async function summarizeWithOpenAI(options: AgentContextCompactionOptions, historyText: string): Promise<string> {
	const key = options.apiKey.trim();
	if (!key) {
		throw new Error('missing OpenAI-compatible API key for context compaction');
	}
	const client = new OpenAI({
		...applyOpenAIProviderIdentity(
			{ providerIdentity: options.providerIdentity } satisfies ShellSettings,
			{
				apiKey: key,
				baseURL: options.baseURL?.trim() || undefined,
				timeout: 60_000,
				maxRetries: 1,
				...(options.proxyUrl?.trim() ? { httpAgent: new HttpsProxyAgent(options.proxyUrl.trim()) } : {}),
			}
		),
	});
	const response = await withLlmTransportRetry(() => client.chat.completions.create({
		model: options.model,
		messages: [
			{
				role: 'system',
				content: prependProviderIdentitySystemPrompt(
					{ providerIdentity: options.providerIdentity },
					'You summarize coding-agent conversation history for context compaction.'
				),
			},
			{ role: 'user', content: summaryPrompt(historyText) },
		],
		stream: false,
		max_completion_tokens: SUMMARY_OUTPUT_TOKENS,
		temperature: 0,
	}), { signal: options.signal });
	return response.choices[0]?.message?.content?.trim() || '';
}

async function summarizeWithAnthropic(options: AgentContextCompactionOptions, historyText: string): Promise<string> {
	const key = options.apiKey.trim();
	if (!key) {
		throw new Error('missing Anthropic API key for context compaction');
	}
	const client = new Anthropic({
		...applyAnthropicProviderIdentity(
			{ providerIdentity: options.providerIdentity } satisfies ShellSettings,
			{
				apiKey: key,
				baseURL: options.baseURL?.trim() || undefined,
				maxRetries: 1,
				timeout: 60_000,
				...(options.proxyUrl?.trim() ? { httpAgent: new HttpsProxyAgent(options.proxyUrl.trim()) } : {}),
			}
		),
	});
	const identitySettings: ShellSettings = { providerIdentity: options.providerIdentity };
	const anthropicMetadata = buildAnthropicProviderIdentityMetadata(identitySettings);
	const response = await withLlmTransportRetry(() => client.messages.create({
		model: options.model,
		max_tokens: anthropicEffectiveMaxTokens(0, SUMMARY_OUTPUT_TOKENS),
		system: prependProviderIdentitySystemPrompt(
			identitySettings,
			'You summarize coding-agent conversation history for context compaction.'
		),
		messages: [{ role: 'user', content: summaryPrompt(historyText) }],
		temperature: 0,
		...(anthropicMetadata ? { metadata: anthropicMetadata } : {}),
	}), { signal: options.signal });
	return response.content
		.map((block) => block.type === 'text' ? block.text : '')
		.join('')
		.trim();
}

async function summarizeHistory(options: AgentContextCompactionOptions, lines: Array<string | null>): Promise<string> {
	const historyText = truncate(lines.filter(Boolean).join('\n'), SUMMARY_MAX_INPUT_CHARS);
	if (!historyText.trim()) {
		return '';
	}
	return options.provider === 'anthropic'
		? summarizeWithAnthropic(options, historyText)
		: summarizeWithOpenAI(options, historyText);
}

function emitState(options: AgentContextCompactionOptions, patch: Partial<AgentContextCompactState>): void {
	const next: AgentContextCompactState = {
		...(options.state ?? {}),
		...patch,
	};
	options.onStateChange?.(next);
}

function shouldSkipSummary(options: AgentContextCompactionOptions): boolean {
	return (options.state?.failureCount ?? 0) >= MAX_CONSECUTIVE_FAILURES;
}

export async function compactOpenAIConversationForContext(
	messages: OpenAIMessage[],
	options: Omit<AgentContextCompactionOptions, 'provider'>
): Promise<AgentContextCompactionResult<OpenAIMessage>> {
	const fullOptions: AgentContextCompactionOptions = { ...options, provider: 'openai' };
	const estimatedTokensBefore = estimateOpenAIConversationTokens(messages);
	const trigger = threshold(fullOptions);
	if (estimatedTokensBefore < trigger) {
		return { messages, changed: false, mode: 'none', estimatedTokensBefore, estimatedTokensAfter: estimatedTokensBefore, clearedToolResults: 0, compactedMessages: 0 };
	}
	const systemMessages = messages.filter((message) => message.role === 'system');
	const groups = groupOpenAIByApiRound(messages);
	const { old, recent } = selectRecentGroups(groups, systemMessages, estimateOpenAIConversationTokens, fullOptions);
	if (old.length === 0) {
		return { messages, changed: false, mode: 'none', estimatedTokensBefore, estimatedTokensAfter: estimatedTokensBefore, clearedToolResults: 0, compactedMessages: 0 };
	}
	const recentMessages = recent.flatMap((group) => group.messages);
	const boundaryId = recent[0]?.id ?? 'openai-tail';
	const keepToolIds = collectOpenAIToolIds(recentMessages);
	const oldMessages = old.flatMap((group) => group.messages);
	const micro = microcompactOpenAI(messages, keepToolIds);
	const microTokens = estimateOpenAIConversationTokens(micro.messages);
	if (micro.cleared > 0 && microTokens < trigger) {
		return { messages: micro.messages, changed: true, mode: 'microcompact', estimatedTokensBefore, estimatedTokensAfter: microTokens, clearedToolResults: micro.cleared, compactedMessages: 0 };
	}

	const summaryLines = microcompactOpenAI(oldMessages, keepToolIds).messages.map(openAISummaryLine);
	let summary = '';
	let mode: AgentContextCompactionResult<OpenAIMessage>['mode'] = 'summary';
	let error: string | undefined;
	if (fullOptions.state?.lastBoundaryId === boundaryId && fullOptions.state.lastSummary?.trim()) {
		summary = fullOptions.state.lastSummary;
	} else if (!shouldSkipSummary(fullOptions)) {
		try {
			summary = await summarizeHistory(fullOptions, summaryLines);
			emitState(fullOptions, { failureCount: 0, lastBoundaryId: boundaryId, lastSummary: summary, lastCompactedAt: Date.now() });
		} catch (caught) {
			error = formatLlmSdkError(caught);
			emitState(fullOptions, { failureCount: (fullOptions.state?.failureCount ?? 0) + 1 });
		}
	}
	if (!summary.trim()) {
		summary = buildExtractiveSummary(summaryLines, oldMessages.length);
		mode = 'fallback';
		emitState(fullOptions, { lastBoundaryId: boundaryId, lastSummary: summary, lastCompactedAt: Date.now() });
	}
	const summaryMessage: OpenAIMessage = {
		role: 'user',
		content: `[Auto compacted conversation]\n\n${summary}`,
	};
	const compacted = [...systemMessages, summaryMessage, ...recentMessages];
	const estimatedTokensAfter = estimateOpenAIConversationTokens(compacted);
	return { messages: compacted, changed: true, mode, estimatedTokensBefore, estimatedTokensAfter, clearedToolResults: micro.cleared, compactedMessages: oldMessages.length, ...(error ? { error } : {}) };
}

export async function compactAnthropicConversationForContext(
	messages: AnthropicMessage[],
	options: Omit<AgentContextCompactionOptions, 'provider'>
): Promise<AgentContextCompactionResult<AnthropicMessage>> {
	const fullOptions: AgentContextCompactionOptions = { ...options, provider: 'anthropic' };
	const estimatedTokensBefore = estimateAnthropicConversationTokens(messages);
	const trigger = threshold(fullOptions);
	if (estimatedTokensBefore < trigger) {
		return { messages, changed: false, mode: 'none', estimatedTokensBefore, estimatedTokensAfter: estimatedTokensBefore, clearedToolResults: 0, compactedMessages: 0 };
	}
	const groups = groupAnthropicByApiRound(messages);
	const { old, recent } = selectRecentGroups(groups, [], estimateAnthropicConversationTokens, fullOptions);
	if (old.length === 0) {
		return { messages, changed: false, mode: 'none', estimatedTokensBefore, estimatedTokensAfter: estimatedTokensBefore, clearedToolResults: 0, compactedMessages: 0 };
	}
	const recentMessages = recent.flatMap((group) => group.messages);
	const boundaryId = recent[0]?.id ?? 'anthropic-tail';
	const keepToolIds = collectAnthropicToolIds(recentMessages);
	const oldMessages = old.flatMap((group) => group.messages);
	const micro = microcompactAnthropic(messages, keepToolIds);
	const microTokens = estimateAnthropicConversationTokens(micro.messages);
	if (micro.cleared > 0 && microTokens < trigger) {
		return { messages: micro.messages, changed: true, mode: 'microcompact', estimatedTokensBefore, estimatedTokensAfter: microTokens, clearedToolResults: micro.cleared, compactedMessages: 0 };
	}

	const summaryLines = microcompactAnthropic(oldMessages, keepToolIds).messages.map(anthropicSummaryLine);
	let summary = '';
	let mode: AgentContextCompactionResult<AnthropicMessage>['mode'] = 'summary';
	let error: string | undefined;
	if (fullOptions.state?.lastBoundaryId === boundaryId && fullOptions.state.lastSummary?.trim()) {
		summary = fullOptions.state.lastSummary;
	} else if (!shouldSkipSummary(fullOptions)) {
		try {
			summary = await summarizeHistory(fullOptions, summaryLines);
			emitState(fullOptions, { failureCount: 0, lastBoundaryId: boundaryId, lastSummary: summary, lastCompactedAt: Date.now() });
		} catch (caught) {
			error = formatLlmSdkError(caught);
			emitState(fullOptions, { failureCount: (fullOptions.state?.failureCount ?? 0) + 1 });
		}
	}
	if (!summary.trim()) {
		summary = buildExtractiveSummary(summaryLines, oldMessages.length);
		mode = 'fallback';
		emitState(fullOptions, { lastBoundaryId: boundaryId, lastSummary: summary, lastCompactedAt: Date.now() });
	}
	const summaryMessage: AnthropicMessage = {
		role: 'user',
		content: [{ type: 'text', text: `[Auto compacted conversation]\n\n${summary}` }],
	};
	const compacted = [summaryMessage, ...recentMessages];
	const estimatedTokensAfter = estimateAnthropicConversationTokens(compacted);
	return { messages: compacted, changed: true, mode, estimatedTokensBefore, estimatedTokensAfter, clearedToolResults: micro.cleared, compactedMessages: oldMessages.length, ...(error ? { error } : {}) };
}
