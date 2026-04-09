import * as path from 'node:path';
import { getCachedAsyncDataDir } from '../dataDir.js';
import type { ShellSettings } from '../settingsStore.js';
import { getBuiltinTypescriptScopedServers } from './bundledTypescriptLsp.js';
import type { ScopedLspServerConfig } from './pluginLspTypes.js';
import { discoverPluginSubdirs, loadScopedServersForPluginDir, scopedServersFromSettingsLsp } from './loadPluginLspConfig.js';

export type GetAllLspServersOptions = {
	workspaceRoot: string;
	appPath: string;
	settings: ShellSettings;
};

/**
 * 合并 LSP 来源（与 Claude Code 思路一致：插件目录 + 作用域名；Async 另含可选的 TSLS 路径探测与 settings 迁移）。
 * 同一扩展名多服务器时，**后合并的覆盖先合并的**（工作区插件优先于用户目录与内置）。
 */
export async function getAllLspServers(opts: GetAllLspServersOptions): Promise<Record<string, ScopedLspServerConfig>> {
	const merged: Record<string, ScopedLspServerConfig> = {};

	Object.assign(merged, getBuiltinTypescriptScopedServers(opts.appPath));

	const asyncDataPlugins = path.join(getCachedAsyncDataDir(), 'plugins');
	for (const dir of await discoverPluginSubdirs(asyncDataPlugins)) {
		Object.assign(merged, await loadScopedServersForPluginDir(dir));
	}

	Object.assign(merged, scopedServersFromSettingsLsp(opts.settings.lsp?.servers));

	const ws = path.resolve(opts.workspaceRoot);
	const wsPlugins = path.join(ws, '.async', 'plugins');
	for (const dir of await discoverPluginSubdirs(wsPlugins)) {
		Object.assign(merged, await loadScopedServersForPluginDir(dir));
	}

	return merged;
}
