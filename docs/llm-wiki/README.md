# Async LLM Wiki

- 状态：Phase 1-8 已落地，已按 2026-04-18 的仓库代码和现有记忆文件校对。
- 目标：把项目知识编译成稳定的 Markdown 网络，减少每次任务都从头扫代码。
- 定位：这里是 `用户/Agent -> Wiki -> 原始代码/配置/运行时记忆` 之间的中间层。

## 设计原则

- 先链接，后下钻：优先通过本 Wiki 找入口，再去读对应源码。
- 代码优先：当 Wiki、README、`.async/memory`、生成索引互相冲突时，以当前源码为准。
- 一页一主题：主题页负责总结，避免把所有内容堆到单个大文件。
- 明确不确定性：发现冲突时，不静默覆盖，记录到 [矛盾与待确认项](./meta/contradictions-and-open-questions.md)。
- 可持续维护：新数据源加入后，不只是“索引一下”，而是要更新已有页面、修正旧说法、补充交叉链接。

## 快速导航

按任务类型走：

- 想先知道这个项目到底是什么：看 [项目总览](./project-overview.md)。
- 想找代码入口和目录职责：看 [仓库地图](./repo-map.md)。
- 想理解 Electron 主进程、渲染进程和 IPC：看 [运行时架构](./architecture/runtime-architecture.md)；要按通道名查全表：看 [IPC 通道地图](./architecture/ipc-channel-map.md)。
- 想改 Agent、工具调用、模型路由、Team 模式：看 [Agent 系统](./architecture/agent-system.md)。
- 想查线程、设置、计划、`.async/memory`、工作区级 AI 配置：看 [状态与记忆](./architecture/state-and-memory.md)。
- 想改文件搜索、符号索引、LSP、浏览器工具：看 [工作区智能](./architecture/workspace-intelligence.md)。
- 想直接修改核心文件：看 [模块页索引](./modules/README.md)。
- 想跑项目、打包、测试或发版：看 [开发与发布流程](./operations/dev-workflow.md)。
- 想继续扩建这套 Wiki：看 [维护手册](./meta/maintenance-playbook.md)。
- 想核对 preload `invoke` 白名单与主进程 `handle`：看 [Preload 与主进程 invoke 对齐检查清单](./meta/preload-main-invoke-checklist.md)。
- 想确认哪些旧说法已经过时：看 [矛盾与待确认项](./meta/contradictions-and-open-questions.md)。

## 知识分层

这几个地方都在存“给 AI 用的信息”，但职责不同：

- `docs/llm-wiki/`：人工维护、可审阅、偏稳定的知识层，适合放架构、事实、规则、冲突。
- `.async/memory/`：运行时记忆入口，适合放更短的持久记忆；它会影响对话上下文，但不天然等于“权威文档”。
- `.async/agent.json`：项目级 Agent 规则、技能和子 Agent 配置，用来告诉 AI 先看什么、如何行动；但当前仓库默认忽略 `.async/`，所以它是本机级配置，未必会随 Git 共享。
- `README*.md`：对外说明文档，适合介绍项目，但不保证比代码更及时。
- `.async/index/`：运行时索引产物，便于检索，但可能保留历史残影，不能直接当事实来源。

## 当前收录范围

Phase 1 重点做了四件事：

1. 建立 Wiki 信息架构和入口页。
2. 把主进程、渲染层、Agent、持久化、索引体系的核心知识沉淀成专题页。
3. 把现有 `.async/memory` 里的有效信息重新放回代码语境里校验。
4. 建立“矛盾与待确认项”页，开始显式管理文档漂移。

Phase 2 已追加：

1. 为高频核心文件建立模块级实体页。
2. 明确纠偏 `workspaceFileIndex` 的当前状态：仍在用，但已转成按需底座。

Phase 3 已追加：

1. 为前端状态桥接层补模块页：`useSettings.ts`、`useWorkspaceManager.ts`。
2. 为主进程上下文编译与 Team 编排补模块页：`workspaceContextExpand.ts`、`teamOrchestrator.ts`。

Phase 4 已追加：

1. 为 Team UI 状态消费层补模块页：`useTeamSession.ts`。
2. 为 AppShell 上下文切片层补模块页：`appShellContexts.tsx`。
3. 为模型解析与流式聊天基础设施补模块页：`modelResolve.ts`、`useStreamingChat.ts`。

Phase 5 已追加：

1. 为线程与消息加载层补模块页：`useThreads.ts`。
2. 为 Plan 预览与双写持久化补模块页：`usePlanSystem.ts`。
3. 为 Git 状态与 diff 预览补模块页：`useGitIntegration.ts`。
4. 为外部平台 Bot 主进程编排补模块页：`botRuntime.ts`。

Phase 8 已追加：

1. 新增架构页 [IPC 通道地图](./architecture/ipc-channel-map.md)，按域汇总 `ipcMain.handle` 与终端子模块登记。
2. 为共享 PTY 会话池补模块页：`terminalSessionService.ts`。
3. 为 MCP 多连接管理补模块页：`mcpManager.ts`。

Phase 9（进行中）已追加：

1. 为终端 IPC 薄层补模块页：[terminalSessionIpc.ts](./modules/terminal-session-ipc.md)（与 Phase 8 的 `terminalSessionService` 页配对）。
2. IPC 地图终端表与 `preload.cjs` 对齐，补全 `term:sessionRespondToPrompt` 等通道说明。
3. 为旧版按 sender PTY 补模块页：[terminalPty.ts](./modules/terminal-pty.md)。
4. 为插件运行时与 MCP effective 合并补模块页：[pluginRuntimeService.ts](./modules/plugin-runtime-service.md)。
5. 新增维护向专题：[Preload 与主进程 invoke 对齐检查清单](./meta/preload-main-invoke-checklist.md)。

## 后续阶段建议

- Phase 6：把每次大功能开发后的结论编译进专题页，而不是只落在聊天记录或 `.async/memory` 里。
- Phase 7：补充 ADR 风格决策页，记录“为什么是现在这个架构”。
- Phase 9 余量：按需把 `mcpClient.ts` / `pluginFs.ts` 等拆成更细模块页；处理 `team:userInputRespond` 白名单与主进程不一致（见矛盾页）。

## 维护约定

- 每次增加新源码、设计文档或运行时记忆时，先判断它应该更新哪张现有页面。
- 如果旧结论被推翻，不要只追加新页，要同步修订旧页并记录矛盾。
- 每一页都尽量保留“Primary sources / 更新触发条件 / 相关页面”。

## 推荐阅读顺序

1. [项目总览](./project-overview.md)
2. [仓库地图](./repo-map.md)
3. [运行时架构](./architecture/runtime-architecture.md)
4. [IPC 通道地图](./architecture/ipc-channel-map.md)（需要按通道名排查时）
5. [Agent 系统](./architecture/agent-system.md)
6. [状态与记忆](./architecture/state-and-memory.md)
7. [模块页索引](./modules/README.md)
