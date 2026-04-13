import { useMemo, useState } from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import { TeamExpertCard } from './TeamExpertCard';
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

const PHASE_STEPS: TeamSessionState['phase'][] = ['planning', 'executing', 'reviewing', 'delivering'];

function phaseIndex(phase: TeamSessionState['phase']): number {
	const idx = PHASE_STEPS.indexOf(phase);
	return idx >= 0 ? idx : 0;
}

export function TeamSessionView({ t, session, onSelectExpert, layout }: Props) {
	const [inputText, setInputText] = useState('');

	const submitUserInput = async () => {
		if (!session.userInputRequest || !window.asyncShell) return;
		const answerText = inputText.trim();
		if (!answerText) return;
		await window.asyncShell.invoke('team:userInputRespond', {
			requestId: session.userInputRequest.requestId,
			answerText,
		});
		setInputText('');
	};

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
				<details className="ref-team-plan-summary" open={session.phase === 'planning'}>
					<summary>{t('team.phase.planning')}</summary>
					<ChatMarkdown content={session.planSummary} />
				</details>
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
				{session.userInputRequest ? (
					<div className="ref-team-user-input-card">
						<div className="ref-team-detail-head">
							<strong>{session.userInputRequest.question}</strong>
						</div>
						<div className="ref-team-user-input-options">
							{session.userInputRequest.options.map((opt) => (
								<button
									key={opt.id}
									type="button"
									className="ref-team-user-input-option"
									onClick={() => setInputText(opt.label)}
								>
									{opt.label}
								</button>
							))}
						</div>
						<div className="ref-team-user-input-row">
							<input
								className="ref-settings-models-search"
								value={inputText}
								placeholder={t('settings.team.inputPlaceholder')}
								onChange={(e) => setInputText(e.target.value)}
								onKeyDown={(e) => { if (e.key === 'Enter') void submitUserInput(); }}
							/>
							<button type="button" className="ref-settings-add-model" onClick={() => void submitUserInput()}>
								{t('settings.team.submitInput')}
							</button>
						</div>
					</div>
				) : null}

				{selectedTask ? (
					<>
						<div className="ref-team-detail-head">
							<span className={`ref-team-expert-avatar ref-team-expert-avatar--${selectedTask.roleType} ref-team-avatar-sm`}>
								{selectedTask.expertName.slice(0, 1).toUpperCase()}
							</span>
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
}
