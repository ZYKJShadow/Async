# terminalPty.ts

- 模块：`main-src/terminalPty.ts`
- 状态：已根据当前源码与 `electron/preload.cjs` 校验。
- 主题：按 **创建者 `WebContents`** 绑定的本地 PTY 会话（`terminal:pty*`），与会话池路径对照。

## 一句话职责

`registerTerminalPtyIpc()` 注册四个 `handle`：在 **当前 sender** 上 `pty.spawn` 默认 shell，把 `onData` / `onExit` 发回 **同一 sender**（`terminal:ptyData` / `terminal:ptyExit`）；`write` / `resize` / `kill` 时校验 `sessions.get(id).sender === event.sender`，防止跨窗口误操作。

## 与 `terminalSessionService` / `terminalSessionIpc` 的区别

| 路径 | 会话归属 | 典型用途 |
| --- | --- | --- |
| `terminalPty.ts` | 每会话绑定创建时的 `event.sender` | 内嵌编辑器旁终端等「单窗口私有」场景 |
| `terminalSessionService.ts` + `terminalSessionIpc.ts` | 全局池，多窗口可订阅 | 全能终端、Agent 终端工具共享会话 |

两套 API **并存**；改 UI 或 Agent 工具前要先确认走的是哪条 IPC。

## `terminal:ptyCreate` 行为摘要

- **cwd**：默认当前窗口工作区根（存在则用）；可选 `opts.cwdRel` 在工作区内解析为目录（文件则取父目录）。
- **shell**：Windows 用 `ComSpec` / `cmd.exe` 且带 `chcp 65001` 前缀；类 Unix 用 `SHELL` 或 `/bin/bash`，`args` 为 `['-i']`。
- **尺寸**：固定初始 `cols: 80`、`rows: 24`（创建后靠 `terminal:ptyResize` 调整）。
- **id**：`randomUUID()`，成功则 `{ ok: true, id }`。

## 已注册的 `handle`

| 通道 | 作用 |
| --- | --- |
| `terminal:ptyCreate` | 创建会话并挂监听 |
| `terminal:ptyWrite` | 写入 PTY（校验 sender） |
| `terminal:ptyResize` | `cols`/`rows` 取整并 `Math.max` 下限后 `resize` |
| `terminal:ptyKill` | `kill` 并移除会话 |

## Renderer 侧

- **invoke**：上述四个通道须在 `preload.cjs` 的 `INVOKE_CHANNELS` 中（与共享终端的 `term:*` 不同套）。
- **事件**：preload 提供 `subscribeTerminalPtyData` / `subscribeTerminalPtyExit`，对应 `terminal:ptyData` / `terminal:ptyExit`。

## 修改这个文件时要一起看

- [terminalSessionIpc.ts](./terminal-session-ipc.md) / [terminalSessionService.ts](./terminal-session-service.md)（避免两条终端路径语义混用）
- `src/PtyTerminalView.tsx` 或实际调用 `terminal:pty*` 的组件
- `electron/preload.cjs`

## Primary Sources

- `main-src/terminalPty.ts`
- `electron/preload.cjs`

## 相关页面

- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [运行时架构](../architecture/runtime-architecture.md)

## 更新触发条件

- 默认 shell、编码策略或初始行列变化。
- 安全模型从「按 sender」改为可跨窗口共享时（通常应迁向会话池而非在本文件打补丁）。
