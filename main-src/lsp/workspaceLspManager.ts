/**
 * 按文件扩展名将 LSP 路由到 **插件**（`.lsp.json` / `plugin.json#lspServers`）及可选的 settings 迁移项；
 * 与 Claude Code「由插件登记、作用域名 `plugin:name:server`」同构。
 */

import * as path from 'node:path';
import { getAllLspServers } from '../plugins/getAllLspServers.js';
import type { ScopedLspServerConfig } from '../plugins/pluginLspTypes.js';
import type { ShellSettings } from '../settingsStore.js';
import { GenericLspSession, type GenericLspSessionOptions } from './genericLspSession.js';

export type LspEditorSession = GenericLspSession;

function normalizeExt(raw: string): string {
	const t = String(raw).trim().toLowerCase();
	return t.startsWith('.') ? t : `.${t}`;
}

function buildExtensionToServerId(servers: Record<string, ScopedLspServerConfig>): Map<string, string> {
	const m = new Map<string, string>();
	for (const [scopedId, cfg] of Object.entries(servers)) {
		for (const ext of Object.keys(cfg.extensionToLanguage ?? {})) {
			m.set(normalizeExt(ext), scopedId);
		}
	}
	return m;
}

function genericOptsFromScoped(scopedId: string, cfg: ScopedLspServerConfig): GenericLspSessionOptions {
	let absoluteCwd: string | undefined;
	let cwdRelative: string | undefined;
	if (cfg.workspaceFolder?.trim()) {
		const wf = cfg.workspaceFolder.trim();
		if (path.isAbsolute(wf)) {
			absoluteCwd = wf;
		} else {
			cwdRelative = wf.replace(/^[/\\]+/, '');
		}
	} else if (cfg.cwdRelative?.trim()) {
		cwdRelative = cfg.cwdRelative.trim().replace(/^[/\\]+/, '');
	}

	return {
		command: cfg.command,
		args: cfg.args,
		extensionToLanguage: cfg.extensionToLanguage,
		cwdRelative,
		absoluteCwd,
		env: cfg.env,
		stderrTag: `lsp-${scopedId.replace(/:/g, '-')}`,
	};
}

export class WorkspaceLspManager {
	private readonly genericById = new Map<string, GenericLspSession>();
	private cache: { root: string; lspKey: string; servers: Record<string, ScopedLspServerConfig> } | null = null;

	constructor(
		private readonly getSettings: () => ShellSettings,
		private readonly getAppPath: () => string,
	) {}

	private lspSettingsFingerprint(settings: ShellSettings): string {
		try {
			return JSON.stringify(settings.lsp?.servers ?? []);
		} catch {
			return '';
		}
	}

	private async resolveServers(workspaceRoot: string): Promise<Record<string, ScopedLspServerConfig>> {
		const root = path.resolve(workspaceRoot);
		const settings = this.getSettings();
		const lspKey = this.lspSettingsFingerprint(settings);
		if (this.cache?.root === root && this.cache.lspKey === lspKey) {
			return this.cache.servers;
		}
		const servers = await getAllLspServers({
			workspaceRoot: root,
			appPath: this.getAppPath(),
			settings,
		});
		this.cache = { root, lspKey, servers };
		return servers;
	}

	/**
	 * 解析并启动负责该绝对路径的 LSP 会话；无匹配服务器时返回 null。
	 */
	async sessionForFile(absPath: string, workspaceRoot: string): Promise<LspEditorSession | null> {
		const ext = path.extname(absPath).toLowerCase();
		const servers = await this.resolveServers(workspaceRoot);
		const map = buildExtensionToServerId(servers);
		const scopedId = map.get(ext);
		if (!scopedId) return null;

		const cfg = servers[scopedId];
		if (!cfg?.command?.trim()) return null;

		let g = this.genericById.get(scopedId);
		if (!g) {
			g = new GenericLspSession(genericOptsFromScoped(scopedId, cfg));
			this.genericById.set(scopedId, g);
		}

		if (!g.isRunning) await g.start(path.resolve(workspaceRoot));
		return g;
	}

	async dispose(): Promise<void> {
		this.cache = null;
		for (const g of this.genericById.values()) {
			await g.dispose().catch(() => {});
		}
		this.genericById.clear();
	}
}
