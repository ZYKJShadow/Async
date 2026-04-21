/**
 * 团队任务调度策略 —— 从 open-multi-agent 移植并适配 Async。
 *
 * 解决执行阶段的问题：当就绪任务数超过 maxParallelExperts 时，
 * 应该优先执行哪些任务？
 */

import type { TeamTask } from './teamOrchestrator.js';
import type { TeamExpertRuntimeProfile } from './teamExpertProfiles.js';

export type TaskSchedulingStrategy = 'fifo' | 'round-robin' | 'least-busy' | 'dependency-first' | 'capability-match';

// ── Keyword helpers (mirrors OMA keywords.ts) ─────────────────────────────

const STOP_WORDS: ReadonlySet<string> = new Set([
	'the', 'and', 'for', 'that', 'this', 'with', 'are', 'from', 'have',
	'will', 'your', 'you', 'can', 'all', 'each', 'when', 'then', 'they',
	'them', 'their', 'about', 'into', 'more', 'also', 'should', 'must',
]);

function extractKeywords(text: string): string[] {
	return [
		...new Set(
			text
				.toLowerCase()
				.split(/\W+/)
				.filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
		),
	];
}

function keywordScore(text: string, keywords: readonly string[]): number {
	const lower = text.toLowerCase();
	return keywords.reduce(
		(acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0),
		0,
	);
}

// ── Dependency-first: critical-path heuristic ─────────────────────────────

/**
 * 计算 `taskId` 有多少下游任务（直接或间接）被它阻塞。
 * 使用正向 BFS 遍历依赖图。
 */
function countBlockedDependents(taskId: string, allTasks: TeamTask[]): number {
	const idToTask = new Map<string, TeamTask>(allTasks.map((t) => [t.id, t]));
	const dependents = new Map<string, string[]>();
	for (const t of allTasks) {
		for (const depId of t.dependencies ?? []) {
			const list = dependents.get(depId) ?? [];
			list.push(t.id);
			dependents.set(depId, list);
		}
	}

	const visited = new Set<string>();
	const queue: string[] = [taskId];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const depId of dependents.get(current) ?? []) {
			if (!visited.has(depId) && idToTask.has(depId)) {
				visited.add(depId);
				queue.push(depId);
			}
		}
	}
	return visited.size;
}

// ── Capability-match: keyword affinity ────────────────────────────────────

function rankByCapabilityMatch(
	readyTasks: TeamTask[],
	specialists: TeamExpertRuntimeProfile[],
): TeamTask[] {
	const agentKeywords = new Map<string, string[]>(
		specialists.map((s) => [
			s.id,
			extractKeywords(`${s.name} ${s.systemPrompt ?? ''} ${s.assignmentKey ?? ''}`),
		]),
	);

	return [...readyTasks].sort((a, b) => {
		const scoreA = computeTaskAffinity(a, specialists, agentKeywords);
		const scoreB = computeTaskAffinity(b, specialists, agentKeywords);
		return scoreB - scoreA;
	});
}

function computeTaskAffinity(
	task: TeamTask,
	specialists: TeamExpertRuntimeProfile[],
	agentKeywords: Map<string, string[]>,
): number {
	const expert = specialists.find((s) => s.id === task.expertId);
	if (!expert) return 0;

	const taskText = `${task.description}`;
	const taskKeywords = extractKeywords(taskText);
	const expertText = `${expert.name} ${expert.systemPrompt ?? ''}`;
	const scoreA = keywordScore(expertText, taskKeywords);
	const scoreB = keywordScore(taskText, agentKeywords.get(expert.id) ?? []);
	return scoreA + scoreB;
}

// ── Least-busy: prefer experts with fewer active tasks ────────────────────

function rankByLeastBusy(
	readyTasks: TeamTask[],
	specialists: TeamExpertRuntimeProfile[],
	activeTaskIds: Set<string>,
	allTasks: TeamTask[],
): TeamTask[] {
	const inProgressCount = new Map<string, number>(specialists.map((s) => [s.id, 0]));
	for (const task of allTasks) {
		if (activeTaskIds.has(task.id) && task.expertId) {
			inProgressCount.set(task.expertId, (inProgressCount.get(task.expertId) ?? 0) + 1);
		}
	}

	return [...readyTasks].sort((a, b) => {
		const loadA = inProgressCount.get(a.expertId) ?? 0;
		const loadB = inProgressCount.get(b.expertId) ?? 0;
		return loadA - loadB;
	});
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * 对就绪任务进行排序，返回按策略排好序的任务列表。
 *
 * 调用方应取前 N 个作为当前批次（N = maxParallelExperts）。
 */
export function rankReadyTasks(
	readyTasks: TeamTask[],
	allTasks: TeamTask[],
	specialists: TeamExpertRuntimeProfile[],
	activeTaskIds: Set<string>,
	strategy: TaskSchedulingStrategy = 'dependency-first',
): TeamTask[] {
	if (readyTasks.length <= 1) return readyTasks;

	switch (strategy) {
		case 'fifo':
			return readyTasks;
		case 'round-robin': {
			// Cycle by expert id to spread load across different experts.
			const seenExperts = new Set<string>();
			const result: TeamTask[] = [];
			const remaining = [...readyTasks];
			while (remaining.length > 0) {
				let found = false;
				for (let i = 0; i < remaining.length; i++) {
					const task = remaining[i]!;
					if (!seenExperts.has(task.expertId)) {
						seenExperts.add(task.expertId);
						result.push(task);
						remaining.splice(i, 1);
						found = true;
						break;
					}
				}
				if (!found) {
					// All remaining experts already seen; reset and continue.
					seenExperts.clear();
				}
			}
			return result;
		}
		case 'least-busy':
			return rankByLeastBusy(readyTasks, specialists, activeTaskIds, allTasks);
		case 'capability-match':
			return rankByCapabilityMatch(readyTasks, specialists);
		case 'dependency-first':
		default: {
			return [...readyTasks].sort((a, b) => {
				const critA = countBlockedDependents(a.id, allTasks);
				const critB = countBlockedDependents(b.id, allTasks);
				return critB - critA;
			});
		}
	}
}
