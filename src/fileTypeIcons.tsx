import type { SVGProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function extOf(fileName: string): string {
	const i = fileName.lastIndexOf('.');
	return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

export function isRasterImageFileName(fileName: string): boolean {
	return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'heic', 'tiff', 'tif'].includes(
		extOf(fileName)
	);
}

export function isRasterImageRelPath(relPath: string): boolean {
	const name = relPath.replace(/\\/g, '/').split('/').pop() || relPath;
	return isRasterImageFileName(name);
}

/** 资源管理器：文件夹与按扩展名区分的文件图标（高辨识度、暗色主题友好） */
export function FileTypeIcon({ fileName, isDirectory, className }: { fileName: string; isDirectory: boolean; className?: string }) {
	if (isDirectory) {
		return <IconFolder className={className} />;
	}

	const ext = extOf(fileName);

	if (ext === 'py' || ext === 'pyw' || ext === 'pyi') {
		return <IconPython className={className} />;
	}

	if (ext === 'svg' || ext === 'svgz') {
		return <IconSvgImage className={className} />;
	}

	if (isRasterImageFileName(fileName)) {
		return <IconRasterImage className={className} ext={ext} />;
	}

	if (ext === 'json' || ext === 'jsonc') {
		return <IconJson className={className} />;
	}

	if (ext === 'sql') {
		return <IconSql className={className} />;
	}

	if (['ts', 'tsx'].includes(ext)) {
		return <IconTs className={className} />;
	}

	if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
		return <IconJs className={className} />;
	}

	if (['md', 'mdx'].includes(ext)) {
		return <IconMd className={className} />;
	}

	if (['css', 'scss', 'less'].includes(ext)) {
		return <IconCss className={className} />;
	}

	if (['html', 'htm'].includes(ext)) {
		return <IconHtml className={className} />;
	}

	if (['yml', 'yaml'].includes(ext)) {
		return <IconYaml className={className} />;
	}

	if (['rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs'].includes(ext)) {
		return <IconCode className={className} color="#a78bfa" />;
	}

	if (['ttf', 'woff', 'woff2', 'otf'].includes(ext)) {
		return <IconFont className={className} />;
	}

	if (ext === 'txt' || ext === 'log') {
		return <IconText className={className} />;
	}

	return <IconFile className={className} />;
}

function basenameFromRelPath(relPath: string): string {
	const n = relPath.replace(/\\/g, '/');
	return n.split('/').pop() || n;
}

/**
 * 与 {@link FileTypeIcon}、@ 菜单一致：用于 contenteditable 内 chip 等纯 DOM（避免仅用 CSS 扩展名色块与菜单图标不一致）。
 */
export function fileTypeIconHtmlForRelPath(relPath: string, isDirectory = false): string {
	const fileName = basenameFromRelPath(relPath);
	return renderToStaticMarkup(
		<FileTypeIcon fileName={fileName} isDirectory={isDirectory} className="ref-inline-file-chip-svg" />
	);
}

/** 近似 PSF 双色蛇形：蓝 / 黄椭圆交错 + 眼睛，避免渐变 id 冲突用实色 + 轻微透明度叠层 */
function IconPython({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<ellipse cx="9.2" cy="10.5" rx="5.4" ry="6.8" transform="rotate(-52 9.2 10.5)" fill="#306998" />
			<ellipse cx="14.8" cy="13.5" rx="5.4" ry="6.8" transform="rotate(-52 14.8 13.5)" fill="#ffd43b" />
			<circle cx="6.9" cy="8.4" r="1" fill="#f8fafc" />
			<circle cx="17.1" cy="15.6" r="1" fill="#1e293b" />
		</svg>
	);
}

/** 照片：画框 + 天蓝到紫的叠色 + 太阳 + 山影；GIF 左下角小绿标 */
function IconRasterImage({ className, ext }: IconProps & { ext: string }) {
	const isGif = ext === 'gif';
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="#38bdf8" stroke="#cbd5e1" strokeWidth="1" />
			<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="#6366f1" fillOpacity="0.45" />
			<circle cx="17.2" cy="8.3" r="2.3" fill="#fef08a" stroke="#facc15" strokeWidth="0.35" />
			<path d="M3.5 17.8L8.2 12.5l3.1 3.2 3.6-4.1 6.2 6.2H3.5z" fill="#0f172a" fillOpacity="0.33" />
			{isGif ? <circle cx="6.2" cy="17.2" r="2" fill="#22c55e" stroke="#14532d" strokeWidth="0.5" /> : null}
		</svg>
	);
}

/** 矢量：W3C SVG 系橙色 + 曲线与节点点 */
function IconSvgImage({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<rect x="3" y="3" width="18" height="18" rx="3" fill="#fff7ed" stroke="#ea580c" strokeWidth="1" />
			<path
				d="M7 16.5c2-4 3.5-6 5.5-6s3.5 2 5.5 6"
				fill="none"
				stroke="#ea580c"
				strokeWidth="1.35"
				strokeLinecap="round"
			/>
			<circle cx="8" cy="9" r="1.1" fill="#ea580c" />
			<circle cx="12" cy="7.5" r="1.1" fill="#ea580c" />
			<circle cx="16" cy="9" r="1.1" fill="#ea580c" />
		</svg>
	);
}

function IconFolder({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<path
				d="M4 7.5a2 2 0 012-2h3.2l1.6 1.6H18a2 2 0 012 2V17a2 2 0 01-2 2H6a2 2 0 01-2-2V7.5z"
				fill="#f59e0b"
				stroke="#b45309"
				strokeWidth="0.9"
				strokeLinejoin="round"
			/>
			<path d="M4 9.5h16v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" fill="#fbbf24" fillOpacity="0.5" />
		</svg>
	);
}

function IconJson({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<rect x="4" y="3" width="16" height="18" rx="2.5" fill="#1e293b" stroke="#475569" strokeWidth="1" />
			<path
				d="M8 8c-1 0-1.5.5-1.5 1.5v1c0 .8-.3 1.2-1 1.2v1.6c.7 0 1 .4 1 1.2v1c0 1 .5 1.5 1.5 1.5M16 8c1 0 1.5.5 1.5 1.5v1c0 .8.3 1.2 1 1.2v1.6c-.7 0-1 .4-1 1.2v1c0 1-.5 1.5-1.5 1.5"
				stroke="#fbbf24"
				strokeWidth="1.35"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function IconSql({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<ellipse cx="12" cy="6" rx="7" ry="3" fill="#3b82f6" opacity="0.95" />
			<path d="M5 6v6c0 1.5 3 3 7 3s7-1.5 7-3V6" stroke="#1d4ed8" strokeWidth="1" fill="none" />
			<path d="M5 12v4c0 1.5 3 3 7 3s7-1.5 7-3v-4" stroke="#1d4ed8" strokeWidth="1" fill="none" />
		</svg>
	);
}

function IconTs({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<rect width="24" height="24" rx="4" fill="#3178c6" />
			<text x="12" y="16.5" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800" fontFamily="system-ui, Segoe UI, sans-serif">
				TS
			</text>
		</svg>
	);
}

function IconJs({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<rect width="24" height="24" rx="4" fill="#f7df1e" />
			<text x="12" y="16.5" textAnchor="middle" fill="#323330" fontSize="10" fontWeight="800" fontFamily="system-ui, Segoe UI, sans-serif">
				JS
			</text>
		</svg>
	);
}

function IconMd({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<rect x="4" y="3" width="16" height="18" rx="2.5" fill="#334155" stroke="#64748b" strokeWidth="1" />
			<path d="M8 9v6l2-2 2 2V9M16 9h2v6h-2M16 12h2" stroke="#e2e8f0" strokeWidth="1.35" strokeLinecap="round" />
		</svg>
	);
}

function IconCss({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<rect width="24" height="24" rx="4" fill="#264de4" />
			<text x="12" y="15.5" textAnchor="middle" fill="#fff" fontSize="7.5" fontWeight="800" fontFamily="system-ui, sans-serif">
				CSS
			</text>
		</svg>
	);
}

function IconHtml({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
			<rect width="24" height="24" rx="4" fill="#e34f26" />
			<text x="12" y="15" textAnchor="middle" fill="#fff" fontSize="6.5" fontWeight="800" fontFamily="system-ui, sans-serif">
				HTML
			</text>
		</svg>
	);
}

function IconYaml({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<rect x="4" y="3" width="16" height="18" rx="2.5" fill="#27272a" stroke="#52525b" strokeWidth="1" />
			<text x="12" y="14.5" textAnchor="middle" fill="#eab308" fontSize="6.5" fontWeight="800" fontFamily="ui-monospace, monospace">
				YML
			</text>
		</svg>
	);
}

function IconCode({ className, color }: IconProps & { color: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<rect x="4" y="4" width="16" height="16" rx="2.5" fill={color} fillOpacity="0.22" stroke={color} strokeWidth="1" />
			<path d="M9 9l-3 3 3 3M15 9l3 3-3 3" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function IconFont({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<rect x="4" y="3" width="16" height="18" rx="2.5" fill="#44403c" stroke="#78716c" strokeWidth="1" />
			<text x="12" y="15.5" textAnchor="middle" fill="#e7e5e4" fontSize="9" fontWeight="700" fontFamily="Georgia, serif">
				Aa
			</text>
		</svg>
	);
}

function IconText({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<path
				d="M7 4h10v2.2H12V20h-2V6.2H7V4z"
				fill="#94a3b8"
			/>
		</svg>
	);
}

function IconFile({ className }: IconProps) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
			<path
				d="M14 2H7.5A2.5 2.5 0 005 4.5v15A2.5 2.5 0 007.5 22h9a2.5 2.5 0 002.5-2.5V8L14 2z"
				fill="#3f3f46"
				stroke="#71717a"
				strokeWidth="1"
				strokeLinejoin="round"
			/>
			<path d="M14 2v5.5a1 1 0 001 1H21" stroke="#71717a" strokeWidth="1" fill="none" />
			<path d="M14.5 2.5L20.5 8" stroke="#52525b" strokeWidth="0.75" opacity="0.6" />
		</svg>
	);
}

export function languageFromFilePath(relPath: string): string {
	const ext = extOf(relPath.split('/').pop() ?? relPath);
	const map: Record<string, string> = {
		ts: 'typescript',
		tsx: 'typescript',
		js: 'javascript',
		jsx: 'javascript',
		mjs: 'javascript',
		cjs: 'javascript',
		json: 'json',
		jsonc: 'json',
		md: 'markdown',
		mdx: 'markdown',
		py: 'python',
		css: 'css',
		scss: 'scss',
		less: 'less',
		html: 'html',
		htm: 'html',
		sql: 'sql',
		yml: 'yaml',
		yaml: 'yaml',
		xml: 'xml',
		rs: 'rust',
		go: 'go',
		java: 'java',
		kt: 'kotlin',
		swift: 'swift',
		c: 'c',
		cpp: 'cpp',
		h: 'c',
		hpp: 'cpp',
		cs: 'csharp',
		sh: 'shell',
		ps1: 'powershell',
	};
	return map[ext] ?? 'plaintext';
}
