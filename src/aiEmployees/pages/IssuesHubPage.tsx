import { useCallback, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeeCatalogEntry } from '../../../shared/aiEmployeesSettings';
import type { AgentJson, CreateIssuePayload, IssueJson, WorkspaceMemberJson } from '../api/types';
import { IconChevron, IconListTodo } from '../../icons';
import { BoardPage } from './BoardPage';
import { IssueDetailPanel } from './IssueDetailPanel';

export type IssuesHubVariant = 'workspace' | 'my';

function isDoneLike(status: string): boolean {
	const s = (status || '').toLowerCase();
	return s === 'done' || s === 'cancelled' || s === 'closed';
}

function issueInMyScope(issue: IssueJson, meUserId: string | undefined, catalog: AiEmployeeCatalogEntry[]): boolean {
	const linkedAgentIds = new Set(
		catalog.map((e) => e.linkedRemoteAgentId).filter((x): x is string => Boolean(x))
	);
	if (issue.assignee_type === 'member' && issue.assignee_id && meUserId && issue.assignee_id === meUserId) {
		return true;
	}
	if (issue.assignee_type === 'agent' && issue.assignee_id && linkedAgentIds.has(issue.assignee_id)) {
		return true;
	}
	return false;
}

export function IssuesHubPage({
	t,
	workspaceName,
	issues,
	variant,
	agents,
	members,
	meUserId,
	employeeCatalog,
	onPatchIssue,
	onCreateIssue,
}: {
	t: TFunction;
	workspaceName: string;
	issues: IssueJson[];
	variant: IssuesHubVariant;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	meUserId?: string;
	employeeCatalog: AiEmployeeCatalogEntry[];
	onPatchIssue: (issueId: string, patch: Record<string, unknown>) => Promise<void>;
	onCreateIssue: (payload: CreateIssuePayload) => Promise<void>;
}) {
	const [scope, setScope] = useState<'active' | 'all'>(variant === 'my' ? 'active' : 'all');
	const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const scoped = useMemo(() => {
		let list = issues;
		if (variant === 'my') {
			list = list.filter((i) => issueInMyScope(i, meUserId, employeeCatalog));
		}
		if (variant === 'my' && scope === 'active') {
			list = list.filter((i) => !isDoneLike(i.status));
		}
		return list;
	}, [issues, variant, scope, meUserId, employeeCatalog]);

	const selected = selectedId ? issues.find((i) => i.id === selectedId) ?? null : null;
	const parentIssue =
		selected?.parent_issue_id ? issues.find((i) => i.id === selected.parent_issue_id) ?? null : null;

	const openIssue = useCallback((issue: IssueJson) => setSelectedId(issue.id), []);

	const title = variant === 'my' ? t('aiEmployees.tab.myIssues') : t('aiEmployees.tab.issues');
	const wsInitial = workspaceName.trim() ? workspaceName.trim().charAt(0).toUpperCase() : 'W';

	const emptyPrimary =
		variant === 'my'
			? scope === 'active'
				? t('aiEmployees.issuesHub.emptyMyActive')
				: t('aiEmployees.issuesHub.emptyMyAll')
			: t('aiEmployees.boardEmptyTitle');
	const emptyHint =
		variant === 'my'
			? scope === 'active'
				? t('aiEmployees.issuesHub.emptyMyActiveHint')
				: t('aiEmployees.issuesHub.emptyMyAllHint')
			: t('aiEmployees.boardEmptyHint');

	return (
		<div className="ref-ai-employees-issues-hub">
			<div className="ref-ai-employees-issues-hub-crumb">
				<div className="ref-ai-employees-issues-hub-ws-avatar" aria-hidden>
					{wsInitial}
				</div>
				<span className="ref-ai-employees-issues-hub-ws-name ref-ai-employees-muted">{workspaceName || t('aiEmployees.breadcrumbWorkspaceFallback')}</span>
				<IconChevron className="ref-ai-employees-issues-hub-chev" />
				<span className="ref-ai-employees-issues-hub-page-title">{title}</span>
			</div>

			<div className="ref-ai-employees-issues-hub-toolbar">
				<div className="ref-ai-employees-issues-hub-toolbar-left">
					{variant === 'my' ? (
						<>
							<button
								type="button"
								className={`ref-ai-employees-issues-hub-pill ${scope === 'active' ? 'is-active' : ''}`}
								onClick={() => setScope('active')}
							>
								{t('aiEmployees.issuesHub.scopeActive')}
							</button>
							<button type="button" className={`ref-ai-employees-issues-hub-pill ${scope === 'all' ? 'is-active' : ''}`} onClick={() => setScope('all')}>
								{t('aiEmployees.issuesHub.scopeAll')}
							</button>
						</>
					) : null}
				</div>
				<div className="ref-ai-employees-issues-hub-toolbar-right">
					<button
						type="button"
						className={`ref-ai-employees-issues-hub-pill ${viewMode === 'board' ? 'is-active' : ''}`}
						onClick={() => setViewMode('board')}
					>
						{t('aiEmployees.issuesHub.viewBoard')}
					</button>
					<button type="button" className={`ref-ai-employees-issues-hub-pill ${viewMode === 'list' ? 'is-active' : ''}`} onClick={() => setViewMode('list')}>
						{t('aiEmployees.issuesHub.viewList')}
					</button>
				</div>
			</div>

			<div className={`ref-ai-employees-issues-hub-body ${selected ? 'has-detail' : ''}`}>
				<div className="ref-ai-employees-issues-hub-main">
					{scoped.length === 0 ? (
						<div className="ref-ai-employees-issues-hub-empty">
							<IconListTodo className="ref-ai-employees-issues-hub-empty-icon" aria-hidden />
							<p className="ref-ai-employees-issues-hub-empty-title">{emptyPrimary}</p>
							<p className="ref-ai-employees-issues-hub-empty-hint ref-ai-employees-muted">{emptyHint}</p>
						</div>
					) : viewMode === 'board' ? (
						<BoardPage issues={scoped} t={t} onSelectIssue={openIssue} />
					) : (
						<ul className="ref-ai-employees-issues-hub-list">
							{scoped.map((issue) => (
								<li key={issue.id}>
									<button
										type="button"
										className={`ref-ai-employees-issues-hub-list-btn ${selectedId === issue.id ? 'is-active' : ''}`}
										onClick={() => openIssue(issue)}
									>
										<div className="ref-ai-employees-issues-hub-list-main">
											<strong className="ref-ai-employees-issues-hub-list-title">
												{issue.identifier ? `${issue.identifier} · ` : ''}
												{issue.title}
											</strong>
											{issue.description ? <p className="ref-ai-employees-issues-hub-list-desc ref-ai-employees-muted">{issue.description}</p> : null}
										</div>
										<span className="ref-ai-employees-issues-hub-list-status">{issue.status}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
				{selected ? (
					<IssueDetailPanel
						t={t}
						issue={selected}
						agents={agents}
						members={members}
						parentIssue={parentIssue}
						onClose={() => setSelectedId(null)}
						onPatch={onPatchIssue}
						onCreateChild={async (parentId, payload) => {
							await onCreateIssue({
								title: payload.title,
								parent_issue_id: parentId,
								assignee_type: payload.assignee_type,
								assignee_id: payload.assignee_id,
							});
						}}
						onSelectIssue={(id) => setSelectedId(id)}
					/>
				) : null}
			</div>
		</div>
	);
}
