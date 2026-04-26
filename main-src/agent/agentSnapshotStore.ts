/**
 * Agent 写文件快照的磁盘持久化。
 *
 * 在内存里维护着 `agentRevertSnapshotsByThread`（每个 thread → relPath → 原文件内容 / null），
 * 但旧实现仅放在内存里，应用重启后整个 Map 会丢失，导致用户在面板上点击「撤销」时
 * 后端默默 no-op 而 UI 仍当作成功隐藏面板，磁盘其实没有被还原。
 *
 * 这里把每个 thread 的快照独立写到 `{userData}/async/agent-snapshots/{safeId}.json`，
 * 启动时一次性 reload 回内存 Map；之后由 chatRuntime / IPC handler 的几个改动入口
 * （beforeWrite hook、keep / revert）显式调用 `flushThread` / `removeThread` 同步落盘。
 *
 * 选择"整文件 JSON"而非每文件一份 blob 是因为：
 *  - 一轮 agent 通常改 1–10 个文件，单个 JSON 几十 KB 是常态，写入开销可忽略；
 *  - 减少子目录管理 / 残留清理的复杂度；
 *  - 与现有 plans 子目录结构对齐。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const STORE_VERSION = 1 as const;

type StoredSnapshotEntry = {
	relPath: string;
	previousContent: string | null;
};

type StoredSnapshotFile = {
	v: typeof STORE_VERSION;
	threadId: string;
	updatedAt: number;
	entries: StoredSnapshotEntry[];
};

let snapshotsDir: string | null = null;

function safeThreadFileName(threadId: string): string {
	// 容错：threadId 通常是 UUID，但保险起见把非字母数字下划线点连字符全部替成 _。
	const cleaned = String(threadId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
	return cleaned ? `${cleaned}.json` : '__empty__.json';
}

function snapshotFilePathForThread(threadId: string): string | null {
	if (!snapshotsDir) return null;
	return path.join(snapshotsDir, safeThreadFileName(threadId));
}

/**
 * 启动时调用：建好目录、读出已有快照填充 outMap。
 * 同名旧文件解析失败时直接忽略并删除（坏数据没有保留价值）。
 */
export function initAgentSnapshotStore(
	userDataDir: string,
	outMap: Map<string, Map<string, string | null>>
): void {
	snapshotsDir = path.join(userDataDir, 'async', 'agent-snapshots');
	try {
		fs.mkdirSync(snapshotsDir, { recursive: true });
	} catch (err) {
		console.warn('[agentSnapshotStore] mkdir failed:', err);
		return;
	}

	let entries: string[] = [];
	try {
		entries = fs.readdirSync(snapshotsDir);
	} catch {
		return;
	}

	for (const name of entries) {
		if (!name.endsWith('.json')) continue;
		const full = path.join(snapshotsDir, name);
		try {
			const raw = fs.readFileSync(full, 'utf8');
			const data = JSON.parse(raw) as Partial<StoredSnapshotFile>;
			if (data.v !== STORE_VERSION || typeof data.threadId !== 'string' || !Array.isArray(data.entries)) {
				fs.unlinkSync(full);
				continue;
			}
			const map = new Map<string, string | null>();
			for (const e of data.entries) {
				if (!e || typeof e.relPath !== 'string') continue;
				const prev = e.previousContent;
				if (prev === null || typeof prev === 'string') {
					map.set(e.relPath, prev);
				}
			}
			if (map.size > 0) {
				outMap.set(data.threadId, map);
			} else {
				// 空映射没有保留价值；同步把磁盘那份也清掉。
				fs.unlinkSync(full);
			}
		} catch (err) {
			console.warn('[agentSnapshotStore] failed to load', name, err);
			try {
				fs.unlinkSync(full);
			} catch {
				/* ignore */
			}
		}
	}
}

/** 写整份快照文件；snapshots 为空则等价于 removeThread。 */
export function flushThreadSnapshots(
	threadId: string,
	snapshots: Map<string, string | null> | null | undefined
): void {
	const target = snapshotFilePathForThread(threadId);
	if (!target) return;

	if (!snapshots || snapshots.size === 0) {
		try {
			if (fs.existsSync(target)) fs.unlinkSync(target);
		} catch (err) {
			console.warn('[agentSnapshotStore] remove failed:', err);
		}
		return;
	}

	const payload: StoredSnapshotFile = {
		v: STORE_VERSION,
		threadId,
		updatedAt: Date.now(),
		entries: Array.from(snapshots.entries()).map(([relPath, previousContent]) => ({
			relPath,
			previousContent,
		})),
	};

	try {
		// 先写临时文件再重命名，避免写入中途异常残留半截 JSON。
		const tmp = `${target}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
		fs.renameSync(tmp, target);
	} catch (err) {
		console.warn('[agentSnapshotStore] write failed:', err);
	}
}

export function removeThreadSnapshots(threadId: string): void {
	flushThreadSnapshots(threadId, null);
}
