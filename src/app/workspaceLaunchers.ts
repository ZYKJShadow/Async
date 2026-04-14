import type { TFunction } from '../i18n';

export type WorkspaceLauncherTool = 'vscode' | 'cursor' | 'antigravity' | 'explorer' | 'terminal';

export const DEFAULT_WORKSPACE_LAUNCHER: WorkspaceLauncherTool = 'vscode';
export const AGENT_WORKSPACE_LAUNCHER_STORAGE_KEY = 'async:agent-workspace-launcher-v1';
export const WORKSPACE_LAUNCHER_ORDER: readonly WorkspaceLauncherTool[] = [
	'vscode',
	'cursor',
	'antigravity',
	'explorer',
	'terminal',
];

export function isWorkspaceLauncherTool(value: unknown): value is WorkspaceLauncherTool {
	return (
		value === 'vscode' ||
		value === 'cursor' ||
		value === 'antigravity' ||
		value === 'explorer' ||
		value === 'terminal'
	);
}

export function readStoredWorkspaceLauncher(): WorkspaceLauncherTool {
	if (typeof window === 'undefined') {
		return DEFAULT_WORKSPACE_LAUNCHER;
	}
	try {
		const raw = localStorage.getItem(AGENT_WORKSPACE_LAUNCHER_STORAGE_KEY);
		return isWorkspaceLauncherTool(raw) ? raw : DEFAULT_WORKSPACE_LAUNCHER;
	} catch {
		return DEFAULT_WORKSPACE_LAUNCHER;
	}
}

export function writeStoredWorkspaceLauncher(tool: WorkspaceLauncherTool): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		localStorage.setItem(AGENT_WORKSPACE_LAUNCHER_STORAGE_KEY, tool);
	} catch {
		/* ignore storage errors */
	}
}

export function workspaceLauncherLabel(t: TFunction, tool: WorkspaceLauncherTool): string {
	switch (tool) {
		case 'vscode':
			return t('app.workspaceLauncher.vscode');
		case 'cursor':
			return t('app.workspaceLauncher.cursor');
		case 'antigravity':
			return t('app.workspaceLauncher.antigravity');
		case 'explorer':
			return t('app.workspaceLauncher.explorer');
		case 'terminal':
			return t('app.workspaceLauncher.terminal');
		default:
			return t('app.openWorkspace');
	}
}
