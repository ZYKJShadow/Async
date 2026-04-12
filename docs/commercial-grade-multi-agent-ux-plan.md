# Commercial-Grade Multi-Agent UX Plan

目标：把现有的群聊式多 agent 协作从"能用"升级到"像 Cursor/Devin 那种商业产品"的质感。以下是差距分析、目标 UX 原则、和分阶段执行方案。

---

## 1. 差距分析（现状 vs 商业级）

| 维度 | 现状 | 商业级标杆（Cursor/Devin/Claude Code） |
|---|---|---|
| **整体进度感知** | 只能看到每个 job 的状态；整个 run 没有全局进度条 | 顶部有 run header：目标 + elapsed + "3/5 已完成" + 停止按钮 |
| **计划可见性** | CEO 的"分配 → 收集 → 综合"三段隐式，用户只看见结果 | 上来先出 todo list，条目随子任务完成自动勾选 |
| **子 agent 活性** | 子 agent 批处理 IPC，点开卡片才能看；完成前用户只看到"running" | 即使不做真流式，也应显示当前正在执行的 tool 名（"Reading package.json..."） |
| **工具调用密度** | 每个工具调用一行卡片，带 pill + summary + 时间 + 展开按钮 | 一行紧凑 row：图标 + 工具名 + 目标（路径/命令片段） + 可选 hover 展开 |
| **产出物（artifact）呈现** | 结果是纯文本 summary | 修改文件 → 文件 chip 列表；命令 → 代码块；链接 → 可点击 |
| **控制反馈回路** | 只能等、看；无法中途停止某个子 agent、重试、跳过 | 每个 job 有 Stop/Retry/Skip；run 级有 Pause/Abort/Approve |
| **消息层级** | CEO 消息、子 agent 消息、工具事件混排，视觉权重差不多 | CEO 综合结论视觉上最重，中间态退居次要，细节折叠 |
| **侧边栏信息** | 只有 run 标题 + 预览行 | 每条 run 显示当前活动 agent 的头像 + 行为（"工程师 正在读取…"）|
| **思考指示** | 只有 CEO 流式；子 agent 无任何活性 | 所有活跃 agent 都应有呼吸点或 tool 进行中提示 |
| **错误恢复** | 失败后进入 error 状态，digest 扫到后 CEO 总结；用户无控制 | 失败的卡片内联出现"重试 / 换人 / 跳过"操作 |
| **动效与稳定性** | 新卡片直接跳入，时间线重排 | 新项目 fade-in，已有项不跳动；auto-scroll 只在贴底时生效 |

## 2. 目标 UX 原则

1. **先计划，再执行** — 任何多步任务的第一响应都是一个 todo 列表；其余动作挂在 todo 条目下面。
2. **永远在场** — 用户在任何时刻都知道"现在谁在做什么、还剩多少"。没有静默的 5 秒钟。
3. **信息密度最高的是上下文** — 工具调用、文件改动等细节用一行 row 承载；结论用加粗大字或卡片强调。
4. **一切可中断** — 每个进行中的单位（run / job / tool call）都能被用户打断或修改。
5. **回放友好** — 完成的 run 是一份可阅读的报告，不需要展开就能看懂主线。

## 3. 架构调整（最小侵入）

### 3.1 新增数据模型

`shared/aiEmployeesSettings.ts`：

```ts
export type AiRunPlanItem = {
  id: string;               // plan item id，CEO 生成
  runId: string;
  title: string;             // "Explore project structure"
  ownerEmployeeId?: string;  // 指派给谁（可空，表示 CEO 自己）
  subAgentJobId?: string;    // 与 job 的关联；一个 item 可对应 0 或 1 个 job
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';
  note?: string;
  createdAtIso: string;
  completedAtIso?: string;
};

export type AiOrchestrationRun = {
  // ...existing
  plan?: AiRunPlanItem[];
  planSource?: 'ceo' | 'user';  // 谁生成的 plan
};
```

### 3.2 CEO 新 collab tool：`draft_plan`

在 `buildEmployeeChatPayload` 的 system prompt 里给 CEO 一个新工具：

```
draft_plan(items: Array<{ title: string; ownerEmployeeName?: string }>)
```

CEO 收到用户消息后，**在任何 delegate_task 之前**先调用一次 `draft_plan`。UI 立即渲染 todo 列表。

- `delegate_task` 如果带上 `planItemId`，则自动把 job 绑到该 item，UI 上该行打钩顺序严格按 item 顺序。
- 没有 plan 的快速问答（单句闲聊）CEO 可以直接 `submit_result` 跳过 plan。

### 3.3 活性探针（presence）

新增 `activeStreamOwnerRef` 已有；再加一个：

```ts
const employeeLiveStatusRef = useRef<Record<string, { runId: string; label: string; sinceIso: string }>>({});
```

在 `processSubAgentQueue` 中每次 `tool_start` IPC 事件更新 label（如 `Read: src/foo.ts`）；job 完成时清理。UI 订阅该 ref 做 re-render（用一个专用 tick state 触发）。

### 3.4 IPC 事件扩展

`main-src/aiEmployees/subAgentRunner.ts`：

- 当前子 agent 只在结束时回包一次；需要追加一条 `aiEmployees:subAgentEvent` 推流：`{ requestId, kind: 'tool_start' | 'tool_end', toolName, summary }`。
- 节流：每个子 agent 最多 5Hz，主进程 50ms batch，和现有 CEO 流式 batch 复用同一机制。
- 事件只用于 UI 指示，不进入持久化（避免磁盘压力）。

## 4. UI 改造

### 4.1 Run Header（新增）

`src/aiEmployees/components/RunHeaderBar.tsx`：

```
┌──────────────────────────────────────────────────────────────┐
│ 🎯 帮我优化 Test 项目                                         │
│ ⏱ 01:23   ●●●○○  3 / 5 完成                                  │
│   [ ⏸ Pause ]  [ ■ Stop ]  [ ✓ Approve result ]               │
└──────────────────────────────────────────────────────────────┘
```

- 放在 `InboxPage.tsx` 右侧聊天区顶部，sticky。
- 进度点来自 `run.plan`；没有 plan 时退化为 "N jobs in progress"。
- Stop = 把 pendingEmployeeChatRef 的所有 requestId 发给 main 取消；job 队列清空；已运行的让其完成。

### 4.2 Plan Card（新增，最抢眼）

`src/aiEmployees/components/RunPlanCard.tsx`：

```
┌────────────────────────────────────────────────┐
│ 📋 Plan                                         │
│ ✅ 1. Explore project structure  — 工程师        │
│ ✅ 2. Evaluate business goals     — 产品经理     │
│ 🔄 3. Draft optimization plan     — CEO (自己)   │
│ ⬜ 4. Review with team                           │
│ ⬜ 5. Finalize summary                           │
└────────────────────────────────────────────────┘
```

- 放在 run 消息流最前面（作为第一条 assistant 消息，pinned）。
- 每一行点击 → 滚动/高亮到对应的 job 卡片（或展开 in-place）。
- 状态图标变更时做 200ms 勾选动效。

### 4.3 压缩 SubAgentExecutionCard

现有卡片高度偏大（avatar + 两行 meta + 任务标题 + 描述 + 时间线 wrap）。目标：

**默认态（折叠）**：一行

```
🤖 工程师 · Exploring project structure       [▶ Running · 3 tools]  >
```

**展开态**：保留现有时间线行，但每一行更紧凑：

```
  🔍 Grep   pattern "useEffect"  — 12ms       ▶
  📄 Read   src/App.tsx          — 8ms
  💡 submit_result  项目基于 React + Vite…
```

实现：
- `.ref-ai-employees-subagent-live-card` 去掉内外双层 padding，压到 `py-2 px-3`。
- 工具 row 的 pill 改成 unicode 图标（🔍 📄 💻 ✨）或单色 svg，减少色彩噪音。
- 删除描述块 `<div className="ref-ai-employees-subagent-live-desc">` 在折叠态不渲染；展开态放在 head 正下方窄行。

### 4.4 结论卡片差异化

CEO 的最终综合（`type: 'result'` 且 `fromEmployeeId === ceoId`）视觉上最重：

- 背景色 `var(--ref-surface-accent)`，圆角 12，阴影明显。
- 头部 "Final answer" 标签 + copy 按钮。
- 放一个 "Show plan trail" 链接，点击浮层展示整条 plan + 每个 item 的子 agent 摘要。

而子 agent 的 result 消息（现在和 CEO 同级显示）降权为"plan 条目的附属"，渲染在对应 plan item 的下方（or 折叠进 plan item）。

### 4.5 侧边栏 run 列表增强

`src/aiEmployees/pages/InboxPage.tsx` 左侧列表每一条 row 增加一个活动指示：

```
┌────────────────────────────────────────┐
│ 帮我优化 Test 项目                      │
│ 🤖 工程师 Reading src/App.tsx...  01:12 │
└────────────────────────────────────────┘
```

- 数据来自 `employeeLiveStatusRef` + 每个 run 的最新 live job。
- 非活跃 run 保持现有 preview 行。

### 4.6 错误/阻塞的内联操作

当 job `status === 'error'` 或 `'blocked'`，在卡片尾部添加操作条：

```
[ ↻ Retry ]  [ 🔄 Reassign ▾ ]  [ ⏭ Skip ]  [ 📋 Copy error ]
```

- Retry：重新入队同一 job（清空 toolLog，status → queued）。
- Reassign：打开下拉选员工，新建一个 job 指向 plan 同一 item。
- Skip：把对应 plan item 标记 `skipped`，允许 CEO digest 继续。

### 4.7 动效策略

- 新卡片 `enter` 动画：`opacity 0 → 1` + `translateY(4px → 0)`，200ms cubic-bezier(.2,.7,.3,1)。
- Plan 打钩：image-scale bounce，300ms。
- Auto-scroll 只在"用户已贴底"时触发（沿用 SubAgentExecutionCard 被我删除的那段逻辑，重新挪到 run 级）。
- 杜绝"整列表重排"：用 `key={item.id}` 稳定，新增 item 追加末尾，timestamp 排序已保证。

## 5. 实施分阶段

### Phase 1 · Plan 主干（核心，2-3 天）

- [ ] `AiRunPlanItem` 类型 + `run.plan` 字段（shared）
- [ ] `draft_plan` collab tool 接入 CEO system prompt
- [ ] `handleCollabAction` 处理 `draft_plan`：写入 run.plan、appendTimelineEvent
- [ ] `delegate_task` 携带 `planItemId` 时绑定 job，job 状态变化同步 plan item 状态
- [ ] `RunPlanCard` 组件 + 接入 InboxPage 顶部
- [ ] 勾选动效

**验收**：发起一个多步任务，能看到 plan 先出现、条目按顺序打钩、打钩顺序与 sub-agent 完成顺序一致。

### Phase 2 · 活性与控制（3-4 天）

- [ ] `aiEmployees:subAgentEvent` IPC 通道（main → renderer）
- [ ] renderer 侧 `employeeLiveStatusRef` + 订阅
- [ ] `RunHeaderBar` 组件（goal、进度、elapsed、控制按钮）
- [ ] Stop/Pause：取消 pending IPC、停止新入队
- [ ] 侧边栏 run 列表活动指示行

**验收**：子 agent 运行时，顶部 header 和侧边栏都能看见实时 "tool start" 文本；Stop 按钮能立即阻断新 job。

### Phase 3 · 视觉升级（2-3 天）

- [ ] SubAgentExecutionCard 紧凑化（单行折叠 / 密集工具 row）
- [ ] CEO final answer 视觉差异化 + copy 按钮
- [ ] 子 agent result 消息归属到 plan item（渲染层面）
- [ ] enter 动画 + 稳定 scroll

**验收**：对比当前界面和 Cursor / Claude Code 的 side-by-side 截图，信息密度和视觉层级接近。

### Phase 4 · 恢复与完善（2 天）

- [ ] Error/Blocked 内联 Retry/Reassign/Skip
- [ ] Plan item 的 skip → digest 兼容
- [ ] 键盘：Cmd+Enter 发送、Esc 取消 run、/ 打开命令面板（起步只做前两个）
- [ ] 空态打磨（无 run 时的欢迎屏、第一次交互提示）

**验收**：让一个子 agent 故意失败，用户能不离开页面完成恢复。

## 6. 非目标（明确不做）

- 不做真流式子 agent 回复。代价高、增量体验有限；"活性探针 + tool start 事件"已经足够。
- 不做代码 diff 渲染。可以显示文件 chip，但真正的 diff 视图留给未来迭代。
- 不做多 run 并行执行的全局 dashboard。sidebar 的活动指示足够。
- 不引入新的状态管理库。继续用 ref + persistOrchestration pattern。

## 7. 风险与回避

| 风险 | 回避 |
|---|---|
| CEO 不按约定先 draft_plan 就直接 delegate | system prompt + fallback：若首个 collab_action 不是 draft_plan，renderer 侧自动合成一个单 item plan，保证 UI 一致性 |
| tool_start/tool_end 事件频率高导致 IPC 压力 | 复用现有 50ms batch；不持久化、仅走 presence ref；主进程端每 job 自限 5Hz |
| Plan item 与 job 失去同步（job 完成但 plan 未勾） | 每次 updateSubAgentJobInRun 后在同一 persistOrchestration 闭包里同步对应 plan item |
| 大量动画让低端机卡 | 动画全部用 transform/opacity；媒体查询 `prefers-reduced-motion: reduce` 时降级为无动画 |

## 8. 开源参考

- [Cursor Agents](https://cursor.com/agents) — Plan+checkbox+tool rows 范式
- [Claude Code](https://github.com/anthropics/claude-code) CLI — Todo 工具 + tool call 单行展示
- [Devin](https://devin.ai) — Run header + 活动面板
- 自家项目 `C:\WebstormProjects\multica` — 已有的 Jira-for-agents 交互密度可参考

---

**下一步**：我建议先跑 Phase 1（plan 主干）。它是所有其它改动的骨架，单独拉出来也有明显体验提升。确认方向后我就开始实施。
