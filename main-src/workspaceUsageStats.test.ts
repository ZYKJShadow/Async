import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	USAGE_STATS_RETENTION_MS,
	getUsageStatsForDataDir,
	localDateKey,
	pruneTokenEvents,
	recordAgentLineDelta,
	recordTokenUsageEvent,
	usageStatsFilePath,
	type TokenUsageEvent,
} from './workspaceUsageStats.js';

describe('pruneTokenEvents', () => {
	it('drops events older than window and sorts by at', () => {
		const now = 1_000_000;
		const window = 10_000;
		const events: TokenUsageEvent[] = [
			{ at: now - 20_000, modelId: 'old' },
			{ at: now - 5_000, modelId: 'b' },
			{ at: now - 8_000, modelId: 'a' },
		];
		const out = pruneTokenEvents(events, now, window);
		expect(out.map((e) => e.modelId)).toEqual(['a', 'b']);
	});

	it('filters out events with non-numeric at', () => {
		const now = 1000;
		const events = [
			{ at: 500, modelId: 'ok', input: 1 },
			{ at: Number.NaN, modelId: 'bad', input: 1 } as unknown as TokenUsageEvent,
		];
		const out = pruneTokenEvents(events, now, 10_000);
		expect(out).toHaveLength(1);
		expect(out[0]!.modelId).toBe('ok');
	});
});

describe('usageStatsFilePath', () => {
	it('joins resolved dataDir with usage-stats.json', () => {
		const dir = path.join('foo', 'bar');
		const p = usageStatsFilePath(dir);
		expect(p).toBe(path.join(path.resolve(dir), 'usage-stats.json'));
	});
});

describe('localDateKey', () => {
	it('formats local calendar date as YYYY-MM-DD', () => {
		const d = new Date(2026, 3, 5, 23, 59, 59);
		expect(localDateKey(d.getTime())).toBe('2026-04-05');
	});
});

describe('workspaceUsageStats persistence (temp dir)', () => {
	const tmpDirs: string[] = [];

	afterEach(() => {
		for (const d of tmpDirs.splice(0)) {
			try {
				fs.rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	});

	function mkDataDir(): string {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), 'void-usage-'));
		tmpDirs.push(d);
		return d;
	}

	it('recordAgentLineDelta creates usage-stats.json and parent structure', () => {
		const dir = mkDataDir();
		const t = new Date(2026, 5, 10, 12, 0, 0).getTime();
		recordAgentLineDelta(dir, { add: 2, del: 1 }, t);
		const fp = usageStatsFilePath(dir);
		expect(fs.existsSync(fp)).toBe(true);
		const raw = JSON.parse(fs.readFileSync(fp, 'utf8')) as { agentLineByDay: Record<string, { add: number; del: number }> };
		expect(raw.agentLineByDay['2026-06-10']).toEqual({ add: 2, del: 1 });
	});

	it('recordAgentLineDelta accumulates the same calendar day', () => {
		const dir = mkDataDir();
		const t = new Date(2026, 7, 1, 8, 0, 0).getTime();
		recordAgentLineDelta(dir, { add: 1, del: 0 }, t);
		recordAgentLineDelta(dir, { add: 0, del: 3 }, t + 3_600_000);
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.agentLineByDay['2026-08-01']).toEqual({ add: 1, del: 3 });
		}
	});

	it('recordAgentLineDelta is a no-op when dataDir is null', () => {
		const dir = mkDataDir();
		recordAgentLineDelta(null, { add: 5, del: 5 });
		expect(fs.existsSync(usageStatsFilePath(dir))).toBe(false);
	});

	it('recordAgentLineDelta is a no-op when both add and del are zero', () => {
		const dir = mkDataDir();
		recordAgentLineDelta(dir, { add: 0, del: 0 });
		expect(fs.existsSync(usageStatsFilePath(dir))).toBe(false);
	});

	it('recordTokenUsageEvent appends and respects retention window', () => {
		const dir = mkDataDir();
		const now = 1_800_000_000_000;
		const tooOld = now - USAGE_STATS_RETENTION_MS - 86_400_000;
		recordTokenUsageEvent(dir, { modelId: 'm1', input: 1, at: tooOld }, now);
		recordTokenUsageEvent(dir, { modelId: 'm2', output: 2, at: now - 1000 }, now);
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.tokenEvents).toHaveLength(1);
			expect(snap.tokenEvents[0]!.modelId).toBe('m2');
		}
	});

	it('recordTokenUsageEvent is a no-op without modelId', () => {
		const dir = mkDataDir();
		recordTokenUsageEvent(dir, { modelId: '  ', input: 1 });
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.tokenEvents).toHaveLength(0);
		}
	});

	it('recordTokenUsageEvent is a no-op when all token fields are zero', () => {
		const dir = mkDataDir();
		recordTokenUsageEvent(dir, { modelId: 'x', input: 0, output: 0 });
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.tokenEvents).toHaveLength(0);
		}
	});

	it('getUsageStatsForDataDir persists prune when events expire', () => {
		const dir = mkDataDir();
		const realNow = Date.now();
		const fp = usageStatsFilePath(dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			fp,
			JSON.stringify({
				version: 1,
				agentLineByDay: {},
				tokenEvents: [
					{ at: realNow - USAGE_STATS_RETENTION_MS - 86_400_000, modelId: 'gone', input: 1 },
					{ at: realNow - 60_000, modelId: 'keep', output: 1 },
				],
			}),
			'utf8'
		);
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.tokenEvents).toHaveLength(1);
			expect(snap.tokenEvents[0]!.modelId).toBe('keep');
		}
		const disk = JSON.parse(fs.readFileSync(fp, 'utf8')) as { tokenEvents: { modelId: string }[] };
		expect(disk.tokenEvents).toHaveLength(1);
		expect(disk.tokenEvents[0]!.modelId).toBe('keep');
	});

	it('getUsageStatsForDataDir returns no-directory for whitespace-only path', () => {
		expect(getUsageStatsForDataDir('  \t  ')).toEqual({ ok: false, reason: 'no-directory' });
	});

	it('loadStore recovers from corrupt JSON with empty store', () => {
		const dir = mkDataDir();
		const fp = usageStatsFilePath(dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(fp, '{ not json', 'utf8');
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.agentLineByDay).toEqual({});
			expect(snap.tokenEvents).toEqual([]);
		}
	});

	it('resolved dataDir in snapshot is absolute', () => {
		const dir = mkDataDir();
		recordTokenUsageEvent(dir, { modelId: 'a', input: 1 });
		const snap = getUsageStatsForDataDir(dir);
		expect(snap.ok).toBe(true);
		if (snap.ok) {
			expect(snap.dataDir).toBe(path.resolve(dir));
		}
	});
});
