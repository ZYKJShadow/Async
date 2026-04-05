import type { ChatMessage } from './threadStore.js';
import { listAgentDiffChunks } from './agent/applyAgentDiffs.js';
import { flattenAssistantTextPartsForSearch } from '../src/agentStructuredMessage.js';
import { countDiffLinesInChunk } from './diffLineCount.js';

export type ThreadRowSummary = {
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

function visibleMessages(msgs: ChatMessage[]): ChatMessage[] {
	return msgs.filter((m) => m.role !== 'system');
}

function firstLine(text: string, maxLen: number): string {
	const line = text.replace(/\r\n/g, '\n').split('\n')[0]?.trim() ?? '';
	return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

export function summarizeThreadForSidebar(thread: { messages: ChatMessage[] }): ThreadRowSummary {
	const vis = visibleMessages(thread.messages);
	const last = vis[vis.length - 1];
	const prev = vis.length >= 2 ? vis[vis.length - 2] : undefined;

	const isAwaitingReply = last?.role === 'user';

	let lastAssistantRaw = '';
	for (let i = vis.length - 1; i >= 0; i--) {
		if (vis[i]!.role === 'assistant') {
			lastAssistantRaw = vis[i]!.content;
			break;
		}
	}

	const lastAssistantText = flattenAssistantTextPartsForSearch(lastAssistantRaw);
	const chunks = lastAssistantText ? listAgentDiffChunks(lastAssistantText) : [];
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

	let subtitleFallback = '';
	if (isAwaitingReply && last?.role === 'user') {
		subtitleFallback = firstLine(last.content, 72);
	} else if (lastAssistantRaw) {
		const stripped = lastAssistantText.replace(/```[\s\S]*?```/g, ' ').trim();
		subtitleFallback = firstLine(stripped, 72);
	}
	if (!subtitleFallback && last?.role === 'user') {
		subtitleFallback = firstLine(last.content, 72);
	}
	if (!subtitleFallback && prev?.role === 'user') {
		subtitleFallback = firstLine(prev.content, 72);
	}

	return {
		isAwaitingReply,
		hasAgentDiff,
		additions,
		deletions,
		filePaths: paths,
		fileCount,
		subtitleFallback,
	};
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
