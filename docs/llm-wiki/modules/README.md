# 模块页索引

- 状态：Phase 2 起新增，Phase 3–9 持续扩展。
- 目标：把高频核心文件从“专题概述”继续细化成“模块实体页”。

跨文件的 **IPC 通道全表**（按业务域分组）见架构页 [IPC 通道地图](../architecture/ipc-channel-map.md)；`ipc/register.ts` 本体不再单独建模块页，以免与地图重复。

## 当前模块页

- [agentLoop.ts](./agent-loop.md)
- [toolExecutor.ts](./tool-executor.md)
- [threadStore.ts](./thread-store.md)
- [settingsStore.ts](./settings-store.md)
- [workspaceFileIndex.ts](./workspace-file-index.md)
- [useSettings.ts](./use-settings.md)
- [useWorkspaceManager.ts](./use-workspace-manager.md)
- [workspaceContextExpand.ts](./workspace-context-expand.md)
- [teamOrchestrator.ts](./team-orchestrator.md)
- [useTeamSession.ts](./use-team-session.md)
- [appShellContexts.tsx](./app-shell-contexts.md)
- [modelResolve.ts](./model-resolve.md)
- [useStreamingChat.ts](./use-streaming-chat.md)
- [useThreads.ts](./use-threads.md)
- [usePlanSystem.ts](./use-plan-system.md)
- [useGitIntegration.ts](./use-git-integration.md)
- [botRuntime.ts](./bot-runtime.md)
- [terminalSessionIpc.ts](./terminal-session-ipc.md)
- [terminalSessionService.ts](./terminal-session-service.md)
- [terminalPty.ts](./terminal-pty.md)
- [mcpManager.ts](./mcp-manager.md)
- [pluginRuntimeService.ts](./plugin-runtime-service.md)

## 适用场景

- 需要直接修改某个核心文件。
- 需要快速判断“这个行为到底归哪个模块负责”。
- 需要确认某个模块是活跃实现、边缘依赖，还是历史残留。

## 使用建议

- 先读对应模块页，再回到源码。
- 如果模块页和代码冲突，以当前代码为准，并同步修订该页。
- 模块页不替代专题页；专题页讲系统关系，模块页讲单文件职责。

## 相关页面

- [LLM Wiki 首页](../README.md)
- [仓库地图](../repo-map.md)
- [维护手册](../meta/maintenance-playbook.md)
