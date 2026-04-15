import type { BotInboundMessage } from '../botRuntime.js';

export type PlatformInboundEnvelope = BotInboundMessage & {
	reply: (text: string) => Promise<void>;
};

export type PlatformMessageHandler = (message: PlatformInboundEnvelope) => Promise<void>;

export type BotPlatformAdapter = {
	start(onMessage: PlatformMessageHandler): Promise<void>;
	stop(): Promise<void>;
};

export function splitPlainText(text: string, maxLength: number): string[] {
	const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
	if (!normalized) {
		return ['(empty)'];
	}
	if (normalized.length <= maxLength) {
		return [normalized];
	}
	const chunks: string[] = [];
	let rest = normalized;
	while (rest.length > maxLength) {
		const slice = rest.slice(0, maxLength);
		const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
		const cut = breakAt > maxLength * 0.5 ? breakAt : maxLength;
		chunks.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) {
		chunks.push(rest);
	}
	return chunks.filter(Boolean);
}

export function safeJsonParse<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

