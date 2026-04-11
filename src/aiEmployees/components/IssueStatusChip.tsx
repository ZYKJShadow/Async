import type { TFunction } from '../../i18n';

const KNOWN = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled']);

export function normalizeIssueStatus(raw: string): string {
	const s = (raw || 'backlog').toLowerCase();
	return KNOWN.has(s) ? s : 'backlog';
}

export function IssueStatusChip({
	t,
	status,
	size = 'default',
}: {
	t: TFunction;
	status: string;
	size?: 'default' | 'sm';
}) {
	const ns = normalizeIssueStatus(status);
	const key = `aiEmployees.boardColumn.${ns}` as const;
	const tr = t(key);
	const label = tr === key ? ns.replace(/_/g, ' ') : tr;
	return (
		<span
			className={`ref-ai-employees-status-chip ref-ai-employees-status-chip--${ns}${size === 'sm' ? ' ref-ai-employees-status-chip--sm' : ''}`}
		>
			<span className="ref-ai-employees-status-chip-dot" aria-hidden />
			{label}
		</span>
	);
}
