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

export type MessagesScrollSnapshot = {
	scrollTop: number;
	distanceFromBottom: number;
	pinned: boolean;
};

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

/**
 * 对话消息滚动控制：粘底跟随、滚动指示器、跳转按钮、线程切换时的位置恢复。
 *
 * 行为与原 App.tsx 完全一致，集中管理：
 *  - 11 个 scroll 相关 ref 与 `showScrollToBottomButton` state
 *  - 4 个公开回调：sync / onScroll / scrollToBottom / schedule
 *  - 4 个 layout/effect：线程切换归零、新线程恢复底部、用户新消息强制贴底、ResizeObserver 跟随
 *
 * 调用方应将返回的 `messagesViewportRef`、`messagesTrackRef` 绑到 JSX，
 * 并把 `pinMessagesToBottomRef` / `scheduleMessagesScrollToBottom` / `syncMessagesScrollIndicators`
 * 透传给 `MessagesScrollSync`。
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
	const messagesShrinkScrollTimerRef = useRef<number | null>(null);
	const prevMessagesLenForScrollRef = useRef(0);

	const syncMessagesScrollIndicators = useCallback(() => {
		const el = messagesViewportRef.current;
		if (!el) {
			return;
		}
		const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
		const clampedTop = Math.max(0, Math.min(el.scrollTop, maxScroll));
		const dist = Math.max(0, maxScroll - clampedTop);
		pinMessagesToBottomRef.current = dist < 120;
		const activeThreadId = messagesThreadIdRef.current ?? currentIdRef.current;
		if (activeThreadId) {
			messagesScrollSnapshotByThreadRef.current.set(activeThreadId, {
				scrollTop: clampedTop,
				distanceFromBottom: dist,
				pinned: pinMessagesToBottomRef.current,
			});
		}
		if (suppressScrollToBottomButtonRef.current) {
			if (dist <= 16 || el.scrollHeight <= el.clientHeight + 120) {
				suppressScrollToBottomButtonRef.current = false;
				if (suppressScrollToBottomButtonTimerRef.current !== null) {
					window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
					suppressScrollToBottomButtonTimerRef.current = null;
				}
			}
			setShowScrollToBottomButton(false);
			return;
		}
		const canJumpToBottom = el.scrollHeight > el.clientHeight + 120;
		const shouldShowJumpButton = canJumpToBottom && dist > 180;
		setShowScrollToBottomButton((prev) => (prev === shouldShowJumpButton ? prev : shouldShowJumpButton));
	}, [currentIdRef, messagesThreadIdRef]);

	const onMessagesScroll = useCallback(() => {
		syncMessagesScrollIndicators();
	}, [syncMessagesScrollIndicators]);

	const scrollMessagesToBottom = useCallback(
		(behavior: ScrollBehavior = 'auto') => {
			const el = messagesViewportRef.current;
			if (!el) {
				return;
			}
			pinMessagesToBottomRef.current = true;
			suppressScrollToBottomButtonRef.current = behavior === 'smooth';
			if (suppressScrollToBottomButtonTimerRef.current !== null) {
				window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
				suppressScrollToBottomButtonTimerRef.current = null;
			}
			if (behavior === 'smooth') {
				suppressScrollToBottomButtonTimerRef.current = window.setTimeout(() => {
					suppressScrollToBottomButtonRef.current = false;
					suppressScrollToBottomButtonTimerRef.current = null;
					syncMessagesScrollIndicators();
				}, 1400);
			}
			setShowScrollToBottomButton(false);
			el.scrollTo({ top: el.scrollHeight, behavior });
		},
		[syncMessagesScrollIndicators]
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
			el.scrollTop = el.scrollHeight;
			syncMessagesScrollIndicators();
		});
	}, [syncMessagesScrollIndicators]);

	/** 切换线程：始终从底部开始，等 messages / 流式更新后再滚（避免旧列表闪滚） */
	useLayoutEffect(() => {
		pendingMessagesScrollRestoreRef.current = currentId;
		pinMessagesToBottomRef.current = true;
		suppressScrollToBottomButtonRef.current = false;
		setShowScrollToBottomButton(false);
		if (suppressScrollToBottomButtonTimerRef.current !== null) {
			window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
			suppressScrollToBottomButtonTimerRef.current = null;
		}
		messagesTrackScrollHeightRef.current = 0;
		if (messagesShrinkScrollTimerRef.current !== null) {
			window.clearTimeout(messagesShrinkScrollTimerRef.current);
			messagesShrinkScrollTimerRef.current = null;
		}
	}, [currentId]);

	/** 线程 / 工作区切回后始终滚到消息列表最底部（与渐进渲染窗口配合） */
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
			const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
			pinMessagesToBottomRef.current = true;
			el.scrollTop = maxScroll;
			pendingMessagesScrollRestoreRef.current = null;
			syncMessagesScrollIndicators();
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, currentId, messagesThreadId, messages.length, syncMessagesScrollIndicators]);

	/** 用户发出新消息：强制跟到底部 */
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

	/**
	 * 流式 / 思考计时 / 展示列表变化：粘底跟随。streaming 由 MessagesScrollSync 子组件订阅，
	 * 每个 token 只让该组件重渲染，不再传播到 App。
	 */
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
			syncMessagesScrollIndicators();
		});
		return () => cancelAnimationFrame(rafId);
	}, [hasConversation, messages.length, currentId, syncMessagesScrollIndicators]);

	/** 内容高度异步变化（Markdown、diff 卡片等）时仍保持粘底 */
	useEffect(() => {
		if (!hasConversation) {
			return;
		}
		const outer = messagesViewportRef.current;
		const track = messagesTrackRef.current;
		if (!outer || !track) {
			return;
		}
		const ro = new ResizeObserver(() => {
			const h = track.scrollHeight;
			const prev = messagesTrackScrollHeightRef.current;
			messagesTrackScrollHeightRef.current = h;
			syncMessagesScrollIndicators();
			// 变高：新内容 / 展开，立即粘底（仍由 schedule 合并到单帧）
			if (h >= prev - 2) {
				if (messagesShrinkScrollTimerRef.current !== null) {
					window.clearTimeout(messagesShrinkScrollTimerRef.current);
					messagesShrinkScrollTimerRef.current = null;
				}
				scheduleMessagesScrollToBottom();
				return;
			}
			// 变矮：多为折叠动画中间帧，避免每帧 scrollTo 造成整区闪烁；结束后补一次即可贴底
			if (messagesShrinkScrollTimerRef.current !== null) {
				window.clearTimeout(messagesShrinkScrollTimerRef.current);
			}
			messagesShrinkScrollTimerRef.current = window.setTimeout(() => {
				messagesShrinkScrollTimerRef.current = null;
				scheduleMessagesScrollToBottom();
			}, 340);
		});
		ro.observe(track);
		return () => {
			ro.disconnect();
			if (messagesShrinkScrollTimerRef.current !== null) {
				window.clearTimeout(messagesShrinkScrollTimerRef.current);
				messagesShrinkScrollTimerRef.current = null;
			}
			if (messagesScrollToBottomRafRef.current !== null) {
				cancelAnimationFrame(messagesScrollToBottomRafRef.current);
				messagesScrollToBottomRafRef.current = null;
			}
			if (suppressScrollToBottomButtonTimerRef.current !== null) {
				window.clearTimeout(suppressScrollToBottomButtonTimerRef.current);
				suppressScrollToBottomButtonTimerRef.current = null;
			}
		};
	}, [hasConversation, currentId, scheduleMessagesScrollToBottom, syncMessagesScrollIndicators]);

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
