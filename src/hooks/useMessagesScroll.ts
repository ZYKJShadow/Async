import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type MutableRefObject,
	type RefObject,
} from 'react';
import type { ChatMessage } from '../threadTypes';

export const MESSAGES_FOLLOW_BOTTOM_BUFFER_PX = 120;
const MESSAGES_MIN_SCROLLABLE_OVERFLOW_PX = 120;
export const MESSAGES_SCROLL_TO_BOTTOM_BUTTON_DISTANCE_PX = 180;
const MESSAGES_THREAD_OPEN_SETTLE_DELAY_MS = 420;
const MESSAGES_THREAD_OPEN_SETTLE_MID_DELAY_MS = 180;

export type MessagesScrollSnapshot = {
	scrollTop: number;
	distanceFromBottom: number;
	pinned: boolean;
};

export type MessagesScrollMetrics = {
	maxScroll: number;
	clampedTop: number;
	distanceFromBottom: number;
	nearBottom: boolean;
	canJumpToBottom: boolean;
};

export type MessagesScrollSyncSource = 'user' | 'layout' | 'programmatic';

export type UseMessagesScrollParams = {
	hasConversation: boolean;
	currentId: string | null;
	currentIdRef: MutableRefObject<string | null>;
	messages: ChatMessage[];
	messagesThreadId: string | null;
	messagesThreadIdRef: MutableRefObject<string | null>;
	awaitingReply: boolean;
};

export type UseMessagesScrollResult = {
	messagesViewportRef: RefObject<HTMLDivElement | null>;
	messagesTrackRef: RefObject<HTMLDivElement | null>;
	pinMessagesToBottomRef: MutableRefObject<boolean>;
	messagesScrollSnapshotByThreadRef: MutableRefObject<Map<string, MessagesScrollSnapshot>>;
	showScrollToBottomButton: boolean;
	onMessagesScroll: () => void;
	scrollMessagesToBottom: (behavior?: ScrollBehavior) => void;
	scheduleMessagesScrollToBottom: () => void;
	syncMessagesScrollIndicators: () => void;
};

/** 计算滚动位置时，以「最后一条内容行（普通消息 / preflight / team 补充行）的底部」为准，
 *  而不是 track 的 scrollHeight 底部。这样 turn 容器 padding、tail spacer 等
 *  纯装饰性高度不会把视口顶下去；同时保留 messages viewport 自己的
 *  padding-bottom，让最后一条消息与底部输入区之间仍有安全呼吸感。 */
function resolveViewportBottomInset(viewport: HTMLElement): number {
	const view = viewport.ownerDocument?.defaultView;
	if (!view?.getComputedStyle) {
		return 0;
	}
	const styles = view.getComputedStyle(viewport);
	const paddingBottom = Number.parseFloat(styles.paddingBottom || '0') || 0;
	return Math.max(0, Math.min(paddingBottom, Math.max(0, viewport.clientHeight - 1)));
}

export function resolveContentBottomScroll(
	viewport: HTMLElement,
	track: HTMLElement | null,
	options: { protectActivePreflight?: boolean } = {}
): number {
	const { protectActivePreflight = true } = options;
	const bottomInset = resolveViewportBottomInset(viewport);
	if (!track) {
		return Math.max(0, viewport.scrollHeight - viewport.clientHeight - bottomInset);
	}
	const contentBottomRows = track.querySelectorAll<HTMLElement>(
		[
			'.ref-msg-row-measure[data-msg-index]',
			'.ref-msg-row-measure[data-preflight-for]',
			'.ref-msg-row-measure[data-content-bottom]',
		].join(', ')
	);
	if (contentBottomRows.length === 0) {
		return Math.max(0, viewport.scrollHeight - viewport.clientHeight - bottomInset);
	}
	const viewportRect = viewport.getBoundingClientRect();
	let maxBottomInViewport = -Infinity;
	let activePreflightTopInTrack: number | null = null;
	for (const row of Array.from(contentBottomRows)) {
		const rect = row.getBoundingClientRect();
		const bottomInViewport = rect.bottom - viewportRect.top;
		if (bottomInViewport > maxBottomInViewport) {
			maxBottomInViewport = bottomInViewport;
		}
		if (row.dataset?.preflightFor != null && rect.height > 0) {
			activePreflightTopInTrack = viewport.scrollTop + (rect.top - viewportRect.top);
		}
	}
	if (!Number.isFinite(maxBottomInViewport)) {
		return Math.max(0, viewport.scrollHeight - viewport.clientHeight - bottomInset);
	}
	const rawTarget =
		viewport.scrollTop + maxBottomInViewport - (viewport.clientHeight - bottomInset);
	/* 贴底时不能让"活动 preflight 行"的顶被推到 sticky user 后面 —— 否则
	   header（"正在分析…"）会被钉在顶部的 user 气泡完全遮住。
	   计算允许的最大 scrollTop:让 preflight 顶端至少落在 sticky 下沿,并额外
	   预留 STICKY_USER_BOTTOM_GAP_PX 让 user 气泡视觉上不贴顶。 */
	const STICKY_USER_BOTTOM_GAP_PX = 16;
	if (protectActivePreflight && activePreflightTopInTrack != null) {
		const stickyEl = viewport.querySelector?.('.ref-msg-sticky-user-wrap') as HTMLElement | null;
		const stickyH = stickyEl ? stickyEl.getBoundingClientRect().height : 0;
		if (stickyH > 0) {
			const maxAllowedScroll = Math.max(
				0,
				activePreflightTopInTrack - stickyH - STICKY_USER_BOTTOM_GAP_PX,
			);
			return Math.max(0, Math.min(rawTarget, maxAllowedScroll));
		}
	}
	return Math.max(0, rawTarget);
}

export function measureMessagesScroll(
	viewport: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>
): MessagesScrollMetrics {
	const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	const clampedTop = Math.max(0, Math.min(viewport.scrollTop, maxScroll));
	const distanceFromBottom = Math.max(0, maxScroll - clampedTop);
	return {
		maxScroll,
		clampedTop,
		distanceFromBottom,
		nearBottom: distanceFromBottom < MESSAGES_FOLLOW_BOTTOM_BUFFER_PX,
		canJumpToBottom: maxScroll > MESSAGES_MIN_SCROLLABLE_OVERFLOW_PX,
	};
}

/**
 * “贴底跟随”表示用户是否仍希望继续跟随最新消息，而不是当前几何上是否正好在底部。
 *
 * 只在用户滚动时根据位置改变该意图；布局增长 / team 卡片插入 / 视口缩放这些异步变化
 * 如果发生在用户原本贴底时，不应把贴底意图误判成 false。
 */
export function derivePinnedBottomIntent(
	previousPinned: boolean,
	metrics: Pick<MessagesScrollMetrics, 'nearBottom'>,
	source: MessagesScrollSyncSource
): boolean {
	if (source === 'user') {
		return metrics.nearBottom;
	}
	if (metrics.nearBottom) {
		return true;
	}
	return previousPinned;
}

export function deriveShowScrollToBottomButton(params: {
	metrics: Pick<MessagesScrollMetrics, 'canJumpToBottom' | 'distanceFromBottom'>;
	pinnedBottomIntent: boolean;
	suppress: boolean;
}): boolean {
	const { metrics, pinnedBottomIntent, suppress } = params;
	if (suppress || pinnedBottomIntent) {
		return false;
	}
	return (
		metrics.canJumpToBottom &&
		metrics.distanceFromBottom > MESSAGES_SCROLL_TO_BOTTOM_BUTTON_DISTANCE_PX
	);
}

/**
 * 对话消息滚动控制：粘底跟随、滚动指示器、跳转按钮、线程切换时的位置恢复。
 *
 * 当前实现遵循主流聊天列表的“follow output”思路：
 *  - `pinMessagesToBottomRef` 表示“是否继续跟随底部”的用户意图
 *  - 实际距离 / 是否接近底部是另一套几何状态
 *  - 内容高度变化只触发补滚，不会把贴底意图意外打掉
 */
export function useMessagesScroll(params: UseMessagesScrollParams): UseMessagesScrollResult {
	const {
		hasConversation,
		currentId,
		currentIdRef,
		messages,
		messagesThreadId,
		messagesThreadIdRef,
		awaitingReply,
	} = params;

	const messagesViewportRef = useRef<HTMLDivElement>(null);
	const messagesTrackRef = useRef<HTMLDivElement>(null);
	const messagesScrollSnapshotByThreadRef = useRef<Map<string, MessagesScrollSnapshot>>(
		new Map<string, MessagesScrollSnapshot>()
	);
	const pendingMessagesScrollRestoreRef = useRef<string | null>(null);
	const pinMessagesToBottomRef = useRef(true);
	const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
	const suppressScrollToBottomButtonRef = useRef(false);
	const suppressScrollToBottomButtonTimerRef = useRef<number | null>(null);
	const messagesScrollToBottomRafRef = useRef<number | null>(null);
	const messagesTrackScrollHeightRef = useRef(0);
	const messagesViewportClientHeightRef = useRef(0);
	const prevMessagesLenForScrollRef = useRef(0);
	const awaitingReplyRef = useRef(awaitingReply);
	awaitingReplyRef.current = awaitingReply;

	const clearScrollToBottomButtonSuppression = useCallback(() => {
		suppressScrollToBottomButtonRef.current = false;
		if (suppressScrollToBottomButtonTimerRef.current !== null) {
			window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
			suppressScrollToBottomButtonTimerRef.current = null;
		}
	}, []);

	const syncMessagesScrollState = useCallback(
		(source: MessagesScrollSyncSource) => {
			const el = messagesViewportRef.current;
			if (!el) {
				return;
			}
			const rawMetrics = measureMessagesScroll(el);
			const track = messagesTrackRef.current;
			const contentMaxScroll = resolveContentBottomScroll(el, track, {
				protectActivePreflight: awaitingReplyRef.current,
			});
			const metrics: MessagesScrollMetrics = {
				maxScroll: contentMaxScroll,
				clampedTop: rawMetrics.clampedTop,
				distanceFromBottom: Math.max(0, contentMaxScroll - rawMetrics.clampedTop),
				nearBottom:
					Math.max(0, contentMaxScroll - rawMetrics.clampedTop) <
					MESSAGES_FOLLOW_BOTTOM_BUFFER_PX,
				canJumpToBottom: contentMaxScroll > MESSAGES_MIN_SCROLLABLE_OVERFLOW_PX,
			};
			pinMessagesToBottomRef.current = derivePinnedBottomIntent(
				pinMessagesToBottomRef.current,
				metrics,
				source
			);
			const activeThreadId = messagesThreadIdRef.current ?? currentIdRef.current;
			if (activeThreadId) {
				messagesScrollSnapshotByThreadRef.current.set(activeThreadId, {
					scrollTop: metrics.clampedTop,
					distanceFromBottom: metrics.distanceFromBottom,
					pinned: pinMessagesToBottomRef.current,
				});
			}
			if (suppressScrollToBottomButtonRef.current) {
				if (metrics.nearBottom || !metrics.canJumpToBottom) {
					clearScrollToBottomButtonSuppression();
				}
				setShowScrollToBottomButton(false);
				return;
			}
			const shouldShowJumpButton = deriveShowScrollToBottomButton({
				metrics,
				pinnedBottomIntent: pinMessagesToBottomRef.current,
				suppress: suppressScrollToBottomButtonRef.current,
			});
			setShowScrollToBottomButton((prev) =>
				prev === shouldShowJumpButton ? prev : shouldShowJumpButton
			);
		},
		[
			currentIdRef,
			messagesThreadIdRef,
			clearScrollToBottomButtonSuppression,
			messagesTrackRef,
		]
	);

	const syncMessagesScrollIndicators = useCallback(() => {
		syncMessagesScrollState('layout');
	}, [syncMessagesScrollState]);

	const applyResolvedBottomScroll = useCallback(
		(behavior: ScrollBehavior = 'auto') => {
			const el = messagesViewportRef.current;
			if (!el) {
				return false;
			}
			const track = messagesTrackRef.current;
			const targetScroll = resolveContentBottomScroll(el, track, {
				protectActivePreflight: awaitingReplyRef.current,
			});
			if (behavior === 'auto') {
				el.scrollTop = targetScroll;
			} else {
				el.scrollTo({ top: targetScroll, behavior });
			}
			syncMessagesScrollState('programmatic');
			return true;
		},
		[syncMessagesScrollState]
	);

	const onMessagesScroll = useCallback(() => {
		syncMessagesScrollState('user');
	}, [syncMessagesScrollState]);

	const scrollMessagesToBottom = useCallback(
		(behavior: ScrollBehavior = 'auto') => {
			const el = messagesViewportRef.current;
			if (!el) {
				return;
			}
			pinMessagesToBottomRef.current = true;
			if (behavior === 'smooth') {
				suppressScrollToBottomButtonRef.current = true;
				if (suppressScrollToBottomButtonTimerRef.current !== null) {
					window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
				}
				suppressScrollToBottomButtonTimerRef.current = window.setTimeout(() => {
					clearScrollToBottomButtonSuppression();
					syncMessagesScrollState('layout');
				}, 1400);
			} else {
				clearScrollToBottomButtonSuppression();
			}
			setShowScrollToBottomButton(false);
			applyResolvedBottomScroll(behavior);
		},
		[applyResolvedBottomScroll, clearScrollToBottomButtonSuppression]
	);

	const scheduleMessagesScrollToBottom = useCallback(() => {
		if (!pinMessagesToBottomRef.current) {
			return;
		}
		if (messagesScrollToBottomRafRef.current !== null) {
			return;
		}
		messagesScrollToBottomRafRef.current = requestAnimationFrame(() => {
			messagesScrollToBottomRafRef.current = null;
			if (!pinMessagesToBottomRef.current) {
				return;
			}
			applyResolvedBottomScroll('auto');
		});
	}, [applyResolvedBottomScroll]);

	useLayoutEffect(() => {
		pendingMessagesScrollRestoreRef.current = currentId;
		pinMessagesToBottomRef.current = true;
		clearScrollToBottomButtonSuppression();
		setShowScrollToBottomButton(false);
		messagesTrackScrollHeightRef.current = 0;
		messagesViewportClientHeightRef.current = 0;
		if (messagesScrollToBottomRafRef.current !== null) {
			cancelAnimationFrame(messagesScrollToBottomRafRef.current);
			messagesScrollToBottomRafRef.current = null;
		}
	}, [currentId, clearScrollToBottomButtonSuppression]);

	useLayoutEffect(() => {
		if (!hasConversation || !currentId || messagesThreadId !== currentId) {
			return;
		}
		if (pendingMessagesScrollRestoreRef.current !== currentId) {
			return;
		}
		let rafId1 = 0;
		let rafId2 = 0;
		let rafId3 = 0;
		let timeoutId1 = 0;
		let timeoutId2 = 0;
		const restoreBottom = (clearPending = false) => {
			if (
				pendingMessagesScrollRestoreRef.current !== currentId &&
				currentIdRef.current !== currentId
			) {
				return false;
			}
			if (
				currentIdRef.current !== currentId ||
				messagesThreadIdRef.current !== currentId
			) {
				return false;
			}
			pinMessagesToBottomRef.current = true;
			const didScroll = applyResolvedBottomScroll('auto');
			if (didScroll && clearPending) {
				pendingMessagesScrollRestoreRef.current = null;
			}
			return didScroll;
		};
		rafId1 = requestAnimationFrame(() => {
			if (!restoreBottom(true)) {
				return;
			}
			rafId2 = requestAnimationFrame(() => {
				if (!pinMessagesToBottomRef.current) {
					return;
				}
				if (!restoreBottom()) {
					return;
				}
				rafId3 = requestAnimationFrame(() => {
					if (!pinMessagesToBottomRef.current) {
						return;
					}
					restoreBottom();
				});
			});
		});
		timeoutId1 = window.setTimeout(() => {
			if (!pinMessagesToBottomRef.current) {
				return;
			}
			restoreBottom();
		}, MESSAGES_THREAD_OPEN_SETTLE_MID_DELAY_MS);
		timeoutId2 = window.setTimeout(() => {
			if (!pinMessagesToBottomRef.current) {
				return;
			}
			restoreBottom();
		}, MESSAGES_THREAD_OPEN_SETTLE_DELAY_MS);
		return () => {
			cancelAnimationFrame(rafId1);
			cancelAnimationFrame(rafId2);
			cancelAnimationFrame(rafId3);
			window.clearTimeout(timeoutId1);
			window.clearTimeout(timeoutId2);
		};
	}, [
		hasConversation,
		currentId,
		currentIdRef,
		messages.length,
		messagesThreadId,
		messagesThreadIdRef,
		applyResolvedBottomScroll,
	]);

	useLayoutEffect(() => {
		const len = messages.length;
		const prev = prevMessagesLenForScrollRef.current;
		prevMessagesLenForScrollRef.current = len;
		if (
			len > prev &&
			currentId != null &&
			messagesThreadId === currentId &&
			messages[len - 1]?.role === 'user'
		) {
			pinMessagesToBottomRef.current = true;
			/**
			 * 「新提问后把气泡顶到视口顶部」依赖 AgentChatPanel 的 activeTurnSpacerPx：
			 * 该 spacer 在另一个 useLayoutEffect 里通过 setState 计算，会触发 React 在
			 * paint 之前的同步重渲。如果这里立即 scrollTo(maxScroll)，使用的还是「没有
			 * spacer 时」的 scrollHeight，导致用户气泡先停在视口中部/底部、流式回复一冒
			 * 出来就和气泡叠在同一行；气泡背景不透明（var(--void-bg-3)）+ z-index:8 会
			 * 把回复的顶部完全盖住。
			 *
			 * 改为先调用 scheduleMessagesScrollToBottom（rAF 内读取最新 scrollHeight），
			 * 再追加一帧补滚，覆盖 spacer 因 ResizeObserver/补测量而再度变化的情形。
			 */
			scrollMessagesToBottom('auto');
			scheduleMessagesScrollToBottom();
			window.requestAnimationFrame(() => {
				scheduleMessagesScrollToBottom();
			});
		}
	}, [messages, currentId, messagesThreadId, scrollMessagesToBottom, scheduleMessagesScrollToBottom]);

	useLayoutEffect(() => {
		if (!hasConversation || !pinMessagesToBottomRef.current) {
			return;
		}
		scheduleMessagesScrollToBottom();
	}, [hasConversation, messages.length, currentId, messagesThreadId, scheduleMessagesScrollToBottom]);

	useLayoutEffect(() => {
		if (!hasConversation) {
			setShowScrollToBottomButton(false);
			return;
		}
		const rafId = requestAnimationFrame(() => {
			syncMessagesScrollState('layout');
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, messages.length, currentId, messagesThreadId, syncMessagesScrollState]);

	useEffect(() => {
		if (!hasConversation) {
			return;
		}
		const outer = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!outer || !track) {
			return;
		}
		messagesTrackScrollHeightRef.current = track.scrollHeight;
		messagesViewportClientHeightRef.current = outer.clientHeight;
		if (pinMessagesToBottomRef.current) {
			scheduleMessagesScrollToBottom();
		}
		syncMessagesScrollState('layout');
		const ro = new ResizeObserver(() => {
			const nextTrackHeight = track.scrollHeight;
			const nextViewportHeight = outer.clientHeight;
			const trackChanged =
				Math.abs(nextTrackHeight - messagesTrackScrollHeightRef.current) > 1;
			const viewportChanged =
				Math.abs(nextViewportHeight - messagesViewportClientHeightRef.current) > 1;
			messagesTrackScrollHeightRef.current = nextTrackHeight;
			messagesViewportClientHeightRef.current = nextViewportHeight;
			if ((trackChanged || viewportChanged) && pinMessagesToBottomRef.current) {
				scheduleMessagesScrollToBottom();
			}
			syncMessagesScrollState('layout');
		});
		ro.observe(outer);
		ro.observe(track);
		return () => {
			ro.disconnect();
			if (messagesScrollToBottomRafRef.current !== null) {
				cancelAnimationFrame(messagesScrollToBottomRafRef.current);
				messagesScrollToBottomRafRef.current = null;
			}
			clearScrollToBottomButtonSuppression();
		};
	}, [
		hasConversation,
		currentId,
		messagesThreadId,
		scheduleMessagesScrollToBottom,
		syncMessagesScrollState,
		clearScrollToBottomButtonSuppression,
	]);

	useEffect(() => {
		if (!hasConversation) {
			return;
		}
		const track = messagesTrackRef.current;
		if (!track) {
			return;
		}
		const onMessageAnimationEnd = (event: Event) => {
			if (!pinMessagesToBottomRef.current) {
				return;
			}
			const target = event.target;
			if (
				!(target instanceof HTMLElement) ||
				!target.closest('.ref-msg-slot--user, .ref-msg-slot--assistant')
			) {
				return;
			}
			scheduleMessagesScrollToBottom();
		};
		track.addEventListener('animationend', onMessageAnimationEnd);
		track.addEventListener('animationcancel', onMessageAnimationEnd);
		return () => {
			track.removeEventListener('animationend', onMessageAnimationEnd);
			track.removeEventListener('animationcancel', onMessageAnimationEnd);
		};
	}, [hasConversation, currentId, messagesThreadId, messages.length, scheduleMessagesScrollToBottom]);

	return {
		messagesViewportRef,
		messagesTrackRef,
		pinMessagesToBottomRef,
		messagesScrollSnapshotByThreadRef,
		showScrollToBottomButton,
		onMessagesScroll,
		scrollMessagesToBottom,
		scheduleMessagesScrollToBottom,
		syncMessagesScrollIndicators,
	};
}
