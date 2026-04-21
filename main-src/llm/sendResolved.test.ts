import { mkdtempSync, writeFileSync } from 'node:fs';
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
		const textSegs = resolved!.segments;
		expect(textSegs).toEqual([{ kind: 'text', text: './my-skill ' }, { kind: 'text', text: 'hello' }]);
	});

	it('resolveMessagesForSend：skill 后接 file_ref 时保留路径引用且不内联文件内容', async () => {
		const root = mkdtempSync(join(tmpdir(), 'void-sendresolved-'));
		writeFileSync(join(root, 'example.ts'), 'export const answer = 42;\n');
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: '',
				parts: [
					{ kind: 'skill_invoke', slug: 's', name: 'S' },
					{ kind: 'file_ref', relPath: 'example.ts' },
				],
			},
		];
		const out = await resolveMessagesForSend(messages, root);
		expect(out[0]!.resolved!.flatText).toBe('./s @example.ts');
		expect(out[0]!.resolved!.flatText).not.toContain('answer = 42');
	});

	it('resolveMessagesForSend：legacy @path 文本保持原样，不自动展开源码正文', async () => {
		const root = mkdtempSync(join(tmpdir(), 'void-sendresolved-'));
		writeFileSync(join(root, 'src-file.ts'), 'console.log("expanded");\n');
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: '@src-file.ts 帮我看看这里',
			},
		];
		const out = await resolveMessagesForSend(messages, root);
		expect(out[0]!.resolved!.flatText).toBe('@src-file.ts 帮我看看这里');
		expect(out[0]!.resolved!.flatText).not.toContain('console.log("expanded")');
	});
});
