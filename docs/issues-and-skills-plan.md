# AI Team Issues Board & Skills System - Execution Plan

> **Date:** 2026-04-11
> **Scope:** Async (Frontend / Electron) + async-agent-proxy (Rust Backend)
> **Reference:** multica 项目 Issues / Skills 实现

---

## 1. Requirement Summary

### 1.1 Issues Board (事务看板)

将当前简易的 Issues 界面升级为完整的 **JIRA 式看板 + 列表双视图**，功能包括：

| 能力 | 说明 |
|------|------|
| **Kanban 看板** | Backlog / Todo / In Progress / In Review / Done / Blocked 六列，支持拖拽改状态 |
| **列表视图** | 按状态分组折叠的列表，支持多选批量操作 |
| **筛选 & 排序** | 按状态、优先级、指派人（成员/AI员工）、创建者筛选；按位置、优先级、截止日期、创建时间排序 |
| **Issue 详情面板** | 侧栏展示完整详情，支持编辑标题/描述、改状态/优先级/指派人、子任务创建 |
| **用户创建** | 用户手动创建 Issue 并指派给 AI 员工或自己 |
| **AI 分配** | AI Team 中的角色（如 CEO、产品经理）可通过协作消息自动创建和分配任务 |
| **拖拽排序** | 列内拖拽调整顺序，跨列拖拽改变状态 |
| **优先级系统** | urgent / high / medium / low / none 五级优先级 |
| **子任务** | 支持 parent_issue_id 父子层级 |
| **实时更新** | 通过 WebSocket 事件 (issue:created/updated/deleted) 实时同步 |

### 1.2 Skills System (技能系统)

提供 **全局技能配置 + 成员技能分配** 机制：

| 能力 | 说明 |
|------|------|
| **全局 Skills 管理** | 在 workspace 层级创建/编辑/删除技能，每个 Skill 包含名称、描述、指令内容 (SKILL.md) 和附属文件 |
| **Skill 文件系统** | 每个 Skill 可包含主文件 (content) 和多个 supporting files |
| **外部导入** | 从外部源（URL）导入 Skill 定义 |
| **分配给 AI 员工** | 在员工详情中管理分配的 Skills，一个员工可有多个 Skills |
| **Skills 影响行为** | 分配的 Skills 会注入到 AI 员工的 system prompt 中，影响其行为和能力边界 |

---

## 2. Current State Analysis

### 2.1 Frontend (Async)

| 组件 | 状态 | 说明 |
|------|------|------|
| `IssuesHubPage` | **基础完成** | 有 board/list 切换，active/all scope 切换，但功能简陋 |
| `BoardPage` | **基础完成** | 仅静态列渲染，无拖拽、无筛选、无排序 |
| `IssueDetailPanel` | **基础完成** | 支持编辑标题/描述/状态/指派人、创建子任务 |
| `SkillsPage` | **已创建但未接入** | 仅简单列表，未加入 Tab 导航 |
| Skills API Client | **只读** | 仅有 `apiListSkills()`，无 CRUD |
| Skills Types | **最小定义** | `SkillJson` 仅 id/name/workspace_id |
| WebSocket 事件 | **已定义** | issue:\* 和 skill:\* 事件已监听 |
| 拖拽库 | **未引入** | 当前项目无 @dnd-kit 依赖 |

### 2.2 Backend (async-agent-proxy)

| 组件 | 状态 | 说明 |
|------|------|------|
| Issue CRUD | **完成** | GET/POST/PATCH /api/issues/，支持 assignee/creator 筛选 |
| Issue 数据模型 | **完成** | 7 种状态、5 级优先级、子任务、标签、依赖关系 |
| Skill 表 | **完成** | `skill` + `skill_file` + `agent_skill` 三表结构 |
| Skills API | **只读** | 仅 GET /api/skills/，无 CRUD handler |
| WebSocket 广播 | **完成** | issue:\* / skill:\* 事件类型已定义 |
| Position 排序 | **DB 支持** | issue 表有 position 字段 |
| 员工-Agent 关联 | **完成** | `async_org_employee.linked_remote_agent_id` → agent → agent_skill |

### 2.3 Gap Analysis

```
需要新增的部分:
├── Frontend
│   ├── [NEW] 拖拽 Kanban 实现 (@dnd-kit)
│   ├── [NEW] 筛选/排序 toolbar 及 store
│   ├── [NEW] 批量操作 toolbar
│   ├── [NEW] Issue 创建对话框（完整版）
│   ├── [UPGRADE] BoardPage → 支持 DnD + 列配置
│   ├── [UPGRADE] IssueDetailPanel → 优先级 picker 等
│   ├── [UPGRADE] SkillJson type → 完整字段
│   ├── [NEW] Skills CRUD 页面（全局管理）
│   ├── [NEW] 员工 Skills 分配 Tab
│   └── [NEW] Skills API client 方法 (create/update/delete/assign)
│
├── Backend
│   ├── [NEW] POST /api/skills/ (create)
│   ├── [NEW] PATCH /api/skills/{id} (update)
│   ├── [NEW] DELETE /api/skills/{id} (delete)
│   ├── [NEW] GET /api/skills/{id} (detail with files)
│   ├── [NEW] POST /api/skills/import (URL import)
│   ├── [NEW] GET /api/agents/{id}/skills (list agent skills)
│   ├── [NEW] PUT /api/agents/{id}/skills (set agent skills)
│   ├── [UPGRADE] PATCH /api/issues/{id} → 支持 position 批量更新
│   └── [NEW] POST /api/issues/reorder (批量排序)
│
└── Shared
    └── [NEW] WebSocket 广播 skill CRUD 事件
```

---

## 3. Execution Plan

### Phase 1: Issues Board Enhancement - Backend

**目标**: 补全后端 Issue 操作能力，支持排序和批量操作

#### 1.1 Issue Position / Reorder API

**文件**: `D:\RustroverProjects\async-agent-proxy\src\http\handlers.rs`

```
POST /api/issues/reorder
Body: { "updates": [{ "id": "uuid", "status": "in_progress", "position": 1024 }, ...] }
```

- 接收一组 `(issue_id, status, position)` 批量更新
- 单次事务中更新所有 position 和 status
- 广播 `issue:updated` WebSocket 事件

#### 1.2 增强 Issue 筛选

**文件**: `D:\RustroverProjects\async-agent-proxy\src\http\handlers.rs`

增强 `GET /api/issues/` 查询参数:

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | `string[]` | 多状态筛选 (逗号分隔) |
| `priority` | `string[]` | 多优先级筛选 |
| `assignee_ids` | `string[]` | 多指派人 |
| `sort_by` | `string` | position / priority / due_date / created_at |
| `sort_dir` | `string` | asc / desc |
| `limit` | `i64` | 分页大小 |
| `offset` | `i64` | 偏移量 |

#### 1.3 Issue Delete API

```
DELETE /api/issues/{issue_id}
```

- 级联删除子 issue、评论、反应
- 广播 `issue:deleted`

**预估改动**: `handlers.rs` 新增 ~150 行, 路由注册 ~5 行

---

### Phase 2: Issues Board Enhancement - Frontend

**目标**: 将简易看板升级为完整的拖拽 Kanban + 列表双视图

#### 2.1 安装依赖

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

#### 2.2 数据层改造

**新增文件**: `src/aiEmployees/domain/issueBoard.ts`

```typescript
// Issue 看板状态管理
export type IssueViewMode = 'board' | 'list';
export type IssueSortBy = 'position' | 'priority' | 'due_date' | 'created_at' | 'title';

export interface IssueBoardState {
  viewMode: IssueViewMode;
  statusFilters: string[];
  priorityFilters: string[];
  assigneeFilters: { type: 'member' | 'agent'; id: string }[];
  sortBy: IssueSortBy;
  sortDirection: 'asc' | 'desc';
  collapsedStatuses: string[];  // 列表视图中折叠的分组
}

// 按状态分桶
export function bucketByStatus(issues: IssueJson[]): Map<string, IssueJson[]>;

// 应用筛选
export function applyFilters(issues: IssueJson[], state: IssueBoardState): IssueJson[];

// 计算拖拽后的 position 值
export function computeNewPosition(siblings: IssueJson[], targetIndex: number): number;
```

#### 2.3 看板组件重写

**改造文件**: `src/aiEmployees/pages/BoardPage.tsx`

| 子组件 | 职责 |
|--------|------|
| `BoardPage` | DndContext 根容器，处理 onDragStart/onDragEnd，管理 overlay |
| `BoardColumn` | 单列容器 (SortableContext)，显示状态标题 + 计数 + 添加按钮 |
| `BoardCard` | 可拖拽卡片 (useSortable)，显示标题、优先级徽标、指派人头像、截止日期 |
| `DragOverlay` | 拖拽时的浮动卡片预览 |

**拖拽逻辑**:
1. `onDragStart` - 冻结当前 issue 数据，设置 activeId
2. 拖拽中 - 本地 state 实时更新列分桶（不触发 API）
3. `onDragEnd` - 调用 `onPatchIssue(issueId, { status, position })` 持久化
4. 使用 `requestAnimationFrame` 防抖跨列拖拽

**卡片内容**:
```
┌─────────────────────────────────┐
│ ⚡ ASYNC-42                      │  ← identifier + priority icon
│ Fix login timeout bug            │  ← title
│ Login page times out after...    │  ← description (可选)
│                                  │
│ 👤 Backend Dev    📅 Apr 15     │  ← assignee + due date
└─────────────────────────────────┘
```

#### 2.4 列表视图增强

**改造文件**: `src/aiEmployees/pages/BoardPage.tsx` (或新建 `ListView.tsx`)

- 按状态分组的折叠列表 (accordion)
- 每行：checkbox + identifier + title + priority badge + assignee + due date + status
- 支持多选 → 批量操作 toolbar (改状态 / 改优先级 / 改指派人)

#### 2.5 筛选 & 排序 Toolbar

**改造文件**: `src/aiEmployees/pages/IssuesHubPage.tsx`

在现有 toolbar 基础上增加:

```
┌─ Issues Toolbar ──────────────────────────────────────────────────┐
│ [Board | List]  [Active | All]                                    │
│                                                                   │
│ Filter: [Status ▾] [Priority ▾] [Assignee ▾]  Sort: [Manual ▾]  │
│                                                  [+ New Issue]    │
└───────────────────────────────────────────────────────────────────┘
```

- 每个筛选器为 dropdown + 多选 checkbox
- 激活的筛选器数量显示为 badge
- Sort 下拉：Manual (position) / Priority / Due Date / Created / Title

#### 2.6 Issue 创建对话框

**新增文件**: `src/aiEmployees/components/CreateIssueDialog.tsx`

```
┌─ Create Issue ──────────────────────────┐
│                                          │
│ Title *:     [________________________] │
│ Description: [________________________] │
│              [________________________] │
│                                          │
│ Status:      [Backlog        ▾]         │
│ Priority:    [None           ▾]         │
│ Assignee:    [Unassigned     ▾]         │
│ Due Date:    [Select date    📅]        │
│ Parent:      [None           ▾]         │
│                                          │
│              [Cancel]  [Create Issue]    │
└──────────────────────────────────────────┘
```

- Assignee dropdown 合并展示 workspace members + AI employees
- 创建后自动关闭并通过 WebSocket 同步到看板

#### 2.7 AI 自动创建 & 分配

在现有 orchestration 流程中，当 AI 员工发送 `task_assignment` 类型的协作消息时：

**改造文件**: `src/aiEmployees/domain/orchestration.ts`

- 解析 `task_assignment` 消息的 `cardMeta.issueId`
- 如果 issueId 为空，自动调用 `onCreateIssue()` 创建 Issue
- 将新 Issue 的 assignee 设为目标员工关联的 agent

这利用了现有的 `AiCollabMessage` 机制，无需新增通信协议。

---

### Phase 3: Skills System - Backend

**目标**: 补全后端 Skill CRUD 和分配 API

#### 3.1 Skill CRUD Endpoints

**文件**: `D:\RustroverProjects\async-agent-proxy\src\http\handlers.rs`

| 路由 | Handler | 说明 |
|------|---------|------|
| `GET /api/skills/{id}` | `get_skill` | 获取 Skill 详情（含 files） |
| `POST /api/skills/` | `create_skill` | 创建 Skill |
| `PATCH /api/skills/{id}` | `update_skill` | 更新 Skill（含 files 全量替换） |
| `DELETE /api/skills/{id}` | `delete_skill` | 删除 Skill |

**Create/Update Request Body**:
```json
{
  "name": "Code Review",
  "description": "Perform thorough code reviews",
  "content": "# SKILL.md content...",
  "config": {},
  "files": [
    { "path": "checklist.md", "content": "## Review Checklist\n..." }
  ]
}
```

**实现要点**:
- `create_skill`: INSERT `skill` + 批量 INSERT `skill_file`
- `update_skill`: UPDATE `skill` + DELETE 旧 files + INSERT 新 files (全量替换策略，与 multica 一致)
- `delete_skill`: DELETE `skill` (CASCADE 删 skill_file + agent_skill)
- 每次写操作后广播 `skill:created` / `skill:updated` / `skill:deleted`

#### 3.2 Agent-Skill 分配 Endpoints

| 路由 | Handler | 说明 |
|------|---------|------|
| `GET /api/agents/{id}/skills` | `list_agent_skills` | 获取 agent 已分配的 skills |
| `PUT /api/agents/{id}/skills` | `set_agent_skills` | 设置 agent 的 skills (全量替换) |

**Set Request Body**:
```json
{
  "skill_ids": ["uuid-1", "uuid-2"]
}
```

**实现**: DELETE FROM agent_skill WHERE agent_id = $1; 然后 batch INSERT 新的 skill_ids。

#### 3.3 Skill Import Endpoint (可选，Phase 3+)

```
POST /api/skills/import
Body: { "url": "https://..." }
```

- 从外部 URL 获取 Skill 定义文件
- 解析 SKILL.md + 附属文件
- 创建本地 Skill 记录

**预估改动**: `handlers.rs` 新增 ~300 行, 路由注册 ~10 行

---

### Phase 4: Skills System - Frontend

**目标**: 完整的全局 Skills 管理界面 + 员工 Skills 分配

#### 4.1 扩展 Types 和 API Client

**改造文件**: `src/aiEmployees/api/types.ts`

```typescript
export type SkillJson = {
  id: string;
  workspace_id?: string;
  name: string;
  description?: string;
  content?: string;           // SKILL.md 主内容
  config?: Record<string, unknown>;
  files?: SkillFileJson[];    // 附属文件列表
  created_at?: string;
  updated_at?: string;
};

export type SkillFileJson = {
  id: string;
  skill_id: string;
  path: string;
  content: string;
  created_at?: string;
};

export type CreateSkillPayload = {
  name: string;
  description?: string;
  content?: string;
  config?: Record<string, unknown>;
  files?: { path: string; content: string }[];
};

export type UpdateSkillPayload = Partial<CreateSkillPayload>;

export type SetAgentSkillsPayload = {
  skill_ids: string[];
};
```

**改造文件**: `src/aiEmployees/api/client.ts`

新增方法:
```typescript
apiGetSkill(conn, workspaceId, skillId): Promise<SkillJson>
apiCreateSkill(conn, workspaceId, payload): Promise<SkillJson>
apiUpdateSkill(conn, workspaceId, skillId, payload): Promise<SkillJson>
apiDeleteSkill(conn, workspaceId, skillId): Promise<void>
apiListAgentSkills(conn, workspaceId, agentId): Promise<SkillJson[]>
apiSetAgentSkills(conn, workspaceId, agentId, payload): Promise<void>
```

#### 4.2 全局 Skills 管理页面

**改造文件**: `src/aiEmployees/pages/SkillsPage.tsx`

采用 multica 的 **左右分栏** 布局:

```
┌─────────────────────────────────────────────────────────────────┐
│  Skills                                           [+ New Skill] │
├──────────────────┬──────────────────────────────────────────────┤
│                  │  📝 Code Review                              │
│  ○ Code Review   │  Description: Perform thorough code reviews  │
│  ○ Bug Triage    │                                              │
│  ○ API Design    │  ┌──────────┬────────────────────────────┐  │
│  ○ Testing       │  │ Files    │  Editor                    │  │
│                  │  │          │                             │  │
│                  │  │ SKILL.md │  # Code Review Skill        │  │
│                  │  │ rules.md │                             │  │
│                  │  │          │  ## Instructions             │  │
│                  │  │          │  When reviewing code...     │  │
│                  │  │          │                             │  │
│                  │  │ [+ File] │          [Save] [Delete]    │  │
│                  │  └──────────┴────────────────────────────┘  │
└──────────────────┴──────────────────────────────────────────────┘
```

**组成**:
- **左侧 Skill 列表**: 可选中高亮，显示名称 + 描述预览
- **右侧 Skill 详情**: 
  - 顶部: 可编辑的名称/描述
  - 中部: 文件浏览器 (tree) + 代码编辑器 (Monaco)
  - 底部: Save / Delete 按钮

**文件编辑器**:
- 使用项目已有的 Monaco Editor (@monaco-editor/react)
- SKILL.md 为默认主文件
- 支持添加/删除附属文件

#### 4.3 员工 Skills 分配

**改造文件**: `src/aiEmployees/pages/EmployeesPage.tsx`

在员工详情面板中新增 **Skills Tab**:

```
┌─ Employee Detail ───────────────────────┐
│  [Profile] [Skills] [Activity]          │
│                                          │
│  Assigned Skills:                        │
│  ┌────────────────────────┐              │
│  │ 🔧 Code Review     [×]│              │
│  │ 🔧 API Design      [×]│              │
│  └────────────────────────┘              │
│                                          │
│  [+ Add Skill]                           │
└──────────────────────────────────────────┘
```

**逻辑**:
- 员工通过 `linked_remote_agent_id` 关联到 agent
- 通过 `apiListAgentSkills(agentId)` 获取已分配 skills
- 通过 `apiSetAgentSkills(agentId, { skill_ids })` 更新分配
- Add Skill 弹窗: 展示 workspace 内未分配给该 agent 的 skills

#### 4.4 接入 Tab 导航

**改造文件**: `src/aiEmployees/AiEmployeesApp.tsx`

```typescript
// 新增 'skills' tab
type AiEmployeesTabId = 'inbox' | 'myIssues' | 'issues' | 'agents' | 'skills' | 'activity' | 'connection';

const visibleTabs: AiEmployeesTabId[] = [
  'inbox', 'myIssues', 'issues', 'agents', 'skills', 'activity', 'connection'
];
```

在 Configure 分组中加入 Skills tab icon 和渲染逻辑。

---

### Phase 5: Internationalization (i18n)

**改造文件**:
- `src/i18n/messages.en.ts`
- `src/i18n/messages.zh-CN.ts`

新增翻译 key:

```typescript
// Issues Board
'aiEmployees.issuesHub.filterStatus': 'Status',
'aiEmployees.issuesHub.filterPriority': 'Priority',
'aiEmployees.issuesHub.filterAssignee': 'Assignee',
'aiEmployees.issuesHub.sortManual': 'Manual',
'aiEmployees.issuesHub.sortPriority': 'Priority',
'aiEmployees.issuesHub.sortDueDate': 'Due Date',
'aiEmployees.issuesHub.sortCreated': 'Created',
'aiEmployees.issuesHub.newIssue': 'New Issue',
'aiEmployees.issuesHub.batchChangeStatus': 'Change Status',
'aiEmployees.issuesHub.batchChangePriority': 'Change Priority',
'aiEmployees.issuesHub.batchChangeAssignee': 'Change Assignee',
'aiEmployees.issuesHub.priorityUrgent': 'Urgent',
'aiEmployees.issuesHub.priorityHigh': 'High',
'aiEmployees.issuesHub.priorityMedium': 'Medium',
'aiEmployees.issuesHub.priorityLow': 'Low',
'aiEmployees.issuesHub.priorityNone': 'None',

// Issue Create Dialog
'aiEmployees.createIssue.title': 'Create Issue',
'aiEmployees.createIssue.titleField': 'Title',
'aiEmployees.createIssue.descField': 'Description',
'aiEmployees.createIssue.statusField': 'Status',
'aiEmployees.createIssue.priorityField': 'Priority',
'aiEmployees.createIssue.assigneeField': 'Assignee',
'aiEmployees.createIssue.dueDateField': 'Due Date',
'aiEmployees.createIssue.parentField': 'Parent Issue',
'aiEmployees.createIssue.submit': 'Create Issue',

// Skills
'aiEmployees.tab.skills': 'Skills',
'aiEmployees.skills.title': 'Skills',
'aiEmployees.skills.newSkill': 'New Skill',
'aiEmployees.skills.name': 'Skill Name',
'aiEmployees.skills.description': 'Description',
'aiEmployees.skills.mainFile': 'SKILL.md',
'aiEmployees.skills.addFile': 'Add File',
'aiEmployees.skills.deleteFile': 'Delete File',
'aiEmployees.skills.save': 'Save',
'aiEmployees.skills.delete': 'Delete Skill',
'aiEmployees.skills.confirmDelete': 'Are you sure you want to delete this skill?',
'aiEmployees.skills.empty': 'No skills yet',
'aiEmployees.skills.emptyHint': 'Create a skill to define reusable instructions for your AI employees.',

// Employee Skills Tab
'aiEmployees.employee.skillsTab': 'Skills',
'aiEmployees.employee.assignedSkills': 'Assigned Skills',
'aiEmployees.employee.addSkill': 'Add Skill',
'aiEmployees.employee.removeSkill': 'Remove Skill',
'aiEmployees.employee.noSkills': 'No skills assigned',
'aiEmployees.employee.allSkillsAssigned': 'All skills already assigned',
```

---

### Phase 6: CSS Styling

**改造文件**: `src/aiEmployees/aiEmployees.css`

新增样式模块:

| 模块 | Class Prefix | 说明 |
|------|-------------|------|
| Kanban DnD | `.ref-ai-employees-board-dnd-*` | 拖拽容器、overlay、占位符 |
| Board Card | `.ref-ai-employees-board-card-*` | 卡片优先级徽标、头像、日期 |
| Filter Toolbar | `.ref-ai-employees-filter-*` | 筛选下拉、badge、popup |
| List View | `.ref-ai-employees-list-*` | 折叠列表、checkbox、多选 |
| Batch Actions | `.ref-ai-employees-batch-*` | 底部浮动工具栏 |
| Create Dialog | `.ref-ai-employees-create-dialog-*` | 表单布局、字段样式 |
| Skills Page | `.ref-ai-employees-skills-*` | 分栏布局、文件树、编辑器 |
| Skill Card | `.ref-ai-employees-skill-card-*` | 员工 skills 列表卡片 |

使用项目现有的 CSS Variables 主题系统 (`--void-bg-*`, `--void-fg-*`, `--void-accent-*`)。

---

## 4. Implementation Order & Dependencies

```
Phase 1 (Backend - Issues)          Phase 3 (Backend - Skills)
    │                                    │
    ▼                                    ▼
Phase 2 (Frontend - Issues)         Phase 4 (Frontend - Skills)
    │                                    │
    └──────────┬─────────────────────────┘
               ▼
          Phase 5 (i18n)
               │
               ▼
          Phase 6 (CSS)
```

**可并行的部分**:
- Phase 1 和 Phase 3 可同时开发（后端 Issues 和 Skills 互不依赖）
- Phase 5 和 Phase 6 可穿插在前端开发过程中

**推荐开发顺序**:
1. **Phase 1** → **Phase 2** (先完善看板核心功能)
2. **Phase 3** → **Phase 4** (再构建 Skills 系统)
3. **Phase 5 + 6** (收尾 i18n 和样式)

---

## 5. File Modification Summary

### Frontend (Async)

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `package.json` | EDIT | +@dnd-kit 依赖 |
| `src/aiEmployees/api/types.ts` | EDIT | +SkillFileJson, CreateSkillPayload 等类型 |
| `src/aiEmployees/api/client.ts` | EDIT | +6 个 API 方法 |
| `src/aiEmployees/domain/issueBoard.ts` | NEW | ~200 行 (看板状态/筛选/排序逻辑) |
| `src/aiEmployees/pages/BoardPage.tsx` | REWRITE | ~400 行 (DnD Kanban) |
| `src/aiEmployees/pages/IssuesHubPage.tsx` | EDIT | +筛选 toolbar, +创建按钮 |
| `src/aiEmployees/pages/IssueDetailPanel.tsx` | EDIT | +优先级 picker |
| `src/aiEmployees/components/CreateIssueDialog.tsx` | NEW | ~200 行 |
| `src/aiEmployees/components/FilterDropdown.tsx` | NEW | ~100 行 (通用筛选下拉) |
| `src/aiEmployees/components/PriorityBadge.tsx` | NEW | ~40 行 |
| `src/aiEmployees/pages/SkillsPage.tsx` | REWRITE | ~600 行 (全功能 Skills 管理) |
| `src/aiEmployees/components/EmployeeSkillsTab.tsx` | NEW | ~200 行 |
| `src/aiEmployees/AiEmployeesApp.tsx` | EDIT | +skills tab |
| `src/aiEmployees/hooks/useAiEmployeesController.ts` | EDIT | +skill CRUD 方法 |
| `src/aiEmployees/aiEmployees.css` | EDIT | +~500 行样式 |
| `src/i18n/messages.en.ts` | EDIT | +~50 个 key |
| `src/i18n/messages.zh-CN.ts` | EDIT | +~50 个 key |

### Backend (async-agent-proxy)

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `src/http/mod.rs` | EDIT | +路由注册 |
| `src/http/handlers.rs` | EDIT | +~450 行 (reorder + skill CRUD + agent skills) |
| 无需新增 migration | - | 已有 skill/skill_file/agent_skill 表 |

---

## 6. Key Technical Decisions

### 6.1 DnD 方案: @dnd-kit

选择 @dnd-kit 而非 react-beautiful-dnd (已停维) 或 HTML5 DnD API:
- 与 multica 保持一致
- 更好的 keyboard/touch 支持
- 支持自定义碰撞检测（Kanban 场景需要优先检测卡片而非列）
- 轻量且 tree-shakable

### 6.2 Issue Position 算法

使用 **分数定位法** (fractional indexing):
- 新卡片 position 取 `(上一个 position + 下一个 position) / 2`
- 初始间隔 65536，理论支持 ~50 次连续插入不需要重排
- 当间隔 < 1 时触发 rebalance (服务端重算当前列的 position)

### 6.3 Skill Files 全量替换策略

更新 Skill 时，files 采用 "删除旧的 + 插入新的" 全量替换：
- 简化冲突处理
- 前端编辑器中的虚拟文件系统天然支持全量序列化
- 与 multica 保持一致

### 6.4 Employee ↔ Agent ↔ Skill 关联链

```
Employee (org_employee)
    └── linked_remote_agent_id → Agent (agent)
                                    └── agent_skill → Skill (skill)
```

分配 Skill 给 Employee 实际操作的是其关联 Agent 的 agent_skill 中间表。
前端需要先解析 `employee.linked_remote_agent_id` 获取 agentId，再调用 Skill 分配 API。

---

## 7. Testing Checklist

### Issues Board
- [ ] 拖拽卡片到不同列 → 状态自动更新
- [ ] 列内拖拽排序 → position 持久化
- [ ] 筛选器组合 → 正确过滤显示
- [ ] 创建 Issue → 实时出现在看板
- [ ] 删除 Issue → 实时从看板消失
- [ ] WebSocket 断线重连后 → 数据自动同步
- [ ] 列表视图 → 多选批量操作
- [ ] 子任务创建 → 正确设置 parent_issue_id
- [ ] AI 员工分配任务 → Issue 自动创建并出现在看板

### Skills System
- [ ] 创建 Skill → 列表实时更新
- [ ] 编辑 SKILL.md → Save 后持久化
- [ ] 添加/删除附属文件 → 正确序列化
- [ ] 删除 Skill → 从所有 Agent 解除关联
- [ ] 分配 Skill 给 Employee → 正确写入 agent_skill
- [ ] 移除 Employee 的 Skill → 正确删除关联
- [ ] WebSocket skill:* 事件 → UI 实时更新
