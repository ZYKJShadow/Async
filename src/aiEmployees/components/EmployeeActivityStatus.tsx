import type { TFunction } from '../../i18n';
import type { EmployeeActivity, EmployeeActivityStatus } from '../domain/employeeActivityStatus';

function activityLabel(t: TFunction, status: EmployeeActivityStatus): string {
	switch (status) {
		case 'idle':
			return t('aiEmployees.workStatus.idle');
		case 'working':
			return t('aiEmployees.workStatus.working');
		case 'blocked':
			return t('aiEmployees.workStatus.blocked');
		case 'waiting':
			return t('aiEmployees.workStatus.waiting');
	}
}

export function EmployeeActivityStatusLabel({
	t,
	activity,
	className,
}: {
	t: TFunction;
	activity: EmployeeActivity;
	className?: string;
}) {
	const rootClass = `ref-ai-employees-activity-status ref-ai-employees-activity-status--${activity.status}${className ? ` ${className}` : ''}`;
	return (
		<span className={rootClass} title={activity.runGoal?.trim() || undefined}>
			<span className="ref-ai-employees-activity-dot" aria-hidden />
			<span className="ref-ai-employees-activity-label">{activityLabel(t, activity.status)}</span>
		</span>
	);
}
