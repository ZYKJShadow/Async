/**
 * 用户气泡正下方的「过程区」统一壳。
 *
 * 把 AI 在产出实际结果（file_edit / 命令围栏 / 收尾总结）之前的所有过程性内容
 * （思考 / 搜索 / 读取 / 解释性 markdown / Explored 分组）统一收纳到一个二态容器中：
 *
 * - `expanded`：完整展示过程内容，正文可粘底跟随流式。
 * - `collapsed`：只剩 head 一行 summary。
 *
 * 自动默认值：
 * - 流式期间 (`liveTurn=true`)：默认 `expanded`，让用户能看到实时过程。
 * - 回合结束后：若已有 outcome，默认 `collapsed`（把视线让给最终回答）；否则保持 `expanded`。
 *
 * 关键不变量：
 * - 流式期间不会因 `hasOutcome` 改变而自动收起，避免「壳一边收一边吞文字」的视觉问题。
 * - 用户手动 toggle 过后，自动逻辑全部失效，完全交给用户。
 * - toggle 行为是真正的二值取反：开 ↔ 关。
 */
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import { useI18n } from './i18n';
import type { TurnTokenUsage } from './ipcTypes';

type DisplayState = 'collapsed' | 'expanded';

type Props = {
	children: ReactNode;
	/** 本回合是否仍在进行（awaitingReply && isLast） */
	liveTurn?: boolean;
	/** 本回合下方是否已出现实际结果（file_edit / 命令围栏 / 收尾总结） */
	hasOutcome?: boolean;
	/** 思考阶段：用于 head 文案与 spinner */
	phase?: 'thinking' | 'streaming' | 'done';
	/** done 阶段可在末尾展示 token 用量 */
	tokenUsage?: TurnTokenUsage | null;
	/** 贴底时跳过高度动画，避免外层 follow-bottom 与 max-height transition 互相拉扯 */
	instantToggle?: boolean;
	/** 点击展开/收起时读取最新外层贴底状态，避免使用父级上一次 render 的旧快照 */
	shouldInstantToggle?: () => boolean;
	/** 展开/收起提交到 DOM 后通知父级同步重算外层补高 */
	onLayoutChange?: () => void;
};

function defaultDisplayState(liveTurn: boolean, hasOutcome: boolean): DisplayState {
	if (liveTurn) return 'expanded';
	return hasOutcome ? 'collapsed' : 'expanded';
}

export const AgentPreflightShell = memo(function AgentPreflightShell({
	children,
	liveTurn = false,
	hasOutcome = false,
	phase = 'thinking',
	tokenUsage,
	instantToggle = false,
	shouldInstantToggle,
	onLayoutChange,
}: Props) {
	const { t } = useI18n();

	const [displayState, setDisplayState] = useState<DisplayState>(() =>
		defaultDisplayState(liveTurn, hasOutcome)
	);
	const [toggleInstantOverride, setToggleInstantOverride] = useState(false);
	const userToggledRef = useRef(false);
	const prevLiveTurnRef = useRef(liveTurn);

	// 仅在 liveTurn 真正发生 true→false 跳变（即回合结束）那一刻应用一次默认收起策略。
	// 不再监听 hasOutcome：流式期间 hasOutcome 反复变化会导致壳被收起又展开，
	// 配合「文字位置不变」的新切分语义后，已无任何中途收起的合理性。
	useEffect(() => {
		const wasLive = prevLiveTurnRef.current;
		prevLiveTurnRef.current = liveTurn;
		if (!wasLive || liveTurn) return;
		if (userToggledRef.current) return;
		// 回合结束的最后一帧 hasOutcome 决定默认态：有结果 → 收起聚焦答案；无结果 → 保持展开
		const next = defaultDisplayState(false, hasOutcome);
		const id = setTimeout(() => {
			setToggleInstantOverride(shouldInstantToggle?.() ?? instantToggle);
			setDisplayState(next);
		}, 600);
		return () => clearTimeout(id);
	}, [liveTurn, hasOutcome, instantToggle, shouldInstantToggle]);

	const bodyRef = useRef<HTMLDivElement>(null);
	const pinnedToBottomRef = useRef(true);

	const onBodyScroll = useCallback(() => {
		const el = bodyRef.current;
		if (!el) return;
		const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		pinnedToBottomRef.current = distFromBottom < 40;
	}, []);

	useLayoutEffect(() => {
		if (displayState === 'collapsed' || !pinnedToBottomRef.current) return;
		const el = bodyRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [children, displayState]);

	const didMountLayoutRef = useRef(false);
	useLayoutEffect(() => {
		if (!didMountLayoutRef.current) {
			didMountLayoutRef.current = true;
			return;
		}
		onLayoutChange?.();
	}, [displayState, onLayoutChange]);

	useEffect(() => {
		if (displayState === 'expanded') {
			pinnedToBottomRef.current = true;
			const el = bodyRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		}
	}, [displayState]);

	useLayoutEffect(() => {
		if (!toggleInstantOverride) return;
		const id = window.requestAnimationFrame(() => setToggleInstantOverride(false));
		return () => window.cancelAnimationFrame(id);
	}, [displayState, toggleInstantOverride]);

	const resolveInstantToggle = useCallback(
		() => shouldInstantToggle?.() ?? instantToggle,
		[instantToggle, shouldInstantToggle]
	);

	/** 真正的二值取反：collapsed ↔ expanded。点击后锁定，自动逻辑不再生效。 */
	const onToggle = useCallback(() => {
		userToggledRef.current = true;
		setToggleInstantOverride(resolveInstantToggle());
		setDisplayState((s) => (s === 'expanded' ? 'collapsed' : 'expanded'));
	}, [resolveInstantToggle]);

	const isOpen = displayState === 'expanded';
	const useInstantToggle = instantToggle || toggleInstantOverride;
	const isPending = liveTurn && phase !== 'done';
	const headLabel = isPending
		? t('agent.preflight.working')
		: hasOutcome
			? t('agent.preflight.summary.done')
			: t('agent.preflight.summary.idle');

	return (
		<div
			className={`ref-preflight-shell ${isPending ? 'is-pending' : 'is-done'}`}
			data-state={displayState}
		>
			<button
				type="button"
				className="ref-preflight-shell-header"
				aria-expanded={isOpen}
				onClick={onToggle}
			>
				<span className="ref-preflight-shell-icon" aria-hidden>
					{isPending ? <SpinnerIcon /> : <ProcessIcon />}
				</span>
				<span className="ref-preflight-shell-summary">{headLabel}</span>
				<span
					className="ref-preflight-shell-chevron"
					data-state={displayState}
					aria-hidden
				>
					{isOpen ? <ChevronDown /> : <ChevronRight />}
				</span>
			</button>

			<div
				className={`ref-preflight-shell-collapse ${isOpen ? 'is-open' : ''}${useInstantToggle ? ' instant-toggle' : ''}`}
			>
				<div
					ref={bodyRef}
					className={`ref-preflight-shell-body ${isPending ? 'ref-preflight-shell-body--live' : ''}`}
					onScroll={onBodyScroll}
				>
					{children}
					{phase === 'done' && tokenUsage && (tokenUsage.inputTokens || tokenUsage.outputTokens) ? (
						<div className="ref-preflight-shell-usage">
							{t('usage.tokens', {
								input: (tokenUsage.inputTokens ?? 0).toLocaleString(),
								output: (tokenUsage.outputTokens ?? 0).toLocaleString(),
							})}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
});

function ProcessIcon() {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<circle cx="11" cy="11" r="8" />
			<path d="M21 21l-4.35-4.35" />
		</svg>
	);
}

function SpinnerIcon() {
	return (
		<svg
			className="ref-preflight-shell-spinner"
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			aria-hidden
		>
			<path d="M12 2a10 10 0 0 1 10 10" />
		</svg>
	);
}

function ChevronDown() {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M6 9l6 6 6-6" />
		</svg>
	);
}

function ChevronRight() {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M9 6l6 6-6 6" />
		</svg>
	);
}
