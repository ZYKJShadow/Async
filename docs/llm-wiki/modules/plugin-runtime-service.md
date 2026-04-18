# pluginRuntimeService.ts

- 模块：`main-src/plugins/pluginRuntimeService.ts`（紧密依赖 `pluginFs.js`、`pluginDiscoveryVersion.ts`、`settingsStore`）
- 状态：已根据当前源码与 `ipc/register.ts` 中 `mergeAgentWithPluginRuntime` / `getEffectiveMcpServerConfigs` 用法校验。
- 主题：已安装插件的运行时贡献（skills、commands、**插件声明的 MCP 服务器**）如何扫描、缓存，以及如何与全局设置里的 **MCP 覆盖**、用户 Agent 配置合并。

## 一句话职责

`getPluginRuntimeState(workspaceRoot)` 扫描 **用户插件根** 与 **`<workspace>/.async/plugins`** 下的合法安装目录，读出 Claude/Codex 风格 manifest，聚合成 `PluginRuntimeState`（`plugins`、`skills`、`commands`、`mcpServers`）；`mergeAgentWithPluginRuntime` 把 skills/commands 并进用户 `AgentCustomization`；`getEffectiveMcpServerConfigs` 把 **磁盘上的 `mcpServers` 列表** 与 **插件贡献的 MCP 配置** 拼接，供 `McpManager.loadConfigs` 使用。

## 扫描范围与缓存

- **用户范围**：`resolveUserPluginsRoot(getSettings())` 下的子目录（`scope: 'user'`）。
- **项目范围**：`workspaceRoot` 存在时 `path.join(workspaceRoot, '.async', 'plugins')`（`scope: 'project'`）。
- **缓存**：`runtimeCache` 键为 `(normalizeWorkspaceKey(workspaceRoot), getPluginDiscoveryVersion(), pluginMcpOverridesCacheKey(settings.pluginMcpOverrides))`，任一变化则重新扫描。

单插件贡献由 `readContributionForPluginDir` 汇总：manifest 全禁用或安装 meta 禁用时返回 `null`，不参与聚合。

## MCP：从插件到「有效配置」

1. **来源**：Codex manifest 的 `mcpServers` 字段（字符串路径）指向插件包内 JSON；`collectMcpServers` 解析为 `McpServerConfig[]`，每条 id 形如 `plugin-mcp:<contributionKey>:<serverName>`，并带 `pluginManaged: true` 等元数据（见 `parseMcpServerConfig`）。
2. **用户覆盖**：`settings.pluginMcpOverrides` 按 **server `id`** 合并 `enabled` / `autoStart`（`applyPluginMcpOverrides`），只影响已扫描到的插件 MCP 条目，用于在 UI 里关掉某个插件注入的服务而不改插件包本身。
3. **与用户服务器合并**：`getEffectiveMcpServerConfigs(userServers, workspaceRoot)` 实现为：

   `[...(userServers ?? []), ...runtime.mcpServers]`

   即 **用户 `settings.json` 里的 MCP 在前，插件 MCP 在后**；`McpManager` 再按此列表 `loadConfigs`。

因此：排查「多出来的 MCP 连接」时，除了 `settingsStore` 的 `mcpServers`，还要查工作区/用户插件目录与 `pluginMcpOverrides`。

## Agent：skills / commands 合并

`mergeAgentWithPluginRuntime(agent, workspaceRoot)`：

- `skills`：`mergeSkillsBySlug(runtime.skills, base.skills ?? [])` — **同 slug 时插件侧覆盖用户同名 skill**。
- `commands`：`[...(base.commands ?? []), ...runtime.commands]` — 用户命令在前，插件命令追加。

`chat:send` / `chat:editResend` 等在组装 `agentForTurn` 时使用该函数（在 `mergeAgentWithProjectSlice` 之后），与桌面 Composer 行为一致。

## 修改这个文件时要一起看

- `main-src/settingsStore.ts`（`pluginMcpOverrides`、用户插件根路径）
- [mcpManager.ts](./mcp-manager.md)（`loadConfigs(getEffectiveMcpServerConfigs(...))`）
- `main-src/ipc/register.ts`（MCP IPC、`plugins:getRuntimeState`）
- `main-src/plugins/pluginFs.ts`（manifest 路径解析）

## Primary Sources

- `main-src/plugins/pluginRuntimeService.ts`
- `main-src/settingsStore.ts`
- `main-src/ipc/register.ts`

## 相关页面

- [mcpManager.ts](./mcp-manager.md)
- [settingsStore.ts](./settings-store.md)
- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [Preload 与主进程 invoke 对齐检查清单](../meta/preload-main-invoke-checklist.md)

## 更新触发条件

- 插件 manifest schema、MCP 声明路径或 `plugin-mcp:` id 规则变化。
- `pluginMcpOverrides` 语义或缓存键组成变化。
- 新增插件贡献类型（不仅是 skills/commands/mcp）。
