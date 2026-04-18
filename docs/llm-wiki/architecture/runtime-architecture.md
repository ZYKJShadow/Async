# 运行时架构

- 状态：已根据 `main-src/index.ts`、`main-src/ipc/register.ts`、`main-src/terminalSessionIpc.ts`、`main-src/workspace.ts`、`electron/preload.cjs`、`src/App.tsx` 校验。
- 主题：Electron 主进程、renderer、IPC、工作区绑定和启动流程。

## 总体分层

```text
Renderer (React/Vite)
  -> 通过 window.asyncShell.invoke / subscribe 调主进程
Preload (electron/preload.cjs)
  -> 暴露白名单 IPC 通道
Main (Electron / Node)
  -> 负责 Agent、文件系统、Git、模型调用、终端、持久化、索引、bot、browser
```

## 启动流程

`main-src/index.ts` 的启动顺序很重要：

1. 初始化 Windows 控制台 UTF-8。
2. 在 `web-contents-created` 中拦截 webview 新窗口行为并转发给宿主 renderer。
3. `before-quit` 时先落盘线程数据并释放 bot controller。
4. `app.whenReady()` 后依次初始化：
   - 应用图标
   - `settingsStore`
   - `botController`
   - 可恢复工作区
   - `threadStore`
   - 默认线程
   - IPC 注册
   - 主窗口
   - 自动更新

这意味着：很多“只是 UI 一个动作”的功能，其实前提是主进程 store 和 IPC 已全部就位。

## 主进程与渲染进程的边界

`electron/preload.cjs` 是 renderer 的能力边界：

- 通过 `INVOKE_CHANNELS` 白名单控制哪些 IPC 可被调用。
- 除 `invoke` 外，还提供一批 `subscribe*` 订阅接口，用于聊天流、布局变化、终端 PTY、自动更新状态、浏览器事件等。

结论：

- 如果 renderer 里某能力“看起来不存在”，先查 preload 白名单里有没有这条通道。
- 如果 main 注册了 IPC 但 preload 没暴露，renderer 仍然无法直接访问。

## IPC 的真实中心

`main-src/ipc/register.ts` 是几乎所有跨进程能力的主入口，负责：

- 工作区选择、文件读写、路径打开、目录浏览
- 线程列表、消息读取、线程重命名与切换
- 聊天发送、中止、编辑后重发
- Git 状态、diff、提交、推送、分支操作
- 计划保存、结构化计划持久化
- Agent 审批、恢复、文件快照、diff 应用
- 终端 PTY 和一次性命令执行
- Browser、MCP、LSP、自动更新等

这也是“行为事实的权威汇聚点”之一。

按**通道名字**检索时，优先使用专题页 [IPC 通道地图](./ipc-channel-map.md)（按域分组，并标注终端子模块登记位置），不必从 `register.ts` 首行逐段扫完。终端会话池的 `term:*` 与 `terminalWindow:open` 在 `terminalSessionIpc.ts` 注册，模块说明见 [terminalSessionIpc.ts](../modules/terminal-session-ipc.md)。

## 工作区绑定模型

`main-src/workspace.ts` 以 `WebContents` 为粒度绑定工作区根目录：

- 每个窗口各自拥有一个工作区根。
- `resolveWorkspacePath()` 会把相对路径解析到工作区内，并阻止越界。
- 窗口销毁时会清除绑定，避免 `webContents.id` 复用引起串台。

这直接影响：

- 文件读写工具的安全边界
- 线程按工作区分桶
- 文件索引与符号索引的生命周期

## Renderer 的角色

`src/App.tsx` 是顶层壳层，不是所有逻辑的权威实现。它主要负责：

- 布局模式和界面壳层
- 调用 hooks 组织设置、聊天、工作区、文件 tabs、团队会话等状态
- 将主进程能力装配成 UI

简言之：renderer 负责编排与展示，main 负责大量真实执行。

## Renderer 内部还有一层 Context 切片

`src/app/appShellContexts.tsx` 进一步把 `App.tsx` 汇总出来的大状态拆成多组 Context：

- chrome
- workspace
- git actions / meta / files
- settings

这不是单纯组织代码，而是性能边界的一部分，用来减少 Git 大对象变化带来的整树重渲。

## 值得记住的架构判断

- “配置存在于设置页”不代表“配置逻辑也在前端”，真实持久化多半在 `settingsStore.ts`。
- “按钮在 React 里”不代表“能力在 React 里”，很多能力最终都会穿过 preload 和 IPC 到主进程。
- 工作区是窗口级状态，不是简单的全局变量。

## Primary Sources

- `main-src/index.ts`
- `main-src/ipc/register.ts`
- `main-src/workspace.ts`
- `electron/preload.cjs`
- `src/App.tsx`

## 相关页面

- [仓库地图](../repo-map.md)
- [IPC 通道地图](./ipc-channel-map.md)
- [Agent 系统](./agent-system.md)
- [状态与记忆](./state-and-memory.md)
- [appShellContexts.tsx](../modules/app-shell-contexts.md)
- [useStreamingChat.ts](../modules/use-streaming-chat.md)

## 更新触发条件

- 启动流程变化。
- preload 白名单变化。
- IPC 注册方式变化。
- 工作区绑定语义变化。
