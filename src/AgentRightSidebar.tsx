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
import { useAppShellChrome, useAppShellGit, useAppShellSettings } from './app/appShellContexts';
import type { TeamSessionState } from './hooks/useTeamSession';
import { TeamRoleWorkflowPanel } from './TeamRoleWorkflowPanel';
import { buildTeamWorkflowItems } from './teamWorkflowItems';

type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team' | 'browser';

const BROWSER_HOME_URL = 'https://www.bing.com/';

type BrowserNavEvent = Event & { url?: string; isMainFrame?: boolean };
type BrowserTitleEvent = Event & { title?: string };
type BrowserFailEvent = Event & {
	errorCode?: number;
	errorDescription?: string;
	validatedURL?: string;
	isMainFrame?: boolean;
};
type BrowserSidebarConfig = {
	userAgent: string;
	acceptLanguage: string;
	extraHeadersText: string;
	proxyMode: 'system' | 'direct' | 'custom';
	proxyRules: string;
	proxyBypassRules: string;
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
			type: 'applyConfig';
			config: Partial<BrowserSidebarConfig>;
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

const DEFAULT_BROWSER_SIDEBAR_CONFIG: BrowserSidebarConfig = {
	userAgent: '',
	acceptLanguage: '',
	extraHeadersText: '',
	proxyMode: 'system',
	proxyRules: '',
	proxyBypassRules: '',
};

function normalizeBrowserSidebarConfig(raw?: Partial<BrowserSidebarConfig> | null): BrowserSidebarConfig {
	return {
		userAgent: String(raw?.userAgent ?? '').trim(),
		acceptLanguage: String(raw?.acceptLanguage ?? '').trim(),
		extraHeadersText: String(raw?.extraHeadersText ?? '').replace(/\r/g, ''),
		proxyMode:
			raw?.proxyMode === 'direct' || raw?.proxyMode === 'custom' || raw?.proxyMode === 'system'
				? raw.proxyMode
				: 'system',
		proxyRules: String(raw?.proxyRules ?? '').trim(),
		proxyBypassRules: String(raw?.proxyBypassRules ?? '').trim(),
	};
}

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
		case 'applyConfig':
			return Boolean(obj.config && typeof obj.config === 'object');
		default:
			return false;
	}
}

function parseBrowserExtraHeadersText(raw: string): { ok: true; headers: Array<[string, string]> } | { ok: false; line: number } {
	const text = String(raw ?? '').replace(/\r/g, '');
	const lines = text.split('\n');
	const headers: Array<[string, string]> = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim();
		if (!line) {
			continue;
		}
		const sep = line.indexOf(':');
		if (sep <= 0) {
			return { ok: false, line: i + 1 };
		}
		const name = line.slice(0, sep).trim();
		const value = line.slice(sep + 1).trim();
		if (!name) {
			return { ok: false, line: i + 1 };
		}
		headers.push([name, value]);
	}
	return { ok: true, headers };
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

function looksLikeDirectUrl(raw: string): boolean {
	if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
		return true;
	}
	return /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(raw);
}

function normalizeBrowserTarget(raw: string): string {
	const text = raw.trim();
	if (!text) {
		return BROWSER_HOME_URL;
	}
	if (looksLikeDirectUrl(text)) {
		return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text) ? text : `https://${text}`;
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

function BrowserSettingsModal({
	open,
	t,
	draft,
	setDraft,
	error,
	saving,
	onClose,
	onReset,
	onSave,
}: {
	open: boolean;
	t: TFunction;
	draft: BrowserSidebarConfig;
	setDraft: Dispatch<SetStateAction<BrowserSidebarConfig>>;
	error: string | null;
	saving: boolean;
	onClose: () => void;
	onReset: () => void;
	onSave: () => void | Promise<void>;
}) {
	const firstInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		const timer = window.setTimeout(() => firstInputRef.current?.focus(), 40);
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener('keydown', onKey);
		};
	}, [open, onClose]);

	if (!open) {
		return null;
	}

	return (
		<div className="ref-browser-settings-backdrop" role="presentation" onClick={onClose}>
			<form
				className="ref-browser-settings-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="browser-settings-title"
				onClick={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					void onSave();
				}}
			>
				<div className="ref-browser-settings-head">
					<div className="ref-browser-settings-title-stack">
						<span className="ref-browser-settings-kicker">{t('app.tabBrowser')}</span>
						<h2 id="browser-settings-title" className="ref-browser-settings-title">
							{t('app.browserSettings')}
						</h2>
					</div>
					<button
						type="button"
						className="ref-browser-settings-close"
						aria-label={t('common.close')}
						title={t('common.close')}
						onClick={onClose}
					>
						<IconCloseSmall />
					</button>
				</div>

				<div className="ref-browser-settings-body">
					<p className="ref-browser-settings-note">{t('app.browserSettingsDescription')}</p>

					<label className="ref-browser-settings-field">
						<span className="ref-browser-settings-label">{t('app.browserUserAgent')}</span>
						<input
							ref={firstInputRef}
							type="text"
							className="ref-browser-settings-input"
							value={draft.userAgent}
							placeholder={t('app.browserUserAgentPlaceholder')}
							spellCheck={false}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									userAgent: event.target.value,
								}))
							}
						/>
					</label>

					<label className="ref-browser-settings-field">
						<span className="ref-browser-settings-label">{t('app.browserAcceptLanguage')}</span>
						<input
							type="text"
							className="ref-browser-settings-input"
							value={draft.acceptLanguage}
							placeholder={t('app.browserAcceptLanguagePlaceholder')}
							spellCheck={false}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									acceptLanguage: event.target.value,
								}))
							}
						/>
					</label>

					<div className="ref-browser-settings-field">
						<span className="ref-browser-settings-label">{t('app.browserProxyMode')}</span>
						<div className="ref-browser-settings-segmented" role="radiogroup" aria-label={t('app.browserProxyMode')}>
							{(
								[
									['system', 'app.browserProxyModeSystem', 'app.browserProxyModeSystemDesc'],
									['direct', 'app.browserProxyModeDirect', 'app.browserProxyModeDirectDesc'],
									['custom', 'app.browserProxyModeCustom', 'app.browserProxyModeCustomDesc'],
								] as const
							).map(([mode, titleKey, descKey]) => {
								const active = draft.proxyMode === mode;
								return (
									<button
										key={mode}
										type="button"
										role="radio"
										aria-checked={active}
										className={`ref-browser-settings-segment ${active ? 'is-selected' : ''}`}
										onClick={() =>
											setDraft((prev) => ({
												...prev,
												proxyMode: mode,
											}))
										}
									>
										<span className="ref-browser-settings-segment-title">{t(titleKey)}</span>
										<span className="ref-browser-settings-segment-desc">{t(descKey)}</span>
									</button>
								);
							})}
						</div>
					</div>

					{draft.proxyMode === 'custom' ? (
						<>
							<label className="ref-browser-settings-field">
								<span className="ref-browser-settings-label">{t('app.browserProxyRules')}</span>
								<input
									type="text"
									className="ref-browser-settings-input"
									value={draft.proxyRules}
									placeholder={t('app.browserProxyRulesPlaceholder')}
									spellCheck={false}
									onChange={(event) =>
										setDraft((prev) => ({
											...prev,
											proxyRules: event.target.value,
										}))
									}
								/>
								<span className="ref-browser-settings-help">{t('app.browserProxyRulesHint')}</span>
							</label>

							<label className="ref-browser-settings-field">
								<span className="ref-browser-settings-label">{t('app.browserProxyBypassRules')}</span>
								<input
									type="text"
									className="ref-browser-settings-input"
									value={draft.proxyBypassRules}
									placeholder={t('app.browserProxyBypassRulesPlaceholder')}
									spellCheck={false}
									onChange={(event) =>
										setDraft((prev) => ({
											...prev,
											proxyBypassRules: event.target.value,
										}))
									}
								/>
								<span className="ref-browser-settings-help">{t('app.browserProxyBypassRulesHint')}</span>
							</label>
						</>
					) : null}

					<label className="ref-browser-settings-field">
						<span className="ref-browser-settings-label">{t('app.browserExtraHeaders')}</span>
						<textarea
							className="ref-browser-settings-textarea"
							value={draft.extraHeadersText}
							placeholder={t('app.browserExtraHeadersPlaceholder')}
							spellCheck={false}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									extraHeadersText: event.target.value,
								}))
							}
						/>
						<span className="ref-browser-settings-help">{t('app.browserExtraHeadersHint')}</span>
					</label>

					{error ? <div className="ref-browser-settings-error">{error}</div> : null}
				</div>

				<div className="ref-browser-settings-actions">
					<button type="button" className="ref-browser-settings-btn ref-browser-settings-btn--ghost" onClick={onReset}>
						{t('app.browserResetDefaults')}
					</button>
					<div className="ref-browser-settings-actions-right">
						<button
							type="button"
							className="ref-browser-settings-btn ref-browser-settings-btn--secondary"
							onClick={onClose}
						>
							{t('common.cancel')}
						</button>
						<button type="submit" className="ref-browser-settings-btn" disabled={saving}>
							{t('app.browserSaveAndReload')}
						</button>
					</div>
				</div>
			</form>
		</div>
	);
}

export type AgentRightSidebarProps = {
	open: boolean;
	view: AgentRightSidebarView;
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
	onCommitOnly: () => void;
	onCommitAndPush: () => void;
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
};

type CommitAction = 'commit' | 'commit-push' | 'commit-pr';

function CommitModal({
	t,
	gitBranch,
	changeCount,
	diffTotals,
	diffLoading,
	commitMsg,
	setCommitMsg,
	onClose,
	onCommit,
	previousBranch,
}: {
	t: TFunction;
	gitBranch: string;
	changeCount: number;
	diffTotals: { additions: number; deletions: number };
	diffLoading: boolean;
	commitMsg: string;
	setCommitMsg: (msg: string) => void;
	onClose: () => void;
	onCommit: (action: CommitAction, includeUnstaged: boolean, isDraft: boolean) => void;
	previousBranch?: string;
}) {
	const [selectedAction, setSelectedAction] = useState<CommitAction>('commit');
	const [isDraft, setIsDraft] = useState(false);
	const [includeUnstaged, setIncludeUnstaged] = useState(true);

	const showBranchWarning = previousBranch && previousBranch !== gitBranch;

	return (
		<div className="ref-commit-modal-overlay" onClick={onClose}>
			<div className="ref-commit-modal" onClick={(e) => e.stopPropagation()}>
				<div className="ref-commit-modal-header">
					<div className="ref-commit-modal-icon">
						<IconGitSCM />
					</div>
					<button type="button" className="ref-commit-modal-close" onClick={onClose} aria-label={t('app.close')}>
						<IconCloseSmall />
					</button>
				</div>
				
				<h2 className="ref-commit-modal-title">{t('app.commitYourChanges')}</h2>
				
				<div className="ref-commit-modal-section">
					<div className="ref-commit-modal-row">
						<span className="ref-commit-modal-label">{t('app.branch')}</span>
						<span className="ref-commit-modal-value">
							<IconArrowUpRight />
							{gitBranch || 'master'}
						</span>
					</div>
					
					<div className="ref-commit-modal-row">
						<span className="ref-commit-modal-label">{t('app.changes')}</span>
						<span className="ref-commit-modal-value">
							{t('app.commitFiles', { count: String(changeCount) })}
							{!diffLoading && diffTotals.additions > 0 && (
								<span className="ref-commit-stat-add">+{diffTotals.additions}</span>
							)}
							{!diffLoading && diffTotals.deletions > 0 && (
								<span className="ref-commit-stat-del">-{diffTotals.deletions}</span>
							)}
						</span>
					</div>
					
					<label className="ref-commit-modal-toggle">
						<input
							type="checkbox"
							checked={includeUnstaged}
							onChange={(e) => setIncludeUnstaged(e.target.checked)}
						/>
						<span className="ref-commit-modal-toggle-slider"></span>
						<span className="ref-commit-modal-toggle-label">{t('app.includeUnstaged')}</span>
					</label>
				</div>
				
				<div className="ref-commit-modal-section">
					<div className="ref-commit-modal-section-header">
						<span className="ref-commit-modal-label">{t('app.commitMessage')}</span>
						<button type="button" className="ref-commit-modal-link">
							{t('app.customInstructions')}
						</button>
					</div>
					<textarea
						className="ref-commit-modal-textarea"
						placeholder={t('app.leaveBlankAutogenerate')}
						value={commitMsg}
						onChange={(e) => setCommitMsg(e.target.value)}
						autoFocus
					/>
				</div>
				
				<div className="ref-commit-modal-section">
					<h3 className="ref-commit-modal-section-title">{t('app.nextSteps')}</h3>
					<div className="ref-commit-modal-actions">
						<button
							type="button"
							className={`ref-commit-modal-action ${selectedAction === 'commit' ? 'is-active' : ''}`}
							onClick={() => setSelectedAction('commit')}
						>
							<IconGitSCM />
							<span>{t('app.commit')}</span>
							{selectedAction === 'commit' && <span className="ref-commit-modal-check">✓</span>}
						</button>
						<button
							type="button"
							className={`ref-commit-modal-action ${selectedAction === 'commit-push' ? 'is-active' : ''}`}
							onClick={() => setSelectedAction('commit-push')}
						>
							<IconArrowUp />
							<span>{t('app.commitPush')}</span>
							{selectedAction === 'commit-push' && <span className="ref-commit-modal-check">✓</span>}
						</button>
						<button
							type="button"
							className={`ref-commit-modal-action ${selectedAction === 'commit-pr' ? 'is-active' : ''}`}
							onClick={() => setSelectedAction('commit-pr')}
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
							</svg>
							<span>{t('app.commitAndCreatePR')}</span>
							{selectedAction === 'commit-pr' && <span className="ref-commit-modal-check">✓</span>}
						</button>
					</div>
				</div>
				
				{showBranchWarning && (
					<div className="ref-commit-modal-warning">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="ref-commit-modal-warning-icon">
							<path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.5v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z"/>
						</svg>
						<span>
							{t('app.commitBranchWarning', {
								oldBranch: previousBranch,
								newBranch: gitBranch,
							})}
						</span>
					</div>
				)}
				
				<div className="ref-commit-modal-footer">
					<label className="ref-commit-modal-toggle">
						<input
							type="checkbox"
							checked={isDraft}
							onChange={(e) => setIsDraft(e.target.checked)}
						/>
						<span className="ref-commit-modal-toggle-slider"></span>
						<span className="ref-commit-modal-toggle-label">{t('app.draft')}</span>
					</label>
					<button
						type="button"
						className="ref-commit-modal-continue"
						onClick={() => onCommit(selectedAction, includeUnstaged, isDraft)}
					>
						{t('app.continue')}
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
	const { t } = useAppShellChrome();
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
	onAcceptAgentFilePreviewHunk,
	onRevertAgentFilePreviewHunk,
	agentFilePreviewBusyPatch,
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	agentFilePreview: AgentFilePreviewState | null;
	openFileInTab: AgentRightSidebarProps['openFileInTab'];
	onAcceptAgentFilePreviewHunk: (patch: string) => void;
	onRevertAgentFilePreviewHunk: (patch: string) => void;
	agentFilePreviewBusyPatch: string | null;
}) {
	const { t } = useAppShellChrome();
	const agentFilePreviewTitle =
		agentFilePreview?.relPath?.split('/').pop() || agentFilePreview?.relPath || t('app.filePreview');

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
					revealLine={agentFilePreview.revealLine}
					revealEndLine={agentFilePreview.revealEndLine}
					onOpenInEditor={() =>
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
		active: boolean;
		t: TFunction;
		onNavigate: (id: string, patch: { currentUrl: string; canGoBack: boolean; canGoForward: boolean }) => void;
		onTitle: (id: string, title: string) => void;
		onLoading: (id: string, isLoading: boolean, currentUrl?: string) => void;
		onFailLoad: (id: string, error: { message: string; url: string }) => void;
		onRegisterWebview: (id: string, node: AsyncShellWebviewElement | null) => void;
	}) {
	const webviewRef = useRef<AsyncShellWebviewElement | null>(null);
	const tabIdRef = useRef(tab.id);
	tabIdRef.current = tab.id;

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

	const webviewProps = {
		ref: assignWebviewRef,
		className: `ref-browser-webview${active ? '' : ' is-hidden'}`,
		src: tab.requestedUrl,
		partition: partition,
		useragent: userAgent,
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
	pendingCommand,
	onCommandHandled,
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	pendingCommand: BrowserControlPayload | null;
	onCommandHandled: (commandId: string) => void;
}) {
	const { t, shell } = useAppShellChrome();
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
	const [browserSettingsOpen, setBrowserSettingsOpen] = useState(false);
	const [browserSettingsSaving, setBrowserSettingsSaving] = useState(false);
	const [browserSettingsError, setBrowserSettingsError] = useState<string | null>(null);
	const [browserConfig, setBrowserConfig] = useState<BrowserSidebarConfig>(DEFAULT_BROWSER_SIDEBAR_CONFIG);
	const [browserDraft, setBrowserDraft] = useState<BrowserSidebarConfig>(DEFAULT_BROWSER_SIDEBAR_CONFIG);

	const applyBrowserConfigLocally = useCallback((rawConfig: Partial<BrowserSidebarConfig>, defaultUserAgent?: string) => {
		const nextConfig = normalizeBrowserSidebarConfig(rawConfig);
		setBrowserConfig(nextConfig);
		setBrowserDraft(nextConfig);
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
					config?: Partial<BrowserSidebarConfig>;
					defaultUserAgent?: string;
				};
				if (response.ok && response.partition) {
					const nextConfig = normalizeBrowserSidebarConfig(response.config);
					setBrowserPartition(response.partition);
					setBrowserConfig(nextConfig);
					setBrowserDraft(nextConfig);
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

	const openBrowserSettings = useCallback(() => {
		setBrowserDraft(browserConfig);
		setBrowserSettingsError(null);
		setBrowserSettingsOpen(true);
	}, [browserConfig]);

	const closeBrowserSettings = useCallback(() => {
		setBrowserDraft(browserConfig);
		setBrowserSettingsError(null);
		setBrowserSettingsOpen(false);
	}, [browserConfig]);

	const saveBrowserSettings = useCallback(async () => {
		const parsedHeaders = parseBrowserExtraHeadersText(browserDraft.extraHeadersText);
		if (!parsedHeaders.ok) {
			setBrowserSettingsError(t('app.browserHeaderFormatError', { line: String(parsedHeaders.line) }));
			return;
		}
		if (browserDraft.proxyMode === 'custom' && !browserDraft.proxyRules.trim()) {
			setBrowserSettingsError(t('app.browserProxyRulesRequired'));
			return;
		}
		setBrowserSettingsSaving(true);
		setBrowserSettingsError(null);
		try {
			const nextConfig = normalizeBrowserSidebarConfig(browserDraft);
			if (shell) {
				const payload = (await shell.invoke('browser:setConfig', nextConfig)) as {
					ok?: boolean;
					error?: string;
					line?: number;
					config?: Partial<BrowserSidebarConfig>;
					defaultUserAgent?: string;
				};
				if (!payload?.ok) {
					if (payload?.error === 'invalid-header-line' && payload.line) {
						setBrowserSettingsError(t('app.browserHeaderFormatError', { line: String(payload.line) }));
					} else if (payload?.error === 'proxy-rules-required') {
						setBrowserSettingsError(t('app.browserProxyRulesRequired'));
					} else {
						setBrowserSettingsError(t('app.browserLoadFailed'));
					}
					return;
				}
				applyBrowserConfigLocally(
					payload.config ?? nextConfig,
					String(payload.defaultUserAgent ?? defaultUserAgentRef.current ?? '')
				);
			} else {
				applyBrowserConfigLocally(nextConfig);
			}
			setBrowserSettingsOpen(false);
		} finally {
			setBrowserSettingsSaving(false);
		}
	}, [applyBrowserConfigLocally, browserDraft, shell, t]);

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
				if (command.type === 'readPage' || command.type === 'screenshotPage') {
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
			if (command.type === 'readPage' || command.type === 'screenshotPage') {
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
		closeTab,
		navigateTab,
		onCommandHandled,
		openInNewTab,
		pendingCommand,
		readPageFromWebview,
		shell,
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

	return (
		<div className="ref-agent-review-shell">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.tabBrowser')}</span>
					<span className="ref-agent-review-title" title={headerUrl}>
						{headerLabel}
					</span>
				</div>
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
							onClick={openBrowserSettings}
						>
							<IconSettings />
						</button>
					}
				/>
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
			<BrowserSettingsModal
				open={browserSettingsOpen}
				t={t}
				draft={browserDraft}
				setDraft={setBrowserDraft}
				error={browserSettingsError}
				saving={browserSettingsSaving}
				onClose={closeBrowserSettings}
				onReset={() => {
					setBrowserDraft(DEFAULT_BROWSER_SIDEBAR_CONFIG);
					setBrowserSettingsError(null);
				}}
				onSave={saveBrowserSettings}
			/>
		</div>
	);
});

/** Git 面板：只订阅 AppShell Git/Chrome context，父级因消息/流式重渲时若 Git 切片未变则可跳过本 subtree。 */
const AgentRightSidebarGitPanel = memo(function AgentRightSidebarGitPanel({
	hasAgentPlanSidebarContent,
	gitViewActive,
	openView,
	closeSidebar,
	onOpenGitDiff,
	commitMsg,
	setCommitMsg,
	onCommitOnly,
	onCommitAndPush,
}: {
	hasAgentPlanSidebarContent: boolean;
	gitViewActive: boolean;
	openView: (view: AgentRightSidebarView) => void;
	closeSidebar: () => void;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	commitMsg: string;
	setCommitMsg: Dispatch<SetStateAction<string>>;
	onCommitOnly: () => void;
	onCommitAndPush: () => void;
}) {
	const { t } = useAppShellChrome();
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

	const changeCount = gitChangedPaths.length;
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
	const gitTitle =
		changeCount > 0 ? t('app.gitUncommitted', { count: String(changeCount) }) : t('app.gitNoChanges');

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
					diffTotals={diffTotals}
					diffLoading={!showCompleteDiffTotals}
					commitMsg={commitMsg}
					setCommitMsg={setCommitMsg}
					onClose={() => setShowCommitModal(false)}
					onCommit={(action, _includeUnstaged, _isDraft) => {
						setShowCommitModal(false);
						if (action === 'commit') {
							onCommitOnly();
						} else if (action === 'commit-push') {
							onCommitAndPush();
						}
					}}
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
	onCommitOnly,
	onCommitAndPush,
	teamSession,
	onSelectTeamExpert,
	workspaceRoot,
	onOpenTeamAgentFile,
	revertedPaths,
	revertedChangeKeys,
}: AgentRightSidebarProps) {
	const { t, shell } = useAppShellChrome();
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
			if (payload.type === 'closeSidebar') {
				closeSidebar();
				return;
			}
			setPendingBrowserCommands((prev) => [...prev, payload]);
			openView('browser');
		});
		return () => {
			unsubscribe?.();
		};
	}, [closeSidebar, openView, shell]);

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
				pendingCommand={pendingBrowserCommands[0] ?? null}
				onCommandHandled={handleBrowserCommandHandled}
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
				onCommitOnly={onCommitOnly}
				onCommitAndPush={onCommitAndPush}
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
