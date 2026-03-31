/**
 * Monaco ↔ 主进程 TypeScript LSP（跳转定义）。
 */
import type * as monacoApi from 'monaco-editor';
import { monacoWorkspaceRootRef } from './tsLspWorkspaceRef';
import { absolutePathToFileUrlString, joinWorkspacePosixPath } from './workspaceUri';

type ShellApi = NonNullable<Window['asyncShell']>;

let registered = false;

function modelUriStringForLsp(model: monacoApi.editor.ITextModel): string | null {
	const u = model.uri;
	if (u.scheme === 'file') {
		return u.toString(true);
	}
	const root = monacoWorkspaceRootRef.current;
	if (!root?.trim()) {
		return null;
	}
	let rel = u.path.replace(/^\//, '');
	try {
		rel = decodeURIComponent(rel);
	} catch {
		/* keep rel */
	}
	return absolutePathToFileUrlString(joinWorkspacePosixPath(root, rel));
}

function lspResultToMonacoLocation(
	monaco: typeof monacoApi,
	loc: unknown
): monacoApi.languages.Location | monacoApi.languages.LocationLink | null {
	if (loc == null) {
		return null;
	}
	if (Array.isArray(loc)) {
		return loc.length > 0 ? lspResultToMonacoLocation(monaco, loc[0]) : null;
	}
	if (typeof loc !== 'object') {
		return null;
	}
	const o = loc as Record<string, unknown>;
	if (typeof o.uri === 'string' && o.range && typeof o.range === 'object') {
		const r = o.range as Record<string, Record<string, number>>;
		const s = r.start ?? r.Start;
		const e = r.end ?? r.End;
		if (!s || !e) {
			return null;
		}
		return {
			uri: monaco.Uri.parse(o.uri),
			range: new monaco.Range(s.line + 1, s.character + 1, e.line + 1, e.character + 1),
		};
	}
	if (typeof o.targetUri === 'string' && o.targetRange && typeof o.targetRange === 'object') {
		const r = o.targetRange as Record<string, Record<string, number>>;
		const s = r.start ?? r.Start;
		const e = r.end ?? r.End;
		if (!s || !e) {
			return null;
		}
		return {
			uri: monaco.Uri.parse(o.targetUri),
			range: new monaco.Range(s.line + 1, s.character + 1, e.line + 1, e.character + 1),
		};
	}
	return null;
}

const TS_LIKE_LANGS = new Set(['typescript', 'javascript', 'typescriptreact', 'javascriptreact']);

/**
 * 全局注册一次 DefinitionProvider（多编辑器实例共享）。
 */
export function registerTsLspMonacoOnce(monaco: typeof monacoApi, shell: ShellApi, _workspaceRoot: string | null): void {
	void _workspaceRoot;
	if (registered) {
		return;
	}
	registered = true;

	for (const lang of TS_LIKE_LANGS) {
		monaco.languages.registerDefinitionProvider(lang, {
			async provideDefinition(model, position) {
				const uri = modelUriStringForLsp(model);
				if (!uri?.startsWith('file:')) {
					return null;
				}
				try {
					const raw = (await shell.invoke('lsp:ts:definition', {
						uri,
						line: position.lineNumber,
						column: position.column,
						text: model.getValue(),
					})) as { ok?: boolean; result?: unknown; error?: string };
					if (!raw?.ok) {
						return null;
					}
					return lspResultToMonacoLocation(monaco, raw.result);
				} catch {
					return null;
				}
			},
		});
	}
}
