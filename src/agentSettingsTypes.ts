/** 与主进程 `settingsStore` 中 `agent` 字段结构一致（供设置 UI 使用） */

export type AgentRuleScope = 'always' | 'glob' | 'manual';

export type AgentRule = {
	id: string;
	name: string;
	content: string;
	scope: AgentRuleScope;
	/** scope === 'glob' 时：相对路径 glob（如 ** / *.ts，无空格） */
	globPattern?: string;
	enabled: boolean;
};

export type AgentSkill = {
	id: string;
	name: string;
	description: string;
	/** 对话里以「点斜杠 + slug」触发，slug 不含前缀 */
	slug: string;
	content: string;
	enabled?: boolean;
};

export type AgentSubagent = {
	id: string;
	name: string;
	description: string;
	instructions: string;
	enabled?: boolean;
};

export type AgentCommand = {
	id: string;
	name: string;
	/** 不含 /，如 plan 匹配消息开头的 `/plan` */
	slash: string;
	/** 可用 {{args}} 表示去掉 /slash 后的正文 */
	body: string;
};

export type AgentCustomization = {
	/** 从工作区 `.cursor/rules` 等目录导入规则文本 */
	importThirdPartyConfigs?: boolean;
	rules?: AgentRule[];
	skills?: AgentSkill[];
	subagents?: AgentSubagent[];
	commands?: AgentCommand[];
	/** execute_command 执行前确认，默认 true */
	confirmShellCommands?: boolean;
	/** 写入文件前确认，默认 false */
	confirmWritesBeforeExecute?: boolean;
	/** 低风险 shell 命令跳过确认，默认 true */
	skipSafeShellCommandsConfirm?: boolean;
	/** 连续工具失败多少次后暂停询问（默认 5） */
	maxConsecutiveMistakes?: number;
	/** 是否启用连续失败暂停，默认 true */
	mistakeLimitEnabled?: boolean;
	/** 无新 chunk 最长等待（ms），见主进程 agentSettingsTypes */
	streamIdleTimeoutMs?: number;
	/** 是否启用静默 watchdog，默认 true */
	streamIdleWatchdogEnabled?: boolean;
	/** 单轮硬超时（ms） */
	roundHardTimeoutMs?: number;
};

export const defaultAgentCustomization = (): AgentCustomization => ({
	importThirdPartyConfigs: false,
	rules: [],
	skills: [],
	subagents: [],
	commands: [],
	maxConsecutiveMistakes: 5,
	mistakeLimitEnabled: true,
});
