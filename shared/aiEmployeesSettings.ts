/**
 * AI 员工窗口持久化设置（与 settings.json 中 `aiEmployees` 键一致）。
 * 主进程与渲染层共用此单一类型源；修改字段时请同步 patchSettings 合并逻辑。
 */

/** 外部聊天账号桥接（凭证由未来 bridge 服务管理，此处仅存展示与映射） */
export type AiEmployeeChatAccountRef = {
	provider: 'feishu' | 'telegram' | 'discord';
	/** 展示用标识：用户名、群 id、bot id 等 */
	handle: string;
	note?: string;
};

/** 本地员工目录条目（可与远端 agent 关联） */
export type AiEmployeeCatalogEntry = {
	/** 稳定 id（本地生成） */
	id: string;
	displayName: string;
	/** 职能标签，如 后端工程师 / 测试 / 产品 */
	role: string;
	description?: string;
	modelSource: 'local_model' | 'remote_runtime' | 'hybrid';
	linkedRemoteAgentId?: string;
	managerEmployeeId?: string;
	capabilities?: string[];
	chatAccounts?: AiEmployeeChatAccountRef[];
};

export type AiOrchestrationHandoffStatus = 'pending' | 'in_progress' | 'blocked' | 'done';

/** 编排交接步骤 */
export type AiOrchestrationHandoff = {
	id: string;
	fromEmployeeId?: string;
	toEmployeeId: string;
	status: AiOrchestrationHandoffStatus;
	note?: string;
	atIso: string;
};

export type AiOrchestrationRunStatus =
	| 'draft'
	| 'running'
	| 'awaiting_approval'
	| 'completed'
	| 'cancelled';

/** 一次从目标到落地的编排运行（CEO/产品总监视角） */
export type AiOrchestrationRun = {
	id: string;
	goal: string;
	/** 计划统一提交到的远端分支名 */
	targetBranch?: string;
	status: AiOrchestrationRunStatus;
	createdAtIso: string;
	handoffs: AiOrchestrationHandoff[];
	/** 是否已通过「统一 git 提交」审批闸 */
	gitApproved?: boolean;
};

export type AiEmployeesOrchestrationState = {
	activeRunId?: string;
	runs: AiOrchestrationRun[];
};

export type AiEmployeesSettings = {
	/** REST API 根，如 http://127.0.0.1:8080 */
	apiBaseUrl?: string;
	/** WebSocket 根路径，如 ws://127.0.0.1:8080/ws */
	wsBaseUrl?: string;
	/** Personal access token 或开发用 Bearer */
	token?: string;
	/** 本地工作区绝对路径 → 远端 workspace UUID */
	workspaceMap?: Record<string, string>;
	/** 上次选中的远端 workspace id */
	lastRemoteWorkspaceId?: string;
	/** 远端 agent id → 本地 models.entries 的 id */
		agentLocalModelIdByRemoteAgentId?: Record<string, string>;
		employeeLocalModelIdByEmployeeId?: Record<string, string>;
	/** 员工目录（角色、昵称、模型来源、聊天账号等） */
	employeeCatalog?: AiEmployeeCatalogEntry[];
	/** 任务编排与审批状态 */
	orchestration?: AiEmployeesOrchestrationState;
};
