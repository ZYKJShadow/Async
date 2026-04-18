# terminalSessionIpc.ts

- 模块：`main-src/terminalSessionIpc.ts`
- 状态：已根据当前源码与 `electron/preload.cjs` 的 `INVOKE_CHANNELS` 校验。
- 主题：共享 PTY 会话池的 **IPC 薄层**：参数校验、`cwd` 解析、独立终端窗口的 host/renderer 映射，以及把调用转交给 `terminalSessionService.ts` / profile 密码存储。

## 一句话职责

本文件只负责 **`ipcMain.handle`**：把 renderer 的 `term:*`、`terminalWindow:open` 等调用转成对 `createTerminalSession`、`writeTerminalSession`、`subscribeToSession` 等纯逻辑 API 的调用；**不**维护会话 `Map` 或 PTY 生命周期（那在 `terminalSessionService.ts`）。

## 与 `terminalSessionService.ts` 的分工

| 层次 | 文件 | 内容 |
| --- | --- | --- |
| 业务与 PTY | `terminalSessionService.ts` | 全局会话池、环形缓冲、`term:data` / `term:exit` / `term:authPrompt` 广播 |
| IPC 适配 | `terminalSessionIpc.ts` | handle 注册、参数类型收窄、`cwd` / 对话框 / 窗口映射 |

旧版「按 sender 绑定」的 PTY 仍在 `terminalPty.ts`（`terminal:pty*`），与会话池路径并存；模块说明见 [terminalPty.ts](./terminal-pty.md)。

## 独立终端窗口：host ↔ renderer 映射

全能终端可在独立 `BrowserWindow` 中打开（`createAppWindow` + `queryParams.terminalWindow=1`）。子窗口 renderer 的 `webContents.id` 与「发起方宿主」的 id 不同，因此维护：

- `terminalWindowRendererByHost`：host `webContents.id` → 子窗口 renderer id
- `terminalWindowHostByRenderer`：反向索引
- `resolveHostId(sender)`：子窗口内调用时回到 host，以便 `terminalWindow:open` 等仍关联到正确宿主

`openPromisesByHost` 合并同一 host 上并发的「确保子窗口已创建」请求，避免重复开窗。

## `term:sessionCreate` 的选项摘要

在转调 `createTerminalSession` 前会整理：

- `cwd`：经 `resolveCwdForSender` — 缺省时用已绑定且存在的**工作区根**；相对路径在工作区内解析；存在且为文件则取其目录。
- `shell` / `args` / `env` / `cols` / `rows` / `title`：类型过滤后的白名单字段。
- `passwordAutofill`：当存在 `profileId` 且 SSH 认证模式为自动或密码时，从 `terminalProfileSecrets` 取 profile 密码注入 `TerminalSessionCreateOpts`（与 `terminalSessionService` 内自动填充逻辑衔接）。

## 已注册的 `handle` 一览

与 [IPC 通道地图](../architecture/ipc-channel-map.md) 终端表一致，本文件注册：

- `terminalWindow:open`：聚焦或创建宿主对应的独立终端窗口。
- `term:sessionCreate` / `term:sessionWrite` / `term:sessionRespondToPrompt` / `term:sessionClearPrompt` / `term:sessionResize` / `term:sessionKill` / `term:sessionRename` / `term:sessionList` / `term:sessionInfo` / `term:sessionBuffer` / `term:sessionSubscribe` / `term:sessionUnsubscribe`
- `term:listBuiltinProfiles`
- `term:profilePasswordState` / `term:profilePasswordSet` / `term:profilePasswordClear`
- `term:pickPath`：包装 `dialog.showOpenDialog`（文件或目录、可选多选与扩展名过滤器）。

导出函数 `openTerminalWindowForHostId` 供主进程其它模块在不经 IPC 的情况下打开/聚焦同一映射下的终端窗口。

## 修改这个文件时要一起看

- `main-src/terminalSessionService.ts`
- `main-src/terminalPty.ts`（旧 PTY IPC 对照）
- `electron/preload.cjs`（`INVOKE_CHANNELS` 与 `term:*` 订阅）
- `src/TerminalWindowSurface.tsx`（若改独立窗口 URL 参数或终端 UI 契约）

## Primary Sources

- `main-src/terminalSessionIpc.ts`
- `main-src/terminalSessionService.ts`
- `electron/preload.cjs`

## 相关页面

- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [terminalSessionService.ts](./terminal-session-service.md)
- [运行时架构](../architecture/runtime-architecture.md)

## 更新触发条件

- 新增、重命名或删除任意 `term:*` / `terminalWindow:*` handle。
- 独立终端窗口的 query 参数或 host 映射策略变化。
- Preload 白名单与主进程不同步时，须同时改 preload 与本页及 IPC 地图。
