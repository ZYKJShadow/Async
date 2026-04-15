import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotPlatformAdapter, PlatformMessageHandler } from './common.js';
import { safeJsonParse, splitPlainText } from './common.js';

type DiscordGatewayPayload = {
	op: number;
	t?: string;
	s?: number;
	d?: Record<string, unknown>;
};

export class DiscordBotAdapter implements BotPlatformAdapter {
	private socket: WebSocket | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private seq: number | null = null;
	private stopRequested = false;
	private botUserId = '';

	constructor(private readonly integration: BotIntegrationConfig) {}

	private get token(): string {
		return this.integration.discord?.botToken?.trim() ?? '';
	}

	private async api<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(`https://discord.com/api/v10${url}`, {
			...init,
			headers: {
				authorization: `Bot ${this.token}`,
				'content-type': 'application/json',
				...(init?.headers ?? {}),
			},
		});
		if (!response.ok) {
			throw new Error(`Discord API ${url} failed: ${response.status}`);
		}
		return (await response.json()) as T;
	}

	private isAllowedChannel(channelId: string): boolean {
		const allowed = this.integration.discord?.allowedChannelIds ?? [];
		return allowed.length === 0 || allowed.includes(channelId);
	}

	private startHeartbeat(intervalMs: number): void {
		this.heartbeatTimer && clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = setInterval(() => {
			if (this.socket?.readyState === WebSocket.OPEN) {
				this.socket.send(JSON.stringify({ op: 1, d: this.seq }));
			}
		}, intervalMs);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private normalizeText(content: string): string {
		if (!this.botUserId) {
			return content.trim();
		}
		return content.replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '').trim();
	}

	private async connect(onMessage: PlatformMessageHandler): Promise<void> {
		const me = await this.api<{ id?: string }>('/users/@me');
		this.botUserId = String(me.id ?? '').trim();
		const gateway = await this.api<{ url?: string }>('/gateway/bot');
		const gatewayUrl = `${String(gateway.url ?? 'wss://gateway.discord.gg').replace(/\/+$/, '')}/?v=10&encoding=json`;
		this.socket = new WebSocket(gatewayUrl);

		this.socket.addEventListener('message', (event) => {
			const payload = safeJsonParse<DiscordGatewayPayload>(String(event.data ?? ''));
			if (!payload) {
				return;
			}
			if (typeof payload.s === 'number') {
				this.seq = payload.s;
			}
			if (payload.op === 10) {
				const interval = Number(payload.d?.heartbeat_interval ?? 0);
				if (interval > 0) {
					this.startHeartbeat(interval);
				}
				this.socket?.send(
					JSON.stringify({
						op: 2,
						d: {
							token: this.token,
							intents: 1 << 9 | 1 << 12 | 1 << 15,
							properties: {
								os: process.platform,
								browser: 'async-ide',
								device: 'async-ide',
							},
						},
					})
				);
				return;
			}
			if (payload.op !== 0 || payload.t !== 'MESSAGE_CREATE') {
				return;
			}
			const data = payload.d ?? {};
			const author = (data.author ?? {}) as Record<string, unknown>;
			if (author.bot === true) {
				return;
			}
			const channelId = String(data.channel_id ?? '');
			if (!channelId || !this.isAllowedChannel(channelId)) {
				return;
			}
			const content = String(data.content ?? '');
			if (!content.trim()) {
				return;
			}
			const guildId = data.guild_id ? String(data.guild_id) : '';
			if (guildId && this.integration.discord?.requireMentionInGuilds !== false) {
				const mentions = Array.isArray(data.mentions) ? data.mentions : [];
				const didMention = mentions.some((item) => String((item as { id?: unknown }).id ?? '') === this.botUserId);
				if (!didMention) {
					return;
				}
			}
			const cleaned = this.normalizeText(content);
			if (!cleaned) {
				return;
			}
			void onMessage({
				conversationKey: channelId,
				text: cleaned,
				senderId: String(author.id ?? ''),
				senderName: String(author.global_name ?? author.username ?? '').trim() || undefined,
				reply: async (text) => {
					for (const chunk of splitPlainText(text, 1900)) {
						await this.api(`/channels/${channelId}/messages`, {
							method: 'POST',
							body: JSON.stringify({
								content: chunk,
								message_reference: { message_id: String(data.id ?? '') },
							}),
						});
					}
				},
			});
		});

		this.socket.addEventListener('close', () => {
			this.stopHeartbeat();
			this.socket = null;
			if (!this.stopRequested) {
				setTimeout(() => {
					void this.connect(onMessage).catch((error) =>
						console.warn('[bots][discord]', error instanceof Error ? error.message : error)
					);
				}, 3000);
			}
		});
	}

	async start(onMessage: PlatformMessageHandler): Promise<void> {
		if (!this.token) {
			return;
		}
		this.stopRequested = false;
		await this.connect(onMessage);
	}

	async stop(): Promise<void> {
		this.stopRequested = true;
		this.stopHeartbeat();
		this.socket?.close();
		this.socket = null;
	}
}

