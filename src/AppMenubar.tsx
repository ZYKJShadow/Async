import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useClickOutside } from './hooks/useClickOutside';
import { useAppShell, useAppShellT, useAppWorkspace } from './AppContext';
import { MenubarFileMenu } from './MenubarFileMenu';
import { MenubarWindowMenu } from './MenubarWindowMenu';
import { quickOpenPrimaryShortcutLabel, saveShortcutLabel } from './quickOpenPalette';
import { BrandLogo } from './BrandLogo';
import { IconSearch, IconChevron, IconSettings } from './icons';
import type { SettingsNavId } from './SettingsPage';

export interface AppMenubarProps {
	layoutMode: 'agent' | 'editor';
	// File menu
	folderRecents: string[];
	canSave: boolean;
	canEditorClose: boolean;
	canCloseFolder: boolean;
	onNewFile: () => void;
	onNewWindow: () => void;
	onNewEditorWindow: () => void;
	onOpenFile: () => void;
	onOpenFolder: () => void;
	onOpenRecentPath: (path: string) => void;
	onSave: () => void;
	onSaveAs: () => void;
	onRevert: () => void;
	onCloseEditor: () => void;
	onCloseFolder: () => void;
	onQuit: () => void;
	// Edit menu
	canEditUndoRedo: boolean;
	canEditCut: boolean;
	canEditCopy: boolean;
	canEditPaste: boolean;
	canEditSelectAll: boolean;
	executeEditAction: (kind: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => Promise<void>;
	// View menu
	canToggleTerminal: boolean;
	canToggleDiffPanel: boolean;
	canGoPrevThread: boolean;
	canGoNextThread: boolean;
	canGoBackThread: boolean;
	canGoForwardThread: boolean;
	toggleSidebarVisibility: () => void;
	toggleTerminalVisibility: () => void;
	toggleDiffPanelVisibility: () => void;
	openQuickOpen: (seed?: string) => void;
	goToPreviousThread: () => Promise<void>;
	goToNextThread: () => Promise<void>;
	goThreadBack: () => Promise<void>;
	goThreadForward: () => Promise<void>;
	zoomInUi: () => void;
	zoomOutUi: () => void;
	resetUiZoom: () => void;
	toggleFullscreen: () => Promise<void>;
	// Window menu
	windowMaximized: boolean;
	onMinimize: () => void;
	onToggleMaximize: () => void;
	onCloseWindow: () => void;
	// Terminal menu
	spawnEditorTerminal: () => void;
	// Settings
	openSettingsPage: (nav: SettingsNavId) => void;
}

/**
 * Extracted menubar — owns its own open/close states for each menu dropdown,
 * so the parent App does NOT re-render when menus toggle.
 */
export const AppMenubar = memo(function AppMenubar(props: AppMenubarProps) {
	const shell = useAppShell();
	const workspace = useAppWorkspace();
	const t = useAppShellT();
	const {
		layoutMode,
		folderRecents, canSave, canEditorClose, canCloseFolder,
		onNewFile, onNewWindow, onNewEditorWindow, onOpenFile, onOpenFolder, onOpenRecentPath,
		onSave, onSaveAs, onRevert, onCloseEditor, onCloseFolder, onQuit,
		canEditUndoRedo, canEditCut, canEditCopy, canEditPaste, canEditSelectAll,
		executeEditAction,
		canToggleTerminal, canToggleDiffPanel,
		canGoPrevThread, canGoNextThread, canGoBackThread, canGoForwardThread,
		toggleSidebarVisibility, toggleTerminalVisibility, toggleDiffPanelVisibility,
		openQuickOpen,
		goToPreviousThread, goToNextThread, goThreadBack, goThreadForward,
		zoomInUi, zoomOutUi, resetUiZoom, toggleFullscreen,
		windowMaximized, onMinimize, onToggleMaximize, onCloseWindow,
		spawnEditorTerminal, openSettingsPage,
	} = props;

	// ── Menu open/close state (local to this component) ──
	const [fileMenuOpen, setFileMenuOpen] = useState(false);
	const [editMenuOpen, setEditMenuOpen] = useState(false);
	const [viewMenuOpen, setViewMenuOpen] = useState(false);
	const [windowMenuOpen, setWindowMenuOpen] = useState(false);
	const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);

	const fileMenuRef = useRef<HTMLDivElement>(null);
	const editMenuRef = useRef<HTMLDivElement>(null);
	const viewMenuRef = useRef<HTMLDivElement>(null);
	const windowMenuRef = useRef<HTMLDivElement>(null);
	const terminalMenuRef = useRef<HTMLDivElement>(null);

	const closeFile = useCallback(() => setFileMenuOpen(false), []);
	const closeEdit = useCallback(() => setEditMenuOpen(false), []);
	const closeView = useCallback(() => setViewMenuOpen(false), []);
	const closeWindow = useCallback(() => setWindowMenuOpen(false), []);
	const closeTerminal = useCallback(() => setTerminalMenuOpen(false), []);

	useClickOutside(fileMenuRef, fileMenuOpen, closeFile);
	useClickOutside(editMenuRef, editMenuOpen, closeEdit);
	useClickOutside(viewMenuRef, viewMenuOpen, closeView);
	useClickOutside(windowMenuRef, windowMenuOpen, closeWindow);
	useClickOutside(terminalMenuRef, terminalMenuOpen, closeTerminal);

	// Refresh windowMaximized when window menu opens (was an effect in App)
	const [localWindowMaximized, setLocalWindowMaximized] = useState(windowMaximized);
	useEffect(() => { setLocalWindowMaximized(windowMaximized); }, [windowMaximized]);
	useEffect(() => {
		if (!windowMenuOpen || !shell) return;
		let cancelled = false;
		void shell.invoke('app:windowGetState').then((r) => {
			if (cancelled) return;
			const o = r as { ok?: boolean; maximized?: boolean };
			if (o?.ok && typeof o.maximized === 'boolean') {
				setLocalWindowMaximized(o.maximized);
			}
		});
		return () => { cancelled = true; };
	}, [windowMenuOpen, shell]);

	const closeAllExcept = (keep: 'file' | 'edit' | 'view' | 'window' | 'terminal') => {
		if (keep !== 'file') setFileMenuOpen(false);
		if (keep !== 'edit') setEditMenuOpen(false);
		if (keep !== 'view') setViewMenuOpen(false);
		if (keep !== 'window') setWindowMenuOpen(false);
		if (keep !== 'terminal') setTerminalMenuOpen(false);
	};

	return (
		<header className={`ref-menubar ${layoutMode === 'agent' ? 'ref-menubar--agent' : ''}`}>
			<div className="ref-menubar-left">
				<div className="ref-brand-block-simple">
					<BrandLogo className="ref-brand-logo" size={22} />
				</div>
				<nav className="ref-menu-nav" aria-label={t('app.menu')}>
					{/* ── File ── */}
					<div className="ref-menu-dropdown-wrap" ref={fileMenuRef}>
						<button
							type="button"
							className={`ref-menu-item${fileMenuOpen ? ' is-active' : ''}`}
							aria-expanded={fileMenuOpen}
							aria-haspopup="menu"
							onClick={() => { closeAllExcept('file'); setFileMenuOpen((o) => !o); }}
						>
							{t('app.menuFile')}
						</button>
						{fileMenuOpen ? (
							<MenubarFileMenu
								onClose={closeFile}
								isDesktopShell={!!shell}
								hasWorkspace={!!workspace}
								folderRecents={folderRecents}
								canSave={canSave}
								canEditorClose={canEditorClose}
								canCloseFolder={canCloseFolder}
								shortcutSave={saveShortcutLabel()}
								onNewFile={onNewFile}
								onNewWindow={onNewWindow}
								onNewEditorWindow={onNewEditorWindow}
								onOpenFile={onOpenFile}
								onOpenFolder={onOpenFolder}
								onOpenRecentPath={onOpenRecentPath}
								onSave={onSave}
								onSaveAs={onSaveAs}
								onRevert={onRevert}
								onCloseEditor={onCloseEditor}
								onCloseFolder={onCloseFolder}
								onQuit={onQuit}
							/>
						) : null}
					</div>

					{/* ── Edit ── */}
					<div className="ref-menu-dropdown-wrap" ref={editMenuRef}>
						<button
							type="button"
							className={`ref-menu-item${editMenuOpen ? ' is-active' : ''}`}
							aria-expanded={editMenuOpen}
							aria-haspopup="menu"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => { closeAllExcept('edit'); setEditMenuOpen((o) => !o); }}
						>
							{t('app.menuEdit')}
						</button>
						{editMenuOpen ? (
							<div className="ref-menu-dropdown" role="menu" aria-label={t('app.menuEdit')}>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canEditUndoRedo} onMouseDown={(e) => e.preventDefault()} onClick={() => { void executeEditAction('undo'); setEditMenuOpen(false); }}>
									<span>{t('app.edit.undo')}</span><kbd className="ref-menu-kbd">Ctrl+Z</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canEditUndoRedo} onMouseDown={(e) => e.preventDefault()} onClick={() => { void executeEditAction('redo'); setEditMenuOpen(false); }}>
									<span>{t('app.edit.redo')}</span><kbd className="ref-menu-kbd">Ctrl+Shift+Z</kbd>
								</button>
								<div className="ref-menu-dropdown-sep" role="separator" />
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canEditCut} onMouseDown={(e) => e.preventDefault()} onClick={() => { void executeEditAction('cut'); setEditMenuOpen(false); }}>
									<span>{t('app.edit.cut')}</span><kbd className="ref-menu-kbd">Ctrl+X</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canEditCopy} onMouseDown={(e) => e.preventDefault()} onClick={() => { void executeEditAction('copy'); setEditMenuOpen(false); }}>
									<span>{t('app.edit.copy')}</span><kbd className="ref-menu-kbd">Ctrl+C</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canEditPaste} onMouseDown={(e) => e.preventDefault()} onClick={() => { void executeEditAction('paste'); setEditMenuOpen(false); }}>
									<span>{t('app.edit.paste')}</span><kbd className="ref-menu-kbd">Ctrl+V</kbd>
								</button>
								<div className="ref-menu-dropdown-sep" role="separator" />
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canEditSelectAll} onMouseDown={(e) => e.preventDefault()} onClick={() => { void executeEditAction('selectAll'); setEditMenuOpen(false); }}>
									<span>{t('app.edit.selectAll')}</span><kbd className="ref-menu-kbd">Ctrl+A</kbd>
								</button>
							</div>
						) : null}
					</div>

					{/* ── View ── */}
					<div className="ref-menu-dropdown-wrap" ref={viewMenuRef}>
						<button
							type="button"
							className={`ref-menu-item${viewMenuOpen ? ' is-active' : ''}`}
							aria-expanded={viewMenuOpen}
							aria-haspopup="menu"
							onClick={() => { closeAllExcept('view'); setViewMenuOpen((o) => !o); }}
						>
							{t('app.menuView')}
						</button>
						{viewMenuOpen ? (
							<div className="ref-menu-dropdown" role="menu" aria-label={t('app.menuView')}>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" onClick={() => { toggleSidebarVisibility(); setViewMenuOpen(false); }}>
									<span>{t('app.view.toggleSidebar')}</span><kbd className="ref-menu-kbd">Ctrl+B</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canToggleTerminal} onClick={() => { toggleTerminalVisibility(); setViewMenuOpen(false); }}>
									<span>{t('app.view.toggleTerminal')}</span><kbd className="ref-menu-kbd">Ctrl+J</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canToggleDiffPanel} onClick={() => { toggleDiffPanelVisibility(); setViewMenuOpen(false); }}>
									<span>{t('app.view.toggleDiffPanel')}</span><kbd className="ref-menu-kbd">Alt+Ctrl+B</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" onClick={() => { openQuickOpen(''); setViewMenuOpen(false); }}>
									<span>{t('app.view.find')}</span><kbd className="ref-menu-kbd">Ctrl+F</kbd>
								</button>
								<div className="ref-menu-dropdown-sep" role="separator" />
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canGoPrevThread} onClick={() => { void goToPreviousThread(); setViewMenuOpen(false); }}>
									<span>{t('app.view.previousThread')}</span><kbd className="ref-menu-kbd">Ctrl+Shift+[</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canGoNextThread} onClick={() => { void goToNextThread(); setViewMenuOpen(false); }}>
									<span>{t('app.view.nextThread')}</span><kbd className="ref-menu-kbd">Ctrl+Shift+]</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canGoBackThread} onClick={() => { void goThreadBack(); setViewMenuOpen(false); }}>
									<span>{t('app.view.back')}</span><kbd className="ref-menu-kbd">Ctrl+[</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" disabled={!canGoForwardThread} onClick={() => { void goThreadForward(); setViewMenuOpen(false); }}>
									<span>{t('app.view.forward')}</span><kbd className="ref-menu-kbd">Ctrl+]</kbd>
								</button>
								<div className="ref-menu-dropdown-sep" role="separator" />
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" onClick={() => { zoomInUi(); setViewMenuOpen(false); }}>
									<span>{t('app.view.zoomIn')}</span><kbd className="ref-menu-kbd">Ctrl++</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" onClick={() => { zoomOutUi(); setViewMenuOpen(false); }}>
									<span>{t('app.view.zoomOut')}</span><kbd className="ref-menu-kbd">Ctrl+-</kbd>
								</button>
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" onClick={() => { resetUiZoom(); setViewMenuOpen(false); }}>
									<span>{t('app.view.actualSize')}</span><kbd className="ref-menu-kbd">Ctrl+0</kbd>
								</button>
								<div className="ref-menu-dropdown-sep" role="separator" />
								<button type="button" role="menuitem" className="ref-menu-dropdown-item ref-menu-dropdown-item--row" onClick={() => { void toggleFullscreen(); setViewMenuOpen(false); }}>
									<span>{t('app.view.toggleFullscreen')}</span>
								</button>
							</div>
						) : null}
					</div>

					{/* ── Window ── */}
					<div className="ref-menu-dropdown-wrap" ref={windowMenuRef}>
						<button
							type="button"
							className={`ref-menu-item${windowMenuOpen ? ' is-active' : ''}`}
							aria-expanded={windowMenuOpen}
							aria-haspopup="menu"
							onClick={() => { closeAllExcept('window'); setWindowMenuOpen((o) => !o); }}
						>
							{t('app.menuWindow')}
						</button>
						{windowMenuOpen ? (
							<MenubarWindowMenu
								onClose={closeWindow}
								isDesktopShell={!!shell}
								windowMaximized={localWindowMaximized}
								onNewWindow={onNewWindow}
								onNewEditorWindow={onNewEditorWindow}
								onMinimize={onMinimize}
								onToggleMaximize={onToggleMaximize}
								onCloseWindow={onCloseWindow}
							/>
						) : null}
					</div>

					<button type="button" className="ref-menu-item">{t('app.menuHelp')}</button>

					{/* ── Terminal (editor mode only) ── */}
					{layoutMode === 'editor' && workspace ? (
						<div className="ref-menu-dropdown-wrap" ref={terminalMenuRef}>
							<button
								type="button"
								className={`ref-menu-item${terminalMenuOpen ? ' is-active' : ''}`}
								aria-expanded={terminalMenuOpen}
								aria-haspopup="menu"
								onClick={() => { closeAllExcept('terminal'); setTerminalMenuOpen((o) => !o); }}
							>
								{t('app.menuTerminal')}
								<IconChevron className="ref-menu-chevron" />
							</button>
							{terminalMenuOpen ? (
								<div className="ref-menu-dropdown" role="menu">
									<button type="button" role="menuitem" className="ref-menu-dropdown-item" onClick={spawnEditorTerminal}>
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
	);
});
