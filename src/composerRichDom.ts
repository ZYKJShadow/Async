/** 富文本输入：内联文件 chip + @ 提及的 DOM 工具（contenteditable） */

import { fileTypeIconHtmlForRelPath, isRasterImageRelPath } from './fileTypeIcons';
import {
	newSegmentId,
	slashCommandWire,
	type ComposerSegment,
	type SlashCommandToken,
} from './composerSegments';

const CHIP_CLASS = 'ref-inline-file-chip';
export const SLASH_CMD_CLASS = 'ref-inline-slash-chip';

function fileBasename(path: string): string {
	const n = path.replace(/\\/g, '/');
	return n.split('/').pop() || n;
}

/** 用于 @ 检测：文本节点 + BR，跳过 chip 内部 */
export function domPlainPrefixForAt(root: HTMLElement): string {
	let s = '';
	const walk = (n: Node) => {
		if (n.nodeType === Node.TEXT_NODE) {
			s += n.textContent ?? '';
			return;
		}
		if (n.nodeType !== Node.ELEMENT_NODE) {
			return;
		}
		const e = n as HTMLElement;
		if (e.classList.contains(CHIP_CLASS) || e.classList.contains(SLASH_CMD_CLASS)) {
			return;
		}
		if (e.tagName === 'BR') {
			s += '\n';
			return;
		}
		e.childNodes.forEach(walk);
	};
	root.childNodes.forEach(walk);
	return s;
}

export function textBeforeCaretForAt(root: HTMLElement): string {
	const sel = window.getSelection();
	if (!sel?.anchorNode || !root.contains(sel.anchorNode)) {
		return '';
	}
	const range = document.createRange();
	range.setStart(root, 0);
	range.setEnd(sel.anchorNode, sel.anchorOffset);
	const holder = document.createElement('div');
	holder.appendChild(range.cloneContents());
	return domPlainPrefixForAt(holder);
}

function normalizeCaretLikeRect(rect: DOMRect, lineHeightPx: number): DOMRect {
	if (rect.width === 0 && rect.height === 0) {
		return new DOMRect(rect.left, rect.top, 1, lineHeightPx);
	}
	return rect;
}

/**
 * @ 菜单锚点：优先用「当前 @ 查询」在 DOM 中的范围（与可见文字一致）；
 * 选区 getBoundingClientRect 在 contenteditable 里偶发不准，且窗口改高后若晚两帧才量会明显错位。
 *
 * 返回的 rect 会被 clamp 到容器的可视区域内——当富文本输入框自身有滚动时，
 * 光标的原始 DOMRect 可能超出输入框 visible bounds，导致 @ 菜单偏到奇怪的位置。
 */
export function getCaretRectFromRichRoot(root: HTMLElement): DOMRect | null {
	const lineH = Number.parseFloat(getComputedStyle(root).lineHeight) || 20;
	const mentionR = findAtMentionDomRange(root);
	let raw: DOMRect | null = null;
	if (mentionR) {
		raw = normalizeCaretLikeRect(mentionR.getBoundingClientRect(), lineH);
	} else {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
			return null;
		}
		const r = sel.getRangeAt(0).cloneRange();
		raw = normalizeCaretLikeRect(r.getBoundingClientRect(), lineH);
	}
	if (!raw) {
		return null;
	}
	// Clamp to container visible bounds
	return clampRectToContainer(raw, root);
}

/**
 * 将光标矩形限制在容器的可视区域内。
 * 当 contenteditable 有自身滚动时，光标可能落在 overflow 裁剪区外。
 */
function clampRectToContainer(rect: DOMRect, container: HTMLElement): DOMRect {
	const cb = container.getBoundingClientRect();
	const top = Math.max(rect.top, cb.top);
	const bottom = Math.min(rect.bottom, cb.bottom);
	const left = Math.max(rect.left, cb.left);
	const right = Math.min(rect.right, cb.right);
	// 如果光标完全在容器外（上/下溢出），返回容器边缘
	if (top >= bottom) {
		const clampedTop = rect.top < cb.top ? cb.top : cb.bottom - rect.height;
		return new DOMRect(left, clampedTop, Math.max(1, right - left), rect.height);
	}
	return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
}

export function findAtMentionDomRange(root: HTMLElement): Range | null {
	const slice = textBeforeCaretForAt(root);
	const match = slice.match(/(?:@|\uFF03)([^\s@\n\uFF03]*)$/);
	if (!match || match.index === undefined) {
		return null;
	}
	const startOff = match.index;
	const endOff = slice.length;
	let pos = 0;
	const range = document.createRange();
	let started = false;

	const walk = (n: Node): boolean => {
		if (n.nodeType === Node.TEXT_NODE) {
			const t = n as Text;
			const len = t.length;
			const next = pos + len;
			if (!started && startOff >= pos && startOff < next) {
				range.setStart(t, startOff - pos);
				started = true;
			}
			if (started && endOff >= pos && endOff <= next) {
				range.setEnd(t, endOff - pos);
				return true;
			}
			pos = next;
			return false;
		}
		if (n.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		const e = n as HTMLElement;
		if (e.classList.contains(CHIP_CLASS) || e.classList.contains(SLASH_CMD_CLASS)) {
			return false;
		}
		if (e.tagName === 'BR') {
			if (!started && startOff === pos) {
				range.setStartBefore(e);
				started = true;
			}
			if (started && endOff === pos) {
				range.setEndBefore(e);
				return true;
			}
			pos += 1;
			return false;
		}
		for (let i = 0; i < e.childNodes.length; i++) {
			if (walk(e.childNodes[i]!)) {
				return true;
			}
		}
		return false;
	};

	for (let i = 0; i < root.childNodes.length; i++) {
		if (walk(root.childNodes[i]!)) {
			return range;
		}
	}
	return started ? range : null;
}

export type FileChipDomHandlers = {
	onPreview: (relPath: string) => void;
	onStructureChange: () => void;
};

export function createFileChipElement(relPath: string, segId: string, h: FileChipDomHandlers): HTMLElement {
	const span = document.createElement('span');
	span.contentEditable = 'false';
	span.dataset.voidRel = relPath;
	span.dataset.segId = segId;
	span.className = CHIP_CLASS;
	if (isRasterImageRelPath(relPath)) {
		span.classList.add('ref-inline-file-chip--image');
	}
	span.setAttribute('role', 'button');
	span.setAttribute('tabindex', '0');
	span.title = relPath;

	const ico = document.createElement('span');
	ico.className = 'ref-inline-file-chip-ico';
	ico.setAttribute('aria-hidden', 'true');
	ico.innerHTML = fileTypeIconHtmlForRelPath(relPath, false);

	const name = document.createElement('span');
	name.className = 'ref-inline-file-chip-name';
	name.textContent = fileBasename(relPath);

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'ref-inline-file-chip-x';
	btn.setAttribute('aria-label', '移除引用');
	btn.textContent = '×';
	btn.addEventListener('mousedown', (e) => e.preventDefault());
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		span.remove();
		h.onStructureChange();
	});

	span.addEventListener('mousedown', (e) => {
		if ((e.target as HTMLElement).closest('.ref-inline-file-chip-x')) {
			return;
		}
		e.preventDefault();
	});
	span.addEventListener('click', (e) => {
		if ((e.target as HTMLElement).closest('.ref-inline-file-chip-x')) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		h.onPreview(relPath);
	});
	span.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			h.onPreview(relPath);
		}
	});

	span.appendChild(ico);
	span.appendChild(name);
	span.appendChild(btn);
	return span;
}

export function createSlashCommandChipElement(
	segId: string,
	command: SlashCommandToken,
	h: FileChipDomHandlers
): HTMLElement {
	const span = document.createElement('span');
	span.contentEditable = 'false';
	span.dataset.segId = segId;
	span.dataset.voidSlash = command;
	span.className = SLASH_CMD_CLASS;
	span.setAttribute('role', 'presentation');

	const label = document.createElement('span');
	label.className = 'ref-inline-slash-chip-label';
	label.textContent = slashCommandWire(command);

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'ref-inline-slash-chip-x';
	btn.setAttribute('aria-label', 'Remove slash command');
	btn.textContent = '×';
	btn.addEventListener('mousedown', (e) => e.preventDefault());
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		span.remove();
		h.onStructureChange();
	});

	span.addEventListener('mousedown', (e) => {
		if ((e.target as HTMLElement).closest('.ref-inline-slash-chip-x')) {
			return;
		}
		e.preventDefault();
	});

	span.appendChild(label);
	span.appendChild(btn);
	return span;
}

export function applyFileChipFromAtMention(root: HTMLElement, relPath: string, segId: string, h: FileChipDomHandlers): void {
	const r = findAtMentionDomRange(root);
	if (!r) {
		return;
	}
	r.deleteContents();
	const chip = createFileChipElement(relPath, segId, h);
	r.insertNode(chip);
	/* 与常见 IM/IDE 一致：选完 @ 文件后插入尾随空格，正文与引用在文本上天然分隔 */
	const pad = document.createTextNode(' ');
	chip.after(pad);
	const sel = window.getSelection();
	const nr = document.createRange();
	nr.setStartAfter(pad);
	nr.collapse(true);
	sel?.removeAllRanges();
	sel?.addRange(nr);
	h.onStructureChange();
}

/** 在光标处插入文件 chip（拖放/粘贴附件），行为与 @ 选文件后的 chip 一致 */
export function insertFileChipAtCaret(root: HTMLElement, relPath: string, segId: string, h: FileChipDomHandlers): void {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
		placeCaretAtEndOfRichRoot(root);
	}
	const sel2 = window.getSelection();
	if (!sel2 || sel2.rangeCount === 0 || !root.contains(sel2.anchorNode)) {
		return;
	}
	const range = sel2.getRangeAt(0).cloneRange();
	range.deleteContents();
	const chip = createFileChipElement(relPath, segId, h);
	range.insertNode(chip);
	const pad = document.createTextNode(' ');
	chip.after(pad);
	const nr = document.createRange();
	nr.setStartAfter(pad);
	nr.collapse(true);
	sel2.removeAllRanges();
	sel2.addRange(nr);
	h.onStructureChange();
}

/** 将当前 @查询 替换为静态提及文本（如 @Branch） */
export function applyStaticMentionInsert(root: HTMLElement, insertText: string, h: FileChipDomHandlers): void {
	const r = findAtMentionDomRange(root);
	if (!r) {
		return;
	}
	r.deleteContents();
	const t = insertText.endsWith(' ') ? insertText : `${insertText} `;
	const tn = document.createTextNode(t);
	r.insertNode(tn);
	const sel = window.getSelection();
	const nr = document.createRange();
	nr.setStartAfter(tn);
	nr.collapse(true);
	sel?.removeAllRanges();
	sel?.addRange(nr);
	h.onStructureChange();
}

function mergeAdjacentTextSeg(segments: ComposerSegment[]): ComposerSegment[] {
	const m: ComposerSegment[] = [];
	for (const s of segments) {
		if (s.kind === 'text' && s.text === '') {
			continue;
		}
		const last = m[m.length - 1];
		if (s.kind === 'text' && last?.kind === 'text') {
			last.text += s.text;
		} else {
			m.push(s);
		}
	}
	return m;
}

export function readSegmentsFromRoot(root: HTMLElement): ComposerSegment[] {
	const out: ComposerSegment[] = [];
	let textBuf = '';
	const flush = () => {
		if (textBuf) {
			out.push({ id: newSegmentId(), kind: 'text', text: textBuf });
			textBuf = '';
		}
	};

	const walk = (n: Node) => {
		if (n.nodeType === Node.TEXT_NODE) {
			textBuf += n.textContent ?? '';
			return;
		}
		if (n.nodeType !== Node.ELEMENT_NODE) {
			return;
		}
		const e = n as HTMLElement;
		if (e.classList.contains(SLASH_CMD_CLASS) && e.dataset.voidSlash) {
			flush();
			out.push({
				id: e.dataset.segId || newSegmentId(),
				kind: 'command',
				command: e.dataset.voidSlash,
			});
			return;
		}
		if (e.classList.contains(CHIP_CLASS) && e.dataset.voidRel) {
			flush();
			out.push({
				id: e.dataset.segId || newSegmentId(),
				kind: 'file',
				path: e.dataset.voidRel,
			});
			return;
		}
		if (e.tagName === 'BR') {
			textBuf += '\n';
			return;
		}
		e.childNodes.forEach(walk);
	};

	root.childNodes.forEach(walk);
	flush();
	return mergeAdjacentTextSeg(out);
}

export function placeCaretAtEndOfRichRoot(root: HTMLElement): void {
	const sel = window.getSelection();
	if (!sel) {
		return;
	}
	const r = document.createRange();
	r.selectNodeContents(root);
	r.collapse(false);
	sel.removeAllRanges();
	sel.addRange(r);
}

/**
 * 将光标放在首个 `/create-skill` chip 之后（便于在 chip 后输入）。
 * contenteditable 下 `selectNodeContents` + `collapse(false)` 在仅有 `contentEditable=false` 的 chip 时，
 * 部分浏览器会把选区落在 chip 之前。
 */
export function placeCaretAfterFirstSlashChipElseEnd(root: HTMLElement): void {
	const sel = window.getSelection();
	if (!sel) {
		return;
	}
	let chip: HTMLElement | null = null;
	for (let n = root.firstChild; n; n = n.nextSibling) {
		if (n.nodeType === Node.ELEMENT_NODE) {
			const el = n as HTMLElement;
			if (el.classList.contains(SLASH_CMD_CLASS)) {
				chip = el;
				break;
			}
		}
	}
	const r = document.createRange();
	if (chip) {
		r.setStartAfter(chip);
		r.collapse(true);
	} else {
		r.selectNodeContents(root);
		r.collapse(false);
	}
	sel.removeAllRanges();
	sel.addRange(r);
}

export function writeSegmentsToRoot(
	root: HTMLElement,
	segments: import('./composerSegments').ComposerSegment[],
	h: FileChipDomHandlers
): void {
	root.innerHTML = '';
	for (const s of segments) {
		if (s.kind === 'text') {
			const parts = s.text.split('\n');
			for (let i = 0; i < parts.length; i++) {
				if (i > 0) {
					root.appendChild(document.createElement('br'));
				}
				root.appendChild(document.createTextNode(parts[i]!));
			}
		} else if (s.kind === 'command') {
			root.appendChild(createSlashCommandChipElement(s.id, s.command, h));
		} else if (s.kind === 'file') {
			root.appendChild(createFileChipElement(s.path, s.id, h));
		}
	}
}
