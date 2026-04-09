import { memo, useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentActivityGroup } from './AgentActivityGroup';
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

/** 当前 Explored 分组之后是否已出现工具类块（file_edit / 命令 / diff 等），用于回合未结束时提前折叠 */
function activityGroupFollowedByToolLikeWork(units: RenderUnit[], groupIndex: number): boolean {
	for (let k = groupIndex + 1; k < units.length; k++) {
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
			case 'thinking_group':
			case 'activity_group':
			case 'file_changes':
			case 'plan_todo':
				continue;
		}
	}
	return false;
}

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
}: {
	seg: Extract<AssistantSegment, { type: 'activity' }>;
	t: ReturnType<typeof useI18n>['t'];
	onOpenAgentFile?: Props['onOpenAgentFile'];
	showAgentWorking?: boolean;
}) {
	const readLink = seg.agentReadLink;
	const openHintRaw = t('agent.activity.readOpenEditor');
	const openHint =
		openHintRaw === 'agent.activity.readOpenEditor'
			? 'Open in editor and highlight this range'
			: openHintRaw;
	const hasResultCard = Boolean(seg.resultLines && seg.resultLines.length > 0 && seg.resultKind);
	const isPlainCommandResult = seg.resultKind === 'plain' && hasResultCard;
	const [expandedResult, setExpandedResult] = useState(false);
	const onToggleResult = useCallback(() => setExpandedResult((v) => !v), []);
	const onToggleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggleResult();
		}
	}, [onToggleResult]);

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
				className={`ref-agent-activity-main${isPlainCommandResult ? ' ref-agent-activity-main--cmd-toggle' : ''}`}
				role={isPlainCommandResult ? 'button' : undefined}
				tabIndex={isPlainCommandResult ? 0 : undefined}
				aria-expanded={isPlainCommandResult ? expandedResult : undefined}
				aria-label={isPlainCommandResult ? (expandedResult ? '收起命令结果' : '展开命令结果') : undefined}
				onClick={isPlainCommandResult ? onToggleResult : undefined}
				onKeyDown={isPlainCommandResult ? onToggleKeyDown : undefined}
			>
				<span className="ref-agent-activity-dot" aria-hidden />
				{isPlainCommandResult ? (
					<span className="ref-agent-activity-cmd-inline">
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
							className={`ref-activity-inline-chevron${expandedResult ? ' is-open' : ''}`}
							aria-hidden
						>
							<InlineChevron open={expandedResult} />
						</span>
						{seg.summary ? (
							<span className="ref-agent-activity-summary">{seg.summary}</span>
						) : null}
					</span>
				) : (
					<>
						<span className="ref-agent-activity-text-cluster">
							{readLink && onOpenAgentFile ? (
								<button
									type="button"
									className="ref-agent-activity-ref-link"
									title={openHint}
									onClick={() =>
										onOpenAgentFile(
											readLink.path,
											readLink.startLine,
											readLink.endLine
										)
									}
								>
									{seg.text}
								</button>
							) : (
								<span className="ref-agent-activity-text">{seg.text}</span>
							)}
						</span>
						{seg.summary ? (
							<span className="ref-agent-activity-summary">{seg.summary}</span>
						) : null}
					</>
				)}
			</div>
			{seg.detail ? (
				<pre className="ref-agent-activity-detail">{seg.detail}</pre>
			) : null}
			{hasResultCard && (!isPlainCommandResult || expandedResult) ? (
				<AgentResultCard
					lines={seg.resultLines!}
					kind={seg.resultKind!}
					readSourcePath={seg.agentReadLink?.path}
					onOpenFile={onOpenAgentFile}
					animateLineReveal={showAgentWorking}
					forceExpanded={isPlainCommandResult ? true : undefined}
					hideToggleChrome={isPlainCommandResult}
				/>
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
	liveAgentBlocksState = null,
	liveThoughtMeta = null,
	assistantBubbleVariant = 'default',
	revertedPaths,
	revertedChangeKeys,
	allowAgentFileActions = false,
	skipPlanTodo = false,
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
		<div className={agentRootClass}>
			{renderUnits.map((seg, i) => {
				switch (seg.type) {
					case 'markdown':
						return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>;
					case 'thinking_group':
						const thoughtMeta = thinkingGroupRenderMeta(seg.chunks, liveThoughtMeta);
						return (
							<ComposerThoughtBlock
								key={seg.chunks[0]?.id ?? `thinking-${i}`}
								phase={thoughtMeta.phase}
								elapsedSeconds={thoughtMeta.elapsedSeconds}
								chunks={seg.chunks.map((chunk) => ({ id: chunk.id, text: chunk.text }))}
								streamingThinking={liveThoughtMeta?.streamingThinking ?? ''}
								tokenUsage={thoughtMeta.phase === 'done' ? liveThoughtMeta?.tokenUsage : undefined}
							/>
						);
					case 'diff':
						return (
							<AgentDiffCard
								key={i}
								diff={seg.diff}
								workspaceRoot={workspaceRoot}
								onOpenFile={onOpenAgentFile}
							/>
						);
					case 'command':
						return <AgentCommandCard key={i} lang={seg.lang} body={seg.body} onRun={onRunCommand ? () => onRunCommand(seg.body) : undefined} />;
					case 'streaming_code':
						return <AgentStreamingFenceCard key={i} lang={seg.lang} body={seg.body} />;
					case 'file_edit':
						const changeKey = fileEditChangeKey(seg);
						const isReverted =
							Boolean(revertedPaths?.has(seg.path)) ||
							Boolean(changeKey && revertedChangeKeys?.has(changeKey));
						return (
							<AgentEditCard
								key={i}
								edit={seg}
								isReverted={isReverted}
								allowReviewActions={allowAgentFileActions}
								onOpenFile={onOpenAgentFile}
							/>
						);
				case 'activity_group':
					return (
						<AgentActivityGroup
							key={i}
							group={seg}
							onOpenFile={onOpenAgentFile}
							liveTurn={showAgentWorking}
							animateLineReveal={showAgentWorking}
							followingToolLikeWork={activityGroupFollowedByToolLikeWork(renderUnits, i)}
						/>
					);
					case 'file_changes':
						return null;
					case 'sub_agent_markdown': {
						const label =
							seg.variant === 'thinking' ? t('agent.subAgent.thinking') : t('agent.subAgent.output');
						return (
							<div
								key={i}
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
					case 'activity': {
						return (
							<ActivityLine
								key={i}
								seg={seg}
								t={t}
								onOpenAgentFile={onOpenAgentFile}
								showAgentWorking={showAgentWorking}
							/>
						);
					}
					case 'tool_call':
						return (
							<p key={i} className="ref-agent-activity">
								{t('agent.toolPending', { name: seg.name })}
							</p>
						);
					case 'plan_todo':
						if (skipPlanTodo) return null;
						return (
							<div key={i} className="ref-plan-review-todos">
								<div className="ref-plan-review-todos-head">
									<span>{t('plan.review.todo', { 
										done: seg.todos.filter(td => td.status === 'completed').length, 
										total: seg.todos.length 
									})}</span>
								</div>
								<div className="ref-plan-review-todos-list">
									{seg.todos.map((todo) => {
										const done = todo.status === 'completed';
										const active = todo.status === 'in_progress';
										return (
											<div key={todo.id} className={`ref-plan-todo ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
												{active ? (
													<span className="ref-plan-todo-spinner" aria-hidden />
												) : (
													<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
														<rect
															x="1" y="1" width="14" height="14" rx="3"
															stroke={done ? '#e8a848' : '#555'}
															strokeWidth="1.5"
															fill={done ? '#e8a848' : 'none'}
														/>
														{done ? (
															<path d="M4.5 8l2.5 2.5 4.5-5" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
			})}
		</div>
	);
});
