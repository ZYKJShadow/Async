import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';

export type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team' | 'browser' | 'agents';

export type UseTeamSessionActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	currentId: string | null;
	layoutMode: ShellLayoutMode;
	setSelectedTask: (threadId: string, taskId: string) => void;
	markTeamPlanProposalDecided: (
		threadId: string,
		proposalId: string,
		approved: boolean
	) => void;
	setAgentRightSidebarView: Dispatch<SetStateAction<AgentRightSidebarView>>;
	setAgentRightSidebarOpen: Dispatch<SetStateAction<boolean>>;
};

export type UseTeamSessionActionsResult = {
	onSelectTeamTask: (taskId: string) => void;
	onTeamPlanApprove: (proposalId: string, feedback?: string) => void;
	onTeamPlanReject: (proposalId: string, feedback?: string) => void;
};

/**
 * Team 会话相关的右侧栏交互回调：选中任务 / 通过 / 拒绝 plan 提案。
 *
 * 行为与 App.tsx 完全一致：
 *  - 选中任务时把右侧栏切到 'team' view，agent 布局下顺带把侧栏打开；
 *  - 通过 / 拒绝调用同一个 `team:planApprovalRespond` IPC，并先本地标记已决议。
 */
export function useTeamSessionActions(
	params: UseTeamSessionActionsParams
): UseTeamSessionActionsResult {
	const {
		shell,
		currentId,
		layoutMode,
		setSelectedTask,
		markTeamPlanProposalDecided,
		setAgentRightSidebarView,
		setAgentRightSidebarOpen,
	} = params;

	const onSelectTeamTask = useCallback(
		(taskId: string) => {
			if (!currentId) {
				return;
			}
			setSelectedTask(currentId, taskId);
			setAgentRightSidebarView('team');
			if (layoutMode === 'agent') {
				setAgentRightSidebarOpen(true);
			}
		},
		[currentId, setSelectedTask, layoutMode, setAgentRightSidebarView, setAgentRightSidebarOpen]
	);

	const onTeamPlanApprove = useCallback(
		(proposalId: string, feedback?: string) => {
			if (!currentId || !shell) return;
			markTeamPlanProposalDecided(currentId, proposalId, true);
			void shell.invoke('team:planApprovalRespond', {
				proposalId,
				approved: true,
				feedbackText: feedback,
			});
		},
		[currentId, markTeamPlanProposalDecided, shell]
	);

	const onTeamPlanReject = useCallback(
		(proposalId: string, feedback?: string) => {
			if (!currentId || !shell) return;
			markTeamPlanProposalDecided(currentId, proposalId, false);
			void shell.invoke('team:planApprovalRespond', {
				proposalId,
				approved: false,
				feedbackText: feedback,
			});
		},
		[currentId, markTeamPlanProposalDecided, shell]
	);

	return { onSelectTeamTask, onTeamPlanApprove, onTeamPlanReject };
}
