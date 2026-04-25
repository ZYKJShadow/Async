import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { normWorkspaceRootKey } from '../workspaceRootKey';

type Shell = NonNullable<Window['asyncShell']>;

const AGENT_WORKSPACE_ALIASES_KEY = 'async:agent-workspace-aliases-v1';
const AGENT_WORKSPACE_HIDDEN_KEY = 'async:agent-workspace-hidden-v2';
const AGENT_WORKSPACE_COLLAPSED_KEY = 'async:agent-workspace-collapsed-v2';

function readJsonStorage<T>(key: string, fallback: T): T {
	try {
		if (typeof window === 'undefined') return fallback;
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function writeJsonStorage(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* ignore */
	}
}

/** workspace:searchFiles 返回的单条结果 */
export type WorkspaceFileSearchItem = {
	path: string;
	label: string;
	description: string;
};

/**
 * 管理工作区核心状态：路径、最近列表、别名。
 *
 * ### 文件列表架构（v3 - 完全按需）
 * - `@` 提及：`workspace:searchFiles`（主进程 top-K 搜索，首次触发时用 git ls-files 建索引，~50ms）。
 * - 快速打开等仍可在需要时调用 `ensureWorkspaceFileListLoaded()`，通过 `workspace:listFiles` 拉全量到 `workspaceFileListRef`；
 *   历史消息里的 `@路径` 气泡展示由渲染端启发式解析，不再依赖该列表。
 * - 不再在工作区打开时预热文件索引，完全按需触发，消除启动时的主进程阻塞。
 */
export function useWorkspaceManager(shell: Shell | undefined) {
	const [workspace, setWorkspace] = useState<string | null>(null);
	const [homeRecents, setHomeRecents] = useState<string[]>([]);
	/** 文件菜单「打开最近的文件夹」：与是否打开工作区无关 */
	const [folderRecents, setFolderRecents] = useState<string[]>([]);
	const [workspaceAliases, setWorkspaceAliases] = useState<Record<string, string>>(() =>
		readJsonStorage<Record<string, string>>(AGENT_WORKSPACE_ALIASES_KEY, {})
	);
	const [hiddenAgentWorkspacePaths, setHiddenAgentWorkspacePaths] = useState<string[]>(() =>
		readJsonStorage<string[]>(AGENT_WORKSPACE_HIDDEN_KEY, [])
	);
	const [collapsedAgentWorkspacePaths, setCollapsedAgentWorkspacePaths] = useState<string[]>(() =>
		readJsonStorage<string[]>(AGENT_WORKSPACE_COLLAPSED_KEY, [])
	);

	// ── 持久化 ────────────────────────────────────────────────────────────────

	useEffect(() => {
		writeJsonStorage(AGENT_WORKSPACE_ALIASES_KEY, workspaceAliases);
	}, [workspaceAliases]);

	useEffect(() => {
		writeJsonStorage(AGENT_WORKSPACE_HIDDEN_KEY, hiddenAgentWorkspacePaths);
	}, [hiddenAgentWorkspacePaths]);

	useEffect(() => {
		writeJsonStorage(AGENT_WORKSPACE_COLLAPSED_KEY, collapsedAgentWorkspacePaths);
	}, [collapsedAgentWorkspacePaths]);

	// ── 文件列表（按需拉取）──────────────────────────────────────────────────
	const workspaceFileListRef = useRef<string[]>([]);
	const listLoadPromiseRef = useRef<Promise<string[]> | null>(null);
	const [workspaceFileListVersion, setWorkspaceFileListVersion] = useState(0);

	useEffect(() => {
		workspaceFileListRef.current = [];
		listLoadPromiseRef.current = null;
		setWorkspaceFileListVersion(0);
	}, [workspace]);

	const ensureWorkspaceFileListLoaded = useCallback(async (): Promise<string[]> => {
		if (!shell || !workspace) {
			return [];
		}
		if (workspaceFileListRef.current.length > 0) {
			return workspaceFileListRef.current;
		}
		if (listLoadPromiseRef.current) {
			return listLoadPromiseRef.current;
		}
		const p = (async () => {
			try {
				const r = (await shell.invoke('workspace:listFiles')) as
					| { ok: true; paths: string[] }
					| { ok: false; error?: string };
				const paths = r.ok && Array.isArray(r.paths) ? r.paths : [];
				workspaceFileListRef.current = paths;
				setWorkspaceFileListVersion((v) => v + 1);
				return paths;
			} finally {
				listLoadPromiseRef.current = null;
			}
		})();
		listLoadPromiseRef.current = p;
		return p;
	}, [shell, workspace]);

	// ── 按需搜索 ─────────────────────────────────────────────────────────────

	const searchFiles = useCallback(
		async (query: string, gitChangedPaths: string[], limit = 60): Promise<WorkspaceFileSearchItem[]> => {
			if (!shell || !workspace) return [];
			try {
				const r = (await shell.invoke('workspace:searchFiles', { query, gitChangedPaths, limit })) as {
					ok: boolean;
					items: WorkspaceFileSearchItem[];
				};
				return r.ok ? r.items : [];
			} catch {
				return [];
			}
		},
		[shell, workspace]
	);

	// ── 最近工作区 ────────────────────────────────────────────────────────────

	useEffect(() => {
		if (!shell) {
			setHomeRecents([]);
			setFolderRecents([]);
			return;
		}
		if (workspace) setHomeRecents([]);
		let cancelled = false;
		void (async () => {
			try {
				const r = (await shell.invoke('workspace:listRecents')) as { paths?: string[] };
				if (cancelled) return;
				const paths = Array.isArray(r.paths) ? r.paths : [];
				if (!workspace) setHomeRecents(paths);
				setFolderRecents(paths);
			} catch {
				if (!cancelled) {
					setHomeRecents([]);
					setFolderRecents([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace]);

	// 兼容旧数据：当前工作区不能因为历史 hidden 标记从 Agent 全局侧栏消失。
	useEffect(() => {
		if (!workspace) return;
		const workspaceKey = normWorkspaceRootKey(workspace);
		setHiddenAgentWorkspacePaths((prev) =>
			prev.filter((item) => normWorkspaceRootKey(item) !== workspaceKey)
		);
	}, [workspace]);

	// ── TS LSP ────────────────────────────────────────────────────────────────
	// 不在渲染进程自动启动 LSP。关闭工作区时通知主进程释放 WorkspaceLspManager。

	useEffect(() => {
		if (!shell || workspace) return;
		void shell.invoke('lsp:ts:stop').catch(() => {});
	}, [shell, workspace]);

	return {
		workspace,
		setWorkspace,
		workspaceFileListRef: workspaceFileListRef as MutableRefObject<string[]>,
		/** 在 `workspaceFileListRef` 更新后递增，供依赖全量列表的 UI（如快速打开）重读 ref */
		workspaceFileListVersion,
		/** 首次需要全量路径时调用（幂等、并发合并） */
		ensureWorkspaceFileListLoaded,
		/** 按需搜索工作区文件（IPC，主进程侧过滤）；用于 @ 提及 */
		searchFiles,
		homeRecents,
		setHomeRecents,
		folderRecents,
		setFolderRecents,
		workspaceAliases,
		setWorkspaceAliases,
		hiddenAgentWorkspacePaths,
		setHiddenAgentWorkspacePaths,
		collapsedAgentWorkspacePaths,
		setCollapsedAgentWorkspacePaths,
	};
}
