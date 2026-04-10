import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeeCatalogEntry } from '../../../shared/aiEmployeesSettings';
import type { AiEmployeesConnection } from '../api/client';
import type { AgentJson } from '../api/types';
import {
	apiCreateOrgEmployee,
	apiListPromptTemplates,
	apiPatchOrgEmployee,
	apiUploadOrgEmployeeAvatar,
	orgEmployeeAvatarSrc,
} from '../api/orgClient';
import type { OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import { chatBridgeLabel } from '../adapters/chatBridge';
import { resolveEmployeeLocalModelId } from '../adapters/modelAdapter';
import { RoleProfileEditor, RolePromptReview } from '../components/RoleProfileEditor';
import { MbtiAvatar } from '../domain/mbtiVisuals';
import { emptyPromptDraft } from '../domain/persona';
import {
	applyGeneratedPromptDraft,
	createEmptyRoleProfileDraft,
	createRoleDraftFromHiringCandidate,
	createRoleDraftFromOrgEmployee,
	toPersonaSeed,
	type RoleProfileDraft,
} from '../domain/roleDraft';
import type { HiringPlanGeneratorInput, RolePromptDraft, RolePromptGeneratorInput } from '../../../shared/aiEmployeesPersona';

function useAuthedAvatarPreview(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string | null,
	enabled: boolean
): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!enabled || !employeeId || !workspaceId) {
			setUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return null;
			});
			return;
		}
		let blobUrl: string | null = null;
		let cancelled = false;
		void (async () => {
			try {
				const r = await fetch(orgEmployeeAvatarSrc(conn, employeeId), {
					headers: {
						Authorization: `Bearer ${conn.token.trim()}`,
						'X-Workspace-ID': workspaceId,
					},
				});
				if (!r.ok || cancelled) {
					return;
				}
				const b = await r.blob();
				blobUrl = URL.createObjectURL(b);
				if (!cancelled) {
					setUrl(blobUrl);
				}
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancelled = true;
			if (blobUrl) {
				URL.revokeObjectURL(blobUrl);
			}
		};
	}, [conn, employeeId, enabled, workspaceId]);
	return url;
}

function promptDraftFromTemplate(template: OrgPromptTemplate | undefined): RolePromptDraft {
	return {
		systemPrompt: template?.systemPrompt ?? '',
		roleSummary: '',
		speakingStyle: '',
		collaborationRules: '',
		handoffRules: '',
	};
}

export function EmployeesPage({
	t,
	conn,
	workspaceId,
	companyName,
	agents,
	orgEmployees,
	onRefreshOrg,
	employeeCatalog,
	agentLocalModelMap,
	employeeLocalModelMap,
	modelOptions,
	modelOptionIdSet,
	defaultModelId,
	onUpsertCatalogEntry,
	onRemoveCatalogEntry,
	onBindModel,
	onClearModelBinding,
	onBindEmployeeLocalModel,
	onClearEmployeeLocalModel,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	companyName: string;
	agents: AgentJson[];
	orgEmployees: OrgEmployee[];
	onRefreshOrg: () => void | Promise<void>;
	employeeCatalog: AiEmployeeCatalogEntry[];
	agentLocalModelMap: Record<string, string> | undefined;
	employeeLocalModelMap: Record<string, string> | undefined;
	modelOptions: { id: string; displayName: string }[];
	modelOptionIdSet: Set<string>;
	defaultModelId: string | undefined;
	onUpsertCatalogEntry: (e: AiEmployeeCatalogEntry) => void;
	onRemoveCatalogEntry: (id: string) => void;
	onBindModel: (agentId: string, modelEntryId: string) => void;
	onClearModelBinding: (agentId: string) => void;
	onBindEmployeeLocalModel: (employeeId: string, modelEntryId: string) => void;
	onClearEmployeeLocalModel: (employeeId: string) => void;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [tplList, setTplList] = useState<OrgPromptTemplate[]>([]);
	const [saveErr, setSaveErr] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectedDraft, setSelectedDraft] = useState<RoleProfileDraft | null>(null);
	const [detailPromptBusy, setDetailPromptBusy] = useState(false);
	const [hireDrafts, setHireDrafts] = useState<RoleProfileDraft[]>([]);
	const [hireMode, setHireMode] = useState<'manual' | 'ceo' | null>(null);
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

	const selected = sortedOrg.find((employee) => employee.id === selectedId) ?? sortedOrg[0] ?? null;
	const ceoEmployee = sortedOrg.find((employee) => employee.isCeo) ?? null;

	useEffect(() => {
		if (selected && !sortedOrg.some((employee) => employee.id === selected.id)) {
			setSelectedId(sortedOrg[0]?.id ?? null);
		} else if (!selectedId && sortedOrg[0]) {
			setSelectedId(sortedOrg[0].id);
		}
	}, [selected, selectedId, sortedOrg]);

	useEffect(() => {
		if (!workspaceId) {
			return;
		}
		void onRefreshOrg();
	}, [workspaceId, onRefreshOrg]);

	useEffect(() => {
		if (!workspaceId) {
			return;
		}
		void (async () => {
			try {
				setTplList(await apiListPromptTemplates(conn, workspaceId));
			} catch {
				setTplList([]);
			}
		})();
	}, [conn, workspaceId]);

	useEffect(() => {
		if (!selected) {
			setSelectedDraft(null);
			return;
		}
		const localModelId = resolveEmployeeLocalModelId({
			employeeId: selected.id,
			remoteAgentId: selected.linkedRemoteAgentId ?? undefined,
			agentLocalModelMap,
			employeeLocalModelMap,
			defaultModelId,
			modelOptionIds: modelOptionIdSet,
		});
		setSelectedDraft(createRoleDraftFromOrgEmployee(selected, localModelId));
		setSaveErr(null);
	}, [selected, agentLocalModelMap, employeeLocalModelMap, defaultModelId, modelOptionIdSet]);

	const avatarPreview = useAuthedAvatarPreview(conn, workspaceId, selected?.id ?? null, Boolean(selected?.avatarAssetId));

	const entryForAgent = useCallback(
		(agentId: string) => employeeCatalog.find((entry) => entry.linkedRemoteAgentId === agentId),
		[employeeCatalog]
	);

	const promoteAgentRow = (agent: AgentJson) => {
		const hit = entryForAgent(agent.id);
		if (hit) {
			return hit;
		}
		const id = crypto.randomUUID();
		const next: AiEmployeeCatalogEntry = {
			id,
			displayName: agent.name,
			role: '',
			modelSource: 'hybrid',
			linkedRemoteAgentId: agent.id,
		};
		onUpsertCatalogEntry(next);
		return next;
	};

	const invokeRolePromptGenerator = async (draft: RoleProfileDraft, companyName: string) => {
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
			mbtiType: draft.mbtiType ?? null,
			jobMission: draft.jobMission,
			domainContext: draft.domainContext,
			communicationNotes: draft.communicationNotes,
			companyName,
			managerSummary: ceoEmployee ? `${ceoEmployee.displayName} / ${ceoEmployee.customRoleTitle || ceoEmployee.roleKey}` : '',
		};
		const result = (await window.asyncShell.invoke('aiEmployees:generateRolePrompt', payload)) as
			| { ok: true; draft: RolePromptDraft }
			| { ok: false; error?: string };
		if (!result.ok) {
			throw new Error(result.error || 'generate prompt failed');
		}
		return result.draft;
	};

	const saveDetail = async () => {
		if (!selected || !selectedDraft || !workspaceId) {
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
				modelSource: selectedDraft.modelSource,
				managerEmployeeId: selectedDraft.managerEmployeeId?.trim() || undefined,
				clearManager: !selectedDraft.managerEmployeeId?.trim(),
				nationalityCode: selectedDraft.nationalityCode ?? null,
				clearNationalityCode: !selectedDraft.nationalityCode,
				mbtiType: selectedDraft.mbtiType ?? null,
				clearMbtiType: !selectedDraft.mbtiType,
				personaSeed: toPersonaSeed(selectedDraft, selected.createdByEmployeeId ? 'ceo' : 'user'),
				clearPersonaSeed: false,
			});
			if (selectedDraft.localModelId) {
				onBindEmployeeLocalModel(selected.id, selectedDraft.localModelId);
			} else {
				onClearEmployeeLocalModel(selected.id);
			}
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

	const generateSelectedPrompt = async () => {
		if (!selectedDraft) {
			return;
		}
		setDetailPromptBusy(true);
		setSaveErr(null);
		try {
			const promptDraft = await invokeRolePromptGenerator(selectedDraft, effectiveCompanyName);
			setSelectedDraft((prev) => (prev ? applyGeneratedPromptDraft(prev, promptDraft) : prev));
		} catch (error) {
			setSaveErr(error instanceof Error ? error.message : String(error));
		} finally {
			setDetailPromptBusy(false);
		}
	};

	const startManualHire = () => {
		setHireMode('manual');
		setHireErr(null);
		setHireDrafts([
			createEmptyRoleProfileDraft({
				id: crypto.randomUUID(),
				roleKey: 'custom',
				customRoleTitle: 'New Role',
				managerEmployeeId: ceoEmployee?.id,
				localModelId: modelOptions[0]?.id ?? '',
				promptDraft: emptyPromptDraft(),
			}),
		]);
	};

	const startCeoHire = async () => {
		if (!window.asyncShell) {
			setHireErr('async shell unavailable');
			return;
		}
		if (!ceoEmployee) {
			setHireErr(t('aiEmployees.role.ceoRequired'));
			return;
		}
		const ceoLocalModelId = resolveEmployeeLocalModelId({
			employeeId: ceoEmployee.id,
			remoteAgentId: ceoEmployee.linkedRemoteAgentId ?? undefined,
			agentLocalModelMap,
			employeeLocalModelMap,
			defaultModelId,
			modelOptionIds: modelOptionIdSet,
		});
		if (!ceoLocalModelId) {
			setHireErr(t('aiEmployees.role.modelRequired'));
			return;
		}
		setHireMode('ceo');
		setHireBusy(true);
		setHireErr(null);
		try {
			const payload: HiringPlanGeneratorInput = {
				modelId: ceoLocalModelId,
				companyName: effectiveCompanyName,
				ceoDisplayName: ceoEmployee.displayName,
				ceoPersonaSeed: ceoEmployee.personaSeed ?? undefined,
				ceoSystemPrompt: ceoEmployee.customSystemPrompt ?? '',
				currentEmployees: sortedOrg.map((employee) => ({
					id: employee.id,
					displayName: employee.displayName,
					roleKey: employee.roleKey,
					customRoleTitle: employee.customRoleTitle,
					isCeo: employee.isCeo,
					mbtiType: employee.mbtiType,
					nationalityCode: employee.nationalityCode,
				})),
			};
			const result = (await window.asyncShell.invoke('aiEmployees:generateHiringPlan', payload)) as
				| { ok: true; candidates: import('../../../shared/aiEmployeesPersona').HiringPlanCandidate[] }
				| { ok: false; error?: string };
			if (!result.ok) {
				throw new Error(result.error || 'generate hiring plan failed');
			}
			setHireDrafts(result.candidates.map((candidate) => createRoleDraftFromHiringCandidate(candidate)));
		} catch (error) {
			setHireErr(error instanceof Error ? error.message : String(error));
		} finally {
			setHireBusy(false);
		}
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
		setHireBusy(true);
		setHireErr(null);
		try {
			for (const draft of accepted) {
				const created = await apiCreateOrgEmployee(conn, workspaceId, {
					displayName: draft.displayName.trim(),
					roleKey: draft.roleKey,
					customRoleTitle: draft.customRoleTitle.trim() || undefined,
					managerEmployeeId: draft.managerEmployeeId,
					createdByEmployeeId: hireMode === 'ceo' ? ceoEmployee?.id : undefined,
					templatePromptKey: draft.templatePromptKey,
					customSystemPrompt: draft.promptDraft.systemPrompt.trim() || undefined,
					nationalityCode: draft.nationalityCode ?? null,
					mbtiType: draft.mbtiType ?? null,
					personaSeed: toPersonaSeed(draft, hireMode === 'ceo' ? 'ceo' : 'user'),
					modelSource: draft.modelSource,
				});
				if (draft.localModelId) {
					onBindEmployeeLocalModel(created.id, draft.localModelId);
				}
			}
			setHireDrafts([]);
			setHireMode(null);
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
				<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={startManualHire}>
					{t('aiEmployees.role.manualHireAction')}
				</button>
				<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => void startCeoHire()} disabled={hireBusy || !ceoEmployee}>
					{t('aiEmployees.role.ceoHireAction')}
				</button>
			</div>

			{hireMode ? (
				<div className="ref-ai-employees-panel ref-ai-employees-role-hire-panel">
					<div className="ref-ai-employees-role-review-head">
						<strong>{hireMode === 'ceo' ? t('aiEmployees.role.teamReviewTitle') : t('aiEmployees.role.manualHireAction')}</strong>
						<div className="ref-ai-employees-form-actions">
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" onClick={() => { setHireMode(null); setHireDrafts([]); }}>
								{t('common.cancel')}
							</button>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={() => void createHires()} disabled={hireBusy}>
								{t('aiEmployees.role.createSelectedRoles')}
							</button>
						</div>
					</div>
					{hireErr ? <div className="ref-ai-employees-banner ref-ai-employees-banner--err">{hireErr}</div> : null}
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
									<select className="ref-ai-employees-workspace-select" value={draft.managerEmployeeId ?? ''} onChange={(e) => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, managerEmployeeId: e.target.value || undefined } : item)))}>
										<option value="">{t('aiEmployees.managerNone')}</option>
										{sortedOrg.map((employee) => (
											<option key={employee.id} value={employee.id}>{employee.displayName}</option>
										))}
									</select>
								</label>
								<RoleProfileEditor t={t} draft={draft} modelOptions={modelOptions} onChange={(patch) => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, ...patch } : item)))} />
								<RolePromptReview
									t={t}
									draft={draft}
									generating={hireBusy}
									error={null}
									onPromptChange={(value) => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, promptDraft: { ...item.promptDraft, systemPrompt: value } } : item)))}
									onGenerate={async () => {
										setHireBusy(true);
										try {
											const promptDraft = await invokeRolePromptGenerator(draft, effectiveCompanyName);
											setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? applyGeneratedPromptDraft(item, promptDraft) : item)));
										} catch (error) {
											setHireErr(error instanceof Error ? error.message : String(error));
										} finally {
											setHireBusy(false);
										}
									}}
									onRestore={() => setHireDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, promptDraft: item.lastGeneratedPromptDraft ?? item.promptDraft } : item)))}
								/>
							</div>
						))}
					</div>
				</div>
			) : null}

			<div className="ref-ai-employees-org-split">
				<div className="ref-ai-employees-org-list-pane">
					<p className="ref-ai-employees-muted">{t('aiEmployees.orgDirectoryHint')}</p>
					<ul className="ref-ai-employees-org-member-list">
						{sortedOrg.map((employee) => (
							<li key={employee.id}>
								<button type="button" className={`ref-ai-employees-org-member-btn ${selected?.id === employee.id ? 'is-active' : ''}`} onClick={() => setSelectedId(employee.id)}>
									<span className="ref-ai-employees-org-member-name">{employee.displayName}</span>
									{employee.isCeo ? <span className="ref-ai-employees-pill">{t('aiEmployees.orgCeoBadge')}</span> : null}
									<span className="ref-ai-employees-muted">{employee.customRoleTitle || employee.roleKey}</span>
								</button>
							</li>
						))}
					</ul>
				</div>

				<div className="ref-ai-employees-org-detail-pane">
					{selected && selectedDraft ? (
						<>
							<div className="ref-ai-employees-org-detail-head">
								<div className="ref-ai-employees-org-avatar-wrap">
									{avatarPreview ? (
										<img src={avatarPreview} alt="" className="ref-ai-employees-org-avatar-img" />
									) : (
										<MbtiAvatar mbtiType={selected.mbtiType} size={88} />
									)}
									<label className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-org-avatar-upload">
										<input type="file" accept="image/*" className="ref-ai-employees-sr-only" onChange={(ev) => void onAvatarPick(ev.target.files?.[0] ?? null)} />
										{t('aiEmployees.orgUploadAvatar')}
									</label>
								</div>
								<div className="ref-ai-employees-org-detail-title">
									<h3>{selected.displayName}</h3>
									<p className="ref-ai-employees-muted">{t('aiEmployees.orgRoleKey')}: {selected.roleKey}</p>
								</div>
							</div>

							{saveErr ? <div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">{saveErr}</div> : null}

							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.orgTemplatePrompt')}</span>
								<select className="ref-ai-employees-workspace-select" value={selectedDraft.templatePromptKey ?? ''} onChange={(e) => setSelectedDraft((prev) => (prev ? { ...prev, templatePromptKey: e.target.value || undefined, promptDraft: prev.promptDraft.systemPrompt ? prev.promptDraft : promptDraftFromTemplate(tplList.find((tpl) => tpl.key === e.target.value)) } : prev))}>
									<option value="">{t('aiEmployees.orgTemplateNone')}</option>
									{tplList.map((tpl) => <option key={tpl.key} value={tpl.key}>{tpl.title}</option>)}
								</select>
							</label>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.managerEmployee')}</span>
								<select className="ref-ai-employees-workspace-select" value={selectedDraft.managerEmployeeId ?? ''} onChange={(e) => setSelectedDraft((prev) => (prev ? { ...prev, managerEmployeeId: e.target.value || undefined } : prev))}>
									<option value="">{t('aiEmployees.managerNone')}</option>
									{sortedOrg.filter((employee) => employee.id !== selected.id).map((employee) => (
										<option key={employee.id} value={employee.id}>{employee.displayName}</option>
									))}
								</select>
							</label>
							<RoleProfileEditor t={t} draft={selectedDraft} modelOptions={modelOptions} onChange={(patch) => setSelectedDraft((prev) => (prev ? { ...prev, ...patch } : prev))} />
							<RolePromptReview
								t={t}
								draft={selectedDraft}
								generating={detailPromptBusy}
								error={saveErr}
								onPromptChange={(value) => setSelectedDraft((prev) => (prev ? { ...prev, promptDraft: { ...prev.promptDraft, systemPrompt: value } } : prev))}
								onGenerate={() => void generateSelectedPrompt()}
								onRestore={() => setSelectedDraft((prev) => (prev ? { ...prev, promptDraft: prev.lastGeneratedPromptDraft ?? prev.promptDraft } : prev))}
							/>
							<label className="ref-ai-employees-catalog-field">
								<span>{t('aiEmployees.orgLinkAgent')}</span>
								<select className="ref-ai-employees-workspace-select" value={selected.linkedRemoteAgentId ?? ''} onChange={(e) => {
									const value = e.target.value;
									void (async () => {
										setSaving(true);
										setSaveErr(null);
										try {
											await apiPatchOrgEmployee(conn, workspaceId, selected.id, { linkedRemoteAgentId: value || undefined, clearLinkedRemoteAgent: !value });
											await onRefreshOrg();
										} catch (error) {
											setSaveErr(error instanceof Error ? error.message : String(error));
										} finally {
											setSaving(false);
										}
									})();
								}}>
									<option value="">{t('aiEmployees.orgNoAgent')}</option>
									{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
								</select>
							</label>
							<div className="ref-ai-employees-form-actions">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={saving} onClick={() => void saveDetail()}>{t('aiEmployees.orgSaveProfile')}</button>
							</div>
						</>
					) : (
						<p className="ref-ai-employees-muted">{t('aiEmployees.orgEmptyHint')}</p>
					)}
				</div>
			</div>

			<hr className="ref-ai-employees-org-divider" />

			<h4 className="ref-ai-employees-org-section-title">{t('aiEmployees.orgAgentBridgeTitle')}</h4>
			<p className="ref-ai-employees-muted">{t('aiEmployees.orgAgentBridgeHint')}</p>
			<ul className="ref-ai-employees-list ref-ai-employees-list--agents">
				{agents.map((agent) => {
					const catalogEntry = entryForAgent(agent.id);
					const boundId = agentLocalModelMap?.[agent.id];
					const selectValue =
						boundId && modelOptionIdSet.has(boundId)
							? boundId
							: defaultModelId && modelOptionIdSet.has(defaultModelId)
								? defaultModelId
								: '';
					const row = catalogEntry ?? null;
					return (
						<li key={agent.id} className="ref-ai-employees-agent-row ref-ai-employees-agent-row--catalog">
							<div className="ref-ai-employees-agent-row-main">
								<strong>{agent.name}</strong>
								<span className="ref-ai-employees-muted">{agent.status ?? '—'}</span>
							</div>
							{!row ? (
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" onClick={() => promoteAgentRow(agent)}>
									{t('aiEmployees.addToCatalog')}
								</button>
							) : (
								<div className="ref-ai-employees-catalog-fields">
									<label className="ref-ai-employees-catalog-field">
										<span>{t('aiEmployees.employeeDisplayName')}</span>
										<input className="ref-ai-employees-input" value={row.displayName} onChange={(e) => onUpsertCatalogEntry({ ...row, displayName: e.target.value })} />
									</label>
									<label className="ref-ai-employees-catalog-field">
										<span>{t('aiEmployees.employeeRole')}</span>
										<input className="ref-ai-employees-input" value={row.role} onChange={(e) => onUpsertCatalogEntry({ ...row, role: e.target.value })} />
									</label>
									<label className="ref-ai-employees-catalog-field">
										<span>{t('aiEmployees.modelSource')}</span>
										<select className="ref-ai-employees-workspace-select" value={row.modelSource} onChange={(e) => onUpsertCatalogEntry({ ...row, modelSource: e.target.value as AiEmployeeCatalogEntry['modelSource'] })}>
											<option value="local_model">{t('aiEmployees.modelSource.local')}</option>
											<option value="remote_runtime">{t('aiEmployees.modelSource.remote')}</option>
											<option value="hybrid">{t('aiEmployees.modelSource.hybrid')}</option>
										</select>
									</label>
									<label className="ref-ai-employees-catalog-field">
										<span>{t('aiEmployees.managerEmployee')}</span>
										<select className="ref-ai-employees-workspace-select" value={row.managerEmployeeId ?? ''} onChange={(e) => onUpsertCatalogEntry({ ...row, managerEmployeeId: e.target.value || undefined })}>
											<option value="">{t('aiEmployees.managerNone')}</option>
											{employeeCatalog.filter((entry) => entry.id !== row.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName || entry.id.slice(0, 8)}</option>)}
										</select>
									</label>
									<div className="ref-ai-employees-chat-accounts">
										<div className="ref-ai-employees-muted">{t('aiEmployees.chatAccounts')}</div>
										<ul>
											{(row.chatAccounts ?? []).map((account, index) => <li key={index}>{chatBridgeLabel(account)}</li>)}
										</ul>
									</div>
									<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--danger" onClick={() => onRemoveCatalogEntry(row.id)}>
										{t('aiEmployees.removeFromCatalog')}
									</button>
									<div className="ref-ai-employees-agent-row-model">
										<span className="ref-ai-employees-agent-model-label">{t('aiEmployees.localModelLabel')}</span>
										{modelOptions.length === 0 ? (
											<span className="ref-ai-employees-muted">{t('aiEmployees.localModelMissingHint')}</span>
										) : (
											<select className="ref-ai-employees-workspace-select ref-ai-employees-model-select" value={selectValue} aria-label={t('aiEmployees.localModelPick')} onChange={(e) => {
												const value = e.target.value;
												if (!value) {
													onClearModelBinding(agent.id);
													return;
												}
													 onBindModel(agent.id, value);
											}}>
												<option value="">{t('aiEmployees.localModelUseDefault')}</option>
												{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
											</select>
										)}
									</div>
								</div>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
