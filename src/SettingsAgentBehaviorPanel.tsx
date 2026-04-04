import { useI18n } from './i18n';
import type { AgentCustomization } from './agentSettingsTypes';
import { defaultAgentCustomization } from './agentSettingsTypes';

type Props = {
	value: AgentCustomization;
	onChange: (next: AgentCustomization) => void;
};

export function SettingsAgentBehaviorPanel({ value, onChange }: Props) {
	const { t } = useI18n();
	const v = { ...defaultAgentCustomization(), ...value };

	const patch = (p: Partial<AgentCustomization>) => {
		onChange({ ...v, ...p });
	};

	return (
		<div className="ref-settings-panel ref-settings-panel--agent">
			<p className="ref-settings-lead">{t('agentBehavior.lead')}</p>

			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-title" style={{ marginBottom: 8 }}>
					{t('agentBehavior.executionTitle')}
				</div>
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">{t('agent.settings.confirmShell')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentSettings.safetyShellDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.confirmShellCommands !== false ? 'is-on' : ''}`}
						role="switch"
						aria-checked={v.confirmShellCommands !== false}
						onClick={() => patch({ confirmShellCommands: v.confirmShellCommands === false ? true : false })}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('agent.settings.skipSafeShell')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentSettings.safetySkipDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.skipSafeShellCommandsConfirm !== false ? 'is-on' : ''}`}
						role="switch"
						aria-checked={v.skipSafeShellCommandsConfirm !== false}
						onClick={() =>
							patch({
								skipSafeShellCommandsConfirm: v.skipSafeShellCommandsConfirm === false ? true : false,
							})
						}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('agent.settings.confirmWrites')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentSettings.safetyWritesDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.confirmWritesBeforeExecute === true ? 'is-on' : ''}`}
						role="switch"
						aria-checked={v.confirmWritesBeforeExecute === true}
						onClick={() => patch({ confirmWritesBeforeExecute: v.confirmWritesBeforeExecute !== true })}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('agentSettings.backgroundForkTitle')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentSettings.backgroundForkDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.backgroundForkAgent === true ? 'is-on' : ''}`}
						role="switch"
						aria-checked={v.backgroundForkAgent === true}
						onClick={() => patch({ backgroundForkAgent: v.backgroundForkAgent !== true })}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('agentSettings.mistakeLimitTitle')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentSettings.mistakeLimitDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.mistakeLimitEnabled !== false ? 'is-on' : ''}`}
						role="switch"
						aria-checked={v.mistakeLimitEnabled !== false}
						onClick={() => patch({ mistakeLimitEnabled: v.mistakeLimitEnabled === false })}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 12, alignItems: 'center' }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('agentSettings.maxMistakesLabel')}</div>
					</div>
					<input
						type="number"
						min={2}
						max={30}
						className="ref-settings-agent-number"
						value={v.maxConsecutiveMistakes ?? 5}
						onChange={(e) => {
							const n = parseInt(e.target.value, 10);
							if (!Number.isFinite(n)) return;
							patch({ maxConsecutiveMistakes: Math.min(30, Math.max(2, n)) });
						}}
					/>
				</div>
			</div>

			<div className="ref-settings-agent-card" style={{ marginTop: 18 }}>
				<div className="ref-settings-agent-card-title">{t('agentBehavior.libraryTitle')}</div>
				<p className="ref-settings-agent-card-desc" style={{ marginTop: 8 }}>
					{t('agentBehavior.libraryHint')}
				</p>
			</div>
		</div>
	);
}
