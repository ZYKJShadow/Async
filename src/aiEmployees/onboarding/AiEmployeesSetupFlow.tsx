import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeesSettings } from '../../../shared/aiEmployeesSettings';
import type { RolePromptDraft } from '../../../shared/aiEmployeesPersona';
import type { AiEmployeesConnection } from '../api/client';
import type { OrgBootstrapStatus, OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import {
	apiCreateOrgEmployee,
	apiPatchOrgEmployee,
	apiPostBootstrapComplete,
	apiPostBootstrapConfirmTemplates,
	apiPostBootstrapOrg,
} from '../api/orgClient';
import { resolveEmployeeLocalModelId } from '../adapters/modelAdapter';
import { emptyPromptDraft } from '../domain/persona';
import { createEmptyRoleProfileDraft, createRoleDraftFromOrgEmployee, toPersonaSeed, type RoleProfileDraft } from '../domain/roleDraft';
import type { AiEmployeesSessionPhase } from '../sessionTypes';

type SetupStage = 'connect' | 'choose_team_mode' | 'confirm_team_name';
type TeamModeId = 'product_delivery' | 'lean_builder' | 'custom';

const SETUP_STAGE_ORDER: SetupStage[] = ['connect', 'choose_team_mode', 'confirm_team_name'];

type TeamModeConfig = {
	id: TeamModeId;
	titleKey: string;
	descKey: string;
	roles: Array<{
		id: string;
		roleKey: string;
		customRoleTitle: string;
		jobMission: string;
		domainContext: string;
		communicationNotes: string;
		templateHints: string[];
		managerId?: string;
	}>;
};

function createTeamModes(t: TFunction): TeamModeConfig[] {
	return [
		{
			id: 'product_delivery',
			titleKey: 'aiEmployees.setup.modeProductTitle',
			descKey: 'aiEmployees.setup.modeProductDesc',
			roles: [
				{
					id: 'lead',
					roleKey: 'ceo',
					customRoleTitle: t('aiEmployees.setup.role.coordinatorTitle'),
					jobMission: t('aiEmployees.setup.role.coordinatorMission'),
					domainContext: t('aiEmployees.setup.role.coordinatorContext'),
					communicationNotes: t('aiEmployees.setup.role.coordinatorNotes'),
					templateHints: ['ceo', 'lead', 'coordinator', 'manager'],
				},
				{
					id: 'pm',
					roleKey: 'pm',
					customRoleTitle: t('aiEmployees.setup.role.pmTitle'),
					jobMission: t('aiEmployees.setup.role.pmMission'),
					domainContext: t('aiEmployees.setup.role.pmContext'),
					communicationNotes: t('aiEmployees.setup.role.pmNotes'),
					templateHints: ['pm', 'product'],
					managerId: 'lead',
				},
				{
					id: 'engineer',
					roleKey: 'engineer',
					customRoleTitle: t('aiEmployees.setup.role.engineerTitle'),
					jobMission: t('aiEmployees.setup.role.engineerMission'),
					domainContext: t('aiEmployees.setup.role.engineerContext'),
					communicationNotes: t('aiEmployees.setup.role.engineerNotes'),
					templateHints: ['engineer', 'developer', 'backend', 'frontend', 'fullstack'],
					managerId: 'lead',
				},
				{
					id: 'qa',
					roleKey: 'qa',
					customRoleTitle: t('aiEmployees.setup.role.qaTitle'),
					jobMission: t('aiEmployees.setup.role.qaMission'),
					domainContext: t('aiEmployees.setup.role.qaContext'),
					communicationNotes: t('aiEmployees.setup.role.qaNotes'),
					templateHints: ['qa', 'test'],
					managerId: 'lead',
				},
			],
		},
		{
			id: 'lean_builder',
			titleKey: 'aiEmployees.setup.modeLeanTitle',
			descKey: 'aiEmployees.setup.modeLeanDesc',
			roles: [
				{
					id: 'lead',
					roleKey: 'ceo',
					customRoleTitle: t('aiEmployees.setup.role.teamLeadTitle'),
					jobMission: t('aiEmployees.setup.role.teamLeadMission'),
					domainContext: t('aiEmployees.setup.role.teamLeadContext'),
					communicationNotes: t('aiEmployees.setup.role.teamLeadNotes'),
					templateHints: ['ceo', 'lead', 'coordinator'],
				},
				{
					id: 'builder',
					roleKey: 'fullstack',
					customRoleTitle: t('aiEmployees.setup.role.builderTitle'),
					jobMission: t('aiEmployees.setup.role.builderMission'),
					domainContext: t('aiEmployees.setup.role.builderContext'),
					communicationNotes: t('aiEmployees.setup.role.builderNotes'),
					templateHints: ['fullstack', 'engineer', 'developer'],
					managerId: 'lead',
				},
				{
					id: 'qa',
					roleKey: 'qa',
					customRoleTitle: t('aiEmployees.setup.role.qaTitle'),
					jobMission: t('aiEmployees.setup.role.qaMission'),
					domainContext: t('aiEmployees.setup.role.qaContext'),
					communicationNotes: t('aiEmployees.setup.role.qaNotes'),
					templateHints: ['qa', 'test'],
					managerId: 'lead',
				},
			],
		},
		{
			id: 'custom',
			titleKey: 'aiEmployees.setup.modeCustomTitle',
			descKey: 'aiEmployees.setup.modeCustomDesc',
			roles: [],
		},
	];
}

type ConnectFailureKind = 'network' | 'auth' | 'forbidden' | 'notfound' | 'server' | 'unknown';

function classifyConnectionFailure(raw: string): ConnectFailureKind {
	if (raw.includes('HTTP 401')) {
		return 'auth';
	}
	if (raw.includes('HTTP 403')) {
		return 'forbidden';
	}
	if (raw.includes('HTTP 404')) {
		return 'notfound';
	}
	if (/HTTP 5\d\d/.test(raw)) {
		return 'server';
	}
	const lo = raw.toLowerCase();
	if (
		lo.includes('failed to fetch') ||
		lo.includes('networkerror') ||
		lo.includes('load failed') ||
		lo.includes('econnrefused') ||
		lo.includes('err_connection') ||
		lo.includes('network request failed')
	) {
		return 'network';
	}
	return 'unknown';
}

function connectFailureHintKey(kind: ConnectFailureKind): string {
	switch (kind) {
		case 'network':
			return 'aiEmployees.setup.connectFailureHintNetwork';
		case 'auth':
			return 'aiEmployees.setup.connectFailureHintAuth';
		case 'forbidden':
			return 'aiEmployees.setup.connectFailureHintForbidden';
		case 'notfound':
			return 'aiEmployees.setup.connectFailureHintNotFound';
		case 'server':
			return 'aiEmployees.setup.connectFailureHintServer';
		default:
			return 'aiEmployees.setup.connectFailureHintUnknown';
	}
}

function inferStage(sessionPhase: AiEmployeesSessionPhase, workspaceId: string, status: OrgBootstrapStatus | null): SetupStage {
	if (sessionPhase === 'need_connection' || sessionPhase === 'bootstrapping') {
		return 'connect';
	}
	if (!workspaceId || sessionPhase === 'no_workspace') {
		return 'choose_team_mode';
	}
	if (status?.templatesConfirmed && !status.onboardingCompleted) {
		return 'confirm_team_name';
	}
	if (status?.hasCeo || status?.hasOrgProfile) {
		return 'confirm_team_name';
	}
	return 'choose_team_mode';
}

function clonePromptDraft(draft: RolePromptDraft): RolePromptDraft {
	return {
		systemPrompt: draft.systemPrompt,
		roleSummary: draft.roleSummary,
		speakingStyle: draft.speakingStyle,
		collaborationRules: draft.collaborationRules,
		handoffRules: draft.handoffRules,
	};
}

function cloneRoleDraft(draft: RoleProfileDraft): RoleProfileDraft {
	return {
		...draft,
		promptDraft: clonePromptDraft(draft.promptDraft),
		lastGeneratedPromptDraft: draft.lastGeneratedPromptDraft ? clonePromptDraft(draft.lastGeneratedPromptDraft) : null,
	};
}

function matchTemplate(promptTemplates: OrgPromptTemplate[], hints: string[]): OrgPromptTemplate | undefined {
	if (hints.length === 0) {
		return undefined;
	}
	return promptTemplates.find((template) => {
		const hay = `${template.key} ${template.title}`.toLowerCase();
		return hints.some((hint) => hay.includes(hint.toLowerCase()));
	});
}

function createDraftFromModeRole(
	modeRole: TeamModeConfig['roles'][number],
	promptTemplates: OrgPromptTemplate[],
	defaultModelId: string | undefined,
	t: TFunction
): RoleProfileDraft {
	const template = matchTemplate(promptTemplates, modeRole.templateHints);
	const promptDraft = template
		? {
				systemPrompt: template.systemPrompt,
				roleSummary: modeRole.jobMission,
				speakingStyle: modeRole.communicationNotes,
				collaborationRules: t('aiEmployees.role.defaultCollaborationRules'),
				handoffRules: t('aiEmployees.role.defaultHandoffRules'),
		  }
		: emptyPromptDraft();
	return createEmptyRoleProfileDraft({
		id: modeRole.id,
		roleKey: modeRole.roleKey,
		displayName: modeRole.customRoleTitle,
		customRoleTitle: modeRole.customRoleTitle,
		managerEmployeeId: modeRole.managerId,
		templatePromptKey: template?.key,
		localModelId: defaultModelId ?? '',
		jobMission: modeRole.jobMission,
		domainContext: modeRole.domainContext,
		communicationNotes: modeRole.communicationNotes,
		promptDraft,
		lastGeneratedPromptDraft: template ? promptDraft : null,
		modelSource: 'local_model',
	});
}

function mapOrgEmployeesToCommitDrafts(
	orgEmployees: OrgEmployee[],
	agentLocalModelMap: Record<string, string> | undefined,
	employeeLocalModelMap: Record<string, string> | undefined,
	defaultModelId: string | undefined,
	modelOptionIdSet: Set<string>
): RoleProfileDraft[] {
	return [...orgEmployees]
		.sort((a, b) => {
			if (a.isCeo !== b.isCeo) {
				return a.isCeo ? -1 : 1;
			}
			return a.displayName.localeCompare(b.displayName);
		})
		.map((employee) => {
			const localModelId =
				resolveEmployeeLocalModelId({
					employeeId: employee.id,
					remoteAgentId: employee.linkedRemoteAgentId ?? undefined,
					agentLocalModelMap,
					employeeLocalModelMap,
					defaultModelId,
					modelOptionIds: modelOptionIdSet,
				}) ?? '';
			return createRoleDraftFromOrgEmployee(employee, localModelId);
		});
}

function suggestTeamName(localRoot: string | null, workspaces: { id: string; name?: string }[], workspaceId: string, companyName: string): string {
	if (companyName.trim()) {
		return companyName.trim();
	}
	const workspace = workspaces.find((item) => item.id === workspaceId);
	if (workspace?.name?.trim()) {
		return workspace.name.trim();
	}
	if (localRoot) {
		const normalized = localRoot.replace(/\\/g, '/').split('/').filter(Boolean);
		const leaf = normalized[normalized.length - 1];
		if (leaf) {
			return leaf;
		}
	}
	return 'Async Team';
}

export function AiEmployeesSetupFlow({
	t,
	sessionPhase,
	conn,
	aiSettings,
	setAiSettings,
	onSaveConnection,
	connectionError,
	onClearConnectionError,
	localRoot,
	workspaceId,
	workspaces,
	companyName,
	bootstrapStatus,
	orgEmployees,
	promptTemplates,
	modelOptionIdSet,
	defaultModelId,
	agentLocalModelMap,
	employeeLocalModelMap,
	onLoadPromptTemplates,
	onSync,
	onBindEmployeeLocalModel,
	onClearEmployeeLocalModel,
}: {
	t: TFunction;
	sessionPhase: AiEmployeesSessionPhase;
	conn: AiEmployeesConnection;
	aiSettings: AiEmployeesSettings;
	setAiSettings: Dispatch<SetStateAction<AiEmployeesSettings>>;
	onSaveConnection: () => void;
	connectionError: string | null;
	onClearConnectionError: () => void;
	localRoot: string | null;
	workspaceId: string;
	workspaces: { id: string; name?: string }[];
	companyName: string;
	bootstrapStatus: OrgBootstrapStatus | null;
	orgEmployees: OrgEmployee[];
	promptTemplates: OrgPromptTemplate[];
	modelOptionIdSet: Set<string>;
	defaultModelId: string | undefined;
	agentLocalModelMap: Record<string, string> | undefined;
	employeeLocalModelMap: Record<string, string> | undefined;
	onLoadPromptTemplates: () => void | Promise<void>;
	onSync: () => void | Promise<void>;
	onBindEmployeeLocalModel: (employeeId: string, modelEntryId: string) => void;
	onClearEmployeeLocalModel: (employeeId: string) => void;
}) {
	const [stage, setStage] = useState<SetupStage>(() => inferStage(sessionPhase, workspaceId, bootstrapStatus));
	const [teamName, setTeamName] = useState('');
	const [teamMode, setTeamMode] = useState<TeamModeId>('product_delivery');
	const [submitBusy, setSubmitBusy] = useState(false);
	const [submitErr, setSubmitErr] = useState<string | null>(null);
	const prevStageRef = useRef<SetupStage | null>(null);

	const setupFinishOnlyResume = Boolean(bootstrapStatus?.templatesConfirmed && !bootstrapStatus?.onboardingCompleted);

	useEffect(() => {
		const inferred = inferStage(sessionPhase, workspaceId, bootstrapStatus);
		setStage(inferred);
	}, [
		sessionPhase,
		workspaceId,
		bootstrapStatus?.hasOrgProfile,
		bootstrapStatus?.hasCeo,
		bootstrapStatus?.templatesConfirmed,
		bootstrapStatus?.onboardingCompleted,
	]);

	useEffect(() => {
		const prev = prevStageRef.current;
		prevStageRef.current = stage;
		if (stage !== 'confirm_team_name' || prev === 'confirm_team_name') {
			return;
		}
		setTeamName((cur) => {
			if (cur.trim()) {
				return cur;
			}
			const fromServer = (companyName || bootstrapStatus?.companyName || '').trim();
			if (fromServer) {
				return fromServer;
			}
			return suggestTeamName(localRoot, workspaces, workspaceId, '');
		});
	}, [stage, localRoot, workspaces, workspaceId, companyName, bootstrapStatus?.companyName]);

	useEffect(() => {
		if (stage === 'choose_team_mode') {
			void onLoadPromptTemplates();
		}
	}, [stage, onLoadPromptTemplates]);

	const teamModes = useMemo(() => createTeamModes(t), [t]);

	const draftOrgLabel = useMemo(
		() => teamName.trim() || suggestTeamName(localRoot, workspaces, workspaceId, companyName) || 'Async Team',
		[teamName, localRoot, workspaces, workspaceId, companyName]
	);

	const connectFailureKind = useMemo(
		() => (connectionError ? classifyConnectionFailure(connectionError) : 'unknown'),
		[connectionError]
	);

	const previewDrafts = useMemo(() => {
		const mode = teamModes.find((item) => item.id === teamMode) ?? teamModes[0];
		return mode.roles.map((role) => createDraftFromModeRole(role, promptTemplates, defaultModelId, t));
	}, [teamMode, promptTemplates, defaultModelId, teamModes, t]);

	const commitDrafts = useMemo((): RoleProfileDraft[] => {
		if (orgEmployees.length > 0) {
			return mapOrgEmployeesToCommitDrafts(orgEmployees, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet);
		}
		return previewDrafts.map((item) => cloneRoleDraft(item));
	}, [orgEmployees, previewDrafts, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet]);

	const goBack = () => {
		if (stage === 'confirm_team_name' && setupFinishOnlyResume) {
			return;
		}
		const idx = SETUP_STAGE_ORDER.indexOf(stage);
		if (idx <= 0) {
			return;
		}
		setStage(SETUP_STAGE_ORDER[idx - 1]);
		setSubmitErr(null);
	};

	const goToConfirmTeamName = () => {
		setSubmitErr(null);
		setStage('confirm_team_name');
	};

	const completeOnboardingOnly = async () => {
		if (!workspaceId) {
			return;
		}
		setSubmitBusy(true);
		setSubmitErr(null);
		try {
			await apiPostBootstrapComplete(conn, workspaceId);
			await onSync();
		} catch (error) {
			setSubmitErr(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmitBusy(false);
		}
	};

	const commitTeamAndFinish = async () => {
		if (!workspaceId) {
			return;
		}
		if (commitDrafts.length > 0) {
			const lead = commitDrafts.find((item) => item.roleKey === 'ceo');
			const members = commitDrafts.filter((item) => item.roleKey !== 'ceo');
			if (!lead) {
				setSubmitErr(t('aiEmployees.setup.needLeadError'));
				return;
			}
			if (members.length === 0) {
				setSubmitErr(t('aiEmployees.role.nonCeoRequired'));
				return;
			}
		}
		setSubmitBusy(true);
		setSubmitErr(null);
		try {
			await apiPostBootstrapOrg(conn, workspaceId, teamName.trim() || companyName.trim() || draftOrgLabel);
			if (commitDrafts.length === 0) {
				await apiPostBootstrapConfirmTemplates(conn, workspaceId);
				await onSync();
				await apiPostBootstrapComplete(conn, workspaceId);
				await onSync();
				return;
			}
			const lead = commitDrafts.find((item) => item.roleKey === 'ceo')!;
			const members = commitDrafts.filter((item) => item.roleKey !== 'ceo');
			const actualEmployeeIds = new Map<string, string>();
			const existingEmployees = new Map(orgEmployees.map((item) => [item.id, item]));
			for (const draft of [lead, ...members]) {
				const managerEmployeeId =
					draft.roleKey === 'ceo'
						? undefined
						: draft.managerEmployeeId
							? actualEmployeeIds.get(draft.managerEmployeeId) ?? draft.managerEmployeeId
							: actualEmployeeIds.get(lead.id ?? '');
				const systemPrompt = draft.promptDraft.systemPrompt.trim();
				const existing = draft.id ? existingEmployees.get(draft.id) : undefined;
				const employee = existing
					? await apiPatchOrgEmployee(conn, workspaceId, existing.id, {
							displayName: draft.displayName.trim(),
							customRoleTitle: draft.customRoleTitle.trim() || undefined,
							clearCustomRoleTitle: !draft.customRoleTitle.trim(),
							managerEmployeeId,
							clearManager: !managerEmployeeId,
							isCeo: draft.roleKey === 'ceo',
							templatePromptKey: draft.templatePromptKey?.trim() || undefined,
							clearTemplatePromptKey: !draft.templatePromptKey?.trim(),
							...(systemPrompt
								? { customSystemPrompt: systemPrompt, clearCustomSystemPrompt: false as const }
								: { clearCustomSystemPrompt: true as const }),
							personaSeed: toPersonaSeed(draft, draft.roleKey === 'ceo' ? 'user' : 'system'),
							clearPersonaSeed: false,
							modelSource: draft.modelSource,
					  })
					: await apiCreateOrgEmployee(conn, workspaceId, {
							displayName: draft.displayName.trim(),
							roleKey: draft.roleKey === 'ceo' ? 'ceo' : draft.roleKey || 'custom',
							customRoleTitle: draft.customRoleTitle.trim() || undefined,
							managerEmployeeId,
							createdByEmployeeId: draft.roleKey === 'ceo' ? undefined : actualEmployeeIds.get(lead.id ?? ''),
							isCeo: draft.roleKey === 'ceo',
							templatePromptKey: draft.templatePromptKey?.trim() || undefined,
							...(systemPrompt ? { customSystemPrompt: systemPrompt } : {}),
							personaSeed: toPersonaSeed(draft, draft.roleKey === 'ceo' ? 'user' : 'system'),
							modelSource: draft.modelSource,
					  });
				actualEmployeeIds.set(draft.id ?? employee.id, employee.id);
				if (draft.localModelId) {
					onBindEmployeeLocalModel(employee.id, draft.localModelId);
				} else {
					onClearEmployeeLocalModel(employee.id);
				}
			}
			await apiPostBootstrapConfirmTemplates(conn, workspaceId);
			await onSync();
			await apiPostBootstrapComplete(conn, workspaceId);
			await onSync();
		} catch (error) {
			setSubmitErr(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmitBusy(false);
		}
	};

	const setupFrameClass =
		stage === 'connect' || stage === 'confirm_team_name'
			? 'ref-ai-employees-setup-frame ref-ai-employees-setup-frame--narrow'
			: stage === 'choose_team_mode'
				? 'ref-ai-employees-setup-frame ref-ai-employees-setup-frame--wide'
				: 'ref-ai-employees-setup-frame';

	return (
		<div className="ref-ai-employees-setup-shell">
			<div className={setupFrameClass}>
				<div className="ref-ai-employees-setup-unified">
				{submitErr && stage !== 'connect' ? (
					<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
						{submitErr}
					</div>
				) : null}

				<div key={stage} className="ref-ai-employees-setup-step-anim">
				{stage === 'connect' ? (
					<div className="ref-ai-employees-setup-step ref-ai-employees-setup-panel--connect">
						<div className="ref-ai-employees-setup-panel-head">
							<div className="ref-ai-employees-setup-chip">{t('aiEmployees.setup.stepConnect')}</div>
							<h2>{t('aiEmployees.gateTitle')}</h2>
							<p>{t('aiEmployees.setup.connectBlurb')}</p>
						</div>
						{connectionError?.trim() ? (
							<div className="ref-ai-employees-setup-connect-alert" role="alert" aria-live="polite">
								<div className="ref-ai-employees-setup-connect-alert-top">
									<div className="ref-ai-employees-setup-connect-alert-title-wrap">
										<span className="ref-ai-employees-setup-connect-alert-icon" aria-hidden>
											!
										</span>
										<strong className="ref-ai-employees-setup-connect-alert-title">{t('aiEmployees.setup.connectFailureTitle')}</strong>
									</div>
									<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-setup-connect-alert-dismiss" onClick={onClearConnectionError}>
										{t('aiEmployees.setup.connectFailureDismiss')}
									</button>
								</div>
								<p className="ref-ai-employees-setup-connect-alert-hint">{t(connectFailureHintKey(connectFailureKind))}</p>
								<details className="ref-ai-employees-setup-connect-alert-details">
									<summary>{t('aiEmployees.setup.connectFailureDetailToggle')}</summary>
									<pre className="ref-ai-employees-setup-connect-alert-pre">{connectionError}</pre>
								</details>
							</div>
						) : null}
						<div className="ref-ai-employees-setup-grid">
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.apiBaseUrl')}</span>
								<input
									className="ref-ai-employees-input"
									value={aiSettings.apiBaseUrl ?? conn.apiBaseUrl}
									onChange={(e) => {
										onClearConnectionError();
										setAiSettings((prev) => ({ ...prev, apiBaseUrl: e.target.value }));
									}}
								/>
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.wsBaseUrl')}</span>
								<input
									className="ref-ai-employees-input"
									value={aiSettings.wsBaseUrl ?? conn.wsBaseUrl}
									onChange={(e) => {
										onClearConnectionError();
										setAiSettings((prev) => ({ ...prev, wsBaseUrl: e.target.value }));
									}}
								/>
							</label>
						</div>
						<label className="ref-ai-employees-catalog-field">
							<span>{t('aiEmployees.token')}</span>
							<input
								className="ref-ai-employees-input"
								type="password"
								autoComplete="off"
								value={aiSettings.token ?? conn.token}
								onChange={(e) => {
									onClearConnectionError();
									setAiSettings((prev) => ({ ...prev, token: e.target.value }));
								}}
							/>
						</label>
						<div className="ref-ai-employees-form-actions ref-ai-employees-setup-actions ref-ai-employees-setup-nav-row">
							<div className="ref-ai-employees-setup-nav-trailing">
								<button
									type="button"
									className="ref-ai-employees-btn ref-ai-employees-btn--primary"
									disabled={sessionPhase === 'bootstrapping'}
									aria-busy={sessionPhase === 'bootstrapping'}
									onClick={onSaveConnection}
								>
									{sessionPhase === 'bootstrapping'
										? t('common.loading')
										: connectionError?.trim()
											? t('aiEmployees.setup.connectRetry')
											: t('aiEmployees.setup.nextStep')}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{stage === 'choose_team_mode' ? (
					<div className="ref-ai-employees-setup-step">
						<div className="ref-ai-employees-setup-panel-head">
							<div className="ref-ai-employees-setup-chip">{t('aiEmployees.setup.stepMode')}</div>
							<h2>{t('aiEmployees.setup.modeHeading')}</h2>
							{t('aiEmployees.setup.modeBlurb').trim() ? <p>{t('aiEmployees.setup.modeBlurb')}</p> : null}
							<p className="ref-ai-employees-setup-muted ref-ai-employees-setup-mode-customize-hint">{t('aiEmployees.setup.modeCustomizeLaterHint')}</p>
						</div>
						<div className="ref-ai-employees-setup-tier-grid" role="listbox" aria-label={t('aiEmployees.setup.modeHeading')}>
							{teamModes.map((mode) => {
								const active = mode.id === teamMode;
								const featured = mode.id === 'product_delivery';
								return (
									<button
										key={mode.id}
										type="button"
										role="option"
										aria-selected={active}
										className={`ref-ai-employees-setup-tier-card ${active ? 'is-selected' : ''} ${featured ? 'is-featured' : ''}`}
										onClick={() => setTeamMode(mode.id)}
									>
										<div className="ref-ai-employees-setup-tier-badge-row">
											{featured ? <span className="ref-ai-employees-setup-tier-badge">{t('aiEmployees.setup.tierRecommended')}</span> : null}
										</div>
										<div className="ref-ai-employees-setup-tier-top">
											<h3 className="ref-ai-employees-setup-tier-name">{t(mode.titleKey)}</h3>
											<p className="ref-ai-employees-setup-tier-desc">{t(mode.descKey)}</p>
										</div>
										<div className="ref-ai-employees-setup-tier-divider" />
										{mode.roles.length > 0 ? (
											<>
												<p className="ref-ai-employees-setup-tier-include-label">{t('aiEmployees.setup.tierIncludedLabel')}</p>
												<ul className="ref-ai-employees-setup-tier-features">
													{mode.roles.map((role) => (
														<li key={role.id}>{role.customRoleTitle}</li>
													))}
												</ul>
											</>
										) : (
											<p className="ref-ai-employees-setup-tier-no-roles">{t('aiEmployees.setup.tierNoRolesPreset')}</p>
										)}
										<div className="ref-ai-employees-setup-tier-foot">
											<span className={`ref-ai-employees-setup-tier-cta ${active ? 'is-selected' : ''}`}>
												{active ? t('aiEmployees.setup.tierSelected') : t('aiEmployees.setup.tierSelect')}
											</span>
										</div>
									</button>
								);
							})}
						</div>
						<p className="ref-ai-employees-setup-muted ref-ai-employees-setup-tier-footnote">{t('aiEmployees.setup.modeMultiProjectHint')}</p>
						<div className="ref-ai-employees-form-actions ref-ai-employees-setup-actions ref-ai-employees-setup-nav-row">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={goBack}>
								{t('aiEmployees.onboarding.prevStep')}
							</button>
							<div className="ref-ai-employees-setup-nav-trailing">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={goToConfirmTeamName}>
									{t('aiEmployees.setup.nextStep')}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{stage === 'confirm_team_name' ? (
					<div className="ref-ai-employees-setup-step">
						<div className="ref-ai-employees-setup-panel-head">
							<div className="ref-ai-employees-setup-chip">{t('aiEmployees.setup.stepConfirmName')}</div>
							<h2>{setupFinishOnlyResume ? t('aiEmployees.setup.finishAlmostHeading') : t('aiEmployees.setup.confirmTeamNameHeading')}</h2>
							<p>
								{setupFinishOnlyResume
									? t('aiEmployees.setup.finishAlmostBlurb')
									: teamMode === 'custom'
										? t('aiEmployees.setup.confirmTeamNameBlurbDeferRoles')
										: t('aiEmployees.setup.confirmTeamNameBlurb')}
							</p>
						</div>
						{!setupFinishOnlyResume ? (
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.setup.teamNameFieldLabel')}</span>
								<input className="ref-ai-employees-input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={t('aiEmployees.onboarding.companyPh')} autoComplete="organization" />
							</label>
						) : null}
						<div className="ref-ai-employees-form-actions ref-ai-employees-setup-actions ref-ai-employees-setup-nav-row">
							{!setupFinishOnlyResume ? (
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={goBack}>
									{t('aiEmployees.onboarding.prevStep')}
								</button>
							) : null}
							<div className="ref-ai-employees-setup-nav-trailing">
								<button
									type="button"
									className="ref-ai-employees-btn ref-ai-employees-btn--primary"
									disabled={submitBusy || (!setupFinishOnlyResume && !teamName.trim())}
									onClick={() => void (setupFinishOnlyResume ? completeOnboardingOnly() : commitTeamAndFinish())}
								>
									{submitBusy ? t('common.loading') : t('aiEmployees.setup.nextStep')}
								</button>
							</div>
						</div>
					</div>
				) : null}
				</div>
				</div>
			</div>
		</div>
	);
}
