# Async Shell

<p align="center">
  <img src="docs/assets/async-logo.svg" width="120" height="120" alt="Async 品牌标识" />
</p>

**Async** 是一个**开源**的桌面端 **AI 编程壳（AI-native shell）**，产品形态与使用方式上**对标 [Cursor](https://cursor.com)**：以对话式 Agent 为中心，把工作区、多模型对话、代码预览与 Git 变更收拢在同一套界面里——但实现完全独立，**不基于 VS Code Workbench**，也不依赖 Cursor 闭源客户端。

> 若你认同「用自然语言驱动仓库里的读写、提交与迭代」这一范式，并希望有一份**可 fork、可改协议栈与 UI** 的参考实现，本项目即面向这一方向持续演进。

## 与 Cursor 的相似点（你在找什么）

| 维度 | 说明 |
|------|------|
| **Agent / 对话** | 多线程会话、流式输出、可中止；主进程统一路由 LLM（OpenAI 兼容 `baseURL`、Anthropic、Gemini 等可配置）。 |
| **工作区** | 选择本地文件夹为工作区；受限 IPC 读写文件，路径不越界。 |
| **编辑器** | 内置 **Monaco**，在壳内打开、编辑、保存工作区文件。 |
| **变更与 Git** | 侧栏展示变更概览；`status`、暂存、提交等与仓库交互（具体能力见 [V1 范围](./docs/V1_SCOPE.md)）。 |
| **桌面体验** | **Electron** 独立窗口，非「仅浏览器打开一个网页」；preload + 白名单 IPC，适合日常当主力壳使用。 |

## 与 Cursor 的差异（诚实边界）

- **不是 Cursor 分支**：无 Cursor 账号体系、无其私有模型路由与云端能力。
- **不做 VS Code 扩展生态**：不跑 Extension Host，不装 VS Code / Open VSX 插件（见 [V1_SCOPE](./docs/V1_SCOPE.md)）。
- **功能深度仍在 V1**：例如终端为行级执行、LSP 等为后续扩展点（见 [LSP 说明](./docs/LSP_NOTES.md)）。

## 技术栈

- **Electron** + **Vite** + **React** + **TypeScript**
- 主进程：`main-src/`（esbuild → `electron/main.bundle.cjs`）
- 渲染进程：`src/`
- 预加载：`electron/preload.cjs`（IPC 通道白名单）

## 快速开始

### 桌面版（推荐日常使用）

```bash
npm install
npm run desktop
```

会先完整构建主进程与渲染进程，再启动独立桌面窗口，从本地 `dist/index.html` 加载（不依赖本机常驻 `localhost`）。

### 开发模式（热更新）

```bash
npm run dev
```

- 仍为 **Electron 桌面窗口**，通过 `http://127.0.0.1:5173` 加载 Vite 开发服务器。
- **请勿**仅用系统浏览器打开该地址：无 preload，会进入「仅浏览器预览」模式。
- 默认不自动打开 DevTools；需要调试时使用：

```bash
npm run dev:debug
```

### 仅构建

```bash
npm run build
```

之后可继续 `npm run desktop`，或等价执行 `cross-env ASYNC_SHELL_LOAD_DIST=1 electron .`（亦兼容环境变量 `VOID_SHELL_LOAD_DIST` / `VOID_SHELL_DEVTOOLS`）。

## 配置与数据位置

- **设置**（API Key、Base URL、模型等）：`userData/async/settings.json`  
  若曾使用旧版目录名 `void-shell`，首次启动会尝试迁移到 `async`。
- **线程与消息**：`userData/async/threads.json`。
- 侧栏宽度等界面状态亦会写入 `settings.json`（桌面端），避免 `file://` 下 `localStorage` 不稳定。

## 文档

- [V1 产品范围](./docs/V1_SCOPE.md) — 必须交付与明确不做的边界。
- [LSP 相关说明](./docs/LSP_NOTES.md) — 与 Monaco 集成的扩展点思路。

## 开源与仓库说明

本仓库为**独立开源项目**（自原 VS Code 衍生仓中的子目录拆出后单独维护），与 **Microsoft / VS Code 主仓库无目录嵌套关系**。LLM 适配与路由见 `main-src/llm/`。欢迎 Issue / PR；若你希望强化「更像 Cursor」的某条能力（例如 Agent 工具协议、diff 应用流、多模型切换），可从 V1 范围文档出发分阶段落地。

---

**Async** — 开源、可自托管的 **类 Cursor** AI 编程壳，从三栏 Agent 工作流开始。
