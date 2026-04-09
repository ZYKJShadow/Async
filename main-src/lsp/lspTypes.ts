/** Pull diagnostics / LSP 返回的诊断项（与具体会话实现无关） */

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

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
