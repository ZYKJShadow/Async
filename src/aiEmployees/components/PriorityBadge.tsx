import type { TFunction } from '../../i18n';

const PRI_KEYS = ['urgent', 'high', 'medium', 'low', 'none'] as const;

export function PriorityBadge({ priority, t }: { priority?: string; t: TFunction }) {
	const p = (priority && PRI_KEYS.includes(priority as (typeof PRI_KEYS)[number]) ? priority : 'none') as (typeof PRI_KEYS)[number];
	const label =
		p === 'urgent'
			? t('aiEmployees.issuesHub.priorityUrgent')
			: p === 'high'
				? t('aiEmployees.issuesHub.priorityHigh')
				: p === 'medium'
					? t('aiEmployees.issuesHub.priorityMedium')
					: p === 'low'
						? t('aiEmployees.issuesHub.priorityLow')
						: t('aiEmployees.issuesHub.priorityNone');
	return (
		<span className={`ref-ai-employees-board-card-priority ref-ai-employees-board-card-priority--${p}`} title={label}>
			{p === 'none' ? '—' : p.charAt(0).toUpperCase()}
		</span>
	);
}
