import type {
	TeamRoleType,
	TeamRoleWorkflowState,
	TeamSessionState,
	TeamTaskStatus,
} from './hooks/useTeamSession';

export type TeamWorkflowListItem = {
	id: string;
	expertId: string;
	expertName: string;
	roleType: TeamRoleType;
	description: string;
	status: TeamTaskStatus;
	result?: string;
	logs: string[];
	roleKind: 'specialist' | 'reviewer';
	workflow: TeamRoleWorkflowState | null;
};

export function buildTeamWorkflowItems(session: TeamSessionState | null): TeamWorkflowListItem[] {
	if (!session) {
		return [];
	}
	const specialistItems: TeamWorkflowListItem[] = session.tasks.map((task) => ({
		id: task.id,
		expertId: task.expertId,
		expertName: task.expertName,
		roleType: task.roleType,
		description: task.description,
		status: task.status,
		result: task.result,
		logs: task.logs,
		roleKind: 'specialist',
		workflow: session.roleWorkflowByTaskId[task.id] ?? null,
	}));
	const reviewerWorkflow =
		session.reviewerTaskId != null ? session.roleWorkflowByTaskId[session.reviewerTaskId] ?? null : null;
	if (!reviewerWorkflow && !session.reviewSummary.trim()) {
		return specialistItems;
	}
	const reviewerItem: TeamWorkflowListItem = {
		id: session.reviewerTaskId ?? 'team-reviewer',
		expertId: reviewerWorkflow?.expertId ?? 'reviewer',
		expertName: reviewerWorkflow?.expertName ?? 'Reviewer',
		roleType: reviewerWorkflow?.roleType ?? 'reviewer',
		description: 'Review specialist results and decide whether the delivery is ready.',
		status: session.reviewVerdict
			? session.reviewVerdict === 'approved'
				? 'completed'
				: 'revision'
			: session.phase === 'reviewing'
				? 'in_progress'
				: reviewerWorkflow
					? reviewerWorkflow.awaitingReply
						? 'in_progress'
						: 'pending'
					: 'pending',
		result: session.reviewSummary || undefined,
		logs: session.reviewSummary ? [session.reviewSummary] : [],
		roleKind: 'reviewer',
		workflow: reviewerWorkflow,
	};
	return [...specialistItems, reviewerItem];
}

export function getTeamWorkflowItemById(
	session: TeamSessionState | null,
	taskId: string | null | undefined
): TeamWorkflowListItem | null {
	if (!session || !taskId) {
		return null;
	}
	return buildTeamWorkflowItems(session).find((item) => item.id === taskId) ?? null;
}
