import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentCustomization } from './agentSettingsTypes.js';
import type { BotIntegrationConfig } from './botSettingsTypes.js';
import type { McpServerConfig } from './mcp/mcpTypes.js';
import {
	defaultProviderIdentitySettings,
	type ProviderIdentitySettings,
} from '../src/providerIdentitySettings.js';
import { resolveAsyncDataDir } from './dataDir.js';
import { normalizeThinkingLevel, type ThinkingLevel } from './llm/thinkingLevel.js';
export type { ThinkingLevel } from './llm/thinkingLevel.js';
export type {
	AgentCustomization,
	AgentRule,
	AgentSkill,
	AgentSubagent,
	AgentCommand,
	AgentToolPermissionRule,
	AgentMemoryExtractionSettings,
	ToolPermissionBehavior,
} from './agentSettingsTypes.js';
export type { McpServerConfig } from './mcp/mcpTypes.js';
export type { BotIntegrationConfig } from './botSettingsTypes.js';

/** 单条用户模型实际请求时使用的协议（与适配器一致） */
export type ModelRequestParadigm = 'openai-compatible' | 'anthropic' | 'gemini';

/** 用户配置的 LLM 提供商（连接信息在提供商级统一维护） */
export type UserLlmProvider = {
	/** 稳定 id */
	id: string;
	/** 界面显示名称 */
	displayName: string;
	paradigm: ModelRequestParadigm;
	apiKey?: string;
	/** OpenAI 兼容 / Anthropic 可选 */
	baseURL?: string;
	/** 仅 OpenAI 兼容请求使用的 HTTP(S) 代理 */
	proxyUrl?: string;
};

export type UserModelEntry = {
	/** 稳定 id，用于设置与选择器 */
	id: string;
	/** 所属提供商 id */
	providerId: string;
	/** 界面显示名称 */
	displayName: string;
	/** 发给 API 的模型名 */
	requestName: string;
	/**
	 * 单次补全最大输出 token 上限（各范式各自映射到 API 参数）。
	 * 未设置时在解析层使用默认（当前为 16384）；若网关上限更低请在模型高级选项中调小。
	 */
	maxOutputTokens?: number;
	/**
	 * 模型输入上下文上限（tokens），用于发送前压缩阈值等行为。
	 * 不填则使用 OpenAI 兼容 `/v1/models` 缓存、启发式或默认 200k。
	 */
	contextWindowTokens?: number;
};

export type LLMProviderId = ModelRequestParadigm;

/** 主界面左右侧栏宽度（桌面端持久化，避免 file:// localStorage 因路径变化丢失） */
export type SidebarLayoutPx = { left: number; right: number };

/** 界面颜色模式：`system` 跟随 OS，有效亮暗由渲染层解析 */
export type ShellColorMode = 'light' | 'dark' | 'system';
export type ShellUiFontPreset = 'apple' | 'inter' | 'segoe';

export type ShellUiSettings = {
	sidebarLayout?: SidebarLayoutPx;
	colorMode?: ShellColorMode;
	fontPreset?: ShellUiFontPreset;
	uiFontPreset?: ShellUiFontPreset;
	codeFontPreset?: 'sfmono' | 'monospace' | 'jetbrains';
	themePresetId?: 'async' | 'cursor' | 'graphite' | 'forest' | 'sunset' | 'custom';
	accentColor?: string;
	backgroundColor?: string;
	foregroundColor?: string;
	translucentSidebar?: boolean;
	contrast?: number;
	usePointerCursors?: boolean;
	uiFontSize?: number;
	codeFontSize?: number;
	/** Desktop shell layout: centered agent workspace or classic editor three-column layout. */
	layoutMode?: 'agent' | 'editor';
};

/**
 * 旧版在 settings.json 中登记 LSP 的方式；**优先推荐**使用插件声明：
 * 在 `<asyncData>/plugins/<name>/` 或 `<workspace>/.async/plugins/<name>/` 下放置 `.lsp.json` 或 `plugin.json#lspServers`。
 * 保留本结构仅为兼容已有配置（会合并为 `plugin:settings:<id>`）。
 */
export type ShellLspUserServer = {
	/** 唯一 id，用于日志与多服务器区分 */
	id: string;
	command: string;
	args?: string[];
	extensions: string[];
	extensionToLanguage?: Record<string, string>;
	cwd?: string;
};

export type ShellLspSettings = {
	servers?: ShellLspUserServer[];
};

export type TeamRoleType = 'team_lead' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'custom';
export type TeamPresetId = 'engineering' | 'planning' | 'design';

export type TeamExpertConfig = {
	id: string;
	name: string;
	roleType: TeamRoleType;
	assignmentKey?: string;
	systemPrompt: string;
	preferredModelId?: string;
	allowedTools?: string[];
	enabled?: boolean;
};

export type TeamSettings = {
	experts?: TeamExpertConfig[];
	useDefaults?: boolean;
	/** @deprecated 保留仅兼容旧 settings.json */
	maxParallelExperts?: number;
	presetId?: TeamPresetId;
	presetExpertSnapshots?: Partial<Record<TeamPresetId, TeamExpertConfig[]>>;
	/** Lead 出方案后先等用户确认再派发专家；默认 true */
	requirePlanApproval?: boolean;
	/** 执行前先让评审专家评估需求/方案；默认值随 preset 决定（engineering 默认 false） */
	enablePreflightReview?: boolean;
	/** 可选的规划评审专家；为空时复用 reviewer */
	planReviewer?: TeamExpertConfig | null;
	/** 可选的交付评审专家；为空时复用 reviewer */
	deliveryReviewer?: TeamExpertConfig | null;
};

export type ShellSettings = {
	/** 界面语言：zh-CN 简体中文（默认）、en 英文 */
	language?: 'zh-CN' | 'en';
	/** @deprecated 已由每条模型的 paradigm 取代，保留仅兼容旧 settings.json */
	llm?: {
		provider?: LLMProviderId;
	};
	openAI?: {
		apiKey?: string;
		baseURL?: string;
		/** HTTP/HTTPS 代理，如 http://127.0.0.1:7890 */
		proxyUrl?: string;
	};
	anthropic?: {
		apiKey?: string;
		baseURL?: string;
	};
	gemini?: {
		apiKey?: string;
	};
	/** 类似 Claude Code 的 provider / model 身份信号（UA、headers、system prefix、Anthropic metadata） */
	providerIdentity?: ProviderIdentitySettings;
	/** 当前选择的用户模型 id；未选择时为空或省略 */
	defaultModel?: string;
	/**
	 * @deprecated 已由 `models.thinkingByModelId` 按模型区分；读入时仅用于一次性迁移到各 id。
	 */
	thinkingLevel?: ThinkingLevel;
	models?: {
		/** 用户配置的提供商（含 Base URL / Key / 代理等） */
		providers?: UserLlmProvider[];
		/** 用户自添加的模型条目 */
		entries?: UserModelEntry[];
		/** 在选择器中启用的条目 id，顺序决定 Auto 的优先级 */
		enabledIds?: string[];
		/** 按选择器 id（`auto` 或某条目的 id）分别存储思考强度 */
		thinkingByModelId?: Record<string, ThinkingLevel>;
	};
	recentWorkspaces?: string[];
	lastOpenedWorkspace?: string | null;
	/** Rules / Skills / Subagents / Commands（对话注入） */
	agent?: AgentCustomization;
	/** 窗口布局等纯界面状态 */
	ui?: ShellUiSettings;
	/** @deprecated 兼容字段；LSP 主要来自插件目录，此项若存在会一并合并 */
	lsp?: ShellLspSettings;
	/** MCP 服务器配置 */
	mcpServers?: McpServerConfig[];
	/**
	 * MCP 工具全名前缀拒绝列表（按 `mcp__server` 等规则做预过滤）。
	 * 若某工具名以列表中任一条目开头，则不会进入模型可见工具表（仅影响动态 MCP 工具，不含 ListMcpResourcesTool 等内置项）。
	 */
	mcpToolDenyPrefixes?: string[];
	/**
	 * 统计与用量：默认关闭；开启后写入用户指定目录下的 usage-stats.json（不按工作区分片）。
	 */
	usageStats?: {
		enabled?: boolean;
		/** 绝对路径，用户选择的数据目录 */
		dataDir?: string | null;
	};
	/**
	 * 自动更新：默认开启；从 GitHub Release 拉取更新，支持差异化更新。
	 */
	autoUpdate?: {
		/** 是否启用自动更新 */
		enabled?: boolean;
		/** 是否允许下载差异化更新包（否则全量更新） */
		allowDifferential?: boolean;
	};
	/** Team 模式角色配置 */
	team?: TeamSettings;
	/** 外部机器人接入 */
	bots?: {
		integrations?: BotIntegrationConfig[];
	};
};

const defaultSettings: ShellSettings = {
	language: 'zh-CN',
	thinkingLevel: 'medium',
	recentWorkspaces: [],
	lastOpenedWorkspace: null,
	providerIdentity: defaultProviderIdentitySettings(),
	team: {
		useDefaults: true,
		presetId: 'engineering',
		experts: [],
		requirePlanApproval: true,
		enablePreflightReview: false,
		planReviewer: null,
		deliveryReviewer: null,
	},
	bots: {
		integrations: [],
	},
};

const MAX_RECENTS = 24;

let cached: ShellSettings = { ...defaultSettings };
let settingsPath = '';
type LegacyShellSettings = ShellSettings & { indexing?: unknown };

/** 保证每个选择器 id 在 thinkingByModelId 中有条目；无历史 map 时用旧版全局 thinkingLevel 或 medium 填充。 */
function migrateThinkingByModel(settings: ShellSettings): { next: ShellSettings; didMutate: boolean } {
	const entries = settings.models?.entries ?? [];
	const enabledIds = settings.models?.enabledIds ?? [];
	const ids = new Set<string>();
	for (const id of enabledIds) {
		ids.add(String(id));
	}
	for (const e of entries) {
		ids.add(String(e.id));
	}

	const rawMap = settings.models?.thinkingByModelId;
	const hadStoredMap = rawMap != null && typeof rawMap === 'object' && !Array.isArray(rawMap);

	const map: Record<string, ThinkingLevel> = {};
	if (hadStoredMap) {
		for (const [k, v] of Object.entries(rawMap as Record<string, unknown>)) {
			map[k] = normalizeThinkingLevel(typeof v === 'string' ? v : undefined);
		}
	}

	let didMutate = false;
	if (!hadStoredMap) {
		const seed = settings.thinkingLevel != null ? normalizeThinkingLevel(settings.thinkingLevel) : 'medium';
		for (const id of ids) {
			map[id] = seed;
		}
		didMutate = true;
	} else {
		for (const id of ids) {
			if (map[id] === undefined) {
				map[id] = 'medium';
				didMutate = true;
			}
		}
	}

	return {
		next: {
			...settings,
			models: {
				...(settings.models ?? {}),
				entries,
				enabledIds,
				thinkingByModelId: map,
			},
		},
		didMutate,
	};
}

type LegacyModelJson = {
	id?: string;
	displayName?: string;
	requestName?: string;
	maxOutputTokens?: number;
	providerId?: string;
	paradigm?: ModelRequestParadigm;
	useCustomConnection?: boolean;
	customBaseURL?: string;
	customApiKey?: string;
};

function providerMigrationNeeded(settings: ShellSettings): boolean {
	const provList = settings.models?.providers;
	const providers = Array.isArray(provList) ? provList : [];
	const provIds = new Set(providers.map((p) => p.id));
	const rawEntries = settings.models?.entries ?? [];

	for (const raw of rawEntries) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const e = raw as LegacyModelJson;
		if (e.useCustomConnection === true || e.customApiKey != null || e.customBaseURL != null) {
			return true;
		}
		if (e.paradigm != null && (typeof e.providerId !== 'string' || !e.providerId)) {
			return true;
		}
		if (typeof e.providerId !== 'string' || !provIds.has(e.providerId)) {
			return true;
		}
	}

	if (rawEntries.length === 0) {
		const hasGlobal =
			!!(settings.openAI?.apiKey?.trim()) ||
			!!(settings.openAI?.baseURL?.trim()) ||
			!!(settings.anthropic?.apiKey?.trim()) ||
			!!(settings.gemini?.apiKey?.trim());
		if (hasGlobal && providers.length === 0) {
			return true;
		}
	}

	return false;
}

/**
 * 将旧版「每模型独立连接 / 全局密钥」结构迁移为「提供商 + 模型」。
 */
function migrateProviderModelLayout(settings: ShellSettings): { next: ShellSettings; didMutate: boolean } {
	if (!providerMigrationNeeded(settings)) {
		return { next: settings, didMutate: false };
	}

	const rawEntries = (settings.models?.entries ?? []) as LegacyModelJson[];
	const nextProviders: UserLlmProvider[] = [];
	const defaults: Partial<Record<ModelRequestParadigm, string>> = {};
	const customKeyToId = new Map<string, string>();

	function ensureDefaultParadigm(p: ModelRequestParadigm): string {
		const hit = defaults[p];
		if (hit) {
			return hit;
		}
		const id = randomUUID();
		defaults[p] = id;
		if (p === 'openai-compatible') {
			nextProviders.push({
				id,
				displayName: 'OpenAI compatible',
				paradigm: p,
				apiKey: settings.openAI?.apiKey,
				baseURL: settings.openAI?.baseURL,
				proxyUrl: settings.openAI?.proxyUrl,
			});
		} else if (p === 'anthropic') {
			nextProviders.push({
				id,
				displayName: 'Anthropic',
				paradigm: p,
				apiKey: settings.anthropic?.apiKey,
				baseURL: settings.anthropic?.baseURL,
			});
		} else {
			nextProviders.push({
				id,
				displayName: 'Google Gemini',
				paradigm: p,
				apiKey: settings.gemini?.apiKey,
			});
		}
		return id;
	}

	const nextEntries: UserModelEntry[] = [];

	for (const raw of rawEntries) {
		const id = typeof raw.id === 'string' && raw.id ? raw.id : randomUUID();
		const paradigm: ModelRequestParadigm = raw.paradigm ?? 'openai-compatible';
		let providerId: string;

		if (raw.useCustomConnection === true) {
			const b = String(raw.customBaseURL ?? '').trim();
			const k = String(raw.customApiKey ?? '').trim();
			const mapKey = `${paradigm}\n${b}\n${k}`;
			const existing = customKeyToId.get(mapKey);
			if (existing) {
				providerId = existing;
			} else {
				providerId = randomUUID();
				customKeyToId.set(mapKey, providerId);
				const labelHint =
					String(raw.displayName ?? '').trim() ||
					String(raw.requestName ?? '').trim() ||
					(paradigm === 'openai-compatible'
						? 'OpenAI endpoint'
						: paradigm === 'anthropic'
							? 'Anthropic endpoint'
							: 'Gemini endpoint');
				nextProviders.push({
					id: providerId,
					displayName: labelHint,
					paradigm,
					apiKey: k || undefined,
					baseURL: paradigm === 'gemini' ? undefined : b || undefined,
				});
			}
		} else {
			providerId = ensureDefaultParadigm(paradigm);
		}

		nextEntries.push({
			id,
			providerId,
			displayName: String(raw.displayName ?? ''),
			requestName: String(raw.requestName ?? ''),
			maxOutputTokens: raw.maxOutputTokens,
		});
	}

	if (rawEntries.length === 0) {
		if (settings.openAI?.apiKey?.trim() || settings.openAI?.baseURL?.trim()) {
			ensureDefaultParadigm('openai-compatible');
		}
		if (settings.anthropic?.apiKey?.trim() || settings.anthropic?.baseURL?.trim()) {
			ensureDefaultParadigm('anthropic');
		}
		if (settings.gemini?.apiKey?.trim()) {
			ensureDefaultParadigm('gemini');
		}
	}

	const enabledIds = settings.models?.enabledIds ?? [];
	const validEntryIds = new Set(nextEntries.map((e) => e.id));
	const saneEnabled = enabledIds.filter((x) => validEntryIds.has(String(x)));

	return {
		next: {
			...settings,
			models: {
				...(settings.models ?? {}),
				providers: nextProviders,
				entries: nextEntries,
				enabledIds: saneEnabled,
				thinkingByModelId: settings.models?.thinkingByModelId ?? {},
			},
		},
		didMutate: true,
	};
}

function migrateDefaultModelRemoveAuto(settings: ShellSettings): { next: ShellSettings; didMutate: boolean } {
	const dm = settings.defaultModel;
	if (typeof dm !== 'string') {
		return { next: settings, didMutate: false };
	}
	if (dm.trim().toLowerCase() === 'auto') {
		return { next: { ...settings, defaultModel: undefined }, didMutate: true };
	}
	return { next: settings, didMutate: false };
}

export function initSettingsStore(userData: string): void {
	const dir = resolveAsyncDataDir(userData);
	fs.mkdirSync(dir, { recursive: true });
	settingsPath = path.join(dir, 'settings.json');
	if (fs.existsSync(settingsPath)) {
		try {
			const raw = fs.readFileSync(settingsPath, 'utf8');
			const parsed = JSON.parse(raw) as LegacyShellSettings;
			const { indexing: _legacyIndexing, ...rest } = parsed;
			cached = { ...defaultSettings, ...rest };
		} catch {
			cached = { ...defaultSettings };
		}
	} else {
		cached = { ...defaultSettings };
	}
	const migratedDm = migrateDefaultModelRemoveAuto(cached);
	cached = migratedDm.next;
	const migratedPm = migrateProviderModelLayout(cached);
	cached = migratedPm.next;
	const migrated = migrateThinkingByModel(cached);
	cached = migrated.next;
	if (
		migratedDm.didMutate ||
		migratedPm.didMutate ||
		migrated.didMutate
	) {
		save();
	} else if (!fs.existsSync(settingsPath)) {
		save();
	}
}

export function getSettings(): ShellSettings {
	return { ...cached };
}

/** 已开启且配置了目录时返回解析后的绝对路径，否则 null（不写统计）。 */
export function resolveUsageStatsDataDir(settings: ShellSettings): string | null {
	const u = settings.usageStats;
	if (!u?.enabled) {
		return null;
	}
	const dir = typeof u.dataDir === 'string' ? u.dataDir.trim() : '';
	if (!dir) {
		return null;
	}
	try {
		return path.resolve(dir);
	} catch {
		return null;
	}
}

export function patchSettings(partial: Partial<ShellSettings>): ShellSettings {
	const {
		ui: partialUi,
		usageStats: partialUsageStats,
		autoUpdate: partialAutoUpdate,
		providerIdentity: partialProviderIdentity,
		...partialRest
	} = partial;

	const nextModels =
		partial.models !== undefined
			? {
					providers:
						partial.models.providers !== undefined
							? partial.models.providers
							: (cached.models?.providers ?? []),
					entries:
						partial.models.entries !== undefined
							? partial.models.entries
							: (cached.models?.entries ?? []),
					enabledIds:
						partial.models.enabledIds !== undefined
							? partial.models.enabledIds
							: (cached.models?.enabledIds ?? []),
					thinkingByModelId:
						partial.models.thinkingByModelId !== undefined
							? { ...(cached.models?.thinkingByModelId ?? {}), ...partial.models.thinkingByModelId }
							: (cached.models?.thinkingByModelId ?? {}),
				}
			: cached.models;

	const nextAgent =
		partial.agent !== undefined
			? {
					importThirdPartyConfigs: partial.agent.importThirdPartyConfigs ?? cached.agent?.importThirdPartyConfigs ?? true,
					rules: partial.agent.rules ?? cached.agent?.rules ?? [],
					skills: partial.agent.skills ?? cached.agent?.skills ?? [],
					subagents: partial.agent.subagents ?? cached.agent?.subagents ?? [],
					commands: partial.agent.commands ?? cached.agent?.commands ?? [],
					shellPermissionMode:
						partial.agent.shellPermissionMode !== undefined
							? partial.agent.shellPermissionMode
							: cached.agent?.shellPermissionMode,
					confirmShellCommands: partial.agent.confirmShellCommands ?? cached.agent?.confirmShellCommands,
					skipSafeShellCommandsConfirm:
						partial.agent.skipSafeShellCommandsConfirm ?? cached.agent?.skipSafeShellCommandsConfirm,
					confirmWritesBeforeExecute:
						partial.agent.confirmWritesBeforeExecute ?? cached.agent?.confirmWritesBeforeExecute,
					maxConsecutiveMistakes:
						partial.agent.maxConsecutiveMistakes ?? cached.agent?.maxConsecutiveMistakes,
					mistakeLimitEnabled: partial.agent.mistakeLimitEnabled ?? cached.agent?.mistakeLimitEnabled,
					streamIdleTimeoutMs: partial.agent.streamIdleTimeoutMs ?? cached.agent?.streamIdleTimeoutMs,
					streamIdleWatchdogEnabled:
						partial.agent.streamIdleWatchdogEnabled ?? cached.agent?.streamIdleWatchdogEnabled,
					roundHardTimeoutMs: partial.agent.roundHardTimeoutMs ?? cached.agent?.roundHardTimeoutMs,
					maxToolRounds: partial.agent.maxToolRounds ?? cached.agent?.maxToolRounds,
					toolPermissionRules:
						partial.agent.toolPermissionRules !== undefined
							? partial.agent.toolPermissionRules
							: (cached.agent?.toolPermissionRules ?? []),
					shouldAvoidPermissionPrompts:
						partial.agent.shouldAvoidPermissionPrompts !== undefined
							? partial.agent.shouldAvoidPermissionPrompts
							: cached.agent?.shouldAvoidPermissionPrompts,
					memoryExtraction:
						partial.agent.memoryExtraction !== undefined
							? { ...(cached.agent?.memoryExtraction ?? {}), ...partial.agent.memoryExtraction }
							: cached.agent?.memoryExtraction,
				}
			: cached.agent;

	const mergedUi =
		partialUi !== undefined ? { ...(cached.ui ?? {}), ...partialUi } : cached.ui;

	const mergedMcp =
		partial.mcp !== undefined && Array.isArray(partial.mcp.servers)
			? partial.mcp.servers
			: cached.mcpServers;

	const mergedUsageStats =
		partialUsageStats !== undefined
			? { ...(cached.usageStats ?? {}), ...partialUsageStats }
			: cached.usageStats;

	const mergedAutoUpdate =
		partialAutoUpdate !== undefined
			? { ...(cached.autoUpdate ?? {}), ...partialAutoUpdate }
			: cached.autoUpdate;

	const mergedProviderIdentity =
		partialProviderIdentity !== undefined
			? { ...(cached.providerIdentity ?? defaultProviderIdentitySettings()), ...partialProviderIdentity }
			: (cached.providerIdentity ?? defaultProviderIdentitySettings());

	const partialBotsRaw = (partial as Partial<ShellSettings> & { bots?: { integrations?: BotIntegrationConfig[] } }).bots;
	const mergedBots =
		partialBotsRaw !== undefined
			? {
					integrations:
						Array.isArray(partialBotsRaw?.integrations)
							? partialBotsRaw.integrations
							: (cached.bots?.integrations ?? []),
				}
			: cached.bots;

	const { indexing: _legacyIndexing, ...cachedWithoutLegacyIndexing } = cached as LegacyShellSettings;

	cached = {
		...cachedWithoutLegacyIndexing,
		...partialRest,
		llm: partial.llm ? { ...(cached.llm ?? {}), ...partial.llm } : cached.llm,
		openAI: partial.openAI ? { ...cached.openAI, ...partial.openAI } : cached.openAI,
		anthropic: partial.anthropic ? { ...(cached.anthropic ?? {}), ...partial.anthropic } : cached.anthropic,
		gemini: partial.gemini ? { ...(cached.gemini ?? {}), ...partial.gemini } : cached.gemini,
		models: nextModels,
		agent: nextAgent,
		ui: mergedUi,
		mcpServers: mergedMcp,
		usageStats: mergedUsageStats,
		autoUpdate: mergedAutoUpdate,
		providerIdentity: mergedProviderIdentity,
		bots: mergedBots,
	};
	cached = migrateDefaultModelRemoveAuto(cached).next;
	cached = migrateProviderModelLayout(cached).next;
	cached = migrateThinkingByModel(cached).next;
	save();
	return getSettings();
}

export function getRecentWorkspaces(): string[] {
	const raw = cached.recentWorkspaces ?? [];
	return raw.filter((p) => typeof p === 'string' && p.length > 0);
}

export function rememberWorkspace(root: string): void {
	const norm = path.resolve(root);
	const rest = getRecentWorkspaces().filter((p) => path.resolve(p) !== norm);
	cached.recentWorkspaces = [norm, ...rest].slice(0, MAX_RECENTS);
	cached.lastOpenedWorkspace = norm;
	save();
}

export function removeRecentWorkspace(root: string): void {
	const norm = path.resolve(root);
	cached.recentWorkspaces = getRecentWorkspaces().filter((p) => path.resolve(p) !== norm);
	if (cached.lastOpenedWorkspace && path.resolve(cached.lastOpenedWorkspace) === norm) {
		cached.lastOpenedWorkspace = cached.recentWorkspaces[0] ?? null;
	}
	save();
}

export function getRestorableWorkspace(): string | null {
	const p = cached.lastOpenedWorkspace;
	if (!p || typeof p !== 'string') {
		return null;
	}
	const norm = path.resolve(p);
	try {
		if (fs.existsSync(norm) && fs.statSync(norm).isDirectory()) {
			return norm;
		}
	} catch {
		/* ignore */
	}
	return null;
}

function save(): void {
	if (!settingsPath) {
		return;
	}
	fs.writeFileSync(settingsPath, JSON.stringify(cached, null, 2), 'utf8');
}

/** 获取 MCP 服务器配置 */
export function getMcpServerConfigs(): McpServerConfig[] {
	return cached.mcpServers ?? [];
}

/** 更新 MCP 服务器配置 */
export function patchMcpServerConfigs(servers: McpServerConfig[]): void {
	cached.mcpServers = servers;
	save();
}

/** 添加单个 MCP 服务器配置 */
export function addMcpServerConfig(config: McpServerConfig): void {
	const servers = getMcpServerConfigs();
	const existing = servers.findIndex((s) => s.id === config.id);
	if (existing >= 0) {
		servers[existing] = config;
	} else {
		servers.push(config);
	}
	cached.mcpServers = servers;
	save();
}

/** 删除单个 MCP 服务器配置 */
export function removeMcpServerConfig(id: string): void {
	cached.mcpServers = (cached.mcpServers ?? []).filter((s) => s.id !== id);
	save();
}
