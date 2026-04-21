import {
	Activity,
	Suspense,
	lazy,
	memo,
	useCallback,
	type ComponentProps,
	type Dispatch,
	type RefObject,
	type SetStateAction,
} from 'react';
import { BrandLogo } from '../BrandLogo';
import { ComposerAtMenu } from '../ComposerAtMenu';
import {
	ComposerPlusMenu,
	type ComposerMode,
	type ComposerPlusMcpItem,
	type ComposerPlusSkillItem,
} from '../ComposerPlusMenu';
import { ComposerSkillMenu } from '../ComposerSkillMenu';
import { ComposerSlashMenu } from '../ComposerSlashMenu';
import { GitBranchPickerDropdown } from '../GitBranchPickerDropdown';
import { ModelPickerDropdown, type ModelPickerItem } from '../ModelPickerDropdown';
import { OpenWorkspaceModal } from '../OpenWorkspaceModal';
import { QuickOpenPalette } from '../quickOpenPalette';
import type { SettingsPageProps } from '../SettingsPage';
import type { CaretRectSnapshot } from '../caretRectSnapshot';
import type { AtMenuItem } from '../composerAtMention';
import type { TFunction } from '../i18n';
import type { ThinkingLevel } from '../ipcTypes';
import type { StreamingToast } from '../hooks/useStreamingChat';
import { IconArrowUpRight, IconPencil, IconTrash } from '../icons';
import type { AgentSidebarWorkspace } from '../AgentLeftSidebar';
import type { ShellLayoutMode } from './shellLayoutStorage';
import { useAppShellGitActions, useAppShellGitMeta } from './appShellContexts';

const DrawerPtyTerminal = lazy(() =>
	import('../DrawerPtyTerminal').then((m) => ({ default: m.DrawerPtyTerminal }))
);
const SettingsPage = lazy(() => import('../SettingsPage').then((m) => ({ default: m.SettingsPage })));

/** 分支选择器：内部订阅 Git Meta/Actions，避免父组件因 pathStatus/diff 等大对象更新而带动整层 overlays props 失效 */
function GitBranchPickerOverlaySection({
	shell,
	composerGitBranchAnchorRef,
	showTransientToast,
}: {
	shell: Window['asyncShell'] | undefined;
	composerGitBranchAnchorRef: RefObject<HTMLElement | null>;
	showTransientToast: (ok: boolean, text: string, durationMs?: number) => void;
}) {
	const {
		gitBranchPickerOpen,
		gitStatusOk,
		gitBranchList,
		gitBranchListCurrent,
		gitBranch,
	} = useAppShellGitMeta();
	const { refreshGit, onGitBranchListFresh, setGitBranchPickerOpen } = useAppShellGitActions();
	const handleCloseGitBranchPicker = useCallback(
		() => setGitBranchPickerOpen(false),
		[setGitBranchPickerOpen]
	);
	return (
		<GitBranchPickerDropdown
			open={gitBranchPickerOpen}
			onClose={handleCloseGitBranchPicker}
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
	);
}

export type AppShellOverlaysProps = {
	t: TFunction;
	shell: Window['asyncShell'] | undefined;
	workspace: string | null;
	homePath: string;
	workspaceFileList: string[];
	homeRecents: string[];
	filePath: string;
	searchWorkspaceSymbolsFn:
		| ((query: string) => Promise<{ name: string; path: string; line: number; kind: string }[]>)
		| undefined;
	applyWorkspacePath: (path: string) => void | Promise<void>;
	openWorkspaceByPath: (path: string) => void | Promise<void | boolean>;
	/** 工作区浮动菜单 */
	workspaceMenuRef: RefObject<HTMLDivElement | null>;
	activeWorkspaceMenuItem: AgentSidebarWorkspace | null;
	workspaceMenuPosition: { top: number; left: number } | null;
	revealWorkspaceInOs: (path: string) => void | Promise<void>;
	beginWorkspaceAliasEdit: (path: string) => void;
	removeWorkspaceFromSidebar: (path: string) => void;
	/** 终端抽屉 */
	workspaceToolsOpen: boolean;
	handleCloseWorkspaceTools: () => void;
	/** 打开工作区 */
	workspacePickerOpen: boolean;
	handleCloseWorkspacePicker: () => void;
	setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;
	/** Quick open */
	quickOpenOpen: boolean;
	handleCloseQuickOpen: () => void;
	quickOpenRecentFiles: string[];
	quickOpenSeed: string;
	onExplorerOpenFile: (rel: string, a?: number, b?: number) => void | Promise<void>;
	handleOpenSettingsGeneral: () => void;
	focusSearchSidebarFromQuickOpen: (q: string) => void;
	goToLineInEditor: (line: number) => void;
	/** 设置全屏 */
	settingsPageOpen: boolean;
	settingsOpenPending: boolean;
	closeSettingsPage: () => void | Promise<void>;
	settingsPageProps: SettingsPageProps;
	/** 布局切换遮罩 */
	layoutSwitchPending: boolean;
	layoutSwitchTarget: ShellLayoutMode | null;
	/** Composer 相关浮层 */
	plusMenuOpen: boolean;
	handleClosePlusMenu: () => void;
	plusMenuAnchorRefForDropdown: RefObject<HTMLElement | null>;
	composerMode: ComposerMode;
	setComposerModePersist: (mode: ComposerMode) => void;
	onComposerPickImages: () => Promise<void> | void;
	composerPlusSkills: ComposerPlusSkillItem[];
	onComposerInsertSkill: (slug: string, name: string) => Promise<void> | void;
	handleOpenSettingsRules: () => void;
	composerPlusMcpServers: ComposerPlusMcpItem[];
	onComposerToggleMcpServer: (id: string, nextEnabled: boolean) => Promise<void> | void;
	handleOpenSettingsTools: () => void;
	composerGitBranchAnchorRef: RefObject<HTMLElement | null>;
	showTransientToast: (ok: boolean, text: string, durationMs?: number) => void;
	modelPickerOpen: boolean;
	handleCloseModelPicker: () => void;
	modelPickerAnchorRefForDropdown: RefObject<HTMLElement | null>;
	modelPickerItems: ModelPickerItem[];
	defaultModel: string;
	onPickDefaultModel: (id: string) => void;
	handleOpenSettingsModels: () => void;
	thinkingByModelId: Record<string, ThinkingLevel>;
	setThinkingByModelId: Dispatch<SetStateAction<Record<string, ThinkingLevel>>>;
	atMenuOpen: boolean;
	atMenuItems: AtMenuItem[];
	atMenuFileSearchLoading?: boolean;
	atMenuHighlight: number;
	atCaretRect: CaretRectSnapshot | null;
	setAtMenuHighlight: (i: number) => void;
	applyAtSelection: (item: AtMenuItem) => void;
	closeAtMenu: () => void;
	skillMenuOpen: boolean;
	skillQuery: string;
	skillMenuItems: ComponentProps<typeof ComposerSkillMenu>['items'];
	skillMenuHighlight: number;
	skillCaretRect: CaretRectSnapshot | null;
	setSkillMenuHighlight: (i: number) => void;
	applySkillSelection: ComponentProps<typeof ComposerSkillMenu>['onSelect'];
	closeSkillMenu: () => void;
	slashMenuOpen: boolean;
	slashQuery: string;
	slashMenuItems: ComponentProps<typeof ComposerSlashMenu>['items'];
	slashMenuHighlight: number;
	slashCaretRect: CaretRectSnapshot | null;
	setSlashMenuHighlight: (i: number) => void;
	applySlashSelection: ComponentProps<typeof ComposerSlashMenu>['onSelect'];
	closeSlashMenu: () => void;
	/** Toast */
	saveToastVisible: boolean;
	saveToastKey: number;
	subAgentBgToast: StreamingToast;
	composerAttachErr: string | null;
	onSubAgentToastClick?: (threadId: string, agentId: string) => void;
};

/**
 * 模态、抽屉、Composer 浮层与轻提示；memo 后与主工作区解耦，
 * 流式输出仅改聊天区时若各 overlay 的 props 引用稳定可跳过本 subtree。
 */
export const AppShellOverlays = memo(function AppShellOverlays({
	t,
	shell,
	workspace,
	homePath,
	workspaceFileList,
	homeRecents,
	filePath,
	searchWorkspaceSymbolsFn,
	applyWorkspacePath,
	openWorkspaceByPath,
	workspaceMenuRef,
	activeWorkspaceMenuItem,
	workspaceMenuPosition,
	revealWorkspaceInOs,
	beginWorkspaceAliasEdit,
	removeWorkspaceFromSidebar,
	workspaceToolsOpen,
	handleCloseWorkspaceTools,
	workspacePickerOpen,
	handleCloseWorkspacePicker,
	setWorkspacePickerOpen,
	quickOpenOpen,
	handleCloseQuickOpen,
	quickOpenRecentFiles,
	quickOpenSeed,
	onExplorerOpenFile,
	handleOpenSettingsGeneral,
	focusSearchSidebarFromQuickOpen,
	goToLineInEditor,
	settingsPageOpen,
	settingsOpenPending,
	closeSettingsPage,
	settingsPageProps,
	layoutSwitchPending,
	layoutSwitchTarget,
	plusMenuOpen,
	handleClosePlusMenu,
	plusMenuAnchorRefForDropdown,
	composerMode,
	setComposerModePersist,
	onComposerPickImages,
	composerPlusSkills,
	onComposerInsertSkill,
	handleOpenSettingsRules,
	composerPlusMcpServers,
	onComposerToggleMcpServer,
	handleOpenSettingsTools,
	composerGitBranchAnchorRef,
	showTransientToast,
	modelPickerOpen,
	handleCloseModelPicker,
	modelPickerAnchorRefForDropdown,
	modelPickerItems,
	defaultModel,
	onPickDefaultModel,
	handleOpenSettingsModels,
	thinkingByModelId,
	setThinkingByModelId,
	atMenuOpen,
	atMenuItems,
	atMenuFileSearchLoading = false,
	atMenuHighlight,
	atCaretRect,
	setAtMenuHighlight,
	applyAtSelection,
	closeAtMenu,
	skillMenuOpen,
	skillQuery,
	skillMenuItems,
	skillMenuHighlight,
	skillCaretRect,
	setSkillMenuHighlight,
	applySkillSelection,
	closeSkillMenu,
	slashMenuOpen,
	slashQuery,
	slashMenuItems,
	slashMenuHighlight,
	slashCaretRect,
	setSlashMenuHighlight,
	applySlashSelection,
	closeSlashMenu,
	saveToastVisible,
	saveToastKey,
	subAgentBgToast,
	composerAttachErr,
	onSubAgentToastClick,
}: AppShellOverlaysProps) {
	return (
		<>
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
						<button type="button" className="ref-drawer-close" onClick={handleCloseWorkspaceTools}>
							{t('app.terminalCollapse')}
						</button>
					</div>
					<div className="ref-drawer-terminal">
						<Suspense fallback={<div className="ref-drawer-terminal-loading" />}>
							<DrawerPtyTerminal placeholder={t('app.terminalStarting')} />
						</Suspense>
					</div>
				</section>
			) : null}

			<OpenWorkspaceModal
				open={workspacePickerOpen}
				onClose={handleCloseWorkspacePicker}
				shell={shell}
				homePath={homePath}
				onWorkspaceOpened={(p) => void applyWorkspacePath(p)}
			/>

			<QuickOpenPalette
				open={quickOpenOpen}
				onClose={handleCloseQuickOpen}
				workspaceOpen={!!workspace}
				workspaceFiles={workspaceFileList}
				recentFilePaths={quickOpenRecentFiles}
				homeRecentFolders={homeRecents}
				activeFilePath={filePath.trim()}
				onOpenFile={(rel, a, b) => void onExplorerOpenFile(rel, a, b)}
				onOpenWorkspaceFolder={(p) => void openWorkspaceByPath(p)}
				onOpenWorkspacePicker={() => setWorkspacePickerOpen(true)}
				onOpenSettings={handleOpenSettingsGeneral}
				onFocusSearchSidebar={(q) => focusSearchSidebarFromQuickOpen(q)}
				onGoToLine={goToLineInEditor}
				initialQuery={quickOpenSeed}
				searchWorkspaceSymbols={shell ? searchWorkspaceSymbolsFn : undefined}
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
							<SettingsPage {...settingsPageProps} />
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
				onClose={handleClosePlusMenu}
				anchorRef={plusMenuAnchorRefForDropdown}
				mode={composerMode}
				onSelectMode={setComposerModePersist}
				onPickImages={onComposerPickImages}
				skills={composerPlusSkills}
				onInsertSkill={onComposerInsertSkill}
				onOpenSkillSettings={handleOpenSettingsRules}
				mcpServers={composerPlusMcpServers}
				onToggleMcpServer={onComposerToggleMcpServer}
				onOpenMcpSettings={handleOpenSettingsTools}
			/>

			<GitBranchPickerOverlaySection
				shell={shell}
				composerGitBranchAnchorRef={composerGitBranchAnchorRef}
				showTransientToast={showTransientToast}
			/>

			<ModelPickerDropdown
				open={modelPickerOpen}
				onClose={handleCloseModelPicker}
				anchorRef={modelPickerAnchorRefForDropdown}
				items={modelPickerItems}
				selectedId={defaultModel}
				onSelectModel={(id) => void onPickDefaultModel(id)}
				onNavigateToSettings={handleOpenSettingsModels}
				onAddModels={handleOpenSettingsModels}
				getThinkingLevel={(id) => thinkingByModelId[id] ?? 'medium'}
				onThinkingLevelChange={(modelId, v) => {
					setThinkingByModelId((prev) => ({ ...prev, [modelId]: v }));
					if (shell) {
						void shell.invoke('settings:set', { models: { thinkingByModelId: { [modelId]: v } } });
					}
				}}
			/>

			<ComposerAtMenu
				open={atMenuOpen}
				items={atMenuItems}
				fileSearchLoading={atMenuFileSearchLoading}
				highlightIndex={atMenuHighlight}
				caretRect={atCaretRect}
				onHighlight={setAtMenuHighlight}
				onSelect={applyAtSelection}
				onClose={closeAtMenu}
			/>

			<ComposerSlashMenu
				open={slashMenuOpen}
				query={slashQuery}
				items={slashMenuItems}
				highlightIndex={slashMenuHighlight}
				caretRect={slashCaretRect}
				onHighlight={setSlashMenuHighlight}
				onSelect={applySlashSelection}
				onClose={closeSlashMenu}
			/>

			<ComposerSkillMenu
				open={skillMenuOpen}
				query={skillQuery}
				items={skillMenuItems}
				highlightIndex={skillMenuHighlight}
				caretRect={skillCaretRect}
				onHighlight={setSkillMenuHighlight}
				onSelect={applySkillSelection}
				onClose={closeSkillMenu}
			/>

			{saveToastVisible ? <div key={saveToastKey} className="ref-save-toast">Saved ✓</div> : null}
			{subAgentBgToast ? (
				subAgentBgToast.threadId && subAgentBgToast.agentId && onSubAgentToastClick ? (
					<button
						key={subAgentBgToast.key}
						type="button"
						className={`ref-sub-agent-bg-toast ${subAgentBgToast.ok ? 'is-ok' : 'is-err'}`}
						role="status"
						onClick={() => onSubAgentToastClick(subAgentBgToast.threadId!, subAgentBgToast.agentId!)}
					>
						{subAgentBgToast.text}
					</button>
				) : (
					<div
						key={subAgentBgToast.key}
						className={`ref-sub-agent-bg-toast ${subAgentBgToast.ok ? 'is-ok' : 'is-err'}`}
						role="status"
					>
						{subAgentBgToast.text}
					</div>
				)
			) : null}
			{composerAttachErr ? (
				<div className="ref-sub-agent-bg-toast is-err" role="alert">
					{composerAttachErr}
				</div>
			) : null}
		</>
	);
});
