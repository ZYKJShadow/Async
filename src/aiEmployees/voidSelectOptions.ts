import type { TFunction } from '../i18n';
import type { VoidSelectOption } from '../VoidSelect';
import type { AgentJson, IssueJson, WorkspaceMemberJson } from './api/types';

/** 与 IssueStatusChip / 看板列文案一致 */
export function issueStatusVoidOptions(t: TFunction, statuses: readonly string[]): VoidSelectOption[] {
	return statuses.map((s) => {
		const key = `aiEmployees.boardColumn.${s}` as const;
		const tr = t(key);
		return { value: s, label: tr === key ? s.replace(/_/g, ' ') : tr };
	});
}

export function priorityFieldVoidOptions(t: TFunction): VoidSelectOption[] {
	const order = ['none', 'low', 'medium', 'high', 'urgent'] as const;
	const keys: Record<(typeof order)[number], `aiEmployees.issuesHub.${string}`> = {
		none: 'aiEmployees.issuesHub.priorityNone',
		low: 'aiEmployees.issuesHub.priorityLow',
		medium: 'aiEmployees.issuesHub.priorityMedium',
		high: 'aiEmployees.issuesHub.priorityHigh',
		urgent: 'aiEmployees.issuesHub.priorityUrgent',
	};
	return order.map((p) => ({ value: p, label: t(keys[p]) }));
}

export function assigneeVoidOptions(t: TFunction, members: WorkspaceMemberJson[], agents: AgentJson[]): VoidSelectOption[] {
	const out: VoidSelectOption[] = [{ value: '', label: t('aiEmployees.issueDetail.assigneeNone') }];
	if (members.length > 0) {
		out.push({ value: '__hdr_members', label: t('aiEmployees.issueDetail.assigneeMembers'), disabled: true });
		for (const m of members) {
			out.push({ value: `member:${m.user_id}`, label: m.name ?? m.user_id });
		}
	}
	if (agents.length > 0) {
		out.push({ value: '__hdr_agents', label: t('aiEmployees.issueDetail.assigneeAgents'), disabled: true });
		for (const a of agents) {
			out.push({ value: `agent:${a.id}`, label: a.name ?? a.id.slice(0, 8) });
		}
	}
	return out;
}

export function managerPickVoidOptions(
	t: TFunction,
	org: { id: string; displayName: string }[],
	excludeEmployeeId?: string,
): VoidSelectOption[] {
	const rows = excludeEmployeeId ? org.filter((e) => e.id !== excludeEmployeeId) : org;
	return [{ value: '', label: t('aiEmployees.managerNone') }, ...rows.map((e) => ({ value: e.id, label: e.displayName }))];
}

export function workspacePickVoidOptions(t: TFunction, workspaces: { id: string; name?: string | null }[]): VoidSelectOption[] {
	return [
		{ value: '', label: t('aiEmployees.pickWorkspace') },
		...workspaces.map((w) => ({ value: w.id, label: w.name ?? w.id.slice(0, 8) })),
	];
}

export function parentIssueVoidOptions(t: TFunction, rootIssues: IssueJson[]): VoidSelectOption[] {
	return [
		{ value: '', label: t('aiEmployees.issueDetail.assigneeNone') },
		...rootIssues.map((i) => ({
			value: i.id,
			label: `${i.identifier ? `${i.identifier} · ` : ''}${i.title}`,
		})),
	];
}

const HANDOFF_STATUSES = ['pending', 'in_progress', 'blocked', 'done'] as const;

export function handoffStatusVoidOptions(t: TFunction): VoidSelectOption[] {
	return HANDOFF_STATUSES.map((s) => ({ value: s, label: t(`aiEmployees.handoffStatus.${s}`) }));
}

/** 列表批量操作：首项为占位（禁用），含清除指派 */
export function batchAssigneeVoidOptions(t: TFunction, members: WorkspaceMemberJson[], agents: AgentJson[]): VoidSelectOption[] {
	return [
		{ value: '__ph', label: t('aiEmployees.issuesHub.batchChangeAssignee'), disabled: true },
		{ value: '__clear', label: t('aiEmployees.issueDetail.assigneeNone') },
		...members.map((m) => ({ value: `member:${m.user_id}`, label: m.name ?? m.user_id })),
		...agents.map((a) => ({ value: `agent:${a.id}`, label: a.name ?? a.id.slice(0, 8) })),
	];
}
