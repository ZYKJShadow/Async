import { useMemo, useState } from 'react';
import type { TeamExpertConfig, TeamPresetId, TeamRoleType, TeamSettings } from './agentSettingsTypes';
import type { UserModelEntry, UserLlmProvider } from './modelCatalog';
import { providerDisplayLabel } from './modelCatalog';
import { useI18n } from './i18n';
import {
	TEAM_PRESET_LIBRARY,
	buildTeamPresetExperts,
	getTeamPreset,
	getTeamPresetDefaults,
	mergeTeamPresetSavedRows,
} from './teamPresetCatalog';
import { VoidSelect } from './VoidSelect';

type Props = {
	value: TeamSettings;
	onChange: (next: TeamSettings) => void;
	modelEntries: UserModelEntry[];
	modelProviders?: UserLlmProvider[];
};

const ROLE_IDS: TeamRoleType[] = ['team_lead', 'frontend', 'backend', 'qa', 'reviewer', 'custom'];

function newRole(): TeamExpertConfig {
	const id =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `team-${Date.now()}`;
	return {
		id,
		name: '',
		roleType: 'custom',
		assignmentKey: `specialist_${Date.now()}`,
		systemPrompt: 'You are a specialist engineer. Complete assigned tasks with clear output.',
		enabled: true,
		allowedTools: [],
	};
}

export function SettingsTeamPanel({ value, onChange, modelEntries, modelProviders = [] }: Props) {
	const { t } = useI18n();
	const experts = value.experts ?? [];
	const roleList = experts.length > 0 ? experts : buildTeamPresetExperts(value.presetId);
	const currentPreset = getTeamPreset(value.presetId);
	const presetDefaults = getTeamPresetDefaults(value.presetId);

	const [editingRole, setEditingRole] = useState<TeamExpertConfig | null>(null);

	const restoreDefaults = () => {
		onChange({
			useDefaults: true,
			presetId: 'engineering',
			experts: [],
			presetExpertSnapshots: undefined,
			...getTeamPresetDefaults('engineering'),
		});
	};
	const applyPreset = (nextPresetId: TeamPresetId) => {
		const currentPresetId = (value.presetId ?? 'engineering') as TeamPresetId;
		if (nextPresetId === currentPresetId) {
			return;
		}
		const snapshots: Partial<Record<TeamPresetId, TeamExpertConfig[]>> = {
			...(value.presetExpertSnapshots ?? {}),
		};
		const currentList =
			experts.length > 0 ? experts.map((e) => ({ ...e })) : buildTeamPresetExperts(currentPresetId);
		snapshots[currentPresetId] = currentList;

		const savedNext = snapshots[nextPresetId];
		const fresh = buildTeamPresetExperts(nextPresetId);
		const nextExperts = mergeTeamPresetSavedRows(fresh, savedNext);

		onChange({
			...value,
			presetId: nextPresetId,
			useDefaults: true,
			presetExpertSnapshots: snapshots,
			experts: nextExperts,
			...getTeamPresetDefaults(nextPresetId),
		});
	};
	const modelOptions = useMemo(
		() =>
			modelEntries.map((m) => ({
				id: m.id,
				label: m.displayName.trim() || m.requestName || m.id,
			})),
		[modelEntries]
	);
	const roleOptions = useMemo(
		() =>
			ROLE_IDS.map((item) => ({
				value: item,
				label: t(`settings.team.role.${item}`),
			})),
		[t]
	);
	const teamModelOptions = useMemo(
		() => [{ value: '', label: '—' }, ...modelOptions.map((item) => ({ value: item.id, label: item.label }))],
		[modelOptions]
	);
	const customCount = experts.length;

	const patchEditingRole = (patch: Partial<TeamExpertConfig>) => {
		if (editingRole) {
			setEditingRole({ ...editingRole, ...patch });
		}
	};

	const saveEditingRole = () => {
		if (!editingRole) return;
		const isExisting = roleList.some((r) => r.id === editingRole.id);
		let nextExperts = roleList;
		if (isExisting) {
			nextExperts = roleList.map((r) => (r.id === editingRole.id ? editingRole : r));
		} else {
			nextExperts = [...roleList, editingRole];
		}
		onChange({
			...value,
			experts: nextExperts,
		});
		setEditingRole(null);
	};

	const removeRole = (id: string) => {
		onChange({
			...value,
			experts: roleList.filter((role) => role.id !== id),
		});
		if (editingRole?.id === id) {
			setEditingRole(null);
		}
	};

	return (
		<div className="ref-settings-panel">
			<p className="ref-settings-lead">{t('settings.team.lead')}</p>
			<div className="ref-settings-team-shell">
				<section className="ref-settings-team-hero">
					<div>
						<div className="ref-settings-team-kicker">{t('settings.title.team')}</div>
						<h3 className="ref-settings-team-title">{t('settings.team.templatesTitle')}</h3>
						<p className="ref-settings-team-subtitle">{t('settings.team.templatesLead')}</p>
					</div>
					<div className="ref-settings-team-stats">
						<div className="ref-settings-team-stat">
							<span className="ref-settings-team-stat-label">{t('settings.team.activePreset')}</span>
							<strong>{t(currentPreset.titleKey)}</strong>
						</div>
						<div className="ref-settings-team-stat">
							<span className="ref-settings-team-stat-label">{t('settings.team.customRoles')}</span>
							<strong>{String(customCount)}</strong>
						</div>
					</div>
				</section>

				<section className="ref-settings-team-presets">
					{TEAM_PRESET_LIBRARY.map((preset) => {
						const selected = (value.presetId ?? 'engineering') === preset.id;
						return (
							<button
								key={preset.id}
								type="button"
								className={`ref-settings-team-preset-card ${selected ? 'is-active' : ''}`}
								onClick={() => applyPreset(preset.id)}
							>
								<div className="ref-settings-team-preset-head">
									<strong>{t(preset.titleKey)}</strong>
									<span>{preset.experts.length} roles</span>
								</div>
								<p>{t(preset.descriptionKey)}</p>
							</button>
						);
					})}
				</section>

				<section className="ref-settings-team-config-card">
					<div className="ref-settings-team-config-grid">
						<label className="ref-settings-team-inline-check">
							<input
								type="checkbox"
								checked={value.useDefaults !== false}
								onChange={(e) => onChange({ ...value, useDefaults: e.target.checked })}
							/>
							<span>{t('settings.team.useDefaults')}</span>
						</label>
						<label className="ref-settings-team-inline-check">
							<input
								type="checkbox"
								checked={value.requirePlanApproval ?? presetDefaults.requirePlanApproval}
								onChange={(e) => onChange({ ...value, requirePlanApproval: e.target.checked })}
							/>
							<span>{t('settings.team.requirePlanApproval')}</span>
						</label>
						<label className="ref-settings-team-inline-check">
							<input
								type="checkbox"
								checked={value.enablePreflightReview ?? presetDefaults.enablePreflightReview}
								onChange={(e) => onChange({ ...value, enablePreflightReview: e.target.checked })}
							/>
							<span>{t('settings.team.enablePreflightReview')}</span>
						</label>
						<label className="ref-settings-team-inline-check">
							<input
								type="checkbox"
								checked={value.enableResearchPhase ?? presetDefaults.enableResearchPhase}
								onChange={(e) => onChange({ ...value, enableResearchPhase: e.target.checked })}
							/>
							<span>{t('settings.team.enableResearchPhase')}</span>
						</label>
					</div>
					<div className="ref-settings-team-actions">
						<button
							type="button"
							className="ref-settings-add-model"
							onClick={() => setEditingRole(newRole())}
						>
							{t('settings.team.addRole')}
						</button>
						<button
							type="button"
							className="ref-settings-add-model"
							onClick={() => {
								const pid = (value.presetId ?? 'engineering') as TeamPresetId;
								const snaps = { ...(value.presetExpertSnapshots ?? {}) };
								delete snaps[pid];
								onChange({
									...value,
									experts: buildTeamPresetExperts(pid),
									presetExpertSnapshots: snaps,
								});
							}}
						>
							{t('settings.team.applyPresetRoles')}
						</button>
						<button
							type="button"
							className="ref-settings-remove-model"
							onClick={restoreDefaults}
						>
							{t('settings.team.restoreDefaults')}
						</button>
					</div>
				</section>

				{roleList.length === 0 ? <p className="ref-settings-proxy-hint">{t('settings.team.empty')}</p> : null}
			</div>

			<div className="ref-settings-team-badges">
				{roleList.map((role) => {
					let modelText = '—';
					if (role.preferredModelId) {
						const m = modelEntries.find((e) => e.id === role.preferredModelId);
						if (m) {
							const pName = providerDisplayLabel(m.providerId, modelProviders);
							const mName = m.displayName.trim() || m.requestName;
							modelText = pName ? `${mName} (${pName})` : mName;
						} else {
							modelText = role.preferredModelId;
						}
					}
					
					return (
						<button
							key={role.id}
							type="button"
							className="ref-settings-team-badge"
							onClick={() => setEditingRole(role)}
						>
							<div className="ref-settings-team-badge-header">
								<h4 className="ref-settings-team-badge-name">{role.name || t('settings.team.untitledRole')}</h4>
								<span className="ref-settings-team-badge-role">
									{t(`settings.team.role.${role.roleType}`) || role.roleType}
								</span>
							</div>
							<div className="ref-settings-team-badge-model">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
									<polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
									<line x1="12" y1="22.08" x2="12" y2="12"></line>
								</svg>
								<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelText}</span>
							</div>
							{!role.enabled && (
								<div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit', fontWeight: 'bold' }}>
									Disabled
								</div>
							)}
						</button>
					);
				})}
				<button
					type="button"
					className="ref-settings-team-badge is-add"
					onClick={() => setEditingRole(newRole())}
				>
					+ {t('settings.team.addRole')}
				</button>
			</div>

			{editingRole && (
				<div className="modal-backdrop" onClick={() => setEditingRole(null)}>
					<div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 500, maxWidth: '90vw' }}>
						<h2 style={{ marginBottom: 24, fontSize: 18 }}>{editingRole.name || t('settings.team.untitledRole')}</h2>
						
						<div className="ref-settings-team-role-head" style={{ marginBottom: 20 }}>
							<div>
								<p>{editingRole.assignmentKey || editingRole.roleType}</p>
							</div>
							<label className="ref-settings-team-inline-check">
								<input
									type="checkbox"
									checked={editingRole.enabled !== false}
									onChange={(e) => patchEditingRole({ enabled: e.target.checked })}
								/>
								<span>{t('settings.team.enabled')}</span>
							</label>
						</div>

						<div className="ref-settings-team-role-grid" style={{ marginBottom: 16 }}>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.roleName')}</span>
								<input
									value={editingRole.name}
									placeholder={t('settings.team.untitledRole')}
									onChange={(e) => patchEditingRole({ name: e.target.value })}
								/>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.roleType')}</span>
								<VoidSelect
									variant="compact"
									ariaLabel={t('settings.team.roleType')}
									value={editingRole.roleType}
									onChange={(value) => patchEditingRole({ roleType: value as TeamRoleType })}
									options={roleOptions}
								/>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.assignmentKey')}</span>
								<input
									value={editingRole.assignmentKey ?? ''}
									onChange={(e) => patchEditingRole({ assignmentKey: e.target.value })}
								/>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.model')}</span>
								<VoidSelect
									variant="compact"
									ariaLabel={t('settings.team.model')}
									value={editingRole.preferredModelId ?? ''}
									onChange={(value) => patchEditingRole({ preferredModelId: value || undefined })}
									options={teamModelOptions}
								/>
							</label>
							<label className="ref-settings-field ref-settings-field--compact" style={{ gridColumn: '1 / -1' }}>
								<span>{t('settings.team.toolsCsv')}</span>
								<input
									value={(editingRole.allowedTools ?? []).join(', ')}
									onChange={(e) =>
										patchEditingRole({
											allowedTools: e.target.value
												.split(',')
												.map((x) => x.trim())
												.filter(Boolean),
										})
									}
								/>
							</label>
						</div>

						<label className="ref-settings-field">
							<span>{t('settings.team.prompt')}</span>
							<textarea
								className="ref-settings-models-search"
								style={{ minHeight: 120, resize: 'vertical' }}
								value={editingRole.systemPrompt}
								onChange={(e) => patchEditingRole({ systemPrompt: e.target.value })}
							/>
						</label>

						<div className="modal-actions" style={{ justifyContent: 'space-between', marginTop: 24 }}>
							<button
								type="button"
								className="ref-settings-remove-model"
								onClick={() => removeRole(editingRole.id)}
							>
								{t('settings.team.removeRole')}
							</button>
							<div style={{ display: 'flex', gap: 10 }}>
								<button
									type="button"
									className="ref-settings-remove-model"
									onClick={() => setEditingRole(null)}
								>
									取消
								</button>
								<button
									type="button"
									className="ref-settings-add-model"
									onClick={saveEditingRole}
								>
									保存
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
