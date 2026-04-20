/**
 * 在 AgentPreflightShell 内显示的「思考」条目。
 *
 * B 方案：与 ActivityRow（已搜索 / 已读取）使用同一种条目样式，不再独立紫色头。
 * - head 一行：闪烁圆点 + "思考中…" / "已思考 X.Xs"
 * - body：思考正文（淡灰 markdown），始终展示，由外层 shell 的 preview/expanded 控制限高
 */
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from './i18n';

type Phase = 'thinking' | 'streaming' | 'done';

type Props = {
	phase: Phase;
	elapsedSeconds: number;
	chunks?: Array<{ id: string; text: string }>;
	streamingThinking?: string;
};

export const PreflightThinkingItem = memo(function PreflightThinkingItem({
	phase,
	elapsedSeconds,
	chunks,
	streamingThinking = '',
}: Props) {
	const { t } = useI18n();

	const renderChunks = useMemo(() => {
		if (Array.isArray(chunks) && chunks.length > 0) {
			return chunks.filter((c) => c.text.trim().length > 0);
		}
		if (!streamingThinking.trim()) return [] as Array<{ id: string; text: string }>;
		return [{ id: 'fallback-thinking', text: streamingThinking }];
	}, [chunks, streamingThinking]);

	const reasoningBody = useMemo(
		() => renderChunks.map((c) => c.text).join('\n\n'),
		[renderChunks]
	);
	const hasBody = reasoningBody.trim().length > 0;

	const sec = Math.max(0, elapsedSeconds);
	const secLabel = sec < 10 ? sec.toFixed(1) : String(Math.round(sec));
	const headline =
		phase === 'thinking' ? t('thought.thinking') : t('thought.for', { sec: secLabel });

	return (
		<div className={`ref-preflight-thinking ${phase === 'done' ? 'is-done' : 'is-pending'}`}>
			<div className="ref-preflight-thinking-head">
				<span
					className={`ref-preflight-thinking-dot ref-preflight-thinking-dot--${phase}`}
					aria-hidden
				/>
				<span className="ref-preflight-thinking-label">{headline}</span>
			</div>
			{hasBody ? (
				<div className="ref-preflight-thinking-body">
					<div className="ref-md-root ref-thought-md-root">
						<ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningBody}</ReactMarkdown>
					</div>
				</div>
			) : null}
		</div>
	);
});
