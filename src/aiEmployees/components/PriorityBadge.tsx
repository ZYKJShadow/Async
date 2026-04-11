import type { TFunction } from '../../i18n';

const PRI_KEYS = ['urgent', 'high', 'medium', 'low', 'none'] as const;

function normalizePriority(p?: string): (typeof PRI_KEYS)[number] {
	return p && PRI_KEYS.includes(p as (typeof PRI_KEYS)[number]) ? (p as (typeof PRI_KEYS)[number]) : 'none';
}

function priorityLabel(p: (typeof PRI_KEYS)[number], t: TFunction): string {
	return p === 'urgent'
		? t('aiEmployees.issuesHub.priorityUrgent')
		: p === 'high'
			? t('aiEmployees.issuesHub.priorityHigh')
			: p === 'medium'
				? t('aiEmployees.issuesHub.priorityMedium')
				: p === 'low'
					? t('aiEmployees.issuesHub.priorityLow')
					: t('aiEmployees.issuesHub.priorityNone');
}

/** 下拉/表单内：彩色标签（字母 + 文案） */
export function PriorityPillChip({ priority, t }: { priority: string; t: TFunction }) {
	const p = normalizePriority(priority);
	const label = priorityLabel(p, t);
	const mark = p === 'none' ? '—' : p === 'urgent' ? 'U' : p === 'high' ? 'H' : p === 'medium' ? 'M' : p === 'low' ? 'L' : '?';
	return (
		<span className={`ref-ai-employees-priority-pill ref-ai-employees-priority-pill--${p}`}>
			<span className="ref-ai-employees-priority-pill-mark" aria-hidden>
				{mark}
			</span>
			{label}
		</span>
	);
}

export function PriorityBadge({ priority, t }: { priority?: string; t: TFunction }) {
	const p = normalizePriority(priority);
	const label = priorityLabel(p, t);
	return (
		<span className={`ref-ai-employees-board-card-priority ref-ai-employees-board-card-priority--${p}`} title={label}>
			{p === 'none' ? '—' : p.charAt(0).toUpperCase()}
		</span>
	);
}
