import { memo, useEffect, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { AgentFilePreviewPanel } from './AgentFilePreviewPanel';
import { ChatMarkdown } from './ChatMarkdown';
import { VoidSelect } from './VoidSelect';
import { GitUnavailableState } from './gitBadge';
import {
	IconCloseSmall,
	IconDoc,
	IconGitSCM,
	IconRefresh,
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

type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team';

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
}: {
	t: TFunction;
	hasPlan: boolean;
	openView: (view: AgentRightSidebarView) => void;
	closeSidebar: () => void;
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
}: AgentRightSidebarProps) {
	const { t } = useAppShellChrome();

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
