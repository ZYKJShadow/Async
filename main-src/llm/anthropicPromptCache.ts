/**
 * Anthropic Prompt Caching 核心策略：
 * - system 使用文本块 + `cache_control: { type: 'ephemeral' }`（不做 1h TTL / GrowthBook allowlist，与 CC 默认 5m 一致）
 * - 每轮请求在**恰好一条**对话消息上挂断点（默认最后一条；`skipCacheWrite` 时为倒数第二条，对齐 fork 路径）
 * - 不在内存中的 `conversation` 上持久写入 cache 标记：每轮 API 调用前对克隆应用断点，避免多轮累积多个 marker
 *
 * 环境变量与 CC 同名：`DISABLE_PROMPT_CACHING`、`DISABLE_PROMPT_CACHING_HAIKU`、`DISABLE_PROMPT_CACHING_SONNET`、`DISABLE_PROMPT_CACHING_OPUS`
 * （后三者用模型 id 子串匹配，因 Async 无 CC 的固定 model id 表）。
 */

import type { ContentBlockParam, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { SystemPromptSections } from './modePrompts.js';

export type AnthropicCacheControl = { type: 'ephemeral' };

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

function withCacheOnLastUserContentBlock(blocks: ContentBlockParam[]): ContentBlockParam[] {
	const out = blocks.map((b) => structuredClone(b) as ContentBlockParam);
	if (out.length === 0) {
		return [{ type: 'text', text: '', cache_control: getAnthropicCacheControl() }];
	}
	const last = out.length - 1;
	const cur = out[last] as Record<string, unknown>;
	out[last] = { ...cur, cache_control: getAnthropicCacheControl() } as ContentBlockParam;
	return out;
}

/** 对齐 `assistantMessageToMessageParam`：末块为 thinking / redacted_thinking 时不挂 marker（与 CC 一致）。 */
function withCacheOnAssistantContentBlocks(blocks: ContentBlockParam[]): ContentBlockParam[] {
	const out = blocks.map((b) => structuredClone(b) as ContentBlockParam);
	if (out.length === 0) {
		return [{ type: 'text', text: '', cache_control: getAnthropicCacheControl() }];
	}
	const lastIdx = out.length - 1;
	const last = out[lastIdx]!;
	if (last.type === 'thinking' || last.type === 'redacted_thinking') {
		return out;
	}
	const cur = last as Record<string, unknown>;
	out[lastIdx] = { ...cur, cache_control: getAnthropicCacheControl() } as ContentBlockParam;
	return out;
}

function applyMarkerToMessage(msg: MessageParam): MessageParam {
	const cc = getAnthropicCacheControl();
	if (msg.role === 'user') {
		if (typeof msg.content === 'string') {
			return {
				role: 'user',
				content: [{ type: 'text', text: msg.content, cache_control: cc }],
			};
		}
		return { role: 'user', content: withCacheOnLastUserContentBlock(msg.content) };
	}
	if (typeof msg.content === 'string') {
		return {
			role: 'assistant',
			content: [{ type: 'text', text: msg.content, cache_control: cc }],
		};
	}
	return { role: 'assistant', content: withCacheOnAssistantContentBlocks(msg.content) };
}

/**
 * 对齐 `addCacheBreakpoints`：每请求恰好一条消息带 `cache_control`。
 * `skipCacheWrite`：与 CC fork 一致，断点落在倒数第二条（最后一条为仅追加的新内容时不污染 KVCC）。
 */
export function addAnthropicCacheBreakpoints(
	messages: MessageParam[],
	enableCaching: boolean,
	skipCacheWrite = false
): MessageParam[] {
	const out = structuredClone(messages) as MessageParam[];
	if (!enableCaching || out.length === 0) {
		return out;
	}
	const markerIndex =
		skipCacheWrite && out.length >= 2 ? out.length - 2 : out.length - 1;
	if (markerIndex < 0) {
		return out;
	}
	out[markerIndex] = applyMarkerToMessage(out[markerIndex]!);
	return out;
}
