const { contextBridge, ipcRenderer } = require('electron');

/** @type {Set<string>} */
const INVOKE_CHANNELS = new Set([
	'async-shell:ping',
	'app:getPaths',
	'workspace:pickFolder',
	'workspace:openPath',
	'workspace:listRecents',
	'workspace:get',
	'workspace:listDiskSkills',
	'workspace:deleteSkillFromDisk',
	'workspace:listFiles',
	'workspace:searchFiles',
	'workspace:saveComposerAttachment',
	'workspace:searchSymbols',
	'lsp:ts:start',
	'lsp:ts:stop',
	'lsp:ts:definition',
	'lsp:ts:diagnostics',
	'workspace:indexing:stats',
	'workspace:indexing:rebuild',
	'settings:get',
	'settings:set',
	'usageStats:get',
	'usageStats:pickDirectory',
	'projectBoundary:checkLocalPath',
	'projectBoundary:testGitRemote',
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
	'agent:toolApprovalRespond',
	'agent:mistakeLimitRespond',
	'plan:save',
	'plan:saveStructured',
	'plan:toolQuestionRespond',
	'threads:getPlan',
	'aiEmployees:generateRolePrompt',
	'aiEmployees:generateHiringPlan',
	'aiEmployees:chat',
	'workspaceAgent:get',
	'workspaceAgent:set',
	'workspace:closeFolder',
	'workspace:removeRecent',
	'app:newWindow',
	'app:newEditorWindow',
	'app:openAiEmployees',
	'app:windowGetState',
	'app:windowMinimize',
	'app:windowToggleMaximize',
	'app:windowClose',
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

const appearanceUiHandlers = new Map();
let appearanceUiSeq = 0;

const workspaceFsTouchedHandlers = new Map();
let workspaceFsTouchedSeq = 0;

const workspaceFileIndexReadyHandlers = new Map();
let workspaceFileIndexReadySeq = 0;

const aiEmployeesWorkspaceHandlers = new Map();
let aiEmployeesWorkspaceSeq = 0;

const aiEmployeesChatHandlers = new Map();
let aiEmployeesChatSeq = 0;

ipcRenderer.on('async-shell:aiEmployeesChat', (_event, payload) => {
	for (const fn of aiEmployeesChatHandlers.values()) {
		try {
			fn(payload);
		} catch (e) {
			console.error(e);
		}
	}
});

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

ipcRenderer.on('async-shell:appearanceUi', (_event, payload) => {
	for (const fn of appearanceUiHandlers.values()) {
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

ipcRenderer.on('async-shell:aiEmployeesWorkspace', (_event, payload) => {
	const root =
		payload && typeof payload === 'object' && 'workspaceRoot' in payload
			? String((/** @type {{ workspaceRoot?: string }} */ (payload)).workspaceRoot ?? '')
			: '';
	for (const fn of aiEmployeesWorkspaceHandlers.values()) {
		try {
			fn(root);
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
	subscribeAppearanceUi(callback) {
		const id = ++appearanceUiSeq;
		appearanceUiHandlers.set(id, callback);
		return () => appearanceUiHandlers.delete(id);
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
	subscribeAiEmployeesWorkspace(callback) {
		const id = ++aiEmployeesWorkspaceSeq;
		aiEmployeesWorkspaceHandlers.set(id, callback);
		return () => aiEmployeesWorkspaceHandlers.delete(id);
	},
	subscribeAiEmployeesChat(callback) {
		const id = ++aiEmployeesChatSeq;
		aiEmployeesChatHandlers.set(id, callback);
		return () => aiEmployeesChatHandlers.delete(id);
	},
	subscribeAutoUpdateStatus(callback) {
		const id = ++autoUpdateStatusSeq;
		autoUpdateStatusHandlers.set(id, callback);
		return () => autoUpdateStatusHandlers.delete(id);
	},
});
