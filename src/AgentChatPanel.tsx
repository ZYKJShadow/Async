import {
	memo,
	useCallback,
	useDeferredValue,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type Dispatch,
	type ReactNode,
	type RefObject,
	type SetStateAction,
} from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import { AgentReviewPanel } from './AgentReviewPanel';
import { AgentFileChangesPanel } from './AgentFileChanges';
import {
	AgentBottomTodoPanel,
	type AgentTodoItem,
	type BottomTodoLayoutMode,
} from './AgentBottomTodoPanel';
import { ChatComposer } from './ChatComposer';
import { PlanQuestionDialog } from './PlanQuestionDialog';
import { UserInputRequestDialog } from './UserInputRequestDialog';
import { SkillScopeDialog } from './SkillScopeDialog';
import { RuleWizardDialog } from './RuleWizardDialog';
import { SubagentScopeDialog } from './SubagentScopeDialog';
import { ToolApprovalInlineCard, type ToolApprovalPayload } from './ToolApprovalCard';
import { AgentMistakeLimitDialog, type MistakeLimitPayload } from './AgentMistakeLimitDialog';
import { PlanReviewPanel } from './PlanReviewPanel';
import { TeamPlanReviewPanel } from './TeamPlanReviewPanel';
import { TeamPlanRevisionCard } from './TeamPlanRevisionCard';
import { TeamRoleAvatar } from './TeamRoleAvatar';
import { UserMessageRich } from './UserMessageRich';
import {
	assistantMessageUsesAgentToolProtocol,
	extractLastTodosFromContent,
	segmentAssistantContentUnified,
} from './agentChatSegments';
import {
	useLiveAssistantBlocks,
	useStreaming,
	useStreamingThinking,
	useStreamingToolPreview,
	useThinkingTick,
} from './streamingStore';
import { computeMergedAgentFileChanges } from './agentFileChangesCompute';
import {
	buildConversationRenderKey,
	computeLatestTurnFocusSpacerPx,
	findLatestTurnFocusUserIndex,
	findStickyUserIndexForViewport,
	resolveStickyUserIndex,
} from './agentTurnFocus';
import { useAppShellGitFiles, useAppShellGitMeta } from './app/appShellContexts';
import { userMessageToSegments, type ComposerSegment } from './composerSegments';
import { partsToSegments, type UserMessagePart } from './messageParts';
import type { WizardPending } from './hooks/useWizardPending';
import type { TFunction } from './i18n';
import { isChatAssistantErrorLine } from './i18n';
import { type AgentPendingPatch, type TurnTokenUsage } from './ipcTypes';
import { extractTodosFromLiveBlocks } from './liveAgentBlocks';
import { IconArrowDown, IconChevron, IconDoc } from './icons';
import { type ParsedPlan, type PlanQuestion } from './planParser';
import { type ChatMessage } from './threadTypes';
import type { TeamSessionState } from './hooks/useTeamSession';
import type { AgentUserInputRequest } from './agentSessionTypes';
import { buildTeamConversationTimeline } from './teamChatTimeline';

type SharedComposerProps = Omit<
	ComponentProps<typeof ChatComposer>,
	'slot' | 'variant' | 'segments' | 'setSegments' | 'canSend' | 'extraClass' | 'showGitBranchRow'
>;

export type AgentChatPanelProps = {
	layout?: 'agent-center' | 'editor-rail';
	t: TFunction;
	hasConversation: boolean;
	/** 持久化的历史消息；live 助手气泡由面板内部通过 streamingStore 订阅合成，不从这里传入 */
	persistedMessages: ChatMessage[];
	messagesThreadId: string | null;
	currentId: string | null;
	messagesViewportRef: RefObject<HTMLDivElement | null>;
	messagesTrackRef: RefObject<HTMLDivElement | null>;
	inlineResendRootRef: RefObject<HTMLDivElement | null>;
	onMessagesScroll: () => void;
	awaitingReply: boolean;
	streamStartedAtRef: RefObject<number | null>;
	firstTokenAtRef: RefObject<number | null>;
	thoughtSecondsByThread: Record<string, number>;
	lastTurnUsage: TurnTokenUsage | null;
	composerMode: ComponentProps<typeof ChatComposer>['composerMode'];
	workspace: string | null;
	workspaceBasename: string;
	knownSlashCommands: string[];
	revertedFiles: ReadonlySet<string>;
	revertedChangeKeys: ReadonlySet<string>;
	resendFromUserIndex: number | null;
	inlineResendSegments: ComposerSegment[];
	setInlineResendSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	composerSegments: ComposerSegment[];
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	canSendComposer: boolean;
	canSendInlineResend: boolean;
	sharedComposerProps: SharedComposerProps;
	onStartInlineResend: (userMessageIndex: number, content: string, parts?: UserMessagePart[]) => void;
	onOpenWorkspaceFile: (rel: string) => void;
	onOpenAgentConversationFile: (
		rel: string,
		line?: number,
		end?: number,
		options?: { diff?: string | null; allowReviewActions?: boolean }
	) => void;
	onRunCommand: (cmd: string) => void;
	pendingAgentPatches: AgentPendingPatch[];
	agentReviewBusy: boolean;
	onApplyAgentPatchOne: (id: string) => void;
	onApplyAgentPatchesAll: () => void;
	onDiscardAgentReview: () => void;
	planQuestion: PlanQuestion | null;
	onPlanQuestionSubmit: (answer: string) => void;
	onPlanQuestionSkip: () => void;
	userInputRequest: AgentUserInputRequest | null;
	onUserInputSubmit: (answers: Record<string, string>) => Promise<void>;
	wizardPending: WizardPending | null;
	setWizardPending: Dispatch<SetStateAction<WizardPending | null>>;
	executeSkillCreatorSend: (scope: 'user' | 'project', pending: WizardPending) => void;
	executeRuleWizardSend: (
		ruleScope: 'always' | 'glob' | 'manual',
		globPattern: string | undefined,
		pending: WizardPending
	) => void;
	executeSubagentWizardSend: (scope: 'user' | 'project', pending: WizardPending) => void;
	mistakeLimitRequest: MistakeLimitPayload | null;
	respondMistakeLimit: (action: 'continue' | 'stop' | 'hint', hint?: string) => void;
	agentPlanEffectivePlan: ParsedPlan | null;
	editorPlanReviewDismissed: boolean;
	planFileRelPath: string | null;
	planFilePath: string | null;
	defaultModel: string;
	modelPickerItems: ComponentProps<typeof PlanReviewPanel>['modelItems'];
	planReviewIsBuilt: boolean;
	onPlanBuild: (modelId: string) => void;
	onPlanReviewClose: () => void;
	onPlanTodoToggle: (id: string) => void;
	toolApprovalRequest: ToolApprovalPayload | null;
	respondToolApproval: (allow: boolean) => void;
	/** 逐文件忽略改动条；与 Git 合并后的列表在面板内计算，避免 Git fullStatus 拖垮 useAgentChatPanelProps */
	dismissedFiles: ReadonlySet<string>;
	snapshotPaths: ReadonlySet<string>;
	fileChangesDismissed: boolean;
	onKeepAllEdits: () => void;
	onRevertAllEdits: () => void;
	onKeepFileEdit: (rel: string) => void;
	onRevertFileEdit: (rel: string) => void;
	showScrollToBottomButton: boolean;
	scrollMessagesToBottom: (behavior?: ScrollBehavior) => void;
	agentPlanSummaryCard: ReactNode;
	teamSession: TeamSessionState | null;
	onSelectTeamExpert: (taskId: string) => void;
	onTeamPlanApprove: (proposalId: string, feedback?: string) => void;
	onTeamPlanReject: (proposalId: string, feedback?: string) => void;
	onChatPanelDropFiles: (files: File[]) => Promise<void>;
};

/** 未测量行时用于高度预算的估算高度（与旧虚拟列表 estimate 对齐） */
const ESTIMATED_MESSAGE_ROW_PX = 160;
/** 目标：已渲染轨道总高度至少为视口高度的倍数 + 额外缓冲，避免首屏过短 */
const HEIGHT_BUDGET_VIEWPORT_MULT = 2;
const HEIGHT_BUDGET_OVERSCAN_PX = 400;
/** 顶部哨兵触发时再往上加载的近似高度（约一整屏 + 边距） */
const SCROLL_UP_LOAD_VIEWPORT_MULT = 1;
const SCROLL_UP_LOAD_EXTRA_PX = 250;

function startIndexForHeightBudget(
	len: number,
	targetContentPx: number,
	getRowHeight: (i: number) => number,
	gapPx: number
): number {
	if (len <= 0) {
		return 0;
	}
	let sum = 0;
	for (let i = len - 1; i >= 0; i--) {
		sum += getRowHeight(i);
		if (i < len - 1) {
			sum += gapPx;
		}
		if (sum >= targetContentPx) {
			return i;
		}
	}
	return 0;
}

function expandStartIndexByPixelBudget(
	currentStart: number,
	pixelBudget: number,
	getRowHeight: (i: number) => number,
	gapPx: number
): number {
	if (currentStart <= 0 || pixelBudget <= 0) {
		return currentStart;
	}
	let add = 0;
	let newStart = currentStart;
	while (newStart > 0 && add < pixelBudget) {
		newStart--;
		add += getRowHeight(newStart) + gapPx;
	}
	return newStart;
}

export const AgentChatPanel = memo(function AgentChatPanel({
	layout = 'agent-center',
	t,
	hasConversation,
	persistedMessages,
	messagesThreadId,
	currentId,
	messagesViewportRef,
	messagesTrackRef,
	inlineResendRootRef,
	onMessagesScroll,
	awaitingReply,
	streamStartedAtRef,
	firstTokenAtRef,
	thoughtSecondsByThread,
	lastTurnUsage,
	composerMode,
	workspace,
	workspaceBasename,
	knownSlashCommands,
	revertedFiles,
	revertedChangeKeys,
	resendFromUserIndex,
	inlineResendSegments,
	setInlineResendSegments,
	composerSegments,
	setComposerSegments,
	canSendComposer,
	canSendInlineResend,
	sharedComposerProps,
	onStartInlineResend,
	onOpenWorkspaceFile,
	onOpenAgentConversationFile,
	onRunCommand,
	pendingAgentPatches,
	agentReviewBusy,
	onApplyAgentPatchOne,
	onApplyAgentPatchesAll,
	onDiscardAgentReview,
	planQuestion,
	onPlanQuestionSubmit,
	onPlanQuestionSkip,
	userInputRequest,
	onUserInputSubmit,
	wizardPending,
	setWizardPending,
	executeSkillCreatorSend,
	executeRuleWizardSend,
	executeSubagentWizardSend,
	mistakeLimitRequest,
	respondMistakeLimit,
	agentPlanEffectivePlan,
	editorPlanReviewDismissed,
	planFileRelPath,
	planFilePath,
	defaultModel,
	modelPickerItems,
	planReviewIsBuilt,
	onPlanBuild,
	onPlanReviewClose,
	onPlanTodoToggle,
	toolApprovalRequest,
	respondToolApproval,
	dismissedFiles,
	snapshotPaths,
	fileChangesDismissed,
	onKeepAllEdits,
	onRevertAllEdits,
	onKeepFileEdit,
	onRevertFileEdit,
	showScrollToBottomButton,
	scrollMessagesToBottom,
	agentPlanSummaryCard,
	teamSession,
	onSelectTeamExpert,
	onTeamPlanApprove,
	onTeamPlanReject,
	onChatPanelDropFiles,
}: AgentChatPanelProps) {
	const streamingToolPreview = useStreamingToolPreview();
	const liveAssistantBlocks = useLiveAssistantBlocks();
	const streaming = useStreaming();
	const streamingThinking = useStreamingThinking();
	// 订阅 thinkingTick：仅用于 thinking 阶段每秒刷新耗时显示（订阅成立即可，不需要读值）
	useThinkingTick();
	const persistedMessageCount = persistedMessages.length;
	const displayMessages = useMemo<ChatMessage[]>(() => {
		if (composerMode === 'team' && awaitingReply && streaming === '') {
			return persistedMessages;
		}
		if (!awaitingReply && streaming === '') {
			return persistedMessages;
		}
		return [...persistedMessages, { role: 'assistant' as const, content: streaming }];
	}, [persistedMessages, streaming, awaitingReply, composerMode]);
	const lastAssistantMessageIndex = useMemo(() => {
		let idx = -1;
		for (let j = 0; j < displayMessages.length; j++) {
			if (displayMessages[j]!.role === 'assistant') idx = j;
		}
		return idx;
	}, [displayMessages]);
	if (import.meta.env.DEV) {
		console.log(`[perf] AgentChatPanel render: thread=${messagesThreadId}, messages=${displayMessages.length}, hasConv=${hasConversation}`);
	}
	const { gitStatusOk } = useAppShellGitMeta();
	const { gitChangedPaths: _gitChangedPaths, diffPreviews: _diffPreviews } = useAppShellGitFiles();
	// useDeferredValue：git 状态/diff 批量更新时，React 优先处理用户输入（打字、拖窗），
	// 推迟 agentFileChanges 重算，避免切换工作区后的卡顿。
	const gitChangedPaths = useDeferredValue(_gitChangedPaths);
	const diffPreviews = useDeferredValue(_diffPreviews);
	const segmentCacheRef = useRef<{
		content: string;
		result: ReturnType<typeof segmentAssistantContentUnified>;
	} | null>(null);
	const userSegsCacheRef = useRef<Map<string, ComposerSegment[]>>(new Map());
	const userPartsCacheRef = useRef<WeakMap<UserMessagePart[], ComposerSegment[]>>(new WeakMap());
	const cachedUserMessageToSegments = (
		content: string,
		parts?: UserMessagePart[]
	): ComposerSegment[] => {
		if (parts && parts.length > 0) {
			const partsCache = userPartsCacheRef.current;
			const cached = partsCache.get(parts);
			if (cached) return cached;
			const result = partsToSegments(parts);
			partsCache.set(parts, result);
			return result;
		}
		const cache = userSegsCacheRef.current;
		const cacheKey = `${knownSlashCommands.join('\u241f')}::${content}`;
		const cached = cache.get(cacheKey);
		if (cached) return cached;
		const result = userMessageToSegments(content, undefined, knownSlashCommands);
		cache.set(cacheKey, result);
		return result;
	};
	const agentFileChanges = useMemo(
		() =>
			computeMergedAgentFileChanges(
				displayMessages,
				composerMode,
				t,
				dismissedFiles,
				{ gitStatusOk, gitChangedPaths, diffPreviews },
				segmentCacheRef,
				snapshotPaths
			),
		[displayMessages, composerMode, t, dismissedFiles, gitStatusOk, gitChangedPaths, diffPreviews, snapshotPaths]
	);

	const isEditorRail = layout === 'editor-rail';
	/**
	 * 同线程切换 agent/team/plan 等模式时，消息轨道的 DOM 结构和高度预算都会变化。
	 * render key 必须带上 mode，才能让行高缓存、切片起点、sticky/spacer 一起重建。
	 */
	const conversationRenderKey = buildConversationRenderKey(messagesThreadId, composerMode);
	const dropDepthRef = useRef(0);
	const [chatPanelFileDragOver, setChatPanelFileDragOver] = useState(false);
	const [bottomTodoCollapsed, setBottomTodoCollapsed] = useState(true);
	/**
	 * 实时贴底状态用 ref 维护即可——不需要触发 AgentChatPanel 重渲染，仅在「即将展开」
	 * 那一瞬间被读取一次，用来锁定本次展开使用的 layoutMode。
	 */
	const bottomTodoAtBottomRef = useRef(true);
	/**
	 * 展开态锁定的布局模式：
	 * - 展开瞬间根据 `bottomTodoAtBottomRef` 决定值（'pushup' / 'overlay'），并固定到折叠为止；
	 * - 折叠时清空，下次展开重新评估。
	 *
	 * 这样消除了「展开后用户上下滚动导致 list 在 pushup ↔ overlay 之间反复切换」的跳动问题。
	 */
	const [bottomTodoLockedMode, setBottomTodoLockedMode] =
		useState<BottomTodoLayoutMode | null>(null);
	const bottomTodoCollapsedRef = useRef(true);
	bottomTodoCollapsedRef.current = bottomTodoCollapsed;

	useLayoutEffect(() => {
		bottomTodoAtBottomRef.current = true;
	}, [conversationRenderKey]);

	/**
	 * 把面板「展开 + 锁定 layoutMode」的逻辑抽出来，自动展开和用户手动展开都走这一条路径。
	 * pushup 模式下 commandStack 会变高、messages flex 区会缩小，需要等下一帧立即贴底，
	 * 避免底部消息被新出现的 list 顶出可视范围。
	 */
	const expandBottomTodoLocked = useCallback(() => {
		const nextMode: BottomTodoLayoutMode = bottomTodoAtBottomRef.current
			? 'pushup'
			: 'overlay';
		setBottomTodoCollapsed(false);
		setBottomTodoLockedMode(nextMode);
		if (nextMode === 'pushup') {
			window.requestAnimationFrame(() => {
				scrollMessagesToBottom('auto');
			});
		}
	}, [scrollMessagesToBottom]);

	const toggleBottomTodoCollapsed = useCallback(() => {
		if (bottomTodoCollapsedRef.current) {
			expandBottomTodoLocked();
		} else {
			setBottomTodoCollapsed(true);
			setBottomTodoLockedMode(null);
		}
	}, [expandBottomTodoLocked]);

	/**
	 * 「全局最新 TODO」：流式中以 live blocks 为准；否则反向遍历 displayMessages
	 * 取最近一条 assistant 中的 TodoWrite 快照。
	 */
	const bottomTodos = useMemo<AgentTodoItem[]>(() => {
		const live = extractTodosFromLiveBlocks(liveAssistantBlocks.blocks);
		if (live && live.length > 0) {
			return live;
		}
		for (let i = displayMessages.length - 1; i >= 0; i--) {
			const m = displayMessages[i];
			if (!m || m.role !== 'assistant') continue;
			if (typeof m.content !== 'string' || m.content.length === 0) continue;
			const todos = extractLastTodosFromContent(m.content);
			if (todos && todos.length > 0) {
				return todos;
			}
		}
		return [];
	}, [liveAssistantBlocks.blocks, displayMessages]);

	/**
	 * 显示门控：底部 TODO 面板**仅在 agent 工作中**（`awaitingReply === true`）显示。
	 *
	 * 这一约束直接解决两个体验问题：
	 *  1. 用户暂停（点击 Stop）后 agent 的 partial assistant 仍会被持久化进 `persistedMessages`，
	 *     里面 TodoWrite 的 tool_call 不会被清掉；以前 TODO 一直挂在底部不消失就是它造成的。
	 *  2. agent 自然完成后没必要再让 TODO 占据底部空间，最终回答里通常会有总结。
	 *
	 * 切换到旧会话时只要 `awaitingReply=false`，TODO 也不会浮上来打扰用户翻历史。
	 */
	const shouldShowBottomTodos = awaitingReply && bottomTodos.length > 0;

	/**
	 * 渲染层做延迟卸载：`shouldShowBottomTodos` 由 true → false 时先标记 leaving，
	 * 让退场动画跑完再真正 unmount，避免「啪一下消失」的硬切。
	 */
	const [renderedBottomTodos, setRenderedBottomTodos] = useState<AgentTodoItem[]>([]);
	const [bottomTodoLeaving, setBottomTodoLeaving] = useState(false);
	const bottomTodoLeaveTimerRef = useRef<number | null>(null);
	useEffect(() => {
		if (shouldShowBottomTodos) {
			if (bottomTodoLeaveTimerRef.current !== null) {
				window.clearTimeout(bottomTodoLeaveTimerRef.current);
				bottomTodoLeaveTimerRef.current = null;
			}
			setRenderedBottomTodos(bottomTodos);
			setBottomTodoLeaving(false);
			return;
		}
		if (renderedBottomTodos.length > 0 && !bottomTodoLeaving) {
			setBottomTodoLeaving(true);
			bottomTodoLeaveTimerRef.current = window.setTimeout(() => {
				setRenderedBottomTodos([]);
				setBottomTodoLeaving(false);
				bottomTodoLeaveTimerRef.current = null;
			}, 240);
		}
	}, [shouldShowBottomTodos, bottomTodos, renderedBottomTodos.length, bottomTodoLeaving]);
	useEffect(() => {
		return () => {
			if (bottomTodoLeaveTimerRef.current !== null) {
				window.clearTimeout(bottomTodoLeaveTimerRef.current);
			}
		};
	}, []);

	/**
	 * 自动展开策略——只在以下「首次出现」边沿触发，平时尊重用户折叠状态：
	 *  1. 同一会话内 TODO 由「未显示」变「显示」（agent 新一轮第一次调用 TodoWrite）；
	 *  2. 切换会话且新会话当下就处于「正在显示 TODO」状态（包含首次 mount）；
	 *  3. TODO 不再显示 → 折叠 + 解锁 layoutMode，下次出现重新评估。
	 */
	const prevShownRef = useRef(false);
	const prevConvRenderKeyRef = useRef<string | null>(null);
	useEffect(() => {
		const wasShown = prevShownRef.current;
		const convChanged = prevConvRenderKeyRef.current !== conversationRenderKey;
		prevShownRef.current = shouldShowBottomTodos;
		prevConvRenderKeyRef.current = conversationRenderKey;
		if (shouldShowBottomTodos && (!wasShown || convChanged)) {
			expandBottomTodoLocked();
		} else if (!shouldShowBottomTodos) {
			setBottomTodoCollapsed(true);
			setBottomTodoLockedMode(null);
		}
	}, [shouldShowBottomTodos, conversationRenderKey, expandBottomTodoLocked]);
	const trackGapPx = isEditorRail ? 20 : 22;
	const messageRowHeightsRef = useRef<Map<number, number>>(new Map());
	/**
	 * 「过程区」独立行（preflight row）高度缓存：key 为它附属的 assistant 消息 index。
	 * 不参与 stickyUserIndex / data-msg-index 体系；仅在 DOM 直测缺失时作为
	 * latestTurnFocusSpacerPx 的兜底估算。
	 */
	const preflightRowHeightsRef = useRef<Map<number, number>>(new Map());
	const [messageStartIndex, setMessageStartIndex] = useState(0);
	const [latestTurnFocusSpacerPx, setLatestTurnFocusSpacerPx] = useState(0);
	const [stickyUserIndex, setStickyUserIndex] = useState<number | null>(null);
	const [layoutMeasureVersion, setLayoutMeasureVersion] = useState(0);
	const messagesTopSentinelRef = useRef<HTMLDivElement | null>(null);
	const pendingPrependScrollRef = useRef<{ prevScrollHeight: number } | null>(null);
	const prevDisplayMessagesLenRef = useRef(displayMessages.length);
	const prevConversationForLenRef = useRef<string | null>(null);
	const lastLayoutMeasureSigRef = useRef('');

	const getRowHeightForBudget = useCallback(
		(i: number) => messageRowHeightsRef.current.get(i) ?? ESTIMATED_MESSAGE_ROW_PX,
		[]
	);

	const len = displayMessages.length;
	const allHistoryRendered = messageStartIndex <= 0;
	const latestTurnFocusUserIndex = useMemo(
		() => findLatestTurnFocusUserIndex(displayMessages, composerMode),
		[displayMessages, composerMode]
	);
	const lastDisplayedMessage = len > 0 ? displayMessages[len - 1] : undefined;
	const lastMessageLayoutSig = useMemo(
		() =>
			len === 0
				? '0'
				: `${lastDisplayedMessage?.role ?? ''}:${(lastDisplayedMessage?.content ?? '').length}:${streaming.length}`,
		[len, lastDisplayedMessage?.role, lastDisplayedMessage?.content, streaming]
	);

	/**
	 * 切换对话：清空测量并按视口高度预算重算起点。
	 * 同一会话内仅列表变短时重算；变长（新消息）不缩小起点，末尾始终在切片内。
	 */
	useEffect(() => {
		const n = displayMessages.length;
		const vpGuess =
			typeof window !== 'undefined'
				? window.innerHeight * HEIGHT_BUDGET_VIEWPORT_MULT + HEIGHT_BUDGET_OVERSCAN_PX
				: 1200;
		const prevConv = prevConversationForLenRef.current;
		if (prevConv !== conversationRenderKey) {
			prevConversationForLenRef.current = conversationRenderKey;
			prevDisplayMessagesLenRef.current = n;
			pendingPrependScrollRef.current = null;
			messageRowHeightsRef.current.clear();
			preflightRowHeightsRef.current.clear();
			setMessageStartIndex(
				startIndexForHeightBudget(n, vpGuess, () => ESTIMATED_MESSAGE_ROW_PX, trackGapPx)
			);
			return;
		}
		const prevLen = prevDisplayMessagesLenRef.current;
		if (n < prevLen) {
			setMessageStartIndex(
				startIndexForHeightBudget(n, vpGuess, () => ESTIMATED_MESSAGE_ROW_PX, trackGapPx)
			);
		}
		prevDisplayMessagesLenRef.current = n;
	}, [displayMessages.length, conversationRenderKey, trackGapPx]);

	useLayoutEffect(() => {
		setLatestTurnFocusSpacerPx(0);
		setStickyUserIndex(null);
	}, [conversationRenderKey]);

	/** 顶部哨兵：再往上加载约「一整屏」高的内容（按已测/估算行高累计） */
	useEffect(() => {
		if (!hasConversation || allHistoryRendered) {
			return;
		}
		const root = messagesViewportRef.current;
		const target = messagesTopSentinelRef.current;
		if (!root || !target) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const hit = entries.some((e) => e.isIntersecting);
				if (!hit) {
					return;
				}
				const viewport = messagesViewportRef.current;
				if (!viewport) {
					return;
				}
				if (pendingPrependScrollRef.current != null) {
					return;
				}
				const loadBudget =
					viewport.clientHeight * SCROLL_UP_LOAD_VIEWPORT_MULT + SCROLL_UP_LOAD_EXTRA_PX;
				pendingPrependScrollRef.current = { prevScrollHeight: viewport.scrollHeight };
				setMessageStartIndex((s) =>
					expandStartIndexByPixelBudget(s, loadBudget, getRowHeightForBudget, trackGapPx)
				);
			},
			{ root, rootMargin: '200px 0px 0px 0px', threshold: 0 }
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [
		hasConversation,
		allHistoryRendered,
		displayMessages.length,
		conversationRenderKey,
		getRowHeightForBudget,
		trackGapPx,
	]);

	/** 测量行高；若轨道仍低于高度预算则继续往上扩大切片（粘底时用 scrollHeight 差补偿） */
	useLayoutEffect(() => {
		if (!hasConversation || len === 0) {
			return;
		}
		const viewport = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!viewport || !track) {
			return;
		}
		const wraps = track.querySelectorAll<HTMLElement>('.ref-msg-row-measure[data-msg-index]');
		for (const el of wraps) {
			const raw = el.dataset.msgIndex;
			if (!raw) {
				continue;
			}
			const idx = Number(raw);
			if (!Number.isFinite(idx)) {
				continue;
			}
			const h = Math.ceil(el.getBoundingClientRect().height);
			if (h > 0) {
				messageRowHeightsRef.current.set(idx, h);
			}
		}
		const preflightRows = track.querySelectorAll<HTMLElement>(
			'.ref-msg-preflight-row[data-preflight-for]'
		);
		for (const el of preflightRows) {
			const raw = el.dataset.preflightFor;
			if (!raw) continue;
			const idx = Number(raw);
			if (!Number.isFinite(idx)) continue;
			const h = Math.ceil(el.getBoundingClientRect().height);
			if (h > 0) {
				preflightRowHeightsRef.current.set(idx, h);
			}
		}
		const target = viewport.clientHeight * HEIGHT_BUDGET_VIEWPORT_MULT + HEIGHT_BUDGET_OVERSCAN_PX;
		if (messageStartIndex <= 0 || track.scrollHeight >= target) {
			return;
		}
		const deficit = target - track.scrollHeight;
		if (deficit <= 0) {
			return;
		}
		const newStart = expandStartIndexByPixelBudget(
			messageStartIndex,
			deficit,
			getRowHeightForBudget,
			trackGapPx
		);
		if (newStart < messageStartIndex) {
			pendingPrependScrollRef.current = { prevScrollHeight: viewport.scrollHeight };
			setMessageStartIndex(newStart);
		}
	}, [
		hasConversation,
		len,
		messageStartIndex,
		lastMessageLayoutSig,
		layoutMeasureVersion,
		conversationRenderKey,
		getRowHeightForBudget,
		trackGapPx,
	]);

	useLayoutEffect(() => {
		const pending = pendingPrependScrollRef.current;
		if (!pending) {
			return;
		}
		const viewport = messagesViewportRef.current;
		if (!viewport) {
			pendingPrependScrollRef.current = null;
			return;
		}
		const delta = viewport.scrollHeight - pending.prevScrollHeight;
		pendingPrependScrollRef.current = null;
		if (delta !== 0) {
			viewport.scrollTop += delta;
		}
	}, [messageStartIndex, displayMessages.length]);

	useLayoutEffect(() => {
		if (!hasConversation || latestTurnFocusUserIndex == null) {
			setLatestTurnFocusSpacerPx((prev) => (prev === 0 ? prev : 0));
			return;
		}
		const viewport = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!viewport || !track) {
			return;
		}
		const viewportStyle = window.getComputedStyle(viewport);
		const topPadding = Number.parseFloat(viewportStyle.paddingTop || '0') || 0;
		const bottomPadding = Number.parseFloat(viewportStyle.paddingBottom || '0') || 0;
		const activeRow = track.querySelector<HTMLElement>(
			`.ref-msg-row-measure[data-msg-index="${latestTurnFocusUserIndex}"]`
		);
		const tailSpacer = track.querySelector<HTMLElement>('.ref-messages-tail-spacer');
		let activeRowHeight = Math.max(0, getRowHeightForBudget(latestTurnFocusUserIndex));
		let belowContentHeight = 0;
		if (activeRow) {
			// 用真实布局距离兜住 preflight row 的负 margin、文件 chip/图片撑高等情况，
			// 避免统一 gap 估算把最近 user 永远差几像素顶不到 sticky 边界。
			const measuredActiveHeight =
				activeRow.offsetHeight || Math.ceil(activeRow.getBoundingClientRect().height);
			activeRowHeight = Math.max(0, measuredActiveHeight);
			const activeBottom = activeRow.offsetTop + measuredActiveHeight;
			belowContentHeight = tailSpacer
				? Math.max(0, tailSpacer.offsetTop - activeBottom)
				: Math.max(0, track.scrollHeight - activeBottom);
		} else {
			for (let i = latestTurnFocusUserIndex + 1; i < len; i++) {
				belowContentHeight += Math.max(0, getRowHeightForBudget(i));
				belowContentHeight += trackGapPx;
				const preflightH = preflightRowHeightsRef.current.get(i);
				if (preflightH && preflightH > 0) {
					belowContentHeight += preflightH;
					belowContentHeight += trackGapPx;
				}
			}
			belowContentHeight += trackGapPx;
		}
		const baseSpacer = computeLatestTurnFocusSpacerPx({
			viewportHeight: viewport.clientHeight,
			topPadding,
			bottomPadding,
			activeRowHeight,
			belowContentHeight,
		});
		const nextSpacer = Math.max(0, baseSpacer);
		setLatestTurnFocusSpacerPx((prev) => (Math.abs(prev - nextSpacer) <= 1 ? prev : nextSpacer));
	}, [
		hasConversation,
		latestTurnFocusUserIndex,
		len,
		lastMessageLayoutSig,
		layoutMeasureVersion,
		conversationRenderKey,
		getRowHeightForBudget,
		trackGapPx,
		messagesViewportRef,
		messagesTrackRef,
	]);

	/**
	 * user 图片 chip / 窗口宽度 / 字体加载等都会改变 user row 的真实高度，
	 * 但这些变化未必伴随 messages.length 或 content.length 变化。
	 * 这里单独订阅 viewport + track 的布局尺寸，在轨道重新排版后触发一次高度重测与 spacer 重算。
	 */
	useEffect(() => {
		if (!hasConversation) {
			lastLayoutMeasureSigRef.current = '';
			return;
		}
		const viewport = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!viewport || !track) {
			return;
		}
		let rafId = 0;
		const flush = () => {
			rafId = 0;
			const nextSig = [
				viewport.clientWidth,
				viewport.clientHeight,
				track.clientWidth,
				track.scrollHeight,
			].join(':');
			if (nextSig === lastLayoutMeasureSigRef.current) {
				return;
			}
			lastLayoutMeasureSigRef.current = nextSig;
			setLayoutMeasureVersion((v) => v + 1);
		};
		const schedule = () => {
			if (rafId !== 0) {
				return;
			}
			rafId = window.requestAnimationFrame(flush);
		};
		schedule();
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(viewport);
		resizeObserver.observe(track);
		return () => {
			resizeObserver.disconnect();
			if (rafId !== 0) {
				window.cancelAnimationFrame(rafId);
			}
		};
	}, [hasConversation, conversationRenderKey, messagesViewportRef, messagesTrackRef]);

	/**
	 * sticky 同步逻辑：用 ref 持有最新闭包，让监听器订阅 effect 只在「会话级」变量变化时
	 * 重订阅，避免流式 token 推送期间反复 add/removeEventListener 与 ResizeObserver 拆装。
	 */
	const syncStickyUserIndexRef = useRef<() => void>(() => {});
	syncStickyUserIndexRef.current = () => {
		const viewport = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!viewport || !track) {
			return;
		}
		const distFromBottom = Math.max(
			0,
			viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
		);
		const isAtBottom =
			distFromBottom <= 16 || viewport.scrollHeight <= viewport.clientHeight + 16;
		bottomTodoAtBottomRef.current = isAtBottom;
		const renderedRowTops = Array.from(
			track.querySelectorAll<HTMLElement>('.ref-msg-row-measure[data-msg-index]')
		)
			.map((row) => {
				const raw = row.dataset.msgIndex;
				const index = raw ? Number(raw) : Number.NaN;
				const height = row.offsetHeight || Math.ceil(row.getBoundingClientRect().height);
				return {
					index,
					top: row.offsetTop - viewport.scrollTop,
					height,
				};
			})
			.filter((row) => Number.isFinite(row.index));
		const nextStickyIndex = findStickyUserIndexForViewport({
			displayMessages,
			renderedRowTops,
			stickyTopPx: 0,
			latestTurnFocusUserIndex,
			latestTurnFocusSpacerPx,
		});
		const resolvedStickyIndex = resolveStickyUserIndex(nextStickyIndex);
		setStickyUserIndex((prev) => (prev === resolvedStickyIndex ? prev : resolvedStickyIndex));
	};

	useLayoutEffect(() => {
		if (!hasConversation || composerMode === 'team') {
			setStickyUserIndex((prev) => (prev == null ? prev : null));
			return;
		}
		const viewport = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!viewport || !track) {
			return;
		}
		let rafId = 0;
		const schedule = () => {
			if (rafId !== 0) {
				return;
			}
			rafId = window.requestAnimationFrame(() => {
				rafId = 0;
				syncStickyUserIndexRef.current();
			});
		};
		schedule();
		viewport.addEventListener('scroll', schedule, { passive: true });
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(track);
		return () => {
			viewport.removeEventListener('scroll', schedule);
			resizeObserver.disconnect();
			if (rafId !== 0) {
				window.cancelAnimationFrame(rafId);
			}
		};
	}, [hasConversation, composerMode, conversationRenderKey, messagesViewportRef, messagesTrackRef]);

	/**
	 * 数据/布局变化时主动触发一次同步——监听器订阅 effect 不再覆盖这些维度。
	 * 注意：latestTurnFocusSpacerPx 必须在这里，因为 spacer 高度变化会改变所有行的 top，
	 * 必须重新评估 sticky 候选；否则上一帧选定的 user 可能已经不再贴顶。
	 */
	useLayoutEffect(() => {
		if (!hasConversation || composerMode === 'team') {
			return;
		}
		syncStickyUserIndexRef.current();
	}, [
		hasConversation,
		composerMode,
		lastMessageLayoutSig,
		latestTurnFocusSpacerPx,
		latestTurnFocusUserIndex,
		messageStartIndex,
	]);

	/**
	 * 实时跟踪消息列表是否「贴底」——结果写入 `bottomTodoAtBottomRef`，仅供下次「展开 TODO」
	 * 那一瞬间读取，用来锁定 layoutMode；故意不用 state，避免每次滚动触发 AgentChatPanel 重渲染。
	 */
	useEffect(() => {
		if (!hasConversation) {
			bottomTodoAtBottomRef.current = true;
			return;
		}
		const viewport = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!viewport) {
			return;
		}
		let rafId = 0;
		const update = () => {
			rafId = 0;
			const dist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			bottomTodoAtBottomRef.current =
				dist <= 16 || viewport.scrollHeight <= viewport.clientHeight + 16;
		};
		const schedule = () => {
			if (rafId !== 0) return;
			rafId = window.requestAnimationFrame(update);
		};
		schedule();
		viewport.addEventListener('scroll', schedule, { passive: true });
		const ro = new ResizeObserver(schedule);
		ro.observe(viewport);
		if (track) ro.observe(track);
		return () => {
			viewport.removeEventListener('scroll', schedule);
			ro.disconnect();
			if (rafId !== 0) window.cancelAnimationFrame(rafId);
		};
	}, [hasConversation, conversationRenderKey, messagesViewportRef, messagesTrackRef]);

	/**
	 * 构造 assistant row 与 user 气泡之间的「过程区」props（live thought + 是否 streaming）。
	 * 提取为内部函数，供 messageNodeAtIndex 与 buildFlatMessageList 中的 preflight row 复用。
	 */
	const computeAssistantRuntime = (i: number) => {
		const m = displayMessages[i]!;
		const isLast = i === displayMessages.length - 1;
		const stAt = streamStartedAtRef.current;
		const ftAt = firstTokenAtRef.current;
		const showLiveThought =
			isLast && m.role === 'assistant' && awaitingReply && composerMode !== 'team';
		const agentOrPlanStreaming =
			(composerMode === 'agent' || composerMode === 'plan') && awaitingReply && isLast;
		const frozenSec =
			!awaitingReply && isLast && m.role === 'assistant' && currentId
				? thoughtSecondsByThread[currentId]
				: undefined;

		let liveThoughtMeta: ComponentProps<typeof ChatMarkdown>['liveThoughtMeta'] = null;
		if (showLiveThought && stAt) {
			const assistantTurnHasOutput =
				streaming.trim().length > 0 ||
				streamingToolPreview != null ||
				(agentOrPlanStreaming && liveAssistantBlocks.blocks.length > 0);
			const phase = assistantTurnHasOutput ? 'streaming' : 'thinking';
			const elapsed =
				phase === 'thinking'
					? Math.max(0, (Date.now() - stAt) / 1000)
					: ftAt
						? Math.max(0, (ftAt - stAt) / 1000)
						: Math.max(0, (Date.now() - stAt) / 1000);
			liveThoughtMeta = {
				phase,
				elapsedSeconds: elapsed,
				streamingThinking,
			};
		} else if (frozenSec != null) {
			liveThoughtMeta = {
				phase: 'done',
				elapsedSeconds: frozenSec,
				tokenUsage: isLast ? lastTurnUsage : null,
			};
		}

		return { isLast, agentOrPlanStreaming, liveThoughtMeta };
	};

	const messageNodeAtIndex = (i: number): ReactNode => {
			const m = displayMessages[i];
			if (!m) {
				return null;
			}
			const convoKey = conversationRenderKey;
			const { isLast, agentOrPlanStreaming, liveThoughtMeta } = computeAssistantRuntime(i);

			const pendingEmptyAssistant =
				m.role === 'assistant' &&
				m.content.trim() === '' &&
				awaitingReply &&
				isLast &&
				streamingToolPreview == null &&
				!(agentOrPlanStreaming && (liveAssistantBlocks.blocks.length > 0 || liveThoughtMeta != null));
			const userMessageIndex = i < persistedMessageCount && m.role === 'user' ? i : -1;
			const isEditingThisUser = userMessageIndex >= 0 && resendFromUserIndex === userMessageIndex;

			if (m.role === 'user' && isEditingThisUser) {
				return (
					<div ref={inlineResendRootRef} className="ref-msg-slot ref-msg-slot--composer">
						<ChatComposer
							{...sharedComposerProps}
							slot="inline"
							segments={inlineResendSegments}
							setSegments={setInlineResendSegments}
							canSend={canSendInlineResend}
							extraClass="ref-capsule--inline-edit"
							showGitBranchRow={false}
						/>
					</div>
				);
			}

			if (m.role === 'user') {
				const userSegs = cachedUserMessageToSegments(m.content, m.parts);

				return (
					<div className="ref-msg-slot ref-msg-slot--user">
						<button
							type="button"
							className="ref-msg-user"
							disabled={awaitingReply}
							title={awaitingReply ? t('app.userMsgGenerating') : t('app.userMsgEditHint')}
							onClick={() => {
								if (awaitingReply) {
									return;
								}
								onStartInlineResend(userMessageIndex, m.content, m.parts);
							}}
						>
							<UserMessageRich segments={userSegs} onFileClick={onOpenWorkspaceFile} />
						</button>
					</div>
				);
			}

			/**
			 * Agent / Plan 模式下「过程内容」已经被搬到 user 气泡正下方的 preflight row（见
			 * buildFlatMessageList），assistant 气泡只渲染 outcome（file_edit / 收尾总结等）。
			 * 其他场景（普通聊天、错误气泡、ask/debug 等）保持 'all' 整段渲染。
			 */
			const useAgentSplit =
				m.role === 'assistant' &&
				(composerMode === 'plan' ||
					composerMode === 'agent' ||
					assistantMessageUsesAgentToolProtocol(m.content)) &&
				!isChatAssistantErrorLine(m.content, t);
			const chatRenderMode: ComponentProps<typeof ChatMarkdown>['renderMode'] = useAgentSplit
				? 'outcome'
				: 'all';

			return (
				<div key={`a-${convoKey}-${i}`} className="ref-msg-slot ref-msg-slot--assistant">
					<div className="ref-msg-assistant-body">
						{pendingEmptyAssistant ? (
							<span className="ref-bubble-pending" aria-hidden>
								<span className="ref-bubble-pending-dot" />
								<span className="ref-bubble-pending-dot" />
								<span className="ref-bubble-pending-dot" />
							</span>
						) : (
							<ChatMarkdown
								content={m.content}
								agentUi={
									composerMode === 'plan' ||
									composerMode === 'agent' ||
									assistantMessageUsesAgentToolProtocol(m.content)
								}
								assistantBubbleVariant={
									m.role === 'assistant' && isChatAssistantErrorLine(m.content, t)
										? 'error'
										: 'default'
								}
								planUi={composerMode === 'plan'}
								workspaceRoot={workspace}
								onOpenAgentFile={onOpenAgentConversationFile}
								onRunCommand={onRunCommand}
								streamingToolPreview={agentOrPlanStreaming ? streamingToolPreview : null}
								showAgentWorking={agentOrPlanStreaming}
								hidePendingActivityTextCluster
								liveAgentBlocksState={agentOrPlanStreaming ? liveAssistantBlocks : null}
								liveThoughtMeta={agentOrPlanStreaming ? liveThoughtMeta : null}
								revertedPaths={revertedFiles}
								revertedChangeKeys={revertedChangeKeys}
								allowAgentFileActions={
									composerMode === 'agent' && !awaitingReply && i === lastAssistantMessageIndex
								}
								skipPlanTodo
								renderMode={chatRenderMode}
							/>
						)}
					</div>
				</div>
			);
	};

	/**
	 * 渲染挂在 user 气泡正下方的「过程区」独立行。
	 * 数据源是「下一条 assistant 消息」的 content + liveBlocks（如果该 assistant 是流式末条）。
	 * 不带 `data-msg-index`，不入 stickyUserIndex 体系；高度通过 `data-preflight-for` 由测量
	 * effect 写入 `preflightRowHeightsRef`，参与 latestTurnFocusSpacerPx。
	 */
	const renderPreflightRowForAssistant = (assistantIdx: number): ReactNode => {
		const m = displayMessages[assistantIdx];
		if (!m || m.role !== 'assistant') return null;
		if (composerMode === 'team' || composerMode === 'ask' || composerMode === 'debug') return null;
		if (isChatAssistantErrorLine(m.content, t)) return null;
		const useAgentSplit =
			composerMode === 'plan' ||
			composerMode === 'agent' ||
			assistantMessageUsesAgentToolProtocol(m.content);
		if (!useAgentSplit) return null;

		const { agentOrPlanStreaming, liveThoughtMeta } = computeAssistantRuntime(assistantIdx);

		// 完整复用 assistant 气泡的双层 DOM（slot + body），让浏览器自动产出与下方
		// assistant 气泡 .ref-md-root--agent-chat 完全相同的内容宽度，无须任何手动计算。
		return (
			<div
				key={`row-${conversationRenderKey}-preflight-${assistantIdx}`}
				className="ref-msg-row-measure ref-msg-preflight-row"
				data-preflight-for={String(assistantIdx)}
			>
				<div className="ref-msg-slot ref-msg-slot--assistant ref-msg-slot--preflight">
					<div className="ref-msg-assistant-body">
						<ChatMarkdown
							content={m.content}
							agentUi
							planUi={composerMode === 'plan'}
							workspaceRoot={workspace}
							onOpenAgentFile={onOpenAgentConversationFile}
							onRunCommand={onRunCommand}
							streamingToolPreview={agentOrPlanStreaming ? streamingToolPreview : null}
							showAgentWorking={agentOrPlanStreaming}
							hidePendingActivityTextCluster
							liveAgentBlocksState={agentOrPlanStreaming ? liveAssistantBlocks : null}
							liveThoughtMeta={agentOrPlanStreaming ? liveThoughtMeta : null}
							revertedPaths={revertedFiles}
							revertedChangeKeys={revertedChangeKeys}
							skipPlanTodo
							renderMode="preflight"
						/>
					</div>
				</div>
			</div>
		);
	};

	const buildFlatMessageList = (): ReactNode[] => {
		const t0 = import.meta.env.DEV ? performance.now() : 0;
		const nodes: ReactNode[] = [];
		const convoKey = conversationRenderKey;
		for (let i = messageStartIndex; i < displayMessages.length; i++) {
			const isStickyUserRow = i === stickyUserIndex;
			const m = displayMessages[i]!;
			// assistant 之前如有 preflight 内容，先插入一条独立 preflight row（贴在前一条 user 下方）
			if (m.role === 'assistant') {
				const preflightNode = renderPreflightRowForAssistant(i);
				if (preflightNode) nodes.push(preflightNode);
			}
			nodes.push(
				<div
					key={`row-${convoKey}-${i}`}
					className={`ref-msg-row-measure${isStickyUserRow ? ' ref-msg-sticky-user-wrap' : ''}`}
					data-msg-index={String(i)}
				>
					{messageNodeAtIndex(i)}
				</div>
			);
		}
		if (import.meta.env.DEV) {
			const elapsed = performance.now() - t0;
			if (elapsed > 12) {
				console.log(
					`[perf] renderChatMessageList: ${elapsed.toFixed(1)}ms, slice=${nodes.length}/${displayMessages.length}, awaiting=${awaitingReply}`
				);
			}
		}
		if (latestTurnFocusSpacerPx > 0) {
			nodes.push(
				<div
					key={`row-${convoKey}-turn-focus-tail`}
					className="ref-messages-tail-spacer"
					style={{ height: `${latestTurnFocusSpacerPx}px` }}
					aria-hidden
				/>
			);
		}
		return nodes;
	};

	const buildTeamLeaderRow = (contentOverride?: string, rowIndex = displayMessages.length): ReactNode | null => {
		if (!teamSession || composerMode !== 'team' || !hasConversation) {
			return null;
		}
		const workflow = teamSession.leaderWorkflow;
		const content = contentOverride ?? teamSession.leaderMessage ?? '';
		const lastAssistantContent =
			[...displayMessages].reverse().find((message) => message.role === 'assistant')?.content?.trim() || '';
		const hasLiveBlocks = (workflow?.liveBlocks.blocks.length ?? 0) > 0;
		const isBootstrapping = awaitingReply && !workflow && !content.trim();
		const isWorking = Boolean(workflow?.awaitingReply) || isBootstrapping;
		const hideAsDuplicateTerminalReply =
			teamSession.phase === 'delivering' &&
			teamSession.tasks.length === 0 &&
			lastAssistantContent.length > 0 &&
			lastAssistantContent === content.trim();
		if (!content.trim() && !isWorking && !hasLiveBlocks) {
			return null;
		}
		if (hideAsDuplicateTerminalReply) {
			return null;
		}
		const liveThoughtMeta =
			isWorking || workflow?.streamingThinking
				? {
						phase: (workflow?.streaming?.trim() ? 'streaming' : 'thinking') as 'thinking' | 'streaming' | 'done',
						elapsedSeconds: 0,
						streamingThinking: workflow?.streamingThinking ?? '',
						tokenUsage: workflow?.lastTurnUsage ?? null,
					}
				: null;

		return (
			<div
				key={`row-${conversationRenderKey}-team-leader`}
				className="ref-msg-row-measure ref-msg-row-measure--team-leader"
				data-msg-index={String(rowIndex)}
			>
				<div className="ref-msg-slot ref-msg-slot--assistant">
					<div className="ref-msg-assistant-body">
						<ChatMarkdown
							content={content}
							agentUi
							workspaceRoot={workspace}
							onOpenAgentFile={onOpenAgentConversationFile}
							onRunCommand={onRunCommand}
							showAgentWorking={isWorking}
							hidePendingActivityTextCluster
							liveAgentBlocksState={workflow?.liveBlocks ?? null}
							liveThoughtMeta={liveThoughtMeta}
							revertedPaths={revertedFiles}
							revertedChangeKeys={revertedChangeKeys}
							skipPlanTodo
						/>
					</div>
				</div>
			</div>
		);
	};

	const buildHistoricalTeamLeaderRow = (
		content: string,
		rowKey: string,
		rowIndex: number
	): ReactNode => (
		<div
			key={`row-${conversationRenderKey}-${rowKey}`}
			className="ref-msg-row-measure ref-msg-row-measure--team-leader"
			data-msg-index={String(rowIndex)}
		>
			<div className="ref-msg-slot ref-msg-slot--assistant">
				<div className="ref-msg-assistant-body">
					<ChatMarkdown
						content={content}
						agentUi
						workspaceRoot={workspace}
						onOpenAgentFile={onOpenAgentConversationFile}
						onRunCommand={onRunCommand}
						hidePendingActivityTextCluster
						revertedPaths={revertedFiles}
						revertedChangeKeys={revertedChangeKeys}
						skipPlanTodo
					/>
				</div>
			</div>
		</div>
	);

	const buildTeamTaskRow = (
		item: {
			id: string;
			roleType: Parameters<typeof TeamRoleAvatar>[0]['roleType'];
			expertAssignmentKey?: string;
			roleKind: 'specialist' | 'reviewer';
			expertName: string;
			description: string;
			acceptanceCriteria?: string[];
			status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'revision';
		},
		rowIndex: number
	): ReactNode => (
		<div
			key={`row-${conversationRenderKey}-team-item-${item.id}`}
			className="ref-msg-row-measure ref-msg-row-measure--team-item"
			data-msg-index={String(rowIndex)}
		>
			<div className="ref-msg-slot ref-msg-slot--assistant ref-msg-slot--team-item">
				<button
					type="button"
					className={`ref-team-timeline-item ${teamSession?.selectedTaskId === item.id ? 'is-active' : ''}`}
					onClick={() => onSelectTeamExpert(item.id)}
				>
					<TeamRoleAvatar roleType={item.roleType} assignmentKey={item.expertAssignmentKey} />
					<span className="ref-team-timeline-item-copy">
						<span className="ref-team-timeline-item-meta">{t(`team.timeline.role.${item.roleKind}`)}</span>
						<span className="ref-team-timeline-item-title">{item.expertName}</span>
						<span className="ref-team-timeline-item-body">{item.description}</span>
						{item.acceptanceCriteria && item.acceptanceCriteria.length > 0 ? (
							<ul className="ref-team-timeline-item-criteria">
								{item.acceptanceCriteria.map((criterion, idx) => (
									<li key={idx}>{criterion}</li>
								))}
							</ul>
						) : null}
					</span>
					<span className={`ref-team-expert-status ref-team-expert-status--${item.status}`}>
						{item.status === 'in_progress' ? <span className="ref-team-pulse" /> : null}
						{t(`team.timeline.status.${item.status}`)}
					</span>
				</button>
			</div>
		</div>
	);

	const buildTeamTimelineRows = (): ReactNode[] => {
		const nodes = buildFlatMessageList();
		if (!teamSession || composerMode !== 'team' || !hasConversation) {
			return nodes;
		}
		const teamTimeline = buildTeamConversationTimeline(teamSession, displayMessages);
		let syntheticIndex = displayMessages.length;
		const nextSyntheticIndex = () => syntheticIndex++;
		const timelineRows = teamTimeline.entries.map((entry) => {
			if (entry.kind === 'leader_message') {
				return buildHistoricalTeamLeaderRow(entry.content, entry.id, nextSyntheticIndex());
			}
			if (entry.kind === 'plan_proposal') {
				return (
					<div
						key={`row-${conversationRenderKey}-${entry.id}`}
						className="ref-msg-row-measure ref-msg-row-measure--team-plan"
						data-msg-index={String(nextSyntheticIndex())}
					>
						<div className="ref-msg-slot ref-msg-slot--assistant ref-msg-slot--team-plan">
							<TeamPlanReviewPanel
								proposal={entry.proposal}
								hideSummary={entry.hideSummary}
								onApprove={(fb) => onTeamPlanApprove(entry.proposal.proposalId, fb)}
								onReject={(fb) => onTeamPlanReject(entry.proposal.proposalId, fb)}
							/>
						</div>
					</div>
				);
			}
			if (entry.kind === 'plan_revision') {
				return (
					<div
						key={`row-${conversationRenderKey}-${entry.id}`}
						className="ref-msg-row-measure ref-msg-row-measure--team-plan"
						data-msg-index={String(nextSyntheticIndex())}
					>
						<div className="ref-msg-slot ref-msg-slot--assistant ref-msg-slot--team-plan">
							<TeamPlanRevisionCard revision={entry.revision} />
						</div>
					</div>
				);
			}
			return buildTeamTaskRow(entry.item, nextSyntheticIndex());
		});
		const currentLeaderRow = buildTeamLeaderRow(teamTimeline.currentLeaderMessage, nextSyntheticIndex());
		const isTrailingDeliveryMessage =
			!awaitingReply &&
			lastAssistantMessageIndex === displayMessages.length - 1 &&
			lastAssistantMessageIndex >= messageStartIndex &&
			displayMessages[displayMessages.length - 1]?.role === 'assistant';

		if (isTrailingDeliveryMessage) {
			const trailingAssistant = nodes.pop();
			nodes.push(...timelineRows);
			if (currentLeaderRow) {
				nodes.push(currentLeaderRow);
			}
			if (trailingAssistant) {
				nodes.push(trailingAssistant);
			}
			return nodes;
		}

		nodes.push(...timelineRows);
		if (currentLeaderRow) {
			nodes.push(currentLeaderRow);
		}
		return nodes;
	};

	const dataTransferHasFiles = (dt: DataTransfer | null): boolean => !!dt?.types?.includes('Files');

	const onChatPanelDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		e.preventDefault();
		dropDepthRef.current += 1;
		setChatPanelFileDragOver(true);
	};

	const onChatPanelDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		e.preventDefault();
		dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
		if (dropDepthRef.current === 0) {
			setChatPanelFileDragOver(false);
		}
	};

	const onChatPanelDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	};

	const onChatPanelDrop = (e: React.DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		e.preventDefault();
		dropDepthRef.current = 0;
		setChatPanelFileDragOver(false);
		const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.size > 0);
		if (files.length === 0) {
			return;
		}
		void onChatPanelDropFiles(files);
	};

	const onChatPanelDropCapture = (e: React.DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		dropDepthRef.current = 0;
		setChatPanelFileDragOver(false);
	};

	const messagesEl = hasConversation ? (
		<div className="ref-messages" ref={messagesViewportRef} onScroll={onMessagesScroll}>
			<div
				key={`messages-track-${conversationRenderKey}`}
				className="ref-messages-track"
				ref={messagesTrackRef}
			>
				{!allHistoryRendered ? (
					<div
						ref={messagesTopSentinelRef}
						className="ref-messages-top-sentinel"
						aria-hidden
					/>
				) : null}
				{composerMode === 'team' ? buildTeamTimelineRows() : buildFlatMessageList()}
			</div>
		</div>
	) : null;

	const editorRailHeroComposer =
		isEditorRail && !hasConversation ? (
			<ChatComposer
				{...sharedComposerProps}
				slot="hero"
				variant="editor-hero"
				segments={composerSegments}
				setSegments={setComposerSegments}
				canSend={canSendComposer}
				showGitBranchRow={false}
			/>
		) : null;

	const editorContextStrip = isEditorRail ? (
		<div className="ref-editor-rail-context-strip">
			<IconDoc className="ref-context-icon" />
			<span className="ref-editor-rail-context-local">{t('app.editorChatContextLocal')}</span>
			<IconChevron className="ref-editor-rail-context-chev" aria-hidden />
			<span className="ref-editor-rail-context-path" title={workspace ?? undefined}>
				{workspace ? workspaceBasename : t('app.noWorkspace')}
			</span>
		</div>
	) : null;

	const sharedOverlays = (
		<>
			{hasConversation && pendingAgentPatches.length > 0 ? (
				<AgentReviewPanel
					patches={pendingAgentPatches}
					workspaceRoot={workspace}
					busy={agentReviewBusy}
					onOpenFile={(rel, line, end, options) =>
						onOpenAgentConversationFile(rel, line, end, {
							...options,
							allowReviewActions: true,
						})
					}
					onApplyOne={onApplyAgentPatchOne}
					onApplyAll={onApplyAgentPatchesAll}
					onDiscard={onDiscardAgentReview}
				/>
			) : null}

			{hasConversation && planQuestion && (composerMode === 'plan' || composerMode === 'team') ? (
				<PlanQuestionDialog
					question={planQuestion}
					onSubmit={onPlanQuestionSubmit}
					onSkip={onPlanQuestionSkip}
				/>
			) : null}
			{hasConversation && userInputRequest ? (
				<UserInputRequestDialog request={userInputRequest} onSubmit={onUserInputSubmit} />
			) : null}

			{wizardPending?.kind === 'create-skill' ? (
				<SkillScopeDialog
					workspaceOpen={!!workspace}
					onCancel={() => setWizardPending(null)}
					onConfirm={(scope) => {
						const p = wizardPending;
						setWizardPending(null);
						if (p?.kind === 'create-skill') {
							void executeSkillCreatorSend(scope, p);
						}
					}}
				/>
			) : null}
			{wizardPending?.kind === 'create-rule' ? (
				<RuleWizardDialog
					onCancel={() => setWizardPending(null)}
					onConfirm={(ruleScope, globPattern) => {
						const p = wizardPending;
						setWizardPending(null);
						if (p?.kind === 'create-rule') {
							void executeRuleWizardSend(ruleScope, globPattern, p);
						}
					}}
				/>
			) : null}
			{wizardPending?.kind === 'create-subagent' ? (
				<SubagentScopeDialog
					workspaceOpen={!!workspace}
					onCancel={() => setWizardPending(null)}
					onConfirm={(scope) => {
						const p = wizardPending;
						setWizardPending(null);
						if (p?.kind === 'create-subagent') {
							void executeSubagentWizardSend(scope, p);
						}
					}}
				/>
			) : null}

			<AgentMistakeLimitDialog
				open={mistakeLimitRequest !== null}
				payload={mistakeLimitRequest}
				onContinue={() => void respondMistakeLimit('continue')}
				onStop={() => void respondMistakeLimit('stop')}
				onSendHint={(hint) => void respondMistakeLimit('hint', hint)}
				title={t('agent.mistakeLimit.title')}
				body={
					mistakeLimitRequest
						? t('agent.mistakeLimit.body', {
								count: mistakeLimitRequest.consecutiveFailures,
								threshold: mistakeLimitRequest.threshold,
							})
						: ''
				}
				continueLabel={t('agent.mistakeLimit.continue')}
				stopLabel={t('agent.mistakeLimit.stop')}
				hintFieldLabel={t('agent.mistakeLimit.hintField')}
				sendHintLabel={t('agent.mistakeLimit.sendHint')}
				hintPlaceholder={t('agent.mistakeLimit.hintPlaceholder')}
			/>

			{isEditorRail &&
			hasConversation &&
			agentPlanEffectivePlan &&
			composerMode === 'plan' &&
			!editorPlanReviewDismissed ? (
				<PlanReviewPanel
					plan={agentPlanEffectivePlan}
					planFileDisplayPath={planFileRelPath ?? planFilePath}
					initialBuildModelId={defaultModel}
					modelItems={modelPickerItems}
					planBuilt={planReviewIsBuilt}
					buildDisabled={awaitingReply}
					onBuild={onPlanBuild}
					onClose={onPlanReviewClose}
					onTodoToggle={onPlanTodoToggle}
				/>
			) : null}
		</>
	);

	const commandStack = (
		<div className="ref-command-stack">
			{toolApprovalRequest ? (
				<ToolApprovalInlineCard
					payload={toolApprovalRequest}
					onAllow={() => void respondToolApproval(true)}
					onDeny={() => void respondToolApproval(false)}
					title={
						toolApprovalRequest.toolName === 'Bash'
							? t('agent.toolApproval.titleShell')
							: t('agent.toolApproval.titleWrite')
					}
					allowLabel={t('agent.toolApproval.allow')}
					denyLabel={t('agent.toolApproval.deny')}
				/>
			) : null}
			{hasConversation &&
			(composerMode === 'agent' || composerMode === 'team') &&
			agentFileChanges.length > 0 &&
			!awaitingReply &&
			!fileChangesDismissed ? (
				<AgentFileChangesPanel
					files={agentFileChanges}
					onOpenFile={(rel, line, end, options) =>
						onOpenAgentConversationFile(rel, line, end, {
							...options,
							allowReviewActions: true,
						})
					}
					onKeepAll={onKeepAllEdits}
					onRevertAll={() => void onRevertAllEdits()}
					onKeepFile={(rel) => void onKeepFileEdit(rel)}
					onRevertFile={(rel) => void onRevertFileEdit(rel)}
				/>
			) : null}
			{hasConversation ? (
				<div
					className={`ref-scroll-jump-anchor ${showScrollToBottomButton ? 'is-visible' : ''}`}
					aria-hidden={!showScrollToBottomButton}
				>
					<button
						type="button"
						className="ref-scroll-jump-btn"
						tabIndex={showScrollToBottomButton ? 0 : -1}
						title={t('app.jumpToLatest')}
						aria-label={t('app.jumpToLatest')}
						onClick={() => scrollMessagesToBottom('smooth')}
					>
						<IconArrowDown className="ref-scroll-jump-btn-icon" />
					</button>
				</div>
			) : null}
			{!isEditorRail ? agentPlanSummaryCard : null}
			{hasConversation && renderedBottomTodos.length > 0 ? (
				<AgentBottomTodoPanel
					t={t}
					todos={renderedBottomTodos}
					isCollapsed={bottomTodoCollapsed}
					onToggle={toggleBottomTodoCollapsed}
					layoutMode={bottomTodoLockedMode ?? 'overlay'}
					isLeaving={bottomTodoLeaving}
				/>
			) : null}
			{hasConversation || !isEditorRail ? (
				<ChatComposer
					{...sharedComposerProps}
					slot="bottom"
					segments={composerSegments}
					setSegments={setComposerSegments}
					canSend={canSendComposer}
					showGitBranchRow={!isEditorRail}
				/>
			) : null}
		</div>
	);

	if (isEditorRail) {
		return (
			<>
				<div
					className={`ref-chat-drop-zone ${chatPanelFileDragOver ? 'is-file-drag-over' : ''}`}
					onDragEnter={onChatPanelDragEnter}
					onDragLeave={onChatPanelDragLeave}
					onDragOver={onChatPanelDragOver}
					onDropCapture={onChatPanelDropCapture}
					onDrop={onChatPanelDrop}
				>
					<div className="ref-editor-chat-body">
						{!hasConversation ? (
							<>
								{editorRailHeroComposer}
								{editorContextStrip}
								<div className="ref-editor-rail-message-spring" aria-hidden />
							</>
						) : (
							<>
								{editorContextStrip}
								{messagesEl}
							</>
						)}
					</div>
					{sharedOverlays}
					{commandStack}
				</div>
			</>
		);
	}

	return (
		<>
			<div
				className={`ref-chat-drop-zone ${chatPanelFileDragOver ? 'is-file-drag-over' : ''}`}
				onDragEnter={onChatPanelDragEnter}
				onDragLeave={onChatPanelDragLeave}
				onDragOver={onChatPanelDragOver}
				onDropCapture={onChatPanelDropCapture}
				onDrop={onChatPanelDrop}
			>
				{messagesEl}
				{!hasConversation ? <div className="ref-hero-spacer" /> : null}
				{sharedOverlays}
				{commandStack}
			</div>
		</>
	);
});
