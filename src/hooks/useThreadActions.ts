import {
	useCallback,
	useEffect,
	useLayoutEffect,
	startTransition,
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
} from 'react';
import { clearPersistedAgentFileChanges } from './../agentFileChangesPersist';
import { voidShellDebugLog } from '../tabCloseDebug';
import { normWorkspaceRootKey } from '../workspaceRootKey';
import type { ChatMessage, ThreadInfo } from '../threadTypes';
import type { ComposerSegment } from '../composerSegments';
import type { AgentFilePreviewState } from './useAgentFileReview';
import type { TurnTokenUsage } from '../ipcTypes';
import type { ParsedPlan } from '../planParser';

export type ThreadNavigationState = {
	history: string[];
	index: number;
};

export type UseThreadActionsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	workspace: string | null;
	currentId: string | null;
	currentIdRef: MutableRefObject<string | null>;
	awaitingReply: boolean;
	threads: ThreadInfo[];
	threadsChrono: ThreadInfo[];
	sidebarThreadsByPathKey: Record<string, ThreadInfo[]>;
	threadNavigation: ThreadNavigationState;
	setThreadNavigation: Dispatch<SetStateAction<ThreadNavigationState>>;
	skipThreadNavigationRecordRef: MutableRefObject<boolean>;
	messagesRef: MutableRefObject<ChatMessage[]>;
	messagesThreadIdRef: MutableRefObject<string | null>;
	setCurrentId: Dispatch<SetStateAction<string | null>>;
	setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
	setMessagesThreadId: Dispatch<SetStateAction<string | null>>;
	loadMessages: (
		id: string,
		onLoad?: (
			msgs: ChatMessage[],
			threadId: string,
			extra?: { teamSession?: unknown; agentSession?: unknown }
		) => void
	) => Promise<unknown>;
	refreshThreads: () => void | Promise<unknown>;
	onMessagesLoaded: (
		msgs: ChatMessage[],
		threadId: string,
		extra?: { teamSession?: unknown; agentSession?: unknown }
	) => void;
	restoreInFlightThreadUiIfNeeded: (threadId: string) => void;
	openWorkspaceByPath: (path: string) => Promise<boolean | undefined>;
	closeWorkspaceMenu: () => void;
	setHiddenAgentWorkspacePaths: Dispatch<SetStateAction<string[]>>;

	// streaming reset
	setLastTurnUsage: Dispatch<SetStateAction<TurnTokenUsage | null>>;
	setAwaitingReply: Dispatch<SetStateAction<boolean>>;
	setStreaming: Dispatch<SetStateAction<string>>;
	setStreamingThinking: Dispatch<SetStateAction<string>>;
	clearStreamingToolPreviewNow: () => void;
	resetLiveAgentBlocks: () => void;
	streamStartedAtRef: MutableRefObject<number | null>;
	firstTokenAtRef: MutableRefObject<number | null>;

	// composer reset
	setComposerSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setInlineResendSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	setResendFromUserIndex: Dispatch<SetStateAction<number | null>>;
	composerRichBottomRef: RefObject<HTMLDivElement | null>;
	composerRichHeroRef: RefObject<HTMLDivElement | null>;

	// plan reset
	setParsedPlan: Dispatch<SetStateAction<ParsedPlan | null>>;
	setPlanFilePath: Dispatch<SetStateAction<string | null>>;
	setPlanFileRelPath: Dispatch<SetStateAction<string | null>>;
	planQuestionDismissedByThreadRef: MutableRefObject<Map<string, string>>;

	// agent file preview reset
	setAgentFilePreview: Dispatch<SetStateAction<AgentFilePreviewState | null>>;

	// thread title editing
	editingThreadId: string | null;
	setEditingThreadId: Dispatch<SetStateAction<string | null>>;
	editingThreadWorkspacePath: string | null;
	setEditingThreadWorkspacePath: Dispatch<SetStateAction<string | null>>;
	setEditingThreadTitleDraft: Dispatch<SetStateAction<string>>;
	threadTitleDraftRef: MutableRefObject<string>;
	threadTitleInputRef: RefObject<HTMLInputElement | null>;

	// delete confirmation
	confirmDeleteId: string | null;
	setConfirmDeleteId: Dispatch<SetStateAction<string | null>>;
	confirmDeleteTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;

	// session clears
	clearTeamSession: (id: string) => void;
	clearAgentSession: (id: string) => void;

	// editor menu
	setEditorThreadHistoryOpen: Dispatch<SetStateAction<boolean>>;

	// shared ref to onNewThread (持有以便其他地方通过 ref 调用最新版本，例如全局快捷键)
	onNewThreadRef: MutableRefObject<() => Promise<void>>;
};

export type UseThreadActionsResult = {
	onNewThread: () => Promise<void>;
	composerInvokeNewThread: () => void;
	onNewThreadForWorkspace: (workspacePath: string) => Promise<void>;
	onSelectThread: (id: string, threadWorkspaceRoot?: string | null) => Promise<void>;
	selectThreadByHistoryIndex: (index: number) => Promise<void>;
	goToPreviousThread: () => Promise<void>;
	goToNextThread: () => Promise<void>;
	goThreadBack: () => Promise<void>;
	goThreadForward: () => Promise<void>;
	commitThreadTitleEdit: () => Promise<void>;
	cancelThreadTitleEdit: () => void;
	beginThreadTitleEdit: (t: ThreadInfo, threadListWorkspace?: string | null) => void;
	performThreadDelete: (id: string, threadWorkspaceRoot?: string | null) => Promise<void>;
	onDeleteThread: (
		e: React.MouseEvent,
		id: string,
		threadWorkspaceRoot?: string | null
	) => Promise<void>;
};

/**
 * 线程级动作集合：新建 / 选择 / 删除 / 重命名 / 历史前后跳转 / 时间序前后跳转。
 *
 * 行为与原 App.tsx 完全一致，包含：
 *  - onSelectThread 中保留 dev perf 日志（`[perf] onSelectThread: ...`）
 *  - 删除时的 confirm 二段式（首次点击进入待确认 2.5s，再次点击执行）
 *  - 标题编辑期 input 自动 focus + select
 *  - 全局 Ctrl/Cmd+N 触发 onNewThread
 *  - onNewThreadRef.current 在每次 hook 渲染同步更新，供其他通过 ref 调用的地方读取最新闭包
 */
export function useThreadActions(params: UseThreadActionsParams): UseThreadActionsResult {
	const {
		shell,
		workspace,
		currentId,
		currentIdRef,
		awaitingReply,
		threads,
		threadsChrono,
		sidebarThreadsByPathKey,
		threadNavigation,
		setThreadNavigation,
		skipThreadNavigationRecordRef,
		messagesRef,
		messagesThreadIdRef,
		setCurrentId,
		setMessages,
		setMessagesThreadId,
		loadMessages,
		refreshThreads,
		onMessagesLoaded,
		restoreInFlightThreadUiIfNeeded,
		openWorkspaceByPath,
		closeWorkspaceMenu,
		setHiddenAgentWorkspacePaths,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		streamStartedAtRef,
		firstTokenAtRef,
		setComposerSegments,
		setInlineResendSegments,
		setResendFromUserIndex,
		composerRichBottomRef,
		composerRichHeroRef,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		planQuestionDismissedByThreadRef,
		setAgentFilePreview,
		editingThreadId,
		setEditingThreadId,
		editingThreadWorkspacePath,
		setEditingThreadWorkspacePath,
		setEditingThreadTitleDraft,
		threadTitleDraftRef,
		threadTitleInputRef,
		confirmDeleteId,
		setConfirmDeleteId,
		confirmDeleteTimerRef,
		clearTeamSession,
		clearAgentSession,
		setEditorThreadHistoryOpen,
		onNewThreadRef,
	} = params;

	const onNewThread = useCallback(async () => {
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('threads:create')) as { id: string };
		await refreshThreads();
		setCurrentId(r.id);
		setLastTurnUsage(null);
		setAwaitingReply(false);
		setStreaming('');
		setStreamingThinking('');
		clearStreamingToolPreviewNow();
		resetLiveAgentBlocks();
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		setParsedPlan(null);
		setPlanFilePath(null);
		setPlanFileRelPath(null);
		await loadMessages(r.id);
		setComposerSegments([]);
		setInlineResendSegments([]);
		setResendFromUserIndex(null);
		queueMicrotask(() => {
			if (composerRichBottomRef.current) {
				composerRichBottomRef.current.focus();
			} else {
				composerRichHeroRef.current?.focus();
			}
		});
	}, [
		shell,
		refreshThreads,
		setCurrentId,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		loadMessages,
		setComposerSegments,
		setInlineResendSegments,
		setResendFromUserIndex,
		composerRichBottomRef,
		composerRichHeroRef,
		streamStartedAtRef,
		firstTokenAtRef,
	]);

	onNewThreadRef.current = onNewThread;

	const composerInvokeNewThread = useCallback(() => {
		void onNewThreadRef.current();
	}, [onNewThreadRef]);

	const onNewThreadForWorkspace = useCallback(
		async (workspacePath: string) => {
			closeWorkspaceMenu();
			if (!workspacePath) {
				return;
			}
			if (workspacePath !== workspace) {
				setHiddenAgentWorkspacePaths((prev) => prev.filter((item) => item !== workspacePath));
				const opened = await openWorkspaceByPath(workspacePath);
				if (!opened) {
					return;
				}
			}
			await onNewThreadRef.current();
		},
		[workspace, openWorkspaceByPath, closeWorkspaceMenu, setHiddenAgentWorkspacePaths, onNewThreadRef]
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
				e.preventDefault();
				void onNewThreadRef.current();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onNewThreadRef]);

	const onSelectThread = useCallback(
		async (id: string, threadWorkspaceRoot?: string | null) => {
			const dev = import.meta.env.DEV;
			const t0 = dev ? performance.now() : 0;
			if (dev) {
				console.log(`[perf] onSelectThread called: id=${id}`);
			}
			setEditorThreadHistoryOpen(false);
			if (!shell) {
				return;
			}
			const tw = threadWorkspaceRoot?.trim();
			if (tw && (!workspace || normWorkspaceRootKey(tw) !== normWorkspaceRootKey(workspace))) {
				const opened = await openWorkspaceByPath(tw);
				if (!opened) {
					return;
				}
			}
			const tSelectIpcStart = dev ? performance.now() : 0;
			if (dev) {
				console.log(`[perf] onSelectThread: pre-select Δ=${(tSelectIpcStart - t0).toFixed(1)}ms`);
			}
			const alreadyCurrentThread = currentIdRef.current === id;
			if (!alreadyCurrentThread) {
				await shell.invoke('threads:select', id);
			} else if (dev) {
				console.log(`[perf] onSelectThread: skip threads:select (renderer already currentId=${id})`);
			}
			const tAfterSelectIpc = dev ? performance.now() : 0;
			if (dev) {
				if (alreadyCurrentThread) {
					console.log(`[perf] onSelectThread: threads:select skipped`);
				} else {
					console.log(
						`[perf] onSelectThread: threads:select ipc=${(tAfterSelectIpc - tSelectIpcStart).toFixed(1)}ms`
					);
				}
			}

			// 已展示该线程则跳过 IPC（须在 reset 之前读 ref，且勿用会被 reset 破坏的依赖）
			const skipReloadSameThread =
				messagesThreadIdRef.current === id ||
				(currentIdRef.current === id && messagesRef.current.length > 0);

			if (dev) {
				console.log(`[perf] onSelectThread: setting states for ${id}`);
			}
			setCurrentId(id);

			if (skipReloadSameThread) {
				// 消息已在内存：流式/plan/预览等非紧急状态用 transition，避免与已有 Markdown 长任务叠成单帧巨型 commit
				startTransition(() => {
					setAwaitingReply(false);
					setStreaming('');
					setStreamingThinking('');
					clearStreamingToolPreviewNow();
					resetLiveAgentBlocks();
					streamStartedAtRef.current = null;
					firstTokenAtRef.current = null;
					setParsedPlan(null);
					setPlanFilePath(null);
					setPlanFileRelPath(null);
					setAgentFilePreview(null);
				});
				setResendFromUserIndex(null);
				setComposerSegments([]);
				setInlineResendSegments([]);
			} else {
				setAwaitingReply(false);
				setStreaming('');
				setStreamingThinking('');
				clearStreamingToolPreviewNow();
				resetLiveAgentBlocks();
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
				setParsedPlan(null);
				setPlanFilePath(null);
				setPlanFileRelPath(null);
				setResendFromUserIndex(null);
				setComposerSegments([]);
				setInlineResendSegments([]);
				setAgentFilePreview(null);
			}
			const tAfterResetStates = dev ? performance.now() : 0;
			if (dev) {
				console.log(
					`[perf] onSelectThread: resetStates sync=${(tAfterResetStates - tAfterSelectIpc).toFixed(1)}ms after select-ipc`
				);
			}

			if (skipReloadSameThread) {
				if (dev) {
					console.log(`[perf] onSelectThread: skip loadMessages (already showing thread ${id})`);
				}
			} else {
				if (dev) {
					console.log(`[perf] onSelectThread: calling loadMessages for ${id}`);
				}
				await loadMessages(id, onMessagesLoaded);
			}
			restoreInFlightThreadUiIfNeeded(id);

			if (dev) {
				const tAfterLoad = performance.now();
				console.log(
					`[perf] onSelectThread: after loadMessages await Δ=${(tAfterLoad - tAfterResetStates).toFixed(1)}ms (from post-reset)`
				);
				console.log(`[perf] onSelectThread: completed for ${id} in ${(tAfterLoad - t0).toFixed(1)}ms total`);
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						console.log(
							`[perf] onSelectThread: toPaint Δ=${(performance.now() - t0).toFixed(1)}ms from handler start (≈after frame)`
						);
					});
				});
			}
		},
		[
			shell,
			workspace,
			openWorkspaceByPath,
			loadMessages,
			onMessagesLoaded,
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
			setAgentFilePreview,
			restoreInFlightThreadUiIfNeeded,
			currentIdRef,
			messagesRef,
			messagesThreadIdRef,
			setEditorThreadHistoryOpen,
			setCurrentId,
			setAwaitingReply,
			setStreaming,
			setStreamingThinking,
			streamStartedAtRef,
			firstTokenAtRef,
			setParsedPlan,
			setPlanFilePath,
			setPlanFileRelPath,
			setResendFromUserIndex,
			setComposerSegments,
			setInlineResendSegments,
		]
	);

	const selectThreadByHistoryIndex = useCallback(
		async (index: number) => {
			const id = threadNavigation.history[index];
			if (!id || id === currentId) {
				return;
			}
			skipThreadNavigationRecordRef.current = true;
			setThreadNavigation((prev) => ({ ...prev, index }));
			await onSelectThread(id);
		},
		[
			threadNavigation.history,
			currentId,
			onSelectThread,
			setThreadNavigation,
			skipThreadNavigationRecordRef,
		]
	);

	const goToPreviousThread = useCallback(async () => {
		if (!currentId) {
			return;
		}
		const index = threadsChrono.findIndex((thread) => thread.id === currentId);
		if (index < 0 || index >= threadsChrono.length - 1) {
			return;
		}
		await onSelectThread(threadsChrono[index + 1]!.id);
	}, [currentId, threadsChrono, onSelectThread]);

	const goToNextThread = useCallback(async () => {
		if (!currentId) {
			return;
		}
		const index = threadsChrono.findIndex((thread) => thread.id === currentId);
		if (index <= 0) {
			return;
		}
		await onSelectThread(threadsChrono[index - 1]!.id);
	}, [currentId, threadsChrono, onSelectThread]);

	const goThreadBack = useCallback(async () => {
		if (threadNavigation.index <= 0) {
			return;
		}
		await selectThreadByHistoryIndex(threadNavigation.index - 1);
	}, [threadNavigation.index, selectThreadByHistoryIndex]);

	const goThreadForward = useCallback(async () => {
		if (threadNavigation.index < 0 || threadNavigation.index >= threadNavigation.history.length - 1) {
			return;
		}
		await selectThreadByHistoryIndex(threadNavigation.index + 1);
	}, [threadNavigation.index, threadNavigation.history.length, selectThreadByHistoryIndex]);

	const commitThreadTitleEdit = useCallback(async () => {
		if (!editingThreadId) {
			return;
		}
		if (!shell) {
			setEditingThreadId(null);
			setEditingThreadWorkspacePath(null);
			setEditingThreadTitleDraft('');
			return;
		}
		const id = editingThreadId;
		const scopePath = editingThreadWorkspacePath;
		const draft = threadTitleDraftRef.current.trim();
		const scopeKey = normWorkspaceRootKey(scopePath ?? workspace ?? '');
		const sameBucketAsPrimary =
			!!workspace && !!scopePath && normWorkspaceRootKey(workspace) === normWorkspaceRootKey(scopePath);
		const prev = sameBucketAsPrimary
			? threads.find((x) => x.id === id)?.title ?? ''
			: (sidebarThreadsByPathKey[scopeKey] ?? []).find((x) => x.id === id)?.title ?? '';
		setEditingThreadId(null);
		setEditingThreadWorkspacePath(null);
		setEditingThreadTitleDraft('');
		if (!draft || draft === prev) {
			return;
		}
		const r = (await shell.invoke('threads:rename', id, draft, scopePath ?? undefined)) as {
			ok?: boolean;
		};
		if (r?.ok) {
			await refreshThreads();
		}
	}, [
		shell,
		editingThreadId,
		editingThreadWorkspacePath,
		workspace,
		threads,
		sidebarThreadsByPathKey,
		refreshThreads,
		setEditingThreadId,
		setEditingThreadWorkspacePath,
		setEditingThreadTitleDraft,
		threadTitleDraftRef,
	]);

	const cancelThreadTitleEdit = useCallback(() => {
		setEditingThreadId(null);
		setEditingThreadWorkspacePath(null);
		setEditingThreadTitleDraft('');
	}, [setEditingThreadId, setEditingThreadWorkspacePath, setEditingThreadTitleDraft]);

	const beginThreadTitleEdit = useCallback(
		(t: ThreadInfo, threadListWorkspace?: string | null) => {
			setEditingThreadId(t.id);
			setEditingThreadWorkspacePath(threadListWorkspace ?? workspace);
			setEditingThreadTitleDraft(t.title);
			threadTitleDraftRef.current = t.title;
		},
		[
			workspace,
			setEditingThreadId,
			setEditingThreadWorkspacePath,
			setEditingThreadTitleDraft,
			threadTitleDraftRef,
		]
	);

	const performThreadDelete = useCallback(
		async (id: string, threadWorkspaceRoot?: string | null) => {
			if (!shell) {
				return;
			}
			voidShellDebugLog('thread-delete:perform', { threadId: id });
			const wasCurrent =
				id === currentId &&
				(!threadWorkspaceRoot ||
					!workspace ||
					normWorkspaceRootKey(threadWorkspaceRoot) === normWorkspaceRootKey(workspace));
			if (wasCurrent && awaitingReply) {
				await shell.invoke('chat:abort', id);
				setAwaitingReply(false);
				setStreaming('');
				setStreamingThinking('');
				clearStreamingToolPreviewNow();
				resetLiveAgentBlocks();
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
			}
			const wasEditingTitle = editingThreadId === id;
			setEditingThreadId((ed) => (ed === id ? null : ed));
			if (wasEditingTitle) {
				setEditingThreadWorkspacePath(null);
			}
			if (wasCurrent) {
				setMessages([]);
				setMessagesThreadId(null);
				setStreaming('');
				resetLiveAgentBlocks();
				setComposerSegments([]);
				setInlineResendSegments([]);
				setResendFromUserIndex(null);
			}
			await shell.invoke('threads:delete', id, threadWorkspaceRoot ?? undefined);
			clearPersistedAgentFileChanges(id);
			clearTeamSession(id);
			clearAgentSession(id);
			planQuestionDismissedByThreadRef.current.delete(id);
			await refreshThreads();
		},
		[
			shell,
			currentId,
			editingThreadId,
			awaitingReply,
			refreshThreads,
			workspace,
			clearTeamSession,
			clearAgentSession,
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
			setAwaitingReply,
			setStreaming,
			setStreamingThinking,
			streamStartedAtRef,
			firstTokenAtRef,
			setEditingThreadId,
			setEditingThreadWorkspacePath,
			setMessages,
			setMessagesThreadId,
			setComposerSegments,
			setInlineResendSegments,
			setResendFromUserIndex,
			planQuestionDismissedByThreadRef,
		]
	);

	const onDeleteThread = useCallback(
		async (e: React.MouseEvent, id: string, threadWorkspaceRoot?: string | null) => {
			e.preventDefault();
			e.stopPropagation();
			voidShellDebugLog('thread-delete:left-list-click', {
				threadId: id,
				step: confirmDeleteId === id ? 'confirm' : 'arm',
			});
			if (!shell) {
				return;
			}
			if (confirmDeleteId !== id) {
				setConfirmDeleteId(id);
				if (confirmDeleteTimerRef.current) {
					clearTimeout(confirmDeleteTimerRef.current);
				}
				confirmDeleteTimerRef.current = setTimeout(() => {
					setConfirmDeleteId(null);
					confirmDeleteTimerRef.current = null;
				}, 2500);
				return;
			}
			setConfirmDeleteId(null);
			if (confirmDeleteTimerRef.current) {
				clearTimeout(confirmDeleteTimerRef.current);
				confirmDeleteTimerRef.current = null;
			}
			await performThreadDelete(id, threadWorkspaceRoot);
		},
		[shell, confirmDeleteId, performThreadDelete, setConfirmDeleteId, confirmDeleteTimerRef]
	);

	useLayoutEffect(() => {
		if (!editingThreadId) {
			return;
		}
		const el = threadTitleInputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, [editingThreadId, threadTitleInputRef]);

	return {
		onNewThread,
		composerInvokeNewThread,
		onNewThreadForWorkspace,
		onSelectThread,
		selectThreadByHistoryIndex,
		goToPreviousThread,
		goToNextThread,
		goThreadBack,
		goThreadForward,
		commitThreadTitleEdit,
		cancelThreadTitleEdit,
		beginThreadTitleEdit,
		performThreadDelete,
		onDeleteThread,
	};
}
