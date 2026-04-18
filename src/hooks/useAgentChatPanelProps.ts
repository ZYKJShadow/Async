import { useCallback, useMemo, useRef } from 'react';
import type { AgentChatPanelProps } from '../AgentChatPanel';

type OpenAgentConversationFile = AgentChatPanelProps['onOpenAgentConversationFile'];

export type UseAgentChatPanelPropsParams = Omit<
	AgentChatPanelProps,
	'layout' | 'onOpenWorkspaceFile' | 'onRunCommand' | 'onOpenAgentConversationFile'
> & {
	shell: Window['asyncShell'] | undefined;
	onExplorerOpenFile: (rel: string) => void | Promise<void>;
	onAgentConversationOpenFile: AgentChatPanelProps['onOpenAgentConversationFile'];
};

export function useAgentChatPanelProps({
	shell,
	onExplorerOpenFile,
	onAgentConversationOpenFile,
	...rest
}: UseAgentChatPanelPropsParams): Omit<AgentChatPanelProps, 'layout'> {
	const onExplorerOpenFileRef = useRef(onExplorerOpenFile);
	onExplorerOpenFileRef.current = onExplorerOpenFile;
	const onAgentConversationOpenFileRef = useRef(onAgentConversationOpenFile);
	onAgentConversationOpenFileRef.current = onAgentConversationOpenFile;
	const shellRef = useRef(shell);
	shellRef.current = shell;

	const onOpenWorkspaceFile = useCallback((rel: string) => {
		void onExplorerOpenFileRef.current(rel);
	}, []);

	const onRunCommand = useCallback((cmd: string) => {
		shellRef.current?.invoke('terminal:execLine', cmd).catch(console.error);
	}, []);

	const stableOnOpenAgentConversationFile = useCallback(
		async (...args: Parameters<OpenAgentConversationFile>) => {
			await onAgentConversationOpenFileRef.current(...args);
		},
		[]
	);

	// Group 1: Message/Thread state (changes on thread switch or new messages)
	// streaming / streamingThinking / streamingToolPreview / liveAssistantBlocks 均已迁至
	// streamingStore，AgentChatPanel 内部订阅并合成 displayMessages，不再从 props 走，
	// 避免每个 token / tool 事件触发 App 级重渲染。
	const messageGroup = useMemo(() => ({
		persistedMessages: rest.persistedMessages,
		messagesThreadId: rest.messagesThreadId,
		currentId: rest.currentId,
		hasConversation: rest.hasConversation,
		awaitingReply: rest.awaitingReply,
		lastTurnUsage: rest.lastTurnUsage,
		fileChangesDismissed: rest.fileChangesDismissed,
		agentPlanSummaryCard: rest.agentPlanSummaryCard,
		showScrollToBottomButton: rest.showScrollToBottomButton,
		scrollMessagesToBottom: rest.scrollMessagesToBottom,
	}), [
		rest.persistedMessages, rest.messagesThreadId,
		rest.currentId,
		rest.hasConversation, rest.awaitingReply,
		rest.lastTurnUsage, rest.fileChangesDismissed,
		rest.agentPlanSummaryCard, rest.showScrollToBottomButton, rest.scrollMessagesToBottom,
	]);

	// Group 2: Composer state (changes on user input)
	const composerGroup = useMemo(() => ({
		composerMode: rest.composerMode,
		composerSegments: rest.composerSegments,
		setComposerSegments: rest.setComposerSegments,
		canSendComposer: rest.canSendComposer,
		canSendInlineResend: rest.canSendInlineResend,
		sharedComposerProps: rest.sharedComposerProps,
		resendFromUserIndex: rest.resendFromUserIndex,
		inlineResendSegments: rest.inlineResendSegments,
		setInlineResendSegments: rest.setInlineResendSegments,
		onStartInlineResend: rest.onStartInlineResend,
		inlineResendRootRef: rest.inlineResendRootRef,
	}), [
		rest.composerMode, rest.composerSegments, rest.setComposerSegments,
		rest.canSendComposer, rest.canSendInlineResend, rest.sharedComposerProps,
		rest.resendFromUserIndex, rest.inlineResendSegments, rest.setInlineResendSegments,
		rest.onStartInlineResend, rest.inlineResendRootRef,
	]);

	// Group 3: Agent action/review state (changes on agent actions)
	const actionGroup = useMemo(() => ({
		pendingAgentPatches: rest.pendingAgentPatches,
		agentReviewBusy: rest.agentReviewBusy,
		onApplyAgentPatchOne: rest.onApplyAgentPatchOne,
		onApplyAgentPatchesAll: rest.onApplyAgentPatchesAll,
		onDiscardAgentReview: rest.onDiscardAgentReview,
		planQuestion: rest.planQuestion,
		onPlanQuestionSubmit: rest.onPlanQuestionSubmit,
		onPlanQuestionSkip: rest.onPlanQuestionSkip,
		userInputRequest: rest.userInputRequest,
		onUserInputSubmit: rest.onUserInputSubmit,
		wizardPending: rest.wizardPending,
		setWizardPending: rest.setWizardPending,
		executeSkillCreatorSend: rest.executeSkillCreatorSend,
		executeRuleWizardSend: rest.executeRuleWizardSend,
		executeSubagentWizardSend: rest.executeSubagentWizardSend,
		mistakeLimitRequest: rest.mistakeLimitRequest,
		respondMistakeLimit: rest.respondMistakeLimit,
		agentPlanEffectivePlan: rest.agentPlanEffectivePlan,
		editorPlanReviewDismissed: rest.editorPlanReviewDismissed,
		planFileRelPath: rest.planFileRelPath,
		planFilePath: rest.planFilePath,
		defaultModel: rest.defaultModel,
		modelPickerItems: rest.modelPickerItems,
		planReviewIsBuilt: rest.planReviewIsBuilt,
		onPlanBuild: rest.onPlanBuild,
		onPlanReviewClose: rest.onPlanReviewClose,
		onPlanTodoToggle: rest.onPlanTodoToggle,
		toolApprovalRequest: rest.toolApprovalRequest,
		respondToolApproval: rest.respondToolApproval,
		snapshotPaths: rest.snapshotPaths,
		onKeepAllEdits: rest.onKeepAllEdits,
		onRevertAllEdits: rest.onRevertAllEdits,
		onKeepFileEdit: rest.onKeepFileEdit,
		onRevertFileEdit: rest.onRevertFileEdit,
	}), [
		rest.pendingAgentPatches, rest.agentReviewBusy,
		rest.onApplyAgentPatchOne, rest.onApplyAgentPatchesAll, rest.onDiscardAgentReview,
		rest.planQuestion, rest.onPlanQuestionSubmit, rest.onPlanQuestionSkip,
		rest.userInputRequest, rest.onUserInputSubmit,
		rest.wizardPending, rest.setWizardPending,
		rest.executeSkillCreatorSend, rest.executeRuleWizardSend, rest.executeSubagentWizardSend,
		rest.mistakeLimitRequest, rest.respondMistakeLimit,
		rest.agentPlanEffectivePlan, rest.editorPlanReviewDismissed,
		rest.planFileRelPath, rest.planFilePath,
		rest.defaultModel, rest.modelPickerItems, rest.planReviewIsBuilt,
		rest.onPlanBuild, rest.onPlanReviewClose, rest.onPlanTodoToggle,
		rest.toolApprovalRequest, rest.respondToolApproval, rest.snapshotPaths,
		rest.onKeepAllEdits, rest.onRevertAllEdits, rest.onKeepFileEdit, rest.onRevertFileEdit,
	]);

	// Group 4: Stable/rarely-changing props (refs, t, workspace info)
	const stableGroup = useMemo(() => ({
		t: rest.t,
		workspace: rest.workspace,
		workspaceBasename: rest.workspaceBasename,
		knownSlashCommands: rest.knownSlashCommands,
		dismissedFiles: rest.dismissedFiles,
		revertedFiles: rest.revertedFiles,
		revertedChangeKeys: rest.revertedChangeKeys,
		messagesViewportRef: rest.messagesViewportRef,
		messagesTrackRef: rest.messagesTrackRef,
		onMessagesScroll: rest.onMessagesScroll,
		streamStartedAtRef: rest.streamStartedAtRef,
		firstTokenAtRef: rest.firstTokenAtRef,
		thoughtSecondsByThread: rest.thoughtSecondsByThread,
	}), [
		rest.t, rest.workspace, rest.workspaceBasename, rest.knownSlashCommands,
		rest.dismissedFiles,
		rest.revertedFiles, rest.revertedChangeKeys,
		rest.messagesViewportRef, rest.messagesTrackRef, rest.onMessagesScroll,
		rest.streamStartedAtRef, rest.firstTokenAtRef,
		rest.thoughtSecondsByThread,
	]);

	// Final combined memo — only recomputes when a group-level reference changes
	const prevGroupsRef = useRef<{
		m: typeof messageGroup;
		c: typeof composerGroup;
		a: typeof actionGroup;
		s: typeof stableGroup;
	} | null>(null);
	const result = useMemo(
		() => {
			if (import.meta.env.DEV) {
				const p = prevGroupsRef.current;
				if (p) {
					const reasons: string[] = [];
					if (p.m !== messageGroup) reasons.push('message');
					if (p.c !== composerGroup) reasons.push('composer');
					if (p.a !== actionGroup) reasons.push('action');
					if (p.s !== stableGroup) reasons.push('stable');
					console.log(
						`[perf] useAgentChatPanelProps memo recomputed: messages=${messageGroup.persistedMessages.length}, thread=${messageGroup.messagesThreadId}` +
							(reasons.length ? ` (groups: ${reasons.join(', ')})` : '')
					);
				} else {
					console.log(
						`[perf] useAgentChatPanelProps memo recomputed: messages=${messageGroup.persistedMessages.length}, thread=${messageGroup.messagesThreadId}`
					);
				}
				prevGroupsRef.current = { m: messageGroup, c: composerGroup, a: actionGroup, s: stableGroup };
			}
			return {
				...messageGroup,
				...composerGroup,
				...actionGroup,
				...stableGroup,
				teamSession: rest.teamSession,
				onSelectTeamExpert: rest.onSelectTeamExpert,
				onTeamPlanApprove: rest.onTeamPlanApprove,
				onTeamPlanReject: rest.onTeamPlanReject,
				onOpenWorkspaceFile,
				onOpenAgentConversationFile: stableOnOpenAgentConversationFile,
				onRunCommand,
			};
		},
		[
			messageGroup,
			composerGroup,
			actionGroup,
			stableGroup,
			rest.teamSession,
			rest.onSelectTeamExpert,
			rest.onTeamPlanApprove,
			rest.onTeamPlanReject,
			onOpenWorkspaceFile,
			stableOnOpenAgentConversationFile,
			onRunCommand,
		]
	);

	return result;
}
