import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentCommand, AgentCustomization, AgentSkill } from '../agentSettingsTypes.js';
import type { McpServerConfig } from '../mcp/mcpTypes.js';
import { getSettings, resolveUserPluginsRoot } from '../settingsStore.js';
import type { PluginInstallScope } from '../../src/pluginMarketplaceTypes.js';
import type {
	PluginRuntimeContributionView,
	PluginRuntimeState,
} from '../../src/pluginRuntimeTypes.js';
import {
	isRecognizedPluginDirectorySync,
	pluginContentRootFromManifestPath,
	readAsyncPluginInstallMetaSync,
	resolveClaudePluginManifestPathSync,
	resolveCodexPluginManifestPathSync,
	resolvePluginManifestPathSync,
} from './pluginFs.js';
import { getPluginDiscoveryVersion } from './pluginDiscoveryVersion.js';

const MAX_PLUGIN_MARKDOWN_CHARS = 120_000;

type GenericObject = Record<string, unknown>;

type PluginManifest = {
	name?: unknown;
	version?: unknown;
	description?: unknown;
	disabled?: unknown;
	skills?: unknown;
	commands?: unknown;
	agents?: unknown;
	mcpServers?: unknown;
	interface?: {
		displayName?: unknown;
	};
};

type PluginContribution = PluginRuntimeContributionView;

let runtimeCache:
	| {
			key: string;
			version: number;
			overrideKey: string;
			state: PluginRuntimeState;
	  }
	| null = null;

function normalizeWorkspaceKey(workspaceRoot: string | null): string {
	return workspaceRoot ? path.resolve(workspaceRoot).replace(/\\/g, '/').toLowerCase() : '(none)';
}

function safeReadJsonFile(filePath: string): unknown | null {
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return null;
		}
		return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
	} catch {
		return null;
	}
}

function readManifestFile(filePath: string | null): PluginManifest | null {
	if (!filePath) {
		return null;
	}
	const parsed = safeReadJsonFile(filePath);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	return parsed as PluginManifest;
}

function readTextFileSafe(filePath: string, maxChars = MAX_PLUGIN_MARKDOWN_CHARS): string {
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return '';
		}
		const text = fs.readFileSync(filePath, 'utf8');
		if (text.length > maxChars) {
			return `${text.slice(0, maxChars)}\n\n… (truncated)`;
		}
		return text;
	} catch {
		return '';
	}
}

function stripSimpleFrontmatter(md: string): { body: string; meta: Record<string, string> } {
	const text = md.trim();
	if (!text.startsWith('---')) {
		return { body: md, meta: {} };
	}
	const end = text.indexOf('\n---', 3);
	if (end < 0) {
		return { body: md, meta: {} };
	}
	const yamlBlock = text.slice(3, end).trim();
	const body = text.slice(end + 4).trim();
	const meta: Record<string, string> = {};
	for (const line of yamlBlock.split('\n')) {
		const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
		if (!match) {
			continue;
		}
		meta[match[1]!] = (match[2] ?? '').replace(/^["']|["']$/g, '').trim();
	}
	return { body, meta };
}

function firstMarkdownHeading(body: string): string | null {
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const match = trimmed.match(/^#\s+(.+)$/);
		if (match) {
			return match[1]!.trim();
		}
	}
	return null;
}

function resolvePathWithinRoot(root: string, declaredPath: string): string | null {
	const resolvedRoot = path.resolve(root);
	const resolvedPath = path.resolve(root, declaredPath);
	const rel = path.relative(resolvedRoot, resolvedPath);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		return null;
	}
	return resolvedPath;
}

function asStringArray(value: unknown): string[] {
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		.map((item) => item.trim());
}

function pluginDisplayName(params: {
	installDir: string;
	metaName?: string;
	claudeManifest?: PluginManifest | null;
	codexManifest?: PluginManifest | null;
}): string {
	const codexDisplay =
		typeof params.codexManifest?.interface?.displayName === 'string' && params.codexManifest.interface.displayName.trim()
			? params.codexManifest.interface.displayName.trim()
			: '';
	const manifestName =
		typeof params.claudeManifest?.name === 'string' && params.claudeManifest.name.trim()
			? params.claudeManifest.name.trim()
			: typeof params.codexManifest?.name === 'string' && params.codexManifest.name.trim()
				? params.codexManifest.name.trim()
				: '';
	return codexDisplay || params.metaName?.trim() || manifestName || path.basename(params.installDir);
}

function buildContributionKey(scope: PluginInstallScope, installDir: string): string {
	return `${scope}:${path.resolve(installDir).replace(/\\/g, '/')}`;
}

function relativePluginPath(root: string, filePath: string): string {
	return path.relative(root, filePath).replace(/\\/g, '/');
}

function pluginMcpOverridesCacheKey(
	overrides: ReturnType<typeof getSettings>['pluginMcpOverrides']
): string {
	if (!overrides || typeof overrides !== 'object') {
		return '';
	}
	return Object.entries(overrides)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, override]) => {
			if (!override || typeof override !== 'object' || Array.isArray(override)) {
				return `${id}::`;
			}
			const enabled = typeof override.enabled === 'boolean' ? String(override.enabled) : '';
			const autoStart = typeof override.autoStart === 'boolean' ? String(override.autoStart) : '';
			return `${id}:${enabled}:${autoStart}`;
		})
		.join('|');
}

function applyPluginMcpOverrides(
	servers: McpServerConfig[],
	overrides: ReturnType<typeof getSettings>['pluginMcpOverrides']
): McpServerConfig[] {
	if (!overrides || typeof overrides !== 'object' || servers.length === 0) {
		return servers;
	}
	return servers.map((server) => {
		const override = overrides[server.id];
		if (!override || typeof override !== 'object' || Array.isArray(override)) {
			return server;
		}
		return {
			...server,
			...(typeof override.enabled === 'boolean' ? { enabled: override.enabled } : {}),
			...(typeof override.autoStart === 'boolean' ? { autoStart: override.autoStart } : {}),
		};
	});
}

function collectSkillItemsFromDir(
	dirPath: string,
	pluginRoot: string,
	scope: PluginInstallScope,
	pluginName: string,
	contributionKey: string,
	sourceKind: 'skill' | 'agent',
): AgentSkill[] {
	if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
		return [];
	}
	const out: AgentSkill[] = [];
	const pushSkillFromDirectory = (skillDir: string, dirName: string): void => {
		const skillPath = path.join(skillDir, 'SKILL.md');
		const raw = readTextFileSafe(skillPath);
		if (!raw.trim()) {
			return;
		}
		const { body, meta } = stripSimpleFrontmatter(raw);
		const slug = dirName.trim().toLowerCase();
		if (!slug) {
			return;
		}
		out.push({
			id: `plugin-skill:${contributionKey}:${slug}`,
			name: meta.name?.trim() || meta.title?.trim() || dirName,
			description:
				meta.description?.trim() ||
				`Plugin ${sourceKind} from ${relativePluginPath(pluginRoot, skillPath)}`,
			slug,
			content: body.trim(),
			enabled: true,
			origin: scope,
			pluginSourceName: pluginName,
			pluginSourceRelPath: relativePluginPath(pluginRoot, skillPath),
			pluginSourceKind: sourceKind,
		});
	};
	pushSkillFromDirectory(dirPath, path.basename(dirPath));
	for (const dirName of fs.readdirSync(dirPath)) {
		const skillDir = path.join(dirPath, dirName);
		if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
			continue;
		}
		pushSkillFromDirectory(skillDir, dirName);
	}
	return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

function collectAgentItemsFromPaths(
	declaredPaths: string[],
	pluginRoot: string,
	scope: PluginInstallScope,
	pluginName: string,
	contributionKey: string,
): AgentSkill[] {
	const out: AgentSkill[] = [];
	for (const declaredPath of declaredPaths) {
		const resolved = resolvePathWithinRoot(pluginRoot, declaredPath);
		if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			continue;
		}
		const raw = readTextFileSafe(resolved);
		if (!raw.trim()) {
			continue;
		}
		const { body, meta } = stripSimpleFrontmatter(raw);
		const baseName = path.basename(resolved, path.extname(resolved));
		const slug = (meta.name?.trim() || baseName).trim().toLowerCase();
		if (!slug) {
			continue;
		}
		const title = meta.name?.trim() || firstMarkdownHeading(body) || baseName;
		out.push({
			id: `plugin-skill:${contributionKey}:agent:${slug}`,
			name: title,
			description:
				meta.description?.trim() ||
				`Plugin agent from ${relativePluginPath(pluginRoot, resolved)}`,
			slug,
			content: body.trim(),
			enabled: true,
			origin: scope,
			pluginSourceName: pluginName,
			pluginSourceRelPath: relativePluginPath(pluginRoot, resolved),
			pluginSourceKind: 'agent',
		});
	}
	return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

function collectCommandFiles(dirOrFile: string): string[] {
	if (!fs.existsSync(dirOrFile)) {
		return [];
	}
	if (fs.statSync(dirOrFile).isFile()) {
		return /\.(md|mdc)$/i.test(dirOrFile) ? [dirOrFile] : [];
	}
	const out: string[] = [];
	for (const entry of fs.readdirSync(dirOrFile, { withFileTypes: true })) {
		const full = path.join(dirOrFile, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectCommandFiles(full));
			continue;
		}
		if (entry.isFile() && /\.(md|mdc)$/i.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

function collectCommandItems(
	declaredPaths: string[],
	pluginRoot: string,
	scope: PluginInstallScope,
	pluginName: string,
	contributionKey: string,
): AgentCommand[] {
	const seen = new Set<string>();
	const out: AgentCommand[] = [];
	for (const declaredPath of declaredPaths) {
		const resolved = resolvePathWithinRoot(pluginRoot, declaredPath);
		if (!resolved) {
			continue;
		}
		for (const filePath of collectCommandFiles(resolved)) {
			const raw = readTextFileSafe(filePath);
			if (!raw.trim()) {
				continue;
			}
			const { body, meta } = stripSimpleFrontmatter(raw);
			const slash = path.basename(filePath, path.extname(filePath)).trim().replace(/^\//, '');
			if (!slash || seen.has(slash.toLowerCase())) {
				continue;
			}
			seen.add(slash.toLowerCase());
			out.push({
				id: `plugin-command:${contributionKey}:${slash.toLowerCase()}`,
				name: meta.name?.trim() || firstMarkdownHeading(body) || slash,
				description: meta.description?.trim(),
				slash,
				body: body.trim(),
				invocation: 'prompt',
				origin: scope,
				pluginSourceName: pluginName,
				pluginSourceRelPath: relativePluginPath(pluginRoot, filePath),
			});
		}
	}
	return out.sort((a, b) => a.slash.localeCompare(b.slash));
}

function parseMcpServerConfig(
	serverName: string,
	rawConfig: unknown,
	_scope: PluginInstallScope,
	pluginName: string,
	contributionKey: string,
	sourceRelPath: string,
): McpServerConfig | null {
	if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
		return null;
	}
	const config = rawConfig as GenericObject;
	const typeRaw = typeof config.type === 'string' ? config.type.trim().toLowerCase() : '';
	const transportRaw =
		typeof config.transport === 'string' ? config.transport.trim().toLowerCase() : '';
	const transport: McpServerConfig['transport'] =
		typeRaw === 'http' || transportRaw === 'http'
			? 'http'
			: typeRaw === 'sse' || transportRaw === 'sse'
				? 'sse'
				: 'stdio';
	const args = Array.isArray(config.args)
		? config.args.map((item) => String(item))
		: undefined;
	const env =
		config.env && typeof config.env === 'object' && !Array.isArray(config.env)
			? Object.fromEntries(
					Object.entries(config.env as GenericObject).map(([key, value]) => [key, String(value)])
				)
			: undefined;
	const headers =
		config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
			? Object.fromEntries(
					Object.entries(config.headers as GenericObject).map(([key, value]) => [key, String(value)])
				)
			: undefined;
	const command = typeof config.command === 'string' ? config.command.trim() : '';
	const url = typeof config.url === 'string' ? config.url.trim() : '';
	if (transport === 'stdio' && !command) {
		return null;
	}
	if ((transport === 'sse' || transport === 'http') && !url) {
		return null;
	}
	const timeout =
		typeof config.timeout === 'number' && Number.isFinite(config.timeout)
			? config.timeout
			: undefined;
	return {
		id: `plugin-mcp:${contributionKey}:${serverName}`,
		name: serverName,
		enabled: config.disabled === true ? false : config.enabled !== false,
		transport,
		command: command || undefined,
		args,
		env,
		url: url || undefined,
		headers,
		autoStart: typeof config.autoStart === 'boolean' ? config.autoStart : true,
		timeout,
		pluginSourceName: pluginName,
		pluginSourceRelPath: sourceRelPath,
		pluginManaged: true,
	};
}

function collectMcpServers(
	declaredPath: string,
	pluginRoot: string,
	scope: PluginInstallScope,
	pluginName: string,
	contributionKey: string,
): McpServerConfig[] {
	const resolved = resolvePathWithinRoot(pluginRoot, declaredPath);
	if (!resolved) {
		return [];
	}
	const parsed = safeReadJsonFile(resolved);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return [];
	}
	const rootObject = parsed as GenericObject;
	const serversRoot =
		rootObject.mcpServers && typeof rootObject.mcpServers === 'object' && !Array.isArray(rootObject.mcpServers)
			? (rootObject.mcpServers as GenericObject)
			: rootObject;
	const out: McpServerConfig[] = [];
	for (const [serverName, rawConfig] of Object.entries(serversRoot)) {
		const config = parseMcpServerConfig(
			serverName,
			rawConfig,
			scope,
			pluginName,
			contributionKey,
			relativePluginPath(pluginRoot, resolved),
		);
		if (config) {
			out.push(config);
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readContributionForPluginDir(
	pluginDir: string,
	scope: PluginInstallScope,
): PluginContribution | null {
	const manifestPath = resolvePluginManifestPathSync(pluginDir);
	if (!manifestPath) {
		return null;
	}
	const installMeta = readAsyncPluginInstallMetaSync(pluginDir);
	const claudeManifestPath = resolveClaudePluginManifestPathSync(pluginDir);
	const codexManifestPath = resolveCodexPluginManifestPathSync(pluginDir);
	const claudeManifest = readManifestFile(claudeManifestPath);
	const codexManifest = readManifestFile(codexManifestPath);
	const manifestDisabled =
		claudeManifest?.disabled === true || codexManifest?.disabled === true || installMeta?.disabled === true;
	if (manifestDisabled) {
		return null;
	}
	const pluginRoot = pluginContentRootFromManifestPath(manifestPath);
	const pluginName = pluginDisplayName({
		installDir: pluginDir,
		metaName: typeof installMeta?.pluginName === 'string' ? installMeta.pluginName : undefined,
		claudeManifest,
		codexManifest,
	});
	const contributionKey = buildContributionKey(scope, pluginDir);
	const legacySkills = claudeManifest
		? asStringArray(claudeManifest.skills).flatMap((declaredPath) =>
				collectSkillItemsFromDir(
					resolvePathWithinRoot(pluginRoot, declaredPath) ?? '',
					pluginRoot,
					scope,
					pluginName,
					contributionKey,
					'skill',
				)
			)
		: [];
	const codexSkills = codexManifest
		? asStringArray(codexManifest.skills).flatMap((declaredPath) =>
				collectSkillItemsFromDir(
					resolvePathWithinRoot(pluginRoot, declaredPath) ?? '',
					pluginRoot,
					scope,
					pluginName,
					contributionKey,
					'skill',
				)
			)
		: [];
	const agentSkills = claudeManifest
		? collectAgentItemsFromPaths(asStringArray(claudeManifest.agents), pluginRoot, scope, pluginName, contributionKey)
		: [];
	const commands = claudeManifest
		? collectCommandItems(asStringArray(claudeManifest.commands), pluginRoot, scope, pluginName, contributionKey)
		: [];
	const mcpServers =
		codexManifest && typeof codexManifest.mcpServers === 'string'
			? collectMcpServers(String(codexManifest.mcpServers), pluginRoot, scope, pluginName, contributionKey)
			: [];
	const skills = mergeSkillsBySlug([...legacySkills, ...codexSkills], agentSkills);
	if (skills.length === 0 && commands.length === 0 && mcpServers.length === 0) {
		return {
			pluginId: contributionKey,
			pluginName,
			installDir: pluginDir,
			scope,
			skills: [],
			commands: [],
			mcpServers: [],
		};
	}
	return {
		pluginId: contributionKey,
		pluginName,
		installDir: pluginDir,
		scope,
		skills,
		commands,
		mcpServers,
	};
}

function scanInstalledPluginDirs(root: string | null, scope: PluginInstallScope): PluginContribution[] {
	if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
		return [];
	}
	const out: PluginContribution[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const pluginDir = path.join(root, entry.name);
		if (!isRecognizedPluginDirectorySync(pluginDir)) {
			continue;
		}
		const contribution = readContributionForPluginDir(pluginDir, scope);
		if (contribution) {
			out.push(contribution);
		}
	}
	return out.sort((a, b) => a.pluginName.localeCompare(b.pluginName));
}

function aggregatePluginState(plugins: PluginContribution[]): PluginRuntimeState {
	const pluginSkillsUser = plugins.filter((plugin) => plugin.scope === 'user').flatMap((plugin) => plugin.skills);
	const pluginSkillsProject = plugins
		.filter((plugin) => plugin.scope === 'project')
		.flatMap((plugin) => plugin.skills);
	const pluginCommandsProject = plugins
		.filter((plugin) => plugin.scope === 'project')
		.flatMap((plugin) => plugin.commands);
	const pluginCommandsUser = plugins.filter((plugin) => plugin.scope === 'user').flatMap((plugin) => plugin.commands);
	const pluginMcpServers = plugins.flatMap((plugin) => plugin.mcpServers);
	return {
		plugins,
		skills: [...pluginSkillsUser, ...pluginSkillsProject],
		commands: [...pluginCommandsProject, ...pluginCommandsUser],
		mcpServers: pluginMcpServers,
	};
}

export function getPluginRuntimeState(workspaceRoot: string | null): PluginRuntimeState {
	const cacheKey = normalizeWorkspaceKey(workspaceRoot);
	const version = getPluginDiscoveryVersion();
	const settings = getSettings();
	const overrideKey = pluginMcpOverridesCacheKey(settings.pluginMcpOverrides);
	if (
		runtimeCache &&
		runtimeCache.key === cacheKey &&
		runtimeCache.version === version &&
		runtimeCache.overrideKey === overrideKey
	) {
		return runtimeCache.state;
	}
	const userPluginsRoot = resolveUserPluginsRoot(settings);
	const projectPluginsRoot = workspaceRoot ? path.join(path.resolve(workspaceRoot), '.async', 'plugins') : null;
	const plugins = [
		...scanInstalledPluginDirs(userPluginsRoot, 'user'),
		...scanInstalledPluginDirs(projectPluginsRoot, 'project'),
	];
	const baseState = aggregatePluginState(plugins);
	const state: PluginRuntimeState = {
		...baseState,
		mcpServers: applyPluginMcpOverrides(baseState.mcpServers, settings.pluginMcpOverrides),
	};
	runtimeCache = {
		key: cacheKey,
		version,
		overrideKey,
		state,
	};
	return state;
}

function mergeSkillsBySlug(baseSkills: AgentSkill[], overridingSkills: AgentSkill[]): AgentSkill[] {
	const map = new Map<string, AgentSkill>();
	for (const skill of baseSkills) {
		const slug = skill.slug?.trim().toLowerCase();
		if (slug) {
			map.set(slug, skill);
		}
	}
	for (const skill of overridingSkills) {
		const slug = skill.slug?.trim().toLowerCase();
		if (slug) {
			map.set(slug, skill);
		}
	}
	return [...map.values()];
}

export function mergeAgentWithPluginRuntime(
	agent: AgentCustomization | undefined,
	workspaceRoot: string | null,
): AgentCustomization {
	const base = agent ?? {};
	const runtime = getPluginRuntimeState(workspaceRoot);
	return {
		...base,
		skills: mergeSkillsBySlug(runtime.skills, base.skills ?? []),
		commands: [...(base.commands ?? []), ...runtime.commands],
	};
}

export function getEffectiveMcpServerConfigs(
	userServers: McpServerConfig[] | undefined,
	workspaceRoot: string | null,
): McpServerConfig[] {
	const runtime = getPluginRuntimeState(workspaceRoot);
	return [...(userServers ?? []), ...runtime.mcpServers];
}
