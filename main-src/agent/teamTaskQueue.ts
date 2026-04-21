/**
 * 拓扑依赖感知的任务队列 —— 从 open-multi-agent 移植并适配 Async。
 *
 * 将 teamOrchestrator 中内联的 pending/completed/active 数组操作
 * 提取为独立组件，自动处理：
 * - blocked → pending 的解阻塞
 * - 失败/跳过时级联到下游依赖
 * - 任务状态查询与进度统计
 */

import type { TeamTask } from './teamOrchestrator.js';

export type TaskStatus = TeamTask['status'];

export class TeamTaskQueue {
	private readonly tasks = new Map<string, TeamTask>();

	add(task: TeamTask): void {
		const resolved = this.resolveInitialStatus(task);
		this.tasks.set(resolved.id, resolved);
	}

	addBatch(tasks: TeamTask[]): void {
		for (const task of tasks) {
			this.add(task);
		}
	}

	get(taskId: string): TeamTask | undefined {
		return this.tasks.get(taskId);
	}

	list(): TeamTask[] {
		return Array.from(this.tasks.values());
	}

	getByStatus(status: TaskStatus): TeamTask[] {
		return this.list().filter((t) => t.status === status);
	}

	/** 返回依赖已全部满足且状态为 pending 的任务 */
	getReady(): TeamTask[] {
		return this.list().filter((t) => this.isTaskReady(t));
	}

	/** 返回 status 为 pending 或 blocked 的非终止任务 */
	getPendingOrBlocked(): TeamTask[] {
		return this.list().filter((t) => t.status === 'pending' || t.status === 'blocked');
	}

	update(taskId: string, update: Partial<Pick<TeamTask, 'status' | 'result'>>): TeamTask {
		const task = this.requireTask(taskId);
		const updated: TeamTask = {
			...task,
			...update,
		};
		this.tasks.set(taskId, updated);
		return updated;
	}

	complete(taskId: string, result?: string): TeamTask {
		const completed = this.update(taskId, { status: 'completed', result });
		this.unblockDependents(taskId);
		return completed;
	}

	fail(taskId: string, error: string): TeamTask {
		const failed = this.update(taskId, { status: 'failed', result: error });
		this.cascadeFailure(taskId);
		return failed;
	}

	/**
	 * 跳过指定任务及其所有下游依赖。
	 * 用于 approval gate 拒绝或 abort 场景。
	 */
	skip(taskId: string, reason: string): TeamTask {
		const skipped = this.update(taskId, { status: 'failed', result: reason });
		this.cascadeSkip(taskId, reason);
		return skipped;
	}

	/** 跳过所有非终止任务 */
	skipAllRemaining(reason = 'Skipped.'): void {
		const snapshot = this.list();
		for (const task of snapshot) {
			if (task.status === 'completed' || task.status === 'failed') continue;
			this.update(task.id, { status: 'failed', result: reason });
		}
	}

	remove(taskId: string): boolean {
		return this.tasks.delete(taskId);
	}

	isComplete(): boolean {
		for (const task of this.tasks.values()) {
			if (task.status !== 'completed' && task.status !== 'failed') {
				return false;
			}
		}
		return true;
	}

	getProgress(): {
		total: number;
		completed: number;
		failed: number;
		inProgress: number;
		pending: number;
		blocked: number;
	} {
		let completed = 0;
		let failed = 0;
		let inProgress = 0;
		let pending = 0;
		let blocked = 0;

		for (const task of this.tasks.values()) {
			switch (task.status) {
				case 'completed':
					completed++;
					break;
				case 'failed':
					failed++;
					break;
				case 'in_progress':
					inProgress++;
					break;
				case 'pending':
					pending++;
					break;
				case 'revision':
					// Treat revision as in-progress for progress tracking.
					inProgress++;
					break;
				case 'blocked':
					blocked++;
					break;
				default:
					blocked++;
					break;
			}
		}

		return {
			total: this.tasks.size,
			completed,
			failed,
			inProgress,
			pending,
			blocked,
		};
	}

	// ── Private helpers ─────────────────────────────────────────────────────

	private resolveInitialStatus(task: TeamTask): TeamTask {
		if (!task.dependencies || task.dependencies.length === 0) {
			return task.status === 'pending' ? task : { ...task, status: 'pending' };
		}
		if (this.isTaskReady(task)) {
			return task.status === 'pending' ? task : { ...task, status: 'pending' };
		}
		return { ...task, status: 'blocked' };
	}

	private isTaskReady(task: TeamTask): boolean {
		if (task.status !== 'pending' && task.status !== 'blocked') return false;
		const deps = task.dependencies ?? [];
		if (deps.length === 0) return true;
		return deps.every((depId) => {
			const dep = this.tasks.get(depId);
			return dep?.status === 'completed';
		});
	}

	private unblockDependents(completedId: string): void {
		for (const task of this.tasks.values()) {
			if (task.status !== 'blocked') continue;
			if (!task.dependencies?.includes(completedId)) continue;
			if (this.isTaskReady(task)) {
				this.tasks.set(task.id, { ...task, status: 'pending' });
			}
		}
	}

	private cascadeFailure(failedTaskId: string): void {
		for (const task of this.tasks.values()) {
			if (task.status !== 'blocked' && task.status !== 'pending') continue;
			if (!task.dependencies?.includes(failedTaskId)) continue;
			this.update(task.id, {
				status: 'failed',
				result: `Cancelled: dependency "${failedTaskId}" failed.`,
			});
			this.cascadeFailure(task.id);
		}
	}

	private cascadeSkip(skippedTaskId: string, reason: string): void {
		for (const task of this.tasks.values()) {
			if (task.status !== 'blocked' && task.status !== 'pending') continue;
			if (!task.dependencies?.includes(skippedTaskId)) continue;
			this.update(task.id, {
				status: 'failed',
				result: `Skipped: dependency "${skippedTaskId}" was skipped — ${reason}`,
			});
			this.cascadeSkip(task.id, reason);
		}
	}

	private requireTask(taskId: string): TeamTask {
		const task = this.tasks.get(taskId);
		if (!task) throw new Error(`TeamTaskQueue: task "${taskId}" not found.`);
		return task;
	}
}
