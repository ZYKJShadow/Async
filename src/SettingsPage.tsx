import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import {
	createEmptyUserLlmProvider,
	createEmptyUserModel,
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	mergeDiscoveredProviderModels,
	type DiscoveredProviderModel,
	type UserLlmProvider,
	type UserModelEntry,
} from './modelCatalog';
import { LLM_PROVIDER_OPTIONS, type ModelRequestParadigm } from './llmProvider';
import {
	buildProviderIdentityPreview,
	resolveProviderIdentitySettings,
	type ProviderIdentityPreset,
	type ProviderIdentitySettings,
} from './providerIdentitySettings';
import type { AgentCustomization, TeamSettings } from './agentSettingsTypes';
import type { BotIntegrationConfig } from './botSettingsTypes';
import type { AppAppearanceSettings } from './appearanceSettings';
import type { EditorSettings } from './EditorSettingsPanel';
import type { AppColorMode, ThemeTransitionOrigin } from './colorMode';
import type { McpServerConfig, McpServerStatus } from './mcpTypes';
import { useI18n, type AppLocale } from './i18n';
import { VoidSelect } from './VoidSelect';

const SettingsAgentPanel = lazy(() => import('./SettingsAgentPanel').then((m) => ({ default: m.SettingsAgentPanel })));
const SettingsAgentBehaviorPanel = lazy(() =>
	import('./SettingsAgentBehaviorPanel').then((m) => ({ default: m.SettingsAgentBehaviorPanel }))
);
const EditorSettingsPanel = lazy(() => import('./EditorSettingsPanel').then((m) => ({ default: m.EditorSettingsPanel })));
const SettingsIndexingPanel = lazy(() => import('./SettingsIndexingPanel').then((m) => ({ default: m.SettingsIndexingPanel })));
const SettingsMcpPanel = lazy(() => import('./SettingsMcpPanel').then((m) => ({ default: m.SettingsMcpPanel })));
const SettingsAppearancePanel = lazy(() => import('./SettingsAppearancePanel').then((m) => ({ default: m.SettingsAppearancePanel })));
const SettingsUsageStatsPanel = lazy(() => import('./SettingsUsageStatsPanel').then((m) => ({ default: m.SettingsUsageStatsPanel })));
const SettingsAutoUpdatePanel = lazy(() => import('./SettingsAutoUpdatePanel').then((m) => ({ default: m.SettingsAutoUpdatePanel })));
const SettingsTeamPanel = lazy(() => import('./SettingsTeamPanel').then((m) => ({ default: m.SettingsTeamPanel })));
const SettingsBotsPanel = lazy(() => import('./SettingsBotsPanel').then((m) => ({ default: m.SettingsBotsPanel })));
const SettingsBrowserPanel = lazy(() => import('./SettingsBrowserPanel').then((m) => ({ default: m.SettingsBrowserPanel })));
const SettingsPluginsPanel = lazy(() => import('./SettingsPluginsPanel').then((m) => ({ default: m.SettingsPluginsPanel })));

export type SettingsNavId =
	| 'general'
	| 'appearance'
	| 'editor'
	| 'plan'
	| 'team'
	| 'bots'
	| 'agents'
	| 'models'
	| 'plugins'
	| 'rules'
	| 'tools'
	| 'indexing'
	| 'autoUpdate'
	| 'browser';

/** 与 `app:requestOpenSettings` 白名单及侧栏顺序对齐，供运行时校验导航 id */
export const ALL_SETTINGS_NAV_IDS: SettingsNavId[] = [
	'general',
	'appearance',
	'editor',
	'models',
	'agents',
	'bots',
	'rules',
	'indexing',
	'autoUpdate',
	'browser',
	'tools',
	'plan',
	'team',
	'plugins',
];



type NavItem = { id: SettingsNavId; label: string; badge?: number };

type ProviderDiscoverState = {
	status: 'idle' | 'loading' | 'done';
	ok?: boolean;
	message?: string;
};

type ProviderDiscoverModalState = {
	providerId: string;
	providerName: string;
	mergedEntries: UserModelEntry[];
	addedCount: number;
	totalDiscovered: number;
	duplicateCount: number;
};

function navItemsForT(t: (key: string) => string): NavItem[] {
	return [
		{ id: 'general', label: t('settings.nav.general') },
		{ id: 'appearance', label: t('settings.nav.appearance') },
		{ id: 'editor', label: t('settings.nav.editor') },
		{ id: 'models', label: t('settings.nav.models'), badge: 1 },
		{ id: 'agents', label: t('settings.nav.agents') },
		{ id: 'bots', label: t('settings.nav.bots') },
		{ id: 'rules', label: t('settings.nav.rules') },
		{ id: 'indexing', label: t('settings.nav.indexing') },
		{ id: 'autoUpdate', label: t('settings.nav.autoUpdate') },
		{ id: 'browser', label: t('settings.nav.browser') },
		{ id: 'tools', label: t('settings.nav.tools') },
		{ id: 'plan', label: t('settings.nav.plan') },
		{ id: 'team', label: t('settings.nav.team') },
		{ id: 'plugins', label: t('settings.nav.plugins') },
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

function IconSlidersNav({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
			<circle cx="9" cy="6" r="2" fill="var(--void-bg-0)" />
			<circle cx="15" cy="12" r="2" fill="var(--void-bg-0)" />
			<circle cx="11" cy="18" r="2" fill="var(--void-bg-0)" />
		</svg>
	);
}

function IconShieldNav({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 3 5 6v5c0 4.5 2.7 8.6 7 10 4.3-1.4 7-5.5 7-10V6l-7-3Z" strokeLinecap="round" strokeLinejoin="round" />
			<path d="m9.5 12 2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
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

function IconEditor({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4Z" strokeLinecap="round" strokeLinejoin="round" />
			<path d="m13.5 6.5 4 4" strokeLinecap="round" />
		</svg>
	);
}

function IconBotNav({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="5" y="8" width="14" height="11" rx="3" />
			<path d="M12 3v3M8 13h.01M16 13h.01M9 19v2M15 19v2" strokeLinecap="round" />
		</svg>
	);
}

function IconTeamNav({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="7" cy="9" r="2" />
			<circle cx="12" cy="7" r="2" />
			<circle cx="17" cy="9" r="2" />
			<path d="M4 18a3 3 0 0 1 6 0M9 18a3 3 0 0 1 6 0M14 18a3 3 0 0 1 6 0" strokeLinecap="round" />
		</svg>
	);
}

function IconListChecks({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="m4 7 2 2 3-3M4 17 6 19 9 16M13 7h7M13 17h7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconDatabase({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<ellipse cx="12" cy="5" rx="7" ry="3" />
			<path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
		</svg>
	);
}

function IconPuzzle({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M10 5a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h-1a2 2 0 1 0 0 4h1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V5Z" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

/** 内置浏览器：窗口框 + 简化的「地球」经纬线，与纯地球图标区分 */
function IconBrowserNav({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path d="M3 8h18" strokeLinecap="round" />
			<circle cx="12" cy="14" r="3.25" />
			<path d="M8.75 14h6.5M12 10.75v6.5" strokeLinecap="round" />
		</svg>
	);
}

function IconBarChart({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" />
		</svg>
	);
}

function IconSunNav({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
		</svg>
	);
}

function navIcon(id: SettingsNavId) {
	switch (id) {
		case 'general':
			return <IconSlidersNav />;
		case 'appearance':
			return <IconSunNav />;
		case 'editor':
			return <IconEditor />;
		case 'agents':
			return <IconShieldNav />;
		case 'bots':
			return <IconBotNav />;
		case 'models':
			return <IconChip />;
		case 'rules':
			return <IconListChecks />;
		case 'tools':
			return <IconPlug />;
		case 'indexing':
			return <IconDatabase />;
		case 'autoUpdate':
			return (
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
					<path d="M21 12a9 9 0 1 1-6.2-8.6M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			);
		case 'browser':
			return <IconBrowserNav />;
		case 'plugins':
			return <IconPuzzle />;
		case 'plan':
			return <IconBarChart />;
		case 'team':
			return <IconTeamNav />;
		default:
			return <IconSlidersNav />;
	}
}

function SettingsPanelSkeleton() {
	return (
		<div className="ref-settings-skeleton" aria-hidden>
			<div className="ref-settings-skeleton-line ref-settings-skeleton-line--title" />
			<div className="ref-settings-skeleton-card">
				<div className="ref-settings-skeleton-line ref-settings-skeleton-line--short" />
				<div className="ref-settings-skeleton-line" />
				<div className="ref-settings-skeleton-line" />
				<div className="ref-settings-skeleton-line ref-settings-skeleton-line--short" />
			</div>
			<div className="ref-settings-skeleton-card">
				<div className="ref-settings-skeleton-line ref-settings-skeleton-line--medium" />
				<div className="ref-settings-skeleton-line" />
				<div className="ref-settings-skeleton-line ref-settings-skeleton-line--short" />
			</div>
		</div>
	);
}

type Props = {
	onClose: () => void;
	initialNav: SettingsNavId;
	defaultModel: string;
	modelProviders: UserLlmProvider[];
	modelEntries: UserModelEntry[];
	providerIdentity: ProviderIdentitySettings;
	onChangeModelProviders: (providers: UserLlmProvider[]) => void;
	onChangeModelEntries: (entries: UserModelEntry[]) => void;
	onChangeProviderIdentity: (next: ProviderIdentitySettings) => void;
	onPickDefaultModel: (id: string) => void;
	agentCustomization: AgentCustomization;
	onChangeAgentCustomization: (v: AgentCustomization) => void;
	teamSettings: TeamSettings;
	onChangeTeamSettings: (v: TeamSettings) => void;
	botIntegrations: BotIntegrationConfig[];
	onChangeBotIntegrations: (v: BotIntegrationConfig[]) => void;
	/** 打开 Skill Creator：新建对话并发送引导消息 */
	onOpenSkillCreator?: () => void | Promise<void>;
	/** 在编辑器中打开工作区内的 SKILL.md（设置里磁盘技能卡片） */
	onOpenWorkspaceSkillFile?: (relPath: string) => void | Promise<void>;
	/** 删除磁盘上的技能目录（SKILL.md 相对路径）；成功返回 true */
	onDeleteWorkspaceSkillDisk?: (skillMdRelPath: string) => Promise<boolean>;
	editorSettings: EditorSettings;
	onChangeEditorSettings: (v: EditorSettings) => void;
	/** 语言切换后立即持久化（与关闭设置页时的全量保存配合） */
	onPersistLanguage?: (locale: AppLocale) => void;
	/** MCP 服务器配置 */
	mcpServers: McpServerConfig[];
	onChangeMcpServers: (servers: McpServerConfig[]) => void;
	mcpStatuses: McpServerStatus[];
	onRefreshMcpStatuses: () => void;
	onStartMcpServer: (id: string) => void;
	onStopMcpServer: (id: string) => void;
	onRestartMcpServer: (id: string) => void;
	shell: NonNullable<Window['asyncShell']> | null;
	workspaceOpen: boolean;
	colorMode: AppColorMode;
	onChangeColorMode: (next: AppColorMode, origin?: ThemeTransitionOrigin) => void | Promise<void>;
	/** 当前有效亮/暗，用于外观「恢复默认」与内置主题对齐 */
	effectiveColorScheme: 'light' | 'dark';
	appearanceSettings: AppAppearanceSettings;
	onChangeAppearanceSettings: (next: AppAppearanceSettings) => void | Promise<void>;
};

export type SettingsPageProps = Props;

export function SettingsPage({
	onClose,
	initialNav,
	defaultModel,
	modelProviders,
	modelEntries,
	providerIdentity,
	onChangeModelProviders,
	onChangeModelEntries,
	onChangeProviderIdentity,
	onPickDefaultModel,
	agentCustomization,
	onChangeAgentCustomization,
	teamSettings,
	onChangeTeamSettings,
	botIntegrations,
	onChangeBotIntegrations,
	onOpenSkillCreator,
	onOpenWorkspaceSkillFile,
	onDeleteWorkspaceSkillDisk,
	editorSettings,
	onChangeEditorSettings,
	onPersistLanguage,
	mcpServers,
	onChangeMcpServers,
	mcpStatuses,
	onRefreshMcpStatuses,
	onStartMcpServer,
	onStopMcpServer,
	onRestartMcpServer,
	shell,
	workspaceOpen,
	colorMode,
	onChangeColorMode,
	effectiveColorScheme,
	appearanceSettings,
	onChangeAppearanceSettings,
}: Props) {
	const { t, locale, setLocale } = useI18n();
	const navItems = useMemo(() => navItemsForT(t), [t]);
	const [nav, setNav] = useState<SettingsNavId>(initialNav);
	const [search, setSearch] = useState('');
	const deferredSearch = useDeferredValue(search);
	const [providerDiscoverStateById, setProviderDiscoverStateById] = useState<Record<string, ProviderDiscoverState>>({});
	const [providerDiscoverModal, setProviderDiscoverModal] = useState<ProviderDiscoverModalState | null>(null);
	const [sidebarWidth, setSidebarWidth] = useState(() => readSettingsSidebarWidth());
	const [navPending, startNavTransition] = useTransition();
	const resolvedProviderIdentity = useMemo(
		() => resolveProviderIdentitySettings(providerIdentity),
		[providerIdentity]
	);
	const providerIdentityPreview = useMemo(
		() => buildProviderIdentityPreview(providerIdentity),
		[providerIdentity]
	);

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
		startNavTransition(() => {
			setNav(initialNav);
			setSearch('');
		});
	}, [initialNav, startNavTransition]);

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

	const filteredProviders = useMemo(() => {
		const q = deferredSearch.trim().toLowerCase();
		if (!q) {
			return modelProviders;
		}
		return modelProviders.filter((p) => {
			const pn = p.displayName.toLowerCase();
			const pl = t(`settings.paradigm.${p.paradigm}`).toLowerCase();
			if (pn.includes(q) || pl.includes(q)) {
				return true;
			}
			const sub = modelEntries.filter((m) => m.providerId === p.id);
			return sub.some((m) => {
				const dn = m.displayName.toLowerCase();
				const rn = m.requestName.toLowerCase();
				return dn.includes(q) || rn.includes(q);
			});
		});
	}, [deferredSearch, modelEntries, modelProviders, t]);

	const modelsVisibleUnderProvider = useCallback(
		(provider: UserLlmProvider) => {
			const all = modelEntries.filter((m) => m.providerId === provider.id);
			const q = deferredSearch.trim().toLowerCase();
			if (!q) {
				return all;
			}
			const headerHit =
				provider.displayName.toLowerCase().includes(q) ||
				t(`settings.paradigm.${provider.paradigm}`).toLowerCase().includes(q);
			if (headerHit) {
				return all;
			}
			return all.filter((m) => {
				const dn = m.displayName.toLowerCase();
				const rn = m.requestName.toLowerCase();
				return dn.includes(q) || rn.includes(q);
			});
		},
		[deferredSearch, modelEntries, t]
	);

	const patchProvider = useCallback(
		(id: string, patch: Partial<UserLlmProvider>) => {
			onChangeModelProviders(modelProviders.map((p) => (p.id === id ? { ...p, ...patch } : p)));
		},
		[modelProviders, onChangeModelProviders]
	);

	const removeProvider = useCallback(
		(pid: string) => {
			const removedIds = new Set(modelEntries.filter((m) => m.providerId === pid).map((m) => m.id));
			onChangeModelProviders(modelProviders.filter((p) => p.id !== pid));
			onChangeModelEntries(modelEntries.filter((m) => m.providerId !== pid));
			if (removedIds.has(defaultModel)) {
				onPickDefaultModel('');
			}
		},
		[
			modelProviders,
			modelEntries,
			onChangeModelProviders,
			onChangeModelEntries,
			defaultModel,
			onPickDefaultModel,
		]
	);

	const addProvider = useCallback(() => {
		const p = createEmptyUserLlmProvider();
		onChangeModelProviders([...modelProviders, p]);
	}, [modelProviders, onChangeModelProviders]);

	const addModelToProvider = useCallback(
		(providerId: string) => {
			onChangeModelEntries([...modelEntries, createEmptyUserModel(providerId)]);
		},
		[modelEntries, onChangeModelEntries]
	);

	const patchEntry = useCallback(
		(id: string, patch: Partial<UserModelEntry>) => {
			onChangeModelEntries(modelEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
		},
		[modelEntries, onChangeModelEntries]
	);

	const patchProviderIdentity = useCallback(
		(patch: Partial<ProviderIdentitySettings>) => {
			onChangeProviderIdentity({
				...providerIdentity,
				...patch,
			});
		},
		[providerIdentity, onChangeProviderIdentity]
	);

	const removeEntry = useCallback(
		(id: string) => {
			onChangeModelEntries(modelEntries.filter((e) => e.id !== id));
			if (defaultModel === id) {
				onPickDefaultModel('');
			}
		},
		[modelEntries, onChangeModelEntries, defaultModel, onPickDefaultModel]
	);

	const applyProviderDiscoverImport = useCallback(() => {
		if (!providerDiscoverModal) {
			return;
		}
		onChangeModelEntries(providerDiscoverModal.mergedEntries);
		setProviderDiscoverStateById((prev) => ({
			...prev,
			[providerDiscoverModal.providerId]: {
				status: 'done',
				ok: true,
				message:
					providerDiscoverModal.addedCount > 0
						? t('settings.discoverModelsImported', {
								addedCount: providerDiscoverModal.addedCount,
								totalCount: providerDiscoverModal.totalDiscovered,
							})
						: t('settings.searchProviderModelsNothingNew'),
			},
		}));
		setProviderDiscoverModal(null);
	}, [onChangeModelEntries, providerDiscoverModal, t]);

	const discoverModelsForProvider = useCallback(
		async (provider: UserLlmProvider) => {
			if (!shell) {
				setProviderDiscoverStateById((prev) => ({
					...prev,
					[provider.id]: { status: 'done', ok: false, message: t('settings.discoverModelsUnavailable') },
				}));
				return;
			}

			setProviderDiscoverStateById((prev) => ({
				...prev,
				[provider.id]: { status: 'loading' },
			}));

			try {
				const result = (await shell.invoke('settings:discoverProviderModels', provider)) as
					| {
							ok?: boolean;
							models?: { id?: string; contextWindowTokens?: number; maxOutputTokens?: number }[];
							message?: string;
					  }
					| undefined;
				if (result?.ok !== true) {
					setProviderDiscoverStateById((prev) => ({
						...prev,
						[provider.id]: {
							status: 'done',
							ok: false,
							message: result?.message?.trim() || t('settings.discoverModelsFailed'),
						},
					}));
					return;
				}

				const discoveredModels: DiscoveredProviderModel[] = (result.models ?? [])
					.filter((model) => typeof model?.id === 'string' && model.id.trim().length > 0)
					.map((model) => ({
						requestName: String(model.id).trim(),
						contextWindowTokens: model.contextWindowTokens,
						maxOutputTokens: model.maxOutputTokens,
					}));
				const merged = mergeDiscoveredProviderModels(modelEntries, provider.id, discoveredModels);
				setProviderDiscoverStateById((prev) => ({
					...prev,
					[provider.id]: {
						status: 'done',
						ok: true,
						message: undefined,
					},
				}));
				setProviderDiscoverModal({
					providerId: provider.id,
					providerName: provider.displayName.trim() || t('settings.providerUntitled'),
					mergedEntries: merged.entries,
					addedCount: merged.addedCount,
					totalDiscovered: merged.totalDiscovered,
					duplicateCount: Math.max(0, merged.totalDiscovered - merged.addedCount),
				});
			} catch (error) {
				setProviderDiscoverStateById((prev) => ({
					...prev,
					[provider.id]: {
						status: 'done',
						ok: false,
						message: error instanceof Error ? error.message : String(error ?? t('settings.discoverModelsFailed')),
					},
				}));
			}
		},
		[modelEntries, shell, t]
	);

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
									startNavTransition(() => {
										setNav(item.id);
									});
								}}
							>
								<span className="ref-settings-nav-ico">{navIcon(item.id)}</span>
								<span className="ref-settings-nav-label">{item.label}</span>
								{item.badge != null ? <span className="ref-settings-nav-badge">{item.badge}</span> : null}
							</button>
						))}
					</nav>
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
								{nav === 'appearance' ? t('settings.title.appearance') : null}
								{nav === 'agents' ? t('settings.title.agents') : null}
								{nav === 'models' ? t('settings.title.models') : null}
								{nav === 'rules' ? t('settings.title.rules') : null}
								{nav === 'editor' ? t('settings.title.editor') : null}
								{nav === 'tools' ? t('settings.title.tools') : null}
								{nav === 'indexing' ? t('settings.title.indexing') : null}
								{nav === 'autoUpdate' ? t('settings.title.autoUpdate') : null}
								{nav === 'browser' ? t('settings.title.browser') : null}
								{nav === 'plan' ? t('settings.title.usage') : null}
								{nav === 'team' ? t('settings.title.team') : null}
								{nav === 'bots' ? t('settings.title.bots') : null}
								{nav === 'plugins' ? t('settings.title.plugins') : null}
							</h1>
							{navPending ? (
								<div className="ref-settings-nav-loading" role="status" aria-live="polite">
									<span className="ref-settings-nav-loading-spinner" aria-hidden />
									<span>{t('common.loading')}</span>
								</div>
							) : null}
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
									<VoidSelect
										ariaLabel={t('settings.language')}
										value={locale}
										onChange={(next) => {
											const v = next === 'en' ? 'en' : 'zh-CN';
											setLocale(v);
											onPersistLanguage?.(v);
										}}
										options={[
											{ value: 'zh-CN', label: t('settings.languageZh') },
											{ value: 'en', label: t('settings.languageEn') },
										]}
									/>
								</div>

								<section className="ref-settings-section">
									<h2 className="ref-settings-subhead">{t('settings.general.identityTitle')}</h2>
									<div className="ref-settings-agent-card">
										<div className="ref-settings-agent-card-title">{t('settings.general.identityTitle')}</div>
										<p className="ref-settings-agent-card-desc" style={{ marginTop: 8 }}>
											{t('settings.general.identityLead')}
										</p>

										<div className="ref-settings-field" style={{ marginTop: 18 }}>
											<span>{t('settings.general.identityPreset')}</span>
											<VoidSelect
												ariaLabel={t('settings.general.identityPreset')}
												value={resolvedProviderIdentity.preset}
												onChange={(next) =>
													patchProviderIdentity({ preset: next as ProviderIdentityPreset })
												}
												options={[
													{
														value: 'async-default',
														label: t('settings.general.identityPreset.async'),
													},
													{
														value: 'claude-code',
														label: t('settings.general.identityPreset.claudeCode'),
													},
													{
														value: 'custom',
														label: t('settings.general.identityPreset.custom'),
													},
												]}
											/>
											<p className="ref-settings-field-hint">
												{t('settings.general.identityPresetHint')}
											</p>
										</div>

										{resolvedProviderIdentity.preset === 'custom' ? (
											<>
												<div className="ref-settings-field">
													<span>{t('settings.general.identityUserAgentProduct')}</span>
													<input
														type="text"
														value={resolvedProviderIdentity.userAgentProduct}
														spellCheck={false}
														onChange={(event) =>
															patchProviderIdentity({ userAgentProduct: event.target.value })
														}
													/>
													<p className="ref-settings-field-hint">
														{t('settings.general.identityUserAgentProductHint')}
													</p>
												</div>

												<div className="ref-settings-field">
													<span>{t('settings.general.identityEntrypoint')}</span>
													<input
														type="text"
														value={resolvedProviderIdentity.entrypoint}
														spellCheck={false}
														onChange={(event) =>
															patchProviderIdentity({ entrypoint: event.target.value })
														}
													/>
													<p className="ref-settings-field-hint">
														{t('settings.general.identityEntrypointHint')}
													</p>
												</div>

												<div className="ref-settings-field">
													<span>{t('settings.general.identityAppHeader')}</span>
													<input
														type="text"
														value={resolvedProviderIdentity.appHeaderValue}
														spellCheck={false}
														onChange={(event) =>
															patchProviderIdentity({ appHeaderValue: event.target.value })
														}
													/>
												</div>

												<div className="ref-settings-field">
													<span>{t('settings.general.identityClientApp')}</span>
													<input
														type="text"
														value={resolvedProviderIdentity.clientAppValue}
														spellCheck={false}
														onChange={(event) =>
															patchProviderIdentity({ clientAppValue: event.target.value })
														}
													/>
													<p className="ref-settings-field-hint">
														{t('settings.general.identityClientAppHint')}
													</p>
												</div>

												<div className="ref-settings-field">
													<span>{t('settings.general.identitySystemPromptText')}</span>
													<textarea
														value={resolvedProviderIdentity.systemPromptPrefix}
														spellCheck={false}
														onChange={(event) =>
															patchProviderIdentity({ systemPromptPrefix: event.target.value })
														}
													/>
													<p className="ref-settings-field-hint">
														{t('settings.general.identitySystemPromptTextHint')}
													</p>
												</div>
											</>
										) : (
											<p className="ref-settings-field-hint" style={{ marginTop: 4 }}>
												{resolvedProviderIdentity.preset === 'claude-code'
													? t('settings.general.identityPresetClaudeCodeHint')
													: t('settings.general.identityPresetAsyncHint')}
											</p>
										)}
									</div>

									<div className="ref-settings-agent-card" style={{ marginTop: -8 }}>
										<div className="ref-settings-agent-card-title">{t('settings.general.identityPreview')}</div>
										<p className="ref-settings-agent-card-desc" style={{ marginTop: 8 }}>
											{t('settings.general.identityPreviewHint')}
										</p>
										<div className="ref-settings-field-hint" style={{ marginTop: 14 }}>
											<div>
												<strong>User-Agent:</strong>{' '}
												<code className="ref-settings-code">{providerIdentityPreview.userAgent}</code>
											</div>
											{providerIdentityPreview.headers
												.filter(([name]) => name !== 'User-Agent')
												.map(([name, value]) => (
													<div key={name}>
														<strong>{name}:</strong>{' '}
														<code className="ref-settings-code">{value}</code>
													</div>
												))}
											<div>
												<strong>Anthropic metadata.user_id:</strong>{' '}
												<code className="ref-settings-code">{providerIdentityPreview.anthropicUserId}</code>
											</div>
										</div>
									</div>
								</section>
							</div>
						) : null}

						{nav === 'appearance' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsAppearancePanel
									value={colorMode}
									onChange={onChangeColorMode}
									effectiveColorScheme={effectiveColorScheme}
									appearance={appearanceSettings}
									onChangeAppearance={onChangeAppearanceSettings}
								/>
							</Suspense>
						) : null}

						{nav === 'agents' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsAgentBehaviorPanel value={agentCustomization} onChange={onChangeAgentCustomization} />
							</Suspense>
						) : null}

						{nav === 'bots' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsBotsPanel
									value={botIntegrations}
									onChange={onChangeBotIntegrations}
									modelEntries={modelEntries}
									shell={shell}
								/>
							</Suspense>
						) : null}

						{nav === 'models' ? (
							<div className="ref-settings-panel ref-settings-panel--models">
								<p className="ref-settings-models-hint">{t('settings.modelsHint')}</p>
								<p className="ref-settings-models-provider-lead">{t('settings.modelsProviderLead')}</p>

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
									<button type="button" className="ref-settings-add-model" onClick={addProvider}>
										{t('settings.addProvider')}
									</button>
								</div>

								<ul className="ref-settings-provider-root-list" aria-label={t('settings.modelCatalog')}>
									{filteredProviders.map((prov) => {
										const subModels = modelsVisibleUnderProvider(prov);
										const discoverState = providerDiscoverStateById[prov.id];
										return (
											<li key={prov.id} className="ref-settings-provider-shell">
												<details className="ref-settings-provider-details">
													<summary className="ref-settings-provider-summary">
														<span className="ref-settings-provider-summary-chev" aria-hidden />
														<span className="ref-settings-provider-summary-text">
															{prov.displayName.trim() || t('settings.providerUntitled')}
														</span>
														<span className="ref-settings-provider-summary-tag">{t(`settings.paradigm.${prov.paradigm}`)}</span>
													</summary>

													<div className="ref-settings-provider-body">
														<div className="ref-settings-provider-creds">
															<label className="ref-settings-field ref-settings-field--compact">
																<span>{t('settings.providerName')}</span>
																<input
																	value={prov.displayName}
																	onChange={(e) => patchProvider(prov.id, { displayName: e.target.value })}
																	placeholder={t('settings.providerNamePh')}
																	autoComplete="off"
																/>
															</label>
															<label className="ref-settings-field ref-settings-field--compact">
																<span>{t('settings.requestParadigm')}</span>
																<VoidSelect
																	ariaLabel={t('settings.paradigmAria')}
																	value={prov.paradigm}
																	onChange={(v) => patchProvider(prov.id, { paradigm: v as ModelRequestParadigm })}
																	options={LLM_PROVIDER_OPTIONS.map((o) => ({
																		value: o.id,
																		label: t(`settings.paradigm.${o.id}`),
																	}))}
																/>
															</label>
															<label className="ref-settings-field ref-settings-field--compact">
																<span>{t('settings.providerApiKey')}</span>
																<input
																	value={prov.apiKey ?? ''}
																	onChange={(e) => patchProvider(prov.id, { apiKey: e.target.value })}
																	type="password"
																	autoComplete="off"
																	placeholder={t('settings.providerApiKeyPh')}
																/>
															</label>
															{prov.paradigm !== 'gemini' ? (
																<label className="ref-settings-field ref-settings-field--compact">
																	<span>{t('settings.providerBaseUrl')}</span>
																	<input
																		value={prov.baseURL ?? ''}
																		onChange={(e) => patchProvider(prov.id, { baseURL: e.target.value })}
																		placeholder={
																			prov.paradigm === 'anthropic'
																				? t('settings.placeholder.anthropicBase')
																				: t('settings.placeholder.openaiBase')
																		}
																		autoComplete="off"
																	/>
																</label>
															) : null}
															{prov.paradigm === 'openai-compatible' ? (
																<label className="ref-settings-field ref-settings-field--compact">
																	<span>{t('settings.proxy')}</span>
																	<p className="ref-settings-proxy-hint ref-settings-field-footnote">{t('settings.proxyHint')}</p>
																	<input
																		value={prov.proxyUrl ?? ''}
																		onChange={(e) => patchProvider(prov.id, { proxyUrl: e.target.value })}
																		autoComplete="off"
																		placeholder="http://127.0.0.1:7890"
																	/>
																</label>
															) : null}
														</div>

														<div className="ref-settings-provider-models-head">
															<h3 className="ref-settings-provider-models-title">{t('settings.modelsInProvider')}</h3>
															<div className="ref-settings-provider-models-actions">
																{prov.paradigm === 'openai-compatible' ? (
																	<button
																		type="button"
																		className="ref-settings-add-model ref-settings-add-model--small ref-settings-provider-search-btn"
																		onClick={() => void discoverModelsForProvider(prov)}
																		disabled={!shell || discoverState?.status === 'loading'}
																	>
																		{discoverState?.status === 'loading'
																			? t('settings.searchProviderModelsRunning')
																			: t('settings.searchProviderModels')}
																	</button>
																) : null}
																<button type="button" className="ref-settings-add-model ref-settings-add-model--small" onClick={() => addModelToProvider(prov.id)}>
																	{t('settings.addModelToProvider')}
																</button>
																<button
																	type="button"
																	className="ref-settings-remove-model"
																	onClick={() => removeProvider(prov.id)}
																	title={t('settings.removeProvider')}
																>
																	{t('settings.removeProvider')}
																</button>
															</div>
														</div>
														{discoverState?.status === 'done' && discoverState.message ? (
															<p
																className="ref-settings-field-hint"
																style={{
																	marginTop: 8,
																	color:
																		discoverState.ok === false
																			? 'var(--void-danger, #ef4444)'
																			: undefined,
																}}
															>
																{discoverState.message}
															</p>
														) : null}

														<ul className="ref-settings-provider-model-list">
															{subModels.map((m) => {
																const maxOut = m.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
																return (
																	<li key={m.id} className="ref-settings-user-model-card ref-settings-user-model-card--v2 ref-settings-user-model-card--nested">
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
																				{defaultModel === m.id ? (
																					<span className="ref-settings-default-pill">{t('settings.defaultChat')}</span>
																				) : (
																					<button type="button" className="ref-settings-set-default" onClick={() => onPickDefaultModel(m.id)}>
																						{t('settings.setDefault')}
																					</button>
																				)}
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
																		<div className="ref-settings-model-v2-grid ref-settings-model-v2-grid--single">
																			<label className="ref-settings-field ref-settings-field--compact">
																				<span>{t('settings.requestName')}</span>
																				<input
																					value={m.requestName}
																					onChange={(e) => patchEntry(m.id, { requestName: e.target.value })}
																					placeholder={t('settings.requestNamePh')}
																				/>
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
																				<label className="ref-settings-field ref-settings-field--compact">
																					<span>{t('settings.contextWindowTokens')}</span>
																					<input
																						type="number"
																						min={1024}
																						max={2000000}
																						placeholder="—"
																						value={m.contextWindowTokens ?? ''}
																						onChange={(e) => {
																							const raw = e.target.value.trim();
																							if (raw === '') {
																								patchEntry(m.id, { contextWindowTokens: undefined });
																								return;
																							}
																							const v = Number.parseInt(raw, 10);
																							patchEntry(m.id, {
																								contextWindowTokens: Number.isNaN(v) ? undefined : v,
																							});
																						}}
																					/>
																					<p className="ref-settings-proxy-hint ref-settings-field-footnote">
																						{t('settings.contextWindowTokensHint')}
																					</p>
																				</label>
																			</div>
																		</details>
																	</li>
																);
															})}
														</ul>
													</div>
												</details>
											</li>
										);
									})}
								</ul>
							</div>
						) : null}

						{nav === 'rules' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsAgentPanel
									value={agentCustomization}
									onChange={onChangeAgentCustomization}
									locale={locale}
									workspaceOpen={workspaceOpen}
									onOpenSkillCreator={onOpenSkillCreator}
									onOpenWorkspaceSkillFile={onOpenWorkspaceSkillFile}
									onDeleteWorkspaceSkillDisk={onDeleteWorkspaceSkillDisk}
								/>
							</Suspense>
						) : null}

						{nav === 'editor' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<EditorSettingsPanel value={editorSettings} onChange={onChangeEditorSettings} />
							</Suspense>
						) : null}

						{nav === 'indexing' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsIndexingPanel
									shell={shell}
									workspaceOpen={workspaceOpen}
									agentCustomization={agentCustomization}
									onChangeAgentCustomization={onChangeAgentCustomization}
								/>
							</Suspense>
						) : null}

						{nav === 'autoUpdate' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsAutoUpdatePanel
									shell={shell}
								/>
							</Suspense>
						) : null}

						{nav === 'browser' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsBrowserPanel shell={shell} />
							</Suspense>
						) : null}

						{nav === 'plan' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsUsageStatsPanel shell={shell} modelEntries={modelEntries} modelProviders={modelProviders} />
							</Suspense>
						) : null}
						{nav === 'team' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsTeamPanel
									value={teamSettings}
									onChange={onChangeTeamSettings}
									modelEntries={modelEntries}
									modelProviders={modelProviders}
								/>
							</Suspense>
						) : null}

						{nav === 'tools' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsMcpPanel
									servers={mcpServers}
									statuses={mcpStatuses}
									onChangeServers={onChangeMcpServers}
									onRefreshStatuses={onRefreshMcpStatuses}
									onStartServer={onStartMcpServer}
									onStopServer={onStopMcpServer}
									onRestartServer={onRestartMcpServer}
									shell={shell}
								/>
							</Suspense>
						) : null}

						{nav === 'plugins' ? (
							<Suspense fallback={<SettingsPanelSkeleton />}>
								<SettingsPluginsPanel shell={shell} workspaceOpen={workspaceOpen} />
							</Suspense>
						) : null}

						{nav !== 'general' &&
						nav !== 'appearance' &&
						nav !== 'agents' &&
						nav !== 'bots' &&
						nav !== 'models' &&
						nav !== 'rules' &&
						nav !== 'editor' &&
						nav !== 'tools' &&
						nav !== 'indexing' &&
						nav !== 'autoUpdate' &&
						nav !== 'browser' &&
						nav !== 'plan' &&
						nav !== 'team' &&
						nav !== 'plugins' ? (
							<div className="ref-settings-panel">
								<p className="ref-settings-lead">{t('settings.comingCategory')}</p>
							</div>
						) : null}
						</div>
					</div>
				</div>
			</div>
			{providerDiscoverModal ? (
				<div className="modal-backdrop" role="presentation" onClick={() => setProviderDiscoverModal(null)}>
					<div
						className="modal ref-settings-provider-search-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ref-settings-provider-search-title"
						onClick={(event) => event.stopPropagation()}
					>
						<h2 id="ref-settings-provider-search-title">{t('settings.searchProviderModelsTitle')}</h2>
						<div className="ref-settings-provider-search-modal-copy">
							<p className="ref-settings-lead" style={{ marginBottom: 10 }}>
								{t('settings.searchProviderModelsSummary', {
									totalCount: providerDiscoverModal.totalDiscovered,
									providerName: providerDiscoverModal.providerName,
								})}
							</p>
							{providerDiscoverModal.duplicateCount > 0 ? (
								<p className="ref-settings-field-hint" style={{ marginTop: 0 }}>
									{t('settings.searchProviderModelsFiltered', {
										duplicateCount: providerDiscoverModal.duplicateCount,
									})}
								</p>
							) : null}
							<p className="ref-settings-field-hint" style={{ marginTop: 0 }}>
								{providerDiscoverModal.addedCount > 0
									? t('settings.searchProviderModelsImportReady', {
											addedCount: providerDiscoverModal.addedCount,
										})
									: t('settings.searchProviderModelsNothingNew')}
							</p>
						</div>

						<div className="ref-settings-provider-search-stats">
							<div className="ref-settings-provider-search-stat-row">
								<span>{t('settings.providerName')}</span>
								<strong>{providerDiscoverModal.providerName}</strong>
							</div>
							<div className="ref-settings-provider-search-stat-row">
								<span>{t('settings.searchProviderModelsFoundLabel')}</span>
								<strong>{String(providerDiscoverModal.totalDiscovered)}</strong>
							</div>
							<div className="ref-settings-provider-search-stat-row">
								<span>{t('settings.searchProviderModelsDuplicateLabel')}</span>
								<strong>{String(providerDiscoverModal.duplicateCount)}</strong>
							</div>
							<div className="ref-settings-provider-search-stat-row">
								<span>{t('settings.searchProviderModelsImportableLabel')}</span>
								<strong>{String(providerDiscoverModal.addedCount)}</strong>
							</div>
						</div>

						<div className="modal-actions ref-settings-provider-search-modal-actions">
							<button
								type="button"
								className="ref-settings-remove-model"
								onClick={() => setProviderDiscoverModal(null)}
							>
								{t('settings.searchProviderModelsClose')}
							</button>
							{providerDiscoverModal.addedCount > 0 ? (
								<button
									type="button"
									className="ref-settings-add-model ref-settings-provider-search-btn"
									onClick={applyProviderDiscoverImport}
								>
									{t('settings.searchProviderModelsConfirm')}
								</button>
							) : null}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
