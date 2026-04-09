/**
 * 与 Claude Code 插件 LSP 声明同构的配置形态（见 claude-code `LspServerConfig` / `ScopedLspServerConfig`）。
 */

export type LspServerConfig = {
	command: string;
	args?: string[];
	extensionToLanguage: Record<string, string>;
	transport?: 'stdio' | 'socket';
	env?: Record<string, string>;
	/** 工作区目录：可为绝对路径，或含 ${VAR}，在解析后用于子进程 cwd */
	workspaceFolder?: string;
	/** 相对当前工作区根的路径（Async 对 settings.lsp.servers 的 cwd 的兼容字段） */
	cwdRelative?: string;
};

export type ScopedLspServerConfig = LspServerConfig & {
	scope: 'dynamic' | 'settings' | 'builtin';
	source: string;
};
