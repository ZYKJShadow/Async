import { memo, useEffect, useRef } from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import type { TFunction } from './i18n';
import type { ChatMessage } from './threadTypes';
import type { TeamSessionState } from './hooks/useTeamSession';
import type { LiveAgentBlocksState } from './liveAgentBlocks';
import type { TurnTokenUsage } from './ipcTypes';
import { buildTeamWorkflowItems, getTeamWorkflowItemById } from './teamWorkflowItems';

type Props = {
	t: TFunction;
	session: TeamSessionState | null;
	selectedTaskId: string | null;
	onSelectTask: (taskId: string) => void;
	layout: 'agent-sidebar' | 'editor-center';
	isVisible?: boolean;
};

function renderAssistantMessage(
	key: string,
	content: string,
	options?: {
		isWorking?: boolean;
		liveBlocks?: LiveAgentBlocksState | null;
		liveThoughtMeta?: {
			phase: 'thinking' | 'streaming' | 'done';
			elapsedSeconds: number;
			streamingThinking: string;
			tokenUsage?: TurnTokenUsage | null;
		} | null;
	}
) {
	return (
		<div key={key} className="ref-msg-slot ref-msg-slot--assistant ref-team-role-msg">
			<div className="ref-msg-assistant-body">
				<ChatMarkdown
					content={content}
					agentUi
					workspaceRoot={null}
					showAgentWorking={options?.isWorking ?? false}
					liveAgentBlocksState={options?.liveBlocks ?? null}
					liveThoughtMeta={options?.liveThoughtMeta ?? null}
				/>
			</div>
		</div>
	);
}

export const TeamRoleWorkflowPanel = memo(function TeamRoleWorkflowPanel({
	t,
	session,
	selectedTaskId,
	onSelectTask,
	layout,
	isVisible = true,
}: Props) {
	if (!session) {
		return (
			<div className="ref-team-role-stream ref-team-role-stream--empty">
				<div className="ref-agent-plan-status-main">
					<div className="ref-agent-plan-status-title">{t('composer.mode.team')}</div>
					<p className="ref-agent-plan-status-body">{t('settings.team.empty')}</p>
				</div>
			</div>
		);
	}

	const workflowItems = buildTeamWorkflowItems(session);
	const item = getTeamWorkflowItemById(session, selectedTaskId ?? session.selectedTaskId) ?? workflowItems[0] ?? null;
	if (!item) {
		return (
			<div className="ref-team-role-stream ref-team-role-stream--empty">
				<div className="ref-agent-plan-status-main">
					<div className="ref-agent-plan-status-title">{t('composer.mode.team')}</div>
					<p className="ref-agent-plan-status-body">{t('app.selectFileToView')}</p>
				</div>
			</div>
		);
	}

	const workflow = item.workflow;
	const isWorking = workflow?.awaitingReply ?? item.status === 'in_progress';
	const savedMessages: ChatMessage[] =
		workflow?.messages.length
			? workflow.messages
			: item.result
				? [{ role: 'assistant', content: item.result }]
				: [];
	const liveThoughtMeta =
		workflow?.awaitingReply || workflow?.streamingThinking
			? {
					phase: (workflow?.streaming?.trim() ? 'streaming' : 'thinking') as 'thinking' | 'streaming' | 'done',
					elapsedSeconds: 0,
					streamingThinking: workflow?.streamingThinking ?? '',
					tokenUsage: workflow?.lastTurnUsage ?? null,
				}
			: null;
	const scrollViewportRef = useRef<HTMLDivElement | null>(null);
	const shouldStickToBottomRef = useRef(true);
	const lastOpenStateRef = useRef(false);
	const lastItemIdRef = useRef<string | null>(null);
	const autoScrollFrameRef = useRef<number | null>(null);

	useEffect(() => {
		const viewport = scrollViewportRef.current;
		if (!viewport || !isVisible) {
			lastOpenStateRef.current = isVisible;
			return;
		}

		const openedNow = !lastOpenStateRef.current && isVisible;
		const changedItem = lastItemIdRef.current !== item.id;
		const shouldForceBottom = openedNow || changedItem;

		if (shouldForceBottom || shouldStickToBottomRef.current) {
			shouldStickToBottomRef.current = true;
			if (autoScrollFrameRef.current !== null) {
				cancelAnimationFrame(autoScrollFrameRef.current);
			}
			autoScrollFrameRef.current = requestAnimationFrame(() => {
				viewport.scrollTop = viewport.scrollHeight;
				autoScrollFrameRef.current = null;
			});
		}

		lastOpenStateRef.current = isVisible;
		lastItemIdRef.current = item.id;

		return () => {
			if (autoScrollFrameRef.current !== null) {
				cancelAnimationFrame(autoScrollFrameRef.current);
				autoScrollFrameRef.current = null;
			}
		};
	}, [
		isVisible,
		item.id,
		savedMessages.length,
		item.result,
		isWorking,
		workflow?.streaming,
		workflow?.streamingThinking,
		workflow?.lastUpdatedAt,
	]);

	const onTranscriptScroll = () => {
		const viewport = scrollViewportRef.current;
		if (!viewport) {
			return;
		}
		const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
		shouldStickToBottomRef.current = distanceFromBottom <= 24;
	};

	const transcript = (
		<div
			className={`ref-team-role-stream ${layout === 'agent-sidebar' ? 'ref-team-role-stream--agent-sidebar' : 'ref-team-role-stream--editor-center'}`}
		>
			{savedMessages.map((message, index) =>
				renderAssistantMessage(`team-role-msg-${item.id}-${index}`, message.content)
			)}
			{isWorking
				? renderAssistantMessage(`team-role-live-${item.id}`, workflow?.streaming ?? '', {
						isWorking: true,
						liveBlocks: workflow?.liveBlocks ?? null,
						liveThoughtMeta,
					})
				: null}
			{!savedMessages.length && !isWorking ? (
				<div className="ref-team-role-empty-state">
					{t('team.timeline.pendingTrace', { name: item.expertName })}
				</div>
			) : null}
		</div>
	);

	return (
		<section
			className={`ref-team-role-shell ${layout === 'agent-sidebar' ? 'ref-team-role-shell--agent-sidebar' : 'ref-team-role-shell--editor-center'}`}
		>
			<header className="ref-team-role-shell-head">
				<div className="ref-team-role-shell-main">
					<div className="ref-team-role-shell-expert">
						<span className={`ref-team-expert-avatar ref-team-expert-avatar--${item.roleType}`}>
							{item.expertName.slice(0, 1).toUpperCase()}
						</span>
						<div className="ref-team-role-shell-title-stack">
							<div className="ref-team-role-shell-title-row">
								<span className="ref-team-role-shell-role">
									{t(`team.timeline.role.${item.roleKind}`)}
								</span>
								<strong className="ref-team-role-shell-name">{item.expertName}</strong>
							</div>
							<p className="ref-team-role-shell-task">{item.description}</p>
						</div>
					</div>
					<div className="ref-team-role-shell-meta">
						<span className={`ref-team-expert-status ref-team-expert-status--${item.status}`}>
							{item.status === 'in_progress' ? <span className="ref-team-pulse" /> : null}
							{t(`team.timeline.status.${item.status}`)}
						</span>
					</div>
				</div>

				{layout === 'editor-center' && workflowItems.length > 1 ? (
					<div className="ref-team-role-panel-switcher">
						{workflowItems.map((entry) => (
							<button
								key={entry.id}
								type="button"
								className={`ref-team-role-switch ${entry.id === item.id ? 'is-active' : ''}`}
								onClick={() => onSelectTask(entry.id)}
							>
								{entry.expertName}
							</button>
						))}
					</div>
				) : null}
			</header>

			<div className="ref-team-role-shell-body" ref={scrollViewportRef} onScroll={onTranscriptScroll}>
				{transcript}
			</div>
		</section>
	);
});
