import { useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeesOrchestrationState } from '../../../shared/aiEmployeesSettings';

export function OrchestratorPage({
	t,
	orchestration,
	onCreateRun,
	onApproveGit,
}: {
	t: TFunction;
	orchestration: AiEmployeesOrchestrationState;
	onCreateRun: (goal: string, targetBranch: string) => void;
	onApproveGit: (runId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
	const [goal, setGoal] = useState('');
	const [branch, setBranch] = useState('');
	const [actionErr, setActionErr] = useState<string | null>(null);

	return (
		<div className="ref-ai-employees-panel ref-ai-employees-orchestrator">
			<p className="ref-ai-employees-muted">{t('aiEmployees.orchestratorHint')}</p>
			<div className="ref-ai-employees-form ref-ai-employees-form--inline">
				<label>
					<span>{t('aiEmployees.orchestratorGoal')}</span>
					<input className="ref-ai-employees-input" value={goal} onChange={(e) => setGoal(e.target.value)} />
				</label>
				<label>
					<span>{t('aiEmployees.orchestratorBranch')}</span>
					<input
						className="ref-ai-employees-input"
						value={branch}
						onChange={(e) => setBranch(e.target.value)}
						placeholder="feature/ai-employees-…"
					/>
				</label>
				<div className="ref-ai-employees-form-actions">
					<button
						type="button"
						className="ref-ai-employees-btn ref-ai-employees-btn--primary"
						onClick={() => {
							setActionErr(null);
							if (!goal.trim()) {
								setActionErr(t('aiEmployees.orchestratorGoalRequired'));
								return;
							}
							onCreateRun(goal.trim(), branch.trim());
							setGoal('');
							setBranch('');
						}}
					>
						{t('aiEmployees.orchestratorCreateRun')}
					</button>
				</div>
			</div>
			{actionErr ? (
				<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
					{actionErr}
				</div>
			) : null}
			<ul className="ref-ai-employees-orchestrator-runs">
				{orchestration.runs.map((run) => (
					<li key={run.id} className="ref-ai-employees-orchestrator-run">
						<div className="ref-ai-employees-orchestrator-run-head">
							<strong>{run.goal}</strong>
							<span className="ref-ai-employees-muted">
								{run.status} {run.targetBranch ? `· ${run.targetBranch}` : ''}
							</span>
						</div>
						<div className="ref-ai-employees-orchestrator-run-actions">
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
								disabled={!run.targetBranch || run.gitApproved}
								onClick={async () => {
									setActionErr(null);
									const r = await onApproveGit(run.id);
									if (!r.ok) {
										setActionErr(r.error ?? t('aiEmployees.orchestratorGitFailed'));
									}
								}}
							>
								{run.gitApproved ? t('aiEmployees.orchestratorGitDone') : t('aiEmployees.orchestratorGitApprove')}
							</button>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
