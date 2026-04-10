import type { TFunction } from '../../i18n';

export function TasksPage({ taskEvents, t }: { taskEvents: string[]; t: TFunction }) {
	return (
		<div className="ref-ai-employees-panel">
			<p className="ref-ai-employees-muted">{t('aiEmployees.tasksHint')}</p>
			<ul className="ref-ai-employees-log">
				{taskEvents.map((line, i) => (
					<li key={i}>{line}</li>
				))}
			</ul>
		</div>
	);
}
