import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotPlatformAdapter, PlatformMessageHandler } from './common.js';
import { safeJsonParse, splitPlainText } from './common.js';

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
		};
	};
};

export class SlackBotAdapter implements BotPlatformAdapter {
	private socket: WebSocket | null = null;
	private stopRequested = false;
	private botUserId = '';

	constructor(private readonly integration: BotIntegrationConfig) {}

	private get botToken(): string {
		return this.integration.slack?.botToken?.trim() ?? '';
	}

	private get appToken(): string {
		return this.integration.slack?.appToken?.trim() ?? '';
	}

	private async api<T>(method: string, token: string, body?: Record<string, unknown>): Promise<T> {
		const response = await fetch(`https://slack.com/api/${method}`, {
			method: body ? 'POST' : 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				...(body ? { 'content-type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) {
			throw new Error(`Slack API ${method} failed: ${response.status}`);
		}
		const data = (await response.json()) as { ok?: boolean; error?: string } & T;
		if (!data.ok) {
			throw new Error(data.error || `Slack API ${method} failed`);
		}
		return data;
	}

	private isAllowedChannel(channelId: string): boolean {
		const allowed = this.integration.slack?.allowedChannelIds ?? [];
		return allowed.length === 0 || allowed.includes(channelId);
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

		this.socket = new WebSocket(url);
		this.socket.addEventListener('message', (event) => {
			const payload = safeJsonParse<SlackEventEnvelope>(String(event.data ?? ''));
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
			if (!this.isAllowedChannel(evt.channel)) {
				return;
			}
			const isDirect = evt.channel_type === 'im';
			if (!isDirect && evt.type !== 'app_mention') {
				return;
			}
			const cleaned = this.normalizeEventText(evt.text);
			if (!cleaned) {
				return;
			}
			void onMessage({
				conversationKey: evt.thread_ts ? `${evt.channel}:${evt.thread_ts}` : evt.channel,
				text: cleaned,
				senderId: evt.user,
				reply: async (text) => {
					for (const chunk of splitPlainText(text, 35000)) {
						await this.api('chat.postMessage', this.botToken, {
							channel: evt.channel,
							text: chunk,
							...(evt.thread_ts ? { thread_ts: evt.thread_ts } : {}),
						});
					}
				},
			});
		});

		this.socket.addEventListener('close', () => {
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
	}
}

