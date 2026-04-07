import { memo, useEffect, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { AgentFilePreviewPanel } from './AgentFilePreviewPanel';
import { ChatMarkdown } from './ChatMarkdown';
import { VoidSelect } from './VoidSelect';
import { GitUnavailableState } from './gitBadge';
import { changeBadgeLabel } from './gitBadge';
import {
	IconCloseSmall,
	IconDoc,
	IconEye,
	IconGitSCM,
	IconRefresh,
} from './icons';
import type { TFunction } from './i18n';
import type { ModelPickerItem } from './ModelPickerDropdown';
import type { PlanTodoItem, ParsedPlan } from './planParser';
import { gitUnavailableCopy, type GitUnavailableReason } from './gitAvailability';
import type { AgentFilePreviewState } from './hooks/useAgentFileReview';
import type { GitPathStatusMap } from './WorkspaceExplorer';

type AgentRightSidebarView = 'git' | 'plan' | 'file';
type DiffPreview = { diff: string; isBinary: boolean; additions: number; deletions: number };

export type AgentRightSidebarProps = {
	t: TFunction;
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
	modelPickerItems: ModelPickerItem[];
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
	changeCount: number;
	gitUnavailableReason: GitUnavailableReason;
	gitLines: string[];
	refreshGit: () => void;
	gitBranch: string;
	diffTotals: { additions: number; deletions: number };
	gitChangedPaths: string[];
	diffPreviews: Record<string, DiffPreview>;
	gitPathStatus: GitPathStatusMap;
	diffLoading: boolean;
	onOpenGitDiff: (rel: string, diff: string | null) => void;
	commitMsg: string;
	setCommitMsg: Dispatch<SetStateAction<string>>;
	onCommitOnly: () => void;
	onCommitAndPush: () => void;
	gitActionError: string | null;
};

/** 侧栏卡片：去掉 `diff --git` / `index` / `---` / `+++` 文件头；并省略 `@@ … @@` hunk 行（仅预览里不展示行号范围头，正文仍是标准 unified diff 的 +/- 与上下文行） */
function trimGitDiffForSidebarCard(raw: string): string {
	const lines = raw.split('\n');
	const idx = lines.findIndex((l) => l.startsWith('@@'));
	if (idx < 0) {
		return raw;
	}
	const body = lines.slice(idx).filter((l) => !l.startsWith('@@'));
	return body.join('\n');
}

function gitSidebarDiffLineClass(line: string): string {
	const base = 'ref-git-diff-line';
	if (line.startsWith('+') && !line.startsWith('+++')) {
		return `${base} is-add`;
	}
	if (line.startsWith('-') && !line.startsWith('---')) {
		return `${base} is-del`;
	}
	if (
		line.startsWith('diff --git') ||
		line.startsWith('index ') ||
		line.startsWith('--- ') ||
		line.startsWith('+++ ') ||
		line.startsWith('Binary files ') ||
		line.startsWith('GIT binary patch')
	) {
		return `${base} is-meta`;
	}
	return base;
}

function GitDiffLines({ diff, t }: { diff: string; t: TFunction }) {
	const trimmed = trimGitDiffForSidebarCard(diff);
	const lines = trimmed.split('\n').slice(0, 120);
	return (
		<div className="ref-git-card-diff" role="region" aria-label={t('git.diffPreview')}>
			{lines.map((line, i) => {
				const mod = gitSidebarDiffLineClass(line);
				return (
					<div key={i} className={mod}>
						{line || '\u00a0'}
					</div>
				);
			})}
		</div>
	);
}

function RightSidebarTabs({
	t,
	hasPlan,
	activeView,
	openView,
	closeSidebar,
}: {
	t: TFunction;
	hasPlan: boolean;
	activeView: AgentRightSidebarView;
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
					className={`ref-right-icon-tab ${activeView === 'plan' ? 'is-active' : ''}`}
					onClick={() => openView('plan')}
				>
					<IconDoc />
				</button>
			) : null}
			<button
				type="button"
				aria-label={t('app.tabGit')}
				title={t('app.tabGit')}
				className={`ref-right-icon-tab ${activeView === 'git' ? 'is-active' : ''}`}
				onClick={() => openView('git')}
			>
				<IconGitSCM />
			</button>
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

export const AgentRightSidebar = memo(function AgentRightSidebar({
	t,
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
	modelPickerItems,
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
	changeCount,
	gitUnavailableReason,
	gitLines,
	refreshGit,
	gitBranch,
	diffTotals,
	gitChangedPaths,
	diffPreviews,
	gitPathStatus,
	diffLoading,
	onOpenGitDiff,
	commitMsg,
	setCommitMsg,
	onCommitOnly,
	onCommitAndPush,
	gitActionError,
}: AgentRightSidebarProps) {
	// 用户打开 Git 视图时刷新状态
	useEffect(() => {
		if (view === 'git' && open) {
			void refreshGit();
		}
	}, [view, open, refreshGit]);
	const agentFilePreviewTitle =
		agentFilePreview?.relPath?.split('/').pop() || agentFilePreview?.relPath || t('app.filePreview');
	const gitTitle =
		changeCount > 0 ? t('app.gitUncommitted', { count: String(changeCount) }) : t('app.gitNoChanges');

	let content: ReactNode;

	if (view === 'plan') {
		content = (
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
									activeView="plan"
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
								activeView="plan"
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
	} else if (view === 'file') {
		content = agentFilePreview ? (
			<div className="ref-agent-review-shell">
				<div className="ref-agent-review-head">
					<div className="ref-agent-review-title-stack">
						<span className="ref-agent-review-kicker">{t('app.filePreview')}</span>
						<span className="ref-agent-review-title">{agentFilePreviewTitle}</span>
					</div>
					<RightSidebarTabs
						t={t}
						hasPlan={hasAgentPlanSidebarContent}
						activeView="file"
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
						activeView="file"
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
	} else {
		content = (
			<div className="ref-agent-review-shell">
				<div className="ref-agent-review-head">
					<div className="ref-agent-review-title-stack">
						<span className="ref-agent-review-kicker">{t('app.tabGit')}</span>
						<span className="ref-agent-review-title">{gitTitle}</span>
					</div>
					<RightSidebarTabs
						t={t}
						hasPlan={hasAgentPlanSidebarContent}
						activeView="git"
						openView={openView}
						closeSidebar={closeSidebar}
					/>
				</div>
				<div className="ref-right-panel-stage">
					<div className="ref-right-panel-view ref-right-panel-view--agent">
						<div className="ref-right-git-stack">
							<div className="ref-right-toolbar">
								<button
									type="button"
									className="ref-icon-tile"
									aria-label={t('app.gitRefreshAria')}
									onClick={refreshGit}
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
															aria-label={t('app.gitPreviewAria')}
															title={t('app.gitPreviewTitle')}
															onClick={() => onOpenGitDiff(rel, pr?.diff ?? null)}
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
											<button type="button" className="ref-commit-btn" onClick={onCommitOnly}>
												{t('app.commit')}
											</button>
											<button
												type="button"
												className="ref-commit-btn-secondary"
												onClick={onCommitAndPush}
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
