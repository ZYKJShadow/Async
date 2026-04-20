import { describe, expect, it } from 'vitest';
import { chatMessagesListEqual, type ChatMessage } from './threadTypes';

describe('chatMessagesListEqual skill_invoke', () => {
	it('相同 skill_invoke parts 视为相等', () => {
		const a: ChatMessage[] = [
			{
				role: 'user',
				content: './x y',
				parts: [
					{ kind: 'skill_invoke', slug: 'x', name: 'X' },
					{ kind: 'text', text: 'y' },
				],
			},
		];
		const b: ChatMessage[] = [
			{
				role: 'user',
				content: './x y',
				parts: [
					{ kind: 'skill_invoke', slug: 'x', name: 'X' },
					{ kind: 'text', text: 'y' },
				],
			},
		];
		expect(chatMessagesListEqual(a, b)).toBe(true);
	});

	it('skill slug 或 name 不同则不相等', () => {
		const base: ChatMessage = {
			role: 'user',
			content: '',
			parts: [{ kind: 'skill_invoke', slug: 'a', name: 'A' }],
		};
		expect(
			chatMessagesListEqual([base], [{ ...base, parts: [{ kind: 'skill_invoke', slug: 'b', name: 'A' }] }])
		).toBe(false);
		expect(
			chatMessagesListEqual([base], [{ ...base, parts: [{ kind: 'skill_invoke', slug: 'a', name: 'B' }] }])
		).toBe(false);
	});
});
