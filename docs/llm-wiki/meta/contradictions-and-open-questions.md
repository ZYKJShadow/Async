# 矛盾与待确认项

- 状态：这里记录“旧知识和当前代码不一致”的地方，避免 AI 重复吸收过期结论。
- 规则：如果某项已解决，应同步回写对应专题页，而不是只在这里留痕。

## 当前已确认的漂移

| 项目 | 旧说法 | 当前证据 | 结论 | 建议动作 |
| --- | --- | --- | --- | --- |
| 语义索引源码 | `README.md` / `README.zh-CN.md` 仍列出 `main-src/workspaceSemanticIndex.ts` | 当前工作树中该文件不存在；`Test-Path main-src/workspaceSemanticIndex.ts` 为 `False` | README 已落后于当前代码现实 | 后续应更新 README 的项目结构描述 |
| 运行时索引残影 | `.async/index/semantic.json` 仍包含 `workspaceSemanticIndex.ts` 的索引内容 | 该目录是运行时生成物，不代表当前源码仍存在该实现 | 运行时索引含历史残影 | 不应把 `.async/index/` 当权威事实来源 |
| Plan 存储位置 | README 说 Plan 文档位于 `.async/plans/` | `ipc/handlers/register.ts` 显示：有工作区时写到 `<workspace>/.async/plans/`，否则回退到 `userData/.async/plans/`；同时结构化 plan 还存在线程数据里 | README 描述过于简化 | 后续应把“Markdown plan + 线程结构化 plan”都写清楚 |
| 文件索引策略 | `.async/memory/project/feat-app-shell-architecture.md` 提到 idle-time prewarming | `src/hooks/useWorkspaceManager.ts` 明确写着当前 v3 架构是“完全按需”，不在打开工作区时预热文件索引 | 旧 memory 说法已部分过时 | 应刷新 `.async/memory` 相关条目，避免继续传播旧优化方案 |
| `workspaceFileIndex` 是否已废弃 | 容易形成“它已经没用了”的印象 | 当前代码里它仍被 `appWindow.ts`、`ipc/handlers/workspaceHandlers.ts`、`workspaceSymbolIndex.ts`、`botRuntime.ts`、`workspaceContextExpand.ts` 直接引用，renderer 还通过 `workspace:listFiles` / `workspace:searchFiles` 间接依赖 | 真实情况是“仍在使用，但已转成按需索引底座” | 统一改用这一表述，避免把它误判成死模块 |
| 旧版 `terminalPty.ts` | Wiki 多页仍把它当作活跃模块引用；`preload.cjs` 仍保留 `terminal:pty*` 白名单与订阅 API | `main-src/terminalPty.ts` 已不存在；`main-src` 中无 `registerTerminalPtyIpc`；`src/` 中无 `terminal:pty*` 调用 | 旧按 sender 绑定 PTY 路径已完全移除，但 preload 残留死代码 | 更新所有引用页；考虑从 preload 删除死项 |
| IPC 注册入口集中度 | `repo-map.md`、`runtime-architecture.md`、`ipc-channel-map.md` 等均把 `ipc/register.ts` 描述为“几乎所有/绝大部分”入口 | 大量 handle 已拆分到 `main-src/ipc/handlers/*Handlers.ts`（17 个文件），`register.ts` 只保留线程、Agent、Plan 等核心流 | 架构已演进为分域 handler 文件，文档未同步 | 修正各页对 IPC 注册入口的描述，补全 handlers 目录 |
| `git:diffPreview` | `ipc-channel-map.md` 未列出该通道；`preload.cjs` 无该白名单 | `main-src/ipc/handlers/gitHandlers.ts` 第 261 行注册了 `ipcMain.handle('git:diffPreview', …)`，但 preload 中只有 `git:diffPreviews`（复数） | 主进程有 handler 但 renderer 无法调用 | 确认是笔误后统一通道名，或补 preload 白名单 |
| `ipc-channel-map.md` 覆盖度 | 文档自认为“按域汇总” | 实际只覆盖约 135 个通道，而主进程注册约 225 个；大量 `browserCapture:*`、`feishu:*`、`term:sftp*`、`term:profilePassword*`、`settings:*`、`plugins:*` 等未收录 | 地图不完整 | 补全遗漏域，或至少补全高频/核心通道 |

## 待确认问题

### `team:userInputRespond` 是否仍为有效契约？

当前能看到：

- `electron/preload.cjs` 的 `INVOKE_CHANNELS` 包含 `team:userInputRespond`
- `main-src/ipc/register.ts`（及全 `main-src`）中 **未** 注册同名 `ipcMain.handle`
- `src/` 中亦无对该通道的 `invoke` 引用

需要未来确认：应删除白名单死项、还是补主进程 handler 与 UI 调用。维护步骤见 [Preload 与主进程 invoke 对齐检查清单](./preload-main-invoke-checklist.md)。

### `workspaceSemanticIndex.ts` 是被删除了，还是未提交？

当前能看到：

- ~~README 还引用它~~ → **已修正**：README / README.zh-CN.md 中已删除该条目
- `.async/index/semantic.json` 还记得它
- 代码树里已没有该文件

结论：该文件已被有意移除，暂无替代实现；README 已完成同步。`.async/index/semantic.json` 作为运行时残影，将在下次索引重建时自然消失。

### 是否需要系统性清理 `.async/memory` 的旧分支结论？

当前 `.async/memory/project/` 下有不少分支期的总结文件。它们提供历史线索，但不保证都仍然准确。

建议：

- 把仍然有效的知识编译进 `docs/llm-wiki`
- 对已过期的 memory 条目进行刷新或删除

## 使用方式

当你发现文档漂移时：

1. 先修正相关专题页。
2. 再把漂移写到这里。
3. 最后决定是否同步清理 README 或 `.async/memory`。
