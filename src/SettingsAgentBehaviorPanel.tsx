import { useMemo } from 'react';
import { useI18n } from './i18n';
import type { AgentCustomization, AgentToolPermissionRule, ShellPermissionMode, ToolPermissionBehavior } from './agentSettingsTypes';
import { defaultAgentCustomization } from './agentSettingsTypes';
import { VoidSelect } from './VoidSelect';
import { getShellPermissionMode, shellPermissionModeToAgentPatch } from './shellPermissionMode';

function newToolPermRuleId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `tpr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function IconTrash({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M10 11v6M14 11v6" strokeLinecap="round" />
		</svg>
	);
}

function removeToolPermissionRuleAt(list: AgentToolPermissionRule[], index: number): AgentToolPermissionRule[] {
	const target = list[index];
	if (!target) return list;
	if (target.id) {
		return list.filter((r) => r.id !== target.id);
	}
	return list.filter((_, i) => i !== index);
}

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

	const toolRuleBehaviorOptions = useMemo(
		() => [
			{ value: 'allow', label: t('agentBehavior.toolRuleAllow') },
			{ value: 'deny', label: t('agentBehavior.toolRuleDeny') },
			{ value: 'ask', label: t('agentBehavior.toolRuleAsk') },
		],
		[t]
	);

	return (
		<div className="ref-settings-panel ref-settings-panel--agent">
			<p className="ref-settings-lead">{t('agentBehavior.lead')}</p>

			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-title" style={{ marginBottom: 8 }}>
					{t('agentBehavior.executionTitle')}
				</div>
				<p className="ref-settings-agent-card-desc" style={{ marginBottom: 12 }}>
					{t('agentBehavior.shellComposerHint')}
				</p>
				<label className="ref-settings-field ref-settings-field--compact" style={{ marginBottom: 4 }}>
					<span>{t('agentBehavior.shellPermissionMode')}</span>
					<p className="ref-settings-agent-card-desc" style={{ margin: '4px 0 8px' }}>
						{t('agentBehavior.shellPermissionModeDesc')}
					</p>
					<VoidSelect
						ariaLabel={t('agentBehavior.shellPermissionMode')}
						value={getShellPermissionMode(v)}
						onChange={(next) => patch(shellPermissionModeToAgentPatch(next as ShellPermissionMode))}
						options={[
							{ value: 'always', label: t('agent.commandPermission.always') },
							{ value: 'rules', label: t('agent.commandPermission.rules') },
							{ value: 'ask_every_time', label: t('agent.commandPermission.askEvery') },
						]}
					/>
				</label>
				{getShellPermissionMode(v) === 'rules' ? (
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
				) : null}
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
				<div className="ref-settings-agent-card-title">{t('agentBehavior.toolRulesTitle')}</div>
				<p className="ref-settings-agent-card-desc" style={{ marginTop: 8 }}>
					{t('agentBehavior.toolRulesDesc')}
				</p>
				{(v.toolPermissionRules ?? []).length === 0 ? (
					<p className="ref-settings-agent-empty" style={{ marginTop: 10 }}>
						{t('agentBehavior.toolRulesEmpty')}
					</p>
				) : null}
				<ul className="ref-settings-agent-list ref-settings-tool-perm-rule-list" style={{ marginTop: 12 }}>
					{(v.toolPermissionRules ?? []).map((rule, idx) => (
						<li key={rule.id ?? `tp-${idx}`} className="ref-settings-agent-item ref-settings-tool-perm-rule-item">
							<div className="ref-settings-tool-perm-rule-fields">
								<label className="ref-settings-field ref-settings-field--compact" style={{ minWidth: 160, flex: '0 1 200px' }}>
									<span>{t('agentBehavior.toolRuleBehavior')}</span>
									<VoidSelect
										ariaLabel={t('agentBehavior.toolRuleBehavior')}
										value={rule.behavior}
										onChange={(next) => {
											const list = [...(v.toolPermissionRules ?? [])];
											list[idx] = {
												...rule,
												behavior: next as ToolPermissionBehavior,
											};
											patch({ toolPermissionRules: list });
										}}
										options={toolRuleBehaviorOptions}
									/>
								</label>
								<label className="ref-settings-field ref-settings-field--compact" style={{ flex: 1, minWidth: 140 }}>
									<span>{t('agentBehavior.toolRuleToolName')}</span>
									<input
										type="text"
										value={rule.toolName}
										placeholder="Bash"
										onChange={(e) => {
											const next = [...(v.toolPermissionRules ?? [])];
											next[idx] = { ...rule, toolName: e.target.value };
											patch({ toolPermissionRules: next });
										}}
									/>
								</label>
							</div>
							<label className="ref-settings-field ref-settings-field--compact" style={{ marginTop: 8 }}>
								<span>{t('agentBehavior.toolRuleContent')}</span>
								<input
									type="text"
									value={rule.ruleContent ?? ''}
									placeholder={t('agentBehavior.toolRuleContentPh')}
									onChange={(e) => {
										const next = [...(v.toolPermissionRules ?? [])];
										next[idx] = { ...rule, ruleContent: e.target.value || undefined };
										patch({ toolPermissionRules: next });
									}}
								/>
							</label>
							<div className="ref-settings-tool-perm-rule-footer">
								<button
									type="button"
									className="ref-settings-tool-perm-rule-delete"
									onClick={() => {
										patch({
											toolPermissionRules: removeToolPermissionRuleAt(v.toolPermissionRules ?? [], idx),
										});
									}}
								>
									<IconTrash className="ref-settings-tool-perm-rule-delete-ico" />
									<span>{t('agentBehavior.toolRuleRemove')}</span>
								</button>
							</div>
						</li>
					))}
				</ul>
				<button
					type="button"
					className="ref-settings-agent-new-btn"
					style={{ marginTop: 10 }}
					onClick={() => {
						const row: AgentToolPermissionRule = {
							id: newToolPermRuleId(),
							behavior: 'allow',
							toolName: 'Bash',
							ruleContent: '',
						};
						patch({ toolPermissionRules: [...(v.toolPermissionRules ?? []), row] });
					}}
				>
					{t('agentBehavior.toolRuleAdd')}
				</button>
				<div className="ref-settings-agent-card-row" style={{ marginTop: 16 }}>
					<div>
						<div className="ref-settings-agent-card-title">{t('agentBehavior.avoidPromptsTitle')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentBehavior.avoidPromptsDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.shouldAvoidPermissionPrompts === true ? 'is-on' : ''}`}
						role="switch"
						aria-checked={v.shouldAvoidPermissionPrompts === true}
						onClick={() => patch({ shouldAvoidPermissionPrompts: v.shouldAvoidPermissionPrompts !== true })}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
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
