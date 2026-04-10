import { useMemo } from 'react';
import type { TFunction } from '../../i18n';
import type { IssueJson } from '../api/types';

const STATUS_COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'];

export function BoardPage({ issues, t }: { issues: IssueJson[]; t: TFunction }) {
	const issuesByStatus = useMemo(() => {
		const buckets: Record<string, IssueJson[]> = {};
		for (const i of issues) {
			const s = i.status || 'backlog';
			if (!buckets[s]) {
				buckets[s] = [];
			}
			buckets[s].push(i);
		}
		return buckets;
	}, [issues]);

	if (issues.length === 0) {
		return (
			<div className="ref-ai-employees-empty-board">
				<p className="ref-ai-employees-empty-board-title">{t('aiEmployees.boardEmptyTitle')}</p>
				<p className="ref-ai-employees-muted">{t('aiEmployees.boardEmptyHint')}</p>
			</div>
		);
	}

	return (
		<div className="ref-ai-employees-board">
			{STATUS_COLUMNS.map((st) => (
				<section key={st} className="ref-ai-employees-column" aria-label={st}>
					<div className="ref-ai-employees-column-head">{st.replace(/_/g, ' ')}</div>
					<div className="ref-ai-employees-column-body">
						{(issuesByStatus[st] ?? []).map((issue) => (
							<div key={issue.id} className="ref-ai-employees-card">
								<strong>{issue.title}</strong>
								{issue.description ? <p>{issue.description}</p> : null}
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	);
}
