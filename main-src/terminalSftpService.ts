import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shell } from 'electron';
import SftpClient from 'ssh2-sftp-client';
import { getTerminalProfilePassword } from './terminalProfileSecrets.js';

const {
	SUPPORTED_CIPHER,
	SUPPORTED_COMPRESSION,
	SUPPORTED_KEX,
	SUPPORTED_MAC,
	SUPPORTED_SERVER_HOST_KEY,
} = require('ssh2/lib/protocol/constants');

export type TerminalSftpProfileSnapshot = {
	id: string;
	name?: string;
	kind: 'local' | 'ssh';
	sshHost: string;
	sshPort: number;
	sshUser: string;
	sshIdentityFile?: string;
	sshIdentityFiles?: string[];
	sshAuthMode?: string;
	sshProxyCommand?: string;
	sshJumpHost?: string;
	sshReadyTimeout?: number;
	sshKeepAliveInterval?: number;
	sshKeepAliveCountMax?: number;
	sshAlgorithms?: {
		cipher?: string[];
		kex?: string[];
		hmac?: string[];
		serverHostKey?: string[];
		compression?: string[];
	};
};

export type TerminalSftpListEntry = {
	name: string;
	fullPath: string;
	type: string;
	size: number;
	modifyTime: number;
	rights?: {
		user?: string;
		group?: string;
		other?: string;
	};
};

type TerminalSftpConnection = {
	id: string;
	client: SftpClient;
	profile: TerminalSftpProfileSnapshot;
	editSessionIds: Set<string>;
};

type TerminalSftpEditSession = {
	id: string;
	connectionId: string;
	remotePath: string;
	localPath: string;
	mode: number | null;
	watcher: FSWatcher;
	timer: NodeJS.Timeout | null;
};

const connections = new Map<string, TerminalSftpConnection>();
const editSessions = new Map<string, TerminalSftpEditSession>();
const SUPPORTED_SFTP_ALGORITHMS = {
	cipher: new Set<string>(SUPPORTED_CIPHER),
	kex: new Set<string>(SUPPORTED_KEX),
	hmac: new Set<string>(SUPPORTED_MAC),
	serverHostKey: new Set<string>(SUPPORTED_SERVER_HOST_KEY),
	compression: new Set<string>(SUPPORTED_COMPRESSION),
} as const;

export async function openTerminalSftpConnection(
	profile: TerminalSftpProfileSnapshot,
	options?: { passwordOverride?: string | null }
): Promise<
	| { ok: true; connectionId: string; initialPath: string }
	| { ok: false; error: string; authRequired?: { kind: 'password' | 'passphrase'; prompt: string } }
> {
	if (!profile || profile.kind !== 'ssh') {
		return { ok: false, error: 'SFTP 仅支持 SSH 连接。' };
	}
	if (profile.sshProxyCommand?.trim()) {
		return { ok: false, error: '当前 SFTP 面板暂不支持 ProxyCommand。' };
	}
	if (profile.sshJumpHost?.trim()) {
		return { ok: false, error: '当前 SFTP 面板暂不支持 Jump host。' };
	}

	const password = options?.passwordOverride?.trim() || getTerminalProfilePassword(profile.id) || '';
	const identityFile = resolveIdentityFile(profile);
	const agent = resolveAgentPath();
	const missingAuthState = resolveMissingAuthState(profile, password, identityFile, agent);
	if (missingAuthState === 'missing-public-key') {
		return { ok: false, error: '当前 SSH 配置没有可用的私钥文件。' };
	}
	if (missingAuthState === 'missing-agent') {
		return { ok: false, error: '当前 SSH 配置需要 SSH agent，但系统没有可用的 agent。' };
	}
	if (missingAuthState) {
		return {
			ok: false,
			error: '需要密码',
			authRequired: {
				kind: missingAuthState,
				prompt: buildAuthPromptText(missingAuthState, profile),
			},
		};
	}

	const client = new SftpClient(`async-sftp:${profile.sshUser}@${profile.sshHost}`);
	try {
		await client.connect(buildConnectionConfig(profile, identityFile, password, agent));
		const initialPath = normalizeRemotePath((await client.cwd().catch(() => '/')) || '/');
		const connectionId = randomUUID();
		connections.set(connectionId, {
			id: connectionId,
			client,
			profile,
			editSessionIds: new Set(),
		});
		return { ok: true, connectionId, initialPath };
	} catch (error) {
		await safeEnd(client);
		const message = error instanceof Error ? error.message : String(error);
		if (isAuthenticationError(message)) {
			const authKind = identityFile && (profile.sshAuthMode === 'publicKey' || profile.sshAuthMode === 'auto') ? 'passphrase' : 'password';
			return {
				ok: false,
				error: message,
				authRequired: {
					kind: authKind,
					prompt: buildAuthPromptText(authKind, profile),
				},
			};
		}
		return { ok: false, error: message };
	}
}

export async function closeTerminalSftpConnection(connectionId: string): Promise<boolean> {
	const connection = connections.get(connectionId);
	if (!connection) {
		return false;
	}
	for (const editSessionId of connection.editSessionIds) {
		closeEditSession(editSessionId);
	}
	connections.delete(connectionId);
	await safeEnd(connection.client);
	return true;
}

export async function listTerminalSftpDirectory(
	connectionId: string,
	remotePath: string
): Promise<TerminalSftpListEntry[]> {
	const connection = requireConnection(connectionId);
	const targetPath = normalizeRemotePath(remotePath);
	const entries = (await connection.client.list(targetPath)) as Array<Record<string, unknown>>;
	return entries.map((entry) => mapListEntry(targetPath, entry));
}

export async function statTerminalSftpPath(
	connectionId: string,
	remotePath: string
): Promise<TerminalSftpListEntry> {
	const connection = requireConnection(connectionId);
	const targetPath = normalizeRemotePath(remotePath);
	const stats = (await connection.client.stat(targetPath)) as Record<string, unknown>;
	const type = inferStatType(stats);
	return {
		name: basenameRemote(targetPath),
		fullPath: targetPath,
		type,
		size: numericOrZero(stats.size),
		modifyTime: numericOrZero(stats.modifyTime),
		rights: mapRights(stats),
	};
}

export async function resolveTerminalSftpRealPath(connectionId: string, remotePath: string): Promise<string> {
	const connection = requireConnection(connectionId);
	const targetPath = normalizeRemotePath(remotePath);
	const resolved = await connection.client.realPath(targetPath);
	return normalizeRemotePath(resolved || targetPath);
}

export async function createTerminalSftpDirectory(connectionId: string, remotePath: string): Promise<void> {
	const connection = requireConnection(connectionId);
	await connection.client.mkdir(normalizeRemotePath(remotePath), false);
}

export async function deleteTerminalSftpPath(connectionId: string, remotePath: string, recursive = false): Promise<void> {
	const connection = requireConnection(connectionId);
	const targetPath = normalizeRemotePath(remotePath);
	const stats = (await connection.client.lstat(targetPath)) as Record<string, unknown>;
	if (Boolean(stats.isDirectory)) {
		await connection.client.rmdir(targetPath, recursive);
		return;
	}
	await connection.client.delete(targetPath, true);
}

export async function renameTerminalSftpPath(
	connectionId: string,
	fromPath: string,
	toPath: string
): Promise<void> {
	const connection = requireConnection(connectionId);
	await connection.client.posixRename(normalizeRemotePath(fromPath), normalizeRemotePath(toPath));
}

export async function uploadTerminalSftpFile(
	connectionId: string,
	localPath: string,
	remotePath: string
): Promise<void> {
	const connection = requireConnection(connectionId);
	await ensureLocalFile(localPath);
	await connection.client.put(localPath, normalizeRemotePath(remotePath));
}

export async function uploadTerminalSftpDirectory(
	connectionId: string,
	localPath: string,
	remotePath: string
): Promise<void> {
	const connection = requireConnection(connectionId);
	await ensureLocalDirectory(localPath);
	await connection.client.uploadDir(localPath, normalizeRemotePath(remotePath));
}

export async function downloadTerminalSftpFile(
	connectionId: string,
	remotePath: string,
	localPath: string
): Promise<void> {
	const connection = requireConnection(connectionId);
	mkdirSync(path.dirname(localPath), { recursive: true });
	await connection.client.get(normalizeRemotePath(remotePath), localPath);
}

export async function downloadTerminalSftpDirectory(
	connectionId: string,
	remotePath: string,
	localPath: string
): Promise<void> {
	const connection = requireConnection(connectionId);
	mkdirSync(localPath, { recursive: true });
	await connection.client.downloadDir(normalizeRemotePath(remotePath), localPath);
}

export async function startTerminalSftpEditSession(
	connectionId: string,
	remotePath: string,
	mode?: number | null
): Promise<{ localPath: string }> {
	const connection = requireConnection(connectionId);
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'async-sftp-edit-'));
	const localPath = path.join(tempRoot, basenameRemote(remotePath));
	await downloadTerminalSftpFile(connectionId, remotePath, localPath);
	await shell.openPath(localPath);

	const editSessionId = randomUUID();
	const editSession: TerminalSftpEditSession = {
		id: editSessionId,
		connectionId,
		remotePath: normalizeRemotePath(remotePath),
		localPath,
		mode: typeof mode === 'number' ? mode : null,
		watcher: watch(localPath, () => {
			scheduleEditSessionUpload(editSessionId);
		}),
		timer: null,
	};
	editSessions.set(editSessionId, editSession);
	connection.editSessionIds.add(editSessionId);
	return { localPath };
}

function scheduleEditSessionUpload(editSessionId: string): void {
	const editSession = editSessions.get(editSessionId);
	if (!editSession) {
		return;
	}
	if (editSession.timer) {
		clearTimeout(editSession.timer);
	}
	editSession.timer = setTimeout(async () => {
		const latest = editSessions.get(editSessionId);
		if (!latest) {
			return;
		}
		try {
			await uploadTerminalSftpFile(latest.connectionId, latest.localPath, latest.remotePath);
			if (latest.mode != null) {
				const connection = connections.get(latest.connectionId);
				await connection?.client.chmod(latest.remotePath, latest.mode);
			}
		} catch {
			/* ignore background sync failures */
		}
	}, 700);
}

function closeEditSession(editSessionId: string): void {
	const editSession = editSessions.get(editSessionId);
	if (!editSession) {
		return;
	}
	if (editSession.timer) {
		clearTimeout(editSession.timer);
	}
	try {
		editSession.watcher.close();
	} catch {
		/* ignore */
	}
	editSessions.delete(editSessionId);
	const connection = connections.get(editSession.connectionId);
	connection?.editSessionIds.delete(editSessionId);
}

function requireConnection(connectionId: string): TerminalSftpConnection {
	const connection = connections.get(connectionId);
	if (!connection) {
		throw new Error('SFTP 连接已断开，请重新打开面板。');
	}
	return connection;
}

function resolveIdentityFile(profile: TerminalSftpProfileSnapshot): string | null {
	const files = [...(Array.isArray(profile.sshIdentityFiles) ? profile.sshIdentityFiles : []), profile.sshIdentityFile || '']
		.map((item) => String(item || '').trim())
		.filter(Boolean);
	for (const file of files) {
		if (existsSync(file)) {
			return file;
		}
	}
	return null;
}

function resolveAgentPath(): string | undefined {
	const value = process.env.SSH_AUTH_SOCK?.trim();
	return value ? value : undefined;
}

function resolveMissingAuthState(
	profile: TerminalSftpProfileSnapshot,
	password: string,
	identityFile: string | null,
	agent: string | undefined
): 'password' | 'passphrase' | 'missing-public-key' | 'missing-agent' | null {
	if (password) {
		return null;
	}
	const mode = profile.sshAuthMode || 'auto';
	if (mode === 'password' || mode === 'keyboardInteractive') {
		return 'password';
	}
	if (mode === 'agent') {
		return agent ? null : 'missing-agent';
	}
	if (mode === 'publicKey') {
		if (identityFile) {
			return 'passphrase';
		}
		return agent ? null : 'missing-public-key';
	}
	return !identityFile && !agent ? 'password' : null;
}

function buildConnectionConfig(
	profile: TerminalSftpProfileSnapshot,
	identityFile: string | null,
	password: string,
	agent: string | undefined
): Record<string, unknown> {
	const algorithms = buildAlgorithms(profile.sshAlgorithms);
	const mode = profile.sshAuthMode || 'auto';
	const config: Record<string, unknown> = {
		host: profile.sshHost.trim(),
		port: profile.sshPort > 0 ? profile.sshPort : 22,
		username: profile.sshUser.trim(),
		readyTimeout: profile.sshReadyTimeout && profile.sshReadyTimeout > 0 ? profile.sshReadyTimeout : 20000,
		keepaliveInterval:
			profile.sshKeepAliveInterval && profile.sshKeepAliveInterval > 0 ? profile.sshKeepAliveInterval * 1000 : 0,
		keepaliveCountMax:
			profile.sshKeepAliveCountMax && profile.sshKeepAliveCountMax > 0 ? profile.sshKeepAliveCountMax : 3,
		tryKeyboard: mode === 'keyboardInteractive' || mode === 'auto',
	};
	if (Object.keys(algorithms).length > 0) {
		config.algorithms = algorithms;
	}
	if ((mode === 'agent' || mode === 'auto') && agent) {
		config.agent = agent;
	}
	if (identityFile) {
		config.privateKey = readFileSync(identityFile, 'utf8');
		if (password) {
			config.passphrase = password;
		}
	}
	if ((mode === 'password' || mode === 'keyboardInteractive' || mode === 'auto') && password) {
		config.password = password;
	}
	return config;
}

function buildAlgorithms(algorithms: TerminalSftpProfileSnapshot['sshAlgorithms']): Record<string, string[]> {
	if (!algorithms) {
		return {};
	}
	const next: Record<string, string[]> = {};
	const cipher = filterSupportedAlgorithmList(algorithms.cipher, SUPPORTED_SFTP_ALGORITHMS.cipher);
	if (cipher.length) {
		next.cipher = cipher;
	}
	const kex = filterSupportedAlgorithmList(algorithms.kex, SUPPORTED_SFTP_ALGORITHMS.kex);
	if (kex.length) {
		next.kex = kex;
	}
	const hmac = filterSupportedAlgorithmList(algorithms.hmac, SUPPORTED_SFTP_ALGORITHMS.hmac);
	if (hmac.length) {
		next.hmac = hmac;
	}
	const serverHostKey = filterSupportedAlgorithmList(algorithms.serverHostKey, SUPPORTED_SFTP_ALGORITHMS.serverHostKey);
	if (serverHostKey.length) {
		next.serverHostKey = serverHostKey;
	}
	const compression = filterSupportedAlgorithmList(algorithms.compression, SUPPORTED_SFTP_ALGORITHMS.compression);
	if (compression.length) {
		next.compress = compression;
	}
	return next;
}

function filterSupportedAlgorithmList(source: string[] | undefined, supported: Set<string>): string[] {
	if (!Array.isArray(source) || !source.length) {
		return [];
	}
	return source.filter((item) => typeof item === 'string' && supported.has(item));
}

function mapListEntry(parentPath: string, entry: Record<string, unknown>): TerminalSftpListEntry {
	return {
		name: String(entry.name || ''),
		fullPath: joinRemotePath(parentPath, String(entry.name || '')),
		type: String(entry.type || '-'),
		size: numericOrZero(entry.size),
		modifyTime: numericOrZero(entry.modifyTime),
		rights: mapRights(entry),
	};
}

function mapRights(source: Record<string, unknown>): TerminalSftpListEntry['rights'] | undefined {
	const rights = source.rights;
	if (!rights || typeof rights !== 'object') {
		return undefined;
	}
	const record = rights as Record<string, unknown>;
	return {
		user: typeof record.user === 'string' ? record.user : undefined,
		group: typeof record.group === 'string' ? record.group : undefined,
		other: typeof record.other === 'string' ? record.other : undefined,
	};
}

function inferStatType(stats: Record<string, unknown>): string {
	if (stats.isDirectory) {
		return 'd';
	}
	if (stats.isSymbolicLink) {
		return 'l';
	}
	return '-';
}

function numericOrZero(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function basenameRemote(remotePath: string): string {
	if (remotePath === '/') {
		return '/';
	}
	const trimmed = remotePath.replace(/\/+$/, '');
	const segments = trimmed.split('/').filter(Boolean);
	return segments[segments.length - 1] || '/';
}

function normalizeRemotePath(remotePath: string): string {
	const raw = String(remotePath || '').trim();
	if (!raw || raw === '.') {
		return '/';
	}
	const input = raw.replace(/\\/g, '/');
	const absolute = input.startsWith('/') ? input : `/${input}`;
	const segments = absolute.split('/');
	const next: string[] = [];
	for (const segment of segments) {
		if (!segment || segment === '.') {
			continue;
		}
		if (segment === '..') {
			next.pop();
			continue;
		}
		next.push(segment);
	}
	return `/${next.join('/')}` || '/';
}

function joinRemotePath(basePath: string, name: string): string {
	return normalizeRemotePath(`${normalizeRemotePath(basePath)}/${String(name || '').replace(/^\/+/, '')}`);
}

async function ensureLocalFile(localPath: string): Promise<void> {
	const stats = await fs.stat(localPath);
	if (!stats.isFile()) {
		throw new Error('请选择文件。');
	}
}

async function ensureLocalDirectory(localPath: string): Promise<void> {
	const stats = await fs.stat(localPath);
	if (!stats.isDirectory()) {
		throw new Error('请选择文件夹。');
	}
}

async function safeEnd(client: SftpClient): Promise<void> {
	try {
		await client.end();
	} catch {
		/* ignore */
	}
}

function isAuthenticationError(message: string): boolean {
	return /auth|authentication|configured authentication methods failed|permission denied/i.test(message);
}

function buildAuthPromptText(kind: 'password' | 'passphrase', profile: TerminalSftpProfileSnapshot): string {
	const target = `${profile.sshUser}@${profile.sshHost}`;
	return kind === 'passphrase' ? `Passphrase for ${target}` : `Password for ${target}`;
}
