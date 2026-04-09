/**
 * 用户配置的通用 stdio LSP 子进程（Python、Go、Rust 等），供 Agent **LSP** 工具按扩展名路由。
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import type { LspDiagnostic } from './lspTypes.js';

export type GenericLspSessionOptions = {
	command: string;
	args?: string[];
	/** 该服务器负责的扩展名 → LSP languageId；缺省按常见后缀猜测 */
	extensionToLanguage: Record<string, string>;
	/** 相对 workspaceRoot 的工作目录，缺省为 workspace 根 */
	cwdRelative?: string;
	/** 绝对工作目录；若设置则优先于 cwdRelative */
	absoluteCwd?: string;
	/** 与 process.env 合并后传给子进程 */
	env?: Record<string, string>;
	stderrTag: string;
};

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
	'.java': 'java',
	'.kt': 'kotlin',
	'.kts': 'kotlin',
	'.c': 'c',
	'.h': 'c',
	'.cpp': 'cpp',
	'.cc': 'cpp',
	'.cxx': 'cpp',
	'.hpp': 'cpp',
	'.cs': 'csharp',
	'.rb': 'ruby',
	'.php': 'php',
	'.swift': 'swift',
	'.scala': 'scala',
	'.vue': 'vue',
	'.ex': 'elixir',
	'.exs': 'elixir',
};

function normalizeExt(raw: string): string {
	const t = raw.trim().toLowerCase();
	return t.startsWith('.') ? t : `.${t}`;
}

function languageIdForUri(uri: string, map: Record<string, string>): string {
	let ext = '';
	try {
		ext = path.extname(fileURLToPath(uri)).toLowerCase();
	} catch {
		const i = uri.lastIndexOf('.');
		ext = i >= 0 ? uri.slice(i).toLowerCase() : '';
	}
	const n = normalizeExt(ext || '.txt');
	const explicit = map[n];
	if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
	return GUESS_LANG[n] ?? 'plaintext';
}

export class GenericLspSession {
	private child: cp.ChildProcess | null = null;
	private connection: ReturnType<typeof createMessageConnection> | null = null;
	private workspaceRoot: string | null = null;
	private readonly openedUris = new Set<string>();
	private readonly docVersions = new Map<string, number>();

	private readonly langMap: Record<string, string>;

	constructor(private readonly opts: GenericLspSessionOptions) {
		const norm: Record<string, string> = {};
		for (const [k, v] of Object.entries(opts.extensionToLanguage ?? {})) {
			if (typeof v === 'string' && v.trim()) norm[normalizeExt(k)] = v.trim();
		}
		this.langMap = norm;
	}

	async start(workspaceRoot: string): Promise<void> {
		await this.dispose();
		const root = path.resolve(workspaceRoot);
		this.workspaceRoot = root;
		let cwd: string;
		if (this.opts.absoluteCwd) {
			cwd = path.resolve(this.opts.absoluteCwd);
		} else if (this.opts.cwdRelative) {
			cwd = path.resolve(root, this.opts.cwdRelative.replace(/^[/\\]+/, ''));
		} else {
			cwd = root;
		}
		if (!fs.existsSync(cwd)) {
			throw new Error(`LSP cwd does not exist: ${cwd}`);
		}

		const args = this.opts.args ?? [];
		const spawnEnv = { ...process.env, ...this.opts.env };
		this.child = cp.spawn(this.opts.command, args, {
			cwd,
			env: spawnEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});

		if (!this.child.stdout || !this.child.stdin) {
			await this.dispose();
			throw new Error(`Failed to spawn LSP: ${this.opts.command}`);
		}

		this.child.stderr?.on('data', (buf) => {
			const s = buf.toString('utf8');
			if (s.trim()) {
				console.warn(`[${this.opts.stderrTag}]`, s.slice(0, 500));
			}
		});

		this.connection = createMessageConnection(
			new StreamMessageReader(this.child.stdout),
			new StreamMessageWriter(this.child.stdin),
			console
		);
		this.connection.onRequest('workspace/configuration' as never, (params: { items?: unknown[] }) => {
			return (params?.items ?? []).map(() => null);
		});

		this.connection.listen();

		const rootUri = pathToFileURL(root.endsWith(path.sep) ? root.slice(0, -1) : root).href;

		await this.connection.sendRequest('initialize' as never, {
			processId: null,
			clientInfo: { name: 'async-lsp', version: '0.1.0' },
			rootUri,
			capabilities: {
				textDocument: {
					definition: { linkSupport: true },
					references: { dynamicRegistration: false },
					hover: { contentFormat: ['markdown', 'plaintext'] },
					documentSymbol: {
						dynamicRegistration: false,
						hierarchicalDocumentSymbolSupport: true,
					},
					implementation: { linkSupport: true },
					callHierarchy: { dynamicRegistration: false },
					diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
				},
				workspace: {
					symbol: { dynamicRegistration: false },
				},
			},
			workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
		} as never);

		this.connection.sendNotification('initialized' as never, {} as never);
	}

	async syncDocument(uri: string, text: string): Promise<void> {
		if (!this.connection) throw new Error('LSP not started');
		const languageId = languageIdForUri(uri, this.langMap);
		if (!this.openedUris.has(uri)) {
			await this.connection.sendNotification('textDocument/didOpen' as never, {
				textDocument: { uri, languageId, version: 1, text },
			} as never);
			this.openedUris.add(uri);
			this.docVersions.set(uri, 1);
			return;
		}
		const v = (this.docVersions.get(uri) ?? 1) + 1;
		this.docVersions.set(uri, v);
		await this.connection.sendNotification('textDocument/didChange' as never, {
			textDocument: { uri, version: v },
			contentChanges: [{ text }],
		} as never);
	}

	async definition(uri: string, line: number, column: number, documentText: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, documentText);
		return await this.connection.sendRequest('textDocument/definition' as never, {
			textDocument: { uri },
			position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
		} as never);
	}

	async references(uri: string, line: number, column: number, documentText: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, documentText);
		return await this.connection.sendRequest('textDocument/references' as never, {
			textDocument: { uri },
			position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
			context: { includeDeclaration: true },
		} as never);
	}

	async hover(uri: string, line: number, column: number, documentText: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, documentText);
		return await this.connection.sendRequest('textDocument/hover' as never, {
			textDocument: { uri },
			position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
		} as never);
	}

	async documentSymbols(uri: string, documentText: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, documentText);
		return await this.connection.sendRequest('textDocument/documentSymbol' as never, {
			textDocument: { uri },
		} as never);
	}

	async workspaceSymbol(query: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		return await this.connection.sendRequest('workspace/symbol' as never, {
			query: query ?? '',
		} as never);
	}

	async implementation(uri: string, line: number, column: number, documentText: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, documentText);
		return await this.connection.sendRequest('textDocument/implementation' as never, {
			textDocument: { uri },
			position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
		} as never);
	}

	async prepareCallHierarchy(uri: string, line: number, column: number, documentText: string): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, documentText);
		return await this.connection.sendRequest('textDocument/prepareCallHierarchy' as never, {
			textDocument: { uri },
			position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
		} as never);
	}

	async incomingCalls(item: unknown): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		return await this.connection.sendRequest('callHierarchy/incomingCalls' as never, { item } as never);
	}

	async outgoingCalls(item: unknown): Promise<unknown> {
		if (!this.connection) throw new Error('LSP not started');
		return await this.connection.sendRequest('callHierarchy/outgoingCalls' as never, { item } as never);
	}

	async diagnostics(uri: string, text: string): Promise<LspDiagnostic[] | null> {
		if (!this.connection) throw new Error('LSP not started');
		await this.syncDocument(uri, text);
		await new Promise<void>((r) => setTimeout(r, 400));
		try {
			const result = (await this.connection.sendRequest('textDocument/diagnostic' as never, {
				textDocument: { uri },
			} as never)) as { kind: string; items: LspDiagnostic[] } | null;
			return result?.items ?? [];
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('not supported') || msg.includes('MethodNotFound') || msg.includes('-32601')) {
				return null;
			}
			throw e;
		}
	}

	async dispose(): Promise<void> {
		try {
			this.connection?.dispose();
		} catch {
			/* ignore */
		}
		this.connection = null;
		if (this.child) {
			this.child.kill('SIGTERM');
			this.child = null;
		}
		this.workspaceRoot = null;
		this.openedUris.clear();
		this.docVersions.clear();
	}

	get isRunning(): boolean {
		return this.connection != null && this.child != null;
	}
}
