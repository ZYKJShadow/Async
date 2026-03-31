import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import Editor from '@monaco-editor/react';
import { PtyTerminalView } from './PtyTerminalView';
import { DrawerPtyTerminal } from './DrawerPtyTerminal';
import { ChatMarkdown } from './ChatMarkdown';
import { languageFromFilePath } from './fileTypeIcons';
import { OpenWorkspaceModal } from './OpenWorkspaceModal';
import { WorkspaceExplorer, type GitPathStatusMap } from './WorkspaceExplorer';
import {
	type AgentPendingPatch,
	type ChatStreamPayload,
	coerceThinkingByModelId,
	type ThinkingLevel,
	type TurnTokenUsage,
} from './ipcTypes';
import { AgentReviewPanel } from './AgentReviewPanel';
import { AgentFileChangesPanel } from './AgentFileChanges';
import {
	assistantMessageUsesAgentToolProtocol,
	segmentAssistantContent,
	collectFileChanges,
} from './agentChatSegments';
import {
	clearPersistedAgentFileChanges,
	hashAgentAssistantContent,
	readPersistedAgentFileChanges,
	writePersistedAgentFileChanges,
} from './agentFileChangesPersist';
import { mergeAgentFileChangesWithGit } from './agentFileChangesFromGit';
import { ModelPickerDropdown, type ModelPickerItem } from './ModelPickerDropdown';
import { SettingsPage, type SettingsNavId } from './SettingsPage';
import {
	AUTO_MODEL_ID,
	coerceDefaultModel,
	sanitizeEnabledIds,
	type UserModelEntry,
} from './modelCatalog';
import { ComposerPlusMenu, ComposerModeIcon, composerModeLabel, type ComposerMode } from './ComposerPlusMenu';
import { ComposerThoughtBlock } from './ComposerThoughtBlock';
import { ComposerAtMenu } from './ComposerAtMenu';
import { ComposerSlashMenu } from './ComposerSlashMenu';
import { ComposerRichInput } from './ComposerRichInput';
import { PlanQuestionDialog } from './PlanQuestionDialog';
import { SkillScopeDialog } from './SkillScopeDialog';
import { ToolApprovalInlineCard } from './ToolApprovalCard';
import { AgentMistakeLimitDialog } from './AgentMistakeLimitDialog';
import { PlanReviewPanel } from './PlanReviewPanel';
import {
	parseQuestions,
	parsePlanDocument,
	stripPlanBodyForChatDisplay,
	toPlanMd,
	generatePlanFilename,
	type PlanQuestion,
	type ParsedPlan,
} from './planParser';
import {
	CREATE_SKILL_SLUG,
	isCreateSkillComposerTurn,
	newSegmentId,
	segmentsToWireText,
	segmentsTrimmedEmpty,
	userMessageToSegments,
	type ComposerSegment,
} from './composerSegments';
import { getAtMentionRange } from './composerAtMention';
import { textBeforeCaretForAt } from './composerRichDom';
import { useComposerAtMention, type AtComposerSlot } from './useComposerAtMention';
import { useComposerSlashCommand } from './useComposerSlashCommand';
import { UserMessageRich } from './UserMessageRich';
import { BrandLogo } from './BrandLogo';
import {
	defaultAgentCustomization,
	type AgentCustomization,
	type AgentRule,
	type AgentSkill,
	type AgentSubagent,
} from './agentSettingsTypes';
import { normalizeIndexingSettings, type IndexingSettingsState } from './indexingSettingsTypes';
import { defaultEditorSettings, editorSettingsToMonacoOptions, type EditorSettings } from './EditorSettingsPanel';
import type { McpServerConfig, McpServerStatus } from './mcpTypes';
import { EditorTabBar, tabIdFromPath, type EditorTab } from './EditorTabBar';
import { MenubarFileMenu } from './MenubarFileMenu';
import { QuickOpenPalette, quickOpenPrimaryShortcutLabel, saveShortcutLabel } from './quickOpenPalette';
import { registerTsLspMonacoOnce } from './tsLspMonaco';
import { monacoWorkspaceRootRef } from './tsLspWorkspaceRef';
import { workspaceRelativeFileUrl } from './workspaceUri';
import { voidShellDebugLog } from './tabCloseDebug';

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
import { useI18n, translateChatError, normalizeLocale, type AppLocale, type TFunction } from './i18n';
import './monacoSetup';

type ThreadInfo = {
	id: string;
	title: string;
	updatedAt: number;
	createdAt?: number;
	previewCount: number;
	isToday?: boolean;
	isAwaitingReply?: boolean;
	hasAgentDiff?: boolean;
	additions?: number;
	deletions?: number;
	filePaths?: string[];
	fileCount?: number;
	subtitleFallback?: string;
	tokenUsage?: { totalInput: number; totalOutput: number };
	fileStateCount?: number;
};
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type EditorPtySession = { id: string; title: string };
type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

const SIDEBAR_LAYOUT_KEY = 'async:sidebar-widths-v1';
const COMPOSER_MODE_KEY = 'async:composer-mode-v1';
const EDITOR_TERMINAL_HEIGHT_KEY = 'async:editor-terminal-height-v1';
const EDITOR_TERMINAL_H_MIN = 120;
const EDITOR_TERMINAL_H_MAX_RATIO = 0.65;

function clampEditorTerminalHeight(h: number): number {
	if (typeof window === 'undefined') {
		return Math.max(EDITOR_TERMINAL_H_MIN, Math.round(h));
	}
	const max = Math.max(
		EDITOR_TERMINAL_H_MIN + 40,
		Math.floor(window.innerHeight * EDITOR_TERMINAL_H_MAX_RATIO)
	);
	return Math.min(max, Math.max(EDITOR_TERMINAL_H_MIN, Math.round(h)));
}

function readEditorTerminalHeightPx(): number {
	try {
		if (typeof window === 'undefined') {
			return 260;
		}
		const v = localStorage.getItem(EDITOR_TERMINAL_HEIGHT_KEY);
		if (v) {
			const n = parseInt(v, 10);
			if (Number.isFinite(n)) {
				return clampEditorTerminalHeight(n);
			}
		}
	} catch {
		/* ignore */
	}
	return clampEditorTerminalHeight(Math.round(Math.min(window.innerHeight * 0.3, 280)));
}

function readComposerMode(): ComposerMode {
	try {
		if (typeof window === 'undefined') {
			return 'agent';
		}
		const v = localStorage.getItem(COMPOSER_MODE_KEY);
		if (v === 'agent' || v === 'plan' || v === 'debug' || v === 'ask') {
			return v;
		}
	} catch {
		/* ignore */
	}
	return 'agent';
}

function writeComposerMode(m: ComposerMode) {
	try {
		localStorage.setItem(COMPOSER_MODE_KEY, m);
	} catch {
		/* ignore */
	}
}
const RESIZE_HANDLE_PX = 5;
const LEFT_RAIL_MIN = 200;
const LEFT_RAIL_MAX = 960;
const RIGHT_RAIL_MIN = 260;
const RIGHT_RAIL_MAX = 1280;
const CENTER_MIN_PX = 320;

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

function changeBadgeLabel(gitLabel: string, t: TFunction): string {
	switch (gitLabel) {
		case 'U':
			return t('git.badge.new');
		case 'M':
			return t('git.badge.modified');
		case 'A':
			return t('git.badge.added');
		case 'D':
			return t('git.badge.deleted');
		case 'R':
			return t('git.badge.renamed');
		case 'I':
			return t('git.badge.ignored');
		default:
			return gitLabel;
	}
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

function IconArrowUp({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
			<path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconStop({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<rect x="6" y="6" width="12" height="12" rx="2" />
		</svg>
	);
}

function IconExplorer({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path
				d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function IconCloudOutline({ className }: { className?: string }) {
	return (
		<svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" strokeLinejoin="round" />
		</svg>
	);
}

function IconServerOutline({ className }: { className?: string }) {
	return (
		<svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<rect x="2" y="3" width="20" height="7" rx="2" />
			<rect x="2" y="14" width="20" height="7" rx="2" />
			<circle cx="6" cy="6.5" r="1" fill="currentColor" />
			<circle cx="6" cy="17.5" r="1" fill="currentColor" />
		</svg>
	);
}

function IconGitSCM({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<circle cx="6" cy="6" r="2" />
			<circle cx="18" cy="18" r="2" />
			<circle cx="18" cy="6" r="2" />
			<path d="M6 8v4a2 2 0 0 0 2 2h8M16 8V6" />
		</svg>
	);
}

function useAsyncShell() {
	return window.asyncShell;
}

function IconSearch({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
		</svg>
	);
}

function IconRefresh({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" />
			<path d="M3 3v5h5" strokeLinecap="round" />
			<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" strokeLinecap="round" />
			<path d="M16 21h5v-5" strokeLinecap="round" />
		</svg>
	);
}

function IconDoc({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
		</svg>
	);
}

function IconChevron({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M6 9l6 6 6-6" strokeLinecap="round" />
		</svg>
	);
}

function IconMic({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" strokeLinejoin="round" />
			<path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3M8 22h8" strokeLinecap="round" />
		</svg>
	);
}

function IconPlus({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M12 5v14M5 12h14" strokeLinecap="round" />
		</svg>
	);
}

function IconCloseSmall({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
		</svg>
	);
}

function IconChipClear({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
			<path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
		</svg>
	);
}

function IconPencil({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconTrash({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconCheckCircle({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<circle cx="12" cy="12" r="9" />
			<path d="M8 12l2.5 2.5 5-5" />
		</svg>
	);
}

function IconSettings({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="3"></circle>
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
		</svg>
	);
}

function IconSidebarLeft({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
			<line x1="9" y1="3" x2="9" y2="21"></line>
		</svg>
	);
}

function IconSidebarRight({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
			<line x1="15" y1="3" x2="15" y2="21"></line>
		</svg>
	);
}

function IconHistory({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<path d="M3 4v4h4" />
			<path d="M12 7v5l3 2" />
		</svg>
	);
}

function IconDotsHorizontal({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<circle cx="5" cy="12" r="1.5" />
			<circle cx="12" cy="12" r="1.5" />
			<circle cx="19" cy="12" r="1.5" />
		</svg>
	);
}

function IconImageOutline({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
			<circle cx="8.5" cy="8.5" r="1.5" />
			<path d="M21 15l-5-5L5 21" />
		</svg>
	);
}

function normalizeThreadRow(t: ThreadInfo): ThreadInfo {
	return {
		...t,
		isToday: typeof t.isToday === 'boolean' ? t.isToday : true,
		isAwaitingReply: t.isAwaitingReply ?? false,
		hasAgentDiff: t.hasAgentDiff ?? false,
		additions: t.additions ?? 0,
		deletions: t.deletions ?? 0,
		filePaths: t.filePaths ?? [],
		fileCount: t.fileCount ?? 0,
		subtitleFallback: t.subtitleFallback ?? '',
		tokenUsage: t.tokenUsage,
		fileStateCount: t.fileStateCount ?? 0,
	};
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

export default function App() {
	const shell = useAsyncShell();
	const { t, setLocale, locale } = useI18n();
	const [ipcOk, setIpcOk] = useState<string>('…');
	const [workspace, setWorkspace] = useState<string | null>(null);
	const [workspaceFileList, setWorkspaceFileList] = useState<string[]>([]);
	const [threads, setThreads] = useState<ThreadInfo[]>([]);
	const [threadSearch, setThreadSearch] = useState('');
	const [currentId, setCurrentId] = useState<string | null>(null);
	const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
	const [editingThreadTitleDraft, setEditingThreadTitleDraft] = useState('');
	const threadTitleDraftRef = useRef('');
	const threadTitleInputRef = useRef<HTMLInputElement>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	/** `messages` 最近一次由 `threads:messages` 写入时对应的线程；与 `currentId` 不一致时不做文件条 persist 的读/清，避免切线程空窗期误删 localStorage */
	const [messagesThreadId, setMessagesThreadId] = useState<string | null>(null);
	const currentIdRef = useRef(currentId);
	currentIdRef.current = currentId;
	/** 点击某条用户消息后，从该条起截断并重发（与 threads:messages 顺序一致） */
	const [resendFromUserIndex, setResendFromUserIndex] = useState<number | null>(null);
	const [composerSegments, setComposerSegments] = useState<ComposerSegment[]>([]);
	/** 内联编辑已发送消息时专用，与底部输入框互不共享 */
	const [inlineResendSegments, setInlineResendSegments] = useState<ComposerSegment[]>([]);
	const resendIdxRef = useRef<number | null>(null);
	resendIdxRef.current = resendFromUserIndex;
	const [streaming, setStreaming] = useState('');
	const [awaitingReply, setAwaitingReply] = useState(false);
	const [thinkingTick, setThinkingTick] = useState(0);
	const [thoughtSecondsByThread, setThoughtSecondsByThread] = useState<Record<string, number>>({});
	const [gitBranch, setGitBranch] = useState('—');
	const [gitLines, setGitLines] = useState<string[]>([]);
	const [gitPathStatus, setGitPathStatus] = useState<GitPathStatusMap>({});
	const [gitChangedPaths, setGitChangedPaths] = useState<string[]>([]);
	/** `git:status` 成功（有仓库且本机可执行 git）；否则 Agent 改动条回退为对话解析统计 */
	const [gitStatusOk, setGitStatusOk] = useState(false);
	const [diffPreviews, setDiffPreviews] = useState<Record<string, DiffPreview>>({});
	const [diffLoading, setDiffLoading] = useState(false);
	const [gitActionError, setGitActionError] = useState<string | null>(null);
	/** 各线程待审阅的 Agent diff（确认后才写入工作区） */
	const [agentReviewPendingByThread, setAgentReviewPendingByThread] = useState<
		Record<string, AgentPendingPatch[]>
	>({});
	const [agentReviewBusy, setAgentReviewBusy] = useState(false);
	const [fileChangesDismissed, setFileChangesDismissed] = useState(false);
	const [dismissedFiles, setDismissedFiles] = useState<Set<string>>(new Set());
	const fileChangesDismissedRef = useRef(fileChangesDismissed);
	fileChangesDismissedRef.current = fileChangesDismissed;
	/** Plan 模式 — 结构化问题弹窗 */
	const [planQuestion, setPlanQuestion] = useState<PlanQuestion | null>(null);
	/** /create-skill 发送前：选择 Skill 适用范围 */
	const [skillScopePending, setSkillScopePending] = useState<{
		tailSegments: ComposerSegment[];
		targetThreadId: string;
	} | null>(null);
	/** Plan 模式 — 解析出的计划文档 */
	const [parsedPlan, setParsedPlan] = useState<ParsedPlan | null>(null);
	/** Plan 文件保存路径 */
	const [planFilePath, setPlanFilePath] = useState<string | null>(null);
	/** 上次 Build 时注入的计划内容 */
	const planBuildContentRef = useRef<string | null>(null);
	const [rightPanelTab, setRightPanelTab] = useState<'explorer' | 'search' | 'git'>('git');
	const [treeEpoch, setTreeEpoch] = useState(0);
	const [commitMsg, setCommitMsg] = useState('');
	const [workedSeconds, setWorkedSeconds] = useState<number | null>(null);
	const [lastTurnUsage, setLastTurnUsage] = useState<TurnTokenUsage | null>(null);
	const [settingsPageOpen, setSettingsPageOpen] = useState(false);
	const [settingsMountKey, setSettingsMountKey] = useState(0);
	const [settingsInitialNav, setSettingsInitialNav] = useState<SettingsNavId>('general');
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [plusMenuOpen, setPlusMenuOpen] = useState(false);
	const [composerMode, setComposerMode] = useState<ComposerMode>(() => readComposerMode());
	const [apiKey, setApiKey] = useState('');
	const [baseURL, setBaseURL] = useState('');
	const [proxyUrl, setProxyUrl] = useState('');
	const [anthropicApiKey, setAnthropicApiKey] = useState('');
	const [anthropicBaseURL, setAnthropicBaseURL] = useState('');
	const [geminiApiKey, setGeminiApiKey] = useState('');
	const [defaultModel, setDefaultModel] = useState(AUTO_MODEL_ID);
	const [thinkingByModelId, setThinkingByModelId] = useState<Record<string, ThinkingLevel>>({});
	const [streamingThinking, setStreamingThinking] = useState('');
	const [streamingToolPreview, setStreamingToolPreview] = useState<{
		name: string;
		partialJson: string;
		index: number;
	} | null>(null);
	const streamingToolPreviewClearTimerRef = useRef<number | null>(null);
	const [toolApprovalRequest, setToolApprovalRequest] = useState<{
		approvalId: string;
		toolName: string;
		command?: string;
		path?: string;
	} | null>(null);
	const [mistakeLimitRequest, setMistakeLimitRequest] = useState<{
		recoveryId: string;
		consecutiveFailures: number;
		threshold: number;
	} | null>(null);
	const [modelEntries, setModelEntries] = useState<UserModelEntry[]>([]);
	const [enabledModelIds, setEnabledModelIds] = useState<string[]>([]);
	const [agentCustomization, setAgentCustomization] = useState<AgentCustomization>(() => defaultAgentCustomization());
	/** 当前仓库 `.async/agent.json`（与全局 settings 分离） */
	const [projectAgentSlice, setProjectAgentSlice] = useState<ProjectAgentSliceState>(EMPTY_PROJECT_AGENT);

	const mergedAgentCustomization = useMemo((): AgentCustomization => {
		return {
			...agentCustomization,
			rules: [...(agentCustomization.rules ?? []), ...projectAgentSlice.rules],
			skills: [...(agentCustomization.skills ?? []), ...projectAgentSlice.skills],
			subagents: [...(agentCustomization.subagents ?? []), ...projectAgentSlice.subagents],
		};
	}, [agentCustomization, projectAgentSlice]);

	const onChangeMergedAgentCustomization = useCallback(
		(next: AgentCustomization) => {
			const ur = next.rules?.filter((r) => (r.origin ?? 'user') !== 'project') ?? [];
			const pr = next.rules?.filter((r) => r.origin === 'project') ?? [];
			const us = next.skills?.filter((s) => (s.origin ?? 'user') !== 'project') ?? [];
			const ps = next.skills?.filter((s) => s.origin === 'project') ?? [];
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

	const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => defaultEditorSettings());
	const [indexingSettings, setIndexingSettings] = useState<IndexingSettingsState>(() => normalizeIndexingSettings());
	const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
	const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
	const [layoutMode, setLayoutMode] = useState<LayoutMode>('editor');
	const [homeRecents, setHomeRecents] = useState<string[]>([]);
	/** 文件菜单「打开最近的文件夹」：与是否打开工作区无关 */
	const [folderRecents, setFolderRecents] = useState<string[]>([]);
	const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const [filePath, setFilePath] = useState('');
	const [editorValue, setEditorValue] = useState('');
	const [saveToastKey, setSaveToastKey] = useState(0);
	const [saveToastVisible, setSaveToastVisible] = useState(false);
	const monacoEditorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
	const [tsLspStatus, setTsLspStatus] = useState<'off' | 'starting' | 'ready' | 'error'>('off');
	/** 打开文件后在 Monaco 中高亮的行范围（1-based，含 end） */
	const pendingEditorHighlightRangeRef = useRef<{ start: number; end: number } | null>(null);
	const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const [quickOpenOpen, setQuickOpenOpen] = useState(false);
	const [quickOpenSeed, setQuickOpenSeed] = useState('');
	const [sidebarSearchDraft, setSidebarSearchDraft] = useState('');
	const [editorTerminalVisible, setEditorTerminalVisible] = useState(true);
	const [editorTerminalHeightPx, setEditorTerminalHeightPx] = useState(() => readEditorTerminalHeightPx());
	const [editorTerminalSessions, setEditorTerminalSessions] = useState<EditorPtySession[]>([]);
	const [activeEditorTerminalId, setActiveEditorTerminalId] = useState<string | null>(null);
	const editorTerminalCreateLockRef = useRef(false);
	const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
	const terminalMenuRef = useRef<HTMLDivElement>(null);
	const [fileMenuOpen, setFileMenuOpen] = useState(false);
	const fileMenuRef = useRef<HTMLDivElement>(null);
	const [editorThreadHistoryOpen, setEditorThreadHistoryOpen] = useState(false);
	const [editorChatMoreOpen, setEditorChatMoreOpen] = useState(false);
	const editorHistoryMenuRef = useRef<HTMLDivElement>(null);
	const editorMoreMenuRef = useRef<HTMLDivElement>(null);
	const [homePath, setHomePath] = useState('');
	const [railWidths, setRailWidths] = useState(() => {
		const s = readSidebarLayout();
		return clampSidebarLayout(s.left, s.right);
	});
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
	/** 合并粘底滚动到每帧一次，避免 useLayoutEffect + ResizeObserver 与 sticky 用户条叠加导致上下抖动 */
	const messagesScrollToBottomRafRef = useRef<number | null>(null);
	const prevMessagesLenForScrollRef = useRef(0);
	const closeAtMenuLatestRef = useRef<() => void>(() => {});
	const plusAnchorHeroRef = useRef<HTMLDivElement>(null);
	const plusAnchorBottomRef = useRef<HTMLDivElement>(null);
	const plusAnchorInlineRef = useRef<HTMLDivElement>(null);
	const modelPillHeroRef = useRef<HTMLDivElement>(null);
	const modelPillBottomRef = useRef<HTMLDivElement>(null);
	const modelPillInlineRef = useRef<HTMLDivElement>(null);
	type ComposerAnchorSlot = 'hero' | 'bottom' | 'inline';
	const [plusMenuAnchorSlot, setPlusMenuAnchorSlot] = useState<ComposerAnchorSlot>('bottom');
	const [modelPickerAnchorSlot, setModelPickerAnchorSlot] = useState<ComposerAnchorSlot>('bottom');

	const clearStreamingToolPreviewNow = useCallback(() => {
		if (streamingToolPreviewClearTimerRef.current !== null) {
			window.clearTimeout(streamingToolPreviewClearTimerRef.current);
			streamingToolPreviewClearTimerRef.current = null;
		}
		setStreamingToolPreview(null);
	}, []);

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

	const setComposerModePersist = useCallback((m: ComposerMode) => {
		setComposerMode(m);
		writeComposerMode(m);
	}, []);

	const openSettingsPage = (nav: SettingsNavId) => {
		setModelPickerOpen(false);
		setPlusMenuOpen(false);
		setSettingsMountKey((k) => k + 1);
		setSettingsInitialNav(nav);
		setSettingsPageOpen(true);
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

	const { todayThreads, archivedThreads } = useMemo(() => {
		const q = threadSearch.trim().toLowerCase();
		const list = q
			? threads.filter(
					(t) =>
						t.title.toLowerCase().includes(q) ||
						(t.subtitleFallback ?? '').toLowerCase().includes(q)
				)
			: threads;
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
	}, [threads, threadSearch]);

	const threadsChrono = useMemo(
		() =>
			[...threads].sort(
				(a, b) => b.updatedAt - a.updatedAt || (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.title.localeCompare(b.title)
			),
		[threads]
	);

	const hasConversation = messages.length > 0 || !!streaming;
	const changeCount = gitChangedPaths.length;
	const gitPathsKey = useMemo(() => gitChangedPaths.join('\n'), [gitChangedPaths]);

	const canSendComposer = useMemo(() => !segmentsTrimmedEmpty(composerSegments), [composerSegments]);
	const canSendInlineResend = useMemo(
		() => !segmentsTrimmedEmpty(inlineResendSegments),
		[inlineResendSegments]
	);

	const currentThreadTitle = useMemo(() => {
		const t = threads.find((x) => x.id === currentId);
		return t?.title ?? workspaceBasename;
	}, [threads, currentId, workspaceBasename]);

	const pendingAgentPatches = useMemo(
		() => (currentId ? agentReviewPendingByThread[currentId] ?? [] : []),
		[currentId, agentReviewPendingByThread]
	);

	const diffTotals = useMemo(() => {
		let additions = 0;
		let deletions = 0;
		for (const p of gitChangedPaths) {
			const pr = diffPreviews[p];
			if (pr) {
				additions += pr.additions;
				deletions += pr.deletions;
			}
		}
		return { additions, deletions };
	}, [gitChangedPaths, diffPreviews]);

	const refreshThreads = useCallback(async () => {
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('threads:list')) as {
			threads: ThreadInfo[];
			currentId: string | null;
		};
		setThreads((r.threads ?? []).map(normalizeThreadRow));
		setCurrentId(r.currentId);
	}, [shell]);

	const loadMessages = useCallback(
		async (id: string) => {
			if (!shell) {
				return;
			}
			const r = (await shell.invoke('threads:messages', id)) as {
				ok: boolean;
				messages?: ChatMessage[];
			};
			if (r.ok && r.messages) {
				if (currentIdRef.current !== id) {
					return;
				}
				setMessages(r.messages);
				setMessagesThreadId(id);
			}
		},
		[shell]
	);

	const refreshGit = useCallback(async () => {
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('git:status')) as
			| { ok: true; branch: string; lines: string[]; pathStatus?: GitPathStatusMap; changedPaths?: string[] }
			| { ok: false; error?: string };
		if (r.ok) {
			setGitStatusOk(true);
			setGitBranch(r.branch || 'master');
			setGitLines(r.lines);
			setGitPathStatus(r.pathStatus ?? {});
			setGitChangedPaths(r.changedPaths ?? []);
		} else {
			setGitStatusOk(false);
			setGitBranch('—');
			setGitLines([r.error ?? 'Failed to load changes']);
			setGitPathStatus({});
			setGitChangedPaths([]);
		}
		setTreeEpoch((n) => n + 1);
	}, [shell]);

	const clearAgentReviewForThread = useCallback((threadId: string) => {
		setAgentReviewPendingByThread((prev) => {
			const next = { ...prev };
			delete next[threadId];
			return next;
		});
	}, []);

	const executeSkillCreatorSend = useCallback(
		async (scope: 'user' | 'project', pending: { tailSegments: ComposerSegment[]; targetThreadId: string }) => {
			if (!shell) {
				return;
			}
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
			setWorkedSeconds(null);
			firstTokenAtRef.current = null;
			streamStartedAtRef.current = Date.now();
			streamThreadRef.current = targetThreadId;
			setAwaitingReply(true);
			setMessages((m) => [...m, { role: 'user', content: visible }]);

			const r = (await shell.invoke('chat:send', {
				threadId: targetThreadId,
				text: '',
				mode: composerMode,
				modelId: defaultModel,
				skillCreator: { userNote: tailWire, scope },
			})) as { ok?: boolean; error?: string };

			if (!r?.ok) {
				setAwaitingReply(false);
				streamStartedAtRef.current = null;
				void loadMessages(targetThreadId);
				if (r?.error === 'no-workspace') {
					window.alert(t('skillCreator.sendErrorNoWs'));
				}
				return;
			}
			void refreshThreads();
		},
		[
			shell,
			currentId,
			composerMode,
			defaultModel,
			t,
			loadMessages,
			clearAgentReviewForThread,
			clearStreamingToolPreviewNow,
			refreshThreads,
		]
	);

	const onDiscardAgentReview = useCallback(() => {
		if (currentId) {
			clearAgentReviewForThread(currentId);
		}
	}, [currentId, clearAgentReviewForThread]);

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
				const p = (await shell.invoke('async-shell:ping')) as { ok: boolean; message: string };
				setIpcOk(p.ok ? t('app.ipcReady', { message: p.message }) : t('app.ipcError'));
				const w = (await shell.invoke('workspace:get')) as { root: string | null };
				setWorkspace(w.root);
				const paths = (await shell.invoke('app:getPaths')) as { home?: string };
				if (paths.home) {
					setHomePath(paths.home);
				}
				await refreshThreads();
				const st = (await shell.invoke('settings:get')) as {
					language?: string;
					openAI?: { apiKey?: string; baseURL?: string; proxyUrl?: string };
					anthropic?: { apiKey?: string; baseURL?: string };
					gemini?: { apiKey?: string };
					defaultModel?: string;
					models?: {
						entries?: UserModelEntry[];
						enabledIds?: string[];
						thinkingByModelId?: Record<string, unknown>;
					};
					agent?: AgentCustomization;
					editor?: Partial<EditorSettings>;
					ui?: { sidebarLayout?: { left?: unknown; right?: unknown } };
					indexing?: {
						symbolIndexEnabled?: boolean;
						semanticIndexEnabled?: boolean;
						tsLspEnabled?: boolean;
					};
				};
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
				setApiKey(st.openAI?.apiKey ?? '');
				setBaseURL(st.openAI?.baseURL ?? '');
				setProxyUrl(st.openAI?.proxyUrl ?? '');
				setAnthropicApiKey(st.anthropic?.apiKey ?? '');
				setAnthropicBaseURL(st.anthropic?.baseURL ?? '');
				setGeminiApiKey(st.gemini?.apiKey ?? '');
				const rawEntries = Array.isArray(st.models?.entries) ? st.models!.entries! : [];
				setModelEntries(rawEntries);
				const saneEnabled = sanitizeEnabledIds(rawEntries, st.models?.enabledIds);
				setEnabledModelIds(saneEnabled);
				setDefaultModel(coerceDefaultModel(st.defaultModel, rawEntries, saneEnabled));
				setThinkingByModelId(coerceThinkingByModelId(st.models?.thinkingByModelId));
				const ag = st.agent;
				const defs = defaultAgentCustomization();
				setAgentCustomization({
					...defs,
					...(ag ?? {}),
					importThirdPartyConfigs: ag?.importThirdPartyConfigs ?? false,
					rules: Array.isArray(ag?.rules) ? ag.rules : [],
					skills: Array.isArray(ag?.skills) ? ag.skills : [],
					subagents: Array.isArray(ag?.subagents) ? ag.subagents : [],
					commands: Array.isArray(ag?.commands) ? ag.commands : [],
					confirmShellCommands: ag?.confirmShellCommands ?? defs.confirmShellCommands,
					skipSafeShellCommandsConfirm: ag?.skipSafeShellCommandsConfirm ?? defs.skipSafeShellCommandsConfirm,
					confirmWritesBeforeExecute: ag?.confirmWritesBeforeExecute ?? defs.confirmWritesBeforeExecute,
					maxConsecutiveMistakes: ag?.maxConsecutiveMistakes ?? defs.maxConsecutiveMistakes,
					mistakeLimitEnabled: ag?.mistakeLimitEnabled ?? defs.mistakeLimitEnabled,
				});
				if (st.editor) {
					setEditorSettings({ ...defaultEditorSettings(), ...st.editor });
				}
				setIndexingSettings(normalizeIndexingSettings(st.indexing));
				// Load MCP servers
				const mcpSt = (await shell.invoke('mcp:getServers')) as { servers?: McpServerConfig[] } | undefined;
				setMcpServers(mcpSt?.servers ?? []);
				const mcpStatusRes = (await shell.invoke('mcp:getStatuses')) as { statuses?: McpServerStatus[] } | undefined;
				setMcpStatuses(mcpStatusRes?.statuses ?? []);
				await refreshGit();
			} catch (e) {
				setIpcOk(String(e));
			}
		})();
	}, [shell, refreshThreads, refreshGit, t, setLocale]);

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
			if (payload.type === 'delta') {
				setStreaming((s) => {
					if (s.length === 0 && payload.text.length > 0) {
						firstTokenAtRef.current = Date.now();
					}
					return s + payload.text;
				});
			} else if (payload.type === 'tool_input_delta') {
				if (streamingToolPreviewClearTimerRef.current !== null) {
					window.clearTimeout(streamingToolPreviewClearTimerRef.current);
					streamingToolPreviewClearTimerRef.current = null;
				}
				console.log(`[UI] tool_input_delta: name=${payload.name}, jsonLen=${payload.partialJson.length}`);
				setStreamingToolPreview({
					name: payload.name,
					partialJson: payload.partialJson,
					index: payload.index,
				});
			} else if (payload.type === 'thinking_delta') {
				setStreamingThinking((s) => s + payload.text);
			} else if (payload.type === 'tool_call') {
				if (streamingToolPreviewClearTimerRef.current !== null) {
					window.clearTimeout(streamingToolPreviewClearTimerRef.current);
					streamingToolPreviewClearTimerRef.current = null;
				}
				console.log(`[UI] tool_call: name=${payload.name}`);
				setStreamingToolPreview(null);
				const marker = `\n<tool_call tool="${payload.name}">${payload.args}</tool_call>\n`;
				setStreaming((s) => s + marker);
			} else if (payload.type === 'tool_result') {
				setStreamingToolPreview(null);
				const truncated = payload.result.length > 3000 ? payload.result.slice(0, 3000) + '\n... (truncated)' : payload.result;
				const safe = truncated.split('</tool_result>').join('</tool\u200c_result>');
				const marker = `<tool_result tool="${payload.name}" success="${payload.success}">${safe}</tool_result>\n`;
				setStreaming((s) => s + marker);
			} else if (payload.type === 'tool_approval_request') {
				setToolApprovalRequest({
					approvalId: payload.approvalId,
					toolName: payload.toolName,
					command: payload.command,
					path: payload.path,
				});
			} else if (payload.type === 'agent_mistake_limit') {
				setMistakeLimitRequest({
					recoveryId: payload.recoveryId,
					consecutiveFailures: payload.consecutiveFailures,
					threshold: payload.threshold,
				});
			} else if (payload.type === 'done') {
				const start = streamStartedAtRef.current;
				const ft = firstTokenAtRef.current;
				const end = Date.now();
				if (start !== null) {
					setWorkedSeconds(Math.max(1, Math.round((end - start) / 1000)));
				}
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
				clearStreamingToolPreviewNow();
				setFileChangesDismissed(false);
				setDismissedFiles(new Set());
				/* 新一轮助手回复落库前，勿让旧 persist 在 loadMessages 空窗期把面板状态粘回去 */
				clearPersistedAgentFileChanges(payload.threadId);
				if (payload.pendingAgentPatches && payload.pendingAgentPatches.length > 0) {
					setAgentReviewPendingByThread((prev) => ({
						...prev,
						[payload.threadId]: payload.pendingAgentPatches!,
					}));
				}

				const fullText = payload.text ?? '';
				const q = parseQuestions(fullText);
				if (q) {
					setPlanQuestion(q);
				} else {
					setPlanQuestion(null);
				}

				const plan = parsePlanDocument(fullText);
				if (plan) {
					setParsedPlan(plan);
					const filename = generatePlanFilename(plan.name);
					const md = toPlanMd(plan);
					if (shell) {
						void (async () => {
							const r = (await shell.invoke('plan:save', { filename, content: md })) as
								| { ok: true; path: string }
								| { ok: false };
							if (r.ok) {
								setPlanFilePath(r.path);
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
				if (start !== null) {
					setWorkedSeconds(Math.max(1, Math.round((end - start) / 1000)));
				}
				const thinkSec =
					start !== null && firstTokenAtRef.current !== null
						? Math.max(0.1, (firstTokenAtRef.current - start) / 1000)
						: start !== null
							? Math.max(0.1, (end - start) / 1000)
							: 0.3;
				setThoughtSecondsByThread((prev) => ({ ...prev, [payload.threadId]: thinkSec }));
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
				setAwaitingReply(false);
				setStreaming('');
				setStreamingThinking('');
				setToolApprovalRequest(null);
				setMistakeLimitRequest(null);
				clearStreamingToolPreviewNow();
				setMessages((m) => [
					...m,
					{ role: 'assistant', content: t('app.errorPrefix', { message: translateChatError(payload.message, t) }) },
				]);
				void refreshThreads();
			}
		});
		return () => unsub();
	}, [shell, loadMessages, refreshThreads, clearStreamingToolPreviewNow, t]);

	useEffect(() => {
		if (!workspace || !shell) {
			return;
		}
		void refreshGit();
	}, [workspace, shell, refreshGit]);

	useEffect(() => {
		if (!shell || !workspace) {
			setWorkspaceFileList([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			const r = (await shell.invoke('workspace:listFiles')) as
				| { ok: true; paths: string[] }
				| { ok: false; error?: string };
			if (cancelled) {
				return;
			}
			if (r.ok && Array.isArray(r.paths)) {
				setWorkspaceFileList(r.paths);
			} else {
				setWorkspaceFileList([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace]);

	useEffect(() => {
		monacoWorkspaceRootRef.current = workspace;
	}, [workspace]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		if (!workspace) {
			setTsLspStatus('off');
			void shell.invoke('lsp:ts:stop').catch(() => {});
			return;
		}
		if (!indexingSettings.tsLspEnabled) {
			setTsLspStatus('off');
			void shell.invoke('lsp:ts:stop').catch(() => {});
			return;
		}
		let cancelled = false;
		setTsLspStatus('starting');
		void shell.invoke('lsp:ts:start', workspace).then((r: unknown) => {
			if (cancelled) {
				return;
			}
			const ok = (r as { ok?: boolean })?.ok;
			setTsLspStatus(ok ? 'ready' : 'error');
		});
		return () => {
			cancelled = true;
		};
	}, [shell, workspace, indexingSettings.tsLspEnabled]);

	useEffect(() => {
		if (!shell || workspace) {
			setHomeRecents([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const r = (await shell.invoke('workspace:listRecents')) as { paths?: string[] };
				if (!cancelled) {
					setHomeRecents(Array.isArray(r.paths) ? r.paths : []);
				}
			} catch {
				if (!cancelled) {
					setHomeRecents([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace]);

	useEffect(() => {
		if (!shell) {
			setFolderRecents([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const r = (await shell.invoke('workspace:listRecents')) as { paths?: string[] };
				if (!cancelled) {
					setFolderRecents(Array.isArray(r.paths) ? r.paths.slice(0, 14) : []);
				}
			} catch {
				if (!cancelled) {
					setFolderRecents([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace]);

	useEffect(() => {
		if (!shell || gitChangedPaths.length === 0) {
			setDiffPreviews({});
			setDiffLoading(false);
			return;
		}
		setDiffLoading(true);
		let cancelled = false;
		void (async () => {
			const r = (await shell.invoke('git:diffPreviews', gitChangedPaths)) as
				| { ok: true; previews: Record<string, DiffPreview> }
				| { ok: false };
			if (!cancelled && r.ok) {
				setDiffPreviews(r.previews);
			}
			if (!cancelled) {
				setDiffLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, treeEpoch, gitPathsKey]);

	const applyWorkspacePath = useCallback(
		async (next: string) => {
			setWorkspace(next);
			setRightPanelTab('explorer');
			await refreshGit();
		},
		[refreshGit]
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

	const onNewThread = async () => {
		if (!shell) {
			return;
		}
		const r = (await shell.invoke('threads:create')) as { id: string };
		await refreshThreads();
		setCurrentId(r.id);
		setWorkedSeconds(null);
		setLastTurnUsage(null);
		setAwaitingReply(false);
		setStreaming('');
		setStreamingThinking('');
		clearStreamingToolPreviewNow();
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		await loadMessages(r.id);
		setComposerSegments([]);
		setInlineResendSegments([]);
		setResendFromUserIndex(null);
		composerRichHeroRef.current?.focus();
	};

	onNewThreadRef.current = onNewThread;

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
		setWorkedSeconds(null);
		setAwaitingReply(false);
		setStreaming('');
		setStreamingThinking('');
		clearStreamingToolPreviewNow();
		streamStartedAtRef.current = null;
		firstTokenAtRef.current = null;
		setResendFromUserIndex(null);
		setComposerSegments([]);
		setInlineResendSegments([]);
		await loadMessages(id);
	};

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
				streamStartedAtRef.current = null;
				firstTokenAtRef.current = null;
			}
			setEditingThreadId((ed) => (ed === id ? null : ed));
			if (wasCurrent) {
				setMessages([]);
				setMessagesThreadId(null);
				setStreaming('');
				setComposerSegments([]);
				setInlineResendSegments([]);
				setResendFromUserIndex(null);
			}
			await shell.invoke('threads:delete', id);
			clearPersistedAgentFileChanges(id);
			await refreshThreads();
		},
		[shell, currentId, awaitingReply, refreshThreads, clearStreamingToolPreviewNow]
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

	const onSend = async (textOverride?: string, opts?: { threadId?: string }) => {
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

		if (
			resendIdx === null &&
			(typeof textOverride !== 'string' || textOverride.trim().length === 0) &&
			isCreateSkillComposerTurn(composerSegments)
		) {
			if (segmentsTrimmedEmpty(composerSegments)) {
				return;
			}
			setSkillScopePending({
				targetThreadId,
				tailSegments: composerSegments.slice(1),
			});
			return;
		}

		if (!text) {
			return;
		}
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
		setWorkedSeconds(null);
		firstTokenAtRef.current = null;
		streamStartedAtRef.current = Date.now();
		streamThreadRef.current = targetThreadId;
		setAwaitingReply(true);

		if (resendIdx !== null) {
			setResendFromUserIndex(null);
			const r = (await shell.invoke('chat:editResend', {
				threadId: targetThreadId,
				visibleIndex: resendIdx,
				text,
				mode: composerMode,
				modelId: defaultModel,
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
			mode: composerMode,
			modelId: defaultModel,
		});
		void refreshThreads();
	};

	const onAbort = async () => {
		if (!shell || !currentId) {
			return;
		}
		setMistakeLimitRequest(null);
		await shell.invoke('chat:abort', currentId);
		// Let the 'done' event from backend finalize the state
		clearStreamingToolPreviewNow();
		setAwaitingReply(false);
	};

	const onPlanQuestionSubmit = (answer: string) => {
		setPlanQuestion(null);
		const reply = `我选择：${answer}`;
		void onSend(reply);
	};

	const onPlanQuestionSkip = useCallback(() => {
		setPlanQuestion(null);
	}, []);

	const onPlanTodoToggle = useCallback(
		(id: string) => {
			setParsedPlan((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					todos: prev.todos.map((t) =>
						t.id === id
							? { ...t, status: t.status === 'completed' ? 'pending' as const : 'completed' as const }
							: t
					),
				};
			});
		},
		[]
	);

	const onPlanBuild = useCallback(() => {
		if (!parsedPlan) return;
		planBuildContentRef.current = parsedPlan.body;

		// 构建结构化步骤注入文本
		const stepLines = parsedPlan.todos.length > 0
			? parsedPlan.todos.map((s, i) => `${i + 1}. ${s.content}`).join('\n')
			: '';
		const structuredContext = stepLines
			? `\n\n[Structured Plan — execute these steps in order]\n${stepLines}`
			: '';

		setParsedPlan(null);
		setPlanQuestion(null);
		setComposerModePersist('agent');
		const buildPrompt = `请根据以下计划执行所有步骤，逐个修改文件：\n\n${parsedPlan.body}${structuredContext}`;
		setComposerSegments(userMessageToSegments(buildPrompt, workspaceFileList));
		setTimeout(() => {
			const ref = hasConversation ? composerRichBottomRef.current : composerRichHeroRef.current;
			ref?.focus();
		}, 50);
	}, [parsedPlan, workspaceFileList, hasConversation, setComposerModePersist]);

	const onPlanReviewClose = useCallback(() => {
		setParsedPlan(null);
	}, []);

	const onPersistLanguage = useCallback(
		async (loc: AppLocale) => {
			if (!shell) {
				return;
			}
			await shell.invoke('settings:set', { language: loc });
		},
		[shell]
	);

	const persistSettings = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('settings:set', {
			language: locale,
			openAI: {
				apiKey,
				baseURL: baseURL || undefined,
				proxyUrl: proxyUrl.trim() || undefined,
			},
			anthropic: {
				apiKey: anthropicApiKey || undefined,
				baseURL: anthropicBaseURL.trim() || undefined,
			},
			gemini: {
				apiKey: geminiApiKey || undefined,
			},
			defaultModel,
			models: { entries: modelEntries, enabledIds: enabledModelIds, thinkingByModelId },
			agent: {
				importThirdPartyConfigs: agentCustomization.importThirdPartyConfigs ?? false,
				rules: agentCustomization.rules ?? [],
				skills: agentCustomization.skills ?? [],
				subagents: agentCustomization.subagents ?? [],
				commands: agentCustomization.commands ?? [],
				confirmShellCommands: agentCustomization.confirmShellCommands,
				skipSafeShellCommandsConfirm: agentCustomization.skipSafeShellCommandsConfirm,
				confirmWritesBeforeExecute: agentCustomization.confirmWritesBeforeExecute,
				maxConsecutiveMistakes: agentCustomization.maxConsecutiveMistakes,
				mistakeLimitEnabled: agentCustomization.mistakeLimitEnabled,
			},
			editor: editorSettings,
			indexing: {
				symbolIndexEnabled: indexingSettings.symbolIndexEnabled,
				semanticIndexEnabled: indexingSettings.semanticIndexEnabled,
				tsLspEnabled: indexingSettings.tsLspEnabled,
			},
			mcp: { servers: mcpServers },
		});
	}, [
		shell,
		apiKey,
		baseURL,
		proxyUrl,
		anthropicApiKey,
		anthropicBaseURL,
		geminiApiKey,
		defaultModel,
		modelEntries,
		enabledModelIds,
		thinkingByModelId,
		agentCustomization,
		editorSettings,
		indexingSettings,
		locale,
		mcpServers,
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
		setWorkedSeconds(null);
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
		composerRichHeroRef.current?.focus();
	}, [closeSettingsPage, shell, t, refreshThreads, loadMessages, clearStreamingToolPreviewNow]);

	const onToggleModelEnabled = useCallback(
		async (id: string, enabled: boolean) => {
			const nextSet = new Set(enabledModelIds);
			if (enabled) {
				nextSet.add(id);
			} else {
				nextSet.delete(id);
			}
			const arr = Array.from(nextSet);
			setEnabledModelIds(arr);
			if (shell) {
				await shell.invoke('settings:set', { models: { entries: modelEntries, enabledIds: arr } });
			}
		},
		[shell, enabledModelIds, modelEntries]
	);

	const onChangeModelEntries = useCallback((entries: UserModelEntry[]) => {
		setModelEntries(entries);
		setEnabledModelIds((prev) => sanitizeEnabledIds(entries, prev));
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
		const auto: ModelPickerItem = {
			id: AUTO_MODEL_ID,
			label: t('modelPicker.auto'),
			description: t('modelPicker.autoDesc'),
		};
		const enabledSet = new Set(enabledModelIds);
		const fromUser = modelEntries
			.filter((e) => enabledSet.has(e.id) && (e.displayName.trim() || e.requestName.trim()))
			.map((e) => ({
				id: e.id,
				label: e.displayName.trim() || e.requestName,
				description: `${t(`settings.paradigm.${e.paradigm}`)} · ${e.requestName || t('modelPicker.requestNameMissing')}`,
			}));
		return [auto, ...fromUser];
	}, [enabledModelIds, modelEntries, t]);

	const modelPillLabel = useMemo(() => {
		if (defaultModel === AUTO_MODEL_ID) {
			return t('modelPicker.auto');
		}
		const e = modelEntries.find((x) => x.id === defaultModel);
		return e ? e.displayName.trim() || e.requestName || defaultModel : defaultModel;
	}, [defaultModel, modelEntries, t]);

	const onLoadFile = async () => {
		if (!shell || !filePath.trim()) {
			return;
		}
		try {
			const r = (await shell.invoke('fs:readFile', filePath.trim())) as { ok: boolean; content?: string };
			if (r.ok && r.content !== undefined) {
				setEditorValue(r.content);
			}
		} catch (e) {
			setEditorValue(t('app.readFileFailed', { detail: String(e) }));
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
	};

	/** Open a file in the tab bar (or activate existing tab) and load it into the editor */
	const openFileInTab = useCallback(async (rel: string, revealLine?: number, revealEndLine?: number) => {
		if (!shell) return;
		const tid = tabIdFromPath(rel);
		// Check if tab already open
		const existing = openTabs.find((t2) => t2.id === tid);
		if (!existing) {
			setOpenTabs((prev) => [...prev, { id: tid, filePath: rel, dirty: false }]);
		}
		setActiveTabId(tid);
		// Also set legacy filePath
		setFilePath(rel);
		setRightPanelTab('explorer');
		// Handle highlight range
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
			const r = (await shell.invoke('fs:readFile', rel)) as { ok: boolean; content?: string };
			if (r.ok && r.content !== undefined) {
				setEditorValue(r.content);
			}
		} catch (err) {
			setEditorValue(t('app.readFileFailed', { detail: String(err) }));
		}
	}, [shell, openTabs, t]);

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

			if (tabId !== activeTabId) {
				return;
			}
			const newActive = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
			setActiveTabId(newActive?.id ?? null);
			if (newActive) {
				setFilePath(newActive.filePath);
				if (shell) {
					void (async () => {
						try {
							const r = (await shell.invoke('fs:readFile', newActive.filePath)) as { ok: boolean; content?: string };
							if (r.ok && r.content !== undefined) {
								setEditorValue(r.content);
							}
						} catch {
							/* ignore */
						}
					})();
				}
			} else {
				setFilePath('');
				setEditorValue('');
			}
		},
		[openTabs, activeTabId, shell]
	);

	const onSelectTab = useCallback(async (tabId: string) => {
		setActiveTabId(tabId);
		const tab = openTabs.find((t2) => t2.id === tabId);
		if (tab && shell) {
			setFilePath(tab.filePath);
			pendingEditorHighlightRangeRef.current = null;
			try {
				const r = (await shell.invoke('fs:readFile', tab.filePath)) as { ok: boolean; content?: string };
				if (r.ok && r.content !== undefined) setEditorValue(r.content);
			} catch { /* ignore */ }
		}
	}, [openTabs, shell]);

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

	const onExplorerOpenFile = async (rel: string, revealLine?: number, revealEndLine?: number) => {
		await openFileInTab(rel, revealLine, revealEndLine);
	};

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

	const onMonacoMount = useCallback(
		(ed: MonacoEditorNS.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
			monacoEditorRef.current = ed;
			if (shell) {
				registerTsLspMonacoOnce(monaco, shell, workspace);
			}
		},
		[shell, workspace]
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
		setLayoutMode('agent');
		setRightPanelTab('search');
	}, []);

	const appendEditorTerminal = useCallback(async () => {
		if (editorTerminalCreateLockRef.current || !shell) {
			return;
		}
		editorTerminalCreateLockRef.current = true;
		try {
			const r = (await shell.invoke('terminal:ptyCreate')) as {
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
		closeEditorTerminalPanel();
		setWorkspace(null);
		setOpenTabs([]);
		setActiveTabId(null);
		setFilePath('');
		setEditorValue('');
		pendingEditorHighlightRangeRef.current = null;
		await refreshGit();
	}, [shell, closeEditorTerminalPanel, refreshGit]);

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
		setOpenTabs((prev) => {
			const idx = activeTabId
				? prev.findIndex((t2) => t2.id === activeTabId)
				: filePath.trim()
					? prev.findIndex((t2) => t2.filePath === filePath.trim())
					: -1;
			if (idx >= 0) {
				const next = [...prev];
				next[idx] = { id: newTid, filePath: savedRel, dirty: false };
				return next;
			}
			return [...prev, { id: newTid, filePath: savedRel, dirty: false }];
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
		{ t }
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

	const editorFileBasename = useMemo(() => {
		const p = filePath.trim();
		if (!p) {
			return '';
		}
		const i = p.replace(/\\/g, '/').lastIndexOf('/');
		return i >= 0 ? p.slice(i + 1) : p;
	}, [filePath]);

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
		const segs = segmentAssistantContent(lastAssistant.content, { t });
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
			return;
		}
		if (messagesThreadId !== currentId) {
			/* 切线程后、loadMessages 完成前：勿用旧线程的 messages 去对本线程的 persist 做哈希比对 */
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			return;
		}
		const last = [...messages].reverse().find((m) => m.role === 'assistant');
		const content = last?.content ?? '';
		if (!content.trim()) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			return;
		}
		const hash = hashAgentAssistantContent(content);
		const stored = readPersistedAgentFileChanges(currentId);
		if (!stored) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			return;
		}
		if (stored.contentHash !== hash) {
			setFileChangesDismissed(false);
			setDismissedFiles(new Set());
			clearPersistedAgentFileChanges(currentId);
			return;
		}
		setFileChangesDismissed(stored.fileChangesDismissed);
		setDismissedFiles(new Set(stored.dismissedPaths));
	}, [currentId, messages, messagesThreadId]);

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
		writePersistedAgentFileChanges(currentId, last?.content ?? '', true, new Set());
	}, [shell, currentId]);

	const onRevertAllEdits = useCallback(async () => {
		if (!shell || composerMode !== 'agent' || !currentId) return;
		try {
			const result = (await shell.invoke('agent:revertLastTurn', currentId)) as { ok?: boolean; reverted?: number };
			if ((result.reverted ?? 0) > 0) {
				void refreshGit();
			}
		} catch {
			/* IPC error — still dismiss panel to unblock the user */
		}
		setDismissedFiles(new Set());
		setFileChangesDismissed(true);
		const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
		writePersistedAgentFileChanges(currentId, last?.content ?? '', true, new Set());
	}, [shell, composerMode, currentId, refreshGit]);

	const onKeepFileEdit = useCallback(async (relPath: string) => {
		if (!shell || !currentId) return;
		try {
			await shell.invoke('agent:keepFile', currentId, relPath);
		} catch { /* ignore */ }
		setDismissedFiles((prev) => {
			const next = new Set(prev).add(relPath);
			const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
			writePersistedAgentFileChanges(
				currentId,
				last?.content ?? '',
				fileChangesDismissedRef.current,
				next
			);
			return next;
		});
	}, [shell, currentId]);

	const onRevertFileEdit = useCallback(async (relPath: string) => {
		if (!shell || !currentId) return;
		try {
			await shell.invoke('agent:revertFile', currentId, relPath);
			void refreshGit();
		} catch { /* ignore */ }
		setDismissedFiles((prev) => {
			const next = new Set(prev).add(relPath);
			const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
			writePersistedAgentFileChanges(
				currentId,
				last?.content ?? '',
				fileChangesDismissedRef.current,
				next
			);
			return next;
		});
	}, [shell, currentId, refreshGit]);

	const onMessagesScroll = useCallback(() => {
		const el = messagesViewportRef.current;
		if (!el) {
			return;
		}
		const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
		pinMessagesToBottomRef.current = dist < 120;
	}, []);

	const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
		const el = messagesViewportRef.current;
		if (!el) {
			return;
		}
		el.scrollTo({ top: el.scrollHeight, behavior });
	}, []);

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
		});
	}, []);

	/** 切换线程：恢复「粘底」，等 messages / 流式更新后再滚（避免旧列表闪滚） */
	useLayoutEffect(() => {
		pinMessagesToBottomRef.current = true;
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
			scheduleMessagesScrollToBottom();
		});
		ro.observe(track);
		return () => {
			ro.disconnect();
			if (messagesScrollToBottomRafRef.current !== null) {
				cancelAnimationFrame(messagesScrollToBottomRafRef.current);
				messagesScrollToBottomRafRef.current = null;
			}
		};
	}, [hasConversation, currentId, scheduleMessagesScrollToBottom]);

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
			return;
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

	const renderStackedChatComposer = (
		slot: 'bottom' | 'inline',
		composer: { segments: ComposerSegment[]; setSegments: typeof setComposerSegments; canSend: boolean },
		extraClass?: string
	) => {
		const richRef = slot === 'bottom' ? composerRichBottomRef : composerRichInlineRef;
		const plusRef = slot === 'bottom' ? plusAnchorBottomRef : plusAnchorInlineRef;
		const modelRef = slot === 'bottom' ? modelPillBottomRef : modelPillInlineRef;
		const slotKey: ComposerAnchorSlot = slot === 'bottom' ? 'bottom' : 'inline';
		const isFollowUpBar = slot === 'bottom';
		const inputPlaceholder = isFollowUpBar ? followUpComposerPlaceholder : composerPlaceholder;
		const inputClass = isFollowUpBar
			? 'ref-capsule-input ref-followup-rich-input'
			: 'ref-capsule-input ref-capsule-input--stacked-chat';

		const barStart = (
			<div className="ref-capsule-bar-start">
				<div className="ref-plus-anchor" ref={plusRef}>
					<button
						type="button"
						className="ref-plus-btn"
						aria-expanded={plusMenuOpen}
						aria-haspopup="menu"
						title={t('app.addPlusTitle')}
						aria-label={t('app.addPlusAria')}
						onClick={() => {
							setPlusMenuAnchorSlot(slotKey);
							setModelPickerOpen(false);
							setPlusMenuOpen((o) => !o);
						}}
					>
						<IconPlus className="ref-plus-btn-icon" />
					</button>
				</div>
				<div
					className={`ref-mode-chip ref-mode-chip--${composerMode}`}
					title={t('app.currentMode', { mode: composerModeLabel(composerMode, t) })}
				>
					<ComposerModeIcon mode={composerMode} className="ref-mode-chip-ico" />
					<span className="ref-mode-chip-label">{composerModeLabel(composerMode, t)}</span>
					{composerMode !== 'agent' ? (
						<button
							type="button"
							className="ref-mode-chip-clear"
							aria-label={t('app.resetAgentModeAria')}
							onClick={() => setComposerModePersist('agent')}
						>
							<IconChipClear className="ref-mode-chip-clear-svg" />
						</button>
					) : null}
				</div>
			</div>
		);

		const barEnd = (
			<div className="ref-capsule-bar-end">
				<div className="ref-model-pill-anchor" ref={modelRef}>
					<button
						type="button"
						className="ref-model-pill"
						aria-expanded={modelPickerOpen}
						aria-haspopup="listbox"
						onClick={() => {
							setModelPickerAnchorSlot(slotKey);
							setPlusMenuOpen(false);
							setModelPickerOpen((o) => !o);
						}}
					>
						<span className="ref-model-name">{modelPillLabel}</span>
						<IconChevron className="ref-model-chev" />
					</button>
				</div>
				<button
					type="button"
					className="ref-mic-btn"
					disabled
					title={t('app.voiceSoonTitle')}
					aria-label={t('app.voiceSoonAria')}
				>
					<IconMic className="ref-mic-btn-svg" />
				</button>
				<button
					type="button"
					className={`ref-send-btn ${awaitingReply ? 'is-stop' : ''}`}
					title={awaitingReply ? t('app.stopGeneration') : t('app.send')}
					aria-label={awaitingReply ? t('app.stopGeneration') : t('app.send')}
					disabled={!awaitingReply && !composer.canSend}
					onClick={() => (awaitingReply ? void onAbort() : void onSend())}
				>
					{awaitingReply ? <IconStop className="ref-send-icon" /> : <IconArrowUp className="ref-send-icon" />}
				</button>
			</div>
		);

		const onComposerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
			if (slashCommand.handleSlashKeyDown(e)) {
				return;
			}
			if (atMention.handleAtKeyDown(e)) {
				return;
			}
			if (e.key === 'Escape' && resendFromUserIndex !== null && slot === 'inline') {
				e.preventDefault();
				setResendFromUserIndex(null);
				setInlineResendSegments([]);
				return;
			}
			if (e.key === 'Tab' && e.shiftKey) {
				e.preventDefault();
				void onNewThread();
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void onSend();
			}
		};

		const richInput = (
			<ComposerRichInput
				innerRef={richRef}
				segments={composer.segments}
				onSegmentsChange={composer.setSegments}
				className={inputClass}
				placeholder={inputPlaceholder}
				onFilePreview={(rel) => void onExplorerOpenFile(rel)}
				onRichInput={(root) => syncComposerOverlays(root, slotKey)}
				onRichSelect={(root) => syncComposerOverlays(root, slotKey)}
				onKeyDown={onComposerKeyDown}
			/>
		);

		if (isFollowUpBar) {
			return (
				<div className={['ref-capsule', 'ref-capsule--followup-bar', extraClass].filter(Boolean).join(' ')}>
					<div className="ref-followup-bar-row">
						{barStart}
						<div className="ref-followup-input-shell">
							<div className="ref-composer-stacked-body ref-followup-input-body">{richInput}</div>
						</div>
						{barEnd}
					</div>
				</div>
			);
		}

		return (
			<div className={['ref-capsule', 'ref-capsule--stacked-chat', extraClass].filter(Boolean).join(' ')}>
				<div className="ref-composer-stacked-body">{richInput}</div>
				<div className="ref-capsule-bar ref-capsule-bar--stacked">
					{barStart}
					{barEnd}
				</div>
			</div>
		);
	};

	const renderChatMessageList = (): ReactNode[] =>
		displayMessages.map((m, i) => {
			const isLast = i === displayMessages.length - 1;
			const stAt = streamStartedAtRef.current;
			const ftAt = firstTokenAtRef.current;
			const showLiveThought = isLast && m.role === 'assistant' && awaitingReply;
			const frozenSec =
				!awaitingReply && isLast && m.role === 'assistant' && currentId
					? thoughtSecondsByThread[currentId]
					: undefined;

			let thoughtBlock: ReactNode = null;
			if (showLiveThought && stAt) {
				void thinkingTick;
				const phase = streaming.length === 0 ? 'thinking' : 'streaming';
				const elapsed =
					phase === 'thinking'
						? Math.max(0, (Date.now() - stAt) / 1000)
						: ftAt
							? Math.max(0, (ftAt - stAt) / 1000)
							: Math.max(0, (Date.now() - stAt) / 1000);
				thoughtBlock = (
					<ComposerThoughtBlock
						phase={phase}
						elapsedSeconds={elapsed}
						mode={composerMode}
						streamingThinking={streamingThinking}
					/>
				);
			} else if (frozenSec != null) {
				thoughtBlock = (
					<ComposerThoughtBlock
						phase="done"
						elapsedSeconds={frozenSec}
						totalStreamSeconds={workedSeconds}
						mode={composerMode}
						tokenUsage={isLast ? lastTurnUsage : undefined}
					/>
				);
			}

			const pendingEmptyAssistant =
				m.role === 'assistant' &&
				m.content.trim() === '' &&
				awaitingReply &&
				isLast &&
				streamingToolPreview == null;

			const userMessageIndex = i < messages.length && m.role === 'user' ? i : -1;
			const isEditingThisUser = userMessageIndex >= 0 && resendFromUserIndex === userMessageIndex;

			if (m.role === 'user' && isEditingThisUser) {
				const inner = (
					<div ref={inlineResendRootRef} className="ref-msg-slot ref-msg-slot--composer">
						{renderStackedChatComposer(
							'inline',
							{
								segments: inlineResendSegments,
								setSegments: setInlineResendSegments,
								canSend: canSendInlineResend,
							},
							'ref-capsule--inline-edit'
						)}
					</div>
				);
				return i === lastUserMessageIndex ? (
					<div key={`u-edit-${i}`} className="ref-msg-sticky-user-wrap">
						{inner}
					</div>
				) : (
					<Fragment key={`u-edit-${i}`}>{inner}</Fragment>
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
					<div key={`u-${i}`} className="ref-msg-sticky-user-wrap">
						{inner}
					</div>
				) : (
					<Fragment key={`u-${i}`}>{inner}</Fragment>
				);
			}

			return (
				<div key={`a-${i}`} className="ref-msg-slot ref-msg-slot--assistant">
					{thoughtBlock}
					<div className="ref-msg-assistant-body">
						{pendingEmptyAssistant ? (
							<span className="ref-bubble-pending" aria-hidden>
								<span className="ref-bubble-pending-dot" />
								<span className="ref-bubble-pending-dot" />
								<span className="ref-bubble-pending-dot" />
							</span>
						) : (
							<ChatMarkdown
								content={
									composerMode === 'plan'
										? stripPlanBodyForChatDisplay(m.content)
										: m.content
								}
								agentUi={
									composerMode === 'agent' ||
									assistantMessageUsesAgentToolProtocol(m.content)
								}
								workspaceRoot={workspace}
								onOpenAgentFile={(rel, line, end) => void onExplorerOpenFile(rel, line, end)}
								onRunCommand={(cmd) => {
									shell?.invoke('terminal:execLine', cmd).catch(console.error);
								}}
								streamingToolPreview={
									composerMode === 'agent' && awaitingReply && isLast
										? streamingToolPreview
										: null
								}
								showAgentWorking={composerMode === 'agent' && isLast && awaitingReply}
							/>
						)}
					</div>
				</div>
			);
		});

	const renderAgentConversationBelowContext = (
		layout: 'agent-center' | 'editor-rail' = 'agent-center'
	): ReactNode => {
		const isEditorRail = layout === 'editor-rail';

		const messagesEl = hasConversation ? (
			<div className="ref-messages" ref={messagesViewportRef} onScroll={onMessagesScroll}>
				<div className="ref-messages-track" ref={messagesTrackRef}>
					{renderChatMessageList()}
				</div>
			</div>
		) : null;

		const editorRailHeroComposer =
			isEditorRail && !hasConversation ? (
				<div className="ref-capsule ref-capsule--editor-rail-hero">
					<div className="ref-composer-hero-body">
						<ComposerRichInput
							innerRef={composerRichHeroRef}
							segments={composerSegments}
							onSegmentsChange={setComposerSegments}
							className="ref-capsule-input"
							placeholder={composerPlaceholder}
							onFilePreview={(rel) => void onExplorerOpenFile(rel)}
							onRichInput={(root) => syncComposerOverlays(root, 'hero')}
							onRichSelect={(root) => syncComposerOverlays(root, 'hero')}
							onKeyDown={(e) => {
								if (slashCommand.handleSlashKeyDown(e)) {
									return;
								}
								if (atMention.handleAtKeyDown(e)) {
									return;
								}
								if (e.key === 'Escape' && resendFromUserIndex !== null) {
									e.preventDefault();
									setResendFromUserIndex(null);
									setInlineResendSegments([]);
									return;
								}
								if (e.key === 'Tab' && e.shiftKey) {
									e.preventDefault();
									void onNewThread();
									return;
								}
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									void onSend();
								}
							}}
						/>
					</div>
					<div className="ref-capsule-bar ref-capsule-bar--editor-rail">
						<div className="ref-editor-rail-bar-left">
							<div className="ref-plus-anchor ref-editor-rail-mode-cluster" ref={plusAnchorHeroRef}>
								<button
									type="button"
									className={`ref-mode-chip ref-mode-chip--${composerMode} ref-mode-chip--opens-menu`}
									aria-expanded={plusMenuOpen}
									aria-haspopup="menu"
									title={t('app.addPlusTitle')}
									aria-label={t('app.addPlusAria')}
									onClick={() => {
										setPlusMenuAnchorSlot('hero');
										setModelPickerOpen(false);
										setPlusMenuOpen((o) => !o);
									}}
								>
									<ComposerModeIcon mode={composerMode} className="ref-mode-chip-ico" />
									<span className="ref-mode-chip-label">{composerModeLabel(composerMode, t)}</span>
									<IconChevron className="ref-mode-chip-menu-chev" />
								</button>
								{composerMode !== 'agent' ? (
									<button
										type="button"
										className="ref-mode-chip-clear"
										aria-label={t('app.resetAgentModeAria')}
										onClick={() => setComposerModePersist('agent')}
									>
										<IconChipClear className="ref-mode-chip-clear-svg" />
									</button>
								) : null}
							</div>
							<div className="ref-model-pill-anchor" ref={modelPillHeroRef}>
								<button
									type="button"
									className="ref-model-pill"
									aria-expanded={modelPickerOpen}
									aria-haspopup="listbox"
									onClick={() => {
										setModelPickerAnchorSlot('hero');
										setPlusMenuOpen(false);
										setModelPickerOpen((o) => !o);
									}}
								>
									<span className="ref-model-name">{modelPillLabel}</span>
									<IconChevron className="ref-model-chev" />
								</button>
							</div>
						</div>
						<div className="ref-capsule-bar-spacer" />
						<div className="ref-editor-rail-bar-right">
							<button
								type="button"
								className="ref-mic-btn"
								disabled
								title={t('app.comingSoon')}
								aria-label={t('app.comingSoon')}
							>
								<IconImageOutline className="ref-mic-btn-svg" />
							</button>
							<button
								type="button"
								className="ref-mic-btn"
								disabled
								title={t('app.voiceSoonTitle')}
								aria-label={t('app.voiceSoonAria')}
							>
								<IconMic className="ref-mic-btn-svg" />
							</button>
							<button
								type="button"
								className={`ref-send-btn ${awaitingReply ? 'is-stop' : ''}`}
								title={awaitingReply ? t('app.stopGeneration') : t('app.send')}
								aria-label={awaitingReply ? t('app.stopGeneration') : t('app.send')}
								disabled={!awaitingReply && !canSendComposer}
								onClick={() => (awaitingReply ? void onAbort() : void onSend())}
							>
								{awaitingReply ? <IconStop className="ref-send-icon" /> : <IconArrowUp className="ref-send-icon" />}
							</button>
						</div>
					</div>
				</div>
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
						onOpenFile={(rel, line) => void onExplorerOpenFile(rel, line)}
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

				{skillScopePending ? (
					<SkillScopeDialog
						workspaceOpen={!!workspace}
						onCancel={() => setSkillScopePending(null)}
						onConfirm={(scope) => {
							const p = skillScopePending;
							setSkillScopePending(null);
							if (p) {
								void executeSkillCreatorSend(scope, p);
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

				{hasConversation && parsedPlan && composerMode === 'plan' ? (
					<PlanReviewPanel
						plan={parsedPlan}
						planFilePath={planFilePath}
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
						onOpenFile={(rel, line) => void onExplorerOpenFile(rel, line)}
						onKeepAll={onKeepAllEdits}
						onRevertAll={() => void onRevertAllEdits()}
						onKeepFile={(rel) => void onKeepFileEdit(rel)}
						onRevertFile={(rel) => void onRevertFileEdit(rel)}
					/>
				) : null}
				{hasConversation ? (
					renderStackedChatComposer('bottom', {
						segments: composerSegments,
						setSegments: setComposerSegments,
						canSend: canSendComposer,
					})
				) : isEditorRail ? null : (
					<>
						<div className="ref-capsule">
							<div className="ref-composer-hero-body">
								<ComposerRichInput
									innerRef={composerRichHeroRef}
									segments={composerSegments}
									onSegmentsChange={setComposerSegments}
									className="ref-capsule-input"
									placeholder={composerPlaceholder}
									onFilePreview={(rel) => void onExplorerOpenFile(rel)}
									onRichInput={(root) => syncComposerOverlays(root, 'hero')}
									onRichSelect={(root) => syncComposerOverlays(root, 'hero')}
									onKeyDown={(e) => {
										if (slashCommand.handleSlashKeyDown(e)) {
											return;
										}
										if (atMention.handleAtKeyDown(e)) {
											return;
										}
										if (e.key === 'Escape' && resendFromUserIndex !== null) {
											e.preventDefault();
											setResendFromUserIndex(null);
											setInlineResendSegments([]);
											return;
										}
										if (e.key === 'Tab' && e.shiftKey) {
											e.preventDefault();
											void onNewThread();
											return;
										}
										if (e.key === 'Enter' && !e.shiftKey) {
											e.preventDefault();
											void onSend();
										}
									}}
								/>
							</div>
							<div className="ref-capsule-bar">
								<div className="ref-plus-anchor" ref={plusAnchorHeroRef}>
									<button
										type="button"
										className="ref-plus-btn"
										aria-expanded={plusMenuOpen}
										aria-haspopup="menu"
										title={t('app.addPlusTitle')}
										aria-label={t('app.addPlusAria')}
										onClick={() => {
											setPlusMenuAnchorSlot('hero');
											setModelPickerOpen(false);
											setPlusMenuOpen((o) => !o);
										}}
									>
										<IconPlus className="ref-plus-btn-icon" />
									</button>
								</div>
								<div
									className={`ref-mode-chip ref-mode-chip--${composerMode}`}
									title={t('app.currentMode', { mode: composerModeLabel(composerMode, t) })}
								>
									<ComposerModeIcon mode={composerMode} className="ref-mode-chip-ico" />
									<span className="ref-mode-chip-label">{composerModeLabel(composerMode, t)}</span>
									{composerMode !== 'agent' ? (
										<button
											type="button"
											className="ref-mode-chip-clear"
											aria-label={t('app.resetAgentModeAria')}
											onClick={() => setComposerModePersist('agent')}
										>
											<IconChipClear className="ref-mode-chip-clear-svg" />
										</button>
									) : null}
								</div>
								<div className="ref-model-pill-anchor" ref={modelPillHeroRef}>
									<button
										type="button"
										className="ref-model-pill"
										aria-expanded={modelPickerOpen}
										aria-haspopup="listbox"
										onClick={() => {
											setModelPickerAnchorSlot('hero');
											setPlusMenuOpen(false);
											setModelPickerOpen((o) => !o);
										}}
									>
										<span className="ref-model-name">{modelPillLabel}</span>
										<IconChevron className="ref-model-chev" />
									</button>
								</div>
								<div className="ref-capsule-bar-spacer" />
								<button
									type="button"
									className={`ref-send-btn ${awaitingReply ? 'is-stop' : ''}`}
									title={awaitingReply ? t('app.stopGeneration') : t('app.send')}
									aria-label={awaitingReply ? t('app.stopGeneration') : t('app.send')}
									disabled={!awaitingReply && !canSendComposer}
									onClick={() => (awaitingReply ? void onAbort() : void onSend())}
								>
									{awaitingReply ? (
										<IconStop className="ref-send-icon" />
									) : (
										<IconArrowUp className="ref-send-icon" />
									)}
								</button>
							</div>
						</div>
						<div className="ref-quick-actions">
							<button
								type="button"
								className="ref-quick-pill"
								onClick={() => {
									setComposerModePersist('plan');
									void onNewThread();
								}}
							>
								{t('app.planNewIdea')}
								<kbd className="ref-kbd">Shift+Tab</kbd>
							</button>
							<button
								type="button"
								className="ref-quick-pill"
								onClick={() => setWorkspaceToolsOpen(true)}
							>
								{t('app.quickTerminal')}
							</button>
						</div>
					</>
				)}
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

	return (
		<div className="ref-shell">
			<header className="ref-menubar">
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
									setTerminalMenuOpen(false);
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
						{(
							[
								['Edit', t('app.menuEdit')],
								['View', t('app.menuView')],
								['Help', t('app.menuHelp')],
							] as const
						).map(([key, label]) => (
							<button key={key} type="button" className="ref-menu-item">
								{label}
							</button>
						))}
						{layoutMode === 'editor' && workspace ? (
							<div className="ref-menu-dropdown-wrap" ref={terminalMenuRef}>
								<button
									type="button"
									className={`ref-menu-item${terminalMenuOpen ? ' is-active' : ''}`}
									aria-expanded={terminalMenuOpen}
									aria-haspopup="menu"
									onClick={() => {
										setFileMenuOpen(false);
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
				<div className="ref-menubar-center">
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
				</div>
				<div className="ref-menubar-right">
					<div className="ref-layout-toggle-btns">
						<button
							type="button"
							className={`ref-layout-btn ${layoutMode === 'agent' ? 'is-active' : ''}`}
							onClick={() => setLayoutMode('agent')}
							title="Agent Layout"
						>
							<IconSidebarLeft />
						</button>
						<button
							type="button"
							className={`ref-layout-btn ${layoutMode === 'editor' ? 'is-active' : ''}`}
							onClick={() => setLayoutMode('editor')}
							title="Editor Layout"
						>
							<IconSidebarRight />
						</button>
					</div>
					<button
						type="button"
						className="ref-icon-tile ref-settings-btn"
						onClick={() => openSettingsPage('models')}
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
					className={`ref-body ${layoutMode === 'editor' ? 'ref-body--editor' : ''}`}
					style={{
						gridTemplateColumns: `${railWidths.left}px ${RESIZE_HANDLE_PX}px minmax(0, 1fr) ${RESIZE_HANDLE_PX}px ${railWidths.right}px`,
					}}
				>
				<aside className="ref-left" aria-label={t('app.projectAndAgent')}>
					{layoutMode === 'agent' ? (
					<>
					<div className="ref-left-scroll">
						<div className="ref-project-block">
							<div className="ref-project-header">{workspaceBasename}</div>
							<label className="ref-agent-search-wrap">
								<IconSearch className="ref-agent-search-icon" />
								<input
									type="search"
									className="ref-agent-search-input"
									placeholder={t('app.searchAgentsPlaceholder')}
									value={threadSearch}
									onChange={(e) => setThreadSearch(e.target.value)}
									aria-label={t('app.searchAgentsAria')}
								/>
							</label>
							<button type="button" className="ref-agent-new-btn" onClick={() => void onNewThread()}>
								{t('app.newAgent')}
								<kbd className="ref-kbd">Ctrl+N</kbd>
							</button>
							<div className="ref-thread-section-label">{t('app.today')}</div>
							<div className="ref-thread-list">{todayThreads.map(renderThreadItem)}</div>
							{archivedThreads.length > 0 ? (
								<>
									<div className="ref-thread-section-label ref-thread-section-label--archived">{t('app.archived')}</div>
									<div className="ref-thread-list">{archivedThreads.map(renderThreadItem)}</div>
								</>
							) : null}
						</div>
					</div>
					<div className="ref-left-footer">
						<button type="button" className="ref-open-workspace" onClick={() => setWorkspacePickerOpen(true)}>
							{t('app.openWorkspace')}
						</button>
						<div className="ref-user-strip">
							<div className="ref-user-avatar" aria-hidden />
							<div className="ref-user-meta">
								<span className="ref-user-name">{t('app.you')}</span>
								<span className="ref-user-plan">Async</span>
							</div>
						</div>
						<div className="ref-ipc-hint">{ipcOk}</div>
					</div>
					</>
					) : (
					/* ═══ Editor 布局：左侧 = 文件树 ═══ */
					<>
					<div className="ref-left-scroll">
						<div className="ref-project-block ref-project-block--editor">
							<div className="ref-explorer-kicker">{t('app.tabExplorer')}</div>
							<div className="ref-explorer-head ref-explorer-head--editor">
								<div className="ref-explorer-title-stack">
									<span className="ref-explorer-title">{workspaceBasename}</span>
									<span className="ref-explorer-subtitle" title={workspace ?? undefined}>
										{workspace ?? t('app.noWorkspace')}
									</span>
								</div>
								<button
									type="button"
									className="ref-icon-tile"
									aria-label={t('app.explorerRefreshAria')}
									onClick={() => void refreshGit()}
								>
									<IconRefresh />
								</button>
							</div>
							<div className="ref-explorer-body ref-explorer-body--workspace">
								{workspace && shell ? (
									<WorkspaceExplorer
										key={workspace}
										shell={shell}
										pathStatus={gitPathStatus}
										selectedRel={filePath.trim()}
										treeEpoch={treeEpoch}
										onOpenFile={(rel) => void onExplorerOpenFile(rel)}
									/>
								) : (
									<p className="ref-explorer-placeholder">{t('app.explorerPlaceholder')}</p>
								)}
							</div>
						</div>
					</div>
					<div className="ref-left-footer ref-left-footer--editor">
						<button type="button" className="ref-open-workspace" onClick={() => setWorkspacePickerOpen(true)}>
							{t('app.openWorkspace')}
						</button>
						<div className="ref-ipc-hint">{ipcOk}</div>
					</div>
					</>
					)}
				</aside>

				<div
					className="ref-resize-handle"
					role="separator"
					aria-orientation="vertical"
					aria-label={t('app.resizeLeftAria')}
					title={t('app.resizeLeftTitle')}
					onMouseDown={beginResizeLeft}
					onDoubleClick={resetRailWidths}
				/>

				{layoutMode === 'agent' ? (
				<main
					className={`ref-center ${hasConversation ? 'ref-center--chat' : ''}`}
					aria-label={t('app.commandCenter')}
					onKeyDown={onPlanNewIdea}
				>
					<div className="ref-context-block">
						<div className="ref-context-line">
							<IconDoc className="ref-context-icon" />
							<span className="ref-context-title">{workspace ? workspaceBasename : t('app.noWorkspace')}</span>
						</div>
						{hasConversation ? (
							<div className="ref-context-sub" title={currentThreadTitle}>
								{currentThreadTitle}
							</div>
						) : null}
					</div>

					{renderAgentConversationBelowContext()}
				</main>
				) : (
				/* ═══ Editor：中间 = 标签 + 面包屑 + 编辑器（扁平，贴近 VS Code）；底部终端可关 ═══ */
				<main
					className="ref-center ref-center--editor-workspace"
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
							{filePath.trim() ? (
								<>
									<div className="ref-editor-bc-toolbar-row">
										<div className="ref-editor-bc-toolbar-inner">
											<EditorFileBreadcrumb filePath={filePath.trim()} />
											<div className="ref-editor-bc-actions">
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
											</div>
										</div>
									</div>
									<div className="ref-editor-canvas">
										<div className="ref-editor-pane">
											<div className="ref-monaco-fill">
												<Editor
													key={filePath.trim()}
													height="100%"
													theme="void-dark"
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
											</div>
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
					className="ref-resize-handle"
					role="separator"
					aria-orientation="vertical"
					aria-label={t('app.resizeRightAria')}
					title={t('app.resizeRightTitle')}
					onMouseDown={beginResizeRight}
					onDoubleClick={resetRailWidths}
				/>

				{layoutMode === 'agent' ? (
				<aside className="ref-right" aria-label={t('app.rightSidebar')}>
					<div className="ref-right-icon-tabs" role="tablist" aria-label={t('app.rightSidebarViews')}>
						<button
							type="button"
							role="tab"
							aria-selected={rightPanelTab === 'git'}
							aria-label={t('app.tabGit')}
							title={t('app.tabGit')}
							className={`ref-right-icon-tab ${rightPanelTab === 'git' ? 'is-active' : ''}`}
							onClick={() => setRightPanelTab('git')}
						>
							<IconGitSCM />
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={rightPanelTab === 'search'}
							aria-label={t('app.tabSearch')}
							title={t('app.tabSearch')}
							className={`ref-right-icon-tab ${rightPanelTab === 'search' ? 'is-active' : ''}`}
							onClick={() => setRightPanelTab('search')}
						>
							<IconSearch />
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={rightPanelTab === 'explorer'}
							aria-label={t('app.tabExplorer')}
							title={t('app.tabExplorer')}
							className={`ref-right-icon-tab ${rightPanelTab === 'explorer' ? 'is-active' : ''}`}
							onClick={() => setRightPanelTab('explorer')}
						>
							<IconExplorer />
						</button>
					</div>

					<div className="ref-right-panel-stage">
						<div key={rightPanelTab} className="ref-right-panel-view">
					{rightPanelTab === 'explorer' ? (
						<div className="ref-preview-split">
							<div className="ref-preview-tree">
								<div className="ref-explorer-head">
									<span className="ref-explorer-title">{workspaceBasename}</span>
									<button
										type="button"
										className="ref-icon-tile"
										aria-label={t('app.explorerRefreshAria')}
										onClick={() => void refreshGit()}
									>
										<IconRefresh />
									</button>
								</div>
								<div className="ref-explorer-body">
									{workspace && shell ? (
										<WorkspaceExplorer
											key={workspace}
											shell={shell}
											pathStatus={gitPathStatus}
											selectedRel={filePath.trim()}
											treeEpoch={treeEpoch}
											onOpenFile={(rel) => void onExplorerOpenFile(rel)}
										/>
									) : (
										<p className="ref-explorer-placeholder">{t('app.explorerPlaceholder')}</p>
									)}
								</div>
							</div>
							<div className="ref-preview-editor" aria-label={t('app.filePreview')}>
								<div className="ref-editor-toolbar">
									<span className="ref-editor-file-name" title={filePath.trim() || undefined}>
										{editorFileBasename || t('app.noFileSelected')}
									</span>
									<button
										type="button"
										className="ref-icon-tile"
										aria-label={t('app.reloadFileAria')}
										disabled={!filePath.trim()}
										onClick={() => void onLoadFile()}
									>
										<IconRefresh />
									</button>
									<span className={tsLspPillClassName} title={tsLspPillTitle}>
										LSP
									</span>
									<div className="ref-editor-toolbar-spacer" />
									<button
										type="button"
										className="ref-editor-save"
										disabled={!filePath.trim()}
										onClick={() => void onSaveFile()}
									>
										{t('common.save')}
									</button>
								</div>
								<div className="ref-editor-pane">
									{filePath.trim() ? (
										<div className="ref-monaco-fill">
											<Editor
												key={filePath.trim()}
												height="100%"
												theme="void-dark"
												path={monacoDocumentPath || filePath.trim()}
												language={languageFromFilePath(filePath.trim())}
												value={editorValue}
												onChange={(v) => setEditorValue(v ?? '')}
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
										</div>
									) : (
										<div className="ref-editor-empty">{t('app.selectFileToView')}</div>
									)}
								</div>
							</div>
						</div>
					) : rightPanelTab === 'search' ? (
						<div className="ref-search-stack">
							<div className="ref-search-head">{t('app.searchPanelTitle')}</div>
							{sidebarSearchDraft.trim() ? (
								<div className="ref-search-draft">
									<span className="ref-search-draft-label">{t('quickOpen.searchDraftLabel')}</span>
									{sidebarSearchDraft}
								</div>
							) : null}
							<p className="ref-search-placeholder">{t('app.searchPanelHint')}</p>
						</div>
					) : (
						<div className="ref-right-git-stack">
							<div className="ref-right-toolbar">
								<button type="button" className="ref-icon-tile" aria-label={t('app.gitRefreshAria')} onClick={() => void refreshGit()}>
									<IconRefresh />
								</button>
								<span className="ref-local-label">{t('app.gitLocal')}</span>
								<span className="ref-branch-chip">{gitBranch || 'master'}</span>
							</div>
							<div className="ref-git-summary ref-git-summary--rich">
								{changeCount > 0 ? (
									<span className="ref-git-count">{t('app.gitUncommitted', { count: String(changeCount) })}</span>
								) : (
									<span className="ref-git-count ref-git-count--muted">{t('app.gitNoChanges')}</span>
								)}
								{diffTotals.additions > 0 ? (
									<span className="ref-git-stat-add">+{diffTotals.additions}</span>
								) : null}
								{diffTotals.deletions > 0 ? (
									<span className="ref-git-stat-del">−{diffTotals.deletions}</span>
								) : null}
							</div>
							<div className="ref-git-body">
								{gitLines.length === 1 && gitLines[0]?.includes('Failed') ? (
									<p className="ref-git-error">{t('app.gitLoadFailed')}</p>
								) : null}
								{changeCount > 0 ? (
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
															aria-label={t('app.gitOpenInEditorAria')}
															title={t('app.gitOpenTitle')}
															onClick={() => void onExplorerOpenFile(rel)}
														>
															↗
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
									<button type="button" className="ref-commit-btn-secondary" onClick={() => void onCommitAndPush()}>
										{t('app.commitPush')}
									</button>
								</div>
								{gitActionError ? <p className="ref-git-action-error">{gitActionError}</p> : null}
							</div>
						</div>
					)}
						</div>
					</div>
				</aside>
				) : (
				/* ═══ Editor 布局：右侧 = Agent 对话（与 Agent 布局同一套消息与输入） ═══ */
				<aside
					className={`ref-right ref-right--editor-chat ${hasConversation ? 'ref-right--editor-chat--active' : ''}`}
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

			{settingsPageOpen ? (
				<div className="ref-settings-backdrop" role="presentation" onClick={() => void closeSettingsPage()}>
					<div className="ref-settings-mount" onClick={(e) => e.stopPropagation()}>
						<SettingsPage
							key={settingsMountKey}
							initialNav={settingsInitialNav}
							onClose={() => void closeSettingsPage()}
							apiKey={apiKey}
							baseURL={baseURL}
							defaultModel={defaultModel}
							proxyUrl={proxyUrl}
							anthropicApiKey={anthropicApiKey}
							anthropicBaseURL={anthropicBaseURL}
							geminiApiKey={geminiApiKey}
							modelEntries={modelEntries}
							enabledIds={enabledModelIds}
							onChangeApiKey={setApiKey}
							onChangeBaseURL={setBaseURL}
							onChangeProxyUrl={setProxyUrl}
							onChangeAnthropicApiKey={setAnthropicApiKey}
							onChangeAnthropicBaseURL={setAnthropicBaseURL}
							onChangeGeminiApiKey={setGeminiApiKey}
							onChangeModelEntries={onChangeModelEntries}
							onToggleEnabled={(id, on) => void onToggleModelEnabled(id, on)}
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
						/>
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
		</div>
	);
}
