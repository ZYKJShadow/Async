# Async Shell

<p align="center">
  <img src="docs/assets/async-logo.svg" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>以 Agent 为中心的 AI IDE Shell。</strong><br>
  为追求精简、自主 Agent 工作流的开发者打造。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/Electron-34-green" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-blue" alt="React" />
</p>

---

[English](README.md) | [简体中文](README.zh-CN.md)

---

## 🌟 什么是 Async Shell?

Async Shell 是一款开源的 AI 原生 desktop 应用，旨在成为你与 AI Agent 之间的核心交互界面。与传统的 IDE 插件不同，Async 从底层开始构建，优先考虑 **Agent 循环 (Agent Loop)**，为你提供一个集多模型对话、自主工具执行和代码审核于一体的统一环境。

### 为什么选择 Async?

- **Agent 为中心的工作流**: 不仅仅是一个侧边对话框。Agent 拥有对工作区、工具和终端的一等公民访问权限。
- **完全掌控**: 自托管且完全可定制。直接使用你自己的 OpenAI、Anthropic 或 Gemini API 密钥。
- **轻量且快速**: 基于 Electron 和 React 构建，采用简洁的三栏布局，助力高效开发。
- **透明的执行过程**: 通过工具轨迹可视化和“计划-审核”工作流，清晰掌握 Agent 的每一步操作。

### 📸 界面预览

<p align="center">
  <img src="docs/assets/async-main-screenshot.png" width="920" alt="Async 主界面" />
</p>

## ✨ 核心特性

### 🤖 自主 Agent
- **工具轨迹可视化**: 实时展示 Agent 的操作（读取/写入文件、执行 Shell 命令等）。
- **计划与审核**: Agent 在修改代码前会提交计划，由你审核通过后再执行。
- **多线程会话**: 支持并行多个独立任务，会话状态自动持久化。
- **流式响应**: 实时渲染 LLM 输出，反馈迅速。

### 🧠 多模型支持
- 原生支持 **Anthropic Claude**, **OpenAI** 和 **Google Gemini**。
- 兼容任何 OpenAI 格式的 API（如本地 LLM 或第三方转发服务）。
- 支持在对话过程中随时切换模型。

### 🛠️ 极致开发体验
- **内置 Monaco 编辑器**: 高性能编辑器，支持语法高亮和 Diff 差异对比。
- **Git 集成**: 内置 Git 状态查看、暂存 (Stage) 和提交 (Commit) 功能。
- **集成终端**: 基于 xterm.js，直接在界面内运行和监控命令。
- **@-提及系统**: 在聊天中通过 `@` 快速引用工作区中的文件。

## 🏗️ 项目架构

```text
Async Shell
├── main-src/              # Electron 主进程
│   ├── agent/             # Agent 循环与工具逻辑
│   ├── llm/               # 模型适配器 (OpenAI, Anthropic, Gemini)
│   ├── ipc/               # 进程间通信
│   └── ...
├── src/                   # 渲染进程 (React UI)
│   ├── App.tsx            # 主布局
│   ├── i18n/              # 国际化支持
│   └── ...
└── electron/              # Electron 入口与预加载
```

## 🚀 快速开始

### 环境要求
- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git**

### 安装与运行

1. **克隆仓库**:
   ```bash
   git clone https://github.com/your-org/async-shell.git
   cd async-shell
   ```

2. **安装依赖**:
   ```bash
   npm install
   ```

3. **启动应用**:
   ```bash
   # 构建并运行桌面版程序
   npm run desktop
   ```

### 开发模式
支持热更新的开发环境：
```bash
npm run dev
```

## 🗺️ 路线图
- [ ] **全功能 PTY 终端**: 使用 `node-pty` 提供更完整的终端体验。
- [ ] **LSP 集成**: 引入语言服务器协议，提升代码感知能力。
- [ ] **插件系统**: 支持社区开发的工具和 Agent 行为扩展。
- [ ] **增强上下文**: 针对大型项目的基于 RAG 的工作区索引。

## 📜 许可证
本项目采用 [Apache License 2.0](./LICENSE) 开源协议。
