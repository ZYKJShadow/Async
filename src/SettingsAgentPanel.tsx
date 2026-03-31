import { useCallback, useState } from 'react';
import { useI18n } from './i18n';
import type {
	AgentCommand,
	AgentCustomization,
	AgentRule,
	AgentRuleScope,
	AgentSkill,
	AgentSubagent,
} from './agentSettingsTypes';
import { defaultAgentCustomization } from './agentSettingsTypes';

function newId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function IconInfo({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
		</svg>
	);
}

function IconDrag({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}

function IconChevDown({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 9l6 6 6-6" strokeLinecap="round" />
		</svg>
	);
}

/** Generic drag-to-reorder for a list of {id} items */
function useDragReorder<T extends { id: string }>(items: T[], onReorder: (next: T[]) => void) {
	const [dragId, setDragId] = useState<string | null>(null);

	const onDragStart = (e: React.DragEvent, id: string) => {
		setDragId(id);
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', id);
	};

	const onDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
	};

	const onDrop = (e: React.DragEvent, targetId: string) => {
		e.preventDefault();
		if (!dragId || dragId === targetId) {
			setDragId(null);
			return;
		}
		const fromIdx = items.findIndex((x) => x.id === dragId);
		const toIdx = items.findIndex((x) => x.id === targetId);
		if (fromIdx < 0 || toIdx < 0) {
			setDragId(null);
			return;
		}
		const next = [...items];
		const [moved] = next.splice(fromIdx, 1);
		next.splice(toIdx, 0, moved!);
		onReorder(next);
		setDragId(null);
	};

	const onDragEnd = () => setDragId(null);

	return { dragId, onDragStart, onDragOver, onDrop, onDragEnd };
}

type Props = {
	value: AgentCustomization;
	onChange: (next: AgentCustomization) => void;
};

export function SettingsAgentPanel({ value, onChange }: Props) {
	const { t } = useI18n();
	const v = { ...defaultAgentCustomization(), ...value };
	const rules = v.rules ?? [];
	const skills = v.skills ?? [];
	const subagents = v.subagents ?? [];
	const commands = v.commands ?? [];

	/** 折叠状态 */
	const [collapsedRules, setCollapsedRules] = useState<Set<string>>(new Set());
	const [collapsedSkills, setCollapsedSkills] = useState<Set<string>>(new Set());
	const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
	const [collapsedCmds, setCollapsedCmds] = useState<Set<string>>(new Set());

	const toggleCollapse = (set: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
		const next = new Set(set);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		setter(next);
	};

	const patch = useCallback(
		(p: Partial<AgentCustomization>) => {
			onChange({ ...v, ...p });
		},
		[v, onChange]
	);

	// ─── Rules ────────────────────────────────────────────
	const addRule = () => {
		const r: AgentRule = {
			id: newId(),
			name: '新规则',
			content: '',
			scope: 'always',
			enabled: true,
		};
		patch({ rules: [...rules, r] });
	};
	const updateRule = (id: string, p: Partial<AgentRule>) => {
		patch({ rules: rules.map((x) => (x.id === id ? { ...x, ...p } : x)) });
	};
	const removeRule = (id: string) => {
		patch({ rules: rules.filter((x) => x.id !== id) });
	};
	const rulesDrag = useDragReorder(rules, (next) => patch({ rules: next }));

	// ─── Skills ───────────────────────────────────────────
	const addSkill = () => {
		const s: AgentSkill = {
			id: newId(),
			name: '新 Skill',
			slug: 'myskill',
			description: '',
			content: '',
			enabled: true,
		};
		patch({ skills: [...skills, s] });
	};
	const updateSkill = (id: string, p: Partial<AgentSkill>) => {
		patch({ skills: skills.map((x) => (x.id === id ? { ...x, ...p } : x)) });
	};
	const removeSkill = (id: string) => {
		patch({ skills: skills.filter((x) => x.id !== id) });
	};
	const skillsDrag = useDragReorder(skills, (next) => patch({ skills: next }));

	// ─── Subagents ────────────────────────────────────────
	const addSub = () => {
		const s: AgentSubagent = {
			id: newId(),
			name: '新 Subagent',
			description: '',
			instructions: '',
			enabled: true,
		};
		patch({ subagents: [...subagents, s] });
	};
	const updateSub = (id: string, p: Partial<AgentSubagent>) => {
		patch({ subagents: subagents.map((x) => (x.id === id ? { ...x, ...p } : x)) });
	};
	const removeSub = (id: string) => {
		patch({ subagents: subagents.filter((x) => x.id !== id) });
	};
	const subsDrag = useDragReorder(subagents, (next) => patch({ subagents: next }));

	// ─── Commands ─────────────────────────────────────────
	const addCmd = () => {
		const c: AgentCommand = {
			id: newId(),
			name: '新命令',
			slash: 'cmd',
			body: '{{args}}',
		};
		patch({ commands: [...commands, c] });
	};
	const updateCmd = (id: string, p: Partial<AgentCommand>) => {
		patch({ commands: commands.map((x) => (x.id === id ? { ...x, ...p } : x)) });
	};
	const removeCmd = (id: string) => {
		patch({ commands: commands.filter((x) => x.id !== id) });
	};
	const cmdsDrag = useDragReorder(commands, (next) => patch({ commands: next }));

	return (
		<div className="ref-settings-panel ref-settings-panel--agent">
			<p className="ref-settings-lead ref-settings-agent-lead">
				{t('agentSettings.lead1')}
				<code className="ref-settings-code">./slug</code>
				{t('agentSettings.lead2')}
				<code className="ref-settings-code">/slash</code>
				{t('agentSettings.lead3')}
			</p>

			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-row">
					<div>
						<div className="ref-settings-agent-card-title">{t('agentSettings.importTitle')}</div>
						<p className="ref-settings-agent-card-desc">{t('agentSettings.importDesc')}</p>
					</div>
					<button
						type="button"
						className={`ref-settings-toggle ${v.importThirdPartyConfigs ? 'is-on' : ''}`}
						role="switch"
						aria-checked={!!v.importThirdPartyConfigs}
						onClick={() => patch({ importThirdPartyConfigs: !v.importThirdPartyConfigs })}
					>
						<span className="ref-settings-toggle-knob" />
					</button>
				</div>
			</div>

			<div className="ref-settings-agent-card">
				<div className="ref-settings-agent-card-title" style={{ marginBottom: 8 }}>
					{t('agentSettings.safetyTitle')}
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
			</div>

			{/* ─── Rules ─── */}
			<section className="ref-settings-agent-section" aria-labelledby="agent-rules-h">
				<div className="ref-settings-agent-section-head">
					<h2 id="agent-rules-h" className="ref-settings-agent-section-title">
						{t('agentSettings.rulesTitle')}
						<span className="ref-settings-agent-info-ico" title={t('agentSettings.rulesInfo')}>
							<IconInfo />
						</span>
					</h2>
					<button type="button" className="ref-settings-agent-new-btn" onClick={addRule}>
						+ {t('agentSettings.new')}
					</button>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.rulesDesc')}</p>
				<ul className="ref-settings-agent-list">
					{rules.map((r) => {
						const collapsed = collapsedRules.has(r.id);
						return (
							<li
								key={r.id}
								className={`ref-settings-agent-item ${rulesDrag.dragId === r.id ? 'is-dragging' : ''}`}
								draggable
								onDragStart={(e) => rulesDrag.onDragStart(e, r.id)}
								onDragOver={rulesDrag.onDragOver}
								onDrop={(e) => rulesDrag.onDrop(e, r.id)}
								onDragEnd={rulesDrag.onDragEnd}
							>
								<div className="ref-settings-agent-item-head">
									<span className="ref-settings-agent-drag-handle" aria-hidden>
										<IconDrag />
									</span>
									<button
										type="button"
										className={`ref-settings-toggle ref-settings-toggle--sm ${r.enabled ? 'is-on' : ''}`}
										role="switch"
										aria-checked={r.enabled}
										title={r.enabled ? t('settings.enabled') : t('settings.disabled')}
										onClick={() => updateRule(r.id, { enabled: !r.enabled })}
									>
										<span className="ref-settings-toggle-knob" />
									</button>
									<input
										className="ref-settings-agent-item-name"
										value={r.name}
										onChange={(e) => updateRule(r.id, { name: e.target.value })}
										aria-label={t('agentSettings.ruleNameAria')}
									/>
									<button
										type="button"
										className={`ref-settings-agent-collapse ${collapsed ? 'is-collapsed' : ''}`}
										onClick={() => toggleCollapse(collapsedRules, setCollapsedRules, r.id)}
										aria-label={collapsed ? 'Expand' : 'Collapse'}
									>
										<IconChevDown />
									</button>
									<button type="button" className="ref-settings-agent-remove" onClick={() => removeRule(r.id)}>
										{t('settings.removeModel')}
									</button>
								</div>
								{!collapsed && (
									<>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.scope')}</span>
											<select
												value={r.scope}
												onChange={(e) => updateRule(r.id, { scope: e.target.value as AgentRuleScope })}
											>
												<option value="always">{t('agentSettings.scopeAlways')}</option>
												<option value="glob">{t('agentSettings.scopeGlob')}</option>
												<option value="manual">{t('agentSettings.scopeManual')}</option>
											</select>
										</label>
										{r.scope === 'glob' ? (
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('agentSettings.globPattern')}</span>
												<input
													value={r.globPattern ?? ''}
													onChange={(e) => updateRule(r.id, { globPattern: e.target.value })}
													placeholder="**/*.tsx"
												/>
											</label>
										) : null}
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.ruleBody')}</span>
											<textarea
												rows={4}
												value={r.content}
												onChange={(e) => updateRule(r.id, { content: e.target.value })}
												placeholder={t('agentSettings.ruleBodyPh')}
											/>
										</label>
									</>
								)}
							</li>
						);
					})}
				</ul>
				{rules.length === 0 ? <p className="ref-settings-agent-empty">{t('agentSettings.rulesEmpty')}</p> : null}
			</section>

			{/* ─── Skills ─── */}
			<section className="ref-settings-agent-section" aria-labelledby="agent-skills-h">
				<div className="ref-settings-agent-section-head">
					<h2 id="agent-skills-h" className="ref-settings-agent-section-title">
						{t('agentSettings.skillsTitle')}
						<span className="ref-settings-agent-info-ico" title={t('agentSettings.skillsInfo')}>
							<IconInfo />
						</span>
					</h2>
					<button type="button" className="ref-settings-agent-new-btn" onClick={addSkill}>
						+ {t('agentSettings.new')}
					</button>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.skillsDesc')}</p>
				<ul className="ref-settings-agent-list">
					{skills.map((s) => {
						const collapsed = collapsedSkills.has(s.id);
						return (
							<li
								key={s.id}
								className={`ref-settings-agent-item ${skillsDrag.dragId === s.id ? 'is-dragging' : ''}`}
								draggable
								onDragStart={(e) => skillsDrag.onDragStart(e, s.id)}
								onDragOver={skillsDrag.onDragOver}
								onDrop={(e) => skillsDrag.onDrop(e, s.id)}
								onDragEnd={skillsDrag.onDragEnd}
							>
								<div className="ref-settings-agent-item-head">
									<span className="ref-settings-agent-drag-handle" aria-hidden>
										<IconDrag />
									</span>
									<button
										type="button"
										className={`ref-settings-toggle ref-settings-toggle--sm ${s.enabled !== false ? 'is-on' : ''}`}
										role="switch"
										aria-checked={s.enabled !== false}
										title={s.enabled !== false ? t('settings.enabled') : t('settings.disabled')}
										onClick={() => updateSkill(s.id, { enabled: s.enabled === false ? true : false })}
									>
										<span className="ref-settings-toggle-knob" />
									</button>
									<input
										className="ref-settings-agent-item-name"
										value={s.name}
										onChange={(e) => updateSkill(s.id, { name: e.target.value })}
										aria-label={t('agentSettings.skillNameAria')}
									/>
									<button
										type="button"
										className={`ref-settings-agent-collapse ${collapsed ? 'is-collapsed' : ''}`}
										onClick={() => toggleCollapse(collapsedSkills, setCollapsedSkills, s.id)}
										aria-label={collapsed ? 'Expand' : 'Collapse'}
									>
										<IconChevDown />
									</button>
									<button type="button" className="ref-settings-agent-remove" onClick={() => removeSkill(s.id)}>
										{t('settings.removeModel')}
									</button>
								</div>
								{!collapsed && (
									<>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.slugLabel')}</span>
											<input
												value={s.slug}
												onChange={(e) => updateSkill(s.id, { slug: e.target.value.replace(/^\.\//, '') })}
												placeholder="review"
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.skillIntro')}</span>
											<input
												value={s.description}
												onChange={(e) => updateSkill(s.id, { description: e.target.value })}
												placeholder={t('agentSettings.skillIntroPh')}
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.skillBody')}</span>
											<textarea
												rows={5}
												value={s.content}
												onChange={(e) => updateSkill(s.id, { content: e.target.value })}
												placeholder={t('agentSettings.skillBodyPh')}
											/>
										</label>
									</>
								)}
							</li>
						);
					})}
				</ul>
				{skills.length === 0 ? (
					<div className="ref-settings-agent-empty-block">
						<p>{t('agentSettings.skillsEmpty')}</p>
						<button type="button" className="ref-settings-agent-empty-cta" onClick={addSkill}>
							{t('agentSettings.newSkill')}
						</button>
					</div>
				) : null}
			</section>

			{/* ─── Subagents ─── */}
			<section className="ref-settings-agent-section" aria-labelledby="agent-subs-h">
				<div className="ref-settings-agent-section-head">
					<h2 id="agent-subs-h" className="ref-settings-agent-section-title">
						{t('agentSettings.subagentsTitle')}
						<span className="ref-settings-agent-info-ico" title={t('agentSettings.subagentsInfo')}>
							<IconInfo />
						</span>
					</h2>
					<button type="button" className="ref-settings-agent-new-btn" onClick={addSub}>
						+ {t('agentSettings.new')}
					</button>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.subagentsDesc')}</p>
				<ul className="ref-settings-agent-list">
					{subagents.map((s) => {
						const collapsed = collapsedSubs.has(s.id);
						return (
							<li
								key={s.id}
								className={`ref-settings-agent-item ${subsDrag.dragId === s.id ? 'is-dragging' : ''}`}
								draggable
								onDragStart={(e) => subsDrag.onDragStart(e, s.id)}
								onDragOver={subsDrag.onDragOver}
								onDrop={(e) => subsDrag.onDrop(e, s.id)}
								onDragEnd={subsDrag.onDragEnd}
							>
								<div className="ref-settings-agent-item-head">
									<span className="ref-settings-agent-drag-handle" aria-hidden>
										<IconDrag />
									</span>
									<button
										type="button"
										className={`ref-settings-toggle ref-settings-toggle--sm ${s.enabled !== false ? 'is-on' : ''}`}
										role="switch"
										aria-checked={s.enabled !== false}
										title={s.enabled !== false ? t('settings.enabled') : t('settings.disabled')}
										onClick={() => updateSub(s.id, { enabled: s.enabled === false ? true : false })}
									>
										<span className="ref-settings-toggle-knob" />
									</button>
									<input
										className="ref-settings-agent-item-name"
										value={s.name}
										onChange={(e) => updateSub(s.id, { name: e.target.value })}
										aria-label={t('agentSettings.subNameAria')}
									/>
									<button
										type="button"
										className={`ref-settings-agent-collapse ${collapsed ? 'is-collapsed' : ''}`}
										onClick={() => toggleCollapse(collapsedSubs, setCollapsedSubs, s.id)}
										aria-label={collapsed ? 'Expand' : 'Collapse'}
									>
										<IconChevDown />
									</button>
									<button type="button" className="ref-settings-agent-remove" onClick={() => removeSub(s.id)}>
										{t('settings.removeModel')}
									</button>
								</div>
								{!collapsed && (
									<>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.subDesc')}</span>
											<input
												value={s.description}
												onChange={(e) => updateSub(s.id, { description: e.target.value })}
												placeholder={t('agentSettings.subDescPh')}
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.subInstr')}</span>
											<textarea
												rows={5}
												value={s.instructions}
												onChange={(e) => updateSub(s.id, { instructions: e.target.value })}
												placeholder={t('agentSettings.subInstrPh')}
											/>
										</label>
									</>
								)}
							</li>
						);
					})}
				</ul>
				{subagents.length === 0 ? (
					<div className="ref-settings-agent-empty-block">
						<p>{t('agentSettings.subEmpty')}</p>
						<button type="button" className="ref-settings-agent-empty-cta" onClick={addSub}>
							{t('agentSettings.newSub')}
						</button>
					</div>
				) : null}
			</section>

			{/* ─── Commands ─── */}
			<section className="ref-settings-agent-section" aria-labelledby="agent-cmd-h">
				<div className="ref-settings-agent-section-head">
					<h2 id="agent-cmd-h" className="ref-settings-agent-section-title">
						{t('agentSettings.cmdTitle')}
						<span className="ref-settings-agent-info-ico" title={t('agentSettings.cmdInfo')}>
							<IconInfo />
						</span>
					</h2>
					<button type="button" className="ref-settings-agent-new-btn" onClick={addCmd}>
						+ {t('agentSettings.new')}
					</button>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.cmdDesc')}</p>
				<ul className="ref-settings-agent-list">
					{commands.map((c) => {
						const collapsed = collapsedCmds.has(c.id);
						return (
							<li
								key={c.id}
								className={`ref-settings-agent-item ${cmdsDrag.dragId === c.id ? 'is-dragging' : ''}`}
								draggable
								onDragStart={(e) => cmdsDrag.onDragStart(e, c.id)}
								onDragOver={cmdsDrag.onDragOver}
								onDrop={(e) => cmdsDrag.onDrop(e, c.id)}
								onDragEnd={cmdsDrag.onDragEnd}
							>
								<div className="ref-settings-agent-item-head">
									<span className="ref-settings-agent-drag-handle" aria-hidden>
										<IconDrag />
									</span>
									<input
										className="ref-settings-agent-item-name"
										value={c.name}
										onChange={(e) => updateCmd(c.id, { name: e.target.value })}
										aria-label={t('agentSettings.cmdNameAria')}
									/>
									<button
										type="button"
										className={`ref-settings-agent-collapse ${collapsed ? 'is-collapsed' : ''}`}
										onClick={() => toggleCollapse(collapsedCmds, setCollapsedCmds, c.id)}
										aria-label={collapsed ? 'Expand' : 'Collapse'}
									>
										<IconChevDown />
									</button>
									<button type="button" className="ref-settings-agent-remove" onClick={() => removeCmd(c.id)}>
										{t('settings.removeModel')}
									</button>
								</div>
								{!collapsed && (
									<>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.slashLabel')}</span>
											<input
												value={c.slash}
												onChange={(e) => updateCmd(c.id, { slash: e.target.value.replace(/^\//, '') })}
												placeholder="plan"
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.cmdTemplate')}</span>
											<textarea
												rows={4}
												value={c.body}
												onChange={(e) => updateCmd(c.id, { body: e.target.value })}
												placeholder={t('agentSettings.cmdTemplatePh')}
											/>
										</label>
									</>
								)}
							</li>
						);
					})}
				</ul>
				{commands.length === 0 ? (
					<div className="ref-settings-agent-empty-block">
						<p>{t('agentSettings.cmdEmpty')}</p>
						<button type="button" className="ref-settings-agent-empty-cta" onClick={addCmd}>
							{t('agentSettings.newCmd')}
						</button>
					</div>
				) : null}
			</section>
		</div>
	);
}
