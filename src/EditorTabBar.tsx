import { FileTypeIcon } from './fileTypeIcons';
import { voidShellDebugLog } from './tabCloseDebug';

export type EditorTab = {
	id: string;
	filePath: string;
	dirty: boolean;
};

type Props = {
	tabs: EditorTab[];
	activeTabId: string | null;
	onSelect: (id: string) => void;
	onClose: (id: string) => void;
};

export function EditorTabBar({ tabs, activeTabId, onSelect, onClose }: Props) {
	if (tabs.length === 0) {
		return null;
	}

	return (
		<div className="ref-tab-bar" role="tablist">
			{tabs.map((tab) => {
				const basename = tab.filePath.split(/[\\/]/).pop() ?? tab.filePath;
				const isActive = tab.id === activeTabId;
				return (
					<div
						key={tab.id}
						className={`ref-tab-item ${isActive ? 'is-active' : ''} ${tab.dirty ? 'is-dirty' : ''}`}
					>
						<div
							role="tab"
							aria-selected={isActive}
							className="ref-tab-main"
							tabIndex={0}
							title={tab.filePath}
							onClick={() => {
								voidShellDebugLog('editor-file-tab-select', {
									tabId: tab.id,
									activeTabId,
									tabIds: tabs.map((x) => x.id),
								});
								onSelect(tab.id);
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelect(tab.id);
								}
							}}
						>
							<span className="ref-tab-icon">
								<FileTypeIcon fileName={basename} isDirectory={false} />
							</span>
							<span className="ref-tab-label">{basename}</span>
							{tab.dirty ? <span className="ref-tab-dot" aria-label="unsaved" /> : null}
						</div>
						<button
							type="button"
							className="ref-tab-close"
							onMouseDown={(e) => {
								if (e.button !== 0) return;
								voidShellDebugLog('editor-file-tab-close-mousedown', {
									tabId: tab.id,
									activeTabId,
									button: e.button,
									tabIds: tabs.map((x) => x.id),
								});
								e.preventDefault();
								e.stopPropagation();
								onClose(tab.id);
							}}
							onClick={(e) => {
								voidShellDebugLog('editor-file-tab-close-click', {
									tabId: tab.id,
									activeTabId,
									button: e.button,
									tabIds: tabs.map((x) => x.id),
								});
								e.preventDefault();
								e.stopPropagation();
								onClose(tab.id);
							}}
							aria-label={`Close ${basename}`}
						>
							<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
								<path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z" />
							</svg>
						</button>
					</div>
				);
			})}
		</div>
	);
}

/** Generate a stable tab id from a file path */
export function tabIdFromPath(filePath: string): string {
	return `tab:${filePath.replace(/\\/g, '/')}`;
}
