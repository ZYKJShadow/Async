# Async IDE

<p align="center">
  <img src="docs/assets/async-logo-desktop.svg" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>An open-source, agent-first desktop workspace — Agent, Editor, Git, Terminal, all in one place.</strong><br/>
  Own your AI workflow: local-first, BYOK, and fully hackable.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Agent%20First-Open%20Source-818cf8?style=flat-square" alt="Agent First & Open Source" />
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

## What is Async IDE?

Async IDE is an **AI-native desktop shell** built from scratch on Electron + React + Monaco. It is not a VS Code fork — the entire codebase is intentionally lean, fully transparent, and hackable.

The central idea is simple: **the agent is the center of gravity**, not a chat panel bolted onto the side of an editor. Everything — workspace access, tool execution, diff review, terminal operations — revolves around a transparent **Think → Plan → Execute → Observe** loop that you can see, steer, and interrupt at any time.

- **Apache 2.0** • **BYOK** for models • **Local-first** by default

---

## Highlights

- **Agent-first loop** — Autonomous multi-round tool execution with streaming parameter cards (`Read`, `Write`, `Edit`, `Glob`, `Grep`, Shell, etc.) and approval gates for sensitive operations.
- **Four Composer modes** — **Agent** (full auto), **Plan** (review first, then run), **Ask** (read-only Q&A), and **Debug** (systematic troubleshooting).
- **Team mode** — Multi-agent collaboration with Lead planning, specialist execution, reviewer verification, and plan-approval workflows.
- **Multi-model, multi-provider** — Anthropic, OpenAI, Gemini, plus any OpenAI-compatible endpoint (Ollama, vLLM, self-hosted). Auto model selection included.
- **Git-native** — Status, diff, staging, commit, and push integrated into the UI; agent-driven changes stay in sync with your real repo.
- **IM bot bridge** — Wire **Telegram**, **Slack**, **Discord**, and **Feishu (Lark)** into the same Agent / Team toolchain as the desktop app, with per-integration model, workspace, and allowlist config.
- **Built-in tools** — Browser automation (with custom headers / fingerprint), LSP-powered editor intelligence, MCP server support, file index & symbol search, and an all-in-one terminal shared between user and agent.
- **Local & private** — Threads, settings, and plans live on your machine. No cloud lock-in.

---

## Screenshots

### Agent Layout
<p align="center">
  <img src="docs/assets/workspace_1.png" width="3062" alt="Async Agent Layout" />
</p>

### Model Settings
<p align="center">
  <img src="docs/assets/setting_1.png" width="1824" alt="Async Model Settings" />
</p>

### Appearance Color Palette
<p align="center">
  <img src="docs/assets/setting_2.png" width="1829" alt="Async Appearance Color Palette" />
</p>

#### Mac Codex Theme
<p align="center">
  <img src="docs/assets/setting_3.png" width="1829" alt="Async Mac Codex Theme" />
</p>

### Browser Tool Invocation (customizable request headers)
<p align="center">
  <img src="docs/assets/browser_1.png" width="2868" alt="Async Browser Tool" />
</p>

### Multi-Agent Collaborative Expert Group
<p align="center">
  <img src="docs/assets/multi_agent_1.png" width="2871" alt="Async Multi-Agent" />
</p>

### Control the App via External Chat Bots
<p align="center">
  <img src="docs/assets/bot_1.png" width="2871" alt="Async Bot Integration" />
</p>

### All-in-One Terminal (commands invokable by Agents and bots)
<p align="center">
  <img src="docs/assets/terminal_1.png" width="2859" alt="Async Terminal" />
</p>

<p align="center">
  <img src="docs/assets/terminal_2.png" width="2871" alt="Async Terminal 2" />
</p>

<p align="center">
  <img src="docs/assets/terminal_3.png" width="2865" alt="Async Terminal 3" />
</p>

---

## Core Features

### Autonomous Agent Loop
- Streaming tool parameters with trajectory cards for clear execution visibility.
- Plan and Agent dual modes: review the plan first, or let the agent run directly.
- Approval gates for shell commands and file writes.
- Editor context sync so agent edits can focus on the relevant file and line range.
- Support for nested sub-agents, background execution, and timeline-style activity rendering.

### Multi-Model Support
- Built-in adapters for Anthropic, OpenAI, and Gemini.
- Support for OpenAI-compatible endpoints like Ollama, vLLM, aggregators, or self-hosted services.
- Streaming thinking blocks on supported models.
- Auto mode to automatically pick the best available model.

### Developer Experience
- Monaco editor with multi-tab support, syntax highlighting, and diff review flows.
- Git integration: status, diff, staging, commit, and push all available from the UI.
- xterm.js terminal: for both user commands and observing agent shell operations.
- Composer with `@` file mentions, rich segments, and persistent threads.
- Quick Open palette (`Ctrl/Cmd+P`) and keyboard-first navigation.
- Built-in i18n support for English and Simplified Chinese.
- Support for local disk skills, workspace config merge, and tool approval controls.

### IM / Bot Integrations
Async can act as the **host** for coding agents on external chat surfaces, not only inside the Electron UI.

- **Platforms** — Telegram, Slack, Discord, and Feishu (Lark) via dedicated adapters under `main-src/bots/platforms/`.
- **Same runtime** — Inbound messages run through `botRuntime`: normal threads use `agentLoop`, while Team mode uses the same `teamOrchestrator` path as the desktop Composer, including worker streaming and tool status where applicable.
- **Per integration** — Enable/disable, display name, default model, default Composer mode (`agent` / `ask` / `plan` / `team`), workspace root(s), optional allowlists for chats and users, and an extra system prompt on top of project rules.
- **Connectivity** — Optional HTTP proxy URL per platform when vendor APIs must go through a corporate proxy.
- **Feishu** — App credentials, optional encryption, streaming interactive cards for long-running replies, and session hygiene when integration settings change.
- **Configuration UI** — Managed from **Settings → Bots** (`SettingsBotsPanel.tsx`).

For a deeper module-level walkthrough, see the maintainer-oriented notes under [`docs/llm-wiki/`](./docs/llm-wiki/).

---

## Technical Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                    │
│  React + Vite  │  Monaco Editor  │  xterm.js Terminal  │
│  Composer / Chat / Plan / Agent UI                     │
└──────────────────────────┬──────────────────────────────┘
                           │  contextBridge (IPC)
┌──────────────────────────▼──────────────────────────────┐
│                      Main Process                      │
│  agentLoop.ts  │  toolExecutor.ts  │  LLM Adapters     │
│  gitService    │  threadStore      │  settingsStore    │
│  workspace     │  LSP session      │  PTY terminal     │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | ^19.2.4 | UI framework |
| **Electron** | 41.1.0 | Desktop app shell |
| **Vite** | ^6.0.3 | Build tool & dev server |
| **TypeScript** | ^5.9.3 | Type-safe development |
| **Monaco Editor** | ^0.52.0 | Code editor component |
| **xterm.js** | ^5.5.0 | Terminal emulator |
| **OpenAI SDK** | ^4.96.0 | OpenAI API client |
| **Anthropic SDK** | ^0.39.0 | Claude API client |
| **Google Generative AI** | ^0.21.0 | Gemini API client |
| **MCP SDK** | ^1.29.0 | Model Context Protocol |
| **node-pty** | ^1.1.0 | PTY terminal support |

- **Built from scratch** on Electron + React + Monaco — not a VS Code fork. The architecture is intentionally lean: two processes (main + renderer), clear IPC boundaries, and no inherited extension ecosystem to maintain.
- `agentLoop.ts` handles multi-round tool calls, partial JSON streaming, tool repair, and aborts.
- Structured assistant messages are persisted locally and expanded to provider-native tool formats when needed.
- Local persistence stores threads, settings, and plans as JSON / Markdown under user data.
- `gitService` provides the Git layer used by the UI for status, diff, staging, commit, and push.
- LSP integration uses TypeScript Language Server for in-editor intelligence.

## Project Structure

```text
Async/
├── main-src/                  # Bundled -> electron/main.bundle.cjs (Node / Electron main)
│   ├── index.ts               # App entry: windows, userData, IPC registration
│   ├── agent/                 # agentLoop.ts, toolExecutor.ts, agentTools.ts, toolApprovalGate.ts
│   ├── llm/                   # OpenAI / Anthropic / Gemini adapters & streaming
│   ├── lsp/                   # TypeScript LSP session
│   ├── mcp/                   # Model Context Protocol integration
│   ├── memdir/                # Memory directory management
│   ├── bots/                  # IM bot controller, runtime, connectivity, platform adapters
│   ├── ipc/register.ts        # Core IPC handlers (chat, threads, agent, plan)
│   ├── ipc/handlers/          # Domain-specific IPC handlers (git, fs, mcp, settings, ...)
│   ├── shell/                 # Shell command execution
│   ├── threadStore.ts         # Persistent threads + messages (JSON)
│   ├── settingsStore.ts       # settings.json
│   ├── gitService.ts          # Porcelain status, diff previews, commit/push
│   ├── workspace.ts           # Open-folder root & safe path resolution
│   ├── workspaceFileIndex.ts  # File indexing for workspace
│   ├── workspaceSymbolIndex.ts    # Symbol indexing
│   └── workspaceUsageStats.ts     # Workspace usage statistics
├── src/                       # Vite + React renderer
│   ├── App.tsx                # Shell layout, chat, composer modes, Git / explorer
│   ├── AgentChatPanel.tsx     # Agent chat interface
│   ├── AgentLeftSidebar.tsx   # Agent activity sidebar
│   ├── AgentRightSidebar.tsx  # Agent tools and results
│   ├── ChatComposer.tsx       # Message composer component
│   ├── EditorMainPanel.tsx    # Monaco editor panel
│   ├── SettingsPage.tsx       # Settings UI
│   ├── SettingsBotsPanel.tsx  # IM bot integrations (Telegram / Slack / Discord / Feishu)
│   ├── WorkspaceExplorer.tsx  # File explorer
│   ├── hooks/                 # Custom React hooks
│   ├── i18n/                  # Locale messages (en / zh-CN)
│   └── ...                    # Agent UI, Plan review, Monaco, terminal, ...
├── electron/
│   ├── main.bundle.cjs        # esbuild output (do not edit by hand)
│   └── preload.cjs            # contextBridge -> window.asyncShell
├── docs/assets/               # Logo, screenshots
├── scripts/
│   └── export-app-icon.mjs    # Rasterize SVG -> resources/icons/icon.png
├── esbuild.main.mjs           # Builds main process
├── vite.config.ts             # Renderer build
└── package.json
```

## Data Storage

Default location under Electron's `userData` directory:

- `async/threads.json`: threads and chat messages.
- `async/settings.json`: model configuration, API keys, layout, agent options, and bot integrations.
- `.async/plans/`: Markdown plan documents generated in Plan mode.

The renderer may use `localStorage` for lightweight UI state, but the authoritative data source for conversations is `threads.json`.

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Git** (recommended)

### Install and Run

```bash
git clone https://github.com/ZYKJShadow/Async.git
cd Async
npm install
npm run desktop
```

If you prefer Gitee:

```bash
git clone https://gitee.com/shadowsocks_z/Async.git
cd Async
npm install
npm run desktop
```

### Development

```bash
npm run dev          # Dev server with hot reload
npm run dev:debug    # Same, with DevTools open
npm run icons        # Generate app icons from SVG
```

---

## Acknowledgements

We are grateful to the open-source community and projects like Claude Code that helped demonstrate the power of agent-driven development — Async IDE builds on that momentum with its own take on transparent, local-first AI workflows.

---

## Community

Have questions, ideas, or just want to chat with a community of developers?

- **Forum**: [linux.do](https://linux.do/) — Join the discussion, share your setup, report issues, and stick around.

---

## License

This project is open-sourced under the [Apache License 2.0](./LICENSE).
