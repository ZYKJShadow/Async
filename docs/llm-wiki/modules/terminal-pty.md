# terminalPty.ts（已移除的历史路径）

- 模块：`main-src/terminalPty.ts`（**当前工作树中不存在**）
- 状态：旧版按 sender 绑定的 PTY IPC 路径，已确认移除；本页仅用于记录残留与避免误引用。
- 主题：旧 `terminal:pty*` 通道的原有语义、与会话池路径的区别，以及当前 preload 中的死代码残留。

## 历史职责

`registerTerminalPtyIpc()` 曾注册四个 `handle`，在 **当前 sender** 上 `pty.spawn` 默认 shell，把 `onData` / `onExit` 发回 **同一 sender**（`terminal:ptyData` / `terminal:ptyExit`）；`write` / `resize` / `kill` 时校验 `sessions.get(id).sender === event.sender`，防止跨窗口误操作。

## 为什么被移除

当前仓库已全面迁移到共享 PTY 会话池（`terminalSessionService.ts` + `terminalSessionIpc.ts`，`term:*` 通道）。旧按 sender 绑定的私有 PTY 路径不再维护。

## 当前残留

- `electron/preload.cjs` 的 `INVOKE_CHANNELS` 仍包含：
  - `terminal:ptyCreate`
  - `terminal:ptyWrite`
  - `terminal:ptyResize`
  - `terminal:ptyKill`
- `electron/preload.cjs` 仍导出 `subscribeTerminalPtyData` / `subscribeTerminalPtyExit`。
- `src/` 中已无对这些通道的 `invoke` 或订阅引用。
- `main-src` 中已无对应 handler。

## 对照：会话池路径（当前活跃实现）

| 路径 | 会话归属 | 典型用途 |
| --- | --- | --- |
| ~~`terminalPty.ts`~~（已移除） | 每会话绑定创建时的 `event.sender` | 旧「单窗口私有」场景 |
| `terminalSessionService.ts` + `terminalSessionIpc.ts` | 全局池，多窗口可订阅 | 全能终端、Agent 终端工具共享会话 |

如需修改终端相关功能，应直接看：

- [terminalSessionService.ts](./terminal-session-service.md)
- [terminalSessionIpc.ts](./terminal-session-ipc.md)
- [IPC 通道地图](../architecture/ipc-channel-map.md) 终端一节

## 相关页面

- [terminalSessionService.ts](./terminal-session-service.md)
- [terminalSessionIpc.ts](./terminal-session-ipc.md)
- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [矛盾与待确认项](../meta/contradictions-and-open-questions.md)

## 更新触发条件

- 若从 `electron/preload.cjs` 彻底删除 `terminal:pty*` 死代码，可删除本页。
- 若旧版 PTY 路径以某种形式恢复，应重建本页为活跃模块页。
