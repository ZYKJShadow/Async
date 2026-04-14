import { memo, type KeyboardEvent } from 'react';
import { AgentChatPanel, type AgentChatPanelProps } from '../AgentChatPanel';
import { IconDoc, IconGitSCM } from '../icons';
import type { TFunction } from '../i18n';
import { AgentWorkspaceLauncher } from './AgentWorkspaceLauncher';
import type { WorkspaceLauncherTool } from './workspaceLaunchers';

export type AgentRightSidebarView = 'git' | 'plan' | 'file' | 'team';

export type AgentAgentCenterColumnProps = {
	t: TFunction;
	hasConversation: boolean;
	workspace: string | null;
	workspaceBasename: string;
	currentThreadTitle: string;
	onPlanNewIdea: (e: KeyboardEvent) => void;
	hasAgentPlanSidebarContent: boolean;
	agentRightSidebarOpen: boolean;
	agentRightSidebarView: AgentRightSidebarView;
	toggleAgentRightSidebarView: (view: AgentRightSidebarView) => void;
	onLaunchWorkspaceWithTool: (tool: WorkspaceLauncherTool) => void;
	chatPanelProps: Omit<AgentChatPanelProps, 'layout'>;
};

/** Agent 布局中间列：上下文条 + 右侧栏切换 + 对话面板；memo 以便在 Git 等兄弟域重渲染时跳过本列 reconciliation */
export const AgentAgentCenterColumn = memo(function AgentAgentCenterColumn({
	t,
	hasConversation,
	workspace,
	workspaceBasename,
	currentThreadTitle,
	onPlanNewIdea,
	hasAgentPlanSidebarContent,
	agentRightSidebarOpen,
	agentRightSidebarView,
	toggleAgentRightSidebarView,
	onLaunchWorkspaceWithTool,
	chatPanelProps,
}: AgentAgentCenterColumnProps) {
	const threadMessagesPending =
		chatPanelProps.currentId != null &&
		chatPanelProps.messagesThreadId !== chatPanelProps.currentId;
	const showThreadSubtitle =
		hasConversation ||
		(threadMessagesPending && currentThreadTitle.trim().length > 0);

	if (import.meta.env.DEV) {
		console.log(
			`[perf] AgentAgentCenterColumn render: currentId=${chatPanelProps.currentId ?? 'null'} msgsThread=${chatPanelProps.messagesThreadId ?? 'null'}, hasConv=${hasConversation}`
		);
	}

	return (
		<main
			className={`ref-center ref-center--agent-layout ${
				hasConversation || threadMessagesPending ? 'ref-center--chat' : 'ref-center--empty-agent'
			}`}
			aria-label={t('app.commandCenter')}
			onKeyDown={onPlanNewIdea}
		>
			<div className="ref-context-block ref-context-block--agent">
				<div className="ref-context-line">
					<span className="ref-agent-context-pill">
						<IconDoc className="ref-context-icon" />
						<span className="ref-context-title">{workspace ? workspaceBasename : t('app.noWorkspace')}</span>
					</span>
				</div>
				{showThreadSubtitle ? (
					<div className="ref-context-sub ref-context-sub--agent" title={currentThreadTitle}>
						{currentThreadTitle}
					</div>
				) : null}
			</div>

			<div className="ref-agent-rail-toggle-group" aria-label={t('app.rightSidebarViews')}>
				{hasAgentPlanSidebarContent ? (
					<button
						type="button"
						className={`ref-agent-rail-toggle ${agentRightSidebarOpen && agentRightSidebarView === 'plan' ? 'is-open' : ''}`}
						onClick={() => toggleAgentRightSidebarView('plan')}
						title={t('app.tabPlan')}
						aria-label={t('app.tabPlan')}
						aria-pressed={agentRightSidebarOpen && agentRightSidebarView === 'plan'}
						aria-controls="agent-right-sidebar"
					>
						<IconDoc />
					</button>
				) : null}
				<AgentWorkspaceLauncher
					t={t}
					workspace={workspace}
					onLaunchTool={onLaunchWorkspaceWithTool}
				/>
				<button
					type="button"
					className={`ref-agent-rail-toggle ${agentRightSidebarOpen && agentRightSidebarView === 'git' ? 'is-open' : ''}`}
					onClick={() => toggleAgentRightSidebarView('git')}
					title={t('app.tabGit')}
					aria-label={t('app.tabGit')}
					aria-pressed={agentRightSidebarOpen && agentRightSidebarView === 'git'}
					aria-controls="agent-right-sidebar"
				>
					<IconGitSCM />
				</button>
			</div>

			<AgentChatPanel layout="agent-center" {...chatPanelProps} />
		</main>
	);
}, (prev, next) => {
	// 自定义比较：只关注真正影响渲染的关键 props
	return (
		prev.hasConversation === next.hasConversation &&
		prev.workspace === next.workspace &&
		prev.workspaceBasename === next.workspaceBasename &&
		prev.currentThreadTitle === next.currentThreadTitle &&
		prev.hasAgentPlanSidebarContent === next.hasAgentPlanSidebarContent &&
		prev.agentRightSidebarOpen === next.agentRightSidebarOpen &&
		prev.agentRightSidebarView === next.agentRightSidebarView &&
		prev.chatPanelProps === next.chatPanelProps // 引用比较，由 useAgentChatPanelProps 的 useMemo 保证
	);
});
