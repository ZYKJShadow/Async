/**
 * AI 工具调用成功结果的可折叠内联卡片（search_files / read_file / list_dir / execute_command）。
 *
 * 动画：播放时固定高度 + overflow-y:auto（滚动条），逐行追加并自动滚底（read_file / list_dir 不播放，直接展示全文）。
 * 播完后：read/search/命令输出用 Monaco colorize 做语法高亮（与编辑器主题一致）。
 *
 * 性能：视口外不着色（IntersectionObserver + requestIdleCallback）、Monaco 全局并发池、
 * 大行数时用虚拟列表；预览区 sliceByPixelBudget 有行数上限。
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { layout, prepare } from '@chenglou/pretext';
import type { ActivityResultLine } from './agentChatSegments';
import {
	colorizeJoinedLines,
	colorizeSearchMatchLines,
	languageIdFromPath,
} from './agentResultMonaco';
import { FileTypeIcon } from './fileTypeIcons';

const RESULT_MONO_FONT = '11.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const RESULT_MONO_LH = 11.5 * 1.55;
const RESULT_PREVIEW_MAX_PX = 200;
/** 预览区最多用 pretext 测量的行数，避免目录极长时 O(n) 卡主线程 */
const PREVIEW_PIXEL_BUDGET_MAX_LINES = 56;
/** 超过此行数且在展开或流式播放中使用虚拟滚动 */
const VIRTUAL_MIN_LINES = 100;
const ROW_EST_PX = Math.ceil(RESULT_MONO_LH + 6);

/** 首行较快出现，后续行在总时长内均分，避免少行时像「一整块弹出」 */
function rowIntervalMs(total: number): number {
	if (total <= 1) return 0;
	const minTotal = 820;
	const maxTotal = 2300;
	const target = Math.min(maxTotal, Math.max(minTotal, 40 * total));
	return Math.max(14, Math.floor(target / (total - 1)));
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
		if (out.length >= PREVIEW_PIXEL_BUDGET_MAX_LINES) break;
		const text = line.text || '\u00a0';
		const p = prepare(text, RESULT_MONO_FONT, { whiteSpace: 'pre-wrap' });
		const h = layout(p, w, RESULT_MONO_LH).height;
		if (acc + h > maxPx && out.length > 0) break;
		acc += h;
		out.push(line);
	}
	return out;
}

function stableLinesSignature(lines: readonly ActivityResultLine[]): string {
	return lines
		.map((l) => `${l.text}\x1f${l.filePath ?? ''}\x1f${l.lineNo ?? ''}\x1f${l.matchText ?? ''}`)
		.join('\x1e');
}

const completedResultAnimSignatures = new Set<string>();
const MAX_COMPLETED_RESULT_ANIM_SIGNATURES = 480;

function rememberCompletedResultAnim(sig: string) {
	if (completedResultAnimSignatures.size >= MAX_COMPLETED_RESULT_ANIM_SIGNATURES) {
		const first = completedResultAnimSignatures.values().next().value as string | undefined;
		if (first !== undefined) completedResultAnimSignatures.delete(first);
	}
	completedResultAnimSignatures.add(sig);
}

function prefersReducedMotion(): boolean {
	try {
		return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

type Props = {
	lines: ActivityResultLine[];
	kind: 'search' | 'read' | 'dir' | 'plain';
	/** read_file：用于选择 Monaco 语言 */
	readSourcePath?: string;
	onOpenFile?: (relPath: string, revealLine?: number) => void;
	/**
	 * 仅在本轮 Agent 实时生成（最后一条助手且 awaiting）时为 true。
	 * 历史消息 / 重开应用后为 false，避免依赖进程内 Set 导致整段结果再次逐行「流式」播放。
	 */
	animateLineReveal?: boolean;
};

export function AgentResultCard({
	lines,
	kind,
	readSourcePath,
	onOpenFile,
	animateLineReveal = false,
}: Props) {
	/** 所有结果类型都不使用逐行动画，直接显示全文 */
	const enableLineRevealAnim = false;

	const [expanded, setExpanded] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const streamScrollRef = useRef<HTMLDivElement>(null);
	const expandedScrollRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(320);
	const [inView, setInView] = useState(
		() => typeof window === 'undefined' || typeof IntersectionObserver === 'undefined'
	);

	const linesSignature = useMemo(() => stableLinesSignature(lines), [lines]);

	const alreadySeen = completedResultAnimSignatures.has(linesSignature);
	const skipAnim =
		!enableLineRevealAnim || alreadySeen || prefersReducedMotion() || lines.length === 0;

	const [revealedCount, setRevealedCount] = useState<number>(() => (skipAnim ? lines.length : 0));
	const [streaming, setStreaming] = useState<boolean>(() => !skipAnim && lines.length > 0);

	const [highlightedLines, setHighlightedLines] = useState<(string | null)[] | null>(null);

	const prevSigRef = useRef<string>(linesSignature);
	if (prevSigRef.current !== linesSignature) {
		prevSigRef.current = linesSignature;
		const skip =
			!enableLineRevealAnim ||
			completedResultAnimSignatures.has(linesSignature) ||
			prefersReducedMotion() ||
			lines.length === 0;
		setRevealedCount(skip ? lines.length : 0);
		setStreaming(!skip && lines.length > 0);
		setHighlightedLines(null);
	}

	useEffect(() => {
		const root = containerRef.current;
		if (!root || typeof IntersectionObserver === 'undefined') {
			setInView(true);
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				const hit = entries.some((e) => e.isIntersecting);
				setInView(hit);
			},
			{ root: null, rootMargin: '280px 0px', threshold: 0.01 }
		);
		io.observe(root);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		if (!streaming) return;
		if (revealedCount >= lines.length) {
			setStreaming(false);
			rememberCompletedResultAnim(linesSignature);
			return;
		}

		const between = rowIntervalMs(lines.length);
		const delay = revealedCount === 0 ? Math.min(56, Math.max(20, between || 40)) : between || 32;

		const id = setTimeout(() => {
			setRevealedCount((c) => c + 1);
		}, delay);
		return () => clearTimeout(id);
	}, [streaming, revealedCount, lines.length, linesSignature]);

	const previewLines = useMemo(
		() => sliceByPixelBudget(lines, containerWidth, RESULT_PREVIEW_MAX_PX),
		[lines, containerWidth]
	);

	const needsExpand = !streaming && previewLines.length < lines.length;
	const hiddenCount = lines.length - previewLines.length;

	const displayLines = streaming
		? lines.slice(0, revealedCount)
		: expanded
			? lines
			: previewLines;

	const virtualEnabled =
		displayLines.length >= VIRTUAL_MIN_LINES && (streaming || expanded);

	const streamVirtual = useVirtualizer({
		count: virtualEnabled && streaming ? displayLines.length : 0,
		getScrollElement: () => streamScrollRef.current,
		estimateSize: () => ROW_EST_PX,
		overscan: 12,
		measureElement:
			typeof window !== 'undefined'
				? (el) => (el as HTMLElement).getBoundingClientRect().height
				: undefined,
	});

	const expandedVirtual = useVirtualizer({
		count: virtualEnabled && !streaming ? displayLines.length : 0,
		getScrollElement: () => expandedScrollRef.current,
		estimateSize: () => ROW_EST_PX,
		overscan: 12,
		measureElement:
			typeof window !== 'undefined'
				? (el) => (el as HTMLElement).getBoundingClientRect().height
				: undefined,
	});

	useLayoutEffect(() => {
		if (!streaming) return;
		if (virtualEnabled) {
			const last = Math.max(0, displayLines.length - 1);
			// 推迟到微任务，避免在 useLayoutEffect 内触发 flushSync 警告
			queueMicrotask(() => streamVirtual.scrollToIndex(last, { align: 'end' }));
			return;
		}
		const el = streamScrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
		// streamVirtual.scrollToIndex 依赖 virtualizer 内部状态，勿把实例放进依赖以免多余滚动
		// eslint-disable-next-line react-hooks/exhaustive-deps -- revealedCount / displayLines.length 驱动粘底即可
	}, [revealedCount, streaming, virtualEnabled, displayLines.length]);

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const apply = (w: number) => {
			if (w > 0) setContainerWidth(w);
		};
		apply(el.getBoundingClientRect().width);
		const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const canHighlight = kind === 'read' || kind === 'search' || kind === 'plain';

	useEffect(() => {
		let cancelled = false;
		if (streaming) {
			setHighlightedLines(null);
			return () => {
				cancelled = true;
			};
		}
		if (!canHighlight) {
			setHighlightedLines(null);
			return () => {
				cancelled = true;
			};
		}

		if (!inView) {
			return () => {
				cancelled = true;
			};
		}

		const runColorize = () => {
			if (cancelled || !inView) return;
			void (async () => {
				if (kind === 'read') {
					const lang = readSourcePath ? languageIdFromPath(readSourcePath) : 'plaintext';
					const texts = lines.map((l) => (l.lineNo !== undefined ? (l.matchText ?? '') : l.text));
					const out = await colorizeJoinedLines(texts, lang);
					if (!cancelled) setHighlightedLines(out);
				} else if (kind === 'search') {
					const out = await colorizeSearchMatchLines(lines);
					if (!cancelled) setHighlightedLines(out);
				} else if (kind === 'plain') {
					const texts = lines.map((l) => l.text);
					const out = await colorizeJoinedLines(texts, 'shell');
					if (!cancelled) setHighlightedLines(out);
				}
			})();
		};

		let idleId = 0;
		let toId = 0;
		if (typeof requestIdleCallback !== 'undefined') {
			idleId = requestIdleCallback(() => runColorize(), { timeout: 1400 });
		} else {
			toId = window.setTimeout(runColorize, 0);
		}

		return () => {
			cancelled = true;
			if (idleId) cancelIdleCallback(idleId);
			if (toId) window.clearTimeout(toId);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- lines 内容由 linesSignature 表征
	}, [linesSignature, streaming, kind, readSourcePath, canHighlight, inView]);

	const renderHighlightedCode = (i: number, plain: string, className: string) => {
		const hi = highlightedLines?.[i];
		if (hi) {
			return <code className={className} dangerouslySetInnerHTML={{ __html: hi }} />;
		}
		return <code className={className}>{plain}</code>;
	};

	const renderLine = (line: ActivityResultLine, i: number) => {
		if (kind === 'search' && line.filePath !== undefined) {
			const canOpen = Boolean(onOpenFile && line.filePath);
			const fname = fileBasename(line.filePath);
			const matchPlain = line.matchText ?? '';
			return (
				<div className="ref-result-card-line ref-result-card-line--search">
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
					{matchPlain !== '' || highlightedLines?.[i] ? (
						renderHighlightedCode(i, matchPlain, 'ref-result-card-match ref-result-card-match--monaco')
					) : null}
				</div>
			);
		}

		if (kind === 'search') {
			return (
				<div className="ref-result-card-line">
					{renderHighlightedCode(i, line.text, 'ref-result-card-match ref-result-card-match--monaco')}
				</div>
			);
		}

		if (kind === 'read' && line.lineNo !== undefined) {
			const plain = line.matchText ?? '';
			return (
				<div className="ref-result-card-line ref-result-card-line--read">
					<span className="ref-result-card-lineno-gutter" aria-hidden>{line.lineNo}</span>
					{renderHighlightedCode(i, plain, 'ref-result-card-match ref-result-card-match--monaco')}
				</div>
			);
		}

		if (kind === 'read') {
			return (
				<div className="ref-result-card-line ref-result-card-line--read">
					{renderHighlightedCode(i, line.text, 'ref-result-card-match ref-result-card-match--monaco')}
				</div>
			);
		}

		if (kind === 'dir') {
			const isDir = line.text.startsWith('[dir]');
			const name = line.text.replace(/^\[(dir|file)\]\s*/, '');
			return (
				<div className="ref-result-card-line ref-result-card-line--dir">
					<span className="ref-result-card-file-ico" aria-hidden>
						<FileTypeIcon fileName={name} isDirectory={isDir} className="ref-result-card-ico-svg" />
					</span>
					<span className={`ref-result-card-fname ${isDir ? 'ref-result-card-fname--dir' : ''}`}>{name}</span>
				</div>
			);
		}

		if (kind === 'plain') {
			return (
				<div className="ref-result-card-line ref-result-card-line--plain">
					{renderHighlightedCode(i, line.text, 'ref-result-card-match ref-result-card-match--monaco')}
				</div>
			);
		}

		return (
			<div className="ref-result-card-line">
				<code className="ref-result-card-match">{line.text}</code>
			</div>
		);
	};

	const renderVirtualRows = (virtualizer: Virtualizer<HTMLDivElement, Element>) => (
		<div
			style={{
				height: `${virtualizer.getTotalSize()}px`,
				position: 'relative',
				width: '100%',
			}}
		>
			{virtualizer.getVirtualItems().map((vi) => (
				<div
					key={vi.key}
					data-index={vi.index}
					ref={virtualizer.measureElement}
					style={{
						position: 'absolute',
						top: 0,
						left: 0,
						width: '100%',
						transform: `translateY(${vi.start}px)`,
					}}
				>
					{renderLine(displayLines[vi.index]!, vi.index)}
				</div>
			))}
		</div>
	);

	if (lines.length === 0) return null;

	return (
		<div ref={containerRef} className="ref-result-card">
			{streaming ? (
				<div ref={streamScrollRef} className="ref-result-card-body--stream">
					{virtualEnabled && streaming
						? renderVirtualRows(streamVirtual)
						: displayLines.map((line, i) => (
								<Fragment key={i}>{renderLine(line, i)}</Fragment>
							))}
					<div className="ref-result-card-stream-cursor" aria-hidden />
				</div>
			) : (
				<>
					<div
						ref={expandedScrollRef}
						className={[
							'ref-result-card-body',
							!expanded ? 'ref-result-card-body--preview' : 'ref-result-card-body--expanded',
						].join(' ')}
					>
						{virtualEnabled && !streaming
							? renderVirtualRows(expandedVirtual)
							: displayLines.map((line, i) => (
									<Fragment key={i}>{renderLine(line, i)}</Fragment>
								))}
					</div>
					{needsExpand ? (
						<div
							className={['ref-result-card-chrome', expanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}
						>
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
				</>
			)}
		</div>
	);
}

function IconChevron({ up }: { up: boolean }) {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			{up ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
		</svg>
	);
}
