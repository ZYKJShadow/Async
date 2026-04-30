# IPC 通道地图

- 状态：已根据 `main-src/ipc/register.ts`、`main-src/ipc/handlers/*.ts`、`main-src/terminalSessionIpc.ts` 与 `electron/preload.cjs` 的登记方式校验。
- 主题：主进程注册了哪些 `ipcMain.handle` 通道、按业务域归类、与「preload 白名单」的关系。

## 阅读方式

- **实现权威**：通道处理函数在源码里；本页是**索引**，省略参数细节与返回值形状。
- **Renderer 能否调用**：还须满足 `electron/preload.cjs` 中 `INVOKE_CHANNELS`（及同类列表）是否包含该字符串；main 有而 preload 无则 UI 调不到。
- **注册入口**：`registerIpc()`（`main-src/ipc/register.ts`）会先调用 `registerTerminalSessionIpc()`，再依次调用 `main-src/ipc/handlers/*Handlers.ts` 中的注册函数，最后注册 `register.ts` 本体中的 handle。旧版 `terminalPty.ts` 已移除。

## Shell / 应用

| 通道 | 职责摘要 |
| --- | --- |
| `async-shell:ping` | 连通性探测 |
| `app:getPaths` | 常用路径（userData 等） |
| `app:getVersion` | 应用版本号 |
| `app:newWindow` / `app:newEditorWindow` | 新开窗口 |
| `app:openOrFocusWindowSurface` | 聚焦或打开指定 Surface 窗口 |
| `app:windowGetState` / `app:windowMinimize` / `app:windowToggleMaximize` / `app:windowClose` | 窗口状态与 chrome 控制 |
| `app:windowSurfaceStatus` | 窗口 Surface 状态上报 |
| `app:setUnreadBadgeCount` | 设置未读角标 |
| `app:quit` | 退出应用 |
| `app:requestOpenSettings` | 请求打开设置页并可带导航 id |
| `theme:applyChrome` | 按窗口应用原生标题栏主题色 |

## 工作区

| 通道 | 职责摘要 |
| --- | --- |
| `workspace:pickFolder` / `workspace:openPath` / `workspace:closeFolder` | 选择、打开、关闭工作区 |
| `workspace:openInExternalTool` | 用外部 IDE/资源管理器/终端打开 |
| `workspace:listRecents` / `workspace:removeRecent` | 最近工作区列表 |
| `workspace:get` | 当前 sender 绑定的工作区根 |
| `workspace:listFiles` | 文件列表（经 `ensureWorkspaceFileIndex`） |
| `workspace:searchFiles` | 工作区内文件搜索 |
| `workspace:searchSymbols` | 符号搜索 |
| `workspace:saveComposerAttachment` | Composer 拖拽附件落盘到 `.async/composer-drops` |
| `workspace:pickComposerImages` | 选择图片附件 |
| `workspace:resolveDroppedFilePath` | 解析拖拽文件路径 |

## LSP（TypeScript 内嵌）

| 通道 | 职责摘要 | 注册位置 |
| --- | --- | --- |
| `lsp:ts:start` / `lsp:ts:stop` | 启停 TS 语言服务 | `ipc/handlers/lspHandlers.ts` |
| `lsp:ts:definition` / `lsp:ts:diagnostics` | 定义跳转与诊断 | `ipc/handlers/lspHandlers.ts` |

## 文件与 Shell

| 通道 | 职责摘要 |
| --- | --- |
| `fs:pickOpenFile` / `fs:pickSaveFile` | 系统文件对话框 |
| `fs:readFile` / `fs:readTextPreview` / `fs:writeFile` / `fs:listDir` | 工作区内读写与列目录 |
| `fs:renameEntry` / `fs:removeEntry` | 重命名与删除 |
| `shell:revealInFolder` / `shell:revealAbsolutePath` / `shell:openDefault` / `shell:openInBrowser` / `shell:openExternalUrl` | 在资源管理器中展示或打开 / 打开外部 URL |
| `clipboard:writeText` / `clipboard:readText` | 剪贴板 |

## 浏览器侧栏

| 通道 | 职责摘要 |
| --- | --- |
| `browser:getConfig` / `browser:setConfig` | 分区与配置 |
| `browser:syncState` / `browser:getState` | 与宿主同步浏览器状态 |
| `browser:commandResult` / `browser:windowReady` | 命令结果与窗口就绪 |
| `browser:openWindow` | 打开独立浏览器窗口 |
| `browser:clearData` | 清除浏览器数据 |
| `composer:appendDraft` | 向 Composer 追加草稿内容 |

## 浏览器抓包与代理（Browser Capture）

| 通道 | 职责摘要 |
| --- | --- |
| `browserCapture:start` / `browserCapture:stop` / `browserCapture:clear` | 启停抓包与清空 |
| `browserCapture:listRequests` / `browserCapture:getRequest` / `browserCapture:exportRequests` | 请求列表、详情、导出 |
| `browserCapture:hookList` / `browserCapture:hookIngest` | Hook 列表与注入 |
| `browserCapture:storageList` / `browserCapture:storageIngest` | Storage 条目列表与注入 |
| `browserCapture:sessionsList` / `browserCapture:sessionsSave` / `browserCapture:sessionsLoad` / `browserCapture:sessionsRename` / `browserCapture:sessionsDelete` | 会话快照管理 |
| `browserCapture:analyze` / `browserCapture:analysisRecord` / `browserCapture:analysisList` / `browserCapture:analysisRemove` | 请求分析 |
| `browserCapture:proxyStatus` / `browserCapture:proxyStart` / `browserCapture:proxyStop` / `browserCapture:proxySystemProxyToggle` | 代理启停与系统代理切换 |
| `browserCapture:proxyCaInstall` / `browserCapture:proxyCaUninstall` / `browserCapture:proxyCaRefresh` / `browserCapture:proxyOpenCaPath` / `browserCapture:proxyCopySnippet` / `browserCapture:proxyExportCa` | CA 证书管理 |
| `browserCapture:getState` | 获取抓包整体状态 |

## 设置、插件、工作区 Agent

| 通道 | 职责摘要 |
| --- | --- |
| `settings:get` / `settings:set` | 全局设置读写 |
| `settings:testBotConnection` | 校验 bot 集成连通性 |
| `settings:discoverProviderModels` | 发现 provider 模型列表 |
| `settings:runCodexLogin` / `settings:cancelCodexLogin` | Codex 登录流程 |
| `settings:runProviderOAuthLogin` / `settings:cancelProviderOAuthLogin` | Provider OAuth 登录流程 |
| `settings:importBotSkillFolder` | 导入 bot 技能文件夹 |
| `team:getBuiltinCatalog` | 获取内置 Team 目录 |
| `feishu:runOauth` / `feishu:cancelOauth` / `feishu:disconnect` / `feishu:getCallbackUrls` | 飞书 OAuth 与回调 |
| `plugins:getState` / `plugins:getRuntimeState` | 插件状态与运行时状态 |
| `plugins:pickUserDirectory` / `plugins:setUserDirectory` | 用户插件目录选择 |
| `plugins:addMarketplace` / `plugins:refreshMarketplace` / `plugins:removeMarketplace` | 插件市场管理 |
| `plugins:install` / `plugins:uninstall` | 插件安装与卸载 |
| `plugins:setEnabled` | 插件启用状态 |
| `workspaceAgent:get` / `workspaceAgent:set` / `workspaceAgent:resetAsyncDir` | `.async/agent.json` 项目切片与重置 |
| `workspace:listDiskSkills` / `workspace:deleteSkillFromDisk` | 磁盘技能扫描与删除 |
| `workspace:memory:stats` / `workspace:memory:rebuild` | 项目记忆索引维护 |

## 线程与 Plan

| 通道 | 职责摘要 |
| --- | --- |
| `threads:list` / `threads:listLight` / `threads:listDetails` / `threads:listAgentSidebar` | 线程列表与多工作区侧栏摘要 |
| `threads:messages` / `threads:create` / `threads:select` / `threads:delete` / `threads:rename` | 消息与线程 CRUD |
| `threads:fileStates` | 线程关联文件状态 |
| `threads:getExecutedPlanKeys` / `threads:markPlanExecuted` | Plan 审阅执行记录 |
| `threads:getPlan` | 线程内结构化 plan 元数据 |
| `plan:save` | Markdown Plan 落盘（工作区或 userData 下 `.async/plans`） |
| `plan:saveStructured` | 结构化 plan 写入线程存储 |
| `plan:toolQuestionRespond` | Plan 工具提问的用户响应 |

## 聊天与 Agent

| 通道 | 职责摘要 |
| --- | --- |
| `chat:send` / `chat:editResend` | 发送与编辑后重发（内部进入流式管线） |
| `chat:abort` | 中止指定线程的生成 |
| `agent:applyDiffChunk` / `agent:applyDiffChunks` | 应用 Agent diff / 多段 patch |
| `agent:getSession` | 会话态查询 |
| `agent:sendInput` / `agent:wait` / `agent:resume` / `agent:close` | 托管子 Agent 输入与生命周期 |
| `agent:keepLastTurn` / `agent:revertLastTurn` | 整轮保留或回滚 |
| `agent:keepFile` / `agent:getFileSnapshot` / `agent:revertFile` | 单文件快照与回滚 |
| `agent:hasSnapshots` | 查询线程是否有快照 |
| `agent:seedFileSnapshot` / `agent:acceptFileHunk` / `agent:revertFileHunk` | 分块审阅与快照推进 |
| `agent:userInputRespond` | 通用用户输入请求 |
| `agent:toolApprovalRespond` | 工具审批闸门 |
| `agent:mistakeLimitRespond` | 连续错误恢复决策 |
| `team:planApprovalRespond` | Team 计划提案审批 |

## Git

| 通道 | 职责摘要 |
| --- | --- |
| `git:status` / `git:fullStatus` | 状态行与扩展信息 |
| `git:diffPreviews` | 批量 diff 预览 |
| `git:diffPreview` | 单文件 diff 预览（⚠️ 当前 preload 白名单中**无**此单数通道，renderer 无法调用） |
| `git:hasStaged` | 查询是否有已暂存变更 |
| `git:remoteInfo` | 远程仓库信息 |
| `git:listBranches` / `git:checkoutBranch` / `git:createBranch` | 分支 |
| `git:stageAll` / `git:commit` / `git:push` / `git:pushSetUpstream` | 暂存、提交、推送、推送并设置上游 |

## 终端

| 通道 | 职责摘要 | 注册位置 |
| --- | --- | --- |
| `term:sessionCreate` / `term:sessionWrite` / `term:sessionRespondToPrompt` / `term:sessionClearPrompt` / `term:sessionResize` / `term:sessionKill` / `term:sessionRename` / `term:sessionList` / `term:sessionInfo` / `term:sessionBuffer` / `term:sessionSubscribe` / `term:sessionUnsubscribe` | 共享 PTY 会话池（全能终端 + Agent）；`sessionRespondToPrompt` 对应服务层 `respondToTerminalSessionAuthPrompt`（密码 / passphrase 提示） | `terminalSessionIpc.ts` |
| `terminalWindow:open` / `term:listBuiltinProfiles` / `term:profilePasswordState` / `term:profilePasswordSet` / `term:profilePasswordCacheSet` / `term:profilePasswordClear` / `term:pickPath` / `term:pickSavePath` | 独立终端窗口、profile 密码与路径选择 | `terminalSessionIpc.ts` |
| `term:portCheck` | 端口转发检查 | `terminalSessionIpc.ts` |
| `term:settingsSync` | 终端设置同步 | `terminalSessionIpc.ts` |
| `term:sftpConnect` / `term:sftpDisconnect` / `term:sftpList` / `term:sftpStat` / `term:sftpRealPath` / `term:sftpMkdir` / `term:sftpDelete` / `term:sftpRename` / `term:sftpUploadFile` / `term:sftpUploadDirectory` / `term:sftpDownloadFile` / `term:sftpDownloadDirectory` / `term:sftpEditLocal` | SFTP 文件传输 | `terminalSessionIpc.ts` |
| `terminal:execLine` | 在工作区内执行单行命令（非持久会话路径） | `ipc/handlers/terminalExecHandlers.ts` |
| ~~`terminal:ptyCreate` 等~~ | ~~旧版/按 sender 绑定的 PTY 会话~~ | ~~已移除；preload 残留死代码~~ |

会话池实现见 [terminalSessionService.ts](../modules/terminal-session-service.md)；IPC 注册与窗口映射见 [terminalSessionIpc.ts](../modules/terminal-session-ipc.md)。

## MCP

| 通道 | 职责摘要 |
| --- | --- |
| `mcp:getServers` / `mcp:listServers` | 配置列表 |
| `mcp:getStatuses` | 连接状态（会按工作区合并插件侧 effective 配置） |
| `mcp:saveServer` / `mcp:deleteServer` | 增删改配置并持久化 |
| `mcp:startServer` / `mcp:stopServer` / `mcp:restartServer` / `mcp:startAll` | 进程生命周期 |
| `mcp:getTools` / `mcp:callTool` | 工具列表与调用 |
| `mcp:destroy` | 应用退出时释放 |

管理器实现见 [mcpManager.ts](../modules/mcp-manager.md)。进入管理器前的「用户配置 + 插件 MCP」合并见 [pluginRuntimeService.ts](../modules/plugin-runtime-service.md)。

## 使用统计与自动更新

| 通道 | 职责摘要 |
| --- | --- |
| `usageStats:get` / `usageStats:pickDirectory` | 使用统计目录 |
| `auto-update:check` / `auto-update:download` / `auto-update:install` / `auto-update:get-status` / `auto-update:open-folder` | 自动更新流程与打开更新目录 |

## 推送事件（非 `handle`，仅提醒）

流式聊天、布局、终端数据等多半通过 `webContents.send` / preload `subscribe*` 下发；具体频道以 `preload.cjs` 与 `register.ts` 内 `send('async-shell:…')` 为准，本页不逐项罗列。

## Primary Sources

- `main-src/ipc/register.ts`
- `main-src/ipc/handlers/*Handlers.ts`
- `main-src/terminalSessionIpc.ts`
- `electron/preload.cjs`

## 相关页面

- [运行时架构](./runtime-architecture.md)
- [仓库地图](../repo-map.md)
- [模块页索引](../modules/README.md)
- [Preload 与主进程 invoke 对齐检查清单](../meta/preload-main-invoke-checklist.md)

## 更新触发条件

- 新增或重命名任意 `ipcMain.handle` 通道。
- Preload 白名单与主进程登记不一致时，应同时修订本页与 `runtime-architecture.md` 的描述。
