import { memo } from 'react';
import { buildTeamWorkflowItems, type TeamWorkflowListItem } from './teamWorkflowItems';
import { TeamRoleAvatar } from './TeamRoleAvatar';
import type { TFunction } from './i18n';
import type { TeamSessionState, TeamTaskStatus } from './hooks/useTeamSession';

type Props = {
	t: TFunction;
	session: TeamSessionState;
	onSelectTask: (taskId: string) => void;
};

function statusLabel(t: TFunction, status: TeamTaskStatus): string {
	return t(`team.timeline.status.${status}`);
}

function roleKindLabel(t: TFunction, item: TeamWorkflowListItem): string {
	return t(`team.timeline.role.${item.roleKind}`);
}

export const TeamWorkflowTimelineCard = memo(function TeamWorkflowTimelineCard({ t, session, onSelectTask }: Props) {
	const items = buildTeamWorkflowItems(session);
	const specialistItems = items.filter((item) => item.roleKind === 'specialist');
	const reviewerItems = items.filter((item) => item.roleKind === 'reviewer');
	const completedCount = items.filter((item) => item.status === 'completed').length;

	return (
		<section className="ref-team-timeline-card" aria-label={t('composer.mode.team')}>
			<div className="ref-team-timeline-head">
				<div className="ref-team-timeline-title-stack">
					<span className="ref-team-timeline-kicker">{t('composer.mode.team')}</span>
					<strong className="ref-team-timeline-title">{t(`team.phase.${session.phase}`)}</strong>
				</div>
				<span className="ref-team-timeline-progress">
					{completedCount}/{items.length || 0}
				</span>
			</div>

			<div className="ref-team-timeline-section">
				<div className="ref-team-timeline-section-label">{t('team.timeline.rolesLabel')}</div>
				<div className="ref-team-timeline-list">
					{specialistItems.length > 0 ? (
						specialistItems.map((item) => (
							<button
								key={item.id}
								type="button"
								className={`ref-team-timeline-item ${session.selectedTaskId === item.id ? 'is-active' : ''}`}
								onClick={() => onSelectTask(item.id)}
							>
								<TeamRoleAvatar
									roleType={item.roleType}
									assignmentKey={item.expertAssignmentKey ?? item.expertId}
								/>
								<span className="ref-team-timeline-item-copy">
									<span className="ref-team-timeline-item-meta">{roleKindLabel(t, item)}</span>
									<span className="ref-team-timeline-item-title">{item.expertName}</span>
									<span className="ref-team-timeline-item-body">{item.description}</span>
								</span>
								<span className={`ref-team-expert-status ref-team-expert-status--${item.status}`}>
									{item.status === 'in_progress' ? <span className="ref-team-pulse" /> : null}
									{statusLabel(t, item.status)}
								</span>
							</button>
						))
					) : (
						<div className="ref-team-timeline-empty">{t('team.timeline.preparing')}</div>
					)}
				</div>
			</div>

			{reviewerItems.length > 0 ? (
				<div className="ref-team-timeline-section">
					<div className="ref-team-timeline-section-label">{t('team.timeline.reviewLabel')}</div>
					<div className="ref-team-timeline-list">
						{reviewerItems.map((item) => (
							<button
								key={item.id}
								type="button"
								className={`ref-team-timeline-item ${session.selectedTaskId === item.id ? 'is-active' : ''}`}
								onClick={() => onSelectTask(item.id)}
							>
								<TeamRoleAvatar
									roleType={item.roleType}
									assignmentKey={item.expertAssignmentKey ?? item.expertId}
								/>
								<span className="ref-team-timeline-item-copy">
									<span className="ref-team-timeline-item-meta">{roleKindLabel(t, item)}</span>
									<span className="ref-team-timeline-item-title">{item.expertName}</span>
									<span className="ref-team-timeline-item-body">{item.description}</span>
								</span>
								<span className={`ref-team-expert-status ref-team-expert-status--${item.status}`}>
									{item.status === 'in_progress' ? <span className="ref-team-pulse" /> : null}
									{statusLabel(t, item.status)}
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}
		</section>
	);
});
