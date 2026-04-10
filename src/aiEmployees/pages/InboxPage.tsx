import { useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from '../../i18n';
import { IconDotsHorizontal, IconInbox, IconSend } from '../../icons';
import type { AiCollabMessage, AiEmployeesOrchestrationState, AiOrchestrationRun } from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';
import {
	describeCollaborationContract,
	formatRuleDrivenMessageBody,
	getEmployeeCollaborationContract,
	hasEmployeeCollaborationContract,
	HANDOFF_REPORT_TEMPLATE,
} from '../domain/collaborationRules';

function latestBlockedReason(run: AiOrchestrationRun | undefined): string | undefined {
	return [...(run?.handoffs ?? [])].reverse().find((handoff) => handoff.status === 'blocked')?.blockedReason;
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

export function InboxPage({
	t,
	orgEmployees,
	orchestration: _orchestration,
	onCreateRun,
	onSendMessage,
	onMarkMessageRead,
	listMessagesByEmployee,
	findActiveRunByEmployee,
}: {
	t: TFunction;
	orgEmployees: OrgEmployee[];
	orchestration: AiEmployeesOrchestrationState;
	onCreateRun: (
		employeeId: string,
		title: string,
		details: string,
		targetBranch: string,
		options?: { assignmentBody?: string }
	) => string;
	onSendMessage: (input: {
		runId: string;
		type?: 'text' | 'task_assignment';
		body: string;
		summary?: string;
		toEmployeeId?: string;
	}) => void;
	onMarkMessageRead: (messageId: string) => void;
	listMessagesByEmployee: (employeeId: string) => AiCollabMessage[];
	findActiveRunByEmployee: (employeeId: string) => AiOrchestrationRun | undefined;
}) {
	const sorted = useMemo(
		() => [...orgEmployees].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })),
		[orgEmployees]
	);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [taskOpen, setTaskOpen] = useState(false);
	const [taskTitle, setTaskTitle] = useState('');
	const [taskBody, setTaskBody] = useState('');
	const [taskBranch, setTaskBranch] = useState('');
	const [moreOpen, setMoreOpen] = useState(false);
	const moreRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!selectedId && sorted[0]?.id) {
			setSelectedId(sorted[0].id);
		}
		if (selectedId && !sorted.some((employee) => employee.id === selectedId)) {
			setSelectedId(sorted[0]?.id ?? null);
		}
	}, [selectedId, sorted]);

	useEffect(() => {
		if (!moreOpen) {
			return;
		}
		const onDoc = (event: MouseEvent) => {
			if (!moreRef.current?.contains(event.target as Node)) {
				setMoreOpen(false);
			}
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [moreOpen]);

	const selected = selectedId ? sorted.find((employee) => employee.id === selectedId) : undefined;
	const thread = useMemo(() => (selectedId ? listMessagesByEmployee(selectedId) : []), [listMessagesByEmployee, selectedId]);
	const activeRun = selectedId ? findActiveRunByEmployee(selectedId) : undefined;
	const blocker = latestBlockedReason(activeRun);
	const contract = useMemo(() => getEmployeeCollaborationContract(selected), [selected]);
	const contractSections = useMemo(
		() => describeCollaborationContract(contract, collaborationLabels(t)),
		[contract, t]
	);
	const assignmentBodyPreview = useMemo(
		() => formatRuleDrivenMessageBody(taskBody, contract, collaborationLabels(t)),
		[contract, t, taskBody]
	);

	useEffect(() => {
		for (const message of thread) {
			if (message.toEmployeeId === selectedId && !message.readAtIso) {
				onMarkMessageRead(message.id);
			}
		}
	}, [onMarkMessageRead, selectedId, thread]);

	const unreadCountByEmployee = useMemo(() => {
		const map = new Map<string, number>();
		for (const employee of sorted) {
			const unread = listMessagesByEmployee(employee.id).filter(
				(message) => message.toEmployeeId === employee.id && !message.readAtIso
			).length;
			map.set(employee.id, unread);
		}
		return map;
	}, [listMessagesByEmployee, sorted]);

	const sendMessage = () => {
		const text = draft.trim();
		if (!selectedId || !text) {
			return;
		}
		if (activeRun) {
			onSendMessage({
				runId: activeRun.id,
				type: 'text',
				body: text,
				summary: text.slice(0, 80),
				toEmployeeId: selectedId,
			});
		} else {
			onCreateRun(selectedId, t('aiEmployees.inbox.defaultRunTitle'), text, '');
		}
		setDraft('');
	};

	const submitTask = () => {
		if (!selected) {
			return;
		}
		const title = taskTitle.trim();
		const body = taskBody.trim();
		if (!title) {
			return;
		}
		onCreateRun(selected.id, title, body, taskBranch.trim(), {
			assignmentBody: assignmentBodyPreview,
		});
		setTaskOpen(false);
		setTaskTitle('');
		setTaskBody('');
		setTaskBranch('');
	};

	return (
		<div className="ref-ai-employees-inbox">
			<div className="ref-ai-employees-inbox-split">
				<div className="ref-ai-employees-inbox-list-col">
					<div className="ref-ai-employees-inbox-list-head">
						<div className="ref-ai-employees-inbox-list-head-left">
							<h2 className="ref-ai-employees-inbox-list-title">{t('aiEmployees.tab.inbox')}</h2>
						</div>
						<div className="ref-ai-employees-inbox-list-head-actions" ref={moreRef}>
							<button
								type="button"
								className="ref-agent-sidebar-icon-btn"
								aria-expanded={moreOpen}
								aria-haspopup="menu"
								aria-label={t('aiEmployees.inbox.moreActions')}
								onClick={() => setMoreOpen((open) => !open)}
							>
								<IconDotsHorizontal />
							</button>
							{moreOpen ? (
								<div className="ref-ai-employees-inbox-dropdown" role="menu">
									<button type="button" className="ref-ai-employees-inbox-dropdown-item" role="menuitem" onClick={() => setMoreOpen(false)}>
										{t('aiEmployees.inbox.menuMarkAllRead')}
									</button>
								</div>
							) : null}
						</div>
					</div>
					<div className="ref-ai-employees-inbox-list-scroll">
						{sorted.length === 0 ? (
							<div className="ref-ai-employees-inbox-list-zero">
								<IconInbox className="ref-ai-employees-inbox-list-zero-icon" aria-hidden />
								<p className="ref-ai-employees-inbox-list-zero-text">{t('aiEmployees.inbox.noThreads')}</p>
							</div>
						) : (
							<ul className="ref-ai-employees-inbox-peer-list" aria-label={t('aiEmployees.inbox.railAria')}>
								{sorted.map((employee) => {
									const active = employee.id === selectedId;
									const initial = employee.displayName.trim().slice(0, 1).toUpperCase() || '?';
									const unread = unreadCountByEmployee.get(employee.id) ?? 0;
									const run = findActiveRunByEmployee(employee.id);
									return (
										<li key={employee.id}>
											<button
												type="button"
												className={`ref-ai-employees-inbox-peer-row ${active ? 'is-active' : ''}`}
												onClick={() => setSelectedId(employee.id)}
											>
												<span className="ref-ai-employees-inbox-peer-avatar" aria-hidden>
													{initial}
												</span>
												<span className="ref-ai-employees-inbox-peer-meta">
													<span className="ref-ai-employees-inbox-peer-name">{employee.displayName}</span>
													<span className="ref-ai-employees-inbox-peer-role">
														{run?.statusSummary ?? (employee.customRoleTitle || employee.roleKey)}
													</span>
												</span>
												{unread > 0 ? <span className="ref-ai-employees-inbox-peer-badge">{unread}</span> : null}
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>

				<div className="ref-ai-employees-inbox-detail">
					{!selected ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconInbox className="ref-ai-employees-inbox-detail-empty-ico ref-ai-employees-inbox-detail-empty-ico--muted" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.detailPickTitle')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">{t('aiEmployees.inbox.detailPickHint')}</p>
						</div>
					) : (
						<>
							<div className="ref-ai-employees-inbox-detail-headbar">
								<div>
									<div className="ref-ai-employees-inbox-detail-title">{selected.displayName}</div>
									<div className="ref-ai-employees-inbox-detail-subtitle">{selected.customRoleTitle || selected.roleKey}</div>
								</div>
								<div className="ref-ai-employees-inbox-detail-pills">
									<span className="ref-ai-employees-pill ref-ai-employees-pill--muted">
										{activeRun ? `${t('aiEmployees.inbox.activeRun')}: ${activeRun.goal}` : t('aiEmployees.inbox.noActiveRun')}
									</span>
									{activeRun?.statusSummary ? (
										<span className="ref-ai-employees-pill ref-ai-employees-pill--muted">{activeRun.statusSummary}</span>
									) : null}
									{blocker ? <span className="ref-ai-employees-pill ref-ai-employees-pill--warn">{blocker}</span> : null}
								</div>
							</div>
							<div className="ref-ai-employees-comm-thread" role="log" aria-live="polite">
								{thread.length === 0 ? (
									<div className="ref-ai-employees-inbox-thread-empty ref-ai-employees-muted">{t('aiEmployees.inbox.threadEmptyHint')}</div>
								) : (
									thread.map((message) => (
										<div
											key={message.id}
											className={`ref-ai-employees-comm-bubble ${
												message.toEmployeeId === selected.id
													? 'ref-ai-employees-comm-bubble--user'
													: 'ref-ai-employees-comm-bubble--system'
											}`}
										>
											<div className="ref-ai-employees-inbox-message-summary">{message.summary}</div>
											{message.body}
										</div>
									))
								)}
							</div>
							<div className="ref-ai-employees-comm-composer-wrap">
								<div className="ref-ai-employees-comm-composer">
									<textarea
										className="ref-ai-employees-comm-input ref-ai-employees-input"
										rows={2}
										value={draft}
										placeholder={t('aiEmployees.inbox.messagePlaceholder')}
										onChange={(event) => setDraft(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === 'Enter' && !event.shiftKey) {
												event.preventDefault();
												sendMessage();
											}
										}}
									/>
									<div className="ref-ai-employees-comm-composer-actions">
										<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => setTaskOpen(true)}>
											{activeRun ? t('aiEmployees.inbox.appendTask') : t('aiEmployees.inbox.assignTask')}
										</button>
										<button
											type="button"
											className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-comm-send"
											disabled={!draft.trim()}
											onClick={sendMessage}
										>
											<IconSend className="ref-ai-employees-comm-send-ico" />
											{t('aiEmployees.inbox.send')}
										</button>
									</div>
								</div>
							</div>
						</>
					)}
				</div>
			</div>

			{taskOpen && selected ? (
				<div className="ref-ai-employees-org-modal-overlay" role="presentation" onClick={() => setTaskOpen(false)}>
					<div
						className="ref-ai-employees-org-modal ref-ai-employees-comm-task-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ref-ai-employees-inbox-task-title"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="ref-ai-employees-org-modal-head">
							<h3 id="ref-ai-employees-inbox-task-title" className="ref-ai-employees-org-modal-title">
								{activeRun ? t('aiEmployees.inbox.appendTask') : t('aiEmployees.inbox.assignTask')} · {selected.displayName}
							</h3>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-modal-close" onClick={() => setTaskOpen(false)} aria-label={t('common.close')}>
								×
							</button>
						</div>
						<div className="ref-ai-employees-org-modal-body">
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.inbox.taskTitleLabel')}</span>
								<input className="ref-ai-employees-input" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.inbox.taskDescLabel')}</span>
								<textarea className="ref-ai-employees-input ref-ai-employees-textarea" rows={4} value={taskBody} onChange={(event) => setTaskBody(event.target.value)} />
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.inbox.taskBranchLabel')}</span>
								<input className="ref-ai-employees-input" value={taskBranch} onChange={(event) => setTaskBranch(event.target.value)} placeholder={t('aiEmployees.inbox.taskBranchPh')} />
							</label>
							{hasEmployeeCollaborationContract(contract) ? (
								<div className="ref-ai-employees-panel">
									<strong>{t('aiEmployees.handoff.guidanceTitle')}</strong>
									<p className="ref-ai-employees-muted">{t('aiEmployees.handoff.rulesAppliedHint')}</p>
									<ul className="ref-ai-employees-runs-message-list">
										{contractSections.map((section) => (
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
							<div className="ref-ai-employees-form-actions ref-ai-employees-org-modal-actions">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => setTaskOpen(false)}>
									{t('common.cancel')}
								</button>
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={!taskTitle.trim()} onClick={submitTask}>
									{t('aiEmployees.inbox.taskSubmit')}
								</button>
							</div>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
