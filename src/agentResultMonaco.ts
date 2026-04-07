/**
 * 用 Monaco 的 colorize 为 Agent 结果卡片生成行级 HTML（与主编辑器主题一致）。
 *
 * 全局最多并发 2 次 Monaco colorize，避免多卡片同时抢主线程 / worker。
 *
 * Monaco 通过动态 import() 延迟加载：只有当卡片首次需要语法着色时才拉取 monaco chunk，
 * 避免 Agent 窗口在首屏就同步加载 3MB+ 的 monaco-editor 包。
 */
import { getVoidMonacoThemeFromDom } from './colorMode';

let _monacoModule: typeof import('monaco-editor') | null = null;

async function getMonaco(): Promise<typeof import('monaco-editor')> {
	if (_monacoModule) return _monacoModule;
	// 动态加载时先确保主题已注册（monacoSetup 是幂等的，多次 import 安全）
	const [monacoMod] = await Promise.all([
		import('monaco-editor'),
		import('./monacoSetup'),
	]);
	_monacoModule = monacoMod;
	return monacoMod;
}

const COLORIZE_MAX_PARALLEL = 2;
let colorizeActive = 0;
const colorizeWaitQueue: Array<() => void> = [];

function acquireColorizeSlot(): Promise<void> {
	if (colorizeActive < COLORIZE_MAX_PARALLEL) {
		colorizeActive++;
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		colorizeWaitQueue.push(() => {
			colorizeActive++;
			resolve();
		});
	});
}

function releaseColorizeSlot(): void {
	colorizeActive--;
	const next = colorizeWaitQueue.shift();
	if (next) next();
}

/** 将单次 Monaco 着色包进全局并发池（卡片侧应通过此路径调用，避免嵌套死锁请用 *Direct）。 */
export async function runMonacoColorizeTask<T>(fn: () => Promise<T>): Promise<T> {
	await acquireColorizeSlot();
	try {
		return await fn();
	} finally {
		releaseColorizeSlot();
	}
}

const EXT_TO_LANG: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	json: 'json',
	md: 'markdown',
	css: 'css',
	scss: 'scss',
	less: 'less',
	html: 'html',
	htm: 'html',
	xml: 'xml',
	yml: 'yaml',
	yaml: 'yaml',
	py: 'python',
	rs: 'rust',
	go: 'go',
	java: 'java',
	cs: 'csharp',
	kt: 'kotlin',
	swift: 'swift',
	rb: 'ruby',
	php: 'php',
	sql: 'sql',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	ps1: 'powershell',
	psm1: 'powershell',
	vue: 'html',
	svelte: 'html',
	c: 'c',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	h: 'c',
	hpp: 'cpp',
	ini: 'ini',
	toml: 'ini',
};

export function languageIdFromPath(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? '';
	const dot = base.lastIndexOf('.');
	if (dot <= 0) return 'plaintext';
	const ext = base.slice(dot + 1).toLowerCase();
	return EXT_TO_LANG[ext] ?? 'plaintext';
}

function splitMonacoColorizedHtml(html: string): string[] {
	const parts = html.split(/<br\s*\/?>/i);
	while (parts.length && parts[parts.length - 1]!.trim() === '') {
		parts.pop();
	}
	return parts;
}

/** 将多行文本一次性着色，再按行拆开（保留跨行 token 状态）；不经并发池，仅供池内或批处理调用。 */
async function colorizeJoinedLinesDirect(
	lines: string[],
	languageId: string
): Promise<string[] | null> {
	if (lines.length === 0) return [];
	const text = lines.join('\n');
	try {
		const monaco = await getMonaco();
		monaco.editor.setTheme(getVoidMonacoThemeFromDom());
		// 确保语言已被 Monaco 识别
		const html = await monaco.editor.colorize(text, languageId, {});
		let out = splitMonacoColorizedHtml(html);
		if (out.length < lines.length) {
			while (out.length < lines.length) out.push('');
		} else if (out.length > lines.length) {
			out = out.slice(0, lines.length);
		}
		return out;
	} catch {
		return null;
	}
}

/** 将多行文本一次性着色（占一个全局并发槽位） */
export async function colorizeJoinedLines(lines: string[], languageId: string): Promise<string[] | null> {
	return runMonacoColorizeTask(() => colorizeJoinedLinesDirect(lines, languageId));
}

/**
 * search 结果按语言分组后分批 colorize（每语言一次 join），避免 N 路 Promise.all 打爆 Monaco。
 * 不经并发池的内部调用使用 Direct。
 */
async function colorizeSearchMatchLinesDirect(
	lines: readonly { matchText?: string; filePath?: string }[]
): Promise<(string | null)[] | null> {
	if (lines.length === 0) return [];
	try {
		const monaco = await getMonaco();
		monaco.editor.setTheme(getVoidMonacoThemeFromDom());
		type Bucket = { indices: number[]; texts: string[] };
		const buckets = new Map<string, Bucket>();
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i]!;
			const text = l.matchText ?? '';
			if (!text) continue;
			const lang = l.filePath ? languageIdFromPath(l.filePath) : 'plaintext';
			let b = buckets.get(lang);
			if (!b) {
				b = { indices: [], texts: [] };
				buckets.set(lang, b);
			}
			b.indices.push(i);
			b.texts.push(text);
		}
		const out: (string | null)[] = new Array(lines.length).fill(null);
		for (let i = 0; i < lines.length; i++) {
			if (!(lines[i]!.matchText ?? '')) out[i] = '';
		}
		for (const [lang, bucket] of buckets) {
			const parts = await colorizeJoinedLinesDirect(bucket.texts, lang);
			if (!parts) continue;
			for (let j = 0; j < bucket.indices.length; j++) {
				out[bucket.indices[j]!] = parts[j] ?? '';
			}
		}
		return out;
	} catch {
		return null;
	}
}

/** search 每行可能来自不同扩展名：对 match 片段按行文件路径着色（单槽内批处理） */
export async function colorizeSearchMatchLines(
	lines: readonly { matchText?: string; filePath?: string }[]
): Promise<(string | null)[] | null> {
	return runMonacoColorizeTask(() => colorizeSearchMatchLinesDirect(lines));
}
