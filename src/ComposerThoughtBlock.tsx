import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TurnTokenUsage } from './ipcTypes';
import { useI18n } from './i18n';

type Phase = 'thinking' | 'streaming' | 'done';

type Props = {
	phase: Phase;
	/** 首 token 前已用秒数（思考阶段）；done 时为冻结值 */
	elapsedSeconds: number;
	/** 受控折叠；默认收起 */
	defaultOpen?: boolean;
	/** 扩展思考流式正文（Anthropic 等）；不写入历史气泡 */
	streamingThinking?: string;
	chunks?: Array<{ id: string; text: string }>;
	/** 本回合 token 用量（done 阶段展示） */
	tokenUsage?: TurnTokenUsage | null;
};

export function ComposerThoughtBlock({
	phase,
	elapsedSeconds,
	defaultOpen = false,
	streamingThinking = '',
	chunks,
	tokenUsage,
}: Props) {
	const { t } = useI18n();
	const [open, setOpen] = useState(defaultOpen);
	const renderChunks = useMemo(() => {
		if (Array.isArray(chunks) && chunks.length > 0) {
			return chunks.filter((chunk) => chunk.text.trim().length > 0);
		}
		if (!streamingThinking.trim()) {
			return [] as Array<{ id: string; text: string }>;
		}
		return [{ id: 'fallback-thinking', text: streamingThinking }];
	}, [chunks, streamingThinking]);

	useEffect(() => {
		if (renderChunks.length > 0) {
			setOpen(true);
		}
	}, [renderChunks]);
	const id = useId();
	const headId = `${id}-head`;
	const panelId = `${id}-panel`;

	const sec = Math.max(0, elapsedSeconds);
	const secLabel = sec < 10 ? sec.toFixed(1) : String(Math.round(sec));

	const headline =
		phase === 'thinking' ? t('thought.thinking', { sec: secLabel }) : t('thought.for', { sec: secLabel });

	const onToggle = useCallback(() => setOpen((o) => !o), []);

	return (
		<div className="ref-thought-block">
			<button
				type="button"
				id={headId}
				className="ref-thought-head"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<span className="ref-thought-head-label">{headline}</span>
				<span className={`ref-thought-chev ${open ? 'is-open' : ''}`} aria-hidden>
					<svg
						className="ref-thought-chev-svg"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					>
						<path d="M6 9l6 6 6-6" />
					</svg>
				</span>
			</button>
			<div className={`ref-collapse-grid ${open ? 'is-open' : ''}`}>
				<div className="ref-collapse-inner">
					<div id={panelId} role="region" aria-labelledby={headId} className="ref-thought-panel">
						{renderChunks.length > 0 ? (
							<div className="ref-thought-reasoning-wrap">
								{renderChunks.map((chunk) => (
									<div key={chunk.id} className="ref-thought-reasoning-chunk">
										<div className="ref-md-root ref-thought-md-root">
											<ReactMarkdown remarkPlugins={[remarkGfm]}>{chunk.text}</ReactMarkdown>
										</div>
									</div>
								))}
							</div>
						) : null}
						{phase === 'done' && tokenUsage && (tokenUsage.inputTokens || tokenUsage.outputTokens) ? (
							<div className="ref-thought-usage">
								{t('usage.tokens', {
									input: (tokenUsage.inputTokens ?? 0).toLocaleString(),
									output: (tokenUsage.outputTokens ?? 0).toLocaleString(),
								})}
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
