import { BrandLogo } from '../BrandLogo';
import type { TFunction } from '../i18n';
import { IconPlus, IconServerOutline, IconSettings, IconTerminal } from '../icons';

export type TerminalStartPageProfile = {
	id: string;
	name: string;
	target: string;
	kind: 'local' | 'ssh';
	isDefault?: boolean;
};

type Props = {
	t: TFunction;
	defaultActionMeta: string;
	profiles: TerminalStartPageProfile[];
	remainingProfileCount: number;
	onCreate(): void;
	onOpenSettings(): void;
	onLaunchProfile(profileId: string): void;
};

export function TerminalStartPage({
	t,
	defaultActionMeta,
	profiles,
	remainingProfileCount,
	onCreate,
	onOpenSettings,
	onLaunchProfile,
}: Props) {
	return (
		<div className="ref-uterm-start-page">
			<div className="ref-uterm-start-page-shell">
				<section className="ref-uterm-start-page-hero" aria-label={t('app.universalTerminalWindowTitle')}>
					<div className="ref-uterm-start-page-brand">
						<div className="ref-uterm-start-page-logo-wrap">
							<BrandLogo className="ref-uterm-start-page-logo" size={42} aria-label="Async" />
						</div>
						<div className="ref-uterm-start-page-copyblock">
							<div className="ref-uterm-start-page-kicker">{t('app.universalTerminalWindowTitle')}</div>
							<h1 className="ref-uterm-start-page-title">Async</h1>
							<p className="ref-uterm-start-page-copy">{t('app.universalTerminalStartPageCopy')}</p>
						</div>
					</div>

					<div className="ref-uterm-start-page-actions">
						<button
							type="button"
							className="ref-uterm-start-page-action ref-uterm-start-page-action--primary"
							onClick={onCreate}
						>
							<span className="ref-uterm-start-page-action-icon">
								<IconPlus className="ref-uterm-start-page-action-icon-svg" />
							</span>
							<span className="ref-uterm-start-page-action-copy">
								<span className="ref-uterm-start-page-action-title">{t('app.universalTerminalNewTab')}</span>
								<span className="ref-uterm-start-page-action-meta">{defaultActionMeta}</span>
							</span>
						</button>

						<button type="button" className="ref-uterm-start-page-action" onClick={onOpenSettings}>
							<span className="ref-uterm-start-page-action-icon">
								<IconSettings className="ref-uterm-start-page-action-icon-svg" />
							</span>
							<span className="ref-uterm-start-page-action-copy">
								<span className="ref-uterm-start-page-action-title">{t('app.universalTerminalSettings.title')}</span>
								<span className="ref-uterm-start-page-action-meta">
									{t('app.universalTerminalStartPageSettingsHint')}
								</span>
							</span>
						</button>
					</div>
				</section>

				<section className="ref-uterm-start-page-panel">
					<div className="ref-uterm-start-page-panel-head">
						<div className="ref-uterm-start-page-panel-kicker">{t('app.universalTerminalMenu.newWithProfile')}</div>
						<div className="ref-uterm-start-page-panel-title">{t('app.universalTerminalStartPageProfilesTitle')}</div>
						<p className="ref-uterm-start-page-panel-copy">{t('app.universalTerminalStartPageProfilesHint')}</p>
					</div>

					{profiles.length > 0 ? (
						<div className="ref-uterm-start-page-profile-list">
							{profiles.map((profile) => (
								<button
									key={profile.id}
									type="button"
									className="ref-uterm-start-page-profile"
									onClick={() => onLaunchProfile(profile.id)}
								>
									<span className={`ref-uterm-start-page-profile-icon is-${profile.kind}`}>
										{profile.kind === 'ssh' ? (
											<IconServerOutline className="ref-uterm-start-page-profile-icon-svg" />
										) : (
											<IconTerminal className="ref-uterm-start-page-profile-icon-svg" />
										)}
									</span>
									<span className="ref-uterm-start-page-profile-copy">
										<span className="ref-uterm-start-page-profile-name">{profile.name}</span>
										<span className="ref-uterm-start-page-profile-target">{profile.target}</span>
									</span>
									{profile.isDefault ? (
										<span className="ref-uterm-start-page-profile-badge">
											{t('app.universalTerminalStartPageDefaultBadge')}
										</span>
									) : null}
								</button>
							))}
						</div>
					) : (
						<div className="ref-uterm-start-page-profile-empty">
							{t('app.universalTerminalStartPageProfilesEmpty')}
						</div>
					)}

					{remainingProfileCount > 0 ? (
						<div className="ref-uterm-start-page-panel-note">
							{t('app.universalTerminalStartPageMoreProfiles', { count: remainingProfileCount })}
						</div>
					) : null}
				</section>
			</div>
		</div>
	);
}
