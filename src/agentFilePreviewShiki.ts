import type { BundledLanguage, BundledTheme, Highlighter } from 'shiki';
import type { AgentFilePreviewRow } from './agentFilePreviewDiff';
import type { EffectiveColorScheme } from './colorMode';

export const AGENT_FILE_PREVIEW_SHIKI_THEME_DARK = 'github-dark' as const;
export const AGENT_FILE_PREVIEW_SHIKI_THEME_LIGHT = 'github-light-default' as const;

type ShikiHighlighter = Highlighter;

function asBundledLang(lang: string): BundledLanguage {
	return lang as BundledLanguage;
}

const EXT_TO_LANG: Record<string, string> = {
	ts: 'typescript',
	tsx: 'tsx',
	mts: 'typescript',
	cts: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	json: 'json',
	jsonc: 'jsonc',
	md: 'markdown',
	mdx: 'mdx',
	css: 'css',
	scss: 'scss',
	sass: 'sass',
	less: 'less',
	html: 'html',
	htm: 'html',
	vue: 'vue',
	svelte: 'svelte',
	py: 'python',
	pyw: 'python',
	rs: 'rust',
	go: 'go',
	java: 'java',
	kt: 'kotlin',
	kts: 'kotlin',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	h: 'cpp',
	hpp: 'cpp',
	c: 'c',
	cs: 'csharp',
	rb: 'ruby',
	php: 'php',
	swift: 'swift',
	sql: 'sql',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	xml: 'xml',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	ps1: 'powershell',
	dockerfile: 'dockerfile',
};

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

export function resolveAgentFilePreviewShikiTheme(colorScheme: EffectiveColorScheme): BundledTheme {
	return colorScheme === 'light'
		? AGENT_FILE_PREVIEW_SHIKI_THEME_LIGHT
		: AGENT_FILE_PREVIEW_SHIKI_THEME_DARK;
}

export function agentFilePreviewPathToLang(filePath: string): string {
	const seg = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
	const i = seg.lastIndexOf('.');
	if (i < 0) {
		return 'plaintext';
	}
	const ext = seg.slice(i + 1).toLowerCase();
	return EXT_TO_LANG[ext] ?? 'plaintext';
}

/**
 * JavaScript 正则引擎，避免 Oniguruma WASM 在 Electron `file://` 等环境下的问题。
 */
export async function getAgentFilePreviewHighlighter(): Promise<ShikiHighlighter> {
	if (!highlighterPromise) {
		const { createHighlighter, createJavaScriptRegexEngine } = await import('shiki');
		highlighterPromise = createHighlighter({
			themes: [AGENT_FILE_PREVIEW_SHIKI_THEME_DARK, AGENT_FILE_PREVIEW_SHIKI_THEME_LIGHT],
			langs: ['plaintext'],
			engine: createJavaScriptRegexEngine(),
		});
	}
	return highlighterPromise;
}

export async function ensureAgentFilePreviewLang(lang: string): Promise<string> {
	const h = await getAgentFilePreviewHighlighter();
	if (h.getLoadedLanguages().includes(lang)) {
		return lang;
	}
	try {
		await h.loadLanguage(asBundledLang(lang));
		return lang;
	} catch {
		await h.loadLanguage('plaintext');
		return 'plaintext';
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * 行内 HTML（各 span 带 style="color:…"），用 dangerouslySetInnerHTML 渲染，不依赖外层 CSS 传色。
 */
export function shikiLineToInlineHtml(
	h: ShikiHighlighter,
	lineText: string,
	lang: string,
	colorScheme: EffectiveColorScheme = 'dark'
): string {
	const raw = lineText === '' ? ' ' : lineText;
	try {
		return h.codeToHtml(raw, {
			lang: asBundledLang(lang),
			theme: resolveAgentFilePreviewShikiTheme(colorScheme),
			structure: 'inline',
		});
	} catch {
		return escapeHtml(raw);
	}
}

export function computeAgentFilePreviewLineHtmls(
	h: ShikiHighlighter,
	lang: string,
	rows: AgentFilePreviewRow[],
	colorScheme: EffectiveColorScheme = 'dark'
): string[] {
	return rows.map((row) => shikiLineToInlineHtml(h, row.text, lang, colorScheme));
}

export type GitSidebarDiffLineRender =
	| { mode: 'raw'; className: string; html: string }
	| { mode: 'split'; className: string; prefix: string; bodyHtml: string };

/** Git 侧栏 unified diff 单行：元信息行整段转义；+/-/空格 行只对去掉首字符后的正文着色 */
export function buildGitSidebarDiffLineRender(
	h: ShikiHighlighter,
	lang: string,
	line: string,
	lineClassName: string,
	colorScheme: EffectiveColorScheme = 'dark'
): GitSidebarDiffLineRender {
	if (lineClassName.includes('is-meta')) {
		return { mode: 'raw', className: lineClassName, html: escapeHtml(line || '\u00a0') };
	}
	if (line.length === 0) {
		return { mode: 'raw', className: lineClassName, html: '\u00a0' };
	}
	const prefix = line[0]!;
	const body = line.slice(1);
	const bodyHtml = shikiLineToInlineHtml(h, body, lang, colorScheme);
	return { mode: 'split', className: lineClassName, prefix, bodyHtml };
}
