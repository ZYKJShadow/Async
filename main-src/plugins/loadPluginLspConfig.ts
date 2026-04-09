import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { LspServerConfig, ScopedLspServerConfig } from './pluginLspTypes.js';

const GUESS_LANG: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescriptreact',
	'.js': 'javascript',
	'.jsx': 'javascriptreact',
	'.mts': 'typescript',
	'.cts': 'typescript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.py': 'python',
	'.pyi': 'python',
	'.go': 'go',
	'.rs': 'rust',
};

type PluginManifest = {
	name?: string;
	disabled?: boolean;
	lspServers?: string | Record<string, unknown> | Array<string | Record<string, unknown>>;
};

function normalizeExt(raw: string): string {
	const t = String(raw).trim().toLowerCase();
	return t.startsWith('.') ? t : `.${t}`;
}

/**
 * 与 Claude `validatePathWithinPlugin` 一致：禁止路径穿越。
 */
export function validatePathWithinPlugin(pluginPath: string, relativePath: string): string | null {
	const resolvedPluginPath = path.resolve(pluginPath);
	const resolvedFilePath = path.resolve(pluginPath, relativePath);
	const rel = path.relative(resolvedPluginPath, resolvedFilePath);
	if (rel.startsWith('..') || path.resolve(rel) === rel) {
		return null;
	}
	return resolvedFilePath;
}

function expandEnvPlaceholdersInString(value: string, env: Record<string, string | undefined>): string {
	return value.replace(/\$\{([^}]+)\}/g, (_m, key: string) => {
		const k = String(key).trim();
		if (k === 'ASYNC_PLUGIN_ROOT' || k === 'CLAUDE_PLUGIN_ROOT') {
			return env.ASYNC_PLUGIN_ROOT ?? env.CLAUDE_PLUGIN_ROOT ?? '';
		}
		const v = env[k] ?? process.env[k];
		return v ?? '';
	});
}

function resolveLspConfigPlaceholders(cfg: LspServerConfig, pluginRoot: string): LspServerConfig {
	const baseEnv: Record<string, string | undefined> = {
		...process.env,
		ASYNC_PLUGIN_ROOT: pluginRoot,
		CLAUDE_PLUGIN_ROOT: pluginRoot,
	};
	const next: LspServerConfig = { ...cfg, command: expandEnvPlaceholdersInString(cfg.command, baseEnv) };
	if (next.args?.length) {
		next.args = next.args.map((a) => expandEnvPlaceholdersInString(a, baseEnv));
	}
	const mergedEnv: Record<string, string> = {
		ASYNC_PLUGIN_ROOT: pluginRoot,
		CLAUDE_PLUGIN_ROOT: pluginRoot,
	};
	if (cfg.env) {
		for (const [k, v] of Object.entries(cfg.env)) {
			mergedEnv[k] = expandEnvPlaceholdersInString(String(v), { ...baseEnv, ...mergedEnv });
		}
	}
	next.env = Object.keys(mergedEnv).length ? mergedEnv : undefined;
	if (next.workspaceFolder) {
		next.workspaceFolder = expandEnvPlaceholdersInString(next.workspaceFolder, { ...baseEnv, ...next.env });
	}
	if (next.cwdRelative) {
		next.cwdRelative = expandEnvPlaceholdersInString(next.cwdRelative, { ...baseEnv, ...next.env });
	}
	return next;
}

function validateServerConfig(raw: unknown, context: string): LspServerConfig | null {
	if (!raw || typeof raw !== 'object') {
		console.warn(`[lsp-plugin] ${context}: config is not an object`);
		return null;
	}
	const o = raw as Record<string, unknown>;
	const command = typeof o.command === 'string' ? o.command.trim() : '';
	if (!command) {
		console.warn(`[lsp-plugin] ${context}: missing command`);
		return null;
	}
	if (command.includes(' ') && !command.startsWith('/') && !/^[A-Za-z]:\\/.test(command)) {
		console.warn(`[lsp-plugin] ${context}: command must not contain spaces (use args)`);
		return null;
	}
	const transport = o.transport;
	if (transport !== undefined && transport !== 'stdio' && transport !== 'socket') {
		console.warn(`[lsp-plugin] ${context}: unsupported transport`);
		return null;
	}
	if (transport === 'socket') {
		console.warn(`[lsp-plugin] ${context}: socket transport not supported in Async, skipping`);
		return null;
	}
	const etm = o.extensionToLanguage;
	if (!etm || typeof etm !== 'object') {
		console.warn(`[lsp-plugin] ${context}: extensionToLanguage required`);
		return null;
	}
	const extensionToLanguage: Record<string, string> = {};
	for (const [k, v] of Object.entries(etm as Record<string, unknown>)) {
		if (typeof v === 'string' && v.trim()) {
			extensionToLanguage[normalizeExt(k)] = v.trim();
		}
	}
	if (Object.keys(extensionToLanguage).length === 0) {
		console.warn(`[lsp-plugin] ${context}: extensionToLanguage must have at least one mapping`);
		return null;
	}
	let args: string[] | undefined;
	if (o.args !== undefined) {
		if (!Array.isArray(o.args)) {
			console.warn(`[lsp-plugin] ${context}: args must be an array`);
			return null;
		}
		args = o.args.map((a) => String(a));
	}
	let env: Record<string, string> | undefined;
	if (o.env !== undefined && o.env && typeof o.env === 'object') {
		env = {};
		for (const [k, v] of Object.entries(o.env as Record<string, unknown>)) {
			env[k] = String(v);
		}
	}
	const workspaceFolder = typeof o.workspaceFolder === 'string' ? o.workspaceFolder : undefined;
	const cwdRelative = typeof o.cwdRelative === 'string' ? o.cwdRelative : undefined;
	return {
		command,
		args,
		extensionToLanguage,
		transport: 'stdio' as const,
		env,
		workspaceFolder,
		cwdRelative,
	};
}

function parseJsonRecord(raw: string, context: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			console.warn(`[lsp-plugin] ${context}: root must be a JSON object`);
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch (e) {
		console.warn(`[lsp-plugin] ${context}: ${e instanceof Error ? e.message : 'parse error'}`);
		return null;
	}
}

function recordToServers(
	record: Record<string, unknown>,
	context: string,
): Record<string, LspServerConfig> {
	const out: Record<string, LspServerConfig> = {};
	for (const [name, val] of Object.entries(record)) {
		const cfg = validateServerConfig(val, `${context}/${name}`);
		if (cfg) out[name] = cfg;
	}
	return out;
}

async function readLspJsonFile(filePath: string, context: string): Promise<Record<string, LspServerConfig>> {
	try {
		const raw = await readFile(filePath, 'utf8');
		const rec = parseJsonRecord(raw, context);
		if (!rec) return {};
		return recordToServers(rec, context);
	} catch (e) {
		if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
		console.warn(`[lsp-plugin] ${context}: ${e instanceof Error ? e.message : 'read failed'}`);
		return {};
	}
}

async function loadLspServersFromManifest(
	declaration: NonNullable<PluginManifest['lspServers']>,
	pluginPath: string,
	pluginName: string,
): Promise<Record<string, LspServerConfig>> {
	const servers: Record<string, LspServerConfig> = {};
	const declarations = Array.isArray(declaration) ? declaration : [declaration];
	for (const decl of declarations) {
		if (typeof decl === 'string') {
			const validatedPath = validatePathWithinPlugin(pluginPath, decl);
			if (!validatedPath) {
				console.warn(`[lsp-plugin] blocked path traversal in ${pluginName}: ${decl}`);
				continue;
			}
			Object.assign(servers, await readLspJsonFile(validatedPath, `${pluginName}:${decl}`));
		} else if (decl && typeof decl === 'object') {
			Object.assign(servers, recordToServers(decl as Record<string, unknown>, `${pluginName}:inline`));
		}
	}
	return servers;
}

export function addPluginScopeToLspServers(
	servers: Record<string, LspServerConfig>,
	pluginName: string,
): Record<string, ScopedLspServerConfig> {
	const scoped: Record<string, ScopedLspServerConfig> = {};
	for (const [name, config] of Object.entries(servers)) {
		const scopedName = `plugin:${pluginName}:${name}`;
		scoped[scopedName] = {
			...config,
			scope: 'dynamic',
			source: pluginName,
		};
	}
	return scoped;
}

/**
 * 从插件目录加载 LSP（`.lsp.json` + `plugin.json` 的 `lspServers`），与 Claude `loadPluginLspServers` 一致。
 */
export async function loadPluginLspFromDirectory(pluginPath: string, pluginName: string): Promise<Record<string, LspServerConfig>> {
	const servers: Record<string, LspServerConfig> = {};

	const lspJsonPath = path.join(pluginPath, '.lsp.json');
	Object.assign(servers, await readLspJsonFile(lspJsonPath, `${pluginName}/.lsp.json`));

	const manifestPath = path.join(pluginPath, 'plugin.json');
	let manifest: PluginManifest | null = null;
	try {
		const mraw = await readFile(manifestPath, 'utf8');
		const parsed = JSON.parse(mraw) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			manifest = parsed as PluginManifest;
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			console.warn(`[lsp-plugin] ${pluginName}/plugin.json: ${e instanceof Error ? e.message : 'read failed'}`);
		}
	}

	if (manifest?.lspServers) {
		Object.assign(servers, await loadLspServersFromManifest(manifest.lspServers, pluginPath, pluginName));
	}

	return servers;
}

export async function discoverPluginSubdirs(pluginsRoot: string): Promise<string[]> {
	if (!pluginsRoot || !fs.existsSync(pluginsRoot)) return [];
	const names = await fs.promises.readdir(pluginsRoot, { withFileTypes: true });
	const dirs: string[] = [];
	for (const ent of names) {
		if (!ent.isDirectory()) continue;
		const full = path.join(pluginsRoot, ent.name);
		const hasLsp = fs.existsSync(path.join(full, '.lsp.json'));
		const hasManifest = fs.existsSync(path.join(full, 'plugin.json'));
		if (hasLsp || hasManifest) dirs.push(full);
	}
	dirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
	return dirs;
}

export async function loadScopedServersForPluginDir(pluginDir: string): Promise<Record<string, ScopedLspServerConfig>> {
	const folderName = path.basename(pluginDir);
	let manifestName = folderName;
	try {
		const mraw = await readFile(path.join(pluginDir, 'plugin.json'), 'utf8');
		const parsed = JSON.parse(mraw) as PluginManifest;
		if (typeof parsed?.name === 'string' && parsed.name.trim()) {
			manifestName = parsed.name.trim();
		}
		if (parsed?.disabled === true) {
			return {};
		}
	} catch {
		/* no plugin.json or invalid — still load .lsp.json under folder name */
	}

	const rawServers = await loadPluginLspFromDirectory(pluginDir, manifestName);
	const resolved: Record<string, LspServerConfig> = {};
	for (const [n, cfg] of Object.entries(rawServers)) {
		resolved[n] = resolveLspConfigPlaceholders(cfg, path.resolve(pluginDir));
	}
	return addPluginScopeToLspServers(resolved, manifestName);
}

/** 与 `settings.json` 中 `lsp.servers` 单条结构一致（避免循环依赖 settingsStore）。 */
export type LegacySettingsLspServer = {
	id: string;
	command: string;
	args?: string[];
	extensions?: string[];
	extensionToLanguage?: Record<string, string>;
	cwd?: string;
};

/** 将 settings.lsp.servers 转为与插件同形的 Scoped 配置（迁移/兼容）。 */
export function scopedServersFromSettingsLsp(servers: LegacySettingsLspServer[] | undefined): Record<string, ScopedLspServerConfig> {
	const out: Record<string, ScopedLspServerConfig> = {};
	if (!servers?.length) return out;
	for (const srv of servers) {
		const id = String(srv.id ?? '').trim();
		if (!id || !String(srv.command ?? '').trim()) continue;
		const command = String(srv.command).trim();
		const extensionToLanguage: Record<string, string> = {};
		for (const [k, v] of Object.entries(srv.extensionToLanguage ?? {})) {
			if (typeof v === 'string' && v.trim()) extensionToLanguage[normalizeExt(k)] = v.trim();
		}
		for (const raw of srv.extensions ?? []) {
			const ext = normalizeExt(String(raw));
			if (!extensionToLanguage[ext]) {
				extensionToLanguage[ext] = GUESS_LANG[ext] ?? 'plaintext';
			}
		}
		if (Object.keys(extensionToLanguage).length === 0) continue;
		const scopedName = `plugin:settings:${id}`;
		out[scopedName] = {
			command,
			args: Array.isArray(srv.args) ? srv.args.map((a) => String(a)) : undefined,
			extensionToLanguage,
			cwdRelative: typeof srv.cwd === 'string' ? srv.cwd.trim() : undefined,
			scope: 'settings',
			source: 'settings.json',
		};
	}
	return out;
}
