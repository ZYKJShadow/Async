# browserController.ts

- 模块：`main-src/browser/browserController.ts`（同目录 `browserFingerprintNormalize.ts`、`browserCapture.ts`、`browserMitmProxy.ts`、`browserCaInstaller.ts`、`browserSystemProxy.ts` 为紧密依赖）
- 状态：已根据当前源码校验。
- 主题：内置浏览器侧栏的配置、分区隔离、命令控制、指纹伪装、代理与抓包能力。

## 一句话职责

`browserController.ts` 是 Async 内置浏览器的「驾驶舱」：按宿主窗口分隔浏览器配置与状态，通过 `BrowserControlCommand` 驱动导航/刷新/截图/读页等操作，并支持自定义请求头、指纹伪装、代理规则和请求抓包。

## 核心概念

### 按窗口分隔

每个宿主窗口拥有独立的浏览器 runtime state（`BrowserRuntimeState`），包含：

- `activeTabId`：当前激活标签
- `tabs`：标签列表，每条含 `requestedUrl`、`currentUrl`、`pageTitle`、`isLoading`、`loadError` 等

这意味着多窗口之间浏览器状态互不干扰。

### 配置项

`BrowserSidebarConfig` 包含：

| 字段 | 说明 |
| --- | --- |
| `userAgent` | 自定义 User-Agent |
| `acceptLanguage` | Accept-Language 头 |
| `extraHeaders` / `extraHeadersText` | 附加请求头（key:value 每行一个） |
| `blockTrackers` | 是否拦截追踪器 |
| `proxyMode` | `system` / `direct` / `custom` |
| `proxyRules` / `proxyBypassRules` | 自定义代理规则 |
| `fingerprint` | 指纹伪装设置（时区、屏幕尺寸、WebGL、Canvas、字体等） |

### 命令体系

`BrowserControlCommand` 支持：

- `navigate` —— 导航到指定 URL，可选新开标签
- `reload` / `stop` / `goBack` / `goForward` / `closeTab` —— 常规浏览控制
- `closeSidebar` —— 关闭浏览器侧栏
- `readPage` —— 读取页面内容，支持 CSS selector、HTML 包含开关、最大字符数
- `screenshotPage` —— 页面截图

### 与 Agent 的关系

Agent 工具中的 `Browser` 工具最终调用 `browserController.ts` 中的命令。因此 Agent 的「打开网页→读取内容→截图」能力不是简单外链跳转，而是受控的内置浏览器会话。

## 抓包与代理子系统

同目录下还有一组抓包/代理相关模块：

- `browserCapture.ts` —— 请求捕获、HAR 风格导出
- `browserMitmProxy.ts` —— MITM 代理核心
- `browserCaInstaller.ts` / `browserSystemProxy.ts` —— CA 证书与系统代理切换

这些通过 `browserCapture:*` IPC 通道暴露给 UI，详见 [IPC 通道地图](../architecture/ipc-channel-map.md) 浏览器抓包一节。

## 修改这个文件时要一起看

- `main-src/browser/browserFingerprintNormalize.ts`（指纹字段规范化）
- `src/SettingsBrowserPanel.tsx` / `src/SettingsBrowserFingerprintEditor.tsx`（浏览器设置 UI）
- `src/AgentBrowserWindowSurface.tsx`（Agent 浏览器工具 UI）
- `main-src/ipc/handlers/browserHandlers.ts`（`browser:*` / `browserCapture:*` IPC）
- `main-src/agent/toolExecutor.ts`（Browser 工具执行分支）

## Primary Sources

- `main-src/browser/browserController.ts`
- `main-src/browser/browserFingerprintNormalize.ts`
- `main-src/ipc/handlers/browserHandlers.ts`

## 相关页面

- [工作区智能](../architecture/workspace-intelligence.md)
- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [toolExecutor.ts](./tool-executor.md)

## 更新触发条件

- 新增浏览器命令类型。
- 指纹伪装字段变化。
- 代理模式或抓包策略变化。
- 浏览器分区/会话隔离策略变化。
