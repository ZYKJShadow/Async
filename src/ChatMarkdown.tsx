import { Fragment, memo, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentActivityGroup } from './AgentActivityGroup';
import { AgentPreflightShell } from './AgentPreflightShell';
import { PreflightThinkingItem } from './PreflightThinkingItem';
import { AnimatedHeightReveal } from './AnimatedHeightReveal';
import { AgentCommandCard } from './AgentCommandCard';
import { AgentDiffCard } from './AgentDiffCard';
import { AgentStreamingFenceCard } from './AgentStreamingFenceCard';
import { AgentEditCard } from './AgentEditCard';
import { AgentResultCard } from './AgentResultCard';
import { ComposerThoughtBlock } from './ComposerThoughtBlock';
import {
	buildStreamingToolSegments,
	fileEditChangeKey,
	segmentAssistantContentUnified,
	type AssistantSegment,
	type StreamingToolPreview,
} from './agentChatSegments';
import { useI18n } from './i18n';
import type { TurnTokenUsage } from './ipcTypes';
import { liveBlocksToAssistantSegments, type LiveAgentBlocksState } from './liveAgentBlocks';

type ThinkingSegment = Extract<AssistantSegment, { type: 'thinking' }>;
type RenderUnit =
	| Exclude<AssistantSegment, { type: 'thinking' }>
	| { type: 'thinking_group'; chunks: ThinkingSegment[] };

function thinkingGroupRenderMeta(
	chunks: ThinkingSegment[],
	liveThoughtMeta: Props['liveThoughtMeta']
): { phase: 'thinking' | 'streaming' | 'done'; elapsedSeconds: number } {
	const fallbackPhase = liveThoughtMeta?.phase ?? 'thinking';
	const fallbackElapsed = liveThoughtMeta?.elapsedSeconds ?? 0;
	const startedAt = chunks.find((chunk) => typeof chunk.startedAt === 'number')?.startedAt;
	if (startedAt == null) {
		return { phase: fallbackPhase, elapsedSeconds: fallbackElapsed };
	}
	const lastChunk = chunks[chunks.length - 1];
	const endedAt =
		lastChunk?.endedAt ??
		[...chunks].reverse().find((chunk) => typeof chunk.endedAt === 'number')?.endedAt;
	const stillRunning = lastChunk?.endedAt == null;
	const endMs = stillRunning ? Date.now() : (endedAt ?? startedAt);
	return {
		phase: stillRunning ? fallbackPhase : 'done',
		elapsedSeconds: Math.max(0, (endMs - startedAt) / 1000),
	};
}

/**
 * 当前块（Explored 分组 / 思考块）之后是否已出现工具类块或收尾输出，
 * 用于回合未结束时提前把 head 上方的过程容器收成单行 summary。
 *
 * 注意：思考块之后只要见到“真正的输出”就该收起，因此 markdown / plan_todo /
 * file_changes 也算。Explored 分组与 markdown 之间常常正常并存（先搜索再说话），
 * 不能把 markdown 也算上 —— 该函数对两类块走分支。
 */
function unitFollowedByToolLikeWork(
	units: RenderUnit[],
	currentIndex: number,
	currentKind: 'activity_group' | 'thinking_group'
): boolean {
	for (let k = currentIndex + 1; k < units.length; k++) {
		const u = units[k]!;
		switch (u.type) {
			case 'diff':
			case 'command':
			case 'streaming_code':
			case 'file_edit':
			case 'tool_call':
			case 'activity':
			case 'sub_agent_markdown':
				return true;
			case 'markdown':
			case 'plan_todo':
			case 'file_changes':
				if (currentKind === 'thinking_group') {
					return true;
				}
				continue;
			case 'thinking_group':
			case 'activity_group':
			case 'outcome_marker':
				continue;
		}
	}
	return false;
}

// preflight / outcome 切分纯函数 + 配套辅助谓词已抽到 ./preflightSplit 以便独立单元测试，
// 这里 re-export 保持原有公共 API。
export { splitPreflightAndOutcome, preflightHasContent } from './preflightSplit';
import { splitPreflightAndOutcome, preflightHasContent } from './preflightSplit';

/** 有 tool_input_delta 预览时，解析层也会生成 isStreaming 的 file_edit，避免与预览重复且保证预览优先显示 */
function dropParsedStreamingFileEditWhilePreview(
	segments: AssistantSegment[],
	hasPreview: boolean
): AssistantSegment[] {
	if (!hasPreview) return segments;
	return segments.filter((seg) => !(seg.type === 'file_edit' && seg.isStreaming));
}

type Props = {
	content: string;
	agentUi?: boolean;
	planUi?: boolean;
	workspaceRoot?: string | null;
	onOpenAgentFile?: (
		relPath: string,
		revealLine?: number,
		revealEndLine?: number,
		options?: { diff?: string | null; allowReviewActions?: boolean }
	) => void;
	onRunCommand?: (cmd: string) => void;
	streamingToolPreview?: StreamingToolPreview | null;
	showAgentWorking?: boolean;
	hidePendingActivityTextCluster?: boolean;
	/** 对话错误气泡：强制易读配色并避免 Agent 解析路径漏字 */
	assistantBubbleVariant?: 'default' | 'error';
	/** 实时回合块状态；与 showAgentWorking 同时为真且 blocks 非空时，优先走块渲染，避免整段 content 重解析 */
	liveAgentBlocksState?: LiveAgentBlocksState | null;
	liveThoughtMeta?: {
		phase: 'thinking' | 'streaming' | 'done';
		elapsedSeconds: number;
		streamingThinking?: string;
		tokenUsage?: TurnTokenUsage | null;
	} | null;
	revertedPaths?: ReadonlySet<string>;
	revertedChangeKeys?: ReadonlySet<string>;
	allowAgentFileActions?: boolean;
	skipPlanTodo?: boolean;
	/**
	 * 渲染范围：
	 * - `'all'`（默认，兼容老调用方）：preflight + outcome 都在本组件渲染（整段一起）。
	 * - `'preflight'`：仅渲染过程区（思考 / 搜索 / 解释 markdown），用于挂在用户气泡正下方。
	 * - `'outcome'`：仅渲染结果区（file_edit / diff / 收尾总结）等，用于 assistant 气泡正文。
	 */
	renderMode?: 'all' | 'preflight' | 'outcome';
};

function InlineChevron({ open }: { open: boolean }) {
	return (
		<svg
			className={`ref-activity-inline-chevron-svg${open ? ' is-open' : ''}`}
			width="11"
			height="11"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.3"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M9 6l6 6-6 6" />
		</svg>
	);
}

function ActivityLine({
	seg,
	t,
	onOpenAgentFile,
	showAgentWorking,
	hidePendingTextCluster = false,
}: {
	seg: Extract<AssistantSegment, { type: 'activity' }>;
	t: ReturnType<typeof useI18n>['t'];
	onOpenAgentFile?: Props['onOpenAgentFile'];
	showAgentWorking?: boolean;
	hidePendingTextCluster?: boolean;
}) {
	const readLink = seg.agentReadLink;
	const openHintRaw = t('agent.activity.readOpenEditor');
	const openHint =
		openHintRaw === 'agent.activity.readOpenEditor'
			? 'Open in editor and highlight this range'
			: openHintRaw;
	const hasResultCard = Boolean(seg.resultLines && seg.resultLines.length > 0 && seg.resultKind);
	const hasExpandableBody = Boolean(seg.detail || hasResultCard);
	const shouldHideWorkingTextCluster =
		hidePendingTextCluster && showAgentWorking && !hasExpandableBody;
	const [expandedBody, setExpandedBody] = useState(false);
	const onToggleBody = useCallback(() => setExpandedBody((v) => !v), []);
	const onToggleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggleBody();
		}
	}, [onToggleBody]);

	if (shouldHideWorkingTextCluster && !seg.summary) {
		return null;
	}

	return (
		<div
			className={`ref-agent-activity ref-agent-activity--${seg.status}${seg.nestParent ? ' ref-agent-activity--nested' : ''}`}
			style={
				seg.nestParent
					? { marginLeft: Math.min(12 + ((seg.nestDepth ?? 1) - 1) * 10, 40) }
					: undefined
			}
		>
			<div
				className={`ref-agent-activity-main${hasExpandableBody ? ' ref-agent-activity-main--toggle' : ''}`}
				role={hasExpandableBody ? 'button' : undefined}
				tabIndex={hasExpandableBody ? 0 : undefined}
				aria-expanded={hasExpandableBody ? expandedBody : undefined}
				aria-label={hasExpandableBody ? (expandedBody ? '收起详情' : '展开详情') : undefined}
				onClick={hasExpandableBody ? onToggleBody : undefined}
				onKeyDown={hasExpandableBody ? onToggleKeyDown : undefined}
			>
				<span className="ref-agent-activity-dot" aria-hidden />
				{hasExpandableBody ? (
					<span className="ref-agent-activity-inline">
						{readLink && onOpenAgentFile ? (
							<button
								type="button"
								className="ref-agent-activity-ref-link"
								title={openHint}
								onClick={(e) => {
									e.stopPropagation();
									onOpenAgentFile(
										readLink.path,
										readLink.startLine,
										readLink.endLine
									);
								}}
							>
								{seg.text}
							</button>
						) : (
							<span className="ref-agent-activity-text">{seg.text}</span>
							)}
						<span
							className={`ref-activity-inline-chevron${expandedBody ? ' is-open' : ''}`}
							aria-hidden
						>
							<InlineChevron open={expandedBody} />
						</span>
						{seg.summary ? (
							<span className="ref-agent-activity-summary">{seg.summary}</span>
						) : null}
					</span>
				) : (
					<>
						{shouldHideWorkingTextCluster ? null : (
							<span className="ref-agent-activity-text-cluster">
								{readLink && onOpenAgentFile ? (
									<button
										type="button"
										className="ref-agent-activity-ref-link"
										title={openHint}
										onClick={(e) => {
											e.stopPropagation();
											onOpenAgentFile(
												readLink.path,
												readLink.startLine,
												readLink.endLine
											);
										}}
									>
										{seg.text}
									</button>
								) : (
									<span className="ref-agent-activity-text">{seg.text}</span>
								)}
							</span>
						)}
						{seg.summary ? (
							<span className="ref-agent-activity-summary">{seg.summary}</span>
						) : null}
					</>
				)}
			</div>
			{hasExpandableBody ? (
				<AnimatedHeightReveal open={expandedBody}>
					{seg.detail ? (
						<pre className="ref-agent-activity-detail">{seg.detail}</pre>
					) : null}
					{hasResultCard ? (
						<AgentResultCard
							lines={seg.resultLines!}
							kind={seg.resultKind!}
							readSourcePath={seg.agentReadLink?.path}
							onOpenFile={onOpenAgentFile}
							animateLineReveal={showAgentWorking}
							forceExpanded
							hideToggleChrome
						/>
					) : null}
				</AnimatedHeightReveal>
			) : null}
		</div>
	);
}

export const ChatMarkdown = memo(function ChatMarkdown({
	content,
	agentUi = false,
	planUi = false,
	workspaceRoot,
	onOpenAgentFile,
	onRunCommand,
	streamingToolPreview,
	showAgentWorking = false,
	hidePendingActivityTextCluster: forceHidePendingActivityTextCluster = false,
	liveAgentBlocksState = null,
	liveThoughtMeta = null,
	assistantBubbleVariant = 'default',
	revertedPaths,
	revertedChangeKeys,
	allowAgentFileActions = false,
	skipPlanTodo = false,
	renderMode = 'all',
}: Props) {
	const { t } = useI18n();

	const forcePlainMarkdown = assistantBubbleVariant === 'error';
	const agentMarkdown = agentUi && !forcePlainMarkdown;

	const useLiveBlockRender =
		agentMarkdown &&
		showAgentWorking &&
		(liveThoughtMeta != null ||
			(liveAgentBlocksState != null && liveAgentBlocksState.blocks.length > 0));

	/**
	 * 将 content 解析与 streamingToolPreview 拆开：
	 * content 解析涉及全量 tool 协议扫描，开销较大；
	 * streamingToolPreview 变化极频繁（每个 tool_input_delta 都触发），
	 * 拆分后 preview 变化只需做轻量合并，避免阻塞 React 渲染导致流式卡片被跳过。
	 *
	 * 正文解析必须用当前 content：useDeferredValue 会在高优先级更新后短暂保留旧值，
	 * 若旧值为空则 segment 结果为空，对话错误等短消息会出现「有气泡无字」。
	 *
	 * Live blocks 主路径下不再对整段 content 做 segmentAssistantContentUnified，也不合并 streamingToolPreview（块内已含）。
	 */
	const parseInput = content;
	const parsedSegments = useMemo(() => {
		if (!agentMarkdown) return [] as AssistantSegment[];
		const t0 = performance.now();
		if (useLiveBlockRender && liveAgentBlocksState) {
			const result = liveBlocksToAssistantSegments(liveAgentBlocksState.blocks, t);
			if (import.meta.env.DEV) {
				const elapsed = performance.now() - t0;
				if (elapsed > 8) {
					// eslint-disable-next-line no-console
					console.log(
						`[ChatMarkdown] parsedSegments (live blocks): ${elapsed.toFixed(1)}ms, blocks=${liveAgentBlocksState.blocks.length}, segs=${result.length}`
					);
				}
			}
			return result;
		}
		const result = segmentAssistantContentUnified(parseInput, { t, planUi });
		if (import.meta.env.DEV) {
			const elapsed = performance.now() - t0;
			if (elapsed > 8) {
				// eslint-disable-next-line no-console
				console.log(
					`[ChatMarkdown] parsedSegments: ${elapsed.toFixed(1)}ms, contentLen=${content.length}, segs=${result.length}`
				);
			}
		}
		return result;
	}, [agentMarkdown, useLiveBlockRender, liveAgentBlocksState, parseInput, t, planUi]);

	const renderSegments = useMemo(() => {
		if (!agentMarkdown) {
			return [] as AssistantSegment[];
		}
		const filtered = dropParsedStreamingFileEditWhilePreview(
			parsedSegments,
			!useLiveBlockRender && streamingToolPreview != null
		);
		const streamingSegments = useLiveBlockRender
			? ([] as AssistantSegment[])
			: buildStreamingToolSegments(streamingToolPreview, { t });
		const segs: AssistantSegment[] = [...filtered, ...streamingSegments];
		if (
			useLiveBlockRender &&
			liveThoughtMeta &&
			!segs.some((s) => s.type === 'thinking')
		) {
			segs.unshift({
				type: 'thinking',
				id: 'live-thinking-fallback',
				text: liveThoughtMeta.streamingThinking ?? '',
			});
		}
		const hasPendingTail =
			segs.some((s) => s.type === 'activity' && s.status === 'pending') ||
			streamingToolPreview != null;
		if (showAgentWorking && !hasPendingTail && !segs.some((s) => s.type === 'thinking')) {
			segs.push({
				type: 'activity',
				text: t('agent.working'),
				status: 'pending',
			});
		}
		return segs;
	}, [agentMarkdown, parsedSegments, t, streamingToolPreview, showAgentWorking, useLiveBlockRender, liveThoughtMeta]);

	const renderUnits = useMemo(() => {
		const out: RenderUnit[] = [];
		for (const seg of renderSegments) {
			if (seg.type !== 'thinking') {
				out.push(seg);
				continue;
			}
			const last = out[out.length - 1];
			if (last?.type === 'thinking_group') {
				last.chunks.push(seg);
			} else {
				out.push({ type: 'thinking_group', chunks: [seg] });
			}
		}
		return out;
	}, [renderSegments]);
	// 注意：以下 useMemo 必须在所有条件 return 之前调用，否则违反 Hooks 顺序。
	// 流式期间 markdown 永远留在 preflight，回合结束（liveTurn=false）才一次性切到 outcome。
	// 这避免了「文字外置→收回」的视觉抖动 —— 任意 unit 在流式期间不会在 preflight ↔ outcome 之间反向迁移。
	const { preflight, outcome } = useMemo(
		() => splitPreflightAndOutcome(renderUnits, { liveTurn: showAgentWorking }),
		[renderUnits, showAgentWorking]
	);
	const hidePendingActivityTextCluster =
		showAgentWorking &&
		(
			forceHidePendingActivityTextCluster ||
			streamingToolPreview != null ||
			(liveAgentBlocksState?.blocks.length ?? 0) > 0
		);

	if (!agentMarkdown) {
		const plainClass =
			assistantBubbleVariant === 'error'
				? `ref-md-root ref-md-root--chat-error${agentUi ? ' ref-md-root--agent-chat' : ''}`
				: 'ref-md-root';
		return (
			<div className={plainClass}>
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
			</div>
		);
	}

	const agentRootClass = 'ref-md-root ref-md-root--agent-chat';

	const renderUnitNode = (seg: RenderUnit, i: number, opts?: { insideShell?: boolean }): ReactNode => {
		const insideShell = opts?.insideShell === true;
		switch (seg.type) {
			case 'markdown':
				return (
					<ReactMarkdown key={`u-${i}`} remarkPlugins={[remarkGfm]}>
						{seg.text}
					</ReactMarkdown>
				);
			case 'thinking_group': {
				const thoughtMeta = thinkingGroupRenderMeta(seg.chunks, liveThoughtMeta);
				if (insideShell) {
					return (
						<PreflightThinkingItem
							key={seg.chunks[0]?.id ?? `thinking-${i}`}
							phase={thoughtMeta.phase}
							elapsedSeconds={thoughtMeta.elapsedSeconds}
							chunks={seg.chunks.map((chunk) => ({ id: chunk.id, text: chunk.text }))}
							streamingThinking={liveThoughtMeta?.streamingThinking ?? ''}
						/>
					);
				}
				return (
					<ComposerThoughtBlock
						key={seg.chunks[0]?.id ?? `thinking-${i}`}
						phase={thoughtMeta.phase}
						elapsedSeconds={thoughtMeta.elapsedSeconds}
						chunks={seg.chunks.map((chunk) => ({ id: chunk.id, text: chunk.text }))}
						streamingThinking={liveThoughtMeta?.streamingThinking ?? ''}
						tokenUsage={thoughtMeta.phase === 'done' ? liveThoughtMeta?.tokenUsage : undefined}
						followingToolLikeWork={unitFollowedByToolLikeWork(renderUnits, i, 'thinking_group')}
					/>
				);
			}
			case 'diff':
				return (
					<AgentDiffCard
						key={`u-${i}`}
						diff={seg.diff}
						workspaceRoot={workspaceRoot}
						onOpenFile={onOpenAgentFile}
					/>
				);
			case 'command':
				return (
					<AgentCommandCard
						key={`u-${i}`}
						lang={seg.lang}
						body={seg.body}
						onRun={onRunCommand ? () => onRunCommand(seg.body) : undefined}
					/>
				);
			case 'streaming_code':
				return <AgentStreamingFenceCard key={`u-${i}`} lang={seg.lang} body={seg.body} />;
			case 'file_edit': {
				const changeKey = fileEditChangeKey(seg);
				const isReverted =
					Boolean(revertedPaths?.has(seg.path)) ||
					Boolean(changeKey && revertedChangeKeys?.has(changeKey));
				return (
					<AgentEditCard
						key={`u-${i}`}
						edit={seg}
						isReverted={isReverted}
						allowReviewActions={allowAgentFileActions}
						onOpenFile={onOpenAgentFile}
					/>
				);
			}
			case 'activity_group':
				// preflight 内不渲染 .ref-activity-group 壳：直接把组内 items 摊平成独立活动行，
				// 视觉上跟其它独立 activity（如 Bash/已运行）一致，过程中无任何额外折叠层。
				if (insideShell) {
					return (
						<Fragment key={`u-${i}`}>
							{seg.items.map((item, j) => (
								<ActivityLine
									key={`u-${i}-${j}`}
									seg={item}
									t={t}
									onOpenAgentFile={onOpenAgentFile}
									showAgentWorking={showAgentWorking}
									hidePendingTextCluster={hidePendingActivityTextCluster}
								/>
							))}
						</Fragment>
					);
				}
				return (
					<AgentActivityGroup
						key={`u-${i}`}
						group={seg}
						onOpenFile={onOpenAgentFile}
						liveTurn={showAgentWorking}
						animateLineReveal={showAgentWorking}
						insideShell={insideShell}
						followingToolLikeWork={unitFollowedByToolLikeWork(renderUnits, i, 'activity_group')}
					/>
				);
			case 'file_changes':
				return null;
			case 'sub_agent_markdown': {
				const label =
					seg.variant === 'thinking' ? t('agent.subAgent.thinking') : t('agent.subAgent.output');
				return (
					<div
						key={`u-${i}`}
						className="ref-sub-agent-md"
						style={{ marginLeft: Math.min(12 + (seg.depth - 1) * 10, 40) }}
					>
						<div className="ref-sub-agent-md-label">{label}</div>
						<div className="ref-md-root ref-md-root--agent-chat ref-sub-agent-md-body">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
						</div>
					</div>
				);
			}
			case 'activity':
				return (
					<ActivityLine
						key={`u-${i}`}
						seg={seg}
						t={t}
						onOpenAgentFile={onOpenAgentFile}
						showAgentWorking={showAgentWorking}
						hidePendingTextCluster={hidePendingActivityTextCluster}
					/>
				);
			case 'tool_call':
				if (hidePendingActivityTextCluster && showAgentWorking) {
					return null;
				}
				return (
					<p key={`u-${i}`} className="ref-agent-activity">
						{t('agent.toolPending', { name: seg.name })}
					</p>
				);
			case 'plan_todo':
				if (skipPlanTodo) return null;
				return (
					<div key={`u-${i}`} className="ref-plan-review-todos">
						<div className="ref-plan-review-todos-head">
							<span>
								{t('plan.review.todo', {
									done: seg.todos.filter((td) => td.status === 'completed').length,
									total: seg.todos.length,
								})}
							</span>
						</div>
						<div className="ref-plan-review-todos-list">
							{seg.todos.map((todo) => {
								const done = todo.status === 'completed';
								const active = todo.status === 'in_progress';
								return (
									<div
										key={todo.id}
										className={`ref-plan-todo ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}
									>
										{active ? (
											<span className="ref-plan-todo-spinner" aria-hidden />
										) : (
											<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
												<rect
													x="1"
													y="1"
													width="14"
													height="14"
													rx="3"
													stroke={done ? '#e8a848' : '#555'}
													strokeWidth="1.5"
													fill={done ? '#e8a848' : 'none'}
												/>
												{done ? (
													<path
														d="M4.5 8l2.5 2.5 4.5-5"
														stroke="#1a1a1a"
														strokeWidth="1.8"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
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
					</div>
				);
			default:
				return null;
		}
	};

	const hasPreflight = preflightHasContent(preflight);
	const hasOutcome = outcome.some((u) => {
		// outcome_marker 自身不可见，单独存在不算「有 outcome」
		if (u.type === 'outcome_marker') return false;
		if (u.type === 'markdown') return u.text.trim().length > 0;
		return true;
	});

	if (renderMode === 'preflight') {
		if (!hasPreflight) return null;
		return (
			<div className={agentRootClass}>
				<AgentPreflightShell
					liveTurn={showAgentWorking}
					hasOutcome={hasOutcome}
					phase={liveThoughtMeta?.phase ?? (showAgentWorking ? 'thinking' : 'done')}
					tokenUsage={liveThoughtMeta?.tokenUsage ?? null}
				>
					{preflight.map((seg, i) => renderUnitNode(seg, i, { insideShell: true }))}
				</AgentPreflightShell>
			</div>
		);
	}

	if (renderMode === 'outcome') {
		if (!hasOutcome) {
			return <div className={agentRootClass} />;
		}
		if (outcome.length === 1 && outcome[0]!.type === 'markdown') {
			return (
				<div className={agentRootClass}>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{outcome[0]!.text}</ReactMarkdown>
				</div>
			);
		}
		return (
			<div className={agentRootClass}>
				{outcome.map((seg, i) => renderUnitNode(seg, i))}
			</div>
		);
	}

	if (renderUnits.length === 0) {
		if (content.trim()) {
			return (
				<div className={agentRootClass}>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
				</div>
			);
		}
		return <div className={agentRootClass} />;
	}
	if (renderUnits.length === 1 && renderUnits[0]!.type === 'markdown') {
		return (
			<div className={agentRootClass}>
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{renderUnits[0]!.text}</ReactMarkdown>
			</div>
		);
	}

	return (
		<div className={agentRootClass}>{renderUnits.map((seg, i) => renderUnitNode(seg, i))}</div>
	);
});
