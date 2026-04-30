# settingsStore.ts

- 模块：`main-src/settingsStore.ts`
- 状态：已根据当前源码校验。
- 主题：全局设置的结构定义、迁移和持久化。

## 一句话职责

`settingsStore.ts` 定义并持久化 Async 的全局设置模型，是模型、Agent、UI、MCP、Team、bot 和统计配置的总入口。

## 它管什么

当前 `ShellSettings` 覆盖范围很广，包括：

- 语言
- 模型 providers / entries / enabledIds / thinkingByModelId
- `defaultModel`
- recent workspaces
- Agent customization
- UI 与布局
- LSP 兼容配置
- MCP servers
- usage stats
- auto update
- Team
- bots

## 初始化行为

`initSettingsStore()` 会做几件事：

1. 定位到 `userData/async/settings.json`
2. 读取已有设置
3. 执行若干迁移
4. 如有需要则回写

当前已知迁移包括：

- 旧 provider/model 布局迁移
- `defaultModel: auto` 清理
- `thinkingByModelId` 补全

## patch 语义不是“整对象替换”

`patchSettings()` 的重要特点是按字段做合并，而不是简单覆写整个设置对象。

尤其是这些位置要注意：

- `models`
- `agent`
- `ui`
- `usageStats`
- `autoUpdate`

因此改设置时要判断当前调用是“增量 patch”还是“显式替换某个子块”。

## 模型层为什么离不开这个文件

虽然模型请求解析在 `modelResolve.ts`，但真正的数据源在这里定义：

- provider 凭证
- model entry
- enabled 顺序
- per-model thinking level

所以模型相关问题，通常要和 `modelResolve.ts` 一起看。

## 与工作区状态的边界

这个模块管理的是全局用户设置，不是工作区项目切片。

工作区级 Agent 规则、skills、subagents 在：

- `<workspace>/.async/agent.json`
- 对应实现：`workspaceAgentStore.ts`

## 调试建议

这些问题优先看这里：

- 设置页改了但重启后没持久化
- 模型选择与 provider 配置对不上
- recentWorkspaces 不正确
- Team / bot / MCP 配置丢失
- thinking level 迁移异常

## 典型配套文件

- `main-src/llm/modelResolve.ts`
- `src/hooks/useSettings.ts`
- `main-src/workspaceAgentStore.ts`
- `main-src/ipc/handlers/settingsHandlers.ts`

## Primary Sources

- `main-src/settingsStore.ts`
- `main-src/llm/modelResolve.ts`
- `src/hooks/useSettings.ts`

## 相关页面

- [状态与记忆](../architecture/state-and-memory.md)
- [threadStore.ts](./thread-store.md)

## 更新触发条件

- `ShellSettings` 结构变化
- 设置迁移逻辑变化
- `patchSettings()` 合并语义变化
