# useWorkspaceManager.ts

- 模块：`src/hooks/useWorkspaceManager.ts`
- 状态：已根据当前源码校验。
- 主题：renderer 侧工作区路径、recent、文件搜索和文件列表懒加载的聚合 hook。

## 一句话职责

`useWorkspaceManager.ts` 是 renderer 侧的工作区状态中枢，负责“当前打开的工作区是什么、最近工作区有哪些、文件搜索如何触发、全量文件列表何时加载”。

## 它管理什么

- 当前工作区路径 `workspace`
- 首页 recent 列表 `homeRecents`
- 文件菜单 recent 列表 `folderRecents`
- 工作区别名 `workspaceAliases`
- Agent 工作区隐藏/折叠状态
- 按需加载的 `workspaceFileListRef`
- 按需搜索函数 `searchFiles()`

## 当前文件列表语义

这个 hook 自己已经写明当前是：

- `v3 - 完全按需`

它的关键策略是：

- `@` 提及走 `workspace:searchFiles`
- Quick Open 等需要全量列表时才调用 `ensureWorkspaceFileListLoaded()`
- 打开工作区时不主动预热全量索引

因此它是 renderer 对 “workspaceFileIndex 已转成按需底座” 的最直接体现之一。

## 非显而易见的关键点

### 1. 文件列表是 ref，不是大 state

`workspaceFileListRef` 用 ref 持有全量路径，而不是每次完整进 state，目的是降低不必要重渲染。

### 2. recent 分成两套语义

- `homeRecents`：首页展示
- `folderRecents`：文件菜单里的“打开最近文件夹”

它们不是同一块 UI 状态的不同名字，而是不同消费场景。

### 3. 一部分工作区 UI 偏好只存在本地 localStorage

例如：

- workspace alias
- hidden/collapsed agent workspace paths

这类状态不是主进程权威持久化。

### 4. 关闭工作区时顺便停止 TS LSP

它会在 `workspace` 为空时调用 `lsp:ts:stop`，说明这个 hook 也承担了一部分工作区生命周期清理职责。

## 上层调用关系

- `src/App.tsx` 直接调用
- 之后通过 `src/app/appShellContexts.tsx` 暴露为 `AppShellWorkspaceContext`
- `useComposerAtMention`、Quick Open、工作区菜单等 UI 逻辑间接依赖它提供的数据

## 它和 `workspaceFileIndex.ts` 的关系

这个 hook 本身不直接实现索引，而是 renderer 到主进程索引能力的桥：

- `workspace:listFiles`
- `workspace:searchFiles`

因此它是“UI 如何使用文件索引”的关键边界层。

## 修改这个文件时要一起看

- `main-src/ipc/handlers/workspaceHandlers.ts`
- `main-src/workspaceFileIndex.ts`
- `src/App.tsx`
- `src/useComposerAtMention.ts`
- `src/quickOpenPalette.tsx`

## Primary Sources

- `src/hooks/useWorkspaceManager.ts`
- `src/App.tsx`
- `src/app/appShellContexts.tsx`
- `main-src/ipc/handlers/workspaceHandlers.ts`
- `main-src/workspaceFileIndex.ts`

## 相关页面

- [workspaceFileIndex.ts](./workspace-file-index.md)
- [工作区智能](../architecture/workspace-intelligence.md)

## 更新触发条件

- 文件搜索入口变化
- recent / alias / hidden workspace 状态模型变化
- Quick Open 或 `@` 提及不再依赖这里的 API
- 工作区生命周期清理逻辑变化
