import { useMemo } from 'react';
import type { TeamExpertConfig, TeamPresetId, TeamRoleType, TeamSettings } from './agentSettingsTypes';
import type { UserModelEntry } from './modelCatalog';
import { useI18n } from './i18n';
import { TEAM_PRESET_LIBRARY, buildTeamPresetExperts, getTeamPreset } from './teamPresetCatalog';

type Props = {
	value: TeamSettings;
	onChange: (next: TeamSettings) => void;
	modelEntries: UserModelEntry[];
};

const ROLE_IDS: TeamRoleType[] = ['team_lead', 'frontend', 'backend', 'qa', 'reviewer', 'custom'];

function newRole(): TeamExpertConfig {
	const id =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `team-${Date.now()}`;
	return {
		id,
		name: 'New Expert',
		roleType: 'custom',
		assignmentKey: `specialist_${Date.now()}`,
		systemPrompt: 'You are a specialist engineer. Complete assigned tasks with clear output.',
		enabled: true,
		allowedTools: [],
	};
}

export function SettingsTeamPanel({ value, onChange, modelEntries }: Props) {
	const { t } = useI18n();
	const experts = value.experts ?? [];
	const roleList = experts.length > 0 ? experts : buildTeamPresetExperts(value.presetId);
	const currentPreset = getTeamPreset(value.presetId);
	const restoreDefaults = () => {
		onChange({
			useDefaults: true,
			presetId: 'engineering',
			maxParallelExperts: 3,
			experts: [],
		});
	};
	const applyPreset = (presetId: TeamPresetId) => {
		const preset = getTeamPreset(presetId);
		onChange({
			...value,
			presetId,
			useDefaults: true,
			maxParallelExperts: preset.maxParallelExperts,
			experts: buildTeamPresetExperts(presetId),
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
	const customCount = experts.length;

	const patchRole = (id: string, patch: Partial<TeamExpertConfig>) => {
		onChange({
			...value,
			experts: roleList.map((role) => (role.id === id ? { ...role, ...patch } : role)),
		});
	};

	const removeRole = (id: string) => {
		onChange({
			...value,
			experts: roleList.filter((role) => role.id !== id),
		});
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
						<label className="ref-settings-field">
							<span>{t('settings.team.maxParallel')}</span>
							<input
								type="number"
								min={1}
								max={8}
								value={value.maxParallelExperts ?? 3}
								onChange={(e) => onChange({ ...value, maxParallelExperts: Number.parseInt(e.target.value, 10) || 3 })}
							/>
						</label>
						<label className="ref-settings-team-inline-check">
							<input
								type="checkbox"
								checked={value.useDefaults !== false}
								onChange={(e) => onChange({ ...value, useDefaults: e.target.checked })}
							/>
							<span>{t('settings.team.useDefaults')}</span>
						</label>
					</div>
					<div className="ref-settings-team-actions">
						<button
							type="button"
							className="ref-settings-add-model"
							onClick={() => onChange({ ...value, experts: [...roleList, newRole()] })}
						>
							{t('settings.team.addRole')}
						</button>
						<button
							type="button"
							className="ref-settings-add-model"
							onClick={() => onChange({ ...value, experts: buildTeamPresetExperts(value.presetId) })}
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
			<div className="ref-settings-team-roles">
				{roleList.map((role) => (
					<div key={role.id} className="ref-settings-team-role-card">
						<div className="ref-settings-team-role-head">
							<div>
								<strong>{role.name || t('settings.team.untitledRole')}</strong>
								<p>{role.assignmentKey || role.roleType}</p>
							</div>
							<label className="ref-settings-team-inline-check">
								<input
									type="checkbox"
									checked={role.enabled !== false}
									onChange={(e) => patchRole(role.id, { enabled: e.target.checked })}
								/>
								<span>{t('settings.team.enabled')}</span>
							</label>
						</div>
						<div className="ref-settings-team-role-grid">
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.roleName')}</span>
								<input
									value={role.name}
									onChange={(e) => patchRole(role.id, { name: e.target.value })}
								/>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.roleType')}</span>
								<select
									className="ref-settings-native-select"
									value={role.roleType}
									onChange={(e) => patchRole(role.id, { roleType: e.target.value as TeamRoleType })}
								>
									{ROLE_IDS.map((item) => (
										<option key={item} value={item}>
											{t(`settings.team.role.${item}`)}
										</option>
									))}
								</select>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.assignmentKey')}</span>
								<input
									value={role.assignmentKey ?? ''}
									onChange={(e) => patchRole(role.id, { assignmentKey: e.target.value })}
								/>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.model')}</span>
								<select
									className="ref-settings-native-select"
									value={role.preferredModelId ?? ''}
									onChange={(e) => patchRole(role.id, { preferredModelId: e.target.value || undefined })}
								>
									<option value="">—</option>
									{modelOptions.map((item) => (
										<option key={item.id} value={item.id}>
											{item.label}
										</option>
									))}
								</select>
							</label>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('settings.team.toolsCsv')}</span>
								<input
									value={(role.allowedTools ?? []).join(', ')}
									onChange={(e) =>
										patchRole(role.id, {
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
								value={role.systemPrompt}
								onChange={(e) => patchRole(role.id, { systemPrompt: e.target.value })}
							/>
						</label>
						<button
							type="button"
							className="ref-settings-remove-model"
							onClick={() => removeRole(role.id)}
						>
							{t('settings.team.removeRole')}
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
