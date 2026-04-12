import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from '../../i18n';
import { VoidSelect } from '../../VoidSelect';
import type { AiEmployeesSettings } from '../../../shared/aiEmployeesSettings';
import type { RolePromptDraft, RolePromptGeneratorInput } from '../../../shared/aiEmployeesPersona';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import type { AiEmployeesConnection } from '../api/client';
import type { OrgBootstrapStatus, OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import {
	apiCreateOrgEmployee,
	apiPatchOrgEmployee,
	apiPostBootstrapComplete,
	apiPostBootstrapConfirmTemplates,
	apiPostBootstrapOrg,
} from '../api/orgClient';
import {
	formatLocalModelPickLabel,
	getModelRecommendation,
	resolveEmployeeLocalModelId,
} from '../adapters/modelAdapter';
import { RoleCustomSystemPromptField, RoleProfileEditor } from '../components/RoleProfileEditor';
import type { LocalModelEntry } from '../sessionTypes';
import { emptyPromptDraft } from '../domain/persona';
import {
	applyGeneratedPromptDraft,
	createEmptyRoleProfileDraft,
	createRoleDraftFromOrgEmployee,
	toPersonaSeed,
	type RoleProfileDraft,
} from '../domain/roleDraft';
import type { AiEmployeesSessionPhase } from '../sessionTypes';

type SetupStage =
	| 'connect'
	| 'configure_model'
	| 'choose_team_mode'
	| 'preview_team'
	| 'confirm_team_name';

type TeamModeConfig = {
	id: 'tech_team';
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

function createTechTeamMode(t: TFunction): TeamModeConfig {
	return {
		id: 'tech_team',
		titleKey: 'aiEmployees.setup.modeTechTeamTitle',
		descKey: 'aiEmployees.setup.modeTechTeamDesc',
		roles: [
			{
				id: 'lead',
				roleKey: 'ceo',
				customRoleTitle: t('aiEmployees.setup.role.teamLeadTitle'),
				jobMission: t('aiEmployees.setup.role.teamLeadMission'),
				domainContext: t('aiEmployees.setup.role.teamLeadContext'),
				communicationNotes: t('aiEmployees.setup.role.teamLeadNotes'),
				templateHints: ['ceo', 'lead', 'coordinator', 'manager'],
			},
			{
				id: 'frontend',
				roleKey: 'frontend',
				customRoleTitle: t('aiEmployees.setup.role.frontendTitle'),
				jobMission: t('aiEmployees.setup.role.frontendMission'),
				domainContext: t('aiEmployees.setup.role.frontendContext'),
				communicationNotes: t('aiEmployees.setup.role.frontendNotes'),
				templateHints: ['frontend', 'ui', 'web'],
				managerId: 'lead',
			},
			{
				id: 'backend',
				roleKey: 'backend',
				customRoleTitle: t('aiEmployees.setup.role.backendTitle'),
				jobMission: t('aiEmployees.setup.role.backendMission'),
				domainContext: t('aiEmployees.setup.role.backendContext'),
				communicationNotes: t('aiEmployees.setup.role.backendNotes'),
				templateHints: ['backend', 'api', 'server'],
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
			{
				id: 'reviewer',
				roleKey: 'reviewer',
				customRoleTitle: t('aiEmployees.setup.role.reviewerTitle'),
				jobMission: t('aiEmployees.setup.role.reviewerMission'),
				domainContext: t('aiEmployees.setup.role.reviewerContext'),
				communicationNotes: t('aiEmployees.setup.role.reviewerNotes'),
				templateHints: ['reviewer', 'review'],
				managerId: 'lead',
			},
		],
	};
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
	return 'configure_model';
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
	connectRefreshFailed,
	onClearConnectRefreshFailed,
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
	modelOptions,
}: {
	t: TFunction;
	sessionPhase: AiEmployeesSessionPhase;
	conn: AiEmployeesConnection;
	aiSettings: AiEmployeesSettings;
	setAiSettings: Dispatch<SetStateAction<AiEmployeesSettings>>;
	onSaveConnection: () => void;
	connectRefreshFailed: boolean;
	onClearConnectRefreshFailed: () => void;
	localRoot: string | null;
	workspaceId: string;
	workspaces: { id: string; name?: string }[];
	companyName: string;
	bootstrapStatus: OrgBootstrapStatus | null;
	orgEmployees: OrgEmployee[];
	promptTemplates: OrgPromptTemplate[];
	modelOptions: LocalModelEntry[];
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
	const [submitBusy, setSubmitBusy] = useState(false);
	const [submitErr, setSubmitErr] = useState<string | null>(null);
	const [selectedModelId, setSelectedModelId] = useState('');
	const [previewTeamDrafts, setPreviewTeamDrafts] = useState<RoleProfileDraft[]>([]);
	const [wizardCommitDrafts, setWizardCommitDrafts] = useState<RoleProfileDraft[] | null>(null);
	const [previewEditDraft, setPreviewEditDraft] = useState<RoleProfileDraft | null>(null);
	const [previewPromptBusy, setPreviewPromptBusy] = useState(false);
	const prevStageRef = useRef<SetupStage | null>(null);

	const setupFinishOnlyResume = Boolean(bootstrapStatus?.templatesConfirmed && !bootstrapStatus?.onboardingCompleted);

	useEffect(() => {
		setSelectedModelId((cur) => {
			if (cur && modelOptionIdSet.has(cur)) {
				return cur;
			}
			if (defaultModelId && modelOptionIdSet.has(defaultModelId)) {
				return defaultModelId;
			}
			return modelOptions.find((m) => modelOptionIdSet.has(m.id))?.id ?? '';
		});
	}, [defaultModelId, modelOptions, modelOptionIdSet]);

	const configureModelOpts = useMemo(
		() => [
			{ value: '', label: t('aiEmployees.role.modelRequired') },
			...modelOptions
				.filter((m) => modelOptionIdSet.has(m.id))
				.map((m) => ({
					value: m.id,
					label: formatLocalModelPickLabel(m),
				})),
		],
		[t, modelOptions, modelOptionIdSet],
	);

	useEffect(() => {
		const inferred = inferStage(sessionPhase, workspaceId, bootstrapStatus);
		if (inferred === 'connect') {
			setStage('connect');
			return;
		}
		if (inferred === 'confirm_team_name') {
			setStage('confirm_team_name');
			return;
		}
		if (inferred === 'configure_model') {
			setStage((cur) => (cur === 'connect' ? 'configure_model' : cur));
		}
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
		if (stage === 'choose_team_mode' || stage === 'configure_model') {
			void onLoadPromptTemplates();
		}
	}, [stage, onLoadPromptTemplates]);

	const teamMode = useMemo(() => createTechTeamMode(t), [t]);

	const draftOrgLabel = useMemo(
		() => teamName.trim() || suggestTeamName(localRoot, workspaces, workspaceId, companyName) || 'Async Team',
		[teamName, localRoot, workspaces, workspaceId, companyName]
	);

	const effectiveModelForDrafts = selectedModelId && modelOptionIdSet.has(selectedModelId) ? selectedModelId : defaultModelId;

	const previewDrafts = useMemo(() => {
		return teamMode.roles.map((role) => createDraftFromModeRole(role, promptTemplates, effectiveModelForDrafts, t));
	}, [teamMode, promptTemplates, effectiveModelForDrafts, t]);

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
		setSubmitErr(null);
		if (stage === 'confirm_team_name') {
			if (wizardCommitDrafts?.length) {
				setPreviewTeamDrafts(wizardCommitDrafts.map((d) => cloneRoleDraft(d)));
			}
			setStage('preview_team');
			return;
		}
		if (stage === 'preview_team') {
			setStage('choose_team_mode');
			return;
		}
		if (stage === 'choose_team_mode') {
			setStage('configure_model');
			return;
		}
		if (stage === 'configure_model') {
			setStage('connect');
			return;
		}
	};

	const goConfigureNext = () => {
		if (!selectedModelId || !modelOptionIdSet.has(selectedModelId)) {
			setSubmitErr(t('aiEmployees.setup.ceoPlanNeedModel'));
			return;
		}
		setSubmitErr(null);
		setStage('choose_team_mode');
	};

	const goChooseTeamNext = () => {
		setSubmitErr(null);
		setPreviewTeamDrafts(previewDrafts.map((d) => cloneRoleDraft(d)));
		setStage('preview_team');
	};

	const goPreviewNext = () => {
		const lead = previewTeamDrafts.find((d) => d.roleKey === 'ceo');
		const members = previewTeamDrafts.filter((d) => d.roleKey !== 'ceo');
		if (!lead || members.length === 0) {
			setSubmitErr(t('aiEmployees.setup.previewNeedMembers'));
			return;
		}
		setWizardCommitDrafts(previewTeamDrafts.map((d) => cloneRoleDraft(d)));
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
			notifyAiEmployeesRequestFailed(error);
		} finally {
			setSubmitBusy(false);
		}
	};

	/** Prefer wizard snapshot over live org list during onboarding commit. */
	const draftsForBootstrapCommit = useMemo(() => {
		if (wizardCommitDrafts?.length) {
			return wizardCommitDrafts.map((d) => cloneRoleDraft(d));
		}
		if (orgEmployees.length > 0) {
			return mapOrgEmployeesToCommitDrafts(orgEmployees, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet);
		}
		return commitDrafts;
	}, [orgEmployees, wizardCommitDrafts, commitDrafts, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet]);

	const commitTeamAndFinish = async () => {
		if (!workspaceId) {
			return;
		}
		const commitList = draftsForBootstrapCommit;
		if (commitList.length > 0) {
			const lead = commitList.find((item) => item.roleKey === 'ceo');
			const members = commitList.filter((item) => item.roleKey !== 'ceo');
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
			if (commitList.length === 0) {
				await apiPostBootstrapConfirmTemplates(conn, workspaceId);
				await onSync();
				await apiPostBootstrapComplete(conn, workspaceId);
				await onSync();
				return;
			}
			const lead = commitList.find((item) => item.roleKey === 'ceo')!;
			const members = commitList.filter((item) => item.roleKey !== 'ceo');
			const actualEmployeeIds = new Map<string, string>();
			const existingEmployees = new Map(orgEmployees.map((item) => [item.id, item]));
			const existingCeoEmployee = orgEmployees.find((e) => e.isCeo);
			for (const draft of [lead, ...members]) {
				const managerEmployeeId =
					draft.roleKey === 'ceo'
						? undefined
						: draft.managerEmployeeId
							? actualEmployeeIds.get(draft.managerEmployeeId) ?? draft.managerEmployeeId
							: actualEmployeeIds.get(lead.id ?? '');
				const systemPrompt = draft.promptDraft.systemPrompt.trim();
				const existingByDraftId = draft.id ? existingEmployees.get(draft.id) : undefined;
				const existing =
					existingByDraftId ?? (draft.roleKey === 'ceo' && existingCeoEmployee ? existingCeoEmployee : undefined);
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
							personaSeed: toPersonaSeed(
								draft,
								draft.roleKey === 'ceo' ? 'user' : draft.reason?.trim() ? 'ceo' : 'system'
							),
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
							personaSeed: toPersonaSeed(
								draft,
								draft.roleKey === 'ceo' ? 'user' : draft.reason?.trim() ? 'ceo' : 'system'
							),
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
			notifyAiEmployeesRequestFailed(error);
		} finally {
			setSubmitBusy(false);
		}
	};

	const setupFrameClass =
		stage === 'connect' ||
		stage === 'configure_model' ||
		stage === 'confirm_team_name'
			? 'ref-ai-employees-setup-frame ref-ai-employees-setup-frame--narrow'
			: stage === 'choose_team_mode' || stage === 'preview_team'
				? 'ref-ai-employees-setup-frame ref-ai-employees-setup-frame--wide'
				: 'ref-ai-employees-setup-frame';

	const generatePreviewRolePrompt = async () => {
		if (!previewEditDraft || !window.asyncShell) {
			return;
		}
		if (!previewEditDraft.localModelId || !modelOptionIdSet.has(previewEditDraft.localModelId)) {
			setSubmitErr(t('aiEmployees.role.modelRequired'));
			return;
		}
		setPreviewPromptBusy(true);
		setSubmitErr(null);
		try {
			const ceoName = previewTeamDrafts.find((d) => d.roleKey === 'ceo')?.displayName ?? '';
			const payload: RolePromptGeneratorInput = {
				modelId: previewEditDraft.localModelId,
				roleKey: previewEditDraft.roleKey,
				templatePromptKey: previewEditDraft.templatePromptKey,
				displayName: previewEditDraft.displayName,
				customRoleTitle: previewEditDraft.customRoleTitle,
				nationalityCode: previewEditDraft.nationalityCode ?? null,
				jobMission: previewEditDraft.jobMission,
				domainContext: previewEditDraft.domainContext,
				communicationNotes: previewEditDraft.communicationNotes,
				collaborationRules: previewEditDraft.promptDraft.collaborationRules,
				handoffRules: previewEditDraft.promptDraft.handoffRules,
				companyName: draftOrgLabel,
				managerSummary: ceoName,
			};
			const result = (await window.asyncShell.invoke('aiEmployees:generateRolePrompt', payload)) as
				| { ok: true; draft: RolePromptDraft }
				| { ok: false; error?: string };
			if (result.ok) {
				setPreviewEditDraft((prev) => (prev ? applyGeneratedPromptDraft(prev, result.draft) : null));
			}
		} catch (error) {
			notifyAiEmployeesRequestFailed(error);
		} finally {
			setPreviewPromptBusy(false);
		}
	};

	const savePreviewModal = () => {
		if (!previewEditDraft) {
			return;
		}
		if (previewEditDraft.id) {
			setPreviewTeamDrafts((prev) => prev.map((d) => (d.id === previewEditDraft.id ? cloneRoleDraft(previewEditDraft) : d)));
		}
		setPreviewEditDraft(null);
	};

	useEffect(() => {
		if (!previewEditDraft) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setPreviewEditDraft(null);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [previewEditDraft]);

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
						<div className="ref-ai-employees-setup-grid">
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.apiBaseUrl')}</span>
								<input
									className="ref-ai-employees-input"
									value={aiSettings.apiBaseUrl ?? conn.apiBaseUrl}
									onChange={(e) => {
										onClearConnectRefreshFailed();
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
										onClearConnectRefreshFailed();
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
									onClearConnectRefreshFailed();
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
										: connectRefreshFailed
											? t('aiEmployees.setup.connectRetry')
											: t('aiEmployees.setup.nextStep')}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{stage === 'configure_model' ? (
					<div className="ref-ai-employees-setup-step">
						<div className="ref-ai-employees-setup-panel-head">
							<div className="ref-ai-employees-setup-chip">{t('aiEmployees.setup.stepConfigModel')}</div>
							<h2>{t('aiEmployees.setup.configModelHeading')}</h2>
							<p>{t('aiEmployees.setup.configModelBlurb')}</p>
						</div>
						<label className="ref-ai-employees-catalog-field">
							<span>{t('aiEmployees.role.localModel')}</span>
							<VoidSelect
								ariaLabel={t('aiEmployees.role.localModel')}
								value={selectedModelId}
								onChange={setSelectedModelId}
								options={configureModelOpts}
							/>
						</label>
						{modelOptions.filter((m) => modelOptionIdSet.has(m.id)).length === 0 ? (
							<p className="ref-ai-employees-setup-muted">{t('aiEmployees.setup.configModelNoModels')}</p>
						) : null}
						<div className="ref-ai-employees-form-actions ref-ai-employees-setup-actions ref-ai-employees-setup-nav-row">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={goBack}>
								{t('aiEmployees.onboarding.prevStep')}
							</button>
							<div className="ref-ai-employees-setup-nav-trailing">
								<button
									type="button"
									className="ref-ai-employees-btn ref-ai-employees-btn--primary"
									onClick={goConfigureNext}
									disabled={!selectedModelId || !modelOptionIdSet.has(selectedModelId)}
								>
									{t('aiEmployees.setup.nextStep')}
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
						<div className="ref-ai-employees-setup-tier-grid" role="list" aria-label={t('aiEmployees.setup.modeHeading')}>
							<div
								role="listitem"
								className="ref-ai-employees-setup-tier-card is-selected is-featured"
							>
								<div className="ref-ai-employees-setup-tier-badge-row">
									<span className="ref-ai-employees-setup-tier-badge">{t('aiEmployees.setup.tierRecommended')}</span>
								</div>
								<div className="ref-ai-employees-setup-tier-top">
									<h3 className="ref-ai-employees-setup-tier-name">{t(teamMode.titleKey)}</h3>
									<p className="ref-ai-employees-setup-tier-desc">{t(teamMode.descKey)}</p>
								</div>
								<div className="ref-ai-employees-setup-tier-divider" />
								<p className="ref-ai-employees-setup-tier-include-label">{t('aiEmployees.setup.tierIncludedLabel')}</p>
								<ul className="ref-ai-employees-setup-tier-features">
									{teamMode.roles.map((role) => {
										const rec = getModelRecommendation(role.roleKey);
										return (
											<li key={role.id}>
												<span>{role.customRoleTitle}</span>
												{rec ? (
													<span className="ref-ai-employees-setup-tier-feature-hint">
														{' · '}
														{t(rec.hintKey)}
													</span>
												) : null}
											</li>
										);
									})}
								</ul>
							</div>
						</div>
						<p className="ref-ai-employees-setup-muted ref-ai-employees-setup-tier-footnote">{t('aiEmployees.setup.modeMultiProjectHint')}</p>
						<div className="ref-ai-employees-form-actions ref-ai-employees-setup-actions ref-ai-employees-setup-nav-row">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={goBack}>
								{t('aiEmployees.onboarding.prevStep')}
							</button>
							<div className="ref-ai-employees-setup-nav-trailing">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={goChooseTeamNext}>
									{t('aiEmployees.setup.nextStep')}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{stage === 'preview_team' ? (
					<div className="ref-ai-employees-setup-step">
						<div className="ref-ai-employees-setup-panel-head">
							<div className="ref-ai-employees-setup-chip">{t('aiEmployees.setup.stepPreviewTeam')}</div>
							<h2>{t('aiEmployees.setup.previewHeading')}</h2>
							<p>{t('aiEmployees.setup.previewBlurb')}</p>
							<p className="ref-ai-employees-setup-muted">{t('aiEmployees.setup.previewEditHint')}</p>
						</div>
						<div className="ref-ai-employees-org-badge-grid" role="list">
							{previewTeamDrafts.map((draft) => {
								const initial = (draft.displayName || draft.customRoleTitle || '?').trim().slice(0, 1).toUpperCase() || '?';
								const title = (draft.customRoleTitle || draft.roleKey).trim() || '—';
								const isActive = Boolean(previewEditDraft && previewEditDraft.id === draft.id);
								return (
									<button
										key={draft.id ?? draft.displayName}
										type="button"
										className={`ref-ai-employees-org-badge-card ${isActive ? 'is-active' : ''}`}
										onClick={() => setPreviewEditDraft(cloneRoleDraft(draft))}
									>
										<div className="ref-ai-employees-org-badge-lanyard" aria-hidden />
										<div className="ref-ai-employees-org-badge-card-inner">
											<div className="ref-ai-employees-org-badge-face" aria-hidden>
												<div className="ref-ai-employees-org-badge-face-ph">{initial}</div>
											</div>
											<div className="ref-ai-employees-org-badge-text">
												<span className="ref-ai-employees-org-badge-name">{draft.displayName || title}</span>
												<span className="ref-ai-employees-org-badge-title">{title}</span>
											</div>
											{draft.roleKey === 'ceo' ? <span className="ref-ai-employees-org-badge-chip">CEO</span> : null}
										</div>
									</button>
								);
							})}
						</div>
						<div className="ref-ai-employees-form-actions ref-ai-employees-setup-actions ref-ai-employees-setup-nav-row">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={goBack}>
								{t('aiEmployees.onboarding.prevStep')}
							</button>
							<div className="ref-ai-employees-setup-nav-trailing">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={goPreviewNext}>
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
							<p>{setupFinishOnlyResume ? t('aiEmployees.setup.finishAlmostBlurb') : t('aiEmployees.setup.confirmTeamNameBlurb')}</p>
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
			{previewEditDraft ? (
				<div
					className="ref-ai-employees-org-modal-overlay"
					role="presentation"
					onClick={() => {
						setPreviewEditDraft(null);
					}}
				>
					<div
						className="ref-ai-employees-org-modal ref-ai-employees-setup-preview-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ref-ai-employees-setup-preview-modal-title"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="ref-ai-employees-org-modal-head">
							<h3 id="ref-ai-employees-setup-preview-modal-title" className="ref-ai-employees-org-modal-title">
								{previewEditDraft.displayName || previewEditDraft.customRoleTitle || previewEditDraft.roleKey}
							</h3>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-modal-close"
								onClick={() => setPreviewEditDraft(null)}
								aria-label={t('common.close')}
							>
								×
							</button>
						</div>
						<div className="ref-ai-employees-org-modal-body">
							<RoleProfileEditor
								t={t}
								draft={previewEditDraft}
								modelOptions={modelOptions}
								onChange={(patch) => setPreviewEditDraft((prev) => (prev ? { ...prev, ...patch } : null))}
							/>
							<RoleCustomSystemPromptField
								t={t}
								value={previewEditDraft.promptDraft.systemPrompt}
								disabled={previewPromptBusy}
								generating={previewPromptBusy}
								generateDisabled={!previewEditDraft.localModelId || !modelOptionIdSet.has(previewEditDraft.localModelId)}
								onGenerate={() => void generatePreviewRolePrompt()}
								onRestore={() =>
									setPreviewEditDraft((prev) =>
										prev ? { ...prev, promptDraft: prev.lastGeneratedPromptDraft ?? prev.promptDraft } : null
									)
								}
								canRestore={Boolean(previewEditDraft.lastGeneratedPromptDraft)}
								onChange={(value) =>
									setPreviewEditDraft((prev) =>
										prev ? { ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } } : null
									)
								}
							/>
						</div>
						<div className="ref-ai-employees-org-modal-footer">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" onClick={() => setPreviewEditDraft(null)}>
								{t('common.cancel')}
							</button>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={savePreviewModal}>
								{t('common.save')}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
