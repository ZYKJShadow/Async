import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from '../../i18n';
import type { AiEmployeesSettings } from '../../../shared/aiEmployeesSettings';

export function ConnectionPage({
	t,
	DEFAULT_API,
	DEFAULT_WS,
	aiSettings,
	setAiSettings,
	wsLog,
	onSave,
}: {
	t: TFunction;
	DEFAULT_API: string;
	DEFAULT_WS: string;
	aiSettings: AiEmployeesSettings;
	setAiSettings: Dispatch<SetStateAction<AiEmployeesSettings>>;
	wsLog: string[];
	onSave: () => void;
}) {
	return (
		<div className="ref-ai-employees-form">
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
			<p className="ref-ai-employees-muted">{t('aiEmployees.wsLogHint')}</p>
			<ul className="ref-ai-employees-log">
				{wsLog.map((line, i) => (
					<li key={i}>{line}</li>
				))}
			</ul>
		</div>
	);
}
