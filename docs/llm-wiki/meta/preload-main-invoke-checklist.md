# Preload 与主进程 `invoke` 对齐检查清单

- 状态：流程说明 + 截至 2026-04-18 的基线备注。
- 主题：在 `electron/preload.cjs` 增加或删除 `INVOKE_CHANNELS` 条目时，如何与主进程 `ipcMain.handle` 保持一致，避免「主进程已实现但 UI 报 blocked」或「白名单开了却无人处理」。

## 背景

Renderer 通过 `window.asyncShell.invoke(channel, ...args)` 发 IPC；preload 在 invoke 前执行：

```text
INVOKE_CHANNELS.has(channel) ? ipcRenderer.invoke(...) : throw blocked
```

因此：**channel 字符串必须与主进程 `handle` 的第一个参数完全一致**（含大小写、冒号分段）。

推送类能力（`webContents.send`、`ipcRenderer.on`）走 `subscribe*` 或独立 `on`，**不在**本清单的 `Set` 范围内，但改通道名时仍要同步搜全仓库。

## 主进程 `handle` 注册位置（权威入口）

| 文件 | 内容 |
| --- | --- |
| `main-src/ipc/register.ts` | 绝大部分业务通道 |
| `main-src/terminalSessionIpc.ts` | `term:*`、`terminalWindow:open` |
| `main-src/terminalPty.ts` | `terminal:ptyCreate` 等 |

`registerIpc()` 内会先 `registerTerminalPtyIpc()`、`registerTerminalSessionIpc()`，再注册 `register.ts` 本体中的 handle（见 [运行时架构](../architecture/runtime-architecture.md)）。

## 推荐操作步骤（新增 renderer 可调通道时）

1. 在对应主进程文件添加 `ipcMain.handle('your:channel', …)`。
2. 将 `'your:channel'` 加入 `electron/preload.cjs` 的 `INVOKE_CHANNELS`。
3. 更新 [IPC 通道地图](../architecture/ipc-channel-map.md) 相应分组表。
4. 全局搜字符串 `your:channel`，确认无拼写分叉（含测试、mock）。
5. 在 renderer 实际路径上手动点一次或跑相关 E2E，确认不再出现 `async-shell: blocked IPC channel`。

## 推荐操作步骤（仅主进程 / 无 UI 需求时）

- **不要**加入 `INVOKE_CHANNELS`，除非确定 renderer 需要调用。
- 仍建议在 IPC 地图中记录该通道（若属于对外契约的一部分），并注明「仅主进程 / bot / 测试」。

## 自动化核对思路（可选）

在仓库根执行（需本机有 Node；仅为维护者脚本思路，Wiki 不提交脚本）：

1. 用 ripgrep从上述三个文件提取 `ipcMain.handle('…')` 中的通道字面量集合 `M`。
2. 从 `preload.cjs` 解析 `INVOKE_CHANNELS` 集合 `P`。
3. 报告：
   - `P - M`：白名单有而主进程无（死通道或笔误）；
   - `M - P`：主进程有而白名单无（**renderer 无法 invoke**，可能是刻意仅给 bot 用）。

运行前注意：`register.ts` 里部分 `handle` 跨行书写，简单正则可能漏项，应以人工或 AST 级提取为准。

## 已知基线差异（2026-04-18）

| 通道 | 现象 |
| --- | --- |
| `team:userInputRespond` | 出现在 `INVOKE_CHANNELS` 中；`main-src` 内 **未** 发现对应 `ipcMain.handle`；`src/` 内亦无引用。疑似预留或遗漏，见 [矛盾与待确认项](./contradictions-and-open-questions.md)。 |

## 相关页面

- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [运行时架构](../architecture/runtime-architecture.md)
- [维护手册](./maintenance-playbook.md)
- [terminalSessionIpc.ts](../modules/terminal-session-ipc.md) / [terminalPty.ts](../modules/terminal-pty.md)

## 更新触发条件

- 任意改动 `INVOKE_CHANNELS` 或上述主进程 IPC 注册文件。
- 引入新的 preload 订阅 API 且涉及与 `invoke` 成对的通道名时。
