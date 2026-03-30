# Async Shell

<p align="center">
  <img src="docs/assets/async-logo.svg?v=2" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>开源 AI IDE Shell — 功能对标 Cursor：Agent、编辑器、Git、终端一体。</strong><br>
  用开源方式实现与 Cursor 相近的能力，栈与密钥由你掌控。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/功能-对标%20Cursor%20%E4%B8%94%E5%BC%80%E6%BA%90-818cf8" alt="对标 Cursor 且开源" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/Electron-34-green" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-blue" alt="React" />
  <img src="https://img.shields.io/badge/Monaco-0.52-blue" alt="Monaco Editor" />
</p>

---

[English](README.md) | [简体中文](README.zh-CN.md)

---

## 对标 Cursor，开源实现

项目目标很明确：**在功能与体验上对标 [Cursor](https://cursor.com)** —— AI 原生 IDE Shell，Agent、Monaco 编辑器、工作区工具、Diff 审阅与终端协同 —— **但以开源方式交付**：**Apache 2.0** 许可证，**自带模型密钥（BYOK）**，线程与配置默认**本地优先**。

| | **Cursor**（对标参照） | **Async Shell** |
| --- | --- | --- |
| **形态** | 成熟商业产品 | **开源** — 可读可改、可自建 |
| **密钥** | 产品内计费与集成 | **BYOK**：OpenAI、Anthropic、Gemini 或兼容接口 |
| **会话与数据** | 随产品走 | **本地优先**：线程、配置、计划在本机 |
| **范围** | 完整 IDE 与生态 | 聚焦 **Shell**：Agent 循环、Monaco、Git、终端、Plan/Agent 双模式 |

---

## 什么是 Async Shell？

Async Shell 是一款开源的 AI 原生桌面应用，作为你与 Agent 之间的主界面。它不是简单的侧边聊天插件，而是从 **Agent 循环** 出发，把多模型对话、自主工具执行与审阅放在同一工作区内完成。

### 为什么选择 Async？

- **Agent 优先**：对工作区、工具与终端的一等访问，清晰的 **思考 → 规划 → 执行 → 观察** 闭环。
- **可观测**：**流式工具参数**与 **工具轨迹** 卡片（`read_file`、`write_to_file`、`str_replace`、`search_files`、Shell 等）。
- **自主可控**：自有 API 密钥；对话与仓库状态以本地为主。
- **Git 原生**：状态、Diff 与 Agent 改动和真实仓库对齐。
- **轻量外壳**：Electron + React，**Agent / Editor** 布局、Monaco + 内嵌终端 —— 整体思路与 Cursor 一致，代码体量更聚焦。

### 界面预览

<p align="center">
  <img src="docs/assets/async-main-screenshot.png" width="1024" alt="Async 主界面" />
</p>

### Plan 模式

在 **Plan** 模式下，模型生成结构化计划（标题、任务、澄清问题）。你在执行前审阅草稿、调整任务后，通过 **「开始执行」** 让 Agent 按既定计划运行。草稿可保存在应用用户数据目录（如 `.async/plans/`）。

<p align="center">
  <img src="docs/assets/async-plan-mode.png" width="1024" alt="Async Plan 模式：草稿计划、任务列表与开始执行" />
</p>

---

## 核心特性

### 自主 Agent 循环

- 流式工具参数与实时 **轨迹** 展示。
- **Plan** 与 **Agent** 双模式：先审计划或直接跑工具循环。
- 智能上下文：Agent 改代码时在编辑器侧对齐文件与行范围。

### 多模型

- **Anthropic**（含扩展思考）、**OpenAI**、**Gemini** 等适配路径。
- 兼容 OpenAI 接口的端点（Ollama、vLLM、聚合 API 等）。
- 面向推理模型的流式 **思考块** 展示。

### 开发体验

- **Monaco** 编辑器、标签页、面向 Diff 的审阅流。
- **Git** 服务：在界面内完成状态、暂存、提交与推送。
- **xterm.js** 终端：本地命令与观察 Agent 触发的 Shell。
- **Composer**：**@** 引用文件、多段消息、持久化线程。

---

## 技术架构

- Electron **主进程 / 渲染进程** 分离，`contextBridge` 与 `ipcMain` 通信。
- **`agentLoop.ts`**：多轮工具调用、流式 JSON 片段解析。
- **本地持久化**：线程、配置、计划以 JSON/Markdown 落在用户目录。
- **`gitService`**：与 UI 同步的 Git 操作层。

## 项目结构

```text
async-shell/
├── main-src/                 # 源码 -> 打包至 electron/main.bundle.cjs
│   ├── index.ts              # 应用入口：窗口管理、IPC 注册
│   ├── agent/                # Agent 引擎、工具执行器、工具定义
│   ├── llm/                  # 各厂商适配器与流式处理
│   ├── ipc/register.ts       # IPC 处理函数 (聊天, 线程, Git, 文件系统等)
│   ├── threadStore.ts        # 线程与消息持久化
│   ├── settingsStore.ts      # 设置持久化
│   ├── gitService.ts         # Git 状态与操作服务
│   └── workspace.ts          # 工作区管理与安全路径解析
├── src/                      # Vite + React 渲染进程
│   ├── App.tsx               # 核心布局与状态管理
│   ├── i18n/                 # 国际化文案
│   └── …                     # Agent UI, Monaco, 终端等组件
├── electron/
│   ├── main.bundle.cjs       # 自动生成的主进程产物
│   └── preload.cjs           # 预加载脚本
├── esbuild.main.mjs          # 主进程构建配置
├── vite.config.ts            # 渲染进程构建配置
└── package.json
```

## 数据存储

默认位于 Electron **`userData`**：

- **`async/threads.json`** — 聊天记录与线程列表。
- **`async/settings.json`** — 模型、密钥与应用设置。
- **`.async/plans/`** — Plan 模式生成的 Markdown 计划。

渲染进程可能使用 **localStorage** 保存少量 UI 状态；对话的权威数据源为 **`threads.json`**。

## 快速开始

### 前置要求

- **Node.js** ≥ 18  
- **npm** ≥ 9  
- **Git**（推荐）

### 安装与运行

1. **克隆仓库**（请替换为你的 fork 或上游地址）：

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

### 开发模式

```bash
npm run dev
```

可选，附带 DevTools：

```bash
npm run dev:debug
```

## 路线图

- [ ] 完整 **PTY** 终端，增强 Shell 交互。
- [ ] **LSP** 集成（跳转、诊断等）。
- [ ] **插件 / 工具** 扩展机制。
- [ ] **超大仓库上下文**（索引或类 RAG 检索）。

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。
