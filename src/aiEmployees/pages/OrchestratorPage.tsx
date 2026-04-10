import { useState } from 'react';
import type { TFunction } from '../../i18n';
import type {
	AiEmployeeCatalogEntry,
	AiEmployeesOrchestrationState,
	AiOrchestrationHandoffStatus,
	AiOrchestrationRun,
} from '../../../shared/aiEmployeesSettings';

function catalogName(catalog: AiEmployeeCatalogEntry[], id: string): string {
	const e = catalog.find((x) => x.id === id);
	return e ? `${e.displayName} · ${e.role}` : id.slice(0, 8);
}

function RunHandoffControls({
	t,
	run,
	catalog,
	onAdd,
	onSetStatus,
}: {
	t: TFunction;
	run: AiOrchestrationRun;
	catalog: AiEmployeeCatalogEntry[];
	onAdd: (toEmployeeId: string, note?: string) => void;
	onSetStatus: (handoffId: string, status: AiOrchestrationHandoffStatus) => void;
}) {
	const [toId, setToId] = useState('');
	const [note, setNote] = useState('');

	return (
		<div className="ref-ai-employees-orchestrator-handoffs">
			<div className="ref-ai-employees-orchestrator-handoffs-label">{t('aiEmployees.handoffChain')}</div>
			{run.handoffs.length === 0 ? (
				<p className="ref-ai-employees-muted ref-ai-employees-orchestrator-handoffs-empty">{t('aiEmployees.handoffEmpty')}</p>
			) : (
				<ul className="ref-ai-employees-orchestrator-handoff-list">
					{run.handoffs.map((h, i) => (
						<li key={h.id} className="ref-ai-employees-orchestrator-handoff-row">
							<span className="ref-ai-employees-orchestrator-handoff-idx">{i + 1}</span>
							<div className="ref-ai-employees-orchestrator-handoff-main">
								<div className="ref-ai-employees-orchestrator-handoff-target">
									{t('aiEmployees.handoffAssignTo')}{' '}
									<strong>{catalogName(catalog, h.toEmployeeId)}</strong>
								</div>
								{h.note ? <div className="ref-ai-employees-orchestrator-handoff-note">{h.note}</div> : null}
								<select
									className="ref-settings-native-select ref-ai-employees-orchestrator-handoff-status"
									value={h.status}
									onChange={(e) => onSetStatus(h.id, e.target.value as AiOrchestrationHandoffStatus)}
									aria-label={t('aiEmployees.handoffStatusAria')}
								>
									<option value="pending">{t('aiEmployees.handoffStatus.pending')}</option>
									<option value="in_progress">{t('aiEmployees.handoffStatus.in_progress')}</option>
									<option value="blocked">{t('aiEmployees.handoffStatus.blocked')}</option>
									<option value="done">{t('aiEmployees.handoffStatus.done')}</option>
								</select>
							</div>
						</li>
					))}
				</ul>
			)}
			<div className="ref-ai-employees-orchestrator-handoff-add">
				<select
					className="ref-settings-native-select ref-ai-employees-orchestrator-handoff-select"
					value={toId}
					onChange={(e) => setToId(e.target.value)}
					aria-label={t('aiEmployees.handoffPickMember')}
				>
					<option value="">{t('aiEmployees.handoffPickMember')}</option>
					{catalog.map((e) => (
						<option key={e.id} value={e.id}>
							{e.displayName} — {e.role}
						</option>
					))}
				</select>
				<input
					className="ref-ai-employees-input ref-ai-employees-orchestrator-handoff-note-input"
					value={note}
					onChange={(e) => setNote(e.target.value)}
					placeholder={t('aiEmployees.handoffNotePh')}
				/>
				<button
					type="button"
					className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
					disabled={!toId}
					onClick={() => {
						onAdd(toId, note.trim() || undefined);
						setToId('');
						setNote('');
					}}
				>
					{t('aiEmployees.handoffAdd')}
				</button>
			</div>
		</div>
	);
}

export function OrchestratorPage({
	t,
	orchestration,
	employeeCatalog = [],
	onCreateRun,
	onApproveGit,
	onAddHandoff,
	onSetHandoffStatus,
	embedded,
}: {
	t: TFunction;
	orchestration: AiEmployeesOrchestrationState;
	employeeCatalog?: AiEmployeeCatalogEntry[];
	onCreateRun: (goal: string, targetBranch: string) => void;
	onApproveGit: (runId: string) => Promise<{ ok: boolean; error?: string }>;
	onAddHandoff?: (runId: string, toEmployeeId: string, note?: string) => void;
	onSetHandoffStatus?: (runId: string, handoffId: string, status: AiOrchestrationHandoffStatus) => void;
	embedded?: boolean;
}) {
	const [goal, setGoal] = useState('');
	const [branch, setBranch] = useState('');
	const [actionErr, setActionErr] = useState<string | null>(null);

	const showHandoffs = Boolean(onAddHandoff && onSetHandoffStatus);

	return (
		<div
			className={
				embedded
					? 'ref-ai-employees-orchestrator ref-ai-employees-orchestrator--embedded'
					: 'ref-ai-employees-panel ref-ai-employees-orchestrator'
			}
		>
			<p className="ref-ai-employees-muted">{t('aiEmployees.orchestratorHint')}</p>
			<p className="ref-ai-employees-muted ref-ai-employees-orchestrator-collab-hint">{t('aiEmployees.orchestratorCollabHint')}</p>
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
			{showHandoffs && employeeCatalog.length === 0 ? (
				<p className="ref-ai-employees-muted ref-ai-employees-orchestrator-catalog-hint">{t('aiEmployees.handoffCatalogEmpty')}</p>
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
						{showHandoffs ? (
							<RunHandoffControls
								t={t}
								run={run}
								catalog={employeeCatalog}
								onAdd={(toEmployeeId, note) => onAddHandoff!(run.id, toEmployeeId, note)}
								onSetStatus={(handoffId, status) => onSetHandoffStatus!(run.id, handoffId, status)}
							/>
						) : null}
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
