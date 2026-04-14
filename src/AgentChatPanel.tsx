import {
	Fragment,
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
import { ChatComposer } from './ChatComposer';
import { PlanQuestionDialog } from './PlanQuestionDialog';
import { SkillScopeDialog } from './SkillScopeDialog';
import { RuleWizardDialog } from './RuleWizardDialog';
import { SubagentScopeDialog } from './SubagentScopeDialog';
import { ToolApprovalInlineCard, type ToolApprovalPayload } from './ToolApprovalCard';
import { AgentMistakeLimitDialog, type MistakeLimitPayload } from './AgentMistakeLimitDialog';
import { PlanReviewPanel } from './PlanReviewPanel';
import { TeamPlanReviewPanel } from './TeamPlanReviewPanel';
import { ComposerThoughtBlock } from './ComposerThoughtBlock';
import { UserMessageRich } from './UserMessageRich';
import {
	assistantMessageUsesAgentToolProtocol,
	extractLastTodosFromContent,
	segmentAssistantContentUnified,
} from './agentChatSegments';
import { computeMergedAgentFileChanges } from './agentFileChangesCompute';
import { useAppShellGitFiles, useAppShellGitMeta } from './app/appShellContexts';
import { userMessageToSegments, type ComposerSegment } from './composerSegments';
import type { WizardPending } from './hooks/useWizardPending';
import type { TFunction } from './i18n';
import { isChatAssistantErrorLine } from './i18n';
import { type AgentPendingPatch, type TurnTokenUsage } from './ipcTypes';
import { extractTodosFromLiveBlocks, type LiveAgentBlocksState } from './liveAgentBlocks';
import { IconArrowDown, IconChevron, IconDoc } from './icons';
import { type ParsedPlan, type PlanQuestion } from './planParser';
import { type ChatMessage } from './threadTypes';
import type { TeamSessionState } from './hooks/useTeamSession';
import { buildTeamWorkflowItems } from './teamWorkflowItems';

type SharedComposerProps = Omit<
	ComponentProps<typeof ChatComposer>,
	'slot' | 'variant' | 'segments' | 'setSegments' | 'canSend' | 'extraClass' | 'showGitBranchRow'
>;

export type AgentChatPanelProps = {
	layout?: 'agent-center' | 'editor-rail';
	t: TFunction;
	hasConversation: boolean;
	displayMessages: ChatMessage[];
	persistedMessageCount: number;
	messagesThreadId: string | null;
	currentId: string | null;
	lastAssistantMessageIndex: number;
	lastUserMessageIndex: number;
	messagesViewportRef: RefObject<HTMLDivElement | null>;
	messagesTrackRef: RefObject<HTMLDivElement | null>;
	inlineResendRootRef: RefObject<HTMLDivElement | null>;
	onMessagesScroll: () => void;
	awaitingReply: boolean;
	thinkingTickRef: React.RefObject<number>;
	streamStartedAtRef: RefObject<number | null>;
	firstTokenAtRef: RefObject<number | null>;
	thoughtSecondsByThread: Record<string, number>;
	lastTurnUsage: TurnTokenUsage | null;
	composerMode: ComponentProps<typeof ChatComposer>['composerMode'];
	streaming: string;
	streamingThinking: string;
	streamingToolPreview: ComponentProps<typeof ChatMarkdown>['streamingToolPreview'];
	liveAssistantBlocks: LiveAgentBlocksState;
	workspace: string | null;
	workspaceBasename: string;
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
	onStartInlineResend: (userMessageIndex: number, content: string) => void;
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
	displayMessages,
	persistedMessageCount,
	messagesThreadId,
	currentId,
	lastAssistantMessageIndex,
	lastUserMessageIndex,
	messagesViewportRef,
	messagesTrackRef,
	inlineResendRootRef,
	onMessagesScroll,
	awaitingReply,
	thinkingTickRef,
	streamStartedAtRef,
	firstTokenAtRef,
	thoughtSecondsByThread,
	lastTurnUsage,
	composerMode,
	streaming,
	streamingThinking,
	streamingToolPreview,
	liveAssistantBlocks,
	workspace,
	workspaceBasename,
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
}: AgentChatPanelProps) {
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
	const cachedUserMessageToSegments = (content: string): ComposerSegment[] => {
		const cache = userSegsCacheRef.current;
		const cached = cache.get(content);
		if (cached) return cached;
		const result = userMessageToSegments(content);
		cache.set(content, result);
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
				segmentCacheRef
			),
		[displayMessages, composerMode, t, dismissedFiles, gitStatusOk, gitChangedPaths, diffPreviews]
	);

	const isEditorRail = layout === 'editor-rail';
	const [collapsedTodos, setCollapsedTodos] = useState<Set<number>>(new Set());
	const toggleTodoCollapse = useCallback((msgIndex: number) => {
		setCollapsedTodos(prev => {
			const next = new Set(prev);
			if (next.has(msgIndex)) next.delete(msgIndex);
			else next.add(msgIndex);
			return next;
		});
	}, []);
	const conversationRenderKey = messagesThreadId ?? 'no-thread';
	const trackGapPx = isEditorRail ? 20 : 22;
	const messageRowHeightsRef = useRef<Map<number, number>>(new Map());
	const [messageStartIndex, setMessageStartIndex] = useState(0);
	const messagesTopSentinelRef = useRef<HTMLDivElement | null>(null);
	const pendingPrependScrollRef = useRef<{ prevScrollHeight: number } | null>(null);
	const prevDisplayMessagesLenRef = useRef(displayMessages.length);
	const prevConversationForLenRef = useRef<string | null>(null);

	const getRowHeightForBudget = useCallback(
		(i: number) => messageRowHeightsRef.current.get(i) ?? ESTIMATED_MESSAGE_ROW_PX,
		[]
	);

	const len = displayMessages.length;
	const allHistoryRendered = messageStartIndex <= 0;
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

	const messageNodeAtIndex = (i: number): ReactNode => {
			const m = displayMessages[i];
			if (!m) {
				return null;
			}
			const convoKey = conversationRenderKey;
			const isLast = i === displayMessages.length - 1;
			const stAt = streamStartedAtRef.current;
			const ftAt = firstTokenAtRef.current;
			const showLiveThought = isLast && m.role === 'assistant' && awaitingReply && composerMode !== 'team';
			const agentOrPlanStreaming =
				(composerMode === 'agent' || composerMode === 'plan') && awaitingReply && isLast;
			const frozenSec =
				!awaitingReply && isLast && m.role === 'assistant' && currentId
					? thoughtSecondsByThread[currentId]
					: undefined;

			let thoughtBlock: ReactNode = null;
			let liveThoughtMeta: ComponentProps<typeof ChatMarkdown>['liveThoughtMeta'] = null;
			let thoughtAfterBody = false;
			if (showLiveThought && stAt) {
				void thinkingTickRef.current; // 读取 ref 以建立依赖
				const assistantTurnHasOutput =
					streaming.trim().length > 0 ||
					streamingToolPreview != null ||
					(agentOrPlanStreaming && liveAssistantBlocks.blocks.length > 0);
				const phase = assistantTurnHasOutput ? 'streaming' : 'thinking';
				thoughtAfterBody =
					assistantTurnHasOutput && composerMode !== 'ask' && composerMode !== 'debug';
				const elapsed =
					phase === 'thinking'
						? Math.max(0, (Date.now() - stAt) / 1000)
						: ftAt
							? Math.max(0, (ftAt - stAt) / 1000)
							: Math.max(0, (Date.now() - stAt) / 1000);
				if (agentOrPlanStreaming) {
					liveThoughtMeta = {
						phase,
						elapsedSeconds: elapsed,
						streamingThinking,
					};
				} else {
					thoughtBlock = (
						<ComposerThoughtBlock
							phase={phase}
							elapsedSeconds={elapsed}
							streamingThinking={streamingThinking}
						/>
					);
				}
			} else if (frozenSec != null) {
				thoughtAfterBody = true;
				thoughtBlock = (
					<ComposerThoughtBlock
						phase="done"
						elapsedSeconds={frozenSec}
						tokenUsage={isLast ? lastTurnUsage : undefined}
					/>
				);
			}

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
				const inner = (
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
				return i === lastUserMessageIndex ? (
					<div key={`u-edit-${convoKey}-${i}`} className="ref-msg-sticky-user-wrap">
						{inner}
					</div>
				) : (
					<Fragment key={`u-edit-${convoKey}-${i}`}>{inner}</Fragment>
				);
			}

			if (m.role === 'user') {
				const userSegs = cachedUserMessageToSegments(m.content);

				// Look ahead: does the next assistant message contain TodoWrite?
				const nextMsg = displayMessages[i + 1];
				const isNextAssistantStreaming = nextMsg?.role === 'assistant' && (i + 1) === displayMessages.length - 1 && awaitingReply;
				const userTodos = nextMsg?.role === 'assistant'
					? (isNextAssistantStreaming && liveAssistantBlocks
						? (extractTodosFromLiveBlocks(liveAssistantBlocks.blocks) ??
								(typeof nextMsg.content === 'string' ? extractLastTodosFromContent(nextMsg.content) : null))
						: typeof nextMsg.content === 'string'
							? extractLastTodosFromContent(nextMsg.content)
							: null)
					: null;
				const hasTodoPanel = userTodos != null && userTodos.length > 0;

				const inner = (
					<div className={`ref-msg-slot ref-msg-slot--user${hasTodoPanel ? ' has-todo-panel' : ''}`}>
						<button
							type="button"
							className="ref-msg-user"
							disabled={awaitingReply}
							title={awaitingReply ? t('app.userMsgGenerating') : t('app.userMsgEditHint')}
							onClick={() => {
								if (awaitingReply) {
									return;
								}
								onStartInlineResend(userMessageIndex, m.content);
							}}
						>
							<UserMessageRich segments={userSegs} onFileClick={onOpenWorkspaceFile} />
						</button>
						{hasTodoPanel && (() => {
							const doneCount = userTodos!.filter(td => td.status === 'completed').length;
							const allDone = doneCount === userTodos!.length;
							const userToggled = collapsedTodos.has(i);
							const isCollapsed = userToggled ? !allDone : allDone;
							return (
								<div className="ref-plan-review-todos ref-agent-todo-panel">
									<button
										type="button"
										className="ref-plan-review-todos-head"
										onClick={(e) => { e.stopPropagation(); toggleTodoCollapse(i); }}
									>
										<span>{t('plan.review.todo', { done: doneCount, total: userTodos!.length })}</span>
										<svg className={`ref-plan-review-chev${isCollapsed ? '' : ' is-open'}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
											<path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
										</svg>
									</button>
									{!isCollapsed && (
										<div className="ref-plan-review-todos-list">
											{userTodos!.map((todo) => {
												const done = todo.status === 'completed';
												const active = todo.status === 'in_progress';
												return (
													<div key={todo.id} className={`ref-plan-todo ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
														{active ? (
															<span className="ref-plan-todo-spinner" aria-hidden />
														) : (
															<svg className="ref-plan-todo-check" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
																<rect
																	x="1" y="1" width="14" height="14" rx="3"
																	stroke="currentColor"
																	strokeWidth="1.5"
																	fill={done ? 'currentColor' : 'none'}
																/>
																{done ? (
																	<path d="M4.5 8l2.5 2.5 4.5-5" stroke="var(--void-bg-3, #1a1a1a)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
																) : null}
															</svg>
														)}
														<span className="ref-plan-todo-text">
															{active && todo.activeForm ? todo.activeForm : todo.content}
														</span>
													</div>
												);
											})}
										</div>
									)}
								</div>
							);
						})()}
					</div>
				);
				return i === lastUserMessageIndex ? (
					<div key={`u-${convoKey}-${i}`} className="ref-msg-sticky-user-wrap">
						{inner}
					</div>
				) : (
					<Fragment key={`u-${convoKey}-${i}`}>{inner}</Fragment>
				);
			}

			return (
				<div key={`a-${convoKey}-${i}`} className="ref-msg-slot ref-msg-slot--assistant">
					{thoughtBlock && !thoughtAfterBody ? thoughtBlock : null}
					{/* TODO panel moved to user message bubble */}
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
								liveAgentBlocksState={agentOrPlanStreaming ? liveAssistantBlocks : null}
								liveThoughtMeta={agentOrPlanStreaming ? liveThoughtMeta : null}
								revertedPaths={revertedFiles}
								revertedChangeKeys={revertedChangeKeys}
								allowAgentFileActions={
									composerMode === 'agent' && !awaitingReply && i === lastAssistantMessageIndex
								}
								skipPlanTodo
							/>
						)}
					</div>
					{thoughtBlock && thoughtAfterBody ? thoughtBlock : null}
				</div>
			);
	};

	const buildFlatMessageList = (): ReactNode[] => {
		const t0 = import.meta.env.DEV ? performance.now() : 0;
		const nodes: ReactNode[] = [];
		const convoKey = conversationRenderKey;
		for (let i = messageStartIndex; i < displayMessages.length; i++) {
			nodes.push(
				<div
					key={`row-${convoKey}-${i}`}
					className="ref-msg-row-measure"
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
		return nodes;
	};

	const buildTeamLeaderRow = (): ReactNode | null => {
		if (!teamSession || composerMode !== 'team' || !hasConversation) {
			return null;
		}
		const workflow = teamSession.leaderWorkflow;
		const content = teamSession.leaderMessage || '';
		const hasLiveBlocks = (workflow?.liveBlocks.blocks.length ?? 0) > 0;
		const isBootstrapping = awaitingReply && !workflow && !content.trim();
		const isWorking = Boolean(workflow?.awaitingReply) || isBootstrapping;
		if (!content.trim() && !isWorking && !hasLiveBlocks) {
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
				data-msg-index={String(displayMessages.length)}
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

	const buildTeamTimelineRows = (): ReactNode[] => {
		const nodes = buildFlatMessageList();
		if (!teamSession || composerMode !== 'team' || !hasConversation) {
			return nodes;
		}
		const workflowItems = buildTeamWorkflowItems(teamSession);
		const leaderRow = buildTeamLeaderRow();
		const planProposal = teamSession.planProposal;
		const planProposalRow: ReactNode | null = planProposal ? (
			<div
				key={`row-${conversationRenderKey}-team-plan-proposal`}
				className="ref-msg-row-measure ref-msg-row-measure--team-plan"
				data-msg-index={String(displayMessages.length)}
			>
				<div className="ref-msg-slot ref-msg-slot--assistant ref-msg-slot--team-plan">
					<TeamPlanReviewPanel
						proposal={planProposal}
						onApprove={(fb) => onTeamPlanApprove(planProposal.proposalId, fb)}
						onReject={(fb) => onTeamPlanReject(planProposal.proposalId, fb)}
					/>
				</div>
			</div>
		) : null;
		const timelineItemRows = workflowItems.map((item, idx) => (
			<div
				key={`row-${conversationRenderKey}-team-item-${item.id}`}
				className="ref-msg-row-measure ref-msg-row-measure--team-item"
				data-msg-index={String(displayMessages.length + 1 + idx)}
			>
				<div className="ref-msg-slot ref-msg-slot--assistant ref-msg-slot--team-item">
					<button
						type="button"
						className={`ref-team-timeline-item ${teamSession.selectedTaskId === item.id ? 'is-active' : ''}`}
						onClick={() => onSelectTeamExpert(item.id)}
					>
						<span className={`ref-team-expert-avatar ref-team-expert-avatar--${item.roleType}`}>
							{item.expertName.slice(0, 1).toUpperCase()}
						</span>
						<span className="ref-team-timeline-item-copy">
							<span className="ref-team-timeline-item-meta">
								{t(`team.timeline.role.${item.roleKind}`)}
							</span>
							<span className="ref-team-timeline-item-title">{item.expertName}</span>
							<span className="ref-team-timeline-item-body">{item.description}</span>
						</span>
						<span className={`ref-team-expert-status ref-team-expert-status--${item.status}`}>
							{item.status === 'in_progress' ? <span className="ref-team-pulse" /> : null}
							{t(`team.timeline.status.${item.status}`)}
						</span>
					</button>
				</div>
			</div>
		));
		const isTrailingDeliveryMessage =
			!awaitingReply &&
			lastAssistantMessageIndex === displayMessages.length - 1 &&
			lastAssistantMessageIndex >= messageStartIndex &&
			displayMessages[displayMessages.length - 1]?.role === 'assistant';

		if (isTrailingDeliveryMessage) {
			const trailingAssistant = nodes.pop();
			if (leaderRow) {
				nodes.push(leaderRow);
			}
			if (planProposalRow) {
				nodes.push(planProposalRow);
			}
			nodes.push(...timelineItemRows);
			if (trailingAssistant) {
				nodes.push(trailingAssistant);
			}
			return nodes;
		}

		if (leaderRow) {
			nodes.push(leaderRow);
		}
		if (planProposalRow) {
			nodes.push(planProposalRow);
		}
		nodes.push(...timelineItemRows);
		return nodes;
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

			{hasConversation && planQuestion && composerMode === 'plan' ? (
				<PlanQuestionDialog
					question={planQuestion}
					onSubmit={onPlanQuestionSubmit}
					onSkip={onPlanQuestionSkip}
				/>
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
			composerMode === 'agent' &&
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
			</>
		);
	}

	return (
		<>
			{messagesEl}
			{!hasConversation ? <div className="ref-hero-spacer" /> : null}
			{sharedOverlays}
			{commandStack}
		</>
	);
});
