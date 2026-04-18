# 维护手册

- 状态：这是 `docs/llm-wiki` 的维护规则，而不是产品功能说明。
- 目标：让新的源码、文档、对话记忆进入仓库后，能被“编译进 Wiki”，而不是永远停留在零散来源里。

## Wiki 的工作方式

这套 Wiki 应该始终做三件事：

1. 给出稳定入口。
2. 汇总已经验证过的项目知识。
3. 显式管理漂移、冲突和不确定性。

## 信息源优先级

默认优先级：

1. 当前源码
2. 当前配置和持久化实现
3. 当前测试
4. README / docs
5. `.async/memory`
6. `.async/index/` 等运行时生成索引

规则：

- 上层与下层冲突时，不要“平均采信”，而要写清楚谁是当前事实、谁是旧信息。
- `.async/memory` 可以提供线索，但不能跳过代码核验。

## 新数据源进入后的处理流程

### 1. 识别数据源类型

- 源码文件
- README / 设计文档
- `.async/memory` 新记忆
- 运行时生成物
- 外部需求说明

### 2. 提取 durable facts

只提炼这些值得进入 Wiki 的信息：

- 稳定职责
- 关键数据流
- 持久化位置
- 入口文件
- 新旧说法冲突
- 对后续任务有复用价值的约束

不要把这些直接塞进 Wiki：

- 一次性调试日志
- 临时分支状态
- 与本仓库无关的闲聊
- 纯时间线式流水账

### 3. 更新已有页面，而不是盲目新增

优先顺序：

- 先找有没有现成的专题页能承接新事实
- 如果能承接，就直接改现有页面
- 只有当主题明显独立时，才新建页面

若在 `main-src/ipc/register.ts` 或 `terminalSessionIpc.ts` / `terminalPty.ts` 中**新增或重命名** `ipcMain.handle` 通道，应同步更新 [IPC 通道地图](../architecture/ipc-channel-map.md)；若 renderer 需要调用，还要核对 `electron/preload.cjs` 白名单，并视情况修订 [运行时架构](../architecture/runtime-architecture.md) 中 preload 边界说明。具体步骤见 [Preload 与主进程 invoke 对齐检查清单](./preload-main-invoke-checklist.md)。

## 页面结构约定

推荐每页至少保留这些段落：

- `状态`
- `主题`
- `Primary Sources`
- `相关页面`
- `更新触发条件`

如果页面较复杂，再补：

- `关键事实`
- `非目标/边界`
- `开放问题`

模板见 [topic-template](../_templates/topic-template.md)。

## 冲突处理规则

发现冲突时必须做三件事：

1. 修正受影响的专题页。
2. 把冲突写进 [矛盾与待确认项](./contradictions-and-open-questions.md)。
3. 如果旧信息来自 `.async/memory`，考虑同步刷新或删除对应记忆。

## 关于 `.async/memory`

建议把它当作“面向对话注入的压缩记忆”，而不是文档系统本身。

推荐分工：

- `docs/llm-wiki/`：架构、事实、规则、冲突、导航
- `.async/memory/`：短索引、长期偏好、便于自动加载的记忆钩子

注意：

- 当前仓库默认在 `.gitignore` 中忽略 `.async/`
- 因此 `.async/agent.json`、`.async/memory/`、`.async/index/` 默认都偏本地运行时资产
- 真正需要团队共享的知识，应优先编译到 `docs/llm-wiki/`

如果某条 `.async/memory` 记忆已经明显过时，应当：

- 在 Wiki 里记录冲突
- 视情况刷新那条 memory 文件

## 建议的后续扩建方向

- 给 `agentLoop.ts`、`toolExecutor.ts`、`threadStore.ts`、`settingsStore.ts` 建实体页（多数已有 [模块页索引](../modules/README.md)）
- 增加 ADR 风格页面
- 为高频功能建立“变更影响矩阵”
- 让每次大功能合并后同步更新 Wiki，而不是只改 README
- 大版本 IPC 变更时跑一遍 [Preload 与主进程 invoke 对齐检查清单](./preload-main-invoke-checklist.md) 中的步骤

## 审核清单

每次更新 Wiki 后，至少检查：

- 入口页链接是否可达
- 是否出现重复主题页
- 新说法是否和源码一致
- 有无新的冲突需要记录
- 是否需要同步 `.async/agent.json` 的入口规则
