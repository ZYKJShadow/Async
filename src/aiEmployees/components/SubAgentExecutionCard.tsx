import { useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiSubAgentJob } from '../../../shared/aiEmployeesSettings';
import {
	IconBot,
	IconCheckCircle,
	IconChevron,
	IconWindowMaximize,
} from '../../icons';
import {
	subAgentCardCompactHead,
	subAgentCardShowBody,
	subAgentCardShowDesc,
} from '../domain/subAgentCardLayout';
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

function timelineItemLabel(t: TFunction, item: SubAgentTimelineItem): string {
	if (item.kind === 'tool') {
		return item.name;
	}
	if (item.kind === 'result') {
		return t('aiEmployees.groupChat.finalResult');
	}
	return t('aiEmployees.groupChat.jobError');
}

function CompactTimelineRow({
	t,
	item,
}: {
	t: TFunction;
	item: SubAgentTimelineItem;
}) {
	const [open, setOpen] = useState(false);
	const hasDetail =
		item.kind === 'tool'
			? Object.keys(item.args).length > 0 || item.output.trim().length > 0
			: item.detail.trim().length > 0;
	return (
		<div className="ref-ai-employees-subagent-live-row">
			<button
				type="button"
				className={`ref-ai-employees-subagent-live-row-head ${hasDetail ? '' : 'is-static'}`}
				onClick={() => {
					if (hasDetail) {
						setOpen((value) => !value);
					}
				}}
				aria-expanded={hasDetail ? open : undefined}
			>
				<span
					className={`ref-ai-employees-subagent-live-row-pill is-${item.kind}${
						item.kind === 'tool' && item.success ? ' is-success' : ''
					}`}
				>
					{timelineItemLabel(t, item)}
				</span>
				<span className="ref-ai-employees-subagent-live-row-summary">{item.summary || '—'}</span>
				{item.kind === 'tool' && item.durationMs !== undefined ? (
					<span className="ref-ai-employees-subagent-live-row-time">
						{formatSubAgentDuration(item.durationMs)}
					</span>
				) : null}
				{hasDetail ? (
					<IconChevron className={`ref-ai-employees-subagent-live-row-chevron ${open ? 'is-open' : ''}`} />
				) : null}
			</button>
			{hasDetail && open ? (
				<div className="ref-ai-employees-subagent-live-row-body">
					{item.kind === 'tool' && Object.keys(item.args).length > 0 ? (
						<div className="ref-ai-employees-subagent-live-detail-block">
							<div className="ref-ai-employees-subagent-live-detail-label">
								{t('aiEmployees.groupChat.toolInput')}
							</div>
							<pre className="ref-ai-employees-subagent-live-pre">
								{JSON.stringify(item.args, null, 2)}
							</pre>
						</div>
					) : null}
					{item.kind === 'tool' && item.output.trim().length > 0 ? (
						<div className="ref-ai-employees-subagent-live-detail-block">
							<div className="ref-ai-employees-subagent-live-detail-label">
								{t('aiEmployees.groupChat.toolResult')}
							</div>
							<pre className="ref-ai-employees-subagent-live-pre">{item.output}</pre>
						</div>
					) : null}
					{item.kind !== 'tool' ? (
						<pre className="ref-ai-employees-subagent-live-pre">{item.detail}</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function SubAgentExecutionCard({
	t,
	job,
	description,
	onOpenDetail,
}: {
	t: TFunction;
	job: AiSubAgentJob;
	description?: string;
	onOpenDetail: (job: AiSubAgentJob) => void;
}) {
	const timeline = useMemo(() => buildSubAgentTimeline(job), [job]);
	const [timelineOpen, setTimelineOpen] = useState(
		job.status === 'running' || job.status === 'blocked' || job.status === 'error'
	);
	const hasTimeline = timeline.length > 0;
	const wallMs = getSubAgentJobWallDurationMs(job);
	const statusText = jobStatusLabel(t, job.status);
	const detailText = description?.trim() || job.taskDescription?.trim();
	const showCompactHead = subAgentCardCompactHead(hasTimeline, timelineOpen);
	const showBody = subAgentCardShowBody(hasTimeline, timelineOpen);
	const showDesc = subAgentCardShowDesc(detailText, hasTimeline, timelineOpen);

	return (
		<article
			className="ref-ai-employees-subagent-live-card"
			data-job-status={job.status}
			data-sub-agent-job-id={job.id}
		>
			<div className="ref-ai-employees-subagent-live-card-head">
				<div className="ref-ai-employees-subagent-live-card-summary">
					<span className="ref-ai-employees-subagent-live-card-avatar" aria-hidden>
						{job.status === 'done' ? <IconCheckCircle className="ref-ai-employees-subagent-live-card-avatar-icon" /> : <IconBot className="ref-ai-employees-subagent-live-card-avatar-icon" />}
					</span>
					<span className="ref-ai-employees-subagent-live-card-copy">
						<span className={`ref-ai-employees-subagent-live-card-line1 ${showCompactHead ? 'is-compact' : ''}`}>
							<span className="ref-ai-employees-subagent-live-card-title">{job.employeeName}</span>
							{showCompactHead ? (
								<>
									<span className="ref-ai-employees-subagent-live-card-sep" aria-hidden>
										·
									</span>
									<span className="ref-ai-employees-subagent-live-task-inline" title={job.taskTitle}>
										{job.taskTitle}
									</span>
								</>
							) : null}
						</span>
						<span className="ref-ai-employees-subagent-live-card-meta">
							<span className={`ref-ai-employees-subagent-live-status is-${job.status}`}>
								{statusText}
							</span>
							{wallMs !== undefined ? (
								<span>{formatSubAgentDuration(wallMs)}</span>
							) : null}
							{job.toolLog.length > 0 ? (
								<span>{t('aiEmployees.groupChat.toolsCount', { count: String(job.toolLog.length) })}</span>
							) : null}
						</span>
					</span>
				</div>
				<button
					type="button"
					className="ref-ai-employees-subagent-live-card-open"
					onClick={() => onOpenDetail(job)}
					title={t('aiEmployees.groupChat.viewJobDetail')}
					aria-label={t('aiEmployees.groupChat.viewJobDetail')}
				>
					<IconWindowMaximize />
				</button>
			</div>
			{showBody ? (
				<div className="ref-ai-employees-subagent-live-card-body">
					<div className="ref-ai-employees-subagent-live-task">{job.taskTitle}</div>
					{showDesc ? <div className="ref-ai-employees-subagent-live-desc">{detailText}</div> : null}
				</div>
			) : null}
			{hasTimeline && timelineOpen ? (
				<div className="ref-ai-employees-subagent-live-timeline-wrap is-open">
					<div className="ref-ai-employees-subagent-live-timeline-shell">
						<div className="ref-ai-employees-subagent-live-timeline">
							<div className="ref-ai-employees-subagent-live-timeline-inner">
								{timeline.map((item) => (
									<CompactTimelineRow key={item.id} t={t} item={item} />
								))}
							</div>
						</div>
					</div>
				</div>
			) : null}
			{hasTimeline ? (
				<button
					type="button"
					className="ref-ai-employees-subagent-live-card-expand"
					onClick={() => setTimelineOpen((value) => !value)}
					aria-expanded={timelineOpen}
				>
					<span className="ref-ai-employees-subagent-live-card-expand-label">
						{timelineOpen
							? t('aiEmployees.groupChat.collapseExecutionLog')
							: t('aiEmployees.groupChat.expandExecutionLog')}
					</span>
					<IconChevron className={`ref-ai-employees-subagent-live-card-expand-chevron ${timelineOpen ? 'is-open' : ''}`} />
				</button>
			) : null}
		</article>
	);
}
