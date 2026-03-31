import { defaultT, type TFunction } from './i18n';

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
	todos: Array<{ id: string; content: string; status: 'pending' | 'completed' }>;
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
	| { type: 'diff'; diff: string }
	| { type: 'command'; lang: string; body: string }
	| ActivitySegment
	| ActivityGroupSegment
	| { type: 'file_changes'; files: FileChangeSummary[] }
	| FileEditSegment
	| ToolCallSegment
	| PlanTodoSegment;

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

// ─── Tool marker parsing ────────────────────────────────────────────────

/** 与主进程写入一致：避免 tool 输出里含字面量 `</tool_result>` 时提前截断。 */
const TOOL_RESULT_CLOSE_ESC = '</tool\u200c_result>';

const WRITE_TOOLS = new Set(['str_replace', 'write_to_file']);

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
};

type ToolResultBlock = {
	index: number;
	name: string;
	success: boolean;
	body: string;
	fullEnd: number;
};

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
		const nameStart = start + TOOL_CALL_OPEN.length;
		const nameEnd = content.indexOf('">', nameStart);
		if (nameEnd === -1) {
			break;
		}
		const name = content.slice(nameStart, nameEnd);
		const jsonStart = nameEnd + 2;
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
			break;
		}
		const successStart = nameEnd + successMid.length;
		const successEnd = content.indexOf('">', successStart);
		if (successEnd === -1) {
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
		case 'read_file': {
			const lines = result.split('\n');
			const count = lines.filter((l) => /^\s*\d+\|/.test(l)).length || lines.length;
			return t('agent.summary.readLines', { count });
		}
		case 'list_dir': {
			const entries = result.split('\n').filter((l) => l.trim()).length;
			if (result === '(empty directory)') return t('agent.summary.emptyDir');
			return t('agent.summary.dirEntries', { count: entries });
		}
		case 'search_files': {
			if (result === 'No matches found.') return t('agent.summary.noMatches');
			const lines = result.split('\n').filter((l) => l.trim());
			return t('agent.summary.searchMatches', { count: lines.length });
		}
		case 'execute_command': {
			const lines = result.split('\n').filter((l) => l.trim());
			if (lines.length === 1 && result.includes('(command completed with no output)')) return t('agent.summary.cmdNoOutput');
			return t('agent.summary.cmdOutput', { lines: lines.length });
		}
		default:
			return undefined;
	}
}

/** 解析 search_files 结果行：格式为 "path:lineNo:content" */
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

/** 解析 execute_command 标准输出（保留空行，与终端一致） */
function parseCommandResultLines(result: string): ActivityResultLine[] {
	if (!result || result.includes('(command completed with no output)')) return [];
	return result.split('\n').map((line) => ({ text: line }));
}

function summarizeToolActivity(mk: ParsedMarker, t: TFunction): ActivitySegment {
	const inProgress = mk.result === undefined;
	const failed = mk.success === false;
	const detail = failed ? compactActivityDetail(mk.result, t) : undefined;
	const summary = (!inProgress && !failed) ? extractResultSummary(mk.name, mk.result, t) : undefined;
	
	const getPath = (argName = 'path') => {
		if (mk.args[argName]) return String(mk.args[argName]);
		if (mk.isStreaming && mk.rawJson) return tailAfterKey(mk.rawJson, argName) ?? '';
		return '';
	};

	switch (mk.name) {
		case 'read_file': {
			const p = getPath();
			const agentReadLink = computeReadFileAgentLink(mk, p, inProgress);
			const resultLines =
				!inProgress && !failed && mk.result
					? parseReadFileResultLines(mk.result)
					: undefined;
			return {
				type: 'activity',
				text: readFileActivityLabel(t, p, agentReadLink, inProgress, failed),
				status: inProgress ? 'pending' : failed ? 'error' : 'success',
				detail,
				summary,
				agentReadLink,
				resultLines,
				resultKind: resultLines ? 'read' : undefined,
			};
		}
		case 'write_to_file': {
			const p = getPath();
			let text = t('agent.activity.wrote', { path: p });
			if (typeof mk.result === 'string') {
				if (mk.result.startsWith('Created ')) text = t('agent.activity.created', { path: p });
				else if (mk.result.startsWith('Updated ')) text = t('agent.activity.updated', { path: p });
			}
			return {
				type: 'activity',
				text: failed
					? t('agent.activity.writeFailed', { path: p })
					: inProgress
						? t('agent.activity.writing', { path: p })
						: text,
				status: failed ? 'error' : inProgress ? 'pending' : 'success',
				detail,
			};
		}
		case 'str_replace': {
			const p = getPath();
			return {
				type: 'activity',
				text: failed
					? t('agent.activity.editFailed', { path: p })
					: inProgress
						? t('agent.activity.editing', { path: p })
						: t('agent.activity.edited', { path: p }),
				status: failed ? 'error' : inProgress ? 'pending' : 'success',
				detail,
			};
		}
		case 'list_dir': {
			const p = getPath() || '.';
			const resultLines =
				!inProgress && !failed && mk.result
					? parseDirResultLines(mk.result)
					: undefined;
			return {
				type: 'activity',
				text: inProgress ? t('agent.activity.listing', { path: p }) : t('agent.activity.listed', { path: p }),
				status: inProgress ? 'pending' : 'success',
				detail,
				summary,
				resultLines,
				resultKind: resultLines ? 'dir' : undefined,
			};
		}
		case 'search_files': {
			const pat = getPath('pattern');
			const resultLines =
				!inProgress && !failed && mk.result && mk.result !== 'No matches found.'
					? parseSearchResultLines(mk.result)
					: undefined;
			return {
				type: 'activity',
				text: inProgress
					? t('agent.activity.searching', { pattern: pat })
					: t('agent.activity.searched', { pattern: pat }),
				status: inProgress ? 'pending' : 'success',
				detail,
				summary,
				resultLines,
				resultKind: resultLines ? 'search' : undefined,
			};
		}
		case 'execute_command': {
			const cmd = getPath('command').slice(0, 60);
			const resultLines =
				!inProgress && !failed && mk.result
					? parseCommandResultLines(mk.result)
					: undefined;
			return {
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
			};
		}
		default:
			return {
				type: 'activity',
				text: inProgress ? t('agent.toolPending', { name: mk.name }) : mk.name,
				status: inProgress ? 'pending' : failed ? 'error' : 'info',
				detail,
			};
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

	const pathGuess = tailAfterKey(mk.rawJson, 'path') ?? String(mk.args.path ?? '');
	if (mk.name === 'str_replace') {
		const oldStr = tailAfterKey(mk.rawJson, 'old_str') ?? String(mk.args.old_str ?? '');
		const newStr = tailAfterKey(mk.rawJson, 'new_str') ?? String(mk.args.new_str ?? '');
		if (!pathGuess && !oldStr && !newStr) {
			return null;
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
		return null;
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
	const resultBlocks = findAllToolResultBlocks(content);
	const markers = findAllToolCallMarkers(content, resultBlocks);
	if (markers.length === 0 && resultBlocks.length === 0) {
		return { segments: [], hasTools: false };
	}
	// 有 tool_result 块但没有对应 tool_call 标记时（如流式时序差异），
	// 为每个孤立的 tool_result 块合成虚拟 marker，避免原始 XML 泄漏到渲染层
	if (markers.length === 0 && resultBlocks.length > 0) {
		const syntheticSegments: AssistantSegment[] = [];
		let cursor = 0;
		for (const r of resultBlocks) {
			if (r.index > cursor) {
				const text = content.slice(cursor, r.index).trim();
				if (text) syntheticSegments.push(...segmentParagraphsForActivity(text));
			}
			const synMk: ParsedMarker = {
				start: r.index,
				end: r.fullEnd,
				name: r.name,
				args: {},
				result: r.body,
				success: r.success,
			};
			syntheticSegments.push(summarizeToolActivity(synMk, t));
			cursor = r.fullEnd;
		}
		if (cursor < content.length) {
			const text = content.slice(cursor).trim();
			if (text) syntheticSegments.push(...segmentParagraphsForActivity(text));
		}
		return { segments: groupActivities(mergeAdjacentMarkdown(syntheticSegments)), hasTools: true };
	}
	for (const r of resultBlocks) {
		const prev = markers.find(
			(mk) => mk.name === r.name && mk.end <= r.index && mk.result === undefined
		);
		if (prev) {
			prev.result = r.body;
			prev.success = r.success;
			prev.end = r.fullEnd;
		}
	}

	markers.sort((a, b) => a.start - b.start);

	const segments: AssistantSegment[] = [];
	let cursor = 0;

	for (const mk of markers) {
		if (mk.start > cursor) {
			const text = content.slice(cursor, mk.start).trim();
			if (text) segments.push(...segmentParagraphsForActivity(text));
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

		const normalizedMk =
			markerHasSubstantiveTail(content, mk)
				? { ...mk, result: '', success: true as const }
				: mk;
		const activity = summarizeToolActivity(normalizedMk, t);

		if (WRITE_TOOLS.has(mk.name)) {
			if (normalizedMk.success) {
				segments.push(activity);
				const filePath = String(mk.args.path ?? '');
				if (mk.name === 'str_replace') {
					const oldStr = String(mk.args.old_str ?? '');
					const newStr = String(mk.args.new_str ?? '');
					const lineMatch = mk.result?.match(/at line (\d+)/);
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
			segments.push(activity);
		}

		cursor = mk.end;
	}

	if (cursor < content.length) {
		const text = content.slice(cursor).trim();
		if (text) segments.push(...segmentParagraphsForActivity(text));
	}

	return { segments: groupActivities(mergeAdjacentMarkdown(segments)), hasTools: true };
}

function countLines(s: string): number {
	if (!s) return 0;
	return s.split('\n').length;
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
			map.set(seg.path, existing);
		}
	}
	return Array.from(map.values());
}

// ─── Main entry ─────────────────────────────────────────────────────────

export type SegmentAssistantOptions = {
	t?: TFunction;
};

export function segmentAssistantContent(content: string, options?: SegmentAssistantOptions): AssistantSegment[] {
	const t = options?.t ?? defaultT;
	const { segments: toolSegments, hasTools } = extractToolSegments(content, t);
	if (hasTools) return toolSegments;

	const out: AssistantSegment[] = [];
	let i = 0;
	const n = content.length;

	const pushText = (slice: string) => {
		if (!slice) return;
		out.push(...segmentParagraphsForActivity(slice));
	};

	while (i < n) {
		const fence = content.indexOf('```', i);
		if (fence === -1) { pushText(content.slice(i)); break; }
		pushText(content.slice(i, fence));
		const langEnd = content.indexOf('\n', fence + 3);
		if (langEnd === -1) { out.push({ type: 'markdown', text: content.slice(fence) }); break; }
		const lang = content.slice(fence + 3, langEnd).trim();
		const close = content.indexOf('```', langEnd + 1);
		if (close === -1) { out.push({ type: 'markdown', text: content.slice(fence) }); break; }
		const body = content.slice(langEnd + 1, close);
		if (lang === 'diff' || isUnifiedDiffBody(body)) {
			for (const piece of splitUnifiedDiffFiles(body)) {
				if (piece.trim()) out.push({ type: 'diff', diff: piece.trimEnd() });
			}
		} else if (isShortCommandFence(lang, body)) {
			out.push({ type: 'command', lang, body: body.trimEnd() });
		} else {
			out.push({ type: 'markdown', text: content.slice(fence, close + 3) });
		}
		i = close + 3;
	}

	return mergeAdjacentMarkdown(out);
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
		// 收集连续的 activity（允许中间夹 file_edit，file_edit 不进 group）
		const groupItems: ActivitySegment[] = [];
		let j = i;
		while (j < segs.length && (segs[j]!.type === 'activity' || segs[j]!.type === 'file_edit')) {
			if (segs[j]!.type === 'activity') groupItems.push(segs[j] as ActivitySegment);
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
