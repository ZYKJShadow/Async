import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type {
	AiCollabMessage,
	AiEmployeeCatalogEntry,
	AiEmployeesOrchestrationState,
	AiOrchestrationHandoffStatus,
	AiOrchestrationTimelineEvent,
} from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';
import {
	describeCollaborationContract,
	formatRuleDrivenMessageBody,
	getEmployeeCollaborationContract,
	getPrimaryRuleHint,
	hasEmployeeCollaborationContract,
	HANDOFF_REPORT_TEMPLATE,
} from '../domain/collaborationRules';

function personName(catalog: AiEmployeeCatalogEntry[], employees: OrgEmployee[], id?: string): string {
	if (!id) {
		return '?';
	}
	return (
		catalog.find((entry) => entry.id === id)?.displayName ??
		employees.find((employee) => employee.id === id)?.displayName ??
		id.slice(0, 8)
	);
}

function statusTone(status: string): string {
	switch (status) {
		case 'completed':
			return 'is-done';
		case 'awaiting_approval':
			return 'is-pending';
		case 'cancelled':
			return 'is-muted';
		default:
			return 'is-running';
	}
}

function collaborationLabels(t: TFunction) {
	return {
		jobMission: t('aiEmployees.role.jobMission'),
		domainContext: t('aiEmployees.role.domainContext'),
		communicationNotes: t('aiEmployees.role.communicationNotes'),
		collaborationRules: t('aiEmployees.role.collaborationRules'),
		handoffRules: t('aiEmployees.role.handoffRules'),
		reportTemplate: t('aiEmployees.handoff.reportTemplateLabel'),
	};
}

export function OrchestratorPage({
	t,
	orchestration,
	employeeCatalog = [],
	orgEmployees = [],
	onCreateRun,
	onApproveGit,
	onAddHandoff,
	onSetHandoffStatus,
	listMessagesByRun,
	listTimelineEventsByRun,
}: {
	t: TFunction;
	orchestration: AiEmployeesOrchestrationState;
	employeeCatalog?: AiEmployeeCatalogEntry[];
	orgEmployees?: OrgEmployee[];
	onCreateRun: (goal: string, targetBranch: string) => string;
	onApproveGit: (runId: string) => Promise<{ ok: boolean; error?: string }>;
	onAddHandoff?: (runId: string, toEmployeeId: string, note?: string, messageBody?: string) => void;
	onSetHandoffStatus?: (runId: string, handoffId: string, status: AiOrchestrationHandoffStatus) => void;
	listMessagesByRun: (runId: string) => AiCollabMessage[];
	listTimelineEventsByRun: (runId: string) => AiOrchestrationTimelineEvent[];
}) {
	const [goal, setGoal] = useState('');
	const [branch, setBranch] = useState('');
	const [actionErr, setActionErr] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState('');
	const [handoffToId, setHandoffToId] = useState('');
	const [handoffNote, setHandoffNote] = useState('');

	useEffect(() => {
		if (!selectedRunId && orchestration.runs[0]?.id) {
			setSelectedRunId(orchestration.runs[0].id);
		}
		if (selectedRunId && !orchestration.runs.some((run) => run.id === selectedRunId)) {
			setSelectedRunId(orchestration.runs[0]?.id ?? '');
		}
	}, [orchestration.runs, selectedRunId]);

	const selectedRun = orchestration.runs.find((run) => run.id === selectedRunId) ?? orchestration.runs[0];
	const timeline = useMemo(() => (selectedRun ? listTimelineEventsByRun(selectedRun.id) : []), [listTimelineEventsByRun, selectedRun]);
	const messages = useMemo(() => (selectedRun ? listMessagesByRun(selectedRun.id) : []), [listMessagesByRun, selectedRun]);
	const showHandoffs = Boolean(onAddHandoff && onSetHandoffStatus);
	const selectedHandoffEmployee = useMemo(
		() => orgEmployees.find((employee) => employee.id === handoffToId),
		[handoffToId, orgEmployees]
	);
	const handoffContract = useMemo(
		() => getEmployeeCollaborationContract(selectedHandoffEmployee),
		[selectedHandoffEmployee]
	);
	const handoffContractSections = useMemo(
		() => describeCollaborationContract(handoffContract, collaborationLabels(t)),
		[handoffContract, t]
	);
	const handoffMessageBody = useMemo(
		() =>
			formatRuleDrivenMessageBody(
				[selectedRun?.goal, handoffNote.trim()].filter(Boolean).join('\n\n'),
				handoffContract,
				collaborationLabels(t)
			),
		[handoffContract, handoffNote, selectedRun?.goal, t]
	);

	useEffect(() => {
		if (!handoffToId || handoffNote.trim()) {
			return;
		}
		const hint = getPrimaryRuleHint(handoffContract);
		if (hint) {
			setHandoffNote(hint);
		}
	}, [handoffContract, handoffNote, handoffToId]);

	return (
		<div className="ref-ai-employees-runs-root">
			<div className="ref-ai-employees-runs-toolbar">
				<div>
					<div className="ref-ai-employees-runs-title">{t('aiEmployees.tab.runs')}</div>
					<p className="ref-ai-employees-muted ref-ai-employees-runs-subtitle">{t('aiEmployees.orchestratorCollabHint')}</p>
				</div>
				<div className="ref-ai-employees-form ref-ai-employees-form--inline ref-ai-employees-runs-create-form">
					<label>
						<span>{t('aiEmployees.orchestratorGoal')}</span>
						<input className="ref-ai-employees-input" value={goal} onChange={(event) => setGoal(event.target.value)} />
					</label>
					<label>
						<span>{t('aiEmployees.orchestratorBranch')}</span>
						<input className="ref-ai-employees-input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/ai-collab" />
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
								const runId = onCreateRun(goal.trim(), branch.trim());
								setSelectedRunId(runId);
								setGoal('');
								setBranch('');
							}}
						>
							{t('aiEmployees.orchestratorCreateRun')}
						</button>
					</div>
				</div>
			</div>
			{actionErr ? (
				<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
					{actionErr}
				</div>
			) : null}
			<div className="ref-ai-employees-runs-workbench">
				<aside className="ref-ai-employees-runs-list-col">
					<div className="ref-ai-employees-runs-col-head">{t('aiEmployees.tab.runs')}</div>
					<ul className="ref-ai-employees-runs-list">
						{orchestration.runs.map((run) => (
							<li key={run.id}>
								<button
									type="button"
									className={`ref-ai-employees-runs-list-item ${selectedRun?.id === run.id ? 'is-active' : ''}`}
									onClick={() => setSelectedRunId(run.id)}
								>
									<div className="ref-ai-employees-runs-list-item-title">{run.goal}</div>
									<div className="ref-ai-employees-runs-list-item-meta">
										<span className={`ref-ai-employees-run-badge ${statusTone(run.status)}`}>{run.status}</span>
										<span>{personName(employeeCatalog, orgEmployees, run.currentAssigneeEmployeeId)}</span>
									</div>
									<div className="ref-ai-employees-runs-list-item-foot">{run.statusSummary ?? '?'}</div>
								</button>
							</li>
						))}
					</ul>
				</aside>
				<section className="ref-ai-employees-runs-detail-col">
					{selectedRun ? (
						<>
							<div className="ref-ai-employees-runs-col-head">{t('aiEmployees.orchestratorGoal')}</div>
							<div className="ref-ai-employees-runs-summary-card">
								<h3>{selectedRun.goal}</h3>
								<div className="ref-ai-employees-runs-meta-grid">
									<div>
										<span>{t('aiEmployees.orchestratorBranch')}</span>
										<strong>{selectedRun.targetBranch || '?'}</strong>
									</div>
									<div>
										<span>{t('aiEmployees.runs.owner')}</span>
										<strong>{personName(employeeCatalog, orgEmployees, selectedRun.ownerEmployeeId)}</strong>
									</div>
									<div>
										<span>{t('aiEmployees.runs.assignee')}</span>
										<strong>{personName(employeeCatalog, orgEmployees, selectedRun.currentAssigneeEmployeeId)}</strong>
									</div>
									<div>
										<span>{t('aiEmployees.runs.updatedAt')}</span>
										<strong>{selectedRun.lastEventAtIso ? new Date(selectedRun.lastEventAtIso).toLocaleString() : '?'}</strong>
									</div>
								</div>
							</div>

							<div className="ref-ai-employees-runs-section">
								<div className="ref-ai-employees-runs-section-title">{t('aiEmployees.handoffChain')}</div>
								<ul className="ref-ai-employees-runs-handoff-list">
									{selectedRun.handoffs.map((handoff) => (
										<li key={handoff.id} className={`ref-ai-employees-runs-handoff-item is-${handoff.status}`}>
											<div className="ref-ai-employees-runs-handoff-head">
												<strong>{personName(employeeCatalog, orgEmployees, handoff.fromEmployeeId)} → {personName(employeeCatalog, orgEmployees, handoff.toEmployeeId)}</strong>
												<span className={`ref-ai-employees-run-badge is-${handoff.status}`}>{t(`aiEmployees.handoffStatus.${handoff.status}`)}</span>
											</div>
											{handoff.note ? <div className="ref-ai-employees-runs-handoff-note">{handoff.note}</div> : null}
											{handoff.resultSummary ? <div className="ref-ai-employees-runs-handoff-note">{handoff.resultSummary}</div> : null}
											<div className="ref-ai-employees-runs-handoff-foot">
												<span>{handoff.taskId || '?'}</span>
												{showHandoffs ? (
													<select
														className="ref-settings-native-select ref-ai-employees-orchestrator-handoff-status"
														value={handoff.status}
														onChange={(event) => onSetHandoffStatus?.(selectedRun.id, handoff.id, event.target.value as AiOrchestrationHandoffStatus)}
													>
														<option value="pending">{t('aiEmployees.handoffStatus.pending')}</option>
														<option value="in_progress">{t('aiEmployees.handoffStatus.in_progress')}</option>
														<option value="blocked">{t('aiEmployees.handoffStatus.blocked')}</option>
														<option value="done">{t('aiEmployees.handoffStatus.done')}</option>
													</select>
												) : null}
											</div>
										</li>
									))}
								</ul>
								{showHandoffs ? (
									<>
										<div className="ref-ai-employees-runs-handoff-add">
											<select className="ref-settings-native-select" value={handoffToId} onChange={(event) => setHandoffToId(event.target.value)}>
												<option value="">{t('aiEmployees.handoffPickMember')}</option>
												{orgEmployees.map((employee) => (
													<option key={employee.id} value={employee.id}>{employee.displayName}</option>
												))}
											</select>
											<input className="ref-ai-employees-input" value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} placeholder={t('aiEmployees.handoffNotePh')} />
											<button
												type="button"
												className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
												disabled={!handoffToId}
												onClick={() => {
													onAddHandoff?.(
														selectedRun.id,
														handoffToId,
														handoffNote.trim() || undefined,
														handoffMessageBody
													);
													setHandoffToId('');
													setHandoffNote('');
												}}
											>
												{t('aiEmployees.handoffAdd')}
											</button>
										</div>
										{selectedHandoffEmployee && hasEmployeeCollaborationContract(handoffContract) ? (
											<div className="ref-ai-employees-panel">
												<strong>{t('aiEmployees.handoff.guidanceTitle')}</strong>
												<p className="ref-ai-employees-muted">{t('aiEmployees.handoff.rulesAppliedHint')}</p>
												<ul className="ref-ai-employees-runs-message-list">
													{handoffContractSections.map((section) => (
														<li key={section.label}>
															<div className="ref-ai-employees-runs-message-summary">{section.label}</div>
															<div className="ref-ai-employees-runs-message-body">{section.value}</div>
														</li>
													))}
													<li>
														<div className="ref-ai-employees-runs-message-summary">{t('aiEmployees.handoff.reportTemplateLabel')}</div>
														<div className="ref-ai-employees-runs-message-body">{HANDOFF_REPORT_TEMPLATE.join(' / ')}</div>
													</li>
												</ul>
											</div>
										) : null}
									</>
								) : null}
							</div>

							<div className="ref-ai-employees-runs-section">
								<div className="ref-ai-employees-runs-section-title">{t('aiEmployees.runs.messages')}</div>
								<ul className="ref-ai-employees-runs-message-list">
									{messages.map((message) => (
										<li key={message.id}>
											<div className="ref-ai-employees-runs-message-summary">{message.summary}</div>
											<div className="ref-ai-employees-runs-message-body">{message.body}</div>
										</li>
									))}
								</ul>
							</div>
						</>
					) : (
						<div className="ref-ai-employees-stub">{t('aiEmployees.runs.empty')}</div>
					)}
				</section>
				<aside className="ref-ai-employees-runs-side-col">
					<div className="ref-ai-employees-runs-col-head">{t('aiEmployees.runs.timeline')}</div>
					<div className="ref-ai-employees-runs-approval-card">
						<div className="ref-ai-employees-runs-approval-title">{t('aiEmployees.runs.approvals')}</div>
						{selectedRun ? (
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
								disabled={!selectedRun.targetBranch || selectedRun.gitApproved}
								onClick={async () => {
									setActionErr(null);
									const result = await onApproveGit(selectedRun.id);
									if (!result.ok) {
										setActionErr(result.error ?? t('aiEmployees.orchestratorGitFailed'));
									}
								}}
							>
								{selectedRun.gitApproved ? t('aiEmployees.orchestratorGitDone') : t('aiEmployees.orchestratorGitApprove')}
							</button>
						) : null}
					</div>
					<ul className="ref-ai-employees-runs-timeline">
						{timeline.map((event) => (
							<li key={event.id} className="ref-ai-employees-runs-timeline-item">
								<div className="ref-ai-employees-runs-timeline-label">{event.label}</div>
								{event.description ? <div className="ref-ai-employees-runs-timeline-desc">{event.description}</div> : null}
								<div className="ref-ai-employees-runs-timeline-time">{new Date(event.createdAtIso).toLocaleString()}</div>
							</li>
						))}
					</ul>
				</aside>
			</div>
		</div>
	);
}
