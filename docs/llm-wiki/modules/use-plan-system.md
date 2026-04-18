# usePlanSystem.ts

- 模块：`src/hooks/usePlanSystem.ts`
- 状态：已根据当前源码校验。
- 主题：Plan 模式下的预览 Markdown、结构化解析、落盘、与线程内结构化 plan 的同步，以及与流式正文的衔接。

## 一句话职责

`usePlanSystem.ts` 在 renderer 侧把 **流式 assistant 输出**、**已持久化消息里的 Plan 草稿**、**解析后的 `ParsedPlan`** 和 **主进程里的 plan 文件路径 / 已执行 key** 合成一套可供 Plan 侧栏与审阅 UI 使用的状态与回调。

## 输入依赖

Hook 签名显式依赖：

- `shell`、`currentId`、`currentIdRef`
- `messages`、`messagesThreadId`、`messagesRef`
- `workspace`、`streaming`、`defaultModel`

因此它不是独立数据源，而是挂在「当前线程 + 当前消息 + 流式片段」之上的派生与持久化层。

## 核心派生链路

1. **持久化草稿**：`extractLatestPlanDraftFromMessages` → `latestPersistedPlanDraft`；若无草稿则从 assistant 消息中扫 `# Plan:` 标题段落 → `latestPersistedAgentPlanMarkdown`。
2. **流式草稿**：`extractLatestPlanDraftFromAssistantContent(streaming)` → `streamingPlanDraft`。
3. **预览 Markdown**：`agentPlanPreviewMarkdown` 在 `parsedPlan`、流式草稿、流式 flatten 文本与持久化 Markdown 之间择优组合；`streamingMayContainAgentPlanHeading` 用于在未命中结构化消息时快速跳过无 Plan 的流。
4. **有效结构化对象**：`agentPlanEffectivePlan` = `parsedPlan` ?? 从草稿转的 `ParsedPlan` ?? `parsePlanDocument(preview)`。
5. **文档/Goal/Todos 切片**：`agentPlanDocumentMarkdown`、`agentPlanGoalMarkdown`、`agentPlanTodos` 等供侧栏与统计展示。

导出函数 `streamingMayContainAgentPlanHeading` 供外层在不需要时避免对大块流式正文做昂贵 flatten。

## 持久化与主进程

- **`plan:save`**：在无既有路径时生成文件名并写入 Markdown（工作区/用户目录策略由主进程实现，见 [状态与记忆](../architecture/state-and-memory.md)）。
- **`fs:writeFile`**：当已有 `planFileRelPath` / `planFilePath` 时直接覆盖 Markdown。
- **`plan:saveStructured`**：把当前 `ParsedPlan` 映射为线程结构化 plan 并写入线程存储。
- **`threads:getPlan`** / **`threads:getExecutedPlanKeys`**：切换线程时同步磁盘 plan 路径与「已执行」审阅状态。

`planReviewPathKeyMemo` 与 `planReviewIsBuilt` 用于编辑器侧「是否已按该 plan 执行过」的展示逻辑。

## 交互回调

- `updatePlanDraft` / `persistPlanDraft`：用户改 todo 或整体修订时更新 `parsedPlan` 并写回文件 + 结构化线程数据。
- `onPlanTodoToggle`、`onPlanAddTodo*`：侧栏 todo 维护。
- `onPlanQuestionSkip`：与 assistant 内容 hash 绑定，避免同一线程重复弹问。
- `resetPlanState`：工作区或线程切换时由上层统一清空。

## 修改这个文件时要一起看

- `src/planParser.ts`、`src/planDraft.ts`
- `src/agentStructuredMessage.ts`（flatten / 结构化消息判断）
- `main-src/ipc/register.ts` 中 `plan:*`、`threads:getPlan`、`threads:getExecutedPlanKeys`
- `main-src/threadStore.ts` 中线程 `plan` 字段

## Primary Sources

- `src/hooks/usePlanSystem.ts`
- `src/planParser.ts`
- `src/planDraft.ts`
- `main-src/ipc/register.ts`

## 相关页面

- [状态与记忆](../architecture/state-and-memory.md)
- [threadStore.ts](./thread-store.md)
- [useThreads.ts](./use-threads.md)

## 更新触发条件

- Plan Markdown 格式或 section 约定变化。
- 「Markdown 文件 vs 线程结构化 plan」双写策略变化。
- 流式 Plan 检测或 `ParsedPlan` 形状变化。
