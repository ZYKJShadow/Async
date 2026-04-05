import { memo, type RefObject } from 'react';
import { FileTypeIcon } from './fileTypeIcons';
import { changeBadgeLabel, changeBadgeVariant, GitUnavailableState } from './gitBadge';
import { type GitUnavailableReason } from './gitAvailability';
import { useI18n } from './i18n';
import {
	IconArrowUpRight,
	IconChevron,
	IconExplorer,
	IconGitSCM,
	IconNewFile,
	IconNewFolder,
	IconPlugin,
	IconRefresh,
	IconSearch,
} from './icons';
import type { SettingsNavId } from './SettingsPage';
import {
	WorkspaceExplorer,
	type GitPathStatusMap,
	type WorkspaceExplorerActions,
} from './WorkspaceExplorer';

type Shell = NonNullable<Window['asyncShell']>;
type SearchResult = { rel: string; fileName: string; dir: string };

interface EditorLeftSidebarProps {
	shell: Shell | undefined;
	workspace: string | null;
	workspaceBasename: string;
	ipcOk: string;
	editorLeftSidebarView: 'explorer' | 'search' | 'git';
	setEditorLeftSidebarView: (v: 'explorer' | 'search' | 'git') => void;
	editorExplorerCollapsed: boolean;
	toggleEditorExplorerCollapsed: () => void;
	editorSidebarWorkspaceLabel: string;
	editorSidebarSelectedRel: string;
	editorExplorerScrollRef: RefObject<HTMLDivElement | null>;
	workspaceExplorerActions: WorkspaceExplorerActions | null;
	gitPathStatus: GitPathStatusMap;
	treeEpoch: number;
	editorSidebarSearchQuery: string;
	setEditorSidebarSearchQuery: (q: string) => void;
	normalizedEditorSidebarSearchQuery: string;
	editorSidebarSearchResults: SearchResult[];
	editorSidebarSearchInputRef: RefObject<HTMLInputElement | null>;
	gitUnavailableReason: GitUnavailableReason;
	gitLines: string[];
	gitChangedPaths: string[];
	fileMenuNewFile: () => void;
	revealWorkspaceInOs: (path: string) => void;
	refreshGit: () => void;
	onExplorerOpenFile: (rel: string) => void;
	setWorkspacePickerOpen: (v: boolean) => void;
	openSettingsPage: (nav: SettingsNavId) => void;
}

export const EditorLeftSidebar = memo(function EditorLeftSidebar({
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
	gitPathStatus,
	treeEpoch,
	editorSidebarSearchQuery,
	setEditorSidebarSearchQuery,
	normalizedEditorSidebarSearchQuery,
	editorSidebarSearchResults,
	editorSidebarSearchInputRef,
	gitUnavailableReason,
	gitLines,
	gitChangedPaths,
	fileMenuNewFile,
	revealWorkspaceInOs,
	refreshGit,
	onExplorerOpenFile,
	setWorkspacePickerOpen,
	openSettingsPage,
}: EditorLeftSidebarProps) {
	const { t } = useI18n();
	const hasShellAndWorkspace = Boolean(shell && workspace);

	return (
		<div className="ref-left-editor-nest">
			<div className="ref-editor-activity-bar" aria-label={t('app.rightSidebarViews')}>
				<button
					type="button"
					className={`ref-editor-sidebar-tab ${editorLeftSidebarView === 'explorer' ? 'is-active' : ''}`}
					title={t('app.tabExplorer')}
					aria-label={t('app.tabExplorer')}
					aria-pressed={editorLeftSidebarView === 'explorer'}
					onClick={() => setEditorLeftSidebarView('explorer')}
				>
					<IconExplorer />
				</button>
				<button
					type="button"
					className={`ref-editor-sidebar-tab ${editorLeftSidebarView === 'search' ? 'is-active' : ''}`}
					title={t('app.tabSearch')}
					aria-label={t('app.tabSearch')}
					aria-pressed={editorLeftSidebarView === 'search'}
					onClick={() => setEditorLeftSidebarView('search')}
				>
					<IconSearch />
				</button>
				<button
					type="button"
					className={`ref-editor-sidebar-tab ${editorLeftSidebarView === 'git' ? 'is-active' : ''}`}
					title={t('app.tabGit')}
					aria-label={t('app.tabGit')}
					aria-pressed={editorLeftSidebarView === 'git'}
					onClick={() => setEditorLeftSidebarView('git')}
				>
					<IconGitSCM />
				</button>
				<div className="ref-editor-activity-spacer" aria-hidden />
				<button
					type="button"
					className="ref-editor-sidebar-tab"
					title={t('settings.nav.plugins')}
					aria-label={t('settings.nav.plugins')}
					onClick={() => openSettingsPage('plugins')}
				>
					<IconPlugin />
				</button>
				<button
					type="button"
					className="ref-editor-sidebar-tab"
					title={t('app.openWorkspace')}
					aria-label={t('app.openWorkspace')}
					onClick={() => setWorkspacePickerOpen(true)}
				>
					<IconChevron />
				</button>
			</div>

			<div className="ref-editor-sidebar-pane">
				{editorLeftSidebarView === 'explorer' ? (
					<>
						<div className="ref-editor-sidebar-section-bar">
							<button
								type="button"
								className="ref-editor-sidebar-section-toggle"
								onClick={(event) => {
									event.currentTarget.blur();
									toggleEditorExplorerCollapsed();
								}}
								aria-expanded={!editorExplorerCollapsed}
							>
								<div className="ref-editor-sidebar-section-title">
									<IconChevron className="ref-editor-sidebar-section-chevron" />
									<span className="ref-editor-sidebar-section-name">{editorSidebarWorkspaceLabel}</span>
								</div>
							</button>
							{hasShellAndWorkspace ? (
								<div className="ref-editor-sidebar-section-actions">
									<button
										type="button"
										className="ref-editor-sidebar-action"
										title={t('app.fileMenu.newFile')}
										aria-label={t('app.fileMenu.newFile')}
										onClick={fileMenuNewFile}
									>
										<IconNewFile />
									</button>
									<button
										type="button"
										className="ref-editor-sidebar-action"
										title={t('app.openWorkspace')}
										aria-label={t('app.openWorkspace')}
										onClick={() => setWorkspacePickerOpen(true)}
									>
										<IconNewFolder />
									</button>
									<button
										type="button"
										className="ref-editor-sidebar-action"
										aria-label={t('app.explorerRefreshAria')}
										title={t('common.refresh')}
										onClick={refreshGit}
									>
										<IconRefresh />
									</button>
									<button
										type="button"
										className="ref-editor-sidebar-action"
										title={t('app.workspaceMenuOpenInExplorer')}
										aria-label={t('app.workspaceMenuOpenInExplorer')}
										onClick={() => revealWorkspaceInOs(workspace!)}
									>
										<IconArrowUpRight />
									</button>
								</div>
							) : null}
						</div>
						<div
							ref={editorExplorerScrollRef}
							className={`ref-editor-sidebar-scroll ref-editor-sidebar-scroll--explorer ${
								editorExplorerCollapsed ? 'is-collapsed' : ''
							}`}
						>
							{hasShellAndWorkspace ? (
								<WorkspaceExplorer
									key={workspace!}
									shell={shell!}
									pathStatus={gitPathStatus}
									selectedRel={editorSidebarSelectedRel}
									treeEpoch={treeEpoch}
									onOpenFile={onExplorerOpenFile}
									directoryIconMode="hidden"
									indentBase={0}
									indentStep={8}
									explorerActions={workspaceExplorerActions}
								/>
							) : (
								<div className="ref-editor-sidebar-empty">
									<p className="ref-editor-sidebar-empty-copy">{t('app.explorerPlaceholder')}</p>
									<button
										type="button"
										className="ref-open-workspace ref-open-workspace--inline"
										onClick={() => setWorkspacePickerOpen(true)}
									>
										{t('app.openWorkspace')}
									</button>
									<div className="ref-ipc-hint">{ipcOk}</div>
								</div>
							)}
						</div>
					</>
				) : null}

				{editorLeftSidebarView === 'search' ? (
					<>
						<div className="ref-editor-sidebar-section-bar">
							<div className="ref-editor-sidebar-section-title">
								<span className="ref-editor-sidebar-section-name">{t('app.tabSearch')}</span>
							</div>
						</div>
						<div className="ref-editor-sidebar-search-field">
							<IconSearch className="ref-editor-sidebar-search-icon" />
							<input
								ref={editorSidebarSearchInputRef}
								type="search"
								value={editorSidebarSearchQuery}
								onChange={(e) => setEditorSidebarSearchQuery(e.target.value)}
								className="ref-editor-sidebar-search-input"
								placeholder={t('app.editorSidebarSearchPlaceholder')}
								aria-label={t('app.tabSearch')}
							/>
						</div>
						<div className="ref-editor-sidebar-scroll ref-editor-sidebar-scroll--list">
							<div className="ref-editor-sidebar-file-list">
								{!hasShellAndWorkspace ? (
									<div className="ref-editor-sidebar-empty">
										<p className="ref-editor-sidebar-empty-copy">{t('app.explorerPlaceholder')}</p>
										<button
											type="button"
											className="ref-open-workspace ref-open-workspace--inline"
											onClick={() => setWorkspacePickerOpen(true)}
										>
											{t('app.openWorkspace')}
										</button>
									</div>
								) : !normalizedEditorSidebarSearchQuery ? (
									<div className="ref-editor-sidebar-empty">
										<p className="ref-editor-sidebar-empty-copy">{t('app.editorSidebarSearchHint')}</p>
									</div>
								) : editorSidebarSearchResults.length === 0 ? (
									<div className="ref-editor-sidebar-empty">
										<p className="ref-editor-sidebar-empty-copy">{t('app.editorSidebarSearchEmpty')}</p>
									</div>
								) : (
									editorSidebarSearchResults.map((result) => (
										<button
											key={result.rel}
											type="button"
											className={`ref-editor-sidebar-file-row ${editorSidebarSelectedRel === result.rel ? 'is-active' : ''}`}
											onClick={() => onExplorerOpenFile(result.rel)}
											title={result.rel}
										>
											<span className="ref-editor-sidebar-file-icon" aria-hidden>
												<FileTypeIcon fileName={result.fileName} isDirectory={false} />
											</span>
											<span className="ref-editor-sidebar-file-main">
												<span className="ref-editor-sidebar-file-name">{result.fileName}</span>
												<span className="ref-editor-sidebar-file-path">{result.dir || workspaceBasename}</span>
											</span>
										</button>
									))
								)}
							</div>
						</div>
					</>
				) : null}

				{editorLeftSidebarView === 'git' ? (
					<>
						<div className="ref-editor-sidebar-section-bar">
							<div className="ref-editor-sidebar-section-title">
								<span className="ref-editor-sidebar-section-name">{t('app.tabGit')}</span>
							</div>
							{hasShellAndWorkspace ? (
								<div className="ref-editor-sidebar-section-actions">
									<button
										type="button"
										className="ref-editor-sidebar-action"
										aria-label={t('app.explorerRefreshAria')}
										title={t('common.refresh')}
										onClick={refreshGit}
									>
										<IconRefresh />
									</button>
								</div>
							) : null}
						</div>
						<div className="ref-editor-sidebar-scroll ref-editor-sidebar-scroll--list">
							<div className="ref-editor-sidebar-file-list">
								{!hasShellAndWorkspace ? (
									<div className="ref-editor-sidebar-empty">
										<p className="ref-editor-sidebar-empty-copy">{t('app.explorerPlaceholder')}</p>
										<button
											type="button"
											className="ref-open-workspace ref-open-workspace--inline"
											onClick={() => setWorkspacePickerOpen(true)}
										>
											{t('app.openWorkspace')}
										</button>
									</div>
								) : gitUnavailableReason !== 'none' ? (
									<div className="ref-editor-sidebar-empty">
										<GitUnavailableState t={t} reason={gitUnavailableReason} detail={gitLines[0] ?? ''} />
									</div>
								) : gitChangedPaths.length === 0 ? (
									<div className="ref-editor-sidebar-empty">
										<p className="ref-editor-sidebar-empty-copy">{t('app.gitNoChanges')}</p>
									</div>
								) : (
									gitChangedPaths.map((rel) => {
										const normalizedRel = rel.replace(/\\/g, '/');
										const fileName = normalizedRel.includes('/')
											? normalizedRel.slice(normalizedRel.lastIndexOf('/') + 1)
											: normalizedRel;
										const dir = normalizedRel.includes('/')
											? normalizedRel.slice(0, normalizedRel.lastIndexOf('/'))
											: workspaceBasename;
										const status = gitPathStatus[rel];
										const label = status?.label ?? '';
										return (
											<button
												key={rel}
												type="button"
												className={`ref-editor-sidebar-file-row ${editorSidebarSelectedRel === normalizedRel ? 'is-active' : ''}`}
												onClick={() => onExplorerOpenFile(rel)}
												title={normalizedRel}
											>
												<span className="ref-editor-sidebar-file-icon" aria-hidden>
													<FileTypeIcon fileName={fileName} isDirectory={false} />
												</span>
												<span className="ref-editor-sidebar-file-main">
													<span className="ref-editor-sidebar-file-name">{fileName}</span>
													<span className="ref-editor-sidebar-file-path">{dir}</span>
												</span>
												<span
													className={`ref-explorer-badge ref-explorer-badge--${changeBadgeVariant(label)}`}
													title={status ? changeBadgeLabel(status.label, t) : t('app.gitChangedFallback')}
												>
													{label || '•'}
												</span>
											</button>
										);
									})
								)}
							</div>
						</div>
					</>
				) : null}
			</div>
		</div>
	);
});
