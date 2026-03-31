import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	AUTO_MODEL_ID,
	createEmptyUserModel,
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	type UserModelEntry,
} from './modelCatalog';
import { LLM_PROVIDER_OPTIONS, type ModelRequestParadigm } from './llmProvider';
import type { AgentCustomization } from './agentSettingsTypes';
import { SettingsAgentPanel } from './SettingsAgentPanel';
import { EditorSettingsPanel, type EditorSettings } from './EditorSettingsPanel';
import { SettingsIndexingPanel } from './SettingsIndexingPanel';
import { SettingsMcpPanel } from './SettingsMcpPanel';
import type { McpServerConfig, McpServerStatus } from './mcpTypes';
import type { IndexingSettingsState } from './indexingSettingsTypes';
import { useI18n, type AppLocale } from './i18n';

export type SettingsNavId =
	| 'general'
	| 'appearance'
	| 'editor'
	| 'plan'
	| 'agents'
	| 'tab'
	| 'models'
	| 'cloud'
	| 'plugins'
	| 'rules'
	| 'tools'
	| 'hooks'
	| 'mcp'
	| 'indexing'
	| 'network'
	| 'beta'
	| 'dev';

type NavItem = { id: SettingsNavId; label: string; badge?: number; soon?: boolean };

function navItemsForT(t: (key: string) => string): NavItem[] {
	return [
		{ id: 'general', label: t('settings.nav.general') },
		{ id: 'appearance', label: t('settings.nav.appearance'), soon: true },
		{ id: 'editor', label: t('settings.nav.editor') },
		{ id: 'plan', label: t('settings.nav.plan'), soon: true },
		{ id: 'agents', label: t('settings.nav.agents'), soon: true },
		{ id: 'tab', label: t('settings.nav.tab'), soon: true },
		{ id: 'models', label: t('settings.nav.models'), badge: 1 },
		{ id: 'cloud', label: t('settings.nav.cloud'), soon: true },
		{ id: 'plugins', label: t('settings.nav.plugins'), soon: true },
		{ id: 'rules', label: t('settings.nav.rules') },
		{ id: 'tools', label: t('settings.nav.tools'), soon: true },
		{ id: 'hooks', label: t('settings.nav.hooks'), soon: true },
		{ id: 'mcp', label: t('settings.nav.mcp') },
		{ id: 'indexing', label: t('settings.nav.indexing') },
		{ id: 'network', label: t('settings.nav.network'), soon: true },
		{ id: 'beta', label: t('settings.nav.beta'), soon: true },
		{ id: 'dev', label: t('settings.nav.dev'), soon: true },
	];
}

const SETTINGS_SIDEBAR_KEY = 'async:settings-sidebar-w-v1';
const SETTINGS_SIDEBAR_DEFAULT = 260;
const SETTINGS_SIDEBAR_MIN = 200;
const SETTINGS_SIDEBAR_MAX = 480;

function readSettingsSidebarWidth(): number {
	try {
		if (typeof window === 'undefined') {
			return SETTINGS_SIDEBAR_DEFAULT;
		}
		const raw = localStorage.getItem(SETTINGS_SIDEBAR_KEY);
		if (raw) {
			const n = Number.parseInt(raw, 10);
			if (!Number.isNaN(n)) {
				return clampSettingsSidebarWidth(n);
			}
		}
	} catch {
		/* ignore */
	}
	return SETTINGS_SIDEBAR_DEFAULT;
}

function clampSettingsSidebarWidth(w: number): number {
	const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
	const maxByViewport = Math.max(SETTINGS_SIDEBAR_MIN + 20, vw - 360);
	const cap = Math.min(SETTINGS_SIDEBAR_MAX, maxByViewport);
	return Math.min(Math.max(w, SETTINGS_SIDEBAR_MIN), cap);
}

function IconGear({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" />
		</svg>
	);
}

function IconChip({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="4" y="8" width="16" height="8" rx="2" />
			<path d="M9 12h.01M15 12h.01" strokeLinecap="round" />
		</svg>
	);
}

function IconSearch({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
		</svg>
	);
}

function IconBack({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconPlug({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 22v-6M9 8V2M15 8V2M12 16a4 4 0 00-4-4V8h8v4a4 4 0 00-4 4z" strokeLinecap="round" />
		</svg>
	);
}

function navIcon(id: SettingsNavId) {
	switch (id) {
		case 'general':
			return <IconGear />;
		case 'models':
			return <IconChip />;
		case 'mcp':
			return <IconPlug />;
		default:
			return <IconGear />;
	}
}

type Props = {
	onClose: () => void;
	initialNav: SettingsNavId;
	apiKey: string;
	baseURL: string;
	defaultModel: string;
	proxyUrl: string;
	anthropicApiKey: string;
	anthropicBaseURL: string;
	geminiApiKey: string;
	modelEntries: UserModelEntry[];
	enabledIds: string[];
	onChangeApiKey: (v: string) => void;
	onChangeBaseURL: (v: string) => void;
	onChangeProxyUrl: (v: string) => void;
	onChangeAnthropicApiKey: (v: string) => void;
	onChangeAnthropicBaseURL: (v: string) => void;
	onChangeGeminiApiKey: (v: string) => void;
	onChangeModelEntries: (entries: UserModelEntry[]) => void;
	onToggleEnabled: (id: string, enabled: boolean) => void;
	onPickDefaultModel: (id: string) => void;
	agentCustomization: AgentCustomization;
	onChangeAgentCustomization: (v: AgentCustomization) => void;
	editorSettings: EditorSettings;
	onChangeEditorSettings: (v: EditorSettings) => void;
	/** 语言切换后立即持久化（与关闭设置页时的全量保存配合） */
	onPersistLanguage?: (locale: AppLocale) => void;
	indexingSettings: IndexingSettingsState;
	onChangeIndexingSettings: (v: IndexingSettingsState) => void;
	onPersistIndexingPatch: (patch: Partial<IndexingSettingsState>) => void;
	/** MCP 服务器配置 */
	mcpServers: McpServerConfig[];
	onChangeMcpServers: (servers: McpServerConfig[]) => void;
	mcpStatuses: McpServerStatus[];
	onRefreshMcpStatuses: () => void;
	onStartMcpServer: (id: string) => void;
	onStopMcpServer: (id: string) => void;
	onRestartMcpServer: (id: string) => void;
	shell: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } | null;
	workspaceOpen: boolean;
};

export function SettingsPage({
	onClose,
	initialNav,
	apiKey,
	baseURL,
	defaultModel,
	proxyUrl,
	anthropicApiKey,
	anthropicBaseURL,
	geminiApiKey,
	modelEntries,
	enabledIds,
	onChangeApiKey,
	onChangeBaseURL,
	onChangeProxyUrl,
	onChangeAnthropicApiKey,
	onChangeAnthropicBaseURL,
	onChangeGeminiApiKey,
	onChangeModelEntries,
	onToggleEnabled,
	onPickDefaultModel,
	agentCustomization,
	onChangeAgentCustomization,
	editorSettings,
	onChangeEditorSettings,
	onPersistLanguage,
	indexingSettings,
	onChangeIndexingSettings,
	onPersistIndexingPatch,
	mcpServers,
	onChangeMcpServers,
	mcpStatuses,
	onRefreshMcpStatuses,
	onStartMcpServer,
	onStopMcpServer,
	onRestartMcpServer,
	shell,
	workspaceOpen,
}: Props) {
	const { t, locale, setLocale } = useI18n();
	const navItems = useMemo(() => navItemsForT(t), [t]);
	const [nav, setNav] = useState<SettingsNavId>(initialNav);
	const [search, setSearch] = useState('');
	const [sidebarWidth, setSidebarWidth] = useState(() => readSettingsSidebarWidth());

	const beginResizeSidebar = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startW = sidebarWidth;
		const onMove = (ev: MouseEvent) => {
			const next = clampSettingsSidebarWidth(startW + (ev.clientX - startX));
			setSidebarWidth(next);
		};
		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			setSidebarWidth((w) => {
				const c = clampSettingsSidebarWidth(w);
				try {
					localStorage.setItem(SETTINGS_SIDEBAR_KEY, String(c));
				} catch {
					/* ignore */
				}
				return c;
			});
		};
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}, [sidebarWidth]);

	const resetSidebarWidth = useCallback(() => {
		const w = clampSettingsSidebarWidth(SETTINGS_SIDEBAR_DEFAULT);
		setSidebarWidth(w);
		try {
			localStorage.setItem(SETTINGS_SIDEBAR_KEY, String(w));
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	useEffect(() => {
		const onResize = () => setSidebarWidth((w) => clampSettingsSidebarWidth(w));
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	const enabledSet = useMemo(() => new Set(enabledIds), [enabledIds]);

	const filteredEntries = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) {
			return modelEntries;
		}
		return modelEntries.filter((m) => {
			const dn = m.displayName.toLowerCase();
			const rn = m.requestName.toLowerCase();
			const pl = t(`settings.paradigm.${m.paradigm}`).toLowerCase();
			return dn.includes(q) || rn.includes(q) || pl.includes(q);
		});
	}, [modelEntries, search, t]);

	const patchEntry = useCallback(
		(id: string, patch: Partial<UserModelEntry>) => {
			onChangeModelEntries(modelEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
		},
		[modelEntries, onChangeModelEntries]
	);

	const removeEntry = useCallback(
		(id: string) => {
			onChangeModelEntries(modelEntries.filter((e) => e.id !== id));
			if (defaultModel === id) {
				onPickDefaultModel(AUTO_MODEL_ID);
			}
		},
		[modelEntries, onChangeModelEntries, defaultModel, onPickDefaultModel]
	);

	const addModel = useCallback(() => {
		onChangeModelEntries([...modelEntries, createEmptyUserModel()]);
	}, [modelEntries, onChangeModelEntries]);

	return (
		<div className="ref-settings-root" role="dialog" aria-modal="true" aria-label={t('settings.dialogAria')}>
			<div className="ref-settings-layout">
				<aside className="ref-settings-sidebar" style={{ width: sidebarWidth }}>
					<div className="ref-settings-sidebar-tools">
						<button type="button" className="ref-settings-icon-btn" aria-label={t('common.search')} title={t('common.search')}>
							<IconSearch />
						</button>
						<button type="button" className="ref-settings-icon-btn" onClick={onClose} aria-label={t('common.back')} title={t('common.back')}>
							<IconBack />
						</button>
					</div>
					<nav className="ref-settings-nav" aria-label={t('settings.navAria')}>
						{navItems.map((item) => (
							<button
								key={item.id}
								type="button"
								className={`ref-settings-nav-row ${nav === item.id ? 'is-active' : ''}`}
								onClick={() => {
									if (
										item.soon &&
										item.id !== 'models' &&
										item.id !== 'general' &&
										item.id !== 'editor' &&
										item.id !== 'indexing' &&
										item.id !== 'mcp'
									) {
										return;
									}
									setNav(item.id);
								}}
								disabled={!!item.soon}
							>
								<span className="ref-settings-nav-ico">{navIcon(item.id)}</span>
								<span className="ref-settings-nav-label">{item.label}</span>
								{item.badge != null ? <span className="ref-settings-nav-badge">{item.badge}</span> : null}
								{item.soon ? <span className="ref-settings-nav-soon">{t('common.soon')}</span> : null}
							</button>
						))}
					</nav>
					<div className="ref-settings-sidebar-foot">
						<div className="ref-settings-user-chip">
							<div className="ref-settings-user-avatar" aria-hidden />
							<span className="ref-settings-user-text">{t('settings.userChip')}</span>
						</div>
					</div>
				</aside>

				<div
					className="ref-settings-resize-handle"
					role="separator"
					aria-orientation="vertical"
					aria-label={t('settings.resizeSidebarAria')}
					title={t('settings.resizeSidebarTitle')}
					onMouseDown={beginResizeSidebar}
					onDoubleClick={resetSidebarWidth}
				/>

				<div className="ref-settings-main">
					<div className="ref-settings-main-inner">
						<div key={nav} className="ref-settings-nav-swap">
						<div className="ref-settings-main-head">
							<h1 className="ref-settings-title">
								{nav === 'general' ? t('settings.title.general') : null}
								{nav === 'models' ? t('settings.title.models') : null}
								{nav === 'rules' ? t('settings.title.rules') : null}
								{nav === 'editor' ? t('settings.title.editor') : null}
								{nav === 'mcp' ? t('settings.title.mcp') : null}
								{nav === 'indexing' ? t('settings.title.indexing') : null}
								{nav !== 'general' &&
								nav !== 'models' &&
								nav !== 'rules' &&
								nav !== 'editor' &&
								nav !== 'mcp' &&
								nav !== 'indexing'
									? t('settings.title.comingSoon')
									: null}
							</h1>
						</div>

						{nav === 'general' ? (
							<div className="ref-settings-panel">
								<p className="ref-settings-lead">
									{t('settings.general.lead1')}
									<strong>{t('settings.general.leadBold1')}</strong>
									{t('settings.general.lead2')}
									<strong>{t('settings.general.leadBold2')}</strong>
									{t('settings.general.lead3')}
								</p>
								<div className="ref-settings-field ref-settings-field--language">
									<span>{t('settings.language')}</span>
									<p className="ref-settings-proxy-hint">{t('settings.languageHint')}</p>
									<select
										value={locale}
										aria-label={t('settings.language')}
										onChange={(e) => {
											const next = e.target.value === 'en' ? 'en' : 'zh-CN';
											setLocale(next);
											onPersistLanguage?.(next);
										}}
									>
										<option value="zh-CN">{t('settings.languageZh')}</option>
										<option value="en">{t('settings.languageEn')}</option>
									</select>
								</div>
							</div>
						) : null}

						{nav === 'models' ? (
							<div className="ref-settings-panel ref-settings-panel--models">
								<p className="ref-settings-models-hint">{t('settings.modelsHint')}</p>

								<section className="ref-settings-global-creds" aria-labelledby="ref-settings-global-creds-title">
									<div className="ref-settings-global-creds-head">
										<h2 id="ref-settings-global-creds-title" className="ref-settings-global-creds-title">
											{t('settings.modelsGlobalCredsTitle')}
										</h2>
										<p className="ref-settings-global-creds-lead">{t('settings.modelsGlobalCredsLead')}</p>
									</div>
									<div className="ref-settings-global-creds-body">
										<div className="ref-settings-global-creds-block">
											<p className="ref-settings-global-creds-block-hint">{t('settings.openaiKeyHint')}</p>
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('settings.openaiKey')}</span>
												<input
													value={apiKey}
													onChange={(e) => onChangeApiKey(e.target.value)}
													type="password"
													autoComplete="off"
													placeholder="sk-…"
												/>
											</label>
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('settings.openaiBase')}</span>
												<input
													value={baseURL}
													onChange={(e) => onChangeBaseURL(e.target.value)}
													placeholder={t('settings.placeholder.openaiBase')}
												/>
											</label>
										</div>
										<div className="ref-settings-global-creds-block">
											<p className="ref-settings-global-creds-block-hint">{t('settings.anthropicKeyHint')}</p>
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('settings.anthropicKey')}</span>
												<input
													value={anthropicApiKey}
													onChange={(e) => onChangeAnthropicApiKey(e.target.value)}
													type="password"
													autoComplete="off"
													placeholder="sk-ant-…"
												/>
											</label>
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('settings.anthropicBase')}</span>
												<input
													value={anthropicBaseURL}
													onChange={(e) => onChangeAnthropicBaseURL(e.target.value)}
													placeholder={t('settings.placeholder.anthropicBase')}
												/>
											</label>
										</div>
										<div className="ref-settings-global-creds-block">
											<p className="ref-settings-global-creds-block-hint">{t('settings.geminiKeyHint')}</p>
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('settings.geminiKey')}</span>
												<input
													value={geminiApiKey}
													onChange={(e) => onChangeGeminiApiKey(e.target.value)}
													type="password"
													autoComplete="off"
													placeholder="AIza…"
												/>
											</label>
										</div>
										<div className="ref-settings-global-creds-block ref-settings-global-creds-block--proxy">
											<p className="ref-settings-global-creds-block-hint">{t('settings.proxyHint')}</p>
											<label className="ref-settings-field ref-settings-field--compact">
												<span>{t('settings.proxy')}</span>
												<input
													value={proxyUrl}
													onChange={(e) => onChangeProxyUrl(e.target.value)}
													autoComplete="off"
													placeholder="http://127.0.0.1:7890"
												/>
											</label>
										</div>
									</div>
								</section>

								<h2 className="ref-settings-subhead ref-settings-subhead--models-catalog">{t('settings.modelCatalog')}</h2>
								<div className="ref-settings-models-toolbar">
									<div className="ref-settings-models-search-wrap ref-settings-models-search-wrap--grow">
										<IconSearch className="ref-settings-models-search-ico" />
										<input
											className="ref-settings-models-search"
											placeholder={t('settings.modelSearchPlaceholder')}
											value={search}
											onChange={(e) => setSearch(e.target.value)}
										/>
									</div>
									<button type="button" className="ref-settings-add-model" onClick={addModel}>
										{t('settings.addModel')}
									</button>
								</div>

								<ul className="ref-settings-user-model-list" aria-label={t('settings.modelCatalog')}>
									<li className="ref-settings-model-row ref-settings-model-row--auto">
										<div className="ref-settings-model-row-main">
											<div className="ref-settings-model-text">
												<span className="ref-settings-model-name">{t('modelPicker.auto')}</span>
												<span className="ref-settings-model-id">{t('settings.autoRowDesc')}</span>
											</div>
											{defaultModel === AUTO_MODEL_ID ? (
												<span className="ref-settings-default-pill">{t('settings.defaultChat')}</span>
											) : (
												<button type="button" className="ref-settings-set-default" onClick={() => onPickDefaultModel(AUTO_MODEL_ID)}>
													{t('settings.setDefault')}
												</button>
											)}
										</div>
									</li>
									{filteredEntries.map((m) => {
										const on = enabledSet.has(m.id);
										const maxOut = m.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
										const customOn = m.useCustomConnection === true;
										return (
											<li key={m.id} className="ref-settings-user-model-card ref-settings-user-model-card--v2">
												<div className="ref-settings-model-v2-head">
													<label className="ref-settings-field ref-settings-field--compact ref-settings-model-v2-name">
														<span>{t('settings.displayName')}</span>
														<input
															value={m.displayName}
															onChange={(e) => patchEntry(m.id, { displayName: e.target.value })}
															placeholder={t('settings.displayNamePh')}
														/>
													</label>
													<div className="ref-settings-model-v2-actions">
														<span className="ref-settings-model-v2-enable-label">{t('settings.inPicker')}</span>
														<button
															type="button"
															className={`ref-settings-toggle ${on ? 'is-on' : ''}`}
															role="switch"
															aria-checked={on}
															onClick={() => onToggleEnabled(m.id, !on)}
															title={on ? t('settings.enabled') : t('settings.disabled')}
														>
															<span className="ref-settings-toggle-knob" />
														</button>
														{on ? (
															defaultModel === m.id ? (
																<span className="ref-settings-default-pill">{t('settings.defaultChat')}</span>
															) : (
																<button type="button" className="ref-settings-set-default" onClick={() => onPickDefaultModel(m.id)}>
																	{t('settings.setDefault')}
																</button>
															)
														) : null}
														<button
															type="button"
															className="ref-settings-remove-model"
															onClick={() => removeEntry(m.id)}
															title={t('settings.removeModel')}
														>
															{t('settings.removeModel')}
														</button>
													</div>
												</div>
												<div className="ref-settings-model-v2-grid">
													<label className="ref-settings-field ref-settings-field--compact">
														<span>{t('settings.requestName')}</span>
														<input
															value={m.requestName}
															onChange={(e) => patchEntry(m.id, { requestName: e.target.value })}
															placeholder={t('settings.requestNamePh')}
														/>
													</label>
													<label className="ref-settings-field ref-settings-field--compact">
														<span>{t('settings.requestParadigm')}</span>
														<select
															value={m.paradigm}
															onChange={(e) => patchEntry(m.id, { paradigm: e.target.value as ModelRequestParadigm })}
															aria-label={t('settings.paradigmAria')}
														>
															{LLM_PROVIDER_OPTIONS.map((o) => (
																<option key={o.id} value={o.id}>
																	{t(`settings.paradigm.${o.id}`)}
																</option>
															))}
														</select>
													</label>
												</div>
												<details className="ref-settings-model-advanced">
													<summary className="ref-settings-model-advanced-summary">{t('settings.modelAdvanced')}</summary>
													<div className="ref-settings-model-advanced-body">
														<label className="ref-settings-field ref-settings-field--compact">
															<span>{t('settings.maxOutputTokens')}</span>
															<input
																type="number"
																min={1}
																max={128000}
																value={maxOut}
																onChange={(e) => {
																	const v = Number.parseInt(e.target.value, 10);
																	patchEntry(m.id, {
																		maxOutputTokens: Number.isNaN(v) ? undefined : v,
																	});
																}}
															/>
															<p className="ref-settings-proxy-hint ref-settings-field-footnote">{t('settings.maxOutputTokensHint')}</p>
														</label>
														<div className="ref-settings-custom-endpoint-row">
															<div className="ref-settings-custom-endpoint-label">
																<span className="ref-settings-custom-endpoint-title">{t('settings.useCustomConnection')}</span>
																<p className="ref-settings-proxy-hint ref-settings-custom-endpoint-desc">{t('settings.useCustomConnectionHint')}</p>
															</div>
															<button
																type="button"
																className={`ref-settings-toggle ${customOn ? 'is-on' : ''}`}
																role="switch"
																aria-checked={customOn}
																onClick={() => patchEntry(m.id, { useCustomConnection: !customOn })}
																title={customOn ? t('settings.customOn') : t('settings.customOff')}
															>
																<span className="ref-settings-toggle-knob" />
															</button>
														</div>
														{customOn ? (
															<div className="ref-settings-custom-endpoint-fields">
																{m.paradigm !== 'gemini' ? (
																	<label className="ref-settings-field ref-settings-field--compact">
																		<span>{t('settings.customBaseUrl')}</span>
																		<input
																			value={m.customBaseURL ?? ''}
																			onChange={(e) => patchEntry(m.id, { customBaseURL: e.target.value })}
																			placeholder={
																				m.paradigm === 'anthropic'
																					? t('settings.placeholder.anthropicBase')
																					: t('settings.placeholder.openaiBase')
																			}
																			autoComplete="off"
																		/>
																	</label>
																) : null}
																<label className="ref-settings-field ref-settings-field--compact">
																	<span>{t('settings.customApiKey')}</span>
																	<input
																		value={m.customApiKey ?? ''}
																		onChange={(e) => patchEntry(m.id, { customApiKey: e.target.value })}
																		type="password"
																		autoComplete="off"
																		placeholder={t('settings.customApiKeyPh')}
																	/>
																</label>
															</div>
														) : null}
													</div>
												</details>
											</li>
										);
									})}
								</ul>
							</div>
						) : null}

						{nav === 'rules' ? (
							<SettingsAgentPanel value={agentCustomization} onChange={onChangeAgentCustomization} />
						) : null}

						{nav === 'editor' ? (
							<EditorSettingsPanel value={editorSettings} onChange={onChangeEditorSettings} />
						) : null}

						{nav === 'indexing' ? (
							<SettingsIndexingPanel
								value={indexingSettings}
								onChange={onChangeIndexingSettings}
								onPersistPatch={onPersistIndexingPatch}
								shell={shell}
								workspaceOpen={workspaceOpen}
							/>
						) : null}

						{nav === 'mcp' ? (
							<SettingsMcpPanel
								servers={mcpServers}
								statuses={mcpStatuses}
								onChangeServers={onChangeMcpServers}
								onRefreshStatuses={onRefreshMcpStatuses}
								onStartServer={onStartMcpServer}
								onStopServer={onStopMcpServer}
								onRestartServer={onRestartMcpServer}
							/>
						) : null}

						{nav !== 'general' &&
						nav !== 'models' &&
						nav !== 'rules' &&
						nav !== 'editor' &&
						nav !== 'mcp' &&
						nav !== 'indexing' ? (
							<div className="ref-settings-panel">
								<p className="ref-settings-lead">{t('settings.comingCategory')}</p>
							</div>
						) : null}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
