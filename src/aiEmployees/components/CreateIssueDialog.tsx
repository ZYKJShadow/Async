import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
import type { AgentJson, CreateIssuePayload, IssueJson, WorkspaceMemberJson } from '../api/types';

const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'] as const;
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

export function CreateIssueDialog({
	open,
	t,
	agents,
	members,
	issues,
	onClose,
	onCreate,
}: {
	open: boolean;
	t: TFunction;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	issues: IssueJson[];
	onClose: () => void;
	onCreate: (payload: CreateIssuePayload) => Promise<void | IssueJson>;
}) {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [status, setStatus] = useState<string>('backlog');
	const [priority, setPriority] = useState<string>('none');
	const [assignee, setAssignee] = useState('');
	const [dueDate, setDueDate] = useState('');
	const [parentId, setParentId] = useState('');
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setTitle('');
			setDescription('');
			setStatus('backlog');
			setPriority('none');
			setAssignee('');
			setDueDate('');
			setParentId('');
			setErr(null);
		}
	}, [open]);

	const rootIssues = useMemo(() => issues.filter((i) => !i.parent_issue_id), [issues]);

	const submit = useCallback(async () => {
		const tit = title.trim();
		if (!tit) {
			setErr(t('aiEmployees.issueDetail.titleRequired'));
			return;
		}
		setBusy(true);
		setErr(null);
		try {
			const payload: CreateIssuePayload = {
				title: tit,
				description: description.trim() || undefined,
				status,
				priority,
			};
			if (dueDate.trim()) {
				payload.due_date = new Date(dueDate).toISOString();
			}
			if (parentId) {
				payload.parent_issue_id = parentId;
			}
			if (assignee) {
				const [typ, id] = assignee.split(':');
				if ((typ === 'member' || typ === 'agent') && id) {
					payload.assignee_type = typ;
					payload.assignee_id = id;
				}
			}
			await onCreate(payload);
			onClose();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [assignee, description, dueDate, onClose, onCreate, parentId, priority, status, t, title]);

	const node = (
		<div className="ref-ai-employees-create-dialog-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="ref-ai-employees-create-dialog" role="dialog" aria-modal aria-labelledby="ref-ai-employees-create-dialog-title">
				<h2 id="ref-ai-employees-create-dialog-title" className="ref-ai-employees-create-dialog-title">
					{t('aiEmployees.createIssue.title')}
				</h2>
				{err ? (
					<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
						{err}
					</div>
				) : null}
				<label className="ref-ai-employees-create-dialog-field">
					<span>{t('aiEmployees.createIssue.titleField')} *</span>
					<input className="ref-ai-employees-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
				</label>
				<label className="ref-ai-employees-create-dialog-field">
					<span>{t('aiEmployees.createIssue.descField')}</span>
					<textarea className="ref-ai-employees-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
				</label>
				<div className="ref-ai-employees-create-dialog-grid">
					<label className="ref-ai-employees-create-dialog-field">
						<span>{t('aiEmployees.createIssue.statusField')}</span>
						<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={status} onChange={(e) => setStatus(e.target.value)}>
							{STATUSES.map((s) => (
								<option key={s} value={s}>
									{s.replace(/_/g, ' ')}
								</option>
							))}
						</select>
					</label>
					<label className="ref-ai-employees-create-dialog-field">
						<span>{t('aiEmployees.createIssue.priorityField')}</span>
						<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
							{PRIORITIES.map((p) => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
						</select>
					</label>
					<label className="ref-ai-employees-create-dialog-field">
						<span>{t('aiEmployees.createIssue.assigneeField')}</span>
						<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
							<option value="">{t('aiEmployees.issueDetail.assigneeNone')}</option>
							<optgroup label={t('aiEmployees.issueDetail.assigneeMembers')}>
								{members.map((m) => (
									<option key={m.user_id} value={`member:${m.user_id}`}>
										{m.name}
									</option>
								))}
							</optgroup>
							<optgroup label={t('aiEmployees.issueDetail.assigneeAgents')}>
								{agents.map((a) => (
									<option key={a.id} value={`agent:${a.id}`}>
										{a.name}
									</option>
								))}
							</optgroup>
						</select>
					</label>
					<label className="ref-ai-employees-create-dialog-field">
						<span>{t('aiEmployees.createIssue.dueDateField')}</span>
						<input className="ref-ai-employees-input" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
					</label>
				</div>
				<label className="ref-ai-employees-create-dialog-field">
					<span>{t('aiEmployees.createIssue.parentField')}</span>
					<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
						<option value="">{t('aiEmployees.issueDetail.assigneeNone')}</option>
						{rootIssues.map((i) => (
							<option key={i.id} value={i.id}>
								{i.identifier ? `${i.identifier} · ` : ''}
								{i.title}
							</option>
						))}
					</select>
				</label>
				<div className="ref-ai-employees-create-dialog-actions">
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy} onClick={onClose}>
						{t('common.cancel')}
					</button>
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy} onClick={() => void submit()}>
						{t('aiEmployees.createIssue.submit')}
					</button>
				</div>
			</div>
		</div>
	);

	if (!open) {
		return null;
	}
	const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
	return host ? createPortal(node, host) : node;
}
