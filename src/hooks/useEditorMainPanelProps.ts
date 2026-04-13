import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { EditorMainPanelProps } from '../EditorMainPanel';
import type { EditorTab } from '../EditorTabBar';

export type UseEditorMainPanelPropsParams = Omit<
	EditorMainPanelProps,
	| 'openWorkspacePicker'
	| 'onEditorValueChange'
	| 'onLoadFile'
	| 'onSaveFile'
	| 'appendEditorTerminal'
	| 'onSelectTab'
> & {
	setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;
	onLoadFile: () => void | Promise<void>;
	onSaveFile: () => void | Promise<void>;
	appendEditorTerminal: (opts?: { cwdRel?: string }) => void | Promise<void>;
	onSelectTab: (id: string) => void | Promise<void>;
	setEditorValue: Dispatch<SetStateAction<string>>;
	setOpenTabs: Dispatch<SetStateAction<EditorTab[]>>;
};

export function useEditorMainPanelProps({
	setWorkspacePickerOpen,
	onLoadFile: onLoadFileIn,
	onSaveFile: onSaveFileIn,
	appendEditorTerminal: appendEditorTerminalIn,
	setEditorValue,
	setOpenTabs,
	onSelectTab: onSelectTabIn,
	...er
}: UseEditorMainPanelPropsParams): EditorMainPanelProps {
	const openWorkspacePicker = useCallback(() => setWorkspacePickerOpen(true), [setWorkspacePickerOpen]);

	const onLoadFile = useCallback(() => {
		void onLoadFileIn();
	}, [onLoadFileIn]);

	const onSaveFile = useCallback(() => {
		void onSaveFileIn();
	}, [onSaveFileIn]);

	const appendEditorTerminal = useCallback(() => {
		void appendEditorTerminalIn();
	}, [appendEditorTerminalIn]);

	const onSelectTab = useCallback(
		(id: string) => {
			void onSelectTabIn(id);
		},
		[onSelectTabIn]
	);

	const onEditorValueChange = useCallback(
		(value: string) => {
			setEditorValue(value);
			const fp = er.filePath.trim();
			setOpenTabs((prev) => prev.map((tab) => (tab.filePath === fp ? { ...tab, dirty: true } : tab)));
		},
		[setEditorValue, setOpenTabs, er.filePath]
	);

	return useMemo(
		() => ({
			...er,
			openWorkspacePicker,
			onLoadFile,
			onSaveFile,
			appendEditorTerminal,
			onSelectTab,
			onEditorValueChange,
		}),
		[
			appendEditorTerminal,
			onEditorValueChange,
			onLoadFile,
			onSaveFile,
			onSelectTab,
			openWorkspacePicker,
			er.activeEditorInlineDiff,
			er.activeTabId,
			er.awaitingReply,
			er.beginResizeEditorTerminal,
			er.closeEditorTerminalPanel,
			er.closeEditorTerminalSession,
			er.editorCenterPlanCanBuild,
			er.editorCenterPlanMarkdown,
			er.onSelectTeamTask,
			er.editorPlanBuildModelId,
			er.editorPlanFileIsBuilt,
			er.editorSettings,
			er.editorTerminalHeightPx,
			er.editorTerminalSessions,
			er.editorTerminalVisible,
			er.editorValue,
			er.filePath,
			er.markdownPaneMode,
			er.markdownPreviewContent,
			er.modelPickerItems,
			er.monacoChromeTheme,
			er.monacoDocumentPath,
			er.monacoOriginalDocumentPath,
			er.onCloseTab,
			er.onEditorTerminalSessionExit,
			er.onExecutePlanFromEditor,
			er.onMonacoDiffMount,
			er.onMonacoMount,
			er.onPlanBuild,
			er.openTabs,
			er.planFilePath,
			er.planFileRelPath,
			er.planReviewIsBuilt,
			er.setActiveEditorTerminalId,
			er.setEditorPlanBuildModelId,
			er.setMarkdownPaneMode,
			er.selectedTeamTaskId,
			er.showEditorPlanDocumentInCenter,
			er.showEditorTeamWorkflowInCenter,
			er.showPlanFileEditorChrome,
			er.t,
			er.teamSession,
		]
	);
}
