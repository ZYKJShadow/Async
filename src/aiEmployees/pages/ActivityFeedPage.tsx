import { useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type {
	AiCollabMessageType,
	AiEmployeesOrchestrationState,
} from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';

type FilterKey = 'all' | 'assignments' | 'results' | 'approvals';

const FILTER_TYPES: Record<FilterKey, AiCollabMessageType[] | null> = {
	all: null,
	assignments: ['task_assignment', 'handoff_request'],
	results: ['result', 'status_update'],
	approvals: ['approval_request', 'approval_response'],
};

function isUser(id?: string): boolean {
	return !id;
}

function employeeName(map: Map<string, OrgEmployee>, id?: string, t?: TFunction): string {
	if (!id) return t?.('aiEmployees.activity.you') ?? 'You';
	return map.get(id)?.displayName ?? id.slice(0, 8);
}

function employeeInitial(map: Map<string, OrgEmployee>, id?: string): string {
	if (!id) return 'Me';
	const name = map.get(id)?.displayName ?? '';
	return name.trim().slice(0, 1).toUpperCase() || '?';
}

function typeIcon(type: AiCollabMessageType): string {
	switch (type) {
		case 'task_assignment':
			return '\u{1F4CB}';
		case 'handoff_request':
			return '\u{1F91D}';
		case 'approval_request':
			return '\u{1F6A8}';
		case 'approval_response':
			return '\u2705';
		case 'result':
			return '\u{1F4E6}';
		case 'blocker':
			return '\u{1F6D1}';
		case 'status_update':
			return '\u{1F4E2}';
		default:
			return '\u{1F4AC}';
	}
}

function typeLabel(t: TFunction, type: AiCollabMessageType): string {
	switch (type) {
		case 'task_assignment':
			return t('aiEmployees.collab.taskAssignment');
		case 'handoff_request':
			return t('aiEmployees.collab.handoffRequest');
		case 'approval_request':
			return t('aiEmployees.collab.approvalRequest');
		case 'approval_response':
			return t('aiEmployees.collab.approvalResponse');
		case 'result':
			return t('aiEmployees.collab.result');
		case 'blocker':
			return t('aiEmployees.collab.blocker');
		case 'status_update':
			return t('aiEmployees.collab.statusUpdate');
		default:
			return type;
	}
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function calendarDayKey(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayDivider(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export function ActivityFeedPage({
	t,
	orchestration,
	orgEmployees,
}: {
	t: TFunction;
	orchestration: AiEmployeesOrchestrationState;
	orgEmployees: OrgEmployee[];
}) {
	const [filter, setFilter] = useState<FilterKey>('all');

	const empMap = useMemo(
		() => new Map(orgEmployees.map((e) => [e.id, e])),
		[orgEmployees]
	);

	const allMessages = useMemo(() => {
		const msgs = orchestration.collabMessages.filter((msg) => !msg.internalOnly);
		msgs.sort((a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso));
		return msgs;
	}, [orchestration.collabMessages]);

	const filtered = useMemo(() => {
		const types = FILTER_TYPES[filter];
		if (!types) return allMessages;
		return allMessages.filter((m) => types.includes(m.type));
	}, [allMessages, filter]);

	const filters: { key: FilterKey; label: string }[] = [
		{ key: 'all', label: t('aiEmployees.activity.filterAll') },
		{ key: 'assignments', label: t('aiEmployees.activity.filterAssignments') },
		{ key: 'results', label: t('aiEmployees.activity.filterResults') },
		{ key: 'approvals', label: t('aiEmployees.activity.filterApprovals') },
	];

	return (
		<div className="ref-ai-employees-activity-root">
			<div className="ref-ai-employees-activity-header">
				<h2 className="ref-ai-employees-activity-title">{t('aiEmployees.activity.title')}</h2>
				<div className="ref-ai-employees-runtime-pill-group" role="group">
					{filters.map((f) => (
						<button
							key={f.key}
							type="button"
							className={`ref-ai-employees-runtime-pill ${filter === f.key ? 'is-active' : ''}`}
							onClick={() => setFilter(f.key)}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{filtered.length === 0 ? (
				<div className="ref-ai-employees-stub">
					<div className="ref-ai-employees-stub-title">{t('aiEmployees.activity.empty')}</div>
				</div>
			) : (
				<div className="ref-ai-employees-activity-timeline">
					{filtered.map((msg, idx) => {
						const prev = filtered[idx - 1];
						const showDay = !prev || calendarDayKey(prev.createdAtIso) !== calendarDayKey(msg.createdAtIso);
						return (
							<div key={msg.id}>
								{showDay ? (
									<div className="ref-ai-employees-activity-day" role="separator">
										{formatDayDivider(msg.createdAtIso)}
									</div>
								) : null}
								<div className="ref-ai-employees-activity-item">
									<div className="ref-ai-employees-activity-item-time">
										{formatTime(msg.createdAtIso)}
									</div>
									<div className="ref-ai-employees-activity-item-icon" aria-hidden>
										{typeIcon(msg.type)}
									</div>
									<div className="ref-ai-employees-activity-item-body">
										<div className="ref-ai-employees-activity-item-route">
											<span className={`ref-ai-employees-activity-item-avatar${isUser(msg.fromEmployeeId) ? ' is-user' : ''}`} aria-hidden>
												{employeeInitial(empMap, msg.fromEmployeeId)}
											</span>
											<strong>{employeeName(empMap, msg.fromEmployeeId, t)}</strong>
											<span className="ref-ai-employees-activity-item-arrow">→</span>
											<span className={`ref-ai-employees-activity-item-avatar${isUser(msg.toEmployeeId) ? ' is-user' : ''}`} aria-hidden>
												{employeeInitial(empMap, msg.toEmployeeId)}
											</span>
											<strong>{employeeName(empMap, msg.toEmployeeId, t)}</strong>
										</div>
										<div className="ref-ai-employees-activity-item-label">
											{typeLabel(t, msg.type)}
											{msg.summary && msg.type !== 'text' ? `: ${msg.summary}` : ''}
										</div>
										{msg.type === 'text' && msg.body ? (
											<div className="ref-ai-employees-activity-item-text">
												{msg.body.length > 120 ? `${msg.body.slice(0, 120)}…` : msg.body}
											</div>
										) : null}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
