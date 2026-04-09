/**
 * Cursor 风格的 "Explored N files" 折叠分组。
 *
 * liveTurn=true 且尚未出现后续工具块时：展开以便跟读活动行。
 * 同一回合内一旦下方出现 file_edit / 命令 / diff 等（followingToolLikeWork）：自动折叠，把注意力让给工具卡片。
 * liveTurn 由 true→false（回合结束）时：若仍展开则延迟平滑折叠。
 * 用户手动点击 toggle 后：不再自动覆盖，尊重用户选择。
 */
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
} from 'react';
import type { ActivityGroupSegment, ActivitySegment } from './agentChatSegments';
import { AgentResultCard } from './AgentResultCard';

type Props = {
	group: ActivityGroupSegment;
	onOpenFile?: (relPath: string, revealLine?: number, revealEndLine?: number) => void;
	/** Agent 回合是否仍在进行中（awaitingReply && isLastMessage） */
	liveTurn?: boolean;
	/** 与 liveTurn 一致：仅实时生成时允许 AgentResultCard 逐行揭示 */
	animateLineReveal?: boolean;
	/**
	 * 本分组之后是否已渲染工具类片段（file_edit、命令围栏、diff 等）。
	 * 为 true 时在 liveTurn 内自动折叠，无需等整回合结束。
	 */
	followingToolLikeWork?: boolean;
};

export const AgentActivityGroup = memo(function AgentActivityGroup({
	group,
	onOpenFile,
	liveTurn = false,
	animateLineReveal = false,
	followingToolLikeWork = false,
}: Props) {
	const [expanded, setExpanded] = useState(() => {
		if (liveTurn && followingToolLikeWork) {
			return false;
		}
		return Boolean(group.pending || liveTurn);
	});
	const userToggledRef = useRef(false);
	const prevLiveTurnRef = useRef(liveTurn);

	// 后续已出现工具块时：本回合内自动收起 Explored（除非用户手动操作过）
	useEffect(() => {
		if (!followingToolLikeWork || !liveTurn) {
			return;
		}
		if (userToggledRef.current) {
			return;
		}
		setExpanded(false);
	}, [followingToolLikeWork, liveTurn]);

	// liveTurn 期间、且下方尚无工具块时：新 pending 活动到来则自动展开（除非用户手动折叠了）
	useEffect(() => {
		if (liveTurn && group.pending && !userToggledRef.current && !followingToolLikeWork) {
			setExpanded(true);
		}
	}, [group.pending, group.items.length, liveTurn, followingToolLikeWork]);

	// 仅在整个 Agent 回合结束时自动折叠（liveTurn true→false）
	useEffect(() => {
		const wasLive = prevLiveTurnRef.current;
		prevLiveTurnRef.current = liveTurn;

		if (wasLive && !liveTurn && !userToggledRef.current) {
			const id = setTimeout(() => setExpanded(false), 600);
			return () => clearTimeout(id);
		}
	}, [liveTurn]);

	const bodyRef = useRef<HTMLDivElement>(null);
	const pinnedToBottomRef = useRef(true);

	// 监听滚动：如果用户往上滚（距底部 > 40px），暂停粘底；滚回底部则恢复
	const onBodyScroll = useCallback(() => {
		const el = bodyRef.current;
		if (!el) return;
		const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		pinnedToBottomRef.current = distFromBottom < 40;
	}, []);

	// 内容变化时，若粘底则自动滚到最新
	useLayoutEffect(() => {
		if (!expanded || !pinnedToBottomRef.current) return;
		const el = bodyRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [group.items, expanded]);

	// 展开时重置粘底状态
	useEffect(() => {
		if (expanded) {
			pinnedToBottomRef.current = true;
			const el = bodyRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		}
	}, [expanded]);

	const onToggle = useCallback(() => {
		userToggledRef.current = true;
		setExpanded((v) => !v);
	}, []);

	return (
		<div className={`ref-activity-group ${group.pending ? 'is-pending' : 'is-done'}`}>
			<button
				type="button"
				className="ref-activity-group-header"
				aria-expanded={expanded}
				onClick={onToggle}
			>
				<span className="ref-activity-group-icon" aria-hidden>
					{group.pending ? <SpinnerIcon /> : <ExploreIcon />}
				</span>
				<span className="ref-activity-group-summary">{group.summary}</span>
				<span className="ref-activity-group-chevron" aria-hidden>
					<ChevronDown />
				</span>
			</button>

			<div className={`ref-activity-group-collapse ${expanded ? 'is-open' : ''}`}>
				<div
					ref={bodyRef}
					className={`ref-activity-group-body ${group.pending || liveTurn ? 'ref-activity-group-body--live' : ''}`}
					onScroll={onBodyScroll}
				>
					{group.items.map((item, i) => (
						<ActivityRow
							key={i}
							item={item}
							onOpenFile={onOpenFile}
							animateLineReveal={animateLineReveal}
						/>
					))}
				</div>
			</div>
		</div>
	);
});

function ActivityRow({
	item,
	onOpenFile,
	animateLineReveal,
}: {
	item: ActivitySegment;
	onOpenFile?: (relPath: string, revealLine?: number, revealEndLine?: number) => void;
	animateLineReveal: boolean;
}) {
	const readLink = item.agentReadLink;
	const hasResultCard = Boolean(item.resultLines && item.resultLines.length > 0 && item.resultKind);
	const isPlainCommandResult = item.resultKind === 'plain' && hasResultCard;
	const [expandedResult, setExpandedResult] = useState(false);
	const onToggleResult = useCallback(() => {
		setExpandedResult((v) => !v);
	}, []);
	const onToggleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggleResult();
		}
	}, [onToggleResult]);
	return (
		<div className={`ref-activity-group-row ref-activity-group-row--${item.status}`}>
			<div
				className={`ref-activity-group-row-top${isPlainCommandResult ? ' ref-activity-group-row-top--cmd-toggle' : ''}`}
				role={isPlainCommandResult ? 'button' : undefined}
				tabIndex={isPlainCommandResult ? 0 : undefined}
				aria-expanded={isPlainCommandResult ? expandedResult : undefined}
				aria-label={isPlainCommandResult ? (expandedResult ? '收起命令结果' : '展开命令结果') : undefined}
				onClick={isPlainCommandResult ? onToggleResult : undefined}
				onKeyDown={isPlainCommandResult ? onToggleKeyDown : undefined}
			>
				<span className="ref-activity-group-row-dot-wrap" aria-hidden>
					<span className="ref-activity-group-row-dot" />
				</span>
				<div
					className={`ref-activity-group-row-main${isPlainCommandResult ? ' ref-activity-group-row-main--cmd-head' : ''}`}
				>
					{isPlainCommandResult ? (
						<span className="ref-activity-group-row-cmd-inline">
							{readLink && onOpenFile ? (
								<button
									type="button"
									className="ref-agent-activity-ref-link"
									onClick={(e) => {
										e.stopPropagation();
										onOpenFile(readLink.path, readLink.startLine, readLink.endLine);
									}}
								>
									{item.text}
								</button>
							) : (
								<span>{item.text}</span>
							)}
							<span
								className={`ref-activity-inline-chevron${expandedResult ? ' is-open' : ''}`}
								aria-hidden
							>
								<InlineChevron open={expandedResult} />
							</span>
							{item.summary ? (
								<span className="ref-agent-activity-summary">{item.summary}</span>
							) : null}
						</span>
					) : (
						<>
							<span className="ref-activity-group-row-text-cluster">
								{readLink && onOpenFile ? (
									<button
										type="button"
										className="ref-agent-activity-ref-link"
										onClick={() => onOpenFile(readLink.path, readLink.startLine, readLink.endLine)}
									>
										{item.text}
									</button>
								) : (
									<span>{item.text}</span>
								)}
							</span>
							{item.summary ? (
								<span className="ref-agent-activity-summary">{item.summary}</span>
							) : null}
						</>
					)}
				</div>
			</div>
			{item.detail || hasResultCard ? (
				<div className="ref-activity-group-row-rest">
					{item.detail ? (
						<pre className="ref-agent-activity-detail">{item.detail}</pre>
					) : null}
					{hasResultCard && (!isPlainCommandResult || expandedResult) ? (
						<AgentResultCard
							lines={item.resultLines}
							kind={item.resultKind}
							readSourcePath={item.agentReadLink?.path}
							onOpenFile={onOpenFile}
							animateLineReveal={animateLineReveal}
							forceExpanded={isPlainCommandResult ? true : undefined}
							hideToggleChrome={isPlainCommandResult}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ExploreIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<circle cx="11" cy="11" r="8" />
			<path d="M21 21l-4.35-4.35" />
		</svg>
	);
}

function SpinnerIcon() {
	return (
		<svg className="ref-activity-group-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
			<path d="M12 2a10 10 0 0 1 10 10" />
		</svg>
	);
}

function ChevronDown() {
	return (
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M6 9l6 6 6-6" />
		</svg>
	);
}

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
