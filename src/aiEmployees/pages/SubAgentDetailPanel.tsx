import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiSubAgentJob } from '../../../shared/aiEmployeesSettings';
import {
	IconBot,
	IconCheckCircle,
	IconChevron,
	IconCloseSmall,
} from '../../icons';
import {
	buildSubAgentTimeline,
	formatSubAgentDuration,
	getSubAgentJobWallDurationMs,
	type SubAgentTimelineItem,
} from '../domain/subAgentTimeline';

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

function jobStatusTone(status: AiSubAgentJob['status']): string {
	switch (status) {
		case 'done':
			return 'is-done';
		case 'blocked':
			return 'is-pending';
		case 'error':
			return 'is-blocked';
		default:
			return 'is-running';
	}
}

function timelineItemLabel(t: TFunction, item: SubAgentTimelineItem): string {
	if (item.kind === 'tool') {
		return item.name;
	}
	if (item.kind === 'result') {
		return t('aiEmployees.groupChat.finalResult');
	}
	return t('aiEmployees.groupChat.jobError');
}

function TranscriptRow({
	t,
	item,
}: {
	t: TFunction;
	item: SubAgentTimelineItem;
}) {
	const [open, setOpen] = useState(item.kind !== 'tool');
	const hasDetail =
		item.kind === 'tool'
			? Object.keys(item.args).length > 0 || item.output.trim().length > 0
			: item.detail.trim().length > 0;
	return (
		<div className={`ref-ai-employees-subagent-transcript-row is-${item.kind}`}>
			<button
				type="button"
				className={`ref-ai-employees-subagent-transcript-row-head ${hasDetail ? '' : 'is-static'}`}
				onClick={() => {
					if (hasDetail) {
						setOpen((value) => !value);
					}
				}}
				aria-expanded={hasDetail ? open : undefined}
			>
				<span className={`ref-ai-employees-subagent-transcript-pill is-${item.kind}`}>
					{timelineItemLabel(t, item)}
				</span>
				<span className="ref-ai-employees-subagent-transcript-summary">
					{item.summary || '—'}
				</span>
				{item.kind === 'tool' && item.durationMs !== undefined ? (
					<span className="ref-ai-employees-subagent-transcript-time">
						{formatSubAgentDuration(item.durationMs)}
					</span>
				) : null}
				{hasDetail ? (
					<IconChevron
						className={`ref-ai-employees-subagent-transcript-chevron ${open ? 'is-open' : ''}`}
					/>
				) : null}
			</button>
			{hasDetail && open ? (
				<div className="ref-ai-employees-subagent-transcript-body">
					{item.kind === 'tool' && Object.keys(item.args).length > 0 ? (
						<div className="ref-ai-employees-subagent-transcript-detail">
							<div className="ref-ai-employees-subagent-transcript-label">
								{t('aiEmployees.groupChat.toolInput')}
							</div>
							<pre className="ref-ai-employees-subagent-transcript-pre">
								{JSON.stringify(item.args, null, 2)}
							</pre>
						</div>
					) : null}
					{item.kind === 'tool' && item.output.trim().length > 0 ? (
						<div className="ref-ai-employees-subagent-transcript-detail">
							<div className="ref-ai-employees-subagent-transcript-label">
								{t('aiEmployees.groupChat.toolResult')}
							</div>
							<pre className="ref-ai-employees-subagent-transcript-pre">{item.output}</pre>
						</div>
					) : null}
					{item.kind !== 'tool' ? (
						<pre className="ref-ai-employees-subagent-transcript-pre">{item.detail}</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
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
	const timeline = useMemo(() => (job ? buildSubAgentTimeline(job) : []), [job]);

	useEffect(() => {
		if (!job) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [job, onClose]);

	if (!job) {
		return null;
	}

	const wallDuration = getSubAgentJobWallDurationMs(job);

	return (
		<div
			className="ref-ai-employees-subagent-panel"
			role="dialog"
			aria-modal="true"
			aria-label={t('aiEmployees.groupChat.detailTitle')}
		>
			<div className="ref-ai-employees-subagent-panel-backdrop" onClick={onClose} aria-hidden />
			<div className="ref-ai-employees-subagent-panel-sheet">
				<div className="ref-ai-employees-subagent-panel-head">
					<div className="ref-ai-employees-subagent-panel-hero">
						<div className="ref-ai-employees-subagent-panel-avatar" aria-hidden>
							{job.status === 'done' ? (
								<IconCheckCircle className="ref-ai-employees-subagent-panel-avatar-icon" />
							) : (
								<IconBot className="ref-ai-employees-subagent-panel-avatar-icon" />
							)}
						</div>
						<div className="ref-ai-employees-subagent-panel-head-copy">
							<div className="ref-ai-employees-subagent-panel-eyebrow">
								{t('aiEmployees.groupChat.detailTitle')}
							</div>
							<div className="ref-ai-employees-subagent-panel-title">
								{job.taskTitle}
							</div>
							<div className="ref-ai-employees-subagent-panel-subtitle">
								{job.employeeName}
							</div>
						</div>
					</div>
					<button
						type="button"
						className="ref-ai-employees-subagent-panel-close"
						onClick={onClose}
						aria-label={t('common.close')}
						title={t('common.close')}
					>
						<IconCloseSmall />
					</button>
				</div>
				<div className="ref-ai-employees-subagent-panel-meta-row">
					<span className={`ref-ai-employees-run-badge ${jobStatusTone(job.status)}`}>
						{jobStatusLabel(t, job.status)}
					</span>
					{wallDuration !== undefined ? (
						<span className="ref-ai-employees-subagent-panel-chip">
							{formatSubAgentDuration(wallDuration)}
						</span>
					) : null}
					{job.toolLog.length > 0 ? (
						<span className="ref-ai-employees-subagent-panel-chip">
							{t('aiEmployees.groupChat.toolsCount', { count: String(job.toolLog.length) })}
						</span>
					) : null}
				</div>
				{job.taskDescription ? (
					<div className="ref-ai-employees-subagent-panel-desc">{job.taskDescription}</div>
				) : null}
				<div className="ref-ai-employees-subagent-panel-body">
					{timeline.length === 0 ? (
						<div className="ref-ai-employees-subagent-panel-empty">
							{t('aiEmployees.groupChat.timelineEmpty')}
						</div>
					) : (
						timeline.map((item) => (
							<TranscriptRow key={item.id} t={t} item={item} />
						))
					)}
				</div>
			</div>
		</div>
	);
}
