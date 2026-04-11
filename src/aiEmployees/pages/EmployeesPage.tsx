import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type AnimationEvent } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
import type { AiEmployeesConnection } from '../api/client';
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
import { formatEmployeeResolvedModelLabel } from '../adapters/modelAdapter';
import type { LocalModelEntry } from '../sessionTypes';
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
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
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
	orchestration?: import('../../../shared/aiEmployeesSettings').AiEmployeesOrchestrationState;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detailModalOpen, setDetailModalOpen] = useState(false);
	/** 为渐出动画保留挂载，直至 overlay 的 exit 动画结束 */
	const [detailModalExiting, setDetailModalExiting] = useState(false);
	const modalBodyRef = useRef<HTMLDivElement>(null);
	const [saveErr, setSaveErr] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectedDraft, setSelectedDraft] = useState<RoleProfileDraft | null>(null);
	const [hireDrafts, setHireDrafts] = useState<RoleProfileDraft[]>([]);
	const [hireModalOpen, setHireModalOpen] = useState(false);
	const [hireModalExiting, setHireModalExiting] = useState(false);
	const hireModalBodyRef = useRef<HTMLDivElement>(null);
	const [hireBusy, setHireBusy] = useState(false);
	const [hireErr, setHireErr] = useState<string | null>(null);
	const [detailPromptBusy, setDetailPromptBusy] = useState(false);
	const [hirePromptDraftId, setHirePromptDraftId] = useState<string | null>(null);
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

	// Derive per-employee status from orchestration runs
	const employeeStatusMap = useMemo(() => {
		const map = new Map<string, { status: 'idle' | 'working' | 'blocked' | 'waiting'; runGoal?: string }>();
		if (!orchestration) return map;
		for (const emp of sortedOrg) {
			const activeRun = orchestration.runs
				.filter((r) => r.currentAssigneeEmployeeId === emp.id || r.handoffs.some((h) => h.toEmployeeId === emp.id && h.status !== 'done'))
				.sort((a, b) => Date.parse(b.lastEventAtIso ?? b.createdAtIso) - Date.parse(a.lastEventAtIso ?? a.createdAtIso))[0];
			if (!activeRun) {
				map.set(emp.id, { status: 'idle' });
				continue;
			}
			const handoff = activeRun.handoffs.find((h) => h.toEmployeeId === emp.id && h.status !== 'done');
			if (handoff?.status === 'blocked') {
				map.set(emp.id, { status: 'blocked', runGoal: activeRun.goal });
			} else if (activeRun.status === 'awaiting_approval') {
				map.set(emp.id, { status: 'waiting', runGoal: activeRun.goal });
			} else {
				map.set(emp.id, { status: 'working', runGoal: activeRun.goal });
			}
		}
		return map;
	}, [orchestration, sortedOrg]);

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

	const beginCloseDetailModal = useCallback(() => {
		if (detailModalExiting) {
			return;
		}
		if (!detailModalOpen) {
			return;
		}
		if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			setDetailModalOpen(false);
			setDetailModalExiting(false);
			return;
		}
		setDetailModalOpen(false);
		setDetailModalExiting(true);
	}, [detailModalOpen, detailModalExiting]);

	const onDetailModalOverlayAnimationEnd = useCallback((e: AnimationEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget) {
			return;
		}
		if (e.animationName !== 'ref-ai-employees-org-modal-overlay-out') {
			return;
		}
		setDetailModalExiting(false);
	}, []);

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
		if (selectedId && !sortedOrg.some((employee) => employee.id === selectedId)) {
			setSelectedId(null);
			setDetailModalOpen(false);
			setDetailModalExiting(false);
		}
	}, [selectedId, sortedOrg]);

	useEffect(() => {
		if (!detailModalOpen && !detailModalExiting) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				beginCloseDetailModal();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [detailModalOpen, detailModalExiting, beginCloseDetailModal]);

	useEffect(() => {
		if (detailModalOpen && !detailModalExiting) {
			modalBodyRef.current?.focus();
		}
	}, [detailModalOpen, detailModalExiting, selectedId]);

	useEffect(() => {
		if (!detailModalExiting) {
			return;
		}
		const id = window.setTimeout(() => setDetailModalExiting(false), 500);
		return () => window.clearTimeout(id);
	}, [detailModalExiting]);

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

	const invokeRolePromptGenerator = async (draft: RoleProfileDraft) => {
		if (!window.asyncShell) {
			throw new Error('async shell unavailable');
		}
		if (!draft.localModelId || !modelOptionIdSet.has(draft.localModelId)) {
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
			collaborationRules: draft.promptDraft.collaborationRules,
			handoffRules: draft.promptDraft.handoffRules,
			companyName: effectiveCompanyName,
			managerSummary: managerSummaryLine,
		};
		const result = (await window.asyncShell.invoke('aiEmployees:generateRolePrompt', payload)) as
			| { ok: true; draft: RolePromptDraft }
			| { ok: false; error?: string };
		if (!result.ok) {
			throw new Error(result.error || 'generate prompt failed');
		}
		return result.draft;
	};

	const generateSelectedPrompt = async () => {
		if (!selectedDraft) {
			return;
		}
		setDetailPromptBusy(true);
		setSaveErr(null);
		try {
			const promptDraft = await invokeRolePromptGenerator(selectedDraft);
			setSelectedDraft((prev) => (prev ? applyGeneratedPromptDraft(prev, promptDraft) : prev));
		} catch (error) {
			setSaveErr(error instanceof Error ? error.message : String(error));
		} finally {
			setDetailPromptBusy(false);
		}
	};

	const generateHirePrompt = async (draftId: string) => {
		const draft = hireDrafts.find((item) => item.id === draftId);
		if (!draft) {
			return;
		}
		setHirePromptDraftId(draftId);
		setHireErr(null);
		try {
			const promptDraft = await invokeRolePromptGenerator(draft);
			setHireDrafts((prev) => prev.map((item) => (item.id === draftId ? applyGeneratedPromptDraft(item, promptDraft) : item)));
		} catch (error) {
			setHireErr(error instanceof Error ? error.message : String(error));
		} finally {
			setHirePromptDraftId(null);
		}
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

	return (
		<div className="ref-ai-employees-panel ref-ai-employees-org-layout">
			<div className="ref-ai-employees-form-actions ref-ai-employees-org-top-actions">
				<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={startAddMember}>
					{t('aiEmployees.role.manualHireAction')}
				</button>
			</div>

			<div className="ref-ai-employees-org-team-block">
				<p className="ref-ai-employees-muted ref-ai-employees-org-team-hint">{t('aiEmployees.orgBadgeGridHint')}</p>
				{sortedOrg.length === 0 ? (
					<p className="ref-ai-employees-muted">{t('aiEmployees.orgEmptyHint')}</p>
				) : (
					<div className="ref-ai-employees-org-badge-grid" role="list">
						{sortedOrg.map((employee) => {
							const title = (employee.customRoleTitle || employee.roleKey).trim() || '—';
							const modelLine = employeeModelLine(employee);
							const isActive = (detailModalOpen || detailModalExiting) && selectedId === employee.id;
							return (
								<button
									key={employee.id}
									type="button"
									role="listitem"
									className={`ref-ai-employees-org-badge-card ${isActive ? 'is-active' : ''}`}
									onClick={() => {
										setSelectedId(employee.id);
										setDetailModalExiting(false);
										setDetailModalOpen(true);
									}}
								>
									<div className="ref-ai-employees-org-badge-lanyard" aria-hidden />
									<div className="ref-ai-employees-org-badge-card-inner">
										<div className="ref-ai-employees-org-badge-face">
											<EmployeeBadgeFace conn={conn} workspaceId={workspaceId} employee={employee} />
										</div>
										<div className="ref-ai-employees-org-badge-text">
											<span className="ref-ai-employees-org-badge-name">{employee.displayName}</span>
											<span className="ref-ai-employees-org-badge-title">{title}</span>
											<span className="ref-ai-employees-org-badge-model" title={modelLine}>
												{modelLine}
											</span>
											{(() => {
												const empStatus = employeeStatusMap.get(employee.id);
												if (empStatus && empStatus.status !== 'idle') {
													const dotColor = empStatus.status === 'working'
														? 'color-mix(in srgb, var(--void-accent-cool) 70%, var(--void-fg-0))'
														: empStatus.status === 'blocked'
															? '#f85149'
															: '#d29922';
													return (
														<span
															className="ref-ai-employees-org-badge-title"
															style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}
															title={empStatus.runGoal}
														>
															<span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
															{empStatus.runGoal ? (empStatus.runGoal.length > 24 ? `${empStatus.runGoal.slice(0, 24)}…` : empStatus.runGoal) : empStatus.status}
														</span>
													);
												}
												return null;
											})()}
											{employee.isCeo ? <span className="ref-ai-employees-org-badge-chip">{t('aiEmployees.setup.roleLeadLabel')}</span> : null}
										</div>
									</div>
								</button>
							);
						})}
					</div>
				)}
			</div>

			{(() => {
				const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
				if (!(detailModalOpen || detailModalExiting) || !selected || !selectedDraft) {
					return null;
				}
				const node = (
				<div
					className={`ref-ai-employees-org-modal-overlay${detailModalExiting ? ' ref-ai-employees-org-modal-overlay--exiting' : ''}`}
					role="presentation"
					onClick={() => beginCloseDetailModal()}
					onAnimationEnd={onDetailModalOverlayAnimationEnd}
				>
					<div
						className="ref-ai-employees-org-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ref-ai-employees-org-modal-title"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="ref-ai-employees-org-modal-head">
							<h3 id="ref-ai-employees-org-modal-title" className="ref-ai-employees-org-modal-title">
								{t('aiEmployees.orgDetailModalTitle')}
							</h3>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-modal-close"
								onClick={() => beginCloseDetailModal()}
								aria-label={t('common.close')}
							>
								×
							</button>
						</div>
						<div
							ref={modalBodyRef}
							tabIndex={-1}
							className="ref-ai-employees-org-modal-body"
						>
							<div className="ref-ai-employees-org-detail-head">
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
								<div className="ref-ai-employees-org-detail-title">
									<h3>{selected.displayName}</h3>
									<p className="ref-ai-employees-muted">{t('aiEmployees.orgRoleKey')}: {selected.roleKey}</p>
									<p className="ref-ai-employees-org-detail-model" title={employeeModelLine(selected)}>
										{employeeModelLine(selected)}
									</p>
								</div>
							</div>

							{saveErr ? <div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">{saveErr}</div> : null}

							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.managerEmployee')}</span>
								<select className="ref-settings-native-select ref-ai-employees-workspace-select" value={selectedDraft.managerEmployeeId ?? ''} onChange={(e) => setSelectedDraft((prev) => (prev ? { ...prev, managerEmployeeId: e.target.value || undefined } : prev))}>
									<option value="">{t('aiEmployees.managerNone')}</option>
									{sortedOrg.filter((employee) => employee.id !== selected.id).map((employee) => (
										<option key={employee.id} value={employee.id}>{employee.displayName}</option>
									))}
								</select>
							</label>
							<RoleProfileEditor t={t} draft={selectedDraft} modelOptions={modelOptions} onChange={(patch) => setSelectedDraft((prev) => (prev ? { ...prev, ...patch } : prev))} />
							<RoleCustomSystemPromptField
								t={t}
								value={selectedDraft.promptDraft.systemPrompt}
								disabled={saving}
								generating={detailPromptBusy}
								generateDisabled={!selectedDraft.localModelId || !modelOptionIdSet.has(selectedDraft.localModelId)}
								onGenerate={() => void generateSelectedPrompt()}
								onRestore={() =>
									setSelectedDraft((prev) => (prev ? { ...prev, promptDraft: prev.lastGeneratedPromptDraft ?? prev.promptDraft } : prev))
								}
								canRestore={Boolean(selectedDraft.lastGeneratedPromptDraft)}
								onChange={(value) => setSelectedDraft((prev) => (prev ? { ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } } : prev))}
							/>
							<ImBindingsSection t={t} conn={conn} workspaceId={workspaceId} employeeId={selected.id} />
						</div>
						<div className="ref-ai-employees-org-modal-footer">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => beginCloseDetailModal()}>
								{t('common.close')}
							</button>
							<button
								type="button"
								className="ref-ai-employees-btn ref-ai-employees-btn--primary"
								disabled={saving || !selectedDraft.localModelId || !modelOptionIdSet.has(selectedDraft.localModelId)}
								onClick={() => void saveDetail()}
							>
								{t('aiEmployees.orgSaveProfile')}
							</button>
						</div>
					</div>
				</div>
				);
				return host ? createPortal(node, host) : node;
			})()}

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
											generating={hirePromptDraftId === draft.id}
											generateDisabled={!draft.localModelId || !modelOptionIdSet.has(draft.localModelId)}
											onGenerate={() => {
												if (draft.id) {
													void generateHirePrompt(draft.id);
												}
											}}
											onRestore={() =>
												setHireDrafts((prev) =>
													prev.map((item) =>
														item.id === draft.id ? { ...item, promptDraft: item.lastGeneratedPromptDraft ?? item.promptDraft } : item
													)
												)
											}
											canRestore={Boolean(draft.lastGeneratedPromptDraft)}
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
