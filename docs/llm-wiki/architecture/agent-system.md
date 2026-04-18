# Agent 系统

- 状态：已根据 `main-src/agent/`、`main-src/bots/botRuntime.ts`、`main-src/llm/modelResolve.ts`、`main-src/ipc/register.ts`、`main-src/workspaceAgentStore.ts` 校验。
- 主题：Composer 模式、模型解析、Agent 循环、工具执行、Team 模式、子 Agent、外部平台 Bot。

## 模式概览

当前项目至少存在四种高层模式：

- `Agent`：自主多轮工具循环。
- `Plan`：偏审阅和规划，工具受限。
- `Ask`：问答模式。
- `Debug`：排查/分析模式。

从 `agentLoop.ts` 的工具装配逻辑可以确认：不同模式会改变工具池和上下文扩展策略，不能把它们当成同一种请求。

## 模型解析链路

模型不是直接靠 UI 文案名发送，而是经过 `main-src/llm/modelResolve.ts`：

- 先从 `settings.models.entries` 找模型条目。
- 再从 `settings.models.providers` 找 provider。
- 再解析 provider 的 `apiKey`、`baseURL`、`proxyUrl`。
- 产出统一运行时请求参数：`requestModelId`、`paradigm`、`maxOutputTokens`、`contextWindowTokens` 等。

影响判断：

- “模型选中了但跑不起来”时，通常要同时看 entry 和 provider。
- `defaultModel` 只是选择器状态，不是最终请求参数本身。

## Agent 循环的核心职责

`main-src/agent/agentLoop.ts` 负责真正的多轮循环：

1. 组装消息和工具定义。
2. 对结构化 assistant/tool 消息做规范化、修复和 provider 适配。
3. 调用 LLM。
4. 若 LLM 产出工具调用，则执行工具并把结果补回消息。
5. 若只返回文本，则结束本轮。

它还处理这些关键细节：

- 工具参数流式增量下发，便于 UI 实时展示。
- Anthropic/OpenAI 工具配对修复。
- 连续错误上限和恢复交互。
- 工具审批等待。
- 最大轮次限制，来源可以是环境变量或设置项。
- 部分工具在流式阶段会跳过参数增量，以减少 UI 噪音。

## 工具执行层

`main-src/agent/toolExecutor.ts` 是工具真正落地的地方，负责：

- 文件读写、目录遍历、grep、glob
- Bash / shell 命令
- Git 相关能力
- Browser 工具
- MCP 工具调用
- LSP/符号相关操作
- Todo 状态
- 子 Agent 派发
- Agent / project / local 记忆目录

关键判断：

- “工具定义长什么样”看 `agentTools.ts`
- “工具实际怎么执行”看 `toolExecutor.ts`
- “工具何时允许执行”看审批闸门与权限模型

## Team 模式

`main-src/agent/teamOrchestrator.ts` 把单 Agent 扩展成多角色协作：

- 角色包括 lead、specialist、reviewer 等。
- 会发出更细粒度的 team 事件流。
- 支持计划提案、审批、修订、交付评审。
- Team 任务会写入线程快照。

因此 Team 模式不是单纯的 UI 包装，而是另一套编排层。

## 外部平台 Bot（Leader / worker）

桌面 Composer 之外，Slack / Discord / 飞书等会话由 `main-src/bots/botRuntime.ts` 接入同一套模型解析与工具执行栈：外层 **`runBotOrchestratorTurn`** 跑 Leader 工具循环（含会话级 `switch_workspace`、`run_async_task` 等），需要深度改仓库时再派发到内部的 `runAgentLoop` / `runTeamSession`，并复用 `threadStore`、工作区上下文扩展与文件索引。

细节与工具白名单语义见 [botRuntime.ts](../modules/bot-runtime.md)。

## 子 Agent 与记忆

子 Agent 相关事实分散在几个地方：

- `toolExecutor.ts`：`Agent` / `Task` 工具的派发和后台运行策略。
- `subagentProfile.ts`：子 Agent 配置与系统附加提示。
- `agentMemory.ts`：子 Agent 独立记忆目录，支持 `user` / `project` / `local` 三种范围。

记忆范围对应目录：

- `user` -> 用户数据目录下 `agent-memory/<agent>/`
- `project` -> `<workspace>/.async/agent-memory/<agent>/`
- `local` -> `<workspace>/.async/agent-memory-local/<agent>/`

## 工作区级 Agent 配置

`main-src/workspaceAgentStore.ts` 说明：

- 当前仓库可通过 `<workspace>/.async/agent.json` 注入项目级 `rules / skills / subagents`
- 它会与全局 `settings.agent` 合并
- 因而这是让 Agent “优先看哪份知识”的最佳项目级入口

## Agent 系统的权威入口

排查这类问题时建议顺序：

1. `main-src/ipc/register.ts`（通道名索引见 [IPC 通道地图](./ipc-channel-map.md)）
2. `main-src/llm/modelResolve.ts`
3. `main-src/agent/agentLoop.ts`
4. `main-src/agent/toolExecutor.ts`
5. 相关的 settings / workspace / memory 文件

## Primary Sources

- `main-src/agent/agentLoop.ts`
- `main-src/agent/toolExecutor.ts`
- `main-src/agent/teamOrchestrator.ts`
- `main-src/bots/botRuntime.ts`
- `main-src/llm/modelResolve.ts`
- `main-src/workspaceAgentStore.ts`
- `main-src/ipc/register.ts`

## 相关页面

- [运行时架构](./runtime-architecture.md)
- [IPC 通道地图](./ipc-channel-map.md)
- [状态与记忆](./state-and-memory.md)
- [工作区智能](./workspace-intelligence.md)
- [agentLoop.ts](../modules/agent-loop.md)
- [toolExecutor.ts](../modules/tool-executor.md)
- [teamOrchestrator.ts](../modules/team-orchestrator.md)
- [modelResolve.ts](../modules/model-resolve.md)
- [useTeamSession.ts](../modules/use-team-session.md)
- [botRuntime.ts](../modules/bot-runtime.md)

## 更新触发条件

- 新增/删除工具。
- 模型解析结构变化。
- Team 模式编排变化。
- 子 Agent 记忆范围或项目级 Agent 配置结构变化。
- Bot Leader/worker 分工、会话工具或线程映射策略变化。
