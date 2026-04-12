# AI Employees 协同开发团队 - 现状分析与实施计划

> 最后更新：2026-04-10

---

## 一、当前架构总览

```
用户
  ├── IDE 工作区 (Electron Renderer)
  │     └─ AiEmployeesApp → useAiEmployeesController (1800+ 行)
  │           ├─ OrchestratorPage（Run/Handoff 管理）
  │           ├─ EmployeesPage（团队花名册）
  │           ├─ IssuesHubPage / InboxPage
  │           └─ RuntimePage / ConnectionPage
  │
  ├── async-agent-proxy (远端后端)
  │     ├─ REST API: /api/employees, /api/issues, /api/tasks, /api/bootstrap ...
  │     ├─ WebSocket: 49 种事件类型实时推送
  │     └─ 存储: 组织、员工、Issue、Task、Runtime 等
  │
  └── 外部 IM（飞书 / Telegram / Discord）
        └─ chatBridge.ts  ← 目前是 placeholder，永远返回 'disconnected'
```

### 两套并行的 Agent 系统

| 维度 | 本地 Agent Loop | AI Employees |
|------|----------------|--------------|
| 入口 | IDE 对话框 Composer | AiEmployeesApp 页面 |
| 执行 | `main-src/agent/agentLoop.ts` 多轮工具循环 | async-agent-proxy 远端 Task |
| 模型 | 直接走 LLM Adapter (Anthropic/OpenAI/Gemini) | `modelSource: local_model / remote_runtime / hybrid` |
| 状态 | Thread 本地 JSON | Run → Handoff → Timeline 状态机 |
| 工具 | Read/Write/Edit/Bash/Glob/Grep/LSP/MCP | 远端 Skill / Runtime 定义 |

**核心问题：两套系统没有打通。** 本地 Agent Loop 不知道 Employee 的存在，Employee 也调不动本地 Agent Loop。

---

## 二、现存问题分析

### 问题 1：执行层断裂 — Employee 有身份没有手脚

AI Employee 目前拥有完整的"身份系统"（persona、collaboration contract、handoff rules），也有完整的"管理系统"（Run → Handoff 状态机），但缺少**执行绑定**：

- 本地模式下（`modelSource: 'local_model'`）：没有代码把 Employee 的 system prompt + persona 注入本地 `agentLoop`，也没有触发 agentLoop 为某个 Employee 执行任务的入口。
- 远端模式下（`modelSource: 'remote_runtime'`）：依赖 async-agent-proxy 的 Task 系统，但客户端只做事件监听（`taskEvents.ts`），**无法从 IDE 侧主动 dispatch task 给指定 Employee**。
- 混合模式（`hybrid`）：概念存在但无任何实现路径。

### 问题 2：IM 桥接全是空壳

`chatBridge.ts` 只有类型定义和 `probeChatBridge()` 硬返回 `'disconnected'`。实际的 IM 集成需要：

- 飞书：App Bot + Event Subscription（HTTP 回调）
- Telegram：Bot API + Webhook / Long Polling
- Discord：Bot + Gateway / Interactions

这些都是**服务端行为**，不应该在 Electron Renderer 里实现。但当前架构里 `async-agent-proxy` 似乎也没有 IM 集成的 API。

### 问题 3：模型路由三源歧义

三个地方可以绑定模型，优先级不明确：
1. `employeeLocalModelIdByEmployeeId` — 按 Employee 绑定
2. `agentLocalModelIdByRemoteAgentId` — 按远端 Agent 绑定
3. settings 默认模型

`resolveEmployeeLocalModelId()` 做了优先级处理（employee > agent > default），但 UI 上用户可能不理解这个 fallback 链，也没有地方可以直观看到"这个 Employee 实际用的是哪个模型"。

### 问题 4：编排状态机缺少"执行触发"

`orchestration.ts` 是纯状态管理（pure state transitions），做得很好。但它只是一个"账本"：
- `createDraftRun()` → 创建 Run
- `addHandoff()` → 加入 Handoff
- `setHandoffStatusInState()` → 更新状态

**没有人真正"跑"这个 Run。** 状态从 `draft → running` 依赖手动操作，Handoff 从 `pending → in_progress` 要么手动，要么靠远端事件。缺一个 **Orchestrator Engine** 来驱动执行。

### 问题 5：useAiEmployeesController 单一巨型 Hook

1800+ 行的 hook 承载了：连接管理、workspace 选择、bootstrap 状态、员工列表、issue 列表、task 列表、orchestration 状态、runtime 查询、模型绑定……耦合严重，和主 App.tsx 的"8500行问题"如出一辙。

### 问题 6：消息流单向 — 只"听"不"说"

- WebSocket 客户端只做 `on(event, handler)` 监听
- 没有从 IDE 侧**向 Employee 发消息/发指令**的通道
- 没有 Employee 之间互相通信的机制
- `AiCollabMessage` 的 `task_assignment` / `handoff_request` 类型存在但从未被创建过

---

## 三、目标架构

```
                        ┌──────────────────────────────┐
                        │     async-agent-proxy        │
                        │  (中枢 / Message Broker)      │
                        │                              │
                        │  ┌─────────────────────────┐ │
                        │  │   IM Gateway Service     │ │
                        │  │  Feishu / TG / Discord   │ │
                        │  │  Bot 注册 + Webhook 接收  │ │
                        │  └────────┬────────────────┘ │
                        │           │                  │
                        │  ┌────────▼────────────────┐ │
                        │  │   Message Router         │ │
                        │  │  消息归一化 + 意图识别     │ │
                        │  │  → 路由到目标 Employee    │ │
                        │  └────────┬────────────────┘ │
                        │           │                  │
                        │  ┌────────▼────────────────┐ │
                        │  │   Task Dispatcher        │ │
                        │  │  Employee → Execution    │ │
                        │  │  local / remote / hybrid │ │
                        │  └────────┬────────────────┘ │
                        │           │                  │
                        └───────────┼──────────────────┘
                                    │
               ┌────────────────────┼────────────────────┐
               │                    │                    │
       ┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
       │  IDE Client   │   │  飞书 Bot      │   │  TG/Discord   │
       │  (Electron)   │   │  Webhook      │   │  Bot          │
       │               │   │               │   │               │
       │ Local Agent   │   │  用户在飞书里   │   │  用户在 TG 里  │
       │ Loop 执行     │   │  @员工聊天     │   │  @员工聊天     │
       └───────────────┘   └───────────────┘   └───────────────┘
```

**核心变化：async-agent-proxy 升级为 Message Broker + Task Dispatcher 中枢，所有渠道的消息统一汇入、统一路由、统一执行。**

---

## 四、实施计划

### Phase 0：基础整理（预计 1 周）

> 目标：清理现有代码，为后续开发打好基础

#### 0.1 拆分 useAiEmployeesController

将 1800+ 行的巨型 hook 拆为独立模块：

| 新 Hook | 职责 |
|---------|------|
| `useAiConnection` | 连接管理、token、workspace 选择 |
| `useAiBootstrap` | Onboarding 状态机 |
| `useAiEmployeeList` | 员工 CRUD、avatar |
| `useAiIssues` | Issue 列表、创建、筛选 |
| `useAiOrchestration` | Run/Handoff 状态、timeline、collabMessages |
| `useAiRuntimes` | Runtime/Agent 查询 |
| `useAiModels` | 模型绑定、路由解析 |

#### 0.2 统一模型路由展示

- 在 Employee 卡片上显示"实际使用模型"（resolved model），而非只展示绑定关系
- 增加 `resolvedModelId` 计算属性，UI 统一读取

#### 0.3 补全 TypeScript 类型

- `OrgEmployee.capabilities` 当前是 `unknown`，改为 `string[]`
- WebSocket 事件 payload 增加泛型约束

---

### Phase 1：本地执行绑定（预计 2 周）

> 目标：让 Employee 能通过本地 Agent Loop 执行任务

#### 1.1 Employee Execution Adapter

创建 `src/aiEmployees/adapters/executionAdapter.ts`：

```typescript
// 伪代码
type EmployeeExecutionRequest = {
  employeeId: string;
  goal: string;              // 任务描述
  systemPrompt: string;      // 含 persona + collaboration rules
  modelId: string;           // 解析后的模型 ID
  workspacePath: string;
  tools: ToolDefinition[];   // 该 Employee 可用的工具子集
  runId?: string;
  handoffId?: string;
};

type EmployeeExecutionResult = {
  success: boolean;
  summary: string;
  artifacts?: string[];      // 修改的文件列表
};
```

#### 1.2 IPC 通道：Renderer → Main → agentLoop

新增 IPC channel `ai-employee:execute`：

1. Renderer 侧发送 `EmployeeExecutionRequest`
2. Main 侧：
   - 从 Employee persona 构建 system prompt
   - 注入 collaboration rules 和 handoff rules
   - 用 `resolveEmployeeLocalModelId()` 获取模型
   - 创建 agentLoop 实例（类似 subagent profile）
   - 执行并将流式进度通过 IPC 回传
3. 完成后更新 Handoff 状态

#### 1.3 Employee System Prompt 组装

```
[Base Template Prompt]          ← OrgPromptTemplate.systemPrompt
[Persona Seed]                  ← nationalityCode + speaking style
[Job Mission]                   ← personaSeed.jobMission
[Domain Context]                ← personaSeed.domainContext
[Collaboration Rules]           ← personaSeed.collaborationRules
[Handoff Rules]                 ← personaSeed.handoffRules
[Current Task Context]          ← Run goal + Handoff note
[Workspace Info]                ← git branch, recent changes
```

#### 1.4 Employee Tool Scoping

不同角色的 Employee 可用工具不同：
- **Frontend Dev**: Read/Write/Edit + Glob/Grep + Bash (npm/vite) + LSP
- **Backend Dev**: Read/Write/Edit + Glob/Grep + Bash (全量) + LSP
- **Code Reviewer**: Read + Glob/Grep + Bash (只读命令)
- **PM / Designer**: Read + Glob + 只看不改

根据 `capabilities[]` 字段映射工具子集。

---

### Phase 2：编排引擎（预计 2 周）

> 目标：自动驱动 Run 的执行流转

#### 2.1 Orchestrator Engine

创建 `src/aiEmployees/engine/orchestratorEngine.ts`：

```
Run (draft)
  ↓ start()
Run (running) → 取第一个 pending Handoff
  ↓ dispatch()
Handoff (in_progress) → 调用 Execution Adapter
  ↓ onComplete()
Handoff (done) → 自动激活下一个 pending
  ↓ 全部完成
Run (awaiting_approval) → 等待人工 review
  ↓ approve() / reject()
Run (completed / cancelled)
```

关键能力：
- **顺序执行**：Handoff 按顺序逐个执行
- **并行执行**（可选）：标记为可并行的 Handoff 同时启动
- **阻塞处理**：Handoff blocked 时暂停，通知管理者
- **超时处理**：单个 Handoff 超时自动标记 blocked

#### 2.2 Handoff 间上下文传递

前一个 Handoff 的 `resultSummary` + 产出文件变更作为下一个 Handoff 的输入 context：

```
Handoff A (Frontend Dev):
  result: "Created LoginForm component at src/components/LoginForm.tsx"
  artifacts: [src/components/LoginForm.tsx, src/styles/login.css]
      ↓
Handoff B (Code Reviewer):
  context: "Review the LoginForm component created in previous step"
  focus_files: [src/components/LoginForm.tsx, src/styles/login.css]
```

#### 2.3 人机协作节点

在关键节点插入人工审批：
- Git commit/push 前
- 跨 Employee handoff 时（可选）
- Task 完成时的结果 review

通过 `approvalState` 状态机 + IDE 通知 + IM 消息推送。

---

### Phase 3：IM 网关集成（预计 3 周）

> 目标：通过飞书/TG/Discord 与 Employee 聊天交互

#### 3.1 架构决策：IM 集成放在 async-agent-proxy 侧

**不在 Electron 客户端做 IM 集成**，原因：
- Bot 需要长连接 / Webhook 接收，桌面应用不能保证在线
- 多用户场景下 Bot 应该是单实例服务
- 消息持久化和审计需要服务端

#### 3.2 async-agent-proxy 新增 IM Gateway Module

```
async-agent-proxy
  └── /im-gateway
        ├── feishu/
        │     ├── bot.ts          ← 飞书 App Bot 注册
        │     ├── eventHandler.ts ← Event Subscription 处理
        │     └── sender.ts       ← 主动发消息给用户
        ├── telegram/
        │     ├── bot.ts          ← Telegram Bot API
        │     ├── webhook.ts      ← Webhook / Long Polling
        │     └── sender.ts
        ├── discord/
        │     ├── bot.ts          ← Discord Bot Gateway
        │     ├── interactions.ts ← Slash commands / Interactions
        │     └── sender.ts
        └── router.ts             ← 统一消息路由
```

#### 3.3 消息路由规则

```
用户在飞书 @李明（前端工程师）：
  "帮我看一下 LoginForm 的样式问题"

IM Gateway 收到消息:
  1. 识别目标 Employee: 李明 (employee_id: "emp_liming")
  2. 查 chatAccounts: { provider: 'feishu', handle: 'liming_bot' }
  3. 构建 EmployeeExecutionRequest
  4. 判断 modelSource:
     - local_model → 通过 WebSocket 通知 IDE 客户端执行
     - remote_runtime → 直接 dispatch 到远端 Runtime
     - hybrid → 优先尝试本地，fallback 到远端
  5. 执行结果通过 IM Gateway 回复到飞书
```

#### 3.4 IDE 侧配合

- `chatBridge.ts` 升级为与后端 IM Gateway 交互的客户端
- 新增 `ChatAccountManager` UI，管理每个 Employee 的 IM 账号绑定
- WebSocket 新增事件：`chat:incoming`（IM 消息到达）、`chat:reply`（回复完成）
- IDE 内可查看 IM 聊天记录（只读同步）

#### 3.5 IM 交互模式设计

**直接对话模式：**
```
用户: @前端-李明 帮我实现一个暗色主题切换
李明: 好的，我来看看当前的主题系统... [开始执行]
李明: 已完成暗色主题实现，修改了以下文件：
     - src/theme/dark.ts (新建)
     - src/App.tsx (引入主题切换)
     需要你确认后我再提交 commit。
用户: 看起来不错，提交吧
李明: 已提交到 feat/dark-theme 分支 ✓
```

**任务下发模式：**
```
用户: /task 实现用户登录功能
     分配: 后端-张工(API) → 前端-李明(UI) → 测试-王芳(E2E)
系统: Run #12 已创建，包含 3 个 Handoff
     [1] 张工: 设计登录 API → 进行中
系统: [1] 张工完成，产出: POST /api/login, JWT token
     [2] 李明: 实现登录 UI → 进行中
系统: [2] 李明完成，产出: LoginPage + AuthContext
     [3] 王芳: E2E 测试 → 进行中
系统: [3] 王芳完成，3/3 测试通过
     Run #12 等待审批
```

---

### Phase 4：Employee 间协作（预计 2 周）

> 目标：Employee 之间可以自主协作

#### 4.1 Employee-to-Employee 消息通道

当 Employee A 在执行中遇到需要 Employee B 协助的情况：

```typescript
// 新增 tool: RequestColleagueHelp
{
  name: 'request_colleague_help',
  description: '向团队其他成员请求协助',
  parameters: {
    colleague_role: string,  // 或 colleague_id
    question: string,
    context: string,
    urgency: 'blocking' | 'nice_to_have'
  }
}
```

执行流程：
1. Employee A 调用 `request_colleague_help`
2. Orchestrator 找到匹配的 Employee B
3. 创建子 Handoff 给 B
4. B 执行后结果返回给 A 的上下文
5. A 继续执行

#### 4.2 共享工作记忆

Employee 执行过程中的关键决策和发现写入共享 memory：

```typescript
type SharedWorkMemory = {
  runId: string;
  entries: Array<{
    employeeId: string;
    key: string;         // e.g., "api_schema", "design_decision"
    value: string;
    createdAtIso: string;
  }>;
};
```

后续 Employee 执行时注入相关 memory 到 context。

#### 4.3 代码冲突协调

多 Employee 并行修改代码时：
- 每个 Employee 工作在独立 git worktree 或分支
- Orchestrator 在 Handoff 完成后自动 merge
- 冲突时创建 `blocker` 类型的 CollabMessage，暂停并通知

---

### Phase 5：稳定化与体验打磨（预计 2 周）

#### 5.1 可观测性

- Run/Handoff 执行的实时日志流
- Token 消耗统计（按 Employee、按 Run）
- 执行耗时监控
- 错误率和重试统计

#### 5.2 模板化 Run

常见开发流程做成模板：
- "Feature 开发" → 后端 → 前端 → 测试 → Review
- "Bug 修复" → 定位 → 修复 → 测试
- "重构" → 分析 → 实施 → Review

#### 5.3 权限与安全

- Employee 的文件系统访问范围限制
- Bash 命令白名单（按角色）
- IM 消息内容审计
- 敏感操作（删除文件、force push）需人工确认

#### 5.4 离线模式

- IDE 离线时 IM 消息排队
- 恢复在线后自动 sync 并恢复执行
- local_model Employee 离线可用，remote_runtime 标记为不可用

---

## 五、优先级排序建议

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
基础整理    本地执行    编排引擎    IM 网关     E2E 协作
(1 周)     (2 周)     (2 周)     (3 周)      (2 周)

                                        ↓
                                   Phase 5
                                   稳定打磨
                                   (2 周)
```

**建议先做 Phase 0 + 1**，因为：
1. 不依赖 async-agent-proxy 改动，纯客户端工作
2. 做完后 Employee 就能在 IDE 内真正执行任务，形成闭环
3. Phase 2 的编排引擎是 Phase 3 IM 集成的前提
4. Phase 3 需要 async-agent-proxy 侧配合开发

---

## 六、关键设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| IM 集成放在哪里 | async-agent-proxy 服务端 | 桌面应用无法保证在线，Bot 需要常驻 |
| Employee 执行方式 | 复用现有 agentLoop + persona 注入 | 避免重复造轮子，现有 tool 生态直接可用 |
| 消息路由中枢 | async-agent-proxy 统一路由 | 单一真相源，避免 IDE/IM 双写不一致 |
| Employee 并行执行 | Git worktree 隔离 | 避免文件冲突，merge 由 Orchestrator 控制 |
| 状态机管理 | 保持现有纯函数模式 | orchestration.ts 设计良好，继续扩展即可 |

---

## 七、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| agentLoop 单实例限制 | 多 Employee 并行受阻 | 支持多 agentLoop 实例，每个跑在独立 worker 或 fork |
| IM 平台 API 变更 | 集成失效 | 抽象 adapter 层，隔离平台差异 |
| Token 消耗失控 | 成本飙升 | 按 Employee / Run 设置 token budget，超限暂停 |
| 上下文窗口不足 | 复杂任务执行质量下降 | handoff 间传递精炼摘要而非全量上下文 |
| useAiEmployeesController 重构风险 | 引入 regression | 拆分前补全测试覆盖 |
