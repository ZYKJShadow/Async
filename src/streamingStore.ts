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

let snapshot: StreamingSnapshot = {
	streaming: '',
	streamingThinking: '',
	streamingToolPreview: null,
	liveAssistantBlocks: createEmptyLiveAgentBlocks(),
	thinkingTick: 0,
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function writeField<K extends keyof StreamingSnapshot>(key: K, next: StreamingSnapshot[K]) {
	if (Object.is(snapshot[key], next)) {
		return;
	}
	snapshot = { ...snapshot, [key]: next };
	emit();
}

type Updater<T> = T | ((prev: T) => T);

function resolve<T>(current: T, updater: Updater<T>): T {
	return typeof updater === 'function' ? (updater as (p: T) => T)(current) : updater;
}

export const streamingStore = {
	getStreaming: (): string => snapshot.streaming,
	getStreamingThinking: (): string => snapshot.streamingThinking,
	getStreamingToolPreview: (): StreamingToolPreview => snapshot.streamingToolPreview,
	getLiveAssistantBlocks: (): LiveAgentBlocksState => snapshot.liveAssistantBlocks,
	getThinkingTick: (): number => snapshot.thinkingTick,
	setStreaming(updater: Updater<string>) {
		writeField('streaming', resolve(snapshot.streaming, updater));
	},
	setStreamingThinking(updater: Updater<string>) {
		writeField('streamingThinking', resolve(snapshot.streamingThinking, updater));
	},
	setStreamingToolPreview(updater: Updater<StreamingToolPreview>) {
		writeField('streamingToolPreview', resolve(snapshot.streamingToolPreview, updater));
	},
	setLiveAssistantBlocks(updater: Updater<LiveAgentBlocksState>) {
		writeField('liveAssistantBlocks', resolve(snapshot.liveAssistantBlocks, updater));
	},
	resetLiveBlocks() {
		writeField('liveAssistantBlocks', createEmptyLiveAgentBlocks());
	},
	incrementThinkingTick() {
		writeField('thinkingTick', snapshot.thinkingTick + 1);
	},
	resetThinkingTick() {
		writeField('thinkingTick', 0);
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
