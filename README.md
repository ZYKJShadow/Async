# Async Shell

<p align="center">
  <img src="docs/assets/async-logo.svg" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>The Agent-Centric AI IDE Shell.</strong><br>
  Built for developers who want a streamlined, autonomous agent workflow without the bloat.
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

## 🌟 What is Async Shell?

Async Shell is an open-source, AI-native desktop application designed to be the primary interface between you and your AI agents. Unlike standard IDE extensions, Async is built from the ground up to prioritize the **Agent Loop**, providing a unified environment for multi-model chat, autonomous tool execution, and code review.

### Why use Async?

- **Agent-First Workflow**: Not just a side-chat. The agent has first-class access to your workspace, tools, and terminal.
- **Complete Control**: Self-hosted and fully customizable. Use your own API keys with OpenAI, Anthropic, or Gemini.
- **Lightweight & Fast**: Built with Electron and React, focusing on a clean three-pane layout for maximum productivity.
- **Transparent Execution**: See exactly what the agent is doing with tool trajectory visualization and a Plan/Review workflow.

### 📸 Preview

<p align="center">
  <img src="docs/assets/async-main-screenshot.png" width="920" alt="Async Main Interface" />
</p>

## ✨ Core Features

### 🤖 Autonomous Agent
- **Tool Trajectory**: Real-time visualization of agent actions (file read/write, shell commands, etc.).
- **Plan & Review**: Agents propose a plan; you review and approve before any code is modified.
- **Multi-thread Sessions**: Keep different tasks organized in separate, persistent threads.
- **Streaming Responses**: Fast, real-time feedback from the LLM.

### 🧠 Multi-Model Intelligence
- Native support for **Anthropic Claude**, **OpenAI**, and **Google Gemini**.
- Compatible with any OpenAI-compatible API (local LLMs, third-party providers).
- Seamlessly switch models mid-conversation.

### 🛠️ Developer Experience
- **Built-in Monaco Editor**: High-performance editing with syntax highlighting and diff views.
- **Git Integration**: Built-in Git status, staging, and committing.
- **Integrated Terminal**: Run and monitor commands via xterm.js.
- **@-Mention System**: Easily reference files in your workspace within the chat.

## 🏗️ Project Structure

```text
Async Shell
├── main-src/              # Electron Main Process
│   ├── agent/             # Agent Loop & Tool Logic
│   ├── llm/               # Model Adapters (OpenAI, Anthropic, Gemini)
│   ├── ipc/               # Communication Bridge
│   └── ...
├── src/                   # Renderer Process (React UI)
│   ├── App.tsx            # Main Layout
│   ├── i18n/              # Multi-language Support
│   └── ...
└── electron/              # Electron Entry & Preload
```

## 🚀 Getting Started

### Prerequisites
- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git**

### Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/async-shell.git
   cd async-shell
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Launch the app**:
   ```bash
   # Build and run the desktop application
   npm run desktop
   ```

### Development Mode
For hot-reloading during development:
```bash
npm run dev
```

## 🗺️ Roadmap
- [ ] **Full PTY Terminal**: Enhanced terminal experience with `node-pty`.
- [ ] **LSP Integration**: Language Server Protocol support for better code intelligence.
- [ ] **Plugin System**: Allow community-built tools and agent behaviors.
- [ ] **Enhanced Context**: RAG-based workspace indexing for larger projects.

## 📜 License
This project is licensed under the [Apache License 2.0](./LICENSE).
