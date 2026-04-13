import { ChatMarkdown } from './ChatMarkdown';
import type { TFunction } from './i18n';
import type { TeamSessionState } from './hooks/useTeamSession';
import { getTeamWorkflowItemById } from './teamWorkflowItems';

type Props = {
	t: TFunction;
	session: TeamSessionState | null;
	selectedTaskId: string | null;
	onSelectTask: (taskId: string) => void;
	layout: 'agent-sidebar' | 'editor-center';
};

export function TeamRoleWorkflowPanel({ t, session, selectedTaskId, onSelectTask, layout }: Props) {
	if (!session) {
		return (
			<div className="ref-team-role-panel ref-team-role-panel--empty">
				<div className="ref-agent-plan-status-main">
					<div className="ref-agent-plan-status-title">{t('composer.mode.team')}</div>
					<p className="ref-agent-plan-status-body">{t('settings.team.empty')}</p>
				</div>
			</div>
		);
	}
	const item = getTeamWorkflowItemById(session, selectedTaskId ?? session.selectedTaskId);
	if (!item) {
		return (
			<div className="ref-team-role-panel ref-team-role-panel--empty">
				<div className="ref-agent-plan-status-main">
					<div className="ref-agent-plan-status-title">{t('composer.mode.team')}</div>
					<p className="ref-agent-plan-status-body">{t('app.selectFileToView')}</p>
				</div>
			</div>
		);
	}
	const workflow = item.workflow;
	const content =
		workflow?.streaming && workflow.awaitingReply
			? workflow.streaming
			: workflow?.messages[workflow.messages.length - 1]?.content || item.result || item.logs.join('\n') || item.description;

	return (
		<section className={`ref-team-role-panel ref-team-role-panel--${layout}`}>
			<div className="ref-team-role-panel-head">
				<div className="ref-team-role-panel-title-stack">
					<span className="ref-team-role-panel-kicker">{item.roleKind === 'reviewer' ? 'Reviewer' : t('composer.mode.team')}</span>
					<strong className="ref-team-role-panel-title">{item.expertName}</strong>
					<span className="ref-team-role-panel-subtitle">{item.description}</span>
				</div>
				<div className="ref-team-role-panel-switcher">
					{Object.values(session.roleWorkflowByTaskId).length > 1 || session.tasks.length > 1 ? (
						session.tasks
							.map((task) => ({
								id: task.id,
								label: task.expertName,
							}))
							.concat(
								session.reviewerTaskId
									? [{ id: session.reviewerTaskId, label: session.roleWorkflowByTaskId[session.reviewerTaskId]?.expertName ?? 'Reviewer' }]
									: []
							)
							.filter((entry, index, arr) => arr.findIndex((other) => other.id === entry.id) === index)
							.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className={`ref-team-role-switch ${entry.id === item.id ? 'is-active' : ''}`}
									onClick={() => onSelectTask(entry.id)}
								>
									{entry.label}
								</button>
							))
					) : null}
				</div>
			</div>
			<div className="ref-team-role-panel-body">
				<ChatMarkdown
					content={content}
					agentUi
					workspaceRoot={null}
					showAgentWorking={workflow?.awaitingReply ?? false}
					liveAgentBlocksState={workflow?.liveBlocks ?? null}
					liveThoughtMeta={
						workflow
							? {
									phase: workflow.awaitingReply ? (workflow.streaming ? 'streaming' : 'thinking') : 'done',
									elapsedSeconds: 0,
									streamingThinking: workflow.streamingThinking,
									tokenUsage: workflow.lastTurnUsage,
							  }
							: null
					}
				/>
			</div>
		</section>
	);
}
