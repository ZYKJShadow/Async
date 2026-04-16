import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import {
	BROWSER_SIDEBAR_CONFIG_SYNC_EVENT,
	DEFAULT_BROWSER_SIDEBAR_CONFIG,
	normalizeBrowserSidebarConfig,
	parseBrowserExtraHeadersText,
	type BrowserSidebarSettingsConfig,
} from './browserSidebarConfig';

type ShellApi = NonNullable<Window['asyncShell']>;

function serializeBrowserConfig(c: BrowserSidebarSettingsConfig): string {
	return JSON.stringify(normalizeBrowserSidebarConfig(c));
}

type Props = {
	shell: ShellApi | null;
};

export function SettingsBrowserPanel({ shell }: Props) {
	const { t } = useI18n();
	const [draft, setDraft] = useState<BrowserSidebarSettingsConfig>(DEFAULT_BROWSER_SIDEBAR_CONFIG);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const draftRef = useRef(draft);
	draftRef.current = draft;

	const lastPersistedSerialized = useRef<string>('');

	const load = useCallback(async () => {
		if (!shell) {
			const next = DEFAULT_BROWSER_SIDEBAR_CONFIG;
			setDraft(next);
			lastPersistedSerialized.current = serializeBrowserConfig(next);
			setLoaded(true);
			return;
		}
		try {
			const payload = (await shell.invoke('browser:getConfig')) as {
				ok?: boolean;
				config?: Partial<BrowserSidebarSettingsConfig>;
			};
			const next = payload?.ok && payload.config ? normalizeBrowserSidebarConfig(payload.config) : DEFAULT_BROWSER_SIDEBAR_CONFIG;
			setDraft(next);
			lastPersistedSerialized.current = serializeBrowserConfig(next);
		} catch {
			const next = DEFAULT_BROWSER_SIDEBAR_CONFIG;
			setDraft(next);
			lastPersistedSerialized.current = serializeBrowserConfig(next);
		} finally {
			setLoaded(true);
		}
	}, [shell]);

	useEffect(() => {
		void load();
	}, [load]);

	const persistIfNeeded = useCallback(async () => {
		const current = draftRef.current;
		const serialized = serializeBrowserConfig(current);
		if (serialized === lastPersistedSerialized.current) {
			return;
		}

		const parsedHeaders = parseBrowserExtraHeadersText(current.extraHeadersText);
		if (!parsedHeaders.ok) {
			setError(t('app.browserHeaderFormatError', { line: String(parsedHeaders.line) }));
			return;
		}
		if (current.proxyMode === 'custom' && !current.proxyRules.trim()) {
			setError(t('app.browserProxyRulesRequired'));
			return;
		}

		setSaving(true);
		setError(null);
		try {
			const nextConfig = normalizeBrowserSidebarConfig(current);
			if (shell) {
				const payload = (await shell.invoke('browser:setConfig', nextConfig)) as {
					ok?: boolean;
					error?: string;
					line?: number;
					config?: Partial<BrowserSidebarSettingsConfig>;
					defaultUserAgent?: string;
				};
				if (!payload?.ok) {
					if (payload?.error === 'invalid-header-line' && payload.line) {
						setError(t('app.browserHeaderFormatError', { line: String(payload.line) }));
					} else if (payload?.error === 'proxy-rules-required') {
						setError(t('app.browserProxyRulesRequired'));
					} else {
						setError(t('app.browserLoadFailed'));
					}
					return;
				}
				const applied = normalizeBrowserSidebarConfig(payload.config ?? nextConfig);
				setDraft(applied);
				lastPersistedSerialized.current = serializeBrowserConfig(applied);
				window.dispatchEvent(
					new CustomEvent(BROWSER_SIDEBAR_CONFIG_SYNC_EVENT, {
						detail: {
							config: applied,
							defaultUserAgent: String(payload.defaultUserAgent ?? ''),
						},
					})
				);
			} else {
				setDraft(nextConfig);
				lastPersistedSerialized.current = serializeBrowserConfig(nextConfig);
			}
		} finally {
			setSaving(false);
		}
	}, [shell, t]);

	useEffect(() => {
		if (!loaded) {
			return;
		}
		const debounceMs = 500;
		const timer = window.setTimeout(() => {
			void persistIfNeeded();
		}, debounceMs);
		return () => {
			window.clearTimeout(timer);
		};
	}, [draft, loaded, persistIfNeeded]);

	if (!loaded) {
		return (
			<div className="ref-settings-panel">
				<p className="ref-settings-proxy-hint">{t('common.loading')}</p>
			</div>
		);
	}

	return (
		<div className="ref-settings-panel ref-settings-panel--browser">
			<p className="ref-settings-lead">{t('settings.browser.lead')}</p>

			<label className="ref-browser-settings-toggle" aria-label={t('app.browserBlockTrackers')}>
				<input
					type="checkbox"
					checked={draft.blockTrackers}
					onChange={(event) =>
						setDraft((prev) => ({
							...prev,
							blockTrackers: event.target.checked,
						}))
					}
				/>
				<span className="ref-browser-settings-toggle-slider" aria-hidden="true" />
				<span className="ref-browser-settings-toggle-copy">
					<strong>{t('app.browserBlockTrackers')}</strong>
					<small>{t('app.browserBlockTrackersHint')}</small>
				</span>
			</label>

			<label className="ref-browser-settings-field">
				<span className="ref-browser-settings-label">{t('app.browserUserAgent')}</span>
				<input
					type="text"
					className="ref-browser-settings-input"
					value={draft.userAgent}
					placeholder={t('app.browserUserAgentPlaceholder')}
					spellCheck={false}
					onChange={(event) =>
						setDraft((prev) => ({
							...prev,
							userAgent: event.target.value,
						}))
					}
				/>
			</label>

			<label className="ref-browser-settings-field">
				<span className="ref-browser-settings-label">{t('app.browserAcceptLanguage')}</span>
				<input
					type="text"
					className="ref-browser-settings-input"
					value={draft.acceptLanguage}
					placeholder={t('app.browserAcceptLanguagePlaceholder')}
					spellCheck={false}
					onChange={(event) =>
						setDraft((prev) => ({
							...prev,
							acceptLanguage: event.target.value,
						}))
					}
				/>
			</label>

			<div className="ref-browser-settings-field">
				<span className="ref-browser-settings-label">{t('app.browserProxyMode')}</span>
				<div className="ref-browser-settings-segmented" role="radiogroup" aria-label={t('app.browserProxyMode')}>
					{(
						[
							['system', 'app.browserProxyModeSystem', 'app.browserProxyModeSystemDesc'],
							['direct', 'app.browserProxyModeDirect', 'app.browserProxyModeDirectDesc'],
							['custom', 'app.browserProxyModeCustom', 'app.browserProxyModeCustomDesc'],
						] as const
					).map(([mode, titleKey, descKey]) => {
						const active = draft.proxyMode === mode;
						return (
							<button
								key={mode}
								type="button"
								role="radio"
								aria-checked={active}
								className={`ref-browser-settings-segment ${active ? 'is-selected' : ''}`}
								onClick={() =>
									setDraft((prev) => ({
										...prev,
										proxyMode: mode,
									}))
								}
							>
								<span className="ref-browser-settings-segment-title">{t(titleKey)}</span>
								<span className="ref-browser-settings-segment-desc">{t(descKey)}</span>
							</button>
						);
					})}
				</div>
			</div>

			{draft.proxyMode === 'custom' ? (
				<>
					<label className="ref-browser-settings-field">
						<span className="ref-browser-settings-label">{t('app.browserProxyRules')}</span>
						<input
							type="text"
							className="ref-browser-settings-input"
							value={draft.proxyRules}
							placeholder={t('app.browserProxyRulesPlaceholder')}
							spellCheck={false}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									proxyRules: event.target.value,
								}))
							}
						/>
						<span className="ref-browser-settings-help">{t('app.browserProxyRulesHint')}</span>
					</label>

					<label className="ref-browser-settings-field">
						<span className="ref-browser-settings-label">{t('app.browserProxyBypassRules')}</span>
						<input
							type="text"
							className="ref-browser-settings-input"
							value={draft.proxyBypassRules}
							placeholder={t('app.browserProxyBypassRulesPlaceholder')}
							spellCheck={false}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									proxyBypassRules: event.target.value,
								}))
							}
						/>
						<span className="ref-browser-settings-help">{t('app.browserProxyBypassRulesHint')}</span>
					</label>
				</>
			) : null}

			<label className="ref-browser-settings-field">
				<span className="ref-browser-settings-label">{t('app.browserExtraHeaders')}</span>
				<textarea
					className="ref-browser-settings-textarea"
					value={draft.extraHeadersText}
					placeholder={t('app.browserExtraHeadersPlaceholder')}
					spellCheck={false}
					onChange={(event) =>
						setDraft((prev) => ({
							...prev,
							extraHeadersText: event.target.value,
						}))
					}
				/>
				<span className="ref-browser-settings-help">{t('app.browserExtraHeadersHint')}</span>
			</label>

			{error ? <div className="ref-browser-settings-error">{error}</div> : null}

			{saving ? (
				<p className="ref-settings-proxy-hint ref-settings-browser-autosave-status" role="status" aria-live="polite">
					{t('settings.browser.saving')}
				</p>
			) : null}
		</div>
	);
}
