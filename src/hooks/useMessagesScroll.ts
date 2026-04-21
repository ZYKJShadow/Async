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
			const metrics = measureMessagesScroll(el);
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
		[currentIdRef, messagesThreadIdRef, clearScrollToBottomButtonSuppression]
	);

	const syncMessagesScrollIndicators = useCallback(() => {
		syncMessagesScrollState('layout');
	}, [syncMessagesScrollState]);

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
			const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTo({ top: maxScroll, behavior });
			syncMessagesScrollState('programmatic');
		},
		[clearScrollToBottomButtonSuppression, syncMessagesScrollState]
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
			const el = messagesViewportRef.current;
			if (!el || !pinMessagesToBottomRef.current) {
				return;
			}
			const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = maxScroll;
			syncMessagesScrollState('programmatic');
		});
	}, [syncMessagesScrollState]);

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
		const rafId = requestAnimationFrame(() => {
			if (pendingMessagesScrollRestoreRef.current !== currentId) {
				return;
			}
			const el = messagesViewportRef.current;
			if (!el) {
				return;
			}
			pinMessagesToBottomRef.current = true;
			const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = maxScroll;
			pendingMessagesScrollRestoreRef.current = null;
			syncMessagesScrollState('programmatic');
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, currentId, messagesThreadId, messages.length, syncMessagesScrollState]);

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
			scrollMessagesToBottom('auto');
		}
	}, [messages, currentId, messagesThreadId, scrollMessagesToBottom]);

	useLayoutEffect(() => {
		if (!hasConversation || !pinMessagesToBottomRef.current) {
			return;
		}
		scheduleMessagesScrollToBottom();
	}, [hasConversation, messages.length, currentId, scheduleMessagesScrollToBottom]);

	useLayoutEffect(() => {
		if (!hasConversation) {
			setShowScrollToBottomButton(false);
			return;
		}
		const rafId = requestAnimationFrame(() => {
			syncMessagesScrollState('layout');
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, messages.length, currentId, syncMessagesScrollState]);

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
		scheduleMessagesScrollToBottom,
		syncMessagesScrollState,
		clearScrollToBottomButtonSuppression,
	]);

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
