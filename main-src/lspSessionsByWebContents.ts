import { app, BrowserWindow, type WebContents } from 'electron';
import { WorkspaceLspManager } from './lsp/workspaceLspManager.js';
import { getSettings } from './settingsStore.js';

const managersByWebContentsId = new Map<number, WorkspaceLspManager>();

export function getWorkspaceLspManagerForWebContents(wc: WebContents): WorkspaceLspManager {
	let m = managersByWebContentsId.get(wc.id);
	if (!m) {
		m = new WorkspaceLspManager(getSettings, () => app.getAppPath());
		managersByWebContentsId.set(wc.id, m);
		const id = wc.id;
		wc.once('destroyed', () => {
			const cur = managersByWebContentsId.get(id);
			if (cur === m) {
				managersByWebContentsId.delete(id);
			}
			void m!.dispose().catch(() => {});
		});
	}
	return m;
}

export async function disposeWorkspaceLspManagerForWebContents(wc: WebContents): Promise<void> {
	const m = managersByWebContentsId.get(wc.id);
	if (m) {
		managersByWebContentsId.delete(wc.id);
		await m.dispose();
	}
}

/** @deprecated 使用 disposeWorkspaceLspManagerForWebContents */
export const disposeTsLspSessionForWebContents = disposeWorkspaceLspManagerForWebContents;

export async function disposeAllWorkspaceLspManagers(): Promise<void> {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			await disposeWorkspaceLspManagerForWebContents(win.webContents);
		}
	}
}

/** @deprecated 使用 disposeAllWorkspaceLspManagers */
export const disposeAllTsLspSessions = disposeAllWorkspaceLspManagers;
