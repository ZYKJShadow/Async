import { describe, it, expect } from 'vitest';
import {
	isCollabTool,
	parseCollabAction,
	executeCollabTool,
	COLLAB_TOOL_DEFS,
	COLLAB_TOOL_NAMES,
} from './collaborationTools';
import type { ToolCall } from '../agent/agentTools';

describe('collaborationTools', () => {
	describe('isCollabTool', () => {
		it('recognizes all collaboration tool names', () => {
			expect(isCollabTool('draft_plan')).toBe(true);
			expect(isCollabTool('delegate_task')).toBe(true);
			expect(isCollabTool('send_colleague_message')).toBe(true);
			expect(isCollabTool('submit_result')).toBe(true);
			expect(isCollabTool('report_blocker')).toBe(true);
		});

		it('rejects non-collab tool names', () => {
			expect(isCollabTool('Read')).toBe(false);
			expect(isCollabTool('Write')).toBe(false);
			expect(isCollabTool('Bash')).toBe(false);
			expect(isCollabTool('')).toBe(false);
		});
	});

	describe('COLLAB_TOOL_DEFS', () => {
		it('worker defs are a subset of tool names (CEO adds draft_plan)', () => {
			expect(COLLAB_TOOL_NAMES.size).toBe(COLLAB_TOOL_DEFS.length + 1);
			expect(COLLAB_TOOL_NAMES.has('draft_plan')).toBe(true);
			for (const def of COLLAB_TOOL_DEFS) {
				expect(COLLAB_TOOL_NAMES.has(def.name)).toBe(true);
				expect(def.description).toBeTruthy();
				expect(def.parameters.type).toBe('object');
				expect(def.parameters.required.length).toBeGreaterThan(0);
			}
		});
	});

	describe('parseCollabAction', () => {
		it('parses delegate_task', () => {
			const action = parseCollabAction('delegate_task', {
				target_employee_name: 'Li Ming',
				task_title: 'Fix login page',
				task_description: 'The login form has a validation bug',
				priority: 'high',
				context_files: 'src/Login.tsx, src/auth.ts',
				plan_item_id: 'plan-row-1',
			});
			expect(action).toEqual({
				tool: 'delegate_task',
				targetEmployeeName: 'Li Ming',
				taskTitle: 'Fix login page',
				taskDescription: 'The login form has a validation bug',
				priority: 'high',
				contextFiles: ['src/Login.tsx', 'src/auth.ts'],
				planItemId: 'plan-row-1',
			});
		});

		it('parses draft_plan', () => {
			const action = parseCollabAction('draft_plan', {
				items: [
					{ title: 'Explore repo', owner_employee_name: 'Li Ming' },
					{ title: 'Write summary' },
				],
			});
			expect(action).toEqual({
				tool: 'draft_plan',
				items: [{ title: 'Explore repo', ownerEmployeeName: 'Li Ming' }, { title: 'Write summary' }],
			});
		});

		it('defaults priority to medium', () => {
			const action = parseCollabAction('delegate_task', {
				target_employee_name: 'Li Ming',
				task_title: 'Fix bug',
				task_description: 'Details',
			});
			expect(action?.tool === 'delegate_task' && action.priority).toBe('medium');
		});

		it('parses send_colleague_message', () => {
			const action = parseCollabAction('send_colleague_message', {
				target_employee_name: 'Zhang Wei',
				message: 'Can you review this PR?',
			});
			expect(action).toEqual({
				tool: 'send_colleague_message',
				targetEmployeeName: 'Zhang Wei',
				message: 'Can you review this PR?',
			});
		});

		it('parses submit_result', () => {
			const action = parseCollabAction('submit_result', {
				summary: 'Login page fixed',
				modified_files: 'src/Login.tsx',
				next_steps: 'Needs code review',
			});
			expect(action).toEqual({
				tool: 'submit_result',
				summary: 'Login page fixed',
				modifiedFiles: ['src/Login.tsx'],
				nextSteps: 'Needs code review',
			});
		});

		it('parses report_blocker', () => {
			const action = parseCollabAction('report_blocker', {
				description: 'Cannot access the API endpoint',
				suggested_helper_name: 'Backend Dev',
			});
			expect(action).toEqual({
				tool: 'report_blocker',
				description: 'Cannot access the API endpoint',
				suggestedHelperName: 'Backend Dev',
			});
		});

		it('returns null for unknown tool', () => {
			expect(parseCollabAction('unknown_tool', {})).toBeNull();
		});
	});

	describe('executeCollabTool', () => {
		it('returns success for delegate_task', () => {
			const call: ToolCall = {
				id: 'tc-1',
				name: 'delegate_task',
				arguments: {
					target_employee_name: 'Li Ming',
					task_title: 'Fix login page',
					task_description: 'Bug in validation',
				},
			};
			const result = executeCollabTool(call);
			expect(result.isError).toBe(false);
			expect(result.content).toContain('Li Ming');
			expect(result.content).toContain('Fix login page');
		});

		it('returns success for submit_result', () => {
			const call: ToolCall = {
				id: 'tc-2',
				name: 'submit_result',
				arguments: { summary: 'Fixed the bug' },
			};
			const result = executeCollabTool(call);
			expect(result.isError).toBe(false);
			expect(result.content).toContain('Fixed the bug');
		});

		it('returns success for report_blocker', () => {
			const call: ToolCall = {
				id: 'tc-3',
				name: 'report_blocker',
				arguments: {
					description: 'API is down',
					suggested_helper_name: 'DevOps',
				},
			};
			const result = executeCollabTool(call);
			expect(result.isError).toBe(false);
			expect(result.content).toContain('API is down');
			expect(result.content).toContain('DevOps');
		});

		it('returns success for send_colleague_message', () => {
			const call: ToolCall = {
				id: 'tc-4',
				name: 'send_colleague_message',
				arguments: {
					target_employee_name: 'Zhang Wei',
					message: 'Please check this',
				},
			};
			const result = executeCollabTool(call);
			expect(result.isError).toBe(false);
			expect(result.content).toContain('Zhang Wei');
		});

		it('returns success for draft_plan', () => {
			const call: ToolCall = {
				id: 'tc-draft',
				name: 'draft_plan',
				arguments: {
					items: [{ title: 'Step one' }, { title: 'Step two', owner_employee_name: 'A' }],
				},
			};
			const result = executeCollabTool(call);
			expect(result.isError).toBe(false);
			expect(result.content).toContain('2 step');
		});

		it('returns error for unknown collab tool', () => {
			const call: ToolCall = {
				id: 'tc-5',
				name: 'unknown_collab',
				arguments: {},
			};
			const result = executeCollabTool(call);
			expect(result.isError).toBe(true);
		});
	});
});
