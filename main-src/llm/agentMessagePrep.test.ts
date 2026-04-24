import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '../agentSettingsTypes.js';
import {
	applySlashCommands,
	buildThreadTitleRuleAppend,
	prepareUserTurnForChat,
} from './agentMessagePrep.js';

describe('agentMessagePrep slash commands', () => {
	it('expands template commands into user text', () => {
		const commands: AgentCommand[] = [
			{
				id: 'user-plan',
				name: 'Plan',
				slash: 'plan',
				body: 'Outline the plan: {{args}}',
			},
		];
		expect(applySlashCommands('/plan fix auth', commands)).toEqual({
			userText: 'Outline the plan: fix auth',
			slashSystemBlock: '',
		});
	});

	it('treats plugin commands as prompt injections instead of plain text replacement', () => {
		const commands: AgentCommand[] = [
			{
				id: 'plugin-command:demo:build-fix',
				name: 'Build Fix',
				slash: 'build-fix',
				body: '# Build Fix\n\nUse $ARGUMENTS',
				invocation: 'prompt',
				pluginSourceName: 'Demo Plugin',
			},
		];
		const applied = applySlashCommands('/build-fix src/App.tsx', commands);
		expect(applied.userText).toBe('src/App.tsx');
		expect(applied.slashSystemBlock).toContain('Slash command: /build-fix');
		expect(applied.slashSystemBlock).toContain('Use src/App.tsx');

		const prepared = prepareUserTurnForChat('/build-fix src/App.tsx', { commands }, null, [], 'en');
		expect(prepared.userText).toBe('src/App.tsx');
		expect(prepared.agentSystemAppend).toContain('Slash command: /build-fix');
		expect(prepared.agentSystemAppend).toContain('Use src/App.tsx');
	});
});

describe('buildThreadTitleRuleAppend', () => {
	it('includes always rules and auto language guidance', () => {
		const block = buildThreadTitleRuleAppend({
			agent: {
				rules: [
					{
						id: 'r1',
						name: 'Use Chinese',
						content: '所有回答默认使用中文。',
						scope: 'always',
						enabled: true,
					},
				],
			},
			workspaceRoot: null,
			uiLanguage: 'zh-CN',
		});

		expect(block).toContain('Rule: Use Chinese');
		expect(block).toContain('所有回答默认使用中文。');
		expect(block).toContain('默认始终使用简体中文进行所有自然语言输出');
	});

	it('includes imported workspace rule files', () => {
		const root = mkdtempSync(join(tmpdir(), 'async-title-rules-'));
		mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
		writeFileSync(join(root, '.cursor', 'rules', 'language.mdc'), '请默认使用日语回答。', 'utf8');

		const block = buildThreadTitleRuleAppend({
			agent: undefined,
			workspaceRoot: root,
			uiLanguage: 'zh-CN',
		});

		expect(block).toContain('Imported project rules');
		expect(block).toContain('请默认使用日语回答。');
	});
});
