/** Universal Terminal 用户设置；纯前端，localStorage 持久化，不走 settings.json。 */

export type TerminalCursorStyle = 'bar' | 'block' | 'underline';
export type TerminalBellStyle = 'none' | 'visual' | 'audible';
export type TerminalRightClickAction = 'off' | 'menu' | 'paste' | 'clipboard';
export type TerminalDisplayPresetId = 'compact' | 'balanced' | 'presentation';
export type TerminalSshAuthMode = 'auto' | 'password' | 'publicKey' | 'agent' | 'keyboardInteractive';
export type TerminalProfileSessionEndBehavior = 'auto' | 'keep' | 'reconnect' | 'close';
export type TerminalInputBackspaceMode = 'backspace' | 'ctrl-h' | 'ctrl-?' | 'delete';
export type TerminalPortForwardType = 'local' | 'remote' | 'dynamic';

export type TerminalColorScheme = {
	id: string;
	name: string;
	foreground: string;
	background: string;
	cursor: string;
	cursorAccent?: string;
	selection?: string;
	colors: string[];
};

export type TerminalLoginScript = {
	expect: string;
	send: string;
	isRegex: boolean;
	optional: boolean;
};

export type TerminalPortForward = {
	id: string;
	type: TerminalPortForwardType;
	host: string;
	port: number;
	targetAddress: string;
	targetPort: number;
	description: string;
};

export type TerminalSshAlgorithms = {
	cipher: string[];
	kex: string[];
	hmac: string[];
	serverHostKey: string[];
	compression: string[];
};

/** 本地 Shell 或通过 SSH 的远程会话（由 ssh 作为 pty 子进程）。 */
export type TerminalProfileKind = 'local' | 'ssh';

export type TerminalProfile = {
	id: string;
	name: string;
	group: string;
	icon: string;
	color: string;
	disableDynamicTitle: boolean;
	behaviorOnSessionEnd: TerminalProfileSessionEndBehavior;
	clearServiceMessagesOnConnect: boolean;
	terminalColorSchemeId: string;
	loginScripts: TerminalLoginScript[];
	inputBackspace: TerminalInputBackspaceMode;
	builtinKey?: string;
	kind: TerminalProfileKind;
	/** SSH：主机名或 IP。 */
	sshHost: string;
	/** SSH：端口，默认 22。 */
	sshPort: number;
	/** SSH：登录用户名。 */
	sshUser: string;
	/** SSH：兼容旧配置的首个私钥路径。 */
	sshIdentityFile: string;
	/** SSH：私钥列表。 */
	sshIdentityFiles: string[];
	/** SSH：认证方式偏好。 */
	sshAuthMode: TerminalSshAuthMode;
	/** SSH：ProxyCommand。 */
	sshProxyCommand: string;
	/** SSH：Jump host，格式如 user@host 或 host。 */
	sshJumpHost: string;
	/** SSH：登录后在远端执行的命令（可选，空格分词，支持引号）。 */
	sshRemoteCommand: string;
	/** SSH：附加到 ssh 命令行的参数（在 -tt 之后、-i 之前插入，如 -o ServerAliveInterval=30）。 */
	sshExtraArgs: string;
	/** SSH：keep alive 间隔（秒，0 表示禁用）。 */
	sshKeepAliveInterval: number;
	/** SSH：keep alive 最大重试次数。 */
	sshKeepAliveCountMax: number;
	/** SSH：ready timeout（毫秒）。 */
	sshReadyTimeout: number;
	/** SSH：跳过 banner / MoTD。 */
	sshSkipBanner: boolean;
	/** SSH：转发端口。 */
	sshForwardedPorts: TerminalPortForward[];
	/** SSH：算法集。 */
	sshAlgorithms: TerminalSshAlgorithms;
	/** 为空 = 平台默认 shell。 */
	shell: string;
	/** 以空格分隔（支持 "..."/'...' 引号），为空 = 平台默认参数。 */
	args: string;
	/** 为空 = 工作区根 / 进程 cwd。支持相对路径（相对工作区根）或绝对路径。 */
	cwd: string;
	/** 每行一个 KEY=VAL。 */
	env: string;
};

export type TerminalAppSettings = {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	fontWeightBold: number;
	lineHeight: number;
	cursorStyle: TerminalCursorStyle;
	cursorBlink: boolean;
	scrollback: number;
	minimumContrastRatio: number;
	drawBoldTextInBrightColors: boolean;
	scrollOnInput: boolean;
	wordSeparator: string;
	copyOnSelect: boolean;
	rightClickAction: TerminalRightClickAction;
	pasteOnMiddleClick: boolean;
	bracketedPaste: boolean;
	warnOnMultilinePaste: boolean;
	trimWhitespaceOnPaste: boolean;
	bell: TerminalBellStyle;
	autoOpen: boolean;
	restoreTabs: boolean;
	/** 0.6–1.0；应用到终端内容面板背景色的不透明度（露出窗口的渐变背景）。 */
	opacity: number;
	profiles: TerminalProfile[];
	defaultProfileId: string;
};

export const DEFAULT_PROFILE_ID = 'default';
export const BUILTIN_PROFILE_PREFIX = 'builtin:';
export const STORAGE_KEY = 'void-shell:terminal:settings';
export const TERMINAL_SETTINGS_CHANGED_EVENT = 'async:terminal-settings-changed';
export const DEFAULT_TERMINAL_WORD_SEPARATOR = ` ()[]{}'",`;

export const FONT_FAMILY_CHOICES: { label: string; value: string }[] = [
	{ label: 'JetBrains Mono', value: 'JetBrains Mono, Consolas, monospace' },
	{ label: 'Cascadia Code', value: '"Cascadia Code", Consolas, monospace' },
	{ label: 'Fira Code', value: '"Fira Code", Consolas, monospace' },
	{ label: 'Consolas', value: 'Consolas, monospace' },
	{ label: 'SF Mono', value: '"SF Mono", Menlo, monospace' },
	{ label: 'Menlo', value: 'Menlo, Monaco, monospace' },
	{ label: 'Courier New', value: '"Courier New", monospace' },
];

export const TERMINAL_COLOR_SCHEMES: TerminalColorScheme[] = [
	{
		id: 'tabby-default',
		name: 'Default',
		foreground: '#cacaca',
		background: '#171717',
		cursor: '#bbbbbb',
		colors: ['#000000', '#ff615a', '#b1e969', '#ebd99c', '#5da9f6', '#e86aff', '#82fff7', '#dedacf', '#313131', '#f58c80', '#ddf88f', '#eee5b2', '#a5c7ff', '#ddaaff', '#b7fff9', '#ffffff'],
	},
	{
		id: 'tabby-default-light',
		name: 'Default Light',
		foreground: '#4d4d4c',
		background: '#ffffff',
		cursor: '#4d4d4c',
		colors: ['#000000', '#c82829', '#718c00', '#eab700', '#4271ae', '#8959a8', '#3e999f', '#ffffff', '#000000', '#c82829', '#718c00', '#eab700', '#4271ae', '#8959a8', '#3e999f', '#ffffff'],
	},
	{
		id: 'drift',
		name: 'Drift',
		foreground: '#d8dbe2',
		background: '#10161d',
		cursor: '#7dd3fc',
		colors: ['#18212b', '#ff6b6b', '#98d8aa', '#ffd166', '#78a8ff', '#d7aefb', '#89ddff', '#d8dbe2', '#405264', '#ff9b9b', '#b7f3c3', '#ffe08c', '#a9c3ff', '#e8c8ff', '#b8f0ff', '#ffffff'],
	},
];

export const TERMINAL_SSH_ALGORITHM_OPTIONS: TerminalSshAlgorithms = {
	cipher: ['chacha20-poly1305@openssh.com', 'aes256-gcm@openssh.com', 'aes256-ctr', 'aes192-ctr', 'aes128-ctr'],
	kex: ['mlkem768x25519-sha256', 'curve25519-sha256', 'curve25519-sha256@libssh.org', 'diffie-hellman-group16-sha512', 'diffie-hellman-group14-sha256'],
	hmac: ['hmac-sha2-512-etm@openssh.com', 'hmac-sha2-256-etm@openssh.com', 'hmac-sha2-512', 'hmac-sha2-256', 'hmac-sha1-etm@openssh.com', 'hmac-sha1'],
	serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp521', 'rsa-sha2-256', 'rsa-sha2-512', 'ssh-rsa'],
	compression: ['none', 'zlib@openssh.com', 'zlib'],
};

export function defaultTerminalSettings(): TerminalAppSettings {
	const behaviorDefaults = getPlatformTerminalBehaviorDefaults();
	return {
		fontFamily: FONT_FAMILY_CHOICES[0].value,
		fontSize: 13,
		fontWeight: 400,
		fontWeightBold: 700,
		lineHeight: 1.25,
		cursorStyle: 'bar',
		cursorBlink: true,
		scrollback: 4000,
		minimumContrastRatio: 1,
		drawBoldTextInBrightColors: true,
		scrollOnInput: true,
		wordSeparator: DEFAULT_TERMINAL_WORD_SEPARATOR,
		copyOnSelect: behaviorDefaults.copyOnSelect,
		rightClickAction: behaviorDefaults.rightClickAction,
		pasteOnMiddleClick: behaviorDefaults.pasteOnMiddleClick,
		bracketedPaste: true,
		warnOnMultilinePaste: true,
		trimWhitespaceOnPaste: true,
		bell: 'none',
		autoOpen: true,
		restoreTabs: true,
		opacity: 1,
		profiles: [
			{
				id: DEFAULT_PROFILE_ID,
				name: 'Default',
				group: '',
				icon: '',
				color: '#000000',
				disableDynamicTitle: false,
				behaviorOnSessionEnd: 'auto',
				clearServiceMessagesOnConnect: false,
				terminalColorSchemeId: '',
				loginScripts: [],
				inputBackspace: 'backspace',
				kind: 'local',
				sshHost: '',
				sshPort: 22,
				sshUser: '',
				sshIdentityFile: '',
				sshIdentityFiles: [],
				sshAuthMode: 'auto',
				sshProxyCommand: '',
				sshJumpHost: '',
				sshRemoteCommand: '',
				sshExtraArgs: '',
				sshKeepAliveInterval: 0,
				sshKeepAliveCountMax: 3,
				sshReadyTimeout: 20000,
				sshSkipBanner: false,
				sshForwardedPorts: [],
				sshAlgorithms: cloneSshAlgorithms(TERMINAL_SSH_ALGORITHM_OPTIONS),
				shell: '',
				args: '',
				cwd: '',
				env: '',
			},
		],
		defaultProfileId: DEFAULT_PROFILE_ID,
	};
}

export function normalizeTerminalSettings(raw: unknown): TerminalAppSettings {
	const def = defaultTerminalSettings();
	if (!raw || typeof raw !== 'object') {
		return def;
	}
	const obj = raw as Record<string, unknown>;
	const profilesRaw = Array.isArray(obj.profiles) ? (obj.profiles as unknown[]) : def.profiles;
	const profiles: TerminalProfile[] = profilesRaw
		.map((p, i) => {
			if (!p || typeof p !== 'object') {
				return null;
			}
			const po = p as Record<string, unknown>;
			const id = typeof po.id === 'string' && po.id.trim() ? po.id.trim() : `profile-${i}`;
			const kindRaw = po.kind;
			const kind: TerminalProfileKind = kindRaw === 'ssh' ? 'ssh' : 'local';
			return {
				id,
				name: typeof po.name === 'string' && po.name.trim() ? po.name : `Profile ${i + 1}`,
				group: typeof po.group === 'string' ? po.group : '',
				icon: typeof po.icon === 'string' ? po.icon : '',
				color: typeof po.color === 'string' && po.color.trim() ? po.color : '#000000',
				disableDynamicTitle: toBoolean(po.disableDynamicTitle, false),
				behaviorOnSessionEnd: normalizeSessionEndBehavior(po.behaviorOnSessionEnd),
				clearServiceMessagesOnConnect: toBoolean(po.clearServiceMessagesOnConnect, false),
				terminalColorSchemeId: normalizeColorSchemeId(po.terminalColorSchemeId),
				loginScripts: normalizeLoginScripts(po.loginScripts),
				inputBackspace: normalizeInputBackspace(po.inputBackspace),
				kind,
				sshHost: typeof po.sshHost === 'string' ? po.sshHost : '',
				sshPort: clamp(Math.floor(toNumber(po.sshPort, 22)), 1, 65535),
				sshUser: typeof po.sshUser === 'string' ? po.sshUser : '',
				sshIdentityFile: typeof po.sshIdentityFile === 'string' ? po.sshIdentityFile : '',
				sshIdentityFiles: normalizeIdentityFiles(
					Array.isArray(po.sshIdentityFiles) ? po.sshIdentityFiles : [],
					typeof po.sshIdentityFile === 'string' ? po.sshIdentityFile : ''
				),
				sshAuthMode: normalizeSshAuthMode(po.sshAuthMode),
				sshProxyCommand: typeof po.sshProxyCommand === 'string' ? po.sshProxyCommand : '',
				sshJumpHost: typeof po.sshJumpHost === 'string' ? po.sshJumpHost : '',
				sshRemoteCommand: typeof po.sshRemoteCommand === 'string' ? po.sshRemoteCommand : '',
				sshExtraArgs: typeof po.sshExtraArgs === 'string' ? po.sshExtraArgs : '',
				sshKeepAliveInterval: clamp(Math.floor(toNumber(po.sshKeepAliveInterval, 0)), 0, 86_400),
				sshKeepAliveCountMax: clamp(Math.floor(toNumber(po.sshKeepAliveCountMax, 3)), 1, 20),
				sshReadyTimeout: clamp(Math.floor(toNumber(po.sshReadyTimeout, 20_000)), 1_000, 600_000),
				sshSkipBanner: toBoolean(po.sshSkipBanner, false),
				sshForwardedPorts: normalizeForwardedPorts(po.sshForwardedPorts),
				sshAlgorithms: normalizeSshAlgorithms(po.sshAlgorithms),
				shell: typeof po.shell === 'string' ? po.shell : '',
				args: typeof po.args === 'string' ? po.args : '',
				cwd: typeof po.cwd === 'string' ? po.cwd : '',
				env: typeof po.env === 'string' ? po.env : '',
			};
		})
		.filter((v): v is TerminalProfile => Boolean(v));
	const effectiveProfiles = profiles.length ? profiles : def.profiles;
	const rawDefaultProfileId = typeof obj.defaultProfileId === 'string' ? obj.defaultProfileId : '';
	const validDefaultProfileIds = new Set([
		...effectiveProfiles.map((profile) => profile.id),
		...getBuiltinTerminalProfiles().map((profile) => profile.id),
	]);
	const defaultProfileId =
		rawDefaultProfileId && (validDefaultProfileIds.has(rawDefaultProfileId) || isBuiltinTerminalProfileId(rawDefaultProfileId))
			? rawDefaultProfileId
			: effectiveProfiles[0].id;
	const cursor = obj.cursorStyle;
	const bell = obj.bell;
	const legacyRightClickPaste = obj.rightClickPaste;
	const rawRightClickAction = obj.rightClickAction;
	return {
		fontFamily: typeof obj.fontFamily === 'string' && obj.fontFamily.trim() ? obj.fontFamily : def.fontFamily,
		fontSize: clamp(toNumber(obj.fontSize, def.fontSize), 8, 32),
		fontWeight: snapFontWeight(toNumber(obj.fontWeight, def.fontWeight)),
		fontWeightBold: snapFontWeight(toNumber(obj.fontWeightBold, def.fontWeightBold)),
		lineHeight: clamp(toNumber(obj.lineHeight, def.lineHeight), 1, 2.4),
		cursorStyle: cursor === 'block' || cursor === 'underline' || cursor === 'bar' ? cursor : def.cursorStyle,
		cursorBlink: toBoolean(obj.cursorBlink, def.cursorBlink),
		scrollback: clamp(Math.floor(toNumber(obj.scrollback, def.scrollback)), 100, 100_000),
		minimumContrastRatio: clamp(toNumber(obj.minimumContrastRatio, def.minimumContrastRatio), 1, 21),
		drawBoldTextInBrightColors: toBoolean(obj.drawBoldTextInBrightColors, def.drawBoldTextInBrightColors),
		scrollOnInput: toBoolean(obj.scrollOnInput, def.scrollOnInput),
		wordSeparator:
			typeof obj.wordSeparator === 'string' && obj.wordSeparator.length > 0
				? obj.wordSeparator
				: def.wordSeparator,
		copyOnSelect: toBoolean(obj.copyOnSelect, def.copyOnSelect),
		rightClickAction:
			rawRightClickAction === 'off' ||
			rawRightClickAction === 'menu' ||
			rawRightClickAction === 'paste' ||
			rawRightClickAction === 'clipboard'
				? rawRightClickAction
				: legacyRightClickPaste === false
					? 'off'
					: def.rightClickAction,
		pasteOnMiddleClick: toBoolean(obj.pasteOnMiddleClick, def.pasteOnMiddleClick),
		bracketedPaste: toBoolean(obj.bracketedPaste, def.bracketedPaste),
		warnOnMultilinePaste: toBoolean(obj.warnOnMultilinePaste, def.warnOnMultilinePaste),
		trimWhitespaceOnPaste: toBoolean(obj.trimWhitespaceOnPaste, def.trimWhitespaceOnPaste),
		bell: bell === 'visual' || bell === 'audible' ? bell : 'none',
		autoOpen: toBoolean(obj.autoOpen, def.autoOpen),
		restoreTabs: toBoolean(obj.restoreTabs, def.restoreTabs),
		opacity: clamp(toNumber(obj.opacity, def.opacity), 0.5, 1),
		profiles: effectiveProfiles,
		defaultProfileId,
	};
}

export function loadTerminalSettings(): TerminalAppSettings {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return defaultTerminalSettings();
		}
		return normalizeTerminalSettings(JSON.parse(raw));
	} catch {
		return defaultTerminalSettings();
	}
}

export function saveTerminalSettings(s: TerminalAppSettings): void {
	try {
		const next = normalizeTerminalSettings(s);
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		emitTerminalSettingsChanged(next);
	} catch {
		/* ignore */
	}
}

export function subscribeTerminalSettings(listener: () => void): () => void {
	if (typeof window === 'undefined') {
		return () => {};
	}
	const onStorage = (event: StorageEvent) => {
		if (!event.key || event.key === STORAGE_KEY) {
			listener();
		}
	};
	const onChanged = () => listener();
	window.addEventListener('storage', onStorage);
	window.addEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, onChanged);
	return () => {
		window.removeEventListener('storage', onStorage);
		window.removeEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, onChanged);
	};
}

export function newProfileId(existing: TerminalProfile[]): string {
	let n = existing.length + 1;
	const ids = new Set(existing.map((p) => p.id));
	while (ids.has(`profile-${n}`)) {
		n += 1;
	}
	return `profile-${n}`;
}

export function cloneTerminalProfile(existing: TerminalProfile[], profile: TerminalProfile): TerminalProfile {
	return {
		...profile,
		builtinKey: undefined,
		sshIdentityFiles: [...getSshIdentityFiles(profile)],
		loginScripts: normalizeLoginScripts(profile.loginScripts),
		sshForwardedPorts: normalizeForwardedPorts(profile.sshForwardedPorts),
		sshAlgorithms: normalizeSshAlgorithms(profile.sshAlgorithms),
		terminalColorSchemeId: normalizeColorSchemeId(profile.terminalColorSchemeId),
		inputBackspace: normalizeInputBackspace(profile.inputBackspace),
		id: newProfileId(existing),
		name: `${profile.name.trim() || 'Profile'} Copy`,
	};
}

export function resetTerminalProfile(profile: TerminalProfile): TerminalProfile {
	return {
		...defaultTerminalSettings().profiles[0],
		id: profile.id,
		name: profile.name,
		group: profile.group,
		kind: profile.kind,
		sshIdentityFiles: [],
		loginScripts: [],
		sshForwardedPorts: [],
		sshAlgorithms: cloneSshAlgorithms(TERMINAL_SSH_ALGORITHM_OPTIONS),
	};
}

export function countTerminalProfileEnvEntries(profile: TerminalProfile): number {
	return Object.keys(parseEnvString(profile.env) ?? {}).length;
}

export function buildTerminalProfileTarget(profile: TerminalProfile): string {
	if (profile.kind === 'ssh') {
		const user = profile.sshUser.trim();
		const host = profile.sshHost.trim();
		if (!user && !host) {
			return 'SSH';
		}
		const target = [user, host].filter(Boolean).join('@');
		return profile.sshPort && profile.sshPort !== 22 ? `${target}:${profile.sshPort}` : target;
	}
	return profile.shell.trim();
}

export function buildTerminalProfileLaunchPreview(profile: TerminalProfile): string {
	if (profile.kind === 'ssh') {
		return ['ssh', ...buildSshArgs(profile)].join(' ').trim() || 'ssh';
	}
	const shell = profile.shell.trim() || 'system shell';
	const args = parseArgsString(profile.args);
	return [shell, ...args].join(' ').trim();
}

export function applyTerminalDisplayPreset(
	settings: TerminalAppSettings,
	presetId: TerminalDisplayPresetId
): TerminalAppSettings {
	switch (presetId) {
		case 'compact':
			return normalizeTerminalSettings({
				...settings,
				fontSize: 12,
				fontWeight: 400,
				fontWeightBold: 700,
				lineHeight: 1.12,
				minimumContrastRatio: 4,
				scrollback: 3000,
				opacity: 1,
			});
		case 'presentation':
			return normalizeTerminalSettings({
				...settings,
				fontSize: 15,
				fontWeight: 500,
				fontWeightBold: 800,
				lineHeight: 1.35,
				minimumContrastRatio: 7,
				scrollback: 8000,
				opacity: 0.96,
			});
		case 'balanced':
		default:
			return normalizeTerminalSettings({
				...settings,
				fontSize: 13,
				fontWeight: 400,
				fontWeightBold: 700,
				lineHeight: 1.25,
				minimumContrastRatio: 5,
				scrollback: 4000,
				opacity: 1,
			});
	}
}

/** 将 args 字符串按 shell 风格切分（支持 "..." / '...' 引号）。 */
export function parseArgsString(s: string): string[] {
	const trimmed = s.trim();
	if (!trimmed) {
		return [];
	}
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(trimmed))) {
		out.push(m[1] ?? m[2] ?? m[3] ?? '');
	}
	return out;
}

function isWindowsRenderer(): boolean {
	return readRendererPlatform() === 'win32';
}

/**
 * 根据配置生成 `term:sessionCreate` 的选项（本地 Shell 或 ssh）。SSH 缺少必填项时退回本地逻辑。
 */
export function buildTermSessionCreatePayload(profile: TerminalProfile): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (profile.name.trim()) {
		payload.title = profile.name.trim();
	}
	payload.profileId = profile.id;
	const env = parseEnvString(profile.env);
	if (env) {
		payload.env = env;
	}
	if (profile.cwd.trim()) {
		payload.cwd = profile.cwd.trim();
	}

	const sshReady =
		profile.kind === 'ssh' && profile.sshHost.trim().length > 0 && profile.sshUser.trim().length > 0;

	if (sshReady) {
		payload.sshAuthMode = profile.sshAuthMode;
		payload.shell = isWindowsRenderer() ? 'ssh.exe' : 'ssh';
		payload.args = buildSshArgs(profile);
		return payload;
	}

	if (profile.shell.trim()) {
		payload.shell = profile.shell.trim();
	}
	const a = parseArgsString(profile.args);
	if (a.length) {
		payload.args = a;
	}
	return payload;
}

export function buildSftpArgs(profile: TerminalProfile): string[] {
	return buildSshConnectionArgs(profile, {
		allocateTty: false,
		includeForwarding: false,
		includeRemoteCommand: false,
		portFlag: '-P',
	});
}

/** 每行 KEY=VAL；返回 undefined 表示没有自定义项。 */
export function parseEnvString(s: string): Record<string, string> | undefined {
	const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) {
		return undefined;
	}
	const env: Record<string, string> = {};
	for (const line of lines) {
		const eq = line.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = line.slice(0, eq).trim();
		if (!key) {
			continue;
		}
		env[key] = line.slice(eq + 1);
	}
	return Object.keys(env).length ? env : undefined;
}

export function getSshIdentityFiles(profile: Pick<TerminalProfile, 'sshIdentityFile' | 'sshIdentityFiles'>): string[] {
	return normalizeIdentityFiles(profile.sshIdentityFiles, profile.sshIdentityFile);
}

export function getTerminalColorSchemeById(colorSchemeId: string | null | undefined): TerminalColorScheme | null {
	if (!colorSchemeId) {
		return null;
	}
	return TERMINAL_COLOR_SCHEMES.find((scheme) => scheme.id === colorSchemeId) ?? null;
}

export function getBuiltinTerminalProfiles(): TerminalProfile[] {
	switch (readRendererPlatform()) {
		case 'win32':
			return [
				createBuiltinTerminalProfile('system-default', 'systemDefault', {
					name: 'System default',
				}),
				createBuiltinTerminalProfile('cmd', 'cmd', {
					name: 'Command Prompt',
					shell: 'cmd.exe',
					args: '/k chcp 65001>nul',
				}),
				createBuiltinTerminalProfile('powershell', 'powershell', {
					name: 'PowerShell',
					shell: 'powershell.exe',
					args: '-NoLogo',
				}),
				createBuiltinTerminalProfile('pwsh', 'pwsh', {
					name: 'PowerShell 7',
					shell: 'pwsh.exe',
					args: '-NoLogo',
				}),
				createBuiltinTerminalProfile('git-bash', 'gitBash', {
					name: 'Git Bash',
					shell: 'C:\\Program Files\\Git\\bin\\bash.exe',
					args: '--login -i',
				}),
				createBuiltinTerminalProfile('wsl', 'wsl', {
					name: 'WSL',
					shell: 'wsl.exe',
					env: 'TERM=xterm-color\nCOLORTERM=truecolor',
				}),
				createBuiltinTerminalProfile('ssh-template', 'sshConnection', {
					name: 'SSH connection',
					kind: 'ssh',
					sshUser: 'root',
				}),
			];
		case 'darwin':
			return [
				createBuiltinTerminalProfile('system-default', 'systemDefault', {
					name: 'System default',
				}),
				createBuiltinTerminalProfile('zsh', 'zsh', {
					name: 'zsh',
					shell: '/bin/zsh',
				}),
				createBuiltinTerminalProfile('bash', 'bash', {
					name: 'bash',
					shell: '/bin/bash',
				}),
				createBuiltinTerminalProfile('ssh-template', 'sshConnection', {
					name: 'SSH connection',
					kind: 'ssh',
					sshUser: 'root',
				}),
			];
		case 'linux':
		default:
			return [
				createBuiltinTerminalProfile('system-default', 'systemDefault', {
					name: 'System default',
				}),
				createBuiltinTerminalProfile('bash', 'bash', {
					name: 'bash',
					shell: '/bin/bash',
				}),
				createBuiltinTerminalProfile('zsh', 'zsh', {
					name: 'zsh',
					shell: '/bin/zsh',
				}),
				createBuiltinTerminalProfile('ssh-template', 'sshConnection', {
					name: 'SSH connection',
					kind: 'ssh',
					sshUser: 'root',
				}),
			];
	}
}

export function resolveTerminalProfile(
	customProfiles: TerminalProfile[],
	profileId: string | null | undefined,
	builtinProfiles: TerminalProfile[] = getBuiltinTerminalProfiles()
): TerminalProfile | null {
	if (!profileId) {
		return customProfiles[0] ?? builtinProfiles[0] ?? null;
	}
	return (
		customProfiles.find((profile) => profile.id === profileId) ??
		builtinProfiles.find((profile) => profile.id === profileId) ??
		customProfiles[0] ??
		builtinProfiles[0] ??
		null
	);
}

export function isBuiltinTerminalProfileId(profileId: string): boolean {
	return profileId.startsWith(BUILTIN_PROFILE_PREFIX);
}

function getPlatformTerminalBehaviorDefaults(): Pick<
	TerminalAppSettings,
	'copyOnSelect' | 'rightClickAction' | 'pasteOnMiddleClick'
> {
	switch (readRendererPlatform()) {
		case 'win32':
			return {
				copyOnSelect: true,
				rightClickAction: 'clipboard',
				pasteOnMiddleClick: false,
			};
		case 'linux':
			return {
				copyOnSelect: false,
				rightClickAction: 'menu',
				pasteOnMiddleClick: false,
			};
		case 'darwin':
		default:
			return {
				copyOnSelect: false,
				rightClickAction: 'menu',
				pasteOnMiddleClick: true,
			};
	}
}

function createBuiltinTerminalProfile(
	idSuffix: string,
	builtinKey: string,
	partial: Partial<TerminalProfile>
): TerminalProfile {
	return {
		...defaultTerminalSettings().profiles[0],
		...partial,
		id: `${BUILTIN_PROFILE_PREFIX}${idSuffix}`,
		name: partial.name || idSuffix,
		builtinKey,
		kind: partial.kind === 'ssh' ? 'ssh' : 'local',
	};
}

function clamp(n: number, min: number, max: number): number {
	if (!Number.isFinite(n)) {
		return min;
	}
	return Math.min(Math.max(n, min), max);
}

function snapFontWeight(v: number): number {
	return Math.round(clamp(v, 100, 900) / 100) * 100;
}

function toNumber(v: unknown, fallback: number): number {
	if (typeof v === 'number' && Number.isFinite(v)) {
		return v;
	}
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	}
	return fallback;
}

function toBoolean(v: unknown, fallback: boolean): boolean {
	return typeof v === 'boolean' ? v : fallback;
}

function normalizeSshAuthMode(value: unknown): TerminalSshAuthMode {
	return value === 'password' ||
		value === 'publicKey' ||
		value === 'agent' ||
		value === 'keyboardInteractive'
		? value
		: 'auto';
}

function normalizeSessionEndBehavior(value: unknown): TerminalProfileSessionEndBehavior {
	return value === 'keep' || value === 'reconnect' || value === 'close' ? value : 'auto';
}

function normalizeInputBackspace(value: unknown): TerminalInputBackspaceMode {
	return value === 'ctrl-h' || value === 'ctrl-?' || value === 'delete' ? value : 'backspace';
}

function normalizeColorSchemeId(value: unknown): string {
	const next = typeof value === 'string' ? value.trim() : '';
	return next && TERMINAL_COLOR_SCHEMES.some((scheme) => scheme.id === next) ? next : '';
}

function normalizeLoginScripts(value: unknown): TerminalLoginScript[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => {
			if (!item || typeof item !== 'object') {
				return null;
			}
			const record = item as Record<string, unknown>;
			return {
				expect: typeof record.expect === 'string' ? record.expect : '',
				send: typeof record.send === 'string' ? record.send : '',
				isRegex: toBoolean(record.isRegex, false),
				optional: toBoolean(record.optional, false),
			} satisfies TerminalLoginScript;
		})
		.filter((item): item is TerminalLoginScript => Boolean(item));
}

function normalizeForwardedPorts(value: unknown): TerminalPortForward[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item, index) => {
			if (!item || typeof item !== 'object') {
				return null;
			}
			const record = item as Record<string, unknown>;
			const type = normalizePortForwardType(record.type);
			return {
				id: typeof record.id === 'string' && record.id.trim() ? record.id : `forward-${index + 1}`,
				type,
				host: typeof record.host === 'string' && record.host.trim() ? record.host : '127.0.0.1',
				port: clamp(Math.floor(toNumber(record.port, 0)), 0, 65535),
				targetAddress:
					typeof record.targetAddress === 'string' && record.targetAddress.trim()
						? record.targetAddress
						: '127.0.0.1',
				targetPort: clamp(Math.floor(toNumber(record.targetPort, 0)), 0, 65535),
				description: typeof record.description === 'string' ? record.description : '',
			} satisfies TerminalPortForward;
		})
		.filter((item): item is TerminalPortForward => Boolean(item));
}

function normalizePortForwardType(value: unknown): TerminalPortForwardType {
	return value === 'remote' || value === 'dynamic' ? value : 'local';
}

function normalizeSshAlgorithms(value: unknown): TerminalSshAlgorithms {
	const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		cipher: normalizeAlgorithmList(source.cipher, TERMINAL_SSH_ALGORITHM_OPTIONS.cipher),
		kex: normalizeAlgorithmList(source.kex, TERMINAL_SSH_ALGORITHM_OPTIONS.kex),
		hmac: normalizeAlgorithmList(source.hmac, TERMINAL_SSH_ALGORITHM_OPTIONS.hmac),
		serverHostKey: normalizeAlgorithmList(source.serverHostKey, TERMINAL_SSH_ALGORITHM_OPTIONS.serverHostKey),
		compression: normalizeAlgorithmList(source.compression, TERMINAL_SSH_ALGORITHM_OPTIONS.compression),
	};
}

function normalizeAlgorithmList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) {
		return [...fallback];
	}
	const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
	return items.length ? items : [...fallback];
}

function cloneSshAlgorithms(algorithms: TerminalSshAlgorithms): TerminalSshAlgorithms {
	return {
		cipher: [...algorithms.cipher],
		kex: [...algorithms.kex],
		hmac: [...algorithms.hmac],
		serverHostKey: [...algorithms.serverHostKey],
		compression: [...algorithms.compression],
	};
}

function normalizeIdentityFiles(value: unknown, fallback = ''): string[] {
	const files = Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
	if (typeof fallback === 'string' && fallback.trim()) {
		files.push(fallback);
	}
	const unique = new Set<string>();
	for (const item of files) {
		const next = item.trim();
		if (next) {
			unique.add(next);
		}
	}
	return Array.from(unique);
}

function buildSshArgs(profile: TerminalProfile): string[] {
	return buildSshConnectionArgs(profile, {
		allocateTty: true,
		includeForwarding: true,
		includeRemoteCommand: true,
		portFlag: '-p',
	});
}

function buildSshConnectionArgs(
	profile: TerminalProfile,
	options: {
		allocateTty: boolean;
		includeForwarding: boolean;
		includeRemoteCommand: boolean;
		portFlag: '-p' | '-P';
	}
): string[] {
	const args: string[] = options.allocateTty ? ['-tt'] : [];
	args.push(...parseArgsString(profile.sshExtraArgs));

	switch (profile.sshAuthMode) {
		case 'password':
			args.push('-o', 'PreferredAuthentications=password');
			break;
		case 'publicKey':
		case 'agent':
			args.push('-o', 'PreferredAuthentications=publickey');
			break;
		case 'keyboardInteractive':
			args.push('-o', 'PreferredAuthentications=keyboard-interactive');
			break;
		default:
			break;
	}

	if (profile.sshProxyCommand.trim()) {
		args.push('-o', `ProxyCommand=${profile.sshProxyCommand.trim()}`);
	}
	if (profile.sshJumpHost.trim()) {
		args.push('-J', profile.sshJumpHost.trim());
	}
	if (profile.sshKeepAliveInterval > 0) {
		args.push('-o', `ServerAliveInterval=${profile.sshKeepAliveInterval}`);
	}
	if (profile.sshKeepAliveInterval > 0 && profile.sshKeepAliveCountMax > 0) {
		args.push('-o', `ServerAliveCountMax=${profile.sshKeepAliveCountMax}`);
	}
	if (profile.sshReadyTimeout > 0 && profile.sshReadyTimeout !== 20_000) {
		args.push('-o', `ConnectTimeout=${Math.max(1, Math.floor(profile.sshReadyTimeout / 1000))}`);
	}
	if (profile.sshSkipBanner) {
		args.push('-q');
	}

	appendSshAlgorithmArgs(args, profile.sshAlgorithms);
	if (options.includeForwarding) {
		appendSshForwardingArgs(args, profile.sshForwardedPorts);
	}

	for (const identity of getSshIdentityFiles(profile)) {
		args.push('-i', identity);
	}

	if (profile.sshPort && profile.sshPort !== 22) {
		args.push(options.portFlag, String(profile.sshPort));
	}

	const target = [profile.sshUser.trim(), profile.sshHost.trim()].filter(Boolean).join('@');
	if (target) {
		args.push(target);
	}

	if (options.includeRemoteCommand) {
		args.push(...parseArgsString(profile.sshRemoteCommand));
	}
	return args;
}

function appendSshAlgorithmArgs(args: string[], algorithms: TerminalSshAlgorithms): void {
	if (algorithms.cipher.length && !matchesAlgorithmDefault(algorithms.cipher, TERMINAL_SSH_ALGORITHM_OPTIONS.cipher)) {
		args.push('-o', `Ciphers=${algorithms.cipher.join(',')}`);
	}
	if (algorithms.kex.length && !matchesAlgorithmDefault(algorithms.kex, TERMINAL_SSH_ALGORITHM_OPTIONS.kex)) {
		args.push('-o', `KexAlgorithms=${algorithms.kex.join(',')}`);
	}
	if (algorithms.hmac.length && !matchesAlgorithmDefault(algorithms.hmac, TERMINAL_SSH_ALGORITHM_OPTIONS.hmac)) {
		args.push('-o', `MACs=${algorithms.hmac.join(',')}`);
	}
	if (
		algorithms.serverHostKey.length &&
		!matchesAlgorithmDefault(algorithms.serverHostKey, TERMINAL_SSH_ALGORITHM_OPTIONS.serverHostKey)
	) {
		args.push('-o', `HostKeyAlgorithms=${algorithms.serverHostKey.join(',')}`);
	}
	if (
		algorithms.compression.length &&
		!matchesAlgorithmDefault(algorithms.compression, TERMINAL_SSH_ALGORITHM_OPTIONS.compression)
	) {
		const first = algorithms.compression[0];
		args.push('-o', `Compression=${first === 'none' ? 'no' : 'yes'}`);
	}
}

function appendSshForwardingArgs(args: string[], forwards: TerminalPortForward[]): void {
	for (const forward of forwards) {
		if (forward.type === 'dynamic' && forward.port > 0) {
			args.push('-D', `${forward.host || '127.0.0.1'}:${forward.port}`);
			continue;
		}
		if (forward.port <= 0 || forward.targetPort <= 0) {
			continue;
		}
		const source = `${forward.host || '127.0.0.1'}:${forward.port}`;
		const target = `${forward.targetAddress || '127.0.0.1'}:${forward.targetPort}`;
		if (forward.type === 'remote') {
			args.push('-R', `${source}:${target}`);
		} else {
			args.push('-L', `${source}:${target}`);
		}
	}
}

function matchesAlgorithmDefault(items: string[], defaults: string[]): boolean {
	return items.length === defaults.length && items.every((item, index) => item === defaults[index]);
}

function readRendererPlatform(): 'win32' | 'darwin' | 'linux' | 'unknown' {
	if (typeof document !== 'undefined') {
		const platform = document.documentElement.getAttribute('data-platform');
		if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
			return platform;
		}
	}
	if (typeof navigator !== 'undefined') {
		const raw = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
		if (raw.includes('mac')) {
			return 'darwin';
		}
		if (raw.includes('win')) {
			return 'win32';
		}
		if (raw.includes('linux')) {
			return 'linux';
		}
	}
	return 'unknown';
}

function emitTerminalSettingsChanged(settings: TerminalAppSettings): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		window.dispatchEvent(
			new CustomEvent(TERMINAL_SETTINGS_CHANGED_EVENT, {
				detail: settings,
			})
		);
	} catch {
		/* ignore */
	}
}
