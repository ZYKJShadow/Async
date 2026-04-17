import { parseLeadingWorkspaceRefs } from './composerAtMention';

/** 与 Cursor 类似的斜杠命令 chip；内置向导类命令 */
export const SLASH_COMMAND_IDS = ['create-skill', 'create-rule', 'create-subagent'] as const;
export type SlashCommandId = (typeof SLASH_COMMAND_IDS)[number];
export type SlashCommandToken = SlashCommandId | string;

export const SLASH_COMMAND_WIRE: Record<SlashCommandId, string> = {
	'create-skill': '/create-skill',
	'create-rule': '/create-rule',
	'create-subagent': '/create-subagent',
};

export const CREATE_SKILL_SLUG: SlashCommandId = 'create-skill';
export const CREATE_SKILL_WIRE = SLASH_COMMAND_WIRE['create-skill'];

export function isSlashCommandId(s: string): s is SlashCommandId {
	return (SLASH_COMMAND_IDS as readonly string[]).includes(s);
}

export function slashCommandWire(command: SlashCommandToken): string {
	const normalized = String(command ?? '').trim().replace(/^\//, '');
	if (!normalized) {
		return '/';
	}
	return isSlashCommandId(normalized) ? SLASH_COMMAND_WIRE[normalized] : `/${normalized}`;
}

/** 解析用户消息时匹配 `/wire` 前缀（较长者先匹配） */
const WIRE_PARSE_ORDER: SlashCommandId[] = [...SLASH_COMMAND_IDS].sort(
	(a, b) => SLASH_COMMAND_WIRE[b].length - SLASH_COMMAND_WIRE[a].length
);

function buildSlashParseOrder(knownSlashCommands?: readonly string[]): string[] {
	const set = new Set<string>(WIRE_PARSE_ORDER);
	for (const raw of knownSlashCommands ?? []) {
		const normalized = String(raw ?? '').trim().replace(/^\//, '');
		if (!normalized) {
			continue;
		}
		set.add(normalized);
	}
	return [...set].sort((a, b) => slashCommandWire(b).length - slashCommandWire(a).length);
}

export type ComposerSegment =
	| { id: string; kind: 'text'; text: string }
	| { id: string; kind: 'file'; path: string }
	| { id: string; kind: 'command'; command: SlashCommandToken };

export function newSegmentId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mergeAdjacentText(segments: ComposerSegment[]): ComposerSegment[] {
	const out: ComposerSegment[] = [];
	for (const s of segments) {
		if (s.kind === 'text' && s.text === '') {
			continue;
		}
		const last = out[out.length - 1];
		if (s.kind === 'text' && last?.kind === 'text') {
			last.text += s.text;
		} else {
			out.push(s);
		}
	}
	return out;
}

const SEG_CONTENT_KEY_SEP = '\u241e';

/** 对比 props 与 DOM 读回是否同一内容（忽略 segment id）；纯文本 `/create-skill` 与 command chip 的 key 不同 */
export function segmentsContentKey(segments: ComposerSegment[]): string {
	const norm = mergeAdjacentText(segments);
	return norm
		.map((s) => {
			if (s.kind === 'text') {
				return `t:${s.text}`;
			}
			if (s.kind === 'file') {
				return `f:${s.path}`;
			}
			return `c:${s.command}`;
		})
		.join(SEG_CONTENT_KEY_SEP);
}

/** props 已是某 slash chip，DOM 仍为纯文本 `/…`（含无空格紧贴后缀） */
export function isSlashCommandDomPendingUpgrade(
	segments: ComposerSegment[],
	domSegs: ComposerSegment[]
): boolean {
	const norm = mergeAdjacentText(segments);
	const p0 = norm[0];
	const d0 = domSegs[0];
	if (p0?.kind !== 'command') {
		return false;
	}
	if (d0?.kind !== 'text') {
		return false;
	}
	const wire = slashCommandWire(p0.command);
	const tx = d0.text;
	if (tx === wire || tx.startsWith(wire)) {
		return true;
	}
	// 菜单里通过键盘选中了“非前缀扩展”的命令时，DOM 里仍可能是旧的 `/cr`，
	// 这时也应该允许把纯文本升级成真正的 slash chip。
	if (!tx.startsWith('/')) {
		return false;
	}
	const domSlashToken = tx.match(/^\/\S*/)?.[0] ?? '';
	if (!domSlashToken) {
		return false;
	}
	const domTail = tx.slice(domSlashToken.length).replace(/^\s+/, '');
	const propTail = segmentsToWireText(norm.slice(1)).replace(/^\s+/, '');
	return domTail === propTail;
}

/**
 * 文件/command 与紧随其后的正文之间若缺少空白，在 wire 中补一个 ASCII 空格，
 * 避免 `@path` 与后续字符粘连后被最长前缀匹配吃进路径（如 `@foo.tshello`）。
 * 历史消息里可能仍是 ZWNJ（\u200c），解析端保留兼容。
 */
const FILE_REF_GLUE_SPACE = ' ';

/**
 * `@` 仅在这些前置字符后更可能是文件引用，避免 `user@mail.com` 误判。
 * 发送端写入的 wire 在 `@` 前通常有空格/行首/括号等。
 */
function isLikelyAtFileStart(text: string, atIndex: number): boolean {
	if (atIndex === 0) {
		return true;
	}
	const prev = text[atIndex - 1]!;
	return /[\s([{<'"\n\r:：,，（【「『]/.test(prev);
}

/** 历史 wire 若缺少分隔符，可能出现 `@foo.tshello`；从右侧剥掉误粘的字母后缀 */
function peelGluedTextAfterExtension(raw: string): string {
	const m = raw.match(/^(.+\.([A-Za-z0-9]{1,12}))([A-Za-z][A-Za-z0-9_]*)$/);
	if (m && m[3].length >= 2) {
		return m[1]!;
	}
	return raw;
}

function looksLikeFileRefPath(raw: string): boolean {
	const p = raw.replace(/\\/g, '/');
	if (p.length === 0) {
		return false;
	}
	if (p.includes('/')) {
		return true;
	}
	if (p.startsWith('.')) {
		return true;
	}
	if (/\.[A-Za-z0-9]{1,12}$/.test(p)) {
		return true;
	}
	if (/^[\w-]+\.[\w.-]+$/.test(p)) {
		return true;
	}
	return false;
}

/** 扫描 `@` 后路径体时在此类字符处停止（`.` 不在内，以便匹配 `foo.ts`） */
function isAtPathScanTerminator(c: string): boolean {
	const code = c.charCodeAt(0);
	if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
		return true;
	}
	if (code >= 0x2000 && code <= 0x200f) {
		return true;
	}
	if (',;:!?()[]{}<>\'"「」『』【】（）｛｝。，、；：！？'.includes(c)) {
		return true;
	}
	return false;
}

function heuristicMatchAtPath(text: string, atIndex: number): { path: string; scanEnd: number } | null {
	if (!isLikelyAtFileStart(text, atIndex)) {
		return null;
	}
	let k = atIndex + 1;
	let rawFull = '';
	while (k < text.length) {
		const c = text[k]!;
		if (isAtPathScanTerminator(c)) {
			break;
		}
		rawFull += c;
		k++;
	}
	if (rawFull.length === 0) {
		return null;
	}
	const path = peelGluedTextAfterExtension(rawFull);
	if (!looksLikeFileRefPath(path)) {
		return null;
	}
	return { path, scanEnd: k };
}

/** 发送给后端的纯文本：与内联 chip 顺序一致 */
export function segmentsToWireText(segments: ComposerSegment[]): string {
	let out = '';
	for (let k = 0; k < segments.length; k++) {
		const s = segments[k]!;
		if (s.kind === 'text') {
			out += s.text;
		} else if (s.kind === 'command') {
			out += slashCommandWire(s.command);
			const next = segments[k + 1];
			if (next?.kind === 'text' && next.text.length > 0 && !/^\s/u.test(next.text)) {
				out += FILE_REF_GLUE_SPACE;
			} else if (next?.kind === 'file') {
				out += FILE_REF_GLUE_SPACE;
			}
		} else if (s.kind === 'file') {
			out += `@${s.path}`;
			const next = segments[k + 1];
			if (next?.kind === 'text' && next.text.length > 0 && !/^\s/u.test(next.text)) {
				out += FILE_REF_GLUE_SPACE;
			}
		}
	}
	return out;
}

/** 将用户消息解析为 segments（兼容旧版「首行全是 @路径」格式） */
export function userMessageToSegments(
	content: string,
	_knownPaths?: readonly string[],
	knownSlashCommands?: readonly string[]
): ComposerSegment[] {
	const trimmedStart = content.replace(/^\uFEFF/, '');
	for (const cmd of buildSlashParseOrder(knownSlashCommands)) {
		const wire = slashCommandWire(cmd);
		if (trimmedStart.startsWith(wire)) {
			let rest = trimmedStart.slice(wire.length);
			if (rest.startsWith(FILE_REF_GLUE_SPACE)) {
				rest = rest.slice(1);
			} else if (rest.startsWith('\u200c')) {
				rest = rest.slice(1);
			} else {
				rest = rest.replace(/^\s+/, '');
			}
			const tailSegs = rest.length > 0 ? wirePlainToSegments(rest) : [];
			return mergeAdjacentText([{ id: newSegmentId(), kind: 'command', command: cmd }, ...tailSegs]);
		}
	}
	const legacy = parseLeadingWorkspaceRefs(content);
	if (legacy.refs.length > 0) {
		const parts: ComposerSegment[] = legacy.refs.map((p) => ({
			id: newSegmentId(),
			kind: 'file' as const,
			path: p,
		}));
		if (legacy.body) {
			parts.push({ id: newSegmentId(), kind: 'text', text: legacy.body });
		}
		return mergeAdjacentText(parts);
	}
	return wirePlainToSegments(content);
}

/** 检查字符是否为文件引用的边界字符（路径后应该跟这些字符之一才算有效引用） */
export function isFileRefBoundary(char: string | undefined): boolean {
	if (!char) return true; // 字符串结尾是有效边界
	const code = char.charCodeAt(0);
	// 空白类
	if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return true;
	// 标点符号类
	if (code >= 0x2000 && code <= 0x200f) return true; // 各种空格和不可见字符（包括 ZWNJ \u200c）
	if ('.,;:!?()[]{}<>\'"「」『』【】（）｛｝。，、；：！？'.includes(char)) return true;
	return false;
}

/**
 * 按启发式解析内联 `@相对路径`（不依赖全量 knownPaths）。
 * 发送端已写入合法 wire；渲染端只做展示级切分，避免 O(N) 路径验证。
 */
export function wirePlainToSegments(text: string, _knownPaths?: readonly string[]): ComposerSegment[] {
	const out: ComposerSegment[] = [];
	let i = 0;
	let textBuf = '';
	const flush = () => {
		if (textBuf) {
			out.push({ id: newSegmentId(), kind: 'text', text: textBuf });
			textBuf = '';
		}
	};
	while (i < text.length) {
		if (text[i] === '@' || text[i] === '\uFF03') {
			const hit = heuristicMatchAtPath(text, i);
			if (hit) {
				flush();
				out.push({ id: newSegmentId(), kind: 'file', path: hit.path });
				const pathStart = i + 1;
				const junk = text.slice(pathStart + hit.path.length, hit.scanEnd);
				if (junk) {
					textBuf += junk;
				}
				i = hit.scanEnd;
				while (text[i] === '\u200c' || text[i] === '\u200b') {
					i += 1;
				}
				continue;
			}
		}
		let j = i + 1;
		while (j < text.length && text[j] !== '@' && text[j] !== '\uFF03') {
			j++;
		}
		textBuf += text.slice(i, j);
		i = j;
	}
	flush();
	return mergeAdjacentText(out);
}

export function segmentsTrimmedEmpty(segments: ComposerSegment[]): boolean {
	if (segments.length === 0) {
		return true;
	}
	const first = segments[0];
	if (first?.kind === 'command' && isSlashCommandId(first.command)) {
		const tail = segments.slice(1);
		return segmentsToWireText(tail).trim().length === 0;
	}
	return segmentsToWireText(segments).trim().length === 0;
}

export function getLeadingWizardCommand(segments: ComposerSegment[]): SlashCommandId | null {
	const s = segments[0];
	return s?.kind === 'command' && isSlashCommandId(s.command) ? s.command : null;
}

/** @deprecated 使用 getLeadingWizardCommand(segments) === 'create-skill' */
export function isCreateSkillComposerTurn(segments: ComposerSegment[]): boolean {
	return getLeadingWizardCommand(segments) === 'create-skill';
}
