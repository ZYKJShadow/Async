import type { AiSubAgentJob } from '../../../shared/aiEmployeesSettings';

export type SubAgentTimelineItem =
	| {
			id: string;
			kind: 'tool';
			name: string;
			summary: string;
			args: Record<string, unknown>;
			output: string;
			durationMs?: number;
			success: boolean;
	  }
	| {
			id: string;
			kind: 'result' | 'error';
			summary: string;
			detail: string;
	  };

function previewText(value: string): string {
	const text = value.trim().replace(/\s+/g, ' ');
	if (!text) {
		return '';
	}
	return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

export function summarizeSubAgentToolArgs(args: Record<string, unknown>): string {
	for (const value of Object.values(args)) {
		if (typeof value === 'string') {
			const trimmed = value.trim().replace(/\s+/g, ' ');
			if (trimmed) {
				return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
			}
		}
	}
	return '';
}

export function formatSubAgentDuration(ms?: number): string {
	if (ms === undefined || Number.isNaN(ms)) {
		return '—';
	}
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

export function getSubAgentJobWallDurationMs(job: AiSubAgentJob): number | undefined {
	const started = job.startedAtIso ? Date.parse(job.startedAtIso) : Number.NaN;
	const ended = job.completedAtIso ? Date.parse(job.completedAtIso) : Number.NaN;
	if (!Number.isFinite(started) || !Number.isFinite(ended)) {
		return undefined;
	}
	return Math.max(0, ended - started);
}

export function buildSubAgentTimeline(job: AiSubAgentJob): SubAgentTimelineItem[] {
	const items: SubAgentTimelineItem[] = job.toolLog.map((entry) => ({
		id: entry.id,
		kind: 'tool',
		name: entry.name,
		summary:
			summarizeSubAgentToolArgs(entry.args) ||
			previewText(entry.result) ||
			entry.name,
		args: entry.args,
		output: entry.result,
		durationMs: entry.durationMs,
		success: entry.success,
	}));

	if (job.resultSummary) {
		items.push({
			id: `${job.id}:result`,
			kind: 'result',
			summary: previewText(job.resultSummary) || job.resultSummary,
			detail: job.resultSummary,
		});
	}

	if (job.errorMessage) {
		items.push({
			id: `${job.id}:error`,
			kind: 'error',
			summary: previewText(job.errorMessage) || job.errorMessage,
			detail: job.errorMessage,
		});
	}

	return items;
}
