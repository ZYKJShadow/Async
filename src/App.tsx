import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
	memo,
	type RefObject,
} from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';

import { ChatMarkdown } from './ChatMarkdown';
import {
	type AgentPendingPatch,
	type ChatPlanExecutePayload,
	type TurnTokenUsage,
} from './ipcTypes';
import { buildAgentFilePreviewHunks } from './agentFilePreviewDiff';
import { agentChangeKeyFromDiff, countDiffAddDel } from './agentChatSegments';
import {
	clearPersistedAgentFileChanges,
	hashAgentAssistantContent,
	readPersistedAgentFileChanges,
} from './agentFileChangesPersist';
import { normalizeWorkspaceRelPath, workspaceRelPathsEqual } from './agentFileChangesFromGit';
import { ALL_SETTINGS_NAV_IDS, type SettingsNavId, type SettingsPageProps } from './SettingsPage';
import { normalizeAppearanceSettings } from './appearanceSettings';
import {
	readPrefersDark,
	readStoredColorMode,
	resolveEffectiveScheme,
	writeStoredColorMode,
} from './colorMode';
import { type InitialWindowThemeSnapshot } from './initialWindowTheme';
// modelCatalog types are re-exported via useSettings hook return type
import { type ComposerMode } from './ComposerPlusMenu';
import {
	pendingPlanQuestionFromMessages,
	parsePlanDocument,
	toPlanMd,
} from './planParser';
import {
	CREATE_SKILL_SLUG,
	getLeadingWizardCommand,
	newSegmentId,
	segmentsToWireText,
	segmentsTrimmedEmpty,
	userMessageToSegments,
} from './composerSegments';
import { partsToSegments, type UserMessagePart } from './messageParts';
import {
	computeComposerContextUsedEstimate,
	DEFAULT_CONTEXT_WINDOW_TOKENS_UI,
} from './contextMeterFormat';
import { getAtMentionRange } from './composerAtMention';
import { textBeforeCaretForAt } from './composerRichDom';
import { useComposerAtMention, type AtComposerSlot } from './useComposerAtMention';
import { useComposerSlashCommand } from './useComposerSlashCommand';

const EMPTY_AGENT_PENDING_PATCHES: AgentPendingPatch[] = [];
const EMPTY_SNAPSHOT_PATHS: ReadonlySet<string> = new Set<string>();
import { type MarkdownTabView } from './EditorTabBar';
import {
	isMarkdownEditorPath,
	markdownViewForTab,
	stripLeadingYamlFrontmatter,
	stripPlanFrontmatterForPreview,
} from './editorMarkdownView';
import { isPlanMdPath, planExecutedKey } from './planExecutedKey';
import { workspaceRelativeFileUrl } from './workspaceUri';
import { voidShellDebugLog } from './tabCloseDebug';
import { useSettings } from './hooks/useSettings';
import { usePlanSystem } from './hooks/usePlanSystem';
import {
	useStreamingChat,
	useStreamingChatControls,
	useStreamingChatSubscription,
} from './hooks/useStreamingChat';
import { useMenubarMenuReducer } from './hooks/useMenubarMenuReducer';
import { useWizardPending } from './hooks/useWizardPending';
import { useFileOperations, type AgentConversationFileOpenOptions } from './hooks/useFileOperations';
import { useWorkspaceActions } from './hooks/useWorkspaceActions';
import { useAgentChatPanelProps } from './hooks/useAgentChatPanelProps';
import { useAgentRightSidebarProps } from './hooks/useAgentRightSidebarProps';
import { useAgentLeftSidebarProps } from './hooks/useAgentLeftSidebarProps';
import { useEditorMainPanelProps } from './hooks/useEditorMainPanelProps';
import { useWorkspaceManager } from './hooks/useWorkspaceManager';
import { useThreads } from './hooks/useThreads';
import { type ChatMessage, type ThreadInfo } from './threadTypes';
import { normWorkspaceRootKey } from './workspaceRootKey';
import { useAgentFileReview, type AgentFilePreviewState } from './hooks/useAgentFileReview';
import { useComposer } from './hooks/useComposer';
import { useStreaming } from './streamingStore';
import { DevProfiler } from './devProfiler';
import { useEditorTabs, type EditorInlineDiffState, clampEditorTerminalHeight } from './hooks/useEditorTabs';
import { useResizeRails } from './hooks/useResizeRails';
import { useUiZoom } from './hooks/useUiZoom';
import { useEditCommands } from './hooks/useEditCommands';
import { useLayoutWindows } from './hooks/useLayoutWindows';
import { useWizardSends } from './hooks/useWizardSends';
import { useMessagesScroll } from './hooks/useMessagesScroll';
import { useAgentPatchActions } from './hooks/useAgentPatchActions';
import { useThreadActions } from './hooks/useThreadActions';
import { useComposerAttachments } from './hooks/useComposerAttachments';
import { useSettingsPersistence } from './hooks/useSettingsPersistence';
import { useWorkspaceExplorerActions } from './hooks/useWorkspaceExplorerActions';
import { useAppShellSlices } from './hooks/useAppShellSlices';
import { useTeamSession } from './hooks/useTeamSession';
import { useAgentSession } from './hooks/useAgentSession';
import type { AgentUserInputRequest } from './agentSessionTypes';
import { buildTeamWorkflowItems } from './teamWorkflowItems';
import { AppWorkspaceWelcome } from './app/AppWorkspaceWelcome';
import { AgentAgentCenterColumn } from './app/AgentAgentCenterColumn';
import type { ComposerAnchorSlot } from './ChatComposer';
import { AppProvider } from './AppContext';
import { ComposerActionsProvider } from './ComposerActionsContext';
import { AgentBrowserWindowSurface } from './AgentRightSidebar';
import { TerminalWindowSurface } from './TerminalWindowSurface';
import {
	loadTerminalSettings,
	subscribeTerminalSettings,
	syncTerminalSettingsToMain,
} from './terminalWindow/terminalSettings';
import { runDesktopShellInit } from './app/desktopShellInit';
import {
	DEFAULT_SHELL_LAYOUT_MODE_KEY,
	DEFAULT_SIDEBAR_LAYOUT_KEY,
	clampSidebarLayout,
	readSidebarLayout,
	readStoredShellLayoutModeFromKey,
	type ShellLayoutMode,
} from './app/shellLayoutStorage';
import {
	AppShellProviders,
	useAppShellChromeCore,
	useAppShellChromeLayout,
	useAppShellChromeTheme,
	useAppShellWorkspace,
	useAppShellGitActions,
	useAppShellGitMeta,
	useAppShellGitFiles,
	useAppShellSettings,
} from './app/appShellContexts';
import { AppShellMenubar } from './app/AppShellMenubar';
import { AppShellOverlays } from './app/AppShellOverlays';
import type { ShellLeftRailGroupProps, ShellCenterRightGroupProps } from './app/ShellWorkspaceColumns';
import { ShellWorkspaceGrid } from './app/ShellWorkspaceGrid';
import { ThreadItem } from './app/ThreadItem';
import {
	type WorkspaceLauncherTool,
	workspaceLauncherLabel,
} from './app/workspaceLaunchers';

const EditorMainPanel = lazy(() => import('./EditorMainPanel').then((m) => ({ default: m.EditorMainPanel })));

type LayoutMode = ShellLayoutMode;
type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team' | 'browser' | 'agents';
type EditorLeftSidebarView = 'explorer' | 'search' | 'git';
import { useI18n, normalizeLocale } from './i18n';
import { hideBootSplash } from './bootSplash';
import { debugDiffHead, diffCreatesNewFile, sameStringArray } from './appDiffUtils';

type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

function workspacePathDisplayName(full: string): string {
	const norm = full.replace(/\\/g, '/');
	const parts = norm.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? full;
}

function workspacePathParent(full: string): string {
	const norm = full.replace(/\\/g, '/');
	const i = norm.lastIndexOf('/');
	if (i <= 0) {
		return '';
	}
	return norm.slice(0, i);
}

function useAsyncShell() {
	return window.asyncShell;
}

function isEditableDomTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

type OnSendOptions = {
	threadId?: string;
	modeOverride?: ComposerMode;
	modelIdOverride?: string;
	planExecute?: ChatPlanExecutePayload;
	/** 非空时在本轮 stream 成功 done 后标记该计划文件已执行 Build */
	planBuildPathKey?: string;
};

export default function App({
	appSurface,
	browserWindow = false,
	initialThemeSnapshot = null,
	terminalWindow = false,
	terminalStartPage = false,
}: {
	appSurface?: LayoutMode;
	browserWindow?: boolean;
	initialThemeSnapshot?: InitialWindowThemeSnapshot | null;
	terminalWindow?: boolean;
	terminalStartPage?: boolean;
} = {}) {
	const shell = useAsyncShell();
	const layoutPinnedBySurface = appSurface !== undefined;
	const shellLsPrefix = appSurface === 'editor' ? 'void-shell:editor:' : '';
	const shellLayoutStorageKey = `${shellLsPrefix}${DEFAULT_SHELL_LAYOUT_MODE_KEY}`;
	const sidebarLayoutStorageKey = `${shellLsPrefix}${DEFAULT_SIDEBAR_LAYOUT_KEY}`;

	useEffect(() => {
		if (!shell) {
			return;
		}
		syncTerminalSettingsToMain(loadTerminalSettings());
		return subscribeTerminalSettings(() => {
			syncTerminalSettingsToMain(loadTerminalSettings());
		});
	}, [shell]);

	const { t, setLocale, locale } = useI18n();
	const workspaceManager = useWorkspaceManager(shell);
	const settings = useSettings(shell, workspaceManager.workspace, t);

	const {
		chromeCoreSlice,
		chromeLayoutSlice,
		chromeThemeSlice,
		workspaceSlice,
		settingsSlice,
	} = useAppShellSlices({
		shell,
		t,
		setLocale,
		locale,
		initialThemeSnapshot,
		layoutPinnedBySurface,
		appSurface,
		shellLayoutStorageKey,
		sidebarLayoutStorageKey,
		workspaceManager,
		settings,
	});

	return (
		<AppShellProviders
			chromeCore={chromeCoreSlice}
			chromeLayout={chromeLayoutSlice}
			chromeTheme={chromeThemeSlice}
			workspace={workspaceSlice}
			settings={settingsSlice}
		>
			{terminalWindow ? (
				<AppTerminalWindow terminalStartPage={terminalStartPage} />
			) : browserWindow ? (
				<AppBrowserWindow />
			) : (
				<AppMainWorkspace />
			)}
		</AppShellProviders>
	);
}

function AppTerminalWindow({ terminalStartPage = false }: { terminalStartPage?: boolean }) {
	const { shell, t, setLocale } = useAppShellChromeCore();
	const { setColorMode, setAppearanceSettings } = useAppShellChromeTheme();

	useEffect(() => {
		if (!shell) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const settings = (await shell.invoke('settings:get')) as {
					language?: string;
					ui?: { colorMode?: string } & Record<string, unknown>;
				};
				if (cancelled) {
					return;
				}
				setLocale(normalizeLocale(settings.language));
				const colorMode =
					settings.ui?.colorMode === 'light' ||
					settings.ui?.colorMode === 'dark' ||
					settings.ui?.colorMode === 'system'
						? settings.ui.colorMode
						: readStoredColorMode();
				setColorMode(colorMode);
				const scheme = resolveEffectiveScheme(colorMode, readPrefersDark());
				setAppearanceSettings(normalizeAppearanceSettings(settings.ui, scheme));
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, setAppearanceSettings, setColorMode, setLocale]);

	useEffect(() => {
		hideBootSplash();
	}, []);

	return <TerminalWindowSurface t={t} forceStartPage={terminalStartPage} />;
}

function AppBrowserWindow() {
	const { shell, setLocale } = useAppShellChromeCore();
	const { setColorMode, setAppearanceSettings } = useAppShellChromeTheme();

	useEffect(() => {
		if (!shell) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const settings = (await shell.invoke('settings:get')) as {
					language?: string;
					ui?: {
						colorMode?: string;
					} & Record<string, unknown>;
				};
				if (cancelled) {
					return;
				}
				setLocale(normalizeLocale(settings.language));
				const colorMode =
					settings.ui?.colorMode === 'light' ||
					settings.ui?.colorMode === 'dark' ||
					settings.ui?.colorMode === 'system'
						? settings.ui.colorMode
						: readStoredColorMode();
				setColorMode(colorMode);
				const scheme = resolveEffectiveScheme(colorMode, readPrefersDark());
				setAppearanceSettings(normalizeAppearanceSettings(settings.ui, scheme));
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, setAppearanceSettings, setColorMode, setLocale]);

	return <AgentBrowserWindowSurface />;
}

/**
 * 流式跟随滚动：订阅 streamingStore 的 streaming 字段，仅该子组件按 token 重渲染，
 * 粘底时每次 token 变化都调度一帧合并滚动，App 根不再因 streaming 重渲染。
 */
const MessagesScrollSync = memo(function MessagesScrollSync({
	hasConversation,
	pinMessagesToBottomRef,
	scheduleMessagesScrollToBottom,
	syncMessagesScrollIndicators,
}: {
	hasConversation: boolean;
	pinMessagesToBottomRef: RefObject<boolean>;
	scheduleMessagesScrollToBottom: () => void;
	syncMessagesScrollIndicators: () => void;
}) {
	const streaming = useStreaming();
	useLayoutEffect(() => {
		if (!hasConversation) return;
		if (pinMessagesToBottomRef.current) {
			scheduleMessagesScrollToBottom();
		}
		const rafId = requestAnimationFrame(() => {
			syncMessagesScrollIndicators();
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, streaming, pinMessagesToBottomRef, scheduleMessagesScrollToBottom, syncMessagesScrollIndicators]);
	return null;
});

function AppMainWorkspaceInner() {
	const { shell, t, setLocale, locale } = useAppShellChromeCore();
	const {
		ipcOk,
		setIpcOk,
		layoutPinnedBySurface,
		appSurface,
		shellLayoutStorageKey,
		sidebarLayoutStorageKey,
	} = useAppShellChromeLayout();
	const {
		colorMode,
		setColorMode,
		appearanceSettings,
		setAppearanceSettings,
		effectiveScheme,
		setTransitionOrigin,
		monacoChromeTheme,
	} = useAppShellChromeTheme();

	const {
		workspace,
		setWorkspace,
		workspaceFileListRef,
		ensureWorkspaceFileListLoaded,
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
	} = useAppShellWorkspace();

	const [atFileIndexReadyTick, setAtFileIndexReadyTick] = useState(0);
	useEffect(() => {
		const sub = shell?.subscribeWorkspaceFileIndexReady;
		if (!sub || !workspace) {
			return;
		}
		return sub((rootNorm) => {
			const a = workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
			const b = String(rootNorm).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
			if (a === b) {
				setAtFileIndexReadyTick((k) => k + 1);
			}
		});
	}, [shell, workspace]);

	const { refreshGit, setGitActionError, setGitBranchPickerOpen } = useAppShellGitActions();
	const { gitStatusOk } = useAppShellGitMeta();
	const { gitChangedPaths, diffPreviews } = useAppShellGitFiles();

	/** Git 大对象经 ref 供长生命周期回调读取，避免 fullStatus 引用抖动连带 chat/composer props 失效 */
	const agentGitPackRef = useRef({ gitStatusOk, gitChangedPaths, diffPreviews });
	agentGitPackRef.current = { gitStatusOk, gitChangedPaths, diffPreviews };

	const {
		modelProviders,
		defaultModel,
		modelEntries,
		enabledModelIds,
		thinkingByModelId,
		setThinkingByModelId,
		providerIdentity,
		setProviderIdentity,
		hasSelectedModel,
		modelPickerItems,
		modelPillLabel,
		agentCustomization,
		refreshWorkspaceDiskSkills,
		mergedAgentCustomization,
		onChangeMergedAgentCustomization,
		editorSettings,
		setEditorSettings,
		mcpServers,
		setMcpServers,
		mcpStatuses,
		setMcpStatuses,
		settingsPageOpen,
		setSettingsPageOpen,
		settingsInitialNav,
		settingsOpenPending,
		openSettingsPageBase,
		onPickDefaultModel,
		onChangeModelEntries,
		onChangeModelProviders,
		onRefreshMcpStatuses,
		onStartMcpServer,
		onStopMcpServer,
		onRestartMcpServer,
		applyLoadedSettings,
		teamSettings,
		setTeamSettings,
		botIntegrations,
		setBotIntegrations,
	} = useAppShellSettings();

	const {
		threads,
		threadSearch,
		setThreadSearch,
		currentId,
		setCurrentId,
		currentIdRef,
		editingThreadId,
		setEditingThreadId,
		editingThreadTitleDraft,
		setEditingThreadTitleDraft,
		threadTitleDraftRef,
		threadTitleInputRef,
		confirmDeleteId,
		setConfirmDeleteId,
		confirmDeleteTimerRef,
		messages,
		setMessages,
		messagesRef,
		messagesThreadId,
		setMessagesThreadId,
		resendFromUserIndex,
		setResendFromUserIndex,
		resendIdxRef,
		threadNavigation,
		setThreadNavigation,
		skipThreadNavigationRecordRef,
		refreshThreads,
		refreshAgentSidebarThreads,
		sidebarThreadsByPathKey,
		loadMessages,
		resetThreadState,
	} = useThreads(shell);

	/** onSelectThread 内读取最新值：工作区打开路径已 loadMessages 后避免同线程重复 IPC */
	const messagesThreadIdRef = useRef(messagesThreadId);
	messagesThreadIdRef.current = messagesThreadId;

	// 开发环境：记录阻塞主线程 ≥50ms 的任务（与窗口拖动卡顿强相关）
	useEffect(() => {
		if (!import.meta.env.DEV || typeof PerformanceObserver === 'undefined') {
			return;
		}
		try {
			const obs = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (entry.duration < 50) {
						continue;
					}
					const lt = entry as PerformanceEntry & {
						attribution?: ReadonlyArray<{ name?: string; containerType?: string }>;
					};
					const attr = lt.attribution?.[0];
					console.warn(
						`[perf] longtask ${entry.duration.toFixed(0)}ms name=${entry.name}` +
							(attr?.name ? ` src=${attr.name}` : '')
					);
				}
			});
			obs.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
			return () => obs.disconnect();
		} catch {
			/* Long Task API 不可用 */
		}
	}, []);

	const [editingThreadWorkspacePath, setEditingThreadWorkspacePath] = useState<string | null>(null);
	// ─────────────────────────────────────────────────────────────────────────

	const {
		awaitingReply,
		thoughtSecondsByThread,
		subAgentBgToast,
		showTransientToast,
		beginStream,
		markFirstToken,
		recordThoughtSeconds,
		resetStreamingSession,
		clearInFlightIpcRouting,
		streamThreadRef,
		ipcInFlightChatThreadIdRef,
		ipcStreamNonceRef,
		offThreadStreamDraftsRef,
		streamStartedAtRef,
		firstTokenAtRef,
		setStreaming,
		setAwaitingReply,
	} = useStreamingChat();
	const {
		applyTeamPayload,
		getTeamSession,
		setSelectedTask,
		clearTeamSession,
		clearPendingQuestion: clearTeamPendingQuestion,
		clearPendingUserInput: clearTeamPendingUserInput,
		abortTeamSession,
		startTeamSession,
		restoreTeamSession,
		markTeamPlanProposalDecided,
	} = useTeamSession();
	const {
		restoreAgentSession,
		clearAgentSession,
		setSelectedAgent,
		getAgentSession,
	} = useAgentSession();
	const {
		agentReviewPendingByThread,
		setAgentReviewPendingByThread,
		agentReviewBusy,
		setAgentReviewBusy,
		fileChangesDismissed,
		setFileChangesDismissed,
		fileChangesDismissedRef,
		dismissedFiles,
		setDismissedFiles,
		dismissedFilesRef,
		revertedFiles,
		setRevertedFiles,
		revertedFilesRef,
		revertedChangeKeys,
		setRevertedChangeKeys,
		revertedChangeKeysRef,
		agentFilePreview,
		setAgentFilePreview,
		agentFilePreviewBusyPatch,
		setAgentFilePreviewBusyPatch,
		agentFilePreviewRequestRef,
		clearAgentReviewForThread,
		resetAgentReviewState,
	} = useAgentFileReview();

	const agentReviewPendingByThreadRef = useRef(agentReviewPendingByThread);
	agentReviewPendingByThreadRef.current = agentReviewPendingByThread;

	const {
		setParsedPlan,
		planFilePath, setPlanFilePath,
		planFileRelPath, setPlanFileRelPath,
		executedPlanKeys, setExecutedPlanKeys,
		planQuestion, setPlanQuestion,
		planQuestionRequestId, setPlanQuestionRequestId,
		planQuestionDismissedByThreadRef,
		agentPlanBuildModelId, setAgentPlanBuildModelId,
		editorPlanBuildModelId, setEditorPlanBuildModelId,
		editorPlanReviewDismissed, setEditorPlanReviewDismissed,
		planTodoDraftOpen,
		planTodoDraftText, setPlanTodoDraftText,
		planTodoDraftInputRef,
		planBuildPendingMarkerRef,
		agentPlanPreviewMarkdown,
		agentPlanEffectivePlan,
		agentPlanPreviewTitle,
		agentPlanDocumentMarkdown,
		agentPlanGoalMarkdown,
		agentPlanTodos,
		agentPlanTodoDoneCount,
		agentPlanGoalSummary,
		hasAgentPlanSidebarContent,
		planReviewIsBuilt,
		getLatestAgentPlan,
		onPlanTodoToggle,
		onPlanAddTodo,
		onPlanAddTodoCancel,
		onPlanAddTodoSubmit,
		onPlanQuestionSkip: recordPlanQuestionDismissed,
		resetPlanState,
	} = usePlanSystem(shell, currentId, currentIdRef, messages, messagesThreadId, messagesRef, workspace, defaultModel);

	const [rootUserInputRequestsByThread, setRootUserInputRequestsByThread] = useState<
		Record<string, AgentUserInputRequest>
	>({});
	const { wizardPending, setWizardPending } = useWizardPending();
	const [agentRightSidebarOpen, setAgentRightSidebarOpen] = useState(false);
	const [agentRightSidebarView, setAgentRightSidebarView] = useState<AgentRightSidebarView>('git');
	const [commitMsg, setCommitMsg] = useState('');
	const [lastTurnUsage, setLastTurnUsage] = useState<TurnTokenUsage | null>(null);
	const [layoutSwitchPending] = useTransition();
	const [layoutSwitchTarget, setLayoutSwitchTarget] = useState<LayoutMode | null>(null);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [plusMenuOpen, setPlusMenuOpen] = useState(false);
	useEffect(() => {
		if (plusMenuOpen || modelPickerOpen) {
			setGitBranchPickerOpen(false);
		}
	}, [plusMenuOpen, modelPickerOpen, setGitBranchPickerOpen]);
	const {
		composerSegments,
		setComposerSegments,
		inlineResendSegments,
		setInlineResendSegments,
		composerMode,
		setComposerMode,
		composerAttachErr,
		setStreamingThinking,
		setStreamingToolPreview,
		streamingToolPreviewClearTimerRef,
		setLiveAssistantBlocks,
		toolApprovalRequest,
		setToolApprovalRequest,
		mistakeLimitRequest,
		setMistakeLimitRequest,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		flashComposerAttachErr,
		resetComposerState,
	} = useComposer();
	useEffect(() => {
		if (composerMode === 'team') {
			setModelPickerOpen(false);
		}
	}, [composerMode]);

	/** 切回仍在后台运行的线程时，恢复暂停态；若有离屏累积草稿则一并铺回 UI */
	const restoreInFlightThreadUiIfNeeded = useCallback(
		(threadId: string) => {
			if (ipcInFlightChatThreadIdRef.current !== threadId) {
				return;
			}
			const draft = offThreadStreamDraftsRef.current[threadId];
			if (draft) {
				setStreaming(draft.streaming);
				setStreamingThinking(draft.streamingThinking);
				delete offThreadStreamDraftsRef.current[threadId];
			}
			setAwaitingReply(true);
		},
		[setStreaming, setStreamingThinking, setAwaitingReply]
	);

	const clearPlanQuestion = useCallback(() => {
		setPlanQuestion(null);
		setPlanQuestionRequestId(null);
	}, [setPlanQuestion, setPlanQuestionRequestId]);

	const setRootUserInputRequest = useCallback((threadId: string, request: AgentUserInputRequest | null) => {
		if (!threadId) {
			return;
		}
		setRootUserInputRequestsByThread((prev) => {
			if (!request) {
				if (!prev[threadId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[threadId];
				return next;
			}
			return {
				...prev,
				[threadId]: request,
			};
		});
	}, []);

	const clearRootUserInputRequest = useCallback((threadId?: string | null) => {
		if (!threadId) {
			setRootUserInputRequestsByThread({});
			return;
		}
		setRootUserInputRequest(threadId, null);
	}, [setRootUserInputRequest]);

	const { sendMessage, abortActiveStream } = useStreamingChatControls({
		shell,
		currentId,
		setCurrentId,
		loadMessages,
		refreshThreads,
		restoreAgentSession,
		defaultModel,
		composerMode,
		teamSettings,
		modelEntries,
		resendFromUserIndex,
		setResendFromUserIndex,
		setInlineResendSegments,
		setComposerSegments,
		setMessages,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		beginStream,
		resetStreamingSession,
		clearInFlightIpcRouting,
		ipcInFlightChatThreadIdRef,
		offThreadStreamDraftsRef,
		flashComposerAttachErr,
		t,
		clearAgentReviewForThread,
		clearRootUserInputRequest,
		startTeamSession,
		clearPlanQuestion,
		clearMistakeLimitRequest: () => setMistakeLimitRequest(null),
		planBuildPendingMarkerRef,
		setAwaitingReply,
		streamStartedAtRef,
	});

	useStreamingChatSubscription({
		shell,
		composerMode,
		streamThreadRef,
		ipcInFlightChatThreadIdRef,
		ipcStreamNonceRef,
		offThreadStreamDraftsRef,
		streamingToolPreviewClearTimerRef,
		setStreamingToolPreview,
		setLiveAssistantBlocks,
		markFirstToken,
		setStreaming,
		setStreamingThinking,
		setToolApprovalRequest,
		setRootUserInputRequest,
		setPlanQuestion,
		setPlanQuestionRequestId,
		setMistakeLimitRequest,
		t,
		showTransientToast,
		recordThoughtSeconds,
		setLastTurnUsage,
		resetStreamingSession,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		setFileChangesDismissed,
		setDismissedFiles,
		planBuildPendingMarkerRef,
		currentIdRef,
		setExecutedPlanKeys,
		setAgentReviewPendingByThread,
		setMessages,
		clearRootUserInputRequest,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		loadMessages,
		refreshThreads,
		restoreAgentSession,
		applyTeamPayload,
	});

	const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
		layoutPinnedBySurface && appSurface ? appSurface : readStoredShellLayoutModeFromKey(shellLayoutStorageKey)
	);
	const [layoutWindowAvailability, setLayoutWindowAvailability] = useState<Record<LayoutMode, boolean>>({
		agent: false,
		editor: false,
	});
	const [editorLeftSidebarView, setEditorLeftSidebarView] = useState<EditorLeftSidebarView>('explorer');
	const [editorExplorerCollapsed, setEditorExplorerCollapsed] = useState(false);
	const [editorSidebarSearchQuery, setEditorSidebarSearchQuery] = useState('');
	const editorSidebarSearchInputRef = useRef<HTMLInputElement>(null);
	const editorExplorerScrollRef = useRef<HTMLDivElement>(null);
	const scrollEditorExplorerToTop = useCallback(() => {
		const node = editorExplorerScrollRef.current;
		if (!node) {
			return;
		}
		node.scrollTop = 0;
	}, []);
	const toggleEditorExplorerCollapsed = useCallback(() => {
		scrollEditorExplorerToTop();
		setEditorExplorerCollapsed((prev) => !prev);
		window.requestAnimationFrame(scrollEditorExplorerToTop);
	}, [scrollEditorExplorerToTop]);
	const [agentWorkspaceOrder, setAgentWorkspaceOrder] = useState<string[]>([]);
	const [uiZoom, setUiZoom] = useState(1);
	const {
		openTabs,
		setOpenTabs,
		activeTabId,
		setActiveTabId,
		filePath,
		setFilePath,
		editorValue,
		setEditorValue,
		editorInlineDiffByPath,
		setEditorInlineDiffByPath,
		saveToastKey,
		setSaveToastKey,
		saveToastVisible,
		setSaveToastVisible,
		editorTerminalVisible,
		setEditorTerminalVisible,
		editorTerminalHeightPx,
		setEditorTerminalHeightPx,
		editorTerminalSessions,
		setEditorTerminalSessions,
		activeEditorTerminalId,
		setActiveEditorTerminalId,
		monacoEditorRef,
		editorLoadRequestRef,
		pendingEditorHighlightRangeRef,
		editorTerminalHeightLsKey,
	} = useEditorTabs({ isolatedEditorSurface: appSurface === 'editor' });
	const monacoDiffChangeDisposableRef = useRef<{ dispose(): void } | null>(null);
	useEffect(() => () => monacoDiffChangeDisposableRef.current?.dispose(), []);

	const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const [quickOpenOpen, setQuickOpenOpen] = useState(false);
	const [quickOpenSeed, setQuickOpenSeed] = useState('');

	useEffect(() => {
		if (!quickOpenOpen || !workspace) {
			return;
		}
		void ensureWorkspaceFileListLoaded();
	}, [quickOpenOpen, workspace, ensureWorkspaceFileListLoaded]);
	const [, setSidebarSearchDraft] = useState('');
	const editorTerminalCreateLockRef = useRef(false);
	const terminalMenuRef = useRef<HTMLDivElement>(null);
	const fileMenuRef = useRef<HTMLDivElement>(null);
	const editMenuRef = useRef<HTMLDivElement>(null);
	const viewMenuRef = useRef<HTMLDivElement>(null);
	const windowMenuRef = useRef<HTMLDivElement>(null);
	const helpMenuRef = useRef<HTMLDivElement>(null);
	const {
		fileMenuOpen,
		editMenuOpen,
		viewMenuOpen,
		windowMenuOpen,
		terminalMenuOpen,
		helpMenuOpen,
		menus: menubarMenus,
		toggleMenubarMenu,
		setMenubarMenu,
		setTerminalMenuOpen,
	} = useMenubarMenuReducer();
	const [windowMaximized, setWindowMaximized] = useState(false);
	const [editorThreadHistoryOpen, setEditorThreadHistoryOpen] = useState(false);
	const [editorChatMoreOpen, setEditorChatMoreOpen] = useState(false);
	const editorHistoryMenuRef = useRef<HTMLDivElement>(null);
	const editorMoreMenuRef = useRef<HTMLDivElement>(null);
	const [homePath, setHomePath] = useState('');
	const [railWidths, setRailWidths] = useState(() => {
		const s = readSidebarLayout(sidebarLayoutStorageKey);
		return clampSidebarLayout(s.left, s.right);
	});
	const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
	const onNewThreadRef = useRef<() => Promise<void>>(async () => {});
	const composerRichHeroRef = useRef<HTMLDivElement>(null);
	const composerRichBottomRef = useRef<HTMLDivElement>(null);
	const composerRichInlineRef = useRef<HTMLDivElement>(null);
	/** 底部 composer 测高延后到 rAF，避免与虚拟列表等同步读布局挤在同一任务里触发 forced reflow */
	const composerRichAutoHeightRafRef = useRef<number | null>(null);
	const inlineResendRootRef = useRef<HTMLDivElement | null>(null);
	const closeAtMenuLatestRef = useRef<() => void>(() => {});
	const plusAnchorHeroRef = useRef<HTMLDivElement>(null);
	const plusAnchorBottomRef = useRef<HTMLDivElement>(null);
	const plusAnchorInlineRef = useRef<HTMLDivElement>(null);
	const modelPillHeroRef = useRef<HTMLDivElement>(null);
	const modelPillBottomRef = useRef<HTMLDivElement>(null);
	const modelPillInlineRef = useRef<HTMLDivElement>(null);
	const composerGitBranchAnchorRef = useRef<HTMLButtonElement>(null);
	const [plusMenuAnchorSlot, setPlusMenuAnchorSlot] = useState<ComposerAnchorSlot>('bottom');
	const [modelPickerAnchorSlot, setModelPickerAnchorSlot] = useState<ComposerAnchorSlot>('bottom');

	const respondToolApproval = useCallback(
		async (approved: boolean) => {
			if (!shell) {
				return;
			}
			const req = toolApprovalRequest;
			if (!req) {
				return;
			}
			setToolApprovalRequest(null);
			try {
				await shell.invoke('agent:toolApprovalRespond', { approvalId: req.approvalId, approved });
			} catch {
				/* ignore */
			}
		},
		[shell, toolApprovalRequest]
	);

	const respondMistakeLimit = useCallback(
		async (action: 'continue' | 'stop' | 'hint', hint?: string) => {
			if (!shell) {
				return;
			}
			const req = mistakeLimitRequest;
			if (!req) {
				return;
			}
			setMistakeLimitRequest(null);
			try {
				await shell.invoke('agent:mistakeLimitRespond', {
					recoveryId: req.recoveryId,
					action,
					hint: hint ?? '',
				});
			} catch {
				/* ignore */
			}
		},
		[shell, mistakeLimitRequest]
	);

	useEffect(() => {
		return () => {
			if (streamingToolPreviewClearTimerRef.current !== null) {
				window.clearTimeout(streamingToolPreviewClearTimerRef.current);
			}
		};
	}, []);

	// writeComposerMode 已由 useComposer 内的 useEffect 自动处理，直接使用 setComposerMode
	const setComposerModePersist = setComposerMode;

	const openSettingsPage = useCallback((nav: SettingsNavId) => {
		setModelPickerOpen(false);
		setPlusMenuOpen(false);
		openSettingsPageBase(nav);
	}, [openSettingsPageBase]);

	const settingsNavIdSet = useMemo(() => new Set<string>(ALL_SETTINGS_NAV_IDS), []);

	useEffect(() => {
		const unsub = window.asyncShell?.subscribeOpenSettingsNav?.((nav) => {
			if (typeof nav === 'string' && settingsNavIdSet.has(nav)) {
				openSettingsPage(nav as SettingsNavId);
			}
		});
		return () => {
			unsub?.();
		};
	}, [openSettingsPage, settingsNavIdSet]);

	const openBrowserSettingsPage = useCallback(() => {
		openSettingsPage('browser');
	}, [openSettingsPage]);

	const workspaceBasename = useMemo(() => {
		if (!workspace) {
			return t('app.noWorkspace');
		}
		const norm = workspace.replace(/\\/g, '/');
		const parts = norm.split('/').filter(Boolean);
		return parts[parts.length - 1] ?? workspace;
	}, [workspace, t]);

	const quickOpenRecentFiles = useMemo(() => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (let i = openTabs.length - 1; i >= 0; i--) {
			const p = openTabs[i]?.filePath;
			if (p && !seen.has(p)) {
				seen.add(p);
				out.push(p);
			}
		}
		return out;
	}, [openTabs]);

	const visibleThreads = useMemo(() => threads.filter((thread) => thread.hasUserMessages), [threads]);

	const { todayThreads, archivedThreads } = useMemo(() => {
		const q = threadSearch.trim().toLowerCase();
		const list = q
			? visibleThreads.filter(
					(t) =>
						t.title.toLowerCase().includes(q) ||
						(t.subtitleFallback ?? '').toLowerCase().includes(q)
				)
			: visibleThreads;
		const today: ThreadInfo[] = [];
		const archived: ThreadInfo[] = [];
		for (const t of list) {
			if (t.isToday) {
				today.push(t);
			} else {
				archived.push(t);
			}
		}
		return { todayThreads: today, archivedThreads: archived };
	}, [visibleThreads, threadSearch]);

	const threadsChrono = useMemo(
		() =>
			[...visibleThreads].sort(
				(a, b) => b.updatedAt - a.updatedAt || (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.title.localeCompare(b.title)
			),
		[visibleThreads]
	);

	const hiddenAgentWorkspacePathSet = useMemo(() => new Set(hiddenAgentWorkspacePaths), [hiddenAgentWorkspacePaths]);
	const collapsedAgentWorkspacePathSet = useMemo(
		() => new Set(collapsedAgentWorkspacePaths),
		[collapsedAgentWorkspacePaths]
	);

	const agentSidebarWorkspaceCandidates = useMemo(() => {
		const seen = new Set<string>();
		const ordered: string[] = [];
		for (const path of folderRecents) {
			if (!path || seen.has(path)) {
				continue;
			}
			seen.add(path);
			ordered.push(path);
		}
		if (workspace && !seen.has(workspace)) {
			ordered.push(workspace);
		}
		return ordered;
	}, [folderRecents, workspace]);

	// useLayoutEffect：commit 后同步执行，避免 useEffect 异步触发导致在两个 paint 帧间
	// 出现额外的 agentSidebarWorkspaces 无效渲染。
	useLayoutEffect(() => {
		setAgentWorkspaceOrder((prev) => {
			const candidateSet = new Set(agentSidebarWorkspaceCandidates);
			const next = prev.filter((path) => candidateSet.has(path));
			for (const path of agentSidebarWorkspaceCandidates) {
				if (!next.includes(path)) {
					next.push(path);
				}
			}
			return sameStringArray(prev, next) ? prev : next;
		});
	}, [agentSidebarWorkspaceCandidates]);

	const agentSidebarThreadPaths = useMemo(
		() =>
			agentWorkspaceOrder
				.filter((path) => !hiddenAgentWorkspacePathSet.has(path))
				.slice(0, 8),
		[agentWorkspaceOrder, hiddenAgentWorkspacePathSet]
	);

	useEffect(() => {
		if (!shell) {
			return;
		}
		if (layoutMode !== 'agent') {
			void refreshAgentSidebarThreads([]);
			return;
		}
		const idle = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 } as IdleDeadline), 1));
		const cancel = window.cancelIdleCallback ?? ((id: number) => window.clearTimeout(id));
		const id = idle(
			() => {
				void refreshAgentSidebarThreads(agentSidebarThreadPaths);
			},
			{ timeout: 3000 }
		);
		return () => cancel(id);
	}, [shell, layoutMode, agentSidebarThreadPaths, refreshAgentSidebarThreads]);

	const agentSidebarWorkspaces = useMemo(() => {
		const q = threadSearch.trim().toLowerCase();
		return agentSidebarThreadPaths.map((path) => {
			const rowsSource =
				workspace && normWorkspaceRootKey(path) === normWorkspaceRootKey(workspace)
					? threads
					: (sidebarThreadsByPathKey[normWorkspaceRootKey(path)] ?? []);
			const visible = rowsSource.filter((thread) => thread.hasUserMessages);
			const list = q
				? visible.filter(
						(t) =>
							t.title.toLowerCase().includes(q) ||
							(t.subtitleFallback ?? '').toLowerCase().includes(q)
					)
				: visible;
			const today: ThreadInfo[] = [];
			const archived: ThreadInfo[] = [];
			for (const t of list) {
				if (t.isToday) {
					today.push(t);
				} else {
					archived.push(t);
				}
			}
			return {
				path,
				name: workspaceAliases[path]?.trim() || workspacePathDisplayName(path),
				parent: workspacePathParent(path),
				isCurrent: path === workspace,
				isCollapsed:
					path === workspace ? collapsedAgentWorkspacePathSet.has(path) : !collapsedAgentWorkspacePathSet.has(path),
				threadCount: list.length,
				todayThreads: today,
				archivedThreads: archived,
			};
		});
	}, [
		agentSidebarThreadPaths,
		workspace,
		threads,
		sidebarThreadsByPathKey,
		threadSearch,
		workspaceAliases,
		collapsedAgentWorkspacePathSet,
	]);

	const hasConversation = messages.length > 0 || awaitingReply;
	const normalizedEditorSidebarSearchQuery = editorSidebarSearchQuery.trim().toLowerCase();
	const [editorSidebarSearchResults, setEditorSidebarSearchResults] = useState<
		{ rel: string; fileName: string; dir: string; fileIndex: number; pathIndex: number }[]
	>([]);
	useEffect(() => {
		if (!normalizedEditorSidebarSearchQuery) {
			setEditorSidebarSearchResults([]);
			return;
		}
		let cancelled = false;
		const timer = window.setTimeout(() => {
			void (async () => {
				const items = await searchFiles(normalizedEditorSidebarSearchQuery, [], 120);
				if (cancelled) return;
				setEditorSidebarSearchResults(
					items.map((it) => ({
						rel: it.path,
						fileName: it.label,
						dir: it.description,
						fileIndex: 0,
						pathIndex: 0,
					}))
				);
			})();
		}, 120);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [normalizedEditorSidebarSearchQuery, searchFiles]);
	const editorSidebarSelectedRel = filePath.trim().replace(/\\/g, '/');
	const editorSidebarWorkspaceLabel = workspace ? workspaceBasename.toLocaleUpperCase() : t('app.noWorkspace');

	const canSendComposer = useMemo(
		() => hasSelectedModel && !segmentsTrimmedEmpty(composerSegments),
		[hasSelectedModel, composerSegments]
	);
	const canSendInlineResend = useMemo(
		() => hasSelectedModel && !segmentsTrimmedEmpty(inlineResendSegments),
		[hasSelectedModel, inlineResendSegments]
	);

	const currentThreadTitle = useMemo(() => {
		const t = threads.find((x) => x.id === currentId);
		return t?.title ?? workspaceBasename;
	}, [threads, currentId, workspaceBasename]);

	const pendingAgentPatches = useMemo(() => {
		if (!currentId) {
			return EMPTY_AGENT_PENDING_PATCHES;
		}
		return agentReviewPendingByThread[currentId] ?? EMPTY_AGENT_PENDING_PATCHES;
	}, [currentId, agentReviewPendingByThread]);
	const canToggleTerminal = layoutMode === 'editor' && !!workspace;
	const canToggleDiffPanel = layoutMode === 'agent';
	const currentThreadIndex = currentId ? threadsChrono.findIndex((thread) => thread.id === currentId) : -1;
	const canGoPrevThread = currentThreadIndex >= 0 && currentThreadIndex < threadsChrono.length - 1;
	const canGoNextThread = currentThreadIndex > 0;
	const canGoBackThread = threadNavigation.index > 0;
	const canGoForwardThread =
		threadNavigation.index >= 0 && threadNavigation.index < threadNavigation.history.length - 1;
	const activeDomEditable =
		typeof document !== 'undefined' && isEditableDomTarget(document.activeElement) ? (document.activeElement as HTMLElement) : null;
	const monacoTextFocused = Boolean(monacoEditorRef.current?.hasTextFocus?.() || monacoEditorRef.current?.hasWidgetFocus?.());
	const pageSelectionText =
		typeof window !== 'undefined' ? window.getSelection?.()?.toString().trim() ?? '' : '';
	const canEditUndoRedo = monacoTextFocused || !!activeDomEditable;
	const canEditCut = monacoTextFocused || !!activeDomEditable;
	const canEditCopy = monacoTextFocused || !!activeDomEditable || pageSelectionText.length > 0;
	const canEditPaste = monacoTextFocused || !!activeDomEditable;
	const canEditSelectAll = monacoTextFocused || !!activeDomEditable || pageSelectionText.length > 0;

	useEffect(() => {
		document.body.style.zoom = String(uiZoom);
		return () => {
			document.body.style.zoom = '1';
		};
	}, [uiZoom]);

	const {
		workspaceMenuPath,
		workspaceMenuPosition,
		workspaceMenuRef,
		editingWorkspacePath,
		editingWorkspaceNameDraft,
		setEditingWorkspaceNameDraft,
		workspaceNameDraftRef,
		workspaceNameInputRef,
		closeWorkspaceMenu,
		openWorkspaceMenu,
		revealWorkspaceInOs,
		removeWorkspaceFromSidebar,
		beginWorkspaceAliasEdit,
		cancelWorkspaceAliasEdit,
		commitWorkspaceAliasEdit,
		handleWorkspacePrimaryAction,
	} = useWorkspaceActions({
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
	});

	const activeWorkspaceMenuItem = useMemo(
		() => agentSidebarWorkspaces.find((item) => item.path === workspaceMenuPath) ?? null,
		[agentSidebarWorkspaces, workspaceMenuPath]
	);

	const clearWorkspaceConversationState = useCallback(() => {
		resetStreamingSession({ clearThread: true });
		planBuildPendingMarkerRef.current = null;
		resetThreadState();
		resetAgentReviewState();
		resetComposerState();
		setLastTurnUsage(null);
		resetPlanState();
		cancelWorkspaceAliasEdit();
	}, [resetStreamingSession, resetThreadState, resetAgentReviewState, resetComposerState, cancelWorkspaceAliasEdit]);

	const {
		executeSkillCreatorSend,
		executeRuleWizardSend,
		executeSubagentWizardSend,
	} = useWizardSends({
		shell,
		currentId,
		defaultModel,
		t,
		setComposerModePersist,
		setCurrentId,
		loadMessages,
		clearAgentReviewForThread,
		setComposerSegments,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		beginStream,
		setMessages,
		refreshThreads,
		resetStreamingSession,
		flashComposerAttachErr,
	});

	const {
		persistComposerAttachments,
		onChatPanelDropFiles,
		pickComposerImagesFromDialog,
		insertComposerSkillInvocation,
		toggleComposerMcpServerEnabled,
	} = useComposerAttachments({
		shell,
		workspace,
		t,
		flashComposerAttachErr,
		composerRichBottomRef,
		composerRichHeroRef,
		setComposerSegments,
		mcpServers,
		setMcpServers,
		setMcpStatuses,
		plusMenuOpen,
	});

	const {
		onApplyAgentPatchOne,
		onApplyAgentPatchesAll,
		onDiscardAgentReview,
		dismissAgentChangedFile,
		markAgentConversationChangeReverted,
		onKeepAllEdits,
		onRevertAllEdits,
		onKeepFileEdit,
		onRevertFileEdit,
	} = useAgentPatchActions({
		shell,
		currentId,
		currentIdRef,
		composerMode,
		t,
		messagesRef,
		agentReviewPendingByThreadRef,
		agentGitPackRef,
		setAgentReviewBusy,
		setAgentReviewPendingByThread,
		setDismissedFiles,
		setRevertedFiles,
		setRevertedChangeKeys,
		setFileChangesDismissed,
		dismissedFilesRef,
		revertedFilesRef,
		revertedChangeKeysRef,
		fileChangesDismissedRef,
		clearAgentReviewForThread,
		loadMessages,
		refreshGit,
	});

	useEffect(() => {
		if (!shell) {
			setIpcOk(t('app.ipcBrowserOnly'));
			hideBootSplash();
			return;
		}
		void runDesktopShellInit({
			shell,
			t,
			layoutPinnedBySurface,
			shellLayoutStorageKey,
			sidebarLayoutStorageKey,
			refreshThreads,
			refreshGit,
			setLocale,
			setIpcOk,
			setWorkspace,
			setHomePath,
			setRailWidths,
			setLayoutMode,
			applyLoadedSettings,
			setColorMode,
			setAppearanceSettings,
			setMcpServers,
			setMcpStatuses,
		});
	}, [
		shell,
		refreshThreads,
		refreshGit,
		t,
		setLocale,
		layoutPinnedBySurface,
		shellLayoutStorageKey,
		sidebarLayoutStorageKey,
		setWorkspace,
		setHomePath,
		setRailWidths,
		setLayoutMode,
		applyLoadedSettings,
		setColorMode,
		setAppearanceSettings,
		setMcpServers,
		setMcpStatuses,
	]);

	useEffect(() => {
		if (!shell?.subscribeThemeMode) {
			return;
		}
		return shell.subscribeThemeMode((payload) => {
			const next = (payload as { colorMode?: unknown } | null)?.colorMode;
			if ((next === 'light' || next === 'dark' || next === 'system') && next !== colorMode) {
				setTransitionOrigin(undefined);
				setColorMode(next);
				writeStoredColorMode(next);
			}
		});
	}, [shell, setTransitionOrigin, colorMode]);

	useEffect(() => {
		if (layoutMode !== 'editor' || editorLeftSidebarView !== 'search') {
			return;
		}
		const id = window.setTimeout(() => editorSidebarSearchInputRef.current?.focus(), 0);
		return () => window.clearTimeout(id);
	}, [layoutMode, editorLeftSidebarView]);

	// useLayoutEffect：与上方 agentWorkspaceOrder 同理，避免额外 paint 帧。
	useLayoutEffect(() => {
		setEditorExplorerCollapsed(false);
	}, [workspace]);

	useEffect(() => {
		if (layoutMode !== 'editor' || editorLeftSidebarView !== 'explorer' || editorExplorerCollapsed) {
			return;
		}
		const id = window.requestAnimationFrame(scrollEditorExplorerToTop);
		return () => window.cancelAnimationFrame(id);
	}, [layoutMode, editorLeftSidebarView, editorExplorerCollapsed, workspace, scrollEditorExplorerToTop]);

	/**
	 * fileChanges 状态恢复：从 localStorage 读取已保留/撤销记录并同批写入 state。
	 * 使用 ref 追踪上次计算的 {threadId, hash}，避免 streaming 期间重复计算。
	 * 被 onMessagesLoaded（loadMessages 的 onLoad 回调）和后续 useEffect 共用。
	 */
	const fileChangesLastHashRef = useRef<{ threadId: string | null; hash: string }>({ threadId: null, hash: '' });
	const restoreFileChangesState = useCallback(
		(threadId: string | null, msgs: ChatMessage[], loadedThreadId: string | null) => {
			if (!threadId || loadedThreadId !== threadId) {
				if (fileChangesLastHashRef.current.threadId === null && fileChangesLastHashRef.current.hash === '') return;
				fileChangesLastHashRef.current = { threadId: null, hash: '' };
				setFileChangesDismissed(false);
				setDismissedFiles(new Set());
				setRevertedFiles(new Set());
				setRevertedChangeKeys(new Set());
				return;
			}
			const last = [...msgs].reverse().find((m) => m.role === 'assistant');
			const content = last?.content ?? '';
			if (!content.trim()) {
				if (fileChangesLastHashRef.current.threadId === threadId && fileChangesLastHashRef.current.hash === '') return;
				fileChangesLastHashRef.current = { threadId, hash: '' };
				setFileChangesDismissed(false);
				setDismissedFiles(new Set());
				setRevertedFiles(new Set());
				setRevertedChangeKeys(new Set());
				return;
			}
			const hash = hashAgentAssistantContent(content);
			if (fileChangesLastHashRef.current.threadId === threadId && fileChangesLastHashRef.current.hash === hash) {
				return; // 相同 hash，跳过重复计算
			}
			fileChangesLastHashRef.current = { threadId, hash };
			const stored = readPersistedAgentFileChanges(threadId);
			if (!stored || stored.contentHash !== hash) {
				if (stored) clearPersistedAgentFileChanges(threadId);
				setFileChangesDismissed(false);
				setDismissedFiles(new Set());
				setRevertedFiles(new Set());
				setRevertedChangeKeys(new Set());
				return;
			}
			setFileChangesDismissed(stored.fileChangesDismissed);
			setDismissedFiles(new Set(stored.dismissedPaths));
			setRevertedFiles(new Set(stored.revertedPaths));
			setRevertedChangeKeys(new Set(stored.revertedChangeKeys));
		},
		[setFileChangesDismissed, setDismissedFiles, setRevertedFiles, setRevertedChangeKeys]
	);

	/**
	 * loadMessages 的 onLoad 回调：在 startTransition 内与 setMessages 同批执行，
	 * 避免 messages 变化后 useEffect 级联触发额外 render 轮次。
	 */
	const onMessagesLoaded = useCallback(
		(msgs: ChatMessage[], threadId: string, extra?: { teamSession?: unknown; agentSession?: unknown }) => {
			restoreFileChangesState(threadId, msgs, threadId);
			if (extra?.teamSession && typeof extra.teamSession === 'object') {
				restoreTeamSession(threadId, extra.teamSession as import('./hooks/useTeamSession').TeamSessionSnapshot);
			}
			if (extra?.agentSession && typeof extra.agentSession === 'object') {
				restoreAgentSession(threadId, extra.agentSession as import('./agentSessionTypes').AgentSessionSnapshot);
				if (shell) {
					void shell.invoke('agent:getSession', threadId);
				}
			}
		},
		[restoreFileChangesState, restoreTeamSession, restoreAgentSession, shell]
	);

	useEffect(() => {
		if (!shell || !currentId) {
			return;
		}
		// 避免与 onSelectThread 中的手动调用重复
		if (messagesThreadId === currentId) return;
		void loadMessages(currentId, onMessagesLoaded);
	}, [shell, currentId, loadMessages, messagesThreadId, onMessagesLoaded]);

	const workspaceSwitchSeqRef = useRef(0);
	const applyWorkspacePath = useCallback(
		async (next: string) => {
			const seq = ++workspaceSwitchSeqRef.current;
			const mark = (suffix: string) => {
				try {
					performance.mark(`void-ws-${seq}-${suffix}`);
				} catch {
					/* ignore */
				}
			};
			const measure = (name: string, startSuffix: string, endSuffix: string) => {
				try {
					performance.measure(name, `void-ws-${seq}-${startSuffix}`, `void-ws-${seq}-${endSuffix}`);
				} catch {
					/* ignore */
				}
			};
			const t0 = performance.now();
			console.log(`[perf][renderer] workspace switch START → ${next}`);
			mark('start');
			clearWorkspaceConversationState();
			setWorkspace(next);
			mark('workspace-set');
			console.log(`[perf][renderer] workspace:openPath+setState done in ${(performance.now() - t0).toFixed(1)}ms`);
			// 并行而非串行，且 refreshGit 由 workspace 变化的 effect 触发，此处不重复调用
			const threadId = await refreshThreads();
			mark('threads-done');
			measure('void-ws:apply-path:threads', 'start', 'threads-done');
			console.log(`[perf][renderer] refreshThreads IPC round-trip done in ${(performance.now() - t0).toFixed(1)}ms`);
			// 直接调用 loadMessages，避免通过 effect (currentId 变化 → loadMessages)
			// 间接触发导致多出一帧空白 render。去重 ref 确保 effect 不会发起重复 IPC。
			if (threadId) {
				await loadMessages(threadId, onMessagesLoaded);
				restoreInFlightThreadUiIfNeeded(threadId);
				mark('messages-done');
				measure('void-ws:apply-path:messages', 'threads-done', 'messages-done');
				console.log(`[perf][renderer] loadMessages done in ${(performance.now() - t0).toFixed(1)}ms`);
			}
		},
		[clearWorkspaceConversationState, refreshThreads, loadMessages, onMessagesLoaded, restoreInFlightThreadUiIfNeeded]
	);

	const openWorkspaceByPath = useCallback(
		async (path: string): Promise<boolean> => {
			if (!shell) {
				setWorkspacePickerOpen(true);
				return false;
			}
			const r = (await shell.invoke('workspace:openPath', path)) as {
				ok: boolean;
				path?: string;
				error?: string;
			};
			if (r.ok && r.path) {
				// 主进程解析后的根路径与当前 workspace 相同时勿再 applyWorkspacePath，否则会 clearWorkspaceConversationState
				// 把消息清空（侧栏 threadWorkspaceRoot 与 workspace 字符串略不一致时易误触发）。
				if (workspace && normWorkspaceRootKey(r.path) === normWorkspaceRootKey(workspace)) {
					if (import.meta.env.DEV) {
						console.log('[perf] openWorkspaceByPath: skip apply (resolved path matches current workspace)');
					}
					return true;
				}
				await applyWorkspacePath(r.path);
				return true;
			}
			setWorkspacePickerOpen(true);
			return false;
		},
		[shell, applyWorkspacePath, workspace]
	);

	const { executeEditAction } = useEditCommands({
		shell,
		t,
		monacoEditorRef,
		flashComposerAttachErr,
	});

	// 优化的回调函数,避免 JSX 中创建内联函数
	const handleCloseWorkspacePicker = useCallback(() => setWorkspacePickerOpen(false), []);
	const handleCloseQuickOpen = useCallback(() => {
		setQuickOpenOpen(false);
		setQuickOpenSeed('');
	}, []);
	const handleCloseWorkspaceTools = useCallback(() => setWorkspaceToolsOpen(false), []);
	const handleCloseModelPicker = useCallback(() => setModelPickerOpen(false), []);
	const handleClosePlusMenu = useCallback(() => setPlusMenuOpen(false), []);
	const handleToggleFileMenu = useCallback(() => toggleMenubarMenu('file'), [toggleMenubarMenu]);
	const handleToggleEditMenu = useCallback(() => toggleMenubarMenu('edit'), [toggleMenubarMenu]);
	const handleCloseEditorChatMore = useCallback(() => setEditorChatMoreOpen(false), []);
	const handleOpenSettingsGeneral = useCallback(() => openSettingsPage('general'), [openSettingsPage]);
	const handleOpenSettingsModels = useCallback(() => openSettingsPage('models'), [openSettingsPage]);
	const handleOpenSettingsRules = useCallback(() => openSettingsPage('rules'), [openSettingsPage]);
	const handleOpenSettingsTools = useCallback(() => openSettingsPage('tools'), [openSettingsPage]);
	const handleOpenAutoUpdate = useCallback(() => openSettingsPage('autoUpdate'), [openSettingsPage]);

	const toggleSidebarVisibility = useCallback(() => {
		setLeftSidebarOpen((open) => !open);
	}, []);

	const toggleTerminalVisibility = useCallback(() => {
		if (layoutMode !== 'editor' || !workspace) {
			return;
		}
		setEditorTerminalVisible((visible) => !visible);
	}, [layoutMode, workspace]);

	const openAgentRightSidebarView = useCallback((view: AgentRightSidebarView) => {
		setAgentRightSidebarView(view);
		setAgentRightSidebarOpen(true);
	}, []);

	const toggleAgentRightSidebarView = useCallback(
		(view: AgentRightSidebarView) => {
			if (agentRightSidebarOpen && agentRightSidebarView === view) {
				setAgentRightSidebarOpen(false);
				return;
			}
			setAgentRightSidebarView(view);
			setAgentRightSidebarOpen(true);
		},
		[agentRightSidebarOpen, agentRightSidebarView]
	);

	const toggleDiffPanelVisibility = useCallback(() => {
		if (layoutMode !== 'agent') {
			return;
		}
		toggleAgentRightSidebarView('git');
	}, [layoutMode, toggleAgentRightSidebarView]);

	const launchWorkspaceWithTool = useCallback(
		async (tool: WorkspaceLauncherTool) => {
			if (!shell || !workspace) {
				flashComposerAttachErr(t('app.noWorkspace'));
				return;
			}
			try {
				const r = (await shell.invoke('workspace:openInExternalTool', { tool })) as {
					ok?: boolean;
					code?: string;
					error?: string;
				};
				if (!r?.ok) {
					if (r?.code === 'tool-unavailable') {
						flashComposerAttachErr(
							t('app.workspaceLauncher.toolUnavailable', { app: workspaceLauncherLabel(t, tool) })
						);
						return;
					}
					if (r?.code === 'no-workspace') {
						flashComposerAttachErr(t('app.noWorkspace'));
						return;
					}
					flashComposerAttachErr(
						r?.error ?? t('app.workspaceLauncher.openFailed', { app: workspaceLauncherLabel(t, tool) })
					);
				}
			} catch (e) {
				flashComposerAttachErr(e instanceof Error ? e.message : String(e));
			}
		},
		[shell, workspace, flashComposerAttachErr, t]
	);

	const {
		onNewThread,
		composerInvokeNewThread,
		onNewThreadForWorkspace,
		onSelectThread,
		goToPreviousThread,
		goToNextThread,
		goThreadBack,
		goThreadForward,
		commitThreadTitleEdit,
		cancelThreadTitleEdit,
		beginThreadTitleEdit,
		onDeleteThread,
	} = useThreadActions({
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
	});

	const onSendRef = useRef<(textOverride?: string, opts?: OnSendOptions) => Promise<void>>(async () => {});

	onSendRef.current = async (textOverride?: string, opts?: OnSendOptions) => {
		const resendIdx = resendFromUserIndex;
		const segments = resendIdx !== null ? inlineResendSegments : composerSegments;
		const fromSegments = segmentsToWireText(segments).trim();
		const text =
			resendIdx === null && typeof textOverride === 'string' && textOverride.trim().length > 0
				? textOverride.trim()
				: fromSegments;
		const targetThreadId = opts?.threadId ?? currentId;
		if (!shell || !targetThreadId) {
			return;
		}

		const wizardSlug =
			resendIdx === null &&
			(typeof textOverride !== 'string' || textOverride.trim().length === 0)
				? getLeadingWizardCommand(composerSegments)
				: null;
		if (wizardSlug) {
			if (segmentsTrimmedEmpty(composerSegments)) {
				return;
			}
			/* 关闭 portaled 菜单（slash 等 z-index ~20001），否则会盖在内嵌向导上导致选项无法点击 */
			slashCommand.closeSlashMenu();
			atMention.closeAtMenu();
			setPlusMenuOpen(false);
			setModelPickerOpen(false);
			setWizardPending({
				kind: wizardSlug,
				targetThreadId,
				tailSegments: composerSegments.slice(1),
			});
			return;
		}

		if (!text) {
			return;
		}
		const effectiveModelId = (opts?.modelIdOverride ?? defaultModel).trim();
		if (!effectiveModelId) {
			flashComposerAttachErr(t('app.noModelSelected'));
			return;
		}
		await sendMessage(text, { ...opts, segments });
	};

	const onSend = useCallback(async (textOverride?: string, opts?: OnSendOptions) => {
		return onSendRef.current(textOverride, opts);
	}, []);

	const composerInvokeSend = useCallback(() => {
		void onSend();
	}, [onSend]);

	const onAbortRef = useRef<() => Promise<void>>(async () => {});

	onAbortRef.current = abortActiveStream;

	const onAbort = useCallback(async () => {
		if (currentId) {
			abortTeamSession(currentId);
		}
		return onAbortRef.current();
	}, [currentId, abortTeamSession]);

	const getCurrentPlanQuestionState = useCallback(() => {
		if (composerMode === 'team') {
			const liveTeamSession = getTeamSession(currentIdRef.current);
			return {
				question: liveTeamSession?.pendingQuestion ?? planQuestion,
				requestId: liveTeamSession?.pendingQuestionRequestId ?? planQuestionRequestId,
			};
		}
		return {
			question: planQuestion,
			requestId: planQuestionRequestId,
		};
	}, [composerMode, getTeamSession, planQuestion, planQuestionRequestId, currentIdRef]);

	const formatPlanQuestionReply = useCallback(
		(answer: string) => {
			const questionText = getCurrentPlanQuestionState().question?.text?.trim();
			const normalizedAnswer = answer.trim();
			if (!questionText) {
				return `我选择：${normalizedAnswer}`;
			}
			return [
				'[PLAN QUESTION]',
				questionText,
				'',
				'[USER ANSWER]',
				normalizedAnswer,
			].join('\n');
		},
		[getCurrentPlanQuestionState]
	);

	const onPlanQuestionSubmit = useCallback(
		(answer: string) => {
			const { requestId: rid } = getCurrentPlanQuestionState();
			const threadId = currentIdRef.current;
			const reply = formatPlanQuestionReply(answer);
			if (composerMode === 'team' && threadId) {
				clearTeamPendingQuestion(threadId);
			}
			if (rid && shell) {
				setPlanQuestion(null);
				setPlanQuestionRequestId(null);
				void shell
					.invoke('plan:toolQuestionRespond', { requestId: rid, answerText: reply })
					.catch((e) => console.error('[plan:toolQuestionRespond]', e));
				return;
			}
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			void onSend(reply);
		},
		[
			clearTeamPendingQuestion,
			composerMode,
			currentIdRef,
			formatPlanQuestionReply,
			getCurrentPlanQuestionState,
			shell,
			setPlanQuestion,
			setPlanQuestionRequestId,
			onSend,
		]
	);

	const onPlanQuestionSkip = useCallback(() => {
		recordPlanQuestionDismissed();
		const { requestId: rid } = getCurrentPlanQuestionState();
		const threadId = currentIdRef.current;
		const skipText = t('plan.q.skipUserMessage');
		if (composerMode === 'team' && threadId) {
			clearTeamPendingQuestion(threadId);
		}
		if (rid && shell) {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			void shell
				.invoke('plan:toolQuestionRespond', { requestId: rid, skipped: true, answerText: skipText })
				.catch((e) => console.error('[plan:toolQuestionRespond]', e));
			return;
		}
		setPlanQuestion(null);
		setPlanQuestionRequestId(null);
		void onSend(skipText);
	}, [
		t,
		onSend,
		shell,
		composerMode,
		currentIdRef,
		clearTeamPendingQuestion,
		getCurrentPlanQuestionState,
		recordPlanQuestionDismissed,
	]);

	const getCurrentUserInputRequest = useCallback(() => {
		const threadId = currentIdRef.current;
		if (!threadId) {
			return null;
		}
		if (composerMode === 'team') {
			return getTeamSession(threadId)?.pendingUserInput ?? null;
		}
		return rootUserInputRequestsByThread[threadId] ?? null;
	}, [composerMode, currentIdRef, getTeamSession, rootUserInputRequestsByThread]);

	const onUserInputSubmit = useCallback(
		async (answers: Record<string, string>) => {
			const threadId = currentIdRef.current;
			const request = getCurrentUserInputRequest();
			if (!threadId || !request?.requestId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:userInputRespond', {
				requestId: request.requestId,
				answers,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('app.chatSendFailed'));
				return;
			}
			if (composerMode === 'team') {
				clearTeamPendingUserInput(threadId);
			}
			clearRootUserInputRequest(threadId);
			showTransientToast(true, t('agent.userInput.submittedToast'));
		},
		[
			clearRootUserInputRequest,
			clearTeamPendingUserInput,
			composerMode,
			currentIdRef,
			getCurrentUserInputRequest,
			shell,
			showTransientToast,
			t,
		]
	);


	const onPlanBuild = useCallback(
		(modelId: string) => {
			if (awaitingReply) {
				return;
			}
			const planToBuild = getLatestAgentPlan();
			if (!planToBuild || !shell || !modelId.trim()) {
				return;
			}
			const threadId = currentIdRef.current;
			if (!threadId) {
				return;
			}
			const pbKeyEarly = planExecutedKey(workspace, planFileRelPath, planFilePath);
			if (pbKeyEarly && executedPlanKeys.includes(pbKeyEarly)) {
				return;
			}
			const planExecute: ChatPlanExecutePayload = {
				fromAbsPath: planFilePath ?? undefined,
				inlineMarkdown: toPlanMd(planToBuild),
				planTitle: planToBuild.name,
			};
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			setAgentRightSidebarView('plan');
			setAgentRightSidebarOpen(true);
			setComposerModePersist('agent');
			setComposerSegments([{ id: newSegmentId(), kind: 'text', text: '' }]);
			void onSend(t('plan.review.executeUserBubble'), {
				modeOverride: 'agent',
				modelIdOverride: modelId,
				planExecute,
				planBuildPathKey: pbKeyEarly || undefined,
			});
		},
		[
			getLatestAgentPlan,
			planFilePath,
			planFileRelPath,
			workspace,
			executedPlanKeys,
			shell,
			awaitingReply,
			setComposerModePersist,
			t,
		]
	);

	const onExecutePlanFromEditor = useCallback(
		(modelId: string) => {
			if (!shell || awaitingReply || !modelId.trim()) {
				return;
			}
			const threadId = currentIdRef.current;
			if (!threadId || !hasConversation) {
				return;
			}
			const fp = filePath.trim().replace(/\\/g, '/');
			if (!isPlanMdPath(fp)) {
				return;
			}
			const pbKey = planExecutedKey(workspace, fp, null);
			if (pbKey && executedPlanKeys.includes(pbKey)) {
				return;
			}
			const body = stripLeadingYamlFrontmatter(editorValue);
			const parsed = parsePlanDocument(body);
			const baseName = fp.split('/').pop() ?? 'plan.plan.md';
			const planTitle = parsed?.name ?? baseName.replace(/\.plan\.md$/i, '');
			const planExecute: ChatPlanExecutePayload = {
				inlineMarkdown: parsed ? toPlanMd(parsed) : editorValue,
				planTitle,
			};
			setComposerModePersist('agent');
			setComposerSegments([{ id: newSegmentId(), kind: 'text', text: '' }]);
			void onSend(t('plan.review.executeUserBubble'), {
				modeOverride: 'agent',
				modelIdOverride: modelId,
				planExecute,
				planBuildPathKey: pbKey || undefined,
			});
		},
		[
			shell,
			awaitingReply,
			hasConversation,
			filePath,
			editorValue,
			workspace,
			executedPlanKeys,
			setComposerModePersist,
			t,
		]
	);

	const onPlanReviewClose = useCallback(() => {
		if (layoutMode === 'agent' && agentRightSidebarView === 'plan') {
			setParsedPlan(null);
			setPlanFilePath(null);
			setPlanFileRelPath(null);
			setAgentRightSidebarOpen(false);
			setAgentRightSidebarView('git');
			return;
		}
		setEditorPlanReviewDismissed(true);
	}, [layoutMode, agentRightSidebarView]);

	useEffect(() => {
		if (!layoutSwitchPending) {
			setLayoutSwitchTarget(null);
		}
	}, [layoutSwitchPending]);

	const {
		onPersistLanguage,
		onChangeColorMode,
		refreshLayoutWindowAvailability,
		onChangeBotIntegrations,
		closeSettingsPage,
	} = useSettingsPersistence({
		shell,
		setTransitionOrigin,
		setColorMode,
		setLayoutWindowAvailability,
		workspace,
		setSettingsPageOpen,
		locale,
		providerIdentity,
		defaultModel,
		modelProviders,
		modelEntries,
		enabledModelIds,
		thinkingByModelId,
		agentCustomization,
		editorSettings,
		teamSettings,
		botIntegrations,
		setBotIntegrations,
		mcpServers,
		colorMode,
		appearanceSettings,
		layoutMode,
		layoutPinnedBySurface,
	});

	const startSkillCreatorFlow = useCallback(async () => {
		await closeSettingsPage();
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('threads:create')) as { id: string };
		const threadId = r.id;
		await refreshThreads();
		await shell.invoke('threads:select', threadId);
		setCurrentId(threadId);
		setLastTurnUsage(null);
		setAwaitingReply(false);
		setStreaming('');
		setStreamingThinking('');
		clearStreamingToolPreviewNow();
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		await loadMessages(threadId);
		setComposerSegments([
			{ id: newSegmentId(), kind: 'command', command: CREATE_SKILL_SLUG },
			{ id: newSegmentId(), kind: 'text', text: '' },
		]);
		setInlineResendSegments([]);
		setResendFromUserIndex(null);
		const title = t('agentSettings.skillCreatorThreadTitle');
		const rr = (await shell.invoke('threads:rename', threadId, title)) as { ok?: boolean };
		if (rr?.ok) {
			await refreshThreads();
		}
		queueMicrotask(() => {
			if (composerRichBottomRef.current) {
				composerRichBottomRef.current.focus();
			} else {
				composerRichHeroRef.current?.focus();
			}
		});
	}, [closeSettingsPage, shell, t, refreshThreads, loadMessages, clearStreamingToolPreviewNow]);


	const {
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
	} = useFileOperations({
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
	});

	const openAgentSidebarFilePreview = useCallback(
		async (
			rel: string,
			revealLine?: number,
			revealEndLine?: number,
			options?: AgentConversationFileOpenOptions
		) => {
			if (!shell || layoutMode !== 'agent') {
				await openFileInTab(rel, revealLine, revealEndLine, options);
				return;
			}

			const { gitStatusOk, gitChangedPaths, diffPreviews } = agentGitPackRef.current;
			const normalizedRel = normalizeWorkspaceRelPath(rel);
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
			const useSourceReadonlyFallback = !gitStatusOk && sourceDiff.length > 0;
			voidShellDebugLog('agent-file-preview:open:start', {
				relPath: normalizedRel,
				revealLine: safeRevealLine ?? null,
				revealEndLine: safeRevealEndLine ?? null,
				sourceDiffLength: sourceDiff.length,
				sourceDiffHead: sourceDiff ? debugDiffHead(sourceDiff) : '',
				allowReviewActions: sourceAllowsReviewActions,
				useSourceReadonlyFallback,
				layoutMode,
				currentId: currentId ?? '',
			});

			setAgentRightSidebarView('file');
			setAgentRightSidebarOpen(true);
			setAgentFilePreview((prev) => ({
				relPath: normalizedRel,
				revealLine: safeRevealLine,
				revealEndLine: safeRevealEndLine,
				loading: true,
				content: prev?.relPath === normalizedRel ? prev.content : '',
				diff: sourceAllowsReviewActions || useSourceReadonlyFallback ? sourceDiff : '',
				isBinary: false,
				readError: null,
				additions: 0,
				deletions: 0,
				reviewMode:
					prev?.relPath === normalizedRel && sourceAllowsReviewActions
						? prev.reviewMode
						: 'readonly',
			}));

			const requestId = ++agentFilePreviewRequestRef.current;
			let content = '';
			let readError: string | null = null;
			try {
				const fileResult = (await shell.invoke('fs:readFile', normalizedRel)) as { ok?: boolean; content?: string };
				if (fileResult.ok && typeof fileResult.content === 'string') {
					content = fileResult.content;
				}
			} catch (err) {
				readError = err instanceof Error ? err.message : String(err);
			}

			let previewDiff = sourceAllowsReviewActions || useSourceReadonlyFallback ? sourceDiff : '';
			let isBinary = false;
			let additions = 0;
			let deletions = 0;
			let reviewMode: AgentFilePreviewState['reviewMode'] = 'readonly';
			const isGitChanged = gitChangedPaths.some((path) => workspaceRelPathsEqual(path, normalizedRel));
			voidShellDebugLog('agent-file-preview:open:path-match', {
				relPath: normalizedRel,
				isGitChanged,
				gitChangedCount: gitChangedPaths.length,
				gitChangedHead: gitChangedPaths.slice(0, 12).join(' | '),
			});

			if (currentId && sourceAllowsReviewActions) {
				try {
					const snapshotResult = (await shell.invoke('agent:getFileSnapshot', currentId, normalizedRel)) as
						| { ok: true; hasSnapshot: false }
						| { ok: true; hasSnapshot: true; previousContent: string | null }
						| { ok?: false };
					if (snapshotResult?.ok && snapshotResult.hasSnapshot) {
						const previousContent = snapshotResult.previousContent ?? '';
						const { createTwoFilesPatch } = await import('diff');
						previewDiff = createTwoFilesPatch(
							`a/${normalizedRel}`,
							`b/${normalizedRel}`,
							previousContent,
							content,
							'',
							'',
							{ context: 3 }
						).trim();
						reviewMode = 'snapshot';
						readError = null;
						voidShellDebugLog('agent-file-preview:open:snapshot', {
							relPath: normalizedRel,
							previousLength: previousContent.length,
							contentLength: content.length,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					/* snapshot lookup failed; fall back to git preview */
				}
			}

			let authoritativeGitPreviewLoaded = false;
			if (gitStatusOk) {
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as
						| { ok: true; preview: DiffPreview }
						| { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview) {
						authoritativeGitPreviewLoaded = true;
						const gitPreviewDiff = String(fullDiffResult.preview.diff ?? '');
						const gitPreviewIsBinary = fullDiffResult.preview.isBinary === true;
						const gitPreviewAdditions = fullDiffResult.preview.additions ?? 0;
						const gitPreviewDeletions = fullDiffResult.preview.deletions ?? 0;
						const gitPreviewHead = debugDiffHead(gitPreviewDiff);
						if (!sourceAllowsReviewActions || reviewMode !== 'snapshot') {
							previewDiff = gitPreviewDiff;
							isBinary = gitPreviewIsBinary;
							additions = gitPreviewAdditions;
							deletions = gitPreviewDeletions;
							reviewMode = 'readonly';
						} else if (!gitPreviewDiff.trim()) {
							// Snapshot exists but git shows clean: trust git and hide stale inline diff.
							previewDiff = '';
							isBinary = gitPreviewIsBinary;
							additions = gitPreviewAdditions;
							deletions = gitPreviewDeletions;
							reviewMode = 'readonly';
						}
						voidShellDebugLog('agent-file-preview:open:git-authoritative', {
							relPath: normalizedRel,
							diffLength: gitPreviewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(gitPreviewDiff)).length,
							isBinary: gitPreviewIsBinary,
							additions: gitPreviewAdditions,
							deletions: gitPreviewDeletions,
							reviewMode,
							diffHead: gitPreviewHead,
						});
					}
				} catch {
					/* fall back to cached preview/status heuristics below */
				}
			}

			if (!authoritativeGitPreviewLoaded && !previewDiff && gitStatusOk && isGitChanged) {
				const cachedPreview = Object.entries(diffPreviews).find(
					([path]) => workspaceRelPathsEqual(path, normalizedRel)
				)?.[1];
				voidShellDebugLog('agent-file-preview:open:git-start', {
					relPath: normalizedRel,
					hasCachedPreview: Boolean(cachedPreview),
					cachedDiffLength: String(cachedPreview?.diff ?? '').length,
					gitStatusOk,
					isGitChanged,
				});
				if (cachedPreview) {
					isBinary = cachedPreview.isBinary === true;
					additions = cachedPreview.additions ?? 0;
					deletions = cachedPreview.deletions ?? 0;
				}
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as
						| { ok: true; preview: DiffPreview }
						| { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview) {
						previewDiff = String(fullDiffResult.preview.diff ?? '');
						isBinary = fullDiffResult.preview.isBinary === true;
						additions = fullDiffResult.preview.additions ?? additions;
						deletions = fullDiffResult.preview.deletions ?? deletions;
						reviewMode = 'readonly';
						voidShellDebugLog('agent-file-preview:open:git-full', {
							relPath: normalizedRel,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							isBinary,
							additions,
							deletions,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					if (cachedPreview) {
						previewDiff = String(cachedPreview.diff ?? '');
						isBinary = cachedPreview.isBinary === true;
						additions = cachedPreview.additions ?? 0;
						deletions = cachedPreview.deletions ?? 0;
						reviewMode = 'readonly';
						voidShellDebugLog('agent-file-preview:open:git-cached-fallback', {
							relPath: normalizedRel,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							isBinary,
							additions,
							deletions,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				}
			}

			if (
				!authoritativeGitPreviewLoaded &&
				previewDiff &&
				!isBinary &&
				reviewMode === 'readonly' &&
				(await buildAgentFilePreviewHunks(previewDiff)).length === 0
			) {
				try {
					const fullDiffResult = (await shell.invoke('git:diffPreview', {
						relPath: normalizedRel,
						full: true,
					})) as
						| { ok: true; preview: DiffPreview }
						| { ok: false; error?: string };
					if (fullDiffResult.ok && fullDiffResult.preview) {
						previewDiff = String(fullDiffResult.preview.diff ?? '');
						isBinary = fullDiffResult.preview.isBinary === true;
						additions = fullDiffResult.preview.additions ?? additions;
						deletions = fullDiffResult.preview.deletions ?? deletions;
						voidShellDebugLog('agent-file-preview:open:git-retry-full', {
							relPath: normalizedRel,
							diffLength: previewDiff.length,
							hunkCount: (await buildAgentFilePreviewHunks(previewDiff)).length,
							isBinary,
							additions,
							deletions,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					/* keep the existing preview fallback */
				}
			}

			if (previewDiff) {
				const stats = countDiffAddDel(previewDiff);
				additions = additions || stats.additions;
				deletions = deletions || stats.deletions;
				readError = null;
			}

			const previewHunks = !isBinary ? await buildAgentFilePreviewHunks(previewDiff) : [];
			if (
				currentId &&
				sourceAllowsReviewActions &&
				previewDiff &&
				!isBinary &&
				reviewMode === 'readonly' &&
				previewHunks.length > 0
			) {
				try {
					const seedResult = (await shell.invoke('agent:seedFileSnapshot', {
						threadId: currentId,
						relPath: normalizedRel,
						content,
						diff: previewDiff,
					})) as { ok?: boolean; seeded?: boolean; previousLength?: number; error?: string };
					if (seedResult?.ok && seedResult.seeded) {
						reviewMode = 'snapshot';
						voidShellDebugLog('agent-file-preview:open:seeded-snapshot', {
							relPath: normalizedRel,
							contentLength: content.length,
							previousLength: seedResult.previousLength ?? 0,
							diffLength: previewDiff.length,
							hunkCount: previewHunks.length,
							diffHead: debugDiffHead(previewDiff),
						});
					}
				} catch {
					/* derived snapshot seeding failed; keep readonly preview */
				}
			}

			if (requestId !== agentFilePreviewRequestRef.current) {
				voidShellDebugLog('agent-file-preview:open:stale', {
					relPath: normalizedRel,
					requestId,
					activeRequestId: agentFilePreviewRequestRef.current,
				});
				return;
			}

			voidShellDebugLog('agent-file-preview:open:final', {
				relPath: normalizedRel,
				reviewMode,
				contentLength: content.length,
				diffLength: previewDiff.length,
				hunkCount: previewHunks.length,
				isBinary,
				additions,
				deletions,
				readError: readError ?? '',
				diffHead: previewDiff ? debugDiffHead(previewDiff) : '',
			});

			setAgentFilePreview({
				relPath: normalizedRel,
				revealLine: safeRevealLine,
				revealEndLine: safeRevealEndLine,
				loading: false,
				content,
				diff: previewDiff,
				isBinary,
				readError,
				additions,
				deletions,
				reviewMode,
			});
		},
		[currentId, layoutMode, openFileInTab, shell]
	);

	useEffect(() => {
		if (isPlanMdPath(filePath.trim())) {
			setEditorPlanBuildModelId(defaultModel);
		}
	}, [filePath, defaultModel]);

	useEffect(() => {
		if (
			layoutMode !== 'editor' ||
			composerMode !== 'plan' ||
			awaitingReply ||
			!planFileRelPath
		) {
			return;
		}
		const current = filePath.trim().replace(/\\/g, '/');
		const target = planFileRelPath.replace(/\\/g, '/');
		if (current === target) {
			return;
		}
		void openFileInTab(target);
	}, [layoutMode, composerMode, awaitingReply, planFileRelPath, filePath, openFileInTab]);

	useEffect(() => {
		if (!shell || !currentId) {
			setExecutedPlanKeys([]);
			return;
		}
		let cancelled = false;
		void shell.invoke('threads:getExecutedPlanKeys', currentId).then((r) => {
			if (cancelled) {
				return;
			}
			const rec = r as { ok?: boolean; keys?: string[] };
			setExecutedPlanKeys(rec.ok && Array.isArray(rec.keys) ? rec.keys : []);
		});
		return () => {
			cancelled = true;
		};
	}, [shell, currentId]);

	const handleOpenWorkspaceSkillFile = useCallback(
		(rel: string) => {
			setLayoutMode('editor');
			void openFileInTab(rel);
		},
		[openFileInTab]
	);

	const {
		handleOpenAgentLayoutWindow,
		handleOpenEditorLayoutWindow,
	} = useLayoutWindows({
		shell,
		shellLayoutStorageKey,
		setLayoutMode,
		composerRichBottomRef,
		composerRichHeroRef,
		refreshLayoutWindowAvailability,
	});

	const handleDeleteWorkspaceSkillDisk = useCallback(async (skillMdRel: string): Promise<boolean> => {
		if (!shell) return false;
		try {
			const r = (await shell.invoke('workspace:deleteSkillFromDisk', skillMdRel)) as { ok?: boolean };
			if (r?.ok) refreshWorkspaceDiskSkills();
			return !!r?.ok;
		} catch {
			return false;
		}
	}, [shell]);

	const onAgentConversationOpenFile = useCallback(
		async (
			rel: string,
			revealLine?: number,
			revealEndLine?: number,
			options?: AgentConversationFileOpenOptions
		) => {
			const normalizedRel = normalizeWorkspaceRelPath(rel);
			const pathReverted = normalizedRel
				? [...revertedFilesRef.current].some((path) => workspaceRelPathsEqual(path, normalizedRel))
				: false;
			if (pathReverted) {
				return;
			}
			const changeKey =
				typeof options?.diff === 'string' && options.diff.trim()
					? agentChangeKeyFromDiff(options.diff)
					: '';
			if (changeKey && revertedChangeKeysRef.current.has(changeKey)) {
				return;
			}
			if (layoutMode === 'agent') {
				await openAgentSidebarFilePreview(rel, revealLine, revealEndLine, options);
				return;
			}
			await openFileInTab(rel, revealLine, revealEndLine);
		},
		[layoutMode, openAgentSidebarFilePreview, openFileInTab]
	);

	const onAcceptAgentFilePreviewHunk = useCallback(
		async (patch: string) => {
			if (!shell || !currentId || !agentFilePreview || !patch.trim()) {
				return;
			}
			setAgentFilePreviewBusyPatch(patch);
			try {
				const result = (await shell.invoke('agent:acceptFileHunk', {
					threadId: currentId,
					relPath: agentFilePreview.relPath,
					chunk: patch,
				})) as { ok?: boolean; cleared?: boolean; error?: string };
				if (!result?.ok) {
					flashComposerAttachErr(result?.error ?? 'Unable to accept this change.');
					return;
				}
				if (result.cleared) {
					dismissAgentChangedFile(agentFilePreview.relPath);
				}
				await openAgentSidebarFilePreview(
					agentFilePreview.relPath,
					agentFilePreview.revealLine,
					agentFilePreview.revealEndLine
				);
			} finally {
				setAgentFilePreviewBusyPatch(null);
			}
		},
		[
			agentFilePreview,
			currentId,
			dismissAgentChangedFile,
			flashComposerAttachErr,
			openAgentSidebarFilePreview,
			shell,
		]
	);

	const onRevertAgentFilePreviewHunk = useCallback(
		async (patch: string) => {
			if (!shell || !currentId || !agentFilePreview || !patch.trim()) {
				return;
			}
			if (diffCreatesNewFile(agentFilePreview.diff)) {
				const ok = window.confirm(
					t('app.filePreviewRevertNewFileConfirm', { path: agentFilePreview.relPath })
				);
				if (!ok) {
					return;
				}
			}
			setAgentFilePreviewBusyPatch(patch);
			try {
				const result = (await shell.invoke('agent:revertFileHunk', {
					threadId: currentId,
					relPath: agentFilePreview.relPath,
					chunk: patch,
				})) as { ok?: boolean; cleared?: boolean; error?: string };
				if (!result?.ok) {
					flashComposerAttachErr(result?.error ?? 'Unable to revert this change.');
					return;
				}
				const revertedPatchKey = agentChangeKeyFromDiff(patch);
				const previewDiffKey = agentChangeKeyFromDiff(agentFilePreview.diff);
				const revertedRelPath = result.cleared ? agentFilePreview.relPath : undefined;
				markAgentConversationChangeReverted(revertedPatchKey, revertedRelPath);
				if (previewDiffKey && previewDiffKey !== revertedPatchKey) {
					markAgentConversationChangeReverted(previewDiffKey, revertedRelPath);
				}
				if (result.cleared) {
					dismissAgentChangedFile(agentFilePreview.relPath);
				}
				await refreshGit();
				await openAgentSidebarFilePreview(
					agentFilePreview.relPath,
					agentFilePreview.revealLine,
					agentFilePreview.revealEndLine
				);
			} finally {
				setAgentFilePreviewBusyPatch(null);
			}
		},
		[
			agentFilePreview,
			currentId,
			dismissAgentChangedFile,
			flashComposerAttachErr,
			markAgentConversationChangeReverted,
			openAgentSidebarFilePreview,
			refreshGit,
			shell,
			t,
		]
	);

	const onExplorerOpenFile = useCallback(
		async (
			rel: string,
			revealLine?: number,
			revealEndLine?: number,
			options?: AgentConversationFileOpenOptions
		) => {
			if (layoutMode === 'agent') {
				await openAgentSidebarFilePreview(rel, revealLine, revealEndLine, options);
				return;
			}
			await openFileInTab(rel, revealLine, revealEndLine, options);
		},
		[layoutMode, openAgentSidebarFilePreview, openFileInTab]
	);

	/** 勿内联箭头传入 useComposerAtMention，否则每轮 render 新引用会拖垮 handleAtKeyDown → sharedComposerProps */
	const onAtMentionFileChipPreview = useCallback(
		(relPath: string) => {
			void onExplorerOpenFile(relPath);
		},
		[onExplorerOpenFile]
	);

	const composerExplorerOpenRel = useCallback((rel: string) => {
		void onExplorerOpenFile(rel);
	}, [onExplorerOpenFile]);

	const goToLineInEditor = useCallback((line: number) => {
		const ed = monacoEditorRef.current;
		if (!ed || !Number.isFinite(line) || line < 1) {
			return;
		}
		try {
			const model = ed.getModel();
			const lc = model?.getLineCount() ?? line;
			const ln = Math.max(1, Math.min(Math.floor(line), lc));
			ed.setPosition({ lineNumber: ln, column: 1 });
			ed.revealLineInCenter(ln);
		} catch {
			/* ignore */
		}
	}, []);

	const monacoDocumentPath = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return '';
		}
		const u = workspaceRelativeFileUrl(workspace, fp);
		return u ?? fp.replace(/\\/g, '/');
	}, [workspace, filePath]);

	const activeEditorTab = useMemo(
		() => openTabs.find((t2) => t2.filePath === filePath.trim()),
		[openTabs, filePath]
	);
	const activeEditorInlineDiff = useMemo(() => {
		const fp = normalizeWorkspaceRelPath(filePath.trim());
		return fp ? editorInlineDiffByPath[fp] ?? null : null;
	}, [editorInlineDiffByPath, filePath]);
	const markdownPaneMode = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return null;
		}
		return markdownViewForTab(fp, activeEditorTab?.markdownView);
	}, [filePath, activeEditorTab?.markdownView]);

	const setMarkdownPaneMode = useCallback((mode: MarkdownTabView) => {
		const fp = filePath.trim();
		if (!fp || !isMarkdownEditorPath(fp)) {
			return;
		}
		setOpenTabs((prev) => prev.map((t) => (t.filePath === fp ? { ...t, markdownView: mode } : t)));
	}, [filePath]);

	const markdownPreviewContent = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return editorValue;
		}
		return stripPlanFrontmatterForPreview(fp, editorValue);
	}, [filePath, editorValue]);
	const monacoOriginalDocumentPath = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return '';
		}
		return `inline-diff-original:///${fp.replace(/\\/g, '/')}`;
	}, [filePath]);

	const editorActivePlanPathKey = useMemo(() => {
		const fp = filePath.trim();
		if (!isPlanMdPath(fp)) {
			return '';
		}
		return planExecutedKey(workspace, fp, null);
	}, [filePath, workspace]);

	const editorPlanFileIsBuilt = useMemo(
		() => Boolean(editorActivePlanPathKey && executedPlanKeys.includes(editorActivePlanPathKey)),
		[editorActivePlanPathKey, executedPlanKeys]
	);

	useEffect(() => {
		if (!gitStatusOk) {
			return;
		}
		setEditorInlineDiffByPath((prev) => {
			let changed = false;
			const next: Record<string, EditorInlineDiffState> = {};
			for (const [path, state] of Object.entries(prev)) {
				if (
					state.reviewMode === 'readonly' &&
					!gitChangedPaths.some((changedPath) => workspaceRelPathsEqual(changedPath, path))
				) {
					changed = true;
					continue;
				}
				next[path] = state;
			}
			return changed ? next : prev;
		});
	}, [gitChangedPaths, gitStatusOk]);

	const showPlanFileEditorChrome =
		hasConversation && !!currentId && isPlanMdPath(filePath.trim());
	const teamSession = useMemo(() => getTeamSession(currentId), [getTeamSession, currentId]);
	const agentSession = useMemo(() => getAgentSession(currentId), [getAgentSession, currentId]);
	const activePlanQuestion = useMemo(
		() =>
			resendFromUserIndex !== null
				? null
				: composerMode === 'team'
					? teamSession?.pendingQuestion ?? planQuestion
					: planQuestion,
		[composerMode, teamSession, planQuestion, resendFromUserIndex]
	);
	const activeUserInputRequest = useMemo(
		() =>
			resendFromUserIndex !== null
				? null
				: composerMode === 'team'
					? teamSession?.pendingUserInput ?? null
					: currentId
						? rootUserInputRequestsByThread[currentId] ?? null
						: null,
		[composerMode, currentId, resendFromUserIndex, rootUserInputRequestsByThread, teamSession]
	);
	const hasActiveTeamSidebarContent = useMemo(
		() => composerMode === 'team' && buildTeamWorkflowItems(teamSession).length > 0,
		[composerMode, teamSession]
	);

	const editorCenterPlanMarkdown = useMemo(() => {
		if (agentPlanPreviewMarkdown.trim()) {
			return agentPlanPreviewMarkdown;
		}
		if (layoutMode === 'editor' && composerMode === 'plan' && hasConversation && awaitingReply) {
			return `# ${t('plan.review.label')}\n\n${t('app.planSidebarStreaming')}…`;
		}
		return '';
	}, [agentPlanPreviewMarkdown, layoutMode, composerMode, hasConversation, awaitingReply, t]);
	const showEditorPlanDocumentInCenter =
		layoutMode === 'editor' &&
		composerMode === 'plan' &&
		hasConversation &&
		(awaitingReply || !!editorCenterPlanMarkdown.trim());
	const showEditorTeamWorkflowInCenter =
		layoutMode === 'editor' &&
		composerMode === 'team' &&
		hasConversation &&
		!!teamSession?.selectedTaskId;
	const editorCenterPlanCanBuild =
		!awaitingReply && !!agentPlanEffectivePlan && !!editorPlanBuildModelId.trim() && modelPickerItems.length > 0;
	const agentPlanSidebarAutopenRef = useRef(false);

	useEffect(() => {
		if (!defaultModel.trim() || !showEditorPlanDocumentInCenter) {
			return;
		}
		setEditorPlanBuildModelId((prev) => (prev.trim() ? prev : defaultModel));
	}, [defaultModel, showEditorPlanDocumentInCenter]);

	useEffect(() => {
		if (!hasAgentPlanSidebarContent) {
			agentPlanSidebarAutopenRef.current = false;
			return;
		}
		if (!agentPlanSidebarAutopenRef.current) {
			setAgentRightSidebarView('plan');
			setAgentRightSidebarOpen(true);
		}
		agentPlanSidebarAutopenRef.current = true;
	}, [hasAgentPlanSidebarContent]);

	useEffect(() => {
		if (agentRightSidebarView === 'plan' && !hasAgentPlanSidebarContent) {
			setAgentRightSidebarOpen(false);
			setAgentRightSidebarView('git');
		}
	}, [agentRightSidebarView, hasAgentPlanSidebarContent]);

	useEffect(() => {
		if (agentRightSidebarView === 'team' && !hasActiveTeamSidebarContent) {
			setAgentRightSidebarOpen(false);
			setAgentRightSidebarView(hasAgentPlanSidebarContent ? 'plan' : 'git');
		}
	}, [agentRightSidebarView, hasActiveTeamSidebarContent, hasAgentPlanSidebarContent]);

	useEffect(() => {
		if (!workspace && agentFilePreview) {
			setAgentFilePreview(null);
		}
		if (agentRightSidebarView === 'file' && !agentFilePreview?.relPath) {
			setAgentRightSidebarView(hasAgentPlanSidebarContent ? 'plan' : 'git');
		}
	}, [agentFilePreview, agentRightSidebarView, hasAgentPlanSidebarContent, workspace]);
	const onMonacoMount = useCallback((ed: MonacoEditorNS.IStandaloneCodeEditor) => {
		monacoDiffChangeDisposableRef.current?.dispose();
		monacoDiffChangeDisposableRef.current = null;
		monacoEditorRef.current = ed;
	}, []);

	const onMonacoDiffMount = useCallback((diffEditor: MonacoEditorNS.IStandaloneDiffEditor) => {
		monacoDiffChangeDisposableRef.current?.dispose();
		monacoDiffChangeDisposableRef.current = null;
		monacoEditorRef.current = diffEditor.getModifiedEditor();
	}, []);

	const searchWorkspaceSymbolsFn = useCallback(
		async (query: string) => {
			if (!shell) {
				return [];
			}
			const r = (await shell.invoke('workspace:searchSymbols', query)) as {
				ok?: boolean;
				hits?: { name: string; path: string; line: number; kind: string }[];
			};
			return r.ok && Array.isArray(r.hits) ? r.hits : [];
		},
		[shell]
	);

	const openQuickOpen = useCallback((seed = '') => {
		setQuickOpenSeed(seed);
		setQuickOpenOpen(true);
	}, []);

	const openUniversalTerminal = useCallback(() => {
		if (!shell) {
			return;
		}
		void shell.invoke('terminalWindow:open', { startPage: true }).catch(() => {
			/* ignore */
		});
	}, [shell]);

	const focusSearchSidebarFromQuickOpen = useCallback((q: string) => {
		setSidebarSearchDraft(q);
		setQuickOpenSeed(`%${q}`);
		setQuickOpenOpen(true);
	}, []);

	const workspaceExplorerActions = useWorkspaceExplorerActions({
		shell,
		workspace,
		t,
		flashComposerAttachErr,
		openFileInTab,
		setOpenTabs,
		activeTabId,
		setActiveTabId,
		filePath,
		setFilePath,
		setEditorValue,
		appendEditorTerminal,
		setEditorTerminalVisible,
		setLayoutMode,
		setComposerSegments,
		composerRichBottomRef,
		composerRichHeroRef,
		refreshThreads,
		loadMessages,
		setCurrentId,
		setLastTurnUsage,
		setAwaitingReply,
		setStreaming,
		setStreamingThinking,
		clearStreamingToolPreviewNow,
		resetLiveAgentBlocks,
		streamStartedAtRef,
		firstTokenAtRef,
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		setInlineResendSegments,
		setResendFromUserIndex,
		refreshGit,
	});

	useEffect(() => {
		if (!editorTerminalVisible || !workspace || layoutMode !== 'editor') {
			return;
		}
		if (editorTerminalSessions.length > 0) {
			return;
		}
		void appendEditorTerminal();
	}, [editorTerminalVisible, workspace, layoutMode, editorTerminalSessions.length, appendEditorTerminal]);

	useEffect(() => {
		if (editorTerminalSessions.length === 0) {
			setActiveEditorTerminalId(null);
			return;
		}
		setActiveEditorTerminalId((cur) =>
			cur && editorTerminalSessions.some((s) => s.id === cur) ? cur : editorTerminalSessions[0]!.id
		);
	}, [editorTerminalSessions]);

	const {
		zoomInUi,
		zoomOutUi,
		resetUiZoom,
		toggleFullscreen,
		windowMenuMinimize,
		windowMenuToggleMaximize,
		windowMenuCloseWindow,
	} = useUiZoom({ shell, setUiZoom, setWindowMaximized });

	const onEditorTerminalSessionExit = useCallback((id: string) => {
		setEditorTerminalSessions((prev) => {
			const next = prev.filter((s) => s.id !== id);
			if (next.length === 0) {
				setEditorTerminalVisible(false);
			}
			return next;
		});
	}, [setEditorTerminalSessions, setEditorTerminalVisible]);

	useEffect(() => {
		const entries: {
			id: 'file' | 'edit' | 'view' | 'window' | 'terminal' | 'help';
			ref: RefObject<HTMLDivElement | null>;
		}[] = [
			{ id: 'file', ref: fileMenuRef },
			{ id: 'edit', ref: editMenuRef },
			{ id: 'view', ref: viewMenuRef },
			{ id: 'window', ref: windowMenuRef },
			{ id: 'terminal', ref: terminalMenuRef },
			{ id: 'help', ref: helpMenuRef },
		];
		const open = entries.find((e) => menubarMenus[e.id]);
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (open.ref.current?.contains(e.target as Node)) {
				return;
			}
			setMenubarMenu(open.id, false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [menubarMenus, setMenubarMenu]);

	useEffect(() => {
		if (!windowMenuOpen || !shell) {
			return;
		}
		let cancelled = false;
		void shell.invoke('app:windowGetState').then((r) => {
			if (cancelled) {
				return;
			}
			const o = r as { ok?: boolean; maximized?: boolean };
			if (o?.ok && typeof o.maximized === 'boolean') {
				setWindowMaximized(o.maximized);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [windowMenuOpen, shell]);

	// Ctrl/Cmd+P quick open, Ctrl/Cmd+Shift+P command mode (VS Code-style)
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (quickOpenOpen) {
				return;
			}
			const mod = e.ctrlKey || e.metaKey;
			if (!mod || e.key.toLowerCase() !== 'p' || e.altKey) {
				return;
			}
			e.preventDefault();
			if (e.shiftKey) {
				openQuickOpen('>');
			} else {
				openQuickOpen('');
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [quickOpenOpen, openQuickOpen]);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (!mod) {
				return;
			}
			const key = e.key.toLowerCase();
			const typing = isEditableDomTarget(e.target);
			if (typing && !['b', 'j', 'f', '[', ']', '-', '=', '+', '0'].includes(key)) {
				return;
			}
			if (!e.shiftKey && !e.altKey && key === 'b') {
				e.preventDefault();
				toggleSidebarVisibility();
				return;
			}
			if (!e.shiftKey && !e.altKey && key === 'j') {
				if (layoutMode === 'editor' && workspace) {
					e.preventDefault();
					toggleTerminalVisibility();
				}
				return;
			}
			if (!e.shiftKey && e.altKey && key === 'b') {
				if (layoutMode === 'agent') {
					e.preventDefault();
					toggleDiffPanelVisibility();
				}
				return;
			}
			if (!e.shiftKey && !e.altKey && key === 'f') {
				e.preventDefault();
				openQuickOpen('');
				return;
			}
			if (e.shiftKey && !e.altKey && e.key === '[') {
				e.preventDefault();
				void goToPreviousThread();
				return;
			}
			if (e.shiftKey && !e.altKey && e.key === ']') {
				e.preventDefault();
				void goToNextThread();
				return;
			}
			if (!e.shiftKey && !e.altKey && e.key === '[') {
				e.preventDefault();
				void goThreadBack();
				return;
			}
			if (!e.shiftKey && !e.altKey && e.key === ']') {
				e.preventDefault();
				void goThreadForward();
				return;
			}
			if (!e.shiftKey && !e.altKey && (e.key === '=' || e.key === '+')) {
				e.preventDefault();
				zoomInUi();
				return;
			}
			if (!e.shiftKey && !e.altKey && e.key === '-') {
				e.preventDefault();
				zoomOutUi();
				return;
			}
			if (!e.shiftKey && !e.altKey && e.key === '0') {
				e.preventDefault();
				resetUiZoom();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [
		layoutMode,
		workspace,
		openQuickOpen,
		toggleSidebarVisibility,
		toggleTerminalVisibility,
		toggleDiffPanelVisibility,
		goToPreviousThread,
		goToNextThread,
		goThreadBack,
		goThreadForward,
		zoomInUi,
		zoomOutUi,
		resetUiZoom,
	]);

	useEffect(() => {
		const ed = monacoEditorRef.current;
		const range = pendingEditorHighlightRangeRef.current;
		if (!ed || !filePath.trim() || !range) {
			return;
		}
		const id = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				try {
					const model = ed.getModel();
					if (!model) {
						return;
					}
					const lc = model.getLineCount();
					const start = Math.max(1, Math.min(range.start, lc));
					const end = Math.max(start, Math.min(range.end, lc));
					/* 以读取区间的第一行为锚点（勿用区间中点），避免看起来像跳到末行 */
					ed.setPosition({ lineNumber: start, column: 1 });
					ed.revealLineInCenter(start);
					const endCol = model.getLineMaxColumn(end);
					const decorations = ed.deltaDecorations([], [
						{
							range: {
								startLineNumber: start,
								startColumn: 1,
								endLineNumber: end,
								endColumn: endCol,
							},
							options: {
								isWholeLine: true,
								className: 'ref-editor-highlight-line',
								overviewRuler: { color: 'rgba(212,175,55,0.6)', position: 1 },
							},
						},
					]);
					window.setTimeout(() => {
						try {
							ed.deltaDecorations(decorations, []);
						} catch {
							/* ignore */
						}
					}, 6500);
					pendingEditorHighlightRangeRef.current = null;
				} catch {
					/* 模型尚未就绪时忽略 */
				}
			});
		});
		return () => cancelAnimationFrame(id);
	}, [editorValue, filePath]);

	const composerRichSurface = useMemo(
		() => ({
			hero: composerRichHeroRef,
			bottom: composerRichBottomRef,
			inline: composerRichInlineRef,
		}),
		[]
	);

	/** 勿每轮 render 新建箭头传入 slash/at hooks，否则 applySlashSelection/handle*KeyDown 全链抖动 → sharedComposerProps 永久失效 */
	const getComposerSegmentsSetter = useCallback(
		(slot: AtComposerSlot) =>
			slot === 'inline' && resendIdxRef.current !== null ? setInlineResendSegments : setComposerSegments,
		[setInlineResendSegments, setComposerSegments]
	);

	const atMention = useComposerAtMention(getComposerSegmentsSetter, composerRichSurface, {
		gitChangedPaths,
		currentThreadTitle,
		workspaceOpen: !!workspace,
		searchFiles,
		onFileChipPreview: onAtMentionFileChipPreview,
		fileIndexReadyTick: atFileIndexReadyTick,
		layoutMode,
		editorPreviewFile: editorSidebarSelectedRel,
	});
	const slashCommand = useComposerSlashCommand(getComposerSegmentsSetter, composerRichSurface, {
		t,
		userCommands: mergedAgentCustomization.commands,
	});
	const syncComposerOverlays = useCallback(
		(root: HTMLElement, slot: AtComposerSlot) => {
			const slice = textBeforeCaretForAt(root);
			const caret = slice.length;
			if (getAtMentionRange(slice, caret)) {
				slashCommand.closeSlashMenu();
				atMention.syncAtFromRich(root, slot);
				return;
			}
			atMention.syncAtFromRich(root, slot);
			slashCommand.syncSlashFromRich(root, slot);
		},
		[atMention.syncAtFromRich, slashCommand.closeSlashMenu, slashCommand.syncSlashFromRich]
	);
	closeAtMenuLatestRef.current = atMention.closeAtMenu;

	useEffect(() => {
		if (resendFromUserIndex === null) {
			return;
		}
		const onDocPointerDown = (ev: PointerEvent) => {
			const t = ev.target;
			if (!(t instanceof Node)) {
				return;
			}
			if (inlineResendRootRef.current?.contains(t)) {
				return;
			}
			if (t instanceof Element && t.closest('.ref-at-menu, .ref-slash-menu, .ref-model-dd, .ref-plus-menu, .ref-plus-submenu')) {
				return;
			}
			closeAtMenuLatestRef.current();
			slashCommand.closeSlashMenu();
			composerRichInlineRef.current?.blur();
			setResendFromUserIndex(null);
			setInlineResendSegments([]);
		};
		document.addEventListener('pointerdown', onDocPointerDown, true);
		return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
	}, [resendFromUserIndex, slashCommand]);

	const commitStaged = async () => {
		if (!shell) {
			return;
		}
		setGitActionError(null);
		await shell.invoke('git:stageAll');
				await shell.invoke('git:commit', commitMsg || 'chore: async commit');
		setCommitMsg('');
		await refreshGit();
	};

	const onCommitOnly = async () => {
		if (!shell) {
			return;
		}
		try {
			await commitStaged();
		} catch (e) {
			setGitActionError(String(e));
		}
	};

	const onCommitAndPush = async () => {
		if (!shell) {
			return;
		}
		setGitActionError(null);
		try {
			await shell.invoke('git:stageAll');
				await shell.invoke('git:commit', commitMsg || 'chore: async commit');
			setCommitMsg('');
			const pr = (await shell.invoke('git:push')) as { ok: boolean; error?: string };
			if (!pr.ok) {
				setGitActionError(pr.error ?? t('app.pushFailed'));
			}
			await refreshGit();
		} catch (e) {
			setGitActionError(String(e));
		}
	};

	/**
	 * 从 localStorage 恢复「已保留/已撤销全部」或逐文件忽略，绑定当前线程最后一条助手正文。
	 * 降级为 useEffect（不涉及 DOM 测量）：主路径已由 onMessagesLoaded 在 startTransition
	 * 内同批设置，此处仅作为 streaming 期间和 currentId 变化的兜底。
	 * hash 相同时 restoreFileChangesState 内部短路，不触发额外 setState。
	 */
	useEffect(() => {
		restoreFileChangesState(currentId, messages, messagesThreadId);
	}, [currentId, messages, messagesThreadId, restoreFileChangesState]);

	/**
	 * Plan：切回线程或 loadMessages 完成后，若最后一条仍是带 QUESTIONS 的助手消息则恢复弹窗。
	 * 降级为 useEffect（不涉及 DOM 测量/同步布局），消除 messages 变化引起的额外同步 render 轮次。
	 */
	useEffect(() => {
		if (!currentId || messagesThreadId !== currentId) {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			return;
		}
		/* Team 模式：澄清题由 IPC plan_question_request 驱动，勿按 Plan 逻辑清空 */
		if (composerMode === 'team') {
			if (resendFromUserIndex !== null) {
				setPlanQuestion(null);
				setPlanQuestionRequestId(null);
			}
			return;
		}
		if (composerMode !== 'plan') {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			return;
		}
		if (resendFromUserIndex !== null) {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			return;
		}
		if (awaitingReply) {
			/* ask_plan_question 阻塞主进程时仍需保留弹窗与 requestId */
			if (!planQuestionRequestId) {
				setPlanQuestion(null);
				setPlanQuestionRequestId(null);
			}
			return;
		}
		const pending = pendingPlanQuestionFromMessages(messages);
		const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant');
		const hash = lastAsst ? hashAgentAssistantContent(lastAsst.content) : '';
		const dismissedHash = planQuestionDismissedByThreadRef.current.get(currentId);
		if (pending && dismissedHash === hash) {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			return;
		}
		if (pending) {
			setPlanQuestion(pending);
			setPlanQuestionRequestId(null);
		} else {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
		}
	}, [
		currentId,
		messagesThreadId,
		messages,
		composerMode,
		resendFromUserIndex,
		awaitingReply,
		planQuestionRequestId,
	]);

	const {
		messagesViewportRef,
		messagesTrackRef,
		pinMessagesToBottomRef,
		showScrollToBottomButton,
		onMessagesScroll,
		scrollMessagesToBottom,
		scheduleMessagesScrollToBottom,
		syncMessagesScrollIndicators,
	} = useMessagesScroll({
		hasConversation,
		currentId,
		currentIdRef,
		messages,
		messagesThreadId,
		messagesThreadIdRef,
	});

	useEffect(() => {
		if (composerRichAutoHeightRafRef.current !== null) {
			cancelAnimationFrame(composerRichAutoHeightRafRef.current);
			composerRichAutoHeightRafRef.current = null;
		}
		const applyFollowupHeight = (el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			el.style.height = '0px';
			const next = Math.min(140, Math.max(38, el.scrollHeight));
			el.style.height = `${next}px`;
		};
		const applyInlineEditHeight = (el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			el.style.height = '0px';
			const next = Math.min(200, Math.max(72, el.scrollHeight));
			el.style.height = `${next}px`;
		};
		const run = () => {
			composerRichAutoHeightRafRef.current = null;
			if (!hasConversation) {
				const h = composerRichHeroRef.current;
				if (h) {
					h.style.height = '';
				}
			}
			applyFollowupHeight(composerRichBottomRef.current);
			applyInlineEditHeight(composerRichInlineRef.current);
		};
		composerRichAutoHeightRafRef.current = requestAnimationFrame(run);
		return () => {
			if (composerRichAutoHeightRafRef.current !== null) {
				cancelAnimationFrame(composerRichAutoHeightRafRef.current);
				composerRichAutoHeightRafRef.current = null;
			}
		};
	}, [hasConversation, composerSegments, inlineResendSegments, resendFromUserIndex]);

	useEffect(() => {
		if (resendFromUserIndex === null) {
			return;
		}
		const id = requestAnimationFrame(() => {
			composerRichInlineRef.current?.focus();
		});
		return () => cancelAnimationFrame(id);
	}, [resendFromUserIndex]);

	const composerPlaceholder = useMemo(() => {
		switch (composerMode) {
			case 'ask':
				return t('composer.placeholder.ask');
			case 'plan':
				return t('composer.placeholder.plan');
			case 'team':
				return t('composer.placeholder.team');
			case 'debug':
				return t('composer.placeholder.debug');
			case 'agent':
			default:
				return t('composer.placeholder.agent');
		}
	}, [composerMode, t]);

	/** 有会话时底部胶囊：Cursor 式短占位 */
	const followUpComposerPlaceholder = useMemo(() => {
		switch (composerMode) {
			case 'ask':
				return t('composer.followup.ask');
			case 'plan':
				return t('composer.followup.plan');
			case 'team':
				return t('composer.followup.team');
			case 'debug':
				return t('composer.followup.debug');
			case 'agent':
			default:
				return t('composer.followup.default');
		}
	}, [composerMode, t]);

	const onPlanNewIdea = (e: React.KeyboardEvent) => {
		if (e.key === 'Tab' && e.shiftKey) {
			e.preventDefault();
			setComposerModePersist('plan');
			void onNewThread();
		}
	};

	const onSelectTeamTask = useCallback(
		(taskId: string) => {
			if (!currentId) {
				return;
			}
			setSelectedTask(currentId, taskId);
			setAgentRightSidebarView('team');
			if (layoutMode === 'agent') {
				setAgentRightSidebarOpen(true);
			}
		},
		[currentId, setSelectedTask, layoutMode]
	);

	const onTeamPlanApprove = useCallback(
		(proposalId: string, feedback?: string) => {
			if (!currentId || !shell) return;
			markTeamPlanProposalDecided(currentId, proposalId, true);
			void shell.invoke('team:planApprovalRespond', {
				proposalId,
				approved: true,
				feedbackText: feedback,
			});
		},
		[currentId, markTeamPlanProposalDecided, shell]
	);

	const onTeamPlanReject = useCallback(
		(proposalId: string, feedback?: string) => {
			if (!currentId || !shell) return;
			markTeamPlanProposalDecided(currentId, proposalId, false);
			void shell.invoke('team:planApprovalRespond', {
				proposalId,
				approved: false,
				feedbackText: feedback,
			});
		},
		[currentId, markTeamPlanProposalDecided, shell]
	);

	const onSelectAgentSession = useCallback(
		(agentId: string | null) => {
			if (!currentId) {
				return;
			}
			setSelectedAgent(currentId, agentId);
			setAgentRightSidebarView('agents');
			if (layoutMode === 'agent') {
				setAgentRightSidebarOpen(true);
			}
		},
		[currentId, setSelectedAgent, layoutMode]
	);

	const onSendAgentInput = useCallback(
		async (agentId: string, message: string, interrupt: boolean) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:sendInput', {
				threadId: currentId,
				agentId,
				message,
				interrupt,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('app.chatSendFailed'));
				return;
			}
			setSelectedAgent(currentId, agentId);
			showTransientToast(true, t('agent.session.sentToast'));
		},
		[currentId, shell, showTransientToast, t, setSelectedAgent]
	);

	const onSubmitAgentUserInput = useCallback(
		async (requestId: string, answers: Record<string, string>) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:userInputRespond', {
				requestId,
				answers,
			})) as { ok?: boolean; error?: string };
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('app.chatSendFailed'));
				return;
			}
			showTransientToast(true, t('agent.userInput.submittedToast'));
		},
		[currentId, shell, showTransientToast, t]
	);

	const onWaitAgent = useCallback(
		async (agentId: string) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:wait', {
				threadId: currentId,
				agentIds: [agentId],
				timeoutMs: 30000,
			})) as { ok?: boolean; timedOut?: boolean; statuses?: Record<string, { status: string }> };
			if (!result?.ok) {
				showTransientToast(false, t('agent.session.waitFailed'));
				return;
			}
			const status = result.statuses?.[agentId]?.status ?? 'running';
			showTransientToast(
				true,
				result.timedOut ? t('agent.session.waitTimedOut') : t('agent.session.waitDone', { status })
			);
		},
		[currentId, shell, showTransientToast, t]
	);

	const onResumeAgent = useCallback(
		async (agentId: string) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:resume', { threadId: currentId, agentId })) as {
				ok?: boolean;
				error?: string;
			};
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('agent.session.resumeFailed'));
				return;
			}
			showTransientToast(true, t('agent.session.resumeDone'));
		},
		[currentId, shell, showTransientToast, t]
	);

	const onCloseAgent = useCallback(
		async (agentId: string) => {
			if (!currentId || !shell) {
				return;
			}
			const result = (await shell.invoke('agent:close', { threadId: currentId, agentId })) as {
				ok?: boolean;
				error?: string;
			};
			if (!result?.ok) {
				showTransientToast(false, result?.error || t('agent.session.closeFailed'));
				return;
			}
			showTransientToast(true, t('agent.session.closeDone'));
		},
		[currentId, shell, showTransientToast, t]
	);

	const onOpenAgentTranscript = useCallback(
		(absPath: string) => {
			if (!shell || !absPath.trim()) {
				return;
			}
			void shell.invoke('shell:openDefault', absPath.trim());
		},
		[shell]
	);

	const onSubAgentToastClick = useCallback(
		async (threadId: string, agentId: string) => {
			if (!shell) {
				return;
			}
			if (threadId !== currentIdRef.current) {
				await shell.invoke('threads:select', threadId);
				setCurrentId(threadId);
				await loadMessages(threadId, onMessagesLoaded);
			}
			setSelectedAgent(threadId, agentId);
			setAgentRightSidebarView('agents');
			setAgentRightSidebarOpen(true);
		},
		[shell, loadMessages, onMessagesLoaded, setSelectedAgent]
	);

	useEffect(() => {
		const onResize = () => {
			setRailWidths((prev) => {
				const next = clampSidebarLayout(prev.left, prev.right);
				return next.left === prev.left && next.right === prev.right ? prev : next;
			});
			setEditorTerminalHeightPx((h) => clampEditorTerminalHeight(h));
		};
		window.addEventListener('resize', onResize);
		const unsubLayout = window.asyncShell?.subscribeLayout?.(onResize);
		return () => {
			window.removeEventListener('resize', onResize);
			unsubLayout?.();
		};
	}, []);

	const {
		beginResizeLeft,
		beginResizeRight,
		beginResizeEditorTerminal,
		resetRailWidths,
	} = useResizeRails({
		shell,
		sidebarLayoutStorageKey,
		railWidths,
		setRailWidths,
		editorTerminalHeightPx,
		setEditorTerminalHeightPx,
		editorTerminalHeightLsKey,
	});

	useEffect(() => {
		if (!editorThreadHistoryOpen && !editorChatMoreOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			const node = e.target as Node;
			if (editorHistoryMenuRef.current?.contains(node)) {
				return;
			}
			if (editorMoreMenuRef.current?.contains(node)) {
				return;
			}
			setEditorThreadHistoryOpen(false);
			setEditorChatMoreOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [editorThreadHistoryOpen, editorChatMoreOpen]);

	const onBeforeToggleGitBranchPicker = useCallback(() => {
		setPlusMenuOpen(false);
		setModelPickerOpen(false);
	}, []);

	const composerContextMeter = useMemo(() => {
		if (!hasSelectedModel || !defaultModel.trim()) {
			return null;
		}
		const entry = modelEntries.find((e) => e.id === defaultModel);
		const raw = entry?.contextWindowTokens;
		const isDefaultMax = raw == null || !Number.isFinite(raw) || raw <= 0;
		const maxTokens = isDefaultMax ? DEFAULT_CONTEXT_WINDOW_TOKENS_UI : Math.floor(raw);
		const usedEstimate = computeComposerContextUsedEstimate({
			messages,
			composerSegments,
		});
		return { maxTokens, usedEstimate, isDefaultMax };
	}, [
		hasSelectedModel,
		defaultModel,
		modelEntries,
		messages,
		composerSegments,
	]);

	// 共享给 ChatComposer（send/abort/newThread/openFile 由 ComposerActionsContext 注入，避免对象整体因箭头函数重建）
	const sharedComposerProps = useMemo(
		() => ({
			composerRichHeroRef,
			composerRichBottomRef,
			composerRichInlineRef,
			plusAnchorHeroRef,
			plusAnchorBottomRef,
			plusAnchorInlineRef,
			modelPillHeroRef,
			modelPillBottomRef,
			modelPillInlineRef,
			composerMode,
			hasConversation,
			composerPlaceholder,
			followUpComposerPlaceholder,
			plusMenuOpen,
			modelPickerOpen,
			modelPillLabel,
			awaitingReply,
			resendFromUserIndex,
			composerGitBranchAnchorRef,
			onBeforeToggleGitBranchPicker,
			composerContextMeter,
			setPlusMenuAnchorSlot,
			setModelPickerOpen,
			setPlusMenuOpen,
			setModelPickerAnchorSlot,
			persistComposerAttachments,
			syncComposerOverlays,
			setResendFromUserIndex,
			setInlineResendSegments,
			slashCommandKeyDown: slashCommand.handleSlashKeyDown,
			atMentionKeyDown: atMention.handleAtKeyDown,
		}),
		[
			composerRichHeroRef,
			composerRichBottomRef,
			composerRichInlineRef,
			plusAnchorHeroRef,
			plusAnchorBottomRef,
			plusAnchorInlineRef,
			modelPillHeroRef,
			modelPillBottomRef,
			modelPillInlineRef,
			composerMode,
			hasConversation,
			composerPlaceholder,
			followUpComposerPlaceholder,
			plusMenuOpen,
			modelPickerOpen,
			modelPillLabel,
			awaitingReply,
			resendFromUserIndex,
			composerGitBranchAnchorRef,
			onBeforeToggleGitBranchPicker,
			composerContextMeter,
			setPlusMenuAnchorSlot,
			setModelPickerOpen,
			setPlusMenuOpen,
			setModelPickerAnchorSlot,
			persistComposerAttachments,
			syncComposerOverlays,
			setResendFromUserIndex,
			setInlineResendSegments,
			slashCommand.handleSlashKeyDown,
			atMention.handleAtKeyDown,
		]
	);

	/** 内联编辑历史用户消息：v2 消息直接还原 parts；旧消息启发式解析 @ 引用（不拉全量路径列表） */
	const onStartInlineResend = useCallback(
		(userMessageIndex: number, content: string, parts?: UserMessagePart[]) => {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			setResendFromUserIndex(userMessageIndex);
			if (parts && parts.length > 0) {
				setInlineResendSegments(partsToSegments(parts));
				return;
			}
			setInlineResendSegments(
				userMessageToSegments(
					content,
					undefined,
					(mergedAgentCustomization.commands ?? []).map((command) => command.slash)
				)
			);
		},
		[mergedAgentCustomization.commands, setPlanQuestion, setPlanQuestionRequestId]
	);

	const plusMenuAnchorRefForDropdown =
		plusMenuAnchorSlot === 'hero'
			? plusAnchorHeroRef
			: plusMenuAnchorSlot === 'bottom'
				? plusAnchorBottomRef
				: plusAnchorInlineRef;
	const modelPickerAnchorRefForDropdown =
		modelPickerAnchorSlot === 'hero'
			? modelPillHeroRef
			: modelPickerAnchorSlot === 'bottom'
				? modelPillBottomRef
				: modelPillInlineRef;

	const renderThreadItem = useCallback(
		(th: ThreadInfo, threadListWorkspace?: string | null) => (
			<ThreadItem
				key={th.id}
				th={th}
				threadListWorkspace={threadListWorkspace}
				workspace={workspace}
				currentId={currentId}
				editingThreadId={editingThreadId}
				editingThreadTitleDraft={editingThreadTitleDraft}
				setEditingThreadTitleDraft={setEditingThreadTitleDraft}
				threadTitleDraftRef={threadTitleDraftRef}
				threadTitleInputRef={threadTitleInputRef}
				commitThreadTitleEdit={commitThreadTitleEdit}
				cancelThreadTitleEdit={cancelThreadTitleEdit}
				beginThreadTitleEdit={beginThreadTitleEdit}
				onSelectThread={onSelectThread}
				confirmDeleteId={confirmDeleteId}
				onDeleteThread={onDeleteThread}
				t={t}
			/>
		),
		[
			currentId,
			editingThreadId,
			editingThreadTitleDraft,
			t,
			setEditingThreadTitleDraft,
			threadTitleDraftRef,
			threadTitleInputRef,
			commitThreadTitleEdit,
			cancelThreadTitleEdit,
			beginThreadTitleEdit,
			onSelectThread,
			confirmDeleteId,
			onDeleteThread,
			workspace,
		]
	);

	const agentLeftSidebarProps = useAgentLeftSidebarProps({
		t,
		agentSidebarWorkspaces,
		renderThreadItem,
		editingWorkspacePath,
		editingWorkspaceNameDraft,
		setEditingWorkspaceNameDraft,
		workspaceNameDraftRef,
		workspaceNameInputRef,
		commitWorkspaceAliasEdit,
		cancelWorkspaceAliasEdit,
		handleWorkspacePrimaryAction,
		workspaceMenuPath,
		closeWorkspaceMenu,
		openWorkspaceMenu,
		onNewThread: composerInvokeNewThread,
		onNewThreadForWorkspace,
		setWorkspacePickerOpen,
		openQuickOpen,
		openSettingsPage,
		openUniversalTerminal,
	});

	/** 未打开工作区时：Agent / Editor 均显示同一套欢迎页（打开项目、最近项目等） */
	const isEditorHomeMode = !workspace;
	const agentPlanSummaryCard = useMemo(
		() =>
			!awaitingReply && agentPlanEffectivePlan && composerMode === 'plan' ? (
				<section className="ref-plan-brief-card" aria-label={t('plan.review.label')}>
					<div className="ref-plan-brief-head">
						<div className="ref-plan-brief-title-stack">
							<span className="ref-plan-brief-kicker">{t('plan.review.label')}</span>
							<strong className="ref-plan-brief-title">{agentPlanEffectivePlan.name}</strong>
						</div>
						<div className="ref-plan-brief-actions">
							<button
								type="button"
								className="ref-plan-brief-review-btn"
								onClick={() => openAgentRightSidebarView('plan')}
							>
								{t('plan.review.reviewButton')}
							</button>
							<button
								type="button"
								className="ref-agent-plan-build-btn ref-agent-plan-build-btn--summary"
								disabled={
									awaitingReply ||
									!agentPlanEffectivePlan ||
									!agentPlanBuildModelId.trim() ||
									modelPickerItems.length === 0
								}
								onClick={() => onPlanBuild(agentPlanBuildModelId)}
							>
								{t('plan.review.build')}
							</button>
						</div>
					</div>
					<div className="ref-plan-brief-goal">
						<span className="ref-plan-brief-item-label">{t('plan.review.goal')}</span>
						<div className="ref-plan-brief-goal-markdown">
							<ChatMarkdown
								content={
									agentPlanGoalMarkdown ||
									agentPlanGoalSummary ||
									agentPlanEffectivePlan.overview ||
									t('plan.review.summaryEmpty')
								}
							/>
						</div>
					</div>
				</section>
			) : null,
		[
			awaitingReply,
			agentPlanEffectivePlan,
			composerMode,
			t,
			openAgentRightSidebarView,
			agentPlanBuildModelId,
			modelPickerItems,
			onPlanBuild,
			agentPlanGoalMarkdown,
			agentPlanGoalSummary,
		]
	);

	const agentChatPanelProps = useAgentChatPanelProps({
		t,
		hasConversation,
		persistedMessages: messages,
		messagesThreadId,
		currentId,
		messagesViewportRef,
		messagesTrackRef,
		inlineResendRootRef,
		onMessagesScroll,
		awaitingReply,
		streamStartedAtRef,
		firstTokenAtRef,
		thoughtSecondsByThread,
		lastTurnUsage,
		composerMode,
		workspace,
		workspaceBasename,
		knownSlashCommands: (mergedAgentCustomization.commands ?? []).map((command) => command.slash),
		revertedFiles,
		revertedChangeKeys,
		resendFromUserIndex,
		inlineResendSegments,
		setInlineResendSegments,
		composerSegments,
		setComposerSegments,
		canSendComposer,
		canSendInlineResend,
		sharedComposerProps,
		onChatPanelDropFiles,
		onStartInlineResend,
		shell,
		onExplorerOpenFile,
		onAgentConversationOpenFile,
		pendingAgentPatches,
		agentReviewBusy,
		onApplyAgentPatchOne,
		onApplyAgentPatchesAll,
		onDiscardAgentReview,
		planQuestion: activePlanQuestion,
		onPlanQuestionSubmit,
		onPlanQuestionSkip,
		userInputRequest: activeUserInputRequest,
		onUserInputSubmit,
		wizardPending,
		setWizardPending,
		executeSkillCreatorSend,
		executeRuleWizardSend,
		executeSubagentWizardSend,
		mistakeLimitRequest,
		respondMistakeLimit,
		agentPlanEffectivePlan,
		editorPlanReviewDismissed,
		planFileRelPath,
		planFilePath,
		defaultModel,
		modelPickerItems,
		planReviewIsBuilt,
		onPlanBuild,
		onPlanReviewClose,
		onPlanTodoToggle,
		toolApprovalRequest,
		respondToolApproval,
		snapshotPaths: EMPTY_SNAPSHOT_PATHS,
		dismissedFiles,
		fileChangesDismissed,
		onKeepAllEdits,
		onRevertAllEdits,
		onKeepFileEdit,
		onRevertFileEdit,
		showScrollToBottomButton,
		scrollMessagesToBottom,
		agentPlanSummaryCard,
		teamSession,
		onSelectTeamExpert: onSelectTeamTask,
		onTeamPlanApprove,
		onTeamPlanReject,
	});


	const agentRightSidebarProps = useAgentRightSidebarProps({
		open: agentRightSidebarOpen,
		view: agentRightSidebarView,
		hasAgentPlanSidebarContent,
		setAgentRightSidebarOpen,
		openAgentRightSidebarView,
		onOpenBrowserSettings: openBrowserSettingsPage,
		onExplorerOpenFile,
		planPreviewTitle: agentPlanPreviewTitle ?? '',
		planPreviewMarkdown: agentPlanPreviewMarkdown,
		planDocumentMarkdown: agentPlanDocumentMarkdown,
		planFileRelPath,
		planFilePath,
		agentPlanBuildModelId,
		setAgentPlanBuildModelId,
		awaitingReply,
		agentPlanEffectivePlan,
		onPlanBuild,
		planReviewIsBuilt,
		agentPlanTodoDoneCount,
		agentPlanTodos,
		onPlanAddTodo,
		planTodoDraftOpen,
		planTodoDraftInputRef,
		planTodoDraftText,
		setPlanTodoDraftText,
		onPlanAddTodoSubmit,
		onPlanAddTodoCancel,
		onPlanTodoToggle,
		agentFilePreview,
		openFileInTab,
		onAcceptAgentFilePreviewHunk,
		onRevertAgentFilePreviewHunk,
		agentFilePreviewBusyPatch,
		commitMsg,
		setCommitMsg,
		onCommitOnly,
		onCommitAndPush,
		teamSession,
		onSelectTeamExpert: onSelectTeamTask,
		workspaceRoot: workspace,
		onOpenTeamAgentFile: onAgentConversationOpenFile,
		revertedPaths: revertedFiles,
		revertedChangeKeys,
		agentSession,
		currentThreadId: currentId,
		onSelectAgentSession,
		onSendAgentInput,
		onSubmitAgentUserInput,
		onWaitAgent,
		onResumeAgent,
		onCloseAgent,
		onOpenAgentTranscript,
	});

	const editorMainPanelProps = useEditorMainPanelProps({
		t,
		openTabs,
		activeTabId,
		onCloseTab,
		showEditorPlanDocumentInCenter,
		showEditorTeamWorkflowInCenter,
		planFileRelPath,
		planFilePath,
		editorPlanBuildModelId,
		setEditorPlanBuildModelId,
		modelPickerItems,
		planReviewIsBuilt,
		awaitingReply,
		editorCenterPlanCanBuild,
		onPlanBuild,
		editorCenterPlanMarkdown,
		filePath: filePath.trim(),
		markdownPaneMode,
		setMarkdownPaneMode,
		showPlanFileEditorChrome,
		editorPlanFileIsBuilt,
		onExecutePlanFromEditor,
		markdownPreviewContent,
		activeEditorInlineDiff,
		monacoChromeTheme,
		monacoOriginalDocumentPath,
		monacoDocumentPath,
		editorValue,
		onMonacoMount,
		onMonacoDiffMount,
		editorSettings,
		editorTerminalVisible,
		beginResizeEditorTerminal,
		editorTerminalHeightPx,
		editorTerminalSessions,
		activeEditorTerminalId,
		setActiveEditorTerminalId,
		closeEditorTerminalSession,
		closeEditorTerminalPanel,
		onEditorTerminalSessionExit,
		setWorkspacePickerOpen,
		onLoadFile,
		onSaveFile,
		appendEditorTerminal,
		setEditorValue,
		setOpenTabs,
		onSelectTab,
		teamSession,
		selectedTeamTaskId: teamSession?.selectedTaskId ?? null,
		onSelectTeamTask,
		workspaceRoot: workspace,
		onOpenTeamAgentFile: onAgentConversationOpenFile,
		revertedPaths: revertedFiles,
		revertedChangeKeys,
	});

	const editorLeftSidebarProps = useMemo(
		() => ({
			shell,
			workspace,
			workspaceBasename,
			ipcOk,
			editorLeftSidebarView,
			setEditorLeftSidebarView,
			editorExplorerCollapsed,
			toggleEditorExplorerCollapsed,
			editorSidebarWorkspaceLabel,
			editorSidebarSelectedRel,
			editorExplorerScrollRef,
			workspaceExplorerActions,
			editorSidebarSearchQuery,
			setEditorSidebarSearchQuery,
			normalizedEditorSidebarSearchQuery,
			editorSidebarSearchResults,
			editorSidebarSearchInputRef,
			fileMenuNewFile,
			revealWorkspaceInOs,
			onExplorerOpenFile,
			setWorkspacePickerOpen,
			openSettingsPage,
		}),
		[
			shell,
			workspace,
			workspaceBasename,
			ipcOk,
			editorLeftSidebarView,
			setEditorLeftSidebarView,
			editorExplorerCollapsed,
			toggleEditorExplorerCollapsed,
			editorSidebarWorkspaceLabel,
			editorSidebarSelectedRel,
			editorExplorerScrollRef,
			workspaceExplorerActions,
			editorSidebarSearchQuery,
			setEditorSidebarSearchQuery,
			normalizedEditorSidebarSearchQuery,
			editorSidebarSearchResults,
			editorSidebarSearchInputRef,
			fileMenuNewFile,
			revealWorkspaceInOs,
			onExplorerOpenFile,
			setWorkspacePickerOpen,
			openSettingsPage,
		]
	);

	const shellWorkspaceCenterMain = useMemo(() => {
		if (layoutMode === 'agent') {
			return (
				<AgentAgentCenterColumn
					t={t}
					hasConversation={hasConversation}
					workspace={workspace}
					workspaceBasename={workspaceBasename}
					onPlanNewIdea={onPlanNewIdea}
					hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
					agentRightSidebarOpen={agentRightSidebarOpen}
					agentRightSidebarView={agentRightSidebarView}
					toggleAgentRightSidebarView={toggleAgentRightSidebarView}
					onOpenBrowserWindow={() => {
						void shell?.invoke('browser:openWindow').catch(() => {
							/* ignore */
						});
					}}
					onLaunchWorkspaceWithTool={(tool) => {
						void launchWorkspaceWithTool(tool);
					}}
					chatPanelProps={agentChatPanelProps}
				/>
			);
		}
		return (
			<Suspense
				fallback={
					<main
						className="ref-center ref-center--editor-workspace ref-center--editor-shell"
						aria-label={t('app.editorWorkspaceMainAria')}
						aria-busy="true"
					>
						<div className="ref-editor-center-split" />
					</main>
				}
			>
				<DevProfiler id="EditorMainPanel">
					<EditorMainPanel {...editorMainPanelProps} />
				</DevProfiler>
			</Suspense>
		);
	}, [
		layoutMode,
		t,
		hasConversation,
		workspace,
		workspaceBasename,
		onPlanNewIdea,
		hasAgentPlanSidebarContent,
		agentRightSidebarOpen,
		agentRightSidebarView,
		toggleAgentRightSidebarView,
		shell,
		launchWorkspaceWithTool,
		agentChatPanelProps,
		editorMainPanelProps,
	]);

	const shellLeftRailGroupProps = useMemo(
		(): ShellLeftRailGroupProps => ({
			layoutMode,
			leftSidebarOpen,
			t,
			beginResizeLeft,
			resetRailWidths,
			agentLeftSidebarProps,
			editorLeftSidebarProps,
		}),
		[
			layoutMode,
			leftSidebarOpen,
			t,
			beginResizeLeft,
			resetRailWidths,
			agentLeftSidebarProps,
			editorLeftSidebarProps,
		]
	);

	const shellCenterRightGroupProps = useMemo(
		(): ShellCenterRightGroupProps => ({
			layoutMode,
			agentRightSidebarOpen,
			t,
			centerMain: shellWorkspaceCenterMain,
			hasConversation,
			onPlanNewIdea,
			agentChatPanelProps,
			agentRightSidebarProps,
			beginResizeRight,
			resetRailWidths,
			threadsChrono,
			currentId,
			onSelectThread,
			confirmDeleteId,
			onDeleteThread,
			editorThreadHistoryOpen,
			setEditorThreadHistoryOpen,
			editorChatMoreOpen,
			setEditorChatMoreOpen,
			editorHistoryMenuRef,
			editorMoreMenuRef,
			threadSearch,
			setThreadSearch,
			todayThreads,
			archivedThreads,
			renderThreadItem,
			setComposerModePersist,
			onNewThread,
			setWorkspaceToolsOpen,
			handleCloseEditorChatMore,
			handleOpenSettingsGeneral,
		}),
		[
			layoutMode,
			agentRightSidebarOpen,
			t,
			shellWorkspaceCenterMain,
			hasConversation,
			onPlanNewIdea,
			agentChatPanelProps,
			agentRightSidebarProps,
			beginResizeRight,
			resetRailWidths,
			threadsChrono,
			currentId,
			onSelectThread,
			confirmDeleteId,
			onDeleteThread,
			editorThreadHistoryOpen,
			setEditorThreadHistoryOpen,
			editorChatMoreOpen,
			setEditorChatMoreOpen,
			editorHistoryMenuRef,
			editorMoreMenuRef,
			threadSearch,
			setThreadSearch,
			todayThreads,
			archivedThreads,
			renderThreadItem,
			setComposerModePersist,
			onNewThread,
			setWorkspaceToolsOpen,
			handleCloseEditorChatMore,
			handleOpenSettingsGeneral,
		]
	);

	const composerActions = useMemo(
		() => ({
			onSend: composerInvokeSend,
			onAbort,
			onNewThread: composerInvokeNewThread,
			onExplorerOpenFile: composerExplorerOpenRel,
		}),
		[composerInvokeSend, onAbort, composerInvokeNewThread, composerExplorerOpenRel]
	);

	// 开发环境下追踪切换后的渲染情况
	const appRenderCountRef = useRef(0);
	const lastThreadIdRef = useRef<string | null>(null);
	const threadSwitchTimeRef = useRef<number>(0);
	const appRenderStartRef = useRef<number>(0);
	if (import.meta.env.DEV && currentId !== lastThreadIdRef.current) {
		appRenderCountRef.current = 0;
		lastThreadIdRef.current = currentId;
		threadSwitchTimeRef.current = Date.now();
		console.log(`[perf] ===== Thread changed to ${currentId}, starting render counter =====`);
	}
	if (import.meta.env.DEV) {
		appRenderStartRef.current = performance.now();
		appRenderCountRef.current += 1;
		const elapsed = Date.now() - threadSwitchTimeRef.current;
		if (appRenderCountRef.current <= 5 || appRenderCountRef.current % 10 === 0) {
			console.log(
				`[perf] App render #${appRenderCountRef.current} at +${elapsed}ms for currentId=${currentId ?? 'null'} msgsThread=${messagesThreadId ?? 'null'}`
			);
		}
	}

	// 渲染完成后记录耗时并追踪触发源（必须无条件调用 hook，仅在 DEV 内记录）
	useEffect(() => {
		if (!import.meta.env.DEV) {
			return;
		}
		const renderTime = performance.now() - appRenderStartRef.current;
		if (renderTime > 10) {
			const triggers = [];
			if (messagesThreadId) triggers.push(`thread=${messagesThreadId}`);
			if (messages.length > 0) triggers.push(`msgs=${messages.length}`);
			if (awaitingReply) triggers.push('awaiting');
			console.log(
				`[perf] App render completed in ${renderTime.toFixed(1)}ms, count=${appRenderCountRef.current}, triggers: ${triggers.join(', ') || 'none'}`
			);
		}
	});

	const shellSettingsPageProps = useMemo(
		(): SettingsPageProps => ({
			initialNav: settingsInitialNav,
			onClose: () => void closeSettingsPage(),
			defaultModel,
			modelProviders,
			modelEntries,
			providerIdentity,
			onChangeModelProviders,
			onChangeModelEntries,
			onChangeProviderIdentity: setProviderIdentity,
			onPickDefaultModel: (id) => void onPickDefaultModel(id),
			agentCustomization: mergedAgentCustomization,
			onChangeAgentCustomization: onChangeMergedAgentCustomization,
			teamSettings,
			onChangeTeamSettings: setTeamSettings,
			botIntegrations,
			onChangeBotIntegrations,
			editorSettings,
			onChangeEditorSettings: setEditorSettings,
			onPersistLanguage: (loc) => void onPersistLanguage(loc),
			mcpServers,
			onChangeMcpServers: setMcpServers,
			mcpStatuses,
			onRefreshMcpStatuses: onRefreshMcpStatuses,
			onStartMcpServer,
			onStopMcpServer,
			onRestartMcpServer,
			shell: shell ?? null,
			workspaceOpen: !!workspace,
			onOpenSkillCreator: startSkillCreatorFlow,
			onOpenWorkspaceSkillFile: handleOpenWorkspaceSkillFile,
			onDeleteWorkspaceSkillDisk: handleDeleteWorkspaceSkillDisk,
			colorMode,
			onChangeColorMode: (m, origin) => void onChangeColorMode(m, origin),
			effectiveColorScheme: effectiveScheme,
			appearanceSettings,
			onChangeAppearanceSettings: setAppearanceSettings,
		}),
		[
			settingsInitialNav,
			closeSettingsPage,
			defaultModel,
			modelProviders,
			modelEntries,
			providerIdentity,
			onChangeModelProviders,
			onChangeModelEntries,
			setProviderIdentity,
			onPickDefaultModel,
			mergedAgentCustomization,
			onChangeMergedAgentCustomization,
			teamSettings,
			setTeamSettings,
			botIntegrations,
			setBotIntegrations,
			editorSettings,
			setEditorSettings,
			onPersistLanguage,
			mcpServers,
			setMcpServers,
			mcpStatuses,
			onRefreshMcpStatuses,
			onStartMcpServer,
			onStopMcpServer,
			onRestartMcpServer,
			shell,
			workspace,
			startSkillCreatorFlow,
			handleOpenWorkspaceSkillFile,
			handleDeleteWorkspaceSkillDisk,
			colorMode,
			onChangeColorMode,
			effectiveScheme,
			appearanceSettings,
			setAppearanceSettings,
		]
	);

	const composerPlusSkills = useMemo(
		() =>
			(mergedAgentCustomization.skills ?? [])
				.filter((skill) => skill.enabled !== false && skill.slug.trim().length > 0)
				.map((skill) => ({
					id: skill.id,
					name: skill.name,
					slug: skill.slug.trim(),
					description: skill.description.trim() || skill.content.trim().slice(0, 140),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[mergedAgentCustomization.skills]
	);

	const composerPlusMcpServers = useMemo(() => {
		const statusById = new Map(mcpStatuses.map((status) => [status.id, status]));
		return mcpServers.map((server) => {
			const status = statusById.get(server.id);
			return {
				id: server.id,
				name: server.name,
				enabled: server.enabled,
				transport: server.transport,
				status: status?.status ?? (server.enabled ? 'not_started' : 'disabled'),
				error: status?.error,
				toolsCount: status?.tools.length ?? 0,
			};
		});
	}, [mcpServers, mcpStatuses]);

	return (
		<AppProvider shell={shell} workspace={workspace} t={t}>
		<ComposerActionsProvider value={composerActions}>
		<div className={`ref-shell ${layoutMode === 'agent' ? 'ref-shell--agent-layout' : ''}`}>
			<MessagesScrollSync
				hasConversation={hasConversation}
				pinMessagesToBottomRef={pinMessagesToBottomRef}
				scheduleMessagesScrollToBottom={scheduleMessagesScrollToBottom}
				syncMessagesScrollIndicators={syncMessagesScrollIndicators}
			/>
			<AppShellMenubar
				layoutMode={layoutMode}
				hasAgentLayout={layoutWindowAvailability.agent}
				hasEditorLayout={layoutWindowAvailability.editor}
				t={t}
				shell={shell}
				workspace={workspace}
				folderRecents={folderRecents}
				activeTabId={activeTabId}
				windowMaximized={windowMaximized}
				fileMenuRef={fileMenuRef}
				editMenuRef={editMenuRef}
				viewMenuRef={viewMenuRef}
				windowMenuRef={windowMenuRef}
				terminalMenuRef={terminalMenuRef}
				helpMenuRef={helpMenuRef}
				fileMenuOpen={fileMenuOpen}
				editMenuOpen={editMenuOpen}
				viewMenuOpen={viewMenuOpen}
				windowMenuOpen={windowMenuOpen}
				terminalMenuOpen={terminalMenuOpen}
				helpMenuOpen={helpMenuOpen}
				handleToggleFileMenu={handleToggleFileMenu}
				handleToggleEditMenu={handleToggleEditMenu}
				setMenubarMenu={setMenubarMenu}
				toggleMenubarMenu={toggleMenubarMenu}
				fileMenuNewFile={fileMenuNewFile}
				fileMenuNewWindow={fileMenuNewWindow}
				fileMenuNewEditorWindow={fileMenuNewEditorWindow}
				fileMenuOpenFile={fileMenuOpenFile}
				fileMenuOpenFolder={fileMenuOpenFolder}
				openWorkspaceByPath={openWorkspaceByPath}
				onSaveFile={onSaveFile}
				fileMenuSaveAs={fileMenuSaveAs}
				fileMenuRevertFile={fileMenuRevertFile}
				fileMenuCloseEditor={fileMenuCloseEditor}
				closeWorkspaceFolder={closeWorkspaceFolder}
				fileMenuQuit={fileMenuQuit}
				canEditUndoRedo={canEditUndoRedo}
				canEditCut={canEditCut}
				canEditCopy={canEditCopy}
				canEditPaste={canEditPaste}
				canEditSelectAll={canEditSelectAll}
				executeEditAction={executeEditAction}
				toggleSidebarVisibility={toggleSidebarVisibility}
				canToggleTerminal={canToggleTerminal}
				toggleTerminalVisibility={toggleTerminalVisibility}
				canToggleDiffPanel={canToggleDiffPanel}
				toggleDiffPanelVisibility={toggleDiffPanelVisibility}
				openQuickOpen={openQuickOpen}
				canGoPrevThread={canGoPrevThread}
				goToPreviousThread={goToPreviousThread}
				canGoNextThread={canGoNextThread}
				goToNextThread={goToNextThread}
				canGoBackThread={canGoBackThread}
				goThreadBack={goThreadBack}
				canGoForwardThread={canGoForwardThread}
				goThreadForward={goThreadForward}
				zoomInUi={zoomInUi}
				zoomOutUi={zoomOutUi}
				resetUiZoom={resetUiZoom}
				toggleFullscreen={toggleFullscreen}
				windowMenuMinimize={windowMenuMinimize}
				windowMenuToggleMaximize={windowMenuToggleMaximize}
				windowMenuCloseWindow={windowMenuCloseWindow}
				spawnEditorTerminal={spawnEditorTerminal}
				onReturnToAgentLayout={() => void handleOpenAgentLayoutWindow()}
				onEnterEditorLayout={() => void handleOpenEditorLayoutWindow()}
				handleOpenSettingsGeneral={handleOpenSettingsGeneral}
				handleOpenAutoUpdate={handleOpenAutoUpdate}
			/>

			{isEditorHomeMode ? (
				<AppWorkspaceWelcome
					t={t}
					homeRecents={homeRecents}
					onOpenWorkspacePicker={() => setWorkspacePickerOpen(true)}
					onOpenWorkspacePath={(p) => void openWorkspaceByPath(p)}
				/>
			) : (
				<ShellWorkspaceGrid
					layoutMode={layoutMode}
					leftSidebarOpen={leftSidebarOpen}
					agentRightSidebarOpen={agentRightSidebarOpen}
					railWidths={railWidths}
					leftRail={shellLeftRailGroupProps}
					centerRight={shellCenterRightGroupProps}
				/>
			)}

			<AppShellOverlays
				t={t}
				shell={shell}
				workspace={workspace}
				homePath={homePath}
				workspaceFileList={workspaceFileListRef.current}
				homeRecents={homeRecents}
				filePath={filePath}
				searchWorkspaceSymbolsFn={searchWorkspaceSymbolsFn}
				applyWorkspacePath={applyWorkspacePath}
				openWorkspaceByPath={openWorkspaceByPath}
				workspaceMenuRef={workspaceMenuRef}
				activeWorkspaceMenuItem={activeWorkspaceMenuItem}
				workspaceMenuPosition={workspaceMenuPosition}
				revealWorkspaceInOs={revealWorkspaceInOs}
				beginWorkspaceAliasEdit={beginWorkspaceAliasEdit}
				removeWorkspaceFromSidebar={removeWorkspaceFromSidebar}
				workspaceToolsOpen={workspaceToolsOpen}
				handleCloseWorkspaceTools={handleCloseWorkspaceTools}
				workspacePickerOpen={workspacePickerOpen}
				handleCloseWorkspacePicker={handleCloseWorkspacePicker}
				setWorkspacePickerOpen={setWorkspacePickerOpen}
				quickOpenOpen={quickOpenOpen}
				handleCloseQuickOpen={handleCloseQuickOpen}
				quickOpenRecentFiles={quickOpenRecentFiles}
				quickOpenSeed={quickOpenSeed}
				onExplorerOpenFile={onExplorerOpenFile}
				handleOpenSettingsGeneral={handleOpenSettingsGeneral}
				focusSearchSidebarFromQuickOpen={focusSearchSidebarFromQuickOpen}
				goToLineInEditor={goToLineInEditor}
				settingsPageOpen={settingsPageOpen}
				settingsOpenPending={settingsOpenPending}
				closeSettingsPage={closeSettingsPage}
				settingsPageProps={shellSettingsPageProps}
				layoutSwitchPending={layoutSwitchPending}
				layoutSwitchTarget={layoutSwitchTarget}
				plusMenuOpen={plusMenuOpen}
				handleClosePlusMenu={handleClosePlusMenu}
				plusMenuAnchorRefForDropdown={plusMenuAnchorRefForDropdown}
				composerMode={composerMode}
				setComposerModePersist={setComposerModePersist}
				onComposerPickImages={pickComposerImagesFromDialog}
				composerPlusSkills={composerPlusSkills}
				onComposerInsertSkill={insertComposerSkillInvocation}
				handleOpenSettingsRules={handleOpenSettingsRules}
				composerPlusMcpServers={composerPlusMcpServers}
				onComposerToggleMcpServer={toggleComposerMcpServerEnabled}
				handleOpenSettingsTools={handleOpenSettingsTools}
				composerGitBranchAnchorRef={composerGitBranchAnchorRef}
				showTransientToast={showTransientToast}
				modelPickerOpen={modelPickerOpen}
				handleCloseModelPicker={handleCloseModelPicker}
				modelPickerAnchorRefForDropdown={modelPickerAnchorRefForDropdown}
				modelPickerItems={modelPickerItems}
				defaultModel={defaultModel}
				onPickDefaultModel={onPickDefaultModel}
				handleOpenSettingsModels={handleOpenSettingsModels}
				thinkingByModelId={thinkingByModelId}
				setThinkingByModelId={setThinkingByModelId}
				atMenuOpen={atMention.atMenuOpen}
				atMenuItems={atMention.atMenuItems}
				atMenuFileSearchLoading={atMention.atMenuFileSearchLoading}
				atMenuHighlight={atMention.atMenuHighlight}
				atCaretRect={atMention.atCaretRect}
				setAtMenuHighlight={atMention.setAtMenuHighlight}
				applyAtSelection={atMention.applyAtSelection}
				closeAtMenu={atMention.closeAtMenu}
				slashMenuOpen={slashCommand.slashMenuOpen}
				slashQuery={slashCommand.slashQuery}
				slashMenuItems={slashCommand.slashMenuItems}
				slashMenuHighlight={slashCommand.slashMenuHighlight}
				slashCaretRect={slashCommand.slashCaretRect}
				setSlashMenuHighlight={slashCommand.setSlashMenuHighlight}
				applySlashSelection={slashCommand.applySlashSelection}
				closeSlashMenu={slashCommand.closeSlashMenu}
				saveToastVisible={saveToastVisible}
				saveToastKey={saveToastKey}
				subAgentBgToast={subAgentBgToast}
				composerAttachErr={composerAttachErr}
				onSubAgentToastClick={onSubAgentToastClick}
			/>


		</div>
		</ComposerActionsProvider>
		</AppProvider>
	);
}

const AppMainWorkspace = memo(AppMainWorkspaceInner);

