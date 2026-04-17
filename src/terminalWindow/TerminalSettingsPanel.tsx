import { memo, useCallback, useMemo, useState } from 'react';
import type { TFunction } from '../i18n';
import {
	DEFAULT_PROFILE_ID,
	FONT_FAMILY_CHOICES,
	newProfileId,
	type TerminalAppSettings,
	type TerminalProfile,
	type TerminalProfileKind,
} from './terminalSettings';

type Section = 'profilesConnections' | 'displayBehavior';

type Props = {
	t: TFunction;
	settings: TerminalAppSettings;
	onChange(next: TerminalAppSettings): void;
	onClose(): void;
};

export const TerminalSettingsPanel = memo(function TerminalSettingsPanel({ t, settings, onChange, onClose }: Props) {
	const [section, setSection] = useState<Section>('profilesConnections');
	const [activeProfileId, setActiveProfileId] = useState<string>(settings.defaultProfileId);

	const patch = useCallback(
		(partial: Partial<TerminalAppSettings>) => {
			onChange({ ...settings, ...partial });
		},
		[settings, onChange]
	);

	const activeProfile = useMemo(
		() => settings.profiles.find((p) => p.id === activeProfileId) ?? settings.profiles[0],
		[settings.profiles, activeProfileId]
	);

	const patchProfile = useCallback(
		(id: string, partial: Partial<TerminalProfile>) => {
			const nextProfiles = settings.profiles.map((p) => (p.id === id ? { ...p, ...partial } : p));
			patch({ profiles: nextProfiles });
		},
		[patch, settings.profiles]
	);

	const addProfile = useCallback(() => {
		const id = newProfileId(settings.profiles);
		const next: TerminalProfile = {
			id,
			name: t('app.universalTerminalSettings.profiles.untitled'),
			kind: 'local',
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
	}, [patch, settings.profiles, t]);

	const removeProfile = useCallback(
		(id: string) => {
			if (settings.profiles.length <= 1) {
				return;
			}
			const remaining = settings.profiles.filter((p) => p.id !== id);
			const nextDefault =
				settings.defaultProfileId === id ? remaining[0].id : settings.defaultProfileId;
			patch({ profiles: remaining, defaultProfileId: nextDefault });
			setActiveProfileId(remaining[0].id);
		},
		[patch, settings.profiles, settings.defaultProfileId]
	);

	return (
		<div className="ref-uterm-settings-backdrop" role="dialog" aria-modal="true">
			<div
				className="ref-uterm-settings-scrim"
				onClick={onClose}
				aria-label={t('common.close')}
			/>
			<div className="ref-uterm-settings-panel" role="document">
				<div className="ref-uterm-settings-head">
					<h2 className="ref-uterm-settings-title">{t('app.universalTerminalSettings.title')}</h2>
					<button
						type="button"
						className="ref-uterm-settings-close"
						onClick={onClose}
						aria-label={t('common.close')}
					>
						×
					</button>
				</div>
				<div className="ref-uterm-settings-body">
					<nav className="ref-uterm-settings-nav" aria-label={t('app.universalTerminalSettings.title')}>
						<SectionButton
							active={section === 'profilesConnections'}
							onClick={() => setSection('profilesConnections')}
							label={t('app.universalTerminalSettings.nav.profilesConnections')}
						/>
						<SectionButton
							active={section === 'displayBehavior'}
							onClick={() => setSection('displayBehavior')}
							label={t('app.universalTerminalSettings.nav.displayBehavior')}
						/>
					</nav>
					<div className="ref-uterm-settings-content">
						{section === 'profilesConnections' && (
							<ProfilesSection
								t={t}
								settings={settings}
								patch={patch}
								patchProfile={patchProfile}
								addProfile={addProfile}
								removeProfile={removeProfile}
								activeProfile={activeProfile}
								setActiveProfileId={setActiveProfileId}
							/>
						)}
						{section === 'displayBehavior' && (
							<div className="ref-uterm-settings-display-behavior">
								<h3 className="ref-uterm-settings-subhead">
									{t('app.universalTerminalSettings.nav.appearance')}
								</h3>
								<AppearanceSection t={t} settings={settings} patch={patch} />
								<h3 className="ref-uterm-settings-subhead ref-uterm-settings-subhead--spaced">
									{t('app.universalTerminalSettings.nav.terminal')}
								</h3>
								<TerminalSection t={t} settings={settings} patch={patch} />
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
});

function SectionButton({ active, onClick, label }: { active: boolean; onClick(): void; label: string }) {
	return (
		<button
			type="button"
			className={`ref-uterm-settings-navbtn ${active ? 'is-active' : ''}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}

type SectionProps = {
	t: TFunction;
	settings: TerminalAppSettings;
	patch(partial: Partial<TerminalAppSettings>): void;
};

function AppearanceSection({ t, settings, patch }: SectionProps) {
	return (
		<div className="ref-uterm-settings-section">
			<Field label={t('app.universalTerminalSettings.fontFamily')}>
				<select
					value={settings.fontFamily}
					onChange={(e) => patch({ fontFamily: e.target.value })}
					className="ref-uterm-settings-select"
				>
					{FONT_FAMILY_CHOICES.map((f) => (
						<option key={f.label} value={f.value}>
							{f.label}
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
					onChange={(v) => patch({ fontSize: v })}
				/>
			</Field>
			<Field label={t('app.universalTerminalSettings.lineHeight')}>
				<NumberRow
					value={settings.lineHeight}
					min={1}
					max={2.4}
					step={0.05}
					onChange={(v) => patch({ lineHeight: v })}
				/>
			</Field>
			<Field label={t('app.universalTerminalSettings.cursorStyle')}>
				<div className="ref-uterm-settings-radiorow">
					{(['bar', 'block', 'underline'] as const).map((style) => (
						<label
							key={style}
							className={`ref-uterm-settings-radio ${settings.cursorStyle === style ? 'is-active' : ''}`}
						>
							<input
								type="radio"
								name="uterm-cursor"
								value={style}
								checked={settings.cursorStyle === style}
								onChange={() => patch({ cursorStyle: style })}
							/>
							<span>{t(`app.universalTerminalSettings.cursor.${style}`)}</span>
						</label>
					))}
				</div>
			</Field>
			<Field label={t('app.universalTerminalSettings.cursorBlink')}>
				<ToggleSwitch
					checked={settings.cursorBlink}
					onChange={(v) => patch({ cursorBlink: v })}
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
						onChange={(e) => patch({ opacity: Number(e.target.value) })}
					/>
					<span className="ref-uterm-settings-slider-value">{Math.round(settings.opacity * 100)}%</span>
				</div>
			</Field>
		</div>
	);
}

function TerminalSection({ t, settings, patch }: SectionProps) {
	return (
		<div className="ref-uterm-settings-section">
			<Field label={t('app.universalTerminalSettings.scrollback')}>
				<NumberRow
					value={settings.scrollback}
					min={100}
					max={100_000}
					step={500}
					onChange={(v) => patch({ scrollback: Math.floor(v) })}
				/>
			</Field>
			<Field label={t('app.universalTerminalSettings.copyOnSelect')}>
				<ToggleSwitch
					checked={settings.copyOnSelect}
					onChange={(v) => patch({ copyOnSelect: v })}
				/>
			</Field>
			<Field label={t('app.universalTerminalSettings.rightClickPaste')}>
				<ToggleSwitch
					checked={settings.rightClickPaste}
					onChange={(v) => patch({ rightClickPaste: v })}
				/>
			</Field>
			<Field label={t('app.universalTerminalSettings.bell')}>
				<div className="ref-uterm-settings-radiorow">
					{(['none', 'visual'] as const).map((style) => (
						<label
							key={style}
							className={`ref-uterm-settings-radio ${settings.bell === style ? 'is-active' : ''}`}
						>
							<input
								type="radio"
								name="uterm-bell"
								value={style}
								checked={settings.bell === style}
								onChange={() => patch({ bell: style })}
							/>
							<span>{t(`app.universalTerminalSettings.bell.${style}`)}</span>
						</label>
					))}
				</div>
			</Field>
		</div>
	);
}

type ProfilesSectionProps = SectionProps & {
	patchProfile(id: string, partial: Partial<TerminalProfile>): void;
	addProfile(): void;
	removeProfile(id: string): void;
	activeProfile: TerminalProfile;
	setActiveProfileId(id: string): void;
};

function ProfilesSection({
	t,
	settings,
	patch,
	patchProfile,
	addProfile,
	removeProfile,
	activeProfile,
	setActiveProfileId,
}: ProfilesSectionProps) {
	const sshIncomplete =
		activeProfile.kind === 'ssh' &&
		(!activeProfile.sshHost.trim() || !activeProfile.sshUser.trim());

	return (
		<div className="ref-uterm-settings-section ref-uterm-settings-profiles">
			<p className="ref-uterm-settings-lead">{t('app.universalTerminalSettings.profiles.lead')}</p>
			<div className="ref-uterm-settings-profiles-head">
				<span className="ref-uterm-settings-profiles-hint">
					{t('app.universalTerminalSettings.profiles.hint')}
				</span>
				<button type="button" className="ref-uterm-settings-btn-ghost" onClick={addProfile}>
					+ {t('app.universalTerminalSettings.profiles.add')}
				</button>
			</div>
			<div className="ref-uterm-settings-profiles-grid">
				<ul className="ref-uterm-settings-profiles-list" role="tablist">
					{settings.profiles.map((p) => {
						const isActive = p.id === activeProfile.id;
						const isDefault = p.id === settings.defaultProfileId;
						return (
							<li key={p.id} className="ref-uterm-settings-profile-row">
								<button
									type="button"
									className={`ref-uterm-settings-profile-item ${isActive ? 'is-active' : ''}`}
									onClick={() => setActiveProfileId(p.id)}
									role="tab"
									aria-selected={isActive}
								>
									<span className="ref-uterm-settings-profile-name">{p.name}</span>
									<span className="ref-uterm-settings-profile-meta">
										{p.kind === 'ssh'
											? t('app.universalTerminalSettings.profiles.kindBadge.ssh')
											: t('app.universalTerminalSettings.profiles.kindBadge.local')}
									</span>
									{isDefault && (
										<span className="ref-uterm-settings-profile-default-badge">
											{t('app.universalTerminalSettings.profiles.defaultBadge')}
										</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
				<div className="ref-uterm-settings-profile-editor">
					{sshIncomplete ? (
						<div className="ref-uterm-settings-callout" role="status">
							{t('app.universalTerminalSettings.profiles.sshIncomplete')}
						</div>
					) : null}
					<Field label={t('app.universalTerminalSettings.profiles.name')}>
						<input
							type="text"
							className="ref-uterm-settings-input"
							value={activeProfile.name}
							onChange={(e) => patchProfile(activeProfile.id, { name: e.target.value })}
						/>
					</Field>
					<Field label={t('app.universalTerminalSettings.profiles.connectionKind')}>
						<div className="ref-uterm-settings-radiorow">
							{(['local', 'ssh'] as const).map((k: TerminalProfileKind) => (
								<label
									key={k}
									className={`ref-uterm-settings-radio ${activeProfile.kind === k ? 'is-active' : ''}`}
								>
									<input
										type="radio"
										name="uterm-profile-kind"
										value={k}
										checked={activeProfile.kind === k}
										onChange={() => patchProfile(activeProfile.id, { kind: k })}
									/>
									<span>{t(`app.universalTerminalSettings.profiles.kind.${k}`)}</span>
								</label>
							))}
						</div>
					</Field>

					{activeProfile.kind === 'ssh' ? (
						<div className="ref-uterm-settings-connection-block">
							<Field label={t('app.universalTerminalSettings.profiles.sshHost')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder="example.com"
									value={activeProfile.sshHost}
									onChange={(e) => patchProfile(activeProfile.id, { sshHost: e.target.value })}
								/>
							</Field>
							<Field label={t('app.universalTerminalSettings.profiles.sshPort')}>
								<input
									type="number"
									className="ref-uterm-settings-input ref-uterm-settings-input--narrow"
									min={1}
									max={65535}
									value={activeProfile.sshPort}
									onChange={(e) =>
										patchProfile(activeProfile.id, {
											sshPort: Math.floor(Number(e.target.value) || 22),
										})
									}
								/>
							</Field>
							<Field label={t('app.universalTerminalSettings.profiles.sshUser')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder="ubuntu"
									value={activeProfile.sshUser}
									onChange={(e) => patchProfile(activeProfile.id, { sshUser: e.target.value })}
								/>
							</Field>
							<Field label={t('app.universalTerminalSettings.profiles.sshIdentityFile')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder={t('app.universalTerminalSettings.profiles.sshIdentityPlaceholder')}
									value={activeProfile.sshIdentityFile}
									onChange={(e) =>
										patchProfile(activeProfile.id, { sshIdentityFile: e.target.value })
									}
								/>
							</Field>
							<Field label={t('app.universalTerminalSettings.profiles.sshExtraArgs')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder={t('app.universalTerminalSettings.profiles.sshExtraArgsPlaceholder')}
									value={activeProfile.sshExtraArgs}
									onChange={(e) =>
										patchProfile(activeProfile.id, { sshExtraArgs: e.target.value })
									}
								/>
							</Field>
							<Field label={t('app.universalTerminalSettings.profiles.sshRemoteCommand')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder={t('app.universalTerminalSettings.profiles.sshRemoteCommandPlaceholder')}
									value={activeProfile.sshRemoteCommand}
									onChange={(e) =>
										patchProfile(activeProfile.id, { sshRemoteCommand: e.target.value })
									}
								/>
							</Field>
						</div>
					) : (
						<div className="ref-uterm-settings-connection-block">
							<Field label={t('app.universalTerminalSettings.profiles.shell')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder={t('app.universalTerminalSettings.profiles.shellPlaceholder')}
									value={activeProfile.shell}
									onChange={(e) => patchProfile(activeProfile.id, { shell: e.target.value })}
								/>
							</Field>
							<Field label={t('app.universalTerminalSettings.profiles.args')}>
								<input
									type="text"
									className="ref-uterm-settings-input"
									placeholder={t('app.universalTerminalSettings.profiles.argsPlaceholder')}
									value={activeProfile.args}
									onChange={(e) => patchProfile(activeProfile.id, { args: e.target.value })}
								/>
							</Field>
						</div>
					)}

					<Field label={t('app.universalTerminalSettings.profiles.cwd')}>
						<input
							type="text"
							className="ref-uterm-settings-input"
							placeholder={t('app.universalTerminalSettings.profiles.cwdPlaceholder')}
							value={activeProfile.cwd}
							onChange={(e) => patchProfile(activeProfile.id, { cwd: e.target.value })}
						/>
					</Field>
					<Field label={t('app.universalTerminalSettings.profiles.env')}>
						<textarea
							className="ref-uterm-settings-textarea"
							rows={4}
							placeholder={'NODE_ENV=dev\nMY_VAR=value'}
							value={activeProfile.env}
							onChange={(e) => patchProfile(activeProfile.id, { env: e.target.value })}
						/>
					</Field>
					<div className="ref-uterm-settings-profile-footer">
						<label className="ref-uterm-settings-inline-check">
							<input
								type="checkbox"
								checked={settings.defaultProfileId === activeProfile.id}
								onChange={(e) => {
									if (e.target.checked) {
										patch({ defaultProfileId: activeProfile.id });
									}
								}}
							/>
							<span>{t('app.universalTerminalSettings.profiles.setDefault')}</span>
						</label>
						<button
							type="button"
							className="ref-uterm-settings-btn-danger"
							disabled={
								settings.profiles.length <= 1 || activeProfile.id === DEFAULT_PROFILE_ID
							}
							onClick={() => removeProfile(activeProfile.id)}
						>
							{t('app.universalTerminalSettings.profiles.remove')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="ref-uterm-settings-field">
			<span className="ref-uterm-settings-label">{label}</span>
			<div className="ref-uterm-settings-control">{children}</div>
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
				onChange={(e) => onChange(Number(e.target.value))}
			/>
			<input
				type="number"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => {
					const v = Number(e.target.value);
					if (!Number.isNaN(v)) {
						onChange(v);
					}
				}}
				className="ref-uterm-settings-numberinput"
			/>
		</div>
	);
}
