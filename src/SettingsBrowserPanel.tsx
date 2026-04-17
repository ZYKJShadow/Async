import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';
import { BrowserFingerprintEditorFields } from './SettingsBrowserFingerprintEditor.js';
import {
	applyBrowserFingerprintPatch,
	BROWSER_SIDEBAR_CONFIG_SYNC_EVENT,
	DEFAULT_BROWSER_SIDEBAR_CONFIG,
	normalizeBrowserFingerprintSpoof,
	normalizeBrowserSidebarConfig,
	parseBrowserExtraHeadersText,
	type BrowserFingerprintSpoofSettings,
	type BrowserSidebarSettingsConfig,
} from './browserSidebarConfig';

type ShellApi = NonNullable<Window['asyncShell']>;

const FINGERPRINT_MODAL_TRANSITION_MS = 300;

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
	const [fingerprintModalMounted, setFingerprintModalMounted] = useState(false);
	const [fingerprintModalVisible, setFingerprintModalVisible] = useState(false);
	const [modalFingerprint, setModalFingerprint] = useState<BrowserFingerprintSpoofSettings>({});

	const draftRef = useRef(draft);
	draftRef.current = draft;

	const patchModalFingerprint = useCallback(
		(patch: Partial<Record<keyof BrowserFingerprintSpoofSettings, string | number | boolean | undefined>>) => {
			setModalFingerprint((cur) => applyBrowserFingerprintPatch(cur, patch));
		},
		[]
	);

	const openFingerprintModal = useCallback(() => {
		setModalFingerprint(normalizeBrowserFingerprintSpoof(draftRef.current.fingerprint));
		setFingerprintModalMounted(true);
		setFingerprintModalVisible(false);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				setFingerprintModalVisible(true);
			});
		});
	}, []);

	const beginCloseFingerprintModal = useCallback(() => {
		setFingerprintModalVisible(false);
		window.setTimeout(() => {
			setFingerprintModalMounted(false);
		}, FINGERPRINT_MODAL_TRANSITION_MS);
	}, []);

	const saveFingerprintModal = useCallback(() => {
		const next = normalizeBrowserFingerprintSpoof(modalFingerprint);
		setDraft((prev) => ({ ...prev, fingerprint: next }));
		beginCloseFingerprintModal();
	}, [modalFingerprint, beginCloseFingerprintModal]);

	const resetFingerprintModalDefaults = useCallback(() => {
		setModalFingerprint({});
	}, []);

	useEffect(() => {
		if (!fingerprintModalMounted) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				beginCloseFingerprintModal();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [fingerprintModalMounted, beginCloseFingerprintModal]);

	useEffect(() => {
		if (!fingerprintModalMounted) {
			return;
		}
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, [fingerprintModalMounted]);

	const fingerprintOverrideCount = useMemo(
		() => Object.keys(normalizeBrowserFingerprintSpoof(draft.fingerprint)).length,
		[draft.fingerprint]
	);

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

			<div className="ref-browser-fp ref-browser-fp--summary" aria-labelledby="ref-browser-fp-inline-title">
				<div className="ref-browser-fp-summary-row">
					<div className="ref-browser-fp-summary-main">
						<div className="ref-browser-fp-title-row">
							<h3 id="ref-browser-fp-inline-title" className="ref-browser-fp-title">
								{t('settings.browser.fingerprintCardTitle')}
							</h3>
							{fingerprintOverrideCount > 0 ? (
								<span className="ref-browser-fp-badge" title={t('settings.browser.fingerprintBadgeTitle')}>
									{t('settings.browser.fingerprintBadge', { count: String(fingerprintOverrideCount) })}
								</span>
							) : null}
						</div>
						<p className="ref-browser-fp-sub">{t('settings.browser.fingerprintCardSubtitle')}</p>
					</div>
					<button type="button" className="ref-browser-fp-edit-btn" onClick={openFingerprintModal}>
						{t('settings.browser.fingerprintEdit')}
					</button>
				</div>
			</div>

			{fingerprintModalMounted
				? createPortal(
						<div
							className={`ref-browser-fp-modal-root${fingerprintModalVisible ? ' is-visible' : ''}`}
							role="presentation"
						>
							<div
								className="ref-browser-fp-modal-backdrop"
								aria-hidden="true"
								onClick={beginCloseFingerprintModal}
							/>
							<div
								className="ref-browser-fp-modal-dialog"
								role="dialog"
								aria-modal="true"
								aria-labelledby="ref-browser-fp-modal-title"
								onClick={(event) => event.stopPropagation()}
							>
								<div className="ref-browser-fp-modal-header">
									<h2 id="ref-browser-fp-modal-title" className="ref-browser-fp-modal-title">
										{t('settings.browser.fingerprintModalTitle')}
									</h2>
									<button
										type="button"
										className="ref-browser-fp-modal-close"
										onClick={beginCloseFingerprintModal}
										aria-label={t('common.close')}
									>
										×
									</button>
								</div>
								<div className="ref-browser-fp-modal-scroll">
									<BrowserFingerprintEditorFields
										fp={modalFingerprint}
										onPatch={patchModalFingerprint}
										t={t}
									/>
								</div>
								<div className="ref-browser-fp-modal-footer">
									<button
										type="button"
										className="ref-browser-settings-btn ref-browser-settings-btn--secondary"
										onClick={resetFingerprintModalDefaults}
									>
										{t('settings.browser.fingerprintModalResetDefault')}
									</button>
									<button type="button" className="ref-browser-settings-btn" onClick={saveFingerprintModal}>
										{t('settings.browser.fingerprintModalSave')}
									</button>
								</div>
							</div>
						</div>,
						document.body
					)
				: null}

			{error ? <div className="ref-browser-settings-error">{error}</div> : null}

			{saving ? (
				<p className="ref-settings-proxy-hint ref-settings-browser-autosave-status" role="status" aria-live="polite">
					{t('settings.browser.saving')}
				</p>
			) : null}
		</div>
	);
}
