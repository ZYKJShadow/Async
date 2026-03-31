# Async Shell

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
  <img src="https://img.shields.io/badge/Electron-34-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Monaco-0.52-0078D4?style=flat-square" alt="Monaco Editor" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

---

## 对标 Cursor，开源实现

说白了就一个目标：**在功能和体验上对标 [Cursor](https://cursor.com)**——AI 原生 IDE Shell，Agent、Monaco 编辑器、工作区工具、Diff 审阅、终端全部拧成一股绳——**但以开源方式交付**：**Apache 2.0** 协议，**自带模型密钥（BYOK）**，对话与配置默认**存在本地**。

|  | **Cursor**（对标参照） | **Async Shell** |
| --- | --- | --- |
| **形态** | 成熟商业产品，开箱即用 | **开源** —— 可读、可改、可自建 |
| **密钥** | 产品内计费与集成 | **BYOK**：OpenAI、Anthropic、Gemini 或任意兼容接口 |
| **会话与数据** | 随厂商走 | **本地优先**：对话、配置、计划全在你自己机器上 |
| **定位** | 完整 IDE + 生态 | 聚焦 **Shell**：Agent 循环、Monaco、Git、终端、四种 Composer 模式 |

---

## Async Shell 是什么？

Async Shell 是一款开源的 AI 原生桌面应用，定位是你和 Agent 之间的主战场。它不是那种缝在编辑器侧边的聊天插件，而是从 **Agent 循环**出发，把多模型对话、自主工具执行、审阅确认都塞进同一个工作区里。

### 为什么选 Async？

- **Agent 优先** —— Agent 可以直接访问你的工作区、工具和终端，走的是清晰的**思考 → 规划 → 执行 → 观察**闭环。
- **过程透明** —— 流式工具参数（JSON 边生成边展示）+ **工具轨迹**卡片（`read_file`、`write_to_file`、`str_replace`、`search_files`、Shell 等），每一步都看得见。
- **自主可控** —— 用你自己的 API 密钥，对话记录和仓库状态全在本地，不依赖任何云端服务。
- **Git 原生** —— 状态、Diff、Agent 改动和真实仓库实时同步。
- **四种 Composer 模式** —— **Agent**（自主执行）、**Plan**（先审后跑）、**Ask**（只读问答）、**Debug**（系统排查），覆盖日常开发的各种场景。
- **轻量外壳** —— Electron + React，**Agent / Editor** 双布局，Monaco + 内嵌终端，整体思路和 Cursor 一脉相承，代码体量更聚焦。

---

## 界面预览

### Editor 模式

<p align="center">
  <img src="docs/assets/async-editor-screenshot.png" width="1024" alt="Async Editor 模式" />
</p>

### Agent 模式

<p align="center">
  <img src="docs/assets/async-agent-screenshot.png" width="1024" alt="Async Agent 模式" />
</p>

### 模型设置

<p align="center">
  <img src="docs/assets/async-model-settings.png" width="720" alt="Async 模型设置" />
</p>

---

## 核心特性

### 自主 Agent 循环

- 流式工具参数 + 实时**轨迹**卡片，执行过程一目了然。
- **Plan** 与 **Agent** 双模式：先审计划再执行，或者直接跑工具循环。
- **工具审批门控**：Shell 命令和文件写入可配置为执行前弹窗确认。
- 智能编辑器上下文：Agent 改代码时自动在编辑器侧定位到对应文件和行范围。

### 多模型支持

- 内置 **Anthropic**（含扩展思考）、**OpenAI**、**Gemini** 适配器。
- 兼容 OpenAI 接口的任意端点 —— Ollama、vLLM、各类聚合 API，接上就能用。
- 面向推理模型的流式**思考块**展示。
- **Auto 自动模式**：让应用自动选最合适的可用模型。

### 开发体验

- **Monaco** 编辑器，支持多标签页、语法高亮、面向 Diff 的审阅流。
- **Git** 服务：在界面内直接完成状态查看、暂存、提交、推送。
- **xterm.js** 终端：本地命令行 + 观察 Agent 触发的 Shell 操作。
- **Composer**：**@** 引用文件、多段消息、持久化线程，用起来顺手。
- **快速打开**面板（`Ctrl/Cmd+P`），键盘党友好。
- 内置**国际化**（中英文开箱即用）。

---

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                      渲染进程                            │
│  React + Vite  │  Monaco 编辑器  │  xterm.js 终端       │
│  Composer / Chat / Plan / Agent UI                       │
└──────────────────────────┬──────────────────────────────┘
                           │  contextBridge（IPC）
┌──────────────────────────▼──────────────────────────────┐
│                      主进程                              │
│  agentLoop.ts  │  toolExecutor.ts  │  LLM 适配器        │
│  gitService    │  threadStore      │  settingsStore      │
│  workspace     │  LSP 会话         │  PTY 终端           │
└─────────────────────────────────────────────────────────┘
```

- **主进程 / 渲染进程分离**，通过 Electron `contextBridge` 和 `ipcMain` 通信。
- **`agentLoop.ts`**：多轮工具调用、流式 JSON 片段解析、中止支持。
- **本地持久化**：线程、配置、计划以 JSON/Markdown 落在用户目录，不上云。
- **`gitService`**：与 UI 同步的 Git 操作层（状态、Diff、暂存、提交、推送）。
- **LSP**：集成 TypeScript Language Server，提供编辑器内代码智能。

## 项目结构

```text
async-shell/
├── main-src/                 # 源码 → 打包至 electron/main.bundle.cjs（主进程）
│   ├── index.ts              # 应用入口：窗口管理、IPC 注册
│   ├── agent/                # agentLoop.ts、toolExecutor.ts、agentTools.ts、toolApprovalGate.ts
│   ├── llm/                  # 各厂商适配器与流式处理
│   ├── lsp/                  # TypeScript LSP 会话
│   ├── ipc/register.ts       # IPC 处理函数（聊天、线程、Git、文件系统等）
│   ├── threadStore.ts        # 线程与消息持久化
│   ├── settingsStore.ts      # 设置持久化
│   ├── gitService.ts         # Git 状态与操作服务
│   └── workspace.ts          # 工作区管理与安全路径解析
├── src/                      # Vite + React 渲染进程
│   ├── App.tsx               # 核心布局、聊天、Composer 模式、Git / 文件浏览器
│   ├── i18n/                 # 国际化文案（中 / 英）
│   ├── AgentActivityGroup.tsx # Cursor 风格的「已探索 N 个文件」折叠分组
│   ├── AgentResultCard.tsx   # 工具结果展示卡片
│   └── …                     # Agent UI、Plan 审阅、Monaco、终端等组件
├── electron/
│   ├── main.bundle.cjs       # esbuild 自动生成，勿手动修改
│   └── preload.cjs           # 预加载脚本 → window.asyncShell
├── docs/assets/              # Logo、截图等静态资源
├── scripts/
│   └── export-app-icon.mjs   # SVG → resources/icons/icon.png（应用图标）
├── esbuild.main.mjs          # 主进程构建配置
├── vite.config.ts            # 渲染进程构建配置
└── package.json
```

## 数据存储

默认位于 Electron **`userData`** 目录下：

- **`async/threads.json`** —— 聊天记录与线程列表。
- **`async/settings.json`** —— 模型配置、API 密钥、应用设置。
- **`.async/plans/`** —— Plan 模式生成的 Markdown 计划文件。

渲染进程可能用 **localStorage** 存少量 UI 状态；对话的权威数据源是 **`threads.json`**。

---

## 快速上手

### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git**（推荐安装）

### 安装与运行

1. **克隆仓库**（替换成你自己的 fork 或上游地址）：

   ```bash
   git clone https://github.com/your-org/async-shell.git
   cd async-shell
   ```

2. **安装依赖**：

   ```bash
   npm install
   ```

3. **构建并启动**：

   ```bash
   npm run desktop
   ```

   会先构建主进程和渲染进程（输出到 `dist/`），然后用 Electron 打开 `dist/index.html`。

### 开发模式

```bash
npm run dev
```

需要 DevTools 调试的话：

```bash
npm run dev:debug
```

### 生成应用图标

```bash
npm run icons
```

把 `docs/assets/async-logo.svg` 光栅化为 `resources/icons/icon.png`（256×256）和 `public/favicon.png`。

---

## 路线图

- [ ] 完整 **PTY** 终端，增强 Shell 交互体验。
- [ ] **LSP** 深度集成（跳转定义、诊断、悬浮提示）。
- [ ] **插件 / 工具**扩展机制，让社区能接入自定义工具。
- [ ] **超大仓库上下文**（语义索引 / 类 RAG 检索）。
- [ ] **MCP**（Model Context Protocol）工具集成。

---

## 社区交流

有问题、有想法，或者就是想和一群搞开发的人聊聊？

- **论坛**：[linux.do](https://linux.do/) —— 来这里讨论、分享你的配置、反馈问题，欢迎常驻。

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。
