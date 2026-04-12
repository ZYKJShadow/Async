import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiOrchestrationRun } from '../../../shared/aiEmployeesSettings';
import { runHeaderProgress } from '../domain/runHeaderMetrics';
import { IconStop } from '../../icons';

function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function RunHeaderBar({
	t,
	run,
	presenceLine,
	onStop,
	onApproveGit,
}: {
	t: TFunction;
	run: AiOrchestrationRun;
	presenceLine?: string;
	onStop: () => void;
	onApproveGit?: () => void;
}) {
	const [now, setNow] = useState(() => Date.now());
	const started = Date.parse(run.createdAtIso);
	const elapsedOk = !Number.isNaN(started);

	useEffect(() => {
		if (run.status === 'completed' || run.status === 'cancelled') {
			return;
		}
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [run.status]);

	const elapsedMs = elapsedOk ? now - started : 0;
	const progress = useMemo(() => runHeaderProgress(run), [run]);

	const showApprove =
		(run.approvalState === 'pending_git' || run.approvalState === 'pending_handoff') && Boolean(onApproveGit);
	const canStop = run.status !== 'completed' && run.status !== 'cancelled';
	const [pauseHint, setPauseHint] = useState<string | null>(null);
	useEffect(() => {
		if (!pauseHint) {
			return;
		}
		const tmr = window.setTimeout(() => setPauseHint(null), 4500);
		return () => window.clearTimeout(tmr);
	}, [pauseHint]);

	return (
		<div className="ref-ai-employees-run-header-bar">
			<div className="ref-ai-employees-run-header-bar-row ref-ai-employees-run-header-bar-row--goal">
				<span className="ref-ai-employees-run-header-bar-goal-ico" aria-hidden>
					{'\u{1F3AF}'}
				</span>
				<span className="ref-ai-employees-run-header-bar-goal">{run.goal}</span>
			</div>
			<div className="ref-ai-employees-run-header-bar-row ref-ai-employees-run-header-bar-row--meta">
				<span className="ref-ai-employees-run-header-bar-elapsed" title={t('aiEmployees.groupChat.runHeaderElapsed')}>
					{'\u23F1 '}
					{elapsedOk ? formatElapsed(elapsedMs) : '—'}
				</span>
				{progress ? (
					<span className="ref-ai-employees-run-header-bar-progress">
						<span className="ref-ai-employees-run-header-bar-dots" aria-hidden>
							{Array.from({ length: progress.total }, (_, i) => (
								<span key={i} className={i < progress.done ? 'is-done' : ''} />
							))}
						</span>
						<span className="ref-ai-employees-run-header-bar-progress-text">
							{t('aiEmployees.groupChat.runHeaderProgress', {
								done: String(progress.done),
								total: String(progress.total),
							})}
						</span>
					</span>
				) : (
					<span className="ref-ai-employees-run-header-bar-muted">{t('aiEmployees.groupChat.runHeaderNoPlan')}</span>
				)}
			</div>
			{presenceLine ? (
				<div className="ref-ai-employees-run-header-bar-presence" title={presenceLine}>
					<span className="ref-ai-employees-run-header-bar-presence-ico" aria-hidden>
						{'\u{1F916}'}
					</span>
					<span className="ref-ai-employees-run-header-bar-presence-text">{presenceLine}</span>
				</div>
			) : null}
			<div className="ref-ai-employees-run-header-bar-actions">
				<button
					type="button"
					className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-run-header-btn"
					title={t('aiEmployees.groupChat.runHeaderPauseHint')}
					onClick={() => setPauseHint(t('aiEmployees.groupChat.runHeaderPauseHint'))}
				>
					{t('aiEmployees.groupChat.runHeaderPause')}
				</button>
				<button
					type="button"
					className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-run-header-btn ref-ai-employees-run-header-btn--danger"
					disabled={!canStop}
					onClick={() => {
						setPauseHint(null);
						onStop();
					}}
					title={t('aiEmployees.groupChat.runHeaderStopHint')}
				>
					<IconStop className="ref-ai-employees-run-header-btn-ico" aria-hidden />
					{t('aiEmployees.groupChat.runHeaderStop')}
				</button>
				{showApprove ? (
					<button
						type="button"
						className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-run-header-btn"
						onClick={() => onApproveGit?.()}
					>
						{t('aiEmployees.groupChat.runHeaderApprove')}
					</button>
				) : null}
			</div>
			{pauseHint ? (
				<p className="ref-ai-employees-run-header-bar-hint" role="status">
					{pauseHint}
				</p>
			) : null}
		</div>
	);
}
