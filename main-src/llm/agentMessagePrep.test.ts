import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '../agentSettingsTypes.js';
import { applySlashCommands, prepareUserTurnForChat } from './agentMessagePrep.js';

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
