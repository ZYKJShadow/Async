import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import { VoidSelect } from '../../VoidSelect';
import type { AiEmployeesOnboardingStep } from '../domain/bootstrap';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import type { AiEmployeesConnection } from '../api/client';
import {
	apiCreateOrgEmployee,
	apiPatchOrgEmployee,
	apiPostBootstrapComplete,
	apiPostBootstrapConfirmTemplates,
	apiPostBootstrapOrg,
} from '../api/orgClient';
import type { OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import { RoleCustomSystemPromptField, RoleProfileEditor } from '../components/RoleProfileEditor';
import { emptyPromptDraft } from '../domain/persona';
import { createEmptyRoleProfileDraft, createRoleDraftFromOrgEmployee, toPersonaSeed, type RoleProfileDraft } from '../domain/roleDraft';
import type { LocalModelEntry } from '../sessionTypes';
import type { RolePromptDraft } from '../../../shared/aiEmployeesPersona';
import { managerPickVoidOptions, workspacePickVoidOptions } from '../voidSelectOptions';

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
	employeeLocalModelMap,
	modelOptionIdSet,
	loadPromptTemplates,
	pickWorkspaceAndRefresh,
	backToWorkspacePicker,
	onSync,
	onBindEmployeeLocalModel,
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
	modelOptions: LocalModelEntry[];
	employeeLocalModelMap: Record<string, string> | undefined;
	modelOptionIdSet: Set<string>;
	loadPromptTemplates: () => void | Promise<void>;
	pickWorkspaceAndRefresh: (id: string) => Promise<void>;
	backToWorkspacePicker: () => void;
	onSync: () => void | Promise<void>;
	onBindEmployeeLocalModel: (employeeId: string, modelEntryId: string) => void;
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
		})
	);
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
		if (step === 'team_setup' && teamReviewActive) {
			return 'team_review';
		}
		return step;
	}, [step, teamReviewActive]);

	const stepOrder: AiEmployeesOnboardingStep[] = ['pick_workspace', 'company', 'ceo_profile', 'team_setup', 'team_review', 'finish'];
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
	const workspaceOptsOnboarding = useMemo(() => workspacePickVoidOptions(t, workspaces), [t, workspaces]);
	const managerOptsOnboarding = useMemo(() => managerPickVoidOptions(t, sortedEmployees), [t, sortedEmployees]);
	const ceoEmployee = sortedEmployees.find((employee) => employee.isCeo) ?? null;

	useEffect(() => {
		if (!revisitCeo || !ceoEmployee) {
			setCeoEditDraft(null);
			return;
		}
		const bound = employeeLocalModelMap?.[ceoEmployee.id];
		const mid = bound && modelOptionIdSet.has(bound) ? bound : '';
		setCeoEditDraft(createRoleDraftFromOrgEmployee(ceoEmployee, mid));
	}, [revisitCeo, ceoEmployee, employeeLocalModelMap, modelOptionIdSet]);

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

	const saveCeoRevisit = async () => {
		if (!workspaceId || !ceoEmployee || !ceoEditDraft) {
			return;
		}
		if (!ceoEditDraft.localModelId || !modelOptionIdSet.has(ceoEditDraft.localModelId)) {
			setTeamErr(t('aiEmployees.role.modelRequired'));
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
				modelSource: 'local_model',
			});
			onBindEmployeeLocalModel(ceoEmployee.id, ceoEditDraft.localModelId);
			setRevisitCeo(false);
			setCeoEditDraft(null);
			await onSync();
		} catch (error) {
			notifyAiEmployeesRequestFailed(error);
		} finally {
			setTeamBusy(false);
		}
	};

	const submitCeo = async () => {
		if (!workspaceId || !ceoDraft.displayName.trim() || !ceoDraft.promptDraft.systemPrompt.trim()) {
			return;
		}
		if (!ceoDraft.localModelId || !modelOptionIdSet.has(ceoDraft.localModelId)) {
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
				modelSource: 'local_model',
			});
			onBindEmployeeLocalModel(employee.id, ceoDraft.localModelId);
			await onSync();
		} catch (error) {
			notifyAiEmployeesRequestFailed(error);
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

	const submitRoles = async () => {
		if (!workspaceId) {
			return;
		}
		const accepted = candidateDrafts.filter((candidate) => !candidate.rejected);
		if (accepted.length === 0) {
			setTeamErr(t('aiEmployees.role.nonCeoRequired'));
			return;
		}
		if (accepted.some((c) => !c.localModelId || !modelOptionIdSet.has(c.localModelId))) {
			setTeamErr(t('aiEmployees.role.modelRequired'));
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
					modelSource: 'local_model',
				});
				onBindEmployeeLocalModel(created.id, candidate.localModelId);
			}
			await apiPostBootstrapConfirmTemplates(conn, workspaceId);
			setTeamReviewActive(false);
			setCandidateDrafts([]);
			await onSync();
		} catch (error) {
			notifyAiEmployeesRequestFailed(error);
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
		} catch (error) {
			notifyAiEmployeesRequestFailed(error);
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
						<VoidSelect
							ariaLabel={t('aiEmployees.remoteWorkspace')}
							value={localWs}
							onChange={setLocalWs}
							options={workspaceOptsOnboarding}
						/>
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
					<RoleCustomSystemPromptField
						t={t}
						value={ceoDraft.promptDraft.systemPrompt}
						disabled={busy}
						onChange={(value) => setCeoDraft((prev) => ({ ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } }))}
					/>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy} onClick={() => setRevisitCompany(true)}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--primary"
							disabled={
								busy ||
								!ceoDraft.displayName.trim() ||
								!ceoDraft.promptDraft.systemPrompt.trim() ||
								!ceoDraft.localModelId ||
								!modelOptionIdSet.has(ceoDraft.localModelId)
							}
							onClick={() => void submitCeo()}
						>
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
					<RoleCustomSystemPromptField
						t={t}
						value={ceoEditDraft.promptDraft.systemPrompt}
						disabled={teamBusy}
						onChange={(value) =>
							setCeoEditDraft((prev) => (prev ? { ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } } : prev))
						}
					/>
					<div className="ref-ai-employees-form-actions ref-ai-employees-onboarding-card-actions">
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={teamBusy} onClick={() => setRevisitCeo(false)}>
							{t('aiEmployees.onboarding.prevStep')}
						</button>
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--primary"
							disabled={
								teamBusy ||
								!ceoEditDraft.localModelId ||
								!modelOptionIdSet.has(ceoEditDraft.localModelId)
							}
							onClick={() => void saveCeoRevisit()}
						>
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
									<VoidSelect
										ariaLabel={t('aiEmployees.managerEmployee')}
										value={candidate.managerEmployeeId ?? ''}
										onChange={(v) => updateCandidate(candidate.id ?? '', { managerEmployeeId: v || undefined })}
										options={managerOptsOnboarding}
									/>
								</label>
								<RoleProfileEditor
									t={t}
									draft={candidate}
									modelOptions={modelOptions}
									onChange={(patch) => updateCandidate(candidate.id ?? '', patch)}
								/>
								<RoleCustomSystemPromptField
									t={t}
									value={candidate.promptDraft.systemPrompt}
									disabled={teamBusy}
									onChange={(value) => updateCandidate(candidate.id ?? '', { promptDraft: { ...candidate.promptDraft, systemPrompt: value } })}
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
