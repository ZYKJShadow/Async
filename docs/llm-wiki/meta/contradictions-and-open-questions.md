# 矛盾与待确认项

- 状态：这里记录“旧知识和当前代码不一致”的地方，避免 AI 重复吸收过期结论。
- 规则：如果某项已解决，应同步回写对应专题页，而不是只在这里留痕。

## 当前已确认的漂移

| 项目 | 旧说法 | 当前证据 | 结论 | 建议动作 |
| --- | --- | --- | --- | --- |
| 语义索引源码 | `README.md` / `README.zh-CN.md` 仍列出 `main-src/workspaceSemanticIndex.ts` | 当前工作树中该文件不存在；`Test-Path main-src/workspaceSemanticIndex.ts` 为 `False` | README 已落后于当前代码现实 | 后续应更新 README 的项目结构描述 |
| 运行时索引残影 | `.async/index/semantic.json` 仍包含 `workspaceSemanticIndex.ts` 的索引内容 | 该目录是运行时生成物，不代表当前源码仍存在该实现 | 运行时索引含历史残影 | 不应把 `.async/index/` 当权威事实来源 |
| Plan 存储位置 | README 说 Plan 文档位于 `.async/plans/` | `ipc/register.ts` 显示：有工作区时写到 `<workspace>/.async/plans/`，否则回退到 `userData/.async/plans/`；同时结构化 plan 还存在线程数据里 | README 描述过于简化 | 后续应把“Markdown plan + 线程结构化 plan”都写清楚 |
| 文件索引策略 | `.async/memory/project/feat-app-shell-architecture.md` 提到 idle-time prewarming | `src/hooks/useWorkspaceManager.ts` 明确写着当前 v3 架构是“完全按需”，不在打开工作区时预热文件索引 | 旧 memory 说法已部分过时 | 应刷新 `.async/memory` 相关条目，避免继续传播旧优化方案 |
| `workspaceFileIndex` 是否已废弃 | 容易形成“它已经没用了”的印象 | 当前代码里它仍被 `appWindow.ts`、`ipc/register.ts`、`workspaceSymbolIndex.ts`、`botRuntime.ts`、`workspaceContextExpand.ts` 直接引用，renderer 还通过 `workspace:listFiles` / `workspace:searchFiles` 间接依赖 | 真实情况是“仍在使用，但已转成按需索引底座” | 统一改用这一表述，避免把它误判成死模块 |

## 待确认问题

### `team:userInputRespond` 是否仍为有效契约？

当前能看到：

- `electron/preload.cjs` 的 `INVOKE_CHANNELS` 包含 `team:userInputRespond`
- `main-src/ipc/register.ts`（及全 `main-src`）中 **未** 注册同名 `ipcMain.handle`
- `src/` 中亦无对该通道的 `invoke` 引用

需要未来确认：应删除白名单死项、还是补主进程 handler 与 UI 调用。维护步骤见 [Preload 与主进程 invoke 对齐检查清单](./preload-main-invoke-checklist.md)。

### `workspaceSemanticIndex.ts` 是被删除了，还是未提交？

当前能看到：

- README 还引用它
- `.async/index/semantic.json` 还记得它
- 代码树里已没有该文件

需要未来确认：

- 它是否被有意移除
- 是否已有新实现替代
- README 是否只是未同步

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
