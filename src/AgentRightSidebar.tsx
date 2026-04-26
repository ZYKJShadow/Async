import { buildBrowserFingerprintStealthScript } from './browserFingerprintStealth.js';
import { fingerprintSettingsToInjectPatch } from '../main-src/browser/browserFingerprintNormalize.js';
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type RefObject,
	type SetStateAction,
} from 'react';
import { AgentFilePreviewPanel } from './AgentFilePreviewPanel';
import { ChatMarkdown } from './ChatMarkdown';
import { VoidSelect } from './VoidSelect';
import { GitUnavailableState } from './gitBadge';
import {
	IconArrowLeft,
	IconArrowRight,
	IconCloseSmall,
	IconDoc,
	IconGitSCM,
	IconGlobe,
	IconPlus,
	IconRefresh,
	IconSettings,
	IconStop,
	IconArrowUp,
	IconArrowUpRight,
} from './icons';
import type { TFunction } from './i18n';
import type { PlanTodoItem, ParsedPlan } from './planParser';
import {
	classifyGitUnavailableReason,
	gitUnavailableCopy,
	type GitUnavailableReason,
} from './gitAvailability';
import type { AgentFilePreviewState } from './hooks/useAgentFileReview';
import { AgentGitScmChangedCards } from './GitScmVirtualLists';
import { useAppShellChromeCore, useAppShellGit, useAppShellSettings } from './app/appShellContexts';
import type { TeamSessionState } from './hooks/useTeamSession';
import { TeamRoleWorkflowPanel } from './TeamRoleWorkflowPanel';
import { buildTeamWorkflowItems } from './teamWorkflowItems';
import { AgentSessionPanel } from './AgentSessionPanel';
import type { AgentSessionState } from './hooks/useAgentSession';
import { hideBootSplash } from './bootSplash';
import {
	BROWSER_SIDEBAR_CONFIG_SYNC_EVENT,
	browserSidebarConfigSyncDetail,
	DEFAULT_BROWSER_SIDEBAR_CONFIG,
	normalizeBrowserSidebarConfig,
	type BrowserSidebarSettingsConfig,
} from './browserSidebarConfig';

type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team' | 'browser' | 'agents';

const BROWSER_HOME_URL = 'https://www.bing.com/';

type BrowserNavEvent = Event & { url?: string; isMainFrame?: boolean };
type BrowserTitleEvent = Event & { title?: string };
type BrowserFailEvent = Event & {
	errorCode?: number;
	errorDescription?: string;
	validatedURL?: string;
	isMainFrame?: boolean;
};
type BrowserControlPayload =
	| {
			commandId: string;
			type: 'navigate';
			target: string;
			newTab?: boolean;
	  }
	| {
			commandId: string;
			type: 'closeSidebar';
	  }
	| {
			commandId: string;
			type: 'reload' | 'stop' | 'goBack' | 'goForward' | 'closeTab';
			tabId?: string;
	  }
	| {
			commandId: string;
			type: 'readPage';
			tabId?: string;
			selector?: string;
			includeHtml?: boolean;
			maxChars?: number;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'screenshotPage';
			tabId?: string;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'clickElement';
			tabId?: string;
			selector: string;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'inputText';
			tabId?: string;
			selector: string;
			text: string;
			pressEnter?: boolean;
			waitForLoad?: boolean;
	  }
	| {
			commandId: string;
			type: 'waitForSelector';
			tabId?: string;
			selector: string;
			visible?: boolean;
			waitForLoad?: boolean;
			timeoutMs?: number;
	  }
	| {
			commandId: string;
			type: 'applyConfig';
			config: Partial<BrowserSidebarSettingsConfig>;
			defaultUserAgent?: string;
	  };

type BrowserCommandResultPayload =
	| {
			commandId: string;
			ok: true;
			result: unknown;
	  }
	| {
			commandId: string;
			ok: false;
			error: string;
	  };

function isBrowserControlPayload(raw: unknown): raw is BrowserControlPayload {
	if (!raw || typeof raw !== 'object') {
		return false;
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.commandId !== 'string' || typeof obj.type !== 'string') {
		return false;
	}
	switch (obj.type) {
		case 'navigate':
			return typeof obj.target === 'string';
		case 'closeSidebar':
			return true;
		case 'reload':
		case 'stop':
		case 'goBack':
		case 'goForward':
		case 'closeTab':
			return obj.tabId === undefined || typeof obj.tabId === 'string';
		case 'readPage':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				(obj.selector === undefined || typeof obj.selector === 'string') &&
				(obj.includeHtml === undefined || typeof obj.includeHtml === 'boolean') &&
				(obj.maxChars === undefined || typeof obj.maxChars === 'number') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'screenshotPage':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'clickElement':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				typeof obj.selector === 'string' &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'inputText':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				typeof obj.selector === 'string' &&
				typeof obj.text === 'string' &&
				(obj.pressEnter === undefined || typeof obj.pressEnter === 'boolean') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean')
			);
		case 'waitForSelector':
			return (
				(obj.tabId === undefined || typeof obj.tabId === 'string') &&
				typeof obj.selector === 'string' &&
				(obj.visible === undefined || typeof obj.visible === 'boolean') &&
				(obj.waitForLoad === undefined || typeof obj.waitForLoad === 'boolean') &&
				(obj.timeoutMs === undefined || typeof obj.timeoutMs === 'number')
			);
		case 'applyConfig':
			return Boolean(obj.config && typeof obj.config === 'object');
		default:
			return false;
	}
}

function safeGetWebviewUrl(node: AsyncShellWebviewElement | null): string {
	if (!node) {
		return '';
	}
	try {
		return String(node.getURL?.() ?? '').trim();
	} catch {
		return '';
	}
}

function looksLikeLocalFilesystemPath(raw: string): boolean {
	if (/^[a-zA-Z]:[\\/]/.test(raw)) {
		return true;
	}
	if (/^\\\\/.test(raw)) {
		return true;
	}
	if (/^\/[^/]/.test(raw)) {
		return true;
	}
	if (/\\/.test(raw) && !/^[a-zA-Z][a-zA-Z\d+\-.]+:\/\//.test(raw)) {
		return true;
	}
	return false;
}

function looksLikeDirectUrl(raw: string): boolean {
	if (/^[a-zA-Z][a-zA-Z\d+\-.]+:/.test(raw)) {
		return true;
	}
	return /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(raw);
}

function normalizeBrowserTarget(raw: string): string {
	const text = raw.trim();
	if (!text) {
		return BROWSER_HOME_URL;
	}
	if (looksLikeLocalFilesystemPath(text)) {
		return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
	}
	if (looksLikeDirectUrl(text)) {
		return /^[a-zA-Z][a-zA-Z\d+\-.]+:/.test(text) ? text : `https://${text}`;
	}
	return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

function normalizeBrowserExtractedText(raw: string, maxChars: number): string {
	const compact = String(raw ?? '')
		.replace(/\r/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
	return compact.length > maxChars ? `${compact.slice(0, maxChars)}\n\n... (truncated)` : compact;
}

async function notifyBrowserCommandResult(
	shell: NonNullable<Window['asyncShell']> | undefined,
	payload: BrowserCommandResultPayload
): Promise<void> {
	if (!shell) {
		return;
	}
	try {
		await shell.invoke('browser:commandResult', payload);
	} catch {
		/* ignore */
	}
}

export type CommitAction = 'commit' | 'commit-push' | 'commit-pr';

export type AgentRightSidebarProps = {
	open: boolean;
	view: AgentRightSidebarView;
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	/** 打开设置页中的「内置浏览器」配置（侧栏为设置导航；独立窗口由 IPC 唤起主窗口） */
	onOpenBrowserSettings: () => void;
	planPreviewTitle: string;
	planPreviewMarkdown: string;
	planDocumentMarkdown: string;
	planFileRelPath: string | null;
	planFilePath: string | null;
	agentPlanBuildModelId: string;
	setAgentPlanBuildModelId: Dispatch<SetStateAction<string>>;
	awaitingReply: boolean;
	agentPlanEffectivePlan: ParsedPlan | null;
	onPlanBuild: (modelId: string) => void;
	planReviewIsBuilt: boolean;
	agentPlanTodoDoneCount: number;
	agentPlanTodos: PlanTodoItem[];
	onPlanAddTodo: () => void;
	planTodoDraftOpen: boolean;
	planTodoDraftInputRef: RefObject<HTMLInputElement | null>;
	planTodoDraftText: string;
	setPlanTodoDraftText: Dispatch<SetStateAction<string>>;
	onPlanAddTodoSubmit: () => void;
	onPlanAddTodoCancel: () => void;
	onPlanTodoToggle: (id: string) => void;
	agentFilePreview: AgentFilePreviewState | null;
	openFileInTab: (
		relPath: string,
		revealLine?: number,
		revealEndLine?: number,
		options?: { diff?: string | null; allowReviewActions?: boolean }
	) => void;
	onAcceptAgentFilePreviewHunk: (patch: string) => void;
	onRevertAgentFilePreviewHunk: (patch: string) => void;
	agentFilePreviewBusyPatch: string | null;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	commitMsg: string;
	setCommitMsg: Dispatch<SetStateAction<string>>;
	onCommit: (
		action: CommitAction,
		options: { includeUnstaged: boolean; isDraft: boolean; message: string }
	) => Promise<{ ok: boolean; error?: string; prUrl?: string }>;
	teamSession: TeamSessionState | null;
	onSelectTeamExpert: (taskId: string) => void;
	workspaceRoot: string | null;
	onOpenTeamAgentFile: (
		relPath: string,
		revealLine?: number,
		revealEndLine?: number,
		options?: { diff?: string | null; allowReviewActions?: boolean }
	) => void;
	revertedPaths: ReadonlySet<string>;
	revertedChangeKeys: ReadonlySet<string>;
	agentSession: AgentSessionState | null;
	currentThreadId: string | null;
	onSelectAgentSession: (agentId: string | null) => void;
	onSendAgentInput: (agentId: string, message: string, interrupt: boolean) => Promise<void>;
	onSubmitAgentUserInput: (requestId: string, answers: Record<string, string>) => Promise<void>;
	onWaitAgent: (agentId: string) => Promise<void>;
	onResumeAgent: (agentId: string) => Promise<void>;
	onCloseAgent: (agentId: string) => Promise<void>;
	onOpenAgentTranscript: (absPath: string) => void;
};

const COMMIT_MODAL_EXIT_MS = 180;

function CommitModal({
	t,
	gitBranch,
	changeCount,
	stagedCount,
	diffTotals,
	diffLoading,
	commitMsg,
	setCommitMsg,
	onClose,
	onCommit,
	onOpenCustomInstructions,
	previousBranch,
}: {
	t: TFunction;
	gitBranch: string;
	changeCount: number;
	stagedCount: number;
	diffTotals: { additions: number; deletions: number };
	diffLoading: boolean;
	commitMsg: string;
	setCommitMsg: (msg: string) => void;
	onClose: () => void;
	onCommit: (
		action: CommitAction,
		options: { includeUnstaged: boolean; isDraft: boolean; message: string }
	) => Promise<{ ok: boolean; error?: string; prUrl?: string }>;
	onOpenCustomInstructions: () => void;
	previousBranch?: string;
}) {
	const [selectedAction, setSelectedAction] = useState<CommitAction>('commit');
	const [isDraft, setIsDraft] = useState(false);
	const [includeUnstaged, setIncludeUnstaged] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const titleId = 'ref-commit-modal-title';
	const dialogRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const closeTimerRef = useRef<number | null>(null);

	const showBranchWarning =
		isMeaningfulGitBranch(previousBranch) &&
		isMeaningfulGitBranch(gitBranch) &&
		previousBranch !== gitBranch;
	const trimmedMsg = commitMsg.trim();
	const effectiveCount = includeUnstaged ? changeCount : stagedCount;
	const noStagedWarning = !includeUnstaged && stagedCount === 0;
	const continueDisabled = submitting || isClosing || noStagedWarning;
	const showDiffTotals = includeUnstaged && !diffLoading;

	useEffect(() => {
		if (typeof document === 'undefined') {
			return;
		}
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	}, []);

	useEffect(() => {
		const focus = () => textareaRef.current?.focus();
		const id = window.setTimeout(focus, 0);
		return () => window.clearTimeout(id);
	}, []);

	useEffect(() => {
		return () => {
			if (closeTimerRef.current !== null) {
				window.clearTimeout(closeTimerRef.current);
			}
		};
	}, []);

	const closeWithAnimation = useCallback(
		(afterClose?: () => void) => {
			if (submitting || isClosing) {
				return;
			}
			setIsClosing(true);
			if (closeTimerRef.current !== null) {
				window.clearTimeout(closeTimerRef.current);
			}
			closeTimerRef.current = window.setTimeout(() => {
				closeTimerRef.current = null;
				onClose();
				afterClose?.();
			}, COMMIT_MODAL_EXIT_MS);
		},
		[isClosing, onClose, submitting]
	);

	const submit = useCallback(async () => {
		if (continueDisabled) {
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const result = await onCommit(selectedAction, {
				includeUnstaged,
				isDraft,
				message: trimmedMsg,
			});
			if (result.ok) {
				closeWithAnimation();
			} else {
				setError(result.error ?? t('app.commitGenericError'));
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	}, [closeWithAnimation, continueDisabled, onCommit, selectedAction, includeUnstaged, isDraft, trimmedMsg, t]);

	const onDialogKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLDivElement>) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closeWithAnimation();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				void submit();
				return;
			}
			if (
				e.key === 'Enter' &&
				!e.shiftKey &&
				!e.altKey &&
				!e.ctrlKey &&
				!e.metaKey &&
				e.target === dialogRef.current
			) {
				e.preventDefault();
				e.stopPropagation();
				void submit();
			}
		},
		[closeWithAnimation, submit]
	);

	const onOverlayClick = useCallback(() => {
		closeWithAnimation();
	}, [closeWithAnimation]);

	return (
		<div
			className={`ref-commit-modal-overlay ${isClosing ? 'is-closing' : ''}`}
			onClick={onOverlayClick}
		>
			<div
				className="ref-commit-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				ref={dialogRef}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={onDialogKeyDown}
				tabIndex={-1}
			>
				<div className="ref-commit-modal-header">
					<div className="ref-commit-modal-icon">
						<IconGitSCM />
					</div>
					<button
						type="button"
						className="ref-commit-modal-close"
						onClick={() => closeWithAnimation()}
						aria-label={t('app.close')}
						disabled={submitting || isClosing}
					>
						<IconCloseSmall />
					</button>
				</div>

				<h2 id={titleId} className="ref-commit-modal-title">
					{t('app.commitYourChanges')}
				</h2>

				<div className="ref-commit-modal-section">
					<div className="ref-commit-modal-row">
						<span className="ref-commit-modal-label">{t('app.branch')}</span>
						<span className="ref-commit-modal-value">
							<IconArrowUpRight />
							{gitBranch || '—'}
						</span>
					</div>

					<div className="ref-commit-modal-row">
						<span className="ref-commit-modal-label">{t('app.changes')}</span>
						<span className="ref-commit-modal-value">
							{t('app.commitFiles', { count: String(effectiveCount) })}
							{showDiffTotals && diffTotals.additions > 0 && (
								<span className="ref-commit-stat-add">+{diffTotals.additions}</span>
							)}
							{showDiffTotals && diffTotals.deletions > 0 && (
								<span className="ref-commit-stat-del">-{diffTotals.deletions}</span>
							)}
						</span>
					</div>

					<label className="ref-commit-modal-toggle">
						<input
							type="checkbox"
							checked={includeUnstaged}
							onChange={(e) => setIncludeUnstaged(e.target.checked)}
							disabled={submitting || isClosing}
						/>
						<span className="ref-commit-modal-toggle-slider"></span>
						<span className="ref-commit-modal-toggle-label">{t('app.includeUnstaged')}</span>
					</label>
					{noStagedWarning && (
						<div className="ref-commit-modal-hint ref-commit-modal-hint--warn">
							{t('app.commitNothingStaged')}
						</div>
					)}
				</div>

				<div className="ref-commit-modal-section">
					<div className="ref-commit-modal-section-header">
						<span className="ref-commit-modal-label">{t('app.commitMessage')}</span>
						<button
							type="button"
							className="ref-commit-modal-link"
							onClick={() => closeWithAnimation(onOpenCustomInstructions)}
							disabled={submitting || isClosing}
						>
							{t('app.customInstructions')}
						</button>
					</div>
					<textarea
						ref={textareaRef}
						className="ref-commit-modal-textarea"
						placeholder={t('app.leaveBlankAutogenerate')}
						value={commitMsg}
						onChange={(e) => setCommitMsg(e.target.value)}
						disabled={submitting || isClosing}
					/>
					<div className="ref-commit-modal-hint">{t('app.commitMessageHint')}</div>
				</div>

				<div className="ref-commit-modal-section">
					<h3 className="ref-commit-modal-section-title">{t('app.nextSteps')}</h3>
					<div className="ref-commit-modal-actions" role="radiogroup" aria-label={t('app.nextSteps')}>
						<button
							type="button"
							role="radio"
							aria-checked={selectedAction === 'commit'}
							className={`ref-commit-modal-action ${selectedAction === 'commit' ? 'is-active' : ''}`}
							onClick={() => setSelectedAction('commit')}
							disabled={submitting || isClosing}
						>
							<IconGitSCM />
							<span>{t('app.commit')}</span>
							{selectedAction === 'commit' && <span className="ref-commit-modal-check">✓</span>}
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={selectedAction === 'commit-push'}
							className={`ref-commit-modal-action ${selectedAction === 'commit-push' ? 'is-active' : ''}`}
							onClick={() => setSelectedAction('commit-push')}
							disabled={submitting || isClosing}
						>
							<IconArrowUp />
							<span>{t('app.commitPush')}</span>
							{selectedAction === 'commit-push' && <span className="ref-commit-modal-check">✓</span>}
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={selectedAction === 'commit-pr'}
							className={`ref-commit-modal-action ${selectedAction === 'commit-pr' ? 'is-active' : ''}`}
							onClick={() => setSelectedAction('commit-pr')}
							disabled={submitting || isClosing}
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<circle cx="4" cy="3.5" r="1.6" />
								<circle cx="4" cy="12.5" r="1.6" />
								<circle cx="12" cy="12.5" r="1.6" />
								<path d="M4 5.1v5.8" />
								<path d="M12 10.9V7.5a2.4 2.4 0 0 0-2.4-2.4H7.6" />
								<path d="M9.4 3.1 7.6 5.1l1.8 2" />
							</svg>
							<span>{t('app.commitAndCreatePR')}</span>
							{selectedAction === 'commit-pr' && <span className="ref-commit-modal-check">✓</span>}
						</button>
					</div>
				</div>

				{showBranchWarning && (
					<div className="ref-commit-modal-warning" role="alert">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="ref-commit-modal-warning-icon" aria-hidden="true">
							<path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.5v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z" />
						</svg>
						<span>
							{t('app.commitBranchWarning', {
								oldBranch: previousBranch ?? '',
								newBranch: gitBranch || '—',
							})}
						</span>
					</div>
				)}

				{error && (
					<div className="ref-commit-modal-error" role="alert">
						{error}
					</div>
				)}

				<div className="ref-commit-modal-footer">
					{selectedAction === 'commit-pr' ? (
						<label className="ref-commit-modal-toggle">
							<input
								type="checkbox"
								checked={isDraft}
								onChange={(e) => setIsDraft(e.target.checked)}
								disabled={submitting || isClosing}
							/>
							<span className="ref-commit-modal-toggle-slider"></span>
							<span className="ref-commit-modal-toggle-label">{t('app.draft')}</span>
						</label>
					) : (
						<span />
					)}
					<button
						type="button"
						className="ref-commit-modal-continue"
						onClick={() => void submit()}
						disabled={continueDisabled}
						aria-busy={submitting}
					>
						{submitting ? t('app.commitInProgress') : t('app.continue')}
					</button>
				</div>
			</div>
		</div>
	);
}

function RightSidebarTabs({
	t,
	hasPlan,
	openView,
	closeSidebar,
	extraActions,
}: {
	t: TFunction;
	hasPlan: boolean;
	openView: (view: AgentRightSidebarView) => void;
	closeSidebar: () => void;
	extraActions?: ReactNode;
}) {
	return (
		<div className="ref-right-icon-tabs" aria-label={t('app.rightSidebarViews')}>
			{hasPlan ? (
				<button
					type="button"
					aria-label={t('app.tabPlan')}
					title={t('app.tabPlan')}
					className="ref-right-icon-tab"
					onClick={() => openView('plan')}
				>
					<IconDoc />
				</button>
			) : null}
			{extraActions}
			<button
				type="button"
				aria-label={t('common.close')}
				title={t('common.close')}
				className="ref-right-icon-tab"
				onClick={closeSidebar}
			>
				<IconCloseSmall />
			</button>
		</div>
	);
}

/** Plan 面板：`modelPickerItems` 来自 Settings context，避免仅模型列表变化时整份 sidebar props 失效。 */
const AgentRightSidebarPlanPanel = memo(function AgentRightSidebarPlanPanel({
	hasAgentPlanSidebarContent,
	closeSidebar,
	openView,
	planPreviewTitle,
	planPreviewMarkdown,
	planDocumentMarkdown,
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
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	planPreviewTitle: string;
	planPreviewMarkdown: string;
	planDocumentMarkdown: string;
	planFileRelPath: string | null;
	planFilePath: string | null;
	agentPlanBuildModelId: string;
	setAgentPlanBuildModelId: Dispatch<SetStateAction<string>>;
	awaitingReply: boolean;
	agentPlanEffectivePlan: ParsedPlan | null;
	onPlanBuild: (modelId: string) => void;
	planReviewIsBuilt: boolean;
	agentPlanTodoDoneCount: number;
	agentPlanTodos: PlanTodoItem[];
	onPlanAddTodo: () => void;
	planTodoDraftOpen: boolean;
	planTodoDraftInputRef: RefObject<HTMLInputElement | null>;
	planTodoDraftText: string;
	setPlanTodoDraftText: Dispatch<SetStateAction<string>>;
	onPlanAddTodoSubmit: () => void;
	onPlanAddTodoCancel: () => void;
	onPlanTodoToggle: (id: string) => void;
}) {
	const { t } = useAppShellChromeCore();
	const { modelPickerItems } = useAppShellSettings();

	return (
		<div className="ref-agent-plan-doc-shell">
			{planPreviewMarkdown ? (
				<section className="ref-agent-plan-doc" aria-label={t('app.tabPlan')}>
					<div className="ref-agent-plan-doc-toolbar">
						<div className="ref-agent-plan-doc-title-stack">
							<span className="ref-agent-plan-doc-label">{t('app.tabPlan')}</span>
							<span className="ref-agent-plan-doc-title">{planPreviewTitle || t('app.planSidebarWaiting')}</span>
							{planFileRelPath || planFilePath ? (
								<span className="ref-agent-plan-doc-path">{planFileRelPath ?? planFilePath}</span>
							) : null}
						</div>
						<div className="ref-agent-plan-doc-toolbar-actions">
							<RightSidebarTabs
								t={t}
								hasPlan={hasAgentPlanSidebarContent}
								openView={openView}
								closeSidebar={closeSidebar}
							/>
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
										...modelPickerItems.map((m) => ({ value: m.id, label: m.label })),
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
									<span className="ref-agent-plan-built-chip" role="status">
										{t('app.planEditorBuilt')}
									</span>
								) : null}
							</div>
							<div className="ref-agent-plan-doc-markdown ref-agent-plan-preview-markdown">
								<ChatMarkdown content={planDocumentMarkdown} />
							</div>
							<div className="ref-agent-plan-doc-todos">
								<div className="ref-agent-plan-doc-todos-head">
									<div className="ref-agent-plan-doc-todos-title-wrap">
										<span className="ref-agent-plan-doc-todos-title">
											{t('plan.review.todo', {
												done: String(agentPlanTodoDoneCount),
												total: String(agentPlanTodos.length),
											})}
										</span>
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
												<input
													type="checkbox"
													checked={todo.status === 'completed'}
													readOnly
													tabIndex={-1}
												/>
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
						<RightSidebarTabs
							t={t}
							hasPlan={hasAgentPlanSidebarContent}
							openView={openView}
							closeSidebar={closeSidebar}
						/>
					</div>
					<div className="ref-agent-plan-status-main">
						<div className="ref-agent-plan-status-title">{t('app.planSidebarWaiting')}</div>
						<p className="ref-agent-plan-status-body">{t('app.planSidebarDescription')}</p>
					</div>
				</section>
			)}
		</div>
	);
});

const AgentRightSidebarFilePanel = memo(function AgentRightSidebarFilePanel({
	hasAgentPlanSidebarContent,
	closeSidebar,
	openView,
	agentFilePreview,
	openFileInTab,
	workspaceRoot,
	onAcceptAgentFilePreviewHunk,
	onRevertAgentFilePreviewHunk,
	agentFilePreviewBusyPatch,
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	agentFilePreview: AgentFilePreviewState | null;
	openFileInTab: AgentRightSidebarProps['openFileInTab'];
	workspaceRoot: string | null;
	onAcceptAgentFilePreviewHunk: (patch: string) => void;
	onRevertAgentFilePreviewHunk: (patch: string) => void;
	agentFilePreviewBusyPatch: string | null;
}) {
	const { shell, t } = useAppShellChromeCore();
	const agentFilePreviewTitle =
		agentFilePreview?.relPath?.split('/').pop() || agentFilePreview?.relPath || t('app.filePreview');
	const absolutePreviewPath = agentFilePreview
		? workspaceRoot
			? `${workspaceRoot.replace(/[\\/]+$/, '')}/${agentFilePreview.relPath.replace(/^[\\/]+/, '')}`
			: agentFilePreview.relPath
		: '';

	return agentFilePreview ? (
		<div className="ref-agent-review-shell">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.filePreview')}</span>
					<span className="ref-agent-review-title">{agentFilePreviewTitle}</span>
				</div>
				<RightSidebarTabs
					t={t}
					hasPlan={hasAgentPlanSidebarContent}
					openView={openView}
					closeSidebar={closeSidebar}
				/>
			</div>
			<div className="ref-right-panel-stage">
				<AgentFilePreviewPanel
					filePath={agentFilePreview.relPath}
					content={agentFilePreview.content}
					diff={agentFilePreview.diff}
					loading={agentFilePreview.loading}
					readError={agentFilePreview.readError}
					isBinary={agentFilePreview.isBinary}
					previewKind={agentFilePreview.previewKind}
					fileSize={agentFilePreview.fileSize}
					unsupportedReason={agentFilePreview.unsupportedReason}
					imageUrl={agentFilePreview.imageUrl}
					revealLine={agentFilePreview.revealLine}
					revealEndLine={agentFilePreview.revealEndLine}
					onOpenInEditor={
						agentFilePreview.isBinary || agentFilePreview.unsupportedReason
							? undefined
							: () =>
									openFileInTab(
										agentFilePreview.relPath,
										agentFilePreview.revealLine,
										agentFilePreview.revealEndLine,
										{
											diff: agentFilePreview.diff,
											allowReviewActions: agentFilePreview.reviewMode === 'snapshot',
										}
									)
					}
					onOpenWithDefault={() => {
						void shell?.invoke('shell:openDefault', agentFilePreview.relPath);
					}}
					onCopyPath={() => {
						void shell?.invoke('clipboard:writeText', absolutePreviewPath);
					}}
					onAcceptHunk={
						agentFilePreview.reviewMode === 'snapshot'
							? (patch) => onAcceptAgentFilePreviewHunk(patch)
							: undefined
					}
					onRevertHunk={
						agentFilePreview.reviewMode === 'snapshot'
							? (patch) => onRevertAgentFilePreviewHunk(patch)
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
				<RightSidebarTabs
					t={t}
					hasPlan={hasAgentPlanSidebarContent}
					openView={openView}
					closeSidebar={closeSidebar}
				/>
			</div>
			<div className="ref-right-panel-stage">
				<div className="ref-agent-plan-status-main">
					<div className="ref-agent-plan-status-title">{t('app.filePreview')}</div>
					<p className="ref-agent-plan-status-body">{t('app.selectFileToView')}</p>
				</div>
			</div>
		</div>
	);
});

type BrowserTab = {
	id: string;
	requestedUrl: string;
	currentUrl: string;
	draftUrl: string;
	pageTitle: string;
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	loadError: { message: string; url: string } | null;
};

let browserTabSeq = 0;
function createBrowserTab(url: string = BROWSER_HOME_URL): BrowserTab {
	browserTabSeq += 1;
	return {
		id: `browser-tab-${Date.now().toString(36)}-${browserTabSeq}`,
		requestedUrl: url,
		currentUrl: url,
		draftUrl: url,
		pageTitle: '',
		isLoading: true,
		canGoBack: false,
		canGoForward: false,
		loadError: null,
	};
}

const BrowserTabView = memo(
	function BrowserTabView({
		tab,
		partition,
		userAgent,
		fingerprintScript,
		active,
		t,
		onNavigate,
		onTitle,
		onLoading,
		onFailLoad,
		onRegisterWebview,
	}: {
		tab: BrowserTab;
		partition: string;
		userAgent?: string;
		fingerprintScript: string | null;
		active: boolean;
		t: TFunction;
		onNavigate: (id: string, patch: { currentUrl: string; canGoBack: boolean; canGoForward: boolean }) => void;
		onTitle: (id: string, title: string) => void;
		onLoading: (id: string, isLoading: boolean, currentUrl?: string) => void;
		onFailLoad: (id: string, error: { message: string; url: string }) => void;
		onRegisterWebview: (id: string, node: AsyncShellWebviewElement | null) => void;
	}) {
	const webviewRef = useRef<AsyncShellWebviewElement | null>(null);
	const fingerprintScriptRef = useRef<string | null>(null);
	fingerprintScriptRef.current = fingerprintScript;
	const tabIdRef = useRef(tab.id);
	const [webviewSize, setWebviewSize] = useState<{ width: number; height: number } | null>(null);
	tabIdRef.current = tab.id;

	const syncWebviewSize = useCallback(() => {
		const node = webviewRef.current;
		const host = node?.parentElement;
		if (!node || !(host instanceof HTMLElement)) {
			return;
		}
		const nextWidth = Math.max(1, Math.round(host.clientWidth));
		const nextHeight = Math.max(1, Math.round(host.clientHeight));
		setWebviewSize((prev) => {
			if (prev && prev.width === nextWidth && prev.height === nextHeight) {
				return prev;
			}
			return { width: nextWidth, height: nextHeight };
		});
	}, []);

	const assignWebviewRef = useCallback(
		(node: AsyncShellWebviewElement | null) => {
			webviewRef.current = node;
			try {
				onRegisterWebview(tabIdRef.current, node);
			} catch (err) {
				console.error('[BrowserTab] error in onRegisterWebview:', err);
			}
		},
		[onRegisterWebview]
	);

	useEffect(() => {
		const node = webviewRef.current;
		if (!node) {
			return;
		}

		const readNavState = () => {
			try {
				return {
					canGoBack: Boolean(node.canGoBack?.()),
					canGoForward: Boolean(node.canGoForward?.()),
				};
			} catch {
				return { canGoBack: false, canGoForward: false };
			}
		};

		const handleStartLoading = () => {
			onLoading(tabIdRef.current, true);
		};
		const handleStopLoading = () => {
			onLoading(tabIdRef.current, false, safeGetWebviewUrl(node));
		};
		const handleNavigate = (event: Event) => {
			const navEvent = event as BrowserNavEvent;
			if (navEvent.isMainFrame === false) {
				return;
			}
			const url = String(navEvent.url ?? safeGetWebviewUrl(node) ?? '').trim();
			const { canGoBack, canGoForward } = readNavState();
			onNavigate(tabIdRef.current, { currentUrl: url, canGoBack, canGoForward });
		};
		const handleTitleUpdated = (event: Event) => {
			onTitle(tabIdRef.current, String((event as BrowserTitleEvent).title ?? '').trim());
		};
		const handleDomReady = () => {
			const { canGoBack, canGoForward } = readNavState();
			onNavigate(tabIdRef.current, {
				currentUrl: safeGetWebviewUrl(node),
				canGoBack,
				canGoForward,
			});
			const fpScript = fingerprintScriptRef.current;
			if (fpScript) {
				void node.executeJavaScript(fpScript, false).catch(() => {
					/* ignore */
				});
			}
		};
		const handleFailLoad = (event: Event) => {
			const failEvent = event as BrowserFailEvent;
			if (failEvent.isMainFrame === false || failEvent.errorCode === -3) {
				return;
			}
			const failedUrl = String(failEvent.validatedURL ?? safeGetWebviewUrl(node) ?? '').trim();
			onFailLoad(tabIdRef.current, {
				message: String(failEvent.errorDescription ?? t('app.browserLoadFailed')),
				url: failedUrl,
			});
		};

		node.addEventListener('dom-ready', handleDomReady);
		node.addEventListener('did-start-loading', handleStartLoading);
		node.addEventListener('did-stop-loading', handleStopLoading);
		node.addEventListener('did-navigate', handleNavigate);
		node.addEventListener('did-navigate-in-page', handleNavigate);
		node.addEventListener('page-title-updated', handleTitleUpdated);
		node.addEventListener('did-fail-load', handleFailLoad);

		return () => {
			node.removeEventListener('dom-ready', handleDomReady);
			node.removeEventListener('did-start-loading', handleStartLoading);
			node.removeEventListener('did-stop-loading', handleStopLoading);
			node.removeEventListener('did-navigate', handleNavigate);
			node.removeEventListener('did-navigate-in-page', handleNavigate);
			node.removeEventListener('page-title-updated', handleTitleUpdated);
			node.removeEventListener('did-fail-load', handleFailLoad);
		};
	}, [partition, onLoading, onNavigate, onTitle, onFailLoad]);

	useEffect(() => {
		const node = webviewRef.current;
		const host = node?.parentElement;
		if (!node || !(host instanceof HTMLElement)) {
			return;
		}
		syncWebviewSize();
		let frameId = window.requestAnimationFrame(() => {
			syncWebviewSize();
		});
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(() => {
						syncWebviewSize();
					});
		observer?.observe(host);
		const onWindowResize = () => {
			syncWebviewSize();
		};
		window.addEventListener('resize', onWindowResize);
		return () => {
			window.cancelAnimationFrame(frameId);
			observer?.disconnect();
			window.removeEventListener('resize', onWindowResize);
		};
	}, [active, syncWebviewSize, tab.id]);

	const webviewProps = {
		ref: assignWebviewRef,
		className: `ref-browser-webview${active ? '' : ' is-hidden'}`,
		src: tab.requestedUrl,
		partition: partition,
		useragent: userAgent,
		style: webviewSize
			? { width: `${webviewSize.width}px`, height: `${webviewSize.height}px` }
			: { width: '100%', height: '100%' },
		onLoad: () => console.log('[BrowserTab] webview onLoad event fired'),
		allowpopups: 'true' as any,  // Electron webview expects string, not boolean
	};
	return <webview {...webviewProps} />;
},
(prevProps, nextProps) => {
	// 自定义比较：忽略 t 的变化，只比较关键属性，防止频繁卸载
	const comparisons = {
		tabIdSame: prevProps.tab.id === nextProps.tab.id,
		requestedUrlSame: prevProps.tab.requestedUrl === nextProps.tab.requestedUrl,
		currentUrlSame: prevProps.tab.currentUrl === nextProps.tab.currentUrl,
		isLoadingSame: prevProps.tab.isLoading === nextProps.tab.isLoading,
		canGoBackSame: prevProps.tab.canGoBack === nextProps.tab.canGoBack,
		canGoForwardSame: prevProps.tab.canGoForward === nextProps.tab.canGoForward,
		partitionSame: prevProps.partition === nextProps.partition,
		userAgentSame: prevProps.userAgent === nextProps.userAgent,
		fingerprintScriptSame: prevProps.fingerprintScript === nextProps.fingerprintScript,
		activeSame: prevProps.active === nextProps.active,
	};

	const same = Object.values(comparisons).every(Boolean);

	return same;
}
);

const AgentRightSidebarBrowserPanel = memo(function AgentRightSidebarBrowserPanel({
	hasAgentPlanSidebarContent,
	closeSidebar,
	openView,
	onOpenBrowserSettings,
	pendingCommand,
	onCommandHandled,
	variant = 'sidebar',
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	onOpenBrowserSettings: () => void;
	pendingCommand: BrowserControlPayload | null;
	onCommandHandled: (commandId: string) => void;
	variant?: 'sidebar' | 'window';
}) {
	const { t, shell } = useAppShellChromeCore();
	const webviewsRef = useRef<Map<string, AsyncShellWebviewElement>>(new Map());
	const addressInputRef = useRef<HTMLInputElement | null>(null);
	const defaultUserAgentRef = useRef('');

	const initialTab = useMemo(() => createBrowserTab(), []);
	const [tabs, setTabs] = useState<BrowserTab[]>([initialTab]);
	const [activeTabId, setActiveTabId] = useState<string>(initialTab.id);
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	const activeTabIdRef = useRef(activeTabId);
	activeTabIdRef.current = activeTabId;

	const [browserPartition, setBrowserPartition] = useState('');
	const [browserConfigReady, setBrowserConfigReady] = useState(false);
	const [browserConfig, setBrowserConfig] = useState<BrowserSidebarSettingsConfig>(DEFAULT_BROWSER_SIDEBAR_CONFIG);

	const applyBrowserConfigLocally = useCallback((rawConfig: Partial<BrowserSidebarSettingsConfig>, defaultUserAgent?: string) => {
		let nextConfig = DEFAULT_BROWSER_SIDEBAR_CONFIG;
		setBrowserConfig((prev) => {
			nextConfig = normalizeBrowserSidebarConfig(rawConfig, prev);
			return nextConfig;
		});
		if (typeof defaultUserAgent === 'string') {
			defaultUserAgentRef.current = defaultUserAgent.trim();
		}
		const nextUserAgent = nextConfig.userAgent.trim() || defaultUserAgentRef.current;
		webviewsRef.current.forEach((node) => {
			if (nextUserAgent) {
				try {
					node.setUserAgent(nextUserAgent);
				} catch {
					/* ignore */
				}
			}
			try {
				node.reload();
			} catch {
				/* ignore */
			}
		});
		setTabs((prev) => prev.map((tab) => ({ ...tab, loadError: null })));
	}, []);

	const waitForWebviewNode = useCallback((tabId: string, timeoutMs: number = 10_000): Promise<AsyncShellWebviewElement> => {
		const startedAt = Date.now();
		return new Promise((resolve, reject) => {
			const tick = () => {
				const node = webviewsRef.current.get(tabId);
				if (node) {
					resolve(node);
					return;
				}
				if (Date.now() - startedAt >= timeoutMs) {
					reject(new Error('Timed out waiting for browser tab to become ready.'));
					return;
				}
				window.setTimeout(tick, 50);
			};
			tick();
		});
	}, []);

	const waitForWebviewSettled = useCallback(
		(node: AsyncShellWebviewElement, tabId: string, timeoutMs: number = 15_000): Promise<void> => {
			const currentTab = tabsRef.current.find((tab) => tab.id === tabId);
			if (!currentTab?.isLoading) {
				return Promise.resolve();
			}
			return new Promise((resolve, reject) => {
				const cleanup = () => {
					window.clearTimeout(timer);
					node.removeEventListener('did-stop-loading', handleStopLoading);
					node.removeEventListener('did-fail-load', handleFailLoad);
				};
				const handleStopLoading = () => {
					cleanup();
					resolve();
				};
				const handleFailLoad = (event: Event) => {
					const failEvent = event as BrowserFailEvent;
					if (failEvent.isMainFrame === false || failEvent.errorCode === -3) {
						return;
					}
					cleanup();
					reject(new Error(String(failEvent.errorDescription ?? t('app.browserLoadFailed'))));
				};
				const timer = window.setTimeout(() => {
					cleanup();
					reject(new Error('Timed out waiting for page load to finish.'));
				}, timeoutMs);
				node.addEventListener('did-stop-loading', handleStopLoading);
				node.addEventListener('did-fail-load', handleFailLoad);
			});
		},
		[t]
	);

	const readPageFromWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector?: string; includeHtml?: boolean; maxChars?: number }
		): Promise<Record<string, unknown>> => {
			const maxChars = Math.min(Math.max(500, Math.floor(options.maxChars ?? 12_000)), 50_000);
			const script = `
				(() => {
					const args = ${JSON.stringify({
						selector: options.selector ?? '',
						includeHtml: options.includeHtml === true,
						maxChars,
					})};
					const root = args.selector ? document.querySelector(args.selector) : (document.body || document.documentElement);
					if (!root) {
						return {
							ok: false,
							error: args.selector ? 'Selector did not match any element.' : 'Page body is unavailable.',
						};
					}
					const rawText = String(root.innerText || root.textContent || '');
					const htmlText = args.includeHtml
						? String(root.outerHTML || root.innerHTML || '').slice(0, Math.min(args.maxChars, 30000))
						: '';
					const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
						.map((el) => String(el.textContent || '').trim())
						.filter(Boolean)
						.slice(0, 20);
					const links = Array.from(root.querySelectorAll('a[href]'))
						.map((el) => ({
							text: String(el.textContent || '').trim(),
							href: String(el.getAttribute('href') || '').trim(),
						}))
						.filter((item) => item.href)
						.slice(0, 20);
					const metaDescription = document.querySelector('meta[name=\"description\"]')?.getAttribute('content') || '';
					return {
						ok: true,
						url: location.href,
						title: document.title || '',
						lang: document.documentElement?.lang || '',
						selector: args.selector || null,
						metaDescription: metaDescription || '',
						text: rawText,
						totalTextLength: rawText.length,
						headings,
						links,
						html: htmlText || undefined,
					};
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed to read page content.'));
			}
			const text = normalizeBrowserExtractedText(String(result?.text ?? ''), maxChars);
			return {
				url: String(result?.url ?? safeGetWebviewUrl(node)),
				title: String(result?.title ?? ''),
				lang: String(result?.lang ?? ''),
				selector: result?.selector ?? null,
				metaDescription: String(result?.metaDescription ?? ''),
				totalTextLength: Number(result?.totalTextLength ?? text.length) || text.length,
				text,
				headings: Array.isArray(result?.headings) ? result.headings : [],
				links: Array.isArray(result?.links) ? result.links : [],
				...(options.includeHtml ? { html: String(result?.html ?? '') } : {}),
			};
		},
		[]
	);

	const clickElementInWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector: string }
		): Promise<Record<string, unknown>> => {
			const script = `
				(() => {
					const args = ${JSON.stringify({ selector: options.selector })};
					const target = document.querySelector(args.selector);
					if (!target) {
						return {
							ok: false,
							error: 'Selector did not match any element.',
						};
					}
					if (!(target instanceof HTMLElement)) {
						return {
							ok: false,
							error: 'Matched node is not an HTMLElement.',
						};
					}
					target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
					target.focus?.();
					const rect = target.getBoundingClientRect();
					const beforeUrl = location.href;
					const beforeTitle = document.title || '';
					if (typeof target.click === 'function') {
						target.click();
					} else {
						target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
					}
					return {
						ok: true,
						selector: args.selector,
						tagName: target.tagName.toLowerCase(),
						text: String(target.innerText || target.textContent || '').trim().slice(0, 500),
						href: target instanceof HTMLAnchorElement ? target.href : '',
						x: Math.round(rect.left + rect.width / 2),
						y: Math.round(rect.top + rect.height / 2),
						urlBefore: beforeUrl,
						titleBefore: beforeTitle,
						urlAfter: location.href,
						titleAfter: document.title || '',
					};
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed to click element.'));
			}
			return {
				url: String(result?.urlAfter ?? safeGetWebviewUrl(node)),
				title: String(result?.titleAfter ?? ''),
				selector: String(result?.selector ?? options.selector),
				tagName: String(result?.tagName ?? ''),
				text: String(result?.text ?? ''),
				href: String(result?.href ?? ''),
				clickPoint: {
					x: Number(result?.x ?? 0) || 0,
					y: Number(result?.y ?? 0) || 0,
				},
				urlBefore: String(result?.urlBefore ?? ''),
				urlAfter: String(result?.urlAfter ?? safeGetWebviewUrl(node)),
			};
		},
		[]
	);

	const inputTextInWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector: string; text: string; pressEnter?: boolean }
		): Promise<Record<string, unknown>> => {
			const script = `
				(() => {
					const args = ${JSON.stringify({
						selector: options.selector,
						text: options.text,
						pressEnter: options.pressEnter === true,
					})};
					const target = document.querySelector(args.selector);
					if (!target) {
						return {
							ok: false,
							error: 'Selector did not match any element.',
						};
					}
					if (!(target instanceof HTMLElement)) {
						return {
							ok: false,
							error: 'Matched node is not an HTMLElement.',
						};
					}
					const dispatchInput = (el) => {
						el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
						el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
					};
					const setNativeValue = (el, value) => {
						const proto =
							el instanceof HTMLTextAreaElement
								? HTMLTextAreaElement.prototype
								: el instanceof HTMLInputElement
									? HTMLInputElement.prototype
									: el instanceof HTMLSelectElement
										? HTMLSelectElement.prototype
										: null;
						const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
						if (descriptor?.set) {
							descriptor.set.call(el, value);
						} else {
							el.value = value;
						}
					};
					target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
					target.focus?.();
					let mode = 'unknown';
					if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
						setNativeValue(target, args.text);
						dispatchInput(target);
						mode = target instanceof HTMLTextAreaElement ? 'textarea' : target instanceof HTMLSelectElement ? 'select' : 'input';
					} else if (target.isContentEditable) {
						target.textContent = args.text;
						dispatchInput(target);
						mode = 'contenteditable';
					} else if ('value' in target) {
						try {
							target.value = args.text;
							dispatchInput(target);
							mode = 'value-property';
						} catch {
							target.textContent = args.text;
							dispatchInput(target);
							mode = 'textContent';
						}
					} else {
						target.textContent = args.text;
						dispatchInput(target);
						mode = 'textContent';
					}
					if (args.pressEnter) {
						const keyboardInit = {
							key: 'Enter',
							code: 'Enter',
							keyCode: 13,
							which: 13,
							bubbles: true,
							cancelable: true,
						};
						target.dispatchEvent(new KeyboardEvent('keydown', keyboardInit));
						target.dispatchEvent(new KeyboardEvent('keypress', keyboardInit));
						target.dispatchEvent(new KeyboardEvent('keyup', keyboardInit));
						const form = target.closest('form');
						if (form instanceof HTMLFormElement) {
							if (typeof form.requestSubmit === 'function') {
								form.requestSubmit();
							} else {
								form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
							}
						}
					}
					const value =
						target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
							? target.value
							: target.isContentEditable
								? String(target.textContent || '')
								: 'value' in target
									? String(target.value ?? '')
									: String(target.textContent || '');
					return {
						ok: true,
						selector: args.selector,
						mode,
						tagName: target.tagName.toLowerCase(),
						value,
						pressEnter: args.pressEnter,
						url: location.href,
						title: document.title || '',
					};
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed to input text.'));
			}
			return {
				url: String(result?.url ?? safeGetWebviewUrl(node)),
				title: String(result?.title ?? ''),
				selector: String(result?.selector ?? options.selector),
				mode: String(result?.mode ?? ''),
				tagName: String(result?.tagName ?? ''),
				value: String(result?.value ?? options.text),
				pressEnter: result?.pressEnter === true,
			};
		},
		[]
	);

	const waitForSelectorInWebview = useCallback(
		async (
			node: AsyncShellWebviewElement,
			options: { selector: string; visible?: boolean; timeoutMs?: number }
		): Promise<Record<string, unknown>> => {
			const timeoutMs = Math.min(Math.max(500, Math.floor(options.timeoutMs ?? 20_000)), 60_000);
			const script = `
				(() => {
					const args = ${JSON.stringify({
						selector: options.selector,
						visible: options.visible === true,
						timeoutMs,
					})};
					const root = document.documentElement || document.body;
					if (!root) {
						return Promise.resolve({
							ok: false,
							error: 'Document root is unavailable.',
						});
					}
					const isVisible = (el) => {
						if (!(el instanceof HTMLElement)) {
							return false;
						}
						const style = window.getComputedStyle(el);
						if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
							return false;
						}
						const rect = el.getBoundingClientRect();
						return rect.width > 0 && rect.height > 0;
					};
					const snapshot = (el) => {
						const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : { width: 0, height: 0 };
						return {
							ok: true,
							selector: args.selector,
							tagName: el instanceof Element ? el.tagName.toLowerCase() : '',
							text: el instanceof Element ? String(el.innerText || el.textContent || '').trim().slice(0, 500) : '',
							visible: isVisible(el),
							url: location.href,
							title: document.title || '',
							width: Math.round(rect.width || 0),
							height: Math.round(rect.height || 0),
						};
					};
					const findMatch = () => {
						const el = document.querySelector(args.selector);
						if (!el) {
							return null;
						}
						if (args.visible && !isVisible(el)) {
							return null;
						}
						return el;
					};
					const immediate = findMatch();
					if (immediate) {
						return Promise.resolve(snapshot(immediate));
					}
					return new Promise((resolve) => {
						const observer = new MutationObserver(() => {
							const match = findMatch();
							if (!match) {
								return;
							}
							cleanup();
							resolve(snapshot(match));
						});
						const cleanup = () => {
							window.clearTimeout(timer);
							observer.disconnect();
						};
						const timer = window.setTimeout(() => {
							cleanup();
							resolve({
								ok: false,
								error: args.visible
									? 'Timed out waiting for a visible element matching the selector.'
									: 'Timed out waiting for an element matching the selector.',
							});
						}, args.timeoutMs);
						observer.observe(root, {
							childList: true,
							subtree: true,
							attributes: true,
							attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
						});
					});
				})()
			`;
			const result = await node.executeJavaScript<Record<string, unknown>>(script, true);
			if (result?.ok === false) {
				throw new Error(String(result.error ?? 'Failed while waiting for selector.'));
			}
			return {
				url: String(result?.url ?? safeGetWebviewUrl(node)),
				title: String(result?.title ?? ''),
				selector: String(result?.selector ?? options.selector),
				tagName: String(result?.tagName ?? ''),
				text: String(result?.text ?? ''),
				visible: result?.visible === true,
				size: {
					width: Number(result?.width ?? 0) || 0,
					height: Number(result?.height ?? 0) || 0,
				},
				timeoutMs,
			};
		},
		[]
	);

	const captureWebviewScreenshot = useCallback(async (node: AsyncShellWebviewElement): Promise<Record<string, unknown>> => {
		const image = await node.capturePage();
		const size = image.getSize();
		return {
			url: safeGetWebviewUrl(node),
			title: tabsRef.current.find((tab) => webviewsRef.current.get(tab.id) === node)?.pageTitle ?? '',
			width: size.width,
			height: size.height,
			dataUrl: image.toDataURL(),
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		if (!shell) {
			setBrowserPartition('async-agent-browser-fallback');
			setBrowserConfigReady(true);
			return () => {
				cancelled = true;
			};
		}
		void shell
			.invoke('browser:getConfig')
			.then((payload) => {
				if (cancelled) {
					return;
				}
				const response = payload as {
					ok?: boolean;
					partition?: string;
					config?: Partial<BrowserSidebarSettingsConfig>;
					defaultUserAgent?: string;
				};
				if (response.ok && response.partition) {
					const nextConfig = normalizeBrowserSidebarConfig(response.config);
					setBrowserPartition(response.partition);
					setBrowserConfig(nextConfig);
					defaultUserAgentRef.current = String(response.defaultUserAgent ?? '').trim();
				} else {
					setBrowserPartition('async-agent-browser-fallback');
				}
				setBrowserConfigReady(true);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setBrowserPartition('async-agent-browser-fallback');
				setBrowserConfigReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [shell]);

	const handleRegisterWebview = useCallback((id: string, node: AsyncShellWebviewElement | null) => {
		if (node) {
			webviewsRef.current.set(id, node);
			if (!defaultUserAgentRef.current) {
				try {
					defaultUserAgentRef.current = String(node.getUserAgent?.() ?? '').trim();
				} catch {
					/* ignore */
				}
			}
		} else {
			webviewsRef.current.delete(id);
		}
	}, []);

	const handleTabNavigate = useCallback(
		(id: string, patch: { currentUrl: string; canGoBack: boolean; canGoForward: boolean }) => {
			const addressFocused =
				typeof document !== 'undefined' && document.activeElement === addressInputRef.current;
			const keepDraft = id === activeTabIdRef.current && addressFocused;
			setTabs((prev) =>
				prev.map((tab) => {
					if (tab.id !== id) {
						return tab;
					}
					const resolvedUrl = patch.currentUrl || tab.currentUrl;
					return {
						...tab,
						currentUrl: resolvedUrl,
						draftUrl: keepDraft ? tab.draftUrl : resolvedUrl,
						canGoBack: patch.canGoBack,
						canGoForward: patch.canGoForward,
						loadError: null,
					};
				})
			);
		},
		[]
	);

	const handleTabTitle = useCallback((id: string, title: string) => {
		setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, pageTitle: title } : tab)));
	}, []);

	const handleTabLoading = useCallback((id: string, isLoading: boolean, currentUrl?: string) => {
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== id) {
					return tab;
				}
				const next: BrowserTab = { ...tab, isLoading };
				if (isLoading) {
					next.loadError = null;
				} else if (currentUrl && currentUrl !== tab.currentUrl) {
					const addressFocused =
						typeof document !== 'undefined' && document.activeElement === addressInputRef.current;
					const keepDraft = id === activeTabIdRef.current && addressFocused;
					next.currentUrl = currentUrl;
					if (!keepDraft) {
						next.draftUrl = currentUrl;
					}
				}
				return next;
			})
		);
	}, []);

	const handleTabFailLoad = useCallback((id: string, error: { message: string; url: string }) => {
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== id) {
					return tab;
				}
				return {
					...tab,
					isLoading: false,
					currentUrl: error.url || tab.currentUrl,
					loadError: error,
				};
			})
		);
	}, []);

	const openInNewTab = useCallback((url: string) => {
		const trimmed = String(url ?? '').trim();
		if (!trimmed) {
			return;
		}
		const tab = createBrowserTab(trimmed);
		setTabs((prev) => [...prev, tab]);
		setActiveTabId(tab.id);
	}, []);

	const navigateTab = useCallback((tabId: string, rawTarget: string) => {
		const nextUrl = normalizeBrowserTarget(rawTarget);
		const prevTab = tabsRef.current.find((tab) => tab.id === tabId) ?? null;
		const sameAsRequested = prevTab?.requestedUrl === nextUrl;
		setActiveTabId(tabId);
		setTabs((prev) =>
			prev.map((tab) => {
				if (tab.id !== tabId) {
					return tab;
				}
				return {
					...tab,
					requestedUrl: nextUrl,
					currentUrl: nextUrl,
					draftUrl: nextUrl,
					pageTitle: '',
					isLoading: true,
					canGoBack: false,
					canGoForward: false,
					loadError: null,
				};
			})
		);
		if (sameAsRequested) {
			webviewsRef.current.get(tabId)?.reload();
		}
	}, []);

	// Subscribe to main-process forwarded new-window events for webview contents.
	// Electron 12+ deprecated the 'new-window' event; the host (this webContents)
	// receives 'async-shell:browserNewWindow' from web-contents-created hook in main.
	useEffect(() => {
		const subscribe = shell?.subscribeBrowserNewWindow;
		if (!subscribe) {
			return;
		}
		const unsubscribe = subscribe((payload) => {
			openInNewTab(String(payload?.url ?? ''));
		});
		return () => {
			unsubscribe?.();
		};
	}, [shell, openInNewTab]);

	const addNewTab = useCallback(() => {
		const tab = createBrowserTab();
		setTabs((prev) => [...prev, tab]);
		setActiveTabId(tab.id);
		window.setTimeout(() => {
			addressInputRef.current?.focus();
			addressInputRef.current?.select();
		}, 50);
	}, []);

	const closeTab = useCallback((id: string) => {
		const prev = tabsRef.current;
		const closedIndex = prev.findIndex((tab) => tab.id === id);
		if (closedIndex < 0) {
			return;
		}
		webviewsRef.current.delete(id);
		if (prev.length <= 1) {
			if (variant === 'window') {
				closeSidebar();
				return;
			}
			const fresh = createBrowserTab();
			setTabs([fresh]);
			setActiveTabId(fresh.id);
			return;
		}
		const nextTabs = prev.filter((tab) => tab.id !== id);
		setTabs(nextTabs);
		if (activeTabIdRef.current === id) {
			const nextActive = nextTabs[Math.min(closedIndex, nextTabs.length - 1)];
			setActiveTabId(nextActive.id);
		}
	}, []);

	const activateTab = useCallback((id: string) => {
		setActiveTabId(id);
	}, []);

	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
	const activeWebview = () => (activeTab ? webviewsRef.current.get(activeTab.id) ?? null : null);

	const onAddressChange = useCallback(
		(value: string) => {
			setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, draftUrl: value } : tab)));
		},
		[activeTabId]
	);

	const onAddressSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!activeTab) {
				return;
			}
			addressInputRef.current?.blur();
			navigateTab(activeTabId, activeTab.draftUrl);
		},
		[activeTab, activeTabId, navigateTab]
	);

	const onAddressKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				if (activeTab) {
					setTabs((prev) =>
						prev.map((tab) => (tab.id === activeTabId ? { ...tab, draftUrl: tab.currentUrl } : tab))
					);
				}
				event.currentTarget.blur();
			}
		},
		[activeTab, activeTabId]
	);

	useEffect(() => {
		const onSync = (event: Event) => {
			const detail = browserSidebarConfigSyncDetail(event);
			if (!detail) {
				return;
			}
			applyBrowserConfigLocally(detail.config, detail.defaultUserAgent);
		};
		window.addEventListener(BROWSER_SIDEBAR_CONFIG_SYNC_EVENT, onSync);
		return () => {
			window.removeEventListener(BROWSER_SIDEBAR_CONFIG_SYNC_EVENT, onSync);
		};
	}, [applyBrowserConfigLocally]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		const payload = {
			activeTabId,
			tabs: tabs.map((tab) => ({
				id: tab.id,
				requestedUrl: tab.requestedUrl,
				currentUrl: tab.currentUrl,
				pageTitle: tab.pageTitle,
				isLoading: tab.isLoading,
				canGoBack: tab.canGoBack,
				canGoForward: tab.canGoForward,
				loadError: tab.loadError,
			})),
			guestBindings: tabs
				.map((tab) => {
					const node = webviewsRef.current.get(tab.id);
					if (!node?.getWebContentsId) {
						return null;
					}
					try {
						const webContentsId = Number(node.getWebContentsId());
						if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
							return null;
						}
						return {
							tabId: tab.id,
							webContentsId,
						};
					} catch {
						return null;
					}
				})
				.filter((binding): binding is { tabId: string; webContentsId: number } => Boolean(binding)),
			updatedAt: Date.now(),
		};
		const timer = window.setTimeout(() => {
			void shell.invoke('browser:syncState', payload).catch(() => {
				/* ignore */
			});
		}, 40);
		return () => {
			window.clearTimeout(timer);
		};
	}, [activeTabId, shell, tabs]);

	useEffect(() => {
		if (!pendingCommand) {
			return;
		}
		const command = pendingCommand;
		const finish = () => onCommandHandled(command.commandId);
		if (command.type === 'navigate') {
			const activeId = activeTabIdRef.current;
			const hasActiveTab = Boolean(activeId && tabsRef.current.some((tab) => tab.id === activeId));
			if (command.newTab || !hasActiveTab || !activeId) {
				openInNewTab(normalizeBrowserTarget(command.target));
			} else {
				navigateTab(activeId, command.target);
			}
			finish();
			return;
		}
		if (command.type === 'applyConfig') {
			applyBrowserConfigLocally(command.config, command.defaultUserAgent);
			finish();
			return;
		}
		if (command.type === 'closeSidebar') {
			finish();
			return;
		}
		void (async () => {
			const targetTabId =
				command.tabId && tabsRef.current.some((tab) => tab.id === command.tabId)
					? command.tabId
					: activeTabIdRef.current;
			if (!targetTabId) {
				if (
					command.type === 'readPage' ||
					command.type === 'screenshotPage' ||
					command.type === 'clickElement' ||
					command.type === 'inputText' ||
					command.type === 'waitForSelector'
				) {
					await notifyBrowserCommandResult(shell, {
						commandId: command.commandId,
						ok: false,
						error: 'No active browser tab is available.',
					});
				}
				finish();
				return;
			}
			if (command.type === 'closeTab') {
				closeTab(targetTabId);
				finish();
				return;
			}
			setActiveTabId(targetTabId);
			if (
				command.type === 'readPage' ||
				command.type === 'screenshotPage' ||
				command.type === 'clickElement' ||
				command.type === 'inputText' ||
				command.type === 'waitForSelector'
			) {
				try {
					const node = await waitForWebviewNode(targetTabId);
					if (command.waitForLoad !== false) {
						await waitForWebviewSettled(node, targetTabId);
					}
					if (command.type === 'readPage') {
						const result = await readPageFromWebview(node, {
							selector: command.selector,
							includeHtml: command.includeHtml,
							maxChars: command.maxChars,
						});
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else if (command.type === 'clickElement') {
						const result = await clickElementInWebview(node, {
							selector: command.selector,
						});
						if (command.waitForLoad !== false) {
							await new Promise((resolve) => window.setTimeout(resolve, 60));
							await waitForWebviewSettled(node, targetTabId);
						}
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else if (command.type === 'inputText') {
						const result = await inputTextInWebview(node, {
							selector: command.selector,
							text: command.text,
							pressEnter: command.pressEnter,
						});
						if (command.waitForLoad !== false && command.pressEnter) {
							await new Promise((resolve) => window.setTimeout(resolve, 60));
							await waitForWebviewSettled(node, targetTabId);
						}
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else if (command.type === 'waitForSelector') {
						const result = await waitForSelectorInWebview(node, {
							selector: command.selector,
							visible: command.visible,
							timeoutMs: command.timeoutMs,
						});
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					} else {
						const result = await captureWebviewScreenshot(node);
						await notifyBrowserCommandResult(shell, {
							commandId: command.commandId,
							ok: true,
							result,
						});
					}
				} catch (error) {
					await notifyBrowserCommandResult(shell, {
						commandId: command.commandId,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					});
				} finally {
					finish();
				}
				return;
			}
			const node = webviewsRef.current.get(targetTabId);
			if (command.type === 'reload') {
				setTabs((prev) => prev.map((tab) => (tab.id === targetTabId ? { ...tab, loadError: null } : tab)));
				node?.reload();
			} else if (command.type === 'stop') {
				node?.stop();
			} else if (command.type === 'goBack') {
				if (node?.canGoBack()) {
					node.goBack();
				}
			} else if (command.type === 'goForward' && node?.canGoForward()) {
				node.goForward();
			}
			finish();
		})();
	}, [
		applyBrowserConfigLocally,
		captureWebviewScreenshot,
		clickElementInWebview,
		closeTab,
		inputTextInWebview,
		navigateTab,
		onCommandHandled,
		openInNewTab,
		pendingCommand,
		readPageFromWebview,
		shell,
		waitForSelectorInWebview,
		waitForWebviewNode,
		waitForWebviewSettled,
	]);

	const headerLabel = activeTab
		? activeTab.isLoading
			? t('app.browserLoading')
			: activeTab.pageTitle || activeTab.currentUrl.replace(/^https?:\/\//i, '') || t('app.tabBrowser')
		: t('app.tabBrowser');
	const headerUrl = activeTab?.currentUrl ?? '';
	const userAgentProp = browserConfig.userAgent.trim() || undefined;
	const fingerprintPayloadKey = useMemo(() => JSON.stringify(browserConfig.fingerprint), [browserConfig.fingerprint]);
	const fingerprintScript = useMemo(() => {
		const patch = fingerprintSettingsToInjectPatch(browserConfig.fingerprint);
		return buildBrowserFingerprintStealthScript(patch);
	}, [fingerprintPayloadKey]);

	return (
		<div className="ref-agent-review-shell">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.tabBrowser')}</span>
					<span className="ref-agent-review-title" title={headerUrl}>
						{headerLabel}
					</span>
				</div>
				{variant === 'window' ? (
					<div className="ref-agent-review-actions">
						<button
							type="button"
							aria-label={t('app.browserOpenSettingsInMain')}
							title={t('app.browserOpenSettingsInMain')}
							className="ref-right-icon-tab"
							onClick={onOpenBrowserSettings}
						>
							<IconSettings />
						</button>
					</div>
				) : (
					<RightSidebarTabs
						t={t}
						hasPlan={hasAgentPlanSidebarContent}
						openView={openView}
						closeSidebar={closeSidebar}
						extraActions={
							<button
								type="button"
								aria-label={t('app.browserSettings')}
								title={t('app.browserSettings')}
								className="ref-right-icon-tab"
								onClick={onOpenBrowserSettings}
							>
								<IconSettings />
							</button>
						}
					/>
				)}
			</div>
			<div className="ref-right-panel-stage">
				<div className="ref-right-panel-view ref-right-panel-view--agent ref-browser-panel">
					{browserConfigReady ? (
						<div className="ref-browser-tabstrip" role="tablist" aria-label={t('app.tabBrowser')}>
							<div className="ref-browser-tabstrip-scroll">
								{tabs.map((tab) => {
									const tabActive = tab.id === activeTabId;
									const tabLabel =
										(tab.pageTitle && tab.pageTitle.trim()) ||
										(tab.currentUrl ? tab.currentUrl.replace(/^https?:\/\//i, '') : '') ||
										t('app.browserUntitled');
									return (
										<div
											key={tab.id}
											role="tab"
											aria-selected={tabActive}
											tabIndex={0}
											className={`ref-browser-tab${tabActive ? ' is-active' : ''}`}
											title={tab.currentUrl || tabLabel}
											onClick={() => activateTab(tab.id)}
											onKeyDown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													activateTab(tab.id);
												}
											}}
											onMouseDown={(event) => {
												// middle-click closes tab, like real browsers
												if (event.button === 1) {
													event.preventDefault();
													closeTab(tab.id);
												}
											}}
										>
											<span className="ref-browser-tab-indicator" aria-hidden="true">
												{tab.isLoading ? (
													<span className="ref-browser-tab-spinner" />
												) : (
													<IconGlobe className="ref-browser-tab-favicon" />
												)}
											</span>
											<span className="ref-browser-tab-label">{tabLabel}</span>
											<button
												type="button"
												className="ref-browser-tab-close"
												aria-label={t('app.browserCloseTab')}
												title={t('app.browserCloseTab')}
												onClick={(event) => {
													event.stopPropagation();
													closeTab(tab.id);
												}}
											>
												<IconCloseSmall />
											</button>
										</div>
									);
								})}
							</div>
							<button
								type="button"
								className="ref-browser-tabstrip-add"
								aria-label={t('app.browserNewTab')}
								title={t('app.browserNewTab')}
								onClick={addNewTab}
							>
								<IconPlus />
							</button>
						</div>
					) : null}
					<div className="ref-right-toolbar ref-browser-toolbar">
						<button
							type="button"
							className="ref-icon-tile ref-browser-tool-btn"
							aria-label={t('common.back')}
							title={t('common.back')}
							disabled={!activeTab?.canGoBack}
							onClick={() => {
								const node = activeWebview();
								if (!node?.canGoBack()) {
									return;
								}
								node.goBack();
							}}
						>
							<IconArrowLeft />
						</button>
						<button
							type="button"
							className="ref-icon-tile ref-browser-tool-btn"
							aria-label={t('app.browserForward')}
							title={t('app.browserForward')}
							disabled={!activeTab?.canGoForward}
							onClick={() => {
								const node = activeWebview();
								if (!node?.canGoForward()) {
									return;
								}
								node.goForward();
							}}
						>
							<IconArrowRight />
						</button>
						<form className="ref-browser-address-form" onSubmit={onAddressSubmit}>
							<IconGlobe className="ref-browser-address-icon" />
							<input
								ref={addressInputRef}
								type="text"
								className="ref-browser-address-input"
								value={activeTab?.draftUrl ?? ''}
								placeholder={t('app.browserAddressPlaceholder')}
								spellCheck={false}
								autoCapitalize="none"
								autoCorrect="off"
								onChange={(event) => onAddressChange(event.target.value)}
								onFocus={(event) => event.currentTarget.select()}
								onKeyDown={onAddressKeyDown}
							/>
						</form>
						<button
							type="button"
							className="ref-icon-tile ref-browser-tool-btn"
							aria-label={activeTab?.isLoading ? t('app.browserStop') : t('common.refresh')}
							title={activeTab?.isLoading ? t('app.browserStop') : t('common.refresh')}
							onClick={() => {
								const node = activeWebview();
								if (!node) {
									return;
								}
								if (activeTab?.isLoading) {
									node.stop();
									return;
								}
								setTabs((prev) =>
									prev.map((tab) => (tab.id === activeTabId ? { ...tab, loadError: null } : tab))
								);
								node.reload();
							}}
						>
							{activeTab?.isLoading ? <IconStop /> : <IconRefresh />}
						</button>
					</div>
					<div className="ref-browser-webview-wrap">
						{browserConfigReady && browserPartition ? (
							tabs.map((tab) => (
								<BrowserTabView
										key={tab.id}
										tab={tab}
										partition={browserPartition}
										userAgent={userAgentProp}
										fingerprintScript={fingerprintScript}
										active={tab.id === activeTabId}
										t={t}
										onNavigate={handleTabNavigate}
										onTitle={handleTabTitle}
										onLoading={handleTabLoading}
										onFailLoad={handleTabFailLoad}
										onRegisterWebview={handleRegisterWebview}
									/>
							))
						) : (
							<div className="ref-browser-preparing">
								<div className="ref-agent-plan-status-title">{t('app.browserPreparing')}</div>
								<p className="ref-agent-plan-status-body">{t('app.browserSettingsDescription')}</p>
							</div>
						)}
						{activeTab?.loadError ? (
							<div className="ref-browser-error-card" role="status">
								<div className="ref-browser-error-title">{t('app.browserLoadFailed')}</div>
								<p className="ref-browser-error-body">{activeTab.loadError.message}</p>
								{activeTab.loadError.url ? (
									<p className="ref-browser-error-url" title={activeTab.loadError.url}>
										{activeTab.loadError.url}
									</p>
								) : null}
								<button
									type="button"
									className="ref-browser-error-btn"
									onClick={() => {
										const tabId = activeTabId;
										setTabs((prev) =>
											prev.map((tab) => (tab.id === tabId ? { ...tab, loadError: null } : tab))
										);
										webviewsRef.current.get(tabId)?.reload();
									}}
								>
									{t('common.refresh')}
								</button>
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
});

export const AgentBrowserWindowSurface = memo(function AgentBrowserWindowSurface() {
	const { shell } = useAppShellChromeCore();
	const [pendingBrowserCommands, setPendingBrowserCommands] = useState<BrowserControlPayload[]>([]);

	const openBrowserSettingsInHost = useCallback(() => {
		void shell?.invoke('app:requestOpenSettings', { nav: 'browser' }).catch(() => {
			/* ignore */
		});
	}, [shell]);

	useEffect(() => {
		hideBootSplash();
	}, []);

	const closeWindow = useCallback(() => {
		void shell?.invoke('app:windowClose').catch(() => {
			/* ignore */
		});
	}, [shell]);

	useEffect(() => {
		const subscribe = shell?.subscribeBrowserControl;
		if (!subscribe) {
			return;
		}
		const unsubscribe = subscribe((payload) => {
			if (!isBrowserControlPayload(payload)) {
				return;
			}
			if (payload.type === 'closeSidebar') {
				closeWindow();
				return;
			}
			setPendingBrowserCommands((prev) => [...prev, payload]);
		});
		return () => {
			unsubscribe?.();
		};
	}, [closeWindow, shell]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		void shell.invoke('browser:windowReady').catch(() => {
			/* ignore */
		});
	}, [shell]);

	const handleBrowserCommandHandled = useCallback((commandId: string) => {
		setPendingBrowserCommands((prev) => prev.filter((command) => command.commandId !== commandId));
	}, []);

	return (
		<div className="ref-browser-window-root">
			<AgentRightSidebarBrowserPanel
				hasAgentPlanSidebarContent={false}
				closeSidebar={closeWindow}
				openView={() => {}}
				onOpenBrowserSettings={openBrowserSettingsInHost}
				pendingCommand={pendingBrowserCommands[0] ?? null}
				onCommandHandled={handleBrowserCommandHandled}
				variant="window"
			/>
		</div>
	);
});

const COMMIT_PREV_BRANCH_KEY = 'voidShell.commitModal.prevBranch.v1';

function isMeaningfulGitBranch(branch: string | undefined): branch is string {
	const b = String(branch ?? '').trim();
	return b.length > 0 && b !== '—';
}

function readPreviousCommitBranch(threadId: string | null): string | undefined {
	if (!threadId || typeof window === 'undefined') {
		return undefined;
	}
	try {
		const raw = window.localStorage.getItem(COMMIT_PREV_BRANCH_KEY);
		if (!raw) {
			return undefined;
		}
		const parsed = JSON.parse(raw) as Record<string, string>;
		const value = parsed?.[threadId];
		return isMeaningfulGitBranch(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function writePreviousCommitBranch(threadId: string | null, branch: string): void {
	if (!threadId || typeof window === 'undefined' || !branch) {
		return;
	}
	try {
		const raw = window.localStorage.getItem(COMMIT_PREV_BRANCH_KEY);
		const map: Record<string, string> = raw ? JSON.parse(raw) : {};
		map[threadId] = branch;
		window.localStorage.setItem(COMMIT_PREV_BRANCH_KEY, JSON.stringify(map));
	} catch {
		/* ignore quota / parse errors */
	}
}

function ensurePreviousCommitBranch(threadId: string | null, branch: string): void {
	if (!isMeaningfulGitBranch(branch) || readPreviousCommitBranch(threadId)) {
		return;
	}
	writePreviousCommitBranch(threadId, branch);
}

/** xy[0] 是 index 段；非空格非 '?' 即视为已暂存 */
function isStagedXy(xy: string | undefined): boolean {
	const i = xy?.[0] ?? ' ';
	return i !== ' ' && i !== '?';
}

/** Git 面板：只订阅 AppShell Git/Chrome context，父级因消息/流式重渲时若 Git 切片未变则可跳过本 subtree。 */
const AgentRightSidebarGitPanel = memo(function AgentRightSidebarGitPanel({
	hasAgentPlanSidebarContent,
	gitViewActive,
	openView,
	closeSidebar,
	onOpenGitDiff,
	commitMsg,
	setCommitMsg,
	onCommit,
	currentThreadId,
}: {
	hasAgentPlanSidebarContent: boolean;
	gitViewActive: boolean;
	openView: (view: AgentRightSidebarView) => void;
	closeSidebar: () => void;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	commitMsg: string;
	setCommitMsg: Dispatch<SetStateAction<string>>;
	onCommit: (
		action: CommitAction,
		options: { includeUnstaged: boolean; isDraft: boolean; message: string }
	) => Promise<{ ok: boolean; error?: string; prUrl?: string }>;
	currentThreadId: string | null;
}) {
	const { t } = useAppShellChromeCore();
	const {
		gitBranch,
		gitLines,
		gitPathStatus,
		gitChangedPaths,
		gitStatusOk,
		diffPreviews,
		diffLoading,
		gitActionError,
		refreshGit,
		diffTotals,
		loadGitDiffPreviews,
	} = useAppShellGit();
	const { openSettingsPageBase } = useAppShellSettings();

	const changeCount = gitChangedPaths.length;
	const stagedCount = useMemo(
		() => gitChangedPaths.reduce((acc, p) => (isStagedXy(gitPathStatus[p]?.xy) ? acc + 1 : acc), 0),
		[gitChangedPaths, gitPathStatus]
	);
	const gitUnavailableReason: GitUnavailableReason = gitStatusOk
		? 'none'
		: classifyGitUnavailableReason(gitLines[0]);
	const hasMissingGitPreviews = gitChangedPaths.some((path) => diffPreviews[path] == null);
	const showCompleteDiffTotals = !diffLoading && !hasMissingGitPreviews;

	useEffect(() => {
		if (gitViewActive) {
			void refreshGit();
		}
	}, [gitViewActive, refreshGit]);

	const [showCommitModal, setShowCommitModal] = useState(false);
	const previousBranch = useMemo(
		() => (showCommitModal ? readPreviousCommitBranch(currentThreadId) : undefined),
		[showCommitModal, currentThreadId]
	);
	const gitTitle =
		changeCount > 0 ? t('app.gitUncommitted', { count: String(changeCount) }) : t('app.gitNoChanges');

	useEffect(() => {
		ensurePreviousCommitBranch(currentThreadId, gitBranch);
	}, [currentThreadId, gitBranch]);

	const handleCommit = useCallback(
		async (
			action: CommitAction,
			options: { includeUnstaged: boolean; isDraft: boolean; message: string }
		) => {
			const result = await onCommit(action, options);
			if (result.ok) {
				if (isMeaningfulGitBranch(gitBranch)) {
					writePreviousCommitBranch(currentThreadId, gitBranch);
				}
			}
			return result;
		},
		[onCommit, gitBranch, currentThreadId]
	);

	const handleOpenCustomInstructions = useCallback(() => {
		openSettingsPageBase('rules');
	}, [openSettingsPageBase]);

	return (
		<div className="ref-agent-review-shell">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.tabGit')}</span>
					<span className="ref-agent-review-title">{gitTitle}</span>
				</div>
				<div className="ref-agent-review-actions">
					{gitUnavailableReason === 'none' && changeCount > 0 && (
						<button
							type="button"
							className="ref-git-commit-btn-top"
							onClick={() => setShowCommitModal(true)}
						>
							<IconGitSCM />
							<span>{t('app.commit')}</span>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
								<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
							</svg>
						</button>
					)}
					<RightSidebarTabs
						t={t}
						hasPlan={hasAgentPlanSidebarContent}
						openView={openView}
						closeSidebar={closeSidebar}
					/>
				</div>
			</div>
			<div className="ref-right-panel-stage">
				<div className="ref-right-panel-view ref-right-panel-view--agent">
					<div className="ref-right-git-stack">
						<div className="ref-right-toolbar">
							<button
								type="button"
								className="ref-icon-tile"
								aria-label={t('app.gitRefreshAria')}
								onClick={() => void refreshGit()}
							>
								<IconRefresh />
							</button>
							<span className="ref-local-label">{t('app.gitLocal')}</span>
							<span className="ref-branch-chip">{gitBranch || '—'}</span>
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
							{gitUnavailableReason === 'none' && showCompleteDiffTotals && diffTotals.additions > 0 ? (
								<span className="ref-git-stat-add">+{diffTotals.additions}</span>
							) : null}
							{gitUnavailableReason === 'none' && showCompleteDiffTotals && diffTotals.deletions > 0 ? (
								<span className="ref-git-stat-del">-{diffTotals.deletions}</span>
							) : null}
						</div>
						<div className="ref-git-body">
							{gitUnavailableReason !== 'none' ? (
								<GitUnavailableState t={t} reason={gitUnavailableReason} detail={gitLines[0] ?? ''} />
							) : changeCount > 0 ? (
								<AgentGitScmChangedCards
									paths={gitChangedPaths}
									diffPreviews={diffPreviews}
									gitPathStatus={gitPathStatus}
									diffLoading={diffLoading}
									t={t}
									onOpenGitDiff={onOpenGitDiff}
									onEnsurePreviews={(paths) => {
										void loadGitDiffPreviews(paths);
									}}
								/>
							) : null}
							{gitUnavailableReason === 'none' && gitActionError ? (
								<p className="ref-git-action-error">{gitActionError}</p>
							) : null}
						</div>
					</div>
				</div>
			</div>

			{showCommitModal ? (
				<CommitModal
					t={t}
					gitBranch={gitBranch}
					changeCount={changeCount}
					stagedCount={stagedCount}
					diffTotals={diffTotals}
					diffLoading={!showCompleteDiffTotals}
					commitMsg={commitMsg}
					setCommitMsg={setCommitMsg}
					onClose={() => setShowCommitModal(false)}
					onCommit={handleCommit}
					onOpenCustomInstructions={handleOpenCustomInstructions}
					previousBranch={previousBranch}
				/>
			) : null}
		</div>
	);
});

export const AgentRightSidebar = memo(function AgentRightSidebar({
	open,
	view,
	hasAgentPlanSidebarContent,
	closeSidebar,
	openView,
	onOpenBrowserSettings,
	planPreviewTitle,
	planPreviewMarkdown,
	planDocumentMarkdown,
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
	onOpenGitDiff,
	commitMsg,
	setCommitMsg,
	onCommit,
	teamSession,
	onSelectTeamExpert,
	workspaceRoot,
	onOpenTeamAgentFile,
	revertedPaths,
	revertedChangeKeys,
	agentSession,
	currentThreadId,
	onSelectAgentSession,
	onSendAgentInput,
	onSubmitAgentUserInput,
	onWaitAgent,
	onResumeAgent,
	onCloseAgent,
	onOpenAgentTranscript,
}: AgentRightSidebarProps) {
	const { t, shell } = useAppShellChromeCore();
	const [pendingBrowserCommands, setPendingBrowserCommands] = useState<BrowserControlPayload[]>([]);

	useEffect(() => {
		const subscribe = shell?.subscribeBrowserControl;
		if (!subscribe) {
			return;
		}
		const unsubscribe = subscribe((payload) => {
			if (!isBrowserControlPayload(payload)) {
				return;
			}
			// Main workspace no longer hosts the AI browser UI.
			// Browser commands are expected to land in the dedicated browser window instead.
		});
		return () => {
			unsubscribe?.();
		};
	}, [shell]);

	const handleBrowserCommandHandled = useCallback((commandId: string) => {
		setPendingBrowserCommands((prev) => prev.filter((command) => command.commandId !== commandId));
	}, []);

	let content: ReactNode;

	if (view === 'plan') {
		content = (
			<AgentRightSidebarPlanPanel
				hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
				closeSidebar={closeSidebar}
				openView={openView}
				planPreviewTitle={planPreviewTitle}
				planPreviewMarkdown={planPreviewMarkdown}
				planDocumentMarkdown={planDocumentMarkdown}
				planFileRelPath={planFileRelPath}
				planFilePath={planFilePath}
				agentPlanBuildModelId={agentPlanBuildModelId}
				setAgentPlanBuildModelId={setAgentPlanBuildModelId}
				awaitingReply={awaitingReply}
				agentPlanEffectivePlan={agentPlanEffectivePlan}
				onPlanBuild={onPlanBuild}
				planReviewIsBuilt={planReviewIsBuilt}
				agentPlanTodoDoneCount={agentPlanTodoDoneCount}
				agentPlanTodos={agentPlanTodos}
				onPlanAddTodo={onPlanAddTodo}
				planTodoDraftOpen={planTodoDraftOpen}
				planTodoDraftInputRef={planTodoDraftInputRef}
				planTodoDraftText={planTodoDraftText}
				setPlanTodoDraftText={setPlanTodoDraftText}
				onPlanAddTodoSubmit={onPlanAddTodoSubmit}
				onPlanAddTodoCancel={onPlanAddTodoCancel}
				onPlanTodoToggle={onPlanTodoToggle}
			/>
		);
	} else if (view === 'file') {
		content = (
			<AgentRightSidebarFilePanel
				hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
				closeSidebar={closeSidebar}
				openView={openView}
				agentFilePreview={agentFilePreview}
				openFileInTab={openFileInTab}
				workspaceRoot={workspaceRoot}
				onAcceptAgentFilePreviewHunk={onAcceptAgentFilePreviewHunk}
				onRevertAgentFilePreviewHunk={onRevertAgentFilePreviewHunk}
				agentFilePreviewBusyPatch={agentFilePreviewBusyPatch}
			/>
		);
	} else if (view === 'browser') {
		content = (
			<AgentRightSidebarBrowserPanel
				hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
				closeSidebar={closeSidebar}
				openView={openView}
				onOpenBrowserSettings={onOpenBrowserSettings}
				pendingCommand={pendingBrowserCommands[0] ?? null}
				onCommandHandled={handleBrowserCommandHandled}
			/>
		);
	} else if (view === 'agents') {
		content = (
			<AgentSessionPanel
				t={t}
				session={agentSession}
				threadId={currentThreadId}
				onClose={closeSidebar}
				onSelectAgent={onSelectAgentSession}
				onSendInput={onSendAgentInput}
				onSubmitUserInput={onSubmitAgentUserInput}
				onWaitAgent={onWaitAgent}
				onResumeAgent={onResumeAgent}
				onCloseAgent={onCloseAgent}
				onOpenTranscript={onOpenAgentTranscript}
			/>
		);
	} else if (view === 'team') {
		const workflowItems = buildTeamWorkflowItems(teamSession);
		content = (
			<div className="ref-team-sidebar-shell">
				<button
					type="button"
					className="ref-team-sidebar-close"
					onClick={closeSidebar}
					aria-label={t('common.close')}
					title={t('common.close')}
				>
					<IconCloseSmall />
				</button>
				{workflowItems.length ? (
					<div className="ref-team-right-sidebar-layout">
						<TeamRoleWorkflowPanel
							t={t}
							session={teamSession}
							selectedTaskId={teamSession?.selectedTaskId ?? null}
							onSelectTask={onSelectTeamExpert}
							layout="agent-sidebar"
							isVisible={open && view === 'team'}
							workspaceRoot={workspaceRoot}
							onOpenAgentFile={onOpenTeamAgentFile}
							revertedPaths={revertedPaths}
							revertedChangeKeys={revertedChangeKeys}
							allowAgentFileActions
						/>
					</div>
				) : (
					<div className="ref-team-sidebar-empty">
						<div className="ref-agent-plan-status-main">
							<div className="ref-agent-plan-status-title">{t('composer.mode.team')}</div>
							<p className="ref-agent-plan-status-body">{t('settings.team.empty')}</p>
						</div>
					</div>
				)}
			</div>
		);
	} else {
		content = (
			<AgentRightSidebarGitPanel
				hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
				gitViewActive={open && view === 'git'}
				openView={openView}
				closeSidebar={closeSidebar}
				onOpenGitDiff={onOpenGitDiff}
				commitMsg={commitMsg}
				setCommitMsg={setCommitMsg}
				onCommit={onCommit}
				currentThreadId={currentThreadId}
			/>
		);
	}

	return (
		<aside
			id="agent-right-sidebar"
			className={`ref-right ref-right--agent-layout ${open ? 'is-open' : 'is-collapsed'}`}
			aria-label={t('app.rightSidebar')}
			aria-hidden={!open}
		>
			{content}
		</aside>
	);
});
