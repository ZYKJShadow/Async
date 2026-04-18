import { slashCommandWire, type ComposerSegment } from './composerSegments';
import { FileTypeIcon, isRasterImageRelPath } from './fileTypeIcons';

function fileBasename(path: string): string {
	const n = path.replace(/\\/g, '/');
	return n.split('/').pop() || n;
}

type Props = {
	segments: ComposerSegment[];
	/** 点击文件 chip 时（需 stopPropagation 避免触发外层「编辑整条」） */
	onFileClick: (relPath: string) => void;
};

/**
 * 已发送用户消息的只读展示：与输入框内 chip 样式一致，可点击打开文件。
 */
export function UserMessageRich({ segments, onFileClick }: Props) {
	return (
		<span className="ref-msg-user-rich">
			{segments.map((s) =>
				s.kind === 'text' ? (
					<span key={s.id} className="ref-msg-user-rich-text">
						{s.text}
					</span>
				) : s.kind === 'command' ? (
					<span
						key={s.id}
						className="ref-inline-slash-chip ref-inline-slash-chip--readonly"
						aria-hidden
					>
						<span className="ref-inline-slash-chip-label">{slashCommandWire(s.command)}</span>
					</span>
				) : s.kind === 'file' ? (
					<span
						key={s.id}
						role="button"
						tabIndex={0}
						className={[
							'ref-inline-file-chip',
							'ref-inline-file-chip--readonly',
							isRasterImageRelPath(s.path) ? 'ref-inline-file-chip--image' : '',
						]
							.filter(Boolean)
							.join(' ')}
						title={s.path}
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onFileClick(s.path);
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								e.stopPropagation();
								onFileClick(s.path);
							}
						}}
					>
						<span className="ref-inline-file-chip-ico" aria-hidden>
							<FileTypeIcon fileName={fileBasename(s.path)} isDirectory={false} className="ref-inline-file-chip-svg" />
						</span>
						<span className="ref-inline-file-chip-name">{fileBasename(s.path)}</span>
					</span>
				) : null
			)}
		</span>
	);
}
