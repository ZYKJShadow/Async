import type { BotPlatform } from '../../botSettingsTypes.js';

export type TelegramMessageEntity = {
	type: 'bold' | 'italic' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote';
	offset: number;
	length: number;
	url?: string;
	language?: string;
};

export type TelegramRichText = {
	text: string;
	entities: TelegramMessageEntity[];
};

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function stripMarkdownHeadings(text: string): string {
	return text.replace(/^(#{1,6})\s+/gm, '');
}

function stripMarkdownEmphasisKeepText(text: string): string {
	return text
		.replace(/\*\*\*(.+?)\*\*\*/g, '$1')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2')
		.replace(/__(.+?)__/g, '$1')
		.replace(/~~(.+?)~~/g, '$1');
}

function stripMarkdownLinks(text: string): string {
	return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

function isEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

function findClosingMarker(text: string, marker: string, from: number): number {
	let idx = from;
	while (idx < text.length) {
		const found = text.indexOf(marker, idx);
		if (found === -1) {
			return -1;
		}
		if (!isEscaped(text, found)) {
			return found;
		}
		idx = found + marker.length;
	}
	return -1;
}

function sortTelegramEntities(entities: TelegramMessageEntity[]): TelegramMessageEntity[] {
	return [...entities].sort((a, b) => {
		if (a.offset !== b.offset) {
			return a.offset - b.offset;
		}
		return b.length - a.length;
	});
}

function parseInlineTelegram(text: string): TelegramRichText {
	let plain = '';
	const entities: TelegramMessageEntity[] = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index] ?? '';
		if (char === '\\' && index + 1 < text.length) {
			plain += text[index + 1];
			index += 2;
			continue;
		}
		if (char === '`') {
			const close = findClosingMarker(text, '`', index + 1);
			if (close > index + 1) {
				const content = text.slice(index + 1, close);
				const start = plain.length;
				plain += content;
				entities.push({ type: 'code', offset: start, length: content.length });
				index = close + 1;
				continue;
			}
		}
		if (char === '[') {
			const closeBracket = findClosingMarker(text, ']', index + 1);
			if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
				const closeParen = findClosingMarker(text, ')', closeBracket + 2);
				if (closeParen !== -1) {
					const label = text.slice(index + 1, closeBracket);
					const url = text.slice(closeBracket + 2, closeParen).trim();
					const start = plain.length;
					plain += label;
					if (label && url) {
						entities.push({ type: 'text_link', offset: start, length: label.length, url });
					}
					index = closeParen + 1;
					continue;
				}
			}
		}

		if (text.startsWith('||', index)) {
			const close = findClosingMarker(text, '||', index + 2);
			if (close > index + 2) {
				const inner = parseInlineTelegram(text.slice(index + 2, close));
				const start = plain.length;
				plain += inner.text;
				entities.push(
					...inner.entities.map((entity) => ({
						...entity,
						offset: entity.offset + start,
					}))
				);
				if (inner.text.length > 0) {
					entities.push({ type: 'spoiler', offset: start, length: inner.text.length });
				}
				index = close + 2;
				continue;
			}
		}

		const strongMarker =
			text.startsWith('**', index) || text.startsWith('__', index)
				? text.slice(index, index + 2)
				: text.startsWith('~~', index)
					? '~~'
					: null;
		if (strongMarker) {
			const close = findClosingMarker(text, strongMarker, index + strongMarker.length);
			if (close > index + strongMarker.length) {
				const inner = parseInlineTelegram(text.slice(index + strongMarker.length, close));
				const start = plain.length;
				plain += inner.text;
				entities.push(
					...inner.entities.map((entity) => ({
						...entity,
						offset: entity.offset + start,
					}))
				);
				if (inner.text.length > 0) {
					entities.push({
						type: strongMarker === '~~' ? 'strikethrough' : 'bold',
						offset: start,
						length: inner.text.length,
					});
				}
				index = close + strongMarker.length;
				continue;
			}
		}

		if ((char === '*' || char === '_') && text[index + 1] && !/\s/.test(text[index + 1]!)) {
			const close = findClosingMarker(text, char, index + 1);
			if (close > index + 1) {
				const inner = parseInlineTelegram(text.slice(index + 1, close));
				const start = plain.length;
				plain += inner.text;
				entities.push(
					...inner.entities.map((entity) => ({
						...entity,
						offset: entity.offset + start,
					}))
				);
				if (inner.text.length > 0) {
					entities.push({ type: 'italic', offset: start, length: inner.text.length });
				}
				index = close + 1;
				continue;
			}
		}

		plain += char;
		index += 1;
	}
	return {
		text: plain,
		entities: sortTelegramEntities(entities),
	};
}

export function renderTelegramRichText(text: string): TelegramRichText {
	const clean = stripAnsi(String(text ?? '')).replace(/\r\n/g, '\n');
	const lines = clean.split('\n');
	let output = '';
	const entities: TelegramMessageEntity[] = [];
	let index = 0;

	const appendLine = (lineText: string, lineEntities: TelegramMessageEntity[], extraEntity?: Omit<TelegramMessageEntity, 'offset' | 'length'>) => {
		const start = output.length;
		output += lineText;
		for (const entity of lineEntities) {
			entities.push({
				...entity,
				offset: entity.offset + start,
			});
		}
		if (extraEntity && lineText.length > 0) {
			entities.push({
				...extraEntity,
				offset: start,
				length: lineText.length,
			});
		}
	};

	while (index < lines.length) {
		const rawLine = lines[index] ?? '';
		const fenceMatch = rawLine.match(/^```([a-zA-Z0-9_+.-]+)?\s*$/);
		if (fenceMatch) {
			const language = fenceMatch[1]?.trim() || undefined;
			const codeLines: string[] = [];
			index += 1;
			while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
				codeLines.push(lines[index] ?? '');
				index += 1;
			}
			if (index < lines.length && /^```\s*$/.test(lines[index] ?? '')) {
				index += 1;
			}
			const codeText = codeLines.join('\n');
			const start = output.length;
			output += codeText;
			if (codeText.length > 0) {
				entities.push({
					type: 'pre',
					offset: start,
					length: codeText.length,
					...(language ? { language } : {}),
				});
			}
			if (index < lines.length) {
				output += '\n';
			}
			continue;
		}

		const headingMatch = rawLine.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
		if (headingMatch) {
			const inline = parseInlineTelegram(headingMatch[2] ?? '');
			appendLine(inline.text, inline.entities, { type: 'bold' });
			if (index < lines.length - 1) {
				output += '\n';
			}
			index += 1;
			continue;
		}

		const quoteMatch = rawLine.match(/^\s*>\s?(.*)$/);
		if (quoteMatch) {
			const inline = parseInlineTelegram(quoteMatch[1] ?? '');
			appendLine(inline.text, inline.entities, { type: 'blockquote' });
			if (index < lines.length - 1) {
				output += '\n';
			}
			index += 1;
			continue;
		}

		if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(rawLine)) {
			appendLine('──────────', []);
			if (index < lines.length - 1) {
				output += '\n';
			}
			index += 1;
			continue;
		}

		const taskMatch = rawLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
		if (taskMatch) {
			const indent = taskMatch[1] ?? '';
			const checked = (taskMatch[2] ?? '').toLowerCase() === 'x';
			const prefix = `${indent}${checked ? '☑ ' : '☐ '}`;
			const inline = parseInlineTelegram(taskMatch[3] ?? '');
			appendLine(`${prefix}${inline.text}`, inline.entities.map((entity) => ({
				...entity,
				offset: entity.offset + prefix.length,
			})));
			if (index < lines.length - 1) {
				output += '\n';
			}
			index += 1;
			continue;
		}

		const unorderedMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/);
		if (unorderedMatch) {
			const indent = unorderedMatch[1] ?? '';
			const prefix = indent ? `${indent}• ` : '• ';
			const inline = parseInlineTelegram(unorderedMatch[2] ?? '');
			appendLine(`${prefix}${inline.text}`, inline.entities.map((entity) => ({
				...entity,
				offset: entity.offset + prefix.length,
			})));
			if (index < lines.length - 1) {
				output += '\n';
			}
			index += 1;
			continue;
		}

		const orderedMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
		if (orderedMatch) {
			const indent = orderedMatch[1] ?? '';
			const prefix = `${indent}${orderedMatch[2]}. `;
			const inline = parseInlineTelegram(orderedMatch[3] ?? '');
			appendLine(`${prefix}${inline.text}`, inline.entities.map((entity) => ({
				...entity,
				offset: entity.offset + prefix.length,
			})));
			if (index < lines.length - 1) {
				output += '\n';
			}
			index += 1;
			continue;
		}

		const inline = parseInlineTelegram(rawLine);
		appendLine(inline.text, inline.entities);
		if (index < lines.length - 1) {
			output += '\n';
		}
		index += 1;
	}

	return {
		text: output,
		entities: sortTelegramEntities(entities.filter((entity) => entity.length > 0)),
	};
}

function sliceTelegramRichText(rich: TelegramRichText, start: number, end: number): TelegramRichText {
	const text = rich.text.slice(start, end);
	const entities = rich.entities
		.map((entity) => {
			const entityStart = entity.offset;
			const entityEnd = entity.offset + entity.length;
			if (entityEnd <= start || entityStart >= end) {
				return null;
			}
			const nextOffset = Math.max(entityStart, start) - start;
			const nextEnd = Math.min(entityEnd, end) - start;
			if (nextEnd <= nextOffset) {
				return null;
			}
			return {
				...entity,
				offset: nextOffset,
				length: nextEnd - nextOffset,
			};
		})
		.filter((entity): entity is TelegramMessageEntity => Boolean(entity));
	return {
		text,
		entities: sortTelegramEntities(entities),
	};
}

function findTelegramSplitPoint(text: string, start: number, maxLength: number): number {
	const target = Math.min(text.length, start + maxLength);
	if (target >= text.length) {
		return text.length;
	}
	const windowStart = Math.max(start + Math.floor(maxLength * 0.5), start + 1);
	for (let index = target; index > windowStart; index -= 1) {
		const char = text[index];
		if (char === '\n' || char === ' ' || char === '\t') {
			return adjustSplitEndExclusive(text, start, index);
		}
	}
	return adjustSplitEndExclusive(text, start, target);
}

/** Do not break between a UTF-16 high surrogate and its trailing low surrogate. */
function adjustSplitEndExclusive(text: string, start: number, end: number): number {
	let e = Math.min(Math.max(end, start), text.length);
	while (e > start) {
		const prev = text.charCodeAt(e - 1);
		if (prev >= 0xd800 && prev <= 0xdbff && e < text.length) {
			const next = text.charCodeAt(e);
			if (next >= 0xdc00 && next <= 0xdfff) {
				e -= 1;
				continue;
			}
		}
		break;
	}
	return e <= start ? Math.min(start + 1, text.length) : e;
}

export function splitTelegramRichText(rich: TelegramRichText, maxLength: number): TelegramRichText[] {
	const safeMaxLength = Math.max(1, Math.floor(maxLength));
	if (rich.text.length <= safeMaxLength) {
		return [rich];
	}
	const chunks: TelegramRichText[] = [];
	let start = 0;
	while (start < rich.text.length) {
		const end = findTelegramSplitPoint(rich.text, start, safeMaxLength);
		const chunk = sliceTelegramRichText(rich, start, end);
		if (chunk.text) {
			chunks.push(chunk);
		}
		start = end;
		while (start < rich.text.length && /\s/.test(rich.text[start] ?? '')) {
			start += 1;
		}
	}
	return chunks.length > 0 ? chunks : [{ text: '', entities: [] }];
}

function renderSlackMrkdwn(text: string): string {
	let out = stripAnsi(text);
	out = out.replace(/```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g, (_m, _lang, body) => '```\n' + body + '\n```');
	out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');
	out = out.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1_$2_');
	out = stripMarkdownHeadings(out);
	out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
	return out;
}

function renderDiscord(text: string): string {
	let out = stripAnsi(text);
	out = out.replace(/```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g, (_m, lang, body) => '```' + (lang || '') + '\n' + body + '\n```');
	return out;
}

function renderFeishuPlain(text: string): string {
	let out = stripAnsi(text);
	out = out.replace(/```[a-zA-Z0-9_+.-]*\n([\s\S]*?)```/g, '$1');
	out = out.replace(/`([^`\n]+?)`/g, '$1');
	out = stripMarkdownHeadings(out);
	out = stripMarkdownEmphasisKeepText(out);
	out = stripMarkdownLinks(out);
	return out;
}

export function renderForPlatform(text: string, platform: BotPlatform): string {
	const normalized = String(text ?? '').replace(/\r\n/g, '\n');
	switch (platform) {
		case 'telegram':
			return renderTelegramRichText(normalized).text;
		case 'slack':
			return renderSlackMrkdwn(normalized);
		case 'discord':
			return renderDiscord(normalized);
		case 'feishu':
			return renderFeishuPlain(normalized);
		default:
			return normalized;
	}
}
