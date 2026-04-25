import * as path from 'node:path';
import type { ChatMessage } from './threadStore.js';
import { listAgentDiffChunks } from './agent/applyAgentDiffs.js';
import { flattenAssistantTextPartsForSearch } from '../src/agentStructuredMessage.js';
import { countDiffLinesInChunk } from './diffLineCount.js';

export type ThreadRowSummary = {
	previewCount: number;
	hasUserMessages: boolean;
	/** 末条为用户且其后无助手回复 → 进行中 / 草稿样式 */
	isAwaitingReply: boolean;
	/** 末条助手是否含可解析的 diff */
	hasAgentDiff: boolean;
	additions: number;
	deletions: number;
	filePaths: string[];
	/** diff 块数量（路径解析失败时仍用于「N Files」） */
	fileCount: number;
	/** 副标题：无 diff 时用助手/用户首行摘要 */
	subtitleFallback: string;
};

type SidebarMessageContext = {
	previewCount: number;
	hasUserMessages: boolean;
	lastVisible?: ChatMessage;
	previousVisible?: ChatMessage;
	lastAssistantRaw: string;
};

type SummaryCacheEntry = {
	workspaceKey: string;
	threadId: string;
	signature: string;
	summary: ThreadRowSummary;
	accessedAt: number;
};

type SummaryResult = {
	summary: ThreadRowSummary;
	cacheHit: boolean;
};

function normalizeWorkspaceCacheKey(workspaceRoot: string | null | undefined): string {
	const raw = String(workspaceRoot ?? '').trim();
	if (!raw) {
		return '__global__';
	}
	return path.resolve(raw).replace(/\\/g, '/').toLowerCase();
}

function summaryCacheKey(workspaceRoot: string | null | undefined, threadId: string): string {
	return `${normalizeWorkspaceCacheKey(workspaceRoot)}::${threadId}`;
}

function firstLine(text: string, maxLen: number): string {
	const line = text.replace(/\r\n/g, '\n').split('\n')[0]?.trim() ?? '';
	return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

const summaryCache = new Map<string, SummaryCacheEntry>();

/** Keep enough warm summaries for multiple open workspaces without unbounded growth. */
const SUMMARY_CACHE_MAX = 2_000;
let summaryCacheAccessClock = 0;

// diff 扫描只看消息末尾 N 个字符：最近的 diff 在末尾，扫全文对长消息代价极高。
const DIFF_SCAN_MAX_CHARS = 30_000;
// subtitle 只取消息开头 N 个字符即可提取首行。
const SUBTITLE_HEAD_MAX_CHARS = 2_000;
const USER_SUBTITLE_SIGNATURE_CHARS = 512;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const NON_WHITESPACE_RE = /\S/;

function hasVisibleUserText(text: string): boolean {
	return NON_WHITESPACE_RE.test(text);
}

function collectSidebarMessageContext(messages: ChatMessage[]): SidebarMessageContext {
	let previewCount = 0;
	let hasUserMessages = false;
	let lastVisible: ChatMessage | undefined;
	let previousVisible: ChatMessage | undefined;
	let lastAssistantRaw = '';

	for (const message of messages) {
		if (message.role === 'system') {
			continue;
		}
		previewCount += 1;
		if (message.role === 'user' && !hasUserMessages && hasVisibleUserText(message.content)) {
			hasUserMessages = true;
		}
		previousVisible = lastVisible;
		lastVisible = message;
		if (message.role === 'assistant') {
			lastAssistantRaw = message.content;
		}
	}

	return {
		previewCount,
		hasUserMessages,
		lastVisible,
		previousVisible,
		lastAssistantRaw,
	};
}

function updateFnvHash(hash: number, charCode: number): number {
	hash ^= charCode;
	return Math.imul(hash, FNV_PRIME) >>> 0;
}

function updateFnvHashWithSlice(hash: number, text: string, start: number, end: number): number {
	for (let i = start; i < end; i++) {
		hash = updateFnvHash(hash, text.charCodeAt(i));
	}
	return hash;
}

function boundedTextFingerprint(text: string, headChars: number, tailChars: number): string {
	const len = text.length;
	const safeHead = Math.max(0, Math.min(headChars, len));
	const safeTail = Math.max(0, Math.min(tailChars, len));
	let hash = FNV_OFFSET;

	if (len <= safeHead + safeTail) {
		hash = updateFnvHashWithSlice(hash, text, 0, len);
	} else {
		hash = updateFnvHashWithSlice(hash, text, 0, safeHead);
		hash = updateFnvHash(hash, 0);
		hash = updateFnvHashWithSlice(hash, text, len - safeTail, len);
	}

	return `${len}:${hash.toString(36)}`;
}

function userSubtitleFingerprint(message: ChatMessage | undefined): string {
	if (!message || message.role !== 'user') {
		return '';
	}
	return boundedTextFingerprint(message.content, USER_SUBTITLE_SIGNATURE_CHARS, 0);
}

function buildSummarySignature(context: SidebarMessageContext): string {
	const last = context.lastVisible;
	const prev = context.previousVisible;
	const assistantFingerprint = context.lastAssistantRaw
		? boundedTextFingerprint(context.lastAssistantRaw, SUBTITLE_HEAD_MAX_CHARS, DIFF_SCAN_MAX_CHARS)
		: '';
	return [
		context.previewCount,
		context.hasUserMessages ? 1 : 0,
		last?.role ?? '',
		userSubtitleFingerprint(last),
		prev?.role ?? '',
		userSubtitleFingerprint(prev),
		assistantFingerprint,
	].join('|');
}

function enforceSummaryCacheLimit(): void {
	while (summaryCache.size > SUMMARY_CACHE_MAX) {
		let oldestKey: string | null = null;
		let oldestAccess = Number.POSITIVE_INFINITY;
		for (const [key, entry] of summaryCache) {
			if (entry.accessedAt < oldestAccess) {
				oldestAccess = entry.accessedAt;
				oldestKey = key;
			}
		}
		if (!oldestKey) {
			return;
		}
		summaryCache.delete(oldestKey);
	}
}

function computeThreadRowSummary(context: SidebarMessageContext): ThreadRowSummary {
	const last = context.lastVisible;
	const prev = context.previousVisible;
	const isAwaitingReply = last?.role === 'user';

	// flattenAssistantTextPartsForSearch 需要完整 JSON 才能解析结构化消息，
	// 截断放在 flatten 之后（已是纯文本）。
	const lastAssistantText = flattenAssistantTextPartsForSearch(context.lastAssistantRaw);

	// 只扫末尾 30 KB 以检测 diff：防止超长消息阻塞主进程事件循环。
	const textForDiff = lastAssistantText.length > DIFF_SCAN_MAX_CHARS
		? lastAssistantText.slice(-DIFF_SCAN_MAX_CHARS)
		: lastAssistantText;
	const chunks = textForDiff ? listAgentDiffChunks(textForDiff) : [];
	const paths = [...new Set(chunks.map((c) => c.relPath).filter((p): p is string => !!p?.trim()))];

	let additions = 0;
	let deletions = 0;
	for (const c of chunks) {
		const { add, del } = countDiffLinesInChunk(c.chunk);
		additions += add;
		deletions += del;
	}

	const hasAgentDiff = chunks.length > 0;
	const fileCount = Math.max(paths.length, chunks.length);

	// subtitle 只需开头 2 KB。
	const textForSubtitle = lastAssistantText.length > SUBTITLE_HEAD_MAX_CHARS
		? lastAssistantText.slice(0, SUBTITLE_HEAD_MAX_CHARS)
		: lastAssistantText;

	let subtitleFallback = '';
	if (isAwaitingReply && last?.role === 'user') {
		subtitleFallback = firstLine(last.content, 72);
	} else if (context.lastAssistantRaw) {
		const stripped = textForSubtitle.replace(/```[\s\S]*?```/g, ' ').trim();
		subtitleFallback = firstLine(stripped, 72);
	}
	if (!subtitleFallback && last?.role === 'user') {
		subtitleFallback = firstLine(last.content, 72);
	}
	if (!subtitleFallback && prev?.role === 'user') {
		subtitleFallback = firstLine(prev.content, 72);
	}

	return {
		previewCount: context.previewCount,
		hasUserMessages: context.hasUserMessages,
		isAwaitingReply,
		hasAgentDiff,
		additions,
		deletions,
		filePaths: paths,
		fileCount,
		subtitleFallback,
	};
}

export function summarizeThreadForSidebarWithMeta(thread: {
	id: string;
	messages: ChatMessage[];
}, workspaceRoot?: string | null): SummaryResult {
	const context = collectSidebarMessageContext(thread.messages);
	const signature = buildSummarySignature(context);
	const cacheKey = summaryCacheKey(workspaceRoot, thread.id);
	const cached = summaryCache.get(cacheKey);
	if (cached && cached.signature === signature) {
		cached.accessedAt = ++summaryCacheAccessClock;
		return { summary: cached.summary, cacheHit: true };
	}

	const summary = computeThreadRowSummary(context);
	summaryCache.set(cacheKey, {
		workspaceKey: normalizeWorkspaceCacheKey(workspaceRoot),
		threadId: thread.id,
		signature,
		summary,
		accessedAt: ++summaryCacheAccessClock,
	});
	enforceSummaryCacheLimit();
	return { summary, cacheHit: false };
}

export function summarizeThreadForSidebar(thread: {
	id: string;
	messages: ChatMessage[];
}, workspaceRoot?: string | null): ThreadRowSummary {
	return summarizeThreadForSidebarWithMeta(thread, workspaceRoot).summary;
}

/**
 * Remove cached summaries for thread IDs that no longer exist in one workspace.
 * Other workspace caches stay warm so multi-workspace switching remains instant.
 */
export function pruneSummaryCache(activeIds: ReadonlySet<string>, workspaceRoot?: string | null): void {
	const workspaceKey = normalizeWorkspaceCacheKey(workspaceRoot);
	for (const [key, entry] of summaryCache) {
		if (entry.workspaceKey === workspaceKey && !activeIds.has(entry.threadId)) {
			summaryCache.delete(key);
		}
	}
}

export function clearSummaryCacheForTests(): void {
	summaryCache.clear();
	summaryCacheAccessClock = 0;
}

export function isTimestampToday(ts: number, now = Date.now()): boolean {
	const d = new Date(ts);
	const n = new Date(now);
	return (
		d.getFullYear() === n.getFullYear() &&
		d.getMonth() === n.getMonth() &&
		d.getDate() === n.getDate()
	);
}
