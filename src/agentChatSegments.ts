import { defaultT, type TFunction } from './i18n';
import {
	agentSegmentDebugEnabled,
	agentSegmentDebugLog,
	segmentTypeHistogram,
} from './agentSegmentDebug';
import {
	isStructuredAssistantMessage,
	parseAgentAssistantPayload,
	structuredToLegacyAgentXml,
} from './agentStructuredMessage';
import {
	assistantDisplayStripQuestionBlock,
	stripPlanDocumentForChatDisplay,
} from './planParser';

/**
 * 将助手消息拆成 Markdown / 活动行 / 内联文件编辑卡片（Cursor 风格）。
 *
 * 每次写操作（str_replace / write_to_file）→ 内联 file_edit 卡片（显示文件名+增删行）
 * 读操作 / 搜索 / 命令 → 灰色活动行
 */

export type FileChangeSummary = {
	path: string;
	additions: number;
	deletions: number;
	startLine?: number;
	diff?: string;
};

export type FileEditSegment = {
	type: 'file_edit';
	path: string;
	additions: number;
	deletions: number;
	startLine?: number;
	oldStr?: string;
	newStr?: string;
	isNew?: boolean;
	isStreaming?: boolean;
};

export type ActivityStatus = 'info' | 'pending' | 'success' | 'error';

/** read_file 活动行：点击后在编辑器中打开并高亮行范围 */
export type AgentReadFileLink = {
	path: string;
	startLine: number;
	endLine: number;
};

/** search_files / read_file / list_dir 成功后可折叠展示的结果行 */
export type ActivityResultLine = {
	/** 原始文本行 */
	text: string;
	/** 可选：文件路径（search_files 每行格式 path:line:content） */
	filePath?: string;
	/** 可选：行号（search_files） */
	lineNo?: number;
	/** 可选：匹配内容（search_files） */
	matchText?: string;
};

export type ActivitySegment = {
	type: 'activity';
	text: string;
	status: ActivityStatus;
	/** 嵌套子 Agent 工具活动：归属父 tool_call id */
	nestParent?: string;
	nestDepth?: number;
	detail?: string;
	summary?: string;
	/** 仅 read_file：可点击跳转 Monaco 并高亮 */
	agentReadLink?: AgentReadFileLink;
	/** search_files / read_file / list_dir 成功结果行，用于可折叠内联展示 */
	resultLines?: ActivityResultLine[];
	/** resultLines 对应的工具名，用于选择渲染样式 */
	resultKind?: 'search' | 'read' | 'dir' | 'plain';
};

export type ToolCallSegment = {
	type: 'tool_call';
	name: string;
	args: Record<string, unknown>;
	result?: string;
	success?: boolean;
};

export type PlanTodoSegment = {
	type: 'plan_todo';
	todos: Array<{
		id: string;
		content: string;
		status: 'pending' | 'in_progress' | 'completed';
		activeForm?: string;
	}>;
};

export type StreamingToolPreview = {
	name: string;
	partialJson: string;
	index: number;
};

/** 连续 activity 行合并后的分组（对应 Cursor "Explored N files" 折叠块） */
export type ActivityGroupSegment = {
	type: 'activity_group';
	/** 组内所有 activity（含 resultLines） */
	items: ActivitySegment[];
	/** 整组是否仍在进行中（最后一项 pending） */
	pending: boolean;
	/** 摘要标签，如 "Explored 3 files, 2 searches" */
	summary: string;
};

export type AssistantSegment =
	| { type: 'markdown'; text: string }
	| { type: 'thinking'; id: string; text: string; startedAt?: number; endedAt?: number }
	| { type: 'diff'; diff: string }
	| { type: 'command'; lang: string; body: string }
	/** 围栏已开、闭合 ``` 未到达（流式），独立成段以便立即渲染代码卡片壳 */
	| { type: 'streaming_code'; lang: string; body: string }
	| ActivitySegment
	| ActivityGroupSegment
	| { type: 'file_changes'; files: FileChangeSummary[] }
	| FileEditSegment
	| ToolCallSegment
	| PlanTodoSegment
	/** LLM 调用 begin_outcome 工具的不可见标记：preflight ↔ outcome 切分点 */
	| { type: 'outcome_marker' }
	| { type: 'sub_agent_markdown'; parentToolCallId: string; depth: number; text: string; variant: 'text' | 'thinking' };

const ACTIVITY_PARAGRAPH =
	/^(Explored\b|Ran\b|Verified\b|Verify\b|Linting\b|Linted\b|Searched\b|Checked\b|Reading\b|Editing\b|Searching\b|Wrote\b|Updated\b|Applied\b|Running\b)[\s\S]{0,500}$/i;

function splitUnifiedDiffFiles(raw: string): string[] {
	const t = raw.trim();
	if (!t) return [];
	if (!/^diff --git /m.test(t)) return [t];
	const lines = t.split('\n');
	const chunks: string[][] = [];
	let cur: string[] = [];
	for (const line of lines) {
		if (line.startsWith('diff --git ') && cur.length > 0) {
			chunks.push(cur);
			cur = [line];
		} else {
			cur.push(line);
		}
	}
	if (cur.length) chunks.push(cur);
	return chunks.map((c) => c.join('\n'));
}

function segmentParagraphsForActivity(text: string): AssistantSegment[] {
	const parts = text.split(/\n{2,}/);
	const out: AssistantSegment[] = [];
	for (const p of parts) {
		const trimmed = p.trim();
		if (!trimmed) continue;
		const lines = trimmed.split('\n');
		if (lines.length === 1 && ACTIVITY_PARAGRAPH.test(trimmed)) {
			out.push({ type: 'activity', text: trimmed, status: 'info' });
		} else {
			out.push({ type: 'markdown', text: p });
		}
	}
	return out;
}

function isUnifiedDiffBody(body: string): boolean {
	return /^\s*diff --git /m.test(body);
}

function isShortCommandFence(lang: string, body: string): boolean {
	const L = lang.toLowerCase();
	if (!['bash', 'shell', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'].includes(L)) return false;
	const lines = body.split('\n').filter((l) => l.trim().length > 0);
	return lines.length <= 4 && body.length <= 400;
}

/**
 * 在任意文本切片内解析 fenced code（含未闭合围栏）与活动段落。
 * 该函数不解析 tool 协议，仅用于 tool 标记之外的纯文本区域。
 */
/** 防止畸形输入或逻辑错误导致 while 死循环；正常文档远低于此值 */
const MAX_FENCE_SCAN_ITERATIONS = 16_000;

function segmentTextWithFenceSupport(text: string): AssistantSegment[] {
	const out: AssistantSegment[] = [];
	let i = 0;
	const n = text.length;
	let scanIters = 0;

	const pushText = (slice: string) => {
		if (!slice) return;
		out.push(...segmentParagraphsForActivity(slice));
	};

	while (i < n) {
		if (++scanIters > MAX_FENCE_SCAN_ITERATIONS) {
			// eslint-disable-next-line no-console
			console.warn('[agentSegments] segmentTextWithFenceSupport: iteration cap hit, see ASYNC_DEBUG_AGENT_SEGMENTS', {
				textLen: n,
				cursor: i,
				segmentsSoFar: out.length,
			});
			agentSegmentDebugLog('segmentTextWithFenceSupport: iteration cap, flushing tail as markdown', {
				textLen: n,
				cursor: i,
				segmentsSoFar: out.length,
			});
			out.push({ type: 'markdown', text: text.slice(i) });
			break;
		}
		const fence = text.indexOf('```', i);
		if (fence === -1) {
			pushText(text.slice(i));
			break;
		}
		pushText(text.slice(i, fence));
		const langEnd = text.indexOf('\n', fence + 3);
		if (langEnd === -1) {
			const afterFence = text.slice(fence + 3);
			// 仍在同一行补全语言标记（无换行）：尽早出卡片壳，避免裸露 ``` 文本
			if (/^[\w+#.+-]*$/.test(afterFence)) {
				out.push({ type: 'streaming_code', lang: afterFence, body: '' });
			} else {
				out.push({ type: 'markdown', text: text.slice(fence) });
			}
			break;
		}
		const lang = text.slice(fence + 3, langEnd).trim();
		const close = text.indexOf('```', langEnd + 1);
		if (close === -1) {
			out.push({
				type: 'streaming_code',
				lang,
				body: text.slice(langEnd + 1),
			});
			break;
		}
		const body = text.slice(langEnd + 1, close);
		if (lang === 'diff' || isUnifiedDiffBody(body)) {
			for (const piece of splitUnifiedDiffFiles(body)) {
				if (piece.trim()) out.push({ type: 'diff', diff: piece.trimEnd() });
			}
		} else if (isShortCommandFence(lang, body)) {
			out.push({ type: 'command', lang, body: body.trimEnd() });
		} else {
			out.push({ type: 'markdown', text: text.slice(fence, close + 3) });
		}
		const nextI = close + 3;
		if (nextI <= i) {
			// eslint-disable-next-line no-console
			console.warn('[agentSegments] segmentTextWithFenceSupport: non-advancing cursor', {
				i,
				close,
				nextI,
				fence,
			});
			agentSegmentDebugLog('segmentTextWithFenceSupport: non-advancing cursor, breaking', {
				i,
				close,
				nextI,
				fence,
			});
			break;
		}
		i = nextI;
	}

	return mergeAdjacentMarkdown(out);
}

// ─── Tool marker parsing ────────────────────────────────────────────────

/** 与主进程写入一致：避免 tool 输出里含字面量 `</tool_result>` 时提前截断。 */
const TOOL_RESULT_CLOSE_ESC = '</tool\u200c_result>';

const WRITE_TOOLS = new Set(['Edit', 'str_replace', 'Write', 'write_to_file']);

const TOOL_CALL_OPEN = '<tool_call tool="';
const PLAN_OPEN_1 = '<plan>';
const PLAN_OPEN_2 = '<todo>';

function unescapeJsonFragment(s: string): string {
	let out = '';
	let i = 0;
	while (i < s.length) {
		const c = s[i]!;
		if (c === '\\' && i + 1 < s.length) {
			const n = s[i + 1]!;
			if (n === 'n') out += '\n';
			else if (n === 't') out += '\t';
			else if (n === 'r') out += '\r';
			else if (n === '"') out += '"';
			else if (n === '\\') out += '\\';
			else out += n;
			i += 2;
			continue;
		}
		if (c === '"') break;
		out += c;
		i++;
	}
	return out;
}

function tailAfterKey(partialJson: string, key: string): string | null {
	const re = new RegExp(`"${key}"\\s*:\\s*"`, 'm');
	const m = partialJson.match(re);
	if (m == null || m.index === undefined) return null;
	const start = m.index + m[0].length;
	return unescapeJsonFragment(partialJson.slice(start));
}

type ParsedMarker = {
	start: number;
	end: number;
	name: string;
	args: Record<string, unknown>;
	result?: string;
	success?: boolean;
	isStreaming?: boolean;
	rawJson?: string;
	isPlan?: boolean;
	subParent?: string;
	subDepth?: number;
};

type ToolResultBlock = {
	index: number;
	name: string;
	success: boolean;
	body: string;
	fullEnd: number;
};

/**
 * 解析 `<tool_call tool="NAME" [sub_parent="…"] [sub_depth="…"]>{json}</tool_call>` 的开头。
 */
function parseToolCallOpen(
	content: string,
	absStart: number
): { name: string; jsonStart: number; subParent?: string; subDepth?: number } | null {
	if (!content.startsWith(TOOL_CALL_OPEN, absStart)) {
		return null;
	}
	const nameStart = absStart + TOOL_CALL_OPEN.length;
	const nameQuote = content.indexOf('"', nameStart);
	if (nameQuote === -1) {
		return null;
	}
	const name = content.slice(nameStart, nameQuote);
	let pos = nameQuote + 1;
	let subParent: string | undefined;
	let subDepth: number | undefined;
	while (pos < content.length && /\s/.test(content[pos]!)) {
		pos++;
	}
	while (pos < content.length && content[pos] !== '>') {
		if (content.startsWith('sub_parent="', pos)) {
			pos += 'sub_parent="'.length;
			const eq = content.indexOf('"', pos);
			if (eq === -1) {
				return null;
			}
			subParent = content.slice(pos, eq);
			pos = eq + 1;
			while (pos < content.length && /\s/.test(content[pos]!)) {
				pos++;
			}
			continue;
		}
		if (content.startsWith('sub_depth="', pos)) {
			pos += 'sub_depth="'.length;
			const eq = content.indexOf('"', pos);
			if (eq === -1) {
				return null;
			}
			subDepth = parseInt(content.slice(pos, eq), 10) || 1;
			pos = eq + 1;
			while (pos < content.length && /\s/.test(content[pos]!)) {
				pos++;
			}
			continue;
		}
		return null;
	}
	if (pos >= content.length || content[pos] !== '>') {
		return null;
	}
	return { name, jsonStart: pos + 1, subParent, subDepth };
}

function withNestActivity(seg: ActivitySegment, mk: ParsedMarker): ActivitySegment {
	if (!mk.subParent) {
		return seg;
	}
	return { ...seg, nestParent: mk.subParent, nestDepth: mk.subDepth ?? 1 };
}

function skipJsonObject(s: string, i: number): number {
	if (s[i] !== '{') {
		return -1;
	}
	let depth = 0;
	let state: 'normal' | 'string' | 'escape' = 'normal';
	for (let p = i; p < s.length; p++) {
		const ch = s[p]!;
		if (state === 'escape') {
			state = 'string';
			continue;
		}
		if (state === 'string') {
			if (ch === '\\') {
				state = 'escape';
			} else if (ch === '"') {
				state = 'normal';
			}
			continue;
		}
		if (ch === '"') {
			state = 'string';
			continue;
		}
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return p + 1;
			}
		}
	}
	return -1;
}

function findResultBlockContaining(resultBlocks: ToolResultBlock[], index: number): ToolResultBlock | null {
	for (const block of resultBlocks) {
		if (index < block.index) {
			return null;
		}
		if (index >= block.index && index < block.fullEnd) {
			return block;
		}
	}
	return null;
}

function findAllToolCallMarkers(content: string, resultBlocks: ToolResultBlock[]): ParsedMarker[] {
	const markers: ParsedMarker[] = [];
	let from = 0;
	while (from < content.length) {
		const start = content.indexOf(TOOL_CALL_OPEN, from);
		if (start === -1) {
			break;
		}
		const containingResult = findResultBlockContaining(resultBlocks, start);
		if (containingResult) {
			from = containingResult.fullEnd;
			continue;
		}
		const openParsed = parseToolCallOpen(content, start);
		if (!openParsed) {
			break;
		}
		const { name, jsonStart, subParent, subDepth } = openParsed;
		const jsonEnd = skipJsonObject(content, jsonStart);
		const close = '</tool_call>';

		let args: Record<string, unknown> = {};
		let isStreaming = false;
		let rawJson = '';
		let fullEnd = start;

		if (jsonEnd === -1) {
			isStreaming = true;
			rawJson = content.slice(jsonStart);
			fullEnd = content.length;
		} else {
			const closeIdx = content.indexOf(close, jsonEnd);
			if (closeIdx === -1) {
				isStreaming = true;
				rawJson = content.slice(jsonStart, jsonEnd);
				fullEnd = content.length;
				try {
					const parsed: unknown = JSON.parse(rawJson);
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
						args = parsed as Record<string, unknown>;
					}
				} catch {
					// ignore
				}
			} else {
				rawJson = content.slice(jsonStart, jsonEnd);
				fullEnd = closeIdx + close.length;
				try {
					const parsed: unknown = JSON.parse(rawJson);
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
						args = parsed as Record<string, unknown>;
					}
				} catch {
					args = {};
				}
			}
		}

		markers.push({
			start,
			end: fullEnd,
			name,
			args,
			isStreaming,
			rawJson,
			subParent,
			subDepth,
		});

		if (isStreaming) {
			break;
		}

		from = fullEnd;
	}

	const planRe = /<(plan|todo)>([\s\S]*?)(?:<\/\1>|$)/gi;
	let mPlan;
	while ((mPlan = planRe.exec(content)) !== null) {
		if (findResultBlockContaining(resultBlocks, mPlan.index) != null) {
			continue;
		}
		markers.push({
			start: mPlan.index,
			end: mPlan.index + mPlan[0].length,
			name: mPlan[1]!.toLowerCase(),
			args: {},
			isPlan: true,
			rawJson: mPlan[2],
		});
	}

	return markers;
}

function unescapeToolResultBody(body: string): string {
	return body.split(TOOL_RESULT_CLOSE_ESC).join('</tool_result>');
}

/**
 * 流式追加时，此前缀之后的正文尚未形成完整 tool 协议闭合，分段结果可能仍变化。
 * 用于解析缓存等场景判断「稳定边界」（与 findAllToolResultBlocks / findAllToolCallMarkers 语义一致）。
 */
export function computeStableAgentToolProtocolPrefixLen(content: string): number {
	const resultBlocks = findAllToolResultBlocks(content);
	const lastRb = resultBlocks[resultBlocks.length - 1];
	if (lastRb && lastRb.fullEnd === content.length) {
		const fromOpen = content.slice(lastRb.index);
		if (!fromOpen.includes('</tool_result>')) {
			return lastRb.index;
		}
	}
	const markers = findAllToolCallMarkers(content, resultBlocks);
	for (let i = markers.length - 1; i >= 0; i--) {
		const mk = markers[i]!;
		if (mk.isStreaming) {
			return mk.start;
		}
	}
	return content.length;
}

function findAllToolResultBlocks(
	content: string
): ToolResultBlock[] {
	const out: ToolResultBlock[] = [];
	const open = '<tool_result tool="';
	const successMid = '" success="';
	let from = 0;
	while (from < content.length) {
		const start = content.indexOf(open, from);
		if (start === -1) {
			break;
		}
		const nameStart = start + open.length;
		const nameEnd = content.indexOf(successMid, nameStart);
		if (nameEnd === -1) {
			// 流式：头部还没完整，把整个尾部标记为"进行中"块，避免泄漏
			out.push({
				index: start,
				name: '',
				success: true,
				body: '',
				fullEnd: content.length,
			});
			break;
		}
		const successStart = nameEnd + successMid.length;
		const successEnd = content.indexOf('">', successStart);
		if (successEnd === -1) {
			// 流式：success 属性还没完整
			out.push({
				index: start,
				name: content.slice(nameStart, nameEnd),
				success: true,
				body: '',
				fullEnd: content.length,
			});
			break;
		}
		const successRaw = content.slice(successStart, successEnd);
		if (successRaw !== 'true' && successRaw !== 'false') {
			from = successEnd + 2;
			continue;
		}
		const bodyStart = successEnd + 2;
		const closeTag = '</tool_result>';
		const closeIdx = content.indexOf(closeTag, bodyStart);
		if (closeIdx === -1) {
			// 流式：body 还没完整，把到目前为止的内容作为 body
			const partialBody = unescapeToolResultBody(content.slice(bodyStart));
			out.push({
				index: start,
				name: content.slice(nameStart, nameEnd),
				success: successRaw === 'true',
				body: partialBody,
				fullEnd: content.length,
			});
			break;
		}
		const body = unescapeToolResultBody(content.slice(bodyStart, closeIdx));
		out.push({
			index: start,
			name: content.slice(nameStart, nameEnd),
			success: successRaw === 'true',
			body,
			fullEnd: closeIdx + closeTag.length,
		});
		from = closeIdx + closeTag.length;
	}
	return out;
}

/** 助手气泡是否含本应用序列化的 Agent 工具协议（用于从历史记录恢复时仍渲染工具卡片）。 */
export function assistantMessageUsesAgentToolProtocol(content: string): boolean {
	return (
		isStructuredAssistantMessage(content) ||
		content.includes(TOOL_CALL_OPEN) ||
		content.includes('<tool_result tool="') ||
		content.includes(PLAN_OPEN_1) ||
		content.includes(PLAN_OPEN_2)
	);
}

function tryParseToolArgs(rawJson: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(rawJson);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Keep partial-json fallback behavior.
	}
	return {};
}

/** 从 read_file 返回的正文（6 位行号|内容）解析实际读取区间 */
function parseNumberedResultLineRange(result: string): { start: number; end: number } | null {
	const re = /^\s*(\d+)\|/gm;
	let m: RegExpExecArray | null;
	let min = Infinity;
	let max = 0;
	while ((m = re.exec(result)) !== null) {
		const n = parseInt(m[1]!, 10);
		if (Number.isFinite(n)) {
			min = Math.min(min, n);
			max = Math.max(max, n);
		}
	}
	if (!Number.isFinite(min) || min === Infinity) {
		return null;
	}
	return { start: min, end: Math.max(max, min) };
}

function computeReadFileAgentLink(mk: ParsedMarker, path: string, inProgress: boolean): AgentReadFileLink | undefined {
	if (!path.trim() || mk.success === false) {
		return undefined;
	}
	const p = path.trim();

	if (mk.result !== undefined && mk.result.trim()) {
		const head = mk.result.slice(0, 160);
		if (/^(File not found|Error:|Skipped binary)/i.test(head)) {
			return undefined;
		}
		const parsed = parseNumberedResultLineRange(mk.result);
		if (parsed) {
			return { path: p, startLine: parsed.start, endLine: parsed.end };
		}
	}

	const off = Number(mk.args.offset);
	const lim = Number(mk.args.limit);
	if (Number.isFinite(off) && off > 0) {
		const o = Math.floor(off);
		if (Number.isFinite(lim) && lim > 0) {
			const l = Math.floor(lim);
			return { path: p, startLine: o, endLine: Math.max(o, o + l - 1) };
		}
		return { path: p, startLine: o, endLine: o };
	}
	const sl = Number(mk.args.start_line);
	const el = Number(mk.args.end_line);
	const hasS = Number.isFinite(sl) && sl > 0;
	const hasE = Number.isFinite(el) && el > 0;
	if (hasS && hasE) {
		const a = Math.floor(sl);
		const b = Math.floor(el);
		return { path: p, startLine: Math.min(a, b), endLine: Math.max(a, b) };
	}
	if (hasS) {
		const a = Math.floor(sl);
		return { path: p, startLine: a, endLine: a };
	}

	if (inProgress) {
		return { path: p, startLine: 1, endLine: 1 };
	}
	return undefined;
}

function readFileActivityLabel(
	t: TFunction,
	path: string,
	link: AgentReadFileLink | undefined,
	inProgress: boolean,
	failed: boolean
): string {
	if (failed) {
		return t('agent.activity.read', { path });
	}
	if (!link) {
		return inProgress ? t('agent.activity.reading', { path }) : t('agent.activity.read', { path });
	}
	const { startLine: s, endLine: e } = link;
	if (inProgress) {
		if (s === 1 && e === 1) {
			return t('agent.activity.reading', { path });
		}
		if (s === e) {
			return t('agent.activity.readingAtLine', { path, line: s });
		}
		return t('agent.activity.readingWithRange', { path, start: s, end: e });
	}
	if (s === e) {
		return t('agent.activity.readAtLine', { path, line: s });
	}
	return t('agent.activity.readWithRange', { path, start: s, end: e });
}

function extractResultSummary(name: string, result: string | undefined, t: TFunction): string | undefined {
	if (!result) return undefined;
	switch (name) {
		case 'Read':
		case 'read_file': {
			const lines = result.split('\n');
			const count = lines.filter((l) => /^\s*\d+\|/.test(l)).length || lines.length;
			return t('agent.summary.readLines', { count });
		}
		case 'Glob': {
			if (result === 'No files found') return t('agent.summary.noMatches');
			const lines = result.split('\n').filter((l) => l.trim() && !/^Found\s/i.test(l));
			return t('agent.summary.dirEntries', { count: lines.length });
		}
		case 'list_dir': {
			const entries = result.split('\n').filter((l) => l.trim()).length;
			if (result === '(empty directory)') return t('agent.summary.emptyDir');
			return t('agent.summary.dirEntries', { count: entries });
		}
		case 'search_files':
		case 'Grep': {
			if (
				result === 'No matches found.' ||
				result === 'No files found' ||
				result.startsWith('No matches found')
			) {
				return t('agent.summary.noMatches');
			}
			const lines = result.split('\n').filter((l) => l.trim());
			return t('agent.summary.searchMatches', { count: lines.length });
		}
		case 'Bash':
		case 'execute_command': {
			const lines = result.split('\n').filter((l) => l.trim());
			if (lines.length === 1 && result.includes('(command completed with no output)')) return t('agent.summary.cmdNoOutput');
			return t('agent.summary.cmdOutput', { lines: lines.length });
		}
		case 'Write':
		case 'write_to_file':
		case 'Edit':
		case 'str_replace':
			return undefined;
		default:
			return undefined;
	}
}

/** 解析 Grep content / 旧 search_files 结果行：格式为 "path:lineNo:content" */
function parseSearchResultLines(result: string): ActivityResultLine[] {
	if (!result || result === 'No matches found.') return [];
	return result
		.split('\n')
		.filter((l) => l.trim())
		.map((line) => {
			// rg 输出格式：path:lineNo:content（路径可能含冒号，lineNo 是纯数字）
			const m = line.match(/^(.+?):(\d+):(.*)$/);
			if (m) {
				return {
					text: line,
					filePath: m[1],
					lineNo: parseInt(m[2]!, 10),
					matchText: m[3],
				};
			}
			return { text: line };
		});
}

/** 解析 read_file 结果行：格式为 "  123|content" */
function parseReadFileResultLines(result: string): ActivityResultLine[] {
	if (!result) return [];
	return result
		.split('\n')
		.map((line) => {
			const m = line.match(/^\s*(\d+)\|(.*)$/);
			if (m) {
				return { text: line, lineNo: parseInt(m[1]!, 10), matchText: m[2] };
			}
			return { text: line };
		});
}

/** 解析 list_dir 结果行 */
function parseDirResultLines(result: string): ActivityResultLine[] {
	if (!result || result === '(empty directory)') return [];
	return result
		.split('\n')
		.filter((l) => l.trim())
		.map((line) => ({ text: line }));
}

/** 解析 Bash / execute_command 标准输出（保留空行，与终端一致） */
function parseCommandResultLines(result: string): ActivityResultLine[] {
	if (!result || result.includes('(command completed with no output)')) return [];
	return result.split('\n').map((line) => ({ text: line }));
}

function summarizeToolActivity(mk: ParsedMarker, t: TFunction): ActivitySegment {
	const inProgress = mk.result === undefined;
	const failed = mk.success === false;
	const detail = failed ? compactActivityDetail(mk.result, t) : undefined;
	const summary = !inProgress && !failed ? extractResultSummary(mk.name, mk.result, t) : undefined;
	
	const getPath = (argName = 'path') => {
		if (mk.args[argName]) return String(mk.args[argName]);
		if (mk.isStreaming && mk.rawJson) return tailAfterKey(mk.rawJson, argName) ?? '';
		return '';
	};

	const filePathFromArgs = () => {
		if (mk.args.file_path) return String(mk.args.file_path);
		if (mk.args.path) return String(mk.args.path);
		if (mk.isStreaming && mk.rawJson) {
			return (
				tailAfterKey(mk.rawJson, 'file_path') ??
				tailAfterKey(mk.rawJson, 'path') ??
				''
			);
		}
		return '';
	};

	switch (mk.name) {
		case 'Read':
		case 'read_file': {
			const p = filePathFromArgs();
			const agentReadLink = computeReadFileAgentLink(mk, p, inProgress);
			const resultLines =
				!inProgress && !failed && mk.result
					? parseReadFileResultLines(mk.result)
					: undefined;
			return withNestActivity(
				{
					type: 'activity',
					text: readFileActivityLabel(t, p, agentReadLink, inProgress, failed),
					status: inProgress ? 'pending' : failed ? 'error' : 'success',
					detail,
					summary,
					agentReadLink,
					resultLines,
					resultKind: resultLines ? 'read' : undefined,
				},
				mk
			);
		}
		case 'Write':
		case 'write_to_file': {
			const p = filePathFromArgs();
			let text = t('agent.activity.wrote', { path: p });
			if (typeof mk.result === 'string') {
				if (mk.result.startsWith('Created ')) text = t('agent.activity.created', { path: p });
				else if (mk.result.startsWith('Updated ')) text = t('agent.activity.updated', { path: p });
			}
			return withNestActivity(
				{
					type: 'activity',
					text: failed
						? t('agent.activity.writeFailed', { path: p })
						: inProgress
							? t('agent.activity.writing', { path: p })
							: text,
					status: failed ? 'error' : inProgress ? 'pending' : 'success',
					detail,
				},
				mk
			);
		}
		case 'Edit':
		case 'str_replace': {
			const p = filePathFromArgs();
			return withNestActivity(
				{
					type: 'activity',
					text: failed
						? t('agent.activity.editFailed', { path: p })
						: inProgress
							? t('agent.activity.editing', { path: p })
							: t('agent.activity.edited', { path: p }),
					status: failed ? 'error' : inProgress ? 'pending' : 'success',
					detail,
				},
				mk
			);
		}
		case 'Glob': {
			const pat = getPath('pattern') || '*';
			const body =
				mk.result?.replace(/^Found[^\n]*\n?/m, '').trim() ?? '';
			const resultLines =
				!inProgress && !failed && body && mk.result !== 'No files found'
					? parseDirResultLines(body)
					: undefined;
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress
						? t('agent.activity.searching', { pattern: pat })
						: t('agent.activity.searched', { pattern: pat }),
					status: inProgress ? 'pending' : 'success',
					detail,
					summary,
					resultLines,
					resultKind: resultLines ? 'dir' : undefined,
				},
				mk
			);
		}
		case 'list_dir': {
			const p = getPath() || '.';
			const resultLines =
				!inProgress && !failed && mk.result
					? parseDirResultLines(mk.result)
					: undefined;
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress ? t('agent.activity.listing', { path: p }) : t('agent.activity.listed', { path: p }),
					status: inProgress ? 'pending' : 'success',
					detail,
					summary,
					resultLines,
					resultKind: resultLines ? 'dir' : undefined,
				},
				mk
			);
		}
		case 'search_files':
		case 'Grep': {
			const pat = getPath('pattern');
			const res = mk.result;
			const canParseLines =
				!inProgress &&
				!failed &&
				res &&
				res !== 'No matches found.' &&
				res !== 'No files found' &&
				!res.startsWith('Found ') &&
				!res.includes('total occurrence');
			const resultLines = canParseLines ? parseSearchResultLines(res) : undefined;
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress
						? t('agent.activity.searching', { pattern: pat })
						: t('agent.activity.searched', { pattern: pat }),
					status: inProgress ? 'pending' : 'success',
					detail,
					summary,
					resultLines,
					resultKind: resultLines ? 'search' : undefined,
				},
				mk
			);
		}
		case 'ask_plan_question': {
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress
						? t('plan.q.toolActivityPending')
						: failed
							? t('plan.q.toolActivityFailed')
							: t('plan.q.toolActivityDone'),
					status: inProgress ? 'pending' : failed ? 'error' : 'success',
					detail,
				},
				mk
			);
		}
		case 'request_user_input': {
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress
						? t('agent.userInput.toolActivityPending')
						: failed
							? t('agent.userInput.toolActivityFailed')
							: t('agent.userInput.toolActivityDone'),
					status: inProgress ? 'pending' : failed ? 'error' : 'success',
					detail,
				},
				mk
			);
		}
		case 'plan_submit_draft': {
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress
						? t('plan.draft.toolActivityPending')
						: failed
							? t('plan.draft.toolActivityFailed')
							: t('plan.draft.toolActivityDone'),
					status: inProgress ? 'pending' : failed ? 'error' : 'success',
					detail,
				},
				mk
			);
		}
		case 'Bash':
		case 'execute_command': {
			const cmd = getPath('command').slice(0, 60);
			const resultLines =
				!inProgress && !failed && mk.result
					? parseCommandResultLines(mk.result)
					: undefined;
			return withNestActivity(
				{
					type: 'activity',
					text: failed
						? t('agent.activity.cmdFailed', { cmd })
						: inProgress
							? t('agent.activity.running', { cmd })
							: t('agent.activity.ran', { cmd }),
					status: failed ? 'error' : inProgress ? 'pending' : 'success',
					detail,
					summary,
					resultLines: resultLines?.length ? resultLines : undefined,
					resultKind: resultLines?.length ? 'plain' : undefined,
				},
				mk
			);
		}
		case 'Agent':
		case 'delegate_task':
		case 'Task': {
			const hint = String(mk.args.prompt ?? mk.args.task ?? '').trim().slice(0, 72);
			const subT = String(mk.args.subagent_type ?? '').trim();
			const label =
				subT && hint
					? `${mk.name} (${subT}): ${hint}${hint.length >= 72 ? '…' : ''}`
					: hint
						? `${mk.name}: ${hint}${hint.length >= 72 ? '…' : ''}`
						: mk.name;
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress ? t('agent.toolPending', { name: label }) : label,
					status: inProgress ? 'pending' : failed ? 'error' : 'info',
					detail,
				},
				mk
			);
		}
		case 'TodoWrite': {
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress
						? t('agent.toolPending', { name: 'TodoWrite' })
						: failed
							? t('agent.activity.cmdFailed', { cmd: 'TodoWrite' })
							: t('agent.todoWrite.updated'),
					status: inProgress ? 'pending' : failed ? 'error' : 'success',
					detail,
				},
				mk
			);
		}
		default:
			return withNestActivity(
				{
					type: 'activity',
					text: inProgress ? t('agent.toolPending', { name: mk.name }) : mk.name,
					status: inProgress ? 'pending' : failed ? 'error' : 'info',
					detail,
				},
				mk
			);
	}
}

function compactActivityDetail(detail: string | undefined, t: TFunction): string | undefined {
	if (!detail) return undefined;
	const cleaned = detail.trim();
	if (!cleaned) return undefined;
	return cleaned.length > 1200 ? `${cleaned.slice(0, 1200)}${t('common.truncatedSuffix')}` : cleaned;
}

function clipPreviewText(text: string, maxChars = 8000): string | undefined {
	if (!text) return undefined;
	return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function buildStreamingFileEditSegment(mk: ParsedMarker): FileEditSegment | null {
	if (!mk.rawJson || !WRITE_TOOLS.has(mk.name)) {
		return null;
	}

	const pathGuess =
		tailAfterKey(mk.rawJson, 'file_path') ??
		tailAfterKey(mk.rawJson, 'path') ??
		String(mk.args.file_path ?? mk.args.path ?? '');
	if (mk.name === 'str_replace' || mk.name === 'Edit') {
		const oldStr =
			tailAfterKey(mk.rawJson, 'old_string') ??
			tailAfterKey(mk.rawJson, 'old_str') ??
			String(mk.args.old_string ?? mk.args.old_str ?? '');
		const newStr =
			tailAfterKey(mk.rawJson, 'new_string') ??
			tailAfterKey(mk.rawJson, 'new_str') ??
			String(mk.args.new_string ?? mk.args.new_str ?? '');
		if (!pathGuess && !oldStr && !newStr) {
			// 流式开头 JSON 尚未含可解析字段时仍占位，避免整段预览被跳过
			return {
				type: 'file_edit',
				path: '',
				additions: 0,
				deletions: 0,
				oldStr: '',
				newStr: '',
				isStreaming: true,
			};
		}
		return {
			type: 'file_edit',
			path: pathGuess,
			additions: countLines(newStr),
			deletions: countLines(oldStr),
			oldStr: clipPreviewText(oldStr),
			newStr: clipPreviewText(newStr),
			isStreaming: true,
		};
	}

	const content = tailAfterKey(mk.rawJson, 'content') ?? String(mk.args.content ?? '');
	if (!pathGuess && !content) {
		return {
			type: 'file_edit',
			path: '',
			additions: 0,
			deletions: 0,
			newStr: '',
			isNew: true,
			isStreaming: true,
		};
	}
	return {
		type: 'file_edit',
		path: pathGuess,
		additions: countLines(content),
		deletions: 0,
		newStr: clipPreviewText(content),
		isNew: true,
		isStreaming: true,
	};
}

export function buildStreamingToolSegments(
	preview: StreamingToolPreview | null | undefined,
	options?: SegmentAssistantOptions
): AssistantSegment[] {
	if (!preview) {
		return [];
	}
	const t = options?.t ?? defaultT;
	const mk: ParsedMarker = {
		start: 0,
		end: 0,
		name: preview.name,
		args: tryParseToolArgs(preview.partialJson),
		isStreaming: true,
		rawJson: preview.partialJson,
	};
	const activity = summarizeToolActivity(mk, t);
	if (!WRITE_TOOLS.has(preview.name)) {
		return [activity];
	}
	const edit = buildStreamingFileEditSegment(mk);
	return edit ? [activity, edit] : [activity];
}

function markerHasSubstantiveTail(content: string, mk: ParsedMarker): boolean {
	if (mk.isStreaming || mk.result !== undefined) {
		return false;
	}
	return content.slice(mk.end).trim().length > 0;
}

function extractToolSegments(content: string, t: TFunction): { segments: AssistantSegment[]; hasTools: boolean } {
	const dbg = agentSegmentDebugEnabled();
	const resultBlocks = findAllToolResultBlocks(content);
	const markers = findAllToolCallMarkers(content, resultBlocks);
	if (markers.length === 0 && resultBlocks.length === 0) {
		return { segments: [], hasTools: false };
	}
	if (dbg) {
		agentSegmentDebugLog('extractToolSegments:start', {
			contentLen: content.length,
			toolResultBlocks: resultBlocks.length,
			markers: markers.length,
		});
	}
	// 有 tool_result 块但没有对应 tool_call 标记时（如流式时序差异），
	// 为每个孤立的 tool_result 块合成虚拟 marker，避免原始 XML 泄漏到渲染层
	if (markers.length === 0 && resultBlocks.length > 0) {
		const syntheticSegments: AssistantSegment[] = [];
		let cursor = 0;
		for (const r of resultBlocks) {
			if (r.index > cursor) {
				const text = content.slice(cursor, r.index).trim();
				if (text) syntheticSegments.push(...segmentTextWithFenceSupport(text));
			}
			// 判断是否为流式未闭合块：fullEnd 等于 content.length 且 body 为空或未完整
			const isStreaming = r.fullEnd === content.length && !content.endsWith('</tool_result>');
			const synMk: ParsedMarker = {
				start: r.index,
				end: r.fullEnd,
				name: r.name || 'tool',
				args: {},
				// 流式未闭合时不设置 result，让 summarizeToolActivity 认为它是进行中的
				result: isStreaming ? undefined : r.body,
				success: r.success,
				isStreaming,
			};
			syntheticSegments.push(summarizeToolActivity(synMk, t));
			cursor = r.fullEnd;
		}
		if (cursor < content.length) {
			const text = content.slice(cursor).trim();
			if (text) syntheticSegments.push(...segmentTextWithFenceSupport(text));
		}
		const merged = groupActivities(mergeAdjacentMarkdown(syntheticSegments));
		if (dbg) {
			agentSegmentDebugLog('extractToolSegments:synthetic', {
				segmentCount: merged.length,
				histogram: segmentTypeHistogram(merged),
			});
		}
		return { segments: merged, hasTools: true };
	}
	for (const r of resultBlocks) {
		const prev = markers.find(
			(mk) => mk.name === r.name && mk.end <= r.index && mk.result === undefined
		);
		if (prev) {
			prev.result = r.body;
			prev.success = r.success;
			prev.end = r.fullEnd;
		} else {
			// 孤立的 tool_result：没有对应 tool_call，合成虚拟 marker 避免原始 XML 泄漏
			const isStreaming = r.fullEnd === content.length && !content.endsWith('</tool_result>');
			markers.push({
				start: r.index,
				end: r.fullEnd,
				name: r.name || 'tool',
				args: {},
				result: isStreaming ? undefined : r.body,
				success: r.success,
				isStreaming,
			});
		}
	}

	markers.sort((a, b) => a.start - b.start);

	const segments: AssistantSegment[] = [];
	let cursor = 0;

	for (const mk of markers) {
		if (mk.start > cursor) {
			const text = content.slice(cursor, mk.start).trim();
			if (text) segments.push(...segmentTextWithFenceSupport(text));
		}

		if (mk.isPlan) {
			const lines = (mk.rawJson || '').split('\n');
			const todos: Array<{ id: string; content: string; status: 'pending' | 'completed' }> = [];
			let stepNum = 0;
			for (const line of lines) {
				const m = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
				if (m) {
					stepNum++;
					todos.push({
						id: `todo-${mk.start}-${stepNum}`,
						content: m[2]!.trim(),
						status: m[1]!.trim().toLowerCase() === 'x' ? 'completed' : 'pending',
					});
				}
			}
			if (todos.length > 0) {
				segments.push({ type: 'plan_todo', todos });
			}
			cursor = mk.end;
			continue;
		}

		if (mk.name === 'begin_outcome') {
			segments.push({ type: 'outcome_marker' });
			cursor = mk.end;
			continue;
		}

		const normalizedMk =
			markerHasSubstantiveTail(content, mk)
				? { ...mk, result: '', success: true as const }
				: mk;
		const activity = summarizeToolActivity(normalizedMk, t);

		if (WRITE_TOOLS.has(mk.name)) {
			if (normalizedMk.success) {
				segments.push(activity);
				const filePath = String(mk.args.file_path ?? mk.args.path ?? '');
				if (mk.name === 'str_replace' || mk.name === 'Edit') {
					const oldStr = String(mk.args.old_string ?? mk.args.old_str ?? '');
					const newStr = String(mk.args.new_string ?? mk.args.new_str ?? '');
					const lineMatch =
						mk.result?.match(/at line (\d+)/) ?? mk.result?.match(/first at line (\d+)/);
					segments.push({
						type: 'file_edit',
						path: filePath,
						additions: countLines(newStr),
						deletions: countLines(oldStr),
						startLine: lineMatch ? parseInt(lineMatch[1]!, 10) : undefined,
						oldStr: clipPreviewText(oldStr),
						newStr: clipPreviewText(newStr),
					});
				} else {
					const c = String(mk.args.content ?? '');
					segments.push({
						type: 'file_edit',
						path: filePath,
						additions: countLines(c),
						deletions: 0,
						newStr: clipPreviewText(c),
						isNew: true,
					});
				}
			} else if (mk.isStreaming && mk.rawJson) {
				segments.push(activity);
				const streamingEdit = buildStreamingFileEditSegment(mk);
				if (streamingEdit) {
					segments.push(streamingEdit);
				}
			} else if (mk.result === undefined && mk.rawJson && !markerHasSubstantiveTail(content, mk)) {
				segments.push(activity);
				const pendingEdit = buildStreamingFileEditSegment(mk);
				if (pendingEdit) {
					segments.push(pendingEdit);
				}
			} else {
				segments.push(activity);
			}
		} else if (mk.isStreaming && mk.rawJson) {
			segments.push(activity);
			const streamingEdit = buildStreamingFileEditSegment(mk);
			if (streamingEdit) {
				segments.push(streamingEdit);
			}
		} else if (mk.result === undefined && mk.rawJson && !markerHasSubstantiveTail(content, mk)) {
			segments.push(activity);
			const pendingEdit = buildStreamingFileEditSegment(mk);
			if (pendingEdit) {
				segments.push(pendingEdit);
			}
		} else {
			// TodoWrite: render as plan_todo segment instead of generic activity
			if (mk.name === 'TodoWrite') {
				const todosRaw = Array.isArray(mk.args.todos) ? mk.args.todos : [];
				const todos = todosRaw.map((t: Record<string, unknown>, idx: number) => ({
					id: `todo-${mk.start}-${idx}`,
					content: String(t.content ?? ''),
					status: (['pending', 'in_progress', 'completed'].includes(String(t.status))
						? String(t.status)
						: 'pending') as 'pending' | 'in_progress' | 'completed',
					activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
				}));
				if (todos.length > 0) {
					segments.push({ type: 'plan_todo', todos });
				} else {
					segments.push(activity);
				}
			} else {
				segments.push(activity);
			}
		}

		cursor = mk.end;
	}

	if (cursor < content.length) {
		const text = content.slice(cursor).trim();
		if (text) segments.push(...segmentTextWithFenceSupport(text));
	}

	const done = groupActivities(mergeAdjacentMarkdown(segments));
	if (dbg) {
		agentSegmentDebugLog('extractToolSegments:done', {
			segmentCount: done.length,
			histogram: segmentTypeHistogram(done),
		});
	}
	return { segments: done, hasTools: true };
}

/** 仅 tool_call、尚无 tool_result：用于「工具执行中」活动行（pending） */
export function segmentsFromPendingToolCall(name: string, argsJson: string, t: TFunction): AssistantSegment[] {
	const wire = `\n<tool_call tool="${name}">${argsJson}</tool_call>\n`;
	return extractToolSegments(wire, t).segments;
}

/** 单轮已闭合 tool_call + tool_result，与整段协议解析结果一致 */
export function segmentsFromClosedToolRound(
	name: string,
	argsJson: string,
	result: string,
	success: boolean,
	t: TFunction
): AssistantSegment[] {
	const safe = result.split('</tool_result>').join('</tool\u200c_result>');
	const wire = `\n<tool_call tool="${name}">${argsJson}</tool_call>\n<tool_result tool="${name}" success="${success ? 'true' : 'false'}">${safe}</tool_result>\n`;
	return extractToolSegments(wire, t).segments;
}

/** 合并相邻 markdown 并折叠 activity_group，供 live blocks 与解析结果共用 */
export function finalizeAssistantSegmentsForRender(segments: AssistantSegment[]): AssistantSegment[] {
	const deduped = deduplicatePlanTodos(mergeAdjacentMarkdown(segments));
	return groupActivities(deduped);
}

/**
 * 去重 plan_todo 段：同一条消息中可能有多个 TodoWrite 调用，
 * 每次调用都是完整列表替换，因此只保留最后一个并移到末尾。
 */
function deduplicatePlanTodos(segments: AssistantSegment[]): AssistantSegment[] {
	let lastPlanTodo: AssistantSegment | null = null;
	const out: AssistantSegment[] = [];
	for (const seg of segments) {
		if (seg.type === 'plan_todo') {
			lastPlanTodo = seg;
		} else {
			out.push(seg);
		}
	}
	if (lastPlanTodo) {
		out.push(lastPlanTodo);
	}
	return out;
}

function countLines(s: string): number {
	if (!s) return 0;
	return s.split('\n').length;
}

function normalizeSnippetLines(text: string | undefined): string[] {
	const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
	if (!normalized) {
		return [];
	}
	return normalized.split('\n');
}

function normalizeChangeKeyInput(text: string): string {
	return text.replace(/\r\n?/g, '\n').trim();
}

function hashChangeKeySource(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `${(h >>> 0).toString(16)}:${text.length}`;
}

export function agentChangeKeyFromDiff(diff: string | null | undefined): string | null {
	const normalized = normalizeChangeKeyInput(String(diff ?? ''));
	if (!normalized) {
		return null;
	}
	return `diff:${hashChangeKeySource(normalized)}`;
}

export function buildFileEditPreviewDiff(edit: {
	path: string;
	startLine?: number;
	oldStr?: string;
	newStr?: string;
	isNew?: boolean;
}): string {
	const path = String(edit.path ?? '').trim().replace(/\\/g, '/');
	const oldLines = normalizeSnippetLines(edit.oldStr);
	const newLines = normalizeSnippetLines(edit.newStr);
	if (!path || (oldLines.length === 0 && newLines.length === 0)) {
		return '';
	}
	if (edit.isNew && oldLines.length === 0) {
		const body = newLines.map((line) => `+${line}`).join('\n');
		return [
			`diff --git a/${path} b/${path}`,
			'new file mode 100644',
			'--- /dev/null',
			`+++ b/${path}`,
			`@@ -0,0 +1,${newLines.length} @@`,
			body,
		].join('\n');
	}
	const startLine =
		typeof edit.startLine === 'number' && Number.isFinite(edit.startLine) && edit.startLine > 0
			? Math.floor(edit.startLine)
			: 1;
	const oldCount = oldLines.length;
	const newCount = newLines.length;
	const body = [
		...oldLines.map((line) => `-${line}`),
		...newLines.map((line) => `+${line}`),
	].join('\n');
	return [
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -${startLine},${oldCount} +${startLine},${newCount} @@`,
		body,
	].join('\n');
}

/** Extract cumulative file changes from all segments (for the sticky bottom panel) */
export function collectFileChanges(segments: AssistantSegment[]): FileChangeSummary[] {
	const map = new Map<string, FileChangeSummary>();
	for (const seg of segments) {
		if (seg.type === 'file_edit') {
			const existing = map.get(seg.path) ?? { path: seg.path, additions: 0, deletions: 0 };
			existing.additions += seg.additions;
			existing.deletions += seg.deletions;
			if (seg.startLine && !existing.startLine) existing.startLine = seg.startLine;
			if (!existing.diff) {
				const syntheticDiff = buildFileEditPreviewDiff(seg);
				if (syntheticDiff) {
					existing.diff = syntheticDiff;
				}
			}
			map.set(seg.path, existing);
		}
	}
	return Array.from(map.values());
}

export function fileEditChangeKey(edit: Pick<FileEditSegment, 'path' | 'startLine' | 'oldStr' | 'newStr' | 'isNew'>): string | null {
	return agentChangeKeyFromDiff(buildFileEditPreviewDiff(edit));
}

// ─── Main entry ─────────────────────────────────────────────────────────

export type SegmentAssistantOptions = {
	t?: TFunction;
	planUi?: boolean;
};

function unescapeSubAgentXmlEntities(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}

function expandSubAgentsInSegments(segs: AssistantSegment[]): AssistantSegment[] {
	const out: AssistantSegment[] = [];
	const re =
		/<sub_agent_delta parent="([^"]*)" depth="(\d+)">([\s\S]*?)<\/sub_agent_delta>|<sub_agent_thinking parent="([^"]*)" depth="(\d+)">([\s\S]*?)<\/sub_agent_thinking>/g;
	for (const s of segs) {
		if (s.type !== 'markdown') {
			out.push(s);
			continue;
		}
		const text = s.text;
		let last = 0;
		let matched = false;
		let m: RegExpExecArray | null;
		re.lastIndex = 0;
		while ((m = re.exec(text)) !== null) {
			matched = true;
			if (m.index > last) {
				const chunk = text.slice(last, m.index).trim();
				if (chunk) out.push(...segmentParagraphsForActivity(chunk));
			}
			if (m[1] !== undefined) {
				out.push({
					type: 'sub_agent_markdown',
					parentToolCallId: m[1],
					depth: parseInt(m[2]!, 10) || 1,
					text: unescapeSubAgentXmlEntities(m[3]!),
					variant: 'text',
				});
			} else {
				out.push({
					type: 'sub_agent_markdown',
					parentToolCallId: m[4]!,
					depth: parseInt(m[5]!, 10) || 1,
					text: unescapeSubAgentXmlEntities(m[6]!),
					variant: 'thinking',
				});
			}
			last = m.index + m[0].length;
		}
		if (matched) {
			if (last < text.length) {
				const chunk = text.slice(last).trim();
				if (chunk) out.push(...segmentParagraphsForActivity(chunk));
			}
		} else {
			out.push(s);
		}
	}
	return out;
}

function segmentAssistantContentCore(
	content: string,
	t: TFunction,
	planUi = false
): AssistantSegment[] {
	const dbg = agentSegmentDebugEnabled();
	const t0 = dbg ? performance.now() : 0;
	const questionDisplay = planUi
		? assistantDisplayStripQuestionBlock(content)
		: { text: content, questionState: 'none' as const };
	const displayText = planUi
		? stripPlanDocumentForChatDisplay(questionDisplay.text)
		: questionDisplay.text;
	const planQuestionActivity =
		questionDisplay.questionState === 'none'
			? null
			: ({
					type: 'activity',
					text:
						questionDisplay.questionState === 'pending'
							? t('plan.q.chatActivityPending')
							: t('plan.q.chatActivity'),
					status: questionDisplay.questionState === 'pending' ? 'pending' : 'info',
				} satisfies ActivitySegment);

	const { segments: toolSegments, hasTools } = extractToolSegments(displayText, t);
	if (hasTools) {
		const out = planQuestionActivity ? [...toolSegments, planQuestionActivity] : toolSegments;
		if (dbg) {
			agentSegmentDebugLog('segmentAssistantContentCore:tools', {
				ms: Number((performance.now() - t0).toFixed(2)),
				contentLen: content.length,
				segmentCount: out.length,
				histogram: segmentTypeHistogram(out),
			});
		}
		return out;
	}
	const plain = segmentTextWithFenceSupport(displayText);
	const out = planQuestionActivity ? [...plain, planQuestionActivity] : plain;
	if (dbg) {
		agentSegmentDebugLog('segmentAssistantContentCore:plain', {
			ms: Number((performance.now() - t0).toFixed(2)),
			contentLen: content.length,
			segmentCount: out.length,
			histogram: segmentTypeHistogram(out),
		});
	}
	return out;
}

export function segmentAssistantContent(content: string, options?: SegmentAssistantOptions): AssistantSegment[] {
	const t = options?.t ?? defaultT;
	return expandSubAgentsInSegments(segmentAssistantContentCore(content, t, options?.planUi));
}

/**
 * 助手正文：优先解析结构化 JSON（Agent 落盘格式），否则走内嵌 XML 协议解析。
 * 渲染结果与旧版 XML 路径一致，保持 UI 观感不变。
 */
export function segmentAssistantContentUnified(content: string, options?: SegmentAssistantOptions): AssistantSegment[] {
	const t = options?.t ?? defaultT;
	const dbg = agentSegmentDebugEnabled();
	const t0 = dbg ? performance.now() : 0;
	const p = parseAgentAssistantPayload(content);
	let out: AssistantSegment[];
	if (p) {
		const merged: AssistantSegment[] = [];
		for (const part of p.parts) {
			if (part.type === 'text') {
				if (part.text) merged.push(...segmentAssistantContentCore(part.text, t, options?.planUi));
			} else {
				const mini = structuredToLegacyAgentXml({ _asyncAssistant: 1, v: 1, parts: [part] });
				merged.push(...extractToolSegments(mini, t).segments);
			}
		}
		/** `parts: []` 或仅有空 text 时落盘 JSON 无可见内容，避免把原始协议串显示给用户 */
		if (merged.length === 0) {
			merged.push({ type: 'markdown', text: t('agent.emptyStructuredReply') });
		}
		out = expandSubAgentsInSegments(groupActivities(mergeAdjacentMarkdown(merged)));
	} else {
		out = segmentAssistantContent(content, options);
	}
	if (dbg) {
		agentSegmentDebugLog('segmentAssistantContentUnified:summary', {
			ms: Number((performance.now() - t0).toFixed(2)),
			contentLen: content.length,
			structured: Boolean(p),
			parts: p?.parts.length,
			segmentCount: out.length,
			histogram: segmentTypeHistogram(out),
		});
	}
	return out;
}

function mergeAdjacentMarkdown(segs: AssistantSegment[]): AssistantSegment[] {
	const m: AssistantSegment[] = [];
	for (const s of segs) {
		const last = m[m.length - 1];
		if (s.type === 'markdown' && last?.type === 'markdown') {
			last.text += `\n\n${s.text}`;
		} else {
			m.push(s);
		}
	}
	return m;
}

function isExplorationActivity(seg: ActivitySegment): boolean {
	return seg.resultKind === 'search' || seg.resultKind === 'read' || seg.resultKind === 'dir';
}

/** 为一组 activity 生成摘要标签（仿 Cursor "Explored N files, M searches"） */
function buildGroupSummary(items: ActivitySegment[]): string {
	let reads = 0, searches = 0, dirs = 0, cmds = 0, writes = 0, others = 0;
	for (const it of items) {
		const t = it.text.toLowerCase();
		if (it.resultKind === 'read' || /read|reading/.test(t)) reads++;
		else if (it.resultKind === 'search' || /search|searched|searching|grepped/.test(t)) searches++;
		else if (it.resultKind === 'dir' || /list|listed|listing/.test(t)) dirs++;
		else if (/ran|running|run|executed|command/.test(t)) cmds++;
		else if (/wrote|write|created|updated|edited|edit/.test(t)) writes++;
		else others++;
	}
	const parts: string[] = [];
	const total = reads + searches + dirs + cmds + writes + others;
	if (reads > 0) parts.push(`${reads} file${reads > 1 ? 's' : ''}`);
	if (searches > 0) parts.push(`${searches} search${searches > 1 ? 'es' : ''}`);
	if (dirs > 0) parts.push(`${dirs} dir${dirs > 1 ? 's' : ''}`);
	if (cmds > 0) parts.push(`${cmds} command${cmds > 1 ? 's' : ''}`);
	if (writes > 0) parts.push(`${writes} edit${writes > 1 ? 's' : ''}`);
	if (others > 0 && parts.length === 0) parts.push(`${others} step${others > 1 ? 's' : ''}`);
	if (parts.length === 0) return `${total} step${total > 1 ? 's' : ''}`;
	return `Explored ${parts.join(', ')}`;
}

/**
 * 把连续的 activity 行（以及紧跟其后的 file_edit）合并成 activity_group。
 * file_edit 不进入 group，保持独立渲染（diff 卡片）。
 * 单个 pending activity 不合并（仍单独显示，避免"进行中"状态被折叠）。
 */
function groupActivities(segs: AssistantSegment[]): AssistantSegment[] {
	const out: AssistantSegment[] = [];
	let i = 0;
	while (i < segs.length) {
		const s = segs[i]!;
		if (s.type !== 'activity') {
			out.push(s);
			i++;
			continue;
		}
		const firstActivity = s as ActivitySegment;
		if (!isExplorationActivity(firstActivity)) {
			out.push(s);
			i++;
			continue;
		}
		// 仅收集连续的“探索类” activity（允许中间夹 file_edit，file_edit 不进 group）
		const groupItems: ActivitySegment[] = [];
		let j = i;
		const firstNest = firstActivity.nestParent ?? '';
		while (j < segs.length && (segs[j]!.type === 'activity' || segs[j]!.type === 'file_edit')) {
			if (segs[j]!.type === 'activity') {
				const aj = segs[j] as ActivitySegment;
				if ((aj.nestParent ?? '') !== firstNest) {
					break;
				}
				if (!isExplorationActivity(aj)) {
					break;
				}
				groupItems.push(aj);
			}
			j++;
		}
		// 单行 pending 不折叠（保持原来的进行中指示器）
		if (groupItems.length <= 1) {
			out.push(s);
			i++;
			continue;
		}
		const pending = groupItems[groupItems.length - 1]!.status === 'pending';
		const summary = buildGroupSummary(groupItems);
		out.push({ type: 'activity_group', items: groupItems, pending, summary });
		// file_edit 仍独立输出（在 group 之后）
		for (let k = i; k < j; k++) {
			if (segs[k]!.type === 'file_edit') out.push(segs[k]!);
		}
		i = j;
	}
	return out;
}

// ─── Utility exports ────────────────────────────────────────────────────

/**
 * Extract the last TodoWrite todos from raw assistant message content.
 * Used by AgentChatPanel to render todos outside ChatMarkdown.
 */
export function extractLastTodosFromContent(
	content: string
): Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }> | null {
	// Find all TodoWrite tool_call markers using regex
	const pattern = /<tool_call\s+tool="TodoWrite"[^>]*>([\s\S]*?)<\/tool_call>/g;
	let lastMatch: string | null = null;
	let m: RegExpExecArray | null;
	while ((m = pattern.exec(content)) !== null) {
		lastMatch = m[1];
	}
	if (!lastMatch) return null;
	try {
		const args = JSON.parse(lastMatch);
		const todosRaw = Array.isArray(args.todos) ? args.todos : [];
		if (todosRaw.length === 0) return null;
		return todosRaw.map((t: Record<string, unknown>, idx: number) => ({
			id: `ext-todo-${idx}`,
			content: String(t.content ?? ''),
			status: (['pending', 'in_progress', 'completed'].includes(String(t.status))
				? String(t.status)
				: 'pending') as 'pending' | 'in_progress' | 'completed',
			activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
		}));
	} catch {
		return null;
	}
}

export function extractDiffDisplayPath(diff: string): string {
	const m = diff.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
	if (m) return m[2] ?? m[1] ?? 'file';
	const p = diff.match(/^\+\+\+ b\/(.+)$/m);
	if (p) return p[1] ?? 'file';
	return 'patch';
}

export function countDiffAddDel(diff: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) additions++;
		else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
	}
	return { additions, deletions };
}

export function firstHunkNewStartLine(diff: string): number | null {
	const m = diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
	if (!m) return null;
	const n = parseInt(m[1]!, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function diffPathToWorkspaceRel(displayPath: string, workspaceRoot: string | null | undefined): string {
	const d = displayPath.replace(/\\/g, '/').trim();
	if (!d) return '';
	if (!workspaceRoot) return d;
	const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
	const dl = d.toLowerCase();
	const rl = root.toLowerCase();
	if (dl === rl || dl === `${rl}/`) return '';
	if (dl.startsWith(`${rl}/`)) return d.slice(root.length + 1);
	return d;
}
