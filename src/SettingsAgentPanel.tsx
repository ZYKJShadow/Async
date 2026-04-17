import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './i18n';
import type { AppLocale } from './i18n';
import type {
	AgentCommand,
	AgentCustomization,
	AgentItemOrigin,
	AgentMemoryScope,
	AgentRule,
	AgentRuleScope,
	AgentSkill,
	AgentSubagent,
} from './agentSettingsTypes';
import { createAutoReplyLanguageRule } from './autoReplyLanguageRule';
import {
	defaultAgentCustomization,
	isPluginImportedCommand,
	isPluginImportedSkill,
	isWorkspaceDiskImportedSkill,
} from './agentSettingsTypes';
import { VoidSelect } from './VoidSelect';
import { buildSlashCommandListRows } from './composerSlashCommands';

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

function IconTrash({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M10 11v6M14 11v6" strokeLinecap="round" />
		</svg>
	);
}

function BadgeLike({ text }: { text: string }) {
	return <span className="ref-settings-plugins-badge">{text}</span>;
}

const SLASH_HELP_COLLAPSED_ITEMS = 8;

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

type AgentLibraryFilter = 'all' | 'user' | 'project';

type Props = {
	value: AgentCustomization;
	onChange: (next: AgentCustomization) => void;
	locale: AppLocale;
	workspaceOpen: boolean;
	/** 新建 Skill：打开对话并由模型引导编写 SKILL.md */
	onOpenSkillCreator?: () => void | Promise<void>;
	/** 点击磁盘技能卡片时在编辑器中打开 SKILL.md */
	onOpenWorkspaceSkillFile?: (relPath: string) => void | Promise<void>;
	/** 删除磁盘技能目录（整夹）；返回是否成功 */
	onDeleteWorkspaceSkillDisk?: (skillMdRelPath: string) => Promise<boolean>;
};

function itemMatchesLibraryFilter(item: { origin?: AgentItemOrigin }, filter: AgentLibraryFilter): boolean {
	const o = item.origin ?? 'user';
	if (filter === 'all') return true;
	if (filter === 'user') return o === 'user';
	return o === 'project';
}

export function SettingsAgentPanel({
	value,
	onChange,
	locale,
	workspaceOpen,
	onOpenSkillCreator,
	onOpenWorkspaceSkillFile,
	onDeleteWorkspaceSkillDisk,
}: Props) {
	const { t } = useI18n();
	const v = { ...defaultAgentCustomization(), ...value };
	const rules = v.rules ?? [];
	const skills = v.skills ?? [];
	const subagents = v.subagents ?? [];
	const commands = v.commands ?? [];
	const autoReplyLanguageRule = useMemo(() => createAutoReplyLanguageRule(locale, locale), [locale]);

	const [libraryFilter, setLibraryFilter] = useState<AgentLibraryFilter>('all');
	const reorderEnabled = libraryFilter === 'all';

	const originForNewItem = (): AgentItemOrigin => {
		if (libraryFilter === 'project') return 'project';
		return 'user';
	};

	const canAddProjectItem = libraryFilter !== 'project' || workspaceOpen;

	/** 折叠状态 */
	const [collapsedRules, setCollapsedRules] = useState<Set<string>>(new Set());
	const [collapsedSkills, setCollapsedSkills] = useState<Set<string>>(new Set());
	const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
	const [collapsedCmds, setCollapsedCmds] = useState<Set<string>>(new Set());
	const [diskSkillDeletingId, setDiskSkillDeletingId] = useState<string | null>(null);

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
		if (!canAddProjectItem) return;
		const r: AgentRule = {
			id: newId(),
			name: '新规则',
			content: '',
			scope: 'always',
			enabled: true,
			origin: originForNewItem(),
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
	const updateSkill = (id: string, p: Partial<AgentSkill>) => {
		const cur = skills.find((x) => x.id === id);
		if (cur && (isWorkspaceDiskImportedSkill(cur) || isPluginImportedSkill(cur))) return;
		const nextEditable = editableSkills.map((x) => (x.id === id ? { ...x, ...p } : x));
		patch({ skills: [...pluginSkills, ...diskSkillsInWorkspace, ...nextEditable] });
	};
	const removeSkill = (id: string) => {
		const cur = skills.find((x) => x.id === id);
		if (cur && (isWorkspaceDiskImportedSkill(cur) || isPluginImportedSkill(cur))) return;
		patch({ skills: [...pluginSkills, ...diskSkillsInWorkspace, ...editableSkills.filter((x) => x.id !== id)] });
	};

	const pluginSkills = skills.filter((s) => isPluginImportedSkill(s));
	const diskSkillsInWorkspace = skills.filter((s) => isWorkspaceDiskImportedSkill(s) && s.skillSourceRelPath);
	const editableSkills = skills.filter((s) => !isWorkspaceDiskImportedSkill(s) && !isPluginImportedSkill(s));
	const skillsDrag = useDragReorder(editableSkills, (nextEditable) =>
		patch({ skills: [...pluginSkills, ...diskSkillsInWorkspace, ...nextEditable] })
	);

	const deleteDiskSkill = async (s: AgentSkill) => {
		const rel = s.skillSourceRelPath;
		if (!rel || !onDeleteWorkspaceSkillDisk) return;
		if (!window.confirm(t('agentSettings.skillDiskDeleteConfirm', { path: rel }))) return;
		setDiskSkillDeletingId(s.id);
		try {
			const ok = await onDeleteWorkspaceSkillDisk(rel);
			if (!ok) window.alert(t('agentSettings.skillDiskDeleteFailed'));
		} finally {
			setDiskSkillDeletingId(null);
		}
	};

	const onDiskCardOpenClick = (rel: string) => {
		if (onOpenWorkspaceSkillFile) void onOpenWorkspaceSkillFile(rel);
	};

	// ─── Subagents ────────────────────────────────────────
	const addSub = () => {
		if (!canAddProjectItem) return;
		const s: AgentSubagent = {
			id: newId(),
			name: '新 Subagent',
			description: '',
			instructions: '',
			enabled: true,
			origin: originForNewItem(),
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
	const subagentMemoryOptions: Array<{ value: AgentMemoryScope | 'none'; label: string }> = [
		{ value: 'none', label: t('agentSettings.subMemoryNone') },
		{ value: 'user', label: t('agentSettings.subMemoryUser') },
		{ value: 'project', label: t('agentSettings.subMemoryProject') },
		{ value: 'local', label: t('agentSettings.subMemoryLocal') },
	];
	const getSubagentMemoryLabel = (scope?: AgentMemoryScope): string | null => {
		if (!scope) return null;
		return subagentMemoryOptions.find((opt) => opt.value === scope)?.label ?? scope;
	};

	// ─── Commands ─────────────────────────────────────────
	const pluginCommands = commands.filter((command) => isPluginImportedCommand(command));
	const editableCommands = commands.filter((command) => !isPluginImportedCommand(command));
	const addCmd = () => {
		const c: AgentCommand = {
			id: newId(),
			name: '新命令',
			slash: 'cmd',
			body: '{{args}}',
			description: '',
		};
		patch({ commands: [...editableCommands, c, ...pluginCommands] });
	};
	const updateCmd = (id: string, p: Partial<AgentCommand>) => {
		patch({
			commands: [...editableCommands.map((x) => (x.id === id ? { ...x, ...p } : x)), ...pluginCommands],
		});
	};
	const removeCmd = (id: string) => {
		patch({ commands: [...editableCommands.filter((x) => x.id !== id), ...pluginCommands] });
	};
	const cmdsDrag = useDragReorder(editableCommands, (next) => patch({ commands: [...next, ...pluginCommands] }));
	const slashCmdHelpRows = useMemo(() => buildSlashCommandListRows(commands, t), [commands, t]);
	const [slashHelpExpanded, setSlashHelpExpanded] = useState(false);
	const slashHelpListRef = useRef<HTMLUListElement | null>(null);
	const [slashHelpHeights, setSlashHelpHeights] = useState({ collapsed: 0, expanded: 0 });
	const shouldCollapseSlashHelp = slashCmdHelpRows.length > SLASH_HELP_COLLAPSED_ITEMS;

	useLayoutEffect(() => {
		if (!shouldCollapseSlashHelp && slashHelpExpanded) {
			setSlashHelpExpanded(false);
		}
	}, [shouldCollapseSlashHelp, slashHelpExpanded]);

	useLayoutEffect(() => {
		const listEl = slashHelpListRef.current;
		if (!listEl) {
			return;
		}

		let frame = 0;
		const measure = () => {
			const items = Array.from(listEl.children) as HTMLElement[];
			const expanded = Math.ceil(listEl.scrollHeight);
			let collapsed = expanded;
			if (shouldCollapseSlashHelp && items.length > 0) {
				const lastVisibleIndex = Math.min(SLASH_HELP_COLLAPSED_ITEMS, items.length) - 1;
				const lastVisibleItem = items[lastVisibleIndex];
				if (lastVisibleItem) {
					collapsed = Math.ceil(lastVisibleItem.offsetTop + lastVisibleItem.offsetHeight);
				}
			}
			setSlashHelpHeights((prev) =>
				prev.collapsed === collapsed && prev.expanded === expanded ? prev : { collapsed, expanded }
			);
		};
		const scheduleMeasure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};

		scheduleMeasure();

		const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
		resizeObserver?.observe(listEl);
		window.addEventListener('resize', scheduleMeasure);

		return () => {
			cancelAnimationFrame(frame);
			resizeObserver?.disconnect();
			window.removeEventListener('resize', scheduleMeasure);
		};
	}, [shouldCollapseSlashHelp, slashCmdHelpRows]);

	const slashHelpVisibleHeight =
		shouldCollapseSlashHelp && slashHelpHeights.expanded > 0
			? slashHelpExpanded
				? slashHelpHeights.expanded
				: slashHelpHeights.collapsed
			: null;
	const hiddenSlashCount = Math.max(0, slashCmdHelpRows.length - SLASH_HELP_COLLAPSED_ITEMS);

	const renderOriginBadge = (origin?: AgentItemOrigin) => {
		const o = origin ?? 'user';
		return (
			<span
				className={`ref-settings-agent-origin-badge ${o === 'project' ? 'ref-settings-agent-origin-badge--project' : 'ref-settings-agent-origin-badge--user'}`}
			>
				{o === 'project' ? t('agentSettings.originProject') : t('agentSettings.originUser')}
			</span>
		);
	};

	return (
		<div className="ref-settings-panel ref-settings-panel--agent">
			<p className="ref-settings-lead ref-settings-agent-lead">{t('agentSettings.leadCursor')}</p>
			<div className="ref-settings-agent-scope-pills" role="tablist" aria-label={t('agentSettings.scopeFilterAria')}>
				{(['all', 'user', 'project'] as const).map((key) => (
					<button
						key={key}
						type="button"
						role="tab"
						aria-selected={libraryFilter === key}
						className={`ref-settings-agent-scope-pill ${libraryFilter === key ? 'is-active' : ''}`}
						onClick={() => setLibraryFilter(key)}
					>
						{key === 'all' ? t('agentSettings.scopeFilterAll') : null}
						{key === 'user' ? t('agentSettings.scopeFilterUser') : null}
						{key === 'project' ? t('agentSettings.scopeFilterProject') : null}
					</button>
				))}
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
					<button
						type="button"
						className="ref-settings-agent-new-btn"
						onClick={addRule}
						disabled={!canAddProjectItem}
						title={!canAddProjectItem ? t('agentSettings.needWorkspaceForProject') : undefined}
					>
						+ {t('agentSettings.new')}
					</button>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.rulesDesc')}</p>
				{libraryFilter !== 'project' ? (
					<ul className="ref-settings-agent-list">
						<li className="ref-settings-agent-item">
							<div className="ref-settings-agent-item-head">
								<span className="ref-settings-agent-drag-handle" aria-hidden>
									<IconDrag />
								</span>
								<button
									type="button"
									className="ref-settings-toggle ref-settings-toggle--sm is-on"
									role="switch"
									aria-checked="true"
									disabled
									title={t('agentSettings.autoLanguageRuleBadge')}
								>
									<span className="ref-settings-toggle-knob" />
								</button>
								<span className="ref-settings-agent-origin-badge ref-settings-agent-origin-badge--user">
									{t('agentSettings.autoLanguageRuleBadge')}
								</span>
								<input
									className="ref-settings-agent-item-name"
									value={autoReplyLanguageRule.name}
									readOnly
									aria-label={t('agentSettings.ruleNameAria')}
								/>
							</div>
							<div className="ref-settings-field ref-settings-field--compact">
								<p className="ref-settings-proxy-hint ref-settings-field-footnote">
									{t('agentSettings.autoLanguageRuleHint')}
								</p>
							</div>
							<label className="ref-settings-field ref-settings-field--compact">
								<span>{t('agentSettings.ruleBody')}</span>
								<textarea rows={3} value={autoReplyLanguageRule.content} readOnly />
							</label>
						</li>
					</ul>
				) : null}
				<ul className="ref-settings-agent-list">
					{rules.filter((r) => itemMatchesLibraryFilter(r, libraryFilter)).map((r) => {
						const collapsed = collapsedRules.has(r.id);
						return (
							<li
								key={r.id}
								className={`ref-settings-agent-item ${rulesDrag.dragId === r.id ? 'is-dragging' : ''}`}
								draggable={reorderEnabled}
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
									{renderOriginBadge(r.origin)}
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
											<span>{t('agentSettings.itemScopeStorage')}</span>
											<VoidSelect
												value={r.origin ?? 'user'}
												onChange={(v) => updateRule(r.id, { origin: v as AgentItemOrigin })}
												options={[
													{ value: 'user', label: t('agentSettings.originUser') },
													{ value: 'project', label: t('agentSettings.originProject'), disabled: !workspaceOpen },
												]}
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.scope')}</span>
											<VoidSelect
												value={r.scope}
												onChange={(v) => updateRule(r.id, { scope: v as AgentRuleScope })}
												options={[
													{ value: 'always', label: t('agentSettings.scopeAlways') },
													{ value: 'glob', label: t('agentSettings.scopeGlob') },
													{ value: 'manual', label: t('agentSettings.scopeManual') },
												]}
											/>
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
				{rules.length === 0 ? (
					<p className="ref-settings-agent-empty">{t('agentSettings.rulesEmpty')}</p>
				) : rules.filter((r) => itemMatchesLibraryFilter(r, libraryFilter)).length === 0 ? (
					<p className="ref-settings-agent-empty">{t('agentSettings.rulesEmptyFiltered')}</p>
				) : null}
			</section>

			{/* ─── Skills ─── */}
			<section className="ref-settings-agent-section" aria-labelledby="agent-skills-h">
				<div className="ref-settings-agent-section-head ref-settings-agent-section-head--wrap">
					<h2 id="agent-skills-h" className="ref-settings-agent-section-title">
						{t('agentSettings.skillsTitle')}
						<span className="ref-settings-agent-info-ico" title={t('agentSettings.skillsInfo')}>
							<IconInfo />
						</span>
					</h2>
					<div className="ref-settings-agent-head-actions">
						{onOpenSkillCreator ? (
							<button type="button" className="ref-settings-agent-new-btn" onClick={() => void onOpenSkillCreator()}>
								{t('agentSettings.skillsNew')}
							</button>
						) : null}
					</div>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.skillsDesc')}</p>
				{(() => {
					const pluginFiltered = pluginSkills.filter((s) => itemMatchesLibraryFilter(s, libraryFilter));
					const diskFiltered = diskSkillsInWorkspace.filter((s) => itemMatchesLibraryFilter(s, libraryFilter));
					const editableFiltered = editableSkills.filter((s) => itemMatchesLibraryFilter(s, libraryFilter));
					const visibleSkillCount = pluginFiltered.length + diskFiltered.length + editableFiltered.length;
					return (
						<>
							{pluginFiltered.length > 0 ? (
								<details className="ref-settings-provider-details" style={{ marginBottom: 14 }}>
									<summary className="ref-settings-provider-summary">
										<span className="ref-settings-provider-summary-chev" aria-hidden />
										<span className="ref-settings-provider-summary-text">{t('agentSettings.pluginSkillsTitle')}</span>
										<span className="ref-settings-provider-summary-tag">{String(pluginFiltered.length)}</span>
									</summary>
									<ul className="ref-settings-agent-skill-disk-list" style={{ marginTop: 14 }}>
										{pluginFiltered.map((s) => (
											<li key={s.id} className="ref-settings-agent-skill-disk-card">
												<div className="ref-settings-agent-skill-disk-main">
													<div className="ref-settings-plugins-badge-row">
														<BadgeLike text={s.pluginSourceName ?? t('settings.nav.plugins')} />
														<BadgeLike text={`./${s.slug}`} />
													</div>
													<div className="ref-settings-agent-skill-disk-title">{s.name}</div>
													<div className="ref-settings-agent-skill-disk-desc">{s.description}</div>
													{s.pluginSourceRelPath ? (
														<div className="ref-settings-agent-skill-disk-path" title={s.pluginSourceRelPath}>
															{s.pluginSourceRelPath}
														</div>
													) : null}
												</div>
											</li>
										))}
									</ul>
								</details>
							) : null}
							{diskFiltered.length > 0 ? (
								<>
									<ul className="ref-settings-agent-skill-disk-list">
										{diskFiltered.map((s) => {
											const rel = s.skillSourceRelPath!;
											const busy = diskSkillDeletingId === s.id;
											const canOpen = !!onOpenWorkspaceSkillFile;
											return (
												<li key={s.id} className="ref-settings-agent-skill-disk-card">
													<button
														type="button"
														className={`ref-settings-agent-skill-disk-main ${canOpen ? 'is-clickable' : ''}`}
														disabled={!canOpen || busy}
														onClick={() => onDiskCardOpenClick(rel)}
														aria-label={t('agentSettings.skillDiskOpenAria', { name: s.name })}
													>
														<div className="ref-settings-agent-skill-disk-title">{s.name}</div>
														<div className="ref-settings-agent-skill-disk-desc">{s.description}</div>
														<div className="ref-settings-agent-skill-disk-path" title={rel}>
															{rel}
														</div>
													</button>
													<button
														type="button"
														className="ref-settings-agent-skill-disk-trash"
														disabled={busy || !onDeleteWorkspaceSkillDisk}
														title={t('agentSettings.skillDiskDeleteTitle')}
														aria-label={t('agentSettings.skillDiskDeleteTitle')}
														onClick={() => void deleteDiskSkill(s)}
													>
														<IconTrash />
													</button>
												</li>
											);
										})}
									</ul>
								</>
							) : null}
							{editableFiltered.length > 0 ? (
								<ul className="ref-settings-agent-list">
									{editableFiltered.map((s) => {
										const collapsed = collapsedSkills.has(s.id);
										const rowDraggable = reorderEnabled;
										return (
											<li
												key={s.id}
												className={`ref-settings-agent-item ${skillsDrag.dragId === s.id ? 'is-dragging' : ''}`}
												draggable={rowDraggable}
												onDragStart={(e) => rowDraggable && skillsDrag.onDragStart(e, s.id)}
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
													{renderOriginBadge(s.origin)}
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
															<span>{t('agentSettings.itemScopeStorage')}</span>
															<VoidSelect
																value={s.origin ?? 'user'}
																onChange={(v) => updateSkill(s.id, { origin: v as AgentItemOrigin })}
																options={[
																	{ value: 'user', label: t('agentSettings.originUser') },
																	{
																		value: 'project',
																		label: t('agentSettings.originProject'),
																		disabled: !workspaceOpen,
																	},
																]}
															/>
														</label>
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
							) : null}
							{visibleSkillCount === 0 && skills.length === 0 ? null : visibleSkillCount === 0 ? (
								<p className="ref-settings-agent-empty">{t('agentSettings.skillsEmptyFiltered')}</p>
							) : null}
						</>
					);
				})()}
				{skills.length === 0 ? (
					<div className="ref-settings-agent-empty-block">
						<p>{t('agentSettings.skillsEmpty')}</p>
						{onOpenSkillCreator ? (
							<div className="ref-settings-agent-empty-actions">
								<button type="button" className="ref-settings-agent-empty-cta" onClick={() => void onOpenSkillCreator()}>
									{t('agentSettings.skillsNew')}
								</button>
							</div>
						) : null}
					</div>
				) : skills.filter((s) => itemMatchesLibraryFilter(s, libraryFilter)).length === 0 ? (
					<div className="ref-settings-agent-empty-block">
						<p>{t('agentSettings.skillsEmptyFiltered')}</p>
						{onOpenSkillCreator ? (
							<div className="ref-settings-agent-empty-actions">
								<button type="button" className="ref-settings-agent-empty-cta" onClick={() => void onOpenSkillCreator()}>
									{t('agentSettings.skillsNew')}
								</button>
							</div>
						) : null}
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
					<button
						type="button"
						className="ref-settings-agent-new-btn"
						onClick={addSub}
						disabled={!canAddProjectItem}
						title={!canAddProjectItem ? t('agentSettings.needWorkspaceForProject') : undefined}
					>
						+ {t('agentSettings.new')}
					</button>
				</div>
				<p className="ref-settings-agent-section-desc">{t('agentSettings.subagentsDesc')}</p>
				<ul className="ref-settings-agent-list">
					{subagents.filter((s) => itemMatchesLibraryFilter(s, libraryFilter)).map((s) => {
						const collapsed = collapsedSubs.has(s.id);
						const memoryLabel = getSubagentMemoryLabel(s.memoryScope);
						return (
							<li
								key={s.id}
								className={`ref-settings-agent-item ${subsDrag.dragId === s.id ? 'is-dragging' : ''}`}
								draggable={reorderEnabled}
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
									{renderOriginBadge(s.origin)}
									{memoryLabel ? (
										<span
											className="ref-settings-agent-memory-badge"
											title={`${t('agentSettings.subMemoryScope')}: ${memoryLabel}`}
										>
											{memoryLabel}
										</span>
									) : null}
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
											<span>{t('agentSettings.itemScopeStorage')}</span>
											<VoidSelect
												value={s.origin ?? 'user'}
												onChange={(v) => updateSub(s.id, { origin: v as AgentItemOrigin })}
												options={[
													{ value: 'user', label: t('agentSettings.originUser') },
													{ value: 'project', label: t('agentSettings.originProject'), disabled: !workspaceOpen },
												]}
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.subDesc')}</span>
											<input
												value={s.description}
												onChange={(e) => updateSub(s.id, { description: e.target.value })}
												placeholder={t('agentSettings.subDescPh')}
											/>
										</label>
										<label className="ref-settings-field ref-settings-field--compact">
											<span>{t('agentSettings.subMemoryScope')}</span>
											<VoidSelect
												value={s.memoryScope ?? 'none'}
												onChange={(v) =>
													updateSub(s.id, {
														memoryScope: v === 'none' ? undefined : (v as AgentMemoryScope),
													})
												}
												options={subagentMemoryOptions}
											/>
											<small className="ref-settings-field-hint">{t('agentSettings.subMemoryScopeHint')}</small>
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
						<button type="button" className="ref-settings-agent-empty-cta" onClick={addSub} disabled={!canAddProjectItem}>
							{t('agentSettings.newSub')}
						</button>
					</div>
				) : subagents.filter((s) => itemMatchesLibraryFilter(s, libraryFilter)).length === 0 ? (
					<div className="ref-settings-agent-empty-block">
						<p>{t('agentSettings.subEmptyFiltered')}</p>
						<button type="button" className="ref-settings-agent-empty-cta" onClick={addSub} disabled={!canAddProjectItem}>
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
				<div className="ref-settings-agent-slash-help" aria-label={t('agentSettings.cmdSlashListAria')}>
					<h3 className="ref-settings-agent-subheading">{t('agentSettings.cmdSlashListTitle')}</h3>
					<div
						className={`ref-settings-agent-slash-help-list-shell ${shouldCollapseSlashHelp ? (slashHelpExpanded ? 'is-expanded' : 'is-collapsed') : 'is-static'}`}
						style={slashHelpVisibleHeight ? { maxHeight: `${slashHelpVisibleHeight}px` } : undefined}
					>
						<ul id="ref-settings-agent-slash-help-list" ref={slashHelpListRef} className="ref-settings-agent-slash-help-list">
							{slashCmdHelpRows.map((row, i) => (
								<li key={`${row.label}-${i}`} className="ref-settings-agent-slash-help-item">
									<div className="ref-settings-agent-slash-help-row">
										<code className="ref-settings-agent-slash-help-code">{row.label}</code>
										<span
											className={`ref-settings-agent-slash-help-badge ${row.source !== 'builtin' ? 'ref-settings-agent-slash-help-badge--user' : ''}`}
										>
											{row.source === 'builtin'
												? t('slashCmd.helpBuiltin')
												: row.source === 'plugin'
													? t('slashCmd.helpPlugin')
													: t('slashCmd.helpUser')}
										</span>
									</div>
									{row.description ? (
										<p className="ref-settings-agent-slash-help-desc">{row.description}</p>
									) : null}
								</li>
							))}
						</ul>
					</div>
					{shouldCollapseSlashHelp ? (
						<div className="ref-settings-agent-slash-help-actions">
							<button
								type="button"
								className={`ref-settings-agent-slash-help-toggle ${slashHelpExpanded ? 'is-expanded' : ''}`}
								onClick={() => setSlashHelpExpanded((prev) => !prev)}
								aria-expanded={slashHelpExpanded}
								aria-controls="ref-settings-agent-slash-help-list"
							>
								<span>
									{slashHelpExpanded
										? t('agentSettings.cmdSlashListCollapse')
										: t('agentSettings.cmdSlashListExpand', { count: String(hiddenSlashCount) })}
								</span>
								<IconChevDown className="ref-settings-agent-slash-help-toggle-ico" />
							</button>
						</div>
					) : null}
				</div>
				{pluginCommands.length > 0 ? (
					<details className="ref-settings-provider-details" style={{ marginBottom: 14 }}>
						<summary className="ref-settings-provider-summary">
							<span className="ref-settings-provider-summary-chev" aria-hidden />
							<span className="ref-settings-provider-summary-text">{t('agentSettings.pluginCommandsTitle')}</span>
							<span className="ref-settings-provider-summary-tag">{String(pluginCommands.length)}</span>
						</summary>
						<ul className="ref-settings-agent-skill-disk-list" style={{ marginTop: 14 }}>
							{pluginCommands.map((c) => (
								<li key={c.id} className="ref-settings-agent-skill-disk-card">
									<div className="ref-settings-agent-skill-disk-main">
										<div className="ref-settings-plugins-badge-row">
											<BadgeLike text={c.pluginSourceName ?? t('settings.nav.plugins')} />
											<BadgeLike text={`/${c.slash}`} />
										</div>
										<div className="ref-settings-agent-skill-disk-title">{c.name}</div>
										<div className="ref-settings-agent-skill-disk-desc">
											{c.description || t('agentSettings.pluginCommandFallbackDesc')}
										</div>
										{c.pluginSourceRelPath ? (
											<div className="ref-settings-agent-skill-disk-path" title={c.pluginSourceRelPath}>
												{c.pluginSourceRelPath}
											</div>
										) : null}
									</div>
								</li>
							))}
						</ul>
					</details>
				) : null}
				<ul className="ref-settings-agent-list">
					{editableCommands.map((c) => {
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
											<span>{t('agentSettings.cmdDescField')}</span>
											<input
												value={c.description ?? ''}
												onChange={(e) => updateCmd(c.id, { description: e.target.value })}
												placeholder={t('agentSettings.cmdDescFieldPh')}
												autoComplete="off"
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
