import { useMemo, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { AiEmployeesTitlebar } from './AiEmployeesTitlebar';
import {
	IconBot,
	IconChevron,
	IconCircleUser,
	IconListTodo,
	IconMessageCircle,
	IconRefresh,
	IconSettings,
	IconTaskPulse,
} from '../icons';
import { useAiEmployeesController, type AiEmployeesTabId } from './hooks/useAiEmployeesController';
import { ConnectionPage } from './pages/ConnectionPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { InboxPage } from './pages/InboxPage';
import { IssuesHubPage } from './pages/IssuesHubPage';
import { ActivityFeedPage } from './pages/ActivityFeedPage';
import { AiEmployeesSetupFlow } from './onboarding/AiEmployeesSetupFlow';
import './aiEmployees.css';

function workspaceInitial(name: string): string {
	const t = name.trim();
	return t ? t.charAt(0).toUpperCase() : 'M';
}

export function AiEmployeesApp() {
	const { t } = useI18n();
	const c = useAiEmployeesController();

	const activeWorkspaceName = useMemo(() => {
		const w = c.workspaces.find((x) => x.id === c.workspaceId);
		return w?.name ?? (c.workspaceId ? c.workspaceId.slice(0, 8) : '');
	}, [c.workspaces, c.workspaceId]);

	const tabPageTitle = (id: AiEmployeesTabId): string => {
		switch (id) {
			case 'inbox':
				return t('aiEmployees.tab.inbox');
			case 'myIssues':
				return t('aiEmployees.tab.myIssues');
			case 'issues':
				return t('aiEmployees.tab.issues');
			case 'agents':
				return t('aiEmployees.tab.team');
			case 'activity':
				return t('aiEmployees.tab.activity');
			case 'connection':
				return t('aiEmployees.tab.settings');
			default:
				return '';
		}
	};

	const visibleTabs: AiEmployeesTabId[] = ['inbox', 'myIssues', 'issues', 'agents', 'activity', 'connection'];
	const activeTab = visibleTabs.includes(c.tab) ? c.tab : 'inbox';

	const navBusy = c.sessionPhase === 'bootstrapping';
	const navBtn = (id: AiEmployeesTabId, label: string, icon: ReactNode, disabled?: boolean) => (
		<button
			key={id}
			type="button"
			disabled={!!disabled || navBusy}
			className={`ref-ai-employees-nav-item ${activeTab === id ? 'is-active' : ''}`}
			onClick={() => {
				if (!disabled && !navBusy) {
					c.setTab(id);
				}
			}}
		>
			<span className="ref-ai-employees-nav-icon-wrap" aria-hidden>
				{icon}
			</span>
			<span className="ref-ai-employees-nav-label">{label}</span>
		</button>
	);

	const showAiEmployeesSetupFlow =
		c.sessionPhase === 'need_connection' ||
		c.sessionPhase === 'onboarding' ||
		c.sessionPhase === 'no_workspace' ||
		(c.sessionPhase === 'bootstrapping' && c.holdSetupDuringBootstrap);

	if (showAiEmployeesSetupFlow) {
		return (
			<div className="ref-shell ref-shell--agent-layout ref-ai-employees-root">
				<AiEmployeesTitlebar t={t} />
				<AiEmployeesSetupFlow
					t={t}
					sessionPhase={c.sessionPhase}
					conn={c.conn}
					aiSettings={c.aiSettings}
					setAiSettings={c.setAiSettings}
					onSaveConnection={() => void c.saveConnectionAndReconnect()}
					connectionError={c.loadErr}
					onClearConnectionError={c.clearLoadErr}
					localRoot={c.localRoot}
					workspaceId={c.workspaceId}
					workspaces={c.workspaces}
					companyName={c.bootstrapStatus?.companyName ?? ''}
					bootstrapStatus={c.bootstrapStatus}
					orgEmployees={c.orgEmployees}
					promptTemplates={c.promptTemplates}
					modelOptionIdSet={c.modelOptionIdSet}
					defaultModelId={c.localModels.defaultModelId}
					agentLocalModelMap={c.aiSettings.agentLocalModelIdByRemoteAgentId}
					employeeLocalModelMap={c.aiSettings.employeeLocalModelIdByEmployeeId}
					onLoadPromptTemplates={c.loadPromptTemplatesForOnboarding}
					onSync={c.syncOnboardingAfterMutation}
					onBindEmployeeLocalModel={c.bindEmployeeLocalModel}
					onClearEmployeeLocalModel={c.clearEmployeeLocalModel}
					modelOptions={c.modelOptions}
				/>
			</div>
		);
	}

	return (
		<div className="ref-shell ref-shell--agent-layout ref-ai-employees-root">
			<AiEmployeesTitlebar t={t} />
			<div className="ref-ai-employees-dashboard">
				<div className="ref-ai-employees-sidebar-outer" aria-label={t('aiEmployees.sideNavAria')}>
					<div className="ref-ai-employees-sidebar-inner">
						<header className="ref-ai-employees-sidebar-header">
							<select
								className="ref-settings-native-select ref-ai-employees-workspace-select"
								value={c.workspaceId}
								disabled={c.sessionPhase === 'bootstrapping'}
								onChange={(e) => c.onWorkspaceSelectChange(e.target.value)}
								aria-label={t('aiEmployees.remoteWorkspace')}
							>
								<option value="">{t('aiEmployees.pickWorkspace')}</option>
								{c.workspaces.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name ?? w.id.slice(0, 8)}
									</option>
								))}
							</select>
						</header>
							<nav className="ref-ai-employees-sidebar-scroll">
								<div className="ref-ai-employees-nav-group">
									<div className="ref-ai-employees-nav-group-label">{t('aiEmployees.navGroup.workspace')}</div>
									<div className="ref-ai-employees-nav-group-content">
										{navBtn('inbox', t('aiEmployees.tab.inbox'), <IconMessageCircle className="ref-ai-employees-nav-icon" />)}
										{navBtn('myIssues', t('aiEmployees.tab.myIssues'), <IconCircleUser className="ref-ai-employees-nav-icon" />)}
										{navBtn('issues', t('aiEmployees.tab.issues'), <IconListTodo className="ref-ai-employees-nav-icon" />)}
										{navBtn('agents', t('aiEmployees.tab.team'), <IconBot className="ref-ai-employees-nav-icon" />)}
										{navBtn('activity', t('aiEmployees.tab.activity'), <IconTaskPulse className="ref-ai-employees-nav-icon" />)}
									</div>
								</div>
								<div className="ref-ai-employees-nav-group">
									<div className="ref-ai-employees-nav-group-label">{t('aiEmployees.navGroup.configure')}</div>
									<div className="ref-ai-employees-nav-group-content">
										{navBtn('connection', t('aiEmployees.tab.settings'), <IconSettings className="ref-ai-employees-nav-icon" />)}
									</div>
								</div>
						</nav>
					</div>
				</div>
				<main className="ref-ai-employees-inset">
					<div className="ref-ai-employees-breadcrumb">
						<div className="ref-ai-employees-breadcrumb-path">
							<div className="ref-ai-employees-ws-avatar" aria-hidden>
								{workspaceInitial(activeWorkspaceName || 'M')}
							</div>
							<span className="ref-ai-employees-breadcrumb-ws" title={activeWorkspaceName || undefined}>
								{activeWorkspaceName || t('aiEmployees.breadcrumbWorkspaceFallback')}
							</span>
							<IconChevron className="ref-ai-employees-breadcrumb-chevron" />
							<span className="ref-ai-employees-breadcrumb-page">{tabPageTitle(activeTab)}</span>
						</div>
						<div className="ref-ai-employees-breadcrumb-actions">
							<button
								type="button"
								className="ref-agent-sidebar-icon-btn"
								disabled={c.sessionPhase === 'bootstrapping'}
								onClick={() => void c.refreshDataRef.current()}
								title={t('common.refresh')}
							>
								<IconRefresh />
							</button>
						</div>
					</div>
					<div className="ref-ai-employees-inset-subbar">
						<div className="ref-ai-employees-inset-subbar-left">
							{c.localRoot ? (
								<span className="ref-ai-employees-pill ref-ai-employees-pill--muted" title={c.localRoot}>
									{t('aiEmployees.localWorkspace')}: {c.localRoot.replace(/\\/g, '/').split('/').pop()}
								</span>
							) : (
								<span className="ref-ai-employees-muted">{t('aiEmployees.noLocalFolder')}</span>
							)}
						</div>
					</div>
					<div className="ref-ai-employees-inset-body">
						{c.sessionPhase === 'bootstrapping' ? (
							<div className="ref-ai-employees-bootstrap" aria-busy="true" aria-label={t('aiEmployees.bootstrapAria')}>
								<div className="ref-ai-employees-skeleton ref-ai-employees-skeleton--breadcrumb" />
								<div className="ref-ai-employees-skeleton-board">
									{[0, 1, 2, 3].map((i) => (
										<div key={i} className="ref-ai-employees-skeleton-column">
											<div className="ref-ai-employees-skeleton ref-ai-employees-skeleton--head" />
											<div className="ref-ai-employees-skeleton ref-ai-employees-skeleton--card" />
											<div className="ref-ai-employees-skeleton ref-ai-employees-skeleton--card" />
										</div>
									))}
								</div>
							</div>
						) : c.sessionPhase === 'no_workspace' && activeTab !== 'connection' ? (
							<div className="ref-ai-employees-stub ref-ai-employees-stub--phase">
								<div className="ref-ai-employees-stub-title">{t('aiEmployees.noWorkspaceTitle')}</div>
								<p>{t('aiEmployees.noWorkspaceHint')}</p>
							</div>
						) : (
							<>
								{c.loadErr ? (
									<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
										{c.loadErr}
									</div>
								) : null}

								<div key={activeTab} className="ref-ai-employees-tab-panel">
									{activeTab === 'inbox' ? (
										<InboxPage
											t={t}
											orgEmployees={c.orgEmployees}
											orchestration={c.orchestration}
											conn={c.conn}
											workspaceId={c.workspaceId}
											inboxVersion={c.inboxVersion}
											agentLocalModelMap={c.aiSettings.agentLocalModelIdByRemoteAgentId}
											employeeLocalModelMap={c.aiSettings.employeeLocalModelIdByEmployeeId}
											defaultModelId={c.localModels.defaultModelId}
											modelOptions={c.modelOptions}
											modelOptionIdSet={c.modelOptionIdSet}
											onCreateRun={c.createEmployeeRun}
											onSendMessage={c.sendCollabMessage}
											onMarkMessageRead={c.markCollabMessageRead}
											listMessagesByEmployee={c.listMessagesByEmployee}
											findActiveRunByEmployee={c.findActiveRunByEmployee}
											employeeChatStreaming={c.employeeChatStreaming}
											employeeChatError={c.employeeChatError}
										/>
									) : null}

									{activeTab === 'myIssues' ? (
										<IssuesHubPage
											t={t}
											workspaceName={activeWorkspaceName || t('aiEmployees.breadcrumbWorkspaceFallback')}
											issues={c.myIssues}
											issuesLookup={c.issues}
											variant="my"
											agents={c.agents}
											members={c.workspaceMembers}
											onPatchIssue={c.patchWorkspaceIssue}
											onCreateIssue={c.createWorkspaceIssue}
										/>
									) : null}

									{activeTab === 'issues' ? (
										<IssuesHubPage
											t={t}
											workspaceName={activeWorkspaceName || t('aiEmployees.breadcrumbWorkspaceFallback')}
											issues={c.issues}
											variant="workspace"
											agents={c.agents}
											members={c.workspaceMembers}
											onPatchIssue={c.patchWorkspaceIssue}
											onCreateIssue={c.createWorkspaceIssue}
										/>
									) : null}

									{activeTab === 'agents' ? (
										<EmployeesPage
											t={t}
											conn={c.conn}
											workspaceId={c.workspaceId}
											companyName={c.bootstrapStatus?.companyName ?? ''}
											orgEmployees={c.orgEmployees}
											onRefreshOrg={c.refreshOrgEmployeesList}
											agentLocalModelMap={c.aiSettings.agentLocalModelIdByRemoteAgentId}
											employeeLocalModelMap={c.aiSettings.employeeLocalModelIdByEmployeeId}
											modelOptions={c.modelOptions}
											modelOptionIdSet={c.modelOptionIdSet}
											onBindEmployeeLocalModel={c.bindEmployeeLocalModel}
											defaultModelId={c.localModels.defaultModelId}
											orchestration={c.orchestration}
										/>
									) : null}

									{activeTab === 'activity' ? (
										<ActivityFeedPage
											t={t}
											orchestration={c.orchestration}
											orgEmployees={c.orgEmployees}
										/>
									) : null}

									{activeTab === 'connection' ? (
										<ConnectionPage
											t={t}
											DEFAULT_API={c.DEFAULT_API}
											DEFAULT_WS={c.DEFAULT_WS}
											aiSettings={c.aiSettings}
											setAiSettings={c.setAiSettings}
											wsLog={c.wsLog}
											onSave={() => void c.saveConnectionAndReconnect()}
											workspaceId={c.workspaceId}
											sessionPhase={c.sessionPhase}
											onRebuildTeam={() => c.resetWorkspaceTeamBootstrap()}
											runtimes={c.runtimes}
										/>
									) : null}
								</div>
							</>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}
