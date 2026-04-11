# AI Team Collaboration - Execution Plan

> Goal: Let AI employees work like real colleagues — autonomously communicating, assigning tasks, and escalating approvals, all visible in a natural, human-readable UI.

---

## 1. Current State Assessment

### What's Already Built

| Layer | Status | Notes |
|-------|--------|-------|
| **Employee Persona System** | Done | role, mission, collaboration rules, handoff rules, nationality |
| **Orchestration Domain** | Done | Run/Handoff/Timeline model, state persistence |
| **Collaboration Messages** | Done | AiCollabMessage with types: text, task_assignment, handoff_request, status_update, blocker, approval_request, approval_response, result |
| **Inbox Chat (InboxPage)** | Done | Per-employee thread, message compose, streaming reply |
| **Orchestrator Page (OrchestratorPage)** | Done | Run list + handoff chain + timeline + approval — **user confusion point** |
| **Backend Task Queue** | Done | queued -> dispatched -> running -> completed/failed |
| **Backend Approval API** | Done | request-approval / approve / reject endpoints |
| **Backend Auto-Handoff** | Done | auto_handoff_agent_id, handoff_from_task_id |
| **WebSocket Broadcast** | Done | Per-workspace real-time events |
| **CEO Hiring Plan** | Done | LLM-driven team recruitment |

### Core Problems

1. **Runs Page (OrchestratorPage)** — 用户根本看不懂。三栏布局信息密度过高, handoff chain 是纯文字列表, timeline 事件堆砌, 对普通用户而言就是一堆技术日志。
2. **AI-to-AI Communication Not Autonomous** — 当前只有用户手动在 Inbox 给某个 AI 发消息, AI 回复。AI 之间不会主动互相沟通、指派任务。
3. **Inbox Only Has Chat** — 没有 "事务/任务" 的概念, 用户看不到 "张三指派给李四" 这种交互。
4. **Approval Flow Disconnected** — 后端有 approval API, 但前端没有将需审批的任务路由到用户的事务列表。
5. **No Unified Activity Feed** — 用户无法在一个地方看到所有 AI 之间的协作动态。

---

## 2. Target Experience

```
用户视角:

1. 用户在「事务」页面创建一个任务, 指派给产品总监 AI
2. 产品总监 AI 自动分析任务, 拆解为子任务
3. 产品总监 AI 自动在「事务」中创建子任务并指派给前端工程师 AI 和后端工程师 AI
4. 用户能在「动态」面板看到:
   - "产品总监 指派了任务「设计用户注册API」给 后端工程师"
   - "后端工程师 完成了任务「设计用户注册API」, 交付给 测试工程师"
   - "测试工程师 发现问题, 请求 后端工程师 协助"
5. 某个 AI 遇到需要用户决策的事项, 自动创建审批事务到用户的收件箱
6. 用户审批后, AI 继续执行

整个过程就像看真实团队在协作 — 有指派、有交付、有沟通、有审批。
```

---

## 3. Execution Plan

### Phase 1: Remove Runs Page, Merge Useful Bits into Inbox

**Goal:** 删除用户看不懂的 OrchestratorPage, 将有价值的功能融入 Inbox/Issues。

**Tasks:**

- [ ] **1.1** 从 `AiEmployeesApp.tsx` 的 tab 列表中移除 `runs`
- [ ] **1.2** 从路由/nav 中移除 OrchestratorPage 引用
- [ ] **1.3** 保留 `orchestration.ts` domain 逻辑 (Run/Handoff model 仍有用, 只删 UI)
- [ ] **1.4** 将 "创建 Run" 的能力迁移到 InboxPage — 用户发消息给某个 AI 时自动创建 run (当前已部分实现)
- [ ] **1.5** Git approval 功能迁移到 Issue Detail 或 Inbox 对话中 (作为一种审批卡片)

**Files to modify:**
- `src/aiEmployees/AiEmployeesApp.tsx` — remove runs tab
- `src/aiEmployees/pages/OrchestratorPage.tsx` — archive/delete
- `src/aiEmployees/hooks/useAiEmployeesController.ts` — keep orchestration logic, remove runs-specific UI state

---

### Phase 2: Redesign Inbox as "Conversations + Tasks" Hub

**Goal:** Inbox 不再只是聊天界面, 而是像飞书/Slack 一样的 "消息+事务" 统一入口。

**Tasks:**

- [ ] **2.1** Inbox 左侧栏改造:
  - 分为两个区域: **"对话"** (Conversations) 和 **"待办"** (Tasks/Approvals)
  - "对话" 区: 按 AI 员工分组的聊天线程 (保持现有)
  - "待办" 区: 需要用户处理的审批请求、被 AI 标记的 blocker、需决策的事项

- [ ] **2.2** 对话线程增强:
  - 在对话中显示 AI-to-AI 的交互卡片 (不只是 user<->AI 的 chat)
  - 卡片类型: 任务指派卡、交付报告卡、审批请求卡、协助请求卡
  - 每张卡片有明确的状态标签 (进行中/已完成/待审批/已阻塞)

- [ ] **2.3** 新增 "全部动态" (Activity Feed) 视图:
  - 时间线形式展示所有 AI 之间的交互
  - 每条动态: `[头像] 产品总监 → 后端工程师: 指派了「设计API」`
  - 可筛选: 按 AI 员工、按事务类型、按时间
  - 点击动态可跳转到对应的对话或事务详情

- [ ] **2.4** 审批流嵌入 Inbox:
  - 当 AI 请求审批时, 在用户的 "待办" 区创建审批卡片
  - 卡片内容: 谁请求的、为什么、相关上下文
  - 用户可直接在卡片内 "批准" / "驳回" / "回复意见"
  - 审批结果自动通知发起审批的 AI

**新增类型 (扩展 `AiCollabMessage`):**

```typescript
// 在对话中内嵌的结构化卡片
interface CollabCardMessage extends AiCollabMessage {
  type: 'task_assignment' | 'handoff_request' | 'approval_request' | 'approval_response' | 'result' | 'blocker';
  cardMeta: {
    issueId?: string;
    issueTitle?: string;
    handoffId?: string;
    status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'approved' | 'rejected';
    actionable?: boolean;   // 用户是否需要操作
    actions?: Array<{ label: string; action: string }>; // e.g. [{label:'批准', action:'approve'}]
  };
}
```

**Files to modify/create:**
- `src/aiEmployees/pages/InboxPage.tsx` — major refactor
- `src/aiEmployees/components/CollabCard.tsx` — new, 结构化卡片组件
- `src/aiEmployees/components/ActivityFeed.tsx` — new, 动态时间线
- `src/aiEmployees/components/ApprovalCard.tsx` — new, 审批卡片
- `shared/aiEmployeesSettings.ts` — extend message types

---

### Phase 3: AI Autonomous Collaboration Engine

**Goal:** AI 收到任务后, 能自主决定是否需要找其他 AI 协作, 并自动发起沟通和任务指派。

**Tasks:**

- [ ] **3.1** 扩展 Employee System Prompt, 注入协作能力:
  - 在 system prompt 中告诉 AI: "你是团队中的 XX 角色, 你的队友有 [列表]"
  - 明确每个队友的职责范围
  - 给出协作指令: "如果任务涉及 XX 领域, 你应该指派子任务给 YY"
  - 给出审批指令: "如果涉及 XX 决策, 你需要请求用户审批"

- [ ] **3.2** 定义 AI 可用的 "协作工具" (Function Calling / Tool Use):

  ```
  Tools available to each AI employee:
  
  1. assign_task(to_employee_id, title, description)
     — 将子任务指派给其他 AI 同事
  
  2. request_help(to_employee_id, question, context)
     — 向其他 AI 同事请求协助/咨询
  
  3. submit_result(summary, details, to_employee_id?)
     — 提交工作成果, 可选指定交付给谁
  
  4. request_approval(title, description, options?)
     — 向用户请求审批
  
  5. report_blocker(description, related_employee_ids?)
     — 报告阻塞问题
  
  6. send_message(to_employee_id, message)
     — 给某个同事发消息沟通
  ```

- [ ] **3.3** 后端 Executor 支持工具调用:
  - 在 `src/executor/llm.rs` 中将上述工具作为 function/tool 传给 LLM
  - 解析 LLM 的 tool_call 响应
  - 执行对应操作: 创建 task、发送 message、创建 approval request
  - 每次工具调用的结果广播到 WebSocket

- [ ] **3.4** 实现任务链 (Task Chain):
  - AI-A assign_task 给 AI-B → 后端自动创建 task for AI-B
  - AI-B 完成后 submit_result → 结果自动发回 AI-A
  - AI-A 汇总所有子任务结果, 生成最终交付
  - 整个链路的每一步都产生 CollabMessage, 在 Inbox 可见

- [ ] **3.5** 实现审批链路:
  - AI 调用 request_approval → 后端创建 approval inbox_item for user
  - 前端 Inbox "待办" 区显示审批卡片
  - 用户 approve/reject → 后端更新 task status → AI 继续或停止
  - 广播 approval_response event

**Backend files to modify:**
- `D:\RustroverProjects\async-agent-proxy\src\executor\llm.rs` — add tool definitions and tool_call parsing
- `D:\RustroverProjects\async-agent-proxy\src\executor\scheduler.rs` — handle tool execution results
- `D:\RustroverProjects\async-agent-proxy\src\http\handlers.rs` — new internal endpoints for AI-to-AI task creation

**Frontend files to modify:**
- `main-src/aiEmployees/employeeChat.ts` — inject team context into system prompt
- `src/aiEmployees/domain/orchestration.ts` — support AI-initiated runs/handoffs
- `src/aiEmployees/hooks/useAiEmployeesController.ts` — handle new WS events

---

### Phase 4: Visual Collaboration Dashboard

**Goal:** 用户能直观看到 AI 团队的协作全貌。

**Tasks:**

- [ ] **4.1** 在 Issues 页面增强 Issue 详情面板:
  - 显示该 Issue 关联的所有 AI 活动
  - 子任务列表及各自的执行 AI 和状态
  - 评论区显示 AI 的讨论内容 (来自 collab messages)

- [ ] **4.2** 在 Team (Employees) 页面增加状态概览:
  - 每个 AI 的当前状态: 空闲 / 执行中 / 等待协助 / 等待审批
  - 当前正在处理的任务
  - 最近的协作动态 (最近 3 条)

- [ ] **4.3** 新增 "团队协作" 看板视图 (可选, 放在原 Runs tab 位置):
  - 泳道图: 每个 AI 一行, 横轴是时间
  - 显示任务在 AI 之间的流转路径
  - 箭头连接表示指派/交付关系
  - 颜色编码: 绿=完成, 蓝=进行中, 黄=等待, 红=阻塞

**Files to create:**
- `src/aiEmployees/components/TeamStatusOverview.tsx` — team status cards
- `src/aiEmployees/components/IssueActivityPanel.tsx` — issue-level AI activity
- `src/aiEmployees/pages/CollaborationBoardPage.tsx` — optional swimlane view

---

### Phase 5: Runtimes Page Cleanup

**Goal:** Runtimes 页面对普通用户也没有实际意义, 考虑降级或隐藏。

**Tasks:**

- [ ] **5.1** 将 Runtimes 信息降级为 Settings 页面的一个子板块
- [ ] **5.2** 从主导航移除 Runtimes tab
- [ ] **5.3** 在 Settings 中以简洁的卡片形式展示: 运行环境名称、在线状态、连接的 AI 数量

**Files to modify:**
- `src/aiEmployees/AiEmployeesApp.tsx` — remove runtimes from main nav
- `src/aiEmployees/pages/ConnectionPage.tsx` — embed runtime info

---

## 4. Recommended Execution Order

```
Phase 1  (1-2 days)    — Remove Runs page, quick cleanup
    ↓
Phase 2  (3-5 days)    — Inbox redesign as conversation+task hub
    ↓
Phase 3  (5-7 days)    — AI autonomous collaboration (CORE, biggest value)
    ↓
Phase 4  (3-4 days)    — Visual enhancements
    ↓
Phase 5  (0.5 day)     — Runtimes cleanup
```

Phase 3 is the **most important** — it's what makes AI employees feel like "real colleagues" instead of chatbots. Phase 2 is the **prerequisite** for Phase 3 because it provides the UI surface where collaboration becomes visible.

---

## 5. Key Architecture Decisions

### 5.1 AI-to-AI Communication: Via Backend, Not Frontend

AI-to-AI 协作必须在后端 (async-agent-proxy) 完成, 不能依赖前端中转。

```
Current:  User → Frontend → IPC → Local Model → Response → Frontend
Target:   User → Backend Task Queue → AI-A executes → tool_call(assign_task)
          → Backend creates task for AI-B → AI-B executes → result back to AI-A
          → All events broadcast via WebSocket → Frontend displays
```

Reason: 前端可能不在线, AI 协作应该是异步的、后台运行的。

### 5.2 Tool Use vs Free-form Text

AI 之间的协作通过 **structured tool calls** 而非 free-form text。这确保:
- 每次协作动作都有确定的类型 (assign, help, approve, etc.)
- 后端可以可靠地解析和执行
- 前端可以渲染对应的卡片组件
- 不会出现 AI 输出 "我觉得应该找后端同事帮忙" 但实际什么都没发生的情况

### 5.3 Collaboration Context Window

每个 AI 在执行任务时, system prompt 中包含:
1. 自己的角色和职责 (persona)
2. 团队成员列表及各自职责
3. 当前任务的上下文 (issue description, parent task summary)
4. 可用工具列表
5. 协作规则 (什么时候该找谁, 什么时候该请求审批)

### 5.4 State of Truth

- **后端 PostgreSQL** 是所有协作状态的 source of truth
- **前端 orchestration state** 仅作为缓存/快速预览
- WebSocket 事件驱动前端状态更新
- 前端离线期间的事件通过 reconnect 后的 catch-up 同步

---

## 6. Data Flow: Complete Collaboration Cycle

```
[1] 用户创建 Issue "实现用户注册功能", 指派给产品总监

[2] 后端将 Issue 转为 Task, 入队列
    → agent_task_queue: { agent=产品总监, status=queued }
    → WS broadcast: issue:assigned

[3] Executor 拾取任务, 调用产品总监 LLM
    → System prompt: 你是产品总监, 团队有 [前端, 后端, 测试]...
    → User message: 请处理 Issue "实现用户注册功能"
    → LLM response: [tool_call: assign_task(后端工程师, "设计注册API", "...")]
                    [tool_call: assign_task(前端工程师, "实现注册页面", "...")]

[4] 后端执行 tool calls:
    → 创建子 task for 后端工程师
    → 创建子 task for 前端工程师
    → 创建 CollabMessage: 产品总监 → 后端工程师 (task_assignment)
    → 创建 CollabMessage: 产品总监 → 前端工程师 (task_assignment)
    → WS broadcast: task:assigned x2, collab:message x2

[5] 前端 Inbox 实时更新:
    → "全部动态" 出现两条: 产品总监指派了任务给后端/前端
    → 用户点击可查看详情

[6] 后端工程师 AI 拾取任务, 执行, 完成
    → LLM response: [tool_call: submit_result("API设计完成", details)]
    → 后端更新 task status = completed
    → CollabMessage: 后端工程师 → 产品总监 (result)
    → WS broadcast

[7] 前端工程师 AI 执行中遇到问题
    → LLM response: [tool_call: request_help(后端工程师, "注册API的参数格式?")]
    → CollabMessage: 前端工程师 → 后端工程师 (text)
    → 后端自动创建临时 task for 后端工程师回答问题
    → WS broadcast

[8] 产品总监收到所有子任务结果, 需要用户确认
    → LLM response: [tool_call: request_approval("用户注册方案确认", summary)]
    → 后端创建 inbox_item for user
    → 前端 Inbox "待办" 区出现审批卡片
    → WS broadcast

[9] 用户在 Inbox 审批通过
    → 后端更新 approval status
    → 通知产品总监 AI
    → 产品总监 AI 生成最终报告
```

---

## 7. Inbox UI Wireframe (Phase 2)

```
┌─────────────────────────────────────────────────────────────────┐
│  ◀ Workspace ▸ Inbox                                     🔄    │
├──────────────────┬──────────────────────────────────────────────┤
│                  │                                              │
│  ── 待办 (2) ──  │  💬 与 后端工程师 的对话                      │
│                  │                                              │
│  🔴 审批: 注册方案 │  ┌──────────────────────────────────────┐   │
│  🟡 决策: 技术选型 │  │ 📋 任务指派                            │   │
│                  │  │ 产品总监 → 后端工程师                    │   │
│  ── 对话 ──      │  │ 「设计用户注册 API」                     │   │
│                  │  │ 状态: ✅ 已完成                          │   │
│  产品总监    (3) │  └──────────────────────────────────────┘   │
│  后端工程师  (1) │                                              │
│  前端工程师  (2) │  后端工程师: API 设计已完成, 包含以下接口...   │
│  测试工程师      │                                              │
│  运维工程师      │  ┌──────────────────────────────────────┐   │
│                  │  │ 🤝 协助请求                            │   │
│  ── 全部动态 ──  │  │ 前端工程师 → 后端工程师                  │   │
│                  │  │ "注册API的请求参数格式是什么?"           │   │
│  ⊙ 动态时间线    │  │ 状态: 💬 待回复                         │   │
│                  │  └──────────────────────────────────────┘   │
│                  │                                              │
│                  │  后端工程师: 请求体为 JSON, 字段如下...       │
│                  │                                              │
│                  │  ┌──────────────────────────────────────┐   │
│                  │  │ 📦 工作交付                            │   │
│                  │  │ 后端工程师 → 产品总监                    │   │
│                  │  │ 「注册API设计」已完成                    │   │
│                  │  │ 3 个接口 · 12 个字段 · 含错误码定义      │   │
│                  │  └──────────────────────────────────────┘   │
│                  │                                              │
│                  │  ┌──────────────────────────────────┐       │
│                  │  │ 输入消息...                  发送 │       │
│                  │  └──────────────────────────────────┘       │
└──────────────────┴──────────────────────────────────────────────┘
```

---

## 8. Activity Feed Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  全部动态                            筛选: [全部 ▾] [今天 ▾] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  14:32  🧑‍💼 产品总监 → 🔧 后端工程师                         │
│         指派任务「设计用户注册 API」                           │
│                                                             │
│  14:33  🧑‍💼 产品总监 → 🎨 前端工程师                         │
│         指派任务「实现注册页面」                               │
│                                                             │
│  14:45  🎨 前端工程师 → 🔧 后端工程师                         │
│         请求协助: "注册API的请求参数格式?"                     │
│                                                             │
│  14:47  🔧 后端工程师 → 🎨 前端工程师                         │
│         回复了协助请求                                        │
│                                                             │
│  15:01  🔧 后端工程师 → 🧑‍💼 产品总监                         │
│         交付了「设计用户注册 API」✅                           │
│                                                             │
│  15:20  🎨 前端工程师 → 🧑‍💼 产品总监                         │
│         交付了「实现注册页面」✅                               │
│                                                             │
│  15:22  🧑‍💼 产品总监 → 👤 你                                 │
│         请求审批「用户注册方案确认」⏳                         │
│         [查看详情] [批准] [驳回]                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM 不稳定导致 tool_call 解析失败 | AI 无法协作 | 设计 fallback: 解析失败时将原文作为 text message 保存, 不丢失上下文 |
| AI 死循环互相指派 | 资源浪费 | 限制任务链深度 (max 5 hops), 设置单任务超时 |
| AI 产出质量不可控 | 用户体验差 | Phase 1 先实现人工介入点: 关键节点自动请求审批 |
| WebSocket 断连丢事件 | 前端状态不一致 | 重连后做一次全量 sync (已有 refresh 机制) |
| 后端 Executor 未启用 | 协作功能不可用 | 前端检测 executor 状态, 未启用时显示引导 |

---

## 10. Out of Scope (Future)

- AI 代码执行 (actual git operations, file edits) — 需要 sandbox 方案
- 多工作区跨团队协作
- AI 学习/记忆 (长期记忆跨 task)
- 自然语言 @mention 语法 (e.g., "@后端工程师 帮我看看这个API")
- IM bridge 实际集成 (Telegram/Feishu/Discord)
