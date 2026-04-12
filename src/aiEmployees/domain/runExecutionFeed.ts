import type {
	AiCollabMessage,
	AiEmployeesOrchestrationState,
	AiOrchestrationTimelineEvent,
} from '../../../shared/aiEmployeesSettings';

export type RunExecutionFeedItem =
	| {
			id: string;
			kind: 'timeline';
			runId: string;
			createdAtIso: string;
			event: AiOrchestrationTimelineEvent;
	  }
	| {
			id: string;
			kind: 'collab';
			runId: string;
			createdAtIso: string;
			message: AiCollabMessage;
	  };

export function getRunExecutionFeedTimestamp(item: RunExecutionFeedItem): string {
	return item.createdAtIso;
}

export function buildRunExecutionFeed(
	orchestration: AiEmployeesOrchestrationState,
	runIds: Iterable<string>
): RunExecutionFeedItem[] {
	const runIdSet = runIds instanceof Set ? runIds : new Set(runIds);
	const out: RunExecutionFeedItem[] = [];
	for (const event of orchestration.timelineEvents) {
		if (runIdSet.has(event.runId)) {
			out.push({
				id: `tl-${event.id}`,
				kind: 'timeline',
				runId: event.runId,
				createdAtIso: event.createdAtIso,
				event,
			});
		}
	}
	for (const message of orchestration.collabMessages) {
		if (runIdSet.has(message.runId) && !message.internalOnly) {
			out.push({
				id: `cm-${message.id}`,
				kind: 'collab',
				runId: message.runId,
				createdAtIso: message.createdAtIso,
				message,
			});
		}
	}
	out.sort(
		(a, b) =>
			Date.parse(getRunExecutionFeedTimestamp(a)) -
			Date.parse(getRunExecutionFeedTimestamp(b))
	);
	return out;
}
