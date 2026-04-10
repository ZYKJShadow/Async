import { useMemo, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { AiEmployeesTitlebar } from './AiEmployeesTitlebar';
import {
	IconBookOpen,
	IconBot,
	IconChevron,
	IconCircleUser,
	IconFolderKanban,
	IconGitSCM,
	IconInbox,
	IconListTodo,
	IconMonitor,
	IconRefresh,
	IconSettings,
	IconTaskPulse,
} from '../icons';
import { useAiEmployeesController, type AiEmployeesTabId } from './hooks/useAiEmployeesController';
import { BoardPage } from './pages/BoardPage';
import { ConnectionPage } from './pages/ConnectionPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { OrchestratorPage } from './pages/OrchestratorPage';
import { RuntimesPage } from './pages/RuntimesPage';
import { SkillsPage } from './pages/SkillsPage';
import { TasksPage } from './pages/TasksPage';
import { AiEmployeesOnboarding } from './onboarding/AiEmployeesOnboarding';
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

	const userInitials = useMemo(() => {
		const n = c.meProfile.name?.trim();
		if (n) {
			const parts = n.split(/\s+/).filter(Boolean);
			if (parts.length >= 2) {
				return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
			}
			return n.charAt(0).toUpperCase();
		}
		const e = c.meProfile.email?.trim();
		if (e) {
			return e.charAt(0).toUpperCase();
		}
		return 'U';
	}, [c.meProfile.name, c.meProfile.email]);

	const tabPageTitle = (id: AiEmployeesTabId): string => {
		switch (id) {
			case 'inbox':
				return t('aiEmployees.tab.inbox');
			case 'myIssues':
				return t('aiEmployees.tab.myIssues');
			case 'board':
				return t('aiEmployees.tab.issues');
			case 'projects':
				return t('aiEmployees.tab.projects');
			case 'agents':
				return t('aiEmployees.tab.agents');
			case 'orchestrator':
				return t('aiEmployees.tab.orchestrator');
			case 'tasks':
				return t('aiEmployees.tab.tasks');
			case 'skills':
				return t('aiEmployees.tab.skills');
			case 'runtimes':
				return t('aiEmployees.tab.runtimes');
			case 'connection':
				return t('aiEmployees.tab.settings');
			default:
				return '';
		}
	};

	const navBusy = c.sessionPhase === 'bootstrapping' || c.sessionPhase === 'onboarding';
	const navBtn = (id: AiEmployeesTabId, label: string, icon: ReactNode, disabled?: boolean) => (
		<button
			key={id}
			type="button"
			disabled={!!disabled || navBusy}
			className={`ref-ai-employees-nav-item ${c.tab === id ? 'is-active' : ''}`}
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

	if (c.sessionPhase === 'need_connection') {
		return (
			<div className="ref-shell ref-shell--agent-layout ref-ai-employees-root">
				<AiEmployeesTitlebar t={t} />
				<div className="ref-ai-employees-gate" role="dialog" aria-labelledby="ref-ai-employees-gate-title">
					<div className="ref-ai-employees-gate-card">
						<h2 id="ref-ai-employees-gate-title" className="ref-ai-employees-gate-title">
							{t('aiEmployees.gateTitle')}
						</h2>
						<p className="ref-ai-employees-gate-subtitle">{t('aiEmployees.gateSubtitle')}</p>
						<div className="ref-ai-employees-form ref-ai-employees-form--gate">
							<label>
								<span>{t('aiEmployees.apiBaseUrl')}</span>
								<input
									className="ref-ai-employees-input"
									value={c.aiSettings.apiBaseUrl ?? c.DEFAULT_API}
									onChange={(e) => c.setAiSettings((s) => ({ ...s, apiBaseUrl: e.target.value }))}
								/>
							</label>
							<label>
								<span>{t('aiEmployees.wsBaseUrl')}</span>
								<input
									className="ref-ai-employees-input"
									value={c.aiSettings.wsBaseUrl ?? c.DEFAULT_WS}
									onChange={(e) => c.setAiSettings((s) => ({ ...s, wsBaseUrl: e.target.value }))}
								/>
							</label>
							<label>
								<span>{t('aiEmployees.token')}</span>
								<input
									className="ref-ai-employees-input"
									type="password"
									autoComplete="off"
									value={c.aiSettings.token ?? 'dev'}
									onChange={(e) => c.setAiSettings((s) => ({ ...s, token: e.target.value }))}
								/>
							</label>
							<div className="ref-ai-employees-form-actions">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={() => void c.saveConnectionAndReconnect()}>
									{t('aiEmployees.connectAndContinue')}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (c.sessionPhase === 'onboarding') {
		return (
			<div className="ref-shell ref-shell--agent-layout ref-ai-employees-root">
				<AiEmployeesTitlebar t={t} />
				<div className="ref-ai-employees-onboarding-layout">
					<AiEmployeesOnboarding
						t={t}
						conn={c.conn}
						workspaceId={c.workspaceId}
						companyName={c.bootstrapStatus?.companyName ?? ''}
						workspaces={c.workspaces}
						step={c.onboardingStep}
						onboardingErr={c.onboardingErr}
						promptTemplates={c.promptTemplates}
						orgEmployees={c.orgEmployees}
						modelOptions={c.modelOptions}
						agentLocalModelMap={c.aiSettings.agentLocalModelIdByRemoteAgentId}
						employeeLocalModelMap={c.aiSettings.employeeLocalModelIdByEmployeeId}
						modelOptionIdSet={c.modelOptionIdSet}
						defaultModelId={c.localModels.defaultModelId}
						loadPromptTemplates={c.loadPromptTemplatesForOnboarding}
						pickWorkspaceAndRefresh={c.pickWorkspaceAndRefresh}
						onSync={c.syncOnboardingAfterMutation}
						onBindEmployeeLocalModel={c.bindEmployeeLocalModel}
						onClearEmployeeLocalModel={c.clearEmployeeLocalModel}
					/>
				</div>
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
								className="ref-ai-employees-workspace-select"
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
								<div className="ref-ai-employees-nav-group-content">
									{navBtn('inbox', t('aiEmployees.tab.inbox'), <IconInbox className="ref-ai-employees-nav-icon" />, true)}
									{navBtn('myIssues', t('aiEmployees.tab.myIssues'), <IconCircleUser className="ref-ai-employees-nav-icon" />, true)}
								</div>
							</div>
							<div className="ref-ai-employees-nav-group">
								<div className="ref-ai-employees-nav-group-label">{t('aiEmployees.navGroup.workspace')}</div>
								<div className="ref-ai-employees-nav-group-content">
									{navBtn('board', t('aiEmployees.tab.issues'), <IconListTodo className="ref-ai-employees-nav-icon" />)}
									{navBtn('projects', t('aiEmployees.tab.projects'), <IconFolderKanban className="ref-ai-employees-nav-icon" />, true)}
									{navBtn('agents', t('aiEmployees.tab.agents'), <IconBot className="ref-ai-employees-nav-icon" />)}
									{navBtn('orchestrator', t('aiEmployees.tab.orchestrator'), <IconGitSCM className="ref-ai-employees-nav-icon" />)}
									{navBtn('tasks', t('aiEmployees.tab.tasks'), <IconTaskPulse className="ref-ai-employees-nav-icon" />)}
								</div>
							</div>
							<div className="ref-ai-employees-nav-group">
								<div className="ref-ai-employees-nav-group-label">{t('aiEmployees.navGroup.configure')}</div>
								<div className="ref-ai-employees-nav-group-content">
									{navBtn('runtimes', t('aiEmployees.tab.runtimes'), <IconMonitor className="ref-ai-employees-nav-icon" />)}
									{navBtn('skills', t('aiEmployees.tab.skills'), <IconBookOpen className="ref-ai-employees-nav-icon" />)}
									{navBtn('connection', t('aiEmployees.tab.settings'), <IconSettings className="ref-ai-employees-nav-icon" />)}
								</div>
							</div>
						</nav>
						<footer className="ref-ai-employees-sidebar-footer">
							<div className="ref-ai-employees-user-row">
								<div className="ref-ai-employees-user-avatar" aria-hidden>
									{userInitials}
								</div>
								<div className="ref-ai-employees-user-meta">
									<div className="ref-ai-employees-user-name">
										{(c.meProfile.name ?? c.meLabel) || t('aiEmployees.notConnected')}
									</div>
									<div className="ref-ai-employees-user-email">{c.meProfile.email ?? ''}</div>
								</div>
							</div>
						</footer>
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
							<span className="ref-ai-employees-breadcrumb-page">{tabPageTitle(c.tab)}</span>
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
						{c.localRoot && c.workspaceId ? (
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => void c.bindLocalWorkspace()}>
								{t('aiEmployees.bindWorkspace')}
							</button>
						) : null}
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
						) : c.sessionPhase === 'no_workspace' && c.tab !== 'connection' ? (
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

								{c.tab === 'inbox' || c.tab === 'myIssues' || c.tab === 'projects' ? (
									<div className="ref-ai-employees-stub">
										<div className="ref-ai-employees-stub-title">{tabPageTitle(c.tab)}</div>
										<p>{t('aiEmployees.stubNotImplemented')}</p>
									</div>
								) : null}

								{c.tab === 'board' ? <BoardPage issues={c.issues} t={t} /> : null}

								{c.tab === 'agents' ? (
								<EmployeesPage
									t={t}
									conn={c.conn}
									workspaceId={c.workspaceId}
									companyName={c.bootstrapStatus?.companyName ?? ''}
									agents={c.agents}
									orgEmployees={c.orgEmployees}
									onRefreshOrg={c.refreshOrgEmployeesList}
									employeeCatalog={c.employeeCatalog}
									agentLocalModelMap={c.aiSettings.agentLocalModelIdByRemoteAgentId}
									employeeLocalModelMap={c.aiSettings.employeeLocalModelIdByEmployeeId}
									modelOptions={c.modelOptions}
									modelOptionIdSet={c.modelOptionIdSet}
									defaultModelId={c.localModels.defaultModelId}
									onUpsertCatalogEntry={c.upsertCatalogEntry}
									onRemoveCatalogEntry={c.removeCatalogEntry}
									onBindModel={c.bindAgentLocalModel}
									onClearModelBinding={c.clearAgentLocalModel}
									onBindEmployeeLocalModel={c.bindEmployeeLocalModel}
									onClearEmployeeLocalModel={c.clearEmployeeLocalModel}
								/>
								) : null}

								{c.tab === 'orchestrator' ? (
									<OrchestratorPage
										t={t}
										orchestration={c.orchestration}
										onCreateRun={c.createOrchestrationRun}
										onApproveGit={c.approveOrchestrationGit}
									/>
								) : null}

								{c.tab === 'tasks' ? <TasksPage taskEvents={c.taskEvents} t={t} /> : null}

								{c.tab === 'skills' ? <SkillsPage skills={c.skills} /> : null}

								{c.tab === 'runtimes' ? <RuntimesPage runtimes={c.runtimes} /> : null}

								{c.tab === 'connection' ? (
									<ConnectionPage
										t={t}
										DEFAULT_API={c.DEFAULT_API}
										DEFAULT_WS={c.DEFAULT_WS}
										aiSettings={c.aiSettings}
										setAiSettings={c.setAiSettings}
										wsLog={c.wsLog}
										onSave={() => void c.saveConnectionAndReconnect()}
									/>
								) : null}
							</>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}
