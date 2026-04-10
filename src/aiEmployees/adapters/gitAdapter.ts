import type { AiOrchestrationRun } from '../../../shared/aiEmployeesSettings';

export type GitAdapterRequest = {
	workspaceRoot: string | null;
	targetBranch: string;
	message: string;
};

/**
 * Git 执行适配：封装主进程 IPC，供编排层在审批通过后调用。
 * 当前为薄封装，便于后续统一加入「谁提交、哪条 run」等审计字段。
 */
export async function requestCommitToBranch(shell: Window['asyncShell'], req: GitAdapterRequest): Promise<{ ok: boolean; error?: string }> {
	if (!shell) {
		return { ok: false, error: 'no-shell' };
	}
	if (!req.workspaceRoot?.trim()) {
		return { ok: false, error: 'no-workspace' };
	}
	if (!req.targetBranch.trim()) {
		return { ok: false, error: 'no-branch' };
	}
	try {
		const created = (await shell.invoke('git:createBranch', req.targetBranch)) as { ok?: boolean };
		if (!created?.ok) {
			const co = (await shell.invoke('git:checkoutBranch', req.targetBranch)) as { ok?: boolean; error?: string };
			if (!co?.ok) {
				return { ok: false, error: co?.error ?? 'checkout-failed' };
			}
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	try {
		const st = (await shell.invoke('git:stageAll')) as { ok?: boolean; error?: string };
		if (!st?.ok) {
			return { ok: false, error: st?.error ?? 'stage-failed' };
		}
		const msg = req.message || `chore(ai-employees): ${req.targetBranch}`;
		const cm = (await shell.invoke('git:commit', msg)) as { ok?: boolean; error?: string };
		if (!cm?.ok) {
			return { ok: false, error: cm?.error ?? 'commit-failed' };
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	return { ok: true };
}

export function formatOrchestrationCommitMessage(run: AiOrchestrationRun): string {
	const b = run.targetBranch ? ` [${run.targetBranch}]` : '';
	return `ai-employees: ${run.goal.slice(0, 72)}${b}`;
}
