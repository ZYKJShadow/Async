import type { TFunction } from '../../i18n';
import type { AiCollabMessage, AiCollabCardStatus } from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';

function employeeName(employees: Map<string, OrgEmployee>, id?: string): string {
	if (!id) return '?';
	return employees.get(id)?.displayName ?? id.slice(0, 8);
}

function cardTypeLabel(t: TFunction, type: string): string {
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

function cardTypeIcon(type: string): string {
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

function statusLabel(t: TFunction, status?: AiCollabCardStatus): string {
	switch (status) {
		case 'done':
			return t('aiEmployees.collab.statusDone');
		case 'pending':
			return t('aiEmployees.collab.statusPending');
		case 'in_progress':
			return t('aiEmployees.collab.statusInProgress');
		case 'blocked':
			return t('aiEmployees.collab.statusBlocked');
		case 'approved':
			return t('aiEmployees.collab.statusApproved');
		case 'rejected':
			return t('aiEmployees.collab.statusRejected');
		default:
			return '';
	}
}

function statusBadgeClass(status?: AiCollabCardStatus): string {
	switch (status) {
		case 'done':
		case 'approved':
			return 'is-done';
		case 'in_progress':
			return 'is-running';
		case 'pending':
			return 'is-pending';
		case 'blocked':
		case 'rejected':
			return 'is-blocked';
		default:
			return '';
	}
}

const STRUCTURED_TYPES = new Set([
	'task_assignment',
	'handoff_request',
	'approval_request',
	'approval_response',
	'result',
	'blocker',
]);

export function isStructuredMessage(msg: AiCollabMessage): boolean {
	return STRUCTURED_TYPES.has(msg.type);
}

export function CollabCard({
	t,
	message,
	employeeMap,
	onAction,
}: {
	t: TFunction;
	message: AiCollabMessage;
	employeeMap: Map<string, OrgEmployee>;
	onAction?: (messageId: string, action: string) => void;
}) {
	const fromName = employeeName(employeeMap, message.fromEmployeeId);
	const toName = employeeName(employeeMap, message.toEmployeeId);
	const status = message.cardMeta?.status;
	const actions = message.cardMeta?.actions;

	return (
		<div className="ref-ai-employees-collab-card" data-card-type={message.type}>
			<div className="ref-ai-employees-collab-card-head">
				<span className="ref-ai-employees-collab-card-icon" aria-hidden>
					{cardTypeIcon(message.type)}
				</span>
				<span className="ref-ai-employees-collab-card-type">{cardTypeLabel(t, message.type)}</span>
				{status ? (
					<span className={`ref-ai-employees-run-badge ${statusBadgeClass(status)}`}>
						{statusLabel(t, status)}
					</span>
				) : null}
			</div>
			<div className="ref-ai-employees-collab-card-route">
				{fromName} → {toName}
			</div>
			{message.summary ? (
				<div className="ref-ai-employees-collab-card-summary">{message.summary}</div>
			) : null}
			{message.body && message.body !== message.summary ? (
				<div className="ref-ai-employees-collab-card-body">{message.body}</div>
			) : null}
			{actions && actions.length > 0 && onAction ? (
				<div className="ref-ai-employees-collab-card-actions">
					{actions.map((a) => (
						<button
							key={a.action}
							type="button"
							className={`ref-ai-employees-btn ${a.action === 'approve' ? 'ref-ai-employees-btn--primary' : 'ref-ai-employees-btn--secondary'}`}
							onClick={() => onAction(message.id, a.action)}
						>
							{a.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
