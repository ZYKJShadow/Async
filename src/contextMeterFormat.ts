import type { ComposerImageMeta, ComposerSegment } from './composerSegments';
import { skillInvocationWire, slashCommandWire } from './composerSegments';
import { isImagePath, type UserMessagePart } from './messageParts';
import { isStructuredAssistantMessage, parseAgentAssistantPayload } from './agentStructuredMessage';

/**
 * 结构化 tool result 中 `image` 块的固定 token 预算。与 claude-code
 * `tokenEstimation.ts` 的 `IMAGE_MAX_TOKEN_SIZE = 2000` 一致：base64 图片在 JSON 字符串里
 * 会被 char/4 估算成几十万 token（1MB ≈ 1.33M base64 chars → ~325k tokens）而 API 真实
 * 计费仅 ~2000，留作保守上界，避免 view_image 后上下文条直接爆掉。
 */
const STRUCTURED_TOOL_IMAGE_TOKENS = 2000;

/** 与主进程 `modelContext.ts` 中 `MODEL_CONTEXT_WINDOW_DEFAULT` 一致，用于 UI 未填写时的展示上限 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS_UI = 200_000;

/** 估算置信度：high=纯文本或图片元数据齐全，medium=图片尺寸缺失使用保守兜底，low=未知模型计价等更弱估算。 */
export type EstimateConfidence = 'high' | 'medium' | 'low';

export type ContextEstimate = {
	tokens: number;
	confidence: EstimateConfidence;
};

/** 将 token 数格式化为 K / M 展示（用于上下文环与 tooltip） */
export function formatTokenCountShort(n: number): string {
	if (!Number.isFinite(n) || n <= 0) {
		return '0';
	}
	if (n >= 1_000_000) {
		const v = n / 1_000_000;
		const s = (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
		return `${s}M`;
	}
	if (n >= 1_000) {
		const v = n / 1_000;
		const s = (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
		return `${s}K`;
	}
	return String(Math.round(n));
}

/** 与主进程 `compressForSend` 一致：按字符 /4 粗估 token */
export function estimateTokensFromCharLength(charCount: number): number {
	return Math.ceil(Math.max(0, charCount) / 4);
}

/**
 * 单张图片 token 估算（参考 OpenAI high-detail：先按最长边 ≤ 2048、最短边 ≤ 768 缩放，
 * 再按 512×512 瓦片计 170 token/块 + 基础 85）。用作供应商无关的保守上界，三家服务商都能覆盖。
 */
export function estimateImageTokens(meta: ComposerImageMeta | undefined): ContextEstimate {
	const w = meta?.width ?? 0;
	const h = meta?.height ?? 0;
	if (!meta || w <= 0 || h <= 0) {
		return { tokens: 1536, confidence: 'medium' };
	}
	const longest = Math.max(w, h);
	const shortest = Math.min(w, h);
	const scale = Math.min(1, 2048 / longest, 768 / shortest);
	const tilesW = Math.max(1, Math.ceil((w * scale) / 512));
	const tilesH = Math.max(1, Math.ceil((h * scale) / 512));
	const tiles = tilesW * tilesH;
	return { tokens: 85 + 170 * tiles, confidence: 'high' };
}

function downgradeConfidence(a: EstimateConfidence, b: EstimateConfidence): EstimateConfidence {
	if (a === 'low' || b === 'low') {
		return 'low';
	}
	if (a === 'medium' || b === 'medium') {
		return 'medium';
	}
	return 'high';
}

function isComposerImageSegment(segment: Extract<ComposerSegment, { kind: 'file' }>): boolean {
	return !!segment.imageMeta || isImagePath(segment.path);
}

/** 组合器片段的文本字符数（不含图片 token） */
export function estimateComposerSegmentsCharLength(segments: ReadonlyArray<ComposerSegment>): number {
	let n = 0;
	for (const s of segments) {
		if (s.kind === 'text') {
			n += s.text.length;
		} else if (s.kind === 'file') {
			if (!isComposerImageSegment(s)) {
				n += s.path.length;
			}
		} else if (s.kind === 'skill') {
			n += s.slug.length + 3;
		} else {
			n += slashCommandWire(s.command).length;
		}
	}
	return n;
}

/** 组合器片段里所有图片 token 累加（附带整体置信度） */
export function estimateComposerSegmentsImageTokens(segments: ReadonlyArray<ComposerSegment>): ContextEstimate {
	let tokens = 0;
	let confidence: EstimateConfidence = 'high';
	for (const s of segments) {
		if (s.kind !== 'file' || !isComposerImageSegment(s)) {
			continue;
		}
		const est = estimateImageTokens(s.imageMeta);
		tokens += est.tokens;
		confidence = downgradeConfidence(confidence, est.confidence);
	}
	return { tokens, confidence };
}

/**
 * 解析结构化 assistant payload，把图片 base64 与文本内容分开计数。
 * 返回 null 表示 content 不是结构化格式，由调用方走旧的 `content.length` 兜底。
 */
function structuredAssistantStats(content: string): { textChars: number; imageCount: number } | null {
	if (!isStructuredAssistantMessage(content)) {
		return null;
	}
	const payload = parseAgentAssistantPayload(content);
	if (!payload) {
		return null;
	}
	let textChars = 0;
	let imageCount = 0;
	for (const part of payload.parts) {
		if (part.type === 'text') {
			textChars += part.text.length;
			continue;
		}
		// tool 调用：name + args(JSON) + 文本 result 都按字符算入文本；resultStructured 中
		// 的 `image` 改用固定预算，避免 base64 数据被当作普通文本计成天文数字。
		textChars += part.name.length + JSON.stringify(part.args).length + part.result.length;
		if (Array.isArray(part.resultStructured)) {
			for (const block of part.resultStructured) {
				const t = (block as { type?: unknown }).type;
				if (t === 'image') {
					imageCount += 1;
				} else if (t === 'text') {
					textChars += String((block as { text?: unknown }).text ?? '').length;
				}
			}
		}
	}
	return { textChars, imageCount };
}

function estimateUserPartsTextCharLength(parts: ReadonlyArray<UserMessagePart>): number {
	let n = 0;
	for (const part of parts) {
		if (part.kind === 'text') {
			n += part.text.length;
		} else if (part.kind === 'command') {
			n += slashCommandWire(part.command).length;
		} else if (part.kind === 'skill_invoke') {
			n += skillInvocationWire(part.slug).length;
		} else if (part.kind === 'file_ref') {
			n += part.relPath.length + 1;
		}
	}
	return n;
}

function imageMetaFromUserPart(part: Extract<UserMessagePart, { kind: 'image_ref' }>): ComposerImageMeta {
	return {
		mimeType: part.mimeType,
		sizeBytes: part.sizeBytes,
		width: part.width,
		height: part.height,
		sha256: part.sha256,
	};
}

function estimateMessagesTextCharLength(
	messages: ReadonlyArray<{ role?: 'user' | 'assistant'; content: string; parts?: UserMessagePart[] }>
): number {
	let n = 0;
	for (const message of messages) {
		if (message.role === 'assistant') {
			const stats = structuredAssistantStats(message.content);
			if (stats) {
				n += stats.textChars;
				continue;
			}
		}
		n += message.parts && message.parts.length > 0
			? estimateUserPartsTextCharLength(message.parts)
			: message.content.length;
	}
	return n;
}

function estimateMessageImageTokens(
	messages: ReadonlyArray<{ role?: 'user' | 'assistant'; content: string; parts?: UserMessagePart[] }>
): ContextEstimate {
	let tokens = 0;
	let confidence: EstimateConfidence = 'high';
	for (const message of messages) {
		if (message.role === 'assistant') {
			const stats = structuredAssistantStats(message.content);
			if (stats && stats.imageCount > 0) {
				tokens += stats.imageCount * STRUCTURED_TOOL_IMAGE_TOKENS;
				// tool result 里的 image 块没有 width/height，固定预算属保守估计 → medium
				confidence = downgradeConfidence(confidence, 'medium');
			}
			continue;
		}
		for (const part of message.parts ?? []) {
			if (part.kind !== 'image_ref') {
				continue;
			}
			const est = estimateImageTokens(imageMetaFromUserPart(part));
			tokens += est.tokens;
			confidence = downgradeConfidence(confidence, est.confidence);
		}
	}
	return { tokens, confidence };
}

/**
 * 底部输入区上下文环：会话正文 + 草稿 composer（与压缩估算同思路）。
 * streaming / streamingThinking 已迁至 streamingStore，不再参与 App 级的实时估算；
 * 每次 token 都累进会触发 App 重渲染，且端到端对用户感知影响极小，下一轮持久化后自然计入。
 *
 * 多模态：历史消息与草稿都优先基于结构化图片元数据估算；图片不再按 `@path` 字符长度计成本。
 */
export function computeComposerContextUsedEstimate(args: {
	messages: ReadonlyArray<{ role?: 'user' | 'assistant'; content: string; parts?: UserMessagePart[] }>;
	composerSegments: ReadonlyArray<ComposerSegment>;
}): ContextEstimate {
	const messageTextTokens = estimateTokensFromCharLength(estimateMessagesTextCharLength(args.messages));
	const messageImageEst = estimateMessageImageTokens(args.messages);
	const composerTextTokens = estimateTokensFromCharLength(
		estimateComposerSegmentsCharLength(args.composerSegments)
	);
	const composerImageEst = estimateComposerSegmentsImageTokens(args.composerSegments);
	const hasImages = messageImageEst.tokens > 0 || composerImageEst.tokens > 0;
	return {
		tokens: messageTextTokens + messageImageEst.tokens + composerTextTokens + composerImageEst.tokens,
		confidence: hasImages
			? downgradeConfidence(messageImageEst.confidence, composerImageEst.confidence)
			: 'high',
	};
}
