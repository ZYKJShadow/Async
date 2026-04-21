import { useSyncExternalStore } from 'react';
import {
	createEmptyLiveAgentBlocks,
	type LiveAgentBlocksState,
} from './liveAgentBlocks';

export type StreamingToolPreview = {
	name: string;
	partialJson: string;
	index: number;
} | null;

type StreamingSnapshot = {
	streaming: string;
	streamingThinking: string;
	streamingToolPreview: StreamingToolPreview;
	liveAssistantBlocks: LiveAgentBlocksState;
	thinkingTick: number;
};

const initialSnapshot: StreamingSnapshot = {
	streaming: '',
	streamingThinking: '',
	streamingToolPreview: null,
	liveAssistantBlocks: createEmptyLiveAgentBlocks(),
	thinkingTick: 0,
};

/** committed: 已发布的 snapshot，getSnapshot 返回此值 */
let committed: StreamingSnapshot = initialSnapshot;
/** pending: 累积中的 snapshot，setter 操作此值 */
let pending: StreamingSnapshot = committed;

const listeners = new Set<() => void>();
let emitRafId: number | null = null;

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function flush() {
	emitRafId = null;
	if (Object.is(committed, pending)) {
		return;
	}
	committed = pending;
	for (const listener of listeners) {
		listener();
	}
}

function scheduleFlush() {
	if (emitRafId !== null) {
		return;
	}
	emitRafId = requestAnimationFrame(flush);
}

function writeField<K extends keyof StreamingSnapshot>(key: K, next: StreamingSnapshot[K]) {
	if (Object.is(pending[key], next)) {
		return;
	}
	pending = { ...pending, [key]: next };
	scheduleFlush();
}

type Updater<T> = T | ((prev: T) => T);

function resolve<T>(current: T, updater: Updater<T>): T {
	return typeof updater === 'function' ? (updater as (p: T) => T)(current) : updater;
}

export const streamingStore = {
	getStreaming: (): string => committed.streaming,
	getStreamingThinking: (): string => committed.streamingThinking,
	getStreamingToolPreview: (): StreamingToolPreview => committed.streamingToolPreview,
	getLiveAssistantBlocks: (): LiveAgentBlocksState => committed.liveAssistantBlocks,
	getThinkingTick: (): number => committed.thinkingTick,
	setStreaming(updater: Updater<string>) {
		writeField('streaming', resolve(pending.streaming, updater));
	},
	setStreamingThinking(updater: Updater<string>) {
		writeField('streamingThinking', resolve(pending.streamingThinking, updater));
	},
	setStreamingToolPreview(updater: Updater<StreamingToolPreview>) {
		writeField('streamingToolPreview', resolve(pending.streamingToolPreview, updater));
	},
	setLiveAssistantBlocks(updater: Updater<LiveAgentBlocksState>) {
		writeField('liveAssistantBlocks', resolve(pending.liveAssistantBlocks, updater));
	},
	resetLiveBlocks() {
		writeField('liveAssistantBlocks', createEmptyLiveAgentBlocks());
	},
	incrementThinkingTick() {
		writeField('thinkingTick', pending.thinkingTick + 1);
	},
	resetThinkingTick() {
		writeField('thinkingTick', 0);
	},
	/** 立即 flush 所有 pending 更新；用于流结束等需要同步清空的场景 */
	flush() {
		if (emitRafId !== null) {
			cancelAnimationFrame(emitRafId);
			emitRafId = null;
		}
		flush();
	},
};

export function useStreaming(): string {
	return useSyncExternalStore(subscribe, streamingStore.getStreaming, streamingStore.getStreaming);
}

export function useStreamingThinking(): string {
	return useSyncExternalStore(subscribe, streamingStore.getStreamingThinking, streamingStore.getStreamingThinking);
}

export function useStreamingToolPreview(): StreamingToolPreview {
	return useSyncExternalStore(subscribe, streamingStore.getStreamingToolPreview, streamingStore.getStreamingToolPreview);
}

export function useLiveAssistantBlocks(): LiveAgentBlocksState {
	return useSyncExternalStore(subscribe, streamingStore.getLiveAssistantBlocks, streamingStore.getLiveAssistantBlocks);
}

export function useThinkingTick(): number {
	return useSyncExternalStore(subscribe, streamingStore.getThinkingTick, streamingStore.getThinkingTick);
}
