import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import {
	CREATE_SKILL_SLUG,
	newSegmentId,
	type ComposerSegment,
} from '../composerSegments';
import { stripLeadingYamlFrontmatter } from '../editorMarkdownView';
import { isPlanMdPath, planExecutedKey } from '../planExecutedKey';
import { parsePlanDocument, toPlanMd, type ParsedPlan, type PlanQuestion } from '../planParser';
import type { TFunction } from '../i18n';
import type { TurnTokenUsage } from '../ipcTypes';
import type { ChatPlanExecutePayload } from '../ipcTypes';
import type { ComposerMode } from '../ComposerPlusMenu';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';
import type { AgentUserInputRequest } from '../agentSessionTypes';
import type { TeamSessionState } from './useTeamSession';
import type { AgentRightSidebarView } from './useTeamSessionActions';

/** 与 App.tsx 内 onSendRef 的局部 OnSendOptions 等价（保持搬运后行为一致） */
type OnSendOptions = {
	threadId?: string;
	modeOverride?: ComposerMode;
	modelIdOverride?: string;
	planExecute?: ChatPlanExecutePayload;
	planBuildPathKey?: string;
};

export type UsePlanWizardActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	t: TFunction;
	workspace: string | null;
	currentIdRef: MutableRefObject<string | null>;
	composerMode: ComposerMode;
	awaitingReply: boolean;
	hasConversation: boolean;
	layoutMode: ShellLayoutMode;
	agentRightSidebarView: AgentRightSidebarView;

	// plan question state
	planQuestion: PlanQuestion | null;
	planQuestionRequestId: string | null;
	setPlanQuestion: Dispatch<SetStateAction<PlanQuestion | null>>;
	setPlanQuestionRequestId: Dispatch<SetStateAction<string | null>>;
	recordPlanQuestionDismissed: () => void;

	// plan file/exec
	planFilePath: string | null;
	planFileRelPath: string | null;
	executedPlanKeys: string[];
	setParsedPlan: Dispatch<SetStateAction<ParsedPlan | null>>;
	setPlanFilePath: Dispatch<SetStateAction<string | null>>;
	setPlanFileRelPath: Dispatch<SetStateAction<string | null>>;
	setEditorPlanReviewDismissed: Dispatch<SetStateAction<boolean>>;
	getLatestAgentPlan: () => ParsedPlan | null;

	// editor center plan
	filePath: string;
	editorValue: string;

	// team interactions
	getTeamSession: (threadId: string | null) => TeamSessionState | null;
	clearTeamPendingQuestion: (threadId: string) => void;
	clearTeamPendingUserInput: (threadId: string) => void;

	// root userInput
	rootUserInputRequestsByThread: Record<string, AgentUserInputRequest>;
	clearRootUserInputRequest: (threadId?: string | null) => void;

	// composer + sidebar
	setAgentRightSidebarView: Dispatch<SetStateAction<AgentRightSidebarView>>;
	setAgentRightSidebarOpen: Dispatch<SetStateAction<boolean>>;
	setComposerModePersist: (mode: ComposerMode) => void;
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setInlineResendSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setResendFromUserIndex: Dispatch<SetStateAction<number | null>>;

	// thread/streaming reset (used by skill creator)
	closeSettingsPage: () => Promise<void>;
	refreshThreads: () => void | Promise<unknown>;
	loadMessages: (id: string) => Promise<unknown>;
	setCurrentId: Dispatch<SetStateAction<string | null>>;
	setLastTurnUsage: Dispatch<SetStateAction<TurnTokenUsage | null>>;
	setAwaitingReply: Dispatch<SetStateAction<boolean>>;
	setStreaming: Dispatch<SetStateAction<string>>;
	setStreamingThinking: Dispatch<SetStateAction<string>>;
	clearStreamingToolPreviewNow: () => void;
	streamStartedAtRef: MutableRefObject<number | null>;
	firstTokenAtRef: MutableRefObject<number | null>;
	composerRichBottomRef: RefObject<HTMLDivElement | null>;
	composerRichHeroRef: RefObject<HTMLDivElement | null>;

	// transient toast
	showTransientToast: (success: boolean, message: string) => void;

	// chain to send pipeline
	onSend: (textOverride?: string, opts?: OnSendOptions) => Promise<void>;
};

export type UsePlanWizardActionsResult = {
	getCurrentPlanQuestionState: () => { question: PlanQuestion | null; requestId: string | null };
	formatPlanQuestionReply: (answer: string) => string;
	onPlanQuestionSubmit: (answer: string) => void;
	onPlanQuestionSkip: () => void;
	getCurrentUserInputRequest: () => AgentUserInputRequest | null;
	onUserInputSubmit: (answers: Record<string, string>) => Promise<void>;
	onPlanBuild: (modelId: string) => void;
	onExecutePlanFromEditor: (modelId: string) => void;
	onPlanReviewClose: () => void;
	startSkillCreatorFlow: () => Promise<void>;
};

/**
 * Plan / userInput / Skill Creator 三组相关动作。
 *
 * 行为与原 App.tsx 完全一致：
 *  - plan question 在 team 模式下走 teamSession 的 pending 字段，否则走全局 planQuestion；
 *  - plan build 通过 onSend(planExecute) 触发，并标记本次 planBuildPathKey；
 *  - editor 中心区直接执行 plan 时复用同一 onSend 流程；
 *  - plan review close 在 agent 布局且 view==='plan' 时关闭侧栏，否则只是标记 editor 提示已关闭；
 *  - startSkillCreatorFlow：先关闭设置页 → 新建线程 → 切到 create-skill 命令气泡。
 */
export function usePlanWizardActions(
	params: UsePlanWizardActionsParams
): UsePlanWizardActionsResult {
	const {
		shell,
		t,
		workspace,
		currentIdRef,
		composerMode,
		awaitingReply,
		hasConversation,
		layoutMode,
		agentRightSidebarView,
		planQuestion,
		planQuestionRequestId,
		setPlanQuestion,
		setPlanQuestionRequestId,
		recordPlanQuestionDismissed,
		planFilePath,
		planFileRelPath,
		executedPlanKeys,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		setEditorPlanReviewDismissed,
		getLatestAgentPlan,
		filePath,
		editorValue,
		getTeamSession,
		clearTeamPendingQuestion,
		clearTeamPendingUserInput,
		rootUserInputRequestsByThread,
		clearRootUserInputRequest,
		setAgentRightSidebarView,
		setAgentRightSidebarOpen,
		setComposerModePersist,
		setComposerSegments,
		setInlineResendSegments,
		setResendFromUserIndex,
		closeSettingsPage,
		refreshThreads,
		loadMessages,
		setCurrentId,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		streamStartedAtRef,
		firstTokenAtRef,
		composerRichBottomRef,
		composerRichHeroRef,
		showTransientToast,
		onSend,
	} = params;

	const getCurrentPlanQuestionState = useCallback(() => {
		if (composerMode === 'team') {
			const liveTeamSession = getTeamSession(currentIdRef.current);
			return {
				question: liveTeamSession?.pendingQuestion ?? planQuestion,
				requestId: liveTeamSession?.pendingQuestionRequestId ?? planQuestionRequestId,
			};
		}
		return {
			question: planQuestion,
			requestId: planQuestionRequestId,
		};
	}, [composerMode, getTeamSession, planQuestion, planQuestionRequestId, currentIdRef]);

	const formatPlanQuestionReply = useCallback(
		(answer: string) => {
			const questionText = getCurrentPlanQuestionState().question?.text?.trim();
			const normalizedAnswer = answer.trim();
			if (!questionText) {
				return `我选择：${normalizedAnswer}`;
			}
			return [
				'[PLAN QUESTION]',
				questionText,
				'',
				'[USER ANSWER]',
				normalizedAnswer,
			].join('\n');
		},
		[getCurrentPlanQuestionState]
	);

	const onPlanQuestionSubmit = useCallback(
		(answer: string) => {
			const { requestId: rid } = getCurrentPlanQuestionState();
			const threadId = currentIdRef.current;
			const reply = formatPlanQuestionReply(answer);
			if (composerMode === 'team' && threadId) {
				clearTeamPendingQuestion(threadId);
			}
			if (rid && shell) {
				setPlanQuestion(null);
				setPlanQuestionRequestId(null);
				void shell
					.invoke('plan:toolQuestionRespond', { requestId: rid, answerText: reply })
					.catch((e) => console.error('[plan:toolQuestionRespond]', e));
				return;
			}
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			void onSend(reply);
		},
		[
			clearTeamPendingQuestion,
			composerMode,
			currentIdRef,
			formatPlanQuestionReply,
			getCurrentPlanQuestionState,
			shell,
			setPlanQuestion,
			setPlanQuestionRequestId,
			onSend,
		]
	);

	const onPlanQuestionSkip = useCallback(() => {
		recordPlanQuestionDismissed();
		const { requestId: rid } = getCurrentPlanQuestionState();
		const threadId = currentIdRef.current;
		const skipText = t('plan.q.skipUserMessage');
		if (composerMode === 'team' && threadId) {
			clearTeamPendingQuestion(threadId);
		}
		if (rid && shell) {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			void shell
				.invoke('plan:toolQuestionRespond', {
					requestId: rid,
					skipped: true,
					answerText: skipText,
				})
				.catch((e) => console.error('[plan:toolQuestionRespond]', e));
			return;
		}
		setPlanQuestion(null);
		setPlanQuestionRequestId(null);
		void onSend(skipText);
	}, [
		t,
		onSend,
		shell,
		composerMode,
		currentIdRef,
		clearTeamPendingQuestion,
		getCurrentPlanQuestionState,
		recordPlanQuestionDismissed,
		setPlanQuestion,
		setPlanQuestionRequestId,
	]);

	const getCurrentUserInputRequest = useCallback(() => {
		const threadId = currentIdRef.current;
		if (!threadId) {
			return null;
		}
		if (composerMode === 'team') {
			return getTeamSession(threadId)?.pendingUserInput ?? null;
		}
		return rootUserInputRequestsByThread[threadId] ?? null;
	}, [composerMode, currentIdRef, getTeamSession, rootUserInputRequestsByThread]);

	const onUserInputSubmit = useCallback(
		async (answers: Record<string, string>) => {
			const threadId = currentIdRef.current;
			const request = getCurrentUserInputRequest();
			if (!threadId || !request?.requestId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:userInputRespond', {
				requestId: request.requestId,
				answers,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('app.chatSendFailed'));
				return;
			}
			if (composerMode === 'team') {
				clearTeamPendingUserInput(threadId);
			}
			clearRootUserInputRequest(threadId);
			showTransientToast(true, t('agent.userInput.submittedToast'));
		},
		[
			clearRootUserInputRequest,
			clearTeamPendingUserInput,
			composerMode,
			currentIdRef,
			getCurrentUserInputRequest,
			shell,
			showTransientToast,
			t,
		]
	);

	const onPlanBuild = useCallback(
		(modelId: string) => {
			if (awaitingReply) {
				return;
			}
			const planToBuild = getLatestAgentPlan();
			if (!planToBuild || !shell || !modelId.trim()) {
				return;
			}
			const threadId = currentIdRef.current;
			if (!threadId) {
				return;
			}
			const pbKeyEarly = planExecutedKey(workspace, planFileRelPath, planFilePath);
			if (pbKeyEarly && executedPlanKeys.includes(pbKeyEarly)) {
				return;
			}
			const planExecute: ChatPlanExecutePayload = {
				fromAbsPath: planFilePath ?? undefined,
				inlineMarkdown: toPlanMd(planToBuild),
				planTitle: planToBuild.name,
			};
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			setAgentRightSidebarView('plan');
			setAgentRightSidebarOpen(true);
			setComposerModePersist('agent');
			setComposerSegments([{ id: newSegmentId(), kind: 'text', text: '' }]);
			void onSend(t('plan.review.executeUserBubble'), {
				modeOverride: 'agent',
				modelIdOverride: modelId,
				planExecute,
				planBuildPathKey: pbKeyEarly || undefined,
			});
		},
		[
			getLatestAgentPlan,
			planFilePath,
			planFileRelPath,
			workspace,
			executedPlanKeys,
			shell,
			awaitingReply,
			setComposerModePersist,
			t,
			currentIdRef,
			setPlanQuestion,
			setPlanQuestionRequestId,
			setAgentRightSidebarView,
			setAgentRightSidebarOpen,
			setComposerSegments,
			onSend,
		]
	);

	const onExecutePlanFromEditor = useCallback(
		(modelId: string) => {
			if (!shell || awaitingReply || !modelId.trim()) {
				return;
			}
			const threadId = currentIdRef.current;
			if (!threadId || !hasConversation) {
				return;
			}
			const fp = filePath.trim().replace(/\\/g, '/');
			if (!isPlanMdPath(fp)) {
				return;
			}
			const pbKey = planExecutedKey(workspace, fp, null);
			if (pbKey && executedPlanKeys.includes(pbKey)) {
				return;
			}
			const body = stripLeadingYamlFrontmatter(editorValue);
			const parsed = parsePlanDocument(body);
			const baseName = fp.split('/').pop() ?? 'plan.plan.md';
			const planTitle = parsed?.name ?? baseName.replace(/\.plan\.md$/i, '');
			const planExecute: ChatPlanExecutePayload = {
				inlineMarkdown: parsed ? toPlanMd(parsed) : editorValue,
				planTitle,
			};
			setComposerModePersist('agent');
			setComposerSegments([{ id: newSegmentId(), kind: 'text', text: '' }]);
			void onSend(t('plan.review.executeUserBubble'), {
				modeOverride: 'agent',
				modelIdOverride: modelId,
				planExecute,
				planBuildPathKey: pbKey || undefined,
			});
		},
		[
			shell,
			awaitingReply,
			hasConversation,
			filePath,
			editorValue,
			workspace,
			executedPlanKeys,
			setComposerModePersist,
			t,
			currentIdRef,
			setComposerSegments,
			onSend,
		]
	);

	const onPlanReviewClose = useCallback(() => {
		if (layoutMode === 'agent' && agentRightSidebarView === 'plan') {
			setParsedPlan(null);
			setPlanFilePath(null);
			setPlanFileRelPath(null);
			setAgentRightSidebarOpen(false);
			setAgentRightSidebarView('git');
			return;
		}
		setEditorPlanReviewDismissed(true);
	}, [
		layoutMode,
		agentRightSidebarView,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		setAgentRightSidebarOpen,
		setAgentRightSidebarView,
		setEditorPlanReviewDismissed,
	]);

	const startSkillCreatorFlow = useCallback(async () => {
		await closeSettingsPage();
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('threads:create')) as { id: string };
		const threadId = r.id;
		await refreshThreads();
		await shell.invoke('threads:select', threadId);
		setCurrentId(threadId);
		setLastTurnUsage(null);
		setAwaitingReply(false);
		setStreaming('');
		setStreamingThinking('');
		clearStreamingToolPreviewNow();
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		await loadMessages(threadId);
		setComposerSegments([
			{ id: newSegmentId(), kind: 'command', command: CREATE_SKILL_SLUG },
			{ id: newSegmentId(), kind: 'text', text: '' },
		]);
		setInlineResendSegments([]);
		setResendFromUserIndex(null);
		const title = t('agentSettings.skillCreatorThreadTitle');
		const rr = (await shell.invoke('threads:rename', threadId, title)) as { ok?: boolean };
		if (rr?.ok) {
			await refreshThreads();
		}
		queueMicrotask(() => {
			if (composerRichBottomRef.current) {
				composerRichBottomRef.current.focus();
			} else {
				composerRichHeroRef.current?.focus();
			}
		});
	}, [
		closeSettingsPage,
		shell,
		t,
		refreshThreads,
		loadMessages,
		clearStreamingToolPreviewNow,
		setCurrentId,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		streamStartedAtRef,
		firstTokenAtRef,
		setComposerSegments,
		setInlineResendSegments,
		setResendFromUserIndex,
		composerRichBottomRef,
		composerRichHeroRef,
	]);

	return {
		getCurrentPlanQuestionState,
		formatPlanQuestionReply,
		onPlanQuestionSubmit,
		onPlanQuestionSkip,
		getCurrentUserInputRequest,
		onUserInputSubmit,
		onPlanBuild,
		onExecutePlanFromEditor,
		onPlanReviewClose,
		startSkillCreatorFlow,
	};
}
