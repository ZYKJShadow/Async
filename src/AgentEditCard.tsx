import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { FileTypeIcon } from './fileTypeIcons';
import type { FileEditSegment } from './agentChatSegments';
import { useI18n } from './i18n';
import { sliceAgentEditPreviewLines } from './pretextLayout';

type Props = {
	edit: FileEditSegment;
	onOpenFile?: (relPath: string, revealLine?: number) => void;
};

function basename(p: string): string {
	const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	return i >= 0 ? p.slice(i + 1) : p;
}

type PreviewLine = {
	kind: 'add' | 'del';
	text: string;
};

const EDIT_PREVIEW_MAX_BODY_PX = 220;
/** 流式预览：固定尾部行数，避免 pretext 按像素折算时行数忽多忽少导致高度抖动 */
const STREAMING_PREVIEW_MAX_LINES = 22;

function buildPreviewLines(edit: FileEditSegment): PreviewLine[] {
	const lines: PreviewLine[] = [];
	if (edit.oldStr) {
		for (const line of edit.oldStr.split('\n')) {
			lines.push({ kind: 'del', text: line });
		}
	}
	if (edit.newStr) {
		for (const line of edit.newStr.split('\n')) {
			lines.push({ kind: 'add', text: line });
		}
	}
	return lines;
}

export function AgentEditCard({ edit, onOpenFile }: Props) {
	const { t } = useI18n();
	const name = basename(edit.path) || t('agent.review.unknownPath');
	const previewLines = useMemo(() => buildPreviewLines(edit), [edit]);
	const [expanded, setExpanded] = useState(false);
	const previewMeasureRef = useRef<HTMLDivElement>(null);
	/** 流式时预览区内部滚动，避免整块高度顶动外层消息列表（对齐 Cursor 类产品的稳定布局） */
	const previewScrollWrapRef = useRef<HTMLDivElement>(null);
	const [previewInnerWidth, setPreviewInnerWidth] = useState(320);
	const streamingRef = useRef(false);
	streamingRef.current = edit.isStreaming;

	useLayoutEffect(() => {
		if (!edit.isStreaming) {
			return;
		}
		const wrap = previewScrollWrapRef.current;
		if (!wrap) {
			return;
		}
		wrap.scrollTop = wrap.scrollHeight;
	}, [edit.isStreaming, previewLines]);

	useLayoutEffect(() => {
		const el = previewMeasureRef.current;
		if (!el) {
			return;
		}
		const apply = (w: number) => {
			if (w > 0) {
				setPreviewInnerWidth(w);
			}
		};
		apply(el.getBoundingClientRect().width);
		const ro = new ResizeObserver((entries) => {
			if (streamingRef.current) {
				return;
			}
			const w = entries[0]?.contentRect.width ?? 0;
			apply(w);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	/** 流式结束后再用真实宽度刷新一次折叠态，避免完成瞬间宽度仍为过时的 320 */
	useEffect(() => {
		if (edit.isStreaming) {
			return;
		}
		const el = previewMeasureRef.current;
		if (!el) {
			return;
		}
		const w = el.getBoundingClientRect().width;
		if (w > 0) {
			setPreviewInnerWidth(w);
		}
	}, [edit.isStreaming]);

	const collapsedHead = useMemo(
		() => sliceAgentEditPreviewLines(previewLines, previewInnerWidth, EDIT_PREVIEW_MAX_BODY_PX, 'head'),
		[previewLines, previewInnerWidth]
	);

	const canExpand = !edit.isStreaming && previewLines.length > collapsedHead.length;
	// 流式：固定行数尾部，不用 pretext 像素裁切，避免高度忽高忽低；完成后：折叠态头部 / 展开全文。
	const visibleLines = edit.isStreaming
		? previewLines.slice(-STREAMING_PREVIEW_MAX_LINES)
		: expanded
			? previewLines
			: collapsedHead;
	const canOpenFile = edit.path.trim().length > 0;
	const expandRemainingLines = Math.max(0, previewLines.length - collapsedHead.length);

	return (
		<div className={`ref-edit-card ${edit.isStreaming ? 'ref-edit-card--streaming' : ''}`}>
			<button
				type="button"
				className="ref-edit-card-file"
				title={edit.path}
				onClick={() => {
					if (canOpenFile) {
						onOpenFile?.(edit.path, edit.startLine);
					}
				}}
				disabled={!canOpenFile}
			>
				<FileTypeIcon
					fileName={name}
					isDirectory={false}
					className="ref-edit-card-icon"
				/>
				<span className="ref-edit-card-name">{name}</span>
				{edit.isStreaming ? (
					<span
						className="ref-edit-card-streaming-pulse"
						title={edit.isNew ? t('agent.activity.writing', { path: name }) : t('agent.activity.editing', { path: name })}
					/>
				) : (
					<span className="ref-edit-card-stats">
						{edit.additions > 0 && (
							<span className="ref-fc-add">+{edit.additions}</span>
						)}
						{edit.deletions > 0 && (
							<span className="ref-fc-del">-{edit.deletions}</span>
						)}
					</span>
				)}
			</button>
			{previewLines.length > 0 || edit.isStreaming ? (
				<div
					ref={previewScrollWrapRef}
					className={`ref-edit-card-preview-wrap ${edit.isStreaming ? 'ref-edit-card-preview-wrap--streaming-scroll' : ''}`}
				>
					<div ref={previewMeasureRef} className="ref-edit-card-preview">
						{visibleLines.map((line, idx) => (
							<div
								key={`${line.kind}-${idx}`}
								className={`ref-edit-card-preview-line ref-edit-card-preview-line--${line.kind}`}
							>
								<span className="ref-edit-card-preview-sign" aria-hidden>
									{line.kind === 'add' ? '+' : '-'}
								</span>
								<code className="ref-edit-card-preview-code">{line.text || ' '}</code>
							</div>
						))}
					</div>
					{canExpand ? (
						<button
							type="button"
							className="ref-edit-card-toggle"
							onClick={() => setExpanded((v) => !v)}
							aria-expanded={expanded}
						>
							<svg
								className={`ref-fc-chevron ${expanded ? 'ref-fc-chevron--open' : ''}`}
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M6 9l6 6 6-6" />
							</svg>
							<span>
								{expanded
									? t('agent.edit.collapse')
									: t('agent.edit.expand', { lines: expandRemainingLines })}
							</span>
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
