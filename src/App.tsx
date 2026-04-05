import {
	Activity,
	Fragment,
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
	type ReactNode,
} from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { createTwoFilesPatch } from 'diff';
import { PtyTerminalView } from './PtyTerminalView';
import { DrawerPtyTerminal } from './DrawerPtyTerminal';
import { ChatMarkdown } from './ChatMarkdown';
import { languageFromFilePath } from './fileTypeIcons';
import { OpenWorkspaceModal } from './OpenWorkspaceModal';
import { type WorkspaceExplorerActions } from './WorkspaceExplorer';
import {
	type ChatPlanExecutePayload,
	type ChatStreamPayload,
	coerceThinkingByModelId,
	type ThinkingLevel,
	type TurnTokenUsage,
} from './ipcTypes';
import { applyLiveAgentChatPayload } from './liveAgentBlocks';
import { AgentReviewPanel } from './AgentReviewPanel';
import { AgentFileChangesPanel } from './AgentFileChanges';
import { AgentFilePreviewPanel } from './AgentFilePreviewPanel';
import { buildAgentFilePreviewHunks } from './agentFilePreviewDiff';
import {
	agentChangeKeyFromDiff,
	assistantMessageUsesAgentToolProtocol,
	segmentAssistantContentUnified,
	collectFileChanges,
	countDiffAddDel,
} from './agentChatSegments';
import {
	clearPersistedAgentFileChanges,
	hashAgentAssistantContent,
	readPersistedAgentFileChanges,
	writePersistedAgentFileChanges,
} from './agentFileChangesPersist';
import {
	mergeAgentFileChangesWithGit,
	normalizeWorkspaceRelPath,
	workspaceRelPathsEqual,
} from './agentFileChangesFromGit';
import { ModelPickerDropdown, type ModelPickerItem } from './ModelPickerDropdown';
import { GitBranchPickerDropdown } from './GitBranchPickerDropdown';
import { VoidSelect } from './VoidSelect';
import {
	AgentCommandPermissionDropdown,
	type CommandPermissionMode,
} from './AgentCommandPermissionDropdown';
import type { SettingsNavId } from './SettingsPage';
import {
	applyThemePresetToAppearance,
	applyAppearanceSettingsToDom,
	defaultAppearanceSettings,
	nativeWindowChromeFromAppearance,
	normalizeAppearanceSettings,
	replaceBuiltinChromeColorsForScheme,
	shouldMigrateChromeWhenLeavingScheme,
	type AppAppearanceSettings,
} from './appearanceSettings';
import { useAppColorScheme } from './useAppColorScheme';
import {
	type AppColorMode,
	getVoidMonacoTheme,
	readPrefersDark,
	readStoredColorMode,
	resolveEffectiveScheme,
	type ThemeTransitionOrigin,
	writeStoredColorMode,
} from './colorMode';
import {
	coerceDefaultModel,
	mergeEnabledIdsWithAllModels,
	paradigmForModelEntry,
	type UserLlmProvider,
	type UserModelEntry,
} from './modelCatalog';
import { ComposerPlusMenu, type ComposerMode } from './ComposerPlusMenu';
import { ComposerThoughtBlock } from './ComposerThoughtBlock';
import { ComposerAtMenu } from './ComposerAtMenu';
import { ComposerSlashMenu } from './ComposerSlashMenu';
import { PlanQuestionDialog } from './PlanQuestionDialog';
import { SkillScopeDialog } from './SkillScopeDialog';
import { RuleWizardDialog } from './RuleWizardDialog';
import { SubagentScopeDialog } from './SubagentScopeDialog';
import { ToolApprovalInlineCard } from './ToolApprovalCard';
import { AgentMistakeLimitDialog } from './AgentMistakeLimitDialog';
import { PlanReviewPanel } from './PlanReviewPanel';
import { flattenAssistantTextPartsForSearch } from './agentStructuredMessage';
import {
	parseQuestions,
	pendingPlanQuestionFromMessages,
	parsePlanDocument,
	planBodyWithTodos,
	toPlanMd,
	generatePlanFilename,
	type PlanQuestion,
	type ParsedPlan,
} from './planParser';
import {
	CREATE_SKILL_SLUG,
	getLeadingWizardCommand,
	newSegmentId,
	segmentsToWireText,
	segmentsTrimmedEmpty,
	userMessageToSegments,
	type ComposerSegment,
	type SlashCommandId,
} from './composerSegments';
import { getAtMentionRange } from './composerAtMention';
import { textBeforeCaretForAt } from './composerRichDom';
import { useComposerAtMention, type AtComposerSlot } from './useComposerAtMention';
import { useComposerSlashCommand } from './useComposerSlashCommand';
import { UserMessageRich } from './UserMessageRich';
import { BrandLogo } from './BrandLogo';
import {
	defaultAgentCustomization,
	isWorkspaceDiskImportedSkill,
	mergeSkillsBySlug,
	type AgentCustomization,
	type AgentRule,
	type AgentRuleScope,
	type AgentSkill,
	type AgentSubagent,
} from './agentSettingsTypes';
import { normalizeIndexingSettings, type IndexingSettingsState } from './indexingSettingsTypes';
import { defaultEditorSettings, editorSettingsToMonacoOptions, type EditorSettings } from './EditorSettingsPanel';
import type { McpServerConfig, McpServerStatus } from './mcpTypes';
import { EditorTabBar, tabIdFromPath, type MarkdownTabView } from './EditorTabBar';
import {
	initialMarkdownViewForTab,
	isMarkdownEditorPath,
	markdownViewForTab,
	stripLeadingYamlFrontmatter,
	stripPlanFrontmatterForPreview,
} from './editorMarkdownView';
import { isPlanMdPath, planExecutedKey } from './planExecutedKey';
import { MenubarFileMenu } from './MenubarFileMenu';
import { MenubarWindowMenu } from './MenubarWindowMenu';
import { QuickOpenPalette, quickOpenPrimaryShortcutLabel, saveShortcutLabel } from './quickOpenPalette';
import { registerTsLspMonacoOnce } from './tsLspMonaco';
import { monacoWorkspaceRootRef } from './tsLspWorkspaceRef';
import { workspaceRelativeFileUrl } from './workspaceUri';
import { voidShellDebugLog } from './tabCloseDebug';
import {
	classifyGitUnavailableReason,
	gitBranchTriggerTitle,
	gitUnavailableCopy,
	type GitUnavailableReason,
} from './gitAvailability';
import { deriveOriginalContentFromUnifiedDiff } from './editorInlineDiff';
import {
	IconArrowDown, IconExplorer, IconCloudOutline, IconServerOutline,
	IconGitSCM, IconSearch, IconRefresh, IconDoc, IconChevron,
	IconPlus, IconCloseSmall, IconPencil, IconTrash, IconCheckCircle, IconSettings,
	IconPlugin, IconHistory, IconDotsHorizontal, IconArrowUpRight, IconEye,
} from './icons';
import { useGitIntegration } from './hooks/useGitIntegration';
import { useWorkspaceManager } from './hooks/useWorkspaceManager';
import { useThreads } from './hooks/useThreads';
import { type ThreadInfo } from './threadTypes';
import { useAgentFileReview, type AgentFilePreviewState } from './hooks/useAgentFileReview';
import { useComposer } from './hooks/useComposer';
import {
	useEditorTabs,
	type EditorInlineDiffState,
	clampEditorTerminalHeight,
	EDITOR_TERMINAL_H_MAX_RATIO,
	EDITOR_TERMINAL_H_MIN,
	EDITOR_TERMINAL_HEIGHT_KEY,
} from './hooks/useEditorTabs';
import { ChatComposer, type ComposerAnchorSlot } from './ChatComposer';
import { EditorLeftSidebar } from './EditorLeftSidebar';
import { changeBadgeLabel, GitUnavailableState } from './gitBadge';

const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })));

type ProjectAgentSliceState = {
	rules: AgentRule[];
	skills: AgentSkill[];
	subagents: AgentSubagent[];
};

const EMPTY_PROJECT_AGENT: ProjectAgentSliceState = { rules: [], skills: [], subagents: [] };

function tagProjectOrigin<T extends { origin?: 'user' | 'project' }>(items: T[] | undefined): T[] {
	return (items ?? []).map((x) => ({ ...x, origin: 'project' as const }));
}

type LayoutMode = 'agent' | 'editor';
type AgentRightSidebarView = 'git' | 'plan' | 'file';
type EditorLeftSidebarView = 'explorer' | 'search' | 'git';
import {
	useI18n,
	isChatAssistantErrorLine,
	translateChatError,
	normalizeLocale,
	type AppLocale,
	type TFunction,
} from './i18n';
import './monacoSetup';


function debugDiffHead(diff: string, max = 160): string {
	return diff.replace(/\s+/g, ' ').slice(0, max);
}

function diffCreatesNewFile(diff: string | null | undefined): boolean {
	const text = String(diff ?? '');
	return /^new file mode\s/m.test(text) || /^---\s+\/dev\/null$/m.test(text);
}

function extractPlanMarkdownPreview(text: string): string {
	if (!text.trim()) {
		return '';
	}
	const flattened = flattenAssistantTextPartsForSearch(text);
	const heading = flattened.match(/^#\s+Plan:\s*.+$/m);
	if (!heading || heading.index === undefined) {
		return '';
	}
	return flattened.slice(heading.index).trim();
}

function extractPlanTitle(markdown: string): string | null {
	const match = markdown.match(/^#\s+Plan:\s*(.+)$/m);
	return match?.[1]?.trim() || null;
}

function extractMarkdownSection(markdown: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`^##\\s+${escaped}\\s*$`, 'm');
	const idx = markdown.search(regex);
	if (idx < 0) {
		return '';
	}
	const after = markdown.slice(idx).replace(regex, '').trim();
	const next = after.search(/^##\s+/m);
	return (next >= 0 ? after.slice(0, next) : after).trim();
}

function stripMarkdownSection(markdown: string, headingPattern: string): string {
	if (!markdown.trim()) {
		return '';
	}
	const regex = new RegExp(`^##\\s+(?:${headingPattern})\\s*$[\\s\\S]*?(?=^##\\s+|\\s*$)`, 'm');
	return markdown.replace(regex, '').replace(/\n{3,}/g, '\n\n').trim();
}
type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };
type AgentConversationFileOpenOptions = { diff?: string | null; allowReviewActions?: boolean };

const SIDEBAR_LAYOUT_KEY = 'async:sidebar-widths-v1';
const SHELL_LAYOUT_MODE_KEY = 'async:shell-layout-mode-v1';
function sameStringArray(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}


const RESIZE_HANDLE_PX = 5;
const LEFT_RAIL_MIN = 200;
const LEFT_RAIL_MAX = 960;
const RIGHT_RAIL_MIN = 260;
const RIGHT_RAIL_MAX = 1280;
const CENTER_MIN_PX = 320;

function escapeSubAgentXmlText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeStreamAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

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

function EditorFileBreadcrumb({ filePath }: { filePath: string }) {
	const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
	return (
		<div className="ref-editor-breadcrumb-inner" aria-label={filePath}>
			{parts.map((p, i) => (
				<Fragment key={`${i}-${p}`}>
					{i > 0 ? (
						<span className="ref-editor-bc-sep" aria-hidden>
							›
						</span>
					) : null}
					<span className={i === parts.length - 1 ? 'ref-editor-bc-current' : 'ref-editor-bc-part'}>{p}</span>
				</Fragment>
			))}
		</div>
	);
}

function clampSidebarLayout(left: number, right: number): { left: number; right: number } {
	const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
	let l = Math.min(Math.max(left, LEFT_RAIL_MIN), LEFT_RAIL_MAX);
	let r = Math.min(Math.max(right, RIGHT_RAIL_MIN), RIGHT_RAIL_MAX);
	const maxPair = w - 2 * RESIZE_HANDLE_PX - CENTER_MIN_PX;
	if (l + r > maxPair) {
		r = Math.max(RIGHT_RAIL_MIN, maxPair - l);
		if (r < RIGHT_RAIL_MIN || l + r > maxPair) {
			r = RIGHT_RAIL_MIN;
			l = Math.max(LEFT_RAIL_MIN, Math.min(LEFT_RAIL_MAX, maxPair - r));
		}
	}
	return { left: l, right: r };
}

/** 左、右各约 25% 视口，中间列用 1fr 占剩余约 50%（已扣除两条拖拽条宽度） */
function defaultQuarterRailWidths(): { left: number; right: number } {
	const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
	const usable = Math.max(0, w - 2 * RESIZE_HANDLE_PX);
	const quarter = Math.round(usable * 0.25);
	return clampSidebarLayout(quarter, quarter);
}

function syncDesktopSidebarLayout(
	shell: NonNullable<Window['asyncShell']> | undefined,
	c: { left: number; right: number }
): void {
	if (!shell) {
		return;
	}
	void shell.invoke('settings:set', {
		ui: { sidebarLayout: { left: c.left, right: c.right } },
	});
}

function readStoredShellLayoutMode(): LayoutMode {
	try {
		if (typeof window !== 'undefined') {
			const v = localStorage.getItem(SHELL_LAYOUT_MODE_KEY);
			if (v === 'agent' || v === 'editor') {
				return v;
			}
		}
	} catch {
		/* ignore */
	}
	return 'agent';
}

function writeStoredShellLayoutMode(m: LayoutMode) {
	try {
		localStorage.setItem(SHELL_LAYOUT_MODE_KEY, m);
	} catch {
		/* ignore */
	}
}

function syncDesktopShellLayoutMode(
	shell: NonNullable<Window['asyncShell']> | undefined,
	m: LayoutMode
): void {
	if (!shell) {
		return;
	}
	void shell.invoke('settings:set', { ui: { layoutMode: m } });
}

function readSidebarLayout(): { left: number; right: number } {
	try {
		if (typeof window !== 'undefined') {
			const raw = localStorage.getItem(SIDEBAR_LAYOUT_KEY);
			if (raw) {
				const j = JSON.parse(raw) as { left?: unknown; right?: unknown };
				if (
					typeof j.left === 'number' &&
					typeof j.right === 'number' &&
					Number.isFinite(j.left) &&
					Number.isFinite(j.right)
				) {
					return { left: j.left, right: j.right };
				}
			}
		}
	} catch {
		/* ignore */
	}
	return defaultQuarterRailWidths();
}


function shellCommandPermissionMode(agent: AgentCustomization | undefined): CommandPermissionMode {
	return agent?.confirmShellCommands === false ? 'always' : 'ask';
}

function GitDiffLines({ diff, t }: { diff: string; t: TFunction }) {
	const lines = diff.split('\n');
	return (
		<div className="ref-git-card-diff" role="region" aria-label={t('git.diffPreview')}>
			{lines.map((line, i) => {
				let mod = 'ref-git-diff-line';
				if (line.startsWith('+') && !line.startsWith('+++')) {
					mod += ' is-add';
				} else if (line.startsWith('-') && !line.startsWith('---')) {
					mod += ' is-del';
				} else if (line.startsWith('@@')) {
					mod += ' is-hunk';
				} else if (line.startsWith('diff ') || line.startsWith('index ')) {
					mod += ' is-meta';
				}
				return (
					<div key={i} className={mod}>
						{line || '\u00a0'}
					</div>
				);
			})}
		</div>
	);
}

function threadFileBasename(rel: string): string {
	const n = rel.replace(/\\/g, '/');
	const i = n.lastIndexOf('/');
	return i >= 0 ? n.slice(i + 1) : n;
}

function formatThreadRowSubtitle(tr: TFunction, t: ThreadInfo, isActive: boolean): ReactNode {
	const paths = t.filePaths ?? [];
	const fc = Math.max(t.fileCount ?? 0, paths.length);
	const add = t.additions ?? 0;
	const del = t.deletions ?? 0;
	const hasDiff = t.hasAgentDiff ?? false;

	if (t.isAwaitingReply) {
		const fb = (t.subtitleFallback ?? '').trim();
		if (fb) {
			return fb;
		}
	}

	if (isActive && hasDiff && paths.length > 0) {
		const names = paths.map(threadFileBasename);
		let s = names.join(', ');
		if (s.length > 52) {
			s = `${s.slice(0, 50)}…`;
		}
		return <>{tr('app.threadEdited', { names: s })}</>;
	}
	if (!isActive && hasDiff && (add > 0 || del > 0 || fc > 0)) {
		const n = fc > 0 ? fc : 1;
		return (
			<>
				<span className="ref-thread-meta-add">+{add}</span>{' '}
				<span className="ref-thread-meta-del">−{del}</span>
				<span className="ref-thread-meta-sep"> · </span>
				{n === 1 ? tr('app.threadFilesOne', { n }) : tr('app.threadFilesMany', { n })}
			</>
		);
	}
	const fb = (t.subtitleFallback ?? '').trim();
	return fb || '\u00a0';
}

function threadRowTitle(tr: TFunction, t: ThreadInfo): string {
	if (t.isAwaitingReply) {
		return t.title.startsWith('Draft:') || t.title.startsWith('草稿：')
			? t.title
			: tr('app.draftPrefix', { title: t.title });
	}
	return t.title;
}

function useAsyncShell() {
	return window.asyncShell;
}

function isEditableDomTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export default function App() {
	const shell = useAsyncShell();
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

	useEffect(() => {
		applyAppearanceSettingsToDom(appearanceSettings, effectiveScheme);
	}, [appearanceSettings, effectiveScheme]);

	useEffect(() => {
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

	// indexingSettings 前置声明，供 useWorkspaceManager 的 tsLspEnabled 使用
	// 初始值为默认值，init effect 加载完 settings:get 后会 setIndexingSettings 更新
	const [indexingSettings, setIndexingSettings] = useState<IndexingSettingsState>(() => normalizeIndexingSettings());

	// ── 提取的 hooks（必须在所有依赖其返回值的代码之前调用）──────────────────
	const {
		workspace,
		setWorkspace,
		workspaceFileList,
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
		tsLspStatus,
	} = useWorkspaceManager(shell, indexingSettings.tsLspEnabled);

	const {
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
	} = useGitIntegration(shell, workspace);

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
		loadMessages,
		resetThreadState,
	} = useThreads(shell);
	// ─────────────────────────────────────────────────────────────────────────

	/** Plan Build 成功后写入 threads.json；在 stream done 时与 pending 对齐 */
	const planBuildPendingMarkerRef = useRef<{ threadId: string; pathKey: string } | null>(null);
	const [streaming, setStreaming] = useState('');
	const [awaitingReply, setAwaitingReply] = useState(false);
	const [thinkingTick, setThinkingTick] = useState(0);
	const [thoughtSecondsByThread, setThoughtSecondsByThread] = useState<Record<string, number>>({});
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
	/** Plan 模式 — 结构化问题弹窗 */
	const [planQuestion, setPlanQuestion] = useState<PlanQuestion | null>(null);
	/** 若来自 ask_plan_question 工具，需在 IPC 中回传主进程以解除 execute 阻塞 */
	const [planQuestionRequestId, setPlanQuestionRequestId] = useState<string | null>(null);
	/** 用户在某线程对「当前最后一条助手消息」点了跳过，切回该线程时不再自动弹出同一题 */
	const planQuestionDismissedByThreadRef = useRef(new Map<string, string>());
	/** /create-skill | /create-rule | /create-subagent 发送前向导 */
	const [wizardPending, setWizardPending] = useState<{
		kind: SlashCommandId;
		tailSegments: ComposerSegment[];
		targetThreadId: string;
	} | null>(null);
	/** Plan 模式 — 解析出的计划文档 */
	const [parsedPlan, setParsedPlan] = useState<ParsedPlan | null>(null);
	/** Plan 文件绝对路径（磁盘） */
	const [planFilePath, setPlanFilePath] = useState<string | null>(null);
	/** 工作区内相对路径，用于在编辑器中打开预览 */
	const [planFileRelPath, setPlanFileRelPath] = useState<string | null>(null);
	/** 当前线程已执行 Build 的计划文件键（与 planExecutedKey 一致） */
	const [executedPlanKeys, setExecutedPlanKeys] = useState<string[]>([]);
	const [agentRightSidebarOpen, setAgentRightSidebarOpen] = useState(false);
	const [agentRightSidebarView, setAgentRightSidebarView] = useState<AgentRightSidebarView>('git');
	const [commitMsg, setCommitMsg] = useState('');
	const [lastTurnUsage, setLastTurnUsage] = useState<TurnTokenUsage | null>(null);
	const [settingsPageOpen, setSettingsPageOpen] = useState(false);
	const [settingsInitialNav, setSettingsInitialNav] = useState<SettingsNavId>('general');
	const [settingsOpenPending, startSettingsOpenTransition] = useTransition();
	const [layoutSwitchPending, startLayoutSwitchTransition] = useTransition();
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

	const [modelProviders, setModelProviders] = useState<UserLlmProvider[]>([]);
	const [defaultModel, setDefaultModel] = useState('');
	const [agentPlanBuildModelId, setAgentPlanBuildModelId] = useState('');
	const [planTodoDraftOpen, setPlanTodoDraftOpen] = useState(false);
	const [planTodoDraftText, setPlanTodoDraftText] = useState('');
	const [editorPlanBuildModelId, setEditorPlanBuildModelId] = useState('');
	const [editorPlanReviewDismissed, setEditorPlanReviewDismissed] = useState(false);
	const [thinkingByModelId, setThinkingByModelId] = useState<Record<string, ThinkingLevel>>({});
	const planTodoDraftInputRef = useRef<HTMLInputElement | null>(null);
	const [modelEntries, setModelEntries] = useState<UserModelEntry[]>([]);
	const [enabledModelIds, setEnabledModelIds] = useState<string[]>([]);
	const [agentCustomization, setAgentCustomization] = useState<AgentCustomization>(() => defaultAgentCustomization());
	/** 当前仓库 `.async/agent.json`（与全局 settings 分离） */
	const [projectAgentSlice, setProjectAgentSlice] = useState<ProjectAgentSliceState>(EMPTY_PROJECT_AGENT);
	/** 开启「导入第三方配置」时由主进程扫描磁盘 skills 目录（与对话侧合并逻辑一致） */
	const [workspaceDiskSkills, setWorkspaceDiskSkills] = useState<AgentSkill[]>([]);
	/** 删除磁盘技能后递增，触发重新扫描列表 */
	const [diskSkillsRefreshTicker, setDiskSkillsRefreshTicker] = useState(0);

	const mergedAgentCustomization = useMemo((): AgentCustomization => {
		const baseSkills = [...(agentCustomization.skills ?? []), ...projectAgentSlice.skills];
		const skills =
			workspaceDiskSkills.length > 0 ? mergeSkillsBySlug(baseSkills, workspaceDiskSkills) : baseSkills;
		return {
			...agentCustomization,
			rules: [...(agentCustomization.rules ?? []), ...projectAgentSlice.rules],
			skills,
			subagents: [...(agentCustomization.subagents ?? []), ...projectAgentSlice.subagents],
		};
	}, [agentCustomization, projectAgentSlice, workspaceDiskSkills]);

	const onChangeMergedAgentCustomization = useCallback(
		(next: AgentCustomization) => {
			const ur = next.rules?.filter((r) => (r.origin ?? 'user') !== 'project') ?? [];
			const pr = next.rules?.filter((r) => r.origin === 'project') ?? [];
			const skillsPersist = (next.skills ?? []).filter((s) => !isWorkspaceDiskImportedSkill(s));
			const us = skillsPersist.filter((s) => (s.origin ?? 'user') !== 'project') ?? [];
			const ps = skillsPersist.filter((s) => s.origin === 'project') ?? [];
			const ua = next.subagents?.filter((s) => (s.origin ?? 'user') !== 'project') ?? [];
			const pa = next.subagents?.filter((s) => s.origin === 'project') ?? [];
			setAgentCustomization({
				...next,
				rules: ur,
				skills: us,
				subagents: ua,
				commands: next.commands ?? [],
			});
			const proj: ProjectAgentSliceState = { rules: pr, skills: ps, subagents: pa };
			setProjectAgentSlice(proj);
			if (shell && workspace) {
				void shell.invoke('workspaceAgent:set', proj);
			}
		},
		[shell, workspace]
	);

	useEffect(() => {
		if (import.meta.env.DEV) {
			console.warn(
				'[VoidShell] 调试：在应用窗口按 Ctrl+Shift+I（macOS：⌥⌘I）打开开发者工具；输入 window.__voidShellTabCloseLog 查看最近记录。'
			);
		}
	}, []);

	useEffect(() => {
		if (!shell || !workspace) {
			setProjectAgentSlice(EMPTY_PROJECT_AGENT);
			return;
		}
		let cancelled = false;
		void (async () => {
			const r = (await shell.invoke('workspaceAgent:get')) as {
				ok?: boolean;
				slice?: { rules?: AgentRule[]; skills?: AgentSkill[]; subagents?: AgentSubagent[] };
			};
			if (cancelled) return;
			const sl = r?.slice;
			setProjectAgentSlice({
				rules: tagProjectOrigin(sl?.rules),
				skills: tagProjectOrigin(sl?.skills),
				subagents: tagProjectOrigin(sl?.subagents),
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace]);

	useEffect(() => {
		if (!shell || !workspace) {
			setWorkspaceDiskSkills([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const r = (await shell.invoke('workspace:listDiskSkills')) as { ok?: boolean; skills?: AgentSkill[] };
				if (cancelled) return;
				setWorkspaceDiskSkills(Array.isArray(r?.skills) ? r.skills : []);
			} catch {
				if (!cancelled) setWorkspaceDiskSkills([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace, diskSkillsRefreshTicker]);

	const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => defaultEditorSettings());
	const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
	const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
	const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => readStoredShellLayoutMode());
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
	const [workspaceMenuPath, setWorkspaceMenuPath] = useState<string | null>(null);
	const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<{ top: number; left: number } | null>(null);
	const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
	const workspaceMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
	const [editingWorkspacePath, setEditingWorkspacePath] = useState<string | null>(null);
	const [editingWorkspaceNameDraft, setEditingWorkspaceNameDraft] = useState('');
	const workspaceNameDraftRef = useRef('');
	const workspaceNameInputRef = useRef<HTMLInputElement | null>(null);
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
	} = useEditorTabs();
	const monacoDiffChangeDisposableRef = useRef<{ dispose(): void } | null>(null);
	useEffect(() => () => monacoDiffChangeDisposableRef.current?.dispose(), []);

	const [subAgentBgToast, setSubAgentBgToast] = useState<{ key: number; ok: boolean; text: string } | null>(null);
	const subAgentBgToastTimerRef = useRef<number | null>(null);
	const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const [quickOpenOpen, setQuickOpenOpen] = useState(false);
	const [quickOpenSeed, setQuickOpenSeed] = useState('');
	const [, setSidebarSearchDraft] = useState('');
	const editorTerminalCreateLockRef = useRef(false);
	const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
	const terminalMenuRef = useRef<HTMLDivElement>(null);
	const [fileMenuOpen, setFileMenuOpen] = useState(false);
	const fileMenuRef = useRef<HTMLDivElement>(null);
	const [editMenuOpen, setEditMenuOpen] = useState(false);
	const editMenuRef = useRef<HTMLDivElement>(null);
	const [viewMenuOpen, setViewMenuOpen] = useState(false);
	const viewMenuRef = useRef<HTMLDivElement>(null);
	const [windowMenuOpen, setWindowMenuOpen] = useState(false);
	const windowMenuRef = useRef<HTMLDivElement>(null);
	const [windowMaximized, setWindowMaximized] = useState(false);
	const [editorThreadHistoryOpen, setEditorThreadHistoryOpen] = useState(false);
	const [editorChatMoreOpen, setEditorChatMoreOpen] = useState(false);
	const editorHistoryMenuRef = useRef<HTMLDivElement>(null);
	const editorMoreMenuRef = useRef<HTMLDivElement>(null);
	const [homePath, setHomePath] = useState('');
	const [railWidths, setRailWidths] = useState(() => {
		const s = readSidebarLayout();
		return clampSidebarLayout(s.left, s.right);
	});
	const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
	const streamThreadRef = useRef<string | null>(null);
	const streamStartedAtRef = useRef<number | null>(null);
	const firstTokenAtRef = useRef<number | null>(null);
	const onNewThreadRef = useRef<() => Promise<void>>(async () => {});
	const composerRichHeroRef = useRef<HTMLDivElement>(null);
	const composerRichBottomRef = useRef<HTMLDivElement>(null);
	const composerRichInlineRef = useRef<HTMLDivElement>(null);
	const inlineResendRootRef = useRef<HTMLDivElement | null>(null);
	/** 对话消息滚动容器：新消息 / 流式输出时自动滚到底（用户上移阅读时暂停跟随） */
	const messagesViewportRef = useRef<HTMLDivElement>(null);
	const messagesTrackRef = useRef<HTMLDivElement>(null);
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


	const clearWorkspaceConversationState = useCallback(() => {
		streamThreadRef.current = null;
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		planBuildPendingMarkerRef.current = null;
		resetThreadState();
		resetAgentReviewState();
		resetComposerState();
		setLastTurnUsage(null);
		setAwaitingReply(false);
		setStreaming('');
		setParsedPlan(null);
		setPlanFilePath(null);
		setPlanFileRelPath(null);
		setExecutedPlanKeys([]);
		setPlanQuestion(null);
		setPlanQuestionRequestId(null);
		setEditingWorkspacePath(null);
		setEditingWorkspaceNameDraft('');
	}, [resetThreadState, resetAgentReviewState, resetComposerState]);

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

	const openSettingsPage = (nav: SettingsNavId) => {
		setModelPickerOpen(false);
		setPlusMenuOpen(false);
		startSettingsOpenTransition(() => {
			setSettingsInitialNav(nav);
			setSettingsPageOpen(true);
		});
	};

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
	const currentWorkspaceThreadCount = todayThreads.length + archivedThreads.length;

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

	useEffect(() => {
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

	const agentSidebarWorkspaces = useMemo(() => {
		return agentWorkspaceOrder
			.filter((path) => !hiddenAgentWorkspacePathSet.has(path))
			.slice(0, 8)
			.map((path) => ({
				path,
				name: workspaceAliases[path]?.trim() || workspacePathDisplayName(path),
				parent: workspacePathParent(path),
				isCurrent: path === workspace,
				isCollapsed: path === workspace ? collapsedAgentWorkspacePathSet.has(path) : !collapsedAgentWorkspacePathSet.has(path),
				threadCount: path === workspace ? currentWorkspaceThreadCount : 0,
			}));
	}, [
		agentWorkspaceOrder,
		workspace,
		hiddenAgentWorkspacePathSet,
		workspaceAliases,
		collapsedAgentWorkspacePathSet,
		currentWorkspaceThreadCount,
	]);

	const activeWorkspaceMenuItem = useMemo(
		() => agentSidebarWorkspaces.find((item) => item.path === workspaceMenuPath) ?? null,
		[agentSidebarWorkspaces, workspaceMenuPath]
	);

	const hasConversation = messages.length > 0 || !!streaming;
	const changeCount = gitChangedPaths.length;
	const gitUnavailableReason: GitUnavailableReason = gitStatusOk
		? 'none'
		: classifyGitUnavailableReason(gitLines[0]);
	const normalizedEditorSidebarSearchQuery = editorSidebarSearchQuery.trim().toLowerCase();
	const editorSidebarSearchResults = useMemo(() => {
		if (!normalizedEditorSidebarSearchQuery) {
			return [];
		}
		return workspaceFileList
			.map((rel) => {
				const normalizedRel = rel.replace(/\\/g, '/');
				const fileName = normalizedRel.split('/').pop() ?? normalizedRel;
				const lowerRel = normalizedRel.toLowerCase();
				const lowerFileName = fileName.toLowerCase();
				const fileIndex = lowerFileName.indexOf(normalizedEditorSidebarSearchQuery);
				const pathIndex = lowerRel.indexOf(normalizedEditorSidebarSearchQuery);
				if (fileIndex < 0 && pathIndex < 0) {
					return null;
				}
				return {
					rel: normalizedRel,
					fileName,
					dir:
						normalizedRel.includes('/') ? normalizedRel.slice(0, normalizedRel.lastIndexOf('/')) : '',
					fileIndex,
					pathIndex,
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null)
			.sort((a, b) => {
				const aScore = (a.fileIndex === -1 ? 10_000 : a.fileIndex) + (a.pathIndex === -1 ? 1_000 : a.pathIndex);
				const bScore = (b.fileIndex === -1 ? 10_000 : b.fileIndex) + (b.pathIndex === -1 ? 1_000 : b.pathIndex);
				if (aScore !== bScore) {
					return aScore - bScore;
				}
				return a.rel.localeCompare(b.rel);
			})
			.slice(0, 120);
	}, [workspaceFileList, normalizedEditorSidebarSearchQuery]);
	const editorSidebarSelectedRel = filePath.trim().replace(/\\/g, '/');
	const editorSidebarWorkspaceLabel = workspace ? workspaceBasename.toLocaleUpperCase() : t('app.noWorkspace');

	const hasSelectedModel = useMemo(() => defaultModel.trim().length > 0, [defaultModel]);

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

	const pendingAgentPatches = useMemo(
		() => (currentId ? agentReviewPendingByThread[currentId] ?? [] : []),
		[currentId, agentReviewPendingByThread]
	);
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


	const showTransientToast = useCallback((ok: boolean, text: string) => {
		if (subAgentBgToastTimerRef.current !== null) {
			window.clearTimeout(subAgentBgToastTimerRef.current);
			subAgentBgToastTimerRef.current = null;
		}
		setSubAgentBgToast((prev) => ({
			key: (prev?.key ?? 0) + 1,
			ok,
			text,
		}));
		subAgentBgToastTimerRef.current = window.setTimeout(() => {
			setSubAgentBgToast(null);
			subAgentBgToastTimerRef.current = null;
		}, 4200);
	}, []);

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
			setStreaming('');
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			firstTokenAtRef.current = null;
			streamStartedAtRef.current = Date.now();
			streamThreadRef.current = targetThreadId;
			setAwaitingReply(true);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				skillCreator: { userNote: tailWire, scope },
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				setAwaitingReply(false);
				streamStartedAtRef.current = null;
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
			setStreaming('');
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			firstTokenAtRef.current = null;
			streamStartedAtRef.current = Date.now();
			streamThreadRef.current = targetThreadId;
			setAwaitingReply(true);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				ruleCreator: {
					userNote: tailWire,
					ruleScope,
					...(ruleScope === 'glob' && globPattern?.trim() ? { globPattern: globPattern.trim() } : {}),
				},
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				setAwaitingReply(false);
				streamStartedAtRef.current = null;
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
			setStreaming('');
			setStreamingThinking('');
			clearStreamingToolPreviewNow();
			resetLiveAgentBlocks();
			firstTokenAtRef.current = null;
			streamStartedAtRef.current = Date.now();
			streamThreadRef.current = targetThreadId;
			setAwaitingReply(true);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: 'agent',
				modelId: defaultModel,
				subagentCreator: { userNote: tailWire, scope },
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				setAwaitingReply(false);
				streamStartedAtRef.current = null;
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
			refreshThreads,
			flashComposerAttachErr,
		]
	);

	const onDiscardAgentReview = useCallback(() => {
		if (currentId) {
			clearAgentReviewForThread(currentId);
		}
	}, [currentId, clearAgentReviewForThread]);

	const persistComposerAttachments = useCallback(
		async (files: File[]): Promise<string[]> => {
			if (!shell) {
				return [];
			}
			if (!workspace) {
				flashComposerAttachErr(t('composer.attach.noWorkspace'));
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
				const r = (await shell.invoke('workspace:saveComposerAttachment', {
					base64: b64,
					fileName: f.name,
				})) as { ok?: boolean; relPath?: string; error?: string };
				if (r?.ok && typeof r.relPath === 'string') {
					out.push(r.relPath);
				} else {
					const err = r?.error;
					if (err === 'too-large') {
						flashComposerAttachErr(t('composer.attach.tooLarge'));
					} else if (err === 'no-workspace') {
						flashComposerAttachErr(t('composer.attach.noWorkspace'));
					} else {
						flashComposerAttachErr(t('composer.attach.saveFailed'));
					}
				}
			}
			return out;
		},
		[shell, workspace, t, flashComposerAttachErr]
	);

	const onApplyAgentPatchOne = useCallback(
		async (id: string) => {
			if (!shell || !currentId) {
				return;
			}
			const list = agentReviewPendingByThread[currentId] ?? [];
			const patch = list.find((p) => p.id === id);
			if (!patch) {
				return;
			}
			setAgentReviewBusy(true);
			try {
				const ar = (await shell.invoke('agent:applyDiffChunk', {
					threadId: currentId,
					chunk: patch.chunk,
				})) as { applied: string[]; failed: { path: string; reason: string }[] };
				if (ar.applied.length > 0) {
					setAgentReviewPendingByThread((prev) => ({
						...prev,
						[currentId]: (prev[currentId] ?? []).filter((x) => x.id !== id),
					}));
				}
				await loadMessages(currentId);
				await refreshGit();
			} finally {
				setAgentReviewBusy(false);
			}
		},
		[shell, currentId, agentReviewPendingByThread, loadMessages, refreshGit]
	);

	const onApplyAgentPatchesAll = useCallback(async () => {
		if (!shell || !currentId) {
			return;
		}
		const list = agentReviewPendingByThread[currentId] ?? [];
		if (list.length === 0) {
			return;
		}
		setAgentReviewBusy(true);
		try {
			const ar = (await shell.invoke('agent:applyDiffChunks', {
				threadId: currentId,
				items: list.map((p) => ({ id: p.id, chunk: p.chunk })),
			})) as {
				applied: string[];
				failed: { path: string; reason: string }[];
				succeededIds: string[];
			};
			const okIds = new Set(ar.succeededIds ?? []);
			setAgentReviewPendingByThread((prev) => ({
				...prev,
				[currentId]: (prev[currentId] ?? []).filter((p) => !okIds.has(p.id)),
			}));
			await loadMessages(currentId);
			await refreshGit();
		} finally {
			setAgentReviewBusy(false);
		}
	}, [shell, currentId, agentReviewPendingByThread, loadMessages, refreshGit]);

	useEffect(() => {
		if (!shell) {
			setIpcOk(t('app.ipcBrowserOnly'));
			return;
		}
		void (async () => {
			try {
				const _t0 = performance.now();
				const _lap = (label: string) => console.log(`[renderer-init] ${label}: +${Math.round(performance.now() - _t0)}ms`);

				// 检查是否是空白窗口（新建窗口不恢复工作区）
				const isBlankWindow =
					typeof window !== 'undefined' &&
					(window.location.search.includes('blank=1') || window.location.hash.includes('blank'));

				// 第一批：互不依赖的 IPC 并行发送
				const [p, w, paths] = await Promise.all([
					shell.invoke('async-shell:ping') as Promise<{ ok: boolean; message: string }>,
					isBlankWindow
						? Promise.resolve({ root: null } as { root: string | null })
						: (shell.invoke('workspace:get') as Promise<{ root: string | null }>),
					shell.invoke('app:getPaths') as Promise<{ home?: string }>,
				]);
				_lap('batch1 (ping/workspace/paths)');
				setIpcOk(p.ok ? t('app.ipcReady', { message: p.message }) : t('app.ipcError'));
				if (!isBlankWindow) {
					setWorkspace(w.root);
				}
				if (paths.home) {
					setHomePath(paths.home);
				}

				// 第二批：threads 与 settings 并行加载
				_lap('batch2 start');
				const [, st] = await Promise.all([
					refreshThreads(),
					shell.invoke('settings:get') as Promise<{
						language?: string;
						defaultModel?: string;
						models?: {
							providers?: UserLlmProvider[];
							entries?: UserModelEntry[];
							enabledIds?: string[];
							thinkingByModelId?: Record<string, unknown>;
						};
						agent?: AgentCustomization;
						editor?: Partial<EditorSettings>;
						ui?: {
							sidebarLayout?: { left?: unknown; right?: unknown };
							colorMode?: string;
							fontPreset?: unknown;
							uiFontPreset?: unknown;
							codeFontPreset?: unknown;
							themePresetId?: unknown;
							accentColor?: unknown;
							backgroundColor?: unknown;
							foregroundColor?: unknown;
							translucentSidebar?: unknown;
							contrast?: unknown;
							usePointerCursors?: unknown;
							uiFontSize?: unknown;
							codeFontSize?: unknown;
							layoutMode?: string;
						};
						indexing?: {
							symbolIndexEnabled?: boolean;
							semanticIndexEnabled?: boolean;
							tsLspEnabled?: boolean;
						};
					}>,
				]);

				setLocale(normalizeLocale(st.language));
				const sl = st.ui?.sidebarLayout;
				const left = typeof sl?.left === 'number' && Number.isFinite(sl.left) ? sl.left : null;
				const right = typeof sl?.right === 'number' && Number.isFinite(sl.right) ? sl.right : null;
				if (left !== null && right !== null) {
					const rw = clampSidebarLayout(left, right);
					setRailWidths(rw);
					try {
						localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(rw));
					} catch {
						/* ignore */
					}
				} else {
					/** 桌面端曾仅依赖 file:// localStorage，易丢；首次把当前布局写入 settings.json */
					const s0 = readSidebarLayout();
					syncDesktopSidebarLayout(shell, clampSidebarLayout(s0.left, s0.right));
				}
				const lmRaw = st.ui?.layoutMode;
				if (lmRaw === 'agent' || lmRaw === 'editor') {
					setLayoutMode(lmRaw);
					writeStoredShellLayoutMode(lmRaw);
				} else {
					const lm0 = readStoredShellLayoutMode();
					setLayoutMode(lm0);
					syncDesktopShellLayoutMode(shell, lm0);
				}
				const rawProviders = Array.isArray(st.models?.providers) ? st.models!.providers! : [];
				setModelProviders(rawProviders);
				const rawEntries = Array.isArray(st.models?.entries) ? st.models!.entries! : [];
				setModelEntries(rawEntries);
				const saneEnabled = mergeEnabledIdsWithAllModels(rawEntries, st.models?.enabledIds);
				setEnabledModelIds(saneEnabled);
				setDefaultModel(coerceDefaultModel(st.defaultModel, rawEntries, saneEnabled));
				setThinkingByModelId(coerceThinkingByModelId(st.models?.thinkingByModelId));
				const ag = st.agent;
				const defs = defaultAgentCustomization();
				setAgentCustomization({
					...defs,
					...(ag ?? {}),
					importThirdPartyConfigs: true,
					rules: Array.isArray(ag?.rules) ? ag.rules : [],
					skills: Array.isArray(ag?.skills) ? ag.skills : [],
					subagents: Array.isArray(ag?.subagents) ? ag.subagents : [],
					commands: Array.isArray(ag?.commands) ? ag.commands : [],
					confirmShellCommands: ag?.confirmShellCommands ?? defs.confirmShellCommands,
					skipSafeShellCommandsConfirm: ag?.skipSafeShellCommandsConfirm ?? defs.skipSafeShellCommandsConfirm,
					confirmWritesBeforeExecute: ag?.confirmWritesBeforeExecute ?? defs.confirmWritesBeforeExecute,
					maxConsecutiveMistakes: ag?.maxConsecutiveMistakes ?? defs.maxConsecutiveMistakes,
					mistakeLimitEnabled: ag?.mistakeLimitEnabled ?? defs.mistakeLimitEnabled,
					backgroundForkAgent: ag?.backgroundForkAgent ?? defs.backgroundForkAgent,
				});
				if (st.editor) {
					setEditorSettings({ ...defaultEditorSettings(), ...st.editor });
				}
				setIndexingSettings(normalizeIndexingSettings(st.indexing));
				const cmRaw = st.ui?.colorMode;
				const nextColorMode: AppColorMode =
					cmRaw === 'light' || cmRaw === 'dark' || cmRaw === 'system' ? cmRaw : readStoredColorMode();
				setColorMode(nextColorMode);
				writeStoredColorMode(nextColorMode);
				const appearanceScheme = resolveEffectiveScheme(nextColorMode, readPrefersDark());
				setAppearanceSettings(normalizeAppearanceSettings(st.ui, appearanceScheme));
				_lap('batch2 (threads/settings + state apply)');

				// 第三批：MCP 服务器状态与 Git 状态并行加载
				const [mcpSt, mcpStatusRes] = await Promise.all([
					shell.invoke('mcp:getServers') as Promise<{ servers?: McpServerConfig[] } | undefined>,
					shell.invoke('mcp:getStatuses') as Promise<{ statuses?: McpServerStatus[] } | undefined>,
				]);
				setMcpServers(mcpSt?.servers ?? []);
				setMcpStatuses(mcpStatusRes?.statuses ?? []);
				_lap('batch3 (mcp)');
				// refreshGit 不阻塞 UI 渲染，fire-and-forget
				void refreshGit();
				_lap('init complete');
			} catch (e) {
				setIpcOk(String(e));
			}
		})();
	}, [shell, refreshThreads, refreshGit, t, setLocale]);

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

	useEffect(() => {
		setEditorExplorerCollapsed(false);
	}, [workspace]);

	useEffect(() => {
		if (layoutMode !== 'editor' || editorLeftSidebarView !== 'explorer' || editorExplorerCollapsed) {
			return;
		}
		const id = window.requestAnimationFrame(scrollEditorExplorerToTop);
		return () => window.cancelAnimationFrame(id);
	}, [layoutMode, editorLeftSidebarView, editorExplorerCollapsed, workspace, scrollEditorExplorerToTop]);

	useEffect(() => {
		if (!shell || !currentId) {
			return;
		}
		void loadMessages(currentId);
	}, [shell, currentId, loadMessages]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		const unsub = shell.subscribeChat((raw: unknown) => {
			const payload = raw as ChatStreamPayload;
			if (payload.threadId !== streamThreadRef.current) {
				return;
			}
			const trackLiveBlocks = composerMode === 'agent' || composerMode === 'plan';

			/** 工具参数必须每条 IPC 立即进块：多工具并行时单槽 rAF 合并会丢更新，导致无流式卡片 / 执行参数残缺。 */
			const applyToolInputDeltaUi = (p: {
				name: string;
				partialJson: string;
				index: number;
			}) => {
				if (streamingToolPreviewClearTimerRef.current !== null) {
					window.clearTimeout(streamingToolPreviewClearTimerRef.current);
					streamingToolPreviewClearTimerRef.current = null;
				}
				setStreamingToolPreview({
					name: p.name,
					partialJson: p.partialJson,
					index: p.index,
				});
				if (trackLiveBlocks) {
					setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_input_delta',
							name: p.name,
							partialJson: p.partialJson,
							index: p.index,
						})
					);
				}
			};

			if (payload.type === 'delta') {
				const subParent = payload.parentToolCallId;
				if (subParent) {
					const deltaText = payload.text;
					setStreaming((s) => {
						const inner = escapeSubAgentXmlText(deltaText);
						const p = escapeStreamAttr(subParent);
						const d = payload.nestingDepth ?? 1;
						return `${s}<sub_agent_delta parent="${p}" depth="${d}">${inner}</sub_agent_delta>`;
					});
					if (trackLiveBlocks) {
						setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'delta',
								text: deltaText,
								parentToolCallId: subParent,
								nestingDepth: payload.nestingDepth,
							})
						);
					}
				} else {
					if (payload.text.length > 0 && firstTokenAtRef.current === null) {
						firstTokenAtRef.current = Date.now();
					}
					setStreaming((s) => s + payload.text);
					if (trackLiveBlocks) {
						setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'delta',
								text: payload.text,
							})
						);
					}
				}
			} else if (payload.type === 'tool_input_delta') {
				if (payload.parentToolCallId) {
					// 嵌套工具参数流式预览易与主线程混淆，仅写入正文标记
				} else {
					applyToolInputDeltaUi({
						name: payload.name,
						partialJson: payload.partialJson,
						index: payload.index,
					});
				}
			} else if (payload.type === 'thinking_delta') {
				const parentToolCallId = payload.parentToolCallId;
				if (parentToolCallId) {
					setStreaming((s) => {
						const inner = escapeSubAgentXmlText(payload.text);
						const p = escapeStreamAttr(parentToolCallId);
						const d = payload.nestingDepth ?? 1;
						return `${s}<sub_agent_thinking parent="${p}" depth="${d}">${inner}</sub_agent_thinking>`;
					});
					if (trackLiveBlocks) {
						setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'thinking_delta',
								text: payload.text,
								parentToolCallId,
								nestingDepth: payload.nestingDepth,
							})
						);
					}
				} else {
					setStreamingThinking((s) => s + payload.text);
					if (trackLiveBlocks) {
						setLiveAssistantBlocks((st) =>
							applyLiveAgentChatPayload(st, {
								type: 'thinking_delta',
								text: payload.text,
							})
						);
					}
				}
			} else if (payload.type === 'tool_call') {
				if (!payload.parentToolCallId) {
					if (streamingToolPreviewClearTimerRef.current !== null) {
						window.clearTimeout(streamingToolPreviewClearTimerRef.current);
						streamingToolPreviewClearTimerRef.current = null;
					}
					// 不在此处清除 streamingToolPreview：
					// tool_call 与最后一帧 tool_input_delta 可能被 React 18 自动批量更新合并，
					// 导致流式预览帧从未渲染（卡片直到 tool_result 后才出现）。
					// 改为在 tool_result 或 done 事件中清除，
					// 期间 dropParsedStreamingFileEditWhilePreview 自动去重。
				}
				const nest =
					payload.parentToolCallId != null
						? ` sub_parent="${escapeStreamAttr(payload.parentToolCallId)}" sub_depth="${payload.nestingDepth ?? 1}"`
						: '';
				const marker = `\n<tool_call tool="${payload.name}"${nest}>${payload.args}</tool_call>\n`;
				setStreaming((s) => s + marker);
				if (trackLiveBlocks && !payload.parentToolCallId) {
					setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_call',
							name: payload.name,
							args: payload.args,
							toolCallId: payload.toolCallId,
						})
					);
				}
			} else if (payload.type === 'tool_result') {
				if (!payload.parentToolCallId) {
					setStreamingToolPreview(null);
				}
				const truncated = payload.result.length > 3000 ? payload.result.slice(0, 3000) + '\n... (truncated)' : payload.result;
				const safe = truncated.split('</tool_result>').join('</tool\u200c_result>');
				const marker = `<tool_result tool="${payload.name}" success="${payload.success}">${safe}</tool_result>\n`;
				setStreaming((s) => s + marker);
				if (trackLiveBlocks && !payload.parentToolCallId) {
					setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_result',
							name: payload.name,
							result: truncated,
							success: payload.success,
							toolCallId: payload.toolCallId,
						})
					);
				}
			} else if (payload.type === 'tool_progress') {
				if (trackLiveBlocks && !payload.parentToolCallId) {
					setLiveAssistantBlocks((st) =>
						applyLiveAgentChatPayload(st, {
							type: 'tool_progress',
							name: payload.name,
							phase: payload.phase,
							detail: payload.detail,
						})
					);
				}
			} else if (payload.type === 'tool_approval_request') {
				setToolApprovalRequest({
					approvalId: payload.approvalId,
					toolName: payload.toolName,
					command: payload.command,
					path: payload.path,
				});
			} else if (payload.type === 'plan_question_request') {
				setPlanQuestion(payload.question);
				setPlanQuestionRequestId(payload.requestId);
			} else if (payload.type === 'agent_mistake_limit') {
				setMistakeLimitRequest({
					recoveryId: payload.recoveryId,
					consecutiveFailures: payload.consecutiveFailures,
					threshold: payload.threshold,
				});
			} else if (payload.type === 'sub_agent_background_done') {
				if (subAgentBgToastTimerRef.current !== null) {
					window.clearTimeout(subAgentBgToastTimerRef.current);
					subAgentBgToastTimerRef.current = null;
				}
				const preview =
					payload.result.length > 240 ? `${payload.result.slice(0, 240)}…` : payload.result;
				const text = payload.success
					? t('agent.subAgentBg.done', { preview })
					: t('agent.subAgentBg.fail', { preview });
				setSubAgentBgToast((prev) => ({
					key: (prev?.key ?? 0) + 1,
					ok: payload.success,
					text,
				}));
				subAgentBgToastTimerRef.current = window.setTimeout(() => {
					setSubAgentBgToast(null);
					subAgentBgToastTimerRef.current = null;
				}, 6500);
			} else if (payload.type === 'done') {
				const start = streamStartedAtRef.current;
				const ft = firstTokenAtRef.current;
				const end = Date.now();
				const thinkSec =
					start !== null && ft !== null
						? Math.max(0.1, (ft - start) / 1000)
						: start !== null
							? Math.max(0.1, (end - start) / 1000)
							: 0.5;
				setThoughtSecondsByThread((prev) => ({ ...prev, [payload.threadId]: thinkSec }));
				if (payload.usage) {
					setLastTurnUsage(payload.usage);
				}
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
				setAwaitingReply(false);
				setStreaming('');
				setStreamingThinking('');
				setToolApprovalRequest(null);
				setMistakeLimitRequest(null);
				setPlanQuestionRequestId(null);
				clearStreamingToolPreviewNow();
				resetLiveAgentBlocks();
				setFileChangesDismissed(false);
				setDismissedFiles(new Set());
				const pendPlan = planBuildPendingMarkerRef.current;
				if (pendPlan && pendPlan.threadId === payload.threadId) {
					planBuildPendingMarkerRef.current = null;
					if (pendPlan.pathKey && shell) {
						void shell.invoke('threads:markPlanExecuted', {
							threadId: pendPlan.threadId,
							pathKey: pendPlan.pathKey,
						});
						if (pendPlan.threadId === currentIdRef.current) {
							setExecutedPlanKeys((prev) =>
								prev.includes(pendPlan.pathKey) ? prev : [...prev, pendPlan.pathKey]
							);
						}
					}
				}
				/* 新一轮助手回复落库前，勿让旧 persist 在 loadMessages 空窗期把面板状态粘回去 */
				clearPersistedAgentFileChanges(payload.threadId);
				if (payload.pendingAgentPatches && payload.pendingAgentPatches.length > 0) {
					setAgentReviewPendingByThread((prev) => ({
						...prev,
						[payload.threadId]: payload.pendingAgentPatches!,
					}));
				}

				const fullText = payload.text ?? '';
				/** 助手落盘为结构化 JSON；Plan 的 QUESTIONS / # Plan: 只在 text 块里，需展开后再解析 */
				const textForPlanMarkers = flattenAssistantTextPartsForSearch(fullText);
				/**
				 * 避免「先关掉 awaiting/streaming、再等 loadMessages」的一帧空窗：
				 * 那时 displayMessages 只用 messages，而库里的助手消息尚未写入，列表会瞬间变短，
				 * 滚动容器 scrollHeight 骤降，浏览器把 scrollTop 钳到 0，表现为跳到顶部。
				 */
				if (payload.threadId === currentIdRef.current) {
					setMessages((m) => {
						const last = m[m.length - 1];
						if (last?.role === 'assistant' && last.content === fullText) return m;
						return [...m, { role: 'assistant', content: fullText }];
					});
				}
				const q = parseQuestions(textForPlanMarkers);
				if (q) {
					setPlanQuestion(q);
					setPlanQuestionRequestId(null);
				} else {
					setPlanQuestion(null);
					setPlanQuestionRequestId(null);
				}

				const plan = parsePlanDocument(textForPlanMarkers);
				if (plan) {
					setParsedPlan(plan);
					const filename = generatePlanFilename(plan.name);
					const md = toPlanMd(plan);
					if (shell) {
						void (async () => {
							const r = (await shell.invoke('plan:save', { filename, content: md })) as
								| { ok: true; path: string; relPath?: string }
								| { ok: false };
							if (r.ok) {
								setPlanFilePath(r.path);
								if (r.relPath) {
									setPlanFileRelPath(r.relPath);
								} else {
									setPlanFileRelPath(null);
								}
							}
							// 同时保存结构化 plan 到 threadStore
							const structuredPlan = {
								title: plan.name,
								steps: plan.todos.map((t) => ({
									id: t.id,
									title: t.content.split(':')[0]?.trim() ?? t.content,
									description: t.content,
									status: 'pending' as const,
								})),
								updatedAt: Date.now(),
							};
							await shell.invoke('plan:saveStructured', {
								threadId: payload.threadId,
								plan: structuredPlan,
							});
						})();
					}
				}

				void loadMessages(payload.threadId);
				void refreshThreads();
			} else if (payload.type === 'error') {
				const start = streamStartedAtRef.current;
				const end = Date.now();
				const thinkSec =
					start !== null && firstTokenAtRef.current !== null
						? Math.max(0.1, (firstTokenAtRef.current - start) / 1000)
						: start !== null
							? Math.max(0.1, (end - start) / 1000)
							: 0.3;
				setThoughtSecondsByThread((prev) => ({ ...prev, [payload.threadId]: thinkSec }));
				planBuildPendingMarkerRef.current = null;
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
				setAwaitingReply(false);
				setStreaming('');
				setStreamingThinking('');
				setToolApprovalRequest(null);
				setMistakeLimitRequest(null);
				setPlanQuestionRequestId(null);
				clearStreamingToolPreviewNow();
				resetLiveAgentBlocks();
				setMessages((m) => [
					...m,
					{ role: 'assistant', content: t('app.errorPrefix', { message: translateChatError(payload.message, t) }) },
				]);
				void refreshThreads();
			}
		});
		return () => {
			unsub();
		};
	}, [shell, loadMessages, refreshThreads, clearStreamingToolPreviewNow, resetLiveAgentBlocks, t, composerMode]);

	useEffect(() => {
		monacoWorkspaceRootRef.current = workspace;
	}, [workspace]);

	const applyWorkspacePath = useCallback(
		async (next: string) => {
			clearWorkspaceConversationState();
			setWorkspace(next);
			// 并行而非串行，且 refreshGit 由 workspace 变化的 effect 触发，此处不重复调用
			await refreshThreads();
		},
		[clearWorkspaceConversationState, refreshThreads]
	);

	const openWorkspaceByPath = useCallback(
		async (path: string) => {
			if (!shell) {
				setWorkspacePickerOpen(true);
				return;
			}
			const r = (await shell.invoke('workspace:openPath', path)) as {
				ok: boolean;
				path?: string;
				error?: string;
			};
			if (r.ok && r.path) {
				await applyWorkspacePath(r.path);
			} else {
				setWorkspacePickerOpen(true);
			}
		},
		[shell, applyWorkspacePath]
	);

	const toggleWorkspaceCollapsed = useCallback((path: string) => {
		setCollapsedAgentWorkspacePaths((prev) =>
			prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
		);
	}, []);

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
			const ed = monacoEditorRef.current;
			if (!ed || !(ed.hasTextFocus?.() || ed.hasWidgetFocus?.())) {
				return false;
			}
			ed.focus();
			if (kind === 'undo' || kind === 'redo' || kind === 'selectAll') {
				ed.trigger('menu', kind, null);
				return true;
			}
			if (kind === 'copy' || kind === 'cut') {
				const actionId = kind === 'copy' ? 'editor.action.clipboardCopyAction' : 'editor.action.clipboardCutAction';
				const action = ed.getAction(actionId);
				if (action) {
					await action.run();
					return true;
				}
				return false;
			}
			const text = await readClipboardText();
			const sels = ed.getSelections();
			if (!sels || sels.length === 0) {
				return false;
			}
			ed.pushUndoStop();
			ed.executeEdits(
				'menu-paste',
				sels.map((sel) => ({
					range: sel,
					text,
					forceMoveMarkers: true,
				}))
			);
			ed.pushUndoStop();
			return true;
		},
		[readClipboardText]
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

	const closeWorkspaceMenu = useCallback(() => {
		setWorkspaceMenuPath(null);
		setWorkspaceMenuPosition(null);
		workspaceMenuAnchorRef.current = null;
	}, []);

	const openWorkspaceMenu = useCallback((path: string, anchor: HTMLButtonElement) => {
		workspaceMenuAnchorRef.current = anchor;
		setWorkspaceMenuPath(path);
	}, []);

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
			showTransientToast(true, trimmed ? t('app.workspaceRenamedToast', { name: trimmed }) : t('app.workspaceNameResetToast'));
		},
		[t, showTransientToast]
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
			setCollapsedAgentWorkspacePaths((prev) => prev.filter((item) => item !== path));
			setHiddenAgentWorkspacePaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
			setFolderRecents((prev) => prev.filter((item) => item !== path));
			setHomeRecents((prev) => prev.filter((item) => item !== path));
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
		[editingWorkspacePath, shell, showTransientToast, t, closeWorkspaceMenu]
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

	const onNewThread = async () => {
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
	};

	onNewThreadRef.current = onNewThread;

	const onNewThreadForWorkspace = useCallback(
		async (workspacePath: string) => {
			closeWorkspaceMenu();
			if (!workspacePath) {
				return;
			}
			if (workspacePath !== workspace) {
				setHiddenAgentWorkspacePaths((prev) => prev.filter((item) => item !== workspacePath));
				await openWorkspaceByPath(workspacePath);
			}
			await onNewThreadRef.current();
		},
		[workspace, openWorkspaceByPath, closeWorkspaceMenu]
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
	}, []);

	const onSelectThread = async (id: string) => {
		setEditorThreadHistoryOpen(false);
		if (!shell) {
			return;
		}
		await shell.invoke('threads:select', id);
		setCurrentId(id);
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
		await loadMessages(id);
	};

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
		[threadNavigation.history, currentId]
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
	}, [currentId, threadsChrono]);

	const goToNextThread = useCallback(async () => {
		if (!currentId) {
			return;
		}
		const index = threadsChrono.findIndex((thread) => thread.id === currentId);
		if (index <= 0) {
			return;
		}
		await onSelectThread(threadsChrono[index - 1]!.id);
	}, [currentId, threadsChrono]);

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
			setEditingThreadTitleDraft('');
			return;
		}
		const id = editingThreadId;
		const draft = threadTitleDraftRef.current.trim();
		const prev = threads.find((x) => x.id === id)?.title ?? '';
		setEditingThreadId(null);
		setEditingThreadTitleDraft('');
		if (!draft || draft === prev) {
			return;
		}
		const r = (await shell.invoke('threads:rename', id, draft)) as { ok?: boolean };
		if (r?.ok) {
			await refreshThreads();
		}
	}, [shell, editingThreadId, threads, refreshThreads]);

	const cancelThreadTitleEdit = useCallback(() => {
		setEditingThreadId(null);
		setEditingThreadTitleDraft('');
	}, []);

	const beginThreadTitleEdit = useCallback((t: ThreadInfo) => {
		setEditingThreadId(t.id);
		setEditingThreadTitleDraft(t.title);
		threadTitleDraftRef.current = t.title;
	}, []);

	const performThreadDelete = useCallback(
		async (id: string) => {
			if (!shell) {
				return;
			}
			voidShellDebugLog('thread-delete:perform', { threadId: id });
			const wasCurrent = id === currentId;
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
			setEditingThreadId((ed) => (ed === id ? null : ed));
			if (wasCurrent) {
				setMessages([]);
				setMessagesThreadId(null);
				setStreaming('');
				resetLiveAgentBlocks();
				setComposerSegments([]);
				setInlineResendSegments([]);
				setResendFromUserIndex(null);
			}
			await shell.invoke('threads:delete', id);
			clearPersistedAgentFileChanges(id);
			planQuestionDismissedByThreadRef.current.delete(id);
			await refreshThreads();
		},
		[shell, currentId, awaitingReply, refreshThreads, clearStreamingToolPreviewNow, resetLiveAgentBlocks]
	);

	const onDeleteThread = useCallback(
		async (e: React.MouseEvent, id: string) => {
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
			await performThreadDelete(id);
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

	const onSend = async (
		textOverride?: string,
		opts?: {
			threadId?: string;
			modeOverride?: ComposerMode;
			modelIdOverride?: string;
			planExecute?: ChatPlanExecutePayload;
			/** 非空时在本轮 stream 成功 done 后标记该计划文件已执行 Build */
			planBuildPathKey?: string;
		}
	) => {
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
		setPlanQuestion(null);
		setPlanQuestionRequestId(null);
		if (opts?.threadId && opts.threadId !== currentId) {
			await shell.invoke('threads:select', opts.threadId);
			setCurrentId(opts.threadId);
			await loadMessages(opts.threadId);
		}
		clearAgentReviewForThread(targetThreadId);
		if (resendIdx !== null) {
			setInlineResendSegments([]);
			setMessages((m) => [...m.slice(0, resendIdx), { role: 'user', content: text }]);
		} else {
			setComposerSegments([]);
			setMessages((m) => [...m, { role: 'user', content: text }]);
		}
		setStreaming('');
		setStreamingThinking('');
		clearStreamingToolPreviewNow();
		resetLiveAgentBlocks();
		firstTokenAtRef.current = null;
		streamStartedAtRef.current = Date.now();
		streamThreadRef.current = targetThreadId;
		setAwaitingReply(true);

		if (opts?.planExecute && opts.planBuildPathKey) {
			const pk = opts.planBuildPathKey.trim().toLowerCase();
			if (pk) {
				planBuildPendingMarkerRef.current = { threadId: targetThreadId, pathKey: pk };
			}
		}

		if (resendIdx !== null) {
			setResendFromUserIndex(null);
			const r = (await shell.invoke('chat:editResend', {
				threadId: targetThreadId,
				visibleIndex: resendIdx,
				text,
				mode: opts?.modeOverride ?? composerMode,
				modelId: opts?.modelIdOverride ?? defaultModel,
			})) as { ok?: boolean };
			if (!r?.ok) {
				setAwaitingReply(false);
				streamStartedAtRef.current = null;
				setResendFromUserIndex(resendIdx);
				setInlineResendSegments(userMessageToSegments(text, workspaceFileList));
				void loadMessages(targetThreadId);
			} else {
				void refreshThreads();
			}
			return;
		}

		await shell.invoke('chat:send', {
			threadId: targetThreadId,
			text,
			mode: opts?.modeOverride ?? composerMode,
			modelId: opts?.modelIdOverride ?? defaultModel,
			planExecute: opts?.planExecute,
		});
		void refreshThreads();
	};

	const onAbort = async () => {
		if (!shell || !currentId) {
			return;
		}
		planBuildPendingMarkerRef.current = null;
		setMistakeLimitRequest(null);
		await shell.invoke('chat:abort', currentId);
		// Let the 'done' event from backend finalize the state
		clearStreamingToolPreviewNow();
		resetLiveAgentBlocks();
		setAwaitingReply(false);
	};

	const onPlanQuestionSubmit = (answer: string) => {
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
	};

	const onPlanQuestionSkip = useCallback(() => {
		const id = currentIdRef.current;
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		if (id && last) {
			planQuestionDismissedByThreadRef.current.set(id, hashAgentAssistantContent(last.content));
		}
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
	}, [t, onSend, shell, planQuestionRequestId]);

	const getLatestAgentPlan = useCallback((): ParsedPlan | null => {
		if (parsedPlan) {
			return parsedPlan;
		}
		const streamingPlanMarkdown = extractPlanMarkdownPreview(streaming);
		if (streamingPlanMarkdown) {
			return parsePlanDocument(streamingPlanMarkdown);
		}
		for (const message of [...messagesRef.current].reverse()) {
			if (message.role !== 'assistant') {
				continue;
			}
			const persistedPlanMarkdown = extractPlanMarkdownPreview(message.content);
			if (persistedPlanMarkdown) {
				return parsePlanDocument(persistedPlanMarkdown);
			}
		}
		return null;
	}, [parsedPlan, streaming]);

	const planToStructuredDraft = useCallback((plan: ParsedPlan) => {
		return {
			title: plan.name,
			steps: plan.todos.map((todo) => ({
				id: todo.id,
				title: todo.content.split(':')[0]?.trim() ?? todo.content,
				description: todo.content,
				status: todo.status === 'completed' ? ('completed' as const) : ('pending' as const),
			})),
			updatedAt: Date.now(),
		};
	}, []);

	const persistPlanDraft = useCallback(
		async (plan: ParsedPlan) => {
			if (!shell) {
				return;
			}
			try {
				const content = toPlanMd(plan);
				if (planFileRelPath || planFilePath) {
					await shell.invoke('fs:writeFile', planFileRelPath ?? planFilePath ?? '', content);
				} else {
					const filename = generatePlanFilename(plan.name);
					const r = (await shell.invoke('plan:save', { filename, content })) as
						| { ok: true; path: string; relPath?: string }
						| { ok: false; error?: string };
					if (r.ok) {
						setPlanFilePath(r.path);
						setPlanFileRelPath(r.relPath ?? null);
					}
				}
				const threadId = currentIdRef.current;
				if (threadId) {
					await shell.invoke('plan:saveStructured', {
						threadId,
						plan: planToStructuredDraft(plan),
					});
				}
			} catch (error) {
				console.error('[plan:draftPersist]', error);
			}
		},
		[shell, planFileRelPath, planFilePath, planToStructuredDraft]
	);

	const updatePlanDraft = useCallback(
		(mutator: (plan: ParsedPlan) => ParsedPlan | null) => {
			const basePlan = getLatestAgentPlan();
			if (!basePlan) {
				return null;
			}
			const nextPlan = mutator(basePlan);
			if (!nextPlan) {
				return null;
			}
			setParsedPlan(nextPlan);
			void persistPlanDraft(nextPlan);
			return nextPlan;
		},
		[getLatestAgentPlan, persistPlanDraft]
	);

	const onPlanTodoToggle = useCallback(
		(id: string) => {
			updatePlanDraft((basePlan) => ({
				...basePlan,
				todos: basePlan.todos.map((t) =>
						t.id === id
							? { ...t, status: t.status === 'completed' ? 'pending' as const : 'completed' as const }
							: t
					),
			}));
		},
		[updatePlanDraft]
	);

	const onPlanAddTodo = useCallback(() => {
		if (!getLatestAgentPlan()) {
			return;
		}
		setPlanTodoDraftOpen(true);
		setPlanTodoDraftText('');
	}, [getLatestAgentPlan]);

	const onPlanAddTodoCancel = useCallback(() => {
		setPlanTodoDraftOpen(false);
		setPlanTodoDraftText('');
	}, []);

	const onPlanAddTodoSubmit = useCallback(() => {
		const nextText = planTodoDraftText.trim();
		if (!nextText) {
			return;
		}
		updatePlanDraft((currentPlan) => {
			const nextIndex = currentPlan.todos.length + 1;
			return {
				...currentPlan,
				todos: [
					...currentPlan.todos,
					{
						id: `todo-${nextIndex}`,
						content: nextText,
						status: 'pending',
					},
				],
			};
		});
		setPlanTodoDraftOpen(false);
		setPlanTodoDraftText('');
	}, [planTodoDraftText, updatePlanDraft]);

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
			onSend,
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
			onSend,
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

	/** 仅工具栏切换时持久化；打开文件等临时切到 editor 不写偏好 */
	const pickShellLayoutMode = useCallback(
		(next: LayoutMode) => {
			if (next === layoutMode) {
				setLayoutSwitchTarget(null);
				return;
			}
			setLayoutSwitchTarget(next);
			startLayoutSwitchTransition(() => {
				setLayoutMode(next);
				writeStoredShellLayoutMode(next);
				if (shell) {
					void shell.invoke('settings:set', { ui: { layoutMode: next } });
				}
			});
		},
		[layoutMode, shell]
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
				confirmShellCommands: agentCustomization.confirmShellCommands,
				skipSafeShellCommandsConfirm: agentCustomization.skipSafeShellCommandsConfirm,
				confirmWritesBeforeExecute: agentCustomization.confirmWritesBeforeExecute,
				maxConsecutiveMistakes: agentCustomization.maxConsecutiveMistakes,
				mistakeLimitEnabled: agentCustomization.mistakeLimitEnabled,
				backgroundForkAgent: agentCustomization.backgroundForkAgent,
			},
			editor: editorSettings,
			indexing: {
				symbolIndexEnabled: indexingSettings.symbolIndexEnabled,
				semanticIndexEnabled: indexingSettings.semanticIndexEnabled,
				tsLspEnabled: indexingSettings.tsLspEnabled,
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
				layoutMode,
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

	const switchLayoutModeFromSettings = useCallback(
		async (next: LayoutMode) => {
			if (next === layoutMode) {
				return;
			}
			await closeSettingsPage();
			pickShellLayoutMode(next);
		},
		[closeSettingsPage, layoutMode, pickShellLayoutMode]
	);

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

	const onChangeModelEntries = useCallback((entries: UserModelEntry[]) => {
		setModelEntries(entries);
		setEnabledModelIds((prev) => mergeEnabledIdsWithAllModels(entries, prev));
	}, []);

	const onChangeModelProviders = useCallback((providers: UserLlmProvider[]) => {
		setModelProviders(providers);
	}, []);

	const onPickDefaultModel = useCallback(
		async (id: string) => {
			setDefaultModel(id);
			if (shell) {
				await shell.invoke('settings:set', { defaultModel: id });
			}
		},
		[shell]
	);

	const onPersistIndexingPatch = useCallback(
		(patch: Partial<IndexingSettingsState>) => {
			if (!shell) {
				return;
			}
			void shell.invoke('settings:set', { indexing: patch });
		},
		[shell]
	);

	const onRefreshMcpStatuses = useCallback(async () => {
		if (!shell) return;
		const r = (await shell.invoke('mcp:getStatuses')) as { statuses?: McpServerStatus[] } | undefined;
		setMcpStatuses(r?.statuses ?? []);
	}, [shell]);

	const onStartMcpServer = useCallback(async (id: string) => {
		if (!shell) return;
		await shell.invoke('mcp:startServer', id);
		await onRefreshMcpStatuses();
	}, [shell, onRefreshMcpStatuses]);

	const onStopMcpServer = useCallback(async (id: string) => {
		if (!shell) return;
		await shell.invoke('mcp:stopServer', id);
		await onRefreshMcpStatuses();
	}, [shell, onRefreshMcpStatuses]);

	const onRestartMcpServer = useCallback(async (id: string) => {
		if (!shell) return;
		await shell.invoke('mcp:restartServer', id);
		await onRefreshMcpStatuses();
	}, [shell, onRefreshMcpStatuses]);

	const modelPickerItems = useMemo((): ModelPickerItem[] => {
		const enabledSet = new Set(enabledModelIds);
		return modelEntries
			.filter((e) => enabledSet.has(e.id) && (e.displayName.trim() || e.requestName.trim()))
			.map((e) => {
				const paradigm = paradigmForModelEntry(e, modelProviders);
				const paradigmLabel = paradigm ? t(`settings.paradigm.${paradigm}`) : '—';
				const provLabel = modelProviders.find((p) => p.id === e.providerId)?.displayName?.trim() ?? '';
				return {
					id: e.id,
					label: e.displayName.trim() || e.requestName,
					description: `${paradigmLabel} · ${e.requestName || t('modelPicker.requestNameMissing')}`,
					providerLabel: provLabel,
				};
			});
	}, [enabledModelIds, modelEntries, modelProviders, t]);

	const modelPillLabel = useMemo(() => {
		if (!defaultModel.trim()) {
			return t('modelPicker.selectModel');
		}
		const e = modelEntries.find((x) => x.id === defaultModel);
		return e ? e.displayName.trim() || e.requestName || defaultModel : defaultModel;
	}, [defaultModel, modelEntries, t]);

	const setEditorInlineDiffState = useCallback((relPath: string, state: EditorInlineDiffState | null) => {
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
	}, []);

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
			let originalContent = previewDiff ? deriveOriginalContentFromUnifiedDiff(content, previewDiff) : null;
			let reviewMode: EditorInlineDiffState['reviewMode'] = 'readonly';

			if (currentId && sourceAllowsReviewActions) {
				try {
					const snapshotResult = (await shell.invoke('agent:getFileSnapshot', currentId, normalizedRel)) as
						| { ok: true; hasSnapshot: false }
						| { ok: true; hasSnapshot: true; previousContent: string | null }
						| { ok?: false };
					if (snapshotResult?.ok && snapshotResult.hasSnapshot) {
						originalContent = snapshotResult.previousContent ?? '';
						previewDiff = createTwoFilesPatch(
							`a/${normalizedRel}`,
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
							const gitOriginal = deriveOriginalContentFromUnifiedDiff(content, gitPreviewDiff);
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
		[resolveEditorInlineDiff, setEditorInlineDiffState, shell, t]
	);

	const onLoadFile = async () => {
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
	};

	const onSaveFile = async () => {
		if (!shell || !filePath.trim()) {
			return;
		}
		await shell.invoke('fs:writeFile', filePath.trim(), editorValue);
		// Mark tab as clean
		setOpenTabs((prev) => prev.map((tab) => tab.filePath === filePath.trim() ? { ...tab, dirty: false } : tab));
		// Show save toast
		setSaveToastKey((k) => k + 1);
		setSaveToastVisible(true);
		setTimeout(() => setSaveToastVisible(false), 1900);
		await refreshGit();
		const inlineDiff = await resolveEditorInlineDiff(filePath.trim(), editorValue);
		setEditorInlineDiffState(filePath.trim(), inlineDiff);
	};

	/** Open a file in the tab bar (or activate existing tab) and load it into the editor */
	const openFileInTab = useCallback(
		async (
			rel: string,
			revealLine?: number,
			revealEndLine?: number,
			opts?: ({ background?: boolean } & AgentConversationFileOpenOptions)
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
		[layoutMode, loadFileIntoEditor, setEditorInlineDiffState, shell, t]
	);

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
							hunkCount: buildAgentFilePreviewHunks(previewDiff).length,
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
							hunkCount: buildAgentFilePreviewHunks(gitPreviewDiff).length,
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
							hunkCount: buildAgentFilePreviewHunks(previewDiff).length,
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
							hunkCount: buildAgentFilePreviewHunks(previewDiff).length,
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
				buildAgentFilePreviewHunks(previewDiff).length === 0
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
							hunkCount: buildAgentFilePreviewHunks(previewDiff).length,
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

			const previewHunks = !isBinary ? buildAgentFilePreviewHunks(previewDiff) : [];
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
		[currentId, diffPreviews, gitChangedPaths, gitStatusOk, layoutMode, openFileInTab, shell]
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
			if (r?.ok) setDiskSkillsRefreshTicker((k) => k + 1);
			return !!r?.ok;
		} catch {
			return false;
		}
	}, [shell]);

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
		[openTabs, activeTabId, loadFileIntoEditor]
	);

	const onSelectTab = useCallback(async (tabId: string) => {
		setActiveTabId(tabId);
		const tab = openTabs.find((t2) => t2.id === tabId);
		if (tab) {
			setFilePath(tab.filePath);
			pendingEditorHighlightRangeRef.current = null;
			void loadFileIntoEditor(tab.filePath);
		}
	}, [openTabs, loadFileIntoEditor]);

	// Cmd+S / Ctrl+S keyboard shortcut
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 's') {
				e.preventDefault();
				void onSaveFile();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	});

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

	const planReviewPathKeyMemo = useMemo(
		() => planExecutedKey(workspace, planFileRelPath, planFilePath),
		[workspace, planFileRelPath, planFilePath]
	);

	const planReviewIsBuilt = useMemo(
		() => Boolean(planReviewPathKeyMemo && executedPlanKeys.includes(planReviewPathKeyMemo)),
		[planReviewPathKeyMemo, executedPlanKeys]
	);
	const latestPersistedAgentPlanMarkdown = useMemo(() => {
		if (!currentId || messagesThreadId !== currentId) {
			return '';
		}
		for (const message of [...messages].reverse()) {
			if (message.role !== 'assistant') {
				continue;
			}
			const markdown = extractPlanMarkdownPreview(message.content);
			if (markdown) {
				return markdown;
			}
		}
		return '';
	}, [currentId, messagesThreadId, messages]);
	const agentPlanPreviewMarkdown = useMemo(() => {
		if (parsedPlan) {
			return planBodyWithTodos(parsedPlan);
		}
		const streamingPreview = extractPlanMarkdownPreview(streaming);
		return streamingPreview || latestPersistedAgentPlanMarkdown;
	}, [parsedPlan, streaming, latestPersistedAgentPlanMarkdown]);
	const agentPlanEffectivePlan = useMemo(
		() => (parsedPlan ? parsedPlan : agentPlanPreviewMarkdown ? parsePlanDocument(agentPlanPreviewMarkdown) : null),
		[parsedPlan, agentPlanPreviewMarkdown]
	);
	const agentPlanPreviewTitle = useMemo(() => {
		return agentPlanEffectivePlan?.name ?? extractPlanTitle(agentPlanPreviewMarkdown);
	}, [agentPlanEffectivePlan, agentPlanPreviewMarkdown]);
	const agentPlanDocumentMarkdown = useMemo(() => {
		if (!agentPlanPreviewMarkdown) {
			return '';
		}
		const stripped = stripMarkdownSection(agentPlanPreviewMarkdown, 'To-dos|Todos|TODOs?');
		return stripped || agentPlanPreviewMarkdown;
	}, [agentPlanPreviewMarkdown]);
	const agentPlanGoalMarkdown = useMemo(() => {
		if (!agentPlanPreviewMarkdown) {
			return '';
		}
		return extractMarkdownSection(agentPlanPreviewMarkdown, 'Goal').trim();
	}, [agentPlanPreviewMarkdown]);
	const agentPlanTodos = useMemo(() => agentPlanEffectivePlan?.todos ?? [], [agentPlanEffectivePlan]);
	const agentPlanTodoDoneCount = useMemo(
		() => agentPlanTodos.filter((todo) => todo.status === 'completed').length,
		[agentPlanTodos]
	);
	const agentPlanGoalSummary = useMemo(() => {
		if (!agentPlanGoalMarkdown) {
			return '';
		}
		return agentPlanGoalMarkdown.split('\n')[0]?.trim() ?? '';
	}, [agentPlanGoalMarkdown]);
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
	const hasAgentPlanSidebarContent = Boolean(agentPlanPreviewMarkdown.trim());
	const agentPlanSidebarAutopenRef = useRef(false);

	useEffect(() => {
		if (!defaultModel.trim()) {
			return;
		}
		setAgentPlanBuildModelId((prev) => (prev.trim() ? prev : defaultModel));
	}, [defaultModel, parsedPlan, agentPlanPreviewMarkdown]);

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

	useEffect(() => {
		if (!planTodoDraftOpen) {
			return;
		}
		const id = window.requestAnimationFrame(() => {
			planTodoDraftInputRef.current?.focus();
			planTodoDraftInputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(id);
	}, [planTodoDraftOpen]);

	useEffect(() => {
		if (!agentPlanEffectivePlan) {
			setPlanTodoDraftOpen(false);
			setPlanTodoDraftText('');
		}
	}, [agentPlanEffectivePlan]);

	useEffect(() => {
		setEditorPlanReviewDismissed(false);
	}, [currentId, composerMode, agentPlanPreviewMarkdown]);

	const onMonacoMount = useCallback(
		(ed: MonacoEditorNS.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
			monacoDiffChangeDisposableRef.current?.dispose();
			monacoDiffChangeDisposableRef.current = null;
			monacoEditorRef.current = ed;
			if (shell) {
				registerTsLspMonacoOnce(monaco, shell, workspace);
			}
		},
		[shell, workspace]
	);

	const onMonacoDiffMount = useCallback(
		(diffEditor: MonacoEditorNS.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => {
			const modifiedEditor = diffEditor.getModifiedEditor();
			const modifiedModel = modifiedEditor.getModel();
			monacoDiffChangeDisposableRef.current?.dispose();
			monacoDiffChangeDisposableRef.current =
				modifiedModel?.onDidChangeContent(() => {
					const nextValue = modifiedEditor.getValue();
					setEditorValue(nextValue);
					setOpenTabs((prev) =>
						prev.map((tab) => (tab.filePath === filePath.trim() ? { ...tab, dirty: true } : tab))
					);
				}) ?? null;
			monacoEditorRef.current = modifiedEditor;
			if (shell) {
				registerTsLspMonacoOnce(monaco, shell, workspace);
			}
		},
		[filePath, setEditorValue, setOpenTabs, shell, workspace]
	);

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

	const tsLspPillTitle = useMemo(() => {
		if (!workspace) {
			return t('app.lspSoon');
		}
		if (tsLspStatus === 'starting') {
			return t('app.lspStarting');
		}
		if (tsLspStatus === 'ready') {
			return t('app.lspReady');
		}
		if (tsLspStatus === 'error') {
			return t('app.lspUnavailable');
		}
		return t('app.lspSoon');
	}, [workspace, tsLspStatus, t]);

	const tsLspPillClassName =
		tsLspStatus === 'ready'
			? 'ref-lsp-pill ref-lsp-pill--ready'
			: tsLspStatus === 'starting'
				? 'ref-lsp-pill ref-lsp-pill--starting'
				: tsLspStatus === 'error'
					? 'ref-lsp-pill ref-lsp-pill--error'
					: 'ref-lsp-pill';

	const openQuickOpen = useCallback((seed = '') => {
		setQuickOpenSeed(seed);
		setQuickOpenOpen(true);
	}, []);

	const focusSearchSidebarFromQuickOpen = useCallback((q: string) => {
		setSidebarSearchDraft(q);
		setQuickOpenSeed(`%${q}`);
		setQuickOpenOpen(true);
	}, []);

	const appendEditorTerminal = useCallback(async (opts?: { cwdRel?: string }) => {
		if (editorTerminalCreateLockRef.current || !shell) {
			return;
		}
		editorTerminalCreateLockRef.current = true;
		try {
			const r = (await shell.invoke(
				'terminal:ptyCreate',
				opts?.cwdRel != null && opts.cwdRel !== '' ? { cwdRel: opts.cwdRel } : undefined
			)) as {
				ok: boolean;
				id?: string;
				error?: string;
			};
			if (!r.ok || !r.id) {
				return;
			}
			setEditorTerminalSessions((prev) => {
				const n = prev.length + 1;
				return [...prev, { id: r.id!, title: t('app.terminalTabN', { n: String(n) }) }];
			});
			setActiveEditorTerminalId(r.id);
		} finally {
			editorTerminalCreateLockRef.current = false;
		}
	}, [shell, t]);

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

	const closeEditorTerminalPanel = useCallback(() => {
		setEditorTerminalSessions((prev) => {
			for (const s of prev) {
				void shell?.invoke('terminal:ptyKill', s.id);
			}
			return [];
		});
		setActiveEditorTerminalId(null);
		setEditorTerminalVisible(false);
	}, [shell]);

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
	}, [shell, clearWorkspaceConversationState, closeEditorTerminalPanel, refreshThreads, refreshGit]);

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
	}, [shell, applyWorkspacePath]);

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
	}, [shell, workspace, filePath, editorValue, activeTabId, t, refreshGit]);

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
	}, [shell, filePath]);

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

	const fileMenuQuit = useCallback(async () => {
		if (shell) {
			await shell.invoke('app:quit');
		} else {
			window.close();
		}
	}, [shell]);

	const closeEditorTerminalSession = useCallback(
		(id: string) => {
			void shell?.invoke('terminal:ptyKill', id);
			setEditorTerminalSessions((prev) => {
				const next = prev.filter((s) => s.id !== id);
				if (next.length === 0) {
					setEditorTerminalVisible(false);
				}
				return next;
			});
		},
		[shell]
	);

	const onEditorTerminalSessionExit = useCallback((id: string) => {
		setEditorTerminalSessions((prev) => {
			const next = prev.filter((s) => s.id !== id);
			if (next.length === 0) {
				setEditorTerminalVisible(false);
			}
			return next;
		});
	}, []);

	const spawnEditorTerminal = useCallback(() => {
		setEditorTerminalVisible(true);
		setTerminalMenuOpen(false);
		void appendEditorTerminal();
	}, [appendEditorTerminal]);

	useEffect(() => {
		if (!terminalMenuOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (terminalMenuRef.current?.contains(e.target as Node)) {
				return;
			}
			setTerminalMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [terminalMenuOpen]);

	useEffect(() => {
		if (!fileMenuOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (fileMenuRef.current?.contains(e.target as Node)) {
				return;
			}
			setFileMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [fileMenuOpen]);

	useEffect(() => {
		if (!editMenuOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (editMenuRef.current?.contains(e.target as Node)) {
				return;
			}
			setEditMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [editMenuOpen]);

	useEffect(() => {
		if (!viewMenuOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (viewMenuRef.current?.contains(e.target as Node)) {
				return;
			}
			setViewMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [viewMenuOpen]);

	useEffect(() => {
		if (!windowMenuOpen) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (windowMenuRef.current?.contains(e.target as Node)) {
				return;
			}
			setWindowMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [windowMenuOpen]);

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

	const atMention = useComposerAtMention(
		(slot) => (slot === 'inline' && resendIdxRef.current !== null ? setInlineResendSegments : setComposerSegments),
		composerRichSurface,
		{
			gitChangedPaths,
			currentThreadTitle,
			workspaceOpen: !!workspace,
			workspaceFiles: workspaceFileList,
			onFileChipPreview: (relPath: string) => void onExplorerOpenFile(relPath),
		}
	);
	const slashCommand = useComposerSlashCommand(
		(slot) => (slot === 'inline' && resendIdxRef.current !== null ? setInlineResendSegments : setComposerSegments),
		composerRichSurface,
		{ t, userCommands: mergedAgentCustomization.commands }
	);
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
		[atMention, slashCommand]
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

	const agentFileChanges = useMemo(() => {
		if (composerMode !== 'agent') return [];
		const lastAssistant = [...displayMessages].reverse().find((m) => m.role === 'assistant');
		if (!lastAssistant) return [];
		const segs = segmentAssistantContentUnified(lastAssistant.content, { t });
		const all = collectFileChanges(segs);
		const afterDismiss =
			dismissedFiles.size > 0 ? all.filter((f) => !dismissedFiles.has(f.path)) : all;
		return mergeAgentFileChangesWithGit(afterDismiss, {
			gitStatusOk,
			gitChangedPaths,
			diffPreviews,
		});
	}, [displayMessages, composerMode, t, dismissedFiles, gitStatusOk, gitChangedPaths, diffPreviews]);

	/** 从 localStorage 恢复「已保留/已撤销全部」或逐文件忽略，绑定当前线程最后一条助手正文 */
	useLayoutEffect(() => {
		if (!currentId) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			setRevertedFiles(new Set());
			setRevertedChangeKeys(new Set());
			return;
		}
		if (messagesThreadId !== currentId) {
			/* 切线程后、loadMessages 完成前：勿用旧线程的 messages 去对本线程的 persist 做哈希比对 */
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			setRevertedFiles(new Set());
			setRevertedChangeKeys(new Set());
			return;
		}
		const last = [...messages].reverse().find((m) => m.role === 'assistant');
		const content = last?.content ?? '';
		if (!content.trim()) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			setRevertedFiles(new Set());
			setRevertedChangeKeys(new Set());
			return;
		}
		const hash = hashAgentAssistantContent(content);
		const stored = readPersistedAgentFileChanges(currentId);
		if (!stored) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			setRevertedFiles(new Set());
			setRevertedChangeKeys(new Set());
			return;
		}
		if (stored.contentHash !== hash) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			setRevertedFiles(new Set());
			setRevertedChangeKeys(new Set());
			clearPersistedAgentFileChanges(currentId);
			return;
		}
		setFileChangesDismissed(stored.fileChangesDismissed);
		setDismissedFiles(new Set(stored.dismissedPaths));
		setRevertedFiles(new Set(stored.revertedPaths));
		setRevertedChangeKeys(new Set(stored.revertedChangeKeys));
	}, [currentId, messages, messagesThreadId]);

	/** Plan：切回线程或 loadMessages 完成后，若最后一条仍是带 QUESTIONS 的助手消息则恢复弹窗 */
	useLayoutEffect(() => {
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
		const revertedPaths = new Set(agentFileChanges.map((file) => file.path));
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
	}, [shell, composerMode, currentId, refreshGit, agentFileChanges]);

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
		const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
		pinMessagesToBottomRef.current = dist < 120;
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

	/** 切换线程：恢复「粘底」，等 messages / 流式更新后再滚（避免旧列表闪滚） */
	useLayoutEffect(() => {
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

	/** 用户发出新消息：强制跟到底部 */
	useLayoutEffect(() => {
		const len = messages.length;
		const prev = prevMessagesLenForScrollRef.current;
		prevMessagesLenForScrollRef.current = len;
		if (len > prev && messages[len - 1]?.role === 'user') {
			pinMessagesToBottomRef.current = true;
			scrollMessagesToBottom('auto');
		}
	}, [messages, scrollMessagesToBottom]);

	/** 流式 / 思考计时 / 展示列表变化：仅在「粘底」时跟随（每帧合并一次，减轻与 RO 重复滚动） */
	useLayoutEffect(() => {
		if (!hasConversation || !pinMessagesToBottomRef.current) {
			return;
		}
		scheduleMessagesScrollToBottom();
	}, [hasConversation, displayMessages, streaming, thinkingTick, currentId, scheduleMessagesScrollToBottom]);

	useLayoutEffect(() => {
		if (!hasConversation) {
			setShowScrollToBottomButton(false);
			return;
		}
		const rafId = requestAnimationFrame(() => {
			syncMessagesScrollIndicators();
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, displayMessages, streaming, thinkingTick, currentId, syncMessagesScrollIndicators]);

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
		if (!awaitingReply || streaming.length > 0) {
			return;
		}
		const id = window.setInterval(() => setThinkingTick((x) => x + 1), 100);
		return () => window.clearInterval(id);
	}, [awaitingReply, streaming.length]);

	useEffect(() => {
		const applyFollowupHeight = (el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			el.style.height = '0';
			el.style.height = `${Math.min(140, Math.max(38, el.scrollHeight))}px`;
		};
		const applyInlineEditHeight = (el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			el.style.height = '0';
			el.style.height = `${Math.min(200, Math.max(72, el.scrollHeight))}px`;
		};
		if (!hasConversation) {
			const h = composerRichHeroRef.current;
			if (h) {
				h.style.height = '';
			}
		}
		applyFollowupHeight(composerRichBottomRef.current);
		applyInlineEditHeight(composerRichInlineRef.current);
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
			setRailWidths((prev) => clampSidebarLayout(prev.left, prev.right));
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
				localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(c));
			} catch {
				/* ignore */
			}
			syncDesktopSidebarLayout(shell ?? undefined, c);
		},
		[shell]
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
						localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(c));
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
		[railWidths.left, railWidths.right, shell]
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
						localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(c));
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
		[railWidths.left, railWidths.right, shell]
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
						localStorage.setItem(EDITOR_TERMINAL_HEIGHT_KEY, String(c));
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
		[editorTerminalHeightPx]
	);

	const resetRailWidths = useCallback(() => {
		persistRailWidths(defaultQuarterRailWidths());
	}, [persistRailWidths]);

	const commandPermissionMode = shellCommandPermissionMode(agentCustomization);

	const onChangeCommandPermissionMode = useCallback(
		async (mode: CommandPermissionMode) => {
			const patch: Partial<AgentCustomization> =
				mode === 'always'
					? { confirmShellCommands: false }
					: {
							confirmShellCommands: true,
							skipSafeShellCommandsConfirm: false,
						};
			setAgentCustomization((prev) => ({ ...prev, ...patch }));
			if (!shell) {
				return;
			}
			await shell.invoke('settings:set', { agent: patch });
		},
		[shell]
	);

	const composerGitBranchRowEl = useMemo(
		() => (
			<div className="ref-composer-git-branch-row">
				<AgentCommandPermissionDropdown
					value={commandPermissionMode}
					onChange={(mode) => void onChangeCommandPermissionMode(mode)}
					askLabel={t('agent.commandPermission.ask')}
					alwaysLabel={t('agent.commandPermission.always')}
					ariaLabel={t('agent.commandPermission.aria')}
					disabled={!shell}
				/>
				<button
					ref={composerGitBranchAnchorRef}
					type="button"
					className="ref-composer-git-branch-trigger"
					title={gitBranchTriggerTitle(t, gitStatusOk, gitUnavailableReason)}
					aria-label={`${t('app.tabGit')}: ${gitBranch}`}
					aria-expanded={gitBranchPickerOpen}
					aria-haspopup="dialog"
					disabled={!gitStatusOk}
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						setPlusMenuOpen(false);
						setModelPickerOpen(false);
						if (!gitStatusOk) {
							return;
						}
						setGitBranchPickerOpen((o) => !o);
					}}
				>
					<IconGitSCM className="ref-composer-git-branch-ico" aria-hidden />
					<span className="ref-composer-git-branch-name">{gitBranch}</span>
					<IconChevron className="ref-composer-git-branch-chev" aria-hidden />
				</button>
			</div>
		),
		[
			commandPermissionMode,
			gitBranch,
			gitBranchPickerOpen,
			gitStatusOk,
			gitUnavailableReason,
			onChangeCommandPermissionMode,
			shell,
			t,
		]
	);

	// 共享给 ChatComposer 的 stable props（不含 slot/segments/canSend/extraClass/showGitBranchRow）
	const sharedComposerProps = {
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
		composerGitBranchRowEl,
		setPlusMenuAnchorSlot,
		setModelPickerOpen,
		setPlusMenuOpen,
		setModelPickerAnchorSlot,
		onAbort,
		onSend: () => void onSend(),
		onNewThread: () => void onNewThread(),
		onExplorerOpenFile: (rel: string) => void onExplorerOpenFile(rel),
		persistComposerAttachments,
		syncComposerOverlays,
		setResendFromUserIndex,
		setInlineResendSegments,
		slashCommandKeyDown: slashCommand.handleSlashKeyDown,
		atMentionKeyDown: atMention.handleAtKeyDown,
	} as const;

	const renderChatMessageList = (): ReactNode[] => {
		const t0 = import.meta.env.DEV ? performance.now() : 0;
		const nodes = displayMessages.map((m, i) => {
			const convoKey = messagesThreadId ?? currentId ?? 'no-thread';
			const isLast = i === displayMessages.length - 1;
			const stAt = streamStartedAtRef.current;
			const ftAt = firstTokenAtRef.current;
			const showLiveThought = isLast && m.role === 'assistant' && awaitingReply;
			const agentOrPlanStreaming =
				(composerMode === 'agent' || composerMode === 'plan') && awaitingReply && isLast;
			const frozenSec =
				!awaitingReply && isLast && m.role === 'assistant' && currentId
					? thoughtSecondsByThread[currentId]
					: undefined;

			let thoughtBlock: ReactNode = null;
			let liveThoughtMeta:
				| {
						phase: 'thinking' | 'streaming' | 'done';
						elapsedSeconds: number;
						streamingThinking?: string;
						tokenUsage?: TurnTokenUsage | null;
				  }
				| null = null;
			/** 仅在非 live inline 路径下使用外层 thoughtBlock */
			let thoughtAfterBody = false;
			if (showLiveThought && stAt) {
				void thinkingTick;
				const assistantTurnHasOutput =
					streaming.trim().length > 0 ||
					streamingToolPreview != null ||
					(agentOrPlanStreaming && liveAssistantBlocks.blocks.length > 0);
				const phase = assistantTurnHasOutput ? 'streaming' : 'thinking';
				// Agent/Plan 的思考走 ChatMarkdown 内联 liveThoughtMeta；Ask/Debug 用外层 ComposerThoughtBlock。
				// 若此处在出字后把 thoughtAfterBody 设为 true，Ask 下整块「深度思考」会被挤到回复下方，体验差。
				thoughtAfterBody =
					assistantTurnHasOutput && composerMode !== 'ask' && composerMode !== 'debug';
				const elapsed =
					phase === 'thinking'
						? Math.max(0, (Date.now() - stAt) / 1000)
						: ftAt
							? Math.max(0, (ftAt - stAt) / 1000)
							: Math.max(0, (Date.now() - stAt) / 1000);
				if (agentOrPlanStreaming) {
					liveThoughtMeta = {
						phase,
						elapsedSeconds: elapsed,
						streamingThinking,
					};
				} else {
					thoughtBlock = (
						<ComposerThoughtBlock
							phase={phase}
							elapsedSeconds={elapsed}
							streamingThinking={streamingThinking}
						/>
					);
				}
			} else if (frozenSec != null) {
				thoughtAfterBody = true;
				thoughtBlock = (
					<ComposerThoughtBlock
						phase="done"
						elapsedSeconds={frozenSec}
						tokenUsage={isLast ? lastTurnUsage : undefined}
					/>
				);
			}

			const pendingEmptyAssistant =
				m.role === 'assistant' &&
				m.content.trim() === '' &&
				awaitingReply &&
				isLast &&
				streamingToolPreview == null &&
				!(agentOrPlanStreaming && (liveAssistantBlocks.blocks.length > 0 || liveThoughtMeta != null));
			const userMessageIndex = i < messages.length && m.role === 'user' ? i : -1;
			const isEditingThisUser = userMessageIndex >= 0 && resendFromUserIndex === userMessageIndex;

			if (m.role === 'user' && isEditingThisUser) {
				const inner = (
					<div ref={inlineResendRootRef} className="ref-msg-slot ref-msg-slot--composer">
						<ChatComposer
							{...sharedComposerProps}
							slot="inline"
							segments={inlineResendSegments}
							setSegments={setInlineResendSegments}
							canSend={canSendInlineResend}
							extraClass="ref-capsule--inline-edit"
							showGitBranchRow={false}
						/>
					</div>
				);
				return i === lastUserMessageIndex ? (
					<div key={`u-edit-${convoKey}-${i}`} className="ref-msg-sticky-user-wrap">
						{inner}
					</div>
				) : (
					<Fragment key={`u-edit-${convoKey}-${i}`}>{inner}</Fragment>
				);
			}

			if (m.role === 'user') {
				const userSegs = userMessageToSegments(m.content, workspaceFileList);
				const inner = (
					<div className="ref-msg-slot ref-msg-slot--user">
						<button
							type="button"
							className="ref-msg-user"
							disabled={awaitingReply}
							title={
								awaitingReply ? t('app.userMsgGenerating') : t('app.userMsgEditHint')
							}
							onClick={() => {
								if (awaitingReply) {
									return;
								}
								setPlanQuestion(null);
								setPlanQuestionRequestId(null);
								setResendFromUserIndex(userMessageIndex);
								setInlineResendSegments(userMessageToSegments(m.content, workspaceFileList));
							}}
						>
							<UserMessageRich
								segments={userSegs}
								onFileClick={(rel) => void onExplorerOpenFile(rel)}
							/>
						</button>
					</div>
				);
				return i === lastUserMessageIndex ? (
					<div key={`u-${convoKey}-${i}`} className="ref-msg-sticky-user-wrap">
						{inner}
					</div>
				) : (
					<Fragment key={`u-${convoKey}-${i}`}>{inner}</Fragment>
				);
			}

			return (
				<div key={`a-${convoKey}-${i}`} className="ref-msg-slot ref-msg-slot--assistant">
					{thoughtBlock && !thoughtAfterBody ? thoughtBlock : null}
					<div className="ref-msg-assistant-body">
						{pendingEmptyAssistant ? (
							<span className="ref-bubble-pending" aria-hidden>
								<span className="ref-bubble-pending-dot" />
								<span className="ref-bubble-pending-dot" />
								<span className="ref-bubble-pending-dot" />
							</span>
						) : (
							<ChatMarkdown
								content={m.content}
								agentUi={
									composerMode === 'plan' ||
									composerMode === 'agent' ||
									assistantMessageUsesAgentToolProtocol(m.content)
								}
								assistantBubbleVariant={
									m.role === 'assistant' && isChatAssistantErrorLine(m.content, t)
										? 'error'
										: 'default'
								}
								planUi={composerMode === 'plan'}
								workspaceRoot={workspace}
								onOpenAgentFile={(rel, line, end, options) =>
									void onAgentConversationOpenFile(rel, line, end, options)
								}
								onRunCommand={(cmd) => {
									shell?.invoke('terminal:execLine', cmd).catch(console.error);
								}}
								streamingToolPreview={
									agentOrPlanStreaming ? streamingToolPreview : null
								}
								showAgentWorking={agentOrPlanStreaming}
								liveAgentBlocksState={agentOrPlanStreaming ? liveAssistantBlocks : null}
								liveThoughtMeta={agentOrPlanStreaming ? liveThoughtMeta : null}
								revertedPaths={revertedFiles}
								revertedChangeKeys={revertedChangeKeys}
								allowAgentFileActions={
									composerMode === 'agent' && !awaitingReply && i === lastAssistantMessageIndex
								}
							/>
						)}
					</div>
					{thoughtBlock && thoughtAfterBody ? thoughtBlock : null}
				</div>
			);
		});
		if (import.meta.env.DEV) {
			const elapsed = performance.now() - t0;
			if (elapsed > 12) {
				// eslint-disable-next-line no-console
				console.log(
					`[perf] renderChatMessageList: ${elapsed.toFixed(1)}ms, messages=${displayMessages.length}, workspaceFiles=${workspaceFileList.length}, awaiting=${awaitingReply}`
				);
			}
		}
		return nodes;
	};

	const renderAgentConversationBelowContext = (
		layout: 'agent-center' | 'editor-rail' = 'agent-center'
	): ReactNode => {
		const isEditorRail = layout === 'editor-rail';
		const conversationRenderKey = messagesThreadId ?? currentId ?? 'no-thread';

		const messagesEl = hasConversation ? (
			<div className="ref-messages" ref={messagesViewportRef} onScroll={onMessagesScroll}>
				<div
					key={`messages-track-${conversationRenderKey}`}
					className="ref-messages-track"
					ref={messagesTrackRef}
				>
					{renderChatMessageList()}
				</div>
			</div>
		) : null;

		const editorRailHeroComposer =
			isEditorRail && !hasConversation ? (
				<ChatComposer
					{...sharedComposerProps}
					slot="hero"
					variant="editor-hero"
					segments={composerSegments}
					setSegments={setComposerSegments}
					canSend={canSendComposer}
					showGitBranchRow={false}
				/>
			) : null;

		const editorContextStrip = isEditorRail ? (
			<div className="ref-editor-rail-context-strip">
				<IconDoc className="ref-context-icon" />
				<span className="ref-editor-rail-context-local">{t('app.editorChatContextLocal')}</span>
				<IconChevron className="ref-editor-rail-context-chev" aria-hidden />
				<span className="ref-editor-rail-context-path" title={workspace ?? undefined}>
					{workspace ? workspaceBasename : t('app.noWorkspace')}
				</span>
			</div>
		) : null;

		const sharedOverlays = (
			<>
				{hasConversation && pendingAgentPatches.length > 0 ? (
					<AgentReviewPanel
						patches={pendingAgentPatches}
						workspaceRoot={workspace}
						busy={agentReviewBusy}
						onOpenFile={(rel, line, end, options) =>
							void onAgentConversationOpenFile(rel, line, end, {
								...options,
								allowReviewActions: true,
							})
						}
						onApplyOne={(id) => void onApplyAgentPatchOne(id)}
						onApplyAll={() => void onApplyAgentPatchesAll()}
						onDiscard={onDiscardAgentReview}
					/>
				) : null}

				{hasConversation && planQuestion && composerMode === 'plan' ? (
					<PlanQuestionDialog
						question={planQuestion}
						onSubmit={onPlanQuestionSubmit}
						onSkip={onPlanQuestionSkip}
					/>
				) : null}

				{wizardPending?.kind === 'create-skill' ? (
					<SkillScopeDialog
						workspaceOpen={!!workspace}
						onCancel={() => setWizardPending(null)}
						onConfirm={(scope) => {
							const p = wizardPending;
							setWizardPending(null);
							if (p?.kind === 'create-skill') {
								void executeSkillCreatorSend(scope, p);
							}
						}}
					/>
				) : null}
				{wizardPending?.kind === 'create-rule' ? (
					<RuleWizardDialog
						onCancel={() => setWizardPending(null)}
						onConfirm={(ruleScope, globPattern) => {
							const p = wizardPending;
							setWizardPending(null);
							if (p?.kind === 'create-rule') {
								void executeRuleWizardSend(ruleScope, globPattern, p);
							}
						}}
					/>
				) : null}
				{wizardPending?.kind === 'create-subagent' ? (
					<SubagentScopeDialog
						workspaceOpen={!!workspace}
						onCancel={() => setWizardPending(null)}
						onConfirm={(scope) => {
							const p = wizardPending;
							setWizardPending(null);
							if (p?.kind === 'create-subagent') {
								void executeSubagentWizardSend(scope, p);
							}
						}}
					/>
				) : null}

				<AgentMistakeLimitDialog
					open={mistakeLimitRequest !== null}
					payload={mistakeLimitRequest}
					onContinue={() => void respondMistakeLimit('continue')}
					onStop={() => void respondMistakeLimit('stop')}
					onSendHint={(hint) => void respondMistakeLimit('hint', hint)}
					title={t('agent.mistakeLimit.title')}
					body={
						mistakeLimitRequest
							? t('agent.mistakeLimit.body', {
									count: mistakeLimitRequest.consecutiveFailures,
									threshold: mistakeLimitRequest.threshold,
								})
							: ''
					}
					continueLabel={t('agent.mistakeLimit.continue')}
					stopLabel={t('agent.mistakeLimit.stop')}
					hintFieldLabel={t('agent.mistakeLimit.hintField')}
					sendHintLabel={t('agent.mistakeLimit.sendHint')}
					hintPlaceholder={t('agent.mistakeLimit.hintPlaceholder')}
				/>

				{isEditorRail &&
				hasConversation &&
				agentPlanEffectivePlan &&
				composerMode === 'plan' &&
				!editorPlanReviewDismissed ? (
					<PlanReviewPanel
						plan={agentPlanEffectivePlan}
						planFileDisplayPath={planFileRelPath ?? planFilePath}
						initialBuildModelId={defaultModel}
						modelItems={modelPickerItems}
						planBuilt={planReviewIsBuilt}
						buildDisabled={awaitingReply}
						onBuild={onPlanBuild}
						onClose={onPlanReviewClose}
						onTodoToggle={onPlanTodoToggle}
					/>
				) : null}
			</>
		);

		const commandStack = (
			<div className="ref-command-stack">
				{toolApprovalRequest ? (
					<ToolApprovalInlineCard
						payload={toolApprovalRequest}
						onAllow={() => void respondToolApproval(true)}
						onDeny={() => void respondToolApproval(false)}
						title={
							toolApprovalRequest.toolName === 'execute_command'
								? t('agent.toolApproval.titleShell')
								: t('agent.toolApproval.titleWrite')
						}
						allowLabel={t('agent.toolApproval.allow')}
						denyLabel={t('agent.toolApproval.deny')}
					/>
				) : null}
				{hasConversation && composerMode === 'agent' && agentFileChanges.length > 0 && !awaitingReply && !fileChangesDismissed ? (
					<AgentFileChangesPanel
						files={agentFileChanges}
						onOpenFile={(rel, line, end, options) =>
							void onAgentConversationOpenFile(rel, line, end, {
								...options,
								allowReviewActions: true,
							})
						}
						onKeepAll={onKeepAllEdits}
						onRevertAll={() => void onRevertAllEdits()}
						onKeepFile={(rel) => void onKeepFileEdit(rel)}
						onRevertFile={(rel) => void onRevertFileEdit(rel)}
					/>
				) : null}
				{hasConversation ? (
					<div className={`ref-scroll-jump-anchor ${showScrollToBottomButton ? 'is-visible' : ''}`} aria-hidden={!showScrollToBottomButton}>
						<button
							type="button"
							className="ref-scroll-jump-btn"
							tabIndex={showScrollToBottomButton ? 0 : -1}
							title={t('app.jumpToLatest')}
							aria-label={t('app.jumpToLatest')}
							onClick={() => scrollMessagesToBottom('smooth')}
						>
							<IconArrowDown className="ref-scroll-jump-btn-icon" />
						</button>
					</div>
				) : null}
				{!isEditorRail ? agentPlanSummaryCard : null}
				{hasConversation || !isEditorRail ? (
					<ChatComposer
						{...sharedComposerProps}
						slot="bottom"
						segments={composerSegments}
						setSegments={setComposerSegments}
						canSend={canSendComposer}
						showGitBranchRow={!isEditorRail}
					/>
				) : null}
			</div>
		);

		if (isEditorRail) {
			return (
				<>
					<div className="ref-editor-chat-body">
						{!hasConversation ? (
							<>
								{editorRailHeroComposer}
								{editorContextStrip}
								<div className="ref-editor-rail-message-spring" aria-hidden />
							</>
						) : (
							<>
								{editorContextStrip}
								{messagesEl}
							</>
						)}
					</div>
					{sharedOverlays}
					{commandStack}
				</>
			);
		}

		return (
			<>
				{messagesEl}
				{!hasConversation ? <div className="ref-hero-spacer" /> : null}
				{sharedOverlays}
				{commandStack}
			</>
		);
	};

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

	const renderThreadItem = (th: ThreadInfo) => {
		const isActive = th.id === currentId;
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
						onClick={() => void onSelectThread(th.id)}
						onDoubleClick={(e) => {
							e.preventDefault();
							beginThreadTitleEdit(th);
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
									<span className="ref-thread-stat ref-thread-stat--files" title={t('agent.files.count', { count: th.fileStateCount })}>
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
											<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
										</svg>
										{th.fileStateCount}
									</span>
								) : null}
								{th.tokenUsage ? (
									<span className="ref-thread-stat ref-thread-stat--tokens" title={t('usage.totalTokens', { input: th.tokenUsage.totalInput.toLocaleString(), output: th.tokenUsage.totalOutput.toLocaleString() })}>
										{t('usage.tokensShort', { input: th.tokenUsage.totalInput > 999 ? `${Math.round(th.tokenUsage.totalInput / 1000)}k` : String(th.tokenUsage.totalInput), output: th.tokenUsage.totalOutput > 999 ? `${Math.round(th.tokenUsage.totalOutput / 1000)}k` : String(th.tokenUsage.totalOutput) })}
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
							beginThreadTitleEdit(th);
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
						onClick={(e) => void onDeleteThread(e, th.id)}
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
	};

	/** 未打开工作区时：Agent / Editor 均显示同一套欢迎页（打开项目、最近项目等） */
	const isEditorHomeMode = !workspace;
	const agentFilePreviewTitle =
		agentFilePreview?.relPath?.split('/').pop() || agentFilePreview?.relPath || t('app.filePreview');
	const gitCardOpenAria = layoutMode === 'agent' ? t('app.gitPreviewAria') : t('app.gitOpenInEditorAria');
	const gitCardOpenTitle = layoutMode === 'agent' ? t('app.gitPreviewTitle') : t('app.gitOpenTitle');
	const agentRightSidebarTitle =
		agentRightSidebarView === 'git'
			? changeCount > 0
				? t('app.gitUncommitted', { count: String(changeCount) })
				: t('app.gitNoChanges')
			: agentRightSidebarView === 'plan'
				? agentPlanPreviewTitle || t('app.planSidebarWaiting')
				: agentFilePreviewTitle;
	const agentPlanSummaryCard =
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
							content={agentPlanGoalMarkdown || agentPlanGoalSummary || agentPlanEffectivePlan.overview || t('plan.review.summaryEmpty')}
						/>
					</div>
				</div>
			</section>
		) : null;
	const agentPlanSidebarPanel = (
		<div className="ref-agent-plan-doc-shell">
			{agentPlanPreviewMarkdown ? (
				<section className="ref-agent-plan-doc" aria-label={t('app.tabPlan')}>
					<div className="ref-agent-plan-doc-toolbar">
						<div className="ref-agent-plan-doc-title-stack">
							<span className="ref-agent-plan-doc-label">{t('app.tabPlan')}</span>
							<span className="ref-agent-plan-doc-title">{agentPlanPreviewTitle || t('app.planSidebarWaiting')}</span>
							{planFileRelPath || planFilePath ? (
								<span className="ref-agent-plan-doc-path">{planFileRelPath ?? planFilePath}</span>
							) : null}
						</div>
						<div className="ref-agent-plan-doc-toolbar-actions">
							<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
								<button
									type="button"
									aria-label={t('app.tabPlan')}
									title={t('app.tabPlan')}
									className="ref-right-icon-tab is-active"
									onClick={() => openAgentRightSidebarView('plan')}
								>
									<IconDoc />
								</button>
								<button
									type="button"
									aria-label={t('app.tabGit')}
									title={t('app.tabGit')}
									className="ref-right-icon-tab"
									onClick={() => openAgentRightSidebarView('git')}
								>
									<IconGitSCM />
								</button>
								<button
									type="button"
									aria-label={t('common.close')}
									title={t('common.close')}
									className="ref-right-icon-tab"
									onClick={() => setAgentRightSidebarOpen(false)}
								>
									<IconCloseSmall />
								</button>
							</div>
						</div>
					</div>
					<div className="ref-agent-plan-doc-scroll">
						<div className="ref-agent-plan-doc-surface">
							<div className="ref-agent-plan-doc-surface-tools">
								<VoidSelect
									variant="compact"
									className="ref-agent-plan-model-inline"
									ariaLabel={t('plan.review.model')}
									value={agentPlanBuildModelId}
									disabled={modelPickerItems.length === 0}
									onChange={setAgentPlanBuildModelId}
									options={[
										{ value: '', label: t('plan.review.pickModel'), disabled: true },
										...modelPickerItems.map((m) => ({
											value: m.id,
											label: m.label,
										})),
									]}
								/>
								<button
									type="button"
									className="ref-agent-plan-build-btn"
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
								{planReviewIsBuilt ? (
									<span className="ref-agent-plan-built-chip" role="status">{t('app.planEditorBuilt')}</span>
								) : null}
							</div>
							<div className="ref-agent-plan-doc-markdown ref-agent-plan-preview-markdown">
								<ChatMarkdown content={agentPlanDocumentMarkdown} />
							</div>
							<div className="ref-agent-plan-doc-todos">
								<div className="ref-agent-plan-doc-todos-head">
									<div className="ref-agent-plan-doc-todos-title-wrap">
										<span className="ref-agent-plan-doc-todos-title">{t('plan.review.todo', { done: String(agentPlanTodoDoneCount), total: String(agentPlanTodos.length) })}</span>
										<span className="ref-agent-plan-doc-todos-note">{t('plan.review.label')}</span>
									</div>
									<button
										type="button"
										className="ref-agent-plan-doc-add-todo-btn ref-agent-plan-add-todo-btn"
										disabled={!agentPlanEffectivePlan}
										onClick={onPlanAddTodo}
									>
										{t('plan.review.addTodo')}
									</button>
								</div>
								{planTodoDraftOpen ? (
									<div className="ref-agent-plan-doc-todo-draft">
										<input
											ref={planTodoDraftInputRef}
											type="text"
											className="ref-agent-plan-doc-todo-draft-input"
											value={planTodoDraftText}
											placeholder={t('plan.review.addTodoPrompt')}
											onChange={(e) => setPlanTodoDraftText(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													onPlanAddTodoSubmit();
												} else if (e.key === 'Escape') {
													e.preventDefault();
													onPlanAddTodoCancel();
												}
											}}
										/>
										<div className="ref-agent-plan-doc-todo-draft-actions">
											<button
												type="button"
												className="ref-plan-brief-review-btn"
												onClick={onPlanAddTodoCancel}
											>
												{t('common.cancel')}
											</button>
											<button
												type="button"
												className="ref-agent-plan-build-btn ref-agent-plan-build-btn--draft"
												disabled={!planTodoDraftText.trim()}
												onClick={onPlanAddTodoSubmit}
											>
												{t('common.save')}
											</button>
										</div>
									</div>
								) : null}
								<div className="ref-agent-plan-doc-todos-list">
									{agentPlanTodos.length > 0 ? (
										agentPlanTodos.map((todo) => (
											<button
												key={todo.id}
												type="button"
												className={`ref-plan-todo ${todo.status === 'completed' ? 'is-done' : ''}`}
												onClick={() => onPlanTodoToggle(todo.id)}
											>
												<input type="checkbox" checked={todo.status === 'completed'} readOnly tabIndex={-1} />
												<span className="ref-plan-todo-text">{todo.content}</span>
											</button>
										))
									) : (
										<div className="ref-agent-plan-doc-empty-todos">{t('plan.review.todoEmpty')}</div>
									)}
								</div>
							</div>
						</div>
					</div>
				</section>
			) : (
				<section className="ref-agent-plan-status-card ref-agent-plan-status-card--doc" aria-live="polite">
					<div className="ref-agent-plan-doc-toolbar">
						<div className="ref-agent-plan-doc-title-stack">
							<span className="ref-agent-plan-doc-label">{t('app.tabPlan')}</span>
							<span className="ref-agent-plan-status-title">{t('app.planSidebarWaiting')}</span>
						</div>
						<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
							<button
								type="button"
								aria-label={t('app.tabGit')}
								title={t('app.tabGit')}
								className="ref-right-icon-tab"
								onClick={() => openAgentRightSidebarView('git')}
							>
								<IconGitSCM />
							</button>
							<button
								type="button"
								aria-label={t('common.close')}
								title={t('common.close')}
								className="ref-right-icon-tab"
								onClick={() => setAgentRightSidebarOpen(false)}
							>
								<IconCloseSmall />
							</button>
						</div>
					</div>
					<div className="ref-agent-plan-status-main">
						<div className="ref-agent-plan-status-title">{t('app.planSidebarWaiting')}</div>
						<p className="ref-agent-plan-status-body">{t('app.planSidebarDescription')}</p>
					</div>
				</section>
			)}
		</div>
	);
	const agentFileSidebarPanel = agentFilePreview ? (
		<div className="ref-agent-review-shell">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.filePreview')}</span>
					<span className="ref-agent-review-title">{agentFilePreviewTitle}</span>
				</div>
				<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
					{hasAgentPlanSidebarContent ? (
						<button
							type="button"
							aria-label={t('app.tabPlan')}
							title={t('app.tabPlan')}
							className="ref-right-icon-tab"
							onClick={() => openAgentRightSidebarView('plan')}
						>
							<IconDoc />
						</button>
					) : null}
					<button
						type="button"
						aria-label={t('app.tabGit')}
						title={t('app.tabGit')}
						className="ref-right-icon-tab"
						onClick={() => openAgentRightSidebarView('git')}
					>
						<IconGitSCM />
					</button>
					<button
						type="button"
						aria-label={t('common.close')}
						title={t('common.close')}
						className="ref-right-icon-tab"
						onClick={() => setAgentRightSidebarOpen(false)}
					>
						<IconCloseSmall />
					</button>
				</div>
			</div>
			<div className="ref-right-panel-stage">
				<AgentFilePreviewPanel
					filePath={agentFilePreview.relPath}
					content={agentFilePreview.content}
					diff={agentFilePreview.diff}
					loading={agentFilePreview.loading}
					readError={agentFilePreview.readError}
					isBinary={agentFilePreview.isBinary}
					revealLine={agentFilePreview.revealLine}
					revealEndLine={agentFilePreview.revealEndLine}
					onOpenInEditor={() =>
						void openFileInTab(
							agentFilePreview.relPath,
							agentFilePreview.revealLine,
							agentFilePreview.revealEndLine,
							{
								diff: agentFilePreview.diff,
								allowReviewActions: agentFilePreview.reviewMode === 'snapshot',
							}
						)
					}
					onAcceptHunk={
						agentFilePreview.reviewMode === 'snapshot'
							? (patch) => void onAcceptAgentFilePreviewHunk(patch)
							: undefined
					}
					onRevertHunk={
						agentFilePreview.reviewMode === 'snapshot'
							? (patch) => void onRevertAgentFilePreviewHunk(patch)
							: undefined
					}
					busyHunkPatch={agentFilePreviewBusyPatch}
				/>
			</div>
		</div>
	) : (
		<div className="ref-agent-review-shell">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.filePreview')}</span>
					<span className="ref-agent-review-title">{t('app.filePreview')}</span>
				</div>
				<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
					{hasAgentPlanSidebarContent ? (
						<button
							type="button"
							aria-label={t('app.tabPlan')}
							title={t('app.tabPlan')}
							className="ref-right-icon-tab"
							onClick={() => openAgentRightSidebarView('plan')}
						>
							<IconDoc />
						</button>
					) : null}
					<button
						type="button"
						aria-label={t('app.tabGit')}
						title={t('app.tabGit')}
						className="ref-right-icon-tab"
						onClick={() => openAgentRightSidebarView('git')}
					>
						<IconGitSCM />
					</button>
					<button
						type="button"
						aria-label={t('common.close')}
						title={t('common.close')}
						className="ref-right-icon-tab"
						onClick={() => setAgentRightSidebarOpen(false)}
					>
						<IconCloseSmall />
					</button>
				</div>
			</div>
			<div className="ref-right-panel-stage">
				<div className="ref-agent-file-preview-state ref-agent-file-preview-state--empty">
					{t('app.selectFileToView')}
				</div>
			</div>
		</div>
	);

	return (
		<div className={`ref-shell ${layoutMode === 'agent' ? 'ref-shell--agent-layout' : ''}`}>
			<header className={`ref-menubar ${layoutMode === 'agent' ? 'ref-menubar--agent' : ''}`}>
				<div className="ref-menubar-left">
					<div className="ref-brand-block-simple">
						<BrandLogo className="ref-brand-logo" size={22} />
					</div>
					<nav className="ref-menu-nav" aria-label={t('app.menu')}>
						<div className="ref-menu-dropdown-wrap" ref={fileMenuRef}>
							<button
								type="button"
								className={`ref-menu-item${fileMenuOpen ? ' is-active' : ''}`}
								aria-expanded={fileMenuOpen}
								aria-haspopup="menu"
								onClick={() => {
									setEditMenuOpen(false);
									setTerminalMenuOpen(false);
									setViewMenuOpen(false);
									setWindowMenuOpen(false);
									setFileMenuOpen((o) => !o);
								}}
							>
								{t('app.menuFile')}
							</button>
							{fileMenuOpen ? (
								<MenubarFileMenu
									onClose={() => setFileMenuOpen(false)}
									isDesktopShell={!!shell}
									hasWorkspace={!!workspace}
									folderRecents={folderRecents}
									canSave={!!shell && !!workspace && !!filePath.trim()}
									canEditorClose={!!activeTabId}
									canCloseFolder={!!shell && !!workspace}
									shortcutSave={saveShortcutLabel()}
									onNewFile={() => void fileMenuNewFile()}
									onNewWindow={() => void fileMenuNewWindow()}
									onOpenFile={() => void fileMenuOpenFile()}
									onOpenFolder={() => void fileMenuOpenFolder()}
									onOpenRecentPath={(p) => void openWorkspaceByPath(p)}
									onSave={() => void onSaveFile()}
									onSaveAs={() => void fileMenuSaveAs()}
									onRevert={() => void fileMenuRevertFile()}
									onCloseEditor={() => fileMenuCloseEditor()}
									onCloseFolder={() => void closeWorkspaceFolder()}
									onQuit={() => void fileMenuQuit()}
								/>
							) : null}
						</div>
						<div className="ref-menu-dropdown-wrap" ref={editMenuRef}>
							<button
								type="button"
								className={`ref-menu-item${editMenuOpen ? ' is-active' : ''}`}
								aria-expanded={editMenuOpen}
								aria-haspopup="menu"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									setFileMenuOpen(false);
									setTerminalMenuOpen(false);
									setViewMenuOpen(false);
									setWindowMenuOpen(false);
									setEditMenuOpen((open) => !open);
								}}
							>
								{t('app.menuEdit')}
							</button>
							{editMenuOpen ? (
								<div className="ref-menu-dropdown" role="menu" aria-label={t('app.menuEdit')}>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canEditUndoRedo}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											void executeEditAction('undo');
											setEditMenuOpen(false);
										}}
									>
										<span>{t('app.edit.undo')}</span>
										<kbd className="ref-menu-kbd">Ctrl+Z</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canEditUndoRedo}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											void executeEditAction('redo');
											setEditMenuOpen(false);
										}}
									>
										<span>{t('app.edit.redo')}</span>
										<kbd className="ref-menu-kbd">Ctrl+Shift+Z</kbd>
									</button>
									<div className="ref-menu-dropdown-sep" role="separator" />
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canEditCut}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											void executeEditAction('cut');
											setEditMenuOpen(false);
										}}
									>
										<span>{t('app.edit.cut')}</span>
										<kbd className="ref-menu-kbd">Ctrl+X</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canEditCopy}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											void executeEditAction('copy');
											setEditMenuOpen(false);
										}}
									>
										<span>{t('app.edit.copy')}</span>
										<kbd className="ref-menu-kbd">Ctrl+C</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canEditPaste}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											void executeEditAction('paste');
											setEditMenuOpen(false);
										}}
									>
										<span>{t('app.edit.paste')}</span>
										<kbd className="ref-menu-kbd">Ctrl+V</kbd>
									</button>
									<div className="ref-menu-dropdown-sep" role="separator" />
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canEditSelectAll}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											void executeEditAction('selectAll');
											setEditMenuOpen(false);
										}}
									>
										<span>{t('app.edit.selectAll')}</span>
										<kbd className="ref-menu-kbd">Ctrl+A</kbd>
									</button>
								</div>
							) : null}
						</div>
						<div className="ref-menu-dropdown-wrap" ref={viewMenuRef}>
							<button
								type="button"
								className={`ref-menu-item${viewMenuOpen ? ' is-active' : ''}`}
								aria-expanded={viewMenuOpen}
								aria-haspopup="menu"
								onClick={() => {
									setFileMenuOpen(false);
									setEditMenuOpen(false);
									setTerminalMenuOpen(false);
									setWindowMenuOpen(false);
									setViewMenuOpen((open) => !open);
								}}
							>
								{t('app.menuView')}
							</button>
							{viewMenuOpen ? (
								<div className="ref-menu-dropdown" role="menu" aria-label={t('app.menuView')}>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										onClick={() => {
											toggleSidebarVisibility();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.toggleSidebar')}</span>
										<kbd className="ref-menu-kbd">Ctrl+B</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canToggleTerminal}
										onClick={() => {
											toggleTerminalVisibility();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.toggleTerminal')}</span>
										<kbd className="ref-menu-kbd">Ctrl+J</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canToggleDiffPanel}
										onClick={() => {
											toggleDiffPanelVisibility();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.toggleDiffPanel')}</span>
										<kbd className="ref-menu-kbd">Alt+Ctrl+B</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										onClick={() => {
											openQuickOpen('');
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.find')}</span>
										<kbd className="ref-menu-kbd">Ctrl+F</kbd>
									</button>
									<div className="ref-menu-dropdown-sep" role="separator" />
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canGoPrevThread}
										onClick={() => {
											void goToPreviousThread();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.previousThread')}</span>
										<kbd className="ref-menu-kbd">Ctrl+Shift+[</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canGoNextThread}
										onClick={() => {
											void goToNextThread();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.nextThread')}</span>
										<kbd className="ref-menu-kbd">Ctrl+Shift+]</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canGoBackThread}
										onClick={() => {
											void goThreadBack();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.back')}</span>
										<kbd className="ref-menu-kbd">Ctrl+[</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										disabled={!canGoForwardThread}
										onClick={() => {
											void goThreadForward();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.forward')}</span>
										<kbd className="ref-menu-kbd">Ctrl+]</kbd>
									</button>
									<div className="ref-menu-dropdown-sep" role="separator" />
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										onClick={() => {
											zoomInUi();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.zoomIn')}</span>
										<kbd className="ref-menu-kbd">Ctrl++</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										onClick={() => {
											zoomOutUi();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.zoomOut')}</span>
										<kbd className="ref-menu-kbd">Ctrl+-</kbd>
									</button>
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										onClick={() => {
											resetUiZoom();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.actualSize')}</span>
										<kbd className="ref-menu-kbd">Ctrl+0</kbd>
									</button>
									<div className="ref-menu-dropdown-sep" role="separator" />
									<button
										type="button"
										role="menuitem"
										className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
										onClick={() => {
											void toggleFullscreen();
											setViewMenuOpen(false);
										}}
									>
										<span>{t('app.view.toggleFullscreen')}</span>
									</button>
								</div>
							) : null}
						</div>
						<div className="ref-menu-dropdown-wrap" ref={windowMenuRef}>
							<button
								type="button"
								className={`ref-menu-item${windowMenuOpen ? ' is-active' : ''}`}
								aria-expanded={windowMenuOpen}
								aria-haspopup="menu"
								onClick={() => {
									setFileMenuOpen(false);
									setEditMenuOpen(false);
									setTerminalMenuOpen(false);
									setViewMenuOpen(false);
									setWindowMenuOpen((o) => !o);
								}}
							>
								{t('app.menuWindow')}
							</button>
							{windowMenuOpen ? (
								<MenubarWindowMenu
									onClose={() => setWindowMenuOpen(false)}
									isDesktopShell={!!shell}
									windowMaximized={windowMaximized}
									onNewWindow={() => void fileMenuNewWindow()}
									onMinimize={() => void windowMenuMinimize()}
									onToggleMaximize={() => void windowMenuToggleMaximize()}
									onCloseWindow={() => void windowMenuCloseWindow()}
								/>
							) : null}
						</div>
						<button type="button" className="ref-menu-item">
							{t('app.menuHelp')}
						</button>
						{layoutMode === 'editor' && workspace ? (
							<div className="ref-menu-dropdown-wrap" ref={terminalMenuRef}>
								<button
									type="button"
									className={`ref-menu-item${terminalMenuOpen ? ' is-active' : ''}`}
									aria-expanded={terminalMenuOpen}
									aria-haspopup="menu"
									onClick={() => {
										setFileMenuOpen(false);
										setEditMenuOpen(false);
										setViewMenuOpen(false);
										setWindowMenuOpen(false);
										setTerminalMenuOpen((o) => !o);
									}}
								>
									{t('app.menuTerminal')}
									<IconChevron className="ref-menu-chevron" />
								</button>
								{terminalMenuOpen ? (
									<div className="ref-menu-dropdown" role="menu">
										<button
											type="button"
											role="menuitem"
											className="ref-menu-dropdown-item"
											onClick={() => spawnEditorTerminal()}
										>
											{t('app.menuNewTerminal')}
										</button>
									</div>
								) : null}
							</div>
						) : null}
					</nav>
				</div>
				<div className={`ref-menubar-center ${layoutMode === 'agent' ? 'ref-menubar-center--hidden' : ''}`}>
					{layoutMode !== 'agent' ? (
						<button
							type="button"
							className="ref-global-search-btn"
							aria-label={t('quickOpen.menubarAria')}
							title={t('quickOpen.placeholder')}
							onClick={() => openQuickOpen('')}
						>
							<IconSearch className="ref-global-search-icon" />
							<span className="ref-global-search-text">{t('quickOpen.menubarSummary')}</span>
							<kbd className="ref-global-search-kbd">{quickOpenPrimaryShortcutLabel()}</kbd>
						</button>
					) : null}
				</div>
				<div className="ref-menubar-right">
					<button
						type="button"
						className="ref-icon-tile ref-settings-btn"
						onClick={() => openSettingsPage('general')}
						title={t('app.settings')}
						aria-label={t('app.settingsAria')}
					>
						<IconSettings />
					</button>
				</div>
			</header>

			{isEditorHomeMode ? (
				<div
					className="ref-body ref-body--editor-home"
					style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
				>
					<main className="ref-editor-welcome" aria-label={t('app.editorWelcomeAria')}>
						<div className="ref-editor-welcome-inner">
							<section className="ref-editor-launchpad">
								<div className="ref-editor-welcome-brand">
									<BrandLogo className="ref-editor-welcome-logo" size={44} />
									<div className="ref-editor-welcome-brand-text">
										<span className="ref-editor-welcome-wordmark">Async</span>
										<span className="ref-editor-welcome-tagline">{t('app.editorWelcomeTagline')}</span>
									</div>
								</div>
								<div
									className="ref-editor-welcome-actions"
									role="group"
									aria-label={t('app.editorWelcomeActionsAria')}
								>
									<button
										type="button"
										className="ref-welcome-action-card ref-welcome-action-card--primary"
										onClick={() => setWorkspacePickerOpen(true)}
									>
										<span className="ref-welcome-action-icon" aria-hidden>
											<IconExplorer />
										</span>
										<span className="ref-welcome-action-copy">
											<span className="ref-welcome-action-label">{t('app.welcomeOpenProject')}</span>
											<span className="ref-welcome-action-subtitle">{t('app.welcomeOpenProjectHint')}</span>
										</span>
									</button>
									<button
										type="button"
										className="ref-welcome-action-card ref-welcome-action-card--soon"
										disabled
										title={t('app.comingSoon')}
									>
										<span className="ref-welcome-action-icon" aria-hidden>
											<IconCloudOutline />
										</span>
										<span className="ref-welcome-action-copy">
											<span className="ref-welcome-action-label">{t('app.welcomeCloneRepo')}</span>
											<span className="ref-welcome-action-subtitle">{t('app.welcomeCloneRepoHint')}</span>
										</span>
									</button>
									<button
										type="button"
										className="ref-welcome-action-card ref-welcome-action-card--soon"
										disabled
										title={t('app.comingSoon')}
									>
										<span className="ref-welcome-action-icon" aria-hidden>
											<IconServerOutline />
										</span>
										<span className="ref-welcome-action-copy">
											<span className="ref-welcome-action-label">{t('app.welcomeConnectSsh')}</span>
											<span className="ref-welcome-action-subtitle">{t('app.welcomeConnectSshHint')}</span>
										</span>
									</button>
								</div>
							</section>
							<section
								className="ref-editor-welcome-recents ref-editor-welcome-panel"
								aria-labelledby="ref-welcome-recents-title"
							>
								<div className="ref-editor-welcome-recents-head">
									<h2 id="ref-welcome-recents-title" className="ref-editor-welcome-recents-title">
										{t('app.recentProjects')}
									</h2>
									<button type="button" className="ref-welcome-view-all" onClick={() => setWorkspacePickerOpen(true)}>
										{t('app.viewAllRecents', { count: String(homeRecents.length) })}
									</button>
								</div>
								{homeRecents.length === 0 ? (
									<p className="ref-editor-welcome-recents-empty muted">{t('app.noRecentsYet')}</p>
								) : (
									<div className="ref-editor-welcome-recents-list" role="list">
										{homeRecents.slice(0, 6).map((p) => (
											<button
												key={p}
												type="button"
												className="ref-welcome-recent-card"
												role="listitem"
												title={p}
												onClick={() => void openWorkspaceByPath(p)}
											>
												<span className="ref-welcome-recent-card-icon" aria-hidden>
													<IconExplorer />
												</span>
												<span className="ref-welcome-recent-card-copy">
													<span className="ref-welcome-recent-card-name">{workspacePathDisplayName(p)}</span>
													<span className="ref-welcome-recent-card-path muted">
														{workspacePathParent(p) || '—'}
													</span>
												</span>
											</button>
										))}
									</div>
								)}
							</section>
						</div>
					</main>
				</div>
			) : (
				<div
					className={`ref-body ${
						layoutMode === 'editor'
							? 'ref-body--editor ref-body--editor-shell'
							: 'ref-body--agent-shell'
					}`}
					style={{
						gridTemplateColumns:
							layoutMode === 'agent' && !agentRightSidebarOpen
								? `${leftSidebarOpen ? railWidths.left : 0}px ${leftSidebarOpen ? RESIZE_HANDLE_PX : 0}px minmax(0, 1fr) 0px 0px`
								: `${leftSidebarOpen ? railWidths.left : 0}px ${leftSidebarOpen ? RESIZE_HANDLE_PX : 0}px minmax(0, 1fr) ${RESIZE_HANDLE_PX}px ${railWidths.right}px`,
					}}
				>
				<aside
					className={`ref-left ${leftSidebarOpen ? '' : 'is-collapsed'} ${
						layoutMode === 'editor' ? 'ref-left--editor-embedded' : 'ref-left--agent-layout'
					}`}
					aria-label={t('app.projectAndAgent')}
				>
					{layoutMode === 'agent' ? (
					<div className="ref-left-agent-nest">
						<div className="ref-left-scroll">
							<div className="ref-project-block ref-project-block--agent">
								<nav className="ref-agent-nav-list" aria-label={t('app.projectAndAgent')}>
									<button type="button" className="ref-agent-nav-item" onClick={() => void onNewThread()}>
										<IconPlus className="ref-agent-nav-item-icon" />
										<span>{t('app.newAgent')}</span>
									</button>
									<button
										type="button"
										className="ref-agent-nav-item"
										onClick={() => openSettingsPage('plugins')}
									>
										<IconPlugin className="ref-agent-nav-item-icon" />
										<span>{t('settings.nav.plugins')}</span>
									</button>
								</nav>

								<div className="ref-agent-sidebar-section">
									<div className="ref-agent-sidebar-section-head">
										<span className="ref-agent-sidebar-section-title">{t('app.sidebarThreads')}</span>
										<div className="ref-agent-sidebar-section-actions">
											<button
												type="button"
												className="ref-agent-sidebar-icon-btn"
												title={t('app.openWorkspace')}
												aria-label={t('app.openWorkspace')}
												onClick={() => setWorkspacePickerOpen(true)}
											>
												<IconExplorer />
											</button>
											<button
												type="button"
												className="ref-agent-sidebar-icon-btn"
												title={t('common.search')}
												aria-label={t('common.search')}
												onClick={() => openQuickOpen()}
											>
												<IconSearch />
											</button>
										</div>
									</div>

									<div className="ref-agent-workspace-stack">
										{agentSidebarWorkspaces.length === 0 ? (
											<div className="ref-agent-empty-workspace" role="status">
												<span className="ref-agent-empty-workspace-icon" aria-hidden>
													<IconExplorer />
												</span>
												<div className="ref-agent-empty-workspace-copy">
													<span className="ref-agent-empty-workspace-title">{t('app.openWorkspace')}</span>
													<p className="ref-agent-empty-workspace-body">{t('app.explorerPlaceholder')}</p>
												</div>
												<button
													type="button"
													className="ref-agent-empty-workspace-btn"
													onClick={() => setWorkspacePickerOpen(true)}
												>
													<IconExplorer />
													<span>{t('app.openWorkspace')}</span>
												</button>
											</div>
										) : (
											agentSidebarWorkspaces.map((ws) => {
												const hasThreads = ws.isCurrent && ws.threadCount > 0;
												const showThreads = !ws.isCollapsed;
												const isEditingWorkspace = editingWorkspacePath === ws.path;
												return (
													<div
														key={ws.path}
														className={`ref-agent-workspace-group ${ws.isCurrent ? 'is-active' : ''} ${
															ws.isCollapsed ? 'is-collapsed' : ''
														} ${workspaceMenuPath === ws.path ? 'is-menu-open' : ''}`}
													>
														<div className={`ref-agent-workspace-row-shell ${ws.isCurrent ? 'is-active' : ''}`}>
															{isEditingWorkspace ? (
																<div className={`ref-agent-workspace-row is-editing ${ws.isCurrent ? 'is-active' : ''}`}>
																	<span
																		className={`ref-agent-workspace-disclosure ${
																			showThreads ? 'is-open' : ''
																		} is-visible`}
																		aria-hidden
																	>
																		<IconChevron className="ref-agent-workspace-disclosure-icon" />
																	</span>
																	<span className="ref-agent-workspace-row-icon" aria-hidden>
																		<IconExplorer />
																	</span>
																	<span className="ref-agent-workspace-row-copy">
																		<input
																			ref={workspaceNameInputRef}
																			type="text"
																			className="ref-agent-workspace-title-input"
																			value={editingWorkspaceNameDraft}
																			aria-label={t('app.workspaceMenuEditNamePrompt')}
																			onChange={(e) => {
																				const v = e.target.value;
																				setEditingWorkspaceNameDraft(v);
																				workspaceNameDraftRef.current = v;
																			}}
																			onClick={(e) => e.stopPropagation()}
																			onKeyDown={(e) => {
																				if (e.key === 'Enter') {
																					e.preventDefault();
																					commitWorkspaceAliasEdit();
																				} else if (e.key === 'Escape') {
																					e.preventDefault();
																					cancelWorkspaceAliasEdit();
																				}
																			}}
																			onBlur={commitWorkspaceAliasEdit}
																		/>
																		<span
																			className="ref-agent-workspace-row-subtitle"
																			title={ws.parent || ws.path}
																		>
																			{ws.parent || ws.path}
																		</span>
																	</span>
																	{ws.threadCount > 0 ? (
																		<span className="ref-agent-workspace-row-badge">{ws.threadCount}</span>
																	) : null}
																</div>
															) : (
																<button
																	type="button"
																	className={`ref-agent-workspace-row ${ws.isCurrent ? 'is-active' : ''}`}
																	onClick={() => handleWorkspacePrimaryAction(ws.path)}
																	aria-expanded={!ws.isCollapsed}
																>
																	<span
																		className={`ref-agent-workspace-disclosure ${
																			showThreads ? 'is-open' : ''
																		} is-visible`}
																		aria-hidden
																	>
																		<IconChevron className="ref-agent-workspace-disclosure-icon" />
																	</span>
																	<span className="ref-agent-workspace-row-icon" aria-hidden>
																		<IconExplorer />
																	</span>
																	<span className="ref-agent-workspace-row-copy">
																		<span className="ref-agent-workspace-row-label" title={ws.path}>
																			{ws.name}
																		</span>
																		<span
																			className="ref-agent-workspace-row-subtitle"
																			title={ws.parent || ws.path}
																		>
																			{ws.parent || ws.path}
																		</span>
																	</span>
																	{ws.threadCount > 0 ? (
																		<span className="ref-agent-workspace-row-badge">{ws.threadCount}</span>
																	) : null}
																</button>
															)}

															<div className="ref-agent-workspace-actions">
																<button
																	type="button"
																	className="ref-agent-workspace-action-btn"
																	title={t('app.newAgent')}
																	aria-label={t('app.newAgent')}
																	onClick={(e) => {
																		e.stopPropagation();
																		void onNewThreadForWorkspace(ws.path);
																	}}
																>
																	<IconPlus />
																</button>
																<button
																	type="button"
																	className={`ref-agent-workspace-action-btn ${
																		workspaceMenuPath === ws.path ? 'is-active' : ''
																	}`}
																	title={t('app.editorChatMoreAria')}
																	aria-label={t('app.editorChatMoreAria')}
																	aria-haspopup="menu"
																	aria-expanded={workspaceMenuPath === ws.path}
																	onClick={(e) => {
																		e.stopPropagation();
																		const anchor = e.currentTarget;
																		if (workspaceMenuPath === ws.path) {
																			closeWorkspaceMenu();
																		} else {
																			openWorkspaceMenu(ws.path, anchor);
																		}
																	}}
																>
																	<IconDotsHorizontal />
																</button>
															</div>
														</div>

														<div className={`ref-collapse-grid ${showThreads ? 'is-open' : ''}`}>
															<div className="ref-collapse-inner">
																{hasThreads ? (
																	<div className="ref-agent-thread-tree" aria-hidden={!showThreads}>
																		<div className="ref-agent-thread-cluster">
																			<div className="ref-thread-section-label ref-thread-section-label--nested">
																				{t('app.today')}
																			</div>
																			<div className="ref-thread-list ref-thread-list--nested">
																				{todayThreads.map(renderThreadItem)}
																			</div>
																		</div>
																		{archivedThreads.length > 0 ? (
																			<div className="ref-agent-thread-cluster">
																				<div className="ref-thread-section-label ref-thread-section-label--archived ref-thread-section-label--nested">
																					{t('app.archived')}
																				</div>
																				<div className="ref-thread-list ref-thread-list--nested">
																					{archivedThreads.map(renderThreadItem)}
																				</div>
																			</div>
																		) : null}
																	</div>
																) : (
																	<div className="ref-agent-workspace-empty" aria-hidden={!showThreads}>
																		{t('app.noThreads')}
																	</div>
																)}
															</div>
														</div>
													</div>
												);
											})
										)}
									</div>
								</div>
							</div>
						</div>
						<div className="ref-left-footer ref-left-footer--agent">
							<button
								type="button"
								className="ref-agent-settings-link"
								onClick={() => openSettingsPage('general')}
							>
								<IconSettings className="ref-agent-settings-link-icon" />
								<span>{t('app.settings')}</span>
							</button>
						</div>
					</div>
					) : (
				/* ═══ Editor 布局：左侧 = 文件树 ═══ */
				<EditorLeftSidebar
					shell={shell}
					workspace={workspace}
					workspaceBasename={workspaceBasename}
					ipcOk={ipcOk}
					editorLeftSidebarView={editorLeftSidebarView}
					setEditorLeftSidebarView={setEditorLeftSidebarView}
					editorExplorerCollapsed={editorExplorerCollapsed}
					toggleEditorExplorerCollapsed={toggleEditorExplorerCollapsed}
					editorSidebarWorkspaceLabel={editorSidebarWorkspaceLabel}
					editorSidebarSelectedRel={editorSidebarSelectedRel}
					editorExplorerScrollRef={editorExplorerScrollRef}
					workspaceExplorerActions={workspaceExplorerActions}
					gitPathStatus={gitPathStatus}
					treeEpoch={treeEpoch}
					editorSidebarSearchQuery={editorSidebarSearchQuery}
					setEditorSidebarSearchQuery={setEditorSidebarSearchQuery}
					normalizedEditorSidebarSearchQuery={normalizedEditorSidebarSearchQuery}
					editorSidebarSearchResults={editorSidebarSearchResults}
					editorSidebarSearchInputRef={editorSidebarSearchInputRef}
					gitUnavailableReason={gitUnavailableReason}
					gitLines={gitLines}
					gitChangedPaths={gitChangedPaths}
					fileMenuNewFile={() => void fileMenuNewFile()}
					revealWorkspaceInOs={(p) => void revealWorkspaceInOs(p)}
					refreshGit={() => void refreshGit()}
					onExplorerOpenFile={(rel) => void onExplorerOpenFile(rel)}
					setWorkspacePickerOpen={setWorkspacePickerOpen}
					openSettingsPage={openSettingsPage}
				/>
				)}
				</aside>

				<div
					className={`ref-resize-handle ${leftSidebarOpen ? '' : 'is-collapsed'}`}
					role="separator"
					aria-orientation="vertical"
					aria-label={t('app.resizeLeftAria')}
					title={t('app.resizeLeftTitle')}
					onMouseDown={leftSidebarOpen ? beginResizeLeft : undefined}
					onDoubleClick={resetRailWidths}
				/>

				{layoutMode === 'agent' ? (
				<main
					className={`ref-center ref-center--agent-layout ${hasConversation ? 'ref-center--chat' : 'ref-center--empty-agent'}`}
					aria-label={t('app.commandCenter')}
					onKeyDown={onPlanNewIdea}
				>
					<div className="ref-context-block ref-context-block--agent">
						<div className="ref-context-line">
							<span className="ref-agent-context-pill">
								<IconDoc className="ref-context-icon" />
								<span className="ref-context-title">{workspace ? workspaceBasename : t('app.noWorkspace')}</span>
							</span>
						</div>
						{hasConversation ? (
							<div className="ref-context-sub ref-context-sub--agent" title={currentThreadTitle}>
								{currentThreadTitle}
							</div>
						) : null}
					</div>

					<div className="ref-agent-rail-toggle-group" aria-label={t('app.rightSidebarViews')}>
						{hasAgentPlanSidebarContent ? (
							<button
								type="button"
								className={`ref-agent-rail-toggle ${
									agentRightSidebarOpen && agentRightSidebarView === 'plan' ? 'is-open' : ''
								}`}
								onClick={() => toggleAgentRightSidebarView('plan')}
								title={t('app.tabPlan')}
								aria-label={t('app.tabPlan')}
								aria-pressed={agentRightSidebarOpen && agentRightSidebarView === 'plan'}
								aria-controls="agent-right-sidebar"
							>
								<IconDoc />
							</button>
						) : null}
						<button
							type="button"
							className={`ref-agent-rail-toggle ${
								agentRightSidebarOpen && agentRightSidebarView === 'git' ? 'is-open' : ''
							}`}
							onClick={() => toggleAgentRightSidebarView('git')}
							title={t('app.tabGit')}
							aria-label={t('app.tabGit')}
							aria-pressed={agentRightSidebarOpen && agentRightSidebarView === 'git'}
							aria-controls="agent-right-sidebar"
						>
							<IconGitSCM />
						</button>
					</div>

					{renderAgentConversationBelowContext()}
				</main>
				) : (
				/* ═══ Editor：中间 = 标签 + 面包屑 + 编辑器（扁平，贴近 VS Code）；底部终端可关 ═══ */
				<main
					className="ref-center ref-center--editor-workspace ref-center--editor-shell"
					aria-label={t('app.editorWorkspaceMainAria')}
				>
					<div className="ref-editor-center-split">
						<div className="ref-editor-split-top">
							<EditorTabBar
								tabs={openTabs}
								activeTabId={activeTabId}
								onSelect={(id) => void onSelectTab(id)}
								onClose={onCloseTab}
							/>
							{showEditorPlanDocumentInCenter ? (
								<>
									<div className="ref-editor-bc-toolbar-row">
										<div className="ref-editor-bc-toolbar-inner">
											<div className="ref-editor-plan-draft-meta">
												<span className="ref-editor-plan-draft-label">{t('plan.review.label')}</span>
												<span
													className="ref-editor-plan-draft-path"
													title={planFileRelPath ?? planFilePath ?? undefined}
												>
													{planFileRelPath ?? planFilePath ?? t('app.planSidebarWaiting')}
												</span>
											</div>
											<div className="ref-editor-bc-actions">
												<div className="ref-editor-plan-chrome">
													<VoidSelect
														variant="compact"
														ariaLabel={t('plan.review.model')}
														value={editorPlanBuildModelId}
														disabled={planReviewIsBuilt || awaitingReply}
														onChange={setEditorPlanBuildModelId}
														options={[
															{ value: '', label: t('plan.review.pickModel'), disabled: true },
															...modelPickerItems.map((m) => ({
																value: m.id,
																label: m.label,
															})),
														]}
													/>
													{planReviewIsBuilt ? (
														<span className="ref-editor-plan-built" role="status">
															{t('app.planEditorBuilt')}
														</span>
													) : awaitingReply ? (
														<span className="ref-editor-plan-built" role="status">
															{t('app.planSidebarStreaming')}
														</span>
													) : (
														<button
															type="button"
															className="ref-editor-plan-build-btn"
															disabled={!editorCenterPlanCanBuild}
															onClick={() => onPlanBuild(editorPlanBuildModelId)}
														>
															{t('plan.review.build')}
														</button>
													)}
												</div>
											</div>
										</div>
									</div>
									<div className="ref-editor-canvas">
										<div className="ref-editor-pane">
											<div className="ref-editor-plan-preview-scroll">
												<div className="ref-editor-plan-preview-surface">
													<div className="ref-agent-plan-doc-markdown ref-agent-plan-preview-markdown">
														<ChatMarkdown content={editorCenterPlanMarkdown} />
													</div>
												</div>
											</div>
										</div>
									</div>
								</>
							) : filePath.trim() ? (
								<>
									<div className="ref-editor-bc-toolbar-row">
										<div className="ref-editor-bc-toolbar-inner">
											<EditorFileBreadcrumb filePath={filePath.trim()} />
											<div className="ref-editor-bc-actions">
												{markdownPaneMode != null ? (
													<div
														className="ref-editor-md-mode-toggle"
														role="group"
														aria-label={t('app.editorMarkdownModeAria')}
													>
														<button
															type="button"
															className={`ref-editor-md-mode-btn ${markdownPaneMode === 'source' ? 'is-active' : ''}`}
															onClick={() => setMarkdownPaneMode('source')}
														>
															{t('app.editorMarkdownSource')}
														</button>
														<button
															type="button"
															className={`ref-editor-md-mode-btn ${markdownPaneMode === 'preview' ? 'is-active' : ''}`}
															onClick={() => setMarkdownPaneMode('preview')}
														>
															{t('app.editorMarkdownPreview')}
														</button>
													</div>
												) : null}
												<button
													type="button"
													className="ref-icon-tile"
													aria-label={t('app.reloadFileAria')}
													onClick={() => void onLoadFile()}
												>
													<IconRefresh />
												</button>
												<span className={tsLspPillClassName} title={tsLspPillTitle}>
													LSP
												</span>
												<button
													type="button"
													className="ref-editor-save"
													disabled={!filePath.trim()}
													onClick={() => void onSaveFile()}
												>
													{t('common.save')}
												</button>
												{showPlanFileEditorChrome ? (
													<div className="ref-editor-plan-chrome">
														<VoidSelect
															variant="compact"
															ariaLabel={t('plan.review.model')}
															value={editorPlanBuildModelId}
															disabled={editorPlanFileIsBuilt}
															onChange={setEditorPlanBuildModelId}
															options={[
																{ value: '', label: t('plan.review.pickModel'), disabled: true },
																...modelPickerItems.map((m) => ({
																	value: m.id,
																	label: m.label,
																})),
															]}
														/>
														{editorPlanFileIsBuilt ? (
															<span className="ref-editor-plan-built" role="status">
																{t('app.planEditorBuilt')}
															</span>
														) : (
															<button
																type="button"
																className="ref-editor-plan-build-btn"
																disabled={
																	awaitingReply ||
																	!editorPlanBuildModelId.trim() ||
																	modelPickerItems.length === 0
																}
																onClick={() => onExecutePlanFromEditor(editorPlanBuildModelId)}
															>
																{t('plan.review.build')}
															</button>
														)}
													</div>
												) : null}
											</div>
										</div>
									</div>
									<div className="ref-editor-canvas">
										<div
											className={`ref-editor-pane${markdownPaneMode === 'preview' ? ' ref-editor-pane--md-preview' : ''}`}
										>
											{markdownPaneMode === 'preview' ? (
												<div
													className="ref-editor-md-preview-scroll"
													role="document"
													aria-label={t('app.editorMarkdownPreview')}
												>
													<ChatMarkdown content={markdownPreviewContent} />
												</div>
											) : (
												<div className="ref-monaco-fill">
													{activeEditorInlineDiff ? (
														<DiffEditor
															key={`diff:${filePath.trim()}`}
															height="100%"
															theme={monacoChromeTheme}
															original={activeEditorInlineDiff.originalContent}
															modified={editorValue}
															originalModelPath={monacoOriginalDocumentPath}
															modifiedModelPath={monacoDocumentPath || filePath.trim()}
															language={languageFromFilePath(filePath.trim())}
															onMount={onMonacoDiffMount}
															options={{
																...editorSettingsToMonacoOptions(editorSettings),
																renderSideBySide: false,
																originalEditable: false,
																enableSplitViewResizing: false,
																scrollbar: {
																	verticalScrollbarSize: 8,
																	horizontalScrollbarSize: 8,
																	useShadows: false,
																},
															}}
														/>
													) : (
														<Editor
															key={filePath.trim()}
															height="100%"
															theme={monacoChromeTheme}
															path={monacoDocumentPath || filePath.trim()}
															language={languageFromFilePath(filePath.trim())}
															value={editorValue}
															onChange={(v) => {
																setEditorValue(v ?? '');
																setOpenTabs((prev) =>
																	prev.map((tab) =>
																		tab.filePath === filePath.trim() ? { ...tab, dirty: true } : tab
																	)
																);
															}}
															onMount={onMonacoMount}
															options={{
																...editorSettingsToMonacoOptions(editorSettings),
																scrollbar: {
																	verticalScrollbarSize: 8,
																	horizontalScrollbarSize: 8,
																	useShadows: false,
																},
															}}
														/>
													)}
												</div>
											)}
										</div>
									</div>
								</>
							) : (
								<div className="ref-editor-empty-state">
									<div className="ref-editor-empty-card">
										<BrandLogo className="ref-editor-empty-logo" size={28} />
										<div className="ref-editor-empty-copy">
											<strong className="ref-editor-empty-title">{t('app.editorEmptyTitle')}</strong>
											<p className="ref-editor-empty-description">{t('app.editorEmptyDescription')}</p>
										</div>
										<button
											type="button"
											className="ref-open-workspace ref-open-workspace--inline"
											onClick={() => setWorkspacePickerOpen(true)}
										>
											{t('app.openWorkspace')}
										</button>
									</div>
								</div>
							)}
						</div>
						{editorTerminalVisible ? (
							<>
								<div
									className="ref-editor-terminal-resize-handle"
									role="separator"
									aria-orientation="horizontal"
									aria-label={t('app.resizeEditorTerminalAria')}
									title={t('app.resizeEditorTerminalTitle')}
									onMouseDown={beginResizeEditorTerminal}
								/>
								<div
									className="ref-editor-split-bottom"
									style={{
										flex: `0 0 ${editorTerminalHeightPx}px`,
										minHeight: EDITOR_TERMINAL_H_MIN,
										maxHeight: `${Math.floor(window.innerHeight * EDITOR_TERMINAL_H_MAX_RATIO)}px`,
									}}
								>
								<div className="ref-editor-panel-terminal-tabs">
									<div className="ref-editor-terminal-tabs-scroll" role="tablist" aria-label={t('app.terminalTab')}>
										{editorTerminalSessions.map((s) => {
											const isActive = s.id === activeEditorTerminalId;
											return (
												<div
													key={s.id}
													className={`ref-editor-terminal-tab ${isActive ? 'is-active' : ''}`}
													role="presentation"
												>
													<button
														type="button"
														role="tab"
														aria-selected={isActive}
														className="ref-editor-terminal-tab-main"
														onClick={() => setActiveEditorTerminalId(s.id)}
													>
														{s.title}
													</button>
													<button
														type="button"
														className="ref-editor-terminal-tab-close"
														aria-label={t('app.closeTerminalTab')}
														onClick={(e) => {
															e.stopPropagation();
															closeEditorTerminalSession(s.id);
														}}
													>
														<IconCloseSmall />
													</button>
												</div>
											);
										})}
									</div>
									<span className="ref-editor-panel-tab-spacer" aria-hidden />
									<button
										type="button"
										className="ref-editor-terminal-icon-btn"
										title={t('app.newTerminalTitle')}
										aria-label={t('app.menuNewTerminal')}
										onClick={() => void appendEditorTerminal()}
									>
										<IconPlus />
									</button>
									<button
										type="button"
										className="ref-editor-terminal-icon-btn"
										title={t('app.closeTerminalPanel')}
										aria-label={t('app.closeTerminalPanel')}
										onClick={() => closeEditorTerminalPanel()}
									>
										<IconCloseSmall />
									</button>
								</div>
								<div className="ref-editor-terminal-stack">
									{editorTerminalSessions.map((s) => (
										<div
											key={s.id}
											className={`ref-editor-terminal-pane ${s.id === activeEditorTerminalId ? 'is-active' : ''}`}
										>
											<PtyTerminalView
												sessionId={s.id}
												active={s.id === activeEditorTerminalId}
												compactChrome
												onSessionExit={() => onEditorTerminalSessionExit(s.id)}
											/>
										</div>
									))}
								</div>
								</div>
							</>
						) : null}
					</div>
				</main>
				)}

				<div
					className={`ref-resize-handle ${
						layoutMode === 'agent' && !agentRightSidebarOpen ? 'is-collapsed' : ''
					}`}
					role="separator"
					aria-orientation="vertical"
					aria-label={t('app.resizeRightAria')}
					title={t('app.resizeRightTitle')}
					onMouseDown={layoutMode === 'agent' && !agentRightSidebarOpen ? undefined : beginResizeRight}
					onDoubleClick={resetRailWidths}
				/>

				{layoutMode === 'agent' ? (
				<aside
					id="agent-right-sidebar"
					className={`ref-right ref-right--agent-layout ${agentRightSidebarOpen ? 'is-open' : 'is-collapsed'}`}
					aria-label={t('app.rightSidebar')}
					aria-hidden={!agentRightSidebarOpen}
				>
					{agentRightSidebarView === 'plan' ? (
						agentPlanSidebarPanel
					) : agentRightSidebarView === 'file' ? (
						agentFileSidebarPanel
					) : (
						<div className="ref-agent-review-shell">
							<div className="ref-agent-review-head">
								<div className="ref-agent-review-title-stack">
									<span className="ref-agent-review-kicker">{t('app.tabGit')}</span>
									<span className="ref-agent-review-title">{agentRightSidebarTitle}</span>
								</div>
								<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
									{hasAgentPlanSidebarContent ? (
										<button
											type="button"
											aria-label={t('app.tabPlan')}
											title={t('app.tabPlan')}
											className="ref-right-icon-tab"
											onClick={() => openAgentRightSidebarView('plan')}
										>
											<IconDoc />
										</button>
									) : null}
									<button
										type="button"
										aria-label={t('app.tabGit')}
										title={t('app.tabGit')}
										className="ref-right-icon-tab is-active"
										onClick={() => openAgentRightSidebarView('git')}
									>
										<IconGitSCM />
									</button>
									<button
										type="button"
										aria-label={t('common.close')}
										title={t('common.close')}
										className="ref-right-icon-tab"
										onClick={() => setAgentRightSidebarOpen(false)}
									>
										<IconCloseSmall />
									</button>
								</div>
							</div>

							<div className="ref-right-panel-stage">
								<div className="ref-right-panel-view ref-right-panel-view--agent">
									<div className="ref-right-git-stack">
										<div className="ref-right-toolbar">
											<button type="button" className="ref-icon-tile" aria-label={t('app.gitRefreshAria')} onClick={() => void refreshGit()}>
												<IconRefresh />
											</button>
											<span className="ref-local-label">{t('app.gitLocal')}</span>
											<span className="ref-branch-chip">{gitBranch || 'master'}</span>
										</div>
										<div className="ref-git-summary ref-git-summary--rich">
											{gitUnavailableReason !== 'none' ? (
												<span className="ref-git-count ref-git-count--muted">
													{gitUnavailableCopy(t, gitUnavailableReason).title}
												</span>
											) : changeCount > 0 ? (
												<span className="ref-git-count">{t('app.gitUncommitted', { count: String(changeCount) })}</span>
											) : (
												<span className="ref-git-count ref-git-count--muted">{t('app.gitNoChanges')}</span>
											)}
											{gitUnavailableReason === 'none' && diffTotals.additions > 0 ? (
												<span className="ref-git-stat-add">+{diffTotals.additions}</span>
											) : null}
											{gitUnavailableReason === 'none' && diffTotals.deletions > 0 ? (
												<span className="ref-git-stat-del">-{diffTotals.deletions}</span>
											) : null}
										</div>
										<div className="ref-git-body">
											{gitUnavailableReason !== 'none' ? (
												<GitUnavailableState t={t} reason={gitUnavailableReason} detail={gitLines[0] ?? ''} />
											) : changeCount > 0 ? (
												<div className="ref-git-cards">
													{gitChangedPaths.map((rel) => {
														const pr = diffPreviews[rel];
														const st = gitPathStatus[rel];
														const badge = st ? changeBadgeLabel(st.label, t) : t('app.gitChangedFallback');
														return (
															<div key={rel} className="ref-git-card">
																<div className="ref-git-card-head">
																	<span className="ref-git-card-name" title={rel}>
																		{rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel}
																	</span>
																	<span className="ref-git-card-badge">{badge}</span>
																	<button
																		type="button"
																		className="ref-git-card-open"
																		aria-label={gitCardOpenAria}
																		title={gitCardOpenTitle}
																		onClick={() =>
																			void onExplorerOpenFile(rel, undefined, undefined, {
																				diff: pr?.diff ?? null,
																				allowReviewActions: true,
																			})
																		}
																	>
																		<IconEye />
																	</button>
																</div>
																<div className="ref-git-card-body">
																	{diffLoading && !pr ? (
																		<div className="ref-git-card-skel">{t('app.gitDiffLoading')}</div>
																	) : null}
																	{pr?.isBinary ? (
																		<div className="ref-git-binary-msg">{pr.diff || t('app.gitBinary')}</div>
																	) : null}
																	{pr && !pr.isBinary && pr.diff ? <GitDiffLines diff={pr.diff} t={t} /> : null}
																	{pr && !pr.isBinary && !pr.diff ? (
																		<div className="ref-git-binary-msg">{t('app.gitNoPreview')}</div>
																	) : null}
																</div>
															</div>
														);
													})}
												</div>
											) : null}
											{gitUnavailableReason === 'none' ? (
												<>
													<input
														className="ref-commit-field"
														placeholder={t('app.commitPlaceholder')}
														value={commitMsg}
														onChange={(e) => setCommitMsg(e.target.value)}
													/>
													<div className="ref-commit-actions">
														<button type="button" className="ref-commit-btn" onClick={() => void onCommitOnly()}>
															{t('app.commit')}
														</button>
														<button
															type="button"
															className="ref-commit-btn-secondary"
															onClick={() => void onCommitAndPush()}
														>
															{t('app.commitPush')}
														</button>
													</div>
												</>
											) : null}
											{gitUnavailableReason === 'none' && gitActionError ? (
												<p className="ref-git-action-error">{gitActionError}</p>
											) : null}
										</div>
									</div>
								</div>
							</div>
						</div>
					)}
				</aside>
				) : (
				/* ═══ Editor 布局：右侧 = Agent 对话（与 Agent 布局同一套消息与输入） ═══ */
				<aside
					className={`ref-right ref-right--editor-chat ref-right--editor-shell ${hasConversation ? 'ref-right--editor-chat--active' : ''}`}
					aria-label={t('app.editorAgentChatRail')}
					onKeyDown={onPlanNewIdea}
				>
					<div className="ref-editor-chat-panel">
						<div className="ref-editor-chat-tab-rail">
							<nav
								className="ref-editor-chat-tabs-scroll"
								aria-label={t('app.editorChatTabListAria')}
							>
								{threadsChrono.map((th) => {
									const active = th.id === currentId;
									return (
										<div
											key={th.id}
											className={`ref-editor-chat-tab-shell ${active ? 'is-active' : ''}`}
										>
											<button
												type="button"
												className="ref-editor-chat-tab-main"
												aria-current={active ? 'true' : undefined}
												title={threadRowTitle(t, th)}
												onClick={() => {
													setEditorThreadHistoryOpen(false);
													void onSelectThread(th.id);
												}}
											>
												<span className="ref-editor-chat-tab-label">{threadRowTitle(t, th)}</span>
											</button>
											<button
												type="button"
												className={`ref-editor-chat-tab-close ${
													confirmDeleteId === th.id ? 'ref-editor-chat-tab-close--confirm' : ''
												}`}
												title={
													confirmDeleteId === th.id ? t('common.confirmDelete') : t('common.deleteThread')
												}
												aria-label={
													confirmDeleteId === th.id ? t('common.confirmDelete') : t('common.deleteThread')
												}
												onClick={(e) => void onDeleteThread(e, th.id)}
											>
												{confirmDeleteId === th.id ? (
													<span className="ref-editor-chat-tab-close-confirm-label">{t('common.confirm')}</span>
												) : (
													<IconCloseSmall className="ref-editor-chat-tab-close-svg" />
												)}
											</button>
										</div>
									);
								})}
							</nav>
							<div className="ref-editor-chat-tab-actions">
								<button
									type="button"
									className="ref-editor-chat-icon-btn"
									title={t('app.newAgent')}
									aria-label={t('app.newAgent')}
									onClick={() => {
										setEditorThreadHistoryOpen(false);
										setEditorChatMoreOpen(false);
										void onNewThread();
									}}
								>
									<IconPlus className="ref-editor-chat-icon-btn-svg" />
								</button>
								<div className="ref-editor-chat-menu-wrap" ref={editorHistoryMenuRef}>
									<button
										type="button"
										className={`ref-editor-chat-icon-btn ${editorThreadHistoryOpen ? 'is-active' : ''}`}
										title={t('app.editorChatHistoryAria')}
										aria-label={t('app.editorChatHistoryAria')}
										aria-expanded={editorThreadHistoryOpen}
										aria-haspopup="dialog"
										onClick={() => {
											setEditorChatMoreOpen(false);
											setEditorThreadHistoryOpen((o) => !o);
										}}
									>
										<IconHistory className="ref-editor-chat-icon-btn-svg" />
									</button>
									{editorThreadHistoryOpen ? (
										<div className="ref-editor-chat-dropdown ref-editor-chat-dropdown--history" role="dialog">
											<label className="ref-editor-chat-history-search">
												<IconSearch className="ref-editor-chat-history-search-ico" aria-hidden />
												<input
													type="search"
													className="ref-editor-chat-history-input"
													placeholder={t('app.editorChatSearchThreads')}
													value={threadSearch}
													onChange={(e) => setThreadSearch(e.target.value)}
													aria-label={t('app.editorChatSearchThreads')}
												/>
											</label>
											<div className="ref-editor-chat-history-section-label">{t('app.today')}</div>
											<div className="ref-editor-chat-history-list">
												{todayThreads.map(renderThreadItem)}
											</div>
											{archivedThreads.length > 0 ? (
												<>
													<div className="ref-editor-chat-history-section-label ref-editor-chat-history-section-label--arch">
														{t('app.archived')}
													</div>
													<div className="ref-editor-chat-history-list">
														{archivedThreads.map(renderThreadItem)}
													</div>
												</>
											) : null}
										</div>
									) : null}
								</div>
								<div className="ref-editor-chat-menu-wrap" ref={editorMoreMenuRef}>
									<button
										type="button"
										className={`ref-editor-chat-icon-btn ${editorChatMoreOpen ? 'is-active' : ''}`}
										title={t('app.editorChatMoreAria')}
										aria-label={t('app.editorChatMoreAria')}
										aria-expanded={editorChatMoreOpen}
										aria-haspopup="menu"
										onClick={() => {
											setEditorThreadHistoryOpen(false);
											setEditorChatMoreOpen((o) => !o);
										}}
									>
										<IconDotsHorizontal className="ref-editor-chat-icon-btn-svg" />
									</button>
									{editorChatMoreOpen ? (
										<div className="ref-editor-chat-dropdown ref-editor-chat-dropdown--more" role="menu">
											<button
												type="button"
												className="ref-editor-chat-more-item"
												role="menuitem"
												onClick={() => {
													setEditorChatMoreOpen(false);
													setComposerModePersist('plan');
													void onNewThread();
												}}
											>
												{t('app.planNewIdea')}
											</button>
											<button
												type="button"
												className="ref-editor-chat-more-item"
												role="menuitem"
												onClick={() => {
													setEditorChatMoreOpen(false);
													setWorkspaceToolsOpen(true);
												}}
											>
												{t('app.quickTerminal')}
											</button>
											<button
												type="button"
												className="ref-editor-chat-more-item"
												role="menuitem"
												onClick={() => {
													setEditorChatMoreOpen(false);
													openSettingsPage('general');
												}}
											>
												{t('app.settings')}
											</button>
										</div>
									) : null}
								</div>
							</div>
						</div>
						{renderAgentConversationBelowContext('editor-rail')}
					</div>
				</aside>
				)}
			</div>
			)}

			{activeWorkspaceMenuItem && workspaceMenuPosition ? (
				<div
					ref={workspaceMenuRef}
					className="ref-agent-workspace-menu ref-agent-workspace-menu--floating"
					role="menu"
					style={{
						top: workspaceMenuPosition.top,
						left: workspaceMenuPosition.left,
						transform: 'translateX(-100%)',
					}}
				>
					<button
						type="button"
						className="ref-agent-workspace-menu-item"
						role="menuitem"
						onClick={() => void revealWorkspaceInOs(activeWorkspaceMenuItem.path)}
					>
						<span className="ref-agent-workspace-menu-item-icon" aria-hidden>
							<IconArrowUpRight />
						</span>
						<span className="ref-agent-workspace-menu-item-copy">
							<span className="ref-agent-workspace-menu-item-label">{t('app.workspaceMenuOpenInExplorer')}</span>
						</span>
					</button>
					<button
						type="button"
						className="ref-agent-workspace-menu-item"
						role="menuitem"
						onClick={() => beginWorkspaceAliasEdit(activeWorkspaceMenuItem.path)}
					>
						<span className="ref-agent-workspace-menu-item-icon" aria-hidden>
							<IconPencil />
						</span>
						<span className="ref-agent-workspace-menu-item-copy">
							<span className="ref-agent-workspace-menu-item-label">{t('app.workspaceMenuEditName')}</span>
						</span>
					</button>
					<button
						type="button"
						className="ref-agent-workspace-menu-item is-destructive"
						role="menuitem"
						onClick={() => removeWorkspaceFromSidebar(activeWorkspaceMenuItem.path)}
					>
						<span className="ref-agent-workspace-menu-item-icon" aria-hidden>
							<IconTrash />
						</span>
						<span className="ref-agent-workspace-menu-item-copy">
							<span className="ref-agent-workspace-menu-item-label">{t('app.workspaceMenuRemove')}</span>
						</span>
					</button>
				</div>
			) : null}

			{workspaceToolsOpen ? (
				<section className="ref-drawer ref-drawer--terminal-only">
					<div className="ref-drawer-head">
						<span className="ref-drawer-title">{t('app.terminalDrawer')}</span>
						<button type="button" className="ref-drawer-close" onClick={() => setWorkspaceToolsOpen(false)}>
							{t('app.terminalCollapse')}
						</button>
					</div>
					<div className="ref-drawer-terminal">
						<DrawerPtyTerminal placeholder={t('app.terminalStarting')} />
					</div>
				</section>
			) : null}

			<OpenWorkspaceModal
				open={workspacePickerOpen}
				onClose={() => setWorkspacePickerOpen(false)}
				shell={shell}
				homePath={homePath}
				onWorkspaceOpened={(p) => void applyWorkspacePath(p)}
			/>

			<QuickOpenPalette
				open={quickOpenOpen}
				onClose={() => {
					setQuickOpenOpen(false);
					setQuickOpenSeed('');
				}}
				workspaceOpen={!!workspace}
				workspaceFiles={workspaceFileList}
				recentFilePaths={quickOpenRecentFiles}
				homeRecentFolders={homeRecents}
				activeFilePath={filePath.trim()}
				onOpenFile={(rel, a, b) => void onExplorerOpenFile(rel, a, b)}
				onOpenWorkspaceFolder={(p) => void openWorkspaceByPath(p)}
				onOpenWorkspacePicker={() => setWorkspacePickerOpen(true)}
				onOpenSettings={() => openSettingsPage('general')}
				onFocusSearchSidebar={(q) => focusSearchSidebarFromQuickOpen(q)}
				onGoToLine={goToLineInEditor}
				initialQuery={quickOpenSeed}
				searchWorkspaceSymbols={shell && indexingSettings.symbolIndexEnabled ? searchWorkspaceSymbolsFn : undefined}
				t={t}
			/>

			<Activity mode={settingsPageOpen || settingsOpenPending ? 'visible' : 'hidden'}>
				<div className="ref-settings-backdrop" role="presentation" onClick={() => void closeSettingsPage()}>
					<div className="ref-settings-mount" onClick={(e) => e.stopPropagation()}>
						<Suspense
							fallback={
								<div className="ref-settings-open-loading" role="status" aria-live="polite">
									<span className="ref-settings-open-loading-spinner" aria-hidden />
									<span>{t('common.loading')}</span>
								</div>
							}
						>
							<SettingsPage
								initialNav={settingsInitialNav}
								onClose={() => void closeSettingsPage()}
								defaultModel={defaultModel}
								modelProviders={modelProviders}
								modelEntries={modelEntries}
								onChangeModelProviders={onChangeModelProviders}
								onChangeModelEntries={onChangeModelEntries}
								onPickDefaultModel={(id) => void onPickDefaultModel(id)}
								agentCustomization={mergedAgentCustomization}
								onChangeAgentCustomization={onChangeMergedAgentCustomization}
								editorSettings={editorSettings}
								onChangeEditorSettings={setEditorSettings}
								onPersistLanguage={(loc) => void onPersistLanguage(loc)}
								indexingSettings={indexingSettings}
								onChangeIndexingSettings={setIndexingSettings}
								onPersistIndexingPatch={onPersistIndexingPatch}
								mcpServers={mcpServers}
								onChangeMcpServers={setMcpServers}
								mcpStatuses={mcpStatuses}
								onRefreshMcpStatuses={onRefreshMcpStatuses}
								onStartMcpServer={onStartMcpServer}
								onStopMcpServer={onStopMcpServer}
								onRestartMcpServer={onRestartMcpServer}
								shell={shell ?? null}
								workspaceOpen={!!workspace}
								onOpenSkillCreator={startSkillCreatorFlow}
								onOpenWorkspaceSkillFile={handleOpenWorkspaceSkillFile}
								onDeleteWorkspaceSkillDisk={handleDeleteWorkspaceSkillDisk}
								colorMode={colorMode}
								onChangeColorMode={(m, origin) => void onChangeColorMode(m, origin)}
								effectiveColorScheme={effectiveScheme}
								appearanceSettings={appearanceSettings}
								onChangeAppearanceSettings={setAppearanceSettings}
								layoutMode={layoutMode}
								onChangeLayoutMode={(next) => void switchLayoutModeFromSettings(next)}
							/>
						</Suspense>
					</div>
				</div>
			</Activity>

			{layoutSwitchPending && layoutSwitchTarget === 'editor' ? (
				<div className="ref-layout-switch-loading" role="status" aria-live="polite">
					<div className="ref-layout-switch-loading-card">
						<BrandLogo className="ref-layout-switch-loading-logo" size={34} />
						<div className="ref-layout-switch-loading-copy">
							<strong>{t('app.switchingToEditor')}</strong>
							<span>{t('app.switchingToEditorHint')}</span>
						</div>
						<span className="ref-layout-switch-loading-spinner" aria-hidden />
					</div>
				</div>
			) : null}

			<ComposerPlusMenu
				open={plusMenuOpen}
				onClose={() => setPlusMenuOpen(false)}
				anchorRef={plusMenuAnchorRefForDropdown}
				mode={composerMode}
				onSelectMode={setComposerModePersist}
			/>

			<GitBranchPickerDropdown
				open={gitBranchPickerOpen}
				onClose={() => setGitBranchPickerOpen(false)}
				anchorRef={composerGitBranchAnchorRef}
				shell={shell ?? null}
				repoReady={gitStatusOk}
				branches={gitBranchList}
				listCurrent={gitBranchListCurrent}
				onBranchListFresh={onGitBranchListFresh}
				displayBranch={gitBranch}
				onAfterGitChange={() => void refreshGit()}
				onNotify={showTransientToast}
			/>

			<ModelPickerDropdown
				open={modelPickerOpen}
				onClose={() => setModelPickerOpen(false)}
				anchorRef={modelPickerAnchorRefForDropdown}
				items={modelPickerItems}
				selectedId={defaultModel}
				onSelectModel={(id) => void onPickDefaultModel(id)}
				onNavigateToSettings={() => openSettingsPage('models')}
				onAddModels={() => openSettingsPage('models')}
				getThinkingLevel={(id) => thinkingByModelId[id] ?? 'medium'}
				onThinkingLevelChange={(modelId, v) => {
					setThinkingByModelId((prev) => ({ ...prev, [modelId]: v }));
					if (shell) {
						void shell.invoke('settings:set', { models: { thinkingByModelId: { [modelId]: v } } });
					}
				}}
			/>

			<ComposerAtMenu
				open={atMention.atMenuOpen}
				items={atMention.atMenuItems}
				highlightIndex={atMention.atMenuHighlight}
				caretRect={atMention.atCaretRect}
				onHighlight={atMention.setAtMenuHighlight}
				onSelect={atMention.applyAtSelection}
				onClose={atMention.closeAtMenu}
			/>

			<ComposerSlashMenu
				open={slashCommand.slashMenuOpen}
				query={slashCommand.slashQuery}
				items={slashCommand.slashMenuItems}
				highlightIndex={slashCommand.slashMenuHighlight}
				caretRect={slashCommand.slashCaretRect}
				onHighlight={slashCommand.setSlashMenuHighlight}
				onSelect={slashCommand.applySlashSelection}
				onClose={slashCommand.closeSlashMenu}
			/>

			{saveToastVisible ? <div key={saveToastKey} className="ref-save-toast">Saved ✓</div> : null}
			{subAgentBgToast ? (
				<div
					key={subAgentBgToast.key}
					className={`ref-sub-agent-bg-toast ${subAgentBgToast.ok ? 'is-ok' : 'is-err'}`}
					role="status"
				>
					{subAgentBgToast.text}
				</div>
			) : null}
			{composerAttachErr ? (
				<div className="ref-sub-agent-bg-toast is-err" role="alert">
					{composerAttachErr}
				</div>
			) : null}
		</div>
	);
}
