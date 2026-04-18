import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import type { TFunction } from '../i18n';
import {
	DEFAULT_PROFILE_ID,
	FONT_FAMILY_CHOICES,
	TERMINAL_COLOR_SCHEMES,
	TERMINAL_SSH_ALGORITHM_OPTIONS,
	applyTerminalDisplayPreset,
	buildTerminalProfileLaunchPreview,
	buildTerminalProfileTarget,
	cloneTerminalProfile,
	countTerminalProfileEnvEntries,
	defaultTerminalSettings,
	getSshIdentityFiles,
	isBuiltinTerminalProfileId,
	newProfileId,
	normalizeTerminalSettings,
	resolveTerminalProfile,
	type TerminalAppSettings,
	type TerminalLoginScript,
	type TerminalPortForward,
	type TerminalPortForwardType,
	type TerminalDisplayPresetId,
	type TerminalProfile,
	type TerminalProfileKind,
	type TerminalRightClickAction,
	type TerminalSshAuthMode,
} from './terminalSettings';

type SettingsNav = 'profilesConnections' | 'appearance' | 'terminal';
type ProfilesSubtab = 'profiles' | 'advanced';
type ProfileEditorMode = 'create' | 'edit';
type ProfileEditorTabId = 'general' | 'ports' | 'advanced' | 'ciphers' | 'colors' | 'loginScripts' | 'input';
type TerminalSshConnectionMode = 'direct' | 'proxyCommand' | 'jumpHost';

export type TerminalSettingsPanelOpenProfileRequest = {
	profileId: string;
	tab: ProfileEditorTabId;
	nonce: number;
};

type Props = {
	t: TFunction;
	settings: TerminalAppSettings;
	builtinProfiles: TerminalProfile[];
	onChange(next: TerminalAppSettings): void;
	onLaunchProfile(profileId: string): void;
	openProfileRequest?: TerminalSettingsPanelOpenProfileRequest | null;
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

function IconProfileTerminal() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<rect x="4" y="5" width="16" height="14" rx="2.2" />
			<path d="M8 10l2.6 2.2L8 14.4M12.6 14.5H16" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconProfileMonitor() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<rect x="4" y="5" width="16" height="11" rx="2.2" />
			<path d="M9 19h6M12 16v3" strokeLinecap="round" />
		</svg>
	);
}

function IconProfileWindows() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<path d="M4 5.3l7.4-1v7H4zm8.6-1.15L20 3v8.3h-7.4zM4 13h7.4v6.9L4 18.9zm8.6 0H20V21l-7.4-1.05z" />
		</svg>
	);
}

function IconProfilePowerShell() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<path d="M5 18l5.5-12h8.5L13.5 18H5z" strokeLinejoin="round" />
			<path d="M8 11.2l3.3 1.5M9.2 15.1h5.2" strokeLinecap="round" />
		</svg>
	);
}

function IconProfileBash() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<path d="M12 3l3.2 3.2L12 9.4 8.8 6.2zM6.2 8.8L9.4 12l-3.2 3.2L3 12zm11.6 0L21 12l-3.2 3.2-3.2-3.2zm-5.8 5.8l3.2 3.2-3.2 3.2-3.2-3.2z" />
		</svg>
	);
}

function IconPlaySmall() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<path d="M8 6.5v11l9-5.5z" />
		</svg>
	);
}

function IconMoreVerticalSmall() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<circle cx="12" cy="5" r="1.9" />
			<circle cx="12" cy="12" r="1.9" />
			<circle cx="12" cy="19" r="1.9" />
		</svg>
	);
}

export const TerminalSettingsPanel = memo(function TerminalSettingsPanel({
	t,
	settings,
	builtinProfiles,
	onChange,
	onLaunchProfile,
	openProfileRequest,
}: Props) {
	const [nav, setNav] = useState<SettingsNav>('profilesConnections');
	const [profilesSubtab, setProfilesSubtab] = useState<ProfilesSubtab>('profiles');
	const [activeProfileId, setActiveProfileId] = useState<string>(settings.profiles[0]?.id ?? DEFAULT_PROFILE_ID);
	const [filter, setFilter] = useState('');
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
		builtin: false,
	});
	const [navPending, startNavTransition] = useTransition();
	const stageRef = useRef<HTMLDivElement | null>(null);

	const patch = useCallback(
		(partial: Partial<TerminalAppSettings>) => {
			onChange(normalizeTerminalSettings({ ...settings, ...partial }));
		},
		[settings, onChange]
	);

	const activeProfile = useMemo(
		() => settings.profiles.find((profile) => profile.id === activeProfileId) ?? settings.profiles[0],
		[settings.profiles, activeProfileId]
	);

	const defaultProfile = useMemo(
		() => resolveTerminalProfile(settings.profiles, settings.defaultProfileId, builtinProfiles),
		[builtinProfiles, settings.defaultProfileId, settings.profiles]
	);

	const displayStats = useMemo(
		() => [
			{
				label: t('app.universalTerminalSettings.summary.defaultProfile'),
				value: defaultProfile ? withTerminalProfileDisplayName(defaultProfile, t).name : t('app.universalTerminalSettings.systemDefaultShell'),
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

	useEffect(() => {
		if (!openProfileRequest) {
			return;
		}
		startNavTransition(() => {
			setNav('profilesConnections');
		});
		setProfilesSubtab('profiles');
		setActiveProfileId(openProfileRequest.profileId);
	}, [openProfileRequest]);

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
						collapsedGroups={collapsedGroups}
						onToggleGroup={(groupId) =>
							setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
						}
						onSelectProfile={setActiveProfileId}
						onPatchSettings={patch}
						onLaunchProfile={onLaunchProfile}
						builtinProfiles={builtinProfiles}
						openProfileRequest={openProfileRequest}
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
	collapsedGroups: Record<string, boolean>;
	onToggleGroup(groupId: string): void;
	onSelectProfile(id: string): void;
	onPatchSettings(partial: Partial<TerminalAppSettings>): void;
	onLaunchProfile(profileId: string): void;
	builtinProfiles: TerminalProfile[];
	openProfileRequest?: TerminalSettingsPanelOpenProfileRequest | null;
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
	collapsedGroups,
	onToggleGroup,
	onSelectProfile,
	onPatchSettings,
	onLaunchProfile,
	builtinProfiles,
	openProfileRequest,
}: ProfilesSettingsStageProps) {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createFilter, setCreateFilter] = useState('');
	const [editorDraft, setEditorDraft] = useState<TerminalProfile | null>(null);
	const [editorMode, setEditorMode] = useState<ProfileEditorMode>('edit');
	const [editorTab, setEditorTab] = useState<ProfileEditorTabId>('general');
	const [editorSshConnectionMode, setEditorSshConnectionMode] = useState<TerminalSshConnectionMode>('direct');
	const [editorHasSavedPassword, setEditorHasSavedPassword] = useState(false);
	const [rowMenuProfileId, setRowMenuProfileId] = useState<string | null>(null);
	const rowMenuRef = useRef<HTMLDivElement | null>(null);
	const handledOpenProfileRequestRef = useRef<number | null>(null);
	const displayBuiltinProfiles = useMemo(
		() => builtinProfiles.map((profile) => withTerminalProfileDisplayName(profile, t)),
		[builtinProfiles, t]
	);
	const filteredCustomProfiles = useMemo(() => {
		return filterProfilesByQuery(settings.profiles, filter, t);
	}, [filter, settings.profiles, t]);
	const customProfileGroups = useMemo(
		() => groupProfilesByCustomGroup(filteredCustomProfiles, t),
		[filteredCustomProfiles, t]
	);
	const filteredBuiltinProfiles = useMemo(() => {
		return filterProfilesByQuery(displayBuiltinProfiles, filter, t);
	}, [displayBuiltinProfiles, filter, t]);
	const createDialogGroups = useMemo(
		() =>
			[
				{
					id: 'builtin' as const,
					label: t('app.universalTerminalSettings.profiles.group.builtin'),
					items: filterProfilesByQuery(displayBuiltinProfiles, createFilter, t),
				},
				{
					id: 'custom' as const,
					label: t('app.universalTerminalSettings.profiles.group.custom'),
					items: filterProfilesByQuery(settings.profiles, createFilter, t),
				},
			].filter((group) => group.items.length > 0),
		[createFilter, displayBuiltinProfiles, settings.profiles, t]
	);
	const editorOpen = Boolean(editorDraft);
	const editorVisual = editorDraft ? getTerminalProfileVisual(editorDraft) : null;
	const sshIncomplete =
		editorDraft?.kind === 'ssh' && (!editorDraft.sshHost.trim() || !editorDraft.sshUser.trim());
	const canDeleteDraft = editorDraft
		? settings.profiles.length > 1 &&
			editorDraft.id !== DEFAULT_PROFILE_ID &&
			settings.profiles.some((profile) => profile.id === editorDraft.id)
		: false;

	const loadPasswordState = useCallback(async (profileId: string) => {
		const shell = window.asyncShell;
		if (!shell || !profileId) {
			setEditorHasSavedPassword(false);
			return;
		}
		const result = (await shell.invoke('term:profilePasswordState', profileId)) as { ok?: boolean; hasPassword?: boolean };
		setEditorHasSavedPassword(Boolean(result?.ok && result.hasPassword));
	}, []);

	const openProfileEditor = useCallback(
		(id: string) => {
			const source = settings.profiles.find((profile) => profile.id === id);
			if (!source) {
				return;
			}
			onSelectProfile(id);
			setCreateDialogOpen(false);
			setRowMenuProfileId(null);
			setEditorMode('edit');
			setEditorTab('general');
			setEditorSshConnectionMode(inferSshConnectionMode(source));
			setEditorHasSavedPassword(false);
			setEditorDraft({ ...source });
			void loadPasswordState(id);
		},
		[loadPasswordState, onSelectProfile, settings.profiles]
	);

	const closeProfileEditor = useCallback(() => {
		if (editorMode === 'create' && editorDraft && !settings.profiles.some((profile) => profile.id === editorDraft.id)) {
			void window.asyncShell?.invoke('term:profilePasswordClear', editorDraft.id);
		}
		setEditorDraft(null);
		setEditorHasSavedPassword(false);
	}, [editorDraft, editorMode, settings.profiles]);

	const openTemplateEditor = useCallback((profileId?: string) => {
		const source = profileId ? resolveTerminalProfile(settings.profiles, profileId, builtinProfiles) : null;
		const draft = source
			? createProfileFromTemplate(settings.profiles, withTerminalProfileDisplayName(source, t), t)
			: createEmptyProfileDraft(settings.profiles, 'local', t);
		setCreateDialogOpen(false);
		setCreateFilter('');
		setRowMenuProfileId(null);
		setEditorMode('create');
		setEditorTab('general');
		setEditorSshConnectionMode(inferSshConnectionMode(draft));
		setEditorHasSavedPassword(false);
		setEditorDraft(draft);
		void loadPasswordState(draft.id);
	}, [builtinProfiles, loadPasswordState, settings.profiles, t]);

	useEffect(() => {
		if (!openProfileRequest) {
			return;
		}
		if (handledOpenProfileRequestRef.current === openProfileRequest.nonce) {
			return;
		}
		handledOpenProfileRequestRef.current = openProfileRequest.nonce;
		setCreateDialogOpen(false);
		setRowMenuProfileId(null);
		if (isBuiltinTerminalProfileId(openProfileRequest.profileId)) {
			openTemplateEditor(openProfileRequest.profileId);
		} else {
			openProfileEditor(openProfileRequest.profileId);
		}
		setEditorTab(openProfileRequest.tab);
	}, [openProfileEditor, openProfileRequest, openTemplateEditor]);

	const openCreateDialog = useCallback(() => {
		setRowMenuProfileId(null);
		setEditorDraft(null);
		setCreateFilter('');
		setCreateDialogOpen(true);
	}, []);

	const patchEditorDraft = useCallback((partial: Partial<TerminalProfile>) => {
		setEditorDraft((current) => (current ? { ...current, ...partial } : current));
	}, []);

	const addLoginScript = useCallback(() => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						loginScripts: [
							...current.loginScripts,
							{ expect: '', send: '', isRegex: false, optional: false } satisfies TerminalLoginScript,
						],
				  }
				: current
		);
	}, []);

	const patchLoginScript = useCallback((index: number, partial: Partial<TerminalLoginScript>) => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						loginScripts: current.loginScripts.map((script, scriptIndex) =>
							scriptIndex === index ? { ...script, ...partial } : script
						),
				  }
				: current
		);
	}, []);

	const removeLoginScript = useCallback((index: number) => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						loginScripts: current.loginScripts.filter((_, scriptIndex) => scriptIndex !== index),
				  }
				: current
		);
	}, []);

	const addForwardedPort = useCallback(() => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						sshForwardedPorts: [
							...current.sshForwardedPorts,
							{
								id: `forward-${Date.now()}`,
								type: 'local',
								host: '127.0.0.1',
								port: 3000,
								targetAddress: '127.0.0.1',
								targetPort: 3000,
								description: '',
							} satisfies TerminalPortForward,
						],
				  }
				: current
		);
	}, []);

	const patchForwardedPort = useCallback((index: number, partial: Partial<TerminalPortForward>) => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						sshForwardedPorts: current.sshForwardedPorts.map((forward, forwardIndex) =>
							forwardIndex === index ? { ...forward, ...partial } : forward
						),
				  }
				: current
		);
	}, []);

	const removeForwardedPort = useCallback((index: number) => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						sshForwardedPorts: current.sshForwardedPorts.filter((_, forwardIndex) => forwardIndex !== index),
				  }
				: current
		);
	}, []);

	const toggleAlgorithm = useCallback(
		(kind: keyof typeof TERMINAL_SSH_ALGORITHM_OPTIONS, algorithm: string) => {
			setEditorDraft((current) => {
				if (!current) {
					return current;
				}
				const active = current.sshAlgorithms[kind];
				const next = active.includes(algorithm)
					? active.filter((item) => item !== algorithm)
					: [...active, algorithm];
				return {
					...current,
					sshAlgorithms: {
						...current.sshAlgorithms,
						[kind]: next,
					},
				};
			});
		},
		[]
	);

	const setEditorPassword = useCallback(async () => {
		if (!editorDraft?.id) {
			return;
		}
		const value = window.prompt(t('app.universalTerminalSettings.profiles.passwordPrompt'), '');
		if (typeof value !== 'string' || !value) {
			return;
		}
		const shell = window.asyncShell;
		if (!shell) {
			return;
		}
		const result = (await shell.invoke('term:profilePasswordSet', editorDraft.id, value)) as { ok?: boolean };
		if (result?.ok) {
			setEditorHasSavedPassword(true);
		}
	}, [editorDraft?.id, t]);

	const clearEditorPassword = useCallback(async () => {
		if (!editorDraft?.id) {
			return;
		}
		if (!window.confirm(t('app.universalTerminalSettings.profiles.passwordClearConfirm'))) {
			return;
		}
		const shell = window.asyncShell;
		if (!shell) {
			return;
		}
		const result = (await shell.invoke('term:profilePasswordClear', editorDraft.id)) as { ok?: boolean };
		if (result?.ok) {
			setEditorHasSavedPassword(false);
		}
	}, [editorDraft?.id, t]);

	const pickPath = useCallback(
		async (opts: {
			kind: 'file' | 'directory';
			title: string;
			multi?: boolean;
			filters?: Array<{ name: string; extensions: string[] }>;
		}): Promise<string[]> => {
			const shell = window.asyncShell;
			if (!shell) {
				return [];
			}
			const result = (await shell.invoke('term:pickPath', opts)) as {
				ok?: boolean;
				path?: string;
				paths?: string[];
			};
			if (!result?.ok) {
				return [];
			}
			return Array.isArray(result.paths)
				? result.paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
				: typeof result.path === 'string' && result.path.trim()
					? [result.path]
					: [];
		},
		[]
	);

	const pickWorkingDirectory = useCallback(async () => {
		const [picked] = await pickPath({
			kind: 'directory',
			title: t('app.universalTerminalSettings.profiles.pickWorkingDirectory'),
		});
		if (picked) {
			patchEditorDraft({ cwd: picked });
		}
	}, [patchEditorDraft, pickPath, t]);

	const pickShellExecutable = useCallback(async () => {
		const [picked] = await pickPath({
			kind: 'file',
			title: t('app.universalTerminalSettings.profiles.pickExecutable'),
		});
		if (picked) {
			patchEditorDraft({ shell: picked });
		}
	}, [patchEditorDraft, pickPath, t]);

	const addPrivateKeys = useCallback(async () => {
		const picked = await pickPath({
			kind: 'file',
			title: t('app.universalTerminalSettings.profiles.pickPrivateKeys'),
			multi: true,
		});
		if (!picked.length) {
			return;
		}
		setEditorDraft((current) =>
			current
				? {
						...current,
						sshIdentityFiles: Array.from(new Set([...getSshIdentityFiles(current), ...picked])),
				  }
				: current
		);
	}, [pickPath, t]);

	const removePrivateKey = useCallback((index: number) => {
		setEditorDraft((current) =>
			current
				? {
						...current,
						sshIdentityFiles: current.sshIdentityFiles.filter((_, itemIndex) => itemIndex !== index),
				  }
				: current
		);
	}, []);

	const saveEditorProfile = useCallback(() => {
		if (!editorDraft) {
			return;
		}
		const nextProfile = applyProfileNameFallback(applySshConnectionMode(editorDraft, editorSshConnectionMode), t);
		const alreadyExists = settings.profiles.some((profile) => profile.id === nextProfile.id);
		const nextProfiles = alreadyExists
			? settings.profiles.map((profile) => (profile.id === nextProfile.id ? nextProfile : profile))
			: [...settings.profiles, nextProfile];
		onPatchSettings({
			profiles: nextProfiles,
			defaultProfileId: settings.defaultProfileId,
		});
		onSelectProfile(nextProfile.id);
		setEditorDraft(null);
	}, [editorDraft, editorSshConnectionMode, onPatchSettings, onSelectProfile, settings.defaultProfileId, settings.profiles, t]);

	const deleteEditorProfile = useCallback(() => {
		if (!editorDraft || !canDeleteDraft) {
			return;
		}
		const remaining = settings.profiles.filter((profile) => profile.id !== editorDraft.id);
		if (!remaining.length) {
			return;
		}
		const nextDefaultProfileId =
			settings.defaultProfileId === editorDraft.id ? remaining[0].id : settings.defaultProfileId;
		onPatchSettings({
			profiles: remaining,
			defaultProfileId: nextDefaultProfileId,
		});
		void window.asyncShell?.invoke('term:profilePasswordClear', editorDraft.id);
		onSelectProfile(remaining[0].id);
		setEditorDraft(null);
		setEditorHasSavedPassword(false);
	}, [canDeleteDraft, editorDraft, onPatchSettings, onSelectProfile, settings.defaultProfileId, settings.profiles]);

	useEffect(() => {
		if (!rowMenuProfileId) {
			return;
		}
		const onMouseDown = (event: MouseEvent) => {
			if (rowMenuRef.current?.contains(event.target as Node)) {
				return;
			}
			setRowMenuProfileId(null);
		};
		document.addEventListener('mousedown', onMouseDown);
		return () => document.removeEventListener('mousedown', onMouseDown);
	}, [rowMenuProfileId]);

	useEffect(() => {
		if (!editorOpen && !createDialogOpen) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setCreateDialogOpen(false);
				setEditorDraft(null);
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [createDialogOpen, editorOpen]);

	useEffect(() => {
		if (profilesSubtab !== 'profiles') {
			setCreateDialogOpen(false);
			setEditorDraft(null);
		}
	}, [profilesSubtab]);

	useEffect(() => {
		setRowMenuProfileId(null);
	}, [filter, activeProfile.id]);

	useEffect(() => {
		if (!editorDraft) {
			return;
		}
		const availableTabs = new Set(getEditorTabsForProfile(editorDraft, t).map((tab) => tab.id));
		if (!availableTabs.has(editorTab)) {
			setEditorTab('general');
		}
	}, [editorDraft, editorTab, t]);

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
					<div className="ref-uterm-settings-default-stack">
						<div className="ref-uterm-settings-default-label">
							{t('app.universalTerminalSettings.profiles.defaultProfileLabel')}
						</div>
						<div className="ref-uterm-settings-default-copy">
							{t('app.universalTerminalSettings.profiles.defaultProfileHint')}
						</div>
						<div className="ref-uterm-settings-default-picker">
							<select
								value={settings.defaultProfileId}
								onChange={(event) => onPatchSettings({ defaultProfileId: event.target.value })}
								className="ref-uterm-settings-select"
							>
								<optgroup label={t('app.universalTerminalSettings.profiles.group.custom')}>
									{settings.profiles.map((profile) => (
										<option key={profile.id} value={profile.id}>
											{withTerminalProfileDisplayName(profile, t).name || t('app.universalTerminalSettings.profiles.untitled')}
										</option>
									))}
								</optgroup>
								<optgroup label={t('app.universalTerminalSettings.profiles.group.builtin')}>
									{displayBuiltinProfiles.map((profile) => (
										<option key={profile.id} value={profile.id}>
											{profile.name}
										</option>
									))}
								</optgroup>
							</select>
						</div>
					</div>

					<div className="ref-uterm-settings-toolbar">
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
							<button
								type="button"
								className="ref-uterm-settings-primary-btn"
								onClick={openCreateDialog}
							>
								<span className="ref-uterm-settings-primary-btn-plus">+</span>
								<span>{t('app.universalTerminalSettings.profiles.newButton')}</span>
							</button>
						</div>
					</div>

					<div className="ref-uterm-settings-profiles-workbench">
						<div className="ref-uterm-settings-profile-list-shell">
							{[
								...customProfileGroups,
								{
									id: 'builtin',
									label: t('app.universalTerminalSettings.profiles.group.builtin'),
									items: filteredBuiltinProfiles,
								},
							].map((group) => (
								<div
									key={group.id}
									className={`ref-uterm-settings-profile-group ${collapsedGroups[group.id] ? 'is-collapsed' : 'is-expanded'}`}
								>
									<button
										type="button"
										className="ref-uterm-settings-profile-group-head"
										aria-expanded={!collapsedGroups[group.id]}
										onClick={() => onToggleGroup(group.id)}
									>
										<span className={`ref-uterm-settings-profile-group-chevron ${collapsedGroups[group.id] ? 'is-collapsed' : ''}`}>
											▾
										</span>
										<span className="ref-uterm-settings-profile-group-label">{group.label}</span>
										<span className="ref-uterm-settings-profile-group-count">{group.items.length}</span>
									</button>
									{!collapsedGroups[group.id] ? (
										group.items.length > 0 ? (
											<div className="ref-uterm-settings-profile-group-body">
												{group.items.map((profile) => {
													const displayProfile = withTerminalProfileDisplayName(profile, t);
													const isBuiltin = isBuiltinTerminalProfileId(profile.id);
													const isActive = !isBuiltin && profile.id === activeProfile.id;
													const visual = getTerminalProfileVisual(displayProfile);
													const menuOpen = rowMenuProfileId === profile.id;
													const canRemove =
														!isBuiltin && settings.profiles.length > 1 && profile.id !== DEFAULT_PROFILE_ID;
													return (
														<div
															key={profile.id}
															role={isBuiltin ? undefined : 'button'}
															tabIndex={isBuiltin ? undefined : 0}
															className={`ref-uterm-settings-profile-list-item ${isActive ? 'is-active' : ''} ${menuOpen ? 'has-menu-open' : ''} ${isBuiltin ? 'is-builtin' : ''}`}
															onClick={() => {
																if (!isBuiltin) {
																	openProfileEditor(profile.id);
																}
															}}
															onKeyDown={(event) => {
																if (isBuiltin) {
																	return;
																}
																if (event.key === 'Enter' || event.key === ' ') {
																	event.preventDefault();
																	openProfileEditor(profile.id);
																}
															}}
														>
															<span className={`ref-uterm-settings-profile-list-item-icon is-${visual.tone}`}>
																{visual.icon}
															</span>
															<div className="ref-uterm-settings-profile-list-item-main">
																<span className="ref-uterm-settings-profile-list-item-title">
																	{displayProfile.name || t('app.universalTerminalSettings.profiles.untitled')}
																</span>
																<span className="ref-uterm-settings-profile-list-item-meta" title={describeProfileTarget(displayProfile, t)}>
																	{describeProfileTarget(displayProfile, t)}
																</span>
															</div>
															<div className="ref-uterm-settings-profile-list-item-actions">
																<button
																	type="button"
																	className="ref-uterm-settings-profile-action-btn"
																	title={t('app.universalTerminalSettings.profiles.open')}
																	aria-label={t('app.universalTerminalSettings.profiles.open')}
																	onClick={(event) => {
																		event.stopPropagation();
																		onLaunchProfile(profile.id);
																	}}
																>
																	<IconPlaySmall />
																</button>
																<div
																	className="ref-uterm-settings-profile-action-menu"
																	ref={menuOpen ? rowMenuRef : null}
																>
																	<button
																		type="button"
																		className={`ref-uterm-settings-profile-action-btn ${menuOpen ? 'is-active' : ''}`}
																		title={t('app.universalTerminalSettings.profileActions')}
																		aria-label={t('app.universalTerminalSettings.profileActions')}
																		onClick={(event) => {
																			event.stopPropagation();
																			setRowMenuProfileId((prev) => (prev === profile.id ? null : profile.id));
																		}}
																	>
																		<IconMoreVerticalSmall />
																	</button>
																	{menuOpen ? (
																		<div className="ref-uterm-dropdown ref-uterm-settings-row-dropdown" role="menu">
																			<button
																				type="button"
																				role="menuitem"
																				className="ref-uterm-dropdown-item"
																				onClick={(event) => {
																					event.stopPropagation();
																					setRowMenuProfileId(null);
																					onLaunchProfile(profile.id);
																				}}
																			>
																				{t('app.universalTerminalSettings.profiles.open')}
																			</button>
																			<button
																				type="button"
																				role="menuitem"
																				className="ref-uterm-dropdown-item"
																				onClick={(event) => {
																					event.stopPropagation();
																					setRowMenuProfileId(null);
																					openTemplateEditor(profile.id);
																				}}
																			>
																				{t('app.universalTerminalSettings.duplicateProfile')}
																			</button>
																			{settings.defaultProfileId !== profile.id ? (
																				<button
																					type="button"
																					role="menuitem"
																					className="ref-uterm-dropdown-item"
																					onClick={(event) => {
																						event.stopPropagation();
																						setRowMenuProfileId(null);
																						onPatchSettings({ defaultProfileId: profile.id });
																					}}
																				>
																					{t('app.universalTerminalSettings.profiles.setDefault')}
																				</button>
																			) : null}
																			{!isBuiltin ? (
																				<button
																					type="button"
																					role="menuitem"
																					className="ref-uterm-dropdown-item"
																					onClick={(event) => {
																						event.stopPropagation();
																						setRowMenuProfileId(null);
																						openProfileEditor(profile.id);
																					}}
																				>
																					{t('app.universalTerminalSettings.profiles.edit')}
																				</button>
																			) : null}
																			{!isBuiltin ? (
																				<button
																					type="button"
																					role="menuitem"
																					className="ref-uterm-dropdown-item ref-uterm-dropdown-item--danger"
																					disabled={!canRemove}
																					onClick={(event) => {
																						event.stopPropagation();
																						setRowMenuProfileId(null);
																						if (!canRemove) {
																							return;
																						}
																						const remaining = settings.profiles.filter((item) => item.id !== profile.id);
																						const nextDefaultProfileId =
																							settings.defaultProfileId === profile.id
																								? remaining[0]?.id ?? DEFAULT_PROFILE_ID
																								: settings.defaultProfileId;
																						onPatchSettings({
																							profiles: remaining,
																							defaultProfileId: nextDefaultProfileId,
																						});
																						void window.asyncShell?.invoke('term:profilePasswordClear', profile.id);
																						if (isActive) {
																							setEditorDraft(null);
																							onSelectProfile(remaining[0]?.id ?? DEFAULT_PROFILE_ID);
																						}
																					}}
																				>
																					{t('app.universalTerminalSettings.profiles.remove')}
																				</button>
																			) : null}
																		</div>
																	) : null}
																</div>
															</div>
															<div className="ref-uterm-settings-profile-list-item-side">
																{settings.defaultProfileId === profile.id ? (
																	<span className="ref-uterm-settings-badge ref-uterm-settings-badge--accent">
																		{t('app.universalTerminalSettings.profiles.defaultBadge')}
																	</span>
																) : null}
																{displayProfile.kind === 'ssh' ? (
																	<span className="ref-uterm-settings-badge ref-uterm-settings-badge--ssh">
																		{t('app.universalTerminalSettings.profiles.kindBadge.ssh')}
																	</span>
																) : null}
															</div>
														</div>
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
					</div>

					{createDialogOpen ? (
						<div className="ref-uterm-settings-modal-layer" role="presentation">
							<button
								type="button"
								className="ref-uterm-settings-modal-backdrop"
								onClick={() => setCreateDialogOpen(false)}
								aria-label={t('app.universalTerminalSettings.closeEditor')}
							/>
							<div className="ref-uterm-settings-modal" role="dialog" aria-modal="true" aria-label={t('app.universalTerminalSettings.profiles.newDialogTitle')}>
								<div className="ref-uterm-settings-modal-shell">
									<div className="ref-uterm-settings-modal-head">
										<div>
											<div className="ref-uterm-settings-modal-title">
												{t('app.universalTerminalSettings.profiles.newDialogTitle')}
											</div>
											<p className="ref-uterm-settings-modal-copy">
												{t('app.universalTerminalSettings.profiles.newDialogCopy')}
											</p>
										</div>
										<button
											type="button"
											className="ref-uterm-settings-secondary-btn"
											onClick={() => setCreateDialogOpen(false)}
										>
											{t('app.universalTerminalSettings.profiles.newDialogCancel')}
										</button>
									</div>

									<div className="ref-uterm-settings-search ref-uterm-settings-modal-search">
										<span className="ref-uterm-settings-search-ico" aria-hidden>
											<IconSearchSmall />
										</span>
										<input
											type="search"
											value={createFilter}
											onChange={(event) => setCreateFilter(event.target.value)}
											placeholder={t('app.universalTerminalSettings.profiles.newDialogSearch')}
											className="ref-uterm-settings-input"
										/>
									</div>

									<div className="ref-uterm-settings-modal-list">
										{createDialogGroups.length > 0 ? (
											createDialogGroups.map((group) => (
												<div key={group.id} className="ref-uterm-settings-modal-section">
													<div className="ref-uterm-settings-modal-section-title">{group.label}</div>
													<div className="ref-uterm-settings-profile-group-body">
														{group.items.map((profile) => {
															const visual = getTerminalProfileVisual(profile);
															return (
																<button
																	key={profile.id}
																	type="button"
																	className="ref-uterm-settings-profile-list-item ref-uterm-settings-profile-list-item--template"
																	onClick={() => openTemplateEditor(profile.id)}
																>
																	<span className={`ref-uterm-settings-profile-list-item-icon is-${visual.tone}`}>
																		{visual.icon}
																	</span>
																	<div className="ref-uterm-settings-profile-list-item-main">
																		<span className="ref-uterm-settings-profile-list-item-title">
																			{profile.name || t('app.universalTerminalSettings.profiles.untitled')}
																		</span>
																		<span
																			className="ref-uterm-settings-profile-list-item-meta"
																			title={describeProfileTarget(profile, t)}
																		>
																			{describeProfileTarget(profile, t)}
																		</span>
																	</div>
																</button>
															);
														})}
													</div>
												</div>
											))
										) : (
											<div className="ref-uterm-settings-modal-empty">
												{t('app.universalTerminalSettings.profiles.newDialogEmpty')}
											</div>
										)}
									</div>
								</div>
							</div>
						</div>
					) : null}

					{editorOpen && editorDraft && editorVisual ? (
						<div className="ref-uterm-settings-drawer-layer" role="presentation">
							<button
								type="button"
								className="ref-uterm-settings-drawer-backdrop"
								onClick={closeProfileEditor}
								aria-label={t('app.universalTerminalSettings.closeEditor')}
							/>
							<div
								className="ref-uterm-settings-profile-modal"
								role="dialog"
								aria-modal="true"
								aria-label={
									editorMode === 'create'
										? t('app.universalTerminalSettings.profiles.editorTitleNew')
										: editorDraft.name || t('app.universalTerminalSettings.profiles.untitled')
								}
							>
								<div className="ref-uterm-settings-profile-modal-shell">
									<div className="ref-uterm-settings-profile-editor-head">
										<div className="ref-uterm-settings-profile-editor-heading">
											<div>
												<div className="ref-uterm-settings-profile-editor-title">
													{editorMode === 'create'
														? t('app.universalTerminalSettings.profiles.editorTitleNew')
														: editorDraft.name || t('app.universalTerminalSettings.profiles.untitled')}
												</div>
											</div>
										</div>
									</div>

									<div className="ref-uterm-settings-profile-modal-body">
										<div className="ref-uterm-settings-profile-modal-sidebar">
											<div className="ref-uterm-settings-profile-side-form">
												<FieldStack label={t('app.universalTerminalSettings.profiles.name')}>
													<input
														type="text"
														autoFocus
														className="ref-uterm-settings-input"
														value={editorDraft.name}
														onChange={(event) => patchEditorDraft({ name: event.target.value })}
													/>
												</FieldStack>

												<FieldStack label={t('app.universalTerminalSettings.profiles.groupLabel')}>
													<input
														type="text"
														className="ref-uterm-settings-input"
														value={editorDraft.group}
														placeholder={t('app.universalTerminalSettings.profiles.groupPlaceholder')}
														onChange={(event) => patchEditorDraft({ group: event.target.value })}
													/>
												</FieldStack>

												<FieldStack label={t('app.universalTerminalSettings.profiles.iconLabel')}>
													<div className="ref-uterm-settings-input-action">
														<input
															type="text"
															className="ref-uterm-settings-input"
															value={editorDraft.icon}
															placeholder={t('app.universalTerminalSettings.profiles.iconPlaceholder')}
															onChange={(event) => patchEditorDraft({ icon: event.target.value })}
														/>
														<div className="ref-uterm-settings-icon-preview" aria-hidden>
															{editorVisual.icon}
														</div>
													</div>
												</FieldStack>

												<FieldStack label={t('app.universalTerminalSettings.profiles.colorLabel')}>
													<input
														type="text"
														className="ref-uterm-settings-input"
														value={editorDraft.color}
														placeholder="#000000"
														onChange={(event) => patchEditorDraft({ color: event.target.value })}
													/>
												</FieldStack>

												<ToggleField
													label={t('app.universalTerminalSettings.profiles.disableDynamicTitle')}
													hint={t('app.universalTerminalSettings.profiles.disableDynamicTitleHint')}
													checked={editorDraft.disableDynamicTitle}
													onChange={(next) => patchEditorDraft({ disableDynamicTitle: next })}
												/>

												<FieldStack
													label={t('app.universalTerminalSettings.profiles.sessionEndBehavior')}
													hint={t('app.universalTerminalSettings.profiles.sessionEndBehaviorHint')}
												>
													<select
														value={editorDraft.behaviorOnSessionEnd}
														onChange={(event) =>
															patchEditorDraft({
																behaviorOnSessionEnd: event.target.value as TerminalProfile['behaviorOnSessionEnd'],
															})
														}
														className="ref-uterm-settings-select"
													>
														<option value="auto">{t('app.universalTerminalSettings.profiles.sessionEnd.auto')}</option>
														<option value="keep">{t('app.universalTerminalSettings.profiles.sessionEnd.keep')}</option>
														<option value="reconnect">{t('app.universalTerminalSettings.profiles.sessionEnd.reconnect')}</option>
														<option value="close">{t('app.universalTerminalSettings.profiles.sessionEnd.close')}</option>
													</select>
												</FieldStack>

												{editorDraft.kind === 'ssh' ? (
													<ToggleField
														label={t('app.universalTerminalSettings.profiles.clearOnConnect')}
														checked={editorDraft.clearServiceMessagesOnConnect}
														onChange={(next) => patchEditorDraft({ clearServiceMessagesOnConnect: next })}
													/>
												) : null}
											</div>

											{sshIncomplete ? (
												<div className="ref-uterm-settings-callout">
													{t('app.universalTerminalSettings.profiles.sshIncomplete')}
												</div>
											) : null}
										</div>

										<div className="ref-uterm-settings-profile-modal-main">
											<div className="ref-uterm-settings-editor-tabs" role="tablist" aria-label={t('app.universalTerminalSettings.profiles.editorTabsLabel')}>
												{getEditorTabsForProfile(editorDraft, t).map((tab) => (
													<button
														key={tab.id}
														type="button"
														role="tab"
														aria-selected={editorTab === tab.id}
														className={`ref-uterm-settings-editor-tab ${editorTab === tab.id ? 'is-active' : ''}`}
														onClick={() => setEditorTab(tab.id)}
													>
														{tab.label}
													</button>
												))}
											</div>
											{editorDraft.kind === 'ssh' ? (
												<>
													{editorTab === 'general' ? (
													<div className="ref-uterm-settings-modal-page">
														<div className="ref-uterm-settings-ssh-grid">
															<FieldStack label={t('app.universalTerminalSettings.profiles.connectionMode')}>
																<select
																	value={editorSshConnectionMode}
																	onChange={(event) =>
																		setEditorSshConnectionMode(event.target.value as TerminalSshConnectionMode)
																	}
																	className="ref-uterm-settings-select"
																>
																	<option value="direct">{t('app.universalTerminalSettings.profiles.connection.direct')}</option>
																	<option value="proxyCommand">{t('app.universalTerminalSettings.profiles.connection.proxyCommand')}</option>
																	<option value="jumpHost">{t('app.universalTerminalSettings.profiles.connection.jumpHost')}</option>
																</select>
															</FieldStack>

															{editorSshConnectionMode !== 'proxyCommand' ? (
																<FieldStack label={t('app.universalTerminalSettings.profiles.sshHost')}>
																	<input
																		type="text"
																		className="ref-uterm-settings-input"
																		value={editorDraft.sshHost}
																		placeholder="192.168.1.201"
																		onChange={(event) => patchEditorDraft({ sshHost: event.target.value })}
																	/>
																</FieldStack>
															) : (
																<FieldStack label={t('app.universalTerminalSettings.profiles.sshProxyCommand')}>
																	<input
																		type="text"
																		className="ref-uterm-settings-input"
																		value={editorDraft.sshProxyCommand}
																		placeholder={t('app.universalTerminalSettings.profiles.sshProxyCommandPlaceholder')}
																		onChange={(event) =>
																			patchEditorDraft({ sshProxyCommand: event.target.value })
																		}
																	/>
																</FieldStack>
															)}

															<FieldStack label={t('app.universalTerminalSettings.profiles.sshPort')}>
																<input
																	type="number"
																	className="ref-uterm-settings-input"
																	min={1}
																	max={65535}
																	value={editorDraft.sshPort}
																	onChange={(event) =>
																		patchEditorDraft({
																			sshPort: Math.max(
																				1,
																				Math.min(65535, Math.floor(Number(event.target.value) || 22))
																			),
																		})
																	}
																/>
															</FieldStack>
														</div>

														{editorSshConnectionMode === 'jumpHost' ? (
															<FieldStack label={t('app.universalTerminalSettings.profiles.sshJumpHost')}>
																<input
																	type="text"
																	className="ref-uterm-settings-input"
																	value={editorDraft.sshJumpHost}
																	placeholder={t('app.universalTerminalSettings.profiles.sshJumpHostPlaceholder')}
																	onChange={(event) => patchEditorDraft({ sshJumpHost: event.target.value })}
																/>
															</FieldStack>
														) : null}

														<FieldStack label={t('app.universalTerminalSettings.profiles.sshUser')}>
															<input
																type="text"
																className="ref-uterm-settings-input"
																value={editorDraft.sshUser}
																placeholder="licl"
																onChange={(event) => patchEditorDraft({ sshUser: event.target.value })}
															/>
														</FieldStack>

														<FieldStack label={t('app.universalTerminalSettings.profiles.sshAuthMode')}>
															<div className="ref-uterm-settings-authbar">
																{(
																	[
																		'auto',
																		'password',
																		'publicKey',
																		'agent',
																		'keyboardInteractive',
																	] as TerminalSshAuthMode[]
																).map((mode) => (
																	<button
																		key={mode}
																		type="button"
																		className={`ref-uterm-settings-authbar-item ${editorDraft.sshAuthMode === mode ? 'is-active' : ''}`}
																		onClick={() => patchEditorDraft({ sshAuthMode: mode })}
																	>
																		<span className="ref-uterm-settings-authbar-icon" aria-hidden>
																			{renderSshAuthGlyph(mode)}
																		</span>
																		<span>{t(`app.universalTerminalSettings.profiles.sshAuth.${mode}`)}</span>
																	</button>
																))}
															</div>
														</FieldStack>

														{editorDraft.sshAuthMode === 'password' ? (
															<div className="ref-uterm-settings-password-row">
																<div>
																	<div className="ref-uterm-settings-profile-meta-label">
																		{t('app.universalTerminalSettings.profiles.passwordLabel')}
																	</div>
																	<div className="ref-uterm-settings-hint">
																		{t('app.universalTerminalSettings.profiles.passwordHint')}
																	</div>
																</div>
																<button
																	type="button"
																	className={editorHasSavedPassword ? 'ref-uterm-settings-danger-btn' : 'ref-uterm-settings-success-btn'}
																	onClick={() => void (editorHasSavedPassword ? clearEditorPassword() : setEditorPassword())}
																>
																	{editorHasSavedPassword
																		? t('app.universalTerminalSettings.profiles.forgetPassword')
																		: t('app.universalTerminalSettings.profiles.setPassword')}
																</button>
															</div>
														) : null}

														<FieldStack label={t('app.universalTerminalSettings.profiles.sshPrivateKeys')}>
															<div className="ref-uterm-settings-stack-control">
																<div className="ref-uterm-settings-pathlist">
																	{getSshIdentityFiles(editorDraft).length > 0 ? (
																		getSshIdentityFiles(editorDraft).map((item, index) => (
																			<div key={`${item}:${index}`} className="ref-uterm-settings-pathlist-item">
																				<span className="ref-uterm-settings-pathlist-text" title={item}>
																					{item}
																				</span>
																				<button
																					type="button"
																					className="ref-uterm-settings-pathlist-remove"
																					onClick={() => removePrivateKey(index)}
																				>
																					{t('app.universalTerminalSettings.profiles.removeKey')}
																				</button>
																			</div>
																		))
																	) : (
																		<div className="ref-uterm-settings-pathlist-empty">
																			{t('app.universalTerminalSettings.profiles.sshPrivateKeysEmpty')}
																		</div>
																	)}
																</div>
																<button type="button" className="ref-uterm-settings-secondary-btn" onClick={() => void addPrivateKeys()}>
																	{t('app.universalTerminalSettings.profiles.pickPrivateKeys')}
																</button>
															</div>
														</FieldStack>
													</div>
													) : null}

													{editorTab === 'advanced' ? (
													<SettingsSection title={t('app.universalTerminalSettings.profiles.editorAdvancedTitle')}>
														<div className="ref-uterm-settings-form">
															<Field label={t('app.universalTerminalSettings.profiles.sshExtraArgs')}>
																<input
																	type="text"
																	className="ref-uterm-settings-input"
																	value={editorDraft.sshExtraArgs}
																	placeholder={t('app.universalTerminalSettings.profiles.sshExtraArgsPlaceholder')}
																	onChange={(event) =>
																		patchEditorDraft({ sshExtraArgs: event.target.value })
																	}
																/>
															</Field>
															<Field label={t('app.universalTerminalSettings.profiles.sshRemoteCommand')}>
																<input
																	type="text"
																	className="ref-uterm-settings-input"
																	value={editorDraft.sshRemoteCommand}
																	placeholder={t('app.universalTerminalSettings.profiles.sshRemoteCommandPlaceholder')}
																	onChange={(event) =>
																		patchEditorDraft({ sshRemoteCommand: event.target.value })
																	}
																/>
															</Field>
															<Field label={t('app.universalTerminalSettings.profiles.cwd')}>
																<div className="ref-uterm-settings-input-action">
																	<input
																		type="text"
																		className="ref-uterm-settings-input"
																		value={editorDraft.cwd}
																		placeholder={t('app.universalTerminalSettings.profiles.cwdPlaceholder')}
																		onChange={(event) => patchEditorDraft({ cwd: event.target.value })}
																	/>
																	<button
																		type="button"
																		className="ref-uterm-settings-secondary-btn ref-uterm-settings-secondary-btn--compact"
																		onClick={() => void pickWorkingDirectory()}
																	>
																		{t('app.universalTerminalSettings.profiles.browse')}
																	</button>
																</div>
															</Field>
															<Field label={t('app.universalTerminalSettings.profiles.sshKeepAliveInterval')}>
																<input
																	type="number"
																	className="ref-uterm-settings-input ref-uterm-settings-input--narrow"
																	min={0}
																	max={86400}
																	value={editorDraft.sshKeepAliveInterval}
																	onChange={(event) =>
																		patchEditorDraft({
																			sshKeepAliveInterval: Math.max(0, Math.floor(Number(event.target.value) || 0)),
																		})
																	}
																/>
															</Field>
															<Field label={t('app.universalTerminalSettings.profiles.sshKeepAliveCountMax')}>
																<input
																	type="number"
																	className="ref-uterm-settings-input ref-uterm-settings-input--narrow"
																	min={1}
																	max={20}
																	value={editorDraft.sshKeepAliveCountMax}
																	onChange={(event) =>
																		patchEditorDraft({
																			sshKeepAliveCountMax: Math.max(1, Math.floor(Number(event.target.value) || 3)),
																		})
																	}
																/>
															</Field>
														</div>
													</SettingsSection>
													) : null}

													{editorTab === 'ports' ? (
														<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.ports')}>
															<div className="ref-uterm-settings-stack-control">
																{editorDraft.sshForwardedPorts.map((forward, index) => (
																	<div key={forward.id} className="ref-uterm-settings-port-card">
																		<div className="ref-uterm-settings-port-grid">
																			<FieldStack label={t('app.universalTerminalSettings.profiles.forward.type')}>
																				<select
																					value={forward.type}
																					onChange={(event) =>
																						patchForwardedPort(index, {
																							type: event.target.value as TerminalPortForwardType,
																						})
																					}
																					className="ref-uterm-settings-select"
																				>
																					<option value="local">{t('app.universalTerminalSettings.profiles.forward.local')}</option>
																					<option value="remote">{t('app.universalTerminalSettings.profiles.forward.remote')}</option>
																					<option value="dynamic">{t('app.universalTerminalSettings.profiles.forward.dynamic')}</option>
																				</select>
																			</FieldStack>
																			<FieldStack label={t('app.universalTerminalSettings.profiles.forward.host')}>
																				<input
																					type="text"
																					className="ref-uterm-settings-input"
																					value={forward.host}
																					onChange={(event) => patchForwardedPort(index, { host: event.target.value })}
																				/>
																			</FieldStack>
																			<FieldStack label={t('app.universalTerminalSettings.profiles.forward.port')}>
																				<input
																					type="number"
																					className="ref-uterm-settings-input"
																					min={0}
																					max={65535}
																					value={forward.port}
																					onChange={(event) =>
																						patchForwardedPort(index, {
																							port: Math.max(0, Math.min(65535, Math.floor(Number(event.target.value) || 0))),
																						})
																					}
																				/>
																			</FieldStack>
																		</div>
																		{forward.type !== 'dynamic' ? (
																			<div className="ref-uterm-settings-port-grid ref-uterm-settings-port-grid--target">
																				<FieldStack label={t('app.universalTerminalSettings.profiles.forward.targetAddress')}>
																					<input
																						type="text"
																						className="ref-uterm-settings-input"
																						value={forward.targetAddress}
																						onChange={(event) =>
																							patchForwardedPort(index, { targetAddress: event.target.value })
																						}
																					/>
																				</FieldStack>
																				<FieldStack label={t('app.universalTerminalSettings.profiles.forward.targetPort')}>
																					<input
																						type="number"
																						className="ref-uterm-settings-input"
																						min={0}
																						max={65535}
																						value={forward.targetPort}
																						onChange={(event) =>
																							patchForwardedPort(index, {
																								targetPort: Math.max(0, Math.min(65535, Math.floor(Number(event.target.value) || 0))),
																							})
																						}
																					/>
																				</FieldStack>
																			</div>
																		) : null}
																		<div className="ref-uterm-settings-port-actions">
																			<button
																				type="button"
																				className="ref-uterm-settings-danger-btn"
																				onClick={() => removeForwardedPort(index)}
																			>
																				{t('app.universalTerminalSettings.profiles.forward.remove')}
																			</button>
																		</div>
																	</div>
																))}
																<button type="button" className="ref-uterm-settings-secondary-btn" onClick={addForwardedPort}>
																	{t('app.universalTerminalSettings.profiles.forward.add')}
																</button>
															</div>
														</SettingsSection>
													) : null}
													{editorTab === 'ciphers' ? (
														<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.ciphers')}>
															<div className="ref-uterm-settings-algorithm-sections">
																{(Object.entries(TERMINAL_SSH_ALGORITHM_OPTIONS) as Array<
																	[keyof typeof TERMINAL_SSH_ALGORITHM_OPTIONS, string[]]
																>).map(([kind, options]) => (
																	<div key={kind} className="ref-uterm-settings-algorithm-group">
																		<div className="ref-uterm-settings-profile-meta-label">
																			{t(`app.universalTerminalSettings.profiles.algorithms.${kind}`)}
																		</div>
																		<div className="ref-uterm-settings-checkbox-grid">
																			{options.map((algorithm) => (
																				<label key={algorithm} className="ref-uterm-settings-checkbox">
																					<input
																						type="checkbox"
																						checked={editorDraft.sshAlgorithms[kind].includes(algorithm)}
																						onChange={() => toggleAlgorithm(kind, algorithm)}
																					/>
																					<span>{algorithm}</span>
																				</label>
																			))}
																		</div>
																	</div>
																))}
															</div>
														</SettingsSection>
													) : null}
													{editorTab === 'colors' ? (
														<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.colors')}>
															<ColorSchemeList
																selectedId={editorDraft.terminalColorSchemeId}
																onSelect={(colorSchemeId) => patchEditorDraft({ terminalColorSchemeId: colorSchemeId })}
															/>
														</SettingsSection>
													) : null}
													{editorTab === 'loginScripts' ? (
														<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.loginScripts')}>
															<div className="ref-uterm-settings-stack-control">
																{editorDraft.loginScripts.map((script, index) => (
																	<div key={`${script.expect}:${index}`} className="ref-uterm-settings-script-row">
																		<input
																			type="text"
																			className="ref-uterm-settings-input"
																			placeholder={t('app.universalTerminalSettings.profiles.login.expect')}
																			value={script.expect}
																			onChange={(event) => patchLoginScript(index, { expect: event.target.value })}
																		/>
																		<input
																			type="text"
																			className="ref-uterm-settings-input"
																			placeholder={t('app.universalTerminalSettings.profiles.login.send')}
																			value={script.send}
																			onChange={(event) => patchLoginScript(index, { send: event.target.value })}
																		/>
																		<div className="ref-uterm-settings-script-options">
																			<label className="ref-uterm-settings-checkbox">
																				<input
																					type="checkbox"
																					checked={script.isRegex}
																					onChange={(event) => patchLoginScript(index, { isRegex: event.target.checked })}
																				/>
																				<span>{t('app.universalTerminalSettings.profiles.login.regex')}</span>
																			</label>
																			<label className="ref-uterm-settings-checkbox">
																				<input
																					type="checkbox"
																					checked={script.optional}
																					onChange={(event) => patchLoginScript(index, { optional: event.target.checked })}
																				/>
																				<span>{t('app.universalTerminalSettings.profiles.login.optional')}</span>
																			</label>
																			<button
																				type="button"
																				className="ref-uterm-settings-danger-btn"
																				onClick={() => removeLoginScript(index)}
																			>
																				{t('app.universalTerminalSettings.profiles.login.remove')}
																			</button>
																		</div>
																	</div>
																))}
																<button type="button" className="ref-uterm-settings-secondary-btn" onClick={addLoginScript}>
																	{t('app.universalTerminalSettings.profiles.login.add')}
																</button>
															</div>
														</SettingsSection>
													) : null}
													{editorTab === 'input' ? (
														<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.input')}>
															<div className="ref-uterm-settings-form">
																<Field label={t('app.universalTerminalSettings.profiles.inputBackspace')}>
																	<select
																		value={editorDraft.inputBackspace}
																		onChange={(event) =>
																			patchEditorDraft({
																				inputBackspace: event.target.value as TerminalProfile['inputBackspace'],
																			})
																		}
																		className="ref-uterm-settings-select"
																	>
																		<option value="backspace">{t('app.universalTerminalSettings.profiles.backspace.backspace')}</option>
																		<option value="ctrl-h">{t('app.universalTerminalSettings.profiles.backspace.ctrl-h')}</option>
																		<option value="ctrl-?">{t('app.universalTerminalSettings.profiles.backspace.ctrl-?')}</option>
																		<option value="delete">{t('app.universalTerminalSettings.profiles.backspace.delete')}</option>
																	</select>
																</Field>
															</div>
														</SettingsSection>
													) : null}
												</>
											) : (
												<>
													{editorTab === 'general' ? (
													<SettingsSection title={t('app.universalTerminalSettings.profiles.editorGeneralTitle')}>
														<div className="ref-uterm-settings-form">
															<Field label={t('app.universalTerminalSettings.profiles.shell')}>
																<div className="ref-uterm-settings-input-action">
																	<input
																		type="text"
																		className="ref-uterm-settings-input"
																		value={editorDraft.shell}
																		placeholder={t('app.universalTerminalSettings.profiles.shellPlaceholder')}
																		onChange={(event) => patchEditorDraft({ shell: event.target.value })}
																	/>
																	<button
																		type="button"
																		className="ref-uterm-settings-secondary-btn ref-uterm-settings-secondary-btn--compact"
																		onClick={() => void pickShellExecutable()}
																	>
																		{t('app.universalTerminalSettings.profiles.browse')}
																	</button>
																</div>
															</Field>
															<Field label={t('app.universalTerminalSettings.profiles.args')}>
																<input
																	type="text"
																	className="ref-uterm-settings-input"
																	value={editorDraft.args}
																	placeholder={t('app.universalTerminalSettings.profiles.argsPlaceholder')}
																	onChange={(event) => patchEditorDraft({ args: event.target.value })}
																/>
															</Field>
															<Field label={t('app.universalTerminalSettings.profiles.cwd')}>
																<div className="ref-uterm-settings-input-action">
																	<input
																		type="text"
																		className="ref-uterm-settings-input"
																		value={editorDraft.cwd}
																		placeholder={t('app.universalTerminalSettings.profiles.cwdPlaceholder')}
																		onChange={(event) => patchEditorDraft({ cwd: event.target.value })}
																	/>
																	<button
																		type="button"
																		className="ref-uterm-settings-secondary-btn ref-uterm-settings-secondary-btn--compact"
																		onClick={() => void pickWorkingDirectory()}
																	>
																		{t('app.universalTerminalSettings.profiles.browse')}
																	</button>
																</div>
															</Field>
														</div>
													</SettingsSection>
													) : null}

													{editorTab === 'colors' ? (
														<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.colors')}>
															<ColorSchemeList
																selectedId={editorDraft.terminalColorSchemeId}
																onSelect={(colorSchemeId) => patchEditorDraft({ terminalColorSchemeId: colorSchemeId })}
															/>
														</SettingsSection>
													) : null}
													{editorTab === 'input' ? (
													<SettingsSection title={t('app.universalTerminalSettings.profiles.tab.input')}>
														<div className="ref-uterm-settings-form">
															<Field label={t('app.universalTerminalSettings.profiles.inputBackspace')}>
																<select
																	value={editorDraft.inputBackspace}
																	onChange={(event) =>
																		patchEditorDraft({
																			inputBackspace: event.target.value as TerminalProfile['inputBackspace'],
																		})
																	}
																	className="ref-uterm-settings-select"
																>
																	<option value="backspace">{t('app.universalTerminalSettings.profiles.backspace.backspace')}</option>
																	<option value="ctrl-h">{t('app.universalTerminalSettings.profiles.backspace.ctrl-h')}</option>
																	<option value="ctrl-?">{t('app.universalTerminalSettings.profiles.backspace.ctrl-?')}</option>
																	<option value="delete">{t('app.universalTerminalSettings.profiles.backspace.delete')}</option>
																</select>
															</Field>
														</div>
													</SettingsSection>
													) : null}
												</>
											)}
										</div>
									</div>

									<div className="ref-uterm-settings-profile-modal-footer">
										<div className="ref-uterm-settings-profile-modal-footer-main">
											{canDeleteDraft ? (
												<button
													type="button"
													className="ref-uterm-settings-danger-btn"
													onClick={deleteEditorProfile}
												>
													{t('app.universalTerminalSettings.profiles.remove')}
												</button>
											) : (
												<div className="ref-uterm-settings-profile-modal-footer-note">
													{t('app.universalTerminalSettings.profiles.editorSaveHint')}
												</div>
											)}
										</div>
										<div className="ref-uterm-settings-profile-modal-footer-actions">
											<button type="button" className="ref-uterm-settings-secondary-btn" onClick={closeProfileEditor}>
												{t('app.universalTerminalSettings.profiles.editorCancel')}
											</button>
											<button type="button" className="ref-uterm-settings-primary-btn" onClick={saveEditorProfile}>
												{t('app.universalTerminalSettings.profiles.editorSave')}
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					) : null}
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
								<optgroup label={t('app.universalTerminalSettings.profiles.group.custom')}>
									{settings.profiles.map((profile) => (
										<option key={profile.id} value={profile.id}>
											{withTerminalProfileDisplayName(profile, t).name || t('app.universalTerminalSettings.profiles.untitled')}
										</option>
									))}
								</optgroup>
								<optgroup label={t('app.universalTerminalSettings.profiles.group.builtin')}>
									{displayBuiltinProfiles.map((profile) => (
										<option key={profile.id} value={profile.id}>
											{profile.name}
										</option>
									))}
								</optgroup>
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
								<button type="button" className="ref-uterm-settings-primary-btn" onClick={openCreateDialog}>
									{t('app.universalTerminalSettings.profiles.newButton')}
								</button>
								<button
									type="button"
									className="ref-uterm-settings-secondary-btn"
									onClick={() => openTemplateEditor('builtin:ssh-template')}
								>
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

			<div className="ref-uterm-settings-sections">
				<SettingsSection
					title={t('app.universalTerminalSettings.displayPresets.title')}
					description={t('app.universalTerminalSettings.displayPresets.hint')}
				>
					<div className="ref-uterm-settings-preview-shell ref-uterm-settings-preview-shell--block" style={previewStyle}>
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
				</SettingsSection>

				<SettingsSection title={t('app.universalTerminalSettings.appearanceTypography')}>
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
				</SettingsSection>

				<SettingsSection title={t('app.universalTerminalSettings.appearanceCanvas')}>
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
				</SettingsSection>
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

			<div className="ref-uterm-settings-sections">
				<SettingsSection title={t('app.universalTerminalSettings.renderingTitle')}>
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
						<Field label={t('app.universalTerminalSettings.drawBoldTextInBrightColors')}>
							<ToggleSwitch
								checked={settings.drawBoldTextInBrightColors}
								onChange={(next) => onPatchSettings({ drawBoldTextInBrightColors: next })}
							/>
						</Field>
					</div>
				</SettingsSection>

				<SettingsSection title={t('app.universalTerminalSettings.mouseTitle')}>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.rightClickAction')}>
							<ChipGroup>
								{(['off', 'menu', 'paste', 'clipboard'] as TerminalRightClickAction[]).map((action) => (
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
						<Field label={t('app.universalTerminalSettings.pasteOnMiddleClick')}>
							<ToggleSwitch
								checked={settings.pasteOnMiddleClick}
								onChange={(next) => onPatchSettings({ pasteOnMiddleClick: next })}
							/>
						</Field>
						<Field
							label={t('app.universalTerminalSettings.wordSeparator')}
							hint={t('app.universalTerminalSettings.wordSeparatorHint')}
						>
							<input
								type="text"
								className="ref-uterm-settings-input"
								value={settings.wordSeparator}
								onChange={(event) => onPatchSettings({ wordSeparator: event.target.value })}
							/>
						</Field>
					</div>
				</SettingsSection>

				<SettingsSection title={t('app.universalTerminalSettings.clipboardTitle')}>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.copyOnSelect')}>
							<ToggleSwitch
								checked={settings.copyOnSelect}
								onChange={(next) => onPatchSettings({ copyOnSelect: next })}
							/>
						</Field>
						<Field
							label={t('app.universalTerminalSettings.bracketedPaste')}
							hint={t('app.universalTerminalSettings.bracketedPasteHint')}
						>
							<ToggleSwitch
								checked={settings.bracketedPaste}
								onChange={(next) => onPatchSettings({ bracketedPaste: next })}
							/>
						</Field>
						<Field
							label={t('app.universalTerminalSettings.warnOnMultilinePaste')}
							hint={t('app.universalTerminalSettings.warnOnMultilinePasteHint')}
						>
							<ToggleSwitch
								checked={settings.warnOnMultilinePaste}
								onChange={(next) => onPatchSettings({ warnOnMultilinePaste: next })}
							/>
						</Field>
						<Field
							label={t('app.universalTerminalSettings.trimWhitespaceOnPaste')}
							hint={t('app.universalTerminalSettings.trimWhitespaceOnPasteHint')}
						>
							<ToggleSwitch
								checked={settings.trimWhitespaceOnPaste}
								onChange={(next) => onPatchSettings({ trimWhitespaceOnPaste: next })}
							/>
						</Field>
					</div>
				</SettingsSection>

				<SettingsSection title={t('app.universalTerminalSettings.soundTitle')}>
					<div className="ref-uterm-settings-form">
						<Field label={t('app.universalTerminalSettings.bell')}>
							<ChipGroup>
								{(['none', 'visual', 'audible'] as const).map((style) => (
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
				</SettingsSection>

				<SettingsSection title={t('app.universalTerminalSettings.startupTitle')}>
					<div className="ref-uterm-settings-form">
						<Field
							label={t('app.universalTerminalSettings.autoOpen')}
							hint={t('app.universalTerminalSettings.autoOpenHint')}
						>
							<ToggleSwitch
								checked={settings.autoOpen}
								onChange={(next) => onPatchSettings({ autoOpen: next })}
							/>
						</Field>
						<Field
							label={t('app.universalTerminalSettings.restoreTabs')}
							hint={t('app.universalTerminalSettings.restoreTabsHint')}
						>
							<ToggleSwitch
								checked={settings.restoreTabs}
								onChange={(next) => onPatchSettings({ restoreTabs: next })}
							/>
						</Field>
					</div>
				</SettingsSection>
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

function FieldStack({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="ref-uterm-settings-fieldstack">
			<div className="ref-uterm-settings-label">{label}</div>
			{hint ? <p className="ref-uterm-settings-hint">{hint}</p> : null}
			<div>{children}</div>
		</div>
	);
}

function ToggleField({
	label,
	hint,
	checked,
	onChange,
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange(next: boolean): void;
}) {
	return (
		<div className="ref-uterm-settings-toggle-field">
			<div>
				<div className="ref-uterm-settings-label">{label}</div>
				{hint ? <p className="ref-uterm-settings-hint">{hint}</p> : null}
			</div>
			<ToggleSwitch checked={checked} onChange={onChange} />
		</div>
	);
}

function SettingsSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="ref-uterm-settings-section">
			<h3 className="ref-uterm-settings-section-title">{title}</h3>
			{description ? <p className="ref-uterm-settings-section-copy">{description}</p> : null}
			<div className="ref-uterm-settings-section-body">{children}</div>
		</section>
	);
}

function ColorSchemeList({
	selectedId,
	onSelect,
}: {
	selectedId: string;
	onSelect(colorSchemeId: string): void;
}) {
	return (
		<div className="ref-uterm-settings-color-list">
			{TERMINAL_COLOR_SCHEMES.map((scheme) => (
				<button
					key={scheme.id}
					type="button"
					className={`ref-uterm-settings-color-card ${selectedId === scheme.id ? 'is-active' : ''}`}
					onClick={() => onSelect(scheme.id)}
				>
					<div className="ref-uterm-settings-color-card-title">{scheme.name}</div>
					<div
						className="ref-uterm-settings-color-preview"
						style={{ backgroundColor: scheme.background, color: scheme.foreground }}
					>
						<div>
							<span style={{ color: scheme.colors[2] }}>john</span>
							<span style={{ color: scheme.colors[6] }}>@</span>
							<span style={{ color: scheme.colors[4] }}>host</span>
							<strong style={{ color: scheme.colors[1] }}> $</strong>
							<span> ls</span>
						</div>
						<div>
							<span>-rwxr-xr-x 1 root </span>
							<strong style={{ color: scheme.colors[3] }}>Documents</strong>
						</div>
						<div>
							<span>-rwxr-xr-x 1 root </span>
							<strong style={{ color: scheme.colors[12] }}>Music</strong>
						</div>
					</div>
				</button>
			))}
		</div>
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

function filterProfilesByQuery(profiles: TerminalProfile[], query: string, t: TFunction): TerminalProfile[] {
	const q = query.trim().toLowerCase();
	if (!q) {
		return profiles;
	}
	return profiles.filter((profile) =>
		[
			withTerminalProfileDisplayName(profile, t).name,
			describeProfileTarget(profile, t),
			buildTerminalProfileLaunchPreview(profile),
		]
			.join(' ')
			.toLowerCase()
			.includes(q)
	);
}

function groupProfilesByCustomGroup(
	profiles: TerminalProfile[],
	t: TFunction
): Array<{ id: string; label: string; items: TerminalProfile[] }> {
	const groups = new Map<string, TerminalProfile[]>();
	for (const profile of profiles) {
		const key = profile.group.trim();
		const bucketKey = key || '';
		const bucket = groups.get(bucketKey) ?? [];
		bucket.push(profile);
		groups.set(bucketKey, bucket);
	}
	return Array.from(groups.entries())
		.sort(([a], [b]) => {
			if (!a && b) {
				return -1;
			}
			if (a && !b) {
				return 1;
			}
			return a.localeCompare(b);
		})
		.map(([groupName, items]) => ({
			id: `custom:${groupName || 'ungrouped'}`,
			label: groupName || t('app.universalTerminalSettings.profiles.group.custom'),
			items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
		}));
}

function getEditorTabsForProfile(
	profile: TerminalProfile,
	t: TFunction
): Array<{ id: ProfileEditorTabId; label: string }> {
	if (profile.kind === 'ssh') {
		return [
			{ id: 'general', label: t('app.universalTerminalSettings.profiles.tab.general') },
			{ id: 'ports', label: t('app.universalTerminalSettings.profiles.tab.ports') },
			{ id: 'advanced', label: t('app.universalTerminalSettings.profiles.tab.advanced') },
			{ id: 'ciphers', label: t('app.universalTerminalSettings.profiles.tab.ciphers') },
			{ id: 'colors', label: t('app.universalTerminalSettings.profiles.tab.colors') },
			{ id: 'loginScripts', label: t('app.universalTerminalSettings.profiles.tab.loginScripts') },
			{ id: 'input', label: t('app.universalTerminalSettings.profiles.tab.input') },
		];
	}
	return [
		{ id: 'general', label: t('app.universalTerminalSettings.profiles.tab.general') },
		{ id: 'colors', label: t('app.universalTerminalSettings.profiles.tab.colors') },
		{ id: 'input', label: t('app.universalTerminalSettings.profiles.tab.input') },
	];
}

function inferSshConnectionMode(profile: TerminalProfile): TerminalSshConnectionMode {
	if (profile.sshProxyCommand.trim()) {
		return 'proxyCommand';
	}
	if (profile.sshJumpHost.trim()) {
		return 'jumpHost';
	}
	return 'direct';
}

function applySshConnectionMode(profile: TerminalProfile, mode: TerminalSshConnectionMode): TerminalProfile {
	if (profile.kind !== 'ssh') {
		return profile;
	}
	if (mode === 'direct') {
		return {
			...profile,
			sshProxyCommand: '',
			sshJumpHost: '',
		};
	}
	if (mode === 'proxyCommand') {
		return {
			...profile,
			sshJumpHost: '',
		};
	}
	return {
		...profile,
		sshProxyCommand: '',
	};
}

function renderSshAuthGlyph(mode: TerminalSshAuthMode): string {
	return {
		auto: '?',
		password: 'A',
		publicKey: 'K',
		agent: 'G',
		keyboardInteractive: 'T',
	}[mode];
}

function createEmptyProfileDraft(
	existing: TerminalProfile[],
	kind: TerminalProfileKind,
	t: TFunction
): TerminalProfile {
	return {
		...defaultTerminalSettings().profiles[0],
		id: newProfileId(existing),
		name:
			kind === 'ssh'
				? t('app.universalTerminalSettings.profiles.newSshName')
				: t('app.universalTerminalSettings.profiles.untitled'),
		group: '',
		kind,
	};
}

function createProfileFromTemplate(existing: TerminalProfile[], profile: TerminalProfile, t: TFunction): TerminalProfile {
	const next = cloneTerminalProfile(existing, profile);
	next.name = suggestDerivedProfileName(profile, t);
	return next;
}

function applyProfileNameFallback(profile: TerminalProfile, t: TFunction): TerminalProfile {
	const identityFiles = getSshIdentityFiles(profile);
	return {
		...profile,
		group: profile.group.trim(),
		sshIdentityFiles: identityFiles,
		sshIdentityFile: identityFiles[0] ?? '',
		name:
			profile.name.trim() ||
			(profile.kind === 'ssh'
				? t('app.universalTerminalSettings.profiles.newSshName')
				: t('app.universalTerminalSettings.profiles.untitled')),
	};
}

function suggestDerivedProfileName(profile: TerminalProfile, t: TFunction): string {
	const fallbackName =
		profile.kind === 'ssh'
			? t('app.universalTerminalSettings.profiles.newSshName')
			: t('app.universalTerminalSettings.profiles.untitled');
	const baseName = profile.name.trim() || fallbackName;
	if (profile.builtinKey === 'sshConnection') {
		return t('app.universalTerminalSettings.profiles.newSshName');
	}
	if (isBuiltinTerminalProfileId(profile.id)) {
		return baseName;
	}
	return `${baseName} Copy`;
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

function withTerminalProfileDisplayName(profile: TerminalProfile, t: TFunction): TerminalProfile {
	if (!profile.builtinKey) {
		return profile;
	}
	return {
		...profile,
		name: t(`app.universalTerminalSettings.builtin.${profile.builtinKey}`),
	};
}

function getTerminalProfileVisual(profile: TerminalProfile): { icon: ReactNode; tone: 'terminal' | 'windows' | 'powershell' | 'bash' | 'ssh' } {
	if (profile.kind === 'ssh') {
		return {
			icon: <IconProfileMonitor />,
			tone: 'ssh',
		};
	}
	const shellHint = `${profile.name} ${profile.shell}`.toLowerCase();
	if (shellHint.includes('powershell') || shellHint.includes('pwsh')) {
		return {
			icon: <IconProfilePowerShell />,
			tone: 'powershell',
		};
	}
	if (shellHint.includes('bash') || shellHint.includes('git') || shellHint.includes('wsl')) {
		return {
			icon: <IconProfileBash />,
			tone: 'bash',
		};
	}
	if (shellHint.includes('cmd') || shellHint.includes('command prompt')) {
		return {
			icon: <IconProfileWindows />,
			tone: 'windows',
		};
	}
	return {
		icon: <IconProfileTerminal />,
		tone: 'terminal',
	};
}
