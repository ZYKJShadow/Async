# toolApprovalGate.ts & mistakeLimitGate.ts

- 模块：`main-src/agent/toolApprovalGate.ts`、`main-src/agent/mistakeLimitGate.ts`
- 状态：已根据当前源码校验。
- 主题：Agent 工具执行前的审批门控，以及连续工具失败后的暂停恢复机制。

## 一句话职责

`toolApprovalGate.ts` 决定「这个工具调用是否可以直接执行，还是需要弹窗问用户」；`mistakeLimitGate.ts` 决定「连续失败多少次后暂停 Agent，等用户选择继续、补充说明还是停止」。

## 工具审批门控（toolApprovalGate）

### 审批流程

1. 先查用户/项目级的权限规则（`toolPermissionModel.ts`）：
   - `deny` → 直接拒绝，返回 `rejectionMessage`
   - `allow` → 进入下一步
2. 对 `Bash` 工具额外检查 Shell 权限模式：
   - `always` → 永远自动通过
   - `ask_every_time` → 永远弹窗确认
   - `rules` → 结合安全命令白名单判断

### 安全命令白名单

当 Shell 模式为 `rules` 且用户未关闭 `skipSafeShellCommandsConfirm` 时，以下命令可自动通过：

- `git status|diff|log|branch|show|remote -v`
- `npm|pnpm|yarn|bun test|run test|run lint|run build|version`
- `npx|pnpm dlx eslint`

### 审批交互

需要确认时，主进程通过 `agent:toolApprovalRespond` 通道向 UI 发送审批请求，UI 展示 `ToolApprovalCard.tsx`；用户决策后通过同一通道回传，主进程 `resolveToolApproval()` 解除等待。

## 连续错误恢复（mistakeLimit）

### 触发条件

Agent 循环内统计连续工具失败次数，超过阈值（默认来自环境或设置）时触发。

### 用户选项

UI 通过 `AgentMistakeLimitDialog.tsx` 展示三种选择：

- **继续** —— 重置失败计数，Agent 继续执行
- **补充说明** —— 用户输入额外提示，Agent 在下轮使用
- **停止** —— 终止当前 Agent 会话

### 主进程侧

`createMistakeLimitReachedHandler()` 返回一个异步函数，内部用 Promise + waiters Map 挂起 Agent 循环，直到用户决策或 abort 信号触发。

## 与 Agent 循环的关系

- `agentLoop.ts` 在每次工具调用前执行 `beforeExecuteTool`（即 `toolApprovalGate` 生成的函数）。
- `agentLoop.ts` 在工具执行失败后检查连续失败次数，决定是否进入 `mistakeLimit` 暂停。
- 两者都通过 `send()` 回调向 UI 推送事件，并通过 `waiters` Map 等待用户响应。

## 修改这个文件时要一起看

- `main-src/agent/agentLoop.ts`（调用方）
- `main-src/agent/toolPermissionModel.ts`（权限规则解析）
- `src/ToolApprovalCard.tsx`（审批 UI）
- `src/AgentMistakeLimitDialog.tsx`（错误恢复 UI）
- `main-src/ipc/register.ts` 中 `agent:toolApprovalRespond` / `agent:mistakeLimitRespond`

## Primary Sources

- `main-src/agent/toolApprovalGate.ts`
- `main-src/agent/mistakeLimitGate.ts`
- `main-src/agent/toolPermissionModel.ts`
- `main-src/agent/agentLoop.ts`

## 相关页面

- [Agent 系统](../architecture/agent-system.md)
- [agentLoop.ts](./agent-loop.md)
- [toolExecutor.ts](./tool-executor.md)

## 更新触发条件

- 安全命令白名单增减。
- 权限规则语义变化（`allow` / `deny` / `ask`）。
- 连续错误阈值来源或默认值变化。
- 恢复交互选项变化（如新增 "回滚上一回合"）。
