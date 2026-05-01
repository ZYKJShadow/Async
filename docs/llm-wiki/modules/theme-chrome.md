# themeChrome.ts

- 模块：`main-src/themeChrome.ts`
- 状态：已根据当前源码校验。
- 主题：原生窗口标题栏/背景色与渲染层主题 token 的对齐，以及跨平台（Windows / macOS）的外观策略。

## 一句话职责

`themeChrome.ts` 负责把渲染层选中的主题（light / dark / 自定义调色盘）同步到 Electron 原生窗口 chrome：背景色、标题栏颜色、按钮符号色，让窗口边框和原生控件与 UI 主题保持一致。

## 核心机制

### 内置双色方案

| 方案 | 背景色 | 标题栏色 | 符号色 |
| --- | --- | --- | --- |
| `light` | `#e8edf5` | `#EFF3F9` | `#18202e` |
| `dark` | `#111111` | `#161D24` | `#BBBBBB` |

### 自定义覆盖

渲染层可通过 `theme:applyChrome` IPC 传入 `NativeChromeOverride`（`backgroundColor` / `titleBarColor` / `symbolColor`），只要符合 hex6 格式就会覆盖默认值。这支持 Mac Codex 主题、外观调色盘等自定义场景。

### Windows 标题栏 Overlay

仅在 `process.platform === 'win32'` 时调用 `win.setTitleBarOverlay(...)`；macOS 不走此路径。标题栏高度固定为 44px。

### 全窗口批量应用

`applyThemeChromeToAllWindows(scheme)` 可在主题切换时遍历所有存活窗口统一刷色。

## 与渲染层的关系

- 前端通过 `SettingsAppearancePanel.tsx` 让用户选择颜色模式、调色盘、字体预设。
- 设置变更后，前端调用 `window.asyncShell.invoke('theme:applyChrome', ...)` 把覆盖值传回主进程。
- 主进程 `appHandlers.ts` 中 `theme:applyChrome` handler 调用本模块完成原生窗口刷新。

## 修改这个文件时要一起看

- `src/SettingsAppearancePanel.tsx`（前端外观设置 UI）
- `main-src/ipc/handlers/appHandlers.ts`（`theme:applyChrome` IPC 注册）
- `src/app/appShellContexts.tsx` 或 `src/App.tsx`（主题状态分发）

## Primary Sources

- `main-src/themeChrome.ts`
- `electron/preload.cjs`（`theme:applyChrome` 白名单）

## 相关页面

- [运行时架构](../architecture/runtime-architecture.md)
- [IPC 通道地图](../architecture/ipc-channel-map.md)

## 更新触发条件

- 新增主题方案或调色盘语义变化。
- 跨平台标题栏策略变化（如 macOS 也需要 Overlay）。
- 自定义覆盖字段增减。
