/** 与主进程 `settingsStore` 中 `agent` 字段结构一致（供设置 UI 使用） */

export type AgentItemOrigin = 'user' | 'project';
export type AgentMemoryScope = 'user' | 'project' | 'local';

export type AgentRuleScope = 'always' | 'glob' | 'manual';

export type AgentRule = {
	id: string;
	name: string;
	content: string;
	scope: AgentRuleScope;
	/** scope === 'glob' 时：相对路径 glob（如 ** / *.ts，无空格） */
	globPattern?: string;
	enabled: boolean;
	/** user = 所有项目；project = 当前仓库 */
	origin?: AgentItemOrigin;
};

export type AgentSkill = {
	id: string;
	name: string;
	description: string;
	/** 技能标识；也可配合仓库 `.async/skills/<slug>/SKILL.md` */
	slug: string;
	content: string;
	enabled?: boolean;
	origin?: AgentItemOrigin;
	/** 工作区内 SKILL.md 相对路径（正斜杠）；由磁盘扫描填充，用于打开文件与删除目录 */
	skillSourceRelPath?: string;
};

export type AgentSubagent = {
	id: string;
	name: string;
	description: string;
	instructions: string;
	memoryScope?: AgentMemoryScope;
	enabled?: boolean;
	origin?: AgentItemOrigin;
};

export type AgentCommand = {
	id: string;
	name: string;
	/** 展示在斜杠菜单与命令列表中；可选 */
	description?: string;
	/** 不含 /，如 plan 匹配消息开头的 `/plan` */
	slash: string;
	/** 可用 {{args}} 表示去掉 /slash 后的正文 */
	body: string;
};

/** 与 Claude Code `PermissionBehavior` 一致 */
export type ToolPermissionBehavior = 'allow' | 'deny' | 'ask';

export type AgentToolPermissionRule = {
	/** 列表编辑用稳定 id；旧配置可省略，加载时会补全 */
	id?: string;
	behavior: ToolPermissionBehavior;
	toolName: string;
	ruleContent?: string;
};

export type AgentMemoryExtractionSettings = {
	enabled?: boolean;
	minNonSystemMessagesBeforeFirst?: number;
	minNonSystemMessagesBetween?: number;
	minToolCallsBetween?: number;
};

/** Bash 执行权限三档（与 Composer 下拉、设置页一致） */
export type ShellPermissionMode = 'always' | 'rules' | 'ask_every_time';

export type AgentCustomization = {
	/** 从工作区 `.async/rules`、`.cursor/rules` 等目录导入规则文本 */
	importThirdPartyConfigs?: boolean;
	rules?: AgentRule[];
	skills?: AgentSkill[];
	subagents?: AgentSubagent[];
	commands?: AgentCommand[];
	/**
	 * Bash 执行策略三档（与 `confirmShellCommands` / `skipSafeShellCommandsConfirm` 同步持久化，便于推断旧配置）。
	 * - always：直接执行（deny 规则仍拦截）
	 * - rules：`toolPermissionRules` 命中 allow 则放行；否则低风险白名单可放行；其余弹窗
	 * - ask_every_time：除 deny 外一律弹窗（allow 规则也不跳过确认）
	 */
	shellPermissionMode?: ShellPermissionMode;
	/** Bash 执行前确认，默认 true */
	confirmShellCommands?: boolean;
	/** 写入文件前确认，默认 false */
	confirmWritesBeforeExecute?: boolean;
	/** 低风险 shell 命令跳过确认，默认 true */
	skipSafeShellCommandsConfirm?: boolean;
	/** 连续工具失败多少次后暂停询问（默认 5） */
	maxConsecutiveMistakes?: number;
	/** 是否启用连续失败暂停，默认 true */
	mistakeLimitEnabled?: boolean;
	/** 省略 subagent_type 时 Agent 后台运行（对齐 Claude Code fork），默认 false */
	backgroundForkAgent?: boolean;
	/** 无新 chunk 最长等待（ms），见主进程 agentSettingsTypes */
	streamIdleTimeoutMs?: number;
	/** 是否启用静默 watchdog，默认 true */
	streamIdleWatchdogEnabled?: boolean;
	/** 单轮硬超时（ms） */
	roundHardTimeoutMs?: number;
	/** Agent 最大工具轮次；未设则不限制 */
	maxToolRounds?: number;
	toolPermissionRules?: AgentToolPermissionRule[];
	shouldAvoidPermissionPrompts?: boolean;
	memoryExtraction?: AgentMemoryExtractionSettings;
};

export const defaultAgentCustomization = (): AgentCustomization => ({
	importThirdPartyConfigs: true,
	rules: [],
	skills: [],
	subagents: [],
	commands: [],
	maxConsecutiveMistakes: 5,
	mistakeLimitEnabled: true,
	backgroundForkAgent: false,
	toolPermissionRules: [],
	shouldAvoidPermissionPrompts: false,
});

/** 主进程从 `.claude` / `.cursor` / `.async` 的 skills 目录扫描出的项，id 形如 `ws-skill-*`；不应写入 settings 或 `.async/agent.json`。 */
export function isWorkspaceDiskImportedSkill(s: { id: string }): boolean {
	return s.id.startsWith('ws-skill-');
}

/** 与主进程 `agentMessagePrep` 一致：按 slug 合并，后出现的覆盖先前的。 */
export function mergeSkillsBySlug(settingsSkills: AgentSkill[], workspaceSkills: AgentSkill[]): AgentSkill[] {
	const map = new Map<string, AgentSkill>();
	for (const s of settingsSkills) {
		if (s.slug?.trim()) {
			map.set(s.slug.trim().toLowerCase(), s);
		}
	}
	for (const w of workspaceSkills) {
		map.set(w.slug.trim().toLowerCase(), w);
	}
	return [...map.values()];
}
