import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getCachedAsyncDataDir } from '../dataDir.js';
import { normalizeGitFailureMessage } from '../gitService.js';
import {
	getDefaultUserPluginsRoot,
	getSettings,
	patchSettings,
	resolveUserPluginsRoot,
} from '../settingsStore.js';
import type {
	InstalledPluginView,
	MarketplacePluginView,
	MarketplaceView,
	PluginInstallScope,
	PluginPanelState,
	PluginSourceKind,
	PluginMarketplaceSourceKind,
} from '../../src/pluginMarketplaceTypes.js';
import { bumpPluginDiscoveryVersion } from './pluginDiscoveryVersion.js';
import {
	ASYNC_PLUGIN_META_FILE,
	type AsyncPluginInstallMeta,
	isRecognizedPluginDirectorySync,
	pluginContentRootFromManifestPath,
	readAsyncPluginInstallMetaSync,
	resolveMarketplaceManifestPathSync,
	resolvePluginManifestPathSync,
} from './pluginFs.js';

const execFileAsync = promisify(execFile);

const KNOWN_MARKETPLACES_FILE = 'known-marketplaces.json';

type MarketplaceSource =
	| { kind: 'directory'; path: string; raw: string }
	| { kind: 'file'; path: string; raw: string }
	| { kind: 'url'; url: string; raw: string }
	| { kind: 'github'; repo: string; ref?: string; raw: string }
	| { kind: 'git'; url: string; ref?: string; raw: string };

type KnownMarketplaceEntry = {
	name: string;
	source: MarketplaceSource;
	installLocation: string;
	manifestPath: string;
	lastSyncedAt: string;
};

type KnownMarketplacesFile = Record<string, KnownMarketplaceEntry>;

type MarketplacePluginEntry = {
	name?: unknown;
	description?: unknown;
	version?: unknown;
	category?: unknown;
	tags?: unknown;
	source?: unknown;
	skills?: unknown;
	commands?: unknown;
	agents?: unknown;
	mcpServers?: unknown;
	disabled?: unknown;
	interface?: {
		displayName?: unknown;
	};
};

type MarketplaceManifest = {
	name?: unknown;
	plugins?: unknown;
	metadata?: {
		description?: unknown;
		version?: unknown;
		pluginRoot?: unknown;
	};
};

type PluginRemoteSource =
	| { source: 'github'; repo?: unknown; ref?: unknown }
	| { source: 'url'; url?: unknown; ref?: unknown }
	| { source: 'git'; url?: unknown; ref?: unknown }
	| { source: 'git-subdir'; url?: unknown; path?: unknown; ref?: unknown }
	| { source: 'npm'; package?: unknown }
	| { source: 'pip'; package?: unknown }
	| { source: string; [key: string]: unknown };

type PluginManifestFile = {
	name: string;
	version?: string;
	description?: string;
	disabled?: boolean;
	skills?: string[];
	commands?: string[];
	agents?: string[];
	mcpServers?: string;
	interface?: {
		displayName?: string;
	};
};

function getMarketplaceCacheRoot(): string {
	const root = path.join(getCachedAsyncDataDir(), 'plugin-marketplaces');
	fs.mkdirSync(root, { recursive: true });
	return root;
}

function getKnownMarketplacesPath(): string {
	return path.join(getMarketplaceCacheRoot(), KNOWN_MARKETPLACES_FILE);
}

function getUserPluginsRoot(): string {
	return resolveUserPluginsRoot(getSettings());
}

function getProjectPluginsRoot(workspaceRoot: string | null | undefined): string | null {
	if (!workspaceRoot || !String(workspaceRoot).trim()) {
		return null;
	}
	const root = path.join(path.resolve(String(workspaceRoot)), '.async', 'plugins');
	fs.mkdirSync(root, { recursive: true });
	return root;
}

function toErrorMessage(error: unknown, fallback = 'Unknown error'): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return String(error ?? fallback);
}

function writeJsonAtomic(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
	fs.renameSync(tmp, filePath);
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return null;
		}
		return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

function isPathInsideRoot(candidate: string, root: string): boolean {
	const rel = path.relative(path.resolve(root), path.resolve(candidate));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sanitizeSlug(value: string): string {
	const cleaned = String(value ?? '')
		.trim()
		.replace(/[^\w.-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return cleaned || 'plugin';
}

function asTrimmedString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function asTrimmedStringArray(value: unknown): string[] {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		.map((item) => item.trim());
}

function buildSynthesizedPluginManifests(
	pluginName: string,
	entry: MarketplacePluginEntry,
): { claudeManifest: PluginManifestFile | null; codexManifest: PluginManifestFile | null } {
	const description = asTrimmedString(entry.description) ?? undefined;
	const version = asTrimmedString(entry.version) ?? undefined;
	const skills = asTrimmedStringArray(entry.skills);
	const commands = asTrimmedStringArray(entry.commands);
	const agents = asTrimmedStringArray(entry.agents);
	const mcpServers = asTrimmedString(entry.mcpServers) ?? undefined;
	const displayName = asTrimmedString(entry.interface?.displayName) ?? undefined;
	const disabled = entry.disabled === true ? true : undefined;
	const baseManifest = {
		name: pluginName,
		...(version ? { version } : {}),
		...(description ? { description } : {}),
		...(disabled ? { disabled } : {}),
	} satisfies Omit<PluginManifestFile, 'skills' | 'commands' | 'agents' | 'mcpServers' | 'interface'>;
	const claudeManifest =
		skills.length > 0 || commands.length > 0 || agents.length > 0
			? {
					...baseManifest,
					...(skills.length > 0 ? { skills } : {}),
					...(commands.length > 0 ? { commands } : {}),
					...(agents.length > 0 ? { agents } : {}),
				}
			: null;
	const codexManifest =
		skills.length > 0 || Boolean(mcpServers) || Boolean(displayName)
			? {
					...baseManifest,
					...(skills.length > 0 ? { skills } : {}),
					...(mcpServers ? { mcpServers } : {}),
					...(displayName ? { interface: { displayName } } : {}),
				}
			: null;
	return { claudeManifest, codexManifest };
}

function canSynthesizePluginMetadata(entry: MarketplacePluginEntry): boolean {
	const manifests = buildSynthesizedPluginManifests(String(entry.name ?? '').trim() || 'plugin', entry);
	return Boolean(manifests.claudeManifest || manifests.codexManifest);
}

function ensurePluginMetadataForInstall(targetDir: string, pluginName: string, entry: MarketplacePluginEntry): void {
	if (isRecognizedPluginDirectorySync(targetDir)) {
		return;
	}
	const manifests = buildSynthesizedPluginManifests(pluginName, entry);
	if (!manifests.claudeManifest && !manifests.codexManifest) {
		return;
	}
	if (manifests.claudeManifest) {
		writeJsonAtomic(path.join(targetDir, '.claude-plugin', 'plugin.json'), manifests.claudeManifest);
	}
	if (manifests.codexManifest) {
		writeJsonAtomic(path.join(targetDir, '.codex-plugin', 'plugin.json'), manifests.codexManifest);
	}
}

function sourceKindOfMarketplace(source: MarketplaceSource): PluginMarketplaceSourceKind {
	return source.kind;
}

function sourceLabelOfMarketplace(source: MarketplaceSource): string {
	switch (source.kind) {
		case 'github':
			return source.ref ? `${source.repo}#${source.ref}` : source.repo;
		case 'git':
			return source.ref ? `${source.url}#${source.ref}` : source.url;
		case 'url':
			return source.url;
		case 'directory':
		case 'file':
			return source.path;
	}
}

function normalizePluginSourceKind(source: unknown): PluginSourceKind {
	if (typeof source === 'string') {
		return 'relative';
	}
	if (!source || typeof source !== 'object') {
		return 'unknown';
	}
	const kind = String((source as { source?: unknown }).source ?? '').trim();
	switch (kind) {
		case 'github':
		case 'git':
		case 'git-subdir':
		case 'url':
		case 'npm':
		case 'pip':
			return kind;
		default:
			return 'unknown';
	}
}

function parseMarketplaceManifest(raw: unknown, label: string): { manifest: MarketplaceManifest; plugins: MarketplacePluginEntry[] } {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(`Marketplace "${label}" is not a JSON object.`);
	}
	const manifest = raw as MarketplaceManifest;
	const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
	if (!name) {
		throw new Error(`Marketplace "${label}" is missing a valid "name".`);
	}
	if (!Array.isArray(manifest.plugins)) {
		throw new Error(`Marketplace "${name}" is missing a valid "plugins" array.`);
	}
	return {
		manifest,
		plugins: manifest.plugins as MarketplacePluginEntry[],
	};
}

function loadMarketplaceManifestFile(manifestPath: string): { manifest: MarketplaceManifest; plugins: MarketplacePluginEntry[] } {
	const raw = readJsonFile<unknown>(manifestPath);
	if (!raw) {
		throw new Error(`Failed to read marketplace manifest: ${manifestPath}`);
	}
	return parseMarketplaceManifest(raw, manifestPath);
}

function loadKnownMarketplaces(): KnownMarketplacesFile {
	return readJsonFile<KnownMarketplacesFile>(getKnownMarketplacesPath()) ?? {};
}

function saveKnownMarketplaces(data: KnownMarketplacesFile): void {
	writeJsonAtomic(getKnownMarketplacesPath(), data);
}

function formatGitError(error: unknown, fallback: string): string {
	const normalized = normalizeGitFailureMessage(error, fallback);
	if (normalized !== fallback) {
		return normalized;
	}
	const stderr =
		error && typeof error === 'object' && 'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
			? String((error as { stderr?: string }).stderr).trim()
			: '';
	if (stderr) {
		return stderr;
	}
	return toErrorMessage(error, fallback);
}

async function runGit(args: string[], cwd?: string): Promise<void> {
	try {
		await execFileAsync('git', args, {
			cwd,
			windowsHide: true,
			maxBuffer: 8 * 1024 * 1024,
		});
	} catch (error) {
		throw new Error(formatGitError(error, 'Git command failed'));
	}
}

async function cloneRepo(source: Extract<MarketplaceSource, { kind: 'github' | 'git' }>, targetDir: string): Promise<void> {
	const repoUrl = source.kind === 'github' ? `https://github.com/${source.repo}.git` : source.url;
	const args = ['clone', '--depth', '1'];
	if (source.ref?.trim()) {
		args.push('--branch', source.ref.trim());
	}
	args.push(repoUrl, targetDir);
	await runGit(args);
}

async function downloadFile(url: string, targetFile: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download marketplace (${response.status} ${response.statusText}).`);
	}
	const ab = await response.arrayBuffer();
	fs.mkdirSync(path.dirname(targetFile), { recursive: true });
	fs.writeFileSync(targetFile, Buffer.from(ab));
}

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function safeRemove(targetPath: string): void {
	try {
		if (fs.existsSync(targetPath)) {
			fs.rmSync(targetPath, { recursive: true, force: true });
		}
	} catch {
		/* ignore */
	}
}

function copyPathReplacing(sourcePath: string, targetPath: string): void {
	safeRemove(targetPath);
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	const stats = fs.statSync(sourcePath);
	if (stats.isDirectory()) {
		fs.cpSync(sourcePath, targetPath, {
			recursive: true,
			filter: (src) => path.basename(src) !== '.git',
		});
		return;
	}
	fs.copyFileSync(sourcePath, targetPath);
}

async function parseMarketplaceInput(input: string): Promise<MarketplaceSource> {
	const trimmed = String(input ?? '').trim();
	if (!trimmed) {
		throw new Error('Marketplace source cannot be empty.');
	}

	const sshMatch = trimmed.match(/^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$/);
	if (sshMatch?.[1]) {
		return {
			kind: 'git',
			url: sshMatch[1],
			ref: sshMatch[3] ? String(sshMatch[3]).trim() : undefined,
			raw: trimmed,
		};
	}

	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		const fragmentMatch = trimmed.match(/^([^#]+)(#(.+))?$/);
		const urlWithoutFragment = fragmentMatch?.[1] || trimmed;
		const ref = fragmentMatch?.[3] ? String(fragmentMatch[3]).trim() : undefined;
		if (urlWithoutFragment.endsWith('.git') || urlWithoutFragment.includes('/_git/')) {
			return {
				kind: 'git',
				url: urlWithoutFragment,
				ref,
				raw: trimmed,
			};
		}
		try {
			const url = new URL(urlWithoutFragment);
			if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
				const match = url.pathname.match(/^\/([^/]+\/[^/]+?)(\/|\.git|$)/);
				if (match?.[1]) {
					return {
						kind: 'github',
						repo: match[1],
						ref,
						raw: trimmed,
					};
				}
			}
		} catch {
			/* fall through */
		}
		return {
			kind: 'url',
			url: urlWithoutFragment,
			raw: trimmed,
		};
	}

	const isWindowsPath =
		process.platform === 'win32' &&
		(trimmed.startsWith('.\\') || trimmed.startsWith('..\\') || /^[a-zA-Z]:[/\\]/.test(trimmed));

	if (
		trimmed.startsWith('./') ||
		trimmed.startsWith('../') ||
		trimmed.startsWith('/') ||
		trimmed.startsWith('~') ||
		isWindowsPath
	) {
		const resolved = path.resolve(trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed);
		if (!fs.existsSync(resolved)) {
			throw new Error(`Path does not exist: ${resolved}`);
		}
		const stats = fs.statSync(resolved);
		if (stats.isDirectory()) {
			return {
				kind: 'directory',
				path: resolved,
				raw: trimmed,
			};
		}
		if (stats.isFile()) {
			if (!resolved.toLowerCase().endsWith('.json')) {
				throw new Error(`Marketplace file must be a .json file: ${resolved}`);
			}
			return {
				kind: 'file',
				path: resolved,
				raw: trimmed,
			};
		}
		throw new Error(`Unsupported path source: ${resolved}`);
	}

	if (trimmed.includes('/') && !trimmed.startsWith('@') && !trimmed.includes(':')) {
		const fragmentMatch = trimmed.match(/^([^#@]+)(?:[#@](.+))?$/);
		const repo = fragmentMatch?.[1] ? String(fragmentMatch[1]).trim() : '';
		if (repo) {
			return {
				kind: 'github',
				repo,
				ref: fragmentMatch?.[2] ? String(fragmentMatch[2]).trim() : undefined,
				raw: trimmed,
			};
		}
	}

	throw new Error('Unsupported marketplace source. Use owner/repo, a Git URL, a marketplace.json URL, or a local path.');
}

function marketplaceRootFromManifestPath(manifestPath: string, pluginRootSetting: unknown): string | null {
	const baseRoot = pluginContentRootFromManifestPath(manifestPath);
	if (typeof pluginRootSetting === 'string' && pluginRootSetting.trim()) {
		const resolved = path.resolve(baseRoot, pluginRootSetting.trim());
		return isPathInsideRoot(resolved, baseRoot) ? resolved : null;
	}
	return baseRoot;
}

function pluginSourceObject(source: unknown): PluginRemoteSource | null {
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		return null;
	}
	return source as PluginRemoteSource;
}

async function materializeMarketplaceSourceToTemp(source: MarketplaceSource): Promise<{
	manifestPath: string;
	installLocation: string;
	isTemp: boolean;
	cleanup: () => void;
}> {
	if (source.kind === 'directory' || source.kind === 'file') {
		const installLocation = path.resolve(source.path);
		const manifestPath = resolveMarketplaceManifestPathSync(installLocation);
		if (!manifestPath) {
			throw new Error(`Marketplace manifest not found under: ${installLocation}`);
		}
		return {
			manifestPath,
			installLocation,
			isTemp: false,
			cleanup: () => {},
		};
	}

	const tempRoot = makeTempDir('async-marketplace');
	try {
		if (source.kind === 'url') {
			const manifestPath = path.join(tempRoot, 'marketplace.json');
			await downloadFile(source.url, manifestPath);
			return {
				manifestPath,
				installLocation: manifestPath,
				isTemp: true,
				cleanup: () => safeRemove(tempRoot),
			};
		}

		const repoDir = path.join(tempRoot, 'repo');
		await cloneRepo(source, repoDir);
		const manifestPath = resolveMarketplaceManifestPathSync(repoDir);
		if (!manifestPath) {
			throw new Error('Marketplace manifest not found in cloned repository.');
		}
		return {
			manifestPath,
			installLocation: repoDir,
			isTemp: true,
			cleanup: () => safeRemove(tempRoot),
		};
	} catch (error) {
		safeRemove(tempRoot);
		throw error;
	}
}

function finalMarketplaceLocation(source: MarketplaceSource, marketplaceName: string): string | null {
	if (source.kind === 'directory' || source.kind === 'file') {
		return null;
	}
	const root = getMarketplaceCacheRoot();
	if (source.kind === 'url') {
		return path.join(root, `${sanitizeSlug(marketplaceName)}.json`);
	}
	return path.join(root, sanitizeSlug(marketplaceName));
}

function ensureManagedRemoval(targetPath: string): void {
	const cacheRoot = getMarketplaceCacheRoot();
	const resolved = path.resolve(targetPath);
	if (!isPathInsideRoot(resolved, cacheRoot)) {
		throw new Error(`Refusing to remove unmanaged path: ${resolved}`);
	}
	safeRemove(resolved);
}

function readPluginManifestSummary(pluginDir: string): {
	name: string;
	version: string | null;
	description: string | null;
	disabled: boolean;
} {
	const manifestPath = resolvePluginManifestPathSync(pluginDir);
	if (!manifestPath) {
		return {
			name: path.basename(pluginDir),
			version: null,
			description: null,
			disabled: false,
		};
	}
	const parsed = readJsonFile<Record<string, unknown>>(manifestPath) ?? {};
	return {
		name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : path.basename(pluginDir),
		version: typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null,
		description:
			typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : null,
		disabled: parsed.disabled === true,
	};
}

function scanInstalledPluginsInRoot(root: string | null, scope: PluginInstallScope): InstalledPluginView[] {
	if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
		return [];
	}
	const out: InstalledPluginView[] = [];
	for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
		if (!ent.isDirectory()) {
			continue;
		}
		const pluginDir = path.join(root, ent.name);
		if (!isRecognizedPluginDirectorySync(pluginDir)) {
			continue;
		}
		const meta = readAsyncPluginInstallMetaSync(pluginDir);
		const manifest = readPluginManifestSummary(pluginDir);
		const pluginName =
			typeof meta?.pluginName === 'string' && meta.pluginName.trim() ? meta.pluginName.trim() : manifest.name;
		const marketplaceName =
			typeof meta?.marketplaceName === 'string' && meta.marketplaceName.trim() ? meta.marketplaceName.trim() : null;
		const version =
			typeof meta?.version === 'string' && meta.version.trim() ? meta.version.trim() : manifest.version;
		out.push({
			id: `${scope}:${pluginDir.replace(/\\/g, '/')}`,
			pluginName,
			displayName: pluginName,
			marketplaceName,
			scope,
			installDir: pluginDir,
			enabled: meta?.disabled !== true && !manifest.disabled,
			version,
			description: manifest.description,
			sourceKind: marketplaceName ? 'marketplace' : 'local',
		});
	}
	return out.sort((a, b) => a.pluginName.localeCompare(b.pluginName) || a.scope.localeCompare(b.scope));
}

function marketplacePluginInstalls(
	installed: InstalledPluginView[],
	marketplaceName: string,
	pluginName: string,
) {
	return installed
		.filter((item) => item.pluginName === pluginName && item.marketplaceName === marketplaceName)
		.map((item) => ({
			scope: item.scope,
			installDir: item.installDir,
			enabled: item.enabled,
			version: item.version,
		}))
		.sort((a, b) => a.scope.localeCompare(b.scope));
}

function pluginViewFromEntry(
	entry: MarketplacePluginEntry,
	installed: InstalledPluginView[],
	marketplaceName: string,
): MarketplacePluginView | null {
	const name = typeof entry.name === 'string' ? entry.name.trim() : '';
	if (!name) {
		return null;
	}
	return {
		name,
		description: typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim() : null,
		version: typeof entry.version === 'string' && entry.version.trim() ? entry.version.trim() : null,
		category: typeof entry.category === 'string' && entry.category.trim() ? entry.category.trim() : null,
		tags: Array.isArray(entry.tags)
			? entry.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())
			: [],
		sourceKind: normalizePluginSourceKind(entry.source),
		installs: marketplacePluginInstalls(installed, marketplaceName, name),
	};
}

export async function getPluginPanelState(workspaceRoot: string | null): Promise<PluginPanelState> {
	const userPluginsRoot = getUserPluginsRoot();
	const defaultUserPluginsRoot = getDefaultUserPluginsRoot();
	const projectPluginsRoot = getProjectPluginsRoot(workspaceRoot);
	const installed = [
		...scanInstalledPluginsInRoot(userPluginsRoot, 'user'),
		...scanInstalledPluginsInRoot(projectPluginsRoot, 'project'),
	];
	const marketplacesConfig = loadKnownMarketplaces();
	const marketplaces: MarketplaceView[] = Object.values(marketplacesConfig)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => {
			try {
				const { manifest, plugins } = loadMarketplaceManifestFile(entry.manifestPath);
				return {
					name: entry.name,
					description:
						typeof manifest.metadata?.description === 'string' && manifest.metadata.description.trim()
							? manifest.metadata.description.trim()
							: null,
					sourceKind: sourceKindOfMarketplace(entry.source),
					sourceLabel: sourceLabelOfMarketplace(entry.source),
					installLocation: entry.installLocation,
					manifestPath: entry.manifestPath,
					pluginCount: plugins.length,
					isLocal: entry.source.kind === 'directory' || entry.source.kind === 'file',
					canRefresh: entry.source.kind !== 'directory' && entry.source.kind !== 'file',
					plugins: plugins
						.map((plugin) => pluginViewFromEntry(plugin, installed, entry.name))
						.filter((plugin): plugin is MarketplacePluginView => plugin != null)
						.sort((a, b) => a.name.localeCompare(b.name)),
					error: null,
				} satisfies MarketplaceView;
			} catch (error) {
				return {
					name: entry.name,
					description: null,
					sourceKind: sourceKindOfMarketplace(entry.source),
					sourceLabel: sourceLabelOfMarketplace(entry.source),
					installLocation: entry.installLocation,
					manifestPath: entry.manifestPath,
					pluginCount: 0,
					isLocal: entry.source.kind === 'directory' || entry.source.kind === 'file',
					canRefresh: entry.source.kind !== 'directory' && entry.source.kind !== 'file',
					plugins: [],
					error: toErrorMessage(error, 'Failed to load marketplace'),
				} satisfies MarketplaceView;
			}
		});

	return {
		userPluginsRoot,
		defaultUserPluginsRoot,
		userPluginsRootCustomized: path.resolve(userPluginsRoot) !== path.resolve(defaultUserPluginsRoot),
		projectPluginsRoot,
		installed,
		marketplaces,
	};
}

export function setConfiguredUserPluginsRoot(nextPath: string | null | undefined): {
	userPluginsRoot: string;
	defaultUserPluginsRoot: string;
	userPluginsRootCustomized: boolean;
} {
	const defaultUserPluginsRoot = getDefaultUserPluginsRoot();
	const trimmed = typeof nextPath === 'string' ? nextPath.trim() : '';
	if (trimmed) {
		const resolved = path.resolve(trimmed);
		if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
			throw new Error(`Selected plugin directory is not a folder: ${resolved}`);
		}
		fs.mkdirSync(resolved, { recursive: true });
		patchSettings({
			plugins: {
				userPluginsDir:
					path.resolve(resolved).replace(/\\/g, '/').toLowerCase() ===
					path.resolve(defaultUserPluginsRoot).replace(/\\/g, '/').toLowerCase()
						? null
						: resolved,
			},
		});
	} else {
		patchSettings({
			plugins: {
				userPluginsDir: null,
			},
		});
	}
	bumpPluginDiscoveryVersion();
	const userPluginsRoot = getUserPluginsRoot();
	return {
		userPluginsRoot,
		defaultUserPluginsRoot,
		userPluginsRootCustomized: path.resolve(userPluginsRoot) !== path.resolve(defaultUserPluginsRoot),
	};
}

export async function addMarketplaceFromInput(input: string): Promise<{ name: string; replaced: boolean }> {
	const source = await parseMarketplaceInput(input);
	const materialized = await materializeMarketplaceSourceToTemp(source);
	try {
		const { manifest } = loadMarketplaceManifestFile(materialized.manifestPath);
		const marketplaceName = String(manifest.name ?? '').trim();
		if (!marketplaceName) {
			throw new Error('Marketplace manifest is missing a valid name.');
		}
		const config = loadKnownMarketplaces();
		const previous = config[marketplaceName];
		const finalLocation = finalMarketplaceLocation(source, marketplaceName);
		let installLocation = materialized.installLocation;
		let manifestPath = materialized.manifestPath;

		if (finalLocation) {
			copyPathReplacing(materialized.installLocation, finalLocation);
			installLocation = finalLocation;
			const resolvedManifestPath = resolveMarketplaceManifestPathSync(finalLocation);
			if (!resolvedManifestPath) {
				throw new Error(`Marketplace manifest not found after caching: ${finalLocation}`);
			}
			manifestPath = resolvedManifestPath;
		}

		config[marketplaceName] = {
			name: marketplaceName,
			source,
			installLocation,
			manifestPath,
			lastSyncedAt: new Date().toISOString(),
		};
		saveKnownMarketplaces(config);

		if (
			previous &&
			previous.installLocation !== installLocation &&
			(previous.source.kind !== 'directory' && previous.source.kind !== 'file')
		) {
			ensureManagedRemoval(previous.installLocation);
		}

		return {
			name: marketplaceName,
			replaced: Boolean(previous),
		};
	} finally {
		materialized.cleanup();
	}
}

export async function refreshMarketplaceByName(name: string): Promise<void> {
	const config = loadKnownMarketplaces();
	const entry = config[name];
	if (!entry) {
		throw new Error(`Marketplace not found: ${name}`);
	}
	if (entry.source.kind === 'directory' || entry.source.kind === 'file') {
		const manifestPath = resolveMarketplaceManifestPathSync(entry.installLocation);
		if (!manifestPath) {
			throw new Error(`Marketplace manifest not found under: ${entry.installLocation}`);
		}
		config[name] = {
			...entry,
			manifestPath,
			lastSyncedAt: new Date().toISOString(),
		};
		saveKnownMarketplaces(config);
		return;
	}

	const materialized = await materializeMarketplaceSourceToTemp(entry.source);
	try {
		const { manifest } = loadMarketplaceManifestFile(materialized.manifestPath);
		const refreshedName = String(manifest.name ?? '').trim();
		if (refreshedName && refreshedName !== name) {
			throw new Error(`Marketplace name changed from "${name}" to "${refreshedName}". Please remove and add it again.`);
		}
		copyPathReplacing(materialized.installLocation, entry.installLocation);
		const manifestPath = resolveMarketplaceManifestPathSync(entry.installLocation);
		if (!manifestPath) {
			throw new Error(`Marketplace manifest missing after refresh: ${entry.installLocation}`);
		}
		config[name] = {
			...entry,
			manifestPath,
			lastSyncedAt: new Date().toISOString(),
		};
		saveKnownMarketplaces(config);
	} finally {
		materialized.cleanup();
	}
}

export async function removeMarketplaceByName(name: string): Promise<void> {
	const config = loadKnownMarketplaces();
	const entry = config[name];
	if (!entry) {
		throw new Error(`Marketplace not found: ${name}`);
	}
	delete config[name];
	saveKnownMarketplaces(config);
	if (entry.source.kind !== 'directory' && entry.source.kind !== 'file') {
		ensureManagedRemoval(entry.installLocation);
	}
}

function resolvePluginInstallRoot(scope: PluginInstallScope, workspaceRoot: string | null): string {
	if (scope === 'user') {
		return getUserPluginsRoot();
	}
	const projectRoot = getProjectPluginsRoot(workspaceRoot);
	if (!projectRoot) {
		throw new Error('Project scope requires an open workspace.');
	}
	return projectRoot;
}

function validateManagedPluginPath(installDir: string, workspaceRoot: string | null): string {
	const userRoot = getUserPluginsRoot();
	const projectRoot = getProjectPluginsRoot(workspaceRoot);
	const resolved = path.resolve(installDir);
	if (isPathInsideRoot(resolved, userRoot)) {
		return resolved;
	}
	if (projectRoot && isPathInsideRoot(resolved, projectRoot)) {
		return resolved;
	}
	throw new Error(`Refusing to modify unmanaged plugin path: ${resolved}`);
}

async function materializePluginSourceToTemp(
	marketplaceName: string,
	manifest: MarketplaceManifest,
	entry: MarketplacePluginEntry,
	marketplaceEntry: KnownMarketplaceEntry,
): Promise<{ stageDir: string; cleanup: () => void }> {
	const source = entry.source;
	if (typeof source === 'string') {
		const pluginRoot = marketplaceRootFromManifestPath(marketplaceEntry.manifestPath, manifest.metadata?.pluginRoot);
		if (!pluginRoot) {
			throw new Error(`Marketplace "${marketplaceName}" has an invalid metadata.pluginRoot.`);
		}
		const stageDir = path.resolve(pluginRoot, source);
		if (!isPathInsideRoot(stageDir, pluginRoot)) {
			throw new Error(`Plugin "${String(entry.name ?? '')}" resolves outside the marketplace root.`);
		}
		if (!fs.existsSync(stageDir) || !fs.statSync(stageDir).isDirectory()) {
			throw new Error(`Plugin source directory not found: ${stageDir}`);
		}
		if (!isRecognizedPluginDirectorySync(stageDir) && !canSynthesizePluginMetadata(entry)) {
			throw new Error(`Plugin source is missing plugin metadata: ${stageDir}`);
		}
		return { stageDir, cleanup: () => {} };
	}

	const sourceObj = pluginSourceObject(source);
	if (!sourceObj) {
		throw new Error(`Plugin "${String(entry.name ?? '')}" has an unsupported source.`);
	}

	const tempRoot = makeTempDir('async-plugin');
	try {
		const repoDir = path.join(tempRoot, 'repo');
		switch (sourceObj.source) {
			case 'github': {
				const repo = typeof sourceObj.repo === 'string' ? sourceObj.repo.trim() : '';
				if (!repo) {
					throw new Error(`Plugin "${String(entry.name ?? '')}" is missing a valid GitHub repo.`);
				}
				await cloneRepo(
					{
						kind: 'github',
						repo,
						ref: typeof sourceObj.ref === 'string' && sourceObj.ref.trim() ? sourceObj.ref.trim() : undefined,
						raw: repo,
					},
					repoDir
				);
				break;
			}
			case 'url':
			case 'git': {
				const url = typeof sourceObj.url === 'string' ? sourceObj.url.trim() : '';
				if (!url) {
					throw new Error(`Plugin "${String(entry.name ?? '')}" is missing a valid Git URL.`);
				}
				await cloneRepo(
					{
						kind: 'git',
						url,
						ref: typeof sourceObj.ref === 'string' && sourceObj.ref.trim() ? sourceObj.ref.trim() : undefined,
						raw: url,
					},
					repoDir
				);
				break;
			}
			case 'git-subdir': {
				const url = typeof sourceObj.url === 'string' ? sourceObj.url.trim() : '';
				const subdir = typeof sourceObj.path === 'string' ? sourceObj.path.trim() : '';
				if (!url || !subdir) {
					throw new Error(`Plugin "${String(entry.name ?? '')}" is missing a valid git-subdir source.`);
				}
				await cloneRepo(
					{
						kind: 'git',
						url,
						ref: typeof sourceObj.ref === 'string' && sourceObj.ref.trim() ? sourceObj.ref.trim() : undefined,
						raw: url,
					},
					repoDir
				);
				const stageDir = path.resolve(repoDir, subdir);
				if (!isPathInsideRoot(stageDir, repoDir)) {
					throw new Error(`Plugin "${String(entry.name ?? '')}" subdirectory resolves outside the repository.`);
				}
				if (!fs.existsSync(stageDir) || !fs.statSync(stageDir).isDirectory()) {
					throw new Error(`Plugin subdirectory not found: ${stageDir}`);
				}
				if (!isRecognizedPluginDirectorySync(stageDir) && !canSynthesizePluginMetadata(entry)) {
					throw new Error(`Plugin subdirectory is missing plugin metadata: ${stageDir}`);
				}
				return {
					stageDir,
					cleanup: () => safeRemove(tempRoot),
				};
			}
			case 'npm':
			case 'pip':
				throw new Error(`Plugin source "${sourceObj.source}" is not supported by Async yet.`);
			default:
				throw new Error(`Plugin source "${String(sourceObj.source || 'unknown')}" is not supported.`);
		}

		if (!isRecognizedPluginDirectorySync(repoDir) && !canSynthesizePluginMetadata(entry)) {
			throw new Error(`Plugin "${String(entry.name ?? '')}" does not contain a recognized plugin manifest.`);
		}
		return {
			stageDir: repoDir,
			cleanup: () => safeRemove(tempRoot),
		};
	} catch (error) {
		safeRemove(tempRoot);
		throw error;
	}
}

function writeInstallMeta(targetDir: string, meta: AsyncPluginInstallMeta): void {
	writeJsonAtomic(path.join(targetDir, ASYNC_PLUGIN_META_FILE), meta);
}

export async function installMarketplacePlugin(
	marketplaceName: string,
	pluginName: string,
	scope: PluginInstallScope,
	workspaceRoot: string | null,
): Promise<{ installDir: string }> {
	const config = loadKnownMarketplaces();
	const marketplaceEntry = config[marketplaceName];
	if (!marketplaceEntry) {
		throw new Error(`Marketplace not found: ${marketplaceName}`);
	}
	const { manifest, plugins } = loadMarketplaceManifestFile(marketplaceEntry.manifestPath);
	const pluginEntry = plugins.find((item) => typeof item.name === 'string' && item.name.trim() === pluginName);
	if (!pluginEntry) {
		throw new Error(`Plugin "${pluginName}" was not found in marketplace "${marketplaceName}".`);
	}

	const targetRoot = resolvePluginInstallRoot(scope, workspaceRoot);
	const targetDir = path.join(targetRoot, sanitizeSlug(pluginName));
	const staged = await materializePluginSourceToTemp(marketplaceName, manifest, pluginEntry, marketplaceEntry);
	try {
		if (!isRecognizedPluginDirectorySync(staged.stageDir) && !canSynthesizePluginMetadata(pluginEntry)) {
			throw new Error(`Plugin "${pluginName}" is missing a supported plugin manifest.`);
		}
		if (!isPathInsideRoot(targetDir, targetRoot)) {
			throw new Error(`Refusing to install outside the plugins directory: ${targetDir}`);
		}
		if (path.resolve(staged.stageDir) !== path.resolve(targetDir)) {
			copyPathReplacing(staged.stageDir, targetDir);
		}
		ensurePluginMetadataForInstall(targetDir, pluginName, pluginEntry);
		if (!isRecognizedPluginDirectorySync(targetDir)) {
			throw new Error(`Plugin "${pluginName}" is missing a supported plugin manifest.`);
		}
		writeInstallMeta(targetDir, {
			pluginId: `${pluginName}@${marketplaceName}`,
			pluginName,
			marketplaceName,
			version:
				typeof pluginEntry.version === 'string' && pluginEntry.version.trim() ? pluginEntry.version.trim() : undefined,
			installedAt: new Date().toISOString(),
			sourceKind: normalizePluginSourceKind(pluginEntry.source),
			disabled: false,
		});
		bumpPluginDiscoveryVersion();
		return { installDir: targetDir };
	} finally {
		staged.cleanup();
	}
}

export async function uninstallInstalledPlugin(installDir: string, workspaceRoot: string | null): Promise<void> {
	const validated = validateManagedPluginPath(installDir, workspaceRoot);
	safeRemove(validated);
	bumpPluginDiscoveryVersion();
}

export async function setInstalledPluginEnabled(
	installDir: string,
	enabled: boolean,
	workspaceRoot: string | null,
): Promise<void> {
	const validated = validateManagedPluginPath(installDir, workspaceRoot);
	if (!fs.existsSync(validated) || !fs.statSync(validated).isDirectory()) {
		throw new Error(`Plugin directory not found: ${validated}`);
	}
	const current = readAsyncPluginInstallMetaSync(validated);
	const manifest = readPluginManifestSummary(validated);
	writeInstallMeta(validated, {
		...current,
		pluginName:
			typeof current?.pluginName === 'string' && current.pluginName.trim() ? current.pluginName.trim() : manifest.name,
		version:
			typeof current?.version === 'string' && current.version.trim() ? current.version.trim() : manifest.version ?? undefined,
		disabled: !enabled,
	});
	bumpPluginDiscoveryVersion();
}
