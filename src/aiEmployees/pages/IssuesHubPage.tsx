import { useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import { IconChevron, IconListTodo } from '../../icons';
import type { IssueJson } from '../api/types';
import { BoardPage } from './BoardPage';

export type IssuesHubVariant = 'workspace' | 'my';

function isDoneLike(status: string): boolean {
	const s = (status || '').toLowerCase();
	return s === 'done' || s === 'cancelled' || s === 'closed';
}

export function IssuesHubPage({
	t,
	workspaceName,
	issues,
	variant,
}: {
	t: TFunction;
	workspaceName: string;
	issues: IssueJson[];
	variant: IssuesHubVariant;
}) {
	const [scope, setScope] = useState<'active' | 'all'>(variant === 'my' ? 'active' : 'all');
	const [viewMode, setViewMode] = useState<'board' | 'list'>('board');

	const scoped = useMemo(() => {
		if (variant === 'my' && scope === 'active') {
			return issues.filter((i) => !isDoneLike(i.status));
		}
		return issues;
	}, [issues, variant, scope]);

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

			<div className="ref-ai-employees-issues-hub-body">
				{scoped.length === 0 ? (
					<div className="ref-ai-employees-issues-hub-empty">
						<IconListTodo className="ref-ai-employees-issues-hub-empty-icon" aria-hidden />
						<p className="ref-ai-employees-issues-hub-empty-title">{emptyPrimary}</p>
						<p className="ref-ai-employees-issues-hub-empty-hint ref-ai-employees-muted">{emptyHint}</p>
					</div>
				) : viewMode === 'board' ? (
					<BoardPage issues={scoped} t={t} />
				) : (
					<ul className="ref-ai-employees-issues-hub-list">
						{scoped.map((issue) => (
							<li key={issue.id} className="ref-ai-employees-issues-hub-list-item">
								<div className="ref-ai-employees-issues-hub-list-main">
									<strong className="ref-ai-employees-issues-hub-list-title">{issue.title}</strong>
									{issue.description ? <p className="ref-ai-employees-issues-hub-list-desc ref-ai-employees-muted">{issue.description}</p> : null}
								</div>
								<span className="ref-ai-employees-issues-hub-list-status">{issue.status}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
