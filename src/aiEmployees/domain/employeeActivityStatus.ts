import type { OrgEmployee } from '../api/orgTypes';
import type { AiEmployeesOrchestrationState, AiOrchestrationRun } from '../../../shared/aiEmployeesSettings';

export type EmployeeActivityStatus = 'idle' | 'working' | 'blocked' | 'waiting';

export type EmployeeActivity = { status: EmployeeActivityStatus; runGoal?: string };

/** 任务（运行）是否尚未整体结束：已结束或已取消的不参与状态推导。 */
export function isOrchestrationRunIncomplete(run: AiOrchestrationRun): boolean {
	return run.status !== 'completed' && run.status !== 'cancelled';
}

/** 成员是否仍与该运行有关联（当前负责人，或尚有未完成的交接指向该成员）。 */
export function employeeHasActiveRunInvolvement(employeeId: string, run: AiOrchestrationRun): boolean {
	return (
		run.currentAssigneeEmployeeId === employeeId ||
		run.handoffs.some((h) => h.toEmployeeId === employeeId && h.status !== 'done')
	);
}

/** 根据编排中的运行与交接，推导每名成员当前活动状态（与通讯录 / 团队展示一致）。 */
export function buildEmployeeActivityStatusMap(
	sortedEmployees: readonly OrgEmployee[],
	orchestration: AiEmployeesOrchestrationState | undefined | null,
): Map<string, EmployeeActivity> {
	const map = new Map<string, EmployeeActivity>();
	if (!orchestration) {
		for (const emp of sortedEmployees) {
			map.set(emp.id, { status: 'idle' });
		}
		return map;
	}
	const openRuns = orchestration.runs.filter(isOrchestrationRunIncomplete);
	for (const emp of sortedEmployees) {
		const activeRun = openRuns
			.filter((r) => employeeHasActiveRunInvolvement(emp.id, r))
			.sort((a, b) => Date.parse(b.lastEventAtIso ?? b.createdAtIso) - Date.parse(a.lastEventAtIso ?? a.createdAtIso))[0];
		if (!activeRun) {
			map.set(emp.id, { status: 'idle' });
			continue;
		}
		const handoff = activeRun.handoffs.find((h) => h.toEmployeeId === emp.id && h.status !== 'done');
		if (handoff?.status === 'blocked') {
			map.set(emp.id, { status: 'blocked', runGoal: activeRun.goal });
		} else if (activeRun.status === 'awaiting_approval') {
			map.set(emp.id, { status: 'waiting', runGoal: activeRun.goal });
		} else if (activeRun.status === 'running') {
			map.set(emp.id, { status: 'working', runGoal: activeRun.goal });
		} else {
			map.set(emp.id, { status: 'idle' });
		}
	}
	return map;
}
