# useGitIntegration.ts

- 模块：`src/hooks/useGitIntegration.ts`
- 状态：已根据当前源码校验。
- 主题：Git 状态、分支列表、diff 预览的分批加载，以及与工作区切换、UI 响应性相关的调度策略。

## 一句话职责

`useGitIntegration.ts` 通过 `git:status`、`git:listBranches`、`git:diffPreviews` 等 IPC 维护渲染层 Git 全景：分支名、状态行、路径级状态图、变更路径列表、按路径聚合的 diff 预览统计，并在工作区变化时用 **idle 回调** 延后首次刷新，避免与切工作区首帧争抢主线程。

## 它暴露的状态与行为

- 分支与概览：`gitBranch`、`gitLines`、`gitPathStatus`、`gitChangedPaths`。
- 成功与否：`gitStatusOk`（失败时 Agent 改动条等可回退到对话解析统计）。
- 分支选择器：`gitBranchList`、`gitBranchListCurrent`、`gitBranchPickerOpen`、`onGitBranchListFresh`。
- 预览：`diffPreviews`、`diffLoading`、`diffTotals`（由已加载预览累加 additions/deletions）。
- 其它：`gitActionError`、`treeEpoch`（供文件树强制刷新）、`refreshGit`、`loadGitDiffPreviews`。

## 非显而易见的关键点

### 1. `refreshGit` 使用 `startTransition`

一次 status 拉回多段 state；包在 transition 里可减少拖动窗口等交互被长列表重渲染阻塞。diff 预览不随 status 一次性返回，而是清零后由 `loadGitDiffPreviews` 按需补齐。

### 2. 新一轮 `refreshGit` 会 bump `diffLoadRunIdRef`

取消上一批 diff 预览的语义进度，避免旧请求把预览写进新工作区。

### 3. `loadGitDiffPreviews` 分批与去重

常量 `GIT_DIFF_PREVIEW_BATCH_SIZE = 24`，按批调用 `git:diffPreviews`。用 `previewPathsLoadedRef` / `previewPathsInFlightRef` 避免重复请求；路径匹配前经 `normalizeWorkspaceRelPathForMatch` 归一化。

### 4. 工作区 effect 使用 `requestIdleCallback`（带 2000ms timeout 回退）

仅在 `workspace` 与 `shell` 就绪后调度 `refreshGit`，并在 cleanup 时取消 idle 任务。

## 上层调用关系

- `src/App.tsx` 与资源管理器 / 差异视图等消费这些字段。
- UI 在展开或可见路径变化时可调用 `loadGitDiffPreviews(requestedPaths)` 做按需加载。

## 修改这个文件时要一起看

- `main-src/ipc/register.ts` 中 `git:*` 实现
- `src/agentFileChangesFromGit.ts`（路径归一化）
- `src/WorkspaceExplorer.tsx` 中 `GitPathStatusMap` 类型

## Primary Sources

- `src/hooks/useGitIntegration.ts`
- `main-src/ipc/register.ts`

## 相关页面

- [仓库地图](../repo-map.md)
- [appShellContexts.tsx](./app-shell-contexts.md)

## 更新触发条件

- Git IPC 返回形状或字段含义变化。
- diff 预览分批大小或缓存策略调整。
- 工作区切换时刷新时机（idle/timeout）策略变化。
