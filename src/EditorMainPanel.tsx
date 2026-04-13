import './monacoSetup';
import './styles/editor-layout.css';
import Editor, { DiffEditor } from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { memo, type MouseEventHandler } from 'react';
import { BrandLogo } from './BrandLogo';
import { ChatMarkdown } from './ChatMarkdown';
import { EditorFileBreadcrumb } from './EditorFileBreadcrumb';
import {
	EditorTabBar,
	type EditorTab,
	type MarkdownTabView,
} from './EditorTabBar';
import {
	editorSettingsToMonacoOptions,
	type EditorSettings,
} from './EditorSettingsPanel';
import { languageFromFilePath } from './fileTypeIcons';
import { EDITOR_TERMINAL_H_MAX_RATIO, EDITOR_TERMINAL_H_MIN, type EditorInlineDiffState, type EditorPtySession } from './hooks/useEditorTabs';
import { IconCloseSmall, IconPlus, IconRefresh } from './icons';
import type { TFunction } from './i18n';
import type { ModelPickerItem } from './ModelPickerDropdown';
import { PtyTerminalView } from './PtyTerminalView';
import { TeamRoleWorkflowPanel } from './TeamRoleWorkflowPanel';
import { VoidSelect } from './VoidSelect';
import type { TeamSessionState } from './hooks/useTeamSession';

export type EditorMainPanelProps = {
	t: TFunction;
	openTabs: EditorTab[];
	activeTabId: string | null;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
	showEditorPlanDocumentInCenter: boolean;
	showEditorTeamWorkflowInCenter: boolean;
	planFileRelPath: string | null;
	planFilePath: string | null;
	editorPlanBuildModelId: string;
	setEditorPlanBuildModelId: (value: string) => void;
	modelPickerItems: ModelPickerItem[];
	planReviewIsBuilt: boolean;
	awaitingReply: boolean;
	editorCenterPlanCanBuild: boolean;
	onPlanBuild: (modelId: string) => void;
	editorCenterPlanMarkdown: string;
	filePath: string;
	markdownPaneMode: MarkdownTabView | null;
	setMarkdownPaneMode: (mode: MarkdownTabView) => void;
	onLoadFile: () => void;
	onSaveFile: () => void;
	showPlanFileEditorChrome: boolean;
	editorPlanFileIsBuilt: boolean;
	onExecutePlanFromEditor: (modelId: string) => void;
	markdownPreviewContent: string;
	activeEditorInlineDiff: EditorInlineDiffState | null;
	monacoChromeTheme: string;
	monacoOriginalDocumentPath: string;
	monacoDocumentPath: string;
	editorValue: string;
	onEditorValueChange: (value: string) => void;
	onMonacoMount: (
		editor: MonacoEditorNS.IStandaloneCodeEditor,
		monaco: typeof import('monaco-editor')
	) => void;
	onMonacoDiffMount: (
		diffEditor: MonacoEditorNS.IStandaloneDiffEditor,
		monaco: typeof import('monaco-editor')
	) => void;
	editorSettings: EditorSettings;
	openWorkspacePicker: () => void;
	editorTerminalVisible: boolean;
	beginResizeEditorTerminal: MouseEventHandler<HTMLDivElement>;
	editorTerminalHeightPx: number;
	editorTerminalSessions: EditorPtySession[];
	activeEditorTerminalId: string | null;
	setActiveEditorTerminalId: (id: string) => void;
	closeEditorTerminalSession: (id: string) => void;
	appendEditorTerminal: () => void;
	closeEditorTerminalPanel: () => void;
	onEditorTerminalSessionExit: (id: string) => void;
	teamSession: TeamSessionState | null;
	selectedTeamTaskId: string | null;
	onSelectTeamTask: (taskId: string) => void;
};

export const EditorMainPanel = memo(function EditorMainPanel({
	t,
	openTabs,
	activeTabId,
	onSelectTab,
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
	filePath,
	markdownPaneMode,
	setMarkdownPaneMode,
		onLoadFile,
		onSaveFile,
	showPlanFileEditorChrome,
	editorPlanFileIsBuilt,
	onExecutePlanFromEditor,
	markdownPreviewContent,
	activeEditorInlineDiff,
	monacoChromeTheme,
	monacoOriginalDocumentPath,
	monacoDocumentPath,
	editorValue,
	onEditorValueChange,
	onMonacoMount,
	onMonacoDiffMount,
	editorSettings,
	openWorkspacePicker,
	editorTerminalVisible,
	beginResizeEditorTerminal,
	editorTerminalHeightPx,
	editorTerminalSessions,
	activeEditorTerminalId,
	setActiveEditorTerminalId,
	closeEditorTerminalSession,
	appendEditorTerminal,
	closeEditorTerminalPanel,
	onEditorTerminalSessionExit,
	teamSession,
	selectedTeamTaskId,
	onSelectTeamTask,
}: EditorMainPanelProps) {
	return (
		<main
			className="ref-center ref-center--editor-workspace ref-center--editor-shell"
			aria-label={t('app.editorWorkspaceMainAria')}
		>
			<div className="ref-editor-center-split">
				<div className="ref-editor-split-top">
					<EditorTabBar
						tabs={openTabs}
						activeTabId={activeTabId}
						onSelect={onSelectTab}
						onClose={onCloseTab}
					/>
					{showEditorTeamWorkflowInCenter ? (
						<div className="ref-editor-canvas ref-editor-canvas--team-workflow">
							<TeamRoleWorkflowPanel
								t={t}
								session={teamSession}
								selectedTaskId={selectedTeamTaskId}
								onSelectTask={onSelectTeamTask}
								layout="editor-center"
							/>
						</div>
					) : showEditorPlanDocumentInCenter ? (
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
													...modelPickerItems.map((model) => ({
														value: model.id,
														label: model.label,
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
					) : filePath ? (
						<>
							<div className="ref-editor-bc-toolbar-row">
								<div className="ref-editor-bc-toolbar-inner">
									<EditorFileBreadcrumb filePath={filePath} />
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
											onClick={onLoadFile}
										>
											<IconRefresh />
										</button>
										<button
											type="button"
											className="ref-editor-save"
											disabled
											title={t('app.editorReadOnlySaveHint')}
											onClick={onSaveFile}
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
														...modelPickerItems.map((model) => ({
															value: model.id,
															label: model.label,
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
													key={`diff:${filePath}`}
													height="100%"
													theme={monacoChromeTheme}
													original={activeEditorInlineDiff.originalContent}
													modified={editorValue}
													originalModelPath={monacoOriginalDocumentPath}
													modifiedModelPath={monacoDocumentPath || filePath}
													language={languageFromFilePath(filePath)}
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
													key={filePath}
													height="100%"
													theme={monacoChromeTheme}
													path={monacoDocumentPath || filePath}
													language={languageFromFilePath(filePath)}
													value={editorValue}
													onChange={(value) => onEditorValueChange(value ?? '')}
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
									onClick={openWorkspacePicker}
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
									{editorTerminalSessions.map((session) => {
										const isActive = session.id === activeEditorTerminalId;
										return (
											<div
												key={session.id}
												className={`ref-editor-terminal-tab ${isActive ? 'is-active' : ''}`}
												role="presentation"
											>
												<button
													type="button"
													role="tab"
													aria-selected={isActive}
													className="ref-editor-terminal-tab-main"
													onClick={() => setActiveEditorTerminalId(session.id)}
												>
													{session.title}
												</button>
												<button
													type="button"
													className="ref-editor-terminal-tab-close"
													aria-label={t('app.closeTerminalTab')}
													onClick={(event) => {
														event.stopPropagation();
														closeEditorTerminalSession(session.id);
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
									onClick={appendEditorTerminal}
								>
									<IconPlus />
								</button>
								<button
									type="button"
									className="ref-editor-terminal-icon-btn"
									title={t('app.closeTerminalPanel')}
									aria-label={t('app.closeTerminalPanel')}
									onClick={closeEditorTerminalPanel}
								>
									<IconCloseSmall />
								</button>
							</div>
							<div className="ref-editor-terminal-stack">
								{editorTerminalSessions.map((session) => (
									<div
										key={session.id}
										className={`ref-editor-terminal-pane ${session.id === activeEditorTerminalId ? 'is-active' : ''}`}
									>
										<PtyTerminalView
											sessionId={session.id}
											active={session.id === activeEditorTerminalId}
											compactChrome
											onSessionExit={() => onEditorTerminalSessionExit(session.id)}
										/>
									</div>
								))}
							</div>
						</div>
					</>
				) : null}
			</div>
		</main>
	);
});
