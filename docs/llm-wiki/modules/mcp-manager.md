# mcpManager.ts（McpManager）

- 模块：`main-src/mcp/mcpManager.ts`（同目录 `mcpClient.ts`、`mcpToolResolve.ts`、`mcpTypes.ts` 为紧密依赖）
- 状态：已根据当前源码与 `ipc/register.ts` 中 MCP 相关 handle 校验。
- 主题：多 MCP Server 连接生命周期、工具聚合、暴露给 Agent 的工具名规则，以及与 `settingsStore` / 插件 effective 配置的关系。

## 一句话职责

`McpManager` 维护 `Map<serverId, McpClient>`，在 `loadConfigs` 时按配置差异销毁并重建客户端；在服务器 **connected** 时汇总各端工具列表，转成带 `mcp__` 前缀的 `AgentToolDef`（`shouldDefer: true`、`isMcp: true`），供 `toolExecutor` / Agent 循环与 `mcp:getTools` IPC 使用。

## 配置从哪来

- **持久化**：`settings.json` 中的 `mcpServers` 由 `main-src/settingsStore.ts` 的 `getMcpServerConfigs` / `patchMcpServerConfigs` / `removeMcpServerConfig` 维护。
- **Effective 视图**：IPC 与 `agentLoop` 在加载进 `McpManager` 前会调用 `getEffectiveMcpServerConfigs(userServers, workspaceRoot)`（`pluginRuntimeService.ts`），把插件对工作区内 MCP 条目的覆盖（enabled、autoStart 等）合并进去。合并规则与插件扫描范围见 [pluginRuntimeService.ts](./plugin-runtime-service.md)。

因此：**磁盘上的 settings 不等于** 进入 `McpManager` 的最终列表，排查「设置里关了但还连上」时要查插件合并逻辑。

## 核心方法

| 方法 | 作用 |
| --- | --- |
| `loadConfigs` | 更新 `configs`，对缺失/禁用/配置变更的 client `destroy` 并重建映射，然后 `updateTools` + `emit('servers_changed')` |
| `startServer` / `stopServer` / `restartServer` / `startAll` | 单服务与批量启动；`startAll` 默认 `enabled && autoStart !== false` |
| `getServerStatuses` | 每配置一条状态：`disabled` / `not_started` / 来自 client 的 `connected` 等（`disconnected` 会规范为 `stopped`） |
| `getToolsWithSource` / `getAgentTools` | 已连接服务上的工具 + 来源 id/name；后者经 `mcpToolToAgentTool` 包装 |
| `callTool` | 经 `resolveMcpToolInvocation` 解析规范化名 → 真实 server + 远端 tool name，再转调 `McpClient.callTool` |
| `isMcpTool` | 判断 `name.startsWith('mcp__')` |
| `getClientByServerRef` | 按配置 id 或 **显示名** 解析 client（与 ListMcpResources 等内置工具参数一致） |
| `removeServer` | 销毁 client 并从配置数组移除 |
| `destroy` | 应用退出：`mcp:destroy` → `destroyMcpManager()` |

## 事件

`EventEmitter` 上可监听：

- `servers_changed`：配置集合变化。
- `status_changed`：某个 server 连接状态变化。
- `tools_updated`：工具列表刷新（连接成功或 `tools_changed` 时）。

## 与 IPC 的对应关系

`register.ts` 中 `mcp:*` handle 均通过 `getMcpManager()` 操作；保存/删除服务器时会 **先写 settings 再 `loadConfigs(getEffectiveMcpServerConfigs(...))`**，保证进程内状态与磁盘一致。

通道枚举见 [IPC 通道地图](../architecture/ipc-channel-map.md) MCP 一节。

## 修改这个文件时要一起看

- `main-src/mcp/mcpClient.ts`（传输与协议）
- `main-src/mcp/mcpToolResolve.ts`（工具名解析）
- `main-src/agent/toolExecutor.ts`（MCP 工具执行分支）
- `main-src/plugins/pluginRuntimeService.ts`（`getEffectiveMcpServerConfigs`）
- `main-src/settingsStore.ts`（`mcpServers`、`mcpToolDenyPrefixes` 等）

## Primary Sources

- `main-src/mcp/mcpManager.ts`
- `main-src/mcp/mcpClient.ts`
- `main-src/ipc/register.ts`
- `main-src/settingsStore.ts`

## 相关页面

- [IPC 通道地图](../architecture/ipc-channel-map.md)
- [settingsStore.ts](./settings-store.md)
- [toolExecutor.ts](./tool-executor.md)

## 更新触发条件

- MCP 配置 schema、传输类型或工具名规范化规则变化。
- 插件对 MCP 的 override 语义变化。
- Agent 侧 MCP 工具 defer / deny 前缀策略变化。
