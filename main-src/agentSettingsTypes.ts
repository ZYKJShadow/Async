/** 与渲染端 `src/agentSettingsTypes.ts` 保持字段一致 */

export type AgentItemOrigin = 'user' | 'project';
export type AgentMemoryScope = 'user' | 'project' | 'local';

export type AgentRuleScope = 'always' | 'glob' | 'manual';

export type AgentRule = {
	id: string;
	name: string;
	content: string;
	scope: AgentRuleScope;
	globPattern?: string;
	enabled: boolean;
	/** user = 全局设置；project = 当前仓库 `.async/agent.json` */
	origin?: AgentItemOrigin;
};

export type AgentSkill = {
	id: string;
	name: string;
	description: string;
	slug: string;
	content: string;
	enabled?: boolean;
	origin?: AgentItemOrigin;
	/** 工作区内 SKILL.md 相对路径（正斜杠）；磁盘扫描时写入 */
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
	/** 斜杠菜单与命令列表说明（可选） */
	description?: string;
	slash: string;
	body: string;
};

/** 与 Claude Code `PermissionBehavior` 一致 */
export type ToolPermissionBehavior = 'allow' | 'deny' | 'ask';

/**
 * 单条工具权限规则；`ruleContent` 为空表示匹配该工具的全部调用。
 * Bash：可用 minimatch（含 `*`）或「命令前缀 + 空格」；Write/Edit：相对路径 minimatch。
 */
export type AgentToolPermissionRule = {
	id?: string;
	behavior: ToolPermissionBehavior;
	toolName: string;
	ruleContent?: string;
};

/**
 * 后台记忆抽取阈值（对齐 Claude Code SessionMemory 的「首次 / 间隔 / 工具调用」思想，度量简化）。
 */
export type AgentMemoryExtractionSettings = {
	enabled?: boolean;
	/** 首次抽取前，线程内至少需要的非 system 消息条数（默认 4） */
	minNonSystemMessagesBeforeFirst?: number;
	/** 距上次抽取光标后，新增非 system 消息条数下限（默认 3） */
	minNonSystemMessagesBetween?: number;
	/** 自上次抽取基线以来完成的 Agent 工具调用次数下限（默认 3） */
	minToolCallsBetween?: number;
};

export type ShellPermissionMode = 'always' | 'rules' | 'ask_every_time';

export type AgentCustomization = {
	importThirdPartyConfigs?: boolean;
	rules?: AgentRule[];
	skills?: AgentSkill[];
	subagents?: AgentSubagent[];
	commands?: AgentCommand[];
	/**
	 * Bash 三档策略（与 `confirmShellCommands` / `skipSafeShellCommandsConfirm` 一并持久化）。
	 */
	shellPermissionMode?: ShellPermissionMode;
	/**
	 * 是否在执行 **Bash** 前弹出确认（默认 true）。
	 * 设为 false 时命令将直接执行（仍有工作区目录限制）。
	 */
	confirmShellCommands?: boolean;
	/**
	 * 是否在 `Write` / `Edit`（及旧工具名）写入前暂停等待确认（默认 false，依赖事后撤销）。
	 */
	confirmWritesBeforeExecute?: boolean;
	/**
	 * 对常见只读/低风险命令跳过确认（默认 true），如 `git status`、`npm test`。
	 */
	skipSafeShellCommandsConfirm?: boolean;
	/**
	 * 连续多少次工具失败（含用户拒绝执行）后暂停并询问用户（默认 5）。
	 */
	maxConsecutiveMistakes?: number;
	/**
	 * 是否启用「连续失败暂停」交互（默认 true）。
	 */
	mistakeLimitEnabled?: boolean;
	/**
	 * 对齐 Claude Code `FORK_SUBAGENT`：开启后，调用 Agent 时**省略** `subagent_type` 则子 Agent 在后台运行，
	 * 工具立即返回占位说明，过程通过嵌套流展示，结束时前端提示。也可用参数 `run_in_background: true` 强制后台。
	 * 环境变量 `ASYNC_AGENT_BACKGROUND_FORK=1` 等同开启。
	 */
	backgroundForkAgent?: boolean;
	/**
	 * 单轮流式「无新 chunk」最长等待（毫秒）。大文件工具 JSON 可能长时间无 SSE。
	 * 环境变量 `ASYNC_AGENT_STREAM_IDLE_MS` 优先。
	 */
	streamIdleTimeoutMs?: number;
	/**
	 * 是否启用「无 chunk 静默」中止（默认 true）。为 false 时仅依赖 roundHardTimeoutMs。
	 * 环境变量 `ASYNC_AGENT_STREAM_WATCHDOG`（0/false/off 关闭）优先。
	 */
	streamIdleWatchdogEnabled?: boolean;
	/**
	 * 单轮 LLM 调用总时长上限（毫秒）；须 ≥ streamIdleTimeoutMs。
	 * 环境变量 `ASYNC_AGENT_ROUND_HARD_MS` 优先。
	 */
	roundHardTimeoutMs?: number;
	/**
	 * Agent 工具循环最大轮次（每轮 = 一次 LLM + 工具执行）。未设置且环境变量未指定时**不限制**（与 Claude Code `maxTurns` 可选语义一致）。
	 * 环境变量 `ASYNC_AGENT_MAX_ROUNDS` 优先；设为 `0` / `unlimited` / `off` 表示不限制。
	 */
	maxToolRounds?: number;
	/**
	 * 细粒度工具权限（deny > ask > allow）；未匹配规则时走 `confirmShellCommands` 等默认行为。
	 */
	toolPermissionRules?: AgentToolPermissionRule[];
	/**
	 * 无法展示确认 UI 时（如纯后台子 Agent），将本应为询问的规则视为拒绝。
	 */
	shouldAvoidPermissionPrompts?: boolean;
	/** 控制何时触发 `.async/memory` 后台抽取，减少每轮都调用模型 */
	memoryExtraction?: AgentMemoryExtractionSettings;
};
