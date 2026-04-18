# botRuntime.ts

- 模块：`main-src/bots/botRuntime.ts`
- 状态：已根据当前源码校验。
- 主题：Slack/Discord/飞书等外部会话如何复用 Async 的模型解析、Agent 循环、Team、线程存储与工作区上下文，以及 Leader Bot 特有的会话工具与浏览器宿主选择。

## 一句话职责

`botRuntime.ts` 是 **主进程侧** 的 bot 编排核心：为每个外部 `conversationKey` 维护 `BotSessionState`，用 **`runBotOrchestratorTurn`** 跑一层「全局 Leader」工具循环，并在用户需要深度改代码时再 **`run_async_task`** 派发到内部 `runAgentLoop` / `runTeamSession` worker，与桌面端共用 `threadStore`、`modelResolve`、`workspaceContextExpand` 等基础设施。

## 与其它模块的关系

- **模型**：`resolveModelRequest`、`resolveThinkingLevelForSelection`；Bot 路径要求可选用工具调用的范式，**不接受纯 Gemini 范式**（源码在 orchestrator 入口显式校验）。
- **Agent / Team**：`runAgentLoop`、`runTeamSession`；worker 侧与 Composer 同源逻辑。
- **线程**：`createThread`、`appendMessage`、`getThread`、`saveTeamSession` 等，按 `session.workspaceRoot` 与模式映射到 `threadIdsByWorkspace`。
- **上下文**：`buildWorkspaceTreeSummary`、`cloneMessagesWithExpandedLastUser`、`modeExpandsWorkspaceFileContext`；记忆与 Git 块通过 `appendMemoryAndRetrievalContext` 等与桌面 Agent 类似的策略注入。
- **索引 / LSP**：`ensureWorkspaceFileIndex`；`createBotWorkspaceLspManager` 为 bot worker 提供 `WorkspaceLspManager` 实例。
- **设置合并**：`mergeAgentWithProjectSlice`、`readWorkspaceAgentProjectSlice`、`mergeAgentWithPluginRuntime`，与桌面一致地把项目级 Agent 与插件运行时拼进上下文。

## `BotSessionState` 要点

- `integrationId`、`conversationKey`、`workspaceRoot`、`modelId`、`mode`（`BotComposerMode`）。
- `threadIdsByWorkspace`：按工作区键缓存内部 worker 线程 id。
- `leaderMessages`：Leader 轮次自己的消息历史（可与 worker 线程分离）。
- `browserHostWebContentsId` / `pendingQrLogin`：把内置浏览器操作绑定到**仍存活的** `webContents`；必要时回退到前台窗口或 **无头 `BrowserWindow`**（`getOrCreateHeadlessBotWindow`）。

## Leader 专用工具 `BOT_TOOL_DEFS`

包括但不限于：`get_async_session`、`switch_workspace`、`switch_model`、`new_async_thread`、`run_async_task`、`send_local_attachment`、`pause_for_qr_login`。  
`run_async_task` 内部走 `runBotAsyncTask`，可按参数覆盖 `agent` / `ask` / `plan` / `team` 并可选强制新线程。

与完整 `AGENT_TOOLS` 叠加时，Leader 侧对一部分原生工具名（如 `Read`、`Grep`、`Browser`）有白名单式的使用策略，系统提示 `buildBotOrchestratorPrompt` 中说明了「默认优先 Leader 直接答，仅在写改、shell、长链路时再派 worker」的产品语义。

## 辅助导出

- `getAvailableBotModels`：从 `ShellSettings` 过滤出 OpenAI-compatible / Anthropic 且（若配置了）enabled 的条目。
- `createInitialBotSession`：解析默认模型、默认工作区（与集成配置里可用根目录列表求交）。
- `looksLikeQrLoginConfirmation` / `looksLikeQrLoginScreenshotResendRequest` / `buildQrLoginResumeUserTurn`：二维码登录暂停流的用户回复识别与续聊拼装。
- `createBotWorkspaceLspManager`：给 bot 管道注入与桌面类似的 LSP 生命周期。

## 修改这个文件时要一起看

- `main-src/bots/platforms/*` 与各平台 inbound 适配
- `main-src/ipc/register.ts` 中触发 bot 的 IPC
- [agentLoop.ts](./agent-loop.md)、[teamOrchestrator.ts](./team-orchestrator.md)、[toolExecutor.ts](./tool-executor.md)
- [threadStore.ts](./thread-store.md)、[workspaceContextExpand.ts](./workspace-context-expand.md)

## Primary Sources

- `main-src/bots/botRuntime.ts`
- `main-src/bots/platforms/common.ts`（类型与流通道）
- `main-src/botSettingsTypes.ts`

## 相关页面

- [Agent 系统](../architecture/agent-system.md)
- [运行时架构](../architecture/runtime-architecture.md)
- [状态与记忆](../architecture/state-and-memory.md)

## 更新触发条件

- 新增 bot 平台或 inbound 附件语义变化。
- Leader / worker 分工、工具白名单或 `BOT_TOOL_DEFS` 契约变化。
- 浏览器宿主选择、二维码登录流程或线程映射策略变化。
