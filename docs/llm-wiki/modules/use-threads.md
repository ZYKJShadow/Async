# useThreads.ts

- 模块：`src/hooks/useThreads.ts`
- 状态：已根据当前源码校验。
- 主题：渲染层线程列表、当前线程、消息加载、Agent 侧栏多工作区线程摘要，以及与 `startTransition` / 导航历史相关的性能边界。

## 一句话职责

`useThreads.ts` 把主进程线程 IPC（`threads:list`、`threads:messages`、`threads:listAgentSidebar` 等）收敛成 `App.tsx` 可直接使用的状态与回调，并在切换线程、加载大消息体时尽量降低对主线程的阻塞。

## 它实际管理什么

- 当前工作区的线程列表与搜索关键字。
- `currentId` 与用于避免竞态的 `currentIdRef`。
- 线程标题编辑、删除确认等侧栏交互状态。
- 消息域：`messages`、`messagesThreadId`、`messagesRef`，以及乐观/函数式更新用的 `setMessages` / `setMessagesThreadId`。
- **Agent 侧栏**：`sidebarThreadsByPathKey`，按归一化工作区根路径索引的线程摘要（多路径批量走 `threads:listAgentSidebar`）。
- 从某条用户消息重发：`resendFromUserIndex` 与 `resendIdxRef`。
- 线程内前进/后退导航：`threadNavigation`、`setThreadNavigation`、`skipThreadNavigationRecordRef`。
- `refreshThreads`、`refreshAgentSidebarThreads`、`loadMessages`、`resetThreadState`。

## 非显而易见的关键点

### 1. `refreshThreads` 里 `setCurrentId` 与 `setThreads` 的优先级不同

`setCurrentId` 同步执行，保证立刻触发依赖 `currentId` 的 effect（例如加载消息、导航历史）。`setThreads` 包在 `startTransition` 里，避免侧栏列表更新抢在消息加载路径前面。

### 2. `loadMessages` 的并发与陈旧响应丢弃

同一 `threadId` 复用单个 in-flight Promise，避免重复 IPC。返回后若 `currentIdRef` 已变，则丢弃结果。成功时用 `startTransition` 更新 `msgState`，并可选调用 `onLoad`（便于与 fileChanges、plan 等状态同批提交）。

### 3. 与 `startTransition` 配套的 `awaitTransitionPaintCommitted`

注释说明：若在 transition 调度尚未提交时立刻 `await loadMessages` 结束，ref 仍指向上一帧，会导致 `onSelectThread` 误判需要再次拉消息。因此用 microtask + 双 `requestAnimationFrame` 对齐到 “transition 已提交再结束 await”。

### 4. 末尾仅差一条持久化 assistant 错误行时保留旧 state

`incomingMissesOnlyTrailingAssistantError` 用于在服务端去掉尾部 `错误：` / `Error:` 行时避免无意义的状态抖动。

### 5. 侧栏多工作区列表的引用稳定性

`sameSidebarThreadsByPath` 在展示字段等价时保留上一 state 引用，减少左侧栏与 `agentChatPanelProps` 链式失效。

## 上层调用关系

- `src/App.tsx` 聚合 `useThreads(shell)`，再向下传给聊天面板、侧栏、工作区切换逻辑。
- 切换工作区时常与 `resetThreadState()` 一起清空线程域状态。

## 修改这个文件时要一起看

- `main-src/threadStore.ts`
- `main-src/ipc/register.ts` 中 `threads:*` 通道
- `src/threadTypes.ts`（`normalizeThreadRow`、`chatMessagesListEqual` 等）
- `src/workspaceRootKey.ts`（侧栏路径键归一化）

## Primary Sources

- `src/hooks/useThreads.ts`
- `src/App.tsx`
- `main-src/ipc/register.ts`

## 相关页面

- [threadStore.ts](./thread-store.md)
- [状态与记忆](../architecture/state-and-memory.md)
- [useStreamingChat.ts](./use-streaming-chat.md)

## 更新触发条件

- 线程列表或消息 IPC 契约变化。
- 侧栏多工作区线程展示策略变化。
- 消息加载路径的性能策略（transition / ref）调整。
