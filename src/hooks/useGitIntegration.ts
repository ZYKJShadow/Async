import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { normalizeWorkspaceRelPathForMatch } from '../agentFileChangesFromGit';
import type { GitPathStatusMap } from '../WorkspaceExplorer';

type Shell = NonNullable<Window['asyncShell']>;
type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

type StatusOk = {
	ok: true;
	branch: string;
	lines: string[];
	pathStatus: GitPathStatusMap;
	changedPaths: string[];
};

type StatusFail = { ok: false; error?: string };
type BranchListOk = { ok: true; branches: string[]; current: string };
type BranchListFail = { ok: false; error?: string };

/** 大仓库的 diff 预览分批加载，避免一次返回超大对象卡住渲染线程。 */
const GIT_DIFF_PREVIEW_BATCH_SIZE = 24;

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
	const diffLoadRunIdRef = useRef(0);
	const previewLoadActiveCountRef = useRef(0);
	const previewPathsInFlightRef = useRef<Set<string>>(new Set());
	const previewPathsLoadedRef = useRef<Set<string>>(new Set());

	const refreshGit = useCallback(async () => {
		if (!shell) {
			return;
		}
		// 取消上一轮 diff 预览批加载；新的 changedPaths 到来后再按需重新补齐预览。
		diffLoadRunIdRef.current += 1;
		const [statusR, branchListR] = (await Promise.all([
			shell.invoke('git:status'),
			shell.invoke('git:listBranches'),
		])) as [StatusOk | StatusFail, BranchListOk | BranchListFail];
		// 用 startTransition 标记为非紧急更新：React 可在渲染期间让出主线程给鼠标/键盘事件，
		// 防止 git 状态批量 setState 触发的重渲染阻塞窗口拖动和其他 UI 交互。预览改为单独分批拉取。
		if (statusR.ok) {
			const changedPaths = statusR.changedPaths ?? [];
			const branchList = branchListR.ok && Array.isArray(branchListR.branches) ? branchListR.branches : [];
			const currentBranch = branchListR.ok && typeof branchListR.current === 'string' ? branchListR.current : '';
			previewLoadActiveCountRef.current = 0;
			previewPathsInFlightRef.current = new Set();
			previewPathsLoadedRef.current = new Set();
			startTransition(() => {
				setGitStatusOk(true);
				setGitBranch(currentBranch || statusR.branch || '—');
				setGitLines(statusR.lines);
				setGitPathStatus(statusR.pathStatus ?? {});
				setGitChangedPaths(changedPaths);
				setGitBranchList(branchList);
				setGitBranchListCurrent(currentBranch);
				setDiffPreviews({});
				setDiffLoading(false);
				setTreeEpoch((n) => n + 1);
			});
		} else {
			previewLoadActiveCountRef.current = 0;
			previewPathsInFlightRef.current = new Set();
			previewPathsLoadedRef.current = new Set();
			startTransition(() => {
				setGitStatusOk(false);
				setGitBranch('—');
				setGitLines([statusR.error ?? 'Failed to load changes']);
				setGitPathStatus({});
				setGitChangedPaths([]);
				setGitBranchList([]);
				setGitBranchListCurrent('');
				setDiffPreviews({});
				setDiffLoading(false);
				setTreeEpoch((n) => n + 1);
			});
		}
	}, [shell]);

	const onGitBranchListFresh = useCallback((b: string[], c: string) => {
		setGitBranchList(b);
		setGitBranchListCurrent(c);
	}, []);

	// workspace 变化时先刷新轻量 git 状态：延后到空闲再跑，避免与切工作区首帧、大组件提交抢主线程。
	useEffect(() => {
		if (!workspace || !shell) {
			return;
		}
		const idle =
			typeof window.requestIdleCallback === 'function'
				? window.requestIdleCallback.bind(window)
				: (cb: IdleRequestCallback) =>
						window.setTimeout(
							() => cb({ didTimeout: true, timeRemaining: () => 0 } as IdleDeadline),
							1
						);
		const cancel =
			typeof window.cancelIdleCallback === 'function'
				? window.cancelIdleCallback.bind(window)
				: (id: number) => window.clearTimeout(id);
		// 增加 timeout 到 2000ms，给切换工作区后的渲染和交互留出更多时间
		const id = idle(
			() => {
				void refreshGit();
			},
			{ timeout: 2000 }
		);
		return () => cancel(id);
	}, [workspace, shell, refreshGit]);

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

	/** Git 预览按需按批加载：仅请求可见/展开路径，避免一次性构造超大 preview map。 */
	const loadGitDiffPreviews = useCallback(async (requestedPaths?: readonly string[] | null) => {
		if (!shell) {
			return;
		}
		if (gitChangedPaths.length === 0) {
			return;
		}
		const changedPathMap = new Map<string, string>();
		for (const path of gitChangedPaths) {
			changedPathMap.set(normalizeWorkspaceRelPathForMatch(path), path);
		}
		const candidatePaths = (requestedPaths ?? gitChangedPaths)
			.map((path) => changedPathMap.get(normalizeWorkspaceRelPathForMatch(String(path))) ?? null)
			.filter((path): path is string => Boolean(path));
		const uniquePaths = [...new Set(candidatePaths)];
		const pathsToLoad = uniquePaths.filter((path) => {
			const key = normalizeWorkspaceRelPathForMatch(path);
			return (
				!previewPathsLoadedRef.current.has(key) &&
				!previewPathsInFlightRef.current.has(key)
			);
		});
		if (pathsToLoad.length === 0) {
			return;
		}
		const runId = diffLoadRunIdRef.current;
		previewLoadActiveCountRef.current += 1;
		for (const path of pathsToLoad) {
			previewPathsInFlightRef.current.add(normalizeWorkspaceRelPathForMatch(path));
		}
		startTransition(() => setDiffLoading(true));
		try {
			for (let i = 0; i < pathsToLoad.length; i += GIT_DIFF_PREVIEW_BATCH_SIZE) {
				const batch = pathsToLoad.slice(i, i + GIT_DIFF_PREVIEW_BATCH_SIZE);
				const diffR = (await shell.invoke('git:diffPreviews', batch)) as
					| { ok: true; previews: Record<string, DiffPreview> }
					| { ok: false };
				if (runId !== diffLoadRunIdRef.current) {
					return;
				}
				if (diffR.ok) {
					for (const path of batch) {
						const key = normalizeWorkspaceRelPathForMatch(path);
						previewPathsInFlightRef.current.delete(key);
						previewPathsLoadedRef.current.add(key);
					}
					startTransition(() => {
						setDiffPreviews((prev) => ({ ...prev, ...diffR.previews }));
					});
				} else {
					for (const path of batch) {
						previewPathsInFlightRef.current.delete(normalizeWorkspaceRelPathForMatch(path));
					}
				}
			}
		} catch (e) {
			console.error('[Git] loadGitDiffPreviews:', e);
			for (const path of pathsToLoad) {
				previewPathsInFlightRef.current.delete(normalizeWorkspaceRelPathForMatch(path));
			}
		} finally {
			previewLoadActiveCountRef.current = Math.max(0, previewLoadActiveCountRef.current - 1);
			if (runId === diffLoadRunIdRef.current && previewLoadActiveCountRef.current === 0) {
				startTransition(() => setDiffLoading(false));
			}
		}
	}, [shell, gitChangedPaths]);

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
		loadGitDiffPreviews,
		onGitBranchListFresh,
	};
}
