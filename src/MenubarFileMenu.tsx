import { useState } from 'react';
import { useI18n } from './i18n';

function IconChevronSub({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
			<path d="M6 4l4 4-4 4V4z" />
		</svg>
	);
}

export type MenubarFileMenuProps = {
	onClose: () => void;
	isDesktopShell: boolean;
	hasWorkspace: boolean;
	folderRecents: string[];
	canSave: boolean;
	canEditorClose: boolean;
	canCloseFolder: boolean;
	shortcutSave: string;
	onNewFile: () => void;
	onNewWindow: () => void;
	onNewEditorWindow: () => void;
	onOpenFile: () => void;
	onOpenFolder: () => void;
	onOpenRecentPath: (absPath: string) => void;
	onSave: () => void;
	onSaveAs: () => void;
	onRevert: () => void;
	onCloseEditor: () => void;
	onCloseFolder: () => void;
	onQuit: () => void;
};

function displayRecentPath(p: string, maxLen: number): string {
	if (p.length <= maxLen) {
		return p;
	}
	return `…${p.slice(-(maxLen - 1))}`;
}

export function MenubarFileMenu({
	onClose,
	isDesktopShell,
	hasWorkspace,
	folderRecents,
	canSave,
	canEditorClose,
	canCloseFolder,
	shortcutSave,
	onNewFile,
	onNewWindow,
	onNewEditorWindow,
	onOpenFile,
	onOpenFolder,
	onOpenRecentPath,
	onSave,
	onSaveAs,
	onRevert,
	onCloseEditor,
	onCloseFolder,
	onQuit,
}: MenubarFileMenuProps) {
	const { t } = useI18n();
	const [recentOpen, setRecentOpen] = useState(false);

	const needWs = !isDesktopShell || !hasWorkspace;

	return (
		<div className="ref-menu-dropdown" role="menu" aria-label={t('app.fileMenu.aria')}>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={needWs}
				onClick={() => {
					onNewFile();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.newFile')}</span>
			</button>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!isDesktopShell}
				onClick={() => {
					onNewWindow();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.newWindow')}</span>
			</button>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!isDesktopShell}
				onClick={() => {
					onNewEditorWindow();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.newEditorWindow')}</span>
			</button>
			<div className="ref-menu-dropdown-sep" role="separator" />
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={needWs}
				onClick={() => {
					onOpenFile();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.openFile')}</span>
			</button>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!isDesktopShell}
				onClick={() => {
					onOpenFolder();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.openFolder')}</span>
			</button>
			<div
				className="ref-menu-submenu-wrap"
				onMouseEnter={() => setRecentOpen(true)}
				onMouseLeave={() => setRecentOpen(false)}
			>
				<button
					type="button"
					className="ref-menu-dropdown-item ref-menu-dropdown-item--submenu-parent"
					disabled={!isDesktopShell}
					aria-expanded={recentOpen}
					aria-haspopup="menu"
					onFocus={() => setRecentOpen(true)}
				>
					<span>{t('app.fileMenu.openRecent')}</span>
					<IconChevronSub className="ref-menu-submenu-chevron" />
				</button>
				{recentOpen && isDesktopShell ? (
					<div className="ref-menu-submenu" role="menu" aria-label={t('app.fileMenu.openRecent')}>
						{folderRecents.length === 0 ? (
							<div className="ref-menu-submenu-empty">{t('app.fileMenu.openRecentEmpty')}</div>
						) : (
							folderRecents.map((p) => (
								<button
									key={p}
									type="button"
									role="menuitem"
									className="ref-menu-dropdown-item ref-menu-submenu-path-item"
									title={p}
									onClick={() => {
										onOpenRecentPath(p);
										onClose();
										setRecentOpen(false);
									}}
								>
									{displayRecentPath(p, 44)}
								</button>
							))
						)}
					</div>
				) : null}
			</div>
			<div className="ref-menu-dropdown-sep" role="separator" />
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!canSave}
				onClick={() => {
					onSave();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.save')}</span>
				<kbd className="ref-menu-kbd">{shortcutSave}</kbd>
			</button>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={needWs || !canSave}
				onClick={() => {
					onSaveAs();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.saveAs')}</span>
			</button>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!canSave}
				onClick={() => {
					onRevert();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.revertFile')}</span>
			</button>
			<div className="ref-menu-dropdown-sep" role="separator" />
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!canEditorClose}
				onClick={() => {
					onCloseEditor();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.closeEditor')}</span>
			</button>
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!canCloseFolder}
				onClick={() => {
					onCloseFolder();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.closeFolder')}</span>
			</button>
			<div className="ref-menu-dropdown-sep" role="separator" />
			<button
				type="button"
				role="menuitem"
				className="ref-menu-dropdown-item ref-menu-dropdown-item--row"
				disabled={!isDesktopShell}
				onClick={() => {
					onQuit();
					onClose();
				}}
			>
				<span>{t('app.fileMenu.quit')}</span>
			</button>
		</div>
	);
}
