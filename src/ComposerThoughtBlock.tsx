import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TurnTokenUsage } from './ipcTypes';
import { useI18n } from './i18n';

type Phase = 'thinking' | 'streaming' | 'done';

/**
 * 三态显示：
 * - `preview`：默认。head 下方留一段最小高度的滚动预览，正文可粘底。
 * - `expanded`：用户主动展开，正文不限高，完全融入聊天流。
 * - `collapsed`：完全只剩 head 单行 summary。当本回合下方已出现真正的工具/文件/收尾输出
 *   时自动切到该态（仅当用户没有手动 toggle 过）。
 */
type DisplayState = 'collapsed' | 'preview' | 'expanded';

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
	/**
	 * 本块之后是否已渲染真正的工具/文件输出片段（file_edit、命令围栏、diff、收尾 markdown 等）。
	 * 为 true 时自动切到 `collapsed` 单行 summary，把注意力让给结果卡片，
	 * 用户手动 toggle 过后不再被自动覆盖。
	 */
	followingToolLikeWork?: boolean;
};

export function ComposerThoughtBlock({
	phase,
	elapsedSeconds,
	defaultOpen,
	streamingThinking = '',
	chunks,
	tokenUsage,
	followingToolLikeWork = false,
}: Props) {
	const { t } = useI18n();
	const renderChunks = useMemo(() => {
		if (Array.isArray(chunks) && chunks.length > 0) {
			return chunks.filter((chunk) => chunk.text.trim().length > 0);
		}
		if (!streamingThinking.trim()) {
			return [] as Array<{ id: string; text: string }>;
		}
		return [{ id: 'fallback-thinking', text: streamingThinking }];
	}, [chunks, streamingThinking]);
	const reasoningBody = useMemo(() => renderChunks.map((chunk) => chunk.text).join('\n\n'), [renderChunks]);
	const hasBody = reasoningBody.trim().length > 0;

	const [displayState, setDisplayState] = useState<DisplayState>(() => {
		if (defaultOpen) {
			return 'expanded';
		}
		return 'preview';
	});
	const userToggledRef = useRef(false);

	/* 后续已出现工具/收尾输出 → 自动收成单行 summary，除非用户手动 toggle 过 */
	useEffect(() => {
		if (!followingToolLikeWork) {
			return;
		}
		if (userToggledRef.current) {
			return;
		}
		setDisplayState('collapsed');
	}, [followingToolLikeWork]);

	const reasoningScrollRef = useRef<HTMLDivElement>(null);
	const pinnedToBottomRef = useRef(true);

	/** 用户在预览框内主动上滚则停止粘底；滚回底部又恢复 */
	const onReasoningScroll = useCallback(() => {
		const el = reasoningScrollRef.current;
		if (!el) {
			return;
		}
		const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		pinnedToBottomRef.current = distFromBottom < 40;
	}, []);

	/** preview/expanded 状态下流式变长时粘底 */
	useLayoutEffect(() => {
		if (displayState === 'collapsed' || renderChunks.length === 0) {
			return;
		}
		if (!pinnedToBottomRef.current) {
			return;
		}
		const el = reasoningScrollRef.current;
		if (!el) {
			return;
		}
		let cancelled = false;
		const pinBottom = () => {
			if (cancelled || !reasoningScrollRef.current) {
				return;
			}
			const wrap = reasoningScrollRef.current;
			wrap.scrollTop = wrap.scrollHeight;
		};
		pinBottom();
		let raf1 = 0;
		let raf2 = 0;
		raf1 = requestAnimationFrame(() => {
			pinBottom();
			raf2 = requestAnimationFrame(pinBottom);
		});
		return () => {
			cancelled = true;
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
		};
	}, [displayState, renderChunks]);

	const id = useId();
	const headId = `${id}-head`;
	const panelId = `${id}-panel`;

	const sec = Math.max(0, elapsedSeconds);
	const secLabel = sec < 10 ? sec.toFixed(1) : String(Math.round(sec));

	/** 思考阶段（首 token 前）不展示秒数，避免长时间停在「0.0s」；有输出后沿用原有用时展示。 */
	const headline =
		phase === 'thinking' ? t('thought.thinking') : t('thought.for', { sec: secLabel });

	/** 二态切换：preview/collapsed → expanded → preview；点击后 userToggledRef 锁定，自动逻辑不再覆盖 */
	const onToggle = useCallback(() => {
		userToggledRef.current = true;
		setDisplayState((s) => (s === 'expanded' ? 'preview' : 'expanded'));
	}, []);

	const isOpen = displayState !== 'collapsed';
	const ariaExpanded = isOpen;

	return (
		<div className="ref-thought-block" data-state={displayState}>
			<button
				type="button"
				id={headId}
				className="ref-thought-head"
				aria-expanded={ariaExpanded}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<span className={`ref-thought-head-indicator ref-thought-head-indicator--${phase}`} aria-hidden />
				<span className="ref-thought-head-copy">
					<span className="ref-thought-head-label">{headline}</span>
				</span>
				<span className={`ref-thought-chev ${displayState === 'expanded' ? 'is-open' : ''}`} aria-hidden>
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
			<div className={`ref-collapse-grid ${isOpen ? 'is-open' : ''}`}>
				<div className="ref-collapse-inner">
					<div id={panelId} role="region" aria-labelledby={headId} className="ref-thought-panel">
						{hasBody ? (
							<div
								ref={reasoningScrollRef}
								className="ref-thought-reasoning-wrap"
								onScroll={onReasoningScroll}
							>
								<div className="ref-thought-reasoning-surface">
									<div className="ref-md-root ref-thought-md-root">
										<ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningBody}</ReactMarkdown>
									</div>
								</div>
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
