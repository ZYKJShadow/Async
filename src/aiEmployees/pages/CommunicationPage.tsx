import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import { IconMessageCircle, IconSend } from '../../icons';
import type { OrgEmployee } from '../api/orgTypes';

type CommMessage = {
	id: string;
	role: 'user' | 'system';
	body: string;
	at: number;
};

export function CommunicationPage({
	t,
	orgEmployees,
	onCreateRun,
}: {
	t: TFunction;
	orgEmployees: OrgEmployee[];
	onCreateRun: (goal: string, targetBranch: string) => void;
}) {
	const sorted = useMemo(
		() => [...orgEmployees].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })),
		[orgEmployees]
	);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [messagesByEmployee, setMessagesByEmployee] = useState<Record<string, CommMessage[]>>({});
	const [draft, setDraft] = useState('');
	const [taskOpen, setTaskOpen] = useState(false);
	const [taskTitle, setTaskTitle] = useState('');
	const [taskBody, setTaskBody] = useState('');
	const [taskBranch, setTaskBranch] = useState('');

	useEffect(() => {
		if (selectedId && !sorted.some((e) => e.id === selectedId)) {
			setSelectedId(null);
		}
	}, [sorted, selectedId]);

	const selected = selectedId ? sorted.find((e) => e.id === selectedId) : undefined;

	const ensureWelcome = useCallback(
		(employeeId: string) => {
			setMessagesByEmployee((prev) => {
				if (prev[employeeId]?.length) {
					return prev;
				}
				const welcome: CommMessage = {
					id: crypto.randomUUID(),
					role: 'system',
					body: t('aiEmployees.communication.welcomeLine'),
					at: Date.now(),
				};
				return { ...prev, [employeeId]: [welcome] };
			});
		},
		[t]
	);

	const pickEmployee = (id: string) => {
		setSelectedId(id);
		ensureWelcome(id);
	};

	const sendMessage = () => {
		const text = draft.trim();
		if (!selectedId || !text) {
			return;
		}
		ensureWelcome(selectedId);
		const msg: CommMessage = { id: crypto.randomUUID(), role: 'user', body: text, at: Date.now() };
		setMessagesByEmployee((prev) => ({
			...prev,
			[selectedId]: [...(prev[selectedId] ?? []), msg],
		}));
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
		const goal = body ? t('aiEmployees.communication.taskGoalFormat', { name: selected.displayName, title, body }) : `[${selected.displayName}] ${title}`;
		onCreateRun(goal, taskBranch.trim());
		setTaskOpen(false);
		setTaskTitle('');
		setTaskBody('');
		setTaskBranch('');
	};

	const thread = selectedId ? messagesByEmployee[selectedId] ?? [] : [];

	return (
		<div className="ref-ai-employees-comm">
			<header className="ref-ai-employees-comm-head">
				<h2 className="ref-ai-employees-comm-head-title">{t('aiEmployees.tab.communication')}</h2>
			</header>

			<div className="ref-ai-employees-comm-split">
				<aside className="ref-ai-employees-comm-rail" aria-label={t('aiEmployees.communication.railAria')}>
					{sorted.length === 0 ? (
						<p className="ref-ai-employees-comm-rail-empty ref-ai-employees-muted">{t('aiEmployees.communication.noMembers')}</p>
					) : (
						<ul className="ref-ai-employees-comm-rail-list">
							{sorted.map((employee) => {
								const active = employee.id === selectedId;
								const initial = employee.displayName.trim().slice(0, 1).toUpperCase() || '?';
								return (
									<li key={employee.id}>
										<button
											type="button"
											className={`ref-ai-employees-comm-peer ${active ? 'is-active' : ''}`}
											onClick={() => pickEmployee(employee.id)}
										>
											<span className="ref-ai-employees-comm-peer-avatar" aria-hidden>
												{initial}
											</span>
											<span className="ref-ai-employees-comm-peer-text">
												<span className="ref-ai-employees-comm-peer-name">{employee.displayName}</span>
												<span className="ref-ai-employees-comm-peer-role ref-ai-employees-muted">
													{employee.customRoleTitle || employee.roleKey}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</aside>

				<section className="ref-ai-employees-comm-main">
					{!selected ? (
						<div className="ref-ai-employees-comm-empty">
							<div className="ref-ai-employees-comm-empty-icon" aria-hidden>
								<IconMessageCircle className="ref-ai-employees-comm-empty-svg" />
							</div>
							<p className="ref-ai-employees-comm-empty-title">{t('aiEmployees.communication.emptyTitle')}</p>
							<p className="ref-ai-employees-comm-empty-hint ref-ai-employees-muted">{t('aiEmployees.communication.emptyHint')}</p>
						</div>
					) : (
						<>
							<div className="ref-ai-employees-comm-thread" role="log" aria-live="polite">
								{thread.map((m) => (
									<div
										key={m.id}
										className={`ref-ai-employees-comm-bubble ${m.role === 'user' ? 'ref-ai-employees-comm-bubble--user' : 'ref-ai-employees-comm-bubble--system'}`}
									>
										{m.body}
									</div>
								))}
							</div>
							<div className="ref-ai-employees-comm-composer-wrap">
								<div className="ref-ai-employees-comm-composer">
									<textarea
										className="ref-ai-employees-comm-input ref-ai-employees-input"
										rows={2}
										value={draft}
										placeholder={t('aiEmployees.communication.messagePlaceholder')}
										onChange={(e) => setDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' && !e.shiftKey) {
												e.preventDefault();
												sendMessage();
											}
										}}
									/>
									<div className="ref-ai-employees-comm-composer-actions">
										<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => setTaskOpen(true)}>
											{t('aiEmployees.communication.assignTask')}
										</button>
										<button
											type="button"
											className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-comm-send"
											disabled={!draft.trim()}
											onClick={() => sendMessage()}
										>
											<IconSend className="ref-ai-employees-comm-send-ico" />
											{t('aiEmployees.communication.send')}
										</button>
									</div>
								</div>
							</div>
						</>
					)}
				</section>
			</div>

			{taskOpen && selected ? (
				<div
					className="ref-ai-employees-org-modal-overlay"
					role="presentation"
					onClick={() => setTaskOpen(false)}
				>
					<div
						className="ref-ai-employees-org-modal ref-ai-employees-comm-task-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ref-ai-employees-comm-task-title"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="ref-ai-employees-org-modal-head">
							<h3 id="ref-ai-employees-comm-task-title" className="ref-ai-employees-org-modal-title">
								{t('aiEmployees.communication.assignTask')} — {selected.displayName}
							</h3>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-modal-close" onClick={() => setTaskOpen(false)} aria-label={t('common.close')}>
								×
							</button>
						</div>
						<div className="ref-ai-employees-org-modal-body">
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.communication.taskTitleLabel')}</span>
								<input className="ref-ai-employees-input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.communication.taskDescLabel')}</span>
								<textarea className="ref-ai-employees-input ref-ai-employees-textarea" rows={4} value={taskBody} onChange={(e) => setTaskBody(e.target.value)} />
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.communication.taskBranchLabel')}</span>
								<input className="ref-ai-employees-input" value={taskBranch} onChange={(e) => setTaskBranch(e.target.value)} placeholder={t('aiEmployees.communication.taskBranchPh')} />
							</label>
							<div className="ref-ai-employees-form-actions ref-ai-employees-org-modal-actions">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => setTaskOpen(false)}>
									{t('common.cancel')}
								</button>
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={!taskTitle.trim()} onClick={() => submitTask()}>
									{t('aiEmployees.communication.taskSubmit')}
								</button>
							</div>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
