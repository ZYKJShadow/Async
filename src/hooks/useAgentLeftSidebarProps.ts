import { useCallback, useMemo, type Dispatch, type MutableRefObject, type ReactNode, type RefObject, type SetStateAction } from 'react';
import type { SettingsNavId } from '../SettingsPage';
import type { TFunction } from '../i18n';
import type { ThreadInfo } from '../threadTypes';
import type { AgentLeftSidebarProps, AgentSidebarWorkspace } from '../AgentLeftSidebar';

export type UseAgentLeftSidebarPropsParams = {
	t: TFunction;
	agentSidebarWorkspaces: AgentSidebarWorkspace[];
	renderThreadItem: (thread: ThreadInfo, threadListWorkspace: string) => ReactNode;
	editingWorkspacePath: string | null;
	editingWorkspaceNameDraft: string;
	setEditingWorkspaceNameDraft: Dispatch<SetStateAction<string>>;
	workspaceNameDraftRef: MutableRefObject<string>;
	workspaceNameInputRef: RefObject<HTMLInputElement | null>;
	commitWorkspaceAliasEdit: () => void;
	cancelWorkspaceAliasEdit: () => void;
	handleWorkspacePrimaryAction: (path: string) => void;
	workspaceMenuPath: string | null;
	closeWorkspaceMenu: () => void;
	openWorkspaceMenu: (path: string, anchor: HTMLButtonElement) => void;
	onNewThread: () => void | Promise<void>;
	onNewThreadForWorkspace: (path: string) => void | Promise<void>;
	setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;
	openQuickOpen: (seed?: string) => void;
	openSettingsPage: (nav: SettingsNavId) => void;
	openUniversalTerminal: () => void;
};

export function useAgentLeftSidebarProps(p: UseAgentLeftSidebarPropsParams): AgentLeftSidebarProps {
	const onWorkspaceNameDraftChange = useCallback(
		(value: string) => {
			p.setEditingWorkspaceNameDraft(value);
			p.workspaceNameDraftRef.current = value;
		},
		[p.setEditingWorkspaceNameDraft, p.workspaceNameDraftRef]
	);

	const openWorkspacePicker = useCallback(() => {
		p.setWorkspacePickerOpen(true);
	}, [p.setWorkspacePickerOpen]);

	const openPluginSettings = useCallback(() => {
		p.openSettingsPage('plugins');
	}, [p.openSettingsPage]);

	const openGeneralSettings = useCallback(() => {
		p.openSettingsPage('general');
	}, [p.openSettingsPage]);

	const openUniversalTerminal = useCallback(() => {
		p.openUniversalTerminal();
	}, [p.openUniversalTerminal]);

	const onNewThread = useCallback(() => {
		void p.onNewThread();
	}, [p.onNewThread]);

	const onNewThreadForWorkspace = useCallback(
		(path: string) => {
			void p.onNewThreadForWorkspace(path);
		},
		[p.onNewThreadForWorkspace]
	);

	const openQuickOpen = useCallback(() => {
		p.openQuickOpen();
	}, [p.openQuickOpen]);

	return useMemo(
		() => ({
			t: p.t,
			agentSidebarWorkspaces: p.agentSidebarWorkspaces,
			renderThreadItem: p.renderThreadItem,
			editingWorkspacePath: p.editingWorkspacePath,
			editingWorkspaceNameDraft: p.editingWorkspaceNameDraft,
			workspaceNameInputRef: p.workspaceNameInputRef,
			onWorkspaceNameDraftChange,
			commitWorkspaceAliasEdit: p.commitWorkspaceAliasEdit,
			cancelWorkspaceAliasEdit: p.cancelWorkspaceAliasEdit,
			handleWorkspacePrimaryAction: p.handleWorkspacePrimaryAction,
			workspaceMenuPath: p.workspaceMenuPath,
			closeWorkspaceMenu: p.closeWorkspaceMenu,
			openWorkspaceMenu: p.openWorkspaceMenu,
			onNewThread,
			onNewThreadForWorkspace,
			openWorkspacePicker,
			openQuickOpen,
			openPluginSettings,
			openGeneralSettings,
			openUniversalTerminal,
		}),
		[
			p.t,
			p.agentSidebarWorkspaces,
			p.renderThreadItem,
			p.editingWorkspacePath,
			p.editingWorkspaceNameDraft,
			p.workspaceNameInputRef,
			onWorkspaceNameDraftChange,
			p.commitWorkspaceAliasEdit,
			p.cancelWorkspaceAliasEdit,
			p.handleWorkspacePrimaryAction,
			p.workspaceMenuPath,
			p.closeWorkspaceMenu,
			p.openWorkspaceMenu,
			onNewThread,
			onNewThreadForWorkspace,
			openWorkspacePicker,
			openQuickOpen,
			openPluginSettings,
			openGeneralSettings,
			openUniversalTerminal,
		]
	);
}
