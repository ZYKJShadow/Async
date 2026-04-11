import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import { VoidSelect } from '../../VoidSelect';
import type { AgentJson, IssueJson, ProjectJson, WorkspaceMemberJson } from '../api/types';
import { IconCloseSmall } from '../../icons';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import { assigneeVoidOptions, issueProjectVoidOptions, issueStatusVoidOptions, priorityFieldVoidOptions } from '../voidSelectOptions';

const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'] as const;

function assigneeSelectValue(issue: IssueJson): string {
	if (!issue.assignee_type || !issue.assignee_id) return '';
	return `${issue.assignee_type}:${issue.assignee_id}`;
}

export function IssueDetailPanel({
	t,
	issue,
	agents,
	members,
	projects = [],
	parentIssue,
	onClose,
	onPatch,
	onCreateChild,
	onSelectIssue,
	onDelete,
}: {
	t: TFunction;
	issue: IssueJson;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	projects?: ProjectJson[];
	parentIssue: IssueJson | null;
	onClose: () => void;
	onPatch: (issueId: string, patch: Record<string, unknown>) => Promise<void>;
	onCreateChild: (parentId: string, payload: { title: string; assignee_type?: 'member' | 'agent'; assignee_id?: string }) => Promise<void>;
	onSelectIssue?: (issueId: string) => void;
	onDelete?: (issueId: string) => Promise<void>;
}) {
	const [title, setTitle] = useState(issue.title);
	const [description, setDescription] = useState(issue.description ?? '');
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [childTitle, setChildTitle] = useState('');
	const [childAssignee, setChildAssignee] = useState('');

	useEffect(() => {
		setTitle(issue.title);
		setDescription(issue.description ?? '');
		setErr(null);
	}, [issue.id, issue.title, issue.description]);

	const assigneeValue = useMemo(() => assigneeSelectValue(issue), [issue]);
	const statusOpts = useMemo(() => {
		const base = issueStatusVoidOptions(t, ISSUE_STATUSES);
		if (ISSUE_STATUSES.includes(issue.status as (typeof ISSUE_STATUSES)[number])) {
			return base;
		}
		return [{ value: issue.status, label: issue.status }, ...base];
	}, [issue.status, t]);
	const priorityOpts = useMemo(() => priorityFieldVoidOptions(t), [t]);
	const assigneeOpts = useMemo(() => assigneeVoidOptions(t, members, agents), [t, members, agents]);
	const childAssigneeOpts = useMemo(() => assigneeVoidOptions(t, members, agents), [t, members, agents]);
	const projectOpts = useMemo(() => issueProjectVoidOptions(t, projects), [t, projects]);

	const runPatch = useCallback(
		async (patch: Record<string, unknown>) => {
			setErr(null);
			setSaving(true);
			try {
				await onPatch(issue.id, patch);
			} catch (e) {
				notifyAiEmployeesRequestFailed(e);
			} finally {
				setSaving(false);
			}
		},
		[issue.id, onPatch]
	);

	const saveMeta = useCallback(async () => {
		const tTrim = title.trim();
		if (!tTrim) {
			setErr(t('aiEmployees.issueDetail.titleRequired'));
			return;
		}
		const patches: Record<string, unknown> = {};
		if (tTrim !== issue.title) patches.title = tTrim;
		const desc = description.trim();
		const prev = (issue.description ?? '').trim();
		if (desc !== prev) {
			patches.description = desc.length ? desc : null;
		}
		if (Object.keys(patches).length === 0) return;
		await runPatch(patches);
	}, [title, description, issue.title, issue.description, runPatch, t]);

	return (
		<div className="ref-ai-employees-issue-panel">
			<div className="ref-ai-employees-issue-panel-head">
				<div className="ref-ai-employees-issue-panel-id">{issue.identifier ?? issue.id.slice(0, 8)}</div>
				<button type="button" className="ref-ai-employees-issue-panel-close" onClick={onClose} aria-label={t('aiEmployees.issueDetail.close')}>
					<IconCloseSmall />
				</button>
			</div>
			<div className="ref-ai-employees-issue-panel-body">
				{err ? (
					<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
						{err}
					</div>
				) : null}

				<label className="ref-ai-employees-issue-field">
					<span>{t('aiEmployees.issueDetail.title')}</span>
					<input className="ref-ai-employees-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveMeta()} />
				</label>

				<label className="ref-ai-employees-issue-field">
					<span>{t('aiEmployees.issueDetail.description')}</span>
					<textarea
						className="ref-ai-employees-textarea"
						rows={4}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						onBlur={() => void saveMeta()}
					/>
				</label>

				<label className="ref-ai-employees-issue-field">
					<span>{t('aiEmployees.issueDetail.status')}</span>
					<VoidSelect
						ariaLabel={t('aiEmployees.issueDetail.status')}
						value={issue.status}
						disabled={saving}
						options={statusOpts}
						onChange={(v) => void runPatch({ status: v })}
					/>
				</label>

				<label className="ref-ai-employees-issue-field">
					<span>{t('aiEmployees.issueDetail.priority')}</span>
					<VoidSelect
						ariaLabel={t('aiEmployees.issueDetail.priority')}
						value={issue.priority ?? 'none'}
						disabled={saving}
						options={priorityOpts}
						onChange={(v) => void runPatch({ priority: v })}
					/>
				</label>

				<label className="ref-ai-employees-issue-field">
					<span>{t('aiEmployees.issueDetail.dueDate')}</span>
					<input
						className="ref-ai-employees-input"
						type="datetime-local"
						disabled={saving}
						defaultValue={issue.due_date ? issue.due_date.slice(0, 16) : ''}
						key={issue.id + (issue.due_date ?? '')}
						onBlur={(e) => {
							const v = e.target.value;
							if (!v) {
								void runPatch({ due_date: null });
								return;
							}
							const iso = new Date(v).toISOString();
							if (iso !== issue.due_date) {
								void runPatch({ due_date: iso });
							}
						}}
					/>
				</label>

				<label className="ref-ai-employees-issue-field">
					<span>{t('aiEmployees.issueDetail.assignee')}</span>
					<VoidSelect
						ariaLabel={t('aiEmployees.issueDetail.assignee')}
						value={assigneeValue}
						disabled={saving}
						options={assigneeOpts}
						onChange={(v) => {
							if (!v) {
								void runPatch({ assignee_type: null, assignee_id: null });
								return;
							}
							const [typ, id] = v.split(':');
							if ((typ === 'member' || typ === 'agent') && id) {
								void runPatch({ assignee_type: typ, assignee_id: id });
							}
						}}
					/>
				</label>

				{projects.length > 0 ? (
					<label className="ref-ai-employees-issue-field">
						<span>{t('aiEmployees.issueDetail.project')}</span>
						<VoidSelect
							ariaLabel={t('aiEmployees.issueDetail.project')}
							value={issue.project_id ?? ''}
							disabled={saving}
							options={projectOpts}
							onChange={(v) => void runPatch({ project_id: v ? v : null })}
						/>
					</label>
				) : null}

				{issue.parent_issue_id ? (
					<div className="ref-ai-employees-issue-field">
						<span>{t('aiEmployees.issueDetail.parent')}</span>
						{parentIssue ? (
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-issue-parent-link"
								onClick={() => onSelectIssue?.(parentIssue.id)}
							>
								{parentIssue.identifier ?? parentIssue.title}
							</button>
						) : (
							<span className="ref-ai-employees-muted ref-ai-employees-issue-mono">{issue.parent_issue_id.slice(0, 8)}…</span>
						)}
					</div>
				) : null}

				<div className="ref-ai-employees-issue-child">
					<div className="ref-ai-employees-issue-child-label">{t('aiEmployees.issueDetail.createChild')}</div>
					<input
						className="ref-ai-employees-input"
						value={childTitle}
						onChange={(e) => setChildTitle(e.target.value)}
						placeholder={t('aiEmployees.issueDetail.childTitlePh')}
					/>
					<VoidSelect
						ariaLabel={t('aiEmployees.issueDetail.childAssigneeOptional')}
						value={childAssignee}
						onChange={setChildAssignee}
						options={[
							{ value: '', label: t('aiEmployees.issueDetail.childAssigneeOptional') },
							...childAssigneeOpts.filter((o) => o.value !== ''),
						]}
					/>
					<button
						type="button"
						className="ref-ai-employees-btn ref-ai-employees-btn--primary"
						disabled={saving || !childTitle.trim()}
						onClick={async () => {
							const ct = childTitle.trim();
							if (!ct) return;
							setSaving(true);
							setErr(null);
							try {
								const payload: { title: string; assignee_type?: 'member' | 'agent'; assignee_id?: string } = { title: ct };
								if (childAssignee) {
									const [typ, id] = childAssignee.split(':');
									if ((typ === 'member' || typ === 'agent') && id) {
										payload.assignee_type = typ;
										payload.assignee_id = id;
									}
								}
								await onCreateChild(issue.id, payload);
								setChildTitle('');
								setChildAssignee('');
							} catch (e) {
								notifyAiEmployeesRequestFailed(e);
							} finally {
								setSaving(false);
							}
						}}
					>
						{t('aiEmployees.issueDetail.childSubmit')}
					</button>
				</div>

				{onDelete ? (
					<div className="ref-ai-employees-issue-panel-footer">
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-issue-delete"
							disabled={saving}
							onClick={async () => {
								if (!window.confirm(t('common.confirmDelete'))) {
									return;
								}
								setSaving(true);
								setErr(null);
								try {
									await onDelete(issue.id);
									onClose();
								} catch (e) {
									notifyAiEmployeesRequestFailed(e);
								} finally {
									setSaving(false);
								}
							}}
						>
							{t('aiEmployees.issueDetail.delete')}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
