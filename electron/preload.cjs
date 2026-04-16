const { contextBridge, ipcRenderer } = require('electron');

/** @type {Set<string>} */
const INVOKE_CHANNELS = new Set([
	'async-shell:ping',
	'app:getPaths',
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
	'workspace:saveComposerAttachment',
	'workspace:searchSymbols',
	'lsp:ts:start',
	'lsp:ts:stop',
	'lsp:ts:definition',
	'lsp:ts:diagnostics',
	'workspace:memory:stats',
	'workspace:memory:rebuild',
	'settings:get',
	'settings:set',
	'settings:testBotConnection',
	'usageStats:get',
	'usageStats:pickDirectory',
	'theme:applyChrome',
	'threads:list',
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
	'fs:writeFile',
	'fs:listDir',
	'fs:renameEntry',
	'fs:removeEntry',
	'shell:revealInFolder',
	'shell:revealAbsolutePath',
	'shell:openDefault',
	'shell:openInBrowser',
	'clipboard:writeText',
	'clipboard:readText',
	'git:status',
	'git:fullStatus',
	'git:stageAll',
	'git:commit',
	'git:push',
	'git:diffPreviews',
	'git:listBranches',
	'git:checkoutBranch',
	'git:createBranch',
	'terminal:execLine',
	'terminal:ptyCreate',
	'terminal:ptyWrite',
	'terminal:ptyResize',
	'terminal:ptyKill',
	'agent:applyDiffChunk',
	'agent:applyDiffChunks',
	'agent:keepLastTurn',
	'agent:revertLastTurn',
	'agent:keepFile',
	'agent:revertFile',
	'agent:getFileSnapshot',
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
	'threads:getPlan',
	'workspaceAgent:get',
	'workspaceAgent:set',
	'workspace:closeFolder',
	'workspace:removeRecent',
	'app:newWindow',
	'app:newEditorWindow',
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

ipcRenderer.on('async-shell:openSettingsNav', (_event, nav) => {
	for (const fn of openSettingsNavHandlers.values()) {
		try {
			fn(nav);
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
	subscribeOpenSettingsNav(callback) {
		const id = ++openSettingsNavSeq;
		openSettingsNavHandlers.set(id, callback);
		return () => openSettingsNavHandlers.delete(id);
	},
});
