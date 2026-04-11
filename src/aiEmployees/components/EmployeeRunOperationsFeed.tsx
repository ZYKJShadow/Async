import { useMemo } from 'react';
import type { TFunction } from '../../i18n';
import type {
	AiCollabMessage,
	AiEmployeesOrchestrationState,
	AiOrchestrationRun,
	AiOrchestrationTimelineEvent,
} from '../../../shared/aiEmployeesSettings';
import type { OrgEmployee } from '../api/orgTypes';
import { CollabCard } from './CollabCard';

type FeedItem =
	| { kind: 'timeline'; event: AiOrchestrationTimelineEvent }
	| { kind: 'collab'; message: AiCollabMessage };

function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function mergeRunFeed(orchestration: AiEmployeesOrchestrationState, runIds: ReadonlySet<string>): FeedItem[] {
	const out: FeedItem[] = [];
	for (const e of orchestration.timelineEvents) {
		if (runIds.has(e.runId)) {
			out.push({ kind: 'timeline', event: e });
		}
	}
	for (const m of orchestration.collabMessages) {
		if (runIds.has(m.runId)) {
			out.push({ kind: 'collab', message: m });
		}
	}
	out.sort((a, b) => {
		const ta = a.kind === 'timeline' ? a.event.createdAtIso : a.message.createdAtIso;
		const tb = b.kind === 'timeline' ? b.event.createdAtIso : b.message.createdAtIso;
		return Date.parse(ta) - Date.parse(tb);
	});
	return out;
}

/** 与主界面 Agent 聊天区一致的消息轨道：展示该成员相关运行的时间线 + 协作消息 + 流式片段 */
export function EmployeeRunOperationsFeed({
	t,
	orchestration,
	runs,
	employeeMap,
	streamingSnippet,
	streamError,
}: {
	t: TFunction;
	orchestration: AiEmployeesOrchestrationState;
	runs: readonly AiOrchestrationRun[];
	employeeMap: Map<string, OrgEmployee>;
	streamingSnippet?: string;
	streamError?: string;
}) {
	const runIdSet = useMemo(() => new Set(runs.map((r) => r.id)), [runs]);

	const items = useMemo(() => mergeRunFeed(orchestration, runIdSet), [orchestration, runIdSet]);

	const hasTail = Boolean(streamingSnippet?.trim()) || Boolean(streamError);

	return (
		<div className="ref-ai-employees-task-feed">
			{runs.length > 1 ? (
				<div className="ref-ai-employees-task-feed-context" aria-label={t('aiEmployees.aiDetail.tasksRunsContext')}>
					{runs.map((run) => (
						<div key={run.id} className="ref-ai-employees-task-feed-context-chip" title={run.goal}>
							<span className="ref-ai-employees-task-feed-context-goal">{run.goal}</span>
							<span className="ref-ai-employees-task-feed-context-status">{run.statusSummary ?? run.status}</span>
						</div>
					))}
				</div>
			) : runs[0] ? (
				<div className="ref-ai-employees-task-feed-single-head">
					<div className="ref-ai-employees-task-feed-single-goal">{runs[0].goal}</div>
					<div className="ref-ai-employees-task-feed-single-meta">{runs[0].statusSummary ?? runs[0].status}</div>
				</div>
			) : null}

			<div className="ref-messages ref-ai-employees-task-feed-messages">
				<div className="ref-messages-track ref-ai-employees-task-feed-track">
					{items.length === 0 && !hasTail ? (
						<div className="ref-msg-row-measure">
							<div className="ref-msg-slot ref-msg-slot--assistant ref-ai-employees-task-feed-slot">
								<div className="ref-msg-assistant-body ref-ai-employees-task-feed-body ref-ai-employees-task-feed-empty">
									<p className="ref-ai-employees-muted">{t('aiEmployees.aiDetail.tasksFeedEmpty')}</p>
								</div>
							</div>
						</div>
					) : null}
					{items.map((item) => (
						<div
							key={item.kind === 'timeline' ? `tl-${item.event.id}` : `cm-${item.message.id}`}
							className="ref-msg-row-measure"
						>
							<div className="ref-msg-slot ref-msg-slot--assistant ref-ai-employees-task-feed-slot">
								<div className="ref-msg-assistant-body ref-ai-employees-task-feed-body">
									{item.kind === 'timeline' ? (
										<div className="ref-ai-employees-task-feed-timeline" data-ev-type={item.event.type}>
											<div className="ref-ai-employees-task-feed-timeline-head">
												<div className="ref-ai-employees-task-feed-timeline-label">{item.event.label}</div>
												<time className="ref-ai-employees-task-feed-time" dateTime={item.event.createdAtIso}>
													{formatTime(item.event.createdAtIso)}
												</time>
											</div>
											{item.event.description ? (
												<div className="ref-ai-employees-task-feed-timeline-desc">{item.event.description}</div>
											) : null}
										</div>
									) : (
										<div className="ref-ai-employees-task-feed-collab-wrap">
											<CollabCard t={t} message={item.message} employeeMap={employeeMap} />
										</div>
									)}
								</div>
							</div>
						</div>
					))}
					{streamingSnippet?.trim() ? (
						<div className="ref-msg-row-measure">
							<div className="ref-msg-slot ref-msg-slot--assistant ref-ai-employees-task-feed-slot">
								<div className="ref-msg-assistant-body ref-ai-employees-task-feed-body ref-ai-employees-task-feed-streaming">
									<div className="ref-ai-employees-task-feed-streaming-head">
										<span className="ref-bubble-pending" aria-hidden>
											<span className="ref-bubble-pending-dot" />
											<span className="ref-bubble-pending-dot" />
											<span className="ref-bubble-pending-dot" />
										</span>
										<span>{t('aiEmployees.inbox.streamingLabel')}</span>
									</div>
									<pre className="ref-ai-employees-task-feed-stream-pre">{streamingSnippet}</pre>
								</div>
							</div>
						</div>
					) : null}
					{streamError ? (
						<div className="ref-msg-row-measure">
							<div className="ref-msg-slot ref-msg-slot--assistant ref-ai-employees-task-feed-slot">
								<div className="ref-msg-assistant-body ref-ai-employees-task-feed-body ref-ai-employees-task-feed-err">
									{streamError}
								</div>
							</div>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
