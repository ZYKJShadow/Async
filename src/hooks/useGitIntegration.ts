import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitPathStatusMap } from '../WorkspaceExplorer';

type Shell = NonNullable<Window['asyncShell']>;
type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

type FullStatusOk = {
	ok: true;
	branch: string;
	lines: string[];
	pathStatus: GitPathStatusMap;
	changedPaths: string[];
	branches: string[];
	current: string;
};

type FullStatusFail = { ok: false; error?: string };

/**
 * 管理所有 Git 相关状态：分支、状态、diff 预览、分支列表。
 * 在 workspace 变化或文件系统触碰时自动刷新。
 */
export function useGitIntegration(shell: Shell | undefined, workspace: string | null) {
	const [gitBranch, setGitBranch] = useState('—');
	const [gitLines, setGitLines] = useState<string[]>([]);
	const [gitPathStatus, setGitPathStatus] = useState<GitPathStatusMap>({});
	const [gitChangedPaths, setGitChangedPaths] = useState<string[]>([]);
	/** `git:status` 成功（有仓库且本机可执行 git）；否则 Agent 改动条回退为对话解析统计 */
	const [gitStatusOk, setGitStatusOk] = useState(false);
	/** 与 refreshGit 同步预取的本地分支列表（供分支选择器立即展示） */
	const [gitBranchList, setGitBranchList] = useState<string[]>([]);
	const [gitBranchListCurrent, setGitBranchListCurrent] = useState('');
	const [diffPreviews, setDiffPreviews] = useState<Record<string, DiffPreview>>({});
	const [diffLoading, setDiffLoading] = useState(false);
	const [gitActionError, setGitActionError] = useState<string | null>(null);
	const [treeEpoch, setTreeEpoch] = useState(0);
	const [gitBranchPickerOpen, setGitBranchPickerOpen] = useState(false);

	const refreshGit = useCallback(async () => {
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('git:fullStatus')) as FullStatusOk | FullStatusFail;
		if (r.ok) {
			setGitStatusOk(true);
			setGitBranch(r.branch || 'master');
			setGitLines(r.lines);
			setGitPathStatus(r.pathStatus ?? {});
			setGitChangedPaths(r.changedPaths ?? []);
			setGitBranchList(Array.isArray(r.branches) ? r.branches : []);
			setGitBranchListCurrent(typeof r.current === 'string' ? r.current : '');
		} else {
			setGitStatusOk(false);
			setGitBranch('—');
			setGitLines([r.error ?? 'Failed to load changes']);
			setGitPathStatus({});
			setGitChangedPaths([]);
			setGitBranchList([]);
			setGitBranchListCurrent('');
			setDiffPreviews({});
		}
		setTreeEpoch((n) => n + 1);
	}, [shell]);

	const onGitBranchListFresh = useCallback((b: string[], c: string) => {
		setGitBranchList(b);
		setGitBranchListCurrent(c);
	}, []);

	// workspace 变化时刷新 git 状态
	useEffect(() => {
		if (!workspace || !shell) {
			return;
		}
		void refreshGit();
	}, [workspace, shell, refreshGit]);

	// 注意：已移除文件系统变化时的自动刷新
	// Git 状态现在只在以下场景刷新：
	// 1. workspace 变化时
	// 2. 用户打开源代码管理视图时（由组件手动调用 refreshGit）
	// 3. AI 修改代码后（agent review/commit/revert 等操作）
	// 这样可以避免高频的文件系统事件导致不必要的 Git 命令执行

	// diffPreviews 懒加载：在 gitChangedPaths 稳定后异步拉取，不阻塞 refreshGit 关键路径
	const diffPreviewsGenRef = useRef(0);
	const gitPathsKey = useMemo(() => gitChangedPaths.join('\n'), [gitChangedPaths]);
	useEffect(() => {
		if (!shell || gitChangedPaths.length === 0) {
			setDiffPreviews({});
			setDiffLoading(false);
			return;
		}
		const gen = ++diffPreviewsGenRef.current;
		setDiffLoading(true);
		let cancelled = false;
		void (async () => {
			try {
				const r = (await shell.invoke('git:diffPreviews', gitChangedPaths)) as
					| { ok: true; previews: Record<string, DiffPreview> }
					| { ok: false };
				if (!cancelled && gen === diffPreviewsGenRef.current && r.ok) {
					setDiffPreviews(r.previews);
				}
			} finally {
				if (!cancelled && gen === diffPreviewsGenRef.current) {
					setDiffLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	// treeEpoch 确保文件系统变化后也重新拉取
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shell, treeEpoch, gitPathsKey]);

	const diffTotals = useMemo(() => {
		let additions = 0,
			deletions = 0;
		for (const p of gitChangedPaths) {
			const pr = diffPreviews[p];
			if (pr) {
				additions += pr.additions;
				deletions += pr.deletions;
			}
		}
		return { additions, deletions };
	}, [gitChangedPaths, diffPreviews]);

	return {
		gitBranch,
		gitLines,
		gitPathStatus,
		gitChangedPaths,
		gitStatusOk,
		gitBranchList,
		gitBranchListCurrent,
		diffPreviews,
		diffLoading,
		gitActionError,
		setGitActionError,
		treeEpoch,
		gitBranchPickerOpen,
		setGitBranchPickerOpen,
		diffTotals,
		refreshGit,
		onGitBranchListFresh,
	};
}
