import { describe, expect, it } from 'vitest';
import { appendTerminalAuthPromptTail, detectTerminalAuthPrompt, sanitizeTerminalPromptTail } from './terminalAuthPrompt.js';

describe('terminalAuthPrompt', () => {
	it('detects password prompts after stripping terminal control sequences', () => {
		const tail = appendTerminalAuthPromptTail('', '\u001b]0;ssh\u0007user@example.com Password: ');
		expect(detectTerminalAuthPrompt(tail)).toEqual({
			prompt: 'user@example.com Password:',
			kind: 'password',
		});
	});

	it('does not detect a prompt after the auth tail has been cleared', () => {
		const staleTail = appendTerminalAuthPromptTail('Password: ', '\u001b]0;ssh\u0007');
		expect(detectTerminalAuthPrompt(staleTail)?.prompt).toBe('Password:');

		const clearedTail = appendTerminalAuthPromptTail('', '\u001b]0;ssh\u0007');
		expect(detectTerminalAuthPrompt(clearedTail)).toBeNull();
	});

	it('keeps normal shell output from looking like a password prompt', () => {
		const clean = sanitizeTerminalPromptTail('Last login: today\r\nuser@host % ');
		expect(detectTerminalAuthPrompt(clean)).toBeNull();
	});
});
