import { memo, useMemo } from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import { TeamExpertCard } from './TeamExpertCard';
import { TeamRoleAvatar } from './TeamRoleAvatar';
import type { TFunction } from './i18n';
import type { TeamSessionState } from './hooks/useTeamSession';

type Props = {
	t: TFunction;
	session: TeamSessionState;
	onSelectExpert: (taskId: string) => void;
	layout: 'agent-center' | 'editor-rail';
};

function phaseLabel(t: TFunction, phase: TeamSessionState['phase']) {
	return t(`team.phase.${phase}`);
}

const PHASE_STEPS: TeamSessionState['phase'][] = ['researching', 'planning', 'executing', 'reviewing', 'synthesizing', 'delivering'];

function phaseIndex(phase: TeamSessionState['phase']): number {
	const idx = PHASE_STEPS.indexOf(phase);
	return idx >= 0 ? idx : 0;
}

export const TeamSessionView = memo(function TeamSessionView({ t, session, onSelectExpert, layout }: Props) {
	const done = session.tasks.filter((x) => x.status === 'completed').length;
	const total = session.tasks.length;
	const selectedTask =
		session.tasks.find((x) => x.id === session.selectedTaskId) ?? session.tasks[0] ?? null;
	const progressText = t('team.taskProgress', {
		done: String(done),
		total: String(total),
	});
	const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;
	const currentPhaseIdx = phaseIndex(session.phase);

	const logMarkdown = useMemo(() => {
		if (!selectedTask) return '';
		const logs = selectedTask.logs.slice(-20);
		return logs.length > 0 ? logs.map((line) => `- ${line}`).join('\n') : selectedTask.result ?? '';
	}, [selectedTask]);

	return (
		<div className={`ref-team-session ${layout === 'editor-rail' ? 'is-editor' : 'is-agent'}`}>
			{/* Phase stepper */}
			<div className="ref-team-session-head">
				<div className="ref-team-phase-stepper">
					{PHASE_STEPS.map((step, i) => (
						<div
							key={step}
							className={`ref-team-phase-step${i < currentPhaseIdx ? ' is-completed' : ''}${i === currentPhaseIdx ? ' is-active' : ''}`}
						>
							<span className="ref-team-phase-dot" />
							<span className="ref-team-phase-label">{phaseLabel(t, step)}</span>
						</div>
					))}
				</div>
				<div className="ref-team-progress-row">
					<div className="ref-team-progress-bar">
						<div className="ref-team-progress-fill" style={{ width: `${progressPercent}%` }} />
					</div>
					<span className="ref-team-progress-text">{progressText}</span>
				</div>
			</div>

			{/* Planning summary */}
			{session.planSummary ? (
				<details
					className="ref-team-plan-summary"
					open={session.phase === 'planning' && !session.finalSummary}
				>
					<summary>{t('team.phase.planning')}</summary>
					<ChatMarkdown content={session.planSummary} />
				</details>
			) : null}

			{/* Lead final synthesis */}
			{session.finalSummary ? (
				<div className="ref-team-lead-final">
					<strong>{t('team.phase.synthesizing')}</strong>
					<ChatMarkdown content={session.finalSummary} />
				</div>
			) : null}

			{/* Expert cards grid */}
			<div className="ref-team-expert-grid">
				{session.tasks.map((task) => (
					<TeamExpertCard
						key={task.id}
						task={task}
						active={selectedTask?.id === task.id}
						onSelect={() => onSelectExpert(task.id)}
					/>
				))}
			</div>

			{/* Detail panel */}
			<div className="ref-team-detail">
				{selectedTask ? (
					<>
						<div className="ref-team-detail-head">
							<TeamRoleAvatar
								roleType={selectedTask.roleType}
								assignmentKey={selectedTask.expertAssignmentKey}
								avatarSeed={selectedTask.id}
								small
							/>
							<strong>{selectedTask.expertName}</strong>
							<span className={`ref-team-expert-status ref-team-expert-status--${selectedTask.status}`}>
								{selectedTask.status}
							</span>
						</div>
						<ChatMarkdown content={logMarkdown || selectedTask.description} />
					</>
				) : (
					<div className="ref-team-empty">{t('settings.team.empty')}</div>
				)}
			</div>

			{/* Review summary */}
			{session.reviewVerdict ? (
				<div className={`ref-team-review-summary ref-team-review--${session.reviewVerdict}`}>
					<strong>{session.reviewVerdict === 'approved' ? '✅' : '⚠️'} {t('team.phase.reviewing')}</strong>
					<ChatMarkdown content={session.reviewSummary} />
				</div>
			) : null}
		</div>
	);
});

