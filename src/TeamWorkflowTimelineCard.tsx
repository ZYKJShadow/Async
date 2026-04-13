import { buildTeamWorkflowItems, type TeamWorkflowListItem } from './teamWorkflowItems';
import type { TFunction } from './i18n';
import type { TeamSessionState } from './hooks/useTeamSession';

type Props = {
	t: TFunction;
	session: TeamSessionState;
	onSelectTask: (taskId: string) => void;
};

function statusLabel(item: TeamWorkflowListItem): string {
	return item.roleKind === 'reviewer' ? `reviewer · ${item.status}` : item.status;
}

export function TeamWorkflowTimelineCard({ t, session, onSelectTask }: Props) {
	const items = buildTeamWorkflowItems(session);
	return (
		<section className="ref-team-timeline-card" aria-label={t('composer.mode.team')}>
			<div className="ref-team-timeline-head">
				<div className="ref-team-timeline-title-stack">
					<span className="ref-team-timeline-kicker">{t('composer.mode.team')}</span>
					<strong className="ref-team-timeline-title">{session.phase}</strong>
				</div>
				<span className="ref-team-timeline-progress">
					{items.filter((item) => item.status === 'completed').length}/{items.length}
				</span>
			</div>
			{session.planSummary ? (
				<p className="ref-team-timeline-summary">{session.planSummary}</p>
			) : null}
			<div className="ref-team-timeline-list">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						className={`ref-team-timeline-item ${session.selectedTaskId === item.id ? 'is-active' : ''}`}
						onClick={() => onSelectTask(item.id)}
					>
						<span className={`ref-team-expert-avatar ref-team-expert-avatar--${item.roleType}`}>
							{item.expertName.slice(0, 1).toUpperCase()}
						</span>
						<span className="ref-team-timeline-item-copy">
							<span className="ref-team-timeline-item-title">{item.expertName}</span>
							<span className="ref-team-timeline-item-body">{item.description}</span>
						</span>
						<span className={`ref-team-expert-status ref-team-expert-status--${item.status}`}>
							{item.status === 'in_progress' ? <span className="ref-team-pulse" /> : null}
							{statusLabel(item)}
						</span>
					</button>
				))}
			</div>
			{session.userInputRequest ? (
				<div className="ref-team-timeline-input-needed">
					<strong>{session.userInputRequest.question}</strong>
				</div>
			) : null}
		</section>
	);
}
