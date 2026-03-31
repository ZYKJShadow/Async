# Async Shell

<p align="center">
  <img src="docs/assets/async-logo-desktop.svg" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>Open-source AI IDE shell — same ballpark as Cursor: Agent, Editor, Git, Terminal.</strong><br/>
  Built to deliver Cursor-class functionality under an open stack you fully control.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/like%20Cursor-open%20source-818cf8?style=flat-square" alt="Like Cursor, open source" />
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

## Cursor-class features, open source

The goal is straightforward: **implement functionality in the same spirit as [Cursor](https://cursor.com)** — an AI-native IDE shell where the agent, Monaco editor, workspace tools, diff/review, and terminal fit together — **but ship it as open source** under **Apache 2.0**, with **bring-your-own** model keys and **local-first** threads and settings.

|  | **Cursor** (benchmark) | **Async Shell** |
| --- | --- | --- |
| **Delivery** | Product you use as-is | **Open source** — read, fork, self-host |
| **API keys** | Product billing / integrations | **BYOK** — OpenAI, Anthropic, Gemini, OpenAI-compatible APIs |
| **Sessions & data** | Vendor-hosted flows | **Local-first** — threads, settings, plans on your machine |
| **Scope** | Full IDE + ecosystem | Focused **shell**: agent loop, Monaco, Git, terminal, Plan/Agent/Ask/Debug modes |

---

## What is Async Shell?

Async Shell is an open-source, AI-native desktop application: the main surface between you and your agents. Unlike a bolt-on chat extension, Async is structured around the **Agent Loop** — multi-model chat, autonomous tool execution, and review in one workspace.

### Why use Async?

- **Agent-first workflow** — The agent reaches your workspace, tools, and terminal through a clear **Think → Plan → Execute → Observe** loop.
- **Full transparency** — Streaming tool inputs (JSON as it is generated) and **tool trajectory** cards for `read_file`, `write_to_file`, `str_replace`, `search_files`, and shell steps.
- **Your keys, your machine** — Use your own providers; conversations and repo state stay local.
- **Git-native** — Status, diffs, and agent-driven changes tied to your real repository.
- **Four composer modes** — **Agent** (autonomous loop), **Plan** (review before run), **Ask** (read-only Q&A), **Debug** (systematic investigation).
- **Lightweight shell** — Electron + React, **Agent** and **Editor** layouts, Monaco + embedded terminal — the same overall idea as Cursor, in a smaller open codebase.

---

## Screenshots

### Editor Mode

<p align="center">
  <img src="docs/assets/async-editor-screenshot.png" width="1024" alt="Async Editor Mode" />
</p>

### Agent Mode

<p align="center">
  <img src="docs/assets/async-agent-screenshot.png" width="1024" alt="Async Agent Mode" />
</p>

### Model Settings

<p align="center">
  <img src="docs/assets/async-model-settings.png" width="720" alt="Async Model Settings" />
</p>

---

## Core Features

### Autonomous Agent Loop

- Streaming tool parameters and live **trajectory** cards.
- **Plan** vs **Agent** mode: approve structured plans or run direct tool loops.
- **Tool approval gate**: confirm shell commands and file writes before execution.
- Smart editor context: file/line focus when the agent edits code.

### Multi-Model Support

- Adapters for **Anthropic** (incl. extended thinking), **OpenAI**, **Gemini**.
- OpenAI-compatible APIs — Ollama, vLLM, aggregators, any custom endpoint.
- Streaming "thinking" blocks for reasoning-oriented models.
- **Auto** mode: let the app pick the best available model.

### Developer Experience

- **Monaco** editor with tabs, syntax highlighting, and diff-oriented review flows.
- **Git** service: status, diffs, staging, commit/push from the UI.
- **xterm.js** terminal for you and for observing agent shell use.
- **Composer** with **@** file mentions, rich segments, persistent threads.
- **Quick Open** palette (`Ctrl/Cmd+P`) and keyboard-first navigation.
- **i18n** support (English / Simplified Chinese out of the box).

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│  React + Vite  │  Monaco Editor  │  xterm.js Terminal   │
│  Composer / Chat / Plan / Agent UI                       │
└──────────────────────────┬──────────────────────────────┘
                           │  contextBridge (IPC)
┌──────────────────────────▼──────────────────────────────┐
│                     Main Process                         │
│  agentLoop.ts  │  toolExecutor.ts  │  LLM Adapters      │
│  gitService    │  threadStore      │  settingsStore      │
│  workspace     │  LSP session      │  PTY terminal       │
└─────────────────────────────────────────────────────────┘
```

- **Main / Renderer IPC** via Electron `contextBridge` and `ipcMain`.
- **`agentLoop.ts`**: multi-round tool calls, partial JSON streaming, abort support.
- **Local persistence**: threads, settings, plans as JSON/Markdown under user data.
- **`gitService`**: porcelain Git aligned with the UI (status, diff, stage, commit, push).
- **LSP**: TypeScript Language Server integration for in-editor intelligence.

## Project Structure

```text
async-shell/
├── main-src/                 # Bundled → electron/main.bundle.cjs (Node / Electron main)
│   ├── index.ts              # App entry: windows, userData, IPC registration
│   ├── agent/                # agentLoop.ts, toolExecutor.ts, agentTools.ts, toolApprovalGate.ts
│   ├── llm/                  # OpenAI / Anthropic / Gemini adapters & streaming
│   ├── lsp/                  # TypeScript LSP session
│   ├── ipc/register.ts       # ipcMain handlers (chat, threads, git, fs, agent, …)
│   ├── threadStore.ts        # Persistent threads + messages (JSON)
│   ├── settingsStore.ts      # settings.json
│   ├── gitService.ts         # Porcelain status, diff previews, commit/push
│   └── workspace.ts          # Open-folder root & safe path resolution
├── src/                      # Vite + React renderer
│   ├── App.tsx               # Shell layout, chat, composer modes, Git / explorer
│   ├── i18n/                 # Locale messages (en / zh-CN)
│   ├── AgentActivityGroup.tsx # Cursor-style "Explored N files" collapsible group
│   ├── AgentResultCard.tsx   # Tool result display cards
│   └── …                     # Agent UI, Plan review, Monaco, terminal, …
├── electron/
│   ├── main.bundle.cjs       # esbuild output (do not edit by hand)
│   └── preload.cjs           # contextBridge → window.asyncShell
├── docs/assets/              # Logo, screenshots
├── scripts/
│   └── export-app-icon.mjs   # Rasterize SVG → resources/icons/icon.png
├── esbuild.main.mjs          # Builds main process
├── vite.config.ts            # Renderer build
└── package.json
```

## Local Persistence

Default layout under Electron **`userData`**:

- **`async/threads.json`** — threads and messages.
- **`async/settings.json`** — models, keys (local), layout, agent options.
- **`.async/plans/`** — saved Plan documents (Markdown).

The renderer may use **localStorage** for small UI flags; **`threads.json`** is the source of truth for conversations.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git** (optional but recommended)

### Install and Run

1. **Clone** (replace with your fork or upstream URL):

   ```bash
   git clone https://github.com/your-org/async-shell.git
   cd async-shell
   ```

2. **Install**:

   ```bash
   npm install
   ```

3. **Desktop build + Electron**:

   ```bash
   npm run desktop
   ```

   Builds main + renderer (`dist/`), then opens Electron on `dist/index.html`.

### Development

```bash
npm run dev
```

Optional DevTools:

```bash
npm run dev:debug
```

### Generate App Icon

```bash
npm run icons
```

Rasterizes `docs/assets/async-logo.svg` → `resources/icons/icon.png` (256×256) and `public/favicon.png`.

---

## Roadmap

- [ ] Full **PTY** terminal (node-pty integration).
- [ ] **LSP** in-editor (go-to-definition, diagnostics, hover).
- [ ] **Plugin / tool** extensibility API.
- [ ] **Larger-workspace context** (indexing / RAG-style retrieval).
- [ ] **MCP** (Model Context Protocol) tool integration.

---

## Community

Have questions, ideas, or just want to hang out with fellow builders?

- **Forum**: [linux.do](https://linux.do/) — join the discussion, share your setup, report issues.

---

## License

Licensed under the [Apache License 2.0](./LICENSE).
