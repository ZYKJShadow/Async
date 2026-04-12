import type { TFunction } from '../../i18n';
import type { AiRunPlanItem, AiSubAgentJob } from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';

function statusGlyph(status: AiRunPlanItem['status']): string {
	switch (status) {
		case 'done':
			return '\u2705';
		case 'in_progress':
			return '\u{1F504}';
		case 'blocked':
			return '\u26A0\uFE0F';
		case 'skipped':
			return '\u23ED\uFE0F';
		default:
			return '\u2B1C';
	}
}

export function RunPlanCard({
	t,
	plan,
	employeeById,
	jobsById,
	onItemActivate,
}: {
	t: TFunction;
	plan: AiRunPlanItem[];
	employeeById: Map<string, OrgEmployee>;
	jobsById: Map<string, AiSubAgentJob>;
	onItemActivate: (jobId: string | undefined) => void;
}) {
	if (!plan.length) {
		return null;
	}
	return (
		<section className="ref-ai-employees-run-plan-card" aria-label={t('aiEmployees.groupChat.runPlanTitle')}>
			<div className="ref-ai-employees-run-plan-card-head">
				<span aria-hidden>{'\u{1F4CB}'}</span>
				<span>{t('aiEmployees.groupChat.runPlanTitle')}</span>
			</div>
			<ol className="ref-ai-employees-run-plan-card-list">
				{plan.map((item, index) => {
					const owner = item.ownerEmployeeId ? employeeById.get(item.ownerEmployeeId) : undefined;
					const linkedJob = item.subAgentJobId ? jobsById.get(item.subAgentJobId) : undefined;
					const ownerLabel = owner?.displayName ?? t('aiEmployees.groupChat.runPlanCoordinator');
					const jobNote =
						item.note?.trim() ||
						(linkedJob?.status === 'done'
							? linkedJob.resultSummary?.trim()
							: linkedJob?.status === 'blocked' || linkedJob?.status === 'error'
								? linkedJob.errorMessage?.trim()
								: '');
					const busy = item.status === 'in_progress' || item.status === 'pending';
					return (
						<li key={item.id} className="ref-ai-employees-run-plan-card-row">
							<button
								type="button"
								className={`ref-ai-employees-run-plan-card-line ${busy ? 'is-busy' : ''}`}
								disabled={!item.subAgentJobId}
								onClick={() => onItemActivate(item.subAgentJobId)}
							>
								<span
									key={`${item.id}-${item.status}`}
									className={`ref-ai-employees-run-plan-check ${item.status === 'done' ? 'is-done' : ''}`}
									aria-hidden
								>
									{statusGlyph(item.status)}
								</span>
								<span className="ref-ai-employees-run-plan-card-index">{index + 1}.</span>
								<span className="ref-ai-employees-run-plan-card-copy">
									<span className="ref-ai-employees-run-plan-card-main">
										<span className="ref-ai-employees-run-plan-card-title">{item.title}</span>
										<span className="ref-ai-employees-run-plan-card-owner">{ownerLabel}</span>
									</span>
									{jobNote ? (
										<span className="ref-ai-employees-run-plan-card-note" title={jobNote}>
											{jobNote}
										</span>
									) : null}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
