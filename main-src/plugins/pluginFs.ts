import * as fs from 'node:fs';
import * as path from 'node:path';

export const ASYNC_PLUGIN_META_FILE = '.async-plugin.json';
const CLAUDE_PLUGIN_DIR = '.claude-plugin';
const CODEX_PLUGIN_DIR = '.codex-plugin';
const MANIFEST_PLUGIN_DIRS = new Set([CLAUDE_PLUGIN_DIR, CODEX_PLUGIN_DIR]);

export type AsyncPluginInstallMeta = {
	pluginId?: string;
	pluginName?: string;
	marketplaceName?: string;
	version?: string;
	installedAt?: string;
	sourceKind?: string;
	disabled?: boolean;
};

function firstExistingFile(paths: string[]): string | null {
	for (const candidate of paths) {
		try {
			if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
				return candidate;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

export function resolvePluginManifestPathSync(pluginDir: string): string | null {
	return firstExistingFile([
		path.join(pluginDir, 'plugin.json'),
		path.join(pluginDir, CLAUDE_PLUGIN_DIR, 'plugin.json'),
		path.join(pluginDir, CODEX_PLUGIN_DIR, 'plugin.json'),
	]);
}

export function resolveClaudePluginManifestPathSync(pluginDir: string): string | null {
	return firstExistingFile([
		path.join(pluginDir, 'plugin.json'),
		path.join(pluginDir, CLAUDE_PLUGIN_DIR, 'plugin.json'),
	]);
}

export function resolveCodexPluginManifestPathSync(pluginDir: string): string | null {
	return firstExistingFile([path.join(pluginDir, CODEX_PLUGIN_DIR, 'plugin.json')]);
}

export function resolvePluginLspConfigPathSync(pluginDir: string): string | null {
	return firstExistingFile([
		path.join(pluginDir, '.lsp.json'),
		path.join(pluginDir, CLAUDE_PLUGIN_DIR, '.lsp.json'),
	]);
}

export function isRecognizedPluginDirectorySync(pluginDir: string): boolean {
	return Boolean(resolvePluginManifestPathSync(pluginDir) || resolvePluginLspConfigPathSync(pluginDir));
}

export function resolveMarketplaceManifestPathSync(inputPath: string): string | null {
	try {
		const abs = path.resolve(inputPath);
		if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
			return path.basename(abs).toLowerCase() === 'marketplace.json' ? abs : null;
		}
		if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
			return firstExistingFile([
				path.join(abs, CLAUDE_PLUGIN_DIR, 'marketplace.json'),
				path.join(abs, 'marketplace.json'),
			]);
		}
	} catch {
		/* ignore */
	}
	return null;
}

export function pluginContentRootFromManifestPath(manifestPath: string): string {
	const abs = path.resolve(manifestPath);
	const parent = path.dirname(abs);
	return MANIFEST_PLUGIN_DIRS.has(path.basename(parent).toLowerCase()) ? path.dirname(parent) : parent;
}

export function readAsyncPluginInstallMetaSync(pluginDir: string): AsyncPluginInstallMeta | null {
	const metaPath = path.join(pluginDir, ASYNC_PLUGIN_META_FILE);
	try {
		if (!fs.existsSync(metaPath) || !fs.statSync(metaPath).isFile()) {
			return null;
		}
		const raw = fs.readFileSync(metaPath, 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}
		return parsed as AsyncPluginInstallMeta;
	} catch {
		return null;
	}
}
