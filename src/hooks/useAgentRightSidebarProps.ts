import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { AgentRightSidebarProps } from '../AgentRightSidebar';

export type UseAgentRightSidebarPropsParams = Omit<
	AgentRightSidebarProps,
	'closeSidebar' | 'onOpenGitDiff' | 'openView'
> & {
	openAgentRightSidebarView: AgentRightSidebarProps['openView'];
	setAgentRightSidebarOpen: Dispatch<SetStateAction<boolean>>;
	onExplorerOpenFile: (
		rel: string,
		revealLine?: number,
		revealEndLine?: number,
		options?: { diff?: string | null; allowReviewActions?: boolean }
	) => void | Promise<void>;
};

export function useAgentRightSidebarProps(p: UseAgentRightSidebarPropsParams): AgentRightSidebarProps {
	const { onExplorerOpenFile, setAgentRightSidebarOpen, openAgentRightSidebarView, ...rest } = p;

	const closeSidebar = useCallback(() => {
		setAgentRightSidebarOpen(false);
	}, [setAgentRightSidebarOpen]);

	const onOpenGitDiff = useCallback(
		(rel: string, diff: string | null) => {
			void onExplorerOpenFile(rel, undefined, undefined, { diff, allowReviewActions: true });
		},
		[onExplorerOpenFile]
	);

	return useMemo(
		() => ({
			...rest,
			openView: openAgentRightSidebarView,
			closeSidebar,
			onOpenGitDiff,
		}),
		[
			closeSidebar,
			onOpenGitDiff,
			openAgentRightSidebarView,
			rest.open,
			rest.view,
			rest.hasAgentPlanSidebarContent,
			rest.planPreviewTitle,
			rest.planPreviewMarkdown,
			rest.planDocumentMarkdown,
			rest.planFileRelPath,
			rest.planFilePath,
			rest.agentPlanBuildModelId,
			rest.setAgentPlanBuildModelId,
			rest.awaitingReply,
			rest.agentPlanEffectivePlan,
			rest.onPlanBuild,
			rest.planReviewIsBuilt,
			rest.agentPlanTodoDoneCount,
			rest.agentPlanTodos,
			rest.onPlanAddTodo,
			rest.planTodoDraftOpen,
			rest.planTodoDraftInputRef,
			rest.planTodoDraftText,
			rest.setPlanTodoDraftText,
			rest.onPlanAddTodoSubmit,
			rest.onPlanAddTodoCancel,
			rest.onPlanTodoToggle,
			rest.agentFilePreview,
			rest.openFileInTab,
			rest.onAcceptAgentFilePreviewHunk,
			rest.onRevertAgentFilePreviewHunk,
			rest.agentFilePreviewBusyPatch,
			rest.commitMsg,
			rest.setCommitMsg,
			rest.onCommitOnly,
			rest.onCommitAndPush,
			rest.teamSession,
			rest.onSelectTeamExpert,
			rest.workspaceRoot,
			rest.onOpenTeamAgentFile,
			rest.revertedPaths,
			rest.revertedChangeKeys,
			rest.agentSession,
			rest.currentThreadId,
			rest.onSelectAgentSession,
			rest.onSendAgentInput,
			rest.onSubmitAgentUserInput,
			rest.onWaitAgent,
			rest.onResumeAgent,
			rest.onCloseAgent,
			rest.onOpenAgentTranscript,
		]
	);
}
