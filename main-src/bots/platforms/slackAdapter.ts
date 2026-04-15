import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotPlatformAdapter, PlatformMessageHandler } from './common.js';
import {
	createProxyAgent,
	requestJson,
	resolveIntegrationProxyUrl,
	safeJsonParse,
	splitPlainText,
	websocketMessageToText,
} from './common.js';
import { renderForPlatform } from './platformMarkdown.js';
import WebSocket from 'ws';

type SlackEventEnvelope = {
	envelope_id?: string;
	type?: string;
	payload?: {
		event?: {
			type?: string;
			subtype?: string;
			text?: string;
			user?: string;
			bot_id?: string;
			channel?: string;
			channel_type?: string;
			thread_ts?: string;
			ts?: string;
			client_msg_id?: string;
		};
	};
};

const DEDUP_TTL_MS = 10 * 60 * 1000;

export class SlackBotAdapter implements BotPlatformAdapter {
	readonly platform = 'slack' as const;
	private socket: WebSocket | null = null;
	private stopRequested = false;
	private botUserId = '';
	private readonly seenEventIds = new Map<string, number>();

	constructor(private readonly integration: BotIntegrationConfig) {}

	private get botToken(): string {
		return this.integration.slack?.botToken?.trim() ?? '';
	}

	private get appToken(): string {
		return this.integration.slack?.appToken?.trim() ?? '';
	}

	private hasSeen(eventId: string): boolean {
		const trimmed = eventId.trim();
		if (!trimmed) {
			return false;
		}
		const now = Date.now();
		for (const [id, ts] of this.seenEventIds) {
			if (now - ts > DEDUP_TTL_MS) {
				this.seenEventIds.delete(id);
			}
		}
		if (this.seenEventIds.has(trimmed)) {
			return true;
		}
		this.seenEventIds.set(trimmed, now);
		return false;
	}

	private async api<T>(method: string, token: string, body?: Record<string, unknown>): Promise<T> {
		const data = await requestJson<{ ok?: boolean; error?: string } & T>(`https://slack.com/api/${method}`, {
			method: body ? 'POST' : 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				...(body ? { 'content-type': 'application/json' } : {}),
			},
			body,
			timeoutMs: 20_000,
			proxyUrl: resolveIntegrationProxyUrl(this.integration),
		});
		if (!data.ok) {
			throw new Error(data.error || `Slack API ${method} failed`);
		}
		return data;
	}

	private isAllowedChannel(channelId: string): boolean {
		const allowed = this.integration.allowedReplyChatIds?.length
			? this.integration.allowedReplyChatIds
			: (this.integration.slack?.allowedChannelIds ?? []);
		return allowed.length === 0 || allowed.includes(channelId);
	}

	private isAllowedUser(userId: string): boolean {
		const allowed = this.integration.allowedReplyUserIds ?? [];
		return allowed.length === 0 || allowed.includes(userId);
	}

	private normalizeEventText(text: string): string {
		if (!this.botUserId) {
			return text.trim();
		}
		return text.replace(new RegExp(`<@${this.botUserId}>`, 'g'), '').trim();
	}

	private async connect(onMessage: PlatformMessageHandler): Promise<void> {
		const auth = await this.api<{ user_id?: string }>('auth.test', this.botToken);
		this.botUserId = String(auth.user_id ?? '').trim();
		const open = await this.api<{ url?: string }>('apps.connections.open', this.appToken, {});
		const url = String(open.url ?? '').trim();
		if (!url) {
			throw new Error('Slack Socket Mode URL missing.');
		}

		this.socket = new WebSocket(url, {
			agent: createProxyAgent(resolveIntegrationProxyUrl(this.integration)),
		});
		this.socket.on('message', (data) => {
			const payload = safeJsonParse<SlackEventEnvelope>(websocketMessageToText(data));
			if (!payload) {
				return;
			}
			if (payload.envelope_id && this.socket?.readyState === WebSocket.OPEN) {
				this.socket.send(JSON.stringify({ envelope_id: payload.envelope_id }));
			}
			if (payload.type !== 'events_api') {
				return;
			}
			const evt = payload.payload?.event;
			if (!evt?.type || evt.subtype || evt.bot_id || !evt.text || !evt.channel) {
				return;
			}
			if (!this.isAllowedUser(String(evt.user ?? ''))) {
				return;
			}
			const isDirect = evt.channel_type === 'im';
			if (!isDirect && !this.isAllowedChannel(evt.channel)) {
				return;
			}
			if (!isDirect && evt.type !== 'app_mention') {
				return;
			}
			const dedupKey = String(evt.client_msg_id || evt.ts || '');
			if (this.hasSeen(dedupKey)) {
				return;
			}
			const cleaned = this.normalizeEventText(evt.text);
			if (!cleaned) {
				return;
			}
			const channelId = evt.channel;
			const threadTs = evt.thread_ts;
			void onMessage({
				conversationKey: threadTs ? `${channelId}:${threadTs}` : channelId,
				messageId: evt.ts,
				text: cleaned,
				senderId: evt.user,
				reply: async (text) => {
					const rendered = renderForPlatform(text, 'slack');
					for (const chunk of splitPlainText(rendered, 35000)) {
						await this.api('chat.postMessage', this.botToken, {
							channel: channelId,
							text: chunk,
							mrkdwn: true,
							...(threadTs ? { thread_ts: threadTs } : {}),
						});
					}
				},
				sendTyping: async () => {
					if (this.socket?.readyState === WebSocket.OPEN) {
						try {
							this.socket.send(
								JSON.stringify({
									type: 'user_typing',
									channel: channelId,
								})
							);
						} catch {
							/* ignore */
						}
					}
				},
			});
		});

		this.socket.on('error', (error) => {
			if (!this.stopRequested) {
				console.warn('[bots][slack]', error instanceof Error ? error.message : error);
			}
		});

		this.socket.on('close', () => {
			this.socket = null;
			if (!this.stopRequested) {
				setTimeout(() => {
					void this.connect(onMessage).catch((error) =>
						console.warn('[bots][slack]', error instanceof Error ? error.message : error)
					);
				}, 3000);
			}
		});
	}

	async start(onMessage: PlatformMessageHandler): Promise<void> {
		if (!this.botToken || !this.appToken) {
			return;
		}
		this.stopRequested = false;
		await this.connect(onMessage);
	}

	async stop(): Promise<void> {
		this.stopRequested = true;
		this.socket?.close();
		this.socket = null;
		this.seenEventIds.clear();
	}
}
