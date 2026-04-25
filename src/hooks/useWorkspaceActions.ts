import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from 'react';
import type { TFunction } from '../i18n';
import { normWorkspaceRootKey } from '../workspaceRootKey';

function workspacePathDisplayName(full: string): string {
	const norm = full.replace(/\\/g, '/');
	const parts = norm.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? full;
}

export type UseWorkspaceActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	t: TFunction;
	flashComposerAttachErr: (msg: string) => void;
	showTransientToast: (ok: boolean, text: string) => void;
	workspaceAliases: Record<string, string>;
	setWorkspaceAliases: Dispatch<SetStateAction<Record<string, string>>>;
	setCollapsedAgentWorkspacePaths: Dispatch<SetStateAction<string[]>>;
	setHiddenAgentWorkspacePaths: Dispatch<SetStateAction<string[]>>;
	setFolderRecents: Dispatch<SetStateAction<string[]>>;
	setHomeRecents: Dispatch<SetStateAction<string[]>>;
};

export function useWorkspaceActions(p: UseWorkspaceActionsParams) {
	const {
		shell,
		t,
		flashComposerAttachErr,
		showTransientToast,
		workspaceAliases,
		setWorkspaceAliases,
		setCollapsedAgentWorkspacePaths,
		setHiddenAgentWorkspacePaths,
		setFolderRecents,
		setHomeRecents,
	} = p;

	const [workspaceMenuPath, setWorkspaceMenuPath] = useState<string | null>(null);
	const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<{ top: number; left: number } | null>(null);
	const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
	const workspaceMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
	const [editingWorkspacePath, setEditingWorkspacePath] = useState<string | null>(null);
	const [editingWorkspaceNameDraft, setEditingWorkspaceNameDraft] = useState('');
	const workspaceNameDraftRef = useRef('');
	const workspaceNameInputRef = useRef<HTMLInputElement | null>(null);

	const closeWorkspaceMenu = useCallback(() => {
		setWorkspaceMenuPath(null);
		setWorkspaceMenuPosition(null);
		workspaceMenuAnchorRef.current = null;
	}, []);

	const openWorkspaceMenu = useCallback((path: string, anchor: HTMLButtonElement) => {
		workspaceMenuAnchorRef.current = anchor;
		setWorkspaceMenuPath(path);
	}, []);

	const toggleWorkspaceCollapsed = useCallback((path: string) => {
		const key = normWorkspaceRootKey(path);
		setCollapsedAgentWorkspacePaths((prev) => {
			const exists = prev.some((item) => normWorkspaceRootKey(item) === key);
			return exists
				? prev.filter((item) => normWorkspaceRootKey(item) !== key)
				: [...prev, path];
		});
	}, [setCollapsedAgentWorkspacePaths]);

	const revealWorkspaceInOs = useCallback(
		async (path: string) => {
			if (!shell) {
				return;
			}
			try {
				const r = (await shell.invoke('shell:revealAbsolutePath', path)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errReveal'));
				}
			} catch (e) {
				flashComposerAttachErr(e instanceof Error ? e.message : String(e));
			}
			closeWorkspaceMenu();
		},
		[shell, flashComposerAttachErr, t, closeWorkspaceMenu]
	);

	const renameWorkspaceAlias = useCallback(
		(path: string, nextName?: string) => {
			const fallback = workspacePathDisplayName(path);
			const trimmed = (nextName ?? '').trim();
			setWorkspaceAliases((prev) => {
				const updated = { ...prev };
				if (!trimmed || trimmed === fallback) {
					delete updated[path];
				} else {
					updated[path] = trimmed;
				}
				return updated;
			});
			showTransientToast(
				true,
				trimmed ? t('app.workspaceRenamedToast', { name: trimmed }) : t('app.workspaceNameResetToast')
			);
		},
		[t, showTransientToast, setWorkspaceAliases]
	);

	const removeWorkspaceFromSidebar = useCallback(
		async (path: string) => {
			setWorkspaceAliases((prev) => {
				if (!(path in prev)) {
					return prev;
				}
				const updated = { ...prev };
				delete updated[path];
				return updated;
			});
			const key = normWorkspaceRootKey(path);
			setCollapsedAgentWorkspacePaths((prev) => prev.filter((item) => normWorkspaceRootKey(item) !== key));
			setHiddenAgentWorkspacePaths((prev) =>
				prev.some((item) => normWorkspaceRootKey(item) === key) ? prev : [...prev, path]
			);
			setFolderRecents((prev) => prev.filter((item) => normWorkspaceRootKey(item) !== key));
			setHomeRecents((prev) => prev.filter((item) => normWorkspaceRootKey(item) !== key));
			if (editingWorkspacePath === path) {
				setEditingWorkspacePath(null);
				setEditingWorkspaceNameDraft('');
				workspaceNameDraftRef.current = '';
			}
			if (shell) {
				try {
					await shell.invoke('workspace:removeRecent', path);
				} catch {
					/* ignore */
				}
			}
			closeWorkspaceMenu();
			showTransientToast(true, t('app.workspaceRemovedToast'));
		},
		[
			editingWorkspacePath,
			shell,
			showTransientToast,
			t,
			closeWorkspaceMenu,
			setWorkspaceAliases,
			setCollapsedAgentWorkspacePaths,
			setHiddenAgentWorkspacePaths,
			setFolderRecents,
			setHomeRecents,
		]
	);

	const beginWorkspaceAliasEdit = useCallback(
		(path: string) => {
			const fallback = workspacePathDisplayName(path);
			const currentName = workspaceAliases[path]?.trim() || fallback;
			closeWorkspaceMenu();
			setEditingWorkspacePath(path);
			setEditingWorkspaceNameDraft(currentName);
			workspaceNameDraftRef.current = currentName;
		},
		[workspaceAliases, closeWorkspaceMenu]
	);

	const cancelWorkspaceAliasEdit = useCallback(() => {
		setEditingWorkspacePath(null);
		setEditingWorkspaceNameDraft('');
		workspaceNameDraftRef.current = '';
	}, []);

	const commitWorkspaceAliasEdit = useCallback(() => {
		if (!editingWorkspacePath) {
			return;
		}
		const path = editingWorkspacePath;
		const fallback = workspacePathDisplayName(path);
		const currentName = workspaceAliases[path]?.trim() || fallback;
		const draft = workspaceNameDraftRef.current.trim();
		setEditingWorkspacePath(null);
		setEditingWorkspaceNameDraft('');
		workspaceNameDraftRef.current = '';
		if (draft === currentName) {
			return;
		}
		renameWorkspaceAlias(path, draft);
	}, [editingWorkspacePath, workspaceAliases, renameWorkspaceAlias]);

	const handleWorkspacePrimaryAction = useCallback(
		(path: string) => {
			closeWorkspaceMenu();
			toggleWorkspaceCollapsed(path);
		},
		[toggleWorkspaceCollapsed, closeWorkspaceMenu]
	);

	useLayoutEffect(() => {
		if (!editingWorkspacePath) {
			return;
		}
		const el = workspaceNameInputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, [editingWorkspacePath]);

	useEffect(() => {
		if (!workspaceMenuPath) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const node = e.target as Node;
			if (workspaceMenuRef.current?.contains(node)) {
				return;
			}
			closeWorkspaceMenu();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeWorkspaceMenu();
			}
		};
		document.addEventListener('mousedown', onDoc);
		window.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDoc);
			window.removeEventListener('keydown', onKey);
		};
	}, [workspaceMenuPath, closeWorkspaceMenu]);

	useLayoutEffect(() => {
		if (!workspaceMenuPath || !workspaceMenuAnchorRef.current) {
			return;
		}
		const updateMenuPosition = () => {
			const anchor = workspaceMenuAnchorRef.current;
			if (!anchor) {
				return;
			}
			const rect = anchor.getBoundingClientRect();
			const estimatedMenuHeight = 280;
			let top = rect.bottom + 8;
			if (top + estimatedMenuHeight > window.innerHeight - 12) {
				top = Math.max(12, rect.top - estimatedMenuHeight - 8);
			}
			setWorkspaceMenuPosition({
				top,
				left: Math.max(248, Math.min(rect.right, window.innerWidth - 16)),
			});
		};
		const scheduleUpdate = () => {
			requestAnimationFrame(updateMenuPosition);
		};
		updateMenuPosition();
		window.addEventListener('resize', scheduleUpdate);
		document.addEventListener('scroll', scheduleUpdate, true);
		const unsubLayout = window.asyncShell?.subscribeLayout?.(scheduleUpdate);
		return () => {
			window.removeEventListener('resize', scheduleUpdate);
			document.removeEventListener('scroll', scheduleUpdate, true);
			unsubLayout?.();
		};
	}, [workspaceMenuPath]);

	return {
		workspaceMenuPath,
		workspaceMenuPosition,
		workspaceMenuRef,
		workspaceMenuAnchorRef,
		editingWorkspacePath,
		editingWorkspaceNameDraft,
		setEditingWorkspaceNameDraft,
		workspaceNameDraftRef,
		workspaceNameInputRef,
		closeWorkspaceMenu,
		openWorkspaceMenu,
		revealWorkspaceInOs,
		renameWorkspaceAlias,
		removeWorkspaceFromSidebar,
		beginWorkspaceAliasEdit,
		cancelWorkspaceAliasEdit,
		commitWorkspaceAliasEdit,
		handleWorkspacePrimaryAction,
		toggleWorkspaceCollapsed,
	};
}
