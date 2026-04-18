# 仓库地图

- 状态：已根据当前目录结构、`package.json`、`README*` 和关键入口文件校验。
- 主题：哪些目录是权威目录、哪些文件是入口、不同任务应该先看哪里。

## 顶层目录职责

| 路径 | 职责 | 备注 |
| --- | --- | --- |
| `main-src/` | Electron 主进程源码 | 项目最关键的行为层 |
| `src/` | React 渲染进程源码 | UI、hooks、编辑器、聊天、设置 |
| `electron/` | Electron 产物和 preload | `main.bundle.cjs` 为构建产物，不应手改 |
| `docs/` | 文档与资产 | 现在包含 `llm-wiki/` |
| `scripts/` | 辅助脚本 | 图标、截图、端口清理等 |
| `public/` | 静态资源 | 供 Vite 构建 |
| `resources/` | 打包资源 | 应用图标等 |
| `dist/` | 渲染层构建产物 | 生成目录 |
| `.async/` | 工作区运行时数据 | 记忆、索引、Agent 项目切片等 |

## `main-src/` 内部热点

| 路径 | 主要职责 |
| --- | --- |
| `main-src/index.ts` | 应用启动、窗口创建、store 初始化、IPC 注册 |
| `main-src/ipc/register.ts` | 几乎所有 renderer -> main 的行为入口；通道索引见 [IPC 通道地图](./architecture/ipc-channel-map.md) |
| `main-src/terminalSessionService.ts` | 共享 PTY 会话池与环形输出缓冲 |
| `main-src/terminalSessionIpc.ts` | `term:*` / `terminalWindow:*` 等终端相关 IPC；细节页见 [terminalSessionIpc.ts](./modules/terminal-session-ipc.md) |
| `main-src/terminalPty.ts` | 按 sender 绑定的 `terminal:pty*` PTY IPC；细节页见 [terminalPty.ts](./modules/terminal-pty.md) |
| `main-src/mcp/mcpManager.ts` | MCP 多连接与工具聚合 |
| `main-src/agent/` | Agent 循环、工具池、工具执行、计划工具、Team 编排 |
| `main-src/llm/` | 模型解析、Provider 适配、流式输出、超时与重试 |
| `main-src/threadStore.ts` | 线程、消息、计划、团队快照持久化 |
| `main-src/settingsStore.ts` | 模型、UI、Agent、MCP、bot、统计等设置持久化 |
| `main-src/workspaceFileIndex.ts` | 工作区文件索引与搜索 |
| `main-src/workspaceSymbolIndex.ts` | 导出符号级索引 |
| `main-src/workspace.ts` | 工作区绑定与路径越界保护 |
| `main-src/memdir/` | `.async/memory` 入口、扫描、类型定义 |
| `main-src/services/extractMemories/` | 对话到记忆文件的后台抽取 |
| `main-src/browser/` | 内置浏览器配置、分区、命令状态 |
| `main-src/bots/` | 外部平台 bot 适配和会话控制 |

## `src/` 内部热点

| 路径 | 主要职责 |
| --- | --- |
| `src/App.tsx` | 顶层壳层、布局、模式切换、全局状态拼装 |
| `src/hooks/useSettings.ts` | 设置页核心状态与项目级 Agent 切片合并 |
| `src/hooks/useWorkspaceManager.ts` | 工作区路径、recent、文件搜索、懒加载文件列表 |
| `src/hooks/useStreamingChat.ts` | 聊天流式状态 |
| `src/hooks/usePlanSystem.ts` | Plan 预览、持久化、todo 维护 |
| `src/hooks/useTeamSession.ts` | Team 模式流事件到 UI 会话状态的整理层 |
| `src/app/appShellContexts.tsx` | AppShell 上下文切片与性能边界 |
| `src/SettingsPage.tsx` | 设置页 |
| `src/EditorMainPanel.tsx` | 编辑器主体 |
| `src/AgentChatPanel.tsx` | Agent 聊天主视图 |
| `src/app/` | 新版 Shell 布局和工作区壳层 |
| `src/i18n/` | 文案与翻译 |

## 运行时/生成目录

- `electron/main.bundle.cjs`：由 `esbuild.main.mjs` 生成。
- `dist/`：由 Vite 生成。
- `.async/index/`：运行时索引结果，可能包含历史条目，不应直接当源码真相。
- `.async/memory/`：项目运行时记忆，不等同于已审阅文档。

## 按任务找入口

### 想改模型配置或模型选择

- 先看 `main-src/settingsStore.ts`
- 再看 `main-src/llm/modelResolve.ts`
- 再看 `src/hooks/useSettings.ts`
- 细节页见 [useSettings.ts](./modules/use-settings.md)
- 细节页见 [modelResolve.ts](./modules/model-resolve.md)

### 想改 Agent 工具循环

- 先看 `main-src/agent/agentLoop.ts`
- 再看 `main-src/agent/toolExecutor.ts`
- 再看 `main-src/agent/agentTools.ts`
- 最后看 `main-src/ipc/register.ts`

### 想改文件检索、`@` 提及或快速打开

- 先看 `main-src/workspaceFileIndex.ts`
- 再看 `src/hooks/useWorkspaceManager.ts`
- 再看 `main-src/llm/workspaceContextExpand.ts`
- 必要时再看 `src/composerAtMention.ts`、相关 UI 组件
- 细节页见 [workspaceFileIndex.ts](./modules/workspace-file-index.md)
- 细节页见 [useWorkspaceManager.ts](./modules/use-workspace-manager.md)
- 细节页见 [workspaceContextExpand.ts](./modules/workspace-context-expand.md)

### 想改线程、计划、记忆

- 先看 `main-src/threadStore.ts`
- 再看 `main-src/memdir/`
- 再看 `main-src/services/extractMemories/extractMemories.ts`
- 再看 `src/hooks/usePlanSystem.ts`
- 渲染层线程列表与消息加载见 `src/hooks/useThreads.ts`
- 细节页见 [useThreads.ts](./modules/use-threads.md)
- 细节页见 [usePlanSystem.ts](./modules/use-plan-system.md)

### 想改 Git 状态、分支选择器或 diff 预览

- 先看 `src/hooks/useGitIntegration.ts`
- 再看 `main-src/ipc/register.ts` 中 `git:*` 通道
- 细节页见 [useGitIntegration.ts](./modules/use-git-integration.md)

### 想改全能终端、共享 PTY 会话或独立终端窗口

- 先看 `main-src/terminalSessionService.ts`（会话池、缓冲、订阅与广播）。
- 再看 `main-src/terminalSessionIpc.ts`（`term:*`、`terminalWindow:open` 等 handle 与 host 窗口映射）。
- 旧按窗口绑定的 PTY 路径见 `main-src/terminalPty.ts`。
- 细节页见 [terminalSessionService.ts](./modules/terminal-session-service.md)、[terminalSessionIpc.ts](./modules/terminal-session-ipc.md)。

### 想查或新增 IPC 通道

- 先看 [IPC 通道地图](./architecture/ipc-channel-map.md) 按域定位 `handle` 名称。
- 再对照 `electron/preload.cjs` 白名单，确认 renderer 是否可 `invoke`。
- 终端类除 `register.ts` 外还有 `terminalSessionIpc.ts`、`terminalPty.ts`；会话池实现见 [terminalSessionService.ts](./modules/terminal-session-service.md)。

### 想改 MCP 连接或 Agent 中的 MCP 工具

- 先看 `main-src/mcp/mcpManager.ts` 与 `main-src/mcp/mcpClient.ts`
- 再看 `main-src/settingsStore.ts` 中 `mcpServers` 持久化
- 再看 `main-src/plugins/pluginRuntimeService.ts` 中 `getEffectiveMcpServerConfigs`（细节页见 [pluginRuntimeService.ts](./modules/plugin-runtime-service.md)）
- IPC 面见 [IPC 通道地图](./architecture/ipc-channel-map.md) 与 [mcpManager.ts](./modules/mcp-manager.md)

### 想改 Team 模式

- 先看 `main-src/agent/teamOrchestrator.ts`
- 再看 `main-src/ipc/register.ts`
- 再看 `src/hooks/useTeamSession.ts`
- bot 场景再补看 `main-src/bots/botRuntime.ts`
- 细节页见 [teamOrchestrator.ts](./modules/team-orchestrator.md)
- 细节页见 [useTeamSession.ts](./modules/use-team-session.md)
- 细节页见 [botRuntime.ts](./modules/bot-runtime.md)

### 想改 App 根状态切片或减少重渲染

- 先看 `src/app/appShellContexts.tsx`
- 再看 `src/App.tsx`
- 再看对应的 hook，如 `useSettings.ts`、`useWorkspaceManager.ts`、`useGitIntegration.ts`
- 细节页见 [appShellContexts.tsx](./modules/app-shell-contexts.md)

## Primary Sources

- 仓库根目录结构
- `package.json`
- `main-src/index.ts`
- `main-src/ipc/register.ts`
- `src/App.tsx`
- `src/hooks/useSettings.ts`
- `src/hooks/useWorkspaceManager.ts`

## 相关页面

- [项目总览](./project-overview.md)
- [运行时架构](./architecture/runtime-architecture.md)
- [IPC 通道地图](./architecture/ipc-channel-map.md)
- [状态与记忆](./architecture/state-and-memory.md)
- [工作区智能](./architecture/workspace-intelligence.md)
- [模块页索引](./modules/README.md)

## 更新触发条件

- 新增一级目录或核心模块。
- 大规模重构主进程或渲染层。
- 入口文件转移。
