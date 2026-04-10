import { useState, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeesSettings } from '../../../shared/aiEmployeesSettings';
import type { AiEmployeesSessionPhase } from '../sessionTypes';

export function ConnectionPage({
	t,
	DEFAULT_API,
	DEFAULT_WS,
	aiSettings,
	setAiSettings,
	wsLog,
	onSave,
	workspaceId,
	sessionPhase,
	onRebuildTeam,
}: {
	t: TFunction;
	DEFAULT_API: string;
	DEFAULT_WS: string;
	aiSettings: AiEmployeesSettings;
	setAiSettings: Dispatch<SetStateAction<AiEmployeesSettings>>;
	wsLog: string[];
	onSave: () => void;
	workspaceId: string;
	sessionPhase: AiEmployeesSessionPhase;
	onRebuildTeam: () => Promise<void>;
}) {
	const [rebuildBusy, setRebuildBusy] = useState(false);

	return (
		<div className="ref-ai-employees-form ref-ai-employees-settings-page">
			<label>
				<span>{t('aiEmployees.apiBaseUrl')}</span>
				<input
					className="ref-ai-employees-input"
					value={aiSettings.apiBaseUrl ?? DEFAULT_API}
					onChange={(e) => setAiSettings((s) => ({ ...s, apiBaseUrl: e.target.value }))}
				/>
			</label>
			<label>
				<span>{t('aiEmployees.wsBaseUrl')}</span>
				<input
					className="ref-ai-employees-input"
					value={aiSettings.wsBaseUrl ?? DEFAULT_WS}
					onChange={(e) => setAiSettings((s) => ({ ...s, wsBaseUrl: e.target.value }))}
				/>
			</label>
			<label>
				<span>{t('aiEmployees.token')}</span>
				<input
					className="ref-ai-employees-input"
					type="password"
					autoComplete="off"
					value={aiSettings.token ?? 'dev'}
					onChange={(e) => setAiSettings((s) => ({ ...s, token: e.target.value }))}
				/>
			</label>
			<div className="ref-ai-employees-form-actions">
				<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" onClick={() => void onSave()}>
					{t('aiEmployees.saveConnection')}
				</button>
			</div>
			{wsLog.length > 0 ? (
				<details className="ref-ai-employees-settings-diagnostics">
					<summary>{t('aiEmployees.wsLogHint')}</summary>
					<ul className="ref-ai-employees-log">
						{wsLog.map((line, i) => (
							<li key={i}>{line}</li>
						))}
					</ul>
				</details>
			) : null}

			{workspaceId && sessionPhase === 'ready' ? (
				<section className="ref-ai-employees-settings-team-reset" aria-labelledby="ref-ai-employees-team-reset-title">
					<h3 id="ref-ai-employees-team-reset-title" className="ref-ai-employees-settings-subtitle">
						{t('aiEmployees.settings.rebuildTeamTitle')}
					</h3>
					<p className="ref-ai-employees-muted ref-ai-employees-settings-team-reset-desc">{t('aiEmployees.settings.rebuildTeamDesc')}</p>
					<button
						type="button"
						className="ref-ai-employees-btn ref-ai-employees-btn--danger"
						disabled={rebuildBusy}
						onClick={() => {
							if (!window.confirm(t('aiEmployees.settings.rebuildTeamConfirm'))) {
								return;
							}
							setRebuildBusy(true);
							void (async () => {
								try {
									await onRebuildTeam();
								} finally {
									setRebuildBusy(false);
								}
							})();
						}}
					>
						{rebuildBusy ? t('common.loading') : t('aiEmployees.settings.rebuildTeamAction')}
					</button>
				</section>
			) : null}
		</div>
	);
}
