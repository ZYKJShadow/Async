import { describe, expect, it } from 'vitest';
import { buildEmployeeActivityStatusMap } from './employeeActivityStatus';
import type { OrgEmployee } from '../api/orgTypes';
import type { AiEmployeesOrchestrationState } from '../../../shared/aiEmployeesSettings';

const emp = (id: string): OrgEmployee => ({
	id,
	displayName: id,
	roleKey: 'custom',
	isCeo: false,
	capabilities: {},
	status: 'active',
	sortOrder: 0,
	modelSource: 'local_model',
});

describe('buildEmployeeActivityStatusMap', () => {
	it('ignores completed runs (idle)', () => {
		const state: AiEmployeesOrchestrationState = {
			runs: [
				{
					id: 'r1',
					goal: 'g',
					status: 'completed',
					createdAtIso: 't0',
					handoffs: [],
					currentAssigneeEmployeeId: 'e1',
				},
			],
			timelineEvents: [],
			collabMessages: [],
		};
		const map = buildEmployeeActivityStatusMap([emp('e1')], state);
		expect(map.get('e1')?.status).toBe('idle');
	});

	it('marks running assignee as working', () => {
		const state: AiEmployeesOrchestrationState = {
			runs: [
				{
					id: 'r1',
					goal: 'do thing',
					status: 'running',
					createdAtIso: 't0',
					lastEventAtIso: 't1',
					handoffs: [
						{ id: 'h1', toEmployeeId: 'e1', status: 'in_progress', atIso: 't1' },
					],
					currentAssigneeEmployeeId: 'e1',
				},
			],
			timelineEvents: [],
			collabMessages: [],
		};
		const map = buildEmployeeActivityStatusMap([emp('e1')], state);
		expect(map.get('e1')?.status).toBe('working');
		expect(map.get('e1')?.runGoal).toBe('do thing');
	});

	it('draft run shows idle (not yet in running execution phase)', () => {
		const state: AiEmployeesOrchestrationState = {
			runs: [
				{
					id: 'r1',
					goal: 'g',
					status: 'draft',
					createdAtIso: 't0',
					handoffs: [],
					currentAssigneeEmployeeId: 'e1',
				},
			],
			timelineEvents: [],
			collabMessages: [],
		};
		const map = buildEmployeeActivityStatusMap([emp('e1')], state);
		expect(map.get('e1')?.status).toBe('idle');
	});

	it('awaiting_approval shows waiting', () => {
		const state: AiEmployeesOrchestrationState = {
			runs: [
				{
					id: 'r1',
					goal: 'g',
					status: 'awaiting_approval',
					createdAtIso: 't0',
					handoffs: [{ id: 'h1', toEmployeeId: 'e1', status: 'done', atIso: 't1' }],
					currentAssigneeEmployeeId: 'e1',
				},
			],
			timelineEvents: [],
			collabMessages: [],
		};
		const map = buildEmployeeActivityStatusMap([emp('e1')], state);
		expect(map.get('e1')?.status).toBe('waiting');
	});

	it('blocked handoff wins over running', () => {
		const state: AiEmployeesOrchestrationState = {
			runs: [
				{
					id: 'r1',
					goal: 'g',
					status: 'running',
					createdAtIso: 't0',
					handoffs: [{ id: 'h1', toEmployeeId: 'e1', status: 'blocked', atIso: 't1', blockedReason: 'x' }],
					currentAssigneeEmployeeId: 'e1',
				},
			],
			timelineEvents: [],
			collabMessages: [],
		};
		const map = buildEmployeeActivityStatusMap([emp('e1')], state);
		expect(map.get('e1')?.status).toBe('blocked');
	});
});
