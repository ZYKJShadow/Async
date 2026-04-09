import { describe, expect, it } from 'vitest';
import { resolveToolPermissionFromRules } from './toolPermissionModel.js';
import type { AgentCustomization } from '../agentSettingsTypes.js';

describe('resolveToolPermissionFromRules', () => {
	it('deny wins over allow', () => {
		const agent: AgentCustomization = {
			toolPermissionRules: [
				{ behavior: 'allow', toolName: 'Bash', ruleContent: 'git status' },
				{ behavior: 'deny', toolName: 'Bash', ruleContent: 'git status' },
			],
		};
		expect(
			resolveToolPermissionFromRules(
				{ id: '1', name: 'Bash', arguments: { command: 'git status' } },
				agent
			)
		).toBe('deny');
	});

	it('allow bypasses delegate path', () => {
		const agent: AgentCustomization = {
			toolPermissionRules: [{ behavior: 'allow', toolName: 'Bash', ruleContent: 'echo *' }],
		};
		expect(
			resolveToolPermissionFromRules(
				{ id: '1', name: 'Bash', arguments: { command: 'echo hi' } },
				agent
			)
		).toBe('allow');
	});

	it('ask becomes deny when shouldAvoidPermissionPrompts', () => {
		const agent: AgentCustomization = {
			shouldAvoidPermissionPrompts: true,
			toolPermissionRules: [{ behavior: 'ask', toolName: 'Write' }],
		};
		expect(
			resolveToolPermissionFromRules(
				{ id: '1', name: 'Write', arguments: { file_path: 'a.ts' } },
				agent
			)
		).toBe('deny');
	});

	it('matches MCP-style tool names with wildcard', () => {
		const agent: AgentCustomization = {
			toolPermissionRules: [{ behavior: 'deny', toolName: 'mcp__srv__*' }],
		};
		expect(
			resolveToolPermissionFromRules(
				{ id: '1', name: 'mcp__srv__danger', arguments: {} },
				agent
			)
		).toBe('deny');
	});
});
