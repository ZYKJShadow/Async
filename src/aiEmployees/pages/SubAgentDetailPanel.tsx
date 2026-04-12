import { useCallback, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiSubAgentJob, AiSubAgentToolEntry } from '../../../shared/aiEmployeesSettings';

function formatDuration(ms?: number): string {
	if (ms === undefined || Number.isNaN(ms)) {
		return '—';
	}
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

function jobStatusLabel(t: TFunction, status: AiSubAgentJob['status']): string {
	switch (status) {
		case 'queued':
			return t('aiEmployees.groupChat.jobQueued');
		case 'running':
			return t('aiEmployees.groupChat.jobRunning');
		case 'done':
			return t('aiEmployees.groupChat.jobDone');
		case 'error':
			return t('aiEmployees.groupChat.jobError');
		case 'blocked':
			return t('aiEmployees.groupChat.jobBlocked');
		default:
			return status;
	}
}

export function SubAgentDetailPanel({
	t,
	job,
	onClose,
}: {
	t: TFunction;
	job: AiSubAgentJob | null;
	onClose: () => void;
}) {
	const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
	const toggle = useCallback((id: string) => {
		setOpenIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	if (!job) {
		return null;
	}

	const started = job.startedAtIso ? Date.parse(job.startedAtIso) : undefined;
	const ended = job.completedAtIso ? Date.parse(job.completedAtIso) : undefined;
	const wall =
		started !== undefined && ended !== undefined && !Number.isNaN(started) && !Number.isNaN(ended)
			? ended - started
			: undefined;

	return (
		<div className="ref-ai-employees-subagent-panel" role="dialog" aria-modal="true" aria-label={t('aiEmployees.groupChat.detailTitle')}>
			<div className="ref-ai-employees-subagent-panel-backdrop" onClick={onClose} aria-hidden />
			<div className="ref-ai-employees-subagent-panel-sheet">
				<div className="ref-ai-employees-subagent-panel-head">
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" onClick={onClose}>
						{t('aiEmployees.groupChat.detailBack')}
					</button>
					<div className="ref-ai-employees-subagent-panel-head-text">
						<div className="ref-ai-employees-subagent-panel-title">
							{job.employeeName} · {job.taskTitle}
						</div>
						<div className="ref-ai-employees-subagent-panel-meta">
							{jobStatusLabel(t, job.status)}
							{wall !== undefined ? ` · ${formatDuration(wall)}` : ''}
						</div>
					</div>
				</div>
				<div className="ref-ai-employees-subagent-panel-body">
					{job.errorMessage ? (
						<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
							{job.errorMessage}
						</div>
					) : null}
					<ul className="ref-ai-employees-subagent-tool-list">
						{job.toolLog.map((entry: AiSubAgentToolEntry) => {
							const open = openIds.has(entry.id);
							return (
								<li key={entry.id} className="ref-ai-employees-subagent-tool-item">
									<button
										type="button"
										className="ref-ai-employees-subagent-tool-head"
										onClick={() => toggle(entry.id)}
										aria-expanded={open}
									>
										<span className="ref-ai-employees-subagent-tool-chevron">{open ? '▼' : '▶'}</span>
										<span className="ref-ai-employees-subagent-tool-name">{entry.name}</span>
										<span className="ref-ai-employees-subagent-tool-time">{formatDuration(entry.durationMs)}</span>
										<span className={entry.success ? 'is-ok' : 'is-err'}>{entry.success ? 'OK' : 'ERR'}</span>
									</button>
									{open ? (
										<div className="ref-ai-employees-subagent-tool-body">
											<pre className="ref-ai-employees-subagent-tool-pre">
												{JSON.stringify(entry.args, null, 2)}
											</pre>
											<div className="ref-ai-employees-subagent-tool-result-label">{t('aiEmployees.groupChat.toolResult')}</div>
											<pre className="ref-ai-employees-subagent-tool-pre">{entry.result}</pre>
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
					{job.resultSummary ? (
						<div className="ref-ai-employees-subagent-result-block">
							<div className="ref-ai-employees-subagent-result-label">{t('aiEmployees.groupChat.finalResult')}</div>
							<div className="ref-ai-employees-subagent-result-text">{job.resultSummary}</div>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
