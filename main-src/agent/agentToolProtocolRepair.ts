/**
 * 借鉴 Claude Code `ensureToolResultPairing` 思路：在把对话发给 LLM 之前，
 * 修复助手正文里「孤儿」`<tool_result>`（没有按 FIFO 与前置 `<tool_call>` 配对），
 * 避免模型看到畸形协议或历史损坏内容。
 *
 * 本应用用 XML 片段嵌入 assistant.content，配对规则：按出现顺序，每个 tool_result
 * 必须消费队列中最早一个尚未配对的同名 tool_call（与主进程 flush 工具顺序一致）。
 */

import type { ChatMessage } from '../threadStore.js';

const TOOL_CALL_OPEN = '<tool_call tool="';
const TOOL_RESULT_OPEN = '<tool_result tool="';
const SUCCESS_MID = '" success="';

type ToolResultSpan = { index: number; name: string; fullEnd: number };

function findAllToolResultSpans(content: string): ToolResultSpan[] {
	const out: ToolResultSpan[] = [];
	let from = 0;
	while (from < content.length) {
		const start = content.indexOf(TOOL_RESULT_OPEN, from);
		if (start === -1) break;
		const nameStart = start + TOOL_RESULT_OPEN.length;
		const nameEnd = content.indexOf(SUCCESS_MID, nameStart);
		if (nameEnd === -1) break;
		const successStart = nameEnd + SUCCESS_MID.length;
		const successEnd = content.indexOf('">', successStart);
		if (successEnd === -1) break;
		const successRaw = content.slice(successStart, successEnd);
		if (successRaw !== 'true' && successRaw !== 'false') {
			from = successEnd + 2;
			continue;
		}
		const bodyStart = successEnd + 2;
		const closeTag = '</tool_result>';
		const closeIdx = content.indexOf(closeTag, bodyStart);
		if (closeIdx === -1) break;
		const name = content.slice(nameStart, nameEnd);
		out.push({ index: start, name, fullEnd: closeIdx + closeTag.length });
		from = closeIdx + closeTag.length;
	}
	return out;
}

function findResultSpanContaining(resultSpans: ToolResultSpan[], index: number): ToolResultSpan | null {
	for (const r of resultSpans) {
		if (index >= r.index && index < r.fullEnd) return r;
	}
	return null;
}

function skipJsonObject(s: string, i: number): number {
	if (s[i] !== '{') return -1;
	let depth = 0;
	let state: 'normal' | 'string' | 'escape' = 'normal';
	for (let p = i; p < s.length; p++) {
		const ch = s[p]!;
		if (state === 'escape') {
			state = 'string';
			continue;
		}
		if (state === 'string') {
			if (ch === '\\') state = 'escape';
			else if (ch === '"') state = 'normal';
			continue;
		}
		if (ch === '"') {
			state = 'string';
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return p + 1;
		}
	}
	return -1;
}

type ToolCallSpan = { start: number; end: number; name: string };

function findAllCompleteToolCallSpans(content: string, resultSpans: ToolResultSpan[]): ToolCallSpan[] {
	const out: ToolCallSpan[] = [];
	const close = '</tool_call>';
	let from = 0;
	while (from < content.length) {
		const start = content.indexOf(TOOL_CALL_OPEN, from);
		if (start === -1) break;
		if (findResultSpanContaining(resultSpans, start)) {
			from = start + TOOL_CALL_OPEN.length;
			continue;
		}
		const nameStart = start + TOOL_CALL_OPEN.length;
		const nameEnd = content.indexOf('">', nameStart);
		if (nameEnd === -1) break;
		const name = content.slice(nameStart, nameEnd);
		const jsonStart = nameEnd + 2;
		const jsonEnd = skipJsonObject(content, jsonStart);
		if (jsonEnd === -1) break;
		const closeIdx = content.indexOf(close, jsonEnd);
		if (closeIdx === -1) break;
		out.push({ start, end: closeIdx + close.length, name });
		from = closeIdx + close.length;
	}
	return out;
}

/**
 * 从单条助手正文中移除无法与 tool_call 按 FIFO 配对的 tool_result 块。
 */
export function stripOrphanToolResultsFromAssistantContent(content: string): string {
	if (!content.includes(TOOL_RESULT_OPEN)) return content;

	const resultSpans = findAllToolResultSpans(content);
	if (resultSpans.length === 0) return content;

	const callSpans = findAllCompleteToolCallSpans(content, resultSpans);

	type Ev = { kind: 'call' | 'result'; name: string; start: number; end: number };
	const events: Ev[] = [
		...callSpans.map((c) => ({ kind: 'call' as const, name: c.name, start: c.start, end: c.end })),
		...resultSpans.map((r) => ({ kind: 'result' as const, name: r.name, start: r.index, end: r.fullEnd })),
	].sort((a, b) => a.start - b.start);

	const pending: string[] = [];
	const orphanRanges: Array<{ start: number; end: number }> = [];

	for (const ev of events) {
		if (ev.kind === 'call') {
			pending.push(ev.name);
		} else {
			if (pending.length > 0 && pending[0] === ev.name) {
				pending.shift();
			} else {
				orphanRanges.push({ start: ev.start, end: ev.end });
			}
		}
	}

	if (orphanRanges.length === 0) return content;

	orphanRanges.sort((a, b) => b.start - a.start);
	let out = content;
	for (const r of orphanRanges) {
		out = out.slice(0, r.start) + out.slice(r.end);
	}
	return out;
}

/**
 * 修复 thread 中所有助手消息里的孤儿 tool_result（发 API 前调用）。
 */
export function repairAgentThreadMessagesForApi(messages: ChatMessage[]): ChatMessage[] {
	return messages.map((m) => {
		if (m.role !== 'assistant') return m;
		const next = stripOrphanToolResultsFromAssistantContent(m.content);
		return next === m.content ? m : { ...m, content: next };
	});
}
