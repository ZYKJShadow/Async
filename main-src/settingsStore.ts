import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentCustomization } from './agentSettingsTypes.js';
import type { McpServerConfig } from './mcp/mcpTypes.js';
import { resolveAsyncDataDir } from './dataDir.js';
import { normalizeThinkingLevel, type ThinkingLevel } from './llm/thinkingLevel.js';
export type { ThinkingLevel } from './llm/thinkingLevel.js';
export type { AgentCustomization, AgentRule, AgentSkill, AgentSubagent, AgentCommand } from './agentSettingsTypes.js';
export type { McpServerConfig } from './mcp/mcpTypes.js';

/** 单条用户模型实际请求时使用的协议（与适配器一致） */
export type ModelRequestParadigm = 'openai-compatible' | 'anthropic' | 'gemini';

export type UserModelEntry = {
	/** 稳定 id，用于设置与选择器 */
	id: string;
	/** 界面显示名称 */
	displayName: string;
	/** 发给 API 的模型名 */
	requestName: string;
	paradigm: ModelRequestParadigm;
	/**
	 * 单次补全最大输出 token 上限（各范式各自映射到 API 参数）。
	 * 未设置时在解析层使用默认（当前为 16384）；若网关上限更低请在模型高级选项中调小。
	 */
	maxOutputTokens?: number;
	/** 为 true 时本条使用 customBaseURL / customApiKey，否则用全局对应范式的密钥与地址 */
	useCustomConnection?: boolean;
	customBaseURL?: string;
	customApiKey?: string;
};

export type LLMProviderId = ModelRequestParadigm;

/** 主界面左右侧栏宽度（桌面端持久化，避免 file:// localStorage 因路径变化丢失） */
export type SidebarLayoutPx = { left: number; right: number };

export type ShellUiSettings = {
	sidebarLayout?: SidebarLayoutPx;
};

/** 工作区索引与语言服务（未设置字段视为开启，与旧 settings.json 兼容） */
export type ShellIndexingSettings = {
	/** 导出符号索引：Quick Open @、search_files(symbol) */
	symbolIndexEnabled?: boolean;
	/** 本地 TF-IDF 语义块：构建索引并注入 Agent/Plan/Debug 对话上下文 */
	semanticIndexEnabled?: boolean;
	/** TypeScript/JavaScript 语言服务（跳转定义等） */
	tsLspEnabled?: boolean;
	/** 在 Agent/Plan/Debug 对话中注入当前 git 分支、状态和最近提交摘要 */
	gitContextEnabled?: boolean;
};

const INDEXING_DEFAULTS: Required<ShellIndexingSettings> = {
	symbolIndexEnabled: true,
	semanticIndexEnabled: true,
	tsLspEnabled: true,
	gitContextEnabled: true,
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
	/** 当前选择：`auto` 或某条用户模型的 id */
	defaultModel?: string;
	/**
	 * @deprecated 已由 `models.thinkingByModelId` 按模型区分；读入时仅用于一次性迁移到各 id。
	 */
	thinkingLevel?: ThinkingLevel;
	models?: {
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
	/** 索引与 LSP */
	indexing?: ShellIndexingSettings;
	/** MCP 服务器配置 */
	mcpServers?: McpServerConfig[];
};

const defaultSettings: ShellSettings = {
	language: 'zh-CN',
	defaultModel: 'auto',
	thinkingLevel: 'medium',
	recentWorkspaces: [],
	lastOpenedWorkspace: null,
};

const MAX_RECENTS = 24;

let cached: ShellSettings = { ...defaultSettings };
let settingsPath = '';

/** 保证每个选择器 id 在 thinkingByModelId 中有条目；无历史 map 时用旧版全局 thinkingLevel 或 medium 填充。 */
function migrateThinkingByModel(settings: ShellSettings): { next: ShellSettings; didMutate: boolean } {
	const entries = settings.models?.entries ?? [];
	const enabledIds = settings.models?.enabledIds ?? [];
	const ids = new Set<string>(['auto']);
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

export function initSettingsStore(userData: string): void {
	const dir = resolveAsyncDataDir(userData);
	fs.mkdirSync(dir, { recursive: true });
	settingsPath = path.join(dir, 'settings.json');
	if (fs.existsSync(settingsPath)) {
		try {
			const raw = fs.readFileSync(settingsPath, 'utf8');
			cached = { ...defaultSettings, ...JSON.parse(raw) };
		} catch {
			cached = { ...defaultSettings };
		}
	} else {
		cached = { ...defaultSettings };
	}
	const migrated = migrateThinkingByModel(cached);
	cached = migrated.next;
	if (migrated.didMutate) {
		save();
	} else if (!fs.existsSync(settingsPath)) {
		save();
	}
}

export function getSettings(): ShellSettings {
	return { ...cached };
}

export function patchSettings(partial: Partial<ShellSettings>): ShellSettings {
	const { ui: partialUi, indexing: partialIndexing, ...partialRest } = partial;

	const mergedIndexing =
		partialIndexing !== undefined
			? { ...INDEXING_DEFAULTS, ...(cached.indexing ?? {}), ...partialIndexing }
			: cached.indexing;

	const nextModels =
		partial.models !== undefined
			? {
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
					importThirdPartyConfigs:
						partial.agent.importThirdPartyConfigs ?? cached.agent?.importThirdPartyConfigs ?? false,
					rules: partial.agent.rules ?? cached.agent?.rules ?? [],
					skills: partial.agent.skills ?? cached.agent?.skills ?? [],
					subagents: partial.agent.subagents ?? cached.agent?.subagents ?? [],
					commands: partial.agent.commands ?? cached.agent?.commands ?? [],
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
				}
			: cached.agent;

	const mergedUi =
		partialUi !== undefined ? { ...(cached.ui ?? {}), ...partialUi } : cached.ui;

	cached = {
		...cached,
		...partialRest,
		llm: partial.llm ? { ...(cached.llm ?? {}), ...partial.llm } : cached.llm,
		openAI: partial.openAI ? { ...cached.openAI, ...partial.openAI } : cached.openAI,
		anthropic: partial.anthropic ? { ...(cached.anthropic ?? {}), ...partial.anthropic } : cached.anthropic,
		gemini: partial.gemini ? { ...(cached.gemini ?? {}), ...partial.gemini } : cached.gemini,
		models: nextModels,
		agent: nextAgent,
		ui: mergedUi,
		indexing: partialIndexing !== undefined ? mergedIndexing : cached.indexing,
	};
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
