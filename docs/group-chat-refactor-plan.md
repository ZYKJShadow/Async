# AI Team Group Chat Refactor Plan

## 1. Problem Statement

The current architecture gives each AI employee a separate 1:1 inbox. When the user sends a request to the CEO, the CEO delegates to N employees, each starting their own independent agent loop and streaming back simultaneously. This causes:

- **Performance**: N concurrent streams = N parallel IPC floods + N parallel React setState updates, even with throttling
- **Bad UX**: User must switch between N inboxes to see results; no unified conversation view
- **Conceptual mismatch**: The feature is "a team that collaborates", not "N separate chatbots"

## 2. Target Architecture

### 2.1 Mental Model

```
[Team Group Chat]
User:     帮我优化 Test 项目
CEO:      好的，我来分析一下...
          → 委派给 工程师: 探索项目结构     [card: in_progress]
          → 委派给 产品经理: 评估业务目标    [card: pending]
工程师:   ✅ 完成 — 项目是 React + Vite...  [card: done, clickable]
产品经理: ✅ 完成 — 业务目标集中在...        [card: done, clickable]
CEO:      综合团队反馈，优化方案如下...
```

- **Group chat** is the single conversation interface — user talks to the team as a whole
- **CEO** is the primary agent — it receives the user message, analyzes, plans, and delegates
- **Other employees are sub-agents** — they work in the background, results surface in the group chat as summary cards
- **Only one stream at a time** — CEO streams its response, sub-agents work silently, results appear as completed cards
- **Detail drill-down** — clicking a delegation card opens a detail view showing the sub-agent's full work log (tool calls, file operations, thinking process)

### 2.2 Architecture Diagram

```
                    ┌─────────���───────────────────────────┐
                    │          Group Chat UI               │
                    │  (single timeline, one stream)       │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌─────────────���▼──────────────────────┐
                    │      CEO Agent Loop (primary)        │
                    │  - receives user messages             │
                    │  - streams response to group chat     │
                    │  - calls delegate_task → enqueue      │
                    └──────────────┬──────────────────────┘
                                   │ delegation queue
                    ┌──────────────▼──────────────────────┐
                    │      Sub-Agent Executor               │
                    │  - picks tasks from queue             │
                    │  - runs employee agent loop           │
                    │  - stores work log (tool calls, etc.) │
                    │  - posts result to group chat         │
                    └──────────────┬──────────────────────┘
                                   │ click card
                    ┌──────────────▼──────────────────────┐
                    │      Sub-Agent Detail Panel           │
                    │  - shows full work log for a task     │
                    │  - tool calls, file diffs, timing     │
                    │  - status: running / done / blocked   │
                    └─────────────────────────────���───────┘
```

## 3. Data Model Changes

### 3.1 New: Sub-Agent Work Log

Each delegation spawns a sub-agent "job". The job captures all tool call activity so the user can inspect it via the detail panel.

```ts
// shared/aiEmployeesSettings.ts — NEW

/** A single tool invocation recorded during sub-agent execution. */
type AiSubAgentToolEntry = {
  id: string;
  name: string;                    // tool name (e.g. "Read", "Edit", "Bash")
  args: Record<string, unknown>;
  result: string;                  // truncated result text
  success: boolean;
  startedAtIso: string;
  durationMs?: number;
};

/** A sub-agent job — one employee working on one delegated task. */
type AiSubAgentJob = {
  id: string;                      // same as the handoff id
  runId: string;
  employeeId: string;
  employeeName: string;
  taskTitle: string;
  taskDescription: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'blocked';
  queuedAtIso: string;
  startedAtIso?: string;
  completedAtIso?: string;
  /** The LLM's verbal output (text-only, no tool JSON). */
  resultSummary?: string;
  /** Detailed work log: every tool call in order. */
  toolLog: AiSubAgentToolEntry[];
  /** Error message if status === 'error'. */
  errorMessage?: string;
};
```

### 3.2 Extend AiOrchestrationRun

```ts
// Add to AiOrchestrationRun:
type AiOrchestrationRun = {
  // ... existing fields ...
  /** Sub-agent jobs spawned by delegation within this run. */
  subAgentJobs: AiSubAgentJob[];
};
```

### 3.3 Simplify Message Model for Group Chat

Currently `AiCollabMessage` has `fromEmployeeId` and `toEmployeeId` to represent 1:1 conversations. For group chat, every message belongs to a **run**, and `toEmployeeId` is no longer needed for display purposes (all messages are visible to everyone in the group).

```ts
// AiCollabMessage changes:
// - toEmployeeId becomes optional (only used internally for task_assignment routing)
// - Add: subAgentJobId?: string — links a result/blocker message to its sub-agent job
```

### 3.4 No "Team" Entity Needed

The "group" is implicitly the set of `orgEmployees`. The group chat is per-run — each run is one conversation started by the user. The sidebar shows runs, not employees.

## 4. UI Design

### 4.1 New InboxPage Layout

Replace the current "employee list + 1:1 chat" with "run list + group chat":

```
┌─────────────────┬─────────────────────────────────────────────┐
│   Conversations  │  ▼ CEO Coordinator Team                     │
│                  │  ─────────────────────────────────────────── │
│  ● 优化 Test项目 │  [User 10:32]                                │
│    CEO · 进行中  │  帮我看看怎么优化 Test 项目                    │
│                  │                                              │
│  ○ 修复登录Bug   │  [CEO 10:32]                                 │
│    已完成        │  好的，我来分析并分配任务...                    │
│                  │                                              │
│                  │  ┌─── 委派: 工程师 ──────────────────────┐   │
│                  │  │ 探索项目结构和技术栈                    │   │
│                  │  │ ● 进行中    [查看详情]                 │   │
│                  │  └────────────────────────────────────────┘   │
│                  │                                              │
│                  │  ┌─── 委派: 产品经理 ────────────────────┐   │
│                  │  │ 评估业务目标和需求                      │   │
│                  │  │ ○ 排队中                               │   │
│                  │  └────────────────────────────────────────┘   │
│                  │                                              │
│                  │  ┌─── ✅ 工程师 完成 ─────────────────────┐  │
│                  │  │ 项目是 React 19 + Vite 6 全栈应用...    │  │
│                  │  │ 修改了 3 个文件    [查看详情]            │  │
│                  │  └────────────────────────────────────────┘   │
│                  │                                              │
│                  │  [CEO 10:35]   ← streaming                   │
│                  │  综合团队反馈，优化方案如下: ...▌              │
│                  │                                              │
│                  ��� ┌─────────────���────────────────────────────┐ │
│                  │ │  输入消息...                        [发送]│ │
│                  │ └─────────────────────────���────────────────┘ │
└─────────────────┴─────────────────────────────────────────────┘
```

### 4.2 Sub-Agent Detail Panel

Clicking "查看详情" on a delegation card opens a slide-out panel (or right drawer):

```
┌───────────────────��─────────────────────┐
│ ← 返回    工程师 · 探索项目结构          │
│ 状态: ✅ 完成 · 耗时 45s                │
├────────────────────────────────────────���┤
│                                         │
│ ▶ Read src/package.json                 │
│   200 lines · 12ms                      │
│                                         │
│ ▶ Glob **/*.ts                          │
│   Found 47 files · 8ms                  │
│                                         │
│ ▶ Read src/App.tsx                      │
│   150 lines · 10ms                      │
│                                         │
│ ▶ Bash npm run build                    │
│   exit 0 · 3200ms                       │
│                                         │
│ ── 结果 ────────────────────────────── │
│ 项目是 React 19 + Vite 6 全栈应用，     │
│ 包含 47 个 TypeScript 文件...           │
│                                         │
└─────────────────────────────────────────┘
```

Each tool entry is collapsible — click to expand and see args/result detail.

### 4.3 Sidebar Changes

- **Current**: Lists employees, each with their own unread count
- **New**: Lists conversations (runs), each with status badge (running/done/blocked) and the run goal as title
- Keep a "New Conversation" button at top
- CEO/team info moves to the group chat header

## 5. Execution Flow Changes

### 5.1 User Sends Message

```
1. User types in group chat composer → "帮我优化 Test 项目"
2. Controller creates a new Run (or appends to existing)
3. Persist user message as AiCollabMessage { type: 'text', fromEmployeeId: undefined }
4. Trigger CEO agent loop: requestEmployeeReply(ceoEmployeeId, runId)
5. CEO streams response into group chat (single stream, displayed live)
```

### 5.2 CEO Delegates

```
6. CEO calls delegate_task tool → collab_action IPC event
7. Controller:
   a. Creates AiSubAgentJob { status: 'queued', ... }
   b. Creates delegation AiCollabMessage { type: 'task_assignment', subAgentJobId }
   c. Enqueues job into a processing queue
8. Delegation card appears in group chat immediately (status: queued)
```

### 5.3 Sub-Agent Execution

```
9. Sub-agent executor picks next queued job (FIFO or priority)
10. Updates job status → 'running', card in group chat updates
11. Runs employee agent loop with modified handlers:
    - onToolCall → append to job.toolLog (NOT streamed to group chat)
    - onToolResult → update last toolLog entry
    - onDelta → accumulate in job's internal text buffer (NOT streamed to group chat)
    - onDone → extract text-only result → set job.resultSummary
12. Updates job status → 'done'
13. Posts result AiCollabMessage { type: 'result', subAgentJobId } to group chat
14. Card in group chat updates to show ✅ with summary
15. Executor picks next queued job (if any)
```

### 5.4 All Sub-Agents Complete → CEO Summarizes

```
16. When all sub-agent jobs for the current delegation batch are done:
    a. Collect all result summaries
    b. Inject them as context into CEO's conversation history
    c. Re-trigger CEO agent loop to synthesize a final summary
17. CEO streams final summary into group chat
```

### 5.5 Sub-Agent Detail View

```
18. User clicks "查看详情" on any delegation/result card
19. Controller reads job.toolLog from the AiSubAgentJob
20. Detail panel renders the tool log entries
21. Each entry is collapsible: tool name + timing as header, args/result as body
```

## 6. Key Technical Changes

### 6.1 Files to Modify

| File | Change |
|------|--------|
| `shared/aiEmployeesSettings.ts` | Add `AiSubAgentJob`, `AiSubAgentToolEntry` types; extend `AiOrchestrationRun` with `subAgentJobs`; add `subAgentJobId` to `AiCollabMessage` |
| `src/aiEmployees/domain/orchestration.ts` | Add pure functions: `addSubAgentJob`, `updateSubAgentJob`, `appendToolLogEntry`; update `emptyOrchestrationState` |
| `src/aiEmployees/hooks/useAiEmployeesController.ts` | Major refactor: replace per-employee streaming with single-stream group chat; add sub-agent job queue; rewrite `handleCollabAction` for new flow; add sub-agent executor logic |
| `src/aiEmployees/pages/InboxPage.tsx` | Rewrite as GroupChatPage: sidebar shows runs, main area shows group timeline, delegation/result cards replace 1:1 messages |
| `src/aiEmployees/pages/SubAgentDetailPanel.tsx` | **NEW**: slide-out panel showing sub-agent tool log |
| `src/aiEmployees/AiEmployeesApp.tsx` | Wire new GroupChatPage; remove per-employee streaming props |
| `main-src/aiEmployees/employeeChat.ts` | Add new handler type for sub-agent mode: `onToolCall` records to work log instead of streaming |
| `main-src/ipc/register.ts` | Add `aiEmployees:runSubAgent` IPC handler (or modify existing); sub-agent mode records tool log and returns result, no streaming to renderer |
| `src/aiEmployees/aiEmployees.css` | New styles for group chat layout, delegation cards, result cards, detail panel |
| `src/i18n/messages.en.ts`, `messages.zh-CN.ts` | New i18n keys for group chat UI |

### 6.2 Files to Delete / Deprecate

None — the existing types and functions remain useful. We're changing the flow, not scrapping everything.

### 6.3 IPC Protocol Change

**Current**: Every employee streams deltas, tool calls, and collab actions individually via the same `async-shell:aiEmployeesChat` channel.

**New**: Two distinct modes:

1. **CEO streaming mode** (existing channel, same protocol):
   - CEO streams response to group chat
   - `delta` events render in real-time
   - `collab_action` events create sub-agent jobs

2. **Sub-agent batch mode** (new IPC handler `aiEmployees:runSubAgent`):
   - Runs employee agent loop to completion
   - Records tool calls in a structured log
   - Returns final result + tool log as one IPC response (no streaming)
   - Renderer updates the job status and posts result to group chat

```ts
// New IPC handler signature
ipcMain.handle('aiEmployees:runSubAgent', async (event, payload: SubAgentInput) => {
  // Returns when done — no streaming events
  return {
    ok: true,
    resultText: string,
    toolLog: AiSubAgentToolEntry[],
    durationMs: number,
  };
});
```

This eliminates the N concurrent streams problem entirely. Sub-agents run in the main process but don't send per-token IPC events. The renderer gets one message per completed job.

### 6.4 Concurrency Model

Sub-agents can technically run concurrently in the main process (multiple agent loops awaiting different LLM API calls). But we should limit concurrency to avoid API rate limiting:

```ts
// Sub-agent job queue with configurable concurrency
const SUB_AGENT_MAX_CONCURRENCY = 2; // run at most 2 sub-agents at once
```

This means:
- CEO delegates 3 tasks → jobs #1 and #2 start immediately, #3 queues
- When #1 finishes → #3 starts
- Group chat shows real-time status updates (running/queued/done) on cards

## 7. Implementation Phases

### Phase 1: Data Model & Domain Logic (no UI changes)

**Goal**: Add new types and pure state functions without breaking existing UI.

1. Add `AiSubAgentJob` and `AiSubAgentToolEntry` types to `shared/aiEmployeesSettings.ts`
2. Add `subAgentJobs: AiSubAgentJob[]` to `AiOrchestrationRun` (default `[]`)
3. Add `subAgentJobId?: string` to `AiCollabMessage`
4. Add pure functions to `orchestration.ts`:
   - `addSubAgentJobToRun(state, runId, job)`
   - `updateSubAgentJobInRun(state, runId, jobId, updater)`
   - `appendToolLogToJob(state, runId, jobId, entry)`
5. Update `emptyOrchestrationState` and any serialization helpers

**Estimated scope**: ~150 lines across 2 files. No UI breakage.

### Phase 2: Sub-Agent IPC Handler

**Goal**: Add `aiEmployees:runSubAgent` that runs an employee agent loop to completion, returning result + tool log.

1. Create `main-src/aiEmployees/subAgentRunner.ts`:
   - Reuses `runEmployeeChat` internals but captures tool calls into a log
   - No `onDelta` streaming — text accumulates in memory
   - Returns `{ resultText, toolLog, durationMs }`
2. Register `aiEmployees:runSubAgent` IPC handler in `register.ts`
3. Expose it via the preload bridge

**Estimated scope**: ~120 lines new file + ~30 lines in register.ts.

### Phase 3: Controller Refactor — Sub-Agent Executor

**Goal**: Replace the "auto-trigger requestEmployeeReply per delegation" pattern with a job queue.

1. Add sub-agent job queue to `useAiEmployeesController`:
   ```ts
   const subAgentQueueRef = useRef<AiSubAgentJob[]>([]);
   const activeSubAgentCountRef = useRef(0);
   ```
2. Rewrite `handleCollabAction` for `delegate_task`:
   - Create `AiSubAgentJob` and add to orchestration state
   - Enqueue into `subAgentQueueRef`
   - Call `processSubAgentQueue()` which picks next job, runs it via `shell.invoke('aiEmployees:runSubAgent', ...)`, updates state on completion
3. Remove old stagger logic and per-employee streaming for delegated tasks
4. Keep CEO streaming path unchanged (CEO still uses `aiEmployees:chat` with streaming)
5. After all jobs in a batch complete, optionally re-trigger CEO for summary

**Estimated scope**: ~200 lines modified in controller.

### Phase 4: Group Chat UI

**Goal**: Replace InboxPage's employee-list + 1:1 chat with run-list + group timeline.

1. **Sidebar**: Change from employee list to run (conversation) list
   - Each row: run goal as title, status badge, timestamp
   - "New Conversation" button
   - Sort by `lastEventAtIso` descending
2. **Chat thread**: Show all `collabMessages` for the selected run
   - User messages: right-aligned bubbles (same as current)
   - CEO text messages: left-aligned with CEO avatar
   - Delegation cards: full-width cards with employee avatar, task title, status indicator
   - Result cards: full-width cards with summary, "查看详情" button
   - Blocker cards: red-tinted cards with blocker description
3. **Streaming**: Only show streaming bubble for CEO (or whichever agent is currently speaking in the group)
4. **Composer**: Same as current — textarea + send button, triggers CEO
5. Update `listMessagesByEmployee` → `listMessagesByRun` (already exists at line 2210)

**Estimated scope**: ~400 lines InboxPage rewrite + ~100 lines CSS.

### Phase 5: Sub-Agent Detail Panel

**Goal**: Let user click into a delegation/result card to see full sub-agent work log.

1. Create `SubAgentDetailPanel.tsx` — a slide-out drawer or modal:
   - Header: employee name, task title, status, duration
   - Body: list of `AiSubAgentToolEntry` items, each collapsible
   - Collapsed: tool name + duration
   - Expanded: args (JSON pretty-printed) + result (truncated, expandable)
   - Footer: final result text
2. Add CSS for the panel (slide from right, 480px wide, overlays chat)
3. Wire into GroupChatPage: clicking "查看详情" on a card sets `selectedJobId` state → renders panel

**Estimated scope**: ~250 lines new component + ~100 lines CSS.

### Phase 6: CEO Auto-Summary After Delegation Batch

**Goal**: When all sub-agents finish, CEO synthesizes results.

1. In `processSubAgentQueue`, track "batch completion":
   - When all jobs for a given delegation wave are `done`
   - Collect result summaries
   - Inject as assistant-visible context (synthetic collabMessages)
   - Re-trigger CEO agent loop
2. CEO streams its summary into group chat as usual

**Estimated scope**: ~80 lines in controller.

### Phase 7: Polish & Migration

1. Migrate existing `collabMessages` data to work with group chat view (backward-compatible: messages without `subAgentJobId` still render as plain messages)
2. Remove dead code from old 1:1 inbox flow
3. Add i18n keys for all new UI strings
4. Test with 1, 2, 3, 5 employees delegated simultaneously
5. Performance validation: verify only 1 stream active at a time

## 8. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing orchestration data | Users lose conversation history | Phase 1 is additive — new fields default to `[]`/`undefined`, old data still renders |
| Sub-agent timeout | Job stuck in "running" forever | Add timeout (300s) to sub-agent runner; mark job as `error` on timeout |
| CEO doesn't delegate | User sees no sub-agent activity | Fallback: if CEO responds with plain text (no delegation), show it directly — same as current ask-mode |
| LLM API rate limiting with concurrent sub-agents | Jobs fail | `SUB_AGENT_MAX_CONCURRENCY = 2` caps parallel API calls |
| Large tool logs in memory | Memory pressure | Truncate tool results to 2000 chars in log entries; cap toolLog to 50 entries |

## 9. Success Criteria

- [ ] User sends message → CEO responds in group chat (single stream, no lag)
- [ ] CEO delegates → delegation cards appear in group chat with live status
- [ ] Sub-agents work in background (no streaming to UI during execution)
- [ ] Sub-agent completion → result card appears in group chat
- [ ] Clicking "查看详情" opens detail panel with full tool log
- [ ] All sub-agents done → CEO auto-summarizes
- [ ] Zero concurrent streams to the renderer during normal operation
- [ ] Backward-compatible with existing orchestration data
