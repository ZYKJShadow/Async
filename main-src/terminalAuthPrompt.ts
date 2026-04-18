export type TerminalSessionAuthPromptKind = 'password' | 'passphrase';

export function appendTerminalAuthPromptTail(previousTail: string, chunk: string): string {
	return (previousTail + chunk).slice(-512);
}

export function detectTerminalAuthPrompt(
	tail: string
): { prompt: string; kind: TerminalSessionAuthPromptKind } | null {
	const printableTail = sanitizeTerminalPromptTail(tail);
	const match = /([^\r\n]*?(password|passphrase)[^\r\n]*:\s*)$/i.exec(printableTail);
	if (!match) {
		return null;
	}
	const prompt = match[1]?.trim() ?? '';
	if (!prompt) {
		return null;
	}
	return {
		prompt,
		kind: /passphrase/i.test(prompt) ? 'passphrase' : 'password',
	};
}

export function sanitizeTerminalPromptTail(input: string): string {
	let text = input;
	text = stripOscSequences(text);
	text = stripAnsiSequences(text);
	text = applyBackspaces(text);
	text = text.replace(/\r/g, '\n');
	text = text.replace(/[^\S\n]+/g, ' ');
	text = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
	text = text.replace(/\n{2,}/g, '\n');
	return text.slice(-256);
}

function stripOscSequences(input: string): string {
	return input.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '');
}

function stripAnsiSequences(input: string): string {
	return input
		.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/\u001B[@-Z\\-_]/g, '');
}

function applyBackspaces(input: string): string {
	const out: string[] = [];
	for (const ch of input) {
		if (ch === '\b' || ch === '\u007f') {
			out.pop();
			continue;
		}
		out.push(ch);
	}
	return out.join('');
}
