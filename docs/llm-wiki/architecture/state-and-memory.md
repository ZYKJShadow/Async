# 状态与记忆

- 状态：已根据 `threadStore.ts`、`settingsStore.ts`、`workspaceAgentStore.ts`、`ipc/register.ts`、`memdir/*`、`extractMemories.ts`、`workspaceUsageStats.ts` 校验。
- 主题：Async 把什么状态存在哪里，以及 `docs Wiki`、`.async/memory`、线程/计划之间的关系。

## 持久化版图

### 1. 全局用户数据目录

由 `resolveAsyncDataDir(userData)` 统一解析到 `userData/async/`：

- `settings.json`
- `threads.json`

这里是全局设置与线程主存储的权威位置。

### 2. 工作区目录下的 `.async/`

当前仓库会额外持有这些工作区级数据：

- `.async/agent.json`：项目级 Agent rules / skills / subagents
- `.async/plans/*.md`：当工作区已打开时，Plan 文档优先写到这里
- `.async/memory/`：项目级持久记忆
- `.async/agent-memory/`：项目级子 Agent 记忆
- `.async/agent-memory-local/`：本机局部子 Agent 记忆
- `.async/index/`：运行时索引产物

### 3. 其他位置

- `localStorage`：renderer 的轻量 UI 状态
- 用户指定目录下 `usage-stats.json`：使用统计

## `settings.json`

`main-src/settingsStore.ts` 持久化的内容很广，包括：

- 语言
- 模型 providers / entries / enabledIds / thinkingByModelId
- 默认模型
- recentWorkspaces / lastOpenedWorkspace
- Agent 自定义项
- UI 主题与布局
- MCP 服务器
- usage stats 配置
- auto update 配置
- Team 设置
- bot 集成

结论：设置页只是入口，真正的模型、Agent、Team、bot 持久化都在这里汇总。

## `threads.json`

`main-src/threadStore.ts` 里的线程模型比 README 描述更丰富：

- 消息列表
- token usage
- 文件状态
- 摘要
- 记忆抽取进度
- Agent 工具调用计数
- 结构化 plan
- 已执行 plan key
- Team session 快照

另外它已经从“单全局列表”演进为“按工作区分桶”的结构。

## Plan 的双重持久化

Plan 目前至少有两层存储：

- Markdown 文档：`ipc register -> plan:save`
  - 有工作区时写到 `<workspace>/.async/plans/`
  - 无工作区时回退到 `userData/.async/plans/`
- 结构化 plan：`threads.json` 的 `thread.plan`

这意味着：

- 只看 README 里“`.async/plans/`”的描述不够完整。
- 做 Plan 相关改动时，要区分“给人看的 Markdown 文档”和“线程内结构化状态”。
- 渲染层如何把流式输出、消息历史与上述双写串起来，见 [usePlanSystem.ts](../modules/use-plan-system.md)。

## 项目级 Agent 配置

`workspaceAgentStore.ts` 负责 `<workspace>/.async/agent.json`：

- 它只存项目级 rules / skills / subagents
- 读出来后与用户全局 `settings.agent` 合并
- 这是把“仓库内的知识入口规则”注入给 Agent 的关键位置
- 但当前仓库的 `.gitignore` 默认忽略整个 `.async/`，所以这类配置默认是本机本仓库有效，而不是天然团队共享

## 项目级记忆：`.async/memory/`

`main-src/memdir/` 负责这套记忆系统：

- 入口文件固定为 `MEMORY.md`
- `MEMORY.md` 是索引，不是长文档本体
- 主题记忆分散在不同 `.md` 文件中，并带 frontmatter
- 加载时会限制 `MEMORY.md` 的最大行数和字节数

`extractMemories.ts` 会基于最近对话，调用模型生成新的记忆草稿并回写到 `.async/memory/`。

## 子 Agent 记忆

`agentMemory.ts` 说明子 Agent 还有独立记忆空间，按作用域分成：

- user
- project
- local

它们与项目级 `.async/memory/` 不同，不应混为一类。

## 运行时记忆 vs `docs/llm-wiki`

这次新增的 `docs/llm-wiki/` 应被视为：

- 更稳定
- 更可审阅
- 更适合放架构、事实、冲突、维护规则

而 `.async/memory/` 更适合：

- 给对话快速注入短记忆
- 记录可复用但不一定足够结构化的持久信息

建议规则：

- 结构化、长期有效、需要交叉链接的知识放 `docs/llm-wiki/`
- 对话上下文导向、短索引型记忆放 `.async/memory/`

## 使用统计

`workspaceUsageStats.ts` 说明：

- 使用统计默认不是按工作区分片
- 数据写到用户指定目录下单个 `usage-stats.json`
- 会保留 agent 行改动统计和 token 事件

## Primary Sources

- `main-src/settingsStore.ts`
- `main-src/threadStore.ts`
- `main-src/workspaceAgentStore.ts`
- `main-src/ipc/register.ts`
- `main-src/memdir/memdir.ts`
- `main-src/services/extractMemories/extractMemories.ts`
- `main-src/agent/agentMemory.ts`
- `main-src/workspaceUsageStats.ts`

## 相关页面

- [Agent 系统](./agent-system.md)
- [运行时架构](./runtime-architecture.md)
- [矛盾与待确认项](../meta/contradictions-and-open-questions.md)
- [threadStore.ts](../modules/thread-store.md)
- [settingsStore.ts](../modules/settings-store.md)
- [useSettings.ts](../modules/use-settings.md)
- [useStreamingChat.ts](../modules/use-streaming-chat.md)

## 更新触发条件

- 线程结构变化。
- 设置字段变化。
- `.async/` 下新增或迁移新的持久化目录。
- 记忆抽取策略变化。
