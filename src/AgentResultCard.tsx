/**
 * AI 工具调用成功结果的可折叠内联卡片（search_files / read_file / list_dir）。
 *
 * 动态效果：收到完整结果后，用逐行入场动画模拟 Cursor 那种「结果一条一条滚出来」的感觉。
 * 折叠态：用 @chenglou/pretext 按像素预算截取可见行，避免固定行数导致的高度抖动。
 * 展开态：全量滚动展示，支持点击 search_files 匹配行跳转编辑器。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layout, prepare } from '@chenglou/pretext';
import type { ActivityResultLine } from './agentChatSegments';
import { FileTypeIcon } from './fileTypeIcons';

const RESULT_MONO_FONT =
	'11.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const RESULT_MONO_LH = 11.5 * 1.55;
const RESULT_PREVIEW_MAX_PX = 200;

/** 每行入场间隔（ms）。行数越多间隔越短，保证总动画时长不超过约 600ms */
function rowInterval(totalLines: number): number {
	if (totalLines <= 5) return 60;
	if (totalLines <= 15) return 35;
	if (totalLines <= 40) return 18;
	return 10;
}

function fileBasename(p: string): string {
	const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	return i >= 0 ? p.slice(i + 1) : p;
}

function sliceByPixelBudget(
	lines: ActivityResultLine[],
	containerWidthPx: number,
	maxPx: number
): ActivityResultLine[] {
	const w = Math.max(48, containerWidthPx - 24);
	let acc = 0;
	const out: ActivityResultLine[] = [];
	for (const line of lines) {
		const text = line.text || '\u00a0';
		const p = prepare(text, RESULT_MONO_FONT, { whiteSpace: 'pre-wrap' });
		const h = layout(p, w, RESULT_MONO_LH).height;
		if (acc + h > maxPx && out.length > 0) {
			break;
		}
		acc += h;
		out.push(line);
	}
	return out;
}

/** 按内容生成稳定签名（父组件常每次渲染新建 lines 数组，不能靠引用判断「是否变化」） */
function stableLinesSignature(lines: readonly ActivityResultLine[]): string {
	return lines
		.map(
			(l) =>
				`${l.text}\x1f${l.filePath ?? ''}\x1f${l.lineNo ?? ''}\x1f${l.matchText ?? ''}`
		)
		.join('\x1e');
}

/**
 * 切换对话再回来时组件会卸载重挂，实例内 ref 会丢。
 * 用模块级集合记住「这份结果已播完入场」，避免重复 stagger 与每行 CSS 动画。
 */
const completedResultAnimSignatures = new Set<string>();
const MAX_COMPLETED_RESULT_ANIM_SIGNATURES = 480;

function rememberCompletedResultAnim(sig: string) {
	if (completedResultAnimSignatures.size >= MAX_COMPLETED_RESULT_ANIM_SIGNATURES) {
		const first = completedResultAnimSignatures.values().next().value as string | undefined;
		if (first !== undefined) {
			completedResultAnimSignatures.delete(first);
		}
	}
	completedResultAnimSignatures.add(sig);
}

type Props = {
	lines: ActivityResultLine[];
	kind: 'search' | 'read' | 'dir';
	onOpenFile?: (relPath: string, revealLine?: number) => void;
};

export function AgentResultCard({ lines, kind, onOpenFile }: Props) {
	const [expanded, setExpanded] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(320);

	/** 当前已"播放"到的行数（逐行动画计数器） */
	const [revealedCount, setRevealedCount] = useState(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** 已对哪份内容播过入场动画（内容不变则父级重渲染也不重播） */
	const animatedSignatureRef = useRef<string | null>(null);

	const linesSignature = useMemo(() => stableLinesSignature(lines), [lines]);

	const suppressLineEnterCss = completedResultAnimSignatures.has(linesSignature);

	useLayoutEffect(() => {
		if (lines.length === 0) {
			return;
		}
		if (completedResultAnimSignatures.has(linesSignature)) {
			setRevealedCount(lines.length);
			animatedSignatureRef.current = linesSignature;
		}
	}, [linesSignature, lines.length]);

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const apply = (w: number) => { if (w > 0) setContainerWidth(w); };
		apply(el.getBoundingClientRect().width);
		const ro = new ResizeObserver((entries) => {
			apply(entries[0]?.contentRect.width ?? 0);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	/** 逐行入场动画：仅当 result 内容真正变化时播放（避免整页重渲染时所有 Card 重播） */
	useEffect(() => {
		if (linesSignature === animatedSignatureRef.current) {
			return;
		}

		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}

		if (lines.length === 0) {
			animatedSignatureRef.current = linesSignature;
			setRevealedCount(0);
			return;
		}

		if (completedResultAnimSignatures.has(linesSignature)) {
			return;
		}

		// 立即显示第一行，然后按节奏逐行追加；动画结束后再写入 ref，避免 Strict Mode 重跑 effect 时误判「已播完」
		setRevealedCount(1);

		const interval = rowInterval(lines.length);
		const total = lines.length;
		const sig = linesSignature;

		const tick = (next: number) => {
			if (next >= total) {
				animatedSignatureRef.current = sig;
				rememberCompletedResultAnim(sig);
				return;
			}
			timerRef.current = setTimeout(() => {
				setRevealedCount(next + 1);
				tick(next + 1);
			}, interval);
		};
		tick(1);

		return () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [linesSignature]);

	const previewLines = useMemo(
		() => sliceByPixelBudget(lines, containerWidth, RESULT_PREVIEW_MAX_PX),
		[lines, containerWidth]
	);

	/** 折叠态：取已播放行与预览行的交集（动画还没到的行不显示） */
	const collapsedVisible = useMemo(
		() => previewLines.slice(0, revealedCount),
		[previewLines, revealedCount]
	);

	/** 展开态：全部已播放行 */
	const expandedVisible = useMemo(
		() => lines.slice(0, revealedCount),
		[lines, revealedCount]
	);

	const isAnimating = revealedCount < lines.length;
	const needsExpand = !isAnimating && previewLines.length < lines.length;
	const visibleLines = expanded ? expandedVisible : collapsedVisible;
	const hiddenCount = lines.length - previewLines.length;

	const renderLine = (line: ActivityResultLine, i: number) => {
		if (kind === 'search' && line.filePath !== undefined) {
			const canOpen = Boolean(onOpenFile && line.filePath);
			const fname = fileBasename(line.filePath);
			return (
				<div
					key={i}
					className={[
						'ref-result-card-line',
						'ref-result-card-line--search',
						suppressLineEnterCss ? '' : 'ref-result-card-line--enter',
					]
						.filter(Boolean)
						.join(' ')}
				>
					<span className="ref-result-card-file-ico" aria-hidden>
						<FileTypeIcon fileName={fname} isDirectory={false} className="ref-result-card-ico-svg" />
					</span>
					{canOpen ? (
						<button
							type="button"
							className="ref-result-card-file-link"
							onClick={() => onOpenFile!(line.filePath!, line.lineNo)}
							title={`${line.filePath}${line.lineNo ? `:${line.lineNo}` : ''}`}
						>
							<span className="ref-result-card-fname">{fname}</span>
							{line.lineNo !== undefined ? (
								<span className="ref-result-card-lineno">:{line.lineNo}</span>
							) : null}
						</button>
					) : (
						<span className="ref-result-card-fname">{fname}</span>
					)}
					{line.matchText !== undefined ? (
						<code className="ref-result-card-match">{line.matchText}</code>
					) : null}
				</div>
			);
		}

		if (kind === 'read' && line.lineNo !== undefined) {
			return (
				<div
					key={i}
					className={[
						'ref-result-card-line',
						'ref-result-card-line--read',
						suppressLineEnterCss ? '' : 'ref-result-card-line--enter',
					]
						.filter(Boolean)
						.join(' ')}
				>
					<span className="ref-result-card-lineno-gutter" aria-hidden>{line.lineNo}</span>
					<code className="ref-result-card-match">{line.matchText ?? ''}</code>
				</div>
			);
		}

		if (kind === 'dir') {
			const isDir = line.text.startsWith('[dir]');
			const name = line.text.replace(/^\[(dir|file)\]\s*/, '');
			return (
				<div
					key={i}
					className={[
						'ref-result-card-line',
						'ref-result-card-line--dir',
						suppressLineEnterCss ? '' : 'ref-result-card-line--enter',
					]
						.filter(Boolean)
						.join(' ')}
				>
					<span className="ref-result-card-file-ico" aria-hidden>
						<FileTypeIcon fileName={name} isDirectory={isDir} className="ref-result-card-ico-svg" />
					</span>
					<span className={`ref-result-card-fname ${isDir ? 'ref-result-card-fname--dir' : ''}`}>{name}</span>
				</div>
			);
		}

		return (
			<div
				key={i}
				className={['ref-result-card-line', suppressLineEnterCss ? '' : 'ref-result-card-line--enter'].filter(Boolean).join(' ')}
			>
				<code className="ref-result-card-match">{line.text}</code>
			</div>
		);
	};

	if (lines.length === 0) return null;

	return (
		<div ref={containerRef} className="ref-result-card">
			<div
				className={[
					'ref-result-card-body',
					!expanded ? 'ref-result-card-body--preview' : 'ref-result-card-body--expanded',
				].join(' ')}
			>
				{visibleLines.map((line, i) => renderLine(line, i))}
				{/* 动画进行中：在末尾显示扫描光标 */}
				{isAnimating ? <div className="ref-result-card-scanning" aria-hidden /> : null}
			</div>
			{needsExpand ? (
				<div className={['ref-result-card-chrome', expanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}>
					{!expanded ? <div className="ref-result-card-fade" aria-hidden /> : null}
					<button
						type="button"
						className="ref-result-card-toggle"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
					>
						{expanded ? (
							<>
								<IconChevron up />
								<span>收起</span>
							</>
						) : (
							<>
								<IconChevron up={false} />
								<span>展开全部 {hiddenCount} 行</span>
							</>
						)}
					</button>
				</div>
			) : null}
		</div>
	);
}

function IconChevron({ up }: { up: boolean }) {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			{up ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
		</svg>
	);
}
