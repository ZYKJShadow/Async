import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	startTransition,
	useTransition,
	memo,
	type RefObject,
} from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';

import { ChatMarkdown } from './ChatMarkdown';
import { type WorkspaceExplorerActions } from './WorkspaceExplorer';
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
	writePersistedAgentFileChanges,
} from './agentFileChangesPersist';
import { normalizeWorkspaceRelPath, workspaceRelPathsEqual } from './agentFileChangesFromGit';
import { computeMergedAgentFileChanges } from './agentFileChangesCompute';
import type { SettingsNavId, SettingsPageProps } from './SettingsPage';
import {
	applyThemePresetToAppearance,
	applyAppearanceSettingsToDom,
	defaultAppearanceSettings,
	nativeWindowChromeFromAppearance,
	replaceBuiltinChromeColorsForScheme,
	shouldMigrateChromeWhenLeavingScheme,
	type AppAppearanceSettings,
} from './appearanceSettings';
import { useAppColorScheme } from './useAppColorScheme';
import {
	type AppColorMode,
	getVoidMonacoTheme,
	readStoredColorMode,
	type ThemeTransitionOrigin,
	writeStoredColorMode,
} from './colorMode';
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
	type ComposerSegment,
} from './composerSegments';
import {
	computeComposerContextUsedEstimate,
	DEFAULT_CONTEXT_WINDOW_TOKENS_UI,
} from './contextMeterFormat';
import { getAtMentionRange } from './composerAtMention';
import { textBeforeCaretForAt } from './composerRichDom';
import { useComposerAtMention, type AtComposerSlot } from './useComposerAtMention';
import { useComposerSlashCommand } from './useComposerSlashCommand';
import { type AgentRuleScope } from './agentSettingsTypes';
import { normalizeIndexingSettings, type IndexingSettingsState } from './indexingSettingsTypes';

const EMPTY_AGENT_PENDING_PATCHES: AgentPendingPatch[] = [];
import { tabIdFromPath, type MarkdownTabView } from './EditorTabBar';
import {
	isMarkdownEditorPath,
	markdownViewForTab,
	stripLeadingYamlFrontmatter,
	stripPlanFrontmatterForPreview,
} from './editorMarkdownView';
import { isPlanMdPath, planExecutedKey } from './planExecutedKey';
import { workspaceRelativeFileUrl } from './workspaceUri';
import { voidShellDebugLog } from './tabCloseDebug';
import { IconPencil, IconTrash, IconCheckCircle } from './icons';
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
import { useEditorTabs, type EditorInlineDiffState, clampEditorTerminalHeight } from './hooks/useEditorTabs';
import { AppWorkspaceWelcome } from './app/AppWorkspaceWelcome';
import { AgentAgentCenterColumn } from './app/AgentAgentCenterColumn';
import type { ComposerAnchorSlot } from './ChatComposer';
import { AppProvider } from './AppContext';
import { ComposerActionsProvider } from './ComposerActionsContext';
import { runDesktopShellInit } from './app/desktopShellInit';
import {
	DEFAULT_SHELL_LAYOUT_MODE_KEY,
	DEFAULT_SIDEBAR_LAYOUT_KEY,
	clampSidebarLayout,
	defaultQuarterRailWidths,
	readSidebarLayout,
	readStoredShellLayoutModeFromKey,
	syncDesktopSidebarLayout,
	type ShellLayoutMode,
} from './app/shellLayoutStorage';
import {
	AppShellProviders,
	useAppShellChrome,
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
import { formatThreadRowSubtitle, threadRowTitle } from './app/threadRowUi';

const EditorMainPanel = lazy(() => import('./EditorMainPanel').then((m) => ({ default: m.EditorMainPanel })));

type LayoutMode = ShellLayoutMode;
type AgentRightSidebarView = 'git' | 'plan' | 'file';
type EditorLeftSidebarView = 'explorer' | 'search' | 'git';
import { useI18n, type AppLocale } from './i18n';
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

export default function App({ appSurface }: { appSurface?: LayoutMode } = {}) {
	const shell = useAsyncShell();
	const layoutPinnedBySurface = appSurface !== undefined;
	const shellLsPrefix = appSurface === 'editor' ? 'void-shell:editor:' : '';
	const shellLayoutStorageKey = `${shellLsPrefix}${DEFAULT_SHELL_LAYOUT_MODE_KEY}`;
	const sidebarLayoutStorageKey = `${shellLsPrefix}${DEFAULT_SIDEBAR_LAYOUT_KEY}`;
	const [colorMode, setColorMode] = useState<AppColorMode>(() => readStoredColorMode());
	const [appearanceSettings, setAppearanceSettings] = useState<AppAppearanceSettings>(() => defaultAppearanceSettings());
	const { effectiveScheme, setTransitionOrigin } = useAppColorScheme({ colorMode });
	const monacoChromeTheme = getVoidMonacoTheme(effectiveScheme);
	const effectiveSchemePrevRef = useRef(effectiveScheme);
	const shellRef = useRef(shell);
	shellRef.current = shell;

	useEffect(() => {
		const prevScheme = effectiveSchemePrevRef.current;
		if (prevScheme !== effectiveScheme) {
			effectiveSchemePrevRef.current = effectiveScheme;
			setAppearanceSettings((cur) => {
				if (cur.themePresetId !== 'custom') {
					const next = applyThemePresetToAppearance(cur, cur.themePresetId, effectiveScheme);
					const s = shellRef.current;
					if (s) {
						queueMicrotask(() => {
							void s.invoke('settings:set', {
								ui: {
									themePresetId: next.themePresetId,
									accentColor: next.accentColor,
									backgroundColor: next.backgroundColor,
									foregroundColor: next.foregroundColor,
									contrast: next.contrast,
									translucentSidebar: next.translucentSidebar,
								},
							});
						});
					}
					return next;
				}
				if (!shouldMigrateChromeWhenLeavingScheme(cur, prevScheme)) {
					return cur;
				}
				const next = replaceBuiltinChromeColorsForScheme(cur, effectiveScheme);
				const s = shellRef.current;
				if (s) {
					queueMicrotask(() => {
						void s.invoke('settings:set', {
							ui: {
								themePresetId: next.themePresetId,
								accentColor: next.accentColor,
								backgroundColor: next.backgroundColor,
								foregroundColor: next.foregroundColor,
								contrast: next.contrast,
								translucentSidebar: next.translucentSidebar,
							},
						});
					});
				}
				return next;
			});
		}
	}, [effectiveScheme]);

	// 合并 appearanceSettings 相关的 DOM 更新,减少级联渲染
	useEffect(() => {
		applyAppearanceSettingsToDom(appearanceSettings, effectiveScheme);
		if (!shell) {
			return;
		}
		const c = nativeWindowChromeFromAppearance(appearanceSettings, effectiveScheme);
		void shell.invoke('theme:applyChrome', {
			scheme: effectiveScheme,
			backgroundColor: c.backgroundColor,
			titleBarColor: c.titleBarColor,
			symbolColor: c.symbolColor,
		});
	}, [shell, appearanceSettings, effectiveScheme]);

	const { t, setLocale, locale } = useI18n();
	const [ipcOk, setIpcOk] = useState<string>('…');

	// 初始值为默认值，init effect 加载完 settings:get 后会 setIndexingSettings 更新
	const [indexingSettings, setIndexingSettings] = useState<IndexingSettingsState>(() => normalizeIndexingSettings());

	// ── 提取的 hooks（必须在所有依赖其返回值的代码之前调用）──────────────────
	const {
		workspace,
		setWorkspace,
		workspaceFileListRef: _wfListRef,
		workspaceFileListVersion: _workspaceFileListVersion,
		ensureWorkspaceFileListLoaded: _ensureWorkspaceFileListLoaded,
		searchFiles: _searchFiles,
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
	} = useWorkspaceManager(shell);

	const {
		modelProviders,
		defaultModel,
		modelEntries,
		enabledModelIds,
		thinkingByModelId, setThinkingByModelId,
		hasSelectedModel,
		modelPickerItems,
		modelPillLabel,
		agentCustomization, setAgentCustomization,
		refreshWorkspaceDiskSkills,
		mergedAgentCustomization,
		onChangeMergedAgentCustomization,
		editorSettings, setEditorSettings,
		mcpServers, setMcpServers,
		mcpStatuses, setMcpStatuses,
		settingsPageOpen, setSettingsPageOpen,
		settingsInitialNav,
		settingsOpenPending,
		openSettingsPage: openSettingsPageBase,
		onPickDefaultModel,
		onChangeModelEntries,
		onChangeModelProviders,
		onPersistIndexingPatch,
		onRefreshMcpStatuses,
		onStartMcpServer,
		onStopMcpServer,
		onRestartMcpServer,
		applyLoadedSettings,
	} = useSettings(shell, workspace, t);

	const chromeSlice = useMemo(
		() => ({
			shell,
			t,
			setLocale,
			locale,
			ipcOk,
			setIpcOk,
			indexingSettings,
			setIndexingSettings,
			layoutPinnedBySurface,
			appSurface,
			shellLayoutStorageKey,
			sidebarLayoutStorageKey,
			colorMode,
			setColorMode,
			appearanceSettings,
			setAppearanceSettings,
			effectiveScheme,
			setTransitionOrigin,
			monacoChromeTheme,
		}),
		[
			shell,
			t,
			setLocale,
			locale,
			ipcOk,
			setIpcOk,
			indexingSettings,
			setIndexingSettings,
			layoutPinnedBySurface,
			appSurface,
			shellLayoutStorageKey,
			sidebarLayoutStorageKey,
			colorMode,
			setColorMode,
			appearanceSettings,
			setAppearanceSettings,
			effectiveScheme,
			setTransitionOrigin,
			monacoChromeTheme,
		]
	);

	const workspaceSlice = useMemo(
		() => ({
			workspace,
			setWorkspace,
			workspaceFileListRef: _wfListRef,
			workspaceFileListVersion: _workspaceFileListVersion,
			ensureWorkspaceFileListLoaded: _ensureWorkspaceFileListLoaded,
			searchFiles: _searchFiles,
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
		}),
		[
			workspace,
			setWorkspace,
			_wfListRef,
			_workspaceFileListVersion,
			_ensureWorkspaceFileListLoaded,
			_searchFiles,
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
		]
	);

	const settingsSlice = useMemo(
		() => ({
			modelProviders,
			defaultModel,
			modelEntries,
			enabledModelIds,
			thinkingByModelId,
			setThinkingByModelId,
			hasSelectedModel,
			modelPickerItems,
			modelPillLabel,
			agentCustomization,
			setAgentCustomization,
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
			onPersistIndexingPatch,
			onRefreshMcpStatuses,
			onStartMcpServer,
			onStopMcpServer,
			onRestartMcpServer,
			applyLoadedSettings,
		}),
		[
			modelProviders,
			defaultModel,
			modelEntries,
			enabledModelIds,
			thinkingByModelId,
			setThinkingByModelId,
			hasSelectedModel,
			modelPickerItems,
			modelPillLabel,
			agentCustomization,
			setAgentCustomization,
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
			onPersistIndexingPatch,
			onRefreshMcpStatuses,
			onStartMcpServer,
			onStopMcpServer,
			onRestartMcpServer,
			applyLoadedSettings,
		]
	);

	return (
		<AppShellProviders chrome={chromeSlice} workspace={workspaceSlice} settings={settingsSlice}>
			<AppMainWorkspace />
		</AppShellProviders>
	);
}

function AppMainWorkspaceInner() {
	const {
		shell,
		t,
		setLocale,
		locale,
		ipcOk,
		setIpcOk,
		indexingSettings,
		setIndexingSettings,
		layoutPinnedBySurface,
		appSurface,
		shellLayoutStorageKey,
		sidebarLayoutStorageKey,
		colorMode,
		setColorMode,
		appearanceSettings,
		setAppearanceSettings,
		effectiveScheme,
		setTransitionOrigin,
		monacoChromeTheme,
	} = useAppShellChrome();

	const {
		workspace,
		setWorkspace,
		workspaceFileListRef,
		workspaceFileListVersion,
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
		onPersistIndexingPatch,
		onRefreshMcpStatuses,
		onStartMcpServer,
		onStopMcpServer,
		onRestartMcpServer,
		applyLoadedSettings,
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
		streaming,
		awaitingReply,
		thinkingTickRef,
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
	} = usePlanSystem(shell, currentId, currentIdRef, messages, messagesThreadId, messagesRef, workspace, streaming, defaultModel);

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
		streamingThinking,
		setStreamingThinking,
		streamingToolPreview,
		setStreamingToolPreview,
		streamingToolPreviewClearTimerRef,
		liveAssistantBlocks,
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

	/** 切回正在后台流式回复的线程时，把离屏累积的正文/思考草稿铺回 UI */
	const flushOffThreadStreamDraftIfNeeded = useCallback(
		(threadId: string) => {
			const draft = offThreadStreamDraftsRef.current[threadId];
			if (draft && ipcInFlightChatThreadIdRef.current === threadId) {
				setStreaming(draft.streaming);
				setStreamingThinking(draft.streamingThinking);
				setAwaitingReply(true);
				delete offThreadStreamDraftsRef.current[threadId];
			}
		},
		[setStreaming, setStreamingThinking, setAwaitingReply]
	);

	const clearPlanQuestion = useCallback(() => {
		setPlanQuestion(null);
		setPlanQuestionRequestId(null);
	}, [setPlanQuestion, setPlanQuestionRequestId]);

	const { sendMessage, abortActiveStream } = useStreamingChatControls({
		shell,
		currentId,
		setCurrentId,
		loadMessages,
		refreshThreads,
		defaultModel,
		composerMode,
		ensureWorkspaceFileListLoaded,
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
		setParsedPlan,
		setPlanFilePath,
		setPlanFileRelPath,
		loadMessages,
		refreshThreads,
	});

	const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
		layoutPinnedBySurface && appSurface ? appSurface : readStoredShellLayoutModeFromKey(shellLayoutStorageKey)
	);
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
	const {
		fileMenuOpen,
		editMenuOpen,
		viewMenuOpen,
		windowMenuOpen,
		terminalMenuOpen,
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
	/** 对话消息滚动容器：新消息 / 流式输出时自动滚到底（用户上移阅读时暂停跟随） */
	const messagesViewportRef = useRef<HTMLDivElement>(null);
	const messagesTrackRef = useRef<HTMLDivElement>(null);
	const messagesScrollSnapshotByThreadRef = useRef(
		new Map<string, { scrollTop: number; distanceFromBottom: number; pinned: boolean }>()
	);
	const pendingMessagesScrollRestoreRef = useRef<string | null>(null);
	const pinMessagesToBottomRef = useRef(true);
	const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
	const suppressScrollToBottomButtonRef = useRef(false);
	const suppressScrollToBottomButtonTimerRef = useRef<number | null>(null);
	/** 合并粘底滚动到每帧一次，避免 useLayoutEffect + ResizeObserver 与 sticky 用户条叠加导致上下抖动 */
	const messagesScrollToBottomRafRef = useRef<number | null>(null);
	/** 用于区分轨道变高（跟流）与变矮（如 Explored 折叠动画）：变矮时若每帧粘底会整列表「刷新感」 */
	const messagesTrackScrollHeightRef = useRef(0);
	const messagesShrinkScrollTimerRef = useRef<number | null>(null);
	const prevMessagesLenForScrollRef = useRef(0);
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

	const hasConversation = messages.length > 0 || !!streaming;
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

	const executeSkillCreatorSend = useCallback(
		async (scope: 'user' | 'project', pending: { tailSegments: ComposerSegment[]; targetThreadId: string }) => {
			if (!shell) {
				return;
			}
			if (!defaultModel.trim()) {
				flashComposerAttachErr(t('app.noModelSelected'));
				return;
			}
			/* /create-skill 必须走 Agent：Plan 模式无写文件工具，否则模型只能让用户自行复制 */
			setComposerModePersist('agent');
			const { tailSegments, targetThreadId } = pending;
			const tailWire = segmentsToWireText(tailSegments).trim();
			const head =
				scope === 'project' ? t('skillCreator.bubbleHeadProject') : t('skillCreator.bubbleHeadAll');
			const visible = tailWire ? `${head}\n${tailWire}` : head;

			if (targetThreadId !== currentId) {
				await shell.invoke('threads:select', targetThreadId);
				setCurrentId(targetThreadId);
				await loadMessages(targetThreadId);
			}
			clearAgentReviewForThread(targetThreadId);
			setComposerSegments([]);
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			const streamNonce = beginStream(targetThreadId);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				streamNonce,
				skillCreator: { userNote: tailWire, scope },
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				resetStreamingSession();
				void loadMessages(targetThreadId);
				if (r?.error === 'no-workspace') {
					window.alert(t('skillCreator.sendErrorNoWs'));
				} else if (r?.error === 'no-model') {
					flashComposerAttachErr(t('app.noModelSelected'));
				}
				return;
			}
			void refreshThreads();
		},
		[
			shell,
			currentId,
			setComposerModePersist,
			defaultModel,
			t,
			loadMessages,
			clearAgentReviewForThread,
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
			beginStream,
			resetStreamingSession,
			refreshThreads,
			flashComposerAttachErr,
		]
	);

	const executeRuleWizardSend = useCallback(
		async (
			ruleScope: AgentRuleScope,
			globPattern: string | undefined,
			pending: { tailSegments: ComposerSegment[]; targetThreadId: string }
		) => {
			if (!shell) {
				return;
			}
			if (!defaultModel.trim()) {
				flashComposerAttachErr(t('app.noModelSelected'));
				return;
			}
			setComposerModePersist('agent');
			const { tailSegments, targetThreadId } = pending;
			const tailWire = segmentsToWireText(tailSegments).trim();
			const headKey =
				ruleScope === 'always'
					? 'ruleWizard.bubbleHeadAlways'
					: ruleScope === 'glob'
						? 'ruleWizard.bubbleHeadGlob'
						: 'ruleWizard.bubbleHeadManual';
			const head = t(headKey);
			const globLine =
				ruleScope === 'glob' && globPattern?.trim()
					? t('ruleWizard.globLine', { pattern: globPattern.trim() })
					: '';
			const visible = [head, globLine, tailWire].filter((x) => x.length > 0).join('\n');

			if (targetThreadId !== currentId) {
				await shell.invoke('threads:select', targetThreadId);
				setCurrentId(targetThreadId);
				await loadMessages(targetThreadId);
			}
			clearAgentReviewForThread(targetThreadId);
			setComposerSegments([]);
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			const streamNonce = beginStream(targetThreadId);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				streamNonce,
				ruleCreator: {
					userNote: tailWire,
					ruleScope,
					...(ruleScope === 'glob' && globPattern?.trim() ? { globPattern: globPattern.trim() } : {}),
				},
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				resetStreamingSession();
				void loadMessages(targetThreadId);
				if (r?.error === 'no-model') {
					flashComposerAttachErr(t('app.noModelSelected'));
				}
				return;
			}
			void refreshThreads();
		},
		[
			shell,
			currentId,
			setComposerModePersist,
			defaultModel,
			t,
			loadMessages,
			clearAgentReviewForThread,
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
			beginStream,
			resetStreamingSession,
			refreshThreads,
			flashComposerAttachErr,
		]
	);

	const executeSubagentWizardSend = useCallback(
		async (scope: 'user' | 'project', pending: { tailSegments: ComposerSegment[]; targetThreadId: string }) => {
			if (!shell) {
				return;
			}
			if (!defaultModel.trim()) {
				flashComposerAttachErr(t('app.noModelSelected'));
				return;
			}
			setComposerModePersist('agent');
			const { tailSegments, targetThreadId } = pending;
			const tailWire = segmentsToWireText(tailSegments).trim();
			const head = scope === 'project' ? t('subagentWizard.bubbleHeadProject') : t('subagentWizard.bubbleHeadAll');
			const visible = tailWire ? `${head}\n${tailWire}` : head;

			if (targetThreadId !== currentId) {
				await shell.invoke('threads:select', targetThreadId);
				setCurrentId(targetThreadId);
				await loadMessages(targetThreadId);
			}
			clearAgentReviewForThread(targetThreadId);
			setComposerSegments([]);
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			const streamNonce = beginStream(targetThreadId);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				streamNonce,
				subagentCreator: { userNote: tailWire, scope },
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				resetStreamingSession();
				void loadMessages(targetThreadId);
				if (r?.error === 'no-workspace') {
					window.alert(t('subagentWizard.sendErrorNoWs'));
				} else if (r?.error === 'no-model') {
					flashComposerAttachErr(t('app.noModelSelected'));
				}
				return;
			}
			void refreshThreads();
		},
		[
			shell,
			currentId,
			setComposerModePersist,
			defaultModel,
			t,
			loadMessages,
			clearAgentReviewForThread,
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
			beginStream,
			resetStreamingSession,
			refreshThreads,
			flashComposerAttachErr,
		]
	);

	const onDiscardAgentReview = useCallback(() => {
		if (currentId) {
			clearAgentReviewForThread(currentId);
		}
	}, [currentId, clearAgentReviewForThread]);

	const persistComposerShellRef = useRef(shell);
	const persistComposerWorkspaceRef = useRef(workspace);
	const persistComposerTRef = useRef(t);
	const persistComposerFlashErrRef = useRef(flashComposerAttachErr);
	persistComposerShellRef.current = shell;
	persistComposerWorkspaceRef.current = workspace;
	persistComposerTRef.current = t;
	persistComposerFlashErrRef.current = flashComposerAttachErr;

	const persistComposerAttachments = useCallback(async (files: File[]): Promise<string[]> => {
		const sh = persistComposerShellRef.current;
		if (!sh) {
			return [];
		}
		const ws = persistComposerWorkspaceRef.current;
		const tr = persistComposerTRef.current;
		const flash = persistComposerFlashErrRef.current;
		if (!ws) {
			flash(tr('composer.attach.noWorkspace'));
			return [];
		}
		const out: string[] = [];
		for (const f of files) {
			const b64 = await new Promise<string>((resolve, reject) => {
				const r = new FileReader();
				r.onload = () => {
					const d = r.result as string;
					const i = d.indexOf(',');
					resolve(i >= 0 ? d.slice(i + 1) : d);
				};
				r.onerror = () => reject(r.error ?? new Error('read'));
				r.readAsDataURL(f);
			});
			const r = (await sh.invoke('workspace:saveComposerAttachment', {
				base64: b64,
				fileName: f.name,
			})) as { ok?: boolean; relPath?: string; error?: string };
			if (r?.ok && typeof r.relPath === 'string') {
				out.push(r.relPath);
			} else {
				const err = r?.error;
				if (err === 'too-large') {
					flash(tr('composer.attach.tooLarge'));
				} else if (err === 'no-workspace') {
					flash(tr('composer.attach.noWorkspace'));
				} else {
					flash(tr('composer.attach.saveFailed'));
				}
			}
		}
		return out;
	}, []);

	const onApplyAgentPatchOne = useCallback(
		async (id: string) => {
			const cid = currentIdRef.current;
			if (!shell || !cid) {
				return;
			}
			const list = agentReviewPendingByThreadRef.current[cid] ?? EMPTY_AGENT_PENDING_PATCHES;
			const patch = list.find((p) => p.id === id);
			if (!patch) {
				return;
			}
			setAgentReviewBusy(true);
			try {
				const ar = (await shell.invoke('agent:applyDiffChunk', {
					threadId: cid,
					chunk: patch.chunk,
				})) as { applied: string[]; failed: { path: string; reason: string }[] };
				if (ar.applied.length > 0) {
					setAgentReviewPendingByThread((prev) => ({
						...prev,
						[cid]: (prev[cid] ?? []).filter((x) => x.id !== id),
					}));
				}
				await loadMessages(cid);
				await refreshGit();
			} finally {
				setAgentReviewBusy(false);
			}
		},
		[shell, loadMessages, refreshGit]
	);

	const onApplyAgentPatchesAll = useCallback(async () => {
		const cid = currentIdRef.current;
		if (!shell || !cid) {
			return;
		}
		const list = agentReviewPendingByThreadRef.current[cid] ?? EMPTY_AGENT_PENDING_PATCHES;
		if (list.length === 0) {
			return;
		}
		setAgentReviewBusy(true);
		try {
			const ar = (await shell.invoke('agent:applyDiffChunks', {
				threadId: cid,
				items: list.map((p) => ({ id: p.id, chunk: p.chunk })),
			})) as {
				applied: string[];
				failed: { path: string; reason: string }[];
				succeededIds: string[];
			};
			const okIds = new Set(ar.succeededIds ?? []);
			setAgentReviewPendingByThread((prev) => ({
				...prev,
				[cid]: (prev[cid] ?? []).filter((p) => !okIds.has(p.id)),
			}));
			await loadMessages(cid);
			await refreshGit();
		} finally {
			setAgentReviewBusy(false);
		}
	}, [shell, loadMessages, refreshGit]);

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
			setIndexingSettings,
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
		setIndexingSettings,
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
		(msgs: ChatMessage[], threadId: string) => {
			restoreFileChangesState(threadId, msgs, threadId);
		},
		[restoreFileChangesState]
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
				flushOffThreadStreamDraftIfNeeded(threadId);
				mark('messages-done');
				measure('void-ws:apply-path:messages', 'threads-done', 'messages-done');
				console.log(`[perf][renderer] loadMessages done in ${(performance.now() - t0).toFixed(1)}ms`);
			}
		},
		[clearWorkspaceConversationState, refreshThreads, loadMessages, onMessagesLoaded, flushOffThreadStreamDraftIfNeeded]
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

	const writeClipboardText = useCallback(
		async (text: string) => {
			if (shell) {
				const r = (await shell.invoke('clipboard:writeText', text)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					throw new Error(r?.error ?? t('explorer.errClipboard'));
				}
				return;
			}
			await navigator.clipboard.writeText(text);
		},
		[shell, t]
	);

	const readClipboardText = useCallback(async () => {
		if (shell) {
			const r = (await shell.invoke('clipboard:readText')) as { ok?: boolean; error?: string; text?: string };
			if (!r?.ok) {
				throw new Error(r?.error ?? t('explorer.errClipboard'));
			}
			return String(r.text ?? '');
		}
		return navigator.clipboard.readText();
	}, [shell, t]);

	const runMonacoEditCommand = useCallback(
		async (kind: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => {
			/* 主编辑区为只读预览器：仅允许复制与全选 */
			if (kind === 'undo' || kind === 'redo' || kind === 'cut' || kind === 'paste') {
				return false;
			}
			const ed = monacoEditorRef.current;
			if (!ed || !(ed.hasTextFocus?.() || ed.hasWidgetFocus?.())) {
				return false;
			}
			ed.focus();
			if (kind === 'selectAll') {
				ed.trigger('menu', kind, null);
				return true;
			}
			const action = ed.getAction('editor.action.clipboardCopyAction');
			if (action) {
				await action.run();
				return true;
			}
			return false;
		},
		[]
	);

	const runDomEditCommand = useCallback(
		async (kind: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => {
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || !isEditableDomTarget(active)) {
				return false;
			}
			active.focus();
			if (kind === 'paste') {
				const text = await readClipboardText();
				if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
					const start = active.selectionStart ?? active.value.length;
					const end = active.selectionEnd ?? start;
					active.setRangeText(text, start, end, 'end');
					active.dispatchEvent(new Event('input', { bubbles: true }));
					return true;
				}
				document.execCommand('insertText', false, text);
				return true;
			}
			return document.execCommand(
				kind === 'selectAll' ? 'selectAll' : kind === 'undo' ? 'undo' : kind === 'redo' ? 'redo' : kind
			);
		},
		[readClipboardText]
	);

	const executeEditAction = useCallback(
		async (kind: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => {
			try {
				if (await runMonacoEditCommand(kind)) {
					return;
				}
				if (await runDomEditCommand(kind)) {
					return;
				}
				if (kind === 'copy') {
					const selected = window.getSelection?.()?.toString() ?? '';
					if (selected.trim()) {
						await writeClipboardText(selected);
					}
				}
			} catch (e) {
				flashComposerAttachErr(e instanceof Error ? e.message : String(e));
			}
		},
		[flashComposerAttachErr, runDomEditCommand, runMonacoEditCommand, writeClipboardText]
	);

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
	]);

	onNewThreadRef.current = onNewThread;

	const composerInvokeNewThread = useCallback(() => {
		void onNewThreadRef.current();
	}, []);

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
		[workspace, openWorkspaceByPath, closeWorkspaceMenu, setHiddenAgentWorkspacePaths]
	);

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

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
				e.preventDefault();
				void onNewThreadRef.current();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

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
			flushOffThreadStreamDraftIfNeeded(id);

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
			flushOffThreadStreamDraftIfNeeded,
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
		[threadNavigation.history, currentId, onSelectThread]
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

	const zoomInUi = useCallback(() => {
		setUiZoom((value) => Math.min(1.6, Math.round((value + 0.1) * 10) / 10));
	}, []);

	const zoomOutUi = useCallback(() => {
		setUiZoom((value) => Math.max(0.8, Math.round((value - 0.1) * 10) / 10));
	}, []);

	const resetUiZoom = useCallback(() => {
		setUiZoom(1);
	}, []);

	const toggleFullscreen = useCallback(async () => {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await document.documentElement.requestFullscreen();
			}
		} catch {
			/* ignore */
		}
	}, []);

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
		const r = (await shell.invoke('threads:rename', id, draft, scopePath ?? undefined)) as { ok?: boolean };
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
	]);

	const cancelThreadTitleEdit = useCallback(() => {
		setEditingThreadId(null);
		setEditingThreadWorkspacePath(null);
		setEditingThreadTitleDraft('');
	}, []);

	const beginThreadTitleEdit = useCallback((t: ThreadInfo, threadListWorkspace?: string | null) => {
		setEditingThreadId(t.id);
		setEditingThreadWorkspacePath(threadListWorkspace ?? workspace);
		setEditingThreadTitleDraft(t.title);
		threadTitleDraftRef.current = t.title;
	}, [workspace]);

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
			clearStreamingToolPreviewNow,
			resetLiveAgentBlocks,
		]
	);

	const onDeleteThread = useCallback(
		async (e: React.MouseEvent, id: string, threadWorkspaceRoot?: string | null) => {
			e.preventDefault();
			e.stopPropagation();
			voidShellDebugLog('thread-delete:left-list-click', { threadId: id, step: confirmDeleteId === id ? 'confirm' : 'arm' });
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
		[shell, confirmDeleteId, performThreadDelete]
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
	}, [editingThreadId]);

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
		await sendMessage(text, opts);
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
		return onAbortRef.current();
	}, []);

	const onPlanQuestionSubmit = useCallback(
		(answer: string) => {
			const rid = planQuestionRequestId;
			const reply = `我选择：${answer}`;
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
		[planQuestionRequestId, shell, setPlanQuestion, setPlanQuestionRequestId, onSend]
	);

	const onPlanQuestionSkip = useCallback(() => {
		recordPlanQuestionDismissed();
		const rid = planQuestionRequestId;
		const skipText = t('plan.q.skipUserMessage');
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
	}, [t, onSend, shell, planQuestionRequestId, recordPlanQuestionDismissed]);


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

	const onPersistLanguage = useCallback(
		async (loc: AppLocale) => {
			if (!shell) {
				return;
			}
			await shell.invoke('settings:set', { language: loc });
		},
		[shell]
	);

	const onChangeColorMode = useCallback(
		async (next: AppColorMode, origin?: ThemeTransitionOrigin) => {
			setTransitionOrigin(origin);
			setColorMode(next);
			writeStoredColorMode(next);
			if (shell) {
				try {
					await shell.invoke('settings:set', { ui: { colorMode: next } });
				} catch (e) {
					console.error('Failed to persist color mode:', e);
				}
			}
		},
		[shell, setTransitionOrigin]
	);

	useEffect(() => {
		if (!layoutSwitchPending) {
			setLayoutSwitchTarget(null);
		}
	}, [layoutSwitchPending]);

	const persistSettings = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('settings:set', {
			language: locale,
			openAI: { apiKey: undefined, baseURL: undefined, proxyUrl: undefined },
			anthropic: { apiKey: undefined, baseURL: undefined },
			gemini: { apiKey: undefined },
			defaultModel,
			models: {
				providers: modelProviders,
				entries: modelEntries,
				enabledIds: enabledModelIds,
				thinkingByModelId,
			},
			agent: {
				importThirdPartyConfigs: true,
				rules: agentCustomization.rules ?? [],
				skills: agentCustomization.skills ?? [],
				subagents: agentCustomization.subagents ?? [],
				commands: agentCustomization.commands ?? [],
				shellPermissionMode: agentCustomization.shellPermissionMode,
				confirmShellCommands: agentCustomization.confirmShellCommands,
				skipSafeShellCommandsConfirm: agentCustomization.skipSafeShellCommandsConfirm,
				confirmWritesBeforeExecute: agentCustomization.confirmWritesBeforeExecute,
				maxConsecutiveMistakes: agentCustomization.maxConsecutiveMistakes,
				mistakeLimitEnabled: agentCustomization.mistakeLimitEnabled,
				backgroundForkAgent: agentCustomization.backgroundForkAgent,
				toolPermissionRules: agentCustomization.toolPermissionRules ?? [],
				shouldAvoidPermissionPrompts: agentCustomization.shouldAvoidPermissionPrompts,
				memoryExtraction: agentCustomization.memoryExtraction,
			},
			editor: editorSettings,
			indexing: {
				symbolIndexEnabled: indexingSettings.symbolIndexEnabled,
				semanticIndexEnabled: indexingSettings.semanticIndexEnabled,
			},
			mcp: { servers: mcpServers },
			ui: {
				colorMode,
				fontPreset: appearanceSettings.uiFontPreset,
				uiFontPreset: appearanceSettings.uiFontPreset,
				codeFontPreset: appearanceSettings.codeFontPreset,
				themePresetId: appearanceSettings.themePresetId,
				accentColor: appearanceSettings.accentColor,
				backgroundColor: appearanceSettings.backgroundColor,
				foregroundColor: appearanceSettings.foregroundColor,
				translucentSidebar: appearanceSettings.translucentSidebar,
				contrast: appearanceSettings.contrast,
				usePointerCursors: appearanceSettings.usePointerCursors,
				uiFontSize: appearanceSettings.uiFontSize,
				codeFontSize: appearanceSettings.codeFontSize,
				...(layoutPinnedBySurface ? {} : { layoutMode }),
			},
		});
	}, [
		shell,
		modelProviders,
		defaultModel,
		modelEntries,
		enabledModelIds,
		thinkingByModelId,
		agentCustomization,
		editorSettings,
		indexingSettings,
		locale,
		mcpServers,
		colorMode,
		appearanceSettings,
		layoutMode,
		layoutPinnedBySurface,
	]);

	/** 离开设置页时写入磁盘（返回、点遮罩、Esc 等） */
	const closeSettingsPage = useCallback(async () => {
		try {
			await persistSettings();
		} catch (e) {
			console.error('Failed to persist settings:', e);
		} finally {
			setSettingsPageOpen(false);
		}
	}, [persistSettings]);

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

	const dismissAgentChangedFile = useCallback((relPath: string) => {
		if (!currentId) {
			return;
		}
		setDismissedFiles((prev) => {
			const next = new Set(prev).add(relPath);
			const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
			writePersistedAgentFileChanges(
				currentId,
				last?.content ?? '',
				fileChangesDismissedRef.current,
				next,
				revertedFilesRef.current,
				revertedChangeKeysRef.current
			);
			return next;
		});
	}, [currentId]);

	const markAgentConversationChangeReverted = useCallback((changeKey: string | null, relPath?: string) => {
		if (!currentId) {
			return;
		}
		const normalizedPath = typeof relPath === 'string' ? normalizeWorkspaceRelPath(relPath) : '';
		const normalizedKey = typeof changeKey === 'string' ? changeKey.trim() : '';
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		let nextPaths = revertedFilesRef.current;
		let nextKeys = revertedChangeKeysRef.current;
		if (normalizedPath) {
			nextPaths = new Set(revertedFilesRef.current).add(normalizedPath);
			setRevertedFiles(nextPaths);
		}
		if (normalizedKey) {
			nextKeys = new Set(revertedChangeKeysRef.current).add(normalizedKey);
			setRevertedChangeKeys(nextKeys);
		}
		writePersistedAgentFileChanges(
			currentId,
			last?.content ?? '',
			fileChangesDismissedRef.current,
			dismissedFilesRef.current,
			nextPaths,
			nextKeys
		);
	}, [currentId]);

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

	const focusSearchSidebarFromQuickOpen = useCallback((q: string) => {
		setSidebarSearchDraft(q);
		setQuickOpenSeed(`%${q}`);
		setQuickOpenOpen(true);
	}, []);

	const workspaceExplorerActions = useMemo((): WorkspaceExplorerActions | null => {
		if (!shell || !workspace) {
			return null;
		}
		const joinAbs = (rel: string) => {
			const root = workspace.replace(/\\/g, '/').replace(/\/$/, '');
			const sub = rel.replace(/\\/g, '/').replace(/^\//, '');
			return `${root}/${sub}`;
		};
		const normPath = (p: string) => p.replace(/\\/g, '/');
		return {
			openToSide: (rel) => void openFileInTab(rel, undefined, undefined, { background: true }),
			openInBrowser: async (rel) => {
				const r = (await shell.invoke('shell:openInBrowser', rel)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errOpenBrowser'));
				}
			},
			openWithDefault: async (rel) => {
				const r = (await shell.invoke('shell:openDefault', rel)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errOpenDefault'));
				}
			},
			revealInOs: async (rel) => {
				const r = (await shell.invoke('shell:revealInFolder', rel)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errReveal'));
				}
			},
			openInTerminal: async (cwdRel) => {
				setLayoutMode('editor');
				setEditorTerminalVisible(true);
				await appendEditorTerminal(cwdRel !== '' ? { cwdRel } : undefined);
			},
			copyAbsolutePath: async (rel) => {
				const r = (await shell.invoke('clipboard:writeText', joinAbs(rel))) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errClipboard'));
				}
			},
			copyRelativePath: async (rel) => {
				const r = (await shell.invoke('clipboard:writeText', rel.replace(/\\/g, '/'))) as {
					ok?: boolean;
					error?: string;
				};
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errClipboard'));
				}
			},
			copyFileName: async (rel) => {
				const base = normPath(rel).split('/').pop() ?? rel;
				const r = (await shell.invoke('clipboard:writeText', base)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errClipboard'));
				}
			},
			addToChat: (rel) => {
				setComposerSegments((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === 'text' && last.text.length > 0 && !/\s$/.test(last.text)) {
						next[next.length - 1] = { ...last, text: `${last.text} ` };
					}
					next.push({ id: newSegmentId(), kind: 'file', path: rel });
					next.push({ id: newSegmentId(), kind: 'text', text: '' });
					return next;
				});
				setLayoutMode('agent');
				queueMicrotask(() => {
					if (composerRichBottomRef.current) {
						composerRichBottomRef.current.focus();
					} else {
						composerRichHeroRef.current?.focus();
					}
				});
			},
			addToNewChat: async (rel) => {
				const r = (await shell.invoke('threads:create')) as { id: string };
				await refreshThreads();
				await shell.invoke('threads:select', r.id);
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
				setComposerSegments([
					{ id: newSegmentId(), kind: 'file', path: rel },
					{ id: newSegmentId(), kind: 'text', text: '' },
				]);
				setInlineResendSegments([]);
				setResendFromUserIndex(null);
				setLayoutMode('agent');
				queueMicrotask(() => {
					if (composerRichBottomRef.current) {
						composerRichBottomRef.current.focus();
					} else {
						composerRichHeroRef.current?.focus();
					}
				});
			},
			rename: async (rel) => {
				const parts = normPath(rel).split('/').filter(Boolean);
				const base = parts[parts.length - 1] ?? rel;
				const next = window.prompt(t('explorer.renamePrompt'), base);
				if (next == null || next.trim() === '' || next.trim() === base) {
					return;
				}
				const r = (await shell.invoke('fs:renameEntry', rel, next.trim())) as {
					ok?: boolean;
					newRel?: string;
					error?: string;
				};
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errRename'));
					return;
				}
				const nr = r.newRel ?? rel;
				const oldTid = tabIdFromPath(rel);
				const newTid = tabIdFromPath(nr);
				setOpenTabs((prev) =>
					prev.map((tab) =>
						normPath(tab.filePath) === normPath(rel)
							? { ...tab, filePath: nr, id: newTid, dirty: tab.dirty }
							: tab
					)
				);
				if (activeTabId === oldTid) {
					setActiveTabId(newTid);
				}
				if (normPath(filePath.trim()) === normPath(rel)) {
					setFilePath(nr);
				}
				await refreshGit();
			},
			delete: async (rel, isDir) => {
				const ok = isDir
					? window.confirm(t('explorer.deleteConfirmDir'))
					: window.confirm(t('explorer.deleteConfirmFile'));
				if (!ok) {
					return;
				}
				const r = (await shell.invoke('fs:removeEntry', rel, isDir)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					flashComposerAttachErr(r?.error ?? t('explorer.errDelete'));
					return;
				}
				const norm = normPath(rel);
				const curActive = activeTabId;
				setOpenTabs((prev) => {
					const next = prev.filter((t) => {
						const p = normPath(t.filePath);
						if (isDir) {
							const pref = norm.endsWith('/') ? norm : `${norm}/`;
							return p !== norm && !p.startsWith(pref);
						}
						return p !== norm;
					});
					const activeGone = curActive != null && !next.some((t) => t.id === curActive);
					if (activeGone) {
						const oldIdx = prev.findIndex((t) => t.id === curActive);
						const pick = next[Math.min(oldIdx, Math.max(0, next.length - 1))] ?? null;
						queueMicrotask(() => {
							setActiveTabId(pick?.id ?? null);
							if (pick) {
								setFilePath(pick.filePath);
								void (async () => {
									try {
										const rr = (await shell.invoke('fs:readFile', pick.filePath)) as {
											ok?: boolean;
											content?: string;
										};
										if (rr.ok && rr.content !== undefined) {
											setEditorValue(rr.content);
										}
									} catch {
										setEditorValue('');
									}
								})();
							} else {
								setFilePath('');
								setEditorValue('');
							}
						});
					}
					return next;
				});
				await refreshGit();
			},
		};
	}, [
		shell,
		workspace,
		t,
		openFileInTab,
		appendEditorTerminal,
		setEditorTerminalVisible,
		setLayoutMode,
		setComposerSegments,
		flashComposerAttachErr,
		refreshThreads,
		loadMessages,
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
		setInlineResendSegments,
		setResendFromUserIndex,
		activeTabId,
		setOpenTabs,
		setActiveTabId,
		setFilePath,
		setEditorValue,
		refreshGit,
		filePath,
	]);

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

	const windowMenuMinimize = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowMinimize');
	}, [shell]);

	const windowMenuToggleMaximize = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowToggleMaximize');
		const r = (await shell.invoke('app:windowGetState')) as { ok?: boolean; maximized?: boolean };
		if (r?.ok && typeof r.maximized === 'boolean') {
			setWindowMaximized(r.maximized);
		}
	}, [shell]);

	const windowMenuCloseWindow = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('app:windowClose');
	}, [shell]);

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
			id: 'file' | 'edit' | 'view' | 'window' | 'terminal';
			ref: RefObject<HTMLDivElement | null>;
		}[] = [
			{ id: 'file', ref: fileMenuRef },
			{ id: 'edit', ref: editMenuRef },
			{ id: 'view', ref: viewMenuRef },
			{ id: 'window', ref: windowMenuRef },
			{ id: 'terminal', ref: terminalMenuRef },
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
			if (t instanceof Element && t.closest('.ref-at-menu, .ref-slash-menu, .ref-model-dd, .ref-plus-menu')) {
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

	const displayMessages = useMemo(() => {
		if (!awaitingReply && streaming === '') {
			return messages;
		}
		return [...messages, { role: 'assistant' as const, content: streaming }];
	}, [messages, streaming, awaitingReply]);

	const lastAssistantMessageIndex = useMemo(() => {
		let idx = -1;
		for (let j = 0; j < displayMessages.length; j++) {
			if (displayMessages[j]!.role === 'assistant') {
				idx = j;
			}
		}
		return idx;
	}, [displayMessages]);

	/** 中间消息区滚动时，最后一条用户消息 sticky 在视口顶部（参考 Cursor） */
	const lastUserMessageIndex = useMemo(() => {
		let idx = -1;
		for (let j = 0; j < displayMessages.length; j++) {
			if (displayMessages[j]!.role === 'user') {
				idx = j;
			}
		}
		return idx;
	}, [displayMessages]);

	const displayMessagesRef = useRef(displayMessages);
	displayMessagesRef.current = displayMessages;

	/** 聊天区出现带 @ 的用户消息时再拉全量路径，供历史气泡解析文件芯片 */
	useEffect(() => {
		if (!workspace || !shell) {
			return;
		}
		const needsPaths = displayMessages.some(
			(m) => m.role === 'user' && /[@\uFF03]/.test(m.content)
		);
		if (!needsPaths) {
			return;
		}
		void ensureWorkspaceFileListLoaded();
	}, [workspace, shell, displayMessages, ensureWorkspaceFileListLoaded]);

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
		if (awaitingReply || streaming !== '') {
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
		streaming,
		planQuestionRequestId,
	]);

	const onKeepAllEdits = useCallback(async () => {
		if (!currentId) {
			return;
		}
		if (shell) {
			try {
				await shell.invoke('agent:keepLastTurn', currentId);
			} catch {
				/* ignore */
			}
		}
		setDismissedFiles(new Set());
		setFileChangesDismissed(true);
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		writePersistedAgentFileChanges(
			currentId,
			last?.content ?? '',
			true,
			new Set(),
			revertedFilesRef.current,
			revertedChangeKeysRef.current
		);
	}, [shell, currentId]);

	const onRevertAllEdits = useCallback(async () => {
		if (!shell || composerMode !== 'agent' || !currentId) return;
		const gp = agentGitPackRef.current;
		const revertedPaths = new Set(
			computeMergedAgentFileChanges(
				displayMessagesRef.current,
				composerMode,
				t,
				dismissedFilesRef.current,
				{ gitStatusOk: gp.gitStatusOk, gitChangedPaths: gp.gitChangedPaths, diffPreviews: gp.diffPreviews },
				null
			).map((file) => file.path)
		);
		try {
			const result = (await shell.invoke('agent:revertLastTurn', currentId)) as { ok?: boolean; reverted?: number };
			if ((result.reverted ?? 0) > 0) {
				void refreshGit();
			}
		} catch {
			/* IPC error — still dismiss panel to unblock the user */
		}
		setRevertedFiles(revertedPaths);
		setRevertedChangeKeys(new Set());
		setDismissedFiles(new Set());
		setFileChangesDismissed(true);
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		writePersistedAgentFileChanges(
			currentId,
			last?.content ?? '',
			true,
			new Set(),
			revertedPaths,
			new Set()
		);
	}, [shell, composerMode, currentId, refreshGit, t]);

	const onKeepFileEdit = useCallback(async (relPath: string) => {
		if (!shell || !currentId) return;
		try {
			await shell.invoke('agent:keepFile', currentId, relPath);
		} catch { /* ignore */ }
		dismissAgentChangedFile(relPath);
	}, [dismissAgentChangedFile, shell, currentId]);

	const onRevertFileEdit = useCallback(async (relPath: string) => {
		if (!shell || !currentId) return;
		try {
			await shell.invoke('agent:revertFile', currentId, relPath);
			void refreshGit();
		} catch { /* ignore */ }
		markAgentConversationChangeReverted(null, relPath);
		dismissAgentChangedFile(relPath);
	}, [dismissAgentChangedFile, markAgentConversationChangeReverted, shell, currentId, refreshGit]);

	const syncMessagesScrollIndicators = useCallback(() => {
		const el = messagesViewportRef.current;
		if (!el) {
			return;
		}
		const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
		const clampedTop = Math.max(0, Math.min(el.scrollTop, maxScroll));
		const dist = Math.max(0, maxScroll - clampedTop);
		pinMessagesToBottomRef.current = dist < 120;
		const activeThreadId = messagesThreadIdRef.current ?? currentIdRef.current;
		if (activeThreadId) {
			messagesScrollSnapshotByThreadRef.current.set(activeThreadId, {
				scrollTop: clampedTop,
				distanceFromBottom: dist,
				pinned: pinMessagesToBottomRef.current,
			});
		}
		if (suppressScrollToBottomButtonRef.current) {
			if (dist <= 16 || el.scrollHeight <= el.clientHeight + 120) {
				suppressScrollToBottomButtonRef.current = false;
				if (suppressScrollToBottomButtonTimerRef.current !== null) {
					window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
					suppressScrollToBottomButtonTimerRef.current = null;
				}
			}
			setShowScrollToBottomButton(false);
			return;
		}
		const canJumpToBottom = el.scrollHeight > el.clientHeight + 120;
		const shouldShowJumpButton = canJumpToBottom && dist > 180;
		setShowScrollToBottomButton((prev) => (prev === shouldShowJumpButton ? prev : shouldShowJumpButton));
	}, []);

	const onMessagesScroll = useCallback(() => {
		syncMessagesScrollIndicators();
	}, [syncMessagesScrollIndicators]);

	const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
		const el = messagesViewportRef.current;
		if (!el) {
			return;
		}
		pinMessagesToBottomRef.current = true;
		suppressScrollToBottomButtonRef.current = behavior === 'smooth';
		if (suppressScrollToBottomButtonTimerRef.current !== null) {
			window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
			suppressScrollToBottomButtonTimerRef.current = null;
		}
		if (behavior === 'smooth') {
			suppressScrollToBottomButtonTimerRef.current = window.setTimeout(() => {
				suppressScrollToBottomButtonRef.current = false;
				suppressScrollToBottomButtonTimerRef.current = null;
				syncMessagesScrollIndicators();
			}, 1400);
		}
		setShowScrollToBottomButton(false);
		el.scrollTo({ top: el.scrollHeight, behavior });
	}, [syncMessagesScrollIndicators]);

	const scheduleMessagesScrollToBottom = useCallback(() => {
		if (!pinMessagesToBottomRef.current) {
			return;
		}
		if (messagesScrollToBottomRafRef.current !== null) {
			return;
		}
		messagesScrollToBottomRafRef.current = requestAnimationFrame(() => {
			messagesScrollToBottomRafRef.current = null;
			const el = messagesViewportRef.current;
			if (!el || !pinMessagesToBottomRef.current) {
				return;
			}
			el.scrollTop = el.scrollHeight;
			syncMessagesScrollIndicators();
		});
	}, [syncMessagesScrollIndicators]);

	/** 切换线程：始终从底部开始，等 messages / 流式更新后再滚（避免旧列表闪滚） */
	useLayoutEffect(() => {
		pendingMessagesScrollRestoreRef.current = currentId;
		pinMessagesToBottomRef.current = true;
		suppressScrollToBottomButtonRef.current = false;
		setShowScrollToBottomButton(false);
		if (suppressScrollToBottomButtonTimerRef.current !== null) {
			window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
			suppressScrollToBottomButtonTimerRef.current = null;
		}
		messagesTrackScrollHeightRef.current = 0;
		if (messagesShrinkScrollTimerRef.current !== null) {
			window.clearTimeout(messagesShrinkScrollTimerRef.current);
			messagesShrinkScrollTimerRef.current = null;
		}
	}, [currentId]);

	/** 线程 / 工作区切回后始终滚到消息列表最底部（与渐进渲染窗口配合） */
	useLayoutEffect(() => {
		if (!hasConversation || !currentId || messagesThreadId !== currentId) {
			return;
		}
		if (pendingMessagesScrollRestoreRef.current !== currentId) {
			return;
		}
		const rafId = requestAnimationFrame(() => {
			if (pendingMessagesScrollRestoreRef.current !== currentId) {
				return;
			}
			const el = messagesViewportRef.current;
			if (!el) {
				return;
			}
			const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
			pinMessagesToBottomRef.current = true;
			el.scrollTop = maxScroll;
			pendingMessagesScrollRestoreRef.current = null;
			syncMessagesScrollIndicators();
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, currentId, messagesThreadId, displayMessages, syncMessagesScrollIndicators]);

	/** 用户发出新消息：强制跟到底部 */
	useLayoutEffect(() => {
		const len = messages.length;
		const prev = prevMessagesLenForScrollRef.current;
		prevMessagesLenForScrollRef.current = len;
		if (
			len > prev &&
			currentId != null &&
			messagesThreadId === currentId &&
			messages[len - 1]?.role === 'user'
		) {
			pinMessagesToBottomRef.current = true;
			scrollMessagesToBottom('auto');
		}
	}, [messages, currentId, messagesThreadId, scrollMessagesToBottom]);

	/** 流式 / 思考计时 / 展示列表变化：仅在「粘底」时跟随（每帧合并一次，减轻与 RO 重复滚动） */
	useLayoutEffect(() => {
		if (!hasConversation || !pinMessagesToBottomRef.current) {
			return;
		}
		scheduleMessagesScrollToBottom();
	}, [hasConversation, displayMessages, streaming, currentId, scheduleMessagesScrollToBottom]);

	useLayoutEffect(() => {
		if (!hasConversation) {
			setShowScrollToBottomButton(false);
			return;
		}
		const rafId = requestAnimationFrame(() => {
			syncMessagesScrollIndicators();
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, displayMessages, streaming, currentId, syncMessagesScrollIndicators]);

	/** 内容高度异步变化（Markdown、diff 卡片等）时仍保持粘底 */
	useEffect(() => {
		if (!hasConversation) {
			return;
		}
		const outer = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!outer || !track) {
			return;
		}
		const ro = new ResizeObserver(() => {
			const h = track.scrollHeight;
			const prev = messagesTrackScrollHeightRef.current;
			messagesTrackScrollHeightRef.current = h;
			syncMessagesScrollIndicators();
			// 变高：新内容 / 展开，立即粘底（仍由 schedule 合并到单帧）
			if (h >= prev - 2) {
				if (messagesShrinkScrollTimerRef.current !== null) {
					window.clearTimeout(messagesShrinkScrollTimerRef.current);
					messagesShrinkScrollTimerRef.current = null;
				}
				scheduleMessagesScrollToBottom();
				return;
			}
			// 变矮：多为折叠动画中间帧，避免每帧 scrollTo 造成整区闪烁；结束后补一次即可贴底
			if (messagesShrinkScrollTimerRef.current !== null) {
				window.clearTimeout(messagesShrinkScrollTimerRef.current);
			}
			messagesShrinkScrollTimerRef.current = window.setTimeout(() => {
				messagesShrinkScrollTimerRef.current = null;
				scheduleMessagesScrollToBottom();
			}, 340);
		});
		ro.observe(track);
		return () => {
			ro.disconnect();
			if (messagesShrinkScrollTimerRef.current !== null) {
				window.clearTimeout(messagesShrinkScrollTimerRef.current);
				messagesShrinkScrollTimerRef.current = null;
			}
			if (messagesScrollToBottomRafRef.current !== null) {
				cancelAnimationFrame(messagesScrollToBottomRafRef.current);
				messagesScrollToBottomRafRef.current = null;
			}
			if (suppressScrollToBottomButtonTimerRef.current !== null) {
				window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
				suppressScrollToBottomButtonTimerRef.current = null;
			}
		};
	}, [hasConversation, currentId, scheduleMessagesScrollToBottom, syncMessagesScrollIndicators]);

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

	const persistRailWidths = useCallback(
		(next: { left: number; right: number }) => {
			const c = clampSidebarLayout(next.left, next.right);
			setRailWidths(c);
			try {
				localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(c));
			} catch {
				/* ignore */
			}
			syncDesktopSidebarLayout(shell ?? undefined, c);
		},
		[shell, sidebarLayoutStorageKey]
	);

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

	const beginResizeLeft = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const { left, right } = railWidths;
			const onMove = (ev: MouseEvent) => {
				const nl = left + (ev.clientX - startX);
				setRailWidths(clampSidebarLayout(nl, right));
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				setRailWidths((prev) => {
					const c = clampSidebarLayout(prev.left, prev.right);
					try {
						localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(c));
					} catch {
						/* ignore */
					}
					syncDesktopSidebarLayout(shell ?? undefined, c);
					return c;
				});
			};
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[railWidths.left, railWidths.right, shell, sidebarLayoutStorageKey]
	);

	const beginResizeRight = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const { left, right } = railWidths;
			const onMove = (ev: MouseEvent) => {
				const nr = right - (ev.clientX - startX);
				setRailWidths(clampSidebarLayout(left, nr));
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				setRailWidths((prev) => {
					const c = clampSidebarLayout(prev.left, prev.right);
					try {
						localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(c));
					} catch {
						/* ignore */
					}
					syncDesktopSidebarLayout(shell ?? undefined, c);
					return c;
				});
			};
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[railWidths.left, railWidths.right, shell, sidebarLayoutStorageKey]
	);

	const beginResizeEditorTerminal = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startY = e.clientY;
			const startH = editorTerminalHeightPx;
			const onMove = (ev: MouseEvent) => {
				const next = clampEditorTerminalHeight(startH - (ev.clientY - startY));
				setEditorTerminalHeightPx(next);
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				setEditorTerminalHeightPx((h) => {
					const c = clampEditorTerminalHeight(h);
					try {
						localStorage.setItem(editorTerminalHeightLsKey, String(c));
					} catch {
						/* ignore */
					}
					return c;
				});
			};
			document.body.style.cursor = 'row-resize';
			document.body.style.userSelect = 'none';
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[editorTerminalHeightPx, editorTerminalHeightLsKey]
	);

	const resetRailWidths = useCallback(() => {
		persistRailWidths(defaultQuarterRailWidths());
	}, [persistRailWidths]);

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
			streaming,
			streamingThinking,
			composerSegments,
		});
		return { maxTokens, usedEstimate, isDefaultMax };
	}, [
		hasSelectedModel,
		defaultModel,
		modelEntries,
		messages,
		streaming,
		streamingThinking,
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

	/** 内联编辑历史用户消息：按需拉全量路径后再解析 @ 引用 */
	const onStartInlineResend = useCallback(
		(userMessageIndex: number, content: string) => {
			setPlanQuestion(null);
			setPlanQuestionRequestId(null);
			setResendFromUserIndex(userMessageIndex);
			void (async () => {
				const paths = await ensureWorkspaceFileListLoaded();
				setInlineResendSegments(userMessageToSegments(content, paths));
			})();
		},
		[ensureWorkspaceFileListLoaded, setPlanQuestion, setPlanQuestionRequestId]
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
		(th: ThreadInfo, threadListWorkspace?: string | null) => {
			const owningWs = threadListWorkspace ?? workspace;
			const isActive =
				th.id === currentId &&
				(!workspace || !owningWs || normWorkspaceRootKey(owningWs) === normWorkspaceRootKey(workspace));
			return (
				<div
					key={th.id}
					className={`ref-thread-item ${isActive ? 'is-active' : ''} ${
						editingThreadId === th.id ? 'is-editing-title' : ''
					}`}
				>
					{editingThreadId === th.id ? (
						<input
							ref={threadTitleInputRef}
							type="text"
							className="ref-thread-title-input"
							value={editingThreadTitleDraft}
							aria-label={t('common.threadTitle')}
							onChange={(e) => {
								const v = e.target.value;
								setEditingThreadTitleDraft(v);
								threadTitleDraftRef.current = v;
							}}
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									void commitThreadTitleEdit();
								}
								if (e.key === 'Escape') {
									e.preventDefault();
									cancelThreadTitleEdit();
								}
							}}
							onBlur={() => void commitThreadTitleEdit()}
						/>
					) : (
						<button
							type="button"
							className="ref-thread-row ref-thread-row--rich"
							onClick={() => void onSelectThread(th.id, threadListWorkspace)}
							onDoubleClick={(e) => {
								e.preventDefault();
								beginThreadTitleEdit(th, threadListWorkspace);
							}}
						>
							<span className="ref-thread-row-lead" aria-hidden>
								{th.isAwaitingReply ? (
									<IconPencil className="ref-thread-row-lead-svg" />
								) : (
									<IconCheckCircle className="ref-thread-row-lead-svg" />
								)}
							</span>
							<span className="ref-thread-row-stack">
								<span className="ref-thread-row-title">{threadRowTitle(t, th)}</span>
								<span className={`ref-thread-row-meta ${isActive ? 'is-active-meta' : ''}`}>
									{formatThreadRowSubtitle(t, th, isActive)}
								</span>
								{(th.fileStateCount && th.fileStateCount > 0) || th.tokenUsage ? (
									<span className="ref-thread-row-stats">
										{th.fileStateCount && th.fileStateCount > 0 ? (
											<span
												className="ref-thread-stat ref-thread-stat--files"
												title={t('agent.files.count', { count: th.fileStateCount })}
											>
												<svg
													width="10"
													height="10"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													aria-hidden
												>
													<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
													<polyline points="14 2 14 8 20 8" />
												</svg>
												{th.fileStateCount}
											</span>
										) : null}
										{th.tokenUsage ? (
											<span
												className="ref-thread-stat ref-thread-stat--tokens"
												title={t('usage.totalTokens', {
													input: th.tokenUsage.totalInput.toLocaleString(),
													output: th.tokenUsage.totalOutput.toLocaleString(),
												})}
											>
												{t('usage.tokensShort', {
													input:
														th.tokenUsage.totalInput > 999
															? `${Math.round(th.tokenUsage.totalInput / 1000)}k`
															: String(th.tokenUsage.totalInput),
													output:
														th.tokenUsage.totalOutput > 999
															? `${Math.round(th.tokenUsage.totalOutput / 1000)}k`
															: String(th.tokenUsage.totalOutput),
												})}
											</span>
										) : null}
									</span>
								) : null}
							</span>
						</button>
					)}
					<div className="ref-thread-row-actions">
						<button
							type="button"
							className="ref-thread-action"
							title={t('common.rename')}
							aria-label={t('common.renameThread')}
							onMouseDown={(e) => e.preventDefault()}
							onClick={(e) => {
								e.stopPropagation();
								beginThreadTitleEdit(th, threadListWorkspace);
							}}
						>
							<IconPencil className="ref-thread-action-svg" />
						</button>
						<button
							type="button"
							className={`ref-thread-action ${
								confirmDeleteId === th.id ? 'ref-thread-action--confirm' : ''
							}`}
							title={confirmDeleteId === th.id ? t('common.confirmDelete') : t('common.delete')}
							aria-label={confirmDeleteId === th.id ? t('common.confirmDelete') : t('common.deleteThread')}
							onMouseDown={(e) => e.preventDefault()}
							onClick={(e) => void onDeleteThread(e, th.id, threadListWorkspace)}
						>
							{confirmDeleteId === th.id ? (
								<span className="ref-thread-action-confirm-label">{t('common.confirm')}</span>
							) : (
								<IconTrash className="ref-thread-action-svg" />
							)}
						</button>
					</div>
				</div>
			);
		},
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
		displayMessages,
		persistedMessageCount: messages.length,
		messagesThreadId,
		currentId,
		lastAssistantMessageIndex,
		lastUserMessageIndex,
		messagesViewportRef,
		messagesTrackRef,
		inlineResendRootRef,
		onMessagesScroll,
		awaitingReply,
		thinkingTickRef,
		streamStartedAtRef,
		firstTokenAtRef,
		thoughtSecondsByThread,
		lastTurnUsage,
		composerMode,
		streaming,
		streamingThinking,
		streamingToolPreview,
		liveAssistantBlocks,
		workspace,
		workspaceBasename,
		workspaceFileListRef,
		workspaceFileListVersion,
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
		onStartInlineResend,
		shell,
		onExplorerOpenFile,
		onAgentConversationOpenFile,
		pendingAgentPatches,
		agentReviewBusy,
		onApplyAgentPatchOne,
		onApplyAgentPatchesAll,
		onDiscardAgentReview,
		planQuestion,
		onPlanQuestionSubmit,
		onPlanQuestionSkip,
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
		dismissedFiles,
		fileChangesDismissed,
		onKeepAllEdits,
		onRevertAllEdits,
		onKeepFileEdit,
		onRevertFileEdit,
		showScrollToBottomButton,
		scrollMessagesToBottom,
		agentPlanSummaryCard,
	});


	const agentRightSidebarProps = useAgentRightSidebarProps({
		open: agentRightSidebarOpen,
		view: agentRightSidebarView,
		hasAgentPlanSidebarContent,
		setAgentRightSidebarOpen,
		openAgentRightSidebarView,
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
	});

	const editorMainPanelProps = useEditorMainPanelProps({
		t,
		openTabs,
		activeTabId,
		onCloseTab,
		showEditorPlanDocumentInCenter,
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
					currentThreadTitle={currentThreadTitle}
					onPlanNewIdea={onPlanNewIdea}
					hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
					agentRightSidebarOpen={agentRightSidebarOpen}
					agentRightSidebarView={agentRightSidebarView}
					toggleAgentRightSidebarView={toggleAgentRightSidebarView}
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
				<EditorMainPanel {...editorMainPanelProps} />
			</Suspense>
		);
	}, [
		layoutMode,
		t,
		hasConversation,
		workspace,
		workspaceBasename,
		currentThreadTitle,
		onPlanNewIdea,
		hasAgentPlanSidebarContent,
		agentRightSidebarOpen,
		agentRightSidebarView,
		toggleAgentRightSidebarView,
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
			if (streaming) triggers.push('streaming');
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
			onChangeModelProviders,
			onChangeModelEntries,
			onPickDefaultModel: (id) => void onPickDefaultModel(id),
			agentCustomization: mergedAgentCustomization,
			onChangeAgentCustomization: onChangeMergedAgentCustomization,
			editorSettings,
			onChangeEditorSettings: setEditorSettings,
			onPersistLanguage: (loc) => void onPersistLanguage(loc),
			indexingSettings,
			onChangeIndexingSettings: setIndexingSettings,
			onPersistIndexingPatch,
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
			onChangeModelProviders,
			onChangeModelEntries,
			onPickDefaultModel,
			mergedAgentCustomization,
			onChangeMergedAgentCustomization,
			editorSettings,
			setEditorSettings,
			onPersistLanguage,
			indexingSettings,
			setIndexingSettings,
			onPersistIndexingPatch,
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

	return (
		<AppProvider shell={shell} workspace={workspace} t={t}>
		<ComposerActionsProvider value={composerActions}>
		<div className={`ref-shell ${layoutMode === 'agent' ? 'ref-shell--agent-layout' : ''}`}>
			<AppShellMenubar
				layoutMode={layoutMode}
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
				fileMenuOpen={fileMenuOpen}
				editMenuOpen={editMenuOpen}
				viewMenuOpen={viewMenuOpen}
				windowMenuOpen={windowMenuOpen}
				terminalMenuOpen={terminalMenuOpen}
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
				handleOpenSettingsGeneral={handleOpenSettingsGeneral}
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
				indexingSettingsSymbolIndexEnabled={indexingSettings.symbolIndexEnabled}
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
			/>


		</div>
		</ComposerActionsProvider>
		</AppProvider>
	);
}

const AppMainWorkspace = memo(AppMainWorkspaceInner);

