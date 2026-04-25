/**
 * Anthropic Prompt Caching 核心策略：
 * - system 使用文本块 + `cache_control: { type: 'ephemeral' }`（不做 1h TTL / GrowthBook allowlist，与 CC 默认 5m 一致）
 * - 每轮请求在**恰好一条**对话消息上挂断点（默认最后一条；`skipCacheWrite` 时为倒数第二条，对齐 fork 路径）
 * - 不在内存中的 `conversation` 上持久写入 cache 标记：每轮 API 调用前对克隆应用断点，避免多轮累积多个 marker
 *
 * 环境变量与 CC 同名：`DISABLE_PROMPT_CACHING`、`DISABLE_PROMPT_CACHING_HAIKU`、`DISABLE_PROMPT_CACHING_SONNET`、`DISABLE_PROMPT_CACHING_OPUS`
 * （后三者用模型 id 子串匹配，因 Async 无 CC 的固定 model id 表）。
 */

import { createHash } from 'node:crypto';
import type { ContentBlockParam, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { SystemPromptSections } from './modePrompts.js';
import type { TurnTokenUsage } from './types.js';

export type AnthropicCacheControl = { type: 'ephemeral' };

export type AnthropicCacheBreakpointStrategy = 'tail' | 'stable-prefix';

export type AnthropicCacheBreakpointDecision = {
	enabled: boolean;
	strategy: AnthropicCacheBreakpointStrategy;
	messageCount: number;
	markerIndex: number | null;
	markerRole: 'user' | 'assistant' | null;
	reason: string;
	volatileTailMessages: number;
};

export type AnthropicCacheBreakpointOptions = {
	skipCacheWrite?: boolean;
	/**
	 * `tail` matches Claude Code's raw addCacheBreakpoints behavior. `stable-prefix`
	 * keeps the single marker on the latest reusable prefix when the newest user
	 * message/tool_result is expected to change every round.
	 */
	strategy?: AnthropicCacheBreakpointStrategy;
	onDecision?: (decision: AnthropicCacheBreakpointDecision) => void;
};

export type AnthropicPromptCacheObservation = {
	source: string;
	model: string;
	usage?: TurnTokenUsage;
	decision?: AnthropicCacheBreakpointDecision;
	system?: string | TextBlockParam[];
	toolNames?: string[];
};

type CacheTrackingState = {
	previousCacheReadTokens: number | null;
	previousSignature: string | null;
	callCount: number;
};

const cacheTrackingBySource = new Map<string, CacheTrackingState>();
const MIN_CACHE_DROP_TOKENS = 1024;
const CACHE_DROP_RATIO = 0.05;

function isEnvTruthy(v: string | undefined): boolean {
	if (v === undefined) return false;
	const l = v.trim().toLowerCase();
	return l === '1' || l === 'true' || l === 'yes' || l === 'on';
}

/** 对齐 `claude.ts` `getCacheControl` 的默认形态（无 `ttl: '1h'` / `scope`，避免额外 beta 与计费策略依赖）。 */
export function getAnthropicCacheControl(): AnthropicCacheControl {
	return { type: 'ephemeral' };
}

/** 对齐 `getPromptCachingEnabled` 的子集。 */
export function isAnthropicPromptCachingEnabled(model: string): boolean {
	const m = model.trim();
	if (!m) return false;
	if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING)) return false;
	if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_HAIKU) && /haiku/i.test(m)) return false;
	if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_SONNET) && /sonnet/i.test(m)) return false;
	if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_OPUS) && /opus/i.test(m)) return false;
	return true;
}

/**
 * 对齐 `buildSystemPromptBlocks`：启用缓存时把 system 设为单块可缓存文本；关闭时保持普通 string 以减小请求体差异。
 */
export function buildAnthropicSystemForApi(
	systemInput: string | SystemPromptSections,
	enableCaching: boolean
): string | TextBlockParam[] {
	const systemSections =
		typeof systemInput === 'string'
			? { staticText: systemInput, dynamicText: '', fullText: systemInput }
			: systemInput;
	const staticText = systemSections.staticText.trim();
	const dynamicText = systemSections.dynamicText.trim();
	if (!enableCaching) {
		return systemSections.fullText;
	}
	if (!staticText && !dynamicText) {
		return systemSections.fullText;
	}
	const blocks: TextBlockParam[] = [];
	if (staticText) {
		blocks.push({
			type: 'text',
			text: staticText,
			cache_control: getAnthropicCacheControl(),
		});
	}
	if (dynamicText) {
		blocks.push({
			type: 'text',
			text: dynamicText,
		});
	}
	return blocks;
}

function withCacheOnLastUserContentBlock(blocks: ContentBlockParam[]): { blocks: ContentBlockParam[]; applied: boolean } {
	const out = blocks.map((b) => structuredClone(b) as ContentBlockParam);
	if (out.length === 0) {
		return { blocks: [{ type: 'text', text: '', cache_control: getAnthropicCacheControl() }], applied: true };
	}
	const last = out.length - 1;
	const cur = out[last] as unknown as Record<string, unknown>;
	out[last] = { ...cur, cache_control: getAnthropicCacheControl() } as ContentBlockParam;
	return { blocks: out, applied: true };
}

/** 对齐 `assistantMessageToMessageParam`：末块为 thinking / redacted_thinking 时不挂 marker（与 CC 一致）。 */
function withCacheOnAssistantContentBlocks(blocks: ContentBlockParam[]): { blocks: ContentBlockParam[]; applied: boolean } {
	const out = blocks.map((b) => structuredClone(b) as ContentBlockParam);
	if (out.length === 0) {
		return { blocks: [{ type: 'text', text: '', cache_control: getAnthropicCacheControl() }], applied: true };
	}
	const lastIdx = out.length - 1;
	const last = out[lastIdx]!;
	if (last.type === 'thinking' || last.type === 'redacted_thinking') {
		return { blocks: out, applied: false };
	}
	const cur = last as unknown as Record<string, unknown>;
	out[lastIdx] = { ...cur, cache_control: getAnthropicCacheControl() } as ContentBlockParam;
	return { blocks: out, applied: true };
}

function applyMarkerToMessage(msg: MessageParam): { message: MessageParam; applied: boolean } {
	const cc = getAnthropicCacheControl();
	if (msg.role === 'user') {
		if (typeof msg.content === 'string') {
			return { message: {
				role: 'user',
				content: [{ type: 'text', text: msg.content, cache_control: cc }],
			}, applied: true };
		}
		const marked = withCacheOnLastUserContentBlock(msg.content);
		return { message: { role: 'user', content: marked.blocks }, applied: marked.applied };
	}
	if (typeof msg.content === 'string') {
		return { message: {
			role: 'assistant',
			content: [{ type: 'text', text: msg.content, cache_control: cc }],
		}, applied: true };
	}
	const marked = withCacheOnAssistantContentBlocks(msg.content);
	return { message: { role: 'assistant', content: marked.blocks }, applied: marked.applied };
}

function contentBlocks(msg: MessageParam): ContentBlockParam[] {
	return typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content;
}

function hasToolResult(msg: MessageParam): boolean {
	return msg.role === 'user' && contentBlocks(msg).some((block) => block.type === 'tool_result');
}

function stripExistingCacheControls<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map(stripExistingCacheControls) as T;
	}
	if (!value || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key !== 'cache_control') {
			out[key] = stripExistingCacheControls(child);
		}
	}
	return out as T;
}

function countVolatileTailMessages(messages: MessageParam[]): number {
	if (messages.length <= 1) return 0;
	const last = messages[messages.length - 1]!;
	if (hasToolResult(last)) return 1;
	if (last.role === 'user') return 1;
	return 0;
}

function chooseMarkerIndex(
	messages: MessageParam[],
	strategy: AnthropicCacheBreakpointStrategy,
	skipCacheWrite: boolean
): { markerIndex: number; reason: string; volatileTailMessages: number } {
	if (messages.length === 1) {
		return { markerIndex: 0, reason: 'single-message', volatileTailMessages: 0 };
	}
	if (skipCacheWrite) {
		return { markerIndex: Math.max(0, messages.length - 2), reason: 'skip-cache-write-shared-prefix', volatileTailMessages: 1 };
	}
	if (strategy === 'tail') {
		return { markerIndex: messages.length - 1, reason: 'tail', volatileTailMessages: 0 };
	}
	const volatileTailMessages = countVolatileTailMessages(messages);
	if (volatileTailMessages > 0) {
		const candidate = Math.max(0, messages.length - volatileTailMessages - 1);
		return {
			markerIndex: candidate,
			reason: hasToolResult(messages[messages.length - 1]!)
				? 'stable-prefix-before-tool-result'
				: 'stable-prefix-before-new-user-tail',
			volatileTailMessages,
		};
	}
	return { markerIndex: messages.length - 1, reason: 'stable-tail-no-volatile-suffix', volatileTailMessages: 0 };
}

/**
 * 对齐 `addCacheBreakpoints`：每请求恰好一条消息带 `cache_control`。
 * `skipCacheWrite`：与 CC fork 一致，断点落在倒数第二条（最后一条为仅追加的新内容时不污染 KVCC）。
 */
export function addAnthropicCacheBreakpoints(
	messages: MessageParam[],
	enableCaching: boolean,
	optionsOrSkipCacheWrite: boolean | AnthropicCacheBreakpointOptions = false
): MessageParam[] {
	const options: AnthropicCacheBreakpointOptions =
		typeof optionsOrSkipCacheWrite === 'boolean'
			? { skipCacheWrite: optionsOrSkipCacheWrite }
			: optionsOrSkipCacheWrite;
	const strategy = options.strategy ?? 'stable-prefix';
	const out = stripExistingCacheControls(structuredClone(messages) as MessageParam[]);
	if (!enableCaching || out.length === 0) {
		options.onDecision?.({
			enabled: false,
			strategy,
			messageCount: out.length,
			markerIndex: null,
			markerRole: null,
			reason: enableCaching ? 'empty-messages' : 'disabled',
			volatileTailMessages: 0,
		});
		return out;
	}
	const selected = chooseMarkerIndex(out, strategy, options.skipCacheWrite === true);
	for (let index = selected.markerIndex; index >= 0; index--) {
		const marked = applyMarkerToMessage(out[index]!);
		out[index] = marked.message;
		if (marked.applied) {
			options.onDecision?.({
				enabled: true,
				strategy,
				messageCount: out.length,
				markerIndex: index,
				markerRole: out[index]!.role,
				reason: index === selected.markerIndex ? selected.reason : 'fallback-marker-eligible-message',
				volatileTailMessages: selected.volatileTailMessages,
			});
			return out;
		}
	}
	options.onDecision?.({
		enabled: false,
		strategy,
		messageCount: out.length,
		markerIndex: null,
		markerRole: null,
		reason: 'no-eligible-message',
		volatileTailMessages: selected.volatileTailMessages,
	});
	return out;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (!value || typeof value !== 'object') return JSON.stringify(value);
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([key]) => key !== 'cache_control')
		.sort(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
}

function signatureForObservation(observation: AnthropicPromptCacheObservation): string {
	const payload = {
		model: observation.model,
		system: observation.system ?? null,
		toolNames: [...(observation.toolNames ?? [])].sort(),
		strategy: observation.decision?.strategy ?? null,
		markerIndex: observation.decision?.markerIndex ?? null,
	};
	return createHash('sha256').update(stableJson(payload)).digest('hex');
}

export function observeAnthropicPromptCacheUsage(observation: AnthropicPromptCacheObservation): void {
	const usage = observation.usage;
	if (!usage) return;
	const cacheReadTokens = usage.cacheReadTokens ?? 0;
	const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
	const key = observation.source || 'default';
	const state = cacheTrackingBySource.get(key) ?? {
		previousCacheReadTokens: null,
		previousSignature: null,
		callCount: 0,
	};
	state.callCount++;
	const signature = signatureForObservation(observation);
	const previousCacheReadTokens = state.previousCacheReadTokens;
	const previousSignature = state.previousSignature;
	state.previousCacheReadTokens = cacheReadTokens;
	state.previousSignature = signature;
	cacheTrackingBySource.set(key, state);
	if (previousCacheReadTokens === null) return;
	const tokenDrop = previousCacheReadTokens - cacheReadTokens;
	if (tokenDrop < MIN_CACHE_DROP_TOKENS || cacheReadTokens >= previousCacheReadTokens * (1 - CACHE_DROP_RATIO)) {
		return;
	}
	const signatureChanged = previousSignature !== signature;
	console.warn(
		`[AnthropicPromptCache] cache read dropped source=${key} call=${state.callCount} ` +
		`read=${previousCacheReadTokens}->${cacheReadTokens} write=${cacheWriteTokens} ` +
		`drop=${tokenDrop} marker=${observation.decision?.markerIndex ?? 'none'} ` +
		`reason=${observation.decision?.reason ?? 'unknown'} signatureChanged=${signatureChanged}`
	);
}

export function resetAnthropicPromptCacheTracking(): void {
	cacheTrackingBySource.clear();
}
