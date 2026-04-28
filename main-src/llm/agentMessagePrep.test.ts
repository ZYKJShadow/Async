import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
			readableRoots: [],
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

	it('substitutes Claude plugin variables in prompt slash commands', () => {
		const commandDir = join(mkdtempSync(join(tmpdir(), 'async-command-root-')), 'commands');
		const pluginRoot = resolve(commandDir, '..');
		const commands: AgentCommand[] = [
			{
				id: 'plugin-command:demo:build-fix',
				name: 'Build Fix',
				slash: 'build-fix',
				body: 'Use ${CLAUDE_SKILL_DIR}/template.md and ${CLAUDE_PLUGIN_ROOT}/shared/schema.json for $ARGUMENTS',
				invocation: 'prompt',
				commandBaseDirAbs: commandDir,
				pluginRootAbs: pluginRoot,
				pluginSourceName: 'Demo Plugin',
			},
		];

		const applied = applySlashCommands('/build-fix src/App.tsx', commands);
		const promptCommandDir = resolve(commandDir).replace(/\\/g, '/');
		const promptPluginRoot = resolve(pluginRoot).replace(/\\/g, '/');

		expect(applied.userText).toBe('src/App.tsx');
		expect(applied.slashSystemBlock).toContain(`${promptCommandDir}/template.md`);
		expect(applied.slashSystemBlock).toContain(`${promptPluginRoot}/shared/schema.json`);
		expect(applied.readableRoots).toEqual([resolve(commandDir), resolve(pluginRoot)]);
	});

	it('injects skill base directories and substitutes Claude skill/plugin variables', () => {
		const skillRoot = join(mkdtempSync(join(tmpdir(), 'async-skill-root-')), 'skills', 'demo');
		const pluginRoot = resolve(skillRoot, '..', '..');
		const prepared = prepareUserTurnForChat(
			'./demo inspect refs',
			{
				skills: [
					{
						id: 'plugin-skill:demo',
						name: 'Demo Skill',
						description: 'Demo references',
						slug: 'demo',
						content: 'Read ${CLAUDE_SKILL_DIR}/templates/a.md and ${CLAUDE_PLUGIN_ROOT}/shared/b.md',
						enabled: true,
						skillBaseDirAbs: skillRoot,
						pluginRootAbs: pluginRoot,
						pluginSourceName: 'Demo Plugin',
						pluginSourceRelPath: 'skills/demo/SKILL.md',
						pluginSourceKind: 'skill',
					},
				],
			},
			null,
			[],
			'en'
		);
		const promptSkillRoot = resolve(skillRoot).replace(/\\/g, '/');
		const promptPluginRoot = resolve(pluginRoot).replace(/\\/g, '/');

		expect(prepared.userText).toBe('inspect refs');
		expect(prepared.agentSystemAppend).toContain(`Base directory for this skill: ${promptSkillRoot}`);
		expect(prepared.agentSystemAppend).toContain(`Plugin root directory (\${CLAUDE_PLUGIN_ROOT}): ${promptPluginRoot}`);
		expect(prepared.agentSystemAppend).toContain(`${promptSkillRoot}/templates/a.md`);
		expect(prepared.agentSystemAppend).toContain(`${promptPluginRoot}/shared/b.md`);
		expect(prepared.readableRoots).toEqual([resolve(skillRoot), resolve(pluginRoot)]);
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
