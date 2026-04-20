import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../threadStore.js';
import { resolveMessagesForSend } from './sendResolved.js';

describe('sendResolved skill_invoke', () => {
	it('resolveMessagesForSend：skill_invoke 解析为 flatText 中的 ./slug wire，并在紧贴正文前补空格', async () => {
		const root = mkdtempSync(join(tmpdir(), 'void-sendresolved-'));
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: '',
				parts: [
					{ kind: 'skill_invoke', slug: 'my-skill', name: 'My Skill' },
					{ kind: 'text', text: 'hello' },
				],
			},
		];
		const out = await resolveMessagesForSend(messages, root);
		const resolved = out[0]!.resolved;
		expect(resolved).toBeDefined();
		expect(resolved!.flatText).toBe('./my-skill hello');
		const textSegs = resolved!.segments.filter((s) => s.kind === 'text');
		expect(textSegs).toEqual([{ kind: 'text', text: './my-skill ' }, { kind: 'text', text: 'hello' }]);
	});

	it('resolveMessagesForSend：skill 后接 file_ref 时 wire 与路径之间有空格', async () => {
		const root = mkdtempSync(join(tmpdir(), 'void-sendresolved-'));
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: '',
				parts: [
					{ kind: 'skill_invoke', slug: 's', name: 'S' },
					{ kind: 'file_ref', relPath: 'missing-on-purpose.ts' },
				],
			},
		];
		const out = await resolveMessagesForSend(messages, root);
		expect(out[0]!.resolved!.flatText).toMatch(/^\.\/s /);
		expect(out[0]!.resolved!.flatText).toContain('missing-on-purpose.ts');
	});
});
