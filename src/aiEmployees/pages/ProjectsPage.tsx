import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import { IconChevron, IconFolderKanban, IconPlus } from '../../icons';
import { VoidSelect } from '../../VoidSelect';
import type { AiEmployeesConnection } from '../api/client';
import { apiGetProject } from '../api/client';
import type { AgentJson, CreateProjectPayload, IssueJson, ProjectBoundaryKind, ProjectJson, UpdateProjectPayload, WorkspaceMemberJson } from '../api/types';
import { CreateProjectDialog } from '../components/CreateProjectDialog';
import { IssueStatusChip } from '../components/IssueStatusChip';
import {
	isPlausibleGitRemote,
	normalizeProjectBoundaryKind,
	ProjectBoundaryFields,
	projectBoundaryApiFields,
} from '../components/ProjectBoundaryFields';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import { assigneeVoidOptions } from '../voidSelectOptions';

function formatRelativeDate(t: TFunction, iso?: string): string {
	if (!iso) {
		return '—';
	}
	const diff = Date.now() - new Date(iso).getTime();
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	if (days < 1) {
		return t('aiEmployees.projects.relToday');
	}
	if (days === 1) {
		return t('aiEmployees.projects.rel1d');
	}
	if (days < 30) {
		return t('aiEmployees.projects.relDays', { n: String(days) });
	}
	const months = Math.floor(days / 30);
	return t('aiEmployees.projects.relMonths', { n: String(months) });
}

function leadLabel(project: ProjectJson, members: WorkspaceMemberJson[], agents: AgentJson[]): string {
	if (!project.lead_type || !project.lead_id) {
		return '';
	}
	if (project.lead_type === 'member') {
		return members.find((m) => m.user_id === project.lead_id)?.name ?? project.lead_id.slice(0, 8);
	}
	if (project.lead_type === 'agent') {
		return agents.find((a) => a.id === project.lead_id)?.name ?? project.lead_id.slice(0, 8);
	}
	return '';
}

function leadSelectValue(p: ProjectJson): string {
	if (!p.lead_type || !p.lead_id) {
		return '';
	}
	return `${p.lead_type}:${p.lead_id}`;
}

function projectBoundaryFingerprint(p: ProjectJson): string {
	const k = normalizeProjectBoundaryKind(p.boundary_kind);
	if (k === 'none') {
		return 'none';
	}
	if (k === 'local_folder') {
		return `L:${(p.boundary_local_path ?? '').trim()}`;
	}
	return `G:${(p.boundary_git_url ?? '').trim()}`;
}

function formBoundaryFingerprint(mode: ProjectBoundaryKind, localPath: string, gitUrl: string): string {
	const k = normalizeProjectBoundaryKind(mode);
	if (k === 'none') {
		return 'none';
	}
	if (k === 'local_folder') {
		return `L:${localPath.trim()}`;
	}
	return `G:${gitUrl.trim()}`;
}

export function ProjectsPage({
	t,
	conn,
	workspaceId,
	projects,
	issues,
	agents,
	members,
	workspaceDisplayName,
	onRefreshProjects,
	createProject,
	updateProject,
	deleteProject,
	onGoToIssues,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	projects: ProjectJson[];
	issues: IssueJson[];
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	workspaceDisplayName?: string;
	onRefreshProjects: () => void | Promise<void>;
	createProject: (body: CreateProjectPayload) => Promise<ProjectJson>;
	updateProject: (id: string, body: UpdateProjectPayload) => Promise<ProjectJson>;
	deleteProject: (id: string) => Promise<void>;
	onGoToIssues?: () => void;
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const [view, setView] = useState<'list' | 'detail'>('list');
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<ProjectJson | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailTitle, setDetailTitle] = useState('');
	const [detailDesc, setDetailDesc] = useState('');
	const [detailIcon, setDetailIcon] = useState('');
	const [detailLead, setDetailLead] = useState('');
	const [detailBoundaryMode, setDetailBoundaryMode] = useState<ProjectBoundaryKind>('none');
	const [detailBoundaryLocal, setDetailBoundaryLocal] = useState('');
	const [detailBoundaryGit, setDetailBoundaryGit] = useState('');
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const projectIssues = useMemo(
		() => (selectedId ? issues.filter((i) => i.project_id === selectedId) : []),
		[issues, selectedId]
	);

	const leadOpts = useMemo(() => {
		return assigneeVoidOptions(t, members, agents).map((o) => {
			if (o.disabled) {
				return { ...o, label: <span className="ref-ai-employees-void-opt-hdr">{o.label}</span> };
			}
			if (!o.value) {
				return { ...o, label: <span className="ref-ai-employees-assignee-opt-none">{o.label}</span> };
			}
			const isAgent = o.value.startsWith('agent:');
			const isMember = o.value.startsWith('member:');
			return {
				...o,
				label: (
					<span className="ref-ai-employees-assignee-opt">
						<span className={`ref-ai-employees-assignee-opt-badge ${isAgent ? 'is-agent' : isMember ? 'is-member' : ''}`}>
							{isAgent ? 'AI' : isMember ? 'M' : '·'}
						</span>
						<span className="ref-ai-employees-assignee-opt-name">{o.label}</span>
					</span>
				),
			};
		});
	}, [t, members, agents]);

	useEffect(() => {
		if (view !== 'detail' || !selectedId || !workspaceId) {
			setDetail(null);
			return;
		}
		let cancelled = false;
		setDetailLoading(true);
		setErr(null);
		void apiGetProject(conn, workspaceId, selectedId)
			.then((p) => {
				if (!cancelled) {
					setDetail(p);
					setDetailTitle(p.title);
					setDetailDesc(p.description ?? '');
					setDetailIcon((p.icon ?? '').slice(0, 8));
					setDetailLead(leadSelectValue(p));
					const bk = normalizeProjectBoundaryKind(p.boundary_kind);
					setDetailBoundaryMode(bk);
					setDetailBoundaryLocal(bk === 'local_folder' ? (p.boundary_local_path ?? '').trim() : '');
					setDetailBoundaryGit(bk === 'git_repo' ? (p.boundary_git_url ?? '').trim() : '');
				}
			})
			.catch((e) => {
				if (!cancelled) {
					notifyAiEmployeesRequestFailed(e);
					setDetail(null);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setDetailLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [conn, selectedId, view, workspaceId]);

	const isDirty = useMemo(() => {
		if (!detail) {
			return false;
		}
		const ic = detailIcon.trim().slice(0, 8);
		const prevIc = (detail.icon ?? '').trim().slice(0, 8);
		if (detailTitle.trim() !== detail.title.trim()) {
			return true;
		}
		if (detailDesc.trim() !== (detail.description ?? '').trim()) {
			return true;
		}
		if (ic !== prevIc) {
			return true;
		}
		if (detailLead !== leadSelectValue(detail)) {
			return true;
		}
		if (projectBoundaryFingerprint(detail) !== formBoundaryFingerprint(detailBoundaryMode, detailBoundaryLocal, detailBoundaryGit)) {
			return true;
		}
		return false;
	}, [detail, detailBoundaryGit, detailBoundaryLocal, detailBoundaryMode, detailDesc, detailIcon, detailLead, detailTitle]);

	const openDetail = useCallback((id: string) => {
		setSelectedId(id);
		setView('detail');
	}, []);

	const backToList = useCallback(() => {
		setView('list');
		setSelectedId(null);
		setDetail(null);
		setErr(null);
	}, []);

	const handleSaveDetail = useCallback(async () => {
		if (!selectedId || !detail) {
			return;
		}
		const tit = detailTitle.trim();
		if (!tit) {
			setErr(t('aiEmployees.issueDetail.titleRequired'));
			return;
		}
		if (detailBoundaryMode === 'local_folder' && !detailBoundaryLocal.trim()) {
			setErr(t('aiEmployees.projects.boundaryLocalRequired'));
			return;
		}
		if (detailBoundaryMode === 'git_repo') {
			const g = detailBoundaryGit.trim();
			if (!g || !isPlausibleGitRemote(g)) {
				setErr(t('aiEmployees.projects.boundaryGitInvalid'));
				return;
			}
		}
		setSaving(true);
		setErr(null);
		try {
			const body: UpdateProjectPayload = {};
			if (tit !== detail.title) {
				body.title = tit;
			}
			const d = detailDesc.trim();
			const prev = (detail.description ?? '').trim();
			if (d !== prev) {
				body.description = d.length ? d : null;
			}
			const ic = detailIcon.trim().slice(0, 8);
			const prevIc = (detail.icon ?? '').trim().slice(0, 8);
			if (ic !== prevIc) {
				body.icon = ic.length ? ic : null;
			}
			const prevLead = leadSelectValue(detail);
			if (detailLead !== prevLead) {
				if (!detailLead) {
					body.lead_type = null;
					body.lead_id = null;
				} else {
					const [typ, id] = detailLead.split(':');
					if ((typ === 'member' || typ === 'agent') && id) {
						body.lead_type = typ;
						body.lead_id = id;
					}
				}
			}
			if (projectBoundaryFingerprint(detail) !== formBoundaryFingerprint(detailBoundaryMode, detailBoundaryLocal, detailBoundaryGit)) {
				const b = projectBoundaryApiFields(detailBoundaryMode, detailBoundaryLocal, detailBoundaryGit);
				body.boundary_kind = b.boundary_kind;
				body.boundary_local_path = b.boundary_local_path;
				body.boundary_git_url = b.boundary_git_url;
			}
			if (Object.keys(body).length === 0) {
				return;
			}
			await updateProject(selectedId, body);
			await onRefreshProjects();
			const p = await apiGetProject(conn, workspaceId, selectedId);
			setDetail(p);
			setDetailTitle(p.title);
			setDetailDesc(p.description ?? '');
			setDetailIcon((p.icon ?? '').slice(0, 8));
			setDetailLead(leadSelectValue(p));
			const bk = normalizeProjectBoundaryKind(p.boundary_kind);
			setDetailBoundaryMode(bk);
			setDetailBoundaryLocal(bk === 'local_folder' ? (p.boundary_local_path ?? '').trim() : '');
			setDetailBoundaryGit(bk === 'git_repo' ? (p.boundary_git_url ?? '').trim() : '');
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setSaving(false);
		}
	}, [
		conn,
		detail,
		detailBoundaryGit,
		detailBoundaryLocal,
		detailBoundaryMode,
		detailDesc,
		detailIcon,
		detailLead,
		detailTitle,
		onRefreshProjects,
		selectedId,
		t,
		updateProject,
		workspaceId,
	]);

	const handleDelete = useCallback(async () => {
		if (!selectedId || !detail) {
			return;
		}
		if (!window.confirm(t('aiEmployees.projects.deleteConfirm', { title: detail.title }))) {
			return;
		}
		setSaving(true);
		setErr(null);
		try {
			await deleteProject(selectedId);
			await onRefreshProjects();
			backToList();
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setSaving(false);
		}
	}, [backToList, deleteProject, detail, onRefreshProjects, selectedId, t]);

	const handleCreate = useCallback(
		async (payload: CreateProjectPayload) => {
			const p = await createProject(payload);
			await onRefreshProjects();
			openDetail(p.id);
		},
		[createProject, onRefreshProjects, openDetail]
	);

	const detailView =
		view === 'detail' && selectedId ? (
			<div className="ref-ai-employees-projects-shell">
				{err ? (
					<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
						{err}
					</div>
				) : null}
				<div className="ref-ai-employees-projects-detail-top">
					<div className="ref-ai-employees-projects-detail-crumb">
						<button type="button" className="ref-ai-employees-projects-crumb-link" onClick={backToList}>
							{t('aiEmployees.projects.title')}
						</button>
						<IconChevron className="ref-ai-employees-projects-crumb-chev" />
						<span className="ref-ai-employees-projects-crumb-current">{detailLoading ? '…' : detail?.title ?? selectedId}</span>
					</div>
					<div className="ref-ai-employees-projects-detail-actions">
						{onGoToIssues ? (
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-btn--sm" onClick={onGoToIssues}>
								{t('aiEmployees.projects.openIssuesHub')}
							</button>
						) : null}
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm" disabled={saving || !detail} onClick={() => void handleDelete()}>
							{t('aiEmployees.projects.delete')}
						</button>
					</div>
				</div>

				<div className="ref-ai-employees-projects-detail-body">
					<div className="ref-ai-employees-projects-detail-main">
						<div className="ref-ai-employees-projects-detail-section-head">
							<h3 className="ref-ai-employees-projects-section-title">{t('aiEmployees.projects.linkedIssues')}</h3>
						</div>
						{detailLoading ? (
							<p className="ref-ai-employees-projects-muted">{t('common.loading')}</p>
						) : projectIssues.length === 0 ? (
							<div className="ref-ai-employees-projects-empty-inline">
								<p className="ref-ai-employees-projects-muted">{t('aiEmployees.projects.noLinkedIssues')}</p>
							</div>
						) : (
							<ul className="ref-ai-employees-projects-issue-ul">
								{projectIssues.map((i) => (
									<li key={i.id} className="ref-ai-employees-projects-issue-li">
										<span className="ref-ai-employees-projects-issue-id">{i.identifier ?? i.id.slice(0, 8)}</span>
										<span className="ref-ai-employees-projects-issue-title">{i.title}</span>
										<IssueStatusChip t={t} status={i.status ?? 'backlog'} size="sm" />
									</li>
								))}
							</ul>
						)}
					</div>
					<aside className="ref-ai-employees-projects-detail-side">
						<label className="ref-ai-employees-projects-side-field">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.projects.iconField')}</span>
							<input
								className="ref-ai-employees-input ref-ai-employees-projects-icon-input"
								value={detailIcon}
								maxLength={8}
								placeholder="📁"
								onChange={(e) => setDetailIcon(e.target.value)}
								disabled={detailLoading || !detail}
							/>
						</label>
						<label className="ref-ai-employees-projects-side-field">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.projects.nameField')}</span>
							<input className="ref-ai-employees-input" value={detailTitle} onChange={(e) => setDetailTitle(e.target.value)} disabled={detailLoading || !detail} />
						</label>
						<label className="ref-ai-employees-projects-side-field">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.createIssue.descField')}</span>
							<textarea className="ref-ai-employees-textarea" rows={6} value={detailDesc} onChange={(e) => setDetailDesc(e.target.value)} disabled={detailLoading || !detail} />
						</label>
						{detail && !detailLoading ? (
							<>
								<div className="ref-ai-employees-projects-side-field ref-ai-employees-projects-side-boundary">
									<ProjectBoundaryFields
										t={t}
										compact
										mode={detailBoundaryMode}
										localPath={detailBoundaryLocal}
										gitUrl={detailBoundaryGit}
										onModeChange={setDetailBoundaryMode}
										onLocalPathChange={setDetailBoundaryLocal}
										onGitUrlChange={setDetailBoundaryGit}
									/>
								</div>
								<label className="ref-ai-employees-projects-side-field">
									<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.projects.leadField')}</span>
									<VoidSelect
										ariaLabel={t('aiEmployees.projects.leadField')}
										value={detailLead}
										disabled={saving}
										options={leadOpts}
										onChange={setDetailLead}
									/>
								</label>
							</>
						) : null}
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={saving || !isDirty || !detail} onClick={() => void handleSaveDetail()}>
							{saving ? t('aiEmployees.projects.saving') : t('aiEmployees.skills.save')}
						</button>
					</aside>
				</div>
			</div>
		) : null;

	const listView =
		view !== 'detail' || !selectedId ? (
			<div className="ref-ai-employees-projects-shell">
				<div className="ref-ai-employees-projects-header">
					<div className="ref-ai-employees-projects-header-left">
						<IconFolderKanban className="ref-ai-employees-projects-header-ico" />
						<h1 className="ref-ai-employees-projects-header-title">{t('aiEmployees.projects.title')}</h1>
						{projects.length > 0 ? <span className="ref-ai-employees-projects-header-count">{projects.length}</span> : null}
					</div>
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-btn--sm" disabled={!workspaceId} onClick={() => setCreateOpen(true)}>
						<IconPlus />
						{t('aiEmployees.projects.new')}
					</button>
				</div>

				<div className="ref-ai-employees-projects-table-wrap">
					{projects.length === 0 ? (
						<div className="ref-ai-employees-projects-empty">
							<IconFolderKanban className="ref-ai-employees-projects-empty-ico" />
							<p className="ref-ai-employees-projects-empty-title">{t('aiEmployees.projects.empty')}</p>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm" disabled={!workspaceId} onClick={() => setCreateOpen(true)}>
								{t('aiEmployees.projects.emptyCta')}
							</button>
						</div>
					) : (
						<>
							<div className="ref-ai-employees-projects-table-head">
								<span className="ref-ai-employees-projects-col-icon" />
								<span className="ref-ai-employees-projects-col-name">{t('aiEmployees.projects.colName')}</span>
								<span className="ref-ai-employees-projects-col-progress">{t('aiEmployees.projects.colProgress')}</span>
								<span className="ref-ai-employees-projects-col-lead">{t('aiEmployees.projects.colLead')}</span>
								<span className="ref-ai-employees-projects-col-created">{t('aiEmployees.projects.colCreated')}</span>
							</div>
							{projects.map((p) => {
								const total = p.issue_count ?? 0;
								const done = p.done_count ?? 0;
								const pct = total > 0 ? Math.round((done / total) * 100) : 0;
								const lead = leadLabel(p, members, agents);
								return (
									<button key={p.id} type="button" className="ref-ai-employees-projects-row" onClick={() => openDetail(p.id)}>
										<span className="ref-ai-employees-projects-col-icon">{p.icon || '📁'}</span>
										<span className="ref-ai-employees-projects-col-name">{p.title}</span>
										<span className="ref-ai-employees-projects-col-progress">
											{total > 0 ? (
												<>
													<span className="ref-ai-employees-projects-progress-track">
														<span className="ref-ai-employees-projects-progress-fill" style={{ width: `${pct}%` }} />
													</span>
													<span className="ref-ai-employees-projects-progress-label">
														{done}/{total}
													</span>
												</>
											) : (
												<span className="ref-ai-employees-projects-muted">—</span>
											)}
										</span>
										<span className="ref-ai-employees-projects-col-lead">{lead || '—'}</span>
										<span className="ref-ai-employees-projects-col-created">{formatRelativeDate(t, p.created_at)}</span>
									</button>
								);
							})}
						</>
					)}
				</div>
			</div>
		) : null;

	return (
		<>
			{detailView ?? listView}
			<CreateProjectDialog
				open={createOpen}
				t={t}
				agents={agents}
				members={members}
				workspaceDisplayName={workspaceDisplayName}
				onClose={() => setCreateOpen(false)}
				onCreate={handleCreate}
			/>
		</>
	);
}
