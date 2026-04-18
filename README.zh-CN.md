# Async IDE

<p align="center">
  <img src="docs/assets/async-logo-desktop.svg" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>开源 AI IDE Shell —— 对标 Cursor：Agent、编辑器、Git、终端，一个都不少。</strong><br/>
  用完全开放的技术栈，把 Cursor 那套玩法搬到你自己手里。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/对标%20Cursor-开源实现-818cf8?style=flat-square" alt="对标 Cursor 且开源" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/Electron-41-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Monaco-0.52-0078D4?style=flat-square" alt="Monaco Editor" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

---

## 对标 Cursor，开源实现

说白了就一个目标：**在功能和体验上对标 [Cursor](https://cursor.com)**——AI 原生 IDE Shell，Agent、Monaco 编辑器、工作区工具、Diff 审阅、终端全部拧成一股绳——**但以开源方式交付**：**Apache 2.0** 协议，**自带模型密钥（BYOK）**，对话与配置默认**存在本地**。

你可以把它理解成一个 AI 原生桌面工作区：Agent、Monaco 编辑器、Git、Diff 审阅、终端都放在一起，但底层是透明的、可以自己研究也可以自己改。项目使用 **Apache 2.0** 协议，模型接入走 **BYOK**，线程、设置、计划默认都是 **本地优先**。

| 维度 | **Cursor** | **Async IDE** |
| --- | --- | --- |
| **交付方式** | 商业产品 | **开源代码**，可读、可改、可自建 |
| **模型接入** | 平台内计费 / 集成 | **BYOK**，支持 OpenAI、Anthropic、Gemini 和兼容接口 |
| **数据存储** | 产品侧管理 | **本地优先**，线程、设置、计划都在你机器上 |
| **产品重点** | 完整 IDE 产品 | 更聚焦的桌面 **Shell**：Agent、编辑器、Git、终端 |

---

## Async IDE 是什么？

Async IDE 是一款开源的 AI 原生桌面应用，定位是你和 Agent 之间的主战场。它不是那种缝在编辑器侧边的聊天插件，而是从 **Agent 循环**出发，把多模型对话、自主工具执行、审阅确认都塞进同一个工作区里。

### 为什么选 Async？

- **Agent 优先** —— Agent 可以直接访问你的工作区、工具和终端，走的是清晰的**思考 → 规划 → 执行 → 观察**闭环。
- **过程透明** —— 流式工具参数（JSON 边生成边展示）+ **工具轨迹**卡片（`Read`、`Write`、`Edit`、`Glob`、`Grep`、Shell 等），每一步都看得见。
- **自主可控** —— 用你自己的 API 密钥，对话记录和仓库状态全在本地，不依赖任何云端服务。
- **Git 原生** —— 状态、Diff、Agent 改动和真实仓库实时同步。
- **四种 Composer 模式** —— **Agent**（自主执行）、**Plan**（先审后跑）、**Ask**（只读问答）、**Debug**（系统排查），覆盖日常开发的各种场景。
- **IM 机器人桥接** —— 把 **Telegram**、**Slack**、**Discord**、**飞书** 接到与桌面端同一套 Agent / **Team** 编排能力上；可按集成配置默认模型、工作区、白名单、可选 HTTP 代理，并在平台支持时流式回传进度。
- **轻量外壳** —— Electron + React，**Agent / Editor** 双布局，Monaco + 内嵌终端，整体思路和 Cursor 一脉相承，代码体量更聚焦。

---

## 界面预览（部分）

### Agent布局界面
<p align="center">
  <img src="docs/assets/workspace_1.png" width="3062" alt="Async Agent 布局" />
</p>

### 模型设置

<p align="center">
  <img src="docs/assets/setting_1.png" width="1824" alt="Async 模型设置" />
</p>

### 外观调色盘

<p align="center">
  <img src="docs/assets/setting_2.png" width="1829" alt="Async 模型设置" />
</p>

#### Cursor主题

<p align="center">
  <img src="docs/assets/setting_3.png" width="1828" alt="Async 模型设置" />
</p>

### 浏览器工具调用（可自定义请求头）

<p align="center">
  <img src="docs/assets/browser_1.png" width="2868" alt="Async 模型设置" />
</p>

### 多Agent协作专家团

<p align="center">
  <img src="docs/assets/multi_agent_1.png" width="2871" alt="Async 模型设置" />
</p>

### 通过外部机器人以对话的方式控制整个应用

<p align="center">
  <img src="docs/assets/bot_1.png" width="2871" alt="Async 模型设置" />
</p>

### 全能终端（内部命令可被Agent和机器人直接调用）

<p align="center">
  <img src="docs/assets/terminal_1.png" width="2859" alt="Async 模型设置" />
</p>

<p align="center">
  <img src="docs/assets/terminal_2.png" width="2871" alt="Async 模型设置" />
</p>

<p align="center">
  <img src="docs/assets/terminal_3.png" width="2865" alt="Async 模型设置" />
</p>

---

## 核心特性

### 自主 Agent 循环

- 工具参数流式展示，配合轨迹卡片，执行过程比较清楚。
- **Plan** 和 **Agent** 双模式：可以先看计划，也可以直接让 Agent 开跑。
- Shell 命令和文件写入支持审批门控。
- Agent 改代码时，可以联动编辑器定位到对应文件和行范围。
- 支持嵌套子 Agent、后台执行和时间线式活动展示。

### 多模型支持

- 内置 **Anthropic**、**OpenAI**、**Gemini** 适配。
- 支持兼容 OpenAI 接口的各种端点，比如 Ollama、vLLM、聚合 API、自建服务。
- 在支持的模型上展示流式思考块。
- **Auto** 模式可以自动挑当前最合适的模型。

### 开发体验

- **Monaco** 编辑器，支持多标签页、语法高亮和 Diff 审阅流程。
- **Git** 集成：状态、Diff、暂存、提交、推送都能在 UI 里完成。
- **xterm.js** 终端：既能自己用，也能看 Agent 触发了什么 Shell 操作。
- **Composer** 支持 `@` 文件引用、多段消息和线程持久化。
- **快速打开**（`Ctrl/Cmd+P`）和整体键盘优先的交互。
- 内置中英文国际化。
- 支持本地 disk skills、工作区配置合并和工具审批控制。

### IM / 机器人接入

除了桌面里的 Composer，Async 也可以作为「外挂聊天面」上的 **Agent 宿主**。

- **支持平台** —— **Telegram**、**Slack**、**Discord**、**飞书**，适配代码在 `main-src/bots/platforms/`。
- **同一套运行时** —— 外部消息由 **`botRuntime`** 驱动：普通会话走 **`agentLoop`**；**Team** 模式则与桌面端一致，走 **`teamOrchestrator`**（含子 Agent 流式增量与工具状态等）。
- **按集成配置** —— 开关、名称、**默认模型**、**默认 Composer 模式**（`agent` / `ask` / `plan` / `team`）、**工作区根目录（可多选）**、可选 **会话 / 用户白名单**，以及附加 **系统提示词**（叠在项目规则之上）。
- **网络与代理** —— 各平台可单独配置 **HTTP 代理 URL**，便于在企业网络下访问厂商 API / Webhook。
- **飞书** —— 应用凭证、可选加解密、**流式互动卡片** 展示长任务进度；集成配置变更时会清理相关会话状态，避免串会话。
- **界面入口** —— **设置 → 机器人**（`SettingsBotsPanel.tsx`）。

更细的模块说明见维护者向文档 [`docs/llm-wiki/`](./docs/llm-wiki/)。

---

## 技术架构

```text
┌─────────────────────────────────────────────────────────┐
│                      渲染进程                           │
│  React + Vite  │  Monaco 编辑器  │  xterm.js 终端      │
│  Composer / Chat / Plan / Agent UI                     │
└──────────────────────────┬──────────────────────────────┘
                           │  contextBridge（IPC）
┌──────────────────────────▼──────────────────────────────┐
│                       主进程                            │
│  agentLoop.ts  │  toolExecutor.ts  │  LLM 适配器       │
│  gitService    │  threadStore      │  settingsStore    │
│  workspace     │  LSP 会话         │  PTY 终端         │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | ^19.2.4 | UI 框架 |
| **Electron** | 41.1.0 | 桌面应用外壳 |
| **Vite** | ^6.0.3 | 构建工具与开发服务器 |
| **TypeScript** | ^5.9.3 | 类型安全开发 |
| **Monaco Editor** | ^0.52.0 | 代码编辑器组件 |
| **xterm.js** | ^5.5.0 | 终端模拟器 |
| **OpenAI SDK** | ^4.96.0 | OpenAI API 客户端 |
| **Anthropic SDK** | ^0.39.0 | Claude API 客户端 |
| **Google Generative AI** | ^0.21.0 | Gemini API 客户端 |
| **MCP SDK** | ^1.29.0 | Model Context Protocol |
| **node-pty** | ^1.1.0 | PTY 终端支持 |

- 主进程和渲染进程分离，通过 Electron `contextBridge` 和 `ipcMain` 通信。
- **`agentLoop.ts`** 负责多轮工具调用、流式 JSON 片段、工具修复和中止控制。
- Assistant 消息支持结构化持久化，需要时再展开成不同模型原生的 tool 格式。
- 线程、设置、计划等数据默认以 JSON / Markdown 形式落在本地。
- **`gitService`** 提供 UI 用到的 Git 操作层。
- **LSP** 目前接入了 TypeScript Language Server。

## 项目结构

```text
Async/
├── main-src/                  # 主进程源码，最终打包到 electron/main.bundle.cjs
│   ├── index.ts               # 应用入口：窗口、userData、IPC 注册
│   ├── agent/                 # agentLoop.ts、toolExecutor.ts、agentTools.ts 等
│   ├── llm/                   # OpenAI / Anthropic / Gemini 适配器与流式处理
│   ├── lsp/                   # TypeScript LSP 会话
│   ├── mcp/                   # Model Context Protocol 集成
│   ├── memdir/                # 记忆目录管理
│   ├── bots/                  # IM 机器人：控制器、运行时、连通性检测、各平台适配器
│   ├── ipc/register.ts        # IPC 处理函数（聊天、线程、Git、文件系统等）
│   ├── shell/                 # Shell 命令执行
│   ├── threadStore.ts         # 线程与消息持久化
│   ├── settingsStore.ts       # settings.json 管理
│   ├── gitService.ts          # Git 状态、Diff、提交、推送
│   ├── workspace.ts           # 工作区根目录与安全路径解析
│   ├── workspaceFileIndex.ts  # 工作区文件索引
│   ├── workspaceSemanticIndex.ts  # 语义搜索索引
│   ├── workspaceSymbolIndex.ts    # 符号索引
│   └── workspaceUsageStats.ts     # 工作区使用统计
├── src/                       # 渲染进程（Vite + React）
│   ├── App.tsx                # 主界面、聊天、Composer 模式、Git / 文件树
│   ├── AgentChatPanel.tsx     # Agent 聊天界面
│   ├── AgentLeftSidebar.tsx   # Agent 活动侧边栏
│   ├── AgentRightSidebar.tsx  # Agent 工具和结果
│   ├── ChatComposer.tsx       # 消息编辑器组件
│   ├── EditorMainPanel.tsx    # Monaco 编辑器面板
│   ├── SettingsPage.tsx       # 设置界面
│   ├── SettingsBotsPanel.tsx  # IM 机器人集成（Telegram / Slack / Discord / 飞书）
│   ├── WorkspaceExplorer.tsx  # 文件浏览器
│   ├── hooks/                 # 自定义 React hooks（19 个文件）
│   ├── i18n/                  # 中英文文案
│   └── ...                    # Agent UI、Plan 审阅、Monaco、终端等组件
├── electron/
│   ├── main.bundle.cjs        # esbuild 产物，不建议手改
│   └── preload.cjs            # 预加载脚本 -> window.asyncShell
├── docs/assets/               # Logo、截图
├── scripts/
│   └── export-app-icon.mjs    # SVG -> PNG 图标导出
├── esbuild.main.mjs           # 主进程构建脚本
├── vite.config.ts             # 渲染进程构建配置
└── package.json
```

## 数据存储

默认位于 Electron 的 **`userData`** 目录下：

- **`async/threads.json`**：线程和聊天消息。
- **`async/settings.json`**：模型配置、密钥、布局和 Agent 选项，以及 **`bots.integrations`**（各平台 Token、代理、白名单与默认行为等）。
- **`.async/plans/`**：Plan 模式生成的 Markdown 计划文件。

渲染进程可能会用 **localStorage** 存一些轻量 UI 状态，但对话的权威数据源还是 **`threads.json`**。

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9
- **Git**（建议安装）

### 安装与运行

1. **克隆仓库**：

   ```bash
   git clone https://github.com/ZYKJShadow/Async.git
   cd Async
   ```

   如果你更习惯 Gitee，也可以使用：

   ```bash
   git clone https://gitee.com/shadowsocks_z/Async.git
   cd Async
   ```

2. **安装依赖**：

   ```bash
   npm install
   ```

3. **构建并启动桌面应用**：

   ```bash
   npm run desktop
   ```

   这会先构建主进程和渲染进程，然后用 Electron 打开应用。

### 开发模式

```bash
npm run dev
```

如果需要同时打开 DevTools：

```bash
npm run dev:debug
```

### 生成应用图标

```bash
npm run icons
```

会把 `docs/assets/async-logo.svg` 光栅化成 `resources/icons/icon.png` 和 `public/favicon.png`。

---

## 致谢

确实也得认真感谢一下 Claude Code 带来的“开源时刻”，Async IDE 这种开源替代方案，也算是间接受益者之一。

---

## 社区交流

有问题、有想法，或者就是想和一群搞开发的人聊聊？

- **论坛**：[linux.do](https://linux.do/) —— 来这里讨论、分享你的配置、反馈问题，欢迎常驻。

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。
