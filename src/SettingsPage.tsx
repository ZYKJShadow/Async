import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
	createEmptyUserLlmProvider,
	createEmptyUserModel,
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	mergeDiscoveredProviderModels,
	type DiscoveredProviderModel,
	type OAuthProviderKind,
	type UserLlmProvider,
	type UserModelEntry,
} from './modelCatalog';
import { LLM_PROVIDER_OPTIONS, type ModelRequestParadigm } from './llmProvider';
import {
	buildProviderIdentityPreview,
	resolveProviderIdentitySettings,
	resolveProviderIdentityWithOverride,
	type ProviderIdentityPreset,
	type ProviderIdentitySettings,
} from './providerIdentitySettings';
import type { AgentCustomization, TeamSettings } from './agentSettingsTypes';
import type { BotIntegrationConfig } from './botSettingsTypes';
import type { AppAppearanceSettings } from './appearanceSettings';
import type { EditorSettings } from './EditorSettingsPanel';
import type { AppColorMode, ThemeTransitionOrigin } from './colorMode';
import type { McpServerConfig, McpServerStatus } from './mcpTypes';
import { useI18n, type AppLocale, type TFunction } from './i18n';
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
	'plugins',
	'agents',
	'bots',
	'rules',
	'indexing',
	'autoUpdate',
	'browser',
	'tools',
	'plan',
	'team',
];



type NavItem = { id: SettingsNavId; label: string };

type ProviderDiscoverState = {
	status: 'idle' | 'loading' | 'done';
	ok?: boolean;
	message?: string;
};

type ProviderOAuthLoginState = {
	status: 'idle' | 'loading' | 'done';
	provider?: OAuthProviderKind;
	ok?: boolean;
	message?: string;
};

const PROVIDER_OAUTH_LOGIN_UI_TIMEOUT_MS = 5 * 60_000;
const OAUTH_LOGIN_PROVIDERS: OAuthProviderKind[] = ['codex', 'claude', 'antigravity'];
type ProviderGroupId = 'manual' | OAuthProviderKind;

const PROVIDER_GROUPS: {
	id: ProviderGroupId;
	labelKey: string;
	oauthProvider?: OAuthProviderKind;
}[] = [
	{ id: 'manual', labelKey: 'settings.providerGroup.manual' },
	{ id: 'codex', labelKey: 'settings.providerGroup.codex', oauthProvider: 'codex' },
	{ id: 'claude', labelKey: 'settings.providerGroup.claude', oauthProvider: 'claude' },
	{ id: 'antigravity', labelKey: 'settings.providerGroup.antigravity', oauthProvider: 'antigravity' },
];

function providerGroupId(provider: UserLlmProvider): ProviderGroupId {
	const oauthProvider = provider.oauthAuth?.provider;
	if (oauthProvider === 'codex' || oauthProvider === 'claude' || oauthProvider === 'antigravity') {
		return oauthProvider;
	}
	if (provider.codexAuth) {
		return 'codex';
	}
	return 'manual';
}

type OAuthUsageDisplay = {
	tone: 'ok' | 'warn' | 'muted';
	title: string;
	body: string;
	meta?: string;
};

function formatOAuthNumber(value: number | undefined, locale: AppLocale): string {
	if (value == null || !Number.isFinite(value)) {
		return '';
	}
	return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
		maximumFractionDigits: 2,
	}).format(value);
}

function providerOAuthUsageDisplay(provider: UserLlmProvider, locale: AppLocale, t: TFunction): OAuthUsageDisplay | null {
	const auth = provider.oauthAuth;
	if (auth?.provider !== 'antigravity') {
		return null;
	}
	const usage = auth.usage;
	if (!usage || usage.provider !== 'antigravity' || !usage.known) {
		return {
			tone: 'muted',
			title: t('settings.oauthUsage.remainingTitle'),
			body: t('settings.oauthUsage.antigravityUnknown'),
		};
	}
	const amount = formatOAuthNumber(usage.creditAmount, locale);
	const minimum = formatOAuthNumber(usage.minCreditAmount, locale);
	const parts = [
		amount
			? t('settings.oauthUsage.antigravityCredits', { amount })
			: t('settings.oauthUsage.antigravityUnknown'),
		minimum ? t('settings.oauthUsage.antigravityMinimum', { minimum }) : '',
		usage.paidTierId ? t('settings.oauthUsage.tier', { tier: usage.paidTierId }) : '',
	].filter(Boolean);
	const updated = usage.updatedAt
		? new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			}).format(new Date(usage.updatedAt))
		: '';
	return {
		tone: usage.available === false ? 'warn' : 'ok',
		title: t('settings.oauthUsage.remainingTitle'),
		body: parts.join(' · '),
		meta: updated ? t('settings.oauthUsage.updated', { time: updated }) : undefined,
	};
}

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
		{ id: 'models', label: t('settings.nav.models') },
		{ id: 'plugins', label: t('settings.nav.plugins') },
		{ id: 'agents', label: t('settings.nav.agents') },
		{ id: 'bots', label: t('settings.nav.bots') },
		{ id: 'rules', label: t('settings.nav.rules') },
		{ id: 'indexing', label: t('settings.nav.indexing') },
		{ id: 'autoUpdate', label: t('settings.nav.autoUpdate') },
		{ id: 'browser', label: t('settings.nav.browser') },
		{ id: 'tools', label: t('settings.nav.tools') },
		{ id: 'plan', label: t('settings.nav.plan') },
		{ id: 'team', label: t('settings.nav.team') },
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

function IconCodexLogo({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden>
			<path
				d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z"
				fill="#fff"
			/>
			<path
				d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
				fill="url(#ref-settings-codex-logo-fill)"
			/>
			<defs>
				<linearGradient gradientUnits="userSpaceOnUse" id="ref-settings-codex-logo-fill" x1="12" x2="12" y1="3" y2="21">
					<stop stopColor="#B1A7FF" />
					<stop offset=".5" stopColor="#7A9DFF" />
					<stop offset="1" stopColor="#3941FF" />
				</linearGradient>
			</defs>
		</svg>
	);
}

function IconClaudeLogo({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden>
			<path
				d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
				fill="#D97757"
				fillRule="nonzero"
			/>
		</svg>
	);
}

function IconAntigravityLogo({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 64 59" aria-hidden>
			<path d="M0,0 L8,0 L14,4 L19,14 L27,40 L32,50 L36,54 L35,59 L30,59 L22,52 L11,35 L6,33 L-1,34 L-6,39 L-14,52 L-22,59 L-28,59 L-27,53 L-22,47 L-17,34 L-10,12 L-5,3 Z " fill="#3789F9" transform="translate(28,0)" />
			<path d="M0,0 L8,0 L14,4 L19,14 L25,35 L21,34 L16,29 L11,26 L7,20 L7,18 L2,16 L-3,15 L-8,18 L-12,19 L-9,9 L-4,2 Z " fill="#6D80D8" transform="translate(28,0)" />
			<path d="M0,0 L8,0 L14,4 L19,14 L20,19 L13,15 L10,12 L3,10 L-1,8 L-7,7 L-4,2 Z " fill="#D78240" transform="translate(28,0)" />
			<path d="M0,0 L5,1 L10,4 L12,9 L1,8 L-5,13 L-10,21 L-13,26 L-16,26 L-9,5 L-4,2 Z M6,7 Z " fill="#3294CC" transform="translate(25,14)" />
			<path d="M0,0 L5,2 L10,10 L12,18 L5,14 L1,10 L0,4 L-3,3 L0,2 Z " fill="#E45C49" transform="translate(36,1)" />
			<path d="M0,0 L9,1 L12,3 L12,5 L7,6 L4,8 L-1,11 L-5,12 L-2,2 Z " fill="#90AE64" transform="translate(21,7)" />
			<path d="M0,0 L5,1 L5,4 L-2,7 L-7,11 L-11,10 L-9,5 L-4,2 Z " fill="#53A89A" transform="translate(25,14)" />
			<path d="M0,0 L5,0 L16,9 L17,13 L12,12 L8,9 L8,7 L4,5 L0,2 Z " fill="#B5677D" transform="translate(33,11)" />
			<path d="M0,0 L6,0 L14,6 L19,11 L23,12 L22,15 L15,12 L10,8 L10,6 L4,5 Z " fill="#778998" transform="translate(27,12)" />
			<path d="M0,0 L4,2 L-11,17 L-12,14 L-5,4 Z " fill="#3390DF" transform="translate(26,21)" />
			<path d="M0,0 L2,1 L-4,5 L-9,9 L-13,13 L-14,10 L-13,7 L-6,4 L-3,1 Z " fill="#3FA1B7" transform="translate(27,18)" />
			<path d="M0,0 L4,0 L9,5 L13,6 L12,9 L5,6 L0,2 Z " fill="#8277BB" transform="translate(37,18)" />
			<path d="M0,0 L5,1 L7,6 L-2,5 Z M1,4 Z " fill="#4989CF" transform="translate(30,17)" />
			<path d="M0,0 L5,1 L2,3 L-3,6 L-7,7 L-6,3 Z " fill="#71B774" transform="translate(23,12)" />
			<path d="M0,0 L7,1 L9,7 L5,6 L0,1 Z " fill="#6687E9" transform="translate(44,28)" />
			<path d="M0,0 L7,0 L5,1 L5,3 L8,4 L4,5 L-2,4 Z " fill="#C7AF38" transform="translate(23,3)" />
			<path d="M0,0 L8,0 L8,3 L4,4 L-4,3 Z " fill="#EF842A" transform="translate(28,0)" />
			<path d="M0,0 L7,4 L7,6 L10,6 L11,10 L4,6 L0,2 Z " fill="#CD5D67" transform="translate(37,9)" />
			<path d="M0,0 L5,2 L9,8 L8,11 L2,3 L0,2 Z " fill="#F35241" transform="translate(36,1)" />
			<path d="M0,0 L8,2 L9,6 L4,5 L0,2 Z " fill="#A667A2" transform="translate(41,18)" />
			<path d="M0,0 L9,1 L8,3 L-2,3 Z " fill="#A4B34C" transform="translate(21,7)" />
			<path d="M0,0 L2,0 L7,5 L8,7 L3,6 L0,2 Z " fill="#617FCF" transform="translate(35,18)" />
			<path d="M0,0 L5,2 L8,7 L4,5 L0,2 Z " fill="#9D7784" transform="translate(33,11)" />
			<path d="M0,0 L6,2 L6,4 L0,3 Z " fill="#BC7F59" transform="translate(31,7)" />
		</svg>
	);
}

function OAuthProviderMark({ provider }: { provider: OAuthProviderKind }) {
	if (provider === 'codex') {
		return <IconCodexLogo className="ref-settings-oauth-login-icon ref-settings-oauth-login-icon--codex" />;
	}
	if (provider === 'claude') {
		return <IconClaudeLogo className="ref-settings-oauth-login-icon ref-settings-oauth-login-icon--claude" />;
	}
	return <IconAntigravityLogo className="ref-settings-oauth-login-icon ref-settings-oauth-login-icon--antigravity" />;
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
	/** 重新扫描磁盘技能（工作区 + 全局） */
	onRefreshDiskSkills?: () => void;
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
	showTransientToast?: (ok: boolean, text: string, durationMs?: number) => void;
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
	onRefreshDiskSkills,
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
	showTransientToast,
}: Props) {
	const { t, locale, setLocale } = useI18n();
	const navItems = useMemo(() => navItemsForT(t), [t]);
	const [nav, setNav] = useState<SettingsNavId>(initialNav);
	const [search, setSearch] = useState('');
	const deferredSearch = useDeferredValue(search);
	const [providerDiscoverStateById, setProviderDiscoverStateById] = useState<Record<string, ProviderDiscoverState>>({});
	const [providerDiscoverModal, setProviderDiscoverModal] = useState<ProviderDiscoverModalState | null>(null);
	const [oauthLoginState, setOauthLoginState] = useState<ProviderOAuthLoginState>({ status: 'idle' });
	const [expandedProviderIds, setExpandedProviderIds] = useState<Record<string, boolean>>({});
	const oauthLoginRequestIdRef = useRef(0);
	const oauthLoginTimeoutRef = useRef<number | undefined>(undefined);
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

	useEffect(() => {
		return () => {
			oauthLoginRequestIdRef.current += 1;
			if (oauthLoginTimeoutRef.current !== undefined) {
				window.clearTimeout(oauthLoginTimeoutRef.current);
				oauthLoginTimeoutRef.current = undefined;
			}
			void shell?.invoke('settings:cancelProviderOAuthLogin').catch(() => undefined);
		};
	}, [shell]);

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

	const groupedProviders = useMemo(
		() =>
			PROVIDER_GROUPS.map((group) => ({
				...group,
				providers: filteredProviders.filter((provider) => providerGroupId(provider) === group.id),
			})).filter((group) => group.providers.length > 0),
		[filteredProviders]
	);

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

	const providerIdentityOverridePreset = useCallback((provider: UserLlmProvider): ProviderIdentityPreset => {
		if (!provider.providerIdentity) {
			return 'inherit';
		}
		return provider.providerIdentity.preset ?? resolveProviderIdentitySettings(provider.providerIdentity).preset;
	}, []);

	const patchProviderIdentityOverride = useCallback(
		(providerId: string, patch: Partial<ProviderIdentitySettings>) => {
			const current = modelProviders.find((provider) => provider.id === providerId)?.providerIdentity ?? { preset: 'inherit' as const };
			const next: ProviderIdentitySettings = { ...current, ...patch };
			if (next.preset === 'inherit') {
				patchProvider(providerId, { providerIdentity: undefined });
				return;
			}
			patchProvider(providerId, { providerIdentity: next });
		},
		[modelProviders, patchProvider]
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
							models?: { id?: string; displayName?: string; contextWindowTokens?: number; maxOutputTokens?: number }[];
							oauthAuth?: UserLlmProvider['oauthAuth'];
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
						displayName: typeof model.displayName === 'string' ? model.displayName.trim() : undefined,
						contextWindowTokens: model.contextWindowTokens,
						maxOutputTokens: model.maxOutputTokens,
					}));
				if (result.oauthAuth) {
					patchProvider(provider.id, {
						oauthAuth: result.oauthAuth,
						apiKey: result.oauthAuth.accessToken,
					});
				}
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
		[modelEntries, patchProvider, shell, t]
	);

	const clearOAuthLoginTimeout = useCallback(() => {
		if (oauthLoginTimeoutRef.current !== undefined) {
			window.clearTimeout(oauthLoginTimeoutRef.current);
			oauthLoginTimeoutRef.current = undefined;
		}
	}, []);

	const oauthProviderLabel = useCallback(
		(provider: OAuthProviderKind) => t(`settings.oauthLogin.${provider}`),
		[t]
	);

	const formatOAuthLoginSuccess = useCallback(
		(provider: OAuthProviderKind, result: { accountId?: string; email?: string; projectId?: string; modelCount?: number }) => {
			const detail = result.email || result.accountId || result.projectId || '';
			const base = detail
				? t('settings.oauthLoginSuccessWithDetail', { provider: oauthProviderLabel(provider), detail })
				: t('settings.oauthLoginSuccess', { provider: oauthProviderLabel(provider) });
			return result.modelCount && result.modelCount > 1
				? `${base} ${t('settings.oauthLoginModelsImported', { count: String(result.modelCount) })}`
				: base;
		},
		[oauthProviderLabel, t]
	);

	const finishOAuthLogin = useCallback(
		(provider: OAuthProviderKind, ok: boolean, message: string, options?: { toast?: boolean }) => {
			const trimmed = message.trim();
			const shouldToast = Boolean(trimmed) && (options?.toast ?? !ok);
			if (shouldToast && showTransientToast) {
				showTransientToast(ok, trimmed, ok ? 4200 : 6500);
			}
			setOauthLoginState({
				status: 'done',
				provider,
				ok,
				message: ok || !showTransientToast || !shouldToast ? trimmed : undefined,
			});
		},
		[showTransientToast]
	);

	const toggleProviderExpanded = useCallback((providerId: string) => {
		setExpandedProviderIds((prev) => ({
			...prev,
			[providerId]: prev[providerId] !== true,
		}));
	}, []);

	const runProviderOAuthLogin = useCallback(async (provider: OAuthProviderKind) => {
		const providerLabel = oauthProviderLabel(provider);
		if (!shell) {
			finishOAuthLogin(provider, false, t('settings.oauthLoginUnavailable', { provider: providerLabel }));
			return;
		}
		if (oauthLoginState.status === 'loading') {
			if (oauthLoginState.provider !== provider) {
				return;
			}
			oauthLoginRequestIdRef.current += 1;
			clearOAuthLoginTimeout();
			finishOAuthLogin(provider, false, t('settings.oauthLoginCancelled', { provider: providerLabel }));
			void shell.invoke('settings:cancelProviderOAuthLogin').catch(() => undefined);
			return;
		}
		const requestId = oauthLoginRequestIdRef.current + 1;
		oauthLoginRequestIdRef.current = requestId;
		clearOAuthLoginTimeout();
		setOauthLoginState({ status: 'loading', provider });
		oauthLoginTimeoutRef.current = window.setTimeout(() => {
			if (oauthLoginRequestIdRef.current !== requestId) {
				return;
			}
			oauthLoginRequestIdRef.current += 1;
			oauthLoginTimeoutRef.current = undefined;
			finishOAuthLogin(provider, false, t('settings.oauthLoginTimedOut', { provider: providerLabel }));
			void shell.invoke('settings:cancelProviderOAuthLogin').catch(() => undefined);
		}, PROVIDER_OAUTH_LOGIN_UI_TIMEOUT_MS);
		try {
			const result = (await shell.invoke('settings:runProviderOAuthLogin', {
				provider,
				providers: modelProviders,
				entries: modelEntries,
				defaultModel,
				timeoutMs: PROVIDER_OAUTH_LOGIN_UI_TIMEOUT_MS + 5_000,
			})) as
				| {
						ok?: boolean;
						providers?: UserLlmProvider[];
						entries?: UserModelEntry[];
						defaultModel?: string;
						accountId?: string;
						email?: string;
						projectId?: string;
						modelCount?: number;
						message?: string;
				  }
				| undefined;
			if (oauthLoginRequestIdRef.current !== requestId) {
				return;
			}
			clearOAuthLoginTimeout();
			if (result?.ok !== true || !Array.isArray(result.providers) || !Array.isArray(result.entries)) {
				finishOAuthLogin(provider, false, result?.message?.trim() || t('settings.oauthLoginFailed', { provider: providerLabel }));
				return;
			}
			onChangeModelProviders(result.providers);
			onChangeModelEntries(result.entries);
			if (!defaultModel && result.defaultModel) {
				void onPickDefaultModel(result.defaultModel);
			}
			finishOAuthLogin(provider, true, formatOAuthLoginSuccess(provider, result), { toast: false });
		} catch (error) {
			if (oauthLoginRequestIdRef.current !== requestId) {
				return;
			}
			clearOAuthLoginTimeout();
			finishOAuthLogin(
				provider,
				false,
				error instanceof Error ? error.message : String(error ?? t('settings.oauthLoginFailed', { provider: providerLabel }))
			);
		}
	}, [
		clearOAuthLoginTimeout,
		defaultModel,
		finishOAuthLogin,
		formatOAuthLoginSuccess,
		modelEntries,
		modelProviders,
		oauthLoginState.provider,
		oauthLoginState.status,
		oauthProviderLabel,
		onChangeModelEntries,
		onChangeModelProviders,
		onPickDefaultModel,
		shell,
		t,
	]);

	return (
		<div className="ref-settings-root" role="dialog" aria-modal="true" aria-label={t('settings.dialogAria')}>
			<div className="ref-settings-layout">
				<aside className="ref-settings-sidebar" style={{ width: sidebarWidth }}>
					<div className="ref-settings-sidebar-tools">
						<button
							type="button"
							className="ref-settings-icon-btn ref-settings-back-btn"
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
							aria-label={t('common.back')}
							title={t('common.back')}
						>
							<IconBack />
							<span className="ref-settings-back-btn-label">{t('common.back')}</span>
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
														value: 'codex',
														label: t('settings.general.identityPreset.codex'),
													},
													{
														value: 'antigravity',
														label: t('settings.general.identityPreset.antigravity'),
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
													: resolvedProviderIdentity.preset === 'codex'
													? t('settings.general.identityPresetCodexHint')
													: resolvedProviderIdentity.preset === 'antigravity'
													? t('settings.general.identityPresetAntigravityHint')
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
									<div className="ref-settings-models-primary-row">
										<div className="ref-settings-models-search-wrap ref-settings-models-search-wrap--compact">
											<IconSearch className="ref-settings-models-search-ico" />
											<input
												className="ref-settings-models-search"
												placeholder={t('settings.modelSearchPlaceholder')}
												value={search}
												onChange={(e) => setSearch(e.target.value)}
											/>
										</div>
										<button type="button" className="ref-settings-add-model ref-settings-model-action-btn" onClick={addProvider}>
											{t('settings.addProvider')}
										</button>
									</div>
									<div className="ref-settings-models-actions">
										{OAUTH_LOGIN_PROVIDERS.map((provider) => {
											const isLoading =
												oauthLoginState.status === 'loading' && oauthLoginState.provider === provider;
											const anotherLoading =
												oauthLoginState.status === 'loading' && oauthLoginState.provider !== provider;
											return (
												<button
													key={provider}
													type="button"
													className={`ref-settings-add-model ref-settings-oauth-login-btn ref-settings-oauth-login-btn--${provider} ${
														isLoading ? 'is-loading' : ''
													}`}
													onClick={() => void runProviderOAuthLogin(provider)}
													disabled={!shell || anotherLoading}
													aria-busy={isLoading}
												>
													<OAuthProviderMark provider={provider} />
													<span>
														{isLoading ? t('settings.oauthLoginCancel') : t(`settings.oauthLogin.${provider}`)}
													</span>
												</button>
											);
										})}
									</div>
								</div>
								{oauthLoginState.status === 'done' && oauthLoginState.message ? (
									<p
										className="ref-settings-field-hint ref-settings-oauth-login-message"
										style={{
											color: oauthLoginState.ok === false ? 'var(--void-danger, #ef4444)' : undefined,
										}}
									>
										{oauthLoginState.message}
									</p>
								) : null}

								<div className="ref-settings-provider-groups" aria-label={t('settings.modelCatalog')}>
									{groupedProviders.map((group) => (
										<section key={group.id} className="ref-settings-provider-group">
											<div className="ref-settings-provider-group-head">
												<div className="ref-settings-provider-group-title-wrap">
													{group.oauthProvider ? <OAuthProviderMark provider={group.oauthProvider} /> : null}
													<h3 className="ref-settings-provider-group-title">{t(group.labelKey)}</h3>
												</div>
												<span className="ref-settings-provider-group-count">
													{t('settings.providerGroupCount', { count: String(group.providers.length) })}
												</span>
											</div>
											<ul className="ref-settings-provider-root-list" aria-label={t(group.labelKey)}>
												{group.providers.map((prov) => {
										const subModels = modelsVisibleUnderProvider(prov);
										const discoverState = providerDiscoverStateById[prov.id];
										const providerExpanded = expandedProviderIds[prov.id] === true;
										const providerBodyId = `settings-provider-body-${prov.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
										const identityPreset = providerIdentityOverridePreset(prov);
										const providerIdentityResolved =
											identityPreset === 'inherit'
												? resolveProviderIdentityWithOverride(providerIdentity, prov.providerIdentity)
												: resolveProviderIdentitySettings(prov.providerIdentity);
										const oauthUsage = providerOAuthUsageDisplay(prov, locale, t);
										return (
											<li key={prov.id} className="ref-settings-provider-shell">
												<div className={`ref-settings-provider-details ${providerExpanded ? 'is-open' : ''}`}>
													<button
														type="button"
														className="ref-settings-provider-summary"
														aria-expanded={providerExpanded}
														aria-controls={providerBodyId}
														onClick={() => toggleProviderExpanded(prov.id)}
													>
														<span className="ref-settings-provider-summary-chev" aria-hidden />
														<span className="ref-settings-provider-summary-text">
															{prov.displayName.trim() || t('settings.providerUntitled')}
														</span>
														<span className="ref-settings-provider-summary-tag">{t(`settings.paradigm.${prov.paradigm}`)}</span>
													</button>

													<div
														id={providerBodyId}
														className="ref-settings-provider-collapse"
														aria-hidden={!providerExpanded}
													>
														<div className="ref-settings-provider-collapse-inner">
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
															<label className="ref-settings-field ref-settings-field--compact">
																<span>{t('settings.providerIdentity')}</span>
																<VoidSelect
																	ariaLabel={t('settings.providerIdentity')}
																	value={identityPreset}
																	onChange={(next) => {
																		const preset = next as ProviderIdentityPreset;
																		patchProviderIdentityOverride(prov.id, { preset });
																	}}
																	options={[
																		{ value: 'inherit', label: t('settings.providerIdentityInherit') },
																		{ value: 'async-default', label: t('settings.general.identityPreset.async') },
																		{ value: 'claude-code', label: t('settings.general.identityPreset.claudeCode') },
																		{ value: 'codex', label: t('settings.general.identityPreset.codex') },
																		{ value: 'antigravity', label: t('settings.general.identityPreset.antigravity') },
																		{ value: 'custom', label: t('settings.general.identityPreset.custom') },
																	]}
																/>
																<p className="ref-settings-proxy-hint ref-settings-field-footnote">
																	{identityPreset === 'inherit'
																		? t('settings.providerIdentityInheritHint')
																		: t('settings.providerIdentityOverrideHint')}
																</p>
															</label>
															{identityPreset === 'custom' ? (
																<div className="ref-settings-provider-identity-custom">
																	<label className="ref-settings-field ref-settings-field--compact">
																		<span>{t('settings.general.identityUserAgentProduct')}</span>
																		<input
																			type="text"
																			value={providerIdentityResolved.userAgentProduct}
																			spellCheck={false}
																			onChange={(event) =>
																				patchProviderIdentityOverride(prov.id, {
																					userAgentProduct: event.target.value,
																				})
																			}
																		/>
																	</label>
																	<label className="ref-settings-field ref-settings-field--compact">
																		<span>{t('settings.general.identityEntrypoint')}</span>
																		<input
																			type="text"
																			value={providerIdentityResolved.entrypoint}
																			spellCheck={false}
																			onChange={(event) =>
																				patchProviderIdentityOverride(prov.id, {
																					entrypoint: event.target.value,
																				})
																			}
																		/>
																	</label>
																	<label className="ref-settings-field ref-settings-field--compact">
																		<span>{t('settings.general.identityAppHeader')}</span>
																		<input
																			type="text"
																			value={providerIdentityResolved.appHeaderValue}
																			spellCheck={false}
																			onChange={(event) =>
																				patchProviderIdentityOverride(prov.id, {
																					appHeaderValue: event.target.value,
																				})
																			}
																		/>
																	</label>
																	<label className="ref-settings-field ref-settings-field--compact">
																		<span>{t('settings.general.identityClientApp')}</span>
																		<input
																			type="text"
																			value={providerIdentityResolved.clientAppValue}
																			spellCheck={false}
																			onChange={(event) =>
																				patchProviderIdentityOverride(prov.id, {
																					clientAppValue: event.target.value,
																				})
																			}
																		/>
																	</label>
																</div>
															) : null}
														</div>
														{oauthUsage ? (
															<div className={`ref-settings-oauth-usage ref-settings-oauth-usage--${oauthUsage.tone}`}>
																<div className="ref-settings-oauth-usage-title">{oauthUsage.title}</div>
																<div className="ref-settings-oauth-usage-body">{oauthUsage.body}</div>
																{oauthUsage.meta ? (
																	<div className="ref-settings-oauth-usage-meta">{oauthUsage.meta}</div>
																) : null}
															</div>
														) : null}

														<div className="ref-settings-provider-models-head">
															<h3 className="ref-settings-provider-models-title">{t('settings.modelsInProvider')}</h3>
															<div className="ref-settings-provider-models-actions">
																{prov.paradigm === 'openai-compatible' || prov.oauthAuth?.provider === 'claude' || prov.oauthAuth?.provider === 'antigravity' ? (
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
																const temperatureMode = m.temperatureMode === 'custom' ? 'custom' : 'auto';
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
																					<span>{t('settings.temperatureMode')}</span>
																					<VoidSelect
																						ariaLabel={t('settings.temperatureMode')}
																						value={temperatureMode}
																						onChange={(value) => {
																							if (value === 'custom') {
																								patchEntry(m.id, {
																									temperatureMode: 'custom',
																									...(m.temperature == null ? { temperature: 1 } : {}),
																								});
																								return;
																							}
																							patchEntry(m.id, { temperatureMode: 'auto' });
																						}}
																						options={[
																							{ value: 'auto', label: t('settings.temperatureModeAuto') },
																							{ value: 'custom', label: t('settings.temperatureModeCustom') },
																						]}
																					/>
																					<p className="ref-settings-proxy-hint ref-settings-field-footnote">
																						{t('settings.temperatureModeHint')}
																					</p>
																				</label>
																				{temperatureMode === 'custom' ? (
																					<label className="ref-settings-field ref-settings-field--compact">
																						<span>{t('settings.temperature')}</span>
																						<input
																							type="number"
																							min={0}
																							max={2}
																							step={0.05}
																							placeholder="1"
																							value={m.temperature ?? ''}
																							onChange={(e) => {
																								const raw = e.target.value.trim();
																								if (raw === '') {
																									patchEntry(m.id, { temperature: undefined });
																									return;
																								}
																								const v = Number.parseFloat(raw);
																								patchEntry(m.id, {
																									temperature: Number.isNaN(v)
																										? undefined
																										: Math.max(0, Math.min(2, v)),
																								});
																							}}
																						/>
																						<p className="ref-settings-proxy-hint ref-settings-field-footnote">
																							{t('settings.temperatureCustomHint')}
																						</p>
																					</label>
																				) : null}
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
														</div>
													</div>
												</div>
											</li>
										);
												})}
											</ul>
										</section>
									))}
								</div>
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
									onRefreshDiskSkills={onRefreshDiskSkills}
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
