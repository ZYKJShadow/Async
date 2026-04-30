# 工作区智能

- 状态：已根据 `workspaceFileIndex.ts`、`workspaceSymbolIndex.ts`、`workspace.ts`、`useWorkspaceManager.ts`、`browserController.ts`、相关 LSP 入口校验。
- 主题：文件检索、符号索引、LSP、浏览器工具，以及当前已知的索引漂移问题。

## 文件索引

`main-src/workspaceFileIndex.ts` 负责工作区文件级索引：

- 按 workspace root 分桶
- 支持引用计数，多窗口共享同一 root 的索引
- 跳过 `.git`、`node_modules`、`dist`、`.idea`、`.async/index/`、`.async/memory/` 等目录
- 有最大文件数限制：`MAX_WORKSPACE_FILES = 5000`
- 会维护排序快照和 basename bucket，以支持更快搜索

它不是单纯的“列目录”，而是 Async 工作区智能的第一层基础设施。

## 文件搜索的现状

`src/hooks/useWorkspaceManager.ts` 明确写着当前文件列表架构是 `v3 - 完全按需`：

- `@` 提及时，通过 `workspace:searchFiles` 走主进程 Top-K 搜索
- 全量文件列表只在确实需要时才加载
- 打开工作区时不再预热整个文件索引

这和旧的“空闲时预热索引”说法已经不完全一致，见 [矛盾与待确认项](../meta/contradictions-and-open-questions.md)。

## 主进程上下文扩展层

`main-src/llm/workspaceContextExpand.ts` 负责把工作区文件信息编译进模型上下文，包括：

- 从用户消息中识别 `@路径`
- 将最后一条 user 消息扩展为“文件内容 + 原消息”
- 为 Plan / Ask / Team 等模式构建工作区树摘要

它不是前端展示逻辑，而是模型上下文真实会看到的内容编译层。

## `workspaceFileIndex` 的当前定位

需要特别纠偏的一点：

- `workspaceFileIndex.ts` 仍然在用
- 但它现在是按需文件索引底座，不再是“打开工作区就预热的大而全主流程”

它仍服务于：

- `workspace:listFiles`
- `workspace:searchFiles`
- Quick Open 的全量文件列表
- `@` 提及搜索
- symbol index 的文件来源
- bot runtime 的工作区文件集
- `workspaceContextExpand.ts` 里的 `@路径` 展开

## 符号索引

`main-src/workspaceSymbolIndex.ts` 提供轻量符号级索引：

- 主要针对导出符号和常见声明
- 通过正则抽取，不是完整语言语义索引
- 当前覆盖 TS/JS、Python、Go、Rust 等常见语言
- 对大文件和二进制文件会跳过

适合理解为“低成本导航增强”，不是全功能语义数据库。

## LSP

当前仓库已有 LSP 相关结构：

- `main-src/lsp/`
- `main-src/lspSessionsByWebContents.ts`
- `main-src/ipc/handlers/lspHandlers.ts`（`lsp:ts:*` IPC 注册）
- `main-src/plugins/` 下的 LSP 配置装配
- preload 中的 `lsp:*` IPC 通道

从 `settingsStore.ts` 的注释可知：

- 旧版可以直接在 `settings.json` 里登记 LSP
- 现在更推荐用插件目录中的 `.lsp.json` 或 `plugin.json#lspServers`

## Browser 工具

`main-src/browser/browserController.ts` 说明内置浏览器并不是简单 webview：

- 配置按 host window 分隔
- 通过 Electron session partition 隔离
- 可定制 User-Agent、Accept-Language、附加 Header、代理规则
- 保存实时标签页状态，并支持命令结果回传

这解释了为什么 browser tool 能做比“打开个链接”更多的事情。

## 工作区路径安全

`main-src/workspace.ts` 的 `resolveWorkspacePath()` 会阻止路径逃逸工作区。

因此涉及文件读写、截图默认保存路径、浏览器导出路径等时，都要考虑工作区边界检查，而不是只做字符串拼接。

## 关于语义索引的当前现实

当前仓库里：

- ~~README 仍提到 `workspaceSemanticIndex.ts`~~ → **已修正**：README / README.zh-CN.md 已删除该条目
- `.async/index/semantic.json` 仍残留了这个文件的索引内容（运行时历史残影）
- 当前工作树中 `main-src/workspaceSemanticIndex.ts` 并不存在

结论：

- “语义索引”目前不是一个可直接依赖的源码事实
- 相关说法应视为历史信息

## Primary Sources

- `main-src/workspaceFileIndex.ts`
- `main-src/workspaceSymbolIndex.ts`
- `main-src/workspace.ts`
- `src/hooks/useWorkspaceManager.ts`
- `main-src/browser/browserController.ts`
- `main-src/settingsStore.ts`

## 相关页面

- [仓库地图](../repo-map.md)
- [运行时架构](./runtime-architecture.md)
- [矛盾与待确认项](../meta/contradictions-and-open-questions.md)
- [workspaceFileIndex.ts](../modules/workspace-file-index.md)
- [useWorkspaceManager.ts](../modules/use-workspace-manager.md)
- [workspaceContextExpand.ts](../modules/workspace-context-expand.md)

## 更新触发条件

- 文件搜索策略变化。
- 索引结构变化。
- 新增真实语义索引实现。
- Browser 或 LSP 接入方式变化。
