const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** @type {Set<string>} */
const INVOKE_CHANNELS = new Set([
	'async-shell:ping',
	'app:getPaths',
	'app:getVersion',
	'app:setUnreadBadgeCount',
	'workspace:pickFolder',
	'workspace:openPath',
	'workspace:openInExternalTool',
	'workspace:listRecents',
	'workspace:get',
	'workspace:listDiskSkills',
	'workspace:deleteSkillFromDisk',
	'workspace:listFiles',
	'workspace:searchFiles',
	'browser:getConfig',
	'browser:setConfig',
	'browser:syncState',
	'browser:getState',
	'browser:commandResult',
	'browser:windowReady',
	'browser:openWindow',
	'browser:clearData',
	'browserCapture:getState',
	'browserCapture:start',
	'browserCapture:stop',
	'browserCapture:clear',
	'browserCapture:listRequests',
	'browserCapture:exportRequests',
	'browserCapture:getRequest',
	'browserCapture:proxyStatus',
	'browserCapture:proxyStart',
	'browserCapture:proxyStop',
	'browserCapture:proxyExportCa',
	'browserCapture:proxySystemProxyToggle',
	'browserCapture:proxyCaInstall',
	'browserCapture:proxyCaUninstall',
	'browserCapture:proxyCaRefresh',
	'browserCapture:proxyOpenCaPath',
	'browserCapture:proxyCopySnippet',
	'browserCapture:hookIngest',
	'browserCapture:hookList',
	'browserCapture:storageIngest',
	'browserCapture:storageList',
	'browserCapture:sessionsList',
	'browserCapture:sessionsSave',
	'browserCapture:sessionsLoad',
	'browserCapture:sessionsRename',
	'browserCapture:sessionsDelete',
	'browserCapture:analyze',
	'composer:appendDraft',
	'workspace:saveComposerAttachment',
	'workspace:pickComposerImages',
	'workspace:resolveDroppedFilePath',
	'workspace:searchSymbols',
	'lsp:ts:start',
	'lsp:ts:stop',
	'lsp:ts:definition',
	'lsp:ts:diagnostics',
	'workspace:memory:stats',
	'workspace:memory:rebuild',
	'settings:get',
	'settings:set',
	'settings:discoverProviderModels',
	'settings:runProviderOAuthLogin',
	'settings:cancelProviderOAuthLogin',
	'settings:runCodexLogin',
	'settings:cancelCodexLogin',
	'settings:testBotConnection',
	'settings:importBotSkillFolder',
	'feishu:runOauth',
	'feishu:cancelOauth',
	'feishu:disconnect',
	'feishu:getCallbackUrls',
	'plugins:getState',
	'plugins:getRuntimeState',
	'plugins:pickUserDirectory',
	'plugins:setUserDirectory',
	'plugins:addMarketplace',
	'plugins:refreshMarketplace',
	'plugins:removeMarketplace',
	'plugins:install',
	'plugins:uninstall',
	'plugins:setEnabled',
	'mcp:getServers',
	'mcp:listServers',
	'mcp:getStatuses',
	'mcp:saveServer',
	'mcp:deleteServer',
	'mcp:startServer',
	'mcp:stopServer',
	'mcp:restartServer',
	'mcp:startAll',
	'mcp:getTools',
	'mcp:callTool',
	'mcp:destroy',
	'usageStats:get',
	'usageStats:pickDirectory',
	'theme:applyChrome',
	'threads:list',
	'threads:listLight',
	'threads:listDetails',
	'threads:listAgentSidebar',
	'threads:messages',
	'threads:fileStates',
	'threads:create',
	'threads:select',
	'threads:delete',
	'threads:rename',
	'threads:getExecutedPlanKeys',
	'threads:markPlanExecuted',
	'chat:send',
	'chat:editResend',
	'chat:abort',
	'fs:readFile',
	'fs:readTextPreview',
	'fs:writeFile',
	'fs:listDir',
	'fs:renameEntry',
	'fs:removeEntry',
	'shell:revealInFolder',
	'shell:revealAbsolutePath',
	'shell:openDefault',
	'shell:openInBrowser',
	'shell:openExternalUrl',
	'clipboard:writeText',
	'clipboard:readText',
	'git:status',
	'git:fullStatus',
	'git:stageAll',
	'git:commit',
	'git:push',
	'git:pushSetUpstream',
	'git:hasStaged',
	'git:remoteInfo',
	'git:diffPreviews',
	'git:listBranches',
	'git:checkoutBranch',
	'git:createBranch',
	'terminal:execLine',
	'terminal:ptyCreate',
	'terminal:ptyWrite',
	'terminal:ptyResize',
	'terminal:ptyKill',
	'terminalWindow:open',
	'term:sessionCreate',
	'term:sessionWrite',
	'term:sessionRespondToPrompt',
	'term:sessionClearPrompt',
	'term:sessionResize',
	'term:sessionKill',
	'term:sessionRename',
	'term:sessionList',
	'term:settingsSync',
	'term:listBuiltinProfiles',
	'term:profilePasswordState',
	'term:profilePasswordSet',
	'term:profilePasswordCacheSet',
	'term:profilePasswordClear',
	'term:portCheck',
	'term:pickPath',
	'term:pickSavePath',
	'term:sessionInfo',
	'term:sessionBuffer',
	'term:sessionSubscribe',
	'term:sessionUnsubscribe',
	'term:sftpConnect',
	'term:sftpDisconnect',
	'term:sftpList',
	'term:sftpStat',
	'term:sftpRealPath',
	'term:sftpMkdir',
	'term:sftpDelete',
	'term:sftpRename',
	'term:sftpUploadFile',
	'term:sftpUploadDirectory',
	'term:sftpDownloadFile',
	'term:sftpDownloadDirectory',
	'term:sftpEditLocal',
	'agent:applyDiffChunk',
	'agent:applyDiffChunks',
	'agent:keepLastTurn',
	'agent:revertLastTurn',
	'agent:keepFile',
	'agent:revertFile',
	'agent:getFileSnapshot',
	'agent:hasSnapshots',
	'agent:seedFileSnapshot',
	'agent:acceptFileHunk',
	'agent:revertFileHunk',
	'agent:getSession',
	'agent:sendInput',
	'agent:userInputRespond',
	'agent:wait',
	'agent:resume',
	'agent:close',
	'agent:toolApprovalRespond',
	'agent:mistakeLimitRespond',
	'plan:save',
	'plan:saveStructured',
	'plan:toolQuestionRespond',
	'team:userInputRespond',
	'team:planApprovalRespond',
	'team:getBuiltinCatalog',
	'threads:getPlan',
	'workspaceAgent:get',
	'workspaceAgent:set',
	'workspaceAgent:resetAsyncDir',
	'workspace:closeFolder',
	'workspace:removeRecent',
	'app:newWindow',
	'app:newEditorWindow',
	'app:windowSurfaceStatus',
	'app:openOrFocusWindowSurface',
	'app:windowGetState',
	'app:windowMinimize',
	'app:windowToggleMaximize',
	'app:windowClose',
	'app:requestOpenSettings',
	'app:quit',
	'fs:pickOpenFile',
	'fs:pickSaveFile',
	'auto-update:check',
	'auto-update:download',
	'auto-update:install',
	'auto-update:get-status',
	'auto-update:open-folder',
]);

const chatHandlers = new Map();
let chatSeq = 0;

const layoutHandlers = new Map();
let layoutSeq = 0;

const themeModeHandlers = new Map();
let themeModeSeq = 0;

const workspaceFsTouchedHandlers = new Map();
let workspaceFsTouchedSeq = 0;

const workspaceFileIndexReadyHandlers = new Map();
let workspaceFileIndexReadySeq = 0;

const pluginsChangedHandlers = new Map();
let pluginsChangedSeq = 0;

ipcRenderer.on('async-shell:chat', (_event, payload) => {
	for (const fn of chatHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:layout', () => {
	for (const fn of layoutHandlers.values()) {
		try {
			fn();
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:themeMode', (_event, payload) => {
	for (const fn of themeModeHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:workspaceFsTouched', () => {
	for (const fn of workspaceFsTouchedHandlers.values()) {
		try {
			fn();
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:workspaceFileIndexReady', (_event, rootNorm) => {
	for (const fn of workspaceFileIndexReadyHandlers.values()) {
		try {
			fn(String(rootNorm ?? ''));
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:pluginsChanged', () => {
	for (const fn of pluginsChangedHandlers.values()) {
		try {
			fn();
		} catch (e) {
			console.error(e);
		}
	}
});

const autoUpdateStatusHandlers = new Map();
let autoUpdateStatusSeq = 0;

ipcRenderer.on('auto-update:status', (_event, payload) => {
	for (const fn of autoUpdateStatusHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

const browserNewWindowHandlers = new Map();
let browserNewWindowSeq = 0;

ipcRenderer.on('async-shell:browserNewWindow', (_event, payload) => {
	for (const fn of browserNewWindowHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

const browserControlHandlers = new Map();
let browserControlSeq = 0;

ipcRenderer.on('async-shell:browserControl', (_event, payload) => {
	for (const fn of browserControlHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

const openSettingsNavHandlers = new Map();
let openSettingsNavSeq = 0;

const composerAppendDraftHandlers = new Map();
let composerAppendDraftSeq = 0;

const trayCommandHandlers = new Map();
let trayCommandSeq = 0;

ipcRenderer.on('async-shell:openSettingsNav', (_event, nav) => {
	for (const fn of openSettingsNavHandlers.values()) {
		try {
			fn(nav);
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:composerAppendDraft', (_event, payload) => {
	for (const fn of composerAppendDraftHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

ipcRenderer.on('async-shell:trayCommand', (_event, payload) => {
	for (const fn of trayCommandHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

contextBridge.exposeInMainWorld('asyncShell', {
	invoke(channel, ...args) {
		if (!INVOKE_CHANNELS.has(channel)) {
			throw new Error(`async-shell: blocked IPC channel "${channel}"`);
		}
		return ipcRenderer.invoke(channel, ...args);
	},
	setUnreadBadgeCount(count) {
		const safe = Math.max(0, Math.min(999, Math.floor(Number(count) || 0)));
		return ipcRenderer.invoke('app:setUnreadBadgeCount', safe);
	},
	getPathForFile(file) {
		try {
			return webUtils.getPathForFile(file) || null;
		} catch {
			return null;
		}
	},
	subscribeTerminalPtyData(callback) {
		const handler = (_e, id, data) => {
			callback(String(id), String(data));
		};
		ipcRenderer.on('terminal:ptyData', handler);
		return () => ipcRenderer.removeListener('terminal:ptyData', handler);
	},
	subscribeTerminalPtyExit(callback) {
		const handler = (_e, id, code) => {
			callback(String(id), code);
		};
		ipcRenderer.on('terminal:ptyExit', handler);
		return () => ipcRenderer.removeListener('terminal:ptyExit', handler);
	},
	subscribeChat(callback) {
		const id = ++chatSeq;
		chatHandlers.set(id, callback);
		return () => chatHandlers.delete(id);
	},
	subscribeLayout(callback) {
		const id = ++layoutSeq;
		layoutHandlers.set(id, callback);
		return () => layoutHandlers.delete(id);
	},
	subscribeThemeMode(callback) {
		const id = ++themeModeSeq;
		themeModeHandlers.set(id, callback);
		return () => themeModeHandlers.delete(id);
	},
	subscribeWorkspaceFsTouched(callback) {
		const id = ++workspaceFsTouchedSeq;
		workspaceFsTouchedHandlers.set(id, callback);
		return () => workspaceFsTouchedHandlers.delete(id);
	},
	subscribeWorkspaceFileIndexReady(callback) {
		const id = ++workspaceFileIndexReadySeq;
		workspaceFileIndexReadyHandlers.set(id, callback);
		return () => workspaceFileIndexReadyHandlers.delete(id);
	},
	subscribePluginsChanged(callback) {
		const id = ++pluginsChangedSeq;
		pluginsChangedHandlers.set(id, callback);
		return () => pluginsChangedHandlers.delete(id);
	},
	subscribeAutoUpdateStatus(callback) {
		const id = ++autoUpdateStatusSeq;
		autoUpdateStatusHandlers.set(id, callback);
		return () => autoUpdateStatusHandlers.delete(id);
	},
	subscribeBrowserNewWindow(callback) {
		const id = ++browserNewWindowSeq;
		browserNewWindowHandlers.set(id, callback);
		return () => browserNewWindowHandlers.delete(id);
	},
	subscribeBrowserControl(callback) {
		const id = ++browserControlSeq;
		browserControlHandlers.set(id, callback);
		return () => browserControlHandlers.delete(id);
	},
	subscribeTerminalSessionData(callback) {
		const handler = (_e, id, data, seq) => {
			callback(String(id), String(data), typeof seq === 'number' ? seq : 0);
		};
		ipcRenderer.on('term:data', handler);
		return () => ipcRenderer.removeListener('term:data', handler);
	},
	subscribeTerminalSessionAuthPrompt(callback) {
		const handler = (_e, id, prompt) => {
			callback(String(id), prompt && typeof prompt === 'object' ? prompt : null);
		};
		ipcRenderer.on('term:authPrompt', handler);
		return () => ipcRenderer.removeListener('term:authPrompt', handler);
	},
	subscribeTerminalSessionExit(callback) {
		const handler = (_e, id, code) => {
			callback(String(id), code);
		};
		ipcRenderer.on('term:exit', handler);
		return () => ipcRenderer.removeListener('term:exit', handler);
	},
	subscribeTerminalSessionListChanged(callback) {
		const handler = () => {
			callback();
		};
		ipcRenderer.on('term:listChanged', handler);
		return () => ipcRenderer.removeListener('term:listChanged', handler);
	},
	subscribeOpenSettingsNav(callback) {
		const id = ++openSettingsNavSeq;
		openSettingsNavHandlers.set(id, callback);
		return () => openSettingsNavHandlers.delete(id);
	},
	subscribeComposerAppendDraft(callback) {
		const id = ++composerAppendDraftSeq;
		composerAppendDraftHandlers.set(id, callback);
		return () => composerAppendDraftHandlers.delete(id);
	},
	subscribeTrayCommand(callback) {
		const id = ++trayCommandSeq;
		trayCommandHandlers.set(id, callback);
		return () => trayCommandHandlers.delete(id);
	},
});
