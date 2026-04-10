import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeesOnboardingStep } from '../domain/bootstrap';
import type { AiEmployeesConnection } from '../api/client';
import {
	apiCreateOrgEmployee,
	apiPatchOrgEmployee,
	apiPostBootstrapComplete,
	apiPostBootstrapConfirmTemplates,
	apiPostBootstrapOrg,
} from '../api/orgClient';
import type { OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import { RoleProfileEditor, RolePromptReview } from '../components/RoleProfileEditor';
import { emptyPromptDraft } from '../domain/persona';
import { resolveEmployeeLocalModelId } from '../adapters/modelAdapter';
import {
	applyGeneratedPromptDraft,
	createEmptyRoleProfileDraft,
	createRoleDraftFromOrgEmployee,
	toPersonaSeed,
	type RoleProfileDraft,
} from '../domain/roleDraft';
import type { RolePromptDraft, RolePromptGeneratorInput } from '../../../shared/aiEmployeesPersona';

function buildPromptDraftFromTemplate(template: OrgPromptTemplate): RolePromptDraft {
	return {
		systemPrompt: template.systemPrompt,
		roleSummary: '',
		speakingStyle: '',
		collaborationRules: '',
		handoffRules: '',
	};
}

export function AiEmployeesOnboarding({
	t,
	conn,
	workspaceId,
	companyName,
	workspaces,
	step,
	onboardingErr,
	promptTemplates,
	orgEmployees,
	modelOptions,
	agentLocalModelMap,
	employeeLocalModelMap,
	modelOptionIdSet,
	defaultModelId,
	loadPromptTemplates,
	pickWorkspaceAndRefresh,
	backToWorkspacePicker,
	onSync,
	onBindEmployeeLocalModel,
	onClearEmployeeLocalModel,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	companyName: string;
	workspaces: { id: string; name?: string }[];
	step: AiEmployeesOnboardingStep;
	onboardingErr: string | null;
	promptTemplates: OrgPromptTemplate[];
	orgEmployees: OrgEmployee[];
	modelOptions: { id: string; displayName: string }[];
	agentLocalModelMap: Record<string, string> | undefined;
	employeeLocalModelMap: Record<string, string> | undefined;
	modelOptionIdSet: Set<string>;
	defaultModelId: string | undefined;
	loadPromptTemplates: () => void | Promise<void>;
	pickWorkspaceAndRefresh: (id: string) => Promise<void>;
	backToWorkspacePicker: () => void;
	onSync: () => void | Promise<void>;
	onBindEmployeeLocalModel: (employeeId: string, modelEntryId: string) => void;
	onClearEmployeeLocalModel: (employeeId: string) => void;
}) {
	const [localWs, setLocalWs] = useState(workspaceId);
	const [companyDraftName, setCompanyDraftName] = useState(companyName);
	const [busy, setBusy] = useState(false);
	const [rolePick, setRolePick] = useState<Record<string, boolean>>({});
	const [ceoDraft, setCeoDraft] = useState<RoleProfileDraft>(() =>
		createEmptyRoleProfileDraft({
			roleKey: 'ceo',
			customRoleTitle: 'CEO',
			templatePromptKey: 'ceo',
			localModelId: modelOptions[0]?.id ?? '',
			jobMission: 'Define company priorities, decision principles, and execution rhythm for the team.',
			domainContext: 'Describe the business domain, stage, and operating style this CEO should lead.',
		})
	);
	const [ceoStage, setCeoStage] = useState<'profile' | 'review'>('profile');
	const [ceoPromptBusy, setCeoPromptBusy] = useState(false);
	const [ceoPromptErr, setCeoPromptErr] = useState<string | null>(null);
	const [teamReviewActive, setTeamReviewActive] = useState(false);
	const [teamBusy, setTeamBusy] = useState(false);
	const [teamErr, setTeamErr] = useState<string | null>(null);
	const [candidateDrafts, setCandidateDrafts] = useState<RoleProfileDraft[]>([]);
	const [revisitCompany, setRevisitCompany] = useState(false);
	const [revisitCeo, setRevisitCeo] = useState(false);
	const [ceoEditDraft, setCeoEditDraft] = useState<RoleProfileDraft | null>(null);

	useEffect(() => {
		setLocalWs(workspaceId);
	}, [workspaceId]);

	useEffect(() => {
		setCompanyDraftName(companyName);
	}, [companyName]);

	useEffect(() => {
		if ((step === 'team_setup' || step === 'team_review') && promptTemplates.length === 0) {
			void loadPromptTemplates();
		}
	}, [step, loadPromptTemplates, promptTemplates.length]);

	useEffect(() => {
		if (step !== 'ceo_profile') {
			setCeoStage('profile');
			setRevisitCompany(false);
		}
		if (step !== 'team_setup' && step !== 'team_review') {
			setTeamReviewActive(false);
			setCandidateDrafts([]);
			setRolePick({});
		}
		if (step !== 'team_setup') {
			setRevisitCeo(false);
			setCeoEditDraft(null);
		}
	}, [step]);

	const effectiveStep = useMemo<AiEmployeesOnboardingStep>(() => {
		if (step === 'ceo_profile' && ceoStage === 'review') {
			return 'ceo_prompt_review';
		}
		if (step === 'team_setup' && teamReviewActive) {
			return 'team_review';
		}
		return step;
	}, [ceoStage, step, teamReviewActive]);

	const stepOrder: AiEmployeesOnboardingStep[] = [
		'pick_workspace',
		'company',
		'ceo_profile',
		'ceo_prompt_review',
		'team_setup',
		'team_review',
		'finish',
	];
	const stepIndex = Math.max(0, stepOrder.indexOf(effectiveStep));

	const sortedEmployees = useMemo(() => {
		const list = [...orgEmployees];
		list.sort((a, b) => {
			if (a.isCeo !== b.isCeo) {
				return a.isCeo ? -1 : 1;
			}
			return a.displayName.localeCompare(b.displayName);
		});
		return list;
	}, [orgEmployees]);
	const ceoEmployee = sortedEmployees.find((employee) => employee.isCeo) ?? null;

	useEffect(() => {
		if (!revisitCeo || !ceoEmployee) {
			setCeoEditDraft(null);
			return;
		}
		const mid =
			resolveEmployeeLocalModelId({
				employeeId: ceoEmployee.id,
				remoteAgentId: ceoEmployee.linkedRemoteAgentId ?? undefined,
				agentLocalModelMap,
				employeeLocalModelMap,
				defaultModelId,
				modelOptionIds: modelOptionIdSet,
			}) ?? '';
		setCeoEditDraft(createRoleDraftFromOrgEmployee(ceoEmployee, mid));
	}, [revisitCeo, ceoEmployee, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet]);

	const submitPickWorkspace = async () => {
		if (!localWs.trim()) {
			return;
		}
		setBusy(true);
		try {
			await pickWorkspaceAndRefresh(localWs);
		} finally {
			setBusy(false);
		}
	};

	const submitCompany = async () => {
		const name = companyDraftName.trim();
		if (!name || !workspaceId) {
			return;
		}
		setBusy(true);
		try {
			await apiPostBootstrapOrg(conn, workspaceId, name);
			await onSync();
			setRevisitCompany(false);
		} finally {
			setBusy(false);
		}
	};

	const invokeRolePromptGenerator = async (draft: RoleProfileDraft): Promise<RolePromptDraft> => {
		if (!window.asyncShell) {
			throw new Error('async shell unavailable');
		}
		if (!draft.localModelId) {
			throw new Error(t('aiEmployees.role.modelRequired'));
		}
		const payload: RolePromptGeneratorInput = {
			modelId: draft.localModelId,
			roleKey: draft.roleKey,
			templatePromptKey: draft.templatePromptKey,
			displayName: draft.displayName,
			customRoleTitle: draft.customRoleTitle,
			nationalityCode: draft.nationalityCode ?? null,
			jobMission: draft.jobMission,
			domainContext: draft.domainContext,
			communicationNotes: draft.communicationNotes,
			companyName: companyDraftName.trim() || companyName.trim() || 'Async Company',
			managerSummary: ceoEmployee
				? `${ceoEmployee.displayName} / ${ceoEmployee.customRoleTitle || ceoEmployee.roleKey}`
				: 'CEO',
		};
		const result = (await window.asyncShell.invoke('aiEmployees:generateRolePrompt', payload)) as
			| { ok: true; draft: RolePromptDraft }
			| { ok: false; error?: string };
		if (!result.ok) {
			throw new Error(result.error || 'generate prompt failed');
		}
		return result.draft;
	};

	const generateCeoPrompt = async () => {
		setCeoPromptBusy(true);
		setCeoPromptErr(null);
		try {
			const promptDraft = await invokeRolePromptGenerator(ceoDraft);
			setCeoDraft((prev) => applyGeneratedPromptDraft(prev, promptDraft));
		} catch (error) {
			setCeoPromptErr(error instanceof Error ? error.message : String(error));
		} finally {
			setCeoPromptBusy(false);
		}
	};

	const generateCeoEditPrompt = async () => {
		if (!ceoEditDraft) {
			return;
		}
		setTeamBusy(true);
		setTeamErr(null);
		try {
			const promptDraft = await invokeRolePromptGenerator(ceoEditDraft);
			setCeoEditDraft((prev) => (prev ? applyGeneratedPromptDraft(prev, promptDraft) : prev));
		} catch (error) {
			setTeamErr(error instanceof Error ? error.message : String(error));
		} finally {
			setTeamBusy(false);
		}
	};

	const saveCeoRevisit = async () => {
		if (!workspaceId || !ceoEmployee || !ceoEditDraft) {
			return;
		}
		setTeamBusy(true);
		setTeamErr(null);
		try {
			await apiPatchOrgEmployee(conn, workspaceId, ceoEmployee.id, {
				displayName: ceoEditDraft.displayName.trim(),
				customRoleTitle: ceoEditDraft.customRoleTitle.trim() || undefined,
				clearCustomRoleTitle: !ceoEditDraft.customRoleTitle.trim(),
				templatePromptKey: ceoEditDraft.templatePromptKey?.trim() || undefined,
				clearTemplatePromptKey: !ceoEditDraft.templatePromptKey?.trim(),
				customSystemPrompt: ceoEditDraft.promptDraft.systemPrompt.trim() || undefined,
				clearCustomSystemPrompt: !ceoEditDraft.promptDraft.systemPrompt.trim(),
				nationalityCode: ceoEditDraft.nationalityCode ?? null,
				clearNationalityCode: !ceoEditDraft.nationalityCode,
				personaSeed: toPersonaSeed(ceoEditDraft, 'user'),
				clearPersonaSeed: false,
				modelSource: ceoEditDraft.modelSource,
			});
			if (ceoEditDraft.localModelId) {
				onBindEmployeeLocalModel(ceoEmployee.id, ceoEditDraft.localModelId);
			} else {
				onClearEmployeeLocalModel(ceoEmployee.id);
			}
			setRevisitCeo(false);
			setCeoEditDraft(null);
			await onSync();
		} catch (error) {
			setTeamErr(error instanceof Error ? error.message : String(error));
		} finally {
			setTeamBusy(false);
		}
	};

	const submitCeo = async () => {
		if (!workspaceId || !ceoDraft.displayName.trim() || !ceoDraft.promptDraft.systemPrompt.trim()) {
			return;
		}
		setBusy(true);
		try {
			const employee = await apiCreateOrgEmployee(conn, workspaceId, {
				displayName: ceoDraft.displayName.trim(),
				roleKey: 'ceo',
				customRoleTitle: ceoDraft.customRoleTitle.trim() || 'CEO',
				isCeo: true,
				templatePromptKey: 'ceo',
				customSystemPrompt: ceoDraft.promptDraft.systemPrompt.trim(),
				nationalityCode: ceoDraft.nationalityCode ?? null,
				personaSeed: toPersonaSeed(ceoDraft, 'user'),
				modelSource: ceoDraft.modelSource,
			});
			if (ceoDraft.localModelId) {
				onBindEmployeeLocalModel(employee.id, ceoDraft.localModelId);
			}
			setCeoStage('profile');
			await onSync();
		} finally {
			setBusy(false);
		}
	};

	const openManualHiring = () => {
		const keys = Object.entries(rolePick)
			.filter(([, checked]) => checked)
			.map(([key]) => key);
		const drafts = keys.map((key) => {
			const template = promptTemplates.find((item) => item.key === key);
			return createEmptyRoleProfileDraft({
				id: crypto.randomUUID(),
				displayName: template?.title ?? key,
				roleKey: key,
				customRoleTitle: template?.title ?? key,
				templatePromptKey: key,
				promptDraft: template ? buildPromptDraftFromTemplate(template) : emptyPromptDraft(),
				lastGeneratedPromptDraft: template ? buildPromptDraftFromTemplate(template) : null,
				managerEmployeeId: ceoEmployee?.id,
				localModelId: modelOptions[0]?.id ?? '',
			});
		});
		setCandidateDrafts(drafts);
		setTeamReviewActive(drafts.length > 0);
		setTeamErr(null);
	};

	const updateCandidate = (id: string, patch: Partial<RoleProfileDraft>) => {
		setCandidateDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
	};

	const generateCandidatePrompt = async (candidate: RoleProfileDraft) => {
		setTeamBusy(true);
		setTeamErr(null);
		try {
			const promptDraft = await invokeRolePromptGenerator(candidate);
			setCandidateDrafts((prev) => prev.map((item) => (item.id === candidate.id ? applyGeneratedPromptDraft(item, promptDraft) : item)));
		} catch (error) {
			setTeamErr(error instanceof Error ? error.message : String(error));
		} finally {
			setTeamBusy(false);
		}
	};

	const submitRoles = async () => {
		if (!workspaceId) {
			return;
		}
		const accepted = candidateDrafts.filter((candidate) => !candidate.rejected);
		if (accepted.length === 0) {
			setTeamErr(t('aiEmployees.role.nonCeoRequired'));
			return;
		}
		setTeamBusy(true);
		setTeamErr(null);
		try {
			for (const candidate of accepted) {
				const created = await apiCreateOrgEmployee(conn, workspaceId, {
					displayName: candidate.displayName.trim(),
					roleKey: candidate.roleKey,
					customRoleTitle: candidate.customRoleTitle.trim() || undefined,
					managerEmployeeId: candidate.managerEmployeeId,
					createdByEmployeeId: ceoEmployee?.id,
					templatePromptKey: candidate.templatePromptKey,
					customSystemPrompt: candidate.promptDraft.systemPrompt.trim(),
					nationalityCode: candidate.nationalityCode ?? null,
					personaSeed: toPersonaSeed(candidate, ceoEmployee ? 'ceo' : 'user'),
					modelSource: candidate.modelSource,
				});
				if (candidate.localModelId) {
					onBindEmployeeLocalModel(created.id, candidate.localModelId);
				}
			}
			await apiPostBootstrapConfirmTemplates(conn, workspaceId);
			setTeamReviewActive(false);
			setCandidateDrafts([]);
			await onSync();
		} catch (error) {
			setTeamErr(error instanceof Error ? error.message : String(error));
		} finally {
			setTeamBusy(false);
		}
	};

	const submitFinish = async () => {
		if (!workspaceId) {
			return;
		}
		setBusy(true);
		try {
			await apiPostBootstrapComplete(conn, workspaceId);
			await onSync();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ref-ai-employees-onboarding" role="region" aria-label={t('aiEmployees.onboarding.aria')}>
			<div className="ref-ai-employees-onboarding-progress" aria-label={t('aiEmployees.onboarding.progressAria')}>
				{stepOrder.map((currentStep, index) => {
					const done = index <= stepIndex;
					const current = currentStep === effectiveStep;
					return (
						<div
							key={currentStep}
							className={`ref-ai-employees-onboarding-step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`}
						>
							<div className="ref-ai-employees-onboarding-dot" />
							<span className="ref-ai-employees-onboarding-step-label">{t(`aiEmployees.onboarding.stepShort.${currentStep}`)}</span>
						</div>
					);
				})}
			</div>

			{onboardingErr ? (
				<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
					{onboardingErr}
				</div>
			) : null}

			{effectiveStep === 'pick_workspace' ? (
				<div className="ref-ai-employees-onboarding-card ref-ai-employees-onboarding-card--hero">
					<p className="ref-ai-employees-onboarding-kicker">{t('aiEmployees.onboarding.kicker')}</p>
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.pickWorkspaceTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.onboarding.pickWorkspaceDesc')}</p>
					<label className="ref-ai-employees-onboarding-field">
						<span>{t('aiEmployees.remoteWorkspace')}</span>
						<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={localWs} onChange={(e) => setLocalWs(e.target.value)}>
							<option value="">{t('aiEmployees.pickWorkspace')}</option>
							{workspaces.map((workspace) => (
								<option key={workspace.id} value={workspace.id}>
									{workspace.name ?? workspace.id.slice(0, 8)}
								</option>
							))}
						</select>
					</label>
					<p className="ref-ai-employees-muted ref-ai-employees-onboarding-hint">{t('aiEmployees.onboarding.pickWorkspaceHint')}</p>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy || !localWs} onClick={() => void submitPickWorkspace()}>
							{t('aiEmployees.onboarding.continue')}
						</button>
					</div>
				</div>
			) : null}

			{effectiveStep === 'company' ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.companyTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.onboarding.companyDesc')}</p>
					<label className="ref-ai-employees-onboarding-field">
						<span>{t('aiEmployees.onboarding.companyName')}</span>
						<input className="ref-ai-employees-input" value={companyDraftName} onChange={(e) => setCompanyDraftName(e.target.value)} placeholder={t('aiEmployees.onboarding.companyPh')} />
					</label>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy} onClick={() => backToWorkspacePicker()}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy || !companyDraftName.trim()} onClick={() => void submitCompany()}>
							{t('aiEmployees.onboarding.continue')}
						</button>
					</div>
				</div>
			) : null}

			{step === 'ceo_profile' && revisitCompany && effectiveStep === 'ceo_profile' ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.companyTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.onboarding.companyDesc')}</p>
					<label className="ref-ai-employees-onboarding-field">
						<span>{t('aiEmployees.onboarding.companyName')}</span>
						<input className="ref-ai-employees-input" value={companyDraftName} onChange={(e) => setCompanyDraftName(e.target.value)} placeholder={t('aiEmployees.onboarding.companyPh')} />
					</label>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy} onClick={() => setRevisitCompany(false)}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy || !companyDraftName.trim()} onClick={() => void submitCompany()}>
							{t('aiEmployees.onboarding.continue')}
						</button>
					</div>
				</div>
			) : null}

			{step === 'ceo_profile' && !revisitCompany && effectiveStep === 'ceo_profile' ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.ceoTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.role.ceoDesc')}</p>
					<RoleProfileEditor
						t={t}
						draft={ceoDraft}
						modelOptions={modelOptions}
						onChange={(patch) => setCeoDraft((prev) => ({ ...prev, ...patch }))}
					/>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy || ceoPromptBusy} onClick={() => setRevisitCompany(true)}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => void generateCeoPrompt()} disabled={ceoPromptBusy}>
							{ceoPromptBusy ? t('aiEmployees.role.generatingPrompt') : t('aiEmployees.role.generatePrompt')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={!ceoDraft.displayName.trim()} onClick={() => setCeoStage('review')}>
							{t('aiEmployees.onboarding.continue')}
						</button>
					</div>
				</div>
			) : null}

			{effectiveStep === 'ceo_prompt_review' ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.role.promptReviewTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.role.promptReviewDesc')}</p>
					<RolePromptReview
						t={t}
						draft={ceoDraft}
						generating={ceoPromptBusy}
						error={ceoPromptErr}
						onPromptChange={(value) =>
							setCeoDraft((prev) => ({ ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } }))
						}
						onGenerate={() => void generateCeoPrompt()}
						onRestore={() =>
							setCeoDraft((prev) => ({
								...prev,
								promptDraft: prev.lastGeneratedPromptDraft ?? prev.promptDraft,
							}))
						}
					/>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => setCeoStage('profile')}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy || !ceoDraft.promptDraft.systemPrompt.trim()} onClick={() => void submitCeo()}>
							{t('aiEmployees.role.saveRole')}
						</button>
					</div>
				</div>
			) : null}

			{step === 'team_setup' && revisitCeo && ceoEditDraft ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.revisitCeoTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.onboarding.revisitCeoDesc')}</p>
					{teamErr ? (
						<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
							{teamErr}
						</div>
					) : null}
					<RoleProfileEditor
						t={t}
						draft={ceoEditDraft}
						modelOptions={modelOptions}
						onChange={(patch) => setCeoEditDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
					/>
					<RolePromptReview
						t={t}
						draft={ceoEditDraft}
						generating={teamBusy}
						error={null}
						onPromptChange={(value) =>
							setCeoEditDraft((prev) => (prev ? { ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } } : prev))
						}
						onGenerate={() => void generateCeoEditPrompt()}
						onRestore={() =>
							setCeoEditDraft((prev) => (prev ? { ...prev, promptDraft: prev.lastGeneratedPromptDraft ?? prev.promptDraft } : prev))
						}
					/>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={teamBusy} onClick={() => setRevisitCeo(false)}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={teamBusy} onClick={() => void saveCeoRevisit()}>
							{t('aiEmployees.orgSaveProfile')}
						</button>
					</div>
				</div>
			) : null}

			{step === 'team_setup' && !revisitCeo && effectiveStep === 'team_setup' ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.rolesTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.role.teamSetupDesc')}</p>
					{teamErr ? (
						<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
							{teamErr}
						</div>
					) : null}
					<div className="ref-ai-employees-onboarding-mode-row">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={teamBusy} onClick={() => void openManualHiring()}>
							{t('aiEmployees.role.manualHireAction')}
						</button>
					</div>
					<ul className="ref-ai-employees-onboarding-role-list">
						{promptTemplates.map((template) => (
							<li key={template.key}>
								<label className="ref-ai-employees-onboarding-role-row">
									<input type="checkbox" checked={rolePick[template.key] ?? false} onChange={(e) => setRolePick((prev) => ({ ...prev, [template.key]: e.target.checked }))} />
									<span className="ref-ai-employees-onboarding-role-title">{template.title}</span>
									<span className="ref-ai-employees-muted ref-ai-employees-onboarding-role-snippet">{template.systemPrompt.slice(0, 120)}...</span>
								</label>
							</li>
						))}
					</ul>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--secondary"
							disabled={teamBusy || !ceoEmployee}
							onClick={() => {
								setTeamReviewActive(false);
								setRevisitCeo(true);
							}}
						>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
					</div>
				</div>
			) : null}

			{effectiveStep === 'team_review' ? (
				<div className="ref-ai-employees-onboarding-card ref-ai-employees-onboarding-card--wide">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.role.teamReviewTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.role.teamReviewDesc')}</p>
					{teamErr ? (
						<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
							{teamErr}
						</div>
					) : null}
					<div className="ref-ai-employees-role-review-list">
						{candidateDrafts.map((candidate) => (
							<div key={candidate.id} className={`ref-ai-employees-role-review-card ${candidate.rejected ? 'is-rejected' : ''}`}>
								<div className="ref-ai-employees-role-review-head">
									<strong>{candidate.displayName || candidate.customRoleTitle || candidate.roleKey}</strong>
									<div className="ref-ai-employees-form-actions">
										<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" onClick={() => updateCandidate(candidate.id ?? '', { rejected: !candidate.rejected })}>
											{candidate.rejected ? t('aiEmployees.role.acceptCandidate') : t('aiEmployees.role.rejectCandidate')}
										</button>
										<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--danger" onClick={() => setCandidateDrafts((prev) => prev.filter((item) => item.id !== candidate.id))}>
											{t('common.remove')}
										</button>
									</div>
								</div>
								<label className="ref-ai-employees-catalog-field">
									<span>{t('aiEmployees.managerEmployee')}</span>
									<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={candidate.managerEmployeeId ?? ''} onChange={(e) => updateCandidate(candidate.id ?? '', { managerEmployeeId: e.target.value || undefined })}>
										<option value="">{t('aiEmployees.managerNone')}</option>
										{sortedEmployees.map((employee) => (
											<option key={employee.id} value={employee.id}>
												{employee.displayName}
											</option>
										))}
									</select>
								</label>
								<RoleProfileEditor
									t={t}
									draft={candidate}
									modelOptions={modelOptions}
									onChange={(patch) => updateCandidate(candidate.id ?? '', patch)}
								/>
								<RolePromptReview
									t={t}
									draft={candidate}
									generating={teamBusy}
									error={null}
									onPromptChange={(value) => updateCandidate(candidate.id ?? '', { promptDraft: { ...candidate.promptDraft, systemPrompt: value } })}
									onGenerate={() => void generateCandidatePrompt(candidate)}
									onRestore={() => updateCandidate(candidate.id ?? '', { promptDraft: candidate.lastGeneratedPromptDraft ?? candidate.promptDraft })}
								/>
							</div>
						))}
					</div>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={teamBusy} onClick={() => setTeamReviewActive(false)}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={teamBusy || candidateDrafts.filter((candidate) => !candidate.rejected).length === 0} onClick={() => void submitRoles()}>
							{t('aiEmployees.onboarding.rolesContinue')}
						</button>
					</div>
				</div>
			) : null}

			{effectiveStep === 'finish' ? (
				<div className="ref-ai-employees-onboarding-card">
					<h2 className="ref-ai-employees-onboarding-title">{t('aiEmployees.onboarding.finishTitle')}</h2>
					<p className="ref-ai-employees-onboarding-desc">{t('aiEmployees.onboarding.finishDesc')}</p>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy} onClick={() => void submitFinish()}>
							{t('aiEmployees.onboarding.enterDashboard')}
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
