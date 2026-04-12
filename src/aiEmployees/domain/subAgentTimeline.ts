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

function shortenPath(value: string): string {
	const normalized = value.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length <= 3) {
		return normalized;
	}
	return `.../${parts.slice(-2).join('/')}`;
}

function firstShortString(values: unknown[]): string {
	for (const value of values) {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed.length > 0 && trimmed.length <= 120) {
				return trimmed;
			}
		}
	}
	return '';
}

function previewText(value: string): string {
	const text = value.trim().replace(/\s+/g, ' ');
	if (!text) {
		return '';
	}
	return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

export function summarizeSubAgentToolArgs(args: Record<string, unknown>): string {
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (query) {
		return query;
	}
	const pathValue =
		typeof args.file_path === 'string'
			? args.file_path
			: typeof args.path === 'string'
				? args.path
				: '';
	if (pathValue) {
		return shortenPath(pathValue);
	}
	const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : '';
	if (pattern) {
		return pattern;
	}
	const description = typeof args.description === 'string' ? args.description.trim() : '';
	if (description) {
		return description;
	}
	const command = typeof args.command === 'string' ? args.command.trim() : '';
	if (command) {
		return command.length > 120 ? `${command.slice(0, 120)}...` : command;
	}
	const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
	if (prompt) {
		return prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt;
	}
	const skill = typeof args.skill === 'string' ? args.skill.trim() : '';
	if (skill) {
		return skill;
	}
	return firstShortString(Object.values(args));
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
