# terminalSessionService.ts

- 模块：`main-src/terminalSessionService.ts`
- 状态：已根据当前源码校验。
- 主题：跨窗口共享的 `node-pty` 会话池、环形输出缓冲、订阅广播、一次性命令执行，以及与 `terminalSessionIpc.ts` 的分工。

## 一句话职责

`terminalSessionService.ts` 维护**全局** `Map<id, Session>`：每个会话包含一个 `pty.IPty`、环形 UTF-8 输出缓冲（默认上限约 256KB）、单调递增的 `seq`、以及任意多个 `WebContents` 订阅者；输出与退出事件通过 `term:data` / `term:exit` / `term:authPrompt` 等通道广播给订阅方。

## 与 `terminalPty.ts` 的区别

文件头注释说明：

- **本会话池**：不绑定创建者 sender；任意窗口或 Agent 工具可 `write` / `subscribe`。
- **`terminalPty.ts`**：按 sender 绑定的较老 PTY IPC 路径（`terminal:ptyCreate` 等），与会话池并存；模块页见 [terminalPty.ts](./terminal-pty.md)。新全能终端与会话池 IPC 在 `terminalSessionIpc.ts` 注册。

## 对外 API 摘要

| 函数 | 作用 |
| --- | --- |
| `createTerminalSession` | `pty.spawn`，登记会话，`broadcastListChanged` |
| `writeTerminalSession` | 写入 PTY；会清除 pending auth prompt |
| `resizeTerminalSession` / `killTerminalSession` | 尺寸与销毁 |
| `listTerminalSessions` / `getTerminalSession` | 元数据 |
| `getTerminalBuffer` | 取环形缓冲切片（可 cap 字节） |
| `subscribeToSession` / `unsubscribeFromSession` | 增删订阅者；`destroyed` 时统一清理 |
| `renameTerminalSession` | 改标题并广播列表变化 |
| `clearTerminalSessionAuthPrompt` | 清除待响应的密码提示状态 |
| `runOneShotCommand` | 短命会话：写入命令 + `exit`，超时强杀，返回完整输出（供 Agent `Terminal run` 类场景） |

## 输出与列表广播

- 每段 `onData`：`appendBuffer` 截断超长缓冲，`seq++`，向订阅者发 `term:data`（`id, data, seq`）。
- `onExit`：标记 `alive=false`，发 `term:exit`，再 `broadcastListChanged()`（向**所有窗口** `webContents` 发 `term:listChanged`，便于侧栏会话列表同步）。
- 新会话创建同样 `broadcastListChanged()`。

## 密码 / passphrase 提示

`maybeHandleAuthPrompt` 扫描输出尾部（经 OSC/ANSI 剥离、退格折叠）是否像 `password:` / `passphrase:` 提示：

- 若创建会话时传入 `passwordAutofill` 且未超过 `MAX_PASSWORD_AUTOFILL_ATTEMPTS`，可自动写入一次。
- 否则设置 `pendingAuthPrompt` 并通过 `term:authPrompt` 广播，供 UI 收集用户输入。

## IPC 面在哪里

Renderer 不直接 import 本文件；实际调用链为：

`preload invoke` → [terminalSessionIpc.ts](./terminal-session-ipc.md) 中 `ipcMain.handle('term:…')` → 调用上述导出函数。

详见 [IPC 通道地图](../architecture/ipc-channel-map.md) 终端一节。

## 修改这个文件时要一起看

- `main-src/terminalSessionIpc.ts`（模块页见 [terminalSessionIpc.ts](./terminal-session-ipc.md)）
- `main-src/agent/toolExecutor.ts`（Agent 终端工具如何创建/读写会话）
- `main-src/terminalProfileSecrets.ts`（profile 密码，由 IPC 层配合）

## Primary Sources

- `main-src/terminalSessionService.ts`
- `main-src/terminalSessionIpc.ts`

## 相关页面

- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [运行时架构](../architecture/runtime-architecture.md)

## 更新触发条件

- 缓冲上限、广播通道名或订阅生命周期策略变化。
- 与 Agent 终端工具或独立终端窗口的集成方式变化。
