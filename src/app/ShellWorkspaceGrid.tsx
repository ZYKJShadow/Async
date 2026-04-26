import { memo } from 'react';
import {
	ShellLeftRailGroup,
	ShellCenterRightGroup,
	type ShellLeftRailGroupProps,
	type ShellCenterRightGroupProps,
} from './ShellWorkspaceColumns';
import { AGENT_RESIZE_HANDLE_PX, RESIZE_HANDLE_PX, type ShellLayoutMode } from './shellLayoutStorage';

export type ShellWorkspaceGridProps = {
	layoutMode: ShellLayoutMode;
	leftSidebarOpen: boolean;
	agentRightSidebarOpen: boolean;
	railWidths: { left: number; right: number };
	leftRail: ShellLeftRailGroupProps;
	centerRight: ShellCenterRightGroupProps;
};

/**
 * 有工作区时的 ref-body 五列网格；与欢迎页分离，避免无工作区时仍随聊天流式 props 无效重渲。
 */
export const ShellWorkspaceGrid = memo(function ShellWorkspaceGrid({
	layoutMode,
	leftSidebarOpen,
	agentRightSidebarOpen,
	railWidths,
	leftRail,
	centerRight,
}: ShellWorkspaceGridProps) {
	const handlePx = layoutMode === 'agent' ? AGENT_RESIZE_HANDLE_PX : RESIZE_HANDLE_PX;

	return (
		<div
			className={`ref-body ${
				layoutMode === 'editor' ? 'ref-body--editor ref-body--editor-shell' : 'ref-body--agent-shell'
			}`}
			style={{
				gridTemplateColumns:
					layoutMode === 'agent' && !agentRightSidebarOpen
						? `${leftSidebarOpen ? railWidths.left : 0}px ${leftSidebarOpen ? handlePx : 0}px minmax(0, 1fr) 0px 0px`
						: `${leftSidebarOpen ? railWidths.left : 0}px ${leftSidebarOpen ? handlePx : 0}px minmax(0, 1fr) ${handlePx}px ${railWidths.right}px`,
			}}
		>
			<ShellLeftRailGroup {...leftRail} />
			<ShellCenterRightGroup {...centerRight} />
		</div>
	);
});
