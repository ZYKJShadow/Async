import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
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
	IconCloseSmall,
	IconDoc,
	IconGitSCM,
	IconGlobe,
	IconRefresh,
	IconSettings,
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

type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team' | 'browser' | 'agents';

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

const AgentRightSidebarBrowserLauncherPanel = memo(function AgentRightSidebarBrowserLauncherPanel({
	hasAgentPlanSidebarContent,
	closeSidebar,
	openView,
	onOpenBrowserSettings,
}: {
	hasAgentPlanSidebarContent: boolean;
	closeSidebar: () => void;
	openView: (view: AgentRightSidebarView) => void;
	onOpenBrowserSettings: () => void;
}) {
	const { t, shell } = useAppShellChromeCore();
	const [opening, setOpening] = useState(false);

	const openBrowserWindow = useCallback(async () => {
		if (!shell || opening) {
			return;
		}
		setOpening(true);
		try {
			await shell.invoke('browser:openWindow');
			closeSidebar();
		} catch {
			/* keep the launcher visible so the user can retry */
		} finally {
			setOpening(false);
		}
	}, [closeSidebar, opening, shell]);

	return (
		<div className="ref-agent-review-shell ref-browser-sidebar-launcher">
			<div className="ref-agent-review-head">
				<div className="ref-agent-review-title-stack">
					<span className="ref-agent-review-kicker">{t('app.tabBrowser')}</span>
					<span className="ref-agent-review-title">{t('app.browserDetachedSidebarTitle')}</span>
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
							onClick={onOpenBrowserSettings}
						>
							<IconSettings />
						</button>
					}
				/>
			</div>
			<div className="ref-right-panel-stage">
				<div className="ref-agent-plan-status-main ref-browser-sidebar-launcher-main">
					<div className="ref-browser-sidebar-launcher-icon" aria-hidden="true">
						<IconGlobe />
					</div>
					<div className="ref-agent-plan-status-title">{t('app.browserDetachedSidebarTitle')}</div>
					<p className="ref-agent-plan-status-body">{t('app.browserDetachedSidebarBody')}</p>
					<div className="ref-browser-sidebar-launcher-actions">
						<button
							type="button"
							className="ref-browser-error-btn"
							onClick={() => void openBrowserWindow()}
							disabled={!shell || opening}
						>
							{opening ? t('app.browserOpeningWindow') : t('app.browserOpenWindow')}
						</button>
						<button type="button" className="ref-browser-mini-btn" onClick={onOpenBrowserSettings}>
							{t('app.browserSettings')}
						</button>
					</div>
				</div>
			</div>
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
	const { t } = useAppShellChromeCore();

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
			<AgentRightSidebarBrowserLauncherPanel
				hasAgentPlanSidebarContent={hasAgentPlanSidebarContent}
				closeSidebar={closeSidebar}
				openView={openView}
				onOpenBrowserSettings={onOpenBrowserSettings}
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
