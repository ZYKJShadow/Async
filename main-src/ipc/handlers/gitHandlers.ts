import { ipcMain } from 'electron';
import * as gitService from '../../gitService.js';
import { senderWorkspaceRoot } from '../agentRuntime.js';

/**
 * `git:*` IPC：状态、暂存、提交、推送、diff 预览、分支管理。
 * 所有调用统一在 `gitService.withGitWorkspaceRootAsync` 内执行，
 * 失败信息走 `gitService.normalizeGitFailureMessage`，
 * 行为与原 register.ts 完全一致。
 */
export function registerGitHandlers(): void {
	ipcMain.handle('git:status', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return await gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const gitTop = probe.topLevel;
				const [porcelain, branch] = await Promise.all([
					gitService.gitStatusPorcelain(),
					gitService.gitBranch(),
				]);
				const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
				const rawPathStatus = gitService.parseGitPathStatus(lines);
				const rawOrdered = gitService.listPorcelainPaths(lines);
				const pathStatus: Record<string, gitService.PathStatusEntry> = {};
				for (const [repoRel, entry] of Object.entries(rawPathStatus)) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel) {
						pathStatus[wsRel] = entry;
					}
				}
				const changedPaths: string[] = [];
				const seen = new Set<string>();
				for (const repoRel of rawOrdered) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel && !seen.has(wsRel)) {
						seen.add(wsRel);
						changedPaths.push(wsRel);
					}
				}
				return { ok: true as const, branch, lines, pathStatus, changedPaths };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Failed to load changes'),
				};
			}
		});
	});

	ipcMain.handle('git:fullStatus', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return await gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const gitTop = probe.topLevel;
				const [porcelain, branchListPack] = await Promise.all([
					gitService.gitStatusPorcelain(),
					gitService.gitListLocalBranches(),
				]);
				const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
				const rawPathStatus = gitService.parseGitPathStatus(lines);
				const rawOrdered = gitService.listPorcelainPaths(lines);
				const pathStatus: Record<string, gitService.PathStatusEntry> = {};
				for (const [repoRel, entry] of Object.entries(rawPathStatus)) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel) {
						pathStatus[wsRel] = entry;
					}
				}
				const changedPaths: string[] = [];
				const seen = new Set<string>();
				for (const repoRel of rawOrdered) {
					const wsRel = gitService.workspaceRelativeFromRepoRelative(repoRel, root, gitTop);
					if (wsRel && !seen.has(wsRel)) {
						seen.add(wsRel);
						changedPaths.push(wsRel);
					}
				}
				const branch = branchListPack.current?.trim() ? branchListPack.current : 'master';
				const branches = branchListPack.branches;
				const current = branchListPack.current;
				let previews: Record<string, gitService.DiffPreview> = {};
				if (changedPaths.length > 0) {
					const fullDiffRaw = await gitService.gitDiffHeadUnified(root);
					previews = await gitService.buildDiffPreviewsMap(
						changedPaths,
						fullDiffRaw,
						root,
						gitTop,
						{ maxChars: 4_000 }
					);
				}
				return {
					ok: true as const,
					branch,
					lines,
					pathStatus,
					changedPaths,
					branches,
					current,
					previews,
				};
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Failed to load changes'),
				};
			}
		});
	});

	ipcMain.handle('git:stageAll', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				await gitService.gitStageAll();
				return { ok: true as const };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:commit', async (event, message: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				await gitService.gitCommit(message);
				return { ok: true as const };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:push', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				await gitService.gitPush();
				return { ok: true as const };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle('git:diffPreviews', async (event, relPaths: string[]) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		const list = Array.isArray(relPaths) ? relPaths : [];
		try {
			return await gitService.withGitWorkspaceRootAsync(root, async () => {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const fullDiffRaw = await gitService.gitDiffHeadUnified(root);
				const previews = await gitService.buildDiffPreviewsMap(list, fullDiffRaw, root, probe.topLevel, { maxChars: 4_000 });
				return { ok: true as const, previews };
			});
		} catch (e) {
			return { ok: false as const, error: String(e) };
		}
	});

	ipcMain.handle(
		'git:diffPreview',
		async (event, payload: { relPath?: string; full?: boolean; maxChars?: number | null }) => {
			const root = senderWorkspaceRoot(event);
			if (!root) {
				return { ok: false as const, error: 'No workspace' };
			}
			const relPath = String(payload?.relPath ?? '').trim();
			if (!relPath) {
				return { ok: false as const, error: 'Bad path' };
			}
			try {
				const preview = await gitService.getDiffPreview(
					relPath,
					{
						maxChars: payload?.full ? null : payload?.maxChars,
					},
					root
				);
				return { ok: true as const, preview };
			} catch (e) {
				return { ok: false as const, error: String(e) };
			}
		}
	);

	ipcMain.handle('git:listBranches', async (event) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return await gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				const { branches, current } = await gitService.gitListLocalBranches();
				return { ok: true as const, branches, current };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Could not load branches'),
				};
			}
		});
	});

	ipcMain.handle('git:checkoutBranch', async (event, branch: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				await gitService.gitSwitchBranch(typeof branch === 'string' ? branch : '');
				return { ok: true as const };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Could not switch branch'),
				};
			}
		});
	});

	ipcMain.handle('git:createBranch', async (event, name: string) => {
		const root = senderWorkspaceRoot(event);
		if (!root) {
			return { ok: false as const, error: 'No workspace' };
		}
		return gitService.withGitWorkspaceRootAsync(root, async () => {
			try {
				const probe = await gitService.gitProbeContext();
				if (!probe.ok) {
					return { ok: false as const, error: probe.message };
				}
				await gitService.gitCreateBranchAndSwitch(typeof name === 'string' ? name : '');
				return { ok: true as const };
			} catch (e) {
				return {
					ok: false as const,
					error: gitService.normalizeGitFailureMessage(e, 'Could not create branch'),
				};
			}
		});
	});
}
