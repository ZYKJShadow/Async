# AI Employees Feature - Review & Execution Plan

> Date: 2026-04-11
> Frontend: `d:\WebstormProjects\Async\src\aiEmployees\`
> Backend: `D:\RustroverProjects\async-agent-proxy\`

---

## Part 0: Critical Issue — AI Employees Have No Workspace Context

### Problem

When chatting with an AI employee, they cannot see projects, issues, skills, or team info.
Asking "Can you see my projects?" gets the response "I can't directly see your projects."

### Root Cause Analysis

The full conversation chain has been traced:

```
User sends message in InboxPage
  → sendMessage() → onCreateRun(employeeId, title, details)
    → createEmployeeRun()  [useAiEmployeesController.ts:1795]
      → createOrchestrationRun() + apiCreateIssue()
      → requestEmployeeReply(employeeId, runId)  [line 1199]
        → resolveEmployeeLocalModelId() → get modelId
        → buildCollabHistoryForEmployee() → get chat history (user/assistant turns only)
        → Build EmployeeChatInput payload:
            { modelId, displayName, roleKey, customSystemPrompt,
              jobMission, domainContext, communicationNotes,
              collaborationRules, handoffRules, history, teamMembers }
        → shell.invoke('aiEmployees:chat', payload)  [line 1275]
          → runEmployeeChat()  [main-src/aiEmployees/employeeChat.ts:69]
            → buildEmployeeSystemPrompt(input)  [line 12]
            → streamChatUnified(messages)
```

**`buildEmployeeSystemPrompt()` in [employeeChat.ts:12-64](main-src/aiEmployees/employeeChat.ts) builds:**
- Employee name, role title
- Custom system prompt OR fallback role description
- Job mission, domain context, communication style
- Collaboration rules, handoff rules
- Team roster (colleagues' names, roles, missions)
- Boss communication instructions

**What's completely missing — NEVER injected:**
- Workspace projects list (titles, descriptions, boundaries, progress)
- Issues list (status, assignees, priorities)
- Skills catalog
- Organization info (company name)
- Any real-time workspace state

**`EmployeeChatInput` type in [shared/aiEmployeesPersona.ts:86-101](shared/aiEmployeesPersona.ts) has no fields for workspace data.**

The same gap exists in the backend executor path (`scheduler.rs:build_system_prompt()`),
but for local-model inbox chat, the frontend path is what matters.

### Solution Design

**Principle**: Inject a structured workspace context snapshot into the system prompt so employees
are aware of what exists in the workspace. Keep it concise to fit within context windows.

#### Step 1: Extend `EmployeeChatInput` type

Add an optional `workspaceContext` field:

```typescript
// shared/aiEmployeesPersona.ts
export type WorkspaceContextSnapshot = {
  companyName?: string;
  projects: Array<{
    id: string;
    title: string;
    icon?: string;
    description?: string;
    boundaryKind: string;
    boundaryPath?: string;
    issueCount: number;
    doneCount: number;
    leadName?: string;
  }>;
  recentIssues: Array<{
    id: string;
    identifier?: string;
    title: string;
    status: string;
    priority?: string;
    assigneeName?: string;
    projectTitle?: string;
  }>;
  skills: Array<{
    name: string;
    description?: string;
  }>;
};

export type EmployeeChatInput = {
  // ... existing fields ...
  workspaceContext?: WorkspaceContextSnapshot;
};
```

#### Step 2: Build the snapshot in `requestEmployeeReply`

In [useAiEmployeesController.ts:1258](src/aiEmployees/hooks/useAiEmployeesController.ts),
before constructing the payload, build the snapshot from data already in memory:

```typescript
const workspaceContext: WorkspaceContextSnapshot = {
  companyName: bootstrapStatus?.companyName,
  projects: projects.map(p => ({
    id: p.id,
    title: p.title,
    icon: p.icon ?? undefined,
    description: p.description ?? undefined,
    boundaryKind: p.boundary_kind ?? 'none',
    boundaryPath: p.boundary_local_path ?? p.boundary_git_url ?? undefined,
    issueCount: p.issue_count ?? 0,
    doneCount: p.done_count ?? 0,
    leadName: leadLabel(p, workspaceMembers, agents),
  })),
  recentIssues: issues.slice(0, 30).map(i => ({
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    status: i.status,
    priority: i.priority,
    assigneeName: resolveAssigneeName(i, workspaceMembers, agents),
    projectTitle: projects.find(p => p.id === i.project_id)?.title,
  })),
  skills: skills.map(s => ({ name: s.name, description: s.description })),
};

const payload: EmployeeChatInput = {
  // ... existing fields ...
  workspaceContext,
};
```

#### Step 3: Inject into system prompt

In [main-src/aiEmployees/employeeChat.ts:12](main-src/aiEmployees/employeeChat.ts), add workspace context section:

```typescript
// Inside buildEmployeeSystemPrompt(), after team roster section:
if (input.workspaceContext) {
  const ctx = input.workspaceContext;
  const lines: string[] = [];

  if (ctx.companyName) {
    lines.push(`Company: ${ctx.companyName}`);
  }

  if (ctx.projects.length > 0) {
    lines.push('Current projects:');
    for (const p of ctx.projects) {
      const progress = p.issueCount > 0 ? ` [${p.doneCount}/${p.issueCount} done]` : '';
      const lead = p.leadName ? ` (lead: ${p.leadName})` : '';
      const boundary = p.boundaryKind !== 'none'
        ? ` [${p.boundaryKind}: ${p.boundaryPath}]` : '';
      lines.push(`  • ${p.icon ?? '📁'} ${p.title}${progress}${lead}${boundary}`);
      if (p.description) lines.push(`    ${p.description.slice(0, 120)}`);
    }
  }

  if (ctx.recentIssues.length > 0) {
    lines.push('Recent issues:');
    for (const i of ctx.recentIssues.slice(0, 20)) {
      const proj = i.projectTitle ? ` [${i.projectTitle}]` : '';
      const assignee = i.assigneeName ? ` → ${i.assigneeName}` : '';
      lines.push(`  • ${i.identifier ?? i.id.slice(0,8)} ${i.title} (${i.status})${proj}${assignee}`);
    }
  }

  if (ctx.skills.length > 0) {
    lines.push(`Available skills: ${ctx.skills.map(s => s.name).join(', ')}`);
  }

  parts.push(`== Workspace state (live) ==\n${lines.join('\n')}`);
}
```

#### Step 4: Apply same pattern to backend executor

In `scheduler.rs:build_system_prompt()`, query workspace projects/issues and inject the same
structured context. This ensures both local-model and remote-model paths are consistent.

### Files to Modify

| File | Change |
|------|--------|
| `shared/aiEmployeesPersona.ts` | Add `WorkspaceContextSnapshot` type, extend `EmployeeChatInput` |
| `src/aiEmployees/hooks/useAiEmployeesController.ts` | Build snapshot from in-memory data in `requestEmployeeReply` |
| `main-src/aiEmployees/employeeChat.ts` | Add workspace context section to `buildEmployeeSystemPrompt()` |
| `async-agent-proxy/src/executor/scheduler.rs` | Query workspace data, inject into `build_system_prompt()` |

### Impact

After this change, asking an AI employee "Can you see my projects?" will yield a response
listing all workspace projects with their status, progress, and boundaries. Employees will also
be able to reference issues, suggest task assignments, and operate with full workspace awareness.

---

## Part 1: Current State Assessment

### 1.1 Architecture Overview

```
Frontend (React + TypeScript)
  AiEmployeesApp
  ├── Session Controller (useAiEmployeesController)
  │   ├── REST API client (api/client.ts, api/orgClient.ts)
  │   ├── WebSocket realtime (api/ws.ts)
  │   └── Session phases: bootstrapping → onboarding → ready
  ├── Domain Logic (domain/)
  │   ├── bootstrap.ts, orchestration.ts, issueBoard.ts
  │   ├── roleDraft.ts, taskEvents.ts, employeeActivityStatus.ts
  │   └── persona generation, team templates
  ├── Pages: Inbox, Issues, Projects, Team, Skills, Activity, Settings
  └── Dialogs: CreateIssue, CreateProject, CreateSkill, RoleProfileEditor

Backend (Rust / Axum + PostgreSQL)
  async-agent-proxy
  ├── HTTP handlers (CRUD for issues, projects, employees, skills, tasks)
  ├── WebSocket hub (per-workspace broadcast)
  ├── Bridge (Telegram polling ✓, Feishu/Discord stubs)
  ├── Executor (task scheduler + LLM client)
  └── 54 migrations, Bearer token auth, workspace isolation
```

### 1.2 What's Working Well

| Area | Status | Notes |
|------|--------|-------|
| Onboarding flow | **Solid** | 7-step wizard, 3 team templates, CEO prompt review |
| Issue management | **Functional** | CRUD, filtering, sorting, batch ops, board view |
| Project management | **Functional** | List/detail views, create/edit/delete, progress tracking |
| Employee system | **Functional** | Roles, hierarchy, persona, capabilities, manager cycles |
| Skill catalog | **Functional** | CRUD, file management, agent skill mapping |
| i18n | **Complete** | 600+ keys, en + zh-CN |
| CSS/Design system | **Consistent** | Void tokens, dark/light themes, transitions |
| Backend API | **Stable** | Workspace isolation, FK cascades, structured errors |

### 1.3 Issues Found

#### Critical Issues

**C1. Project Boundary Enforcement Not Implemented**
- Migration #54 adds `boundary_kind`, `boundary_local_path`, `boundary_git_url` to `project` table
- Migration #52 adds `allowed_paths`, `max_llm_tokens` to `async_org_employee`
- **But**: executor does NOT validate these boundaries before file access
- **Impact**: boundaries are decorative only — agents can freely operate outside them
- **Frontend**: UI for setting boundaries is complete, but the constraint is never enforced

**C2. Executor Integration Incomplete**
- `executor/scheduler.rs` polls `agent_task_queue` but full LLM call chain is unclear
- Task approval flow creates inbox items but doesn't send IM interactive buttons
- No mechanism to inject boundary constraints into agent system prompt or tool permissions

#### High Priority Issues

**H1. Error Handling Gaps (Frontend)**
- `notifyAiEmployeesRequestFailed()` shows generic toast for all failures
- `CreateProjectDialog` catch block doesn't distinguish API errors from network errors
- Several `IssuesHubPage` try/catch blocks silently swallow errors
- `pickLocalDirectoryPath()` silently returns `null` if shell unavailable — no UI feedback

**H2. Type Safety Looseness**
- `assignee_type?: IssueAssigneeType | string | null` — the `| string` defeats type narrowing
- `boundary_kind?: ProjectBoundaryKind | string` — same pattern in `ProjectJson`
- `lead_type?: IssueAssigneeType | string | null` — allows arbitrary strings through

**H3. No Role-Based Access Control**
- All workspace members have equal permissions (backend)
- No distinction between owner/admin/member for destructive operations
- Project lead assignment is informational only, no access enforcement

**H4. IM Bridges Incomplete**
- Telegram: implemented (long polling)
- Feishu: stub only — webhook not registered, signature verification missing
- Discord: stub only — serenity dependency not enabled

#### Medium Priority Issues

**M1. Performance Concerns**
- `AiEmployeesApp` re-renders entire dashboard on tab change (no lazy loading)
- `applyFilters()` + `sortIssues()` run on every render without memoization
- `ProjectsPage` detail view re-fetches full project after every mutation (redundant if PATCH returns full object)

**M2. Data Consistency Risks**
- Project detail edit compares fingerprints, but no optimistic concurrency (no version/etag)
- Orchestration state (`domain/orchestration.ts`) manually syncs handoff/run states — race risk
- Dev mode accepts any Bearer token — security risk in staging

**M3. UI/UX Polish Needed**
- Delete button not disabled during save in `ProjectsPage` detail
- `window.confirm()` for delete — should use styled dialog
- No auto-save or "unsaved changes" warning when navigating away from detail
- Git URL validation is prefix-only (`isPlausibleGitRemote`), could allow malformed URLs
- Boundary mode switching clears path/url — no "are you sure?" confirmation

**M4. Missing Features for Project Boundaries**
- No visual indicator in project list showing which boundary type is active
- No way to "test" a boundary (validate path exists or git URL is reachable)
- No bulk boundary assignment
- Boundary info not shown in issue detail when issue belongs to a bounded project

---

## Part 2: Project Boundary Feature Deep Dive

### 2.1 Current Implementation

**Frontend Flow:**
```
CreateProjectDialog
  └── ProjectBoundaryFields (radio: none / local_folder / git_repo)
        ├── local_folder → pickLocalDirectoryPath() via asyncShell IPC
        └── git_repo → text input with isPlausibleGitRemote() validation

ProjectsPage (detail view)
  └── ProjectBoundaryFields (compact mode, same component)
        └── isDirty detection via fingerprint comparison
```

**Backend Flow:**
```
POST /api/projects/ → normalize_project_boundary() → INSERT with boundary_* columns
PATCH /api/projects/{id} → normalize_project_boundary() → UPDATE changed columns
GET /api/projects/ → returns boundary_kind, boundary_local_path, boundary_git_url
```

### 2.2 Logic Issues

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| B1 | `projectBoundaryApiFields()` sends `null` for path/url when empty string — backend `normalize_project_boundary()` will reject with "required" error | `ProjectBoundaryFields.tsx:39-44` | **Bug** |
| B2 | Switching boundary mode clears the other field's state, but doesn't prompt user — accidental data loss if switching back | `ProjectBoundaryFields.tsx:80-89` | UX |
| B3 | `pickLocalDirectoryPath()` uses `usageStats:pickDirectory` channel name — misleading name for a directory picker | `ProjectBoundaryFields.tsx:27` | Minor |
| B4 | No path normalization — Windows paths (`D:\foo`) vs Unix paths (`/home/foo`) stored as-is, backend doesn't normalize | Backend `handlers.rs` | **Design Gap** |
| B5 | Backend has no CHECK constraint ensuring local_path is NULL when kind='git_repo' and vice versa | Migration #54 | Data integrity |
| B6 | `isPlausibleGitRemote()` allows `file:` protocol — potentially dangerous for local file exfiltration | `ProjectBoundaryFields.tsx:18` | Security |
| B7 | No validation that the local path actually exists on the machine | Both | UX |
| B8 | Boundary kind not indexed in database — queries filtering by boundary will full-scan | Migration #54 | Performance |

### 2.3 UI/UX Issues

| # | Issue | Recommendation |
|---|-------|---------------|
| U1 | Boundary section in CreateProjectDialog has no visual hierarchy distinction | Add section divider or card container |
| U2 | Radio buttons are pill-style but look identical to other pills in the toolbar | Use a distinct visual treatment (e.g., segmented control) |
| U3 | "Pick Folder" button has no loading state while native dialog is open | Add spinner or disabled state |
| U4 | Git URL input has no inline validation feedback (only on submit) | Add real-time validation indicator |
| U5 | Path display truncates with "..." from the left — hard to distinguish similar deep paths | Show last folder name prominently, full path on hover |
| U6 | No boundary type icon/indicator in the projects list view | Add small icon (folder/git) in the project row |
| U7 | Compact mode in detail view is too cramped on narrow screens | Add responsive breakpoint |
| U8 | No explanation of what "boundary" means to new users | Add tooltip or "learn more" link |

---

## Part 3: Iteration Roadmap

### Phase A: Bug Fixes & Stability (Priority: Immediate)

**A1. Fix boundary field null/empty mismatch**
- Frontend: `projectBoundaryApiFields()` should not send boundary fields at all when mode is `none`, instead of sending `null`
- Backend: add CHECK constraints: `boundary_local_path IS NOT NULL WHEN boundary_kind = 'local_folder'`

**A2. Tighten type definitions**
- Remove `| string` from `assignee_type`, `boundary_kind`, `lead_type` in `types.ts`
- Use discriminated unions where appropriate

**A3. Fix error handling**
- `CreateProjectDialog`: distinguish validation errors vs network errors
- `pickLocalDirectoryPath()`: show toast when shell is unavailable
- `IssuesHubPage`: surface swallowed errors to user

**A4. Add DB constraints for boundary integrity**
```sql
ALTER TABLE project ADD CONSTRAINT ck_project_boundary_local
    CHECK (boundary_kind != 'local_folder' OR boundary_local_path IS NOT NULL);
ALTER TABLE project ADD CONSTRAINT ck_project_boundary_git
    CHECK (boundary_kind != 'git_repo' OR boundary_git_url IS NOT NULL);
ALTER TABLE project ADD CONSTRAINT ck_project_boundary_none_clears
    CHECK (boundary_kind != 'none' OR (boundary_local_path IS NULL AND boundary_git_url IS NULL));
```

---

### Phase B: Boundary Enforcement (Priority: High — Core Feature Gap)

This is the most critical missing piece — boundaries are stored but never enforced.

**B1. Design enforcement strategy**

Option A — **System prompt injection** (simpler, less secure):
- When executor creates an LLM call for a task in a bounded project, prepend boundary constraints to the system prompt
- Example: "You may ONLY read/write files under `/home/user/project-x/`. Refuse any operation outside this path."
- Pros: easy to implement. Cons: LLM compliance is best-effort, not guaranteed.

Option B — **Tool-level sandboxing** (more secure):
- Executor wraps file-access tools with path validation middleware
- Before executing any file read/write/exec, check against `boundary_local_path` or allowed paths
- For git_repo: clone to a temp workspace, restrict operations to that directory
- Pros: deterministic enforcement. Cons: requires changes to executor tool layer.

**Recommended**: Implement both — system prompt (B2) as first pass, tool sandboxing (B3) as hardening.

**B2. System prompt boundary injection**
- Backend: when building agent system prompt for a task, resolve `project.boundary_*` via `issue.project_id`
- Inject boundary instructions into system prompt
- Add `allowed_paths` from `async_org_employee` as additional constraint

**B3. Tool-level path validation**
- Backend: add middleware in executor that intercepts file operations
- Validate resolved absolute path starts with allowed boundary
- Reject with clear error message if out of bounds
- For `git_repo` boundary: auto-clone or validate remote matches configured URL

**B4. Frontend boundary status display**
- Show boundary enforcement status in issue detail (when issue belongs to bounded project)
- Add "Boundary: Local Folder" badge in project list
- Show warning if agent task operates outside boundary

---

### Phase C: Project Boundary UX Polish (Priority: Medium)

**C1. Inline validation**
- Git URL: show green/red indicator as user types (debounced)
- Local path: show folder existence check result (if shell available)

**C2. Boundary type indicator in project list**
- Add column or icon showing boundary type per project row
- `none` → no icon, `local_folder` → folder icon, `git_repo` → git icon

**C3. Path normalization**
- Frontend: normalize Windows backslashes to forward slashes before sending
- Backend: store normalized form, add migration to fix existing data

**C4. "Test Connection" for git_repo**
- Add button to verify git URL is reachable (`git ls-remote`)
- Show result inline (accessible / auth required / not found)

**C5. Boundary summary in project detail header**
- Show active boundary as a chip/badge below project title in detail view
- Clickable to scroll to boundary section

**C6. Unsaved changes guard**
- Add `beforeunload` handler or in-app navigation guard when `isDirty` is true
- Prompt user before leaving detail view with unsaved boundary changes

---

### Phase D: Executor & Task Pipeline (Priority: High)

**D1. Complete executor LLM call chain**
- Ensure `executor/llm.rs` properly handles streaming responses
- Wire task status transitions: queued → dispatched → running → completed/failed
- Implement result reporting back to issue

**D2. Task approval via IM**
- When task requests approval, send interactive message via Telegram bot
- Include approve/reject buttons in message
- Handle callback_query to update task status

**D3. Project-scoped task creation**
- When creating a task for an issue with `project_id`, auto-apply project boundary
- Pass boundary info to executor startup

**D4. `allowed_paths` + `max_llm_tokens` enforcement**
- Read `async_org_employee.allowed_paths` when executor processes task for that employee
- Enforce path restrictions in tool layer
- Track token usage and enforce `max_llm_tokens` soft cap

---

### Phase E: IM Bridge Completion (Priority: Medium-Low)

**E1. Feishu bridge**
- Register webhook route in Axum router
- Implement event signature verification (`X-Lark-Signature`)
- Handle `im.message.receive_v1` events
- Send replies via Feishu API

**E2. Discord bridge**
- Enable serenity dependency in Cargo.toml
- Implement gateway connection and event loop
- Handle message events, send replies with embeds

**E3. Unified bridge abstraction**
- Extract common trait: `BridgeProvider { start, stop, send_message, handle_callback }`
- Reduce code duplication across providers

---

### Phase F: Performance & Polish (Priority: Medium)

**F1. Lazy tab loading**
- Use `React.lazy()` for page components
- Only mount the active tab's page component

**F2. Memoize filtering/sorting**
- Wrap `applyFilters()` + `sortIssues()` in `useMemo` with proper deps
- Avoid recomputing on unrelated renders

**F3. Optimistic concurrency**
- Add `updated_at` comparison (or ETag) for project/issue updates
- Return 409 Conflict if server state diverged

**F4. Delete confirmation dialog**
- Replace `window.confirm()` with styled in-app dialog
- Match design system (Void tokens, transitions)

**F5. RBAC foundation**
- Add `role` enum to member table queries (owner / admin / member / viewer)
- Restrict destructive operations (delete project, manage employees) to admin+
- Show/hide UI elements based on role

---

## Part 4: Priority Matrix

```
                        High Impact
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         │   Phase B        │   Phase D        │
         │   (Boundary      │   (Executor &    │
         │    Enforcement)  │    Task Pipeline) │
         │                  │                  │
High ────┼──────────────────┼──────────────────┤
Urgency  │                  │                  │
         │   Phase A        │   Phase C        │
         │   (Bug Fixes &   │   (Boundary UX   │
         │    Stability)    │    Polish)        │
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                        Low Impact

         Phase E (IM Bridges): Medium urgency, medium impact
         Phase F (Performance): Low urgency, medium impact
```

---

## Part 5: Suggested Sprint Plan

### Sprint 1 (Current): Foundation Fixes + Workspace Context
- [ ] **P0 — Inject workspace context into AI employee system prompt** (Part 0)
  - [ ] P0.1 — Add `WorkspaceContextSnapshot` type to `shared/aiEmployeesPersona.ts`
  - [ ] P0.2 — Build snapshot in `requestEmployeeReply` from in-memory state
  - [ ] P0.3 — Inject into `buildEmployeeSystemPrompt()` in `employeeChat.ts`
  - [ ] P0.4 — Mirror in backend `scheduler.rs:build_system_prompt()`
- [ ] A1 — Fix boundary null/empty mismatch (frontend + backend)
- [ ] A2 — Tighten TypeScript types
- [ ] A3 — Fix error handling (CreateProjectDialog, pickDirectory, IssuesHub)
- [ ] A4 — Add DB CHECK constraints for boundary integrity
- [ ] C2 — Add boundary type indicator in project list
- [ ] C3 — Path normalization (frontend + backend migration)

### Sprint 2: Boundary Enforcement MVP
- [ ] B1 — Design enforcement strategy (decide prompt vs sandbox vs both)
- [ ] B2 — System prompt boundary injection
- [ ] B3 — Tool-level path validation in executor
- [ ] B4 — Frontend boundary status display in issue detail
- [ ] D3 — Project-scoped task creation with boundary pass-through

### Sprint 3: Executor & Task Flow
- [ ] D1 — Complete executor LLM call chain
- [ ] D2 — Task approval via Telegram
- [ ] D4 — `allowed_paths` + `max_llm_tokens` enforcement
- [ ] C1 — Inline validation for boundary fields
- [ ] C4 — "Test Connection" for git URLs

### Sprint 4: Polish & Bridges
- [ ] E1 — Feishu bridge implementation
- [ ] F1 — Lazy tab loading
- [ ] F2 — Memoize filtering/sorting
- [ ] F3 — Optimistic concurrency
- [ ] F4 — Styled delete confirmation dialog
- [ ] C5 — Boundary summary in project detail header
- [ ] C6 — Unsaved changes guard

### Sprint 5: RBAC & Advanced
- [ ] F5 — RBAC foundation
- [ ] E2 — Discord bridge
- [ ] E3 — Unified bridge abstraction
- [ ] Advanced boundary features (wildcard paths, multiple boundaries per project)

---

## Part 6: Technical Debt Summary

| Item | Location | Effort |
|------|----------|--------|
| `\| string` in union types | `api/types.ts` | Small |
| Generic error toasts | Multiple pages | Medium |
| `window.confirm()` usage | `ProjectsPage.tsx` | Small |
| Dev mode any-token auth | `auth.rs` | Small |
| No optimistic concurrency | Backend handlers | Medium |
| `usageStats:pickDirectory` naming | IPC channel | Small |
| Missing indexes on `boundary_kind` | Database | Small |
| Redundant re-fetch after PATCH | `ProjectsPage.tsx` | Small |
| Silent error swallowing | `IssuesHubPage.tsx` | Medium |
| No `beforeunload` guard | Detail views | Small |
