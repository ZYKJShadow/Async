import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type AnimationEvent } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
import { IconBookOpen, IconDoc, IconListTodo, IconSettings, IconBot } from '../../icons';
import type { AiEmployeesConnection } from '../api/client';
import type { SkillJson } from '../api/types';
import { apiCreateOrgEmployee, apiPatchOrgEmployee, apiUploadOrgEmployeeAvatar } from '../api/orgClient';
import type { OrgEmployee } from '../api/orgTypes';
import { ImBindingsSection, RoleCustomSystemPromptField, RoleProfileEditor } from '../components/RoleProfileEditor';
import { emptyPromptDraft } from '../domain/persona';
import {
	applyGeneratedPromptDraft,
	createEmptyRoleProfileDraft,
	createRoleDraftFromOrgEmployee,
	toPersonaSeed,
	type RoleProfileDraft,
} from '../domain/roleDraft';
import { EmployeeSkillsTab } from '../components/EmployeeSkillsTab';
import { EmployeeActivityStatusLabel } from '../components/EmployeeActivityStatus';
import { EmployeeRunOperationsFeed } from '../components/EmployeeRunOperationsFeed';
import { formatEmployeeResolvedModelLabel } from '../adapters/modelAdapter';
import { buildEmployeeActivityStatusMap, employeeHasActiveRunInvolvement, isOrchestrationRunIncomplete } from '../domain/employeeActivityStatus';
import type { LocalModelEntry } from '../sessionTypes';
import type { AiEmployeesOrchestrationState } from '../../../shared/aiEmployeesSettings';
import type { RolePromptDraft, RolePromptGeneratorInput } from '../../../shared/aiEmployeesPersona';
import { useOrgEmployeeAvatarPreview } from '../hooks/useOrgEmployeeAvatarPreview';

function EmployeeBadgeFace({
	conn,
	workspaceId,
	employee,
}: {
	conn: AiEmployeesConnection;
	workspaceId: string;
	employee: OrgEmployee;
}) {
	const preview = useOrgEmployeeAvatarPreview(conn, workspaceId, employee.id, Boolean(employee.avatarAssetId));
	if (preview) {
		return <img src={preview} alt="" className="ref-ai-employees-org-badge-face-img" />;
	}
	return (
		<div className="ref-ai-employees-org-badge-face-ph" aria-hidden>
			{employee.displayName.trim().slice(0, 1).toUpperCase() || '?'}
		</div>
	);
}

export function EmployeesPage({
	t,
	conn,
	workspaceId,
	companyName,
	orgEmployees,
	onRefreshOrg,
	agentLocalModelMap,
	employeeLocalModelMap,
	modelOptions,
	modelOptionIdSet,
	onBindEmployeeLocalModel,
	defaultModelId,
	orchestration,
	employeeChatStreaming,
	employeeChatError,
	skillsCatalog,
	onRefreshSkills,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	skillsCatalog?: SkillJson[];
	onRefreshSkills?: () => void | Promise<void>;
	companyName: string;
	orgEmployees: OrgEmployee[];
	onRefreshOrg: () => void | Promise<void>;
	agentLocalModelMap: Record<string, string> | undefined;
	employeeLocalModelMap: Record<string, string> | undefined;
	modelOptions: LocalModelEntry[];
	modelOptionIdSet: Set<string>;
	onBindEmployeeLocalModel: (employeeId: string, modelEntryId: string) => void;
	/** Async 设置中的默认本地模型（用于招聘等流程） */
	defaultModelId?: string;
	orchestration?: AiEmployeesOrchestrationState;
	employeeChatStreaming?: Record<string, string>;
	employeeChatError?: Record<string, string | undefined>;
}) {
	type AiEmployeeDetailTab = 'instructions' | 'skills' | 'tasks' | 'settings';

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detailTab, setDetailTab] = useState<AiEmployeeDetailTab>('instructions');
	const [saveErr, setSaveErr] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectedDraft, setSelectedDraft] = useState<RoleProfileDraft | null>(null);
	const [hireDrafts, setHireDrafts] = useState<RoleProfileDraft[]>([]);
	const [hireModalOpen, setHireModalOpen] = useState(false);
	const [hireModalExiting, setHireModalExiting] = useState(false);
	const hireModalBodyRef = useRef<HTMLDivElement>(null);
	const [hireBusy, setHireBusy] = useState(false);
	const [hireErr, setHireErr] = useState<string | null>(null);
	const effectiveCompanyName = companyName.trim() || 'Async Company';
	const sortedOrg = useMemo(() => {
		const list = [...orgEmployees];
		list.sort((a, b) => {
			if (a.isCeo !== b.isCeo) {
				return a.isCeo ? -1 : 1;
			}
			return a.displayName.localeCompare(b.displayName);
		});
		return list;
	}, [orgEmployees]);

	const orgById = useMemo(() => new Map(sortedOrg.map((e) => [e.id, e])), [sortedOrg]);

	const employeeActivityMap = useMemo(
		() => buildEmployeeActivityStatusMap(sortedOrg, orchestration),
		[orchestration, sortedOrg],
	);

	const openRunsForSelected = useMemo(() => {
		if (!orchestration || !selectedId) {
			return [];
		}
		return orchestration.runs
			.filter((r) => isOrchestrationRunIncomplete(r) && employeeHasActiveRunInvolvement(selectedId, r))
			.sort((a, b) => Date.parse(b.lastEventAtIso ?? b.createdAtIso) - Date.parse(a.lastEventAtIso ?? a.createdAtIso));
	}, [orchestration, selectedId]);

	const selected = useMemo(
		() => (selectedId ? sortedOrg.find((employee) => employee.id === selectedId) ?? null : null),
		[selectedId, sortedOrg]
	);
	const ceoEmployee = sortedOrg.find((employee) => employee.isCeo) ?? null;

	const modelRouteParams = useMemo(
		() => ({
			agentLocalModelMap,
			employeeLocalModelMap,
			defaultModelId,
			modelOptionIdSet,
			modelOptions,
		}),
		[agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet, modelOptions]
	);

	const employeeModelLine = (employee: OrgEmployee) =>
		formatEmployeeResolvedModelLabel({ employee, ...modelRouteParams }) ?? t('aiEmployees.modelDisplayNone');

	const beginCloseHireModal = useCallback(() => {
		if (hireModalExiting) {
			return;
		}
		if (!hireModalOpen) {
			return;
		}
		if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			setHireModalOpen(false);
			setHireModalExiting(false);
			setHireDrafts([]);
			setHireErr(null);
			return;
		}
		setHireModalOpen(false);
		setHireModalExiting(true);
	}, [hireModalOpen, hireModalExiting]);

	const onHireModalOverlayAnimationEnd = useCallback((e: AnimationEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget) {
			return;
		}
		if (e.animationName !== 'ref-ai-employees-org-modal-overlay-out') {
			return;
		}
		setHireModalExiting(false);
		setHireDrafts([]);
		setHireErr(null);
	}, []);

	useEffect(() => {
		if (sortedOrg.length === 0) {
			setSelectedId(null);
			return;
		}
		if (!selectedId || !sortedOrg.some((employee) => employee.id === selectedId)) {
			setSelectedId(sortedOrg[0]!.id);
		}
	}, [sortedOrg, selectedId]);

	useEffect(() => {
		if (!hireModalOpen && !hireModalExiting) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				beginCloseHireModal();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [hireModalOpen, hireModalExiting, beginCloseHireModal]);

	useEffect(() => {
		if (hireModalOpen && !hireModalExiting) {
			hireModalBodyRef.current?.focus();
		}
	}, [hireModalOpen, hireModalExiting]);

	useEffect(() => {
		if (!hireModalExiting) {
			return;
		}
		const id = window.setTimeout(() => setHireModalExiting(false), 500);
		return () => window.clearTimeout(id);
	}, [hireModalExiting]);

	useEffect(() => {
		if (!workspaceId) {
			return;
		}
		void onRefreshOrg();
	}, [workspaceId, onRefreshOrg]);

	useLayoutEffect(() => {
		if (!selected) {
			setSelectedDraft(null);
			return;
		}
		const bound = employeeLocalModelMap?.[selected.id];
		const localModelId = bound && modelOptionIdSet.has(bound) ? bound : '';
		setSelectedDraft(createRoleDraftFromOrgEmployee(selected, localModelId));
		setSaveErr(null);
	}, [selected, employeeLocalModelMap, modelOptionIdSet]);

	const avatarPreview = useOrgEmployeeAvatarPreview(conn, workspaceId, selected?.id ?? null, Boolean(selected?.avatarAssetId));

	const managerSummaryLine = useMemo(
		() =>
			ceoEmployee ? `${ceoEmployee.displayName} / ${ceoEmployee.customRoleTitle || ceoEmployee.roleKey}` : '',
		[ceoEmployee]
	);

	/** Auto-fill system prompt + collaboration/handoff via local model when hiring (best-effort). */
	const tryAutoGenerateHireDraft = async (draft: RoleProfileDraft): Promise<RoleProfileDraft> => {
		if (!window.asyncShell || !draft.localModelId || !modelOptionIdSet.has(draft.localModelId)) {
			return draft;
		}
		try {
			const teamHint =
				sortedOrg.length > 0
					? `Current team: ${sortedOrg.map((e) => `${e.displayName} (${e.customRoleTitle || e.roleKey})`).join('; ')}`
					: '';
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
				collaborationRules: draft.promptDraft.collaborationRules,
				handoffRules: draft.promptDraft.handoffRules,
				companyName: effectiveCompanyName,
				managerSummary: [managerSummaryLine, teamHint].filter(Boolean).join(' · '),
			};
			const result = (await window.asyncShell.invoke('aiEmployees:generateRolePrompt', payload)) as
				| { ok: true; draft: RolePromptDraft }
				| { ok: false; error?: string };
			if (result.ok) {
				return applyGeneratedPromptDraft(draft, result.draft);
			}
		} catch {
			/* keep draft */
		}
		return draft;
	};

	const saveDetail = async () => {
		if (!selected || !selectedDraft || !workspaceId) {
			return;
		}
		if (!selectedDraft.localModelId || !modelOptionIdSet.has(selectedDraft.localModelId)) {
			setSaveErr(t('aiEmployees.role.modelRequired'));
			return;
		}
		setSaving(true);
		setSaveErr(null);
		try {
			await apiPatchOrgEmployee(conn, workspaceId, selected.id, {
				displayName: selectedDraft.displayName,
				customRoleTitle: selectedDraft.customRoleTitle.trim() || undefined,
				clearCustomRoleTitle: !selectedDraft.customRoleTitle.trim(),
				templatePromptKey: selectedDraft.templatePromptKey?.trim() || undefined,
				clearTemplatePromptKey: !selectedDraft.templatePromptKey?.trim(),
				customSystemPrompt: selectedDraft.promptDraft.systemPrompt.trim() || undefined,
				clearCustomSystemPrompt: !selectedDraft.promptDraft.systemPrompt.trim(),
				modelSource: 'local_model',
				managerEmployeeId: selectedDraft.managerEmployeeId?.trim() || undefined,
				clearManager: !selectedDraft.managerEmployeeId?.trim(),
				nationalityCode: selectedDraft.nationalityCode ?? null,
				clearNationalityCode: !selectedDraft.nationalityCode,
				personaSeed: toPersonaSeed(selectedDraft, selected.createdByEmployeeId ? 'ceo' : 'user'),
				clearPersonaSeed: false,
			});
			onBindEmployeeLocalModel(selected.id, selectedDraft.localModelId);
			await onRefreshOrg();
		} catch (error) {
			setSaveErr(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	};

	const onAvatarPick = async (file: File | null) => {
		if (!file || !selected || !workspaceId) {
			return;
		}
		setSaving(true);
		setSaveErr(null);
		try {
			await apiUploadOrgEmployeeAvatar(conn, workspaceId, selected.id, file);
			await onRefreshOrg();
		} catch (error) {
			setSaveErr(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	};

	const startAddMember = () => {
		setHireModalExiting(false);
		setHireModalOpen(true);
		setHireErr(null);
		const defaultHireModel = modelOptions.find((m) => modelOptionIdSet.has(m.id))?.id ?? '';
		setHireDrafts([
			createEmptyRoleProfileDraft({
				id: crypto.randomUUID(),
				roleKey: 'custom',
				customRoleTitle: 'New Role',
				managerEmployeeId: ceoEmployee?.id,
				localModelId: defaultHireModel,
				promptDraft: emptyPromptDraft(),
			}),
		]);
	};

	const createHires = async () => {
		if (!workspaceId) {
			return;
		}
		const accepted = hireDrafts.filter((draft) => !draft.rejected);
		if (accepted.length === 0) {
			setHireErr(t('aiEmployees.role.nonCeoRequired'));
			return;
		}
		const missingModel = accepted.some((draft) => !draft.localModelId || !modelOptionIdSet.has(draft.localModelId));
		if (missingModel) {
			setHireErr(t('aiEmployees.role.modelRequired'));
			return;
		}
		setHireBusy(true);
		setHireErr(null);
		try {
			for (const draft of accepted) {
				const enriched = await tryAutoGenerateHireDraft(draft);
				const created = await apiCreateOrgEmployee(conn, workspaceId, {
					displayName: enriched.displayName.trim(),
					roleKey: enriched.roleKey,
					customRoleTitle: enriched.customRoleTitle.trim() || undefined,
					managerEmployeeId: enriched.managerEmployeeId,
					createdByEmployeeId: undefined,
					templatePromptKey: enriched.templatePromptKey,
					customSystemPrompt: enriched.promptDraft.systemPrompt.trim() || undefined,
					nationalityCode: enriched.nationalityCode ?? null,
					personaSeed: toPersonaSeed(enriched, 'user'),
					modelSource: 'local_model',
				});
				onBindEmployeeLocalModel(created.id, enriched.localModelId);
			}
			setHireDrafts([]);
			setHireModalOpen(false);
			setHireModalExiting(false);
			await onRefreshOrg();
		} catch (error) {
			setHireErr(error instanceof Error ? error.message : String(error));
		} finally {
			setHireBusy(false);
		}
	};

	const detailTabs: { id: AiEmployeeDetailTab; label: string; icon: typeof IconDoc }[] = [
		{ id: 'instructions', label: t('aiEmployees.aiDetail.tabInstructions'), icon: IconDoc },
		{ id: 'skills', label: t('aiEmployees.aiDetail.tabSkills'), icon: IconBookOpen },
		{ id: 'tasks', label: t('aiEmployees.aiDetail.tabTasks'), icon: IconListTodo },
		{ id: 'settings', label: t('aiEmployees.aiDetail.tabSettings'), icon: IconSettings },
	];

	return (
		<div className="ref-ai-employees-panel ref-ai-employees-agents-shell">
			<div className="ref-ai-employees-agents-list" aria-label={t('aiEmployees.agentsListAria')}>
				<div className="ref-ai-employees-agents-list-toolbar">
					<h2 className="ref-ai-employees-agents-list-title">{t('aiEmployees.tab.team')}</h2>
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm" onClick={startAddMember}>
						{t('aiEmployees.role.manualHireAction')}
					</button>
				</div>
				<p className="ref-ai-employees-muted ref-ai-employees-agents-list-hint">{t('aiEmployees.orgBadgeGridHint')}</p>
				<div className="ref-ai-employees-agents-list-scroll">
					{sortedOrg.length === 0 ? (
						<p className="ref-ai-employees-muted ref-ai-employees-agents-list-zero">{t('aiEmployees.orgEmptyHint')}</p>
					) : (
						<ul className="ref-ai-employees-agents-roster">
							{sortedOrg.map((employee) => {
								const title = (employee.customRoleTitle || employee.roleKey).trim() || '—';
								const modelLine = employeeModelLine(employee);
								const isSel = employee.id === selectedId;
								return (
									<li key={employee.id}>
										<button
											type="button"
											className={`ref-ai-employees-agents-roster-row ${isSel ? 'is-active' : ''}`}
											onClick={() => {
												setSelectedId(employee.id);
												setDetailTab('instructions');
											}}
										>
											<span className="ref-ai-employees-agents-roster-face" aria-hidden>
												<EmployeeBadgeFace conn={conn} workspaceId={workspaceId} employee={employee} />
											</span>
											<span className="ref-ai-employees-agents-roster-meta">
												<span className="ref-ai-employees-agents-roster-name">
													{employee.displayName}
													{employee.isCeo ? (
														<span className="ref-ai-employees-agents-roster-chip">{t('aiEmployees.setup.roleLeadLabel')}</span>
													) : null}
												</span>
												<span className="ref-ai-employees-agents-roster-sub">{title}</span>
												<span className="ref-ai-employees-agents-roster-model" title={modelLine}>
													{modelLine}
												</span>
											</span>
											<EmployeeActivityStatusLabel
												t={t}
												activity={employeeActivityMap.get(employee.id) ?? { status: 'idle' }}
												className="ref-ai-employees-agents-roster-status"
											/>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>

			<div className="ref-ai-employees-agents-detail">
				{!selected || !selectedDraft ? (
					<div className="ref-ai-employees-agents-detail-empty">
						<IconBot className="ref-ai-employees-agents-detail-empty-icon" aria-hidden />
						<p className="ref-ai-employees-muted">{t('aiEmployees.aiDetail.pickMember')}</p>
					</div>
				) : (
					<>
						<div className="ref-ai-employees-agents-detail-head">
							<div className="ref-ai-employees-agents-detail-head-main">
								<div className="ref-ai-employees-agents-detail-avatar" aria-hidden>
									{avatarPreview ? (
										<img src={avatarPreview} alt="" className="ref-ai-employees-org-avatar-img" />
									) : (
										<div className="ref-ai-employees-org-avatar-ph">
											{selected.displayName.trim().slice(0, 1).toUpperCase() || '?'}
										</div>
									)}
								</div>
								<div className="ref-ai-employees-agents-detail-head-text">
									<h3 className="ref-ai-employees-agents-detail-name">{selected.displayName}</h3>
									<p className="ref-ai-employees-muted ref-ai-employees-agents-detail-roleline">
										{t('aiEmployees.orgRoleKey')}: {selected.roleKey}
										{' · '}
										<span title={employeeModelLine(selected)}>{employeeModelLine(selected)}</span>
									</p>
									<EmployeeActivityStatusLabel
										t={t}
										activity={employeeActivityMap.get(selected.id) ?? { status: 'idle' }}
										className="ref-ai-employees-agents-detail-activity"
									/>
								</div>
							</div>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm"
								disabled={saving || !selectedDraft.localModelId || !modelOptionIdSet.has(selectedDraft.localModelId)}
								onClick={() => void saveDetail()}
							>
								{t('aiEmployees.orgSaveProfile')}
							</button>
						</div>

						{saveErr ? <div className="ref-ai-employees-banner ref-ai-employees-banner--err ref-ai-employees-agents-detail-banner" role="alert">{saveErr}</div> : null}

						<div className="ref-ai-employees-agents-detail-tabs" role="tablist" aria-label={t('aiEmployees.aiDetail.tabsAria')}>
							{detailTabs.map((tab) => {
								const Icon = tab.icon;
								return (
									<button
										key={tab.id}
										type="button"
										role="tab"
										aria-selected={detailTab === tab.id}
										className={`ref-ai-employees-agents-detail-tab ${detailTab === tab.id ? 'is-active' : ''}`}
										onClick={() => setDetailTab(tab.id)}
									>
										<Icon className="ref-ai-employees-agents-detail-tab-icon" aria-hidden />
										{tab.label}
									</button>
								);
							})}
						</div>

						<div className="ref-ai-employees-agents-detail-body">
							{detailTab === 'instructions' ? (
								<div className="ref-ai-employees-agents-detail-pane">
									<RoleProfileEditor
										t={t}
										draft={selectedDraft}
										modelOptions={modelOptions}
										onChange={(patch) => setSelectedDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
										fieldGroup="personaPrompts"
									/>
									<RoleCustomSystemPromptField
										t={t}
										value={selectedDraft.promptDraft.systemPrompt}
										disabled={saving}
										onChange={(value) => setSelectedDraft((prev) => (prev ? { ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } } : prev))}
									/>
								</div>
							) : null}

							{detailTab === 'skills' ? (
								<div className="ref-ai-employees-agents-detail-pane">
									{skillsCatalog && onRefreshSkills ? (
										<EmployeeSkillsTab
											t={t}
											conn={conn}
											workspaceId={workspaceId}
											employee={selected}
											allSkills={skillsCatalog}
											onRefreshSkills={onRefreshSkills}
										/>
									) : (
										<p className="ref-ai-employees-muted">{t('aiEmployees.aiDetail.skillsPlaceholder')}</p>
									)}
								</div>
							) : null}

							{detailTab === 'tasks' ? (
								<div className="ref-ai-employees-agents-detail-pane ref-ai-employees-agents-task-pane">
									{openRunsForSelected.length === 0 ? (
										<p className="ref-ai-employees-muted">{t('aiEmployees.aiDetail.tasksEmpty')}</p>
									) : orchestration ? (
										<EmployeeRunOperationsFeed
											t={t}
											orchestration={orchestration}
											runs={openRunsForSelected}
											employeeMap={orgById}
											streamingSnippet={selectedId ? employeeChatStreaming?.[selectedId] : undefined}
											streamError={selectedId ? employeeChatError?.[selectedId] : undefined}
										/>
									) : (
										<p className="ref-ai-employees-muted">{t('aiEmployees.aiDetail.tasksEmpty')}</p>
									)}
								</div>
							) : null}

							{detailTab === 'settings' ? (
								<div className="ref-ai-employees-agents-detail-pane">
									<div className="ref-ai-employees-org-detail-head ref-ai-employees-agents-settings-avatar-block">
										<div className="ref-ai-employees-org-avatar-wrap">
											{avatarPreview ? (
												<img src={avatarPreview} alt="" className="ref-ai-employees-org-avatar-img" />
											) : (
												<div className="ref-ai-employees-org-avatar-ph" aria-hidden>
													{selected.displayName.trim().slice(0, 1).toUpperCase() || '?'}
												</div>
											)}
											<label className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-avatar-upload">
												<input type="file" accept="image/*" className="ref-ai-employees-sr-only" onChange={(ev) => void onAvatarPick(ev.target.files?.[0] ?? null)} />
												{t('aiEmployees.orgUploadAvatar')}
											</label>
										</div>
									</div>
									<label className="ref-ai-employees-catalog-field">
										<span>{t('aiEmployees.managerEmployee')}</span>
										<select
											className="ref-settings-native-select ref-ai-employees-workspace-select"
											value={selectedDraft.managerEmployeeId ?? ''}
											onChange={(e) => setSelectedDraft((prev) => (prev ? { ...prev, managerEmployeeId: e.target.value || undefined } : prev))}
										>
											<option value="">{t('aiEmployees.managerNone')}</option>
											{sortedOrg
												.filter((employee) => employee.id !== selected.id)
												.map((employee) => (
													<option key={employee.id} value={employee.id}>
														{employee.displayName}
													</option>
												))}
										</select>
									</label>
									<RoleProfileEditor
										t={t}
										draft={selectedDraft}
										modelOptions={modelOptions}
										onChange={(patch) => setSelectedDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
										fieldGroup="identityModel"
									/>
									<ImBindingsSection t={t} conn={conn} workspaceId={workspaceId} employeeId={selected.id} />
								</div>
							) : null}
						</div>
					</>
				)}
			</div>

			{(() => {
				const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
				if (!(hireModalOpen || hireModalExiting)) {
					return null;
				}
				const node = (
				<div
					className={`ref-ai-employees-org-modal-overlay ref-ai-employees-role-hire-modal-overlay${hireModalExiting ? ' ref-ai-employees-org-modal-overlay--exiting' : ''}`}
					role="presentation"
					onClick={() => beginCloseHireModal()}
					onAnimationEnd={onHireModalOverlayAnimationEnd}
				>
					<div
						className="ref-ai-employees-org-modal ref-ai-employees-role-hire-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ref-ai-employees-hire-modal-title"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="ref-ai-employees-org-modal-head">
							<h3 id="ref-ai-employees-hire-modal-title" className="ref-ai-employees-org-modal-title">
								{t('aiEmployees.role.manualHireAction')}
							</h3>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-modal-close"
								onClick={() => beginCloseHireModal()}
								aria-label={t('common.close')}
							>
								×
							</button>
						</div>
						<div
							ref={hireModalBodyRef}
							tabIndex={-1}
							className="ref-ai-employees-org-modal-body ref-ai-employees-role-hire-modal-body"
						>
							{hireErr ? <div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">{hireErr}</div> : null}
							<div className="ref-ai-employees-role-review-list">
								{hireDrafts.map((draft) => (
									<div key={draft.id} className={`ref-ai-employees-role-review-card ${draft.rejected ? 'is-rejected' : ''}`}>
										<div className="ref-ai-employees-role-review-head">
											<strong>{draft.displayName || draft.customRoleTitle || draft.roleKey}</strong>
											<div className="ref-ai-employees-form-actions">
												<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" onClick={() => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, rejected: !item.rejected } : item)))}>
													{draft.rejected ? t('aiEmployees.role.acceptCandidate') : t('aiEmployees.role.rejectCandidate')}
												</button>
												<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--danger" onClick={() => setHireDrafts((prev) => prev.filter((item) => item.id !== draft.id))}>
													{t('common.remove')}
												</button>
											</div>
										</div>
										<label className="ref-ai-employees-catalog-field">
											<span>{t('aiEmployees.managerEmployee')}</span>
											<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={draft.managerEmployeeId ?? ''} onChange={(e) => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, managerEmployeeId: e.target.value || undefined } : item)))}>
												<option value="">{t('aiEmployees.managerNone')}</option>
												{sortedOrg.map((employee) => (
													<option key={employee.id} value={employee.id}>{employee.displayName}</option>
												))}
											</select>
										</label>
										<RoleProfileEditor t={t} draft={draft} modelOptions={modelOptions} onChange={(patch) => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, ...patch } : item)))} />
										<RoleCustomSystemPromptField
											t={t}
											value={draft.promptDraft.systemPrompt}
											disabled={hireBusy}
											onChange={(value) => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, promptDraft: { ...item.promptDraft, systemPrompt: value } } : item)))}
										/>
									</div>
								))}
							</div>
						</div>
						<div className="ref-ai-employees-org-modal-footer">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => beginCloseHireModal()}>
								{t('common.cancel')}
							</button>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={() => void createHires()} disabled={hireBusy}>
								{t('aiEmployees.role.createSelectedRoles')}
							</button>
						</div>
					</div>
				</div>
				);
				return host ? createPortal(node, host) : node;
			})()}
		</div>
	);
}
