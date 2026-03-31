/**
 * 流式响应超时配置 — 与 Claude Code 的 idle watchdog 思路一致。
 *
 * 环境变量优先 → settings.agent 字段 → 默认值。
 * 可通过 ASYNC_AGENT_STREAM_WATCHDOG=0 关闭静默 watchdog。
 */

import type { ShellSettings } from '../settingsStore.js';

/** 默认无新 chunk 静默超时（15 分钟）；大工具 JSON 可能长时间无 SSE */
const DEFAULT_STREAM_IDLE_MS = 900_000;
/** 默认单轮硬超时（30 分钟） */
const DEFAULT_ROUND_HARD_MS = 1_800_000;
/** Stall 阈值（30 秒）：两个 chunk 间隔超过此值时记录日志 */
const STALL_THRESHOLD_MS = 30_000;

export type StreamTimeoutConfig = {
	idleMs: number;
	idleWatchdogEnabled: boolean;
	hardMs: number;
	stallThresholdMs: number;
};

export function resolveStreamTimeouts(settings: ShellSettings): StreamTimeoutConfig {
	const w = process.env.ASYNC_AGENT_STREAM_WATCHDOG?.trim().toLowerCase();
	let idleWatchdogEnabled: boolean;
	if (w !== undefined && w !== '') {
		idleWatchdogEnabled = !(w === '0' || w === 'false' || w === 'off' || w === 'no');
	} else {
		idleWatchdogEnabled = settings.agent?.streamIdleWatchdogEnabled !== false;
	}

	const idleEnv = parseInt(process.env.ASYNC_AGENT_STREAM_IDLE_MS || '', 10);
	const idleMs =
		Number.isFinite(idleEnv) && idleEnv > 0
			? idleEnv
			: typeof settings.agent?.streamIdleTimeoutMs === 'number' && settings.agent.streamIdleTimeoutMs > 0
				? settings.agent.streamIdleTimeoutMs
				: DEFAULT_STREAM_IDLE_MS;

	const hardEnv = parseInt(process.env.ASYNC_AGENT_ROUND_HARD_MS || '', 10);
	const hardMsRaw =
		Number.isFinite(hardEnv) && hardEnv > 0
			? hardEnv
			: typeof settings.agent?.roundHardTimeoutMs === 'number' && settings.agent.roundHardTimeoutMs > 0
				? settings.agent.roundHardTimeoutMs
				: DEFAULT_ROUND_HARD_MS;

	const hardMs = Math.max(hardMsRaw, idleMs);

	return { idleMs, idleWatchdogEnabled, hardMs, stallThresholdMs: STALL_THRESHOLD_MS };
}

/**
 * 创建流超时管理器：idle watchdog + 半超时 warning + stall 检测。
 */
export function createStreamTimeoutManager(
	config: StreamTimeoutConfig,
	onAbort: () => void,
	logger?: {
		warn: (msg: string) => void;
		error: (msg: string) => void;
	}
) {
	const log = logger ?? {
		warn: (msg: string) => console.warn(`[StreamTimeout] ${msg}`),
		error: (msg: string) => console.error(`[StreamTimeout] ${msg}`),
	};

	let lastChunkAt = Date.now();
	let idleWarningTimer: ReturnType<typeof setTimeout> | null = null;
	let idleAbortTimer: ReturnType<typeof setTimeout> | null = null;
	let hardTimer: ReturnType<typeof setTimeout> | null = null;
	let stallCount = 0;
	let totalStallTime = 0;
	let isFirstChunk = true;
	let aborted = false;

	const idleWarningMs = config.idleMs / 2;

	function clearIdleTimers(): void {
		if (idleWarningTimer !== null) {
			clearTimeout(idleWarningTimer);
			idleWarningTimer = null;
		}
		if (idleAbortTimer !== null) {
			clearTimeout(idleAbortTimer);
			idleAbortTimer = null;
		}
	}

	function resetIdleTimer(): void {
		clearIdleTimers();
		if (!config.idleWatchdogEnabled || aborted) return;

		idleWarningTimer = setTimeout(() => {
			log.warn(`流静默警告：已 ${(idleWarningMs / 1000).toFixed(0)}s 无新数据`);
		}, idleWarningMs);

		idleAbortTimer = setTimeout(() => {
			if (aborted) return;
			aborted = true;
			log.error(`流静默超时：${(config.idleMs / 1000).toFixed(0)}s 无新数据，中止流`);
			onAbort();
		}, config.idleMs);
	}

	function start(): void {
		lastChunkAt = Date.now();
		isFirstChunk = true;
		stallCount = 0;
		totalStallTime = 0;
		aborted = false;

		resetIdleTimer();
		hardTimer = setTimeout(() => {
			if (aborted) return;
			aborted = true;
			log.error(`单轮硬超时：${(config.hardMs / 1000).toFixed(0)}s，中止流`);
			onAbort();
		}, config.hardMs);
	}

	function onChunk(): void {
		const now = Date.now();

		// Stall 检测（仅在非首个 chunk 后）
		if (!isFirstChunk) {
			const gap = now - lastChunkAt;
			if (gap > config.stallThresholdMs) {
				stallCount++;
				totalStallTime += gap;
				log.warn(
					`流停顿 #${stallCount}：${(gap / 1000).toFixed(1)}s 间隔（累计 ${(totalStallTime / 1000).toFixed(1)}s）`
				);
			}
		}
		isFirstChunk = false;
		lastChunkAt = now;

		resetIdleTimer();
	}

	function stop(): { stallCount: number; totalStallTime: number } {
		clearIdleTimers();
		if (hardTimer !== null) {
			clearTimeout(hardTimer);
			hardTimer = null;
		}
		if (stallCount > 0) {
			log.warn(`流结束：共 ${stallCount} 次停顿，累计 ${(totalStallTime / 1000).toFixed(1)}s`);
		}
		return { stallCount, totalStallTime };
	}

	return { start, onChunk, stop, isAborted: () => aborted };
}
