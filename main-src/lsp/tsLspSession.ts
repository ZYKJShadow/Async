/**
 * 主进程内 TypeScript/JavaScript Language Server（typescript-language-server）会话。
 * 用于 Monaco 跳转定义等；文档内容通过 didOpen / didChange 从渲染端传入。
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4; // error | warning | info | hint

export type LspDiagnostic = {
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	severity?: LspDiagnosticSeverity;
	code?: string | number;
	source?: string;
	message: string;
};

function findTslsCli(): string | null {
	const candidates = [
		...(typeof app?.getAppPath === 'function'
			? [path.join(app.getAppPath(), 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')]
			: []),
		path.join(process.cwd(), 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'),
		path.join(__dirname, '..', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'),
		path.join(__dirname, '..', '..', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'),
	];
	for (const c of candidates) {
		if (fs.existsSync(c)) {
			return c;
		}
	}
	return null;
}

function languageIdFromUri(uri: string): string {
	const lower = uri.toLowerCase();
	if (lower.endsWith('.tsx')) return 'typescriptreact';
	if (lower.endsWith('.jsx')) return 'javascriptreact';
	if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'typescript';
	return 'javascript';
}

export class TsLspSession {
	private child: cp.ChildProcess | null = null;
	private connection: ReturnType<typeof createMessageConnection> | null = null;
	private workspaceRoot: string | null = null;
	private readonly openedUris = new Set<string>();
	private readonly docVersions = new Map<string, number>();

	async start(workspaceRoot: string): Promise<void> {
		await this.dispose();
		const cli = findTslsCli();
		if (!cli) {
			throw new Error('未找到 typescript-language-server（请确保已 npm install）。');
		}
		const root = path.resolve(workspaceRoot);
		this.workspaceRoot = root;

		this.child = cp.spawn(process.platform === 'win32' ? 'node.exe' : 'node', [cli, '--stdio'], {
			cwd: root,
			env: { ...process.env },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		if (!this.child.stdout || !this.child.stdin) {
			await this.dispose();
			throw new Error('无法启动 language server 子进程。');
		}

		this.child.stderr?.on('data', (buf) => {
			const s = buf.toString('utf8');
			if (s.trim()) {
				console.warn('[ts-lsp]', s.slice(0, 500));
			}
		});

		this.connection = createMessageConnection(
			new StreamMessageReader(this.child.stdout),
			new StreamMessageWriter(this.child.stdin),
			console
		);
		this.connection.listen();

		const rootUri = pathToFileURL(root.endsWith(path.sep) ? root.slice(0, -1) : root).href;

		await this.connection.sendRequest('initialize' as never, {
			processId: null,
			clientInfo: { name: 'async-shell', version: '0.0.2' },
			rootUri,
			capabilities: {
				textDocument: {
					definition: { linkSupport: true },
					diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
				},
				workspace: {},
			},
			workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
		} as never);

		this.connection.sendNotification('initialized' as never, {} as never);
	}

	async syncDocument(uri: string, text: string): Promise<void> {
		if (!this.connection) {
			throw new Error('LSP 未启动');
		}
		const languageId = languageIdFromUri(uri);
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
		if (!this.connection) {
			throw new Error('LSP 未启动');
		}
		await this.syncDocument(uri, documentText);
		const result = await this.connection.sendRequest('textDocument/definition' as never, {
			textDocument: { uri },
			position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
		} as never);
		return result;
	}

	/**
	 * 拉取文件诊断（错误/警告）。
	 * 使用 LSP 3.17 pull diagnostics（textDocument/diagnostic）。
	 * 若服务器不支持，返回 null 作为降级信号。
	 */
	async diagnostics(uri: string, text: string): Promise<LspDiagnostic[] | null> {
		if (!this.connection) {
			throw new Error('LSP 未启动');
		}
		await this.syncDocument(uri, text);
		// 等待 tsls 处理文档（pull diagnostics 需要服务器完成类型检查）
		await new Promise<void>((r) => setTimeout(r, 800));
		try {
			const result = await this.connection.sendRequest('textDocument/diagnostic' as never, {
				textDocument: { uri },
			} as never) as { kind: string; items: LspDiagnostic[] } | null;
			return result?.items ?? [];
		} catch (e: unknown) {
			// 服务器不支持 pull diagnostics 时降级
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
