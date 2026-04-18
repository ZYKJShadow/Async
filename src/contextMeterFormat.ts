import type { ComposerSegment } from './composerSegments';
import { slashCommandWire } from './composerSegments';

/** 与主进程 `modelContext.ts` 中 `MODEL_CONTEXT_WINDOW_DEFAULT` 一致，用于 UI 未填写时的展示上限 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS_UI = 200_000;

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

export function sumMessagesCharLength(messages: ReadonlyArray<{ content: string }>): number {
	let n = 0;
	for (const m of messages) {
		n += m.content.length;
	}
	return n;
}

export function estimateComposerSegmentsCharLength(segments: ReadonlyArray<ComposerSegment>): number {
	let n = 0;
	for (const s of segments) {
		if (s.kind === 'text') {
			n += s.text.length;
		} else if (s.kind === 'file') {
			n += s.path.length;
		} else {
			n += slashCommandWire(s.command).length;
		}
	}
	return n;
}

/**
 * 底部输入区上下文环：会话正文 + 草稿 composer（与压缩估算同思路）。
 * streaming / streamingThinking 已迁至 streamingStore，不再参与 App 级的实时估算；
 * 每次 token 都累进会触发 App 重渲染，且端到端对用户感知影响极小，下一轮持久化后自然计入。
 */
export function computeComposerContextUsedEstimate(args: {
	messages: ReadonlyArray<{ content: string }>;
	composerSegments: ReadonlyArray<ComposerSegment>;
}): number {
	const chars =
		sumMessagesCharLength(args.messages) +
		estimateComposerSegmentsCharLength(args.composerSegments);
	return estimateTokensFromCharLength(chars);
}
