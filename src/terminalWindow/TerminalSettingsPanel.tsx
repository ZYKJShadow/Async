import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import type { TFunction } from '../i18n';
import {
	DEFAULT_PROFILE_ID,
	FONT_FAMILY_CHOICES,
	applyTerminalDisplayPreset,
	buildTerminalProfileLaunchPreview,
	buildTerminalProfileTarget,
	cloneTerminalProfile,
	countTerminalProfileEnvEntries,
	defaultTerminalSettings,
	newProfileId,
	normalizeTerminalSettings,
	resetTerminalProfile,
	type TerminalAppSettings,
	type TerminalDisplayPresetId,
	type TerminalProfile,
	type TerminalProfileKind,
	type TerminalRightClickAction,
} from './terminalSettings';

type SettingsNav = 'profilesConnections' | 'appearance' | 'terminal';
type ProfilesSubtab = 'profiles' | 'advanced';

type Props = {
	t: TFunction;
	settings: TerminalAppSettings;
	onChange(next: TerminalAppSettings): void;
};

function IconProfilesNav() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="4" y="5" width="16" height="14" rx="2" />
			<path d="M8 9h8M8 13h4" strokeLinecap="round" />
		</svg>
	);
}

function IconAppearanceNav() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2" strokeLinecap="round" />
		</svg>
	);
}

function IconTerminalNav() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<path d="M7 9l3 3-3 3M12 15h5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconSearchSmall() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
		</svg>
	);
}

export const TerminalSettingsPanel = memo(function TerminalSettingsPanel({ t, settings, onChange }: Props) {
	const [nav, setNav] = useState<SettingsNav>('profilesConnections');
	const [profilesSubtab, setProfilesSubtab] = useState<ProfilesSubtab>('profiles');
	const [activeProfileId, setActiveProfileId] = useState<string>(settings.defaultProfileId);
	const [filter, setFilter] = useState('');
	const [collapsedGroups, setCollapsedGroups] = useState<Record<'local' | 'ssh', boolean>>({
		local: false,
		ssh: false,
	});
	const [navPending, startNavTransition] = useTransition();
	const stageRef = useRef<HTMLDivElement | null>(null);

	const patch = useCallback(
		(partial: Partial<TerminalAppSettings>) => {
			onChange(normalizeTerminalSettings({ ...settings, ...partial }));
		},
		[settings, onChange]
	);

	const patchProfile = useCallback(
		(id: string, partial: Partial<TerminalProfile>) => {
			patch({
				profiles: settings.profiles.map((profile) => (profile.id === id ? { ...profile, ...partial } : profile)),
			});
		},
		[patch, settings.profiles]
	);

	const activeProfile = useMemo(
		() => settings.profiles.find((profile) => profile.id === activeProfileId) ?? settings.profiles[0],
		[settings.profiles, activeProfileId]
	);

	const defaultProfile = useMemo(
		() =>
			settings.profiles.find((profile) => profile.id === settings.defaultProfileId) ?? settings.profiles[0] ?? null,
		[settings.defaultProfileId, settings.profiles]
	);

	const addProfile = useCallback(
		(kind: TerminalProfileKind = 'local') => {
			const id = newProfileId(settings.profiles);
			const next: TerminalProfile = {
				id,
				name:
					kind === 'ssh'
						? t('app.universalTerminalSettings.profiles.newSshName')
						: t('app.universalTerminalSettings.profiles.untitled'),
				kind,
				sshHost: '',
				sshPort: 22,
				sshUser: '',
				sshIdentityFile: '',
				sshRemoteCommand: '',
				sshExtraArgs: '',
				shell: '',
				args: '',
				cwd: '',
				env: '',
			};
			patch({ profiles: [...settings.profiles, next] });
			setActiveProfileId(id);
			setProfilesSubtab('profiles');
			setNav('profilesConnections');
		},
		[patch, settings.profiles, t]
	);

	const duplicateActiveProfile = useCallback(() => {
		if (!activeProfile) {
			return;
		}
		const next = cloneTerminalProfile(settings.profiles, activeProfile);
		patch({ profiles: [...settings.profiles, next] });
		setActiveProfileId(next.id);
	}, [activeProfile, patch, settings.profiles]);

	const resetActiveProfile = useCallback(() => {
		if (!activeProfile) {
			return;
		}
		patch({
			profiles: settings.profiles.map((profile) =>
				profile.id === activeProfile.id ? resetTerminalProfile(activeProfile) : profile
			),
		});
	}, [activeProfile, patch, settings.profiles]);

	const removeProfile = useCallback(
		(id: string) => {
			if (settings.profiles.length <= 1) {
				return;
			}
			const remaining = settings.profiles.filter((profile) => profile.id !== id);
			const nextDefault = settings.defaultProfileId === id ? remaining[0].id : settings.defaultProfileId;
			patch({ profiles: remaining, defaultProfileId: nextDefault });
			setActiveProfileId(remaining[0].id);
		},
		[patch, settings.defaultProfileId, settings.profiles]
	);

	const filteredProfiles = useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) {
			return settings.profiles;
		}
		return settings.profiles.filter((profile) => {
			const haystack = [
				profile.name,
				buildTerminalProfileTarget(profile),
				buildTerminalProfileLaunchPreview(profile),
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(q);
		});
	}, [filter, settings.profiles]);

	const groupedProfiles = useMemo(
		() => [
			{
				id: 'local' as const,
				label: t('app.universalTerminalSettings.groups.local'),
				items: filteredProfiles.filter((profile) => profile.kind === 'local'),
			},
			{
				id: 'ssh' as const,
				label: t('app.universalTerminalSettings.groups.ssh'),
				items: filteredProfiles.filter((profile) => profile.kind === 'ssh'),
			},
		],
		[filteredProfiles, t]
	);

	const displayStats = useMemo(
		() => [
			{
				label: t('app.universalTerminalSettings.summary.defaultProfile'),
				value: defaultProfile?.name || t('app.universalTerminalSettings.systemDefaultShell'),
			},
			{
				label: t('app.universalTerminalSettings.summary.profileCount'),
				value: String(settings.profiles.length),
			},
			{
				label: t('app.universalTerminalSettings.summary.activeTarget'),
				value: describeProfileTarget(activeProfile, t),
			},
			{
				label: t('app.universalTerminalSettings.summary.envCount'),
				value: String(countTerminalProfileEnvEntries(activeProfile)),
			},
		],
		[activeProfile, defaultProfile, settings.profiles.length, t]
	);

	const navItems: Array<{ id: SettingsNav; label: string; description: string }> = [
		{
			id: 'profilesConnections',
			label: t('app.universalTerminalSettings.nav.profilesConnections'),
			description: t('app.universalTerminalSettings.nav.profilesConnectionsDesc'),
		},
		{
			id: 'appearance',
			label: t('app.universalTerminalSettings.nav.appearance'),
			description: t('app.universalTerminalSettings.nav.appearanceDesc'),
		},
		{
			id: 'terminal',
			label: t('app.universalTerminalSettings.nav.terminal'),
			description: t('app.universalTerminalSettings.nav.terminalDesc'),
		},
	];

	const navIcons: Record<SettingsNav, ReactNode> = {
		profilesConnections: <IconProfilesNav />,
		appearance: <IconAppearanceNav />,
		terminal: <IconTerminalNav />,
	};

	useEffect(() => {
		stageRef.current?.scrollTo({ top: 0 });
	}, [nav, profilesSubtab]);

	return (
		<div className="ref-uterm-settings-workspace">
			<aside className="ref-uterm-settings-sidebar">
				<div className="ref-uterm-settings-sidebar-head">
					<div className="ref-uterm-settings-sidebar-kicker">Async</div>
					<div className="ref-uterm-settings-sidebar-title">{t('app.universalTerminalSettings.sidebarTitle')}</div>
				</div>
				<nav className="ref-uterm-settings-sidebar-nav" aria-label={t('app.universalTerminalSettings.sidebarTitle')}>
					{navItems.map((item) => (
						<button
							key={item.id}
							type="button"
							className={`ref-uterm-settings-sidebar-link ${nav === item.id ? 'is-active' : ''}`}
							onClick={() =>
								startNavTransition(() => {
									setNav(item.id);
								})
							}
						>
							<span className="ref-uterm-settings-sidebar-link-ico">{navIcons[item.id]}</span>
							<span className="ref-uterm-settings-sidebar-link-copy">
								<span className="ref-uterm-settings-sidebar-link-label">{item.label}</span>
								<span className="ref-uterm-settings-sidebar-link-desc">{item.description}</span>
							</span>
						</button>
					))}
				</nav>
				<div className="ref-uterm-settings-sidebar-footer">
					<div className="ref-uterm-settings-sidebar-footer-title">
						{displayStats[0]?.value || t('app.universalTerminalSettings.systemDefaultShell')}
					</div>
					<div className="ref-uterm-settings-sidebar-footer-copy">
						{displayStats[1]?.label}: {displayStats[1]?.value}
					</div>
				</div>
			</aside>

			<div className="ref-uterm-settings-stage" ref={stageRef}>
				<div
					key={nav === 'profilesConnections' ? `${nav}:${profilesSubtab}` : nav}
					className={`ref-uterm-settings-page-swap ${navPending ? 'is-pending' : ''}`}
				>
				{nav === 'profilesConnections' ? (
					<ProfilesSettingsStage
						t={t}
						settings={settings}
						defaultProfile={defaultProfile}
						activeProfile={activeProfile}
						profilesSubtab={profilesSubtab}
						onChangeSubtab={setProfilesSubtab}
						filter={filter}
						onFilterChange={setFilter}
						groupedProfiles={groupedProfiles}
						collapsedGroups={collapsedGroups}
						onToggleGroup={(groupId) =>
							setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
						}
						onSelectProfile={setActiveProfileId}
						onAddLocalProfile={() => addProfile('local')}
						onAddSshProfile={() => addProfile('ssh')}
						onPatchProfile={patchProfile}
						onDuplicateProfile={duplicateActiveProfile}
						onResetProfile={resetActiveProfile}
						onRemoveProfile={removeProfile}
						onPatchSettings={patch}
					/>
				) : null}

				{nav === 'appearance' ? (
					<AppearanceSettingsStage t={t} settings={settings} onPatchSettings={patch} />
				) : null}

				{nav === 'terminal' ? (
					<TerminalBehaviorStage t={t} settings={settings} onPatchSettings={patch} />
				) : null}
				</div>
			</div>
		</div>
	);
});

type ProfilesSettingsStageProps = {
	t: TFunction;
	settings: TerminalAppSettings;
	defaultProfile: TerminalProfile | null;
	activeProfile: TerminalProfile;
	profilesSubtab: ProfilesSubtab;
	onChangeSubtab(next: ProfilesSubtab): void;
	filter: string;
	onFilterChange(next: string): void;
	groupedProfiles: Array<{ id: 'local' | 'ssh'; label: string; items: TerminalProfile[] }>;
	collapsedGroups: Record<'local' | 'ssh', boolean>;
	onToggleGroup(groupId: 'local' | 'ssh'): void;
	onSelectProfile(id: string): void;
	onAddLocalProfile(): void;
	onAddSshProfile(): void;
	onPatchProfile(id: string, partial: Partial<TerminalProfile>): void;
	onDuplicateProfile(): void;
	onResetProfile(): void;
	onRemoveProfile(id: string): void;
	onPatchSettings(partial: Partial<TerminalAppSettings>): void;
};

function ProfilesSettingsStage({
	t,
	settings,
	defaultProfile,
	activeProfile,
	profilesSubtab,
	onChangeSubtab,
	filter,
	onFilterChange,
	groupedProfiles,
	collapsedGroups,
	onToggleGroup,
	onSelectProfile,
	onAddLocalProfile,
	onAddSshProfile,
	onPatchProfile,
	onDuplicateProfile,
	onResetProfile,
	onRemoveProfile,
	onPatchSettings,
}: ProfilesSettingsStageProps) {
	const sshIncomplete =
		activeProfile.kind === 'ssh' && (!activeProfile.sshHost.trim() || !activeProfile.sshUser.trim());
	const launchPreview = buildTerminalProfileLaunchPreview(activeProfile);

	return (
		<div className="ref-uterm-settings-page">
			<div className="ref-uterm-settings-page-head">
				<div>
					<h2 className="ref-uterm-settings-page-title">{t('app.universalTerminalSettings.profilesPageTitle')}</h2>
					<p className="ref-uterm-settings-page-copy">{t('app.universalTerminalSettings.profiles.lead')}</p>
				</div>
			</div>

			<div className="ref-uterm-settings-subtabs" role="tablist" aria-label={t('app.universalTerminalSettings.profilesPageTitle')}>
				<SubtabButton
					active={profilesSubtab === 'profiles'}
					onClick={() => onChangeSubtab('profiles')}
					label={t('app.universalTerminalSettings.profilesSubtab.profiles')}
				/>
				<SubtabButton
					active={profilesSubtab === 'advanced'}
					onClick={() => onChangeSubtab('advanced')}
					label={t('app.universalTerminalSettings.profilesSubtab.advanced')}
				/>
			</div>

			{profilesSubtab === 'profiles' ? (
				<>
					<div className="ref-uterm-settings-toolbar">
						<InlineField label={t('app.universalTerminalSettings.profiles.defaultProfileLabel')}>
							<select
								value={settings.defaultProfileId}
								onChange={(event) => onPatchSettings({ defaultProfileId: event.target.value })}
								className="ref-uterm-settings-select"
							>
								{settings.profiles.map((profile) => (
									<option key={profile.id} value={profile.id}>
										{profile.name || t('app.universalTerminalSettings.profiles.untitled')}
									</option>
								))}
							</select>
						</InlineField>
						<div className="ref-uterm-settings-toolbar-actions">
							<div className="ref-uterm-settings-search">
								<span className="ref-uterm-settings-search-ico" aria-hidden>
									<IconSearchSmall />
								</span>
								<input
									type="search"
									value={filter}
									onChange={(event) => onFilterChange(event.target.value)}
									placeholder={t('app.universalTerminalSettings.profiles.filter')}
									className="ref-uterm-settings-input"
								/>
							</div>
							<div className="ref-uterm-settings-split-actions">
								<button type="button" className="ref-uterm-settings-primary-btn" onClick={onAddLocalProfile}>
									{t('app.universalTerminalSettings.profiles.newLocal')}
								</button>
								<button type="button" className="ref-uterm-settings-secondary-btn" onClick={onAddSshProfile}>
									{t('app.universalTerminalSettings.profiles.newSsh')}
								</button>
							</div>
						</div>
					</div>

					<div className="ref-uterm-settings-profiles-workbench">
						<div className="ref-uterm-settings-profile-list-shell">
							{groupedProfiles.map((group) => (
								<div key={group.id} className="ref-uterm-settings-profile-group">
									<button
										type="button"
										className="ref-uterm-settings-profile-group-head"
										onClick={() => onToggleGroup(group.id)}
									>
										<span className={`ref-uterm-settings-profile-group-chevron ${collapsedGroups[group.id] ? 'is-collapsed' : ''}`}>
											▾
										</span>
										<span>{group.label}</span>
										<span className="ref-uterm-settings-profile-group-count">{group.items.length}</span>
									</button>
									{!collapsedGroups[group.id] ? (
										group.items.length > 0 ? (
											<div className="ref-uterm-settings-profile-group-body">
												{group.items.map((profile) => {
													const isActive = profile.id === activeProfile.id;
													return (
														<button
															key={profile.id}
															type="button"
															className={`ref-uterm-settings-profile-list-item ${isActive ? 'is-active' : ''}`}
															onClick={() => onSelectProfile(profile.id)}
														>
															<div className="ref-uterm-settings-profile-list-item-main">
																<span className="ref-uterm-settings-profile-list-item-title">
																	{profile.name || t('app.universalTerminalSettings.profiles.untitled')}
																</span>
																<span className="ref-uterm-settings-profile-list-item-meta" title={describeProfileTarget(profile, t)}>
																	{describeProfileTarget(profile, t)}
																</span>
															</div>
															<div className="ref-uterm-settings-profile-list-item-side">
																{settings.defaultProfileId === profile.id ? (
																	<span className="ref-uterm-settings-badge ref-uterm-settings-badge--accent">
																		{t('app.universalTerminalSettings.profiles.defaultBadge')}
																	</span>
																) : null}
																<span className="ref-uterm-settings-badge">
																	{profile.kind === 'ssh'
																		? t('app.universalTerminalSettings.profiles.kindBadge.ssh')
																		: t('app.universalTerminalSettings.profiles.kindBadge.local')}
																</span>
															</div>
														</button>
													);
												})}
											</div>
										) : (
											<div className="ref-uterm-settings-empty-list">{t('app.universalTerminalSettings.profiles.emptyGroup')}</div>
										)
									) : null}
								</div>
							))}
						</div>

						<div className="ref-uterm-settings-profile-editor-shell">
							<div className="ref-uterm-settings-profile-editor-head">
								<div>
									<div className="ref-uterm-settings-profile-editor-title">
										{activeProfile.name || t('app.universalTerminalSettings.profiles.untitled')}
									</div>
									<div className="ref-uterm-settings-profile-editor-subtitle">{describeProfileTarget(activeProfile, t)}</div>
								</div>
								<div className="ref-uterm-settings-profile-editor-actions">
									<button type="button" className="ref-uterm-settings-secondary-btn" onClick={onDuplicateProfile}>
										{t('app.universalTerminalSettings.duplicateProfile')}
									</button>
									<button type="button" className="ref-uterm-settings-secondary-btn" onClick={onResetProfile}>
										{t('app.universalTerminalSettings.resetProfile')}
									</button>
								</div>
							</div>

							<div className="ref-uterm-settings-inline-grid">
								<MiniStat
									label={t('app.universalTerminalSettings.profiles.connectionSummary')}
									value={describeProfileTarget(activeProfile, t)}
								/>
								<MiniStat
									label={t('app.universalTerminalSettings.profiles.cwd')}
									value={activeProfile.cwd.trim() || t('app.universalTerminalSettings.profiles.cwdDefault')}
								/>
								<MiniStat
									label={t('app.universalTerminalSettings.profiles.envCount')}
									value={
										countTerminalProfileEnvEntries(activeProfile) > 0
											? String(countTerminalProfileEnvEntries(activeProfile))
											: t('app.universalTerminalSettings.profiles.noEnv')
									}
								/>
							</div>

							{sshIncomplete ? (
								<div className="ref-uterm-settings-callout">{t('app.universalTerminalSettings.profiles.sshIncomplete')}</div>
							) : null}

							<div className="ref-uterm-settings-form">
								<Field label={t('app.universalTerminalSettings.profiles.name')}>
									<input
										type="text"
										className="ref-uterm-settings-input"
										value={activeProfile.name}
										onChange={(event) => onPatchProfile(activeProfile.id, { name: event.target.value })}
									/>
								</Field>

								<Field label={t('app.universalTerminalSettings.profiles.connectionKind')}>
									<ChipGroup>
										{(['local', 'ssh'] as const).map((kind) => (
											<ChipToggle
												key={kind}
												active={activeProfile.kind === kind}
												onClick={() => onPatchProfile(activeProfile.id, { kind })}
											>
												{t(`app.universalTerminalSettings.profiles.kind.${kind}`)}
											</ChipToggle>
										))}
									</ChipGroup>
								</Field>

								{activeProfile.kind === 'ssh' ? (
									<>
										<Field label={t('app.universalTerminalSettings.profiles.sshHost')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.sshHost}
												placeholder="example.com"
												onChange={(event) => onPatchProfile(activeProfile.id, { sshHost: event.target.value })}
											/>
										</Field>
										<Field label={t('app.universalTerminalSettings.profiles.sshPort')}>
											<input
												type="number"
												className="ref-uterm-settings-input ref-uterm-settings-input--narrow"
												min={1}
												max={65535}
												value={activeProfile.sshPort}
												onChange={(event) =>
													onPatchProfile(activeProfile.id, {
														sshPort: Math.max(1, Math.min(65535, Math.floor(Number(event.target.value) || 22))),
													})
												}
											/>
										</Field>
										<Field label={t('app.universalTerminalSettings.profiles.sshUser')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.sshUser}
												placeholder="ubuntu"
												onChange={(event) => onPatchProfile(activeProfile.id, { sshUser: event.target.value })}
											/>
										</Field>
										<Field label={t('app.universalTerminalSettings.profiles.sshIdentityFile')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.sshIdentityFile}
												placeholder={t('app.universalTerminalSettings.profiles.sshIdentityPlaceholder')}
												onChange={(event) =>
													onPatchProfile(activeProfile.id, { sshIdentityFile: event.target.value })
												}
											/>
										</Field>
										<Field label={t('app.universalTerminalSettings.profiles.sshExtraArgs')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.sshExtraArgs}
												placeholder={t('app.universalTerminalSettings.profiles.sshExtraArgsPlaceholder')}
												onChange={(event) => onPatchProfile(activeProfile.id, { sshExtraArgs: event.target.value })}
											/>
										</Field>
										<Field label={t('app.universalTerminalSettings.profiles.sshRemoteCommand')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.sshRemoteCommand}
												placeholder={t('app.universalTerminalSettings.profiles.sshRemoteCommandPlaceholder')}
												onChange={(event) =>
													onPatchProfile(activeProfile.id, { sshRemoteCommand: event.target.value })
												}
											/>
										</Field>
									</>
								) : (
									<>
										<Field label={t('app.universalTerminalSettings.profiles.shell')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.shell}
												placeholder={t('app.universalTerminalSettings.profiles.shellPlaceholder')}
												onChange={(event) => onPatchProfile(activeProfile.id, { shell: event.target.value })}
											/>
										</Field>
										<Field label={t('app.universalTerminalSettings.profiles.args')}>
											<input
												type="text"
												className="ref-uterm-settings-input"
												value={activeProfile.args}
												placeholder={t('app.universalTerminalSettings.profiles.argsPlaceholder')}
												onChange={(event) => onPatchProfile(activeProfile.id, { args: event.target.value })}
											/>
										</Field>
									</>
								)}

								<Field label={t('app.universalTerminalSettings.profiles.cwd')}>
									<input
										type="text"
										className="ref-uterm-settings-input"
										value={activeProfile.cwd}
										placeholder={t('app.universalTerminalSettings.profiles.cwdPlaceholder')}
										onChange={(event) => onPatchProfile(activeProfile.id, { cwd: event.target.value })}
									/>
								</Field>

								<Field label={t('app.universalTerminalSettings.profiles.env')}>
									<textarea
										className="ref-uterm-settings-textarea"
										rows={5}
										value={activeProfile.env}
										placeholder={'NODE_ENV=dev\nMY_VAR=value'}
										onChange={(event) => onPatchProfile(activeProfile.id, { env: event.target.value })}
									/>
								</Field>
							</div>

							<div className="ref-uterm-settings-preview-card">
								<div className="ref-uterm-settings-preview-card-title">
									{t('app.universalTerminalSettings.launchPreview')}
								</div>
								<code className="ref-uterm-settings-preview-code">{launchPreview}</code>
							</div>

							<div className="ref-uterm-settings-editor-footer">
								<label className="ref-uterm-settings-checkbox">
									<input
										type="checkbox"
										checked={settings.defaultProfileId === activeProfile.id}
										onChange={(event) => {
											if (event.target.checked) {
												onPatchSettings({ defaultProfileId: activeProfile.id });
											}
										}}
									/>
									<span>{t('app.universalTerminalSettings.profiles.setDefault')}</span>
								</label>
								<button
									type="button"
									className="ref-uterm-settings-danger-btn"
									disabled={settings.profiles.length <= 1 || activeProfile.id === DEFAULT_PROFILE_ID}
									onClick={() => onRemoveProfile(activeProfile.id)}
								>
									{t('app.universalTerminalSettings.profiles.remove')}
								</button>
							</div>
						</div>
					</div>
				</>
			) : (
				<div className="ref-uterm-settings-advanced-page">
					<div className="ref-uterm-settings-advanced-grid">
						<div className="ref-uterm-settings-card">
							<div className="ref-uterm-settings-card-title">
								{t('app.universalTerminalSettings.profiles.defaultProfileLabel')}
							</div>
							<p className="ref-uterm-settings-card-copy">
								{t('app.universalTerminalSettings.profiles.defaultProfileHint')}
							</p>
							<select
								value={settings.defaultProfileId}
								onChange={(event) => onPatchSettings({ defaultProfileId: event.target.value })}
								className="ref-uterm-settings-select"
							>
								{settings.profiles.map((profile) => (
									<option key={profile.id} value={profile.id}>
										{profile.name || t('app.universalTerminalSettings.profiles.untitled')}
									</option>
								))}
							</select>
							{defaultProfile ? (
								<div className="ref-uterm-settings-preview-inline">
									<code className="ref-uterm-settings-preview-code">
										{buildTerminalProfileLaunchPreview(defaultProfile)}
									</code>
								</div>
							) : null}
						</div>

						<div className="ref-uterm-settings-card">
							<div className="ref-uterm-settings-card-title">
								{t('app.universalTerminalSettings.quickActionsTitle')}
							</div>
							<p className="ref-uterm-settings-card-copy">
								{t('app.universalTerminalSettings.quickActionsHint')}
							</p>
							<div className="ref-uterm-settings-stack-actions">
								<button type="button" className="ref-uterm-settings-primary-btn" onClick={onAddLocalProfile}>
									{t('app.universalTerminalSettings.profiles.newLocal')}
								</button>
								<button type="button" className="ref-uterm-settings-secondary-btn" onClick={onAddSshProfile}>
									{t('app.universalTerminalSettings.profiles.newSsh')}
								</button>
								<button
									type="button"
									className="ref-uterm-settings-secondary-btn"
									onClick={() => onPatchSettings(defaultTerminalSettings())}
								>
									{t('app.universalTerminalSettings.resetAll')}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function AppearanceSettingsStage({
	t,
	settings,
	onPatchSettings,
}: {
	t: TFunction;
	settings: TerminalAppSettings;
	onPatchSettings(partial: Partial<TerminalAppSettings>): void;
}) {
	const previewStyle = useMemo(
		(): CSSProperties => ({
			fontFamily: settings.fontFamily,
			fontSize: `${settings.fontSize}px`,
			fontWeight: settings.fontWeight,
			lineHeight: String(settings.lineHeight),
			opacity: settings.opacity,
		}),
		[settings.fontFamily, settings.fontSize, settings.fontWeight, settings.lineHeight, settings.opacity]
	);

	return (
		<div className="ref-uterm-settings-page">
			<div className="ref-uterm-settings-page-head">
				<div>
					<h2 className="ref-uterm-settings-page-title">{t('app.universalTerminalSettings.nav.appearance')}</h2>
					<p className="ref-uterm-settings-page-copy">{t('app.universalTerminalSettings.appearanceLead')}</p>
				</div>
			</div>

			<div className="ref-uterm-settings-hero-card">
				<div className="ref-uterm-settings-preview-shell" style={previewStyle}>
					<div className="ref-uterm-settings-preview-shell-top">
						<span>{t('app.universalTerminalSettings.preview.target')}</span>
						<span>{t('app.universalTerminalSettings.preview.connected')}</span>
					</div>
					<div className="ref-uterm-settings-preview-shell-body">
						<div>
							<span className="ref-uterm-settings-preview-prompt">$</span>npm run dev
						</div>
						<div className="is-dim">ready in 842ms</div>
						<div>
							<span className="ref-uterm-settings-preview-prompt">$</span>git status --short
						</div>
					</div>
				</div>
				<div className="ref-uterm-settings-card">
					<div className="ref-uterm-settings-card-title">{t('app.universalTerminalSettings.displayPresets.title')}</div>
					<p className="ref-uterm-settings-card-copy">{t('app.universalTerminalSettings.displayPresets.hint')}</p>
					<ChipGroup>
						{(['compact', 'balanced', 'presentation'] as TerminalDisplayPresetId[]).map((presetId) => (
							<ChipToggle
								key={presetId}
								active={matchesDisplayPreset(settings, presetId)}
								onClick={() => onPatchSettings(applyTerminalDisplayPreset(settings, presetId))}
							>
								{t(`app.universalTerminalSettings.displayPresets.${presetId}`)}
							</ChipToggle>
						))}
					</ChipGroup>
				</div>
			</div>

			<div className="ref-uterm-settings-card-grid">
				<div className="ref-uterm-settings-card">
					<div className="ref-uterm-settings-card-title">{t('app.universalTerminalSettings.appearanceTypography')}</div>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.fontFamily')}>
							<select
								value={settings.fontFamily}
								onChange={(event) => onPatchSettings({ fontFamily: event.target.value })}
								className="ref-uterm-settings-select"
							>
								{FONT_FAMILY_CHOICES.map((font) => (
									<option key={font.label} value={font.value}>
										{font.label}
									</option>
								))}
							</select>
						</Field>
						<Field label={t('app.universalTerminalSettings.fontSize')}>
							<NumberRow
								value={settings.fontSize}
								min={8}
								max={32}
								step={1}
								onChange={(next) => onPatchSettings({ fontSize: next })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.fontWeight')}>
							<NumberRow
								value={settings.fontWeight}
								min={100}
								max={900}
								step={100}
								onChange={(next) => onPatchSettings({ fontWeight: Math.round(next / 100) * 100 })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.fontWeightBold')}>
							<NumberRow
								value={settings.fontWeightBold}
								min={100}
								max={900}
								step={100}
								onChange={(next) => onPatchSettings({ fontWeightBold: Math.round(next / 100) * 100 })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.lineHeight')}>
							<NumberRow
								value={settings.lineHeight}
								min={1}
								max={2.4}
								step={0.05}
								onChange={(next) => onPatchSettings({ lineHeight: next })}
							/>
						</Field>
					</div>
				</div>

				<div className="ref-uterm-settings-card">
					<div className="ref-uterm-settings-card-title">{t('app.universalTerminalSettings.appearanceCanvas')}</div>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.cursorStyle')}>
							<ChipGroup>
								{(['bar', 'block', 'underline'] as const).map((style) => (
									<ChipToggle
										key={style}
										active={settings.cursorStyle === style}
										onClick={() => onPatchSettings({ cursorStyle: style })}
									>
										{t(`app.universalTerminalSettings.cursor.${style}`)}
									</ChipToggle>
								))}
							</ChipGroup>
						</Field>
						<Field label={t('app.universalTerminalSettings.cursorBlink')}>
							<ToggleSwitch
								checked={settings.cursorBlink}
								onChange={(next) => onPatchSettings({ cursorBlink: next })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.opacity')}>
							<div className="ref-uterm-settings-slider">
								<input
									type="range"
									min={0.6}
									max={1}
									step={0.02}
									value={settings.opacity}
									onChange={(event) => onPatchSettings({ opacity: Number(event.target.value) })}
								/>
								<span className="ref-uterm-settings-slider-value">{Math.round(settings.opacity * 100)}%</span>
							</div>
						</Field>
						<Field
							label={t('app.universalTerminalSettings.minimumContrastRatio')}
							hint={t('app.universalTerminalSettings.minimumContrastRatioHint')}
						>
							<NumberRow
								value={settings.minimumContrastRatio}
								min={1}
								max={21}
								step={0.5}
								onChange={(next) =>
									onPatchSettings({ minimumContrastRatio: Number(next.toFixed(1)) })
								}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.drawBoldTextInBrightColors')}>
							<ToggleSwitch
								checked={settings.drawBoldTextInBrightColors}
								onChange={(next) =>
									onPatchSettings({ drawBoldTextInBrightColors: next })
								}
							/>
						</Field>
					</div>
				</div>
			</div>
		</div>
	);
}

function TerminalBehaviorStage({
	t,
	settings,
	onPatchSettings,
}: {
	t: TFunction;
	settings: TerminalAppSettings;
	onPatchSettings(partial: Partial<TerminalAppSettings>): void;
}) {
	return (
		<div className="ref-uterm-settings-page">
			<div className="ref-uterm-settings-page-head">
				<div>
					<h2 className="ref-uterm-settings-page-title">{t('app.universalTerminalSettings.nav.terminal')}</h2>
					<p className="ref-uterm-settings-page-copy">{t('app.universalTerminalSettings.terminalLead')}</p>
				</div>
			</div>

			<div className="ref-uterm-settings-card-grid">
				<div className="ref-uterm-settings-card">
					<div className="ref-uterm-settings-card-title">{t('app.universalTerminalSettings.behaviorTitle')}</div>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.scrollback')}>
							<NumberRow
								value={settings.scrollback}
								min={100}
								max={100_000}
								step={500}
								onChange={(next) => onPatchSettings({ scrollback: Math.floor(next) })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.scrollOnInput')}>
							<ToggleSwitch
								checked={settings.scrollOnInput}
								onChange={(next) => onPatchSettings({ scrollOnInput: next })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.bell')}>
							<ChipGroup>
								{(['none', 'visual'] as const).map((style) => (
									<ChipToggle
										key={style}
										active={settings.bell === style}
										onClick={() => onPatchSettings({ bell: style })}
									>
										{t(`app.universalTerminalSettings.bell.${style}`)}
									</ChipToggle>
								))}
							</ChipGroup>
						</Field>
					</div>
				</div>

				<div className="ref-uterm-settings-card">
					<div className="ref-uterm-settings-card-title">{t('app.universalTerminalSettings.clipboardTitle')}</div>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.copyOnSelect')}>
							<ToggleSwitch
								checked={settings.copyOnSelect}
								onChange={(next) => onPatchSettings({ copyOnSelect: next })}
							/>
						</Field>
						<Field label={t('app.universalTerminalSettings.rightClickAction')}>
							<ChipGroup>
								{(['off', 'paste', 'clipboard'] as TerminalRightClickAction[]).map((action) => (
									<ChipToggle
										key={action}
										active={settings.rightClickAction === action}
										onClick={() => onPatchSettings({ rightClickAction: action })}
									>
										{t(`app.universalTerminalSettings.rightClick.${action}`)}
									</ChipToggle>
								))}
							</ChipGroup>
						</Field>
						<Field label={t('app.universalTerminalSettings.wordSeparator')} hint={t('app.universalTerminalSettings.wordSeparatorHint')}>
							<input
								type="text"
								className="ref-uterm-settings-input"
								value={settings.wordSeparator}
								onChange={(event) => onPatchSettings({ wordSeparator: event.target.value })}
							/>
						</Field>
					</div>
				</div>
			</div>
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="ref-uterm-settings-field">
			<div>
				<div className="ref-uterm-settings-label">{label}</div>
				{hint ? <p className="ref-uterm-settings-hint">{hint}</p> : null}
			</div>
			<div className="ref-uterm-settings-control">{children}</div>
		</div>
	);
}

function InlineField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="ref-uterm-settings-inline-field">
			<span className="ref-uterm-settings-inline-label">{label}</span>
			{children}
		</label>
	);
}

function SubtabButton({ active, onClick, label }: { active: boolean; onClick(): void; label: string }) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			className={`ref-uterm-settings-subtab ${active ? 'is-active' : ''}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}

function MiniStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="ref-uterm-settings-mini-stat">
			<div className="ref-uterm-settings-mini-stat-label">{label}</div>
			<div className="ref-uterm-settings-mini-stat-value" title={value}>
				{value}
			</div>
		</div>
	);
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange(next: boolean): void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			className={`ref-uterm-settings-toggle ${checked ? 'is-on' : ''}`}
			onClick={() => onChange(!checked)}
		>
			<span className="ref-uterm-settings-toggle-thumb" />
		</button>
	);
}

function NumberRow({
	value,
	min,
	max,
	step,
	onChange,
}: {
	value: number;
	min: number;
	max: number;
	step: number;
	onChange(next: number): void;
}) {
	return (
		<div className="ref-uterm-settings-numberrow">
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<input
				type="number"
				min={min}
				max={max}
				step={step}
				value={value}
				className="ref-uterm-settings-numberinput"
				onChange={(event) => {
					const next = Number(event.target.value);
					if (!Number.isNaN(next)) {
						onChange(next);
					}
				}}
			/>
		</div>
	);
}

function ChipGroup({ children }: { children: ReactNode }) {
	return <div className="ref-uterm-settings-chip-row">{children}</div>;
}

function ChipToggle({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick(): void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className={`ref-uterm-settings-chip ${active ? 'is-active' : ''}`}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function matchesDisplayPreset(settings: TerminalAppSettings, presetId: TerminalDisplayPresetId): boolean {
	const preset = applyTerminalDisplayPreset(settings, presetId);
	return (
		settings.fontSize === preset.fontSize &&
		settings.fontWeight === preset.fontWeight &&
		settings.fontWeightBold === preset.fontWeightBold &&
		settings.lineHeight === preset.lineHeight &&
		settings.minimumContrastRatio === preset.minimumContrastRatio &&
		settings.scrollback === preset.scrollback &&
		settings.opacity === preset.opacity
	);
}

function describeProfileTarget(profile: TerminalProfile, t: TFunction): string {
	return buildTerminalProfileTarget(profile) || t('app.universalTerminalSettings.systemDefaultShell');
}
