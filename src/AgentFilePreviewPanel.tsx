import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTypeIcon } from './fileTypeIcons';
import {
	buildAgentFilePreviewHunks,
	buildAgentFilePreviewRows,
	buildPlainAgentFilePreviewRows,
	type AgentFilePreviewHunk,
	type AgentFilePreviewRow,
} from './agentFilePreviewDiff';
import {
	agentFilePreviewPathToLang,
	computeAgentFilePreviewLineHtmls,
	ensureAgentFilePreviewLang,
	getAgentFilePreviewHighlighter,
} from './agentFilePreviewShiki';
import { useI18n, type TFunction } from './i18n';
import { voidShellDebugLog } from './tabCloseDebug';
import { useDomColorScheme } from './useDomColorScheme';
import type {
	AgentFilePreviewKind,
	AgentFilePreviewUnsupportedReason,
} from './hooks/useAgentFileReview';

type Props = {
	filePath: string;
	content: string;
	diff?: string | null;
	loading?: boolean;
	readError?: string | null;
	isBinary?: boolean;
	previewKind?: AgentFilePreviewKind;
	fileSize?: number;
	unsupportedReason?: AgentFilePreviewUnsupportedReason | null;
	imageUrl?: string;
	revealLine?: number;
	revealEndLine?: number;
	onOpenInEditor?: () => void;
	onOpenWithDefault?: () => void;
	onCopyPath?: () => void;
	onAcceptHunk?: (patch: string) => void;
	onRevertHunk?: (patch: string) => void;
	busyHunkPatch?: string | null;
};

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

function formatFileSize(bytes: number | undefined): string | null {
	if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
		return null;
	}
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(digits)} ${units[unit]}`;
}

function previewKindLabel(t: TFunction, kind: AgentFilePreviewKind | undefined): string {
	switch (kind) {
		case 'image':
			return t('app.filePreviewKindImage');
		case 'pdf':
			return t('app.filePreviewKindPdf');
		case 'office':
			return t('app.filePreviewKindOffice');
		case 'archive':
			return t('app.filePreviewKindArchive');
		case 'media':
			return t('app.filePreviewKindMedia');
		case 'font':
			return t('app.filePreviewKindFont');
		case 'executable':
			return t('app.filePreviewKindExecutable');
		case 'large':
			return t('app.filePreviewKindLarge');
		case 'binary':
			return t('app.filePreviewKindBinary');
		default:
			return t('app.filePreviewKindUnknown');
	}
}

function unsupportedPreviewMessage(
	t: TFunction,
	kind: AgentFilePreviewKind | undefined,
	reason: AgentFilePreviewUnsupportedReason | null | undefined
): string {
	if (reason === 'too-large' || kind === 'large') {
		return t('app.filePreviewUnsupportedLarge');
	}
	if (kind === 'image') {
		return t('app.filePreviewUnsupportedImage');
	}
	if (kind === 'office') {
		return t('app.filePreviewUnsupportedOffice');
	}
	if (kind === 'pdf') {
		return t('app.filePreviewUnsupportedPdf');
	}
	if (kind === 'archive') {
		return t('app.filePreviewUnsupportedArchive');
	}
	if (kind === 'media') {
		return t('app.filePreviewUnsupportedMedia');
	}
	return t('app.filePreviewUnsupportedBinary');
}

function inRevealRange(line: number | null, start: number | undefined, end: number | undefined): boolean {
	if (line == null || start == null || !Number.isFinite(start) || start <= 0) {
		return false;
	}
	const hi = end != null && Number.isFinite(end) && end >= start ? end : start;
	return line >= start && line <= hi;
}

type PreviewBlock =
	| { type: 'plain'; row: AgentFilePreviewRow; index: number }
	| { type: 'hunk'; hunk: AgentFilePreviewHunk; rows: Array<{ row: AgentFilePreviewRow; index: number }> };

type PreviewHunkSegment = {
	kind: AgentFilePreviewRow['kind'];
	rows: Array<{ row: AgentFilePreviewRow; index: number }>;
};

function buildPreviewBlocks(rows: AgentFilePreviewRow[], hunks: AgentFilePreviewHunk[]): PreviewBlock[] {
	const hunkMap = new Map(hunks.map((hunk) => [hunk.id, hunk]));
	const blocks: PreviewBlock[] = [];
	let index = 0;
	while (index < rows.length) {
		const row = rows[index]!;
		const hunk = row.hunkId ? hunkMap.get(row.hunkId) : undefined;
		if (!hunk) {
			blocks.push({ type: 'plain', row, index });
			index += 1;
			continue;
		}
		const groupedRows: Array<{ row: AgentFilePreviewRow; index: number }> = [];
		let cursor = index;
		while (cursor < rows.length && rows[cursor]?.hunkId === hunk.id) {
			groupedRows.push({ row: rows[cursor]!, index: cursor });
			cursor += 1;
		}
		blocks.push({ type: 'hunk', hunk, rows: groupedRows });
		index = cursor;
	}
	return blocks;
}

function buildHunkSegments(rows: Array<{ row: AgentFilePreviewRow; index: number }>): PreviewHunkSegment[] {
	const segments: PreviewHunkSegment[] = [];
	for (const entry of rows) {
		const previous = segments[segments.length - 1];
		if (!previous || previous.kind !== entry.row.kind) {
			segments.push({ kind: entry.row.kind, rows: [entry] });
			continue;
		}
		previous.rows.push(entry);
	}
	return segments;
}

export function AgentFilePreviewPanel({
	filePath,
	content,
	diff,
	loading = false,
	readError = null,
	isBinary = false,
	previewKind = 'text',
	fileSize,
	unsupportedReason = null,
	imageUrl,
	revealLine,
	revealEndLine,
	onOpenInEditor,
	onOpenWithDefault,
	onCopyPath,
	onAcceptHunk,
	onRevertHunk,
	busyHunkPatch = null,
}: Props) {
	const { t } = useI18n();
	const colorScheme = useDomColorScheme();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [rows, setRows] = useState<AgentFilePreviewRow[]>(() =>
		isBinary || String(diff ?? '').trim() ? [] : buildPlainAgentFilePreviewRows(content)
	);
	const [hunks, setHunks] = useState<AgentFilePreviewHunk[]>([]);
	const [shikiHtmlByRow, setShikiHtmlByRow] = useState<string[] | null>(null);
	useEffect(() => {
		if (loading || readError || isBinary) {
			setRows([]);
			setHunks([]);
			return;
		}
		let cancelled = false;
		const raw = String(diff ?? '').trim();
		if (!raw) {
			setRows(buildPlainAgentFilePreviewRows(content));
			setHunks([]);
			return;
		}
		void (async () => {
			const [nextRows, nextHunks] = await Promise.all([
				buildAgentFilePreviewRows(content, diff),
				buildAgentFilePreviewHunks(diff),
			]);
			if (!cancelled) {
				setRows(nextRows);
				setHunks(nextHunks);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [content, diff, loading, readError, isBinary]);

	useEffect(() => {
		if (loading || readError || isBinary) {
			setShikiHtmlByRow(null);
			return;
		}
		if (rows.length === 0) {
			setShikiHtmlByRow(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const langGuess = agentFilePreviewPathToLang(filePath);
				const h = await getAgentFilePreviewHighlighter();
				const lang = await ensureAgentFilePreviewLang(langGuess);
				if (cancelled) {
					return;
				}
				const next = computeAgentFilePreviewLineHtmls(h, lang, rows, colorScheme);
				if (!cancelled) {
					setShikiHtmlByRow(next);
				}
			} catch (e) {
				console.warn('[AgentFilePreviewPanel] Shiki 高亮失败', e);
				if (!cancelled) {
					setShikiHtmlByRow(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [filePath, rows, loading, readError, isBinary, colorScheme]);

	const hunkMap = useMemo(() => new Map(hunks.map((hunk) => [hunk.id, hunk])), [hunks]);
	const blocks = useMemo(() => buildPreviewBlocks(rows, hunks), [rows, hunks]);
	const name = basename(filePath);
	const displaySize = formatFileSize(fileSize);
	const showUnsupported = !loading && !readError && (isBinary || unsupportedReason != null);
	const showImagePreview = showUnsupported && previewKind === 'image' && typeof imageUrl === 'string' && imageUrl.length > 0;
	const canOpenInEditor = !showUnsupported && onOpenInEditor;

	useEffect(() => {
		if (loading) {
			return;
		}
		const addRows = rows.filter((row) => row.kind === 'add').length;
		const delRows = rows.filter((row) => row.kind === 'del').length;
		voidShellDebugLog('agent-file-preview:render', {
			filePath,
			diffLength: String(diff ?? '').length,
			rowCount: rows.length,
			blockCount: blocks.length,
			hunkCount: hunks.length,
			addRows,
			delRows,
			isBinary,
			readError: readError ?? '',
			firstRowKinds: rows.slice(0, 8).map((row) => row.kind).join(','),
		});
	}, [blocks.length, diff, filePath, hunks.length, isBinary, loading, readError, rows]);

	useEffect(() => {
		if (loading) {
			return;
		}
		const root = scrollRef.current;
		if (!root) {
			return;
		}
		const scrollBlockIntoView = (block: HTMLElement) => {
			const desiredTop = Math.max(0, block.offsetTop - Math.round(root.clientHeight * 0.2));
			root.scrollTo({ top: desiredTop });
		};
		const target = root.querySelector<HTMLElement>('.ref-agent-file-preview-row.is-target');
		const targetBlock = target?.closest<HTMLElement>('.ref-agent-file-preview-hunk-block') ?? null;
		if (targetBlock) {
			scrollBlockIntoView(targetBlock);
			return;
		}
		if (target) {
			target.scrollIntoView({ block: 'center' });
			return;
		}
		const firstChanged = root.querySelector<HTMLElement>(
			'.ref-agent-file-preview-row--add, .ref-agent-file-preview-row--del'
		);
		const firstChangedBlock = firstChanged?.closest<HTMLElement>('.ref-agent-file-preview-hunk-block') ?? null;
		if (firstChangedBlock) {
			scrollBlockIntoView(firstChangedBlock);
			return;
		}
		if (firstChanged) {
			firstChanged.scrollIntoView({ block: 'center' });
			return;
		}
		root.scrollTop = 0;
	}, [filePath, loading, rows, revealLine, revealEndLine]);

	const renderRow = (row: AgentFilePreviewRow, index: number, inHunkBlock: boolean) => {
		const focusLine = row.newLineNo ?? row.oldLineNo;
		const targeted = inRevealRange(focusLine, revealLine, revealEndLine);
		const hunk = row.hunkId ? hunkMap.get(row.hunkId) : undefined;
		const rowClasses = [
			'ref-agent-file-preview-row',
			`ref-agent-file-preview-row--${row.kind}`,
			inHunkBlock ? 'ref-agent-file-preview-row--in-hunk' : '',
			targeted ? 'is-target' : '',
		].filter(Boolean).join(' ');
		const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
		const shikiReady = shikiHtmlByRow != null && shikiHtmlByRow.length === rows.length;
		const lineHtml = shikiReady ? shikiHtmlByRow[index] : null;

		return (
			<div
				key={`${row.kind}-${index}-${row.oldLineNo ?? 'x'}-${row.newLineNo ?? 'x'}`}
				className={rowClasses}
				data-hunk-id={hunk?.id ?? undefined}
			>
				<div className="ref-agent-file-preview-gutter" aria-hidden>
					<span className="ref-agent-file-preview-old-no">
						{row.oldLineNo ?? ''}
					</span>
					<span className="ref-agent-file-preview-new-no">
						{row.newLineNo ?? ''}
					</span>
				</div>
				{inHunkBlock ? null : (
					<span className="ref-agent-file-preview-sign" aria-hidden>
						{sign || ' '}
					</span>
				)}
				{lineHtml != null ? (
					<code
						className="ref-agent-file-preview-line ref-agent-file-preview-line--shiki"
						dangerouslySetInnerHTML={{ __html: lineHtml || '\u00a0' }}
					/>
				) : (
					<code className="ref-agent-file-preview-line">
						{row.tokens.length > 0
							? row.tokens.map((token, tokenIndex) => (
									<span
										key={`${token.kind}-${tokenIndex}`}
										className={`ref-agent-file-preview-token ref-agent-file-preview-token--${token.kind}`}
									>
										{token.text || ' '}
									</span>
								))
							: ' '}
					</code>
				)}
			</div>
		);
	};

	return (
		<div className="ref-agent-file-preview-shell">
			<div className="ref-agent-file-preview-toolbar">
				<div className="ref-agent-file-preview-meta">
					<span className="ref-agent-file-preview-icon" aria-hidden>
						<FileTypeIcon fileName={name} isDirectory={false} />
					</span>
					<div className="ref-agent-file-preview-copy">
						<span className="ref-agent-file-preview-label">{t('app.filePreview')}</span>
						<span className="ref-agent-file-preview-path" title={filePath}>
							{filePath}
						</span>
					</div>
				</div>
				{canOpenInEditor ? (
					<div className="ref-agent-file-preview-toolbar-actions">
						<button
							type="button"
							className="ref-agent-file-preview-open-btn"
							onClick={onOpenInEditor}
						>
							{t('app.gitOpenInEditorAria')}
						</button>
					</div>
				) : null}
			</div>

			<div ref={scrollRef} className="ref-agent-file-preview-scroll">
				{loading ? (
					<div className="ref-agent-file-preview-state">{t('common.loading')}</div>
				) : null}
				{!loading && readError ? (
					<div className="ref-agent-file-preview-state">{t('app.readFileFailed', { detail: readError })}</div>
				) : null}
				{showUnsupported ? (
					<div
						className={[
							'ref-agent-file-preview-unsupported',
							showImagePreview ? 'ref-agent-file-preview-unsupported--image' : '',
						].filter(Boolean).join(' ')}
					>
						{showImagePreview ? (
							<div className="ref-agent-file-preview-image-stage">
								<img className="ref-agent-file-preview-image" src={imageUrl} alt={name} />
							</div>
						) : null}
						<div className="ref-agent-file-preview-unsupported-copy">
							<span className="ref-agent-file-preview-unsupported-badge">
								{previewKindLabel(t, previewKind)}
							</span>
							<div className="ref-agent-file-preview-unsupported-title">
								{showImagePreview
									? t('app.filePreviewImageTitle')
									: t('app.filePreviewUnsupportedTitle')}
							</div>
							{showImagePreview ? null : (
								<p>{unsupportedPreviewMessage(t, previewKind, unsupportedReason)}</p>
							)}
							{displaySize ? (
								<div className="ref-agent-file-preview-unsupported-meta">
									{t('app.filePreviewFileSize', { size: displaySize })}
								</div>
							) : null}
							<div className="ref-agent-file-preview-unsupported-actions">
								{onOpenWithDefault ? (
									<button
										type="button"
										className="ref-agent-file-preview-open-btn"
										onClick={onOpenWithDefault}
									>
										{t('app.filePreviewOpenDefault')}
									</button>
								) : null}
								{onCopyPath ? (
									<button
										type="button"
										className="ref-agent-file-preview-open-btn"
										onClick={onCopyPath}
									>
										{t('app.filePreviewCopyPath')}
									</button>
								) : null}
							</div>
						</div>
					</div>
				) : null}
				{!loading && !readError && !showUnsupported ? (
					<div
						className={[
							'ref-agent-file-preview-code',
							hunks.length > 0 ? 'ref-agent-file-preview-code--diff' : '',
						].filter(Boolean).join(' ')}
						role="region"
						aria-label={filePath}
					>
						{blocks.map((block) => {
							if (block.type === 'plain') {
								return renderRow(block.row, block.index, false);
							}
							const segments = buildHunkSegments(block.rows);
							const hunkBusy = Boolean(busyHunkPatch && block.hunk.patch === busyHunkPatch);
							return (
								<div key={block.hunk.id} className="ref-agent-file-preview-hunk-block">
									{onAcceptHunk || onRevertHunk ? (
										<div className="ref-agent-file-preview-hunk-bar ref-agent-file-preview-hunk-bar--floating">
											<div className="ref-agent-file-preview-hunk-actions ref-agent-file-preview-hunk-actions--floating">
												{onRevertHunk ? (
													<button
														type="button"
														className="ref-agent-file-preview-hunk-btn ref-agent-file-preview-hunk-btn--ghost"
														disabled={hunkBusy}
														onClick={() => onRevertHunk(block.hunk.patch)}
													>
														{t('app.filePreviewRevertChange')}
													</button>
												) : null}
												{onAcceptHunk ? (
													<button
														type="button"
														className="ref-agent-file-preview-hunk-btn ref-agent-file-preview-hunk-btn--primary"
														disabled={hunkBusy}
														onClick={() => onAcceptHunk(block.hunk.patch)}
													>
														{t('app.filePreviewAcceptChange')}
													</button>
												) : null}
											</div>
										</div>
									) : null}
									<div className="ref-agent-file-preview-hunk-body">
										{segments.map((segment, segmentIndex) => (
											<div
												key={`${block.hunk.id}-${segment.kind}-${segmentIndex}`}
												className={[
													'ref-agent-file-preview-hunk-segment',
													`ref-agent-file-preview-hunk-segment--${segment.kind}`,
												].join(' ')}
											>
												{segment.kind !== 'context' ? (
													<div className="ref-agent-file-preview-hunk-segment-mark" aria-hidden />
												) : null}
												{segment.rows.map(({ row, index }) => renderRow(row, index, true))}
											</div>
										))}
									</div>
								</div>
							);
						})}
					</div>
				) : null}
			</div>
		</div>
	);
}
