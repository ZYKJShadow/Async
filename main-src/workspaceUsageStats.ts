import * as fs from 'node:fs';
import * as path from 'node:path';

export const USAGE_STATS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type AgentLineDayBucket = { add: number; del: number };

export type TokenUsageEvent = {
	at: number;
	modelId: string;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	mode?: string;
};

export type UsageStatsFileV1 = {
	version: 1;
	agentLineByDay: Record<string, AgentLineDayBucket>;
	tokenEvents: TokenUsageEvent[];
};

export type UsageStatsSnapshot = {
	ok: true;
	/** 统计数据文件所在目录（用户配置） */
	dataDir: string;
	agentLineByDay: Record<string, AgentLineDayBucket>;
	tokenEvents: TokenUsageEvent[];
};

export type UsageStatsGetResult =
	| UsageStatsSnapshot
	| { ok: false; reason: 'disabled' }
	| { ok: false; reason: 'no-directory' };

const FILE_NAME = 'usage-stats.json';

/** 用户指定的数据目录下的单一 JSON 文件（不按工作区分片）。 */
export function usageStatsFilePath(dataDir: string): string {
	return path.join(path.resolve(dataDir), FILE_NAME);
}

export function localDateKey(atMs: number): string {
	const d = new Date(atMs);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function emptyStore(): UsageStatsFileV1 {
	return { version: 1, agentLineByDay: {}, tokenEvents: [] };
}

function loadStore(dataDir: string): UsageStatsFileV1 {
	const p = usageStatsFilePath(dataDir);
	if (!fs.existsSync(p)) {
		return emptyStore();
	}
	try {
		const raw = fs.readFileSync(p, 'utf8');
		const parsed = JSON.parse(raw) as Partial<UsageStatsFileV1>;
		if (!parsed || typeof parsed !== 'object') {
			return emptyStore();
		}
		const agentLineByDay =
			parsed.agentLineByDay && typeof parsed.agentLineByDay === 'object' && !Array.isArray(parsed.agentLineByDay)
				? (parsed.agentLineByDay as Record<string, AgentLineDayBucket>)
				: {};
		const tokenEvents = Array.isArray(parsed.tokenEvents) ? (parsed.tokenEvents as TokenUsageEvent[]) : [];
		return { version: 1, agentLineByDay, tokenEvents };
	} catch {
		return emptyStore();
	}
}

function saveStore(dataDir: string, data: UsageStatsFileV1): void {
	const p = usageStatsFilePath(dataDir);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/** 供测试：按截止时间裁剪 token 事件。 */
export function pruneTokenEvents(events: TokenUsageEvent[], nowMs: number, windowMs: number): TokenUsageEvent[] {
	const cutoff = nowMs - windowMs;
	return events.filter((e) => typeof e.at === 'number' && e.at >= cutoff).sort((a, b) => a.at - b.at);
}

export function recordAgentLineDelta(dataDir: string | null | undefined, delta: { add: number; del: number }, atMs = Date.now()): void {
	const r = dataDir?.trim();
	if (!r || (delta.add <= 0 && delta.del <= 0)) {
		return;
	}
	const data = loadStore(r);
	const key = localDateKey(atMs);
	const prev = data.agentLineByDay[key] ?? { add: 0, del: 0 };
	data.agentLineByDay[key] = {
		add: prev.add + Math.max(0, delta.add),
		del: prev.del + Math.max(0, delta.del),
	};
	saveStore(r, data);
}

export function recordTokenUsageEvent(
	dataDir: string | null | undefined,
	partial: Omit<TokenUsageEvent, 'at'> & { at?: number },
	nowMs = Date.now()
): void {
	const r = dataDir?.trim();
	if (!r) {
		return;
	}
	const modelId = String(partial.modelId ?? '').trim();
	if (!modelId) {
		return;
	}
	const input = partial.input ?? 0;
	const output = partial.output ?? 0;
	const cacheRead = partial.cacheRead ?? 0;
	const cacheWrite = partial.cacheWrite ?? 0;
	if (input + output + cacheRead + cacheWrite <= 0) {
		return;
	}
	const data = loadStore(r);
	const evt: TokenUsageEvent = {
		at: partial.at ?? nowMs,
		modelId,
		input: partial.input,
		output: partial.output,
		cacheRead: partial.cacheRead,
		cacheWrite: partial.cacheWrite,
		mode: partial.mode,
	};
	data.tokenEvents.push(evt);
	data.tokenEvents = pruneTokenEvents(data.tokenEvents, nowMs, USAGE_STATS_RETENTION_MS);
	saveStore(r, data);
}

export function getUsageStatsForDataDir(dataDir: string): UsageStatsGetResult {
	const r = dataDir.trim();
	if (!r) {
		return { ok: false, reason: 'no-directory' };
	}
	const data = loadStore(r);
	const now = Date.now();
	const pruned = pruneTokenEvents(data.tokenEvents, now, USAGE_STATS_RETENTION_MS);
	if (pruned.length !== data.tokenEvents.length) {
		data.tokenEvents = pruned;
		saveStore(r, data);
	}
	return {
		ok: true,
		dataDir: path.resolve(r),
		agentLineByDay: { ...data.agentLineByDay },
		tokenEvents: pruned,
	};
}
