import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
	isMarkdownEditorPath,
	markdownViewForTab,
	stripPlanFrontmatterForPreview,
} from '../editorMarkdownView';
import { isPlanMdPath, planExecutedKey } from '../planExecutedKey';
import { workspaceRelativeFileUrl } from '../workspaceUri';
import { normalizeWorkspaceRelPath } from '../agentFileChangesFromGit';
import type { EditorTab, MarkdownTabView } from '../EditorTabBar';
import type { ComposerMode } from '../ComposerPlusMenu';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';
import type { TFunction } from '../i18n';
import type { EditorInlineDiffState } from './useEditorTabs';
import type { ModelPickerItem } from '../ModelPickerDropdown';

export type UseEditorCenterDerivedParams = {
	filePath: string;
	workspace: string | null;
	openTabs: EditorTab[];
	setOpenTabs: Dispatch<SetStateAction<EditorTab[]>>;
	editorInlineDiffByPath: Record<string, EditorInlineDiffState>;
	editorValue: string;
	executedPlanKeys: string[];
	hasConversation: boolean;
	currentId: string | null;
	awaitingReply: boolean;
	t: TFunction;
	composerMode: ComposerMode;
	layoutMode: ShellLayoutMode;

	// plan center hints
	agentPlanPreviewMarkdown: string;
	agentPlanEffectivePlan: unknown;
	editorPlanBuildModelId: string;
	modelPickerItems: ModelPickerItem[];

	// team center hint (only the bit actually used: selectedTaskId presence)
	teamSelectedTaskId: string | null | undefined;
};

export type UseEditorCenterDerivedResult = {
	monacoDocumentPath: string;
	activeEditorTab: EditorTab | undefined;
	activeEditorInlineDiff: EditorInlineDiffState | null;
	markdownPaneMode: MarkdownTabView | null;
	setMarkdownPaneMode: (mode: MarkdownTabView) => void;
	markdownPreviewContent: string;
	monacoOriginalDocumentPath: string;
	editorActivePlanPathKey: string;
	editorPlanFileIsBuilt: boolean;
	showPlanFileEditorChrome: boolean;
	editorCenterPlanMarkdown: string;
	showEditorPlanDocumentInCenter: boolean;
	showEditorTeamWorkflowInCenter: boolean;
	editorCenterPlanCanBuild: boolean;
};

/**
 * 编辑器中央区的派生状态：
 *  - Monaco 文档 URL / inline diff / 当前 tab
 *  - Markdown view 模式与预览正文
 *  - Plan 文件 chrome（构建中提示 + 已构建标记）
 *  - Editor 布局下中心区是否展示 plan / team workflow
 *
 * 行为与 App.tsx 完全一致；不包含依赖 useTeamSession / useAgentSession 的派生
 * （teamSession / agentSession / activePlanQuestion / activeUserInputRequest /
 *  hasActiveTeamSidebarContent 仍保留在主组件，避免传更多 selector）。
 */
export function useEditorCenterDerived(
	params: UseEditorCenterDerivedParams
): UseEditorCenterDerivedResult {
	const {
		filePath,
		workspace,
		openTabs,
		setOpenTabs,
		editorInlineDiffByPath,
		editorValue,
		executedPlanKeys,
		hasConversation,
		currentId,
		awaitingReply,
		t,
		composerMode,
		layoutMode,
		agentPlanPreviewMarkdown,
		agentPlanEffectivePlan,
		editorPlanBuildModelId,
		modelPickerItems,
		teamSelectedTaskId,
	} = params;

	const monacoDocumentPath = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return '';
		}
		const u = workspaceRelativeFileUrl(workspace, fp);
		return u ?? fp.replace(/\\/g, '/');
	}, [workspace, filePath]);

	const activeEditorTab = useMemo(
		() => openTabs.find((tab) => tab.filePath === filePath.trim()),
		[openTabs, filePath]
	);

	const activeEditorInlineDiff = useMemo(() => {
		const fp = normalizeWorkspaceRelPath(filePath.trim());
		return fp ? editorInlineDiffByPath[fp] ?? null : null;
	}, [editorInlineDiffByPath, filePath]);

	const markdownPaneMode = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return null;
		}
		return markdownViewForTab(fp, activeEditorTab?.markdownView);
	}, [filePath, activeEditorTab?.markdownView]);

	const setMarkdownPaneMode = useCallback(
		(mode: MarkdownTabView) => {
			const fp = filePath.trim();
			if (!fp || !isMarkdownEditorPath(fp)) {
				return;
			}
			setOpenTabs((prev) =>
				prev.map((tab) => (tab.filePath === fp ? { ...tab, markdownView: mode } : tab))
			);
		},
		[filePath, setOpenTabs]
	);

	const markdownPreviewContent = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return editorValue;
		}
		return stripPlanFrontmatterForPreview(fp, editorValue);
	}, [filePath, editorValue]);

	const monacoOriginalDocumentPath = useMemo(() => {
		const fp = filePath.trim();
		if (!fp) {
			return '';
		}
		return `inline-diff-original:///${fp.replace(/\\/g, '/')}`;
	}, [filePath]);

	const editorActivePlanPathKey = useMemo(() => {
		const fp = filePath.trim();
		if (!isPlanMdPath(fp)) {
			return '';
		}
		return planExecutedKey(workspace, fp, null);
	}, [filePath, workspace]);

	const editorPlanFileIsBuilt = useMemo(
		() => Boolean(editorActivePlanPathKey && executedPlanKeys.includes(editorActivePlanPathKey)),
		[editorActivePlanPathKey, executedPlanKeys]
	);

	const showPlanFileEditorChrome =
		hasConversation && !!currentId && isPlanMdPath(filePath.trim());

	const editorCenterPlanMarkdown = useMemo(() => {
		if (agentPlanPreviewMarkdown.trim()) {
			return agentPlanPreviewMarkdown;
		}
		if (layoutMode === 'editor' && composerMode === 'plan' && hasConversation && awaitingReply) {
			return `# ${t('plan.review.label')}\n\n${t('app.planSidebarStreaming')}…`;
		}
		return '';
	}, [agentPlanPreviewMarkdown, layoutMode, composerMode, hasConversation, awaitingReply, t]);

	const showEditorPlanDocumentInCenter =
		layoutMode === 'editor' &&
		composerMode === 'plan' &&
		hasConversation &&
		(awaitingReply || !!editorCenterPlanMarkdown.trim());

	const showEditorTeamWorkflowInCenter =
		layoutMode === 'editor' &&
		composerMode === 'team' &&
		hasConversation &&
		!!teamSelectedTaskId;

	const editorCenterPlanCanBuild =
		!awaitingReply &&
		!!agentPlanEffectivePlan &&
		!!editorPlanBuildModelId.trim() &&
		modelPickerItems.length > 0;

	return {
		monacoDocumentPath,
		activeEditorTab,
		activeEditorInlineDiff,
		markdownPaneMode,
		setMarkdownPaneMode,
		markdownPreviewContent,
		monacoOriginalDocumentPath,
		editorActivePlanPathKey,
		editorPlanFileIsBuilt,
		showPlanFileEditorChrome,
		editorCenterPlanMarkdown,
		showEditorPlanDocumentInCenter,
		showEditorTeamWorkflowInCenter,
		editorCenterPlanCanBuild,
	};
}
