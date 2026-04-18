import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
	isSlashCommandDomPendingUpgrade,
	newSegmentId,
	segmentsContentKey,
	segmentsToWireText,
	type ComposerSegment,
} from './composerSegments';
import {
	type FileChipDomHandlers,
	insertFileChipAtCaret,
	placeCaretAfterFirstSlashChipElseEnd,
	readSegmentsFromRoot,
	writeSegmentsToRoot,
} from './composerRichDom';

function dataTransferHasFiles(dt: DataTransfer | null): boolean {
	return !!dt?.types?.includes('Files');
}

type Props = {
	segments: ComposerSegment[];
	onSegmentsChange: (next: ComposerSegment[]) => void;
	className?: string;
	placeholder?: string;
	/** 点击文件 chip：打开侧栏预览 */
	onFilePreview: (relPath: string) => void;
	/** 将拖放/粘贴的文件写入工作区并返回相对路径（与 @ 引用一致） */
	onComposerAttachFiles?: (files: File[]) => Promise<string[]>;
	/** 与 useComposerAtMention 联动 */
	onRichInput: (root: HTMLElement) => void;
	onRichSelect: (root: HTMLElement) => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
	onInputHeight?: (el: HTMLDivElement) => void;
	innerRef: React.RefObject<HTMLDivElement | null>;
};

export function ComposerRichInput({
	segments,
	onSegmentsChange,
	className,
	placeholder,
	onFilePreview,
	onComposerAttachFiles,
	onRichInput,
	onRichSelect,
	onKeyDown,
	onInputHeight,
	innerRef,
}: Props) {
	const focusedRef = useRef(false);
	const lastEmittedRef = useRef<string>('');
	const dragDepthRef = useRef(0);
	const [fileDragOver, setFileDragOver] = useState(false);

	/** 浏览器常在空 contenteditable 里塞 <br>，:empty 伪类失效；按 segments 判定是否显示 placeholder */
	const showPlaceholder =
		Boolean((placeholder ?? '').trim()) && segmentsToWireText(segments).trim() === '';

	const placeCaretAtContentStart = useCallback(() => {
		const el = innerRef.current;
		if (!el) {
			return;
		}
		try {
			const range = document.createRange();
			range.setStart(el, 0);
			range.collapse(true);
			const sel = window.getSelection();
			if (!sel) {
				return;
			}
			sel.removeAllRanges();
			sel.addRange(range);
		} catch {
			/* 忽略空或异常 DOM */
		}
	}, [innerRef]);

	const emitFromDom = useCallback(() => {
		const el = innerRef.current;
		if (!el) {
			return;
		}
		const next = readSegmentsFromRoot(el);
		lastEmittedRef.current = segmentsToWireText(next);
		onSegmentsChange(next);
	}, [innerRef, onSegmentsChange]);

	const domHandlers = useMemo<FileChipDomHandlers>(
		() => ({
			onPreview: onFilePreview,
			onStructureChange: () => {
				const el = innerRef.current;
				if (!el) {
					return;
				}
				const next = readSegmentsFromRoot(el);
				lastEmittedRef.current = segmentsToWireText(next);
				onSegmentsChange(next);
			},
		}),
		[innerRef, onFilePreview, onSegmentsChange]
	);

	const consumeDroppedOrPastedFiles = useCallback(
		async (files: File[]) => {
			if (!onComposerAttachFiles || files.length === 0) {
				return;
			}
			const nonEmpty = files.filter((f) => f.size > 0);
			if (nonEmpty.length === 0) {
				return;
			}
			let rels: string[];
			try {
				rels = await onComposerAttachFiles(nonEmpty);
			} catch {
				return;
			}
			const el = innerRef.current;
			if (!el) {
				return;
			}
			el.focus();
			for (const rel of rels) {
				insertFileChipAtCaret(el, rel, newSegmentId(), domHandlers);
			}
		},
		[innerRef, onComposerAttachFiles, domHandlers]
	);

	useLayoutEffect(() => {
		const el = innerRef.current;
		if (!el) {
			return;
		}
		const wire = segmentsToWireText(segments);
		if (wire === '') {
			if (el.innerHTML !== '') {
				el.innerHTML = '';
			}
			lastEmittedRef.current = '';
			return;
		}
		const domSegs = readSegmentsFromRoot(el);
		const propKey = segmentsContentKey(segments);
		const domKey = segmentsContentKey(domSegs);
		if (propKey === domKey) {
			lastEmittedRef.current = wire;
			return;
		}
		const domWire = segmentsToWireText(domSegs);
		if (focusedRef.current) {
			// 菜单回车时往往只打了「/」或半段命令：props 可能已切到完整命令/chip，
			// DOM 仍停在旧前缀（包括模糊匹配选中的场景），这时须允许受控写回。
			const allowSyncWhileFocused =
				domWire === wire ||
				isSlashCommandDomPendingUpgrade(segments, domSegs) ||
				(wire.length > domWire.length && wire.startsWith(domWire));
			if (!allowSyncWhileFocused) {
				return;
			}
			writeSegmentsToRoot(el, segments, domHandlers);
			lastEmittedRef.current = wire;
			placeCaretAfterFirstSlashChipElseEnd(el);
			return;
		}
		writeSegmentsToRoot(el, segments, domHandlers);
		lastEmittedRef.current = wire;
		placeCaretAfterFirstSlashChipElseEnd(el);
	}, [segments, innerRef, domHandlers]);

	/** 仅这些键会移动光标但不走 composition 的 input 事件，需补一次 @/slash overlay 同步 */
	const KEYS_NEED_RICH_OVERLAY_RESYNC = new Set([
		'ArrowLeft',
		'ArrowRight',
		'ArrowUp',
		'ArrowDown',
		'Home',
		'End',
		'PageUp',
		'PageDown',
	]);

	const handleInput = () => {
		emitFromDom();
		const el = innerRef.current;
		if (el) {
			onRichInput(el);
		}
		if (el && onInputHeight) {
			onInputHeight(el);
		}
	};

	const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
		const list = e.clipboardData?.files;
		if (!list?.length || !onComposerAttachFiles) {
			return;
		}
		const files = Array.from(list).filter((f) => f.size > 0);
		if (files.length === 0) {
			return;
		}
		e.preventDefault();
		void consumeDroppedOrPastedFiles(files);
	};

	const onDragEnter = (e: React.DragEvent) => {
		if (!onComposerAttachFiles || !dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current += 1;
		setFileDragOver(true);
	};

	const onDragLeave = (e: React.DragEvent) => {
		if (!onComposerAttachFiles) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) {
			setFileDragOver(false);
		}
	};

	const onDragOver = (e: React.DragEvent) => {
		if (!onComposerAttachFiles || !dataTransferHasFiles(e.dataTransfer)) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'copy';
	};

	const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current = 0;
		setFileDragOver(false);
		if (!onComposerAttachFiles) {
			return;
		}
		const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.size > 0);
		if (files.length === 0) {
			return;
		}
		void consumeDroppedOrPastedFiles(files);
	};

	return (
		<div
			className={['ref-composer-rich-wrap', fileDragOver ? 'is-file-drag-over' : ''].filter(Boolean).join(' ')}
			onDragEnter={onDragEnter}
			onDragLeave={onDragLeave}
			onDragOver={onDragOver}
		>
			<div
				ref={innerRef as React.Ref<HTMLDivElement>}
				className={['ref-composer-rich-input', showPlaceholder ? 'ref-composer-rich-input--ph' : '', className]
					.filter(Boolean)
					.join(' ')}
				contentEditable
				suppressContentEditableWarning
				role="textbox"
				aria-multiline="true"
				aria-placeholder={placeholder?.trim() ? placeholder : undefined}
				data-placeholder={placeholder || ''}
				onFocus={() => {
					focusedRef.current = true;
					if (segmentsToWireText(segments).trim() !== '') {
						return;
					}
					/* 空 contenteditable 聚焦后 WebKit 可能插入 <br>，选区落在其后 */
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							if (segmentsToWireText(segments).trim() !== '') {
								return;
							}
							placeCaretAtContentStart();
						});
					});
				}}
				onBlur={() => {
					focusedRef.current = false;
				}}
				onInput={handleInput}
				onPaste={onPaste}
				onDrop={onDrop}
				onSelect={() => {
					const el = innerRef.current;
					if (el) {
						onRichSelect(el);
					}
				}}
				onKeyUp={(e) => {
					const el = innerRef.current;
					/* onInput 已同步可打印字符；此处避免每键重复 syncComposerOverlays 造成卡顿 */
					if (el && KEYS_NEED_RICH_OVERLAY_RESYNC.has(e.key)) {
						onRichInput(el);
					}
					if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') {
						const ed = innerRef.current;
						if (ed && onInputHeight) {
							onInputHeight(ed);
						}
					}
				}}
				onMouseUp={() => {
					const el = innerRef.current;
					if (el) {
						onRichSelect(el);
					}
				}}
				onKeyDown={onKeyDown}
			/>
		</div>
	);
}
