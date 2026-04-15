import type { BotPlatform } from '../../botSettingsTypes.js';

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

function escapeTelegramMarkdownV2(text: string): string {
	return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (ch) => `\\${ch}`);
}

function renderTelegram(text: string): string {
	const clean = stripAnsi(text);
	const parts: string[] = [];
	let cursor = 0;
	const fence = /```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;
	while ((match = fence.exec(clean)) !== null) {
		if (match.index > cursor) {
			parts.push(renderTelegramProse(clean.slice(cursor, match.index)));
		}
		const body = escapeTelegramMarkdownV2(match[2].replace(/```/g, ''));
		parts.push('```\n' + body + '\n```');
		cursor = fence.lastIndex;
	}
	if (cursor < clean.length) {
		parts.push(renderTelegramProse(clean.slice(cursor)));
	}
	return parts.join('');
}

function renderTelegramProse(text: string): string {
	const inlineBold: Array<{ start: number; end: number; content: string }> = [];
	text.replace(/\*\*([^*\n]+?)\*\*/g, (full, content, offset) => {
		inlineBold.push({ start: offset, end: offset + full.length, content });
		return full;
	});
	const inlineCode: Array<{ start: number; end: number; content: string }> = [];
	text.replace(/`([^`\n]+?)`/g, (full, content, offset) => {
		inlineCode.push({ start: offset, end: offset + full.length, content });
		return full;
	});
	const marks: Array<{ start: number; end: number; open: string; close: string; content: string }> = [
		...inlineCode.map((entry) => ({
			...entry,
			open: '`',
			close: '`',
			content: entry.content,
		})),
		...inlineBold.map((entry) => ({
			...entry,
			open: '*',
			close: '*',
			content: entry.content,
		})),
	].sort((a, b) => a.start - b.start);
	const filtered: typeof marks = [];
	for (const mark of marks) {
		if (filtered.length === 0 || filtered[filtered.length - 1].end <= mark.start) {
			filtered.push(mark);
		}
	}
	let out = '';
	let pos = 0;
	for (const mark of filtered) {
		if (mark.start > pos) {
			out += escapeTelegramMarkdownV2(text.slice(pos, mark.start));
		}
		const inner =
			mark.open === '`'
				? mark.content.replace(/[`\\]/g, (ch) => `\\${ch}`)
				: escapeTelegramMarkdownV2(mark.content);
		out += `${mark.open}${inner}${mark.close}`;
		pos = mark.end;
	}
	if (pos < text.length) {
		out += escapeTelegramMarkdownV2(text.slice(pos));
	}
	return out;
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
			return renderTelegram(normalized);
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
