/**
 * AI 员工会话阶段：连接校验 → 工作区列表与数据拉取 → 子视图绑定当前 workspace id。
 * Async 侧「登录」等价于可连通的 API + Bearer。
 */
export type AiEmployeesSessionPhase =
	| 'bootstrapping'
	| 'need_connection'
	| 'no_workspace'
	| 'onboarding'
	| 'ready';

export type LocalModelEntry = { id: string; displayName: string };
