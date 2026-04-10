import type { AiEmployeesOrchestrationState } from '../../../shared/aiEmployeesSettings';
import type { TFunction } from '../../i18n';
import type { IssueJson } from '../api/types';
import type { OrgEmployee } from '../api/orgTypes';

export function HomePage({
	t,
	workspaceName,
	issues,
	orgEmployees,
	orchestration,
	onCreateRun,
}: {
	t: TFunction;
	workspaceName: string;
	issues: IssueJson[];
	orgEmployees: OrgEmployee[];
	orchestration: AiEmployeesOrchestrationState;
	onCreateRun: (goal: string, targetBranch: string) => void;
}) {
	const running = orchestration.runs.filter((run) => run.status === 'running' || run.status === 'awaiting_approval');
	const quickStarts = [
		t('aiEmployees.setup.suggestionAnalyze'),
		t('aiEmployees.setup.suggestionPlan'),
		t('aiEmployees.setup.suggestionShip'),
	];

	return (
		<div className="ref-ai-employees-home">
			<section className="ref-ai-employees-home-hero">
				<div>
					<div className="ref-ai-employees-home-kicker">{workspaceName}</div>
					<h2 className="ref-ai-employees-home-title">{t('aiEmployees.home.title')}</h2>
					<p className="ref-ai-employees-home-desc">{t('aiEmployees.home.desc')}</p>
				</div>
				<div className="ref-ai-employees-home-quick-actions">
					{quickStarts.map((suggestion) => (
						<button key={suggestion} type="button" className="ref-ai-employees-pill ref-ai-employees-pill--muted" onClick={() => onCreateRun(suggestion, '')}>
							{suggestion}
						</button>
					))}
				</div>
			</section>

			<section className="ref-ai-employees-home-stats">
				<div className="ref-ai-employees-home-stat-card">
					<strong>{orgEmployees.length}</strong>
					<span>{t('aiEmployees.home.members')}</span>
				</div>
				<div className="ref-ai-employees-home-stat-card">
					<strong>{issues.length}</strong>
					<span>{t('aiEmployees.home.issues')}</span>
				</div>
				<div className="ref-ai-employees-home-stat-card">
					<strong>{running.length}</strong>
					<span>{t('aiEmployees.home.runs')}</span>
				</div>
			</section>

			<div className="ref-ai-employees-home-grid">
				<section className="ref-ai-employees-panel">
					<div className="ref-ai-employees-home-section-head">
						<strong>{t('aiEmployees.home.teamSection')}</strong>
					</div>
					<ul className="ref-ai-employees-list">
						{orgEmployees.slice(0, 6).map((employee) => (
							<li key={employee.id} className="ref-ai-employees-list-row">
								<strong>{employee.displayName}</strong>
								<span className="ref-ai-employees-muted">{employee.customRoleTitle || employee.roleKey}</span>
							</li>
						))}
					</ul>
				</section>
				<section className="ref-ai-employees-panel">
					<div className="ref-ai-employees-home-section-head">
						<strong>{t('aiEmployees.home.issueSection')}</strong>
					</div>
					{issues.length === 0 ? (
						<p className="ref-ai-employees-muted">{t('aiEmployees.boardEmptyHint')}</p>
					) : (
						<ul className="ref-ai-employees-list">
							{issues.slice(0, 5).map((issue) => (
								<li key={issue.id} className="ref-ai-employees-list-row">
									<strong>{issue.title}</strong>
									<span className="ref-ai-employees-muted">{issue.status}</span>
								</li>
							))}
						</ul>
					)}
				</section>
				<section className="ref-ai-employees-panel">
					<div className="ref-ai-employees-home-section-head">
						<strong>{t('aiEmployees.home.runSection')}</strong>
					</div>
					{orchestration.runs.length === 0 ? (
						<p className="ref-ai-employees-muted">{t('aiEmployees.home.noRuns')}</p>
					) : (
						<ul className="ref-ai-employees-list">
							{orchestration.runs.slice(0, 5).map((run) => (
								<li key={run.id} className="ref-ai-employees-list-row">
									<strong>{run.goal}</strong>
									<span className="ref-ai-employees-muted">{run.status}</span>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</div>
	);
}
