import type { TFunction } from './i18n';
import type { BrowserFingerprintSpoofSettings } from './browserSidebarConfig.js';

type Patch = Partial<
	Record<keyof BrowserFingerprintSpoofSettings, string | number | boolean | undefined>
>;

export function BrowserFingerprintEditorFields({
	fp,
	onPatch,
	t,
}: {
	fp: BrowserFingerprintSpoofSettings;
	onPatch: (patch: Patch) => void;
	t: TFunction;
}) {
	return (
		<div className="ref-browser-fp-modal-form">
			<div className="ref-browser-fp-group">
				<p className="ref-browser-fp-kicker">{t('settings.browser.fingerprintGroupIdentity')}</p>
				<p className="ref-browser-fp-micro">{t('settings.browser.fingerprintPlatformHelp')}</p>
				<div className="ref-browser-fp-seg-grid ref-browser-fp-seg-grid--4" role="group" aria-label={t('settings.browser.fingerprintPlatform')}>
					{(
						[
							['', 'settings.browser.fingerprintPlatformDefault'],
							['Win32', 'Win32'],
							['MacIntel', 'MacIntel'],
							['Linux x86_64', 'Linux x86_64'],
						] as const
					).map(([value, labelKey]) => {
						const cur =
							fp.platform === 'MacIntel'
								? 'MacIntel'
								: fp.platform === 'Linux x86_64'
									? 'Linux x86_64'
									: fp.platform === 'Win32'
										? 'Win32'
										: '';
						const active = cur === value;
						return (
							<button
								key={value || 'default'}
								type="button"
								role="radio"
								aria-checked={active}
								className={`ref-browser-settings-segment${active ? ' is-selected' : ''}`}
								onClick={() => onPatch({ platform: value || undefined })}
							>
								<span className="ref-browser-settings-segment-title">{t(labelKey)}</span>
							</button>
						);
					})}
				</div>
				<div className="ref-browser-fp-field ref-browser-fp-field--full">
					<span className="ref-browser-fp-field-label" id="ref-browser-fp-modal-langs">
						{t('settings.browser.fingerprintLanguages')}
					</span>
					<input
						type="text"
						className="ref-browser-fp-input"
						aria-labelledby="ref-browser-fp-modal-langs"
						value={fp.languages ?? ''}
						placeholder="zh-CN, zh, en"
						spellCheck={false}
						onChange={(event) => onPatch({ languages: event.target.value || undefined })}
					/>
				</div>
				<div className="ref-browser-fp-grid2">
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintHardware')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={1}
							max={128}
							inputMode="numeric"
							value={fp.hardwareConcurrency ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ hardwareConcurrency: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintMemory')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={1}
							max={128}
							inputMode="numeric"
							value={fp.deviceMemory ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ deviceMemory: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
				</div>
			</div>

			<div className="ref-browser-fp-group">
				<p className="ref-browser-fp-kicker">{t('settings.browser.fingerprintGroupScreen')}</p>
				<div className="ref-browser-fp-screen-row">
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintWidth')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={320}
							max={16384}
							inputMode="numeric"
							value={fp.screenWidth ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ screenWidth: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
					<span className="ref-browser-fp-times" aria-hidden="true">
						×
					</span>
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintHeight')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={240}
							max={16384}
							inputMode="numeric"
							value={fp.screenHeight ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ screenHeight: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
				</div>
				<div className="ref-browser-fp-grid2">
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintDpr')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={0.5}
							max={4}
							step={0.25}
							inputMode="decimal"
							value={fp.devicePixelRatio ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ devicePixelRatio: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintColorDepth')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={8}
							max={48}
							inputMode="numeric"
							value={fp.colorDepth ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ colorDepth: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
				</div>
				<div className="ref-browser-fp-field ref-browser-fp-field--full">
					<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintAvailOffset')}</span>
					<input
						type="number"
						className="ref-browser-fp-input ref-browser-fp-input--short"
						min={0}
						max={500}
						placeholder="40"
						inputMode="numeric"
						value={fp.availHeightOffset ?? ''}
						onChange={(event) => {
							const raw = event.target.value;
							onPatch({ availHeightOffset: raw === '' ? undefined : Number(raw) });
						}}
					/>
					<span className="ref-browser-fp-hint-inline">{t('settings.browser.fingerprintAvailHint')}</span>
				</div>
			</div>

			<div className="ref-browser-fp-group">
				<p className="ref-browser-fp-kicker">{t('settings.browser.fingerprintGroupTime')}</p>
				<div className="ref-browser-fp-field ref-browser-fp-field--full">
					<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintTimezone')}</span>
					<input
						type="text"
						className="ref-browser-fp-input"
						value={fp.timezone ?? ''}
						placeholder="Asia/Shanghai"
						spellCheck={false}
						onChange={(event) => onPatch({ timezone: event.target.value || undefined })}
					/>
				</div>
				<div className="ref-browser-fp-field ref-browser-fp-field--full">
					<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintTzOffset')}</span>
					<input
						type="number"
						className="ref-browser-fp-input ref-browser-fp-input--short"
						min={-840}
						max={840}
						inputMode="numeric"
						value={fp.timezoneOffsetMinutes ?? ''}
						onChange={(event) => {
							const raw = event.target.value;
							onPatch({ timezoneOffsetMinutes: raw === '' ? undefined : Number(raw) });
						}}
					/>
				</div>
			</div>

			<div className="ref-browser-fp-group">
				<p className="ref-browser-fp-kicker">{t('settings.browser.fingerprintGroupWebgl')}</p>
				<div className="ref-browser-fp-field ref-browser-fp-field--full">
					<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintWebglVendor')}</span>
					<input
						type="text"
						className="ref-browser-fp-input ref-browser-fp-input--mono"
						value={fp.webglVendor ?? ''}
						spellCheck={false}
						onChange={(event) => onPatch({ webglVendor: event.target.value || undefined })}
					/>
				</div>
				<div className="ref-browser-fp-field ref-browser-fp-field--full">
					<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintWebglRenderer')}</span>
					<input
						type="text"
						className="ref-browser-fp-input ref-browser-fp-input--mono"
						value={fp.webglRenderer ?? ''}
						spellCheck={false}
						onChange={(event) => onPatch({ webglRenderer: event.target.value || undefined })}
					/>
				</div>
			</div>

			<div className="ref-browser-fp-group">
				<p className="ref-browser-fp-kicker">{t('settings.browser.fingerprintGroupNoise')}</p>
				<div className="ref-browser-fp-grid2">
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintCanvasSeed')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={1}
							inputMode="numeric"
							value={fp.canvasNoiseSeed ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ canvasNoiseSeed: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
					<div className="ref-browser-fp-field">
						<span className="ref-browser-fp-field-label">{t('settings.browser.fingerprintAudioSeed')}</span>
						<input
							type="number"
							className="ref-browser-fp-input"
							min={1}
							inputMode="numeric"
							value={fp.audioNoiseSeed ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								onPatch({ audioNoiseSeed: raw === '' ? undefined : Number(raw) });
							}}
						/>
					</div>
				</div>
			</div>

			<div className="ref-browser-fp-group">
				<p className="ref-browser-fp-kicker">{t('settings.browser.fingerprintGroupPrivacy')}</p>
				<div className="ref-browser-fp-seg-grid ref-browser-fp-seg-grid--2" role="group" aria-label={t('settings.browser.fingerprintWebrtc')}>
					{(
						[
							['default', 'settings.browser.fingerprintWebrtcDefault'],
							['block', 'settings.browser.fingerprintWebrtcBlock'],
						] as const
					).map(([value, labelKey]) => {
						const active = value === 'block' ? fp.webrtcPolicy === 'block' : fp.webrtcPolicy !== 'block';
						return (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={active}
								className={`ref-browser-settings-segment${active ? ' is-selected' : ''}`}
								onClick={() => onPatch({ webrtcPolicy: value === 'block' ? 'block' : undefined })}
							>
								<span className="ref-browser-settings-segment-title">{t(labelKey)}</span>
							</button>
						);
					})}
				</div>
				<label
					className="ref-browser-settings-toggle ref-browser-fp-toggle"
					aria-label={t('settings.browser.fingerprintMaskWebdriverTitle')}
				>
					<input
						type="checkbox"
						checked={fp.maskWebdriver !== false}
						onChange={(event) => {
							if (event.target.checked) {
								onPatch({ maskWebdriver: undefined });
							} else {
								onPatch({ maskWebdriver: false });
							}
						}}
					/>
					<span className="ref-browser-settings-toggle-slider" aria-hidden="true" />
					<span className="ref-browser-settings-toggle-copy">
						<strong>{t('settings.browser.fingerprintMaskWebdriverTitle')}</strong>
						<small>{t('settings.browser.fingerprintMaskWebdriverBody')}</small>
					</span>
				</label>
			</div>
		</div>
	);
}
