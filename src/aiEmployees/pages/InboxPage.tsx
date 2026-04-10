import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from '../../i18n';
import { IconDotsHorizontal, IconInbox, IconSend } from '../../icons';
import type { OrgEmployee } from '../api/orgTypes';

type CommMessage = {
	id: string;
	role: 'user' | 'system';
	body: string;
	at: number;
};

export function InboxPage({
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
	const [moreOpen, setMoreOpen] = useState(false);
	const moreRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (selectedId && !sorted.some((e) => e.id === selectedId)) {
			setSelectedId(null);
		}
	}, [sorted, selectedId]);

	useEffect(() => {
		if (!moreOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (!moreRef.current?.contains(e.target as Node)) {
				setMoreOpen(false);
			}
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [moreOpen]);

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
					body: t('aiEmployees.inbox.welcomeLine'),
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
		const goal = body ? t('aiEmployees.inbox.taskGoalFormat', { name: selected.displayName, title, body }) : `[${selected.displayName}] ${title}`;
		onCreateRun(goal, taskBranch.trim());
		setTaskOpen(false);
		setTaskTitle('');
		setTaskBody('');
		setTaskBranch('');
	};

	const thread = selectedId ? messagesByEmployee[selectedId] ?? [] : [];

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
								onClick={() => setMoreOpen((o) => !o)}
							>
								<IconDotsHorizontal />
							</button>
							{moreOpen ? (
								<div className="ref-ai-employees-inbox-dropdown" role="menu">
									<button type="button" className="ref-ai-employees-inbox-dropdown-item" role="menuitem" onClick={() => setMoreOpen(false)}>
										{t('aiEmployees.inbox.menuMarkAllRead')}
									</button>
									<button type="button" className="ref-ai-employees-inbox-dropdown-item" role="menuitem" onClick={() => setMoreOpen(false)}>
										{t('aiEmployees.inbox.menuArchiveAll')}
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
									return (
										<li key={employee.id}>
											<button
												type="button"
												className={`ref-ai-employees-inbox-peer-row ${active ? 'is-active' : ''}`}
												onClick={() => pickEmployee(employee.id)}
											>
												<span className="ref-ai-employees-inbox-peer-avatar" aria-hidden>
													{initial}
												</span>
												<span className="ref-ai-employees-inbox-peer-meta">
													<span className="ref-ai-employees-inbox-peer-name">{employee.displayName}</span>
													<span className="ref-ai-employees-inbox-peer-role">{employee.customRoleTitle || employee.roleKey}</span>
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>

				<div className="ref-ai-employees-inbox-detail">
					{sorted.length === 0 ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconInbox className="ref-ai-employees-inbox-detail-empty-ico" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.inboxEmpty')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">{t('aiEmployees.inbox.inboxEmptyHint')}</p>
						</div>
					) : !selected ? (
						<div className="ref-ai-employees-inbox-detail-empty">
							<IconInbox className="ref-ai-employees-inbox-detail-empty-ico ref-ai-employees-inbox-detail-empty-ico--muted" aria-hidden />
							<p className="ref-ai-employees-inbox-detail-empty-title">{t('aiEmployees.inbox.detailPickTitle')}</p>
							<p className="ref-ai-employees-inbox-detail-empty-hint ref-ai-employees-muted">{t('aiEmployees.inbox.detailPickHint')}</p>
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
										placeholder={t('aiEmployees.inbox.messagePlaceholder')}
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
											{t('aiEmployees.inbox.assignTask')}
										</button>
										<button
											type="button"
											className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-comm-send"
											disabled={!draft.trim()}
											onClick={() => sendMessage()}
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
						onClick={(e) => e.stopPropagation()}
					>
						<div className="ref-ai-employees-org-modal-head">
							<h3 id="ref-ai-employees-inbox-task-title" className="ref-ai-employees-org-modal-title">
								{t('aiEmployees.inbox.assignTask')} — {selected.displayName}
							</h3>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-modal-close" onClick={() => setTaskOpen(false)} aria-label={t('common.close')}>
								×
							</button>
						</div>
						<div className="ref-ai-employees-org-modal-body">
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.inbox.taskTitleLabel')}</span>
								<input className="ref-ai-employees-input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.inbox.taskDescLabel')}</span>
								<textarea className="ref-ai-employees-input ref-ai-employees-textarea" rows={4} value={taskBody} onChange={(e) => setTaskBody(e.target.value)} />
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.inbox.taskBranchLabel')}</span>
								<input className="ref-ai-employees-input" value={taskBranch} onChange={(e) => setTaskBranch(e.target.value)} placeholder={t('aiEmployees.inbox.taskBranchPh')} />
							</label>
							<div className="ref-ai-employees-form-actions ref-ai-employees-org-modal-actions">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => setTaskOpen(false)}>
									{t('common.cancel')}
								</button>
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={!taskTitle.trim()} onClick={() => submitTask()}>
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
