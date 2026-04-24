import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { tabIdFromPath, type EditorTab } from '../EditorTabBar';
import { initialMarkdownViewForTab } from '../editorMarkdownView';
import { deriveOriginalContentFromUnifiedDiff } from '../editorInlineDiff';
import { normalizeWorkspaceRelPath, workspaceRelPathsEqual } from '../agentFileChangesFromGit';
import { voidShellDebugLog } from '../tabCloseDebug';
import type { TFunction } from '../i18n';
import {
	type EditorInlineDiffState,
	type EditorPtySession,
} from './useEditorTabs';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';

export type AgentConversationFileOpenOptions = {
	diff?: string | null;
	allowReviewActions?: boolean;
};

type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

export type UseFileOperationsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	t: TFunction;
	workspace: string | null;
	layoutMode: ShellLayoutMode;
	setLayoutMode: (mode: ShellLayoutMode) => void;
	currentId: string | null;
	gitChangedPaths: string[];
	gitStatusOk: boolean;
	refreshGit: () => void | Promise<unknown>;
	refreshThreads: () => void | Promise<unknown>;
	clearWorkspaceConversationState: () => void;
	setWorkspace: Dispatch<SetStateAction<string | null>>;
	setWorkspacePickerOpen: (open: boolean) => void;
	applyWorkspacePath: (path: string) => Promise<void>;

	openTabs: EditorTab[];
	setOpenTabs: Dispatch<SetStateAction<EditorTab[]>>;
	activeTabId: string | null;
	setActiveTabId: (id: string | null) => void;
	filePath: string;
	setFilePath: (path: string) => void;
	editorValue: string;
	setEditorValue: Dispatch<SetStateAction<string>>;
	setEditorInlineDiffByPath: Dispatch<SetStateAction<Record<string, EditorInlineDiffState>>>;
	setSaveToastKey: Dispatch<SetStateAction<number>>;
	setSaveToastVisible: (visible: boolean) => void;
	editorLoadRequestRef: MutableRefObject<number>;
	pendingEditorHighlightRangeRef: MutableRefObject<{ start: number; end: number } | null>;
	editorTerminalCreateLockRef: MutableRefObject<boolean>;
	setEditorTerminalSessions: Dispatch<SetStateAction<EditorPtySession[]>>;
	setActiveEditorTerminalId: (id: string | null) => void;
	setEditorTerminalVisible: (visible: boolean) => void;
	/** 与桌面「终端」菜单联动：新建终端时关闭下拉 */
	setTerminalMenuOpen: (open: boolean) => void;
};

export function useFileOperations(p: UseFileOperationsParams) {
	const {
		shell,
		t,
		workspace,
		layoutMode,
		setLayoutMode,
		currentId,
		gitChangedPaths,
		gitStatusOk,
		refreshGit,
		refreshThreads,
		clearWorkspaceConversationState,
		setWorkspace,
		setWorkspacePickerOpen,
		applyWorkspacePath,
		openTabs,
		setOpenTabs,
		activeTabId,
		setActiveTabId,
		filePath,
		setFilePath,
		editorValue,
		setEditorValue,
		setEditorInlineDiffByPath,
		setSaveToastKey,
		setSaveToastVisible,
		editorLoadRequestRef,
		pendingEditorHighlightRangeRef,
		editorTerminalCreateLockRef,
		setEditorTerminalSessions,
		setActiveEditorTerminalId,
		setEditorTerminalVisible,
		setTerminalMenuOpen,
	} = p;

	const setEditorInlineDiffState = useCallback(
		(relPath: string, state: EditorInlineDiffState | null) => {
			const normalizedRel = normalizeWorkspaceRelPath(relPath);
			setEditorInlineDiffByPath((prev) => {
				if (!state) {
					if (!(normalizedRel in prev)) {
						return prev;
					}
					const next = { ...prev };
					delete next[normalizedRel];
					return next;
				}
				return {
					...prev,
					[normalizedRel]: {
						...state,
						filePath: normalizedRel,
					},
				};
			});
		},
		[setEditorInlineDiffByPath]
	);

	const resolveEditorInlineDiff = useCallback(
		async (
			relPath: string,
			content: string,
			revealLine?: number,
			revealEndLine?: number,
			options?: AgentConversationFileOpenOptions
		): Promise<EditorInlineDiffState | null> => {
			if (!shell) {
				return null;
			}
			const normalizedRel = normalizeWorkspaceRelPath(relPath);
			const safeRevealLine =
				typeof revealLine === 'number' && Number.isFinite(revealLine) && revealLine > 0
					? Math.floor(revealLine)
					: undefined;
			const safeRevealEndLine =
				typeof revealEndLine === 'number' && Number.isFinite(revealEndLine) && revealEndLine > 0
					? Math.floor(revealEndLine)
					: undefined;
			const sourceDiff = typeof options?.diff === 'string' ? options.diff.trim() : '';
			const sourceAllowsReviewActions = options?.allowReviewActions === true;
			const isGitChanged = gitChangedPaths.some((path) => workspaceRelPathsEqual(path, normalizedRel));

			let previewDiff = sourceDiff;
			let originalContent = previewDiff ? await deriveOriginalContentFromUnifiedDiff(content, previewDiff) : null;
			let reviewMode: EditorInlineDiffState['reviewMode'] = 'readonly';

			if (currentId && sourceAllowsReviewActions) {
				try {
					const snapshotResult = (await shell.invoke('agent:getFileSnapshot', currentId, normalizedRel)) as
						| { ok: true; hasSnapshot: false }
						| { ok: true; hasSnapshot: true; previousContent: string | null }
						| { ok?: false };
					if (snapshotResult?.ok && snapshotResult.hasSnapshot) {
						originalContent = snapshotResult.previousContent ?? '';
						const { createTwoFilesPatch } = await import('diff');
						previewDiff = createTwoFilesPatch(
							snapshotResult.previousContent === null ? '/dev/null' : `a/${normalizedRel}`,
							`b/${normalizedRel}`,
							originalContent,
							content,
							'',
							'',
							{ context: 3 }
						).trim();
						reviewMode = 'snapshot';
					}
				} catch {
					/* ignore */
				}
			}

			if ((!previewDiff || !originalContent) && gitStatusOk && isGitChanged) {
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as
						| { ok: true; preview: DiffPreview }
						| { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview && !fullDiffResult.preview.isBinary) {
						const gitPreviewDiff = String(fullDiffResult.preview.diff ?? '').trim();
						if (gitPreviewDiff) {
							const gitOriginal = await deriveOriginalContentFromUnifiedDiff(content, gitPreviewDiff);
							if (gitOriginal !== null) {
								previewDiff = gitPreviewDiff;
								originalContent = gitOriginal;
								reviewMode = 'readonly';
							}
						}
					}
				} catch {
					/* ignore */
				}
			}

			if (!previewDiff || originalContent === null) {
				return null;
			}

			return {
				filePath: normalizedRel,
				originalContent,
				diff: previewDiff,
				revealLine: safeRevealLine,
				revealEndLine: safeRevealEndLine,
				reviewMode,
			};
		},
		[currentId, gitChangedPaths, gitStatusOk, shell]
	);

	const loadFileIntoEditor = useCallback(
		async (
			relPath: string,
			revealLine?: number,
			revealEndLine?: number,
			options?: AgentConversationFileOpenOptions
		) => {
			if (!shell) {
				return;
			}
			const requestId = ++editorLoadRequestRef.current;
			const normalizedRel = normalizeWorkspaceRelPath(relPath);
			try {
				const r = (await shell.invoke('fs:readFile', normalizedRel)) as { ok: boolean; content?: string };
				if (requestId !== editorLoadRequestRef.current) {
					return;
				}
				if (r.ok && r.content !== undefined) {
					setEditorValue(r.content);
					const inlineDiff = await resolveEditorInlineDiff(
						normalizedRel,
						r.content,
						revealLine,
						revealEndLine,
						options
					);
					if (requestId !== editorLoadRequestRef.current) {
						return;
					}
					setEditorInlineDiffState(normalizedRel, inlineDiff);
				} else {
					setEditorValue('');
					setEditorInlineDiffState(normalizedRel, null);
				}
			} catch (err) {
				if (requestId !== editorLoadRequestRef.current) {
					return;
				}
				setEditorValue(t('app.readFileFailed', { detail: String(err) }));
				setEditorInlineDiffState(normalizedRel, null);
			}
		},
		[resolveEditorInlineDiff, setEditorInlineDiffState, shell, t, editorLoadRequestRef, setEditorValue]
	);

	const onLoadFile = useCallback(async () => {
		if (!shell || !filePath.trim()) {
			return;
		}
		try {
			const r = (await shell.invoke('fs:readFile', filePath.trim())) as { ok: boolean; content?: string };
			if (r.ok && r.content !== undefined) {
				setEditorValue(r.content);
				const inlineDiff = await resolveEditorInlineDiff(filePath.trim(), r.content);
				setEditorInlineDiffState(filePath.trim(), inlineDiff);
			}
		} catch (e) {
			setEditorValue(t('app.readFileFailed', { detail: String(e) }));
			setEditorInlineDiffState(filePath.trim(), null);
		}
	}, [shell, filePath, resolveEditorInlineDiff, setEditorInlineDiffState, setEditorValue, t]);

	const onSaveFile = useCallback(async () => {
		if (!shell || !filePath.trim()) {
			return;
		}
		await shell.invoke('fs:writeFile', filePath.trim(), editorValue);
		setOpenTabs((prev) => prev.map((tab) => (tab.filePath === filePath.trim() ? { ...tab, dirty: false } : tab)));
		setSaveToastKey((k) => k + 1);
		setSaveToastVisible(true);
		setTimeout(() => setSaveToastVisible(false), 1900);
		await refreshGit();
		const inlineDiff = await resolveEditorInlineDiff(filePath.trim(), editorValue);
		setEditorInlineDiffState(filePath.trim(), inlineDiff);
	}, [
		shell,
		filePath,
		editorValue,
		setOpenTabs,
		setSaveToastKey,
		setSaveToastVisible,
		refreshGit,
		resolveEditorInlineDiff,
		setEditorInlineDiffState,
	]);

	const openFileInTab = useCallback(
		async (
			rel: string,
			revealLine?: number,
			revealEndLine?: number,
			opts?: { background?: boolean } & AgentConversationFileOpenOptions
		) => {
			if (!shell) return;
			const tid = tabIdFromPath(rel);
			const background = opts?.background === true;
			setOpenTabs((prev) => {
				if (prev.some((t2) => t2.id === tid)) {
					return prev;
				}
				const mdView = initialMarkdownViewForTab(rel);
				return [
					...prev,
					{
						id: tid,
						filePath: rel,
						dirty: false,
						...(mdView != null ? { markdownView: mdView } : {}),
					},
				];
			});
			if (background) {
				return;
			}
			setActiveTabId(tid);
			setFilePath(rel);
			if (layoutMode === 'agent') {
				setLayoutMode('editor');
			}
			const s =
				typeof revealLine === 'number' && Number.isFinite(revealLine) && revealLine > 0
					? Math.floor(revealLine)
					: null;
			const e =
				typeof revealEndLine === 'number' && Number.isFinite(revealEndLine) && revealEndLine > 0
					? Math.floor(revealEndLine)
					: null;
			if (s != null) {
				const hi = e != null && e > 0 ? e : s;
				pendingEditorHighlightRangeRef.current = {
					start: Math.min(s, hi),
					end: Math.max(s, hi),
				};
			} else {
				pendingEditorHighlightRangeRef.current = null;
			}
			try {
				await loadFileIntoEditor(rel, revealLine, revealEndLine, opts);
			} catch (err) {
				setEditorValue(t('app.readFileFailed', { detail: String(err) }));
				setEditorInlineDiffState(rel, null);
			}
		},
		[
			layoutMode,
			loadFileIntoEditor,
			setEditorInlineDiffState,
			shell,
			t,
			setOpenTabs,
			setActiveTabId,
			setFilePath,
			setLayoutMode,
			pendingEditorHighlightRangeRef,
			setEditorValue,
		]
	);

	const onCloseTab = useCallback(
		(tabId: string) => {
			voidShellDebugLog('editor-file-tab-close', {
				tabId,
				activeTabId,
				openTabIds: openTabs.map((t2) => t2.id),
			});
			const idx = openTabs.findIndex((t2) => t2.id === tabId);
			if (idx < 0) {
				voidShellDebugLog('editor-file-tab-close-miss', { tabId, activeTabId });
				return;
			}
			const nextTabs = openTabs.filter((t2) => t2.id !== tabId);
			setOpenTabs(nextTabs);
			setEditorInlineDiffState(tabId.replace(/^tab:/, ''), null);

			if (tabId !== activeTabId) {
				return;
			}
			const newActive = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
			setActiveTabId(newActive?.id ?? null);
			if (newActive) {
				setFilePath(newActive.filePath);
				void loadFileIntoEditor(newActive.filePath);
			} else {
				setFilePath('');
				setEditorValue('');
			}
		},
		[openTabs, activeTabId, loadFileIntoEditor, setEditorInlineDiffState, setOpenTabs, setActiveTabId, setFilePath, setEditorValue]
	);

	const onSelectTab = useCallback(
		async (tabId: string) => {
			setActiveTabId(tabId);
			const tab = openTabs.find((t2) => t2.id === tabId);
			if (tab) {
				setFilePath(tab.filePath);
				pendingEditorHighlightRangeRef.current = null;
				void loadFileIntoEditor(tab.filePath);
			}
		},
		[openTabs, loadFileIntoEditor, setActiveTabId, setFilePath, pendingEditorHighlightRangeRef]
	);

	const appendEditorTerminal = useCallback(
		async (opts?: { cwdRel?: string }) => {
			if (editorTerminalCreateLockRef.current || !shell) {
				return;
			}
			editorTerminalCreateLockRef.current = true;
			try {
				const r = (await shell.invoke(
					'term:sessionCreate',
					opts?.cwdRel != null && opts.cwdRel !== '' ? { cwd: opts.cwdRel } : undefined
				)) as {
					ok: boolean;
					session?: { id: string };
					error?: string;
				};
				if (!r.ok || !r.session?.id) {
					return;
				}
				setEditorTerminalSessions((prev) => {
					const n = prev.length + 1;
					return [...prev, { id: r.session!.id, title: t('app.terminalTabN', { n: String(n) }) }];
				});
				setActiveEditorTerminalId(r.session.id);
			} finally {
				editorTerminalCreateLockRef.current = false;
			}
		},
		[shell, t, editorTerminalCreateLockRef, setEditorTerminalSessions, setActiveEditorTerminalId]
	);

	const closeEditorTerminalPanel = useCallback(() => {
		setEditorTerminalSessions((prev) => {
			for (const s of prev) {
				void shell?.invoke('term:sessionKill', s.id);
			}
			return [];
		});
		setActiveEditorTerminalId(null);
		setEditorTerminalVisible(false);
	}, [shell, setEditorTerminalSessions, setActiveEditorTerminalId, setEditorTerminalVisible]);

	const closeWorkspaceFolder = useCallback(async () => {
		if (!shell) {
			setWorkspacePickerOpen(true);
			return;
		}
		await shell.invoke('workspace:closeFolder');
		clearWorkspaceConversationState();
		closeEditorTerminalPanel();
		setWorkspace(null);
		setOpenTabs([]);
		setActiveTabId(null);
		setFilePath('');
		setEditorValue('');
		pendingEditorHighlightRangeRef.current = null;
		await refreshThreads();
		await refreshGit();
	}, [
		shell,
		clearWorkspaceConversationState,
		closeEditorTerminalPanel,
		refreshThreads,
		refreshGit,
		setWorkspace,
		setWorkspacePickerOpen,
		setOpenTabs,
		setActiveTabId,
		setFilePath,
		setEditorValue,
		pendingEditorHighlightRangeRef,
	]);

	const fileMenuNewFile = useCallback(async () => {
		if (!shell || !workspace) {
			return;
		}
		const r = (await shell.invoke('fs:pickSaveFile', {
			defaultName: 'Untitled.txt',
			title: t('app.fileMenu.newFileSaveTitle'),
		})) as { ok?: boolean; relPath?: string };
		if (!r?.ok || !r.relPath) {
			return;
		}
		await shell.invoke('fs:writeFile', r.relPath, '');
		await openFileInTab(r.relPath);
	}, [shell, workspace, t, openFileInTab]);

	const fileMenuOpenFile = useCallback(async () => {
		if (!shell || !workspace) {
			return;
		}
		const r = (await shell.invoke('fs:pickOpenFile')) as { ok?: boolean; relPath?: string };
		if (r?.ok && r.relPath) {
			await openFileInTab(r.relPath);
		}
	}, [shell, workspace, openFileInTab]);

	const fileMenuOpenFolder = useCallback(async () => {
		if (!shell) {
			setWorkspacePickerOpen(true);
			return;
		}
		const r = (await shell.invoke('workspace:pickFolder')) as { ok?: boolean; path?: string };
		if (r?.ok && r.path) {
			await applyWorkspacePath(r.path);
		}
	}, [shell, applyWorkspacePath, setWorkspacePickerOpen]);

	const fileMenuSaveAs = useCallback(async () => {
		if (!shell || !workspace) {
			return;
		}
		const defaultName = filePath.trim()
			? (filePath.trim().split(/[/\\]/).pop() ?? 'Untitled.txt')
			: 'Untitled.txt';
		const r = (await shell.invoke('fs:pickSaveFile', {
			defaultName,
			title: t('app.fileMenu.saveAsDialogTitle'),
		})) as { ok?: boolean; relPath?: string };
		if (!r?.ok || !r.relPath) {
			return;
		}
		const savedRel = r.relPath;
		await shell.invoke('fs:writeFile', savedRel, editorValue);
		const newTid = tabIdFromPath(savedRel);
		const mdViewSaveAs = initialMarkdownViewForTab(savedRel);
		setOpenTabs((prev) => {
			const idx = activeTabId
				? prev.findIndex((t2) => t2.id === activeTabId)
				: filePath.trim()
					? prev.findIndex((t2) => t2.filePath === filePath.trim())
					: -1;
			if (idx >= 0) {
				const next = [...prev];
				next[idx] = {
					id: newTid,
					filePath: savedRel,
					dirty: false,
					...(mdViewSaveAs != null ? { markdownView: mdViewSaveAs } : {}),
				};
				return next;
			}
			return [
				...prev,
				{
					id: newTid,
					filePath: savedRel,
					dirty: false,
					...(mdViewSaveAs != null ? { markdownView: mdViewSaveAs } : {}),
				},
			];
		});
		setActiveTabId(newTid);
		setFilePath(savedRel);
		setSaveToastKey((k) => k + 1);
		setSaveToastVisible(true);
		setTimeout(() => setSaveToastVisible(false), 1900);
		await refreshGit();
	}, [
		shell,
		workspace,
		filePath,
		editorValue,
		activeTabId,
		t,
		refreshGit,
		setOpenTabs,
		setActiveTabId,
		setFilePath,
		setSaveToastKey,
		setSaveToastVisible,
	]);

	const fileMenuRevertFile = useCallback(async () => {
		if (!shell || !filePath.trim()) {
			return;
		}
		try {
			const r = (await shell.invoke('fs:readFile', filePath.trim())) as { ok?: boolean; content?: string };
			if (r?.ok && r.content !== undefined) {
				setEditorValue(r.content);
				const p = filePath.trim();
				setOpenTabs((prev) => prev.map((tab) => (tab.filePath === p ? { ...tab, dirty: false } : tab)));
			}
		} catch {
			/* ignore */
		}
	}, [shell, filePath, setEditorValue, setOpenTabs]);

	const fileMenuCloseEditor = useCallback(() => {
		if (activeTabId) {
			onCloseTab(activeTabId);
		}
	}, [activeTabId, onCloseTab]);

	const fileMenuNewWindow = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:newWindow');
	}, [shell]);

	const fileMenuNewEditorWindow = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:newEditorWindow');
	}, [shell]);

	const fileMenuQuit = useCallback(async () => {
		if (shell) {
			await shell.invoke('app:quit');
		} else {
			window.close();
		}
	}, [shell]);

	const closeEditorTerminalSession = useCallback(
		(id: string) => {
			void shell?.invoke('term:sessionKill', id);
			setEditorTerminalSessions((prev) => {
				const next = prev.filter((s) => s.id !== id);
				if (next.length === 0) {
					setEditorTerminalVisible(false);
				}
				return next;
			});
		},
		[shell, setEditorTerminalSessions, setEditorTerminalVisible]
	);

	const spawnEditorTerminal = useCallback(() => {
		setEditorTerminalVisible(true);
		setTerminalMenuOpen(false);
		void appendEditorTerminal();
	}, [appendEditorTerminal, setEditorTerminalVisible, setTerminalMenuOpen]);

	return {
		setEditorInlineDiffState,
		resolveEditorInlineDiff,
		loadFileIntoEditor,
		onLoadFile,
		onSaveFile,
		openFileInTab,
		onCloseTab,
		onSelectTab,
		appendEditorTerminal,
		closeEditorTerminalPanel,
		closeWorkspaceFolder,
		fileMenuNewFile,
		fileMenuOpenFile,
		fileMenuOpenFolder,
		fileMenuSaveAs,
		fileMenuRevertFile,
		fileMenuCloseEditor,
		fileMenuNewWindow,
		fileMenuNewEditorWindow,
		fileMenuQuit,
		closeEditorTerminalSession,
		spawnEditorTerminal,
	};
}
