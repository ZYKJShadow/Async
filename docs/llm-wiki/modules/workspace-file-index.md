# workspaceFileIndex.ts

- 模块：`main-src/workspaceFileIndex.ts`
- 状态：已根据当前源码校验。
- 主题：工作区文件索引的当前真实角色，以及它“仍在用但不再常驻预热”的现状。

## 当前结论

`workspaceFileIndex.ts` 现在不是废弃模块，也不是启动期主流程里一直常驻预热的重模块。

更准确的说法是：

- 它仍然在用
- 但已经转成按需文件索引底座
- 用户记忆里常见的“预热索引版本”已经不是当前主叙事

## 它现在还被谁调用

### 直接调用方

- `main-src/ipc/handlers/workspaceHandlers.ts`
  - `workspace:listFiles`
  - `workspace:searchFiles`
  - chat / plan / ask / team 预处理时获取 `workspaceFiles`
- `main-src/appWindow.ts`
  - 窗口绑定工作区时 `acquireWorkspaceFileIndexRef`
  - 窗口销毁时 `releaseWorkspaceFileIndexRef`
- `main-src/workspaceSymbolIndex.ts`
  - `ensureSymbolIndexLoaded()` 会先拿文件索引
- `main-src/bots/botRuntime.ts`
  - bot 任务运行前会拿 `workspaceFiles`
- `main-src/llm/workspaceContextExpand.ts`
  - 会尝试读“新鲜索引”，否则回退到直接列目录

### renderer 侧间接依赖

- `src/hooks/useWorkspaceManager.ts`
  - `workspace:listFiles`
  - `workspace:searchFiles`
- `src/App.tsx`
  - 订阅 `workspaceFileIndexReady`
- `src/useComposerAtMention.ts`
  - 菜单打开期间依赖 ready tick 重跑查询
- `src/quickOpenPalette.tsx`
  - 通过全量文件列表支持 Quick Open

## 它当前负责什么

- 维护每个 workspace root 的文件集合 bucket
- 提供全量文件列表
- 提供 Top-K 文件搜索
- 在需要时用 `git ls-files` 或全量扫描建立索引
- 可选地挂 watcher
- 在索引完成时广播 ready 事件

## 它不再是什么

基于当前代码，可以确认这些旧印象已经不准确：

- 不是“打开工作区就立刻预热全量索引”
- 不是“前端提前加载完整文件列表后再做搜索”
- 不是“明显无人调用的死模块”

## 当前实现特点

### 1. 优先走 git

`ensureWorkspaceFileIndex()` 会优先尝试：

- `git ls-files`
- `git ls-files --others --exclude-standard`

失败后才退回文件系统全量扫描。

### 2. watcher 默认不常开

是否附加 watcher 受环境变量控制：

- `ASYNC_ENABLE_WORKSPACE_FILE_WATCHER === '1'`

所以默认语义更接近“缓存 + 按需刷新”，而不是“实时常驻监听”。

### 3. 仍然是多能力的共享底座

它不仅服务 `@` 提及，还支撑：

- Quick Open 全量文件集
- 工作区树摘要构建
- symbol index 的文件来源
- bot 任务上下文

## 与“已不使用”这类说法的关系

更准确的纠偏应该是：

- “启动期 eager prewarm 的心智模型过时了”
- 不是“整个 workspaceFileIndex 已经没人用”

## 修改这个文件时要一起看

- `main-src/ipc/handlers/workspaceHandlers.ts`
- `src/hooks/useWorkspaceManager.ts`
- `src/useComposerAtMention.ts`
- `main-src/workspaceSymbolIndex.ts`
- `main-src/llm/workspaceContextExpand.ts`
- `main-src/bots/botRuntime.ts`

## Primary Sources

- `main-src/workspaceFileIndex.ts`
- `main-src/ipc/register.ts`
- `src/hooks/useWorkspaceManager.ts`
- `src/useComposerAtMention.ts`
- `main-src/workspaceSymbolIndex.ts`
- `main-src/llm/workspaceContextExpand.ts`
- `main-src/bots/botRuntime.ts`

## 相关页面

- [工作区智能](../architecture/workspace-intelligence.md)
- [仓库地图](../repo-map.md)

## 更新触发条件

- 文件搜索入口变化
- Quick Open / `@` 提及不再依赖它
- watcher 语义变化
- symbol index 或 bot runtime 改用别的文件来源
