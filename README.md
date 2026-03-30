# Async Shell

<p align="center">
  <img src="docs/assets/async-logo.svg?v=2" width="120" height="120" alt="Async Logo" />
</p>

<p align="center">
  <strong>Open-source AI IDE shell — same ballpark as Cursor: agent, editor, Git, terminal.</strong><br>
  Built to deliver Cursor-like functionality under an open stack you control.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/features-like%20Cursor-open%20source-818cf8" alt="Like Cursor, open source" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/Electron-34-green" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-blue" alt="React" />
  <img src="https://img.shields.io/badge/Monaco-0.52-blue" alt="Monaco Editor" />
</p>

---

[English](README.md) | [简体中文](README.zh-CN.md)

---

## Cursor-class features, open source

The goal is straightforward: **implement functionality in the same spirit as [Cursor](https://cursor.com)** — an AI-native IDE shell where the agent, Monaco editor, workspace tools, diff/review, and terminal fit together — **but ship it as open source** under **Apache 2.0**, with **bring-your-own** model keys and **local-first** threads and settings.

| | **Cursor** (benchmark) | **Async Shell** |
| --- | --- | --- |
| **Delivery** | Product you use as-is | **Open source** — read, fork, self-host |
| **API keys** | Product billing / integrations | **BYOK** — OpenAI, Anthropic, Gemini, OpenAI-compatible APIs |
| **Sessions & data** | Vendor-hosted flows | **Local-first** — threads, settings, plans on your machine |
| **Scope** | Full IDE + ecosystem | Focused **shell**: agent loop, Monaco, Git, terminal, Plan/Agent modes |

---

## What is Async Shell?

Async Shell is an open-source, AI-native desktop application: the main surface between you and your agents. Unlike a bolt-on chat extension, Async is structured around the **Agent Loop** — multi-model chat, autonomous tool execution, and review in one workspace.

### Why use Async?

- **Agent-first workflow**: The agent reaches your workspace, tools, and terminal through a clear **Think → Plan → Execute → Observe** loop.
- **Transparency**: **Streaming tool inputs** (JSON as it is generated) and **tool trajectory** cards for `read_file`, `write_to_file`, `str_replace`, `search_files`, and shell steps.
- **Your keys, your machine**: Use your own providers; conversations and repo state stay local.
- **Git-native**: Status, diffs, and agent-driven changes tied to your real repository.
- **Lightweight shell**: Electron + React, **Agent** and **Editor** layouts, Monaco + embedded terminal — the same overall idea as Cursor, in a smaller open codebase.

### Preview

<p align="center">
  <img src="docs/assets/async-main-screenshot.png" width="1024" alt="Async Main Interface" />
</p>

### Plan mode

In **Plan** mode, the model produces a structured plan (title, description, checklist, optional questions). You review the draft, adjust todos, then **Start execution** (开始执行) to run it. Drafts can live under the app user-data tree (e.g. `.async/plans/`).

<p align="center">
  <img src="docs/assets/async-plan-mode.png" width="1024" alt="Async Plan mode — draft plan, task checklist, and Start execution" />
</p>

---

## Core features

### Autonomous agent loop

- Streaming tool parameters and live **trajectory** cards.
- **Plan** vs **Agent** mode: approve structured plans or run direct tool loops.
- Smart editor context: file/line focus when the agent edits code.

### Multi-model

- Adapters for **Anthropic** (incl. extended thinking), **OpenAI**, **Gemini**.
- OpenAI-compatible APIs (Ollama, vLLM, aggregators).
- Streaming “thinking” blocks for reasoning-oriented models.

### Developer experience

- **Monaco** editor, tabs, diff-oriented review flows.
- **Git** service: status, diffs, staging, commit/push from the UI.
- **xterm.js** terminal for you and for observing agent shell use.
- **Composer** with **@** file mentions, rich segments, persistent threads.

---

## Technical architecture

- **Main / renderer IPC** via Electron `contextBridge` and `ipcMain`.
- **`agentLoop.ts`**: multi-round tools, partial JSON streaming.
- **Local persistence**: threads, settings, plans as JSON/Markdown under user data.
- **`gitService`**: porcelain Git aligned with the UI.

## Project structure

```text
async-shell/
├── main-src/                 # Bundled → electron/main.bundle.cjs (Node / Electron main)
│   ├── index.ts              # App entry: windows, userData, IPC registration
│   ├── agent/                # agentLoop.ts, toolExecutor.ts, agentTools.ts
│   ├── llm/                  # OpenAI / Anthropic / Gemini adapters & streaming
│   ├── ipc/register.ts       # ipcMain handlers (chat, threads, git, fs, agent, …)
│   ├── threadStore.ts        # Persistent threads + messages (JSON)
│   ├── settingsStore.ts      # settings.json
│   ├── gitService.ts         # Porcelain status, diff previews, commit/push
│   └── workspace.ts          # Open-folder root & safe path resolution
├── src/                      # Vite + React renderer
│   ├── App.tsx               # Shell layout, chat, composer modes, Git / explorer
│   ├── i18n/                 # Locale messages
│   └── …                     # Agent UI, Plan review, Monaco, terminal, …
├── electron/
│   ├── main.bundle.cjs       # esbuild output (do not edit by hand)
│   └── preload.cjs           # contextBridge → window.asyncShell
├── esbuild.main.mjs          # Builds main process
├── vite.config.ts            # Renderer build
└── package.json
```

## Persistence (local)

Default layout under Electron **`userData`**:

- **`userData/async/threads.json`** — threads and messages.
- **`userData/async/settings.json`** — models, keys (local), layout, agent options.
- **`userData/.async/plans/`** — saved Plan documents (Markdown).

The renderer may use **localStorage** for small UI flags; **`threads.json`** is the source of truth for conversations.

## Getting started

### Prerequisites

- **Node.js** ≥ 18  
- **npm** ≥ 9  
- **Git** (optional but recommended)

### Install and run

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

## Roadmap

- [ ] Full **PTY** terminal (e.g. `node-pty`).
- [ ] **LSP** in-editor (go-to-definition, diagnostics).
- [ ] **Plugin / tool** extensibility.
- [ ] **Larger-workspace context** (indexing / RAG-style retrieval).

## License

Licensed under the [Apache License 2.0](./LICENSE).
