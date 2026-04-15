import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotInboundAttachment, BotPlatformAdapter, PlatformMessageHandler } from './common.js';
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

type DiscordGatewayPayload = {
	op: number;
	t?: string;
	s?: number;
	d?: Record<string, unknown>;
};

type DiscordAttachment = {
	id: string;
	filename: string;
	url?: string;
	proxy_url?: string;
	content_type?: string;
	size?: number;
};

const DEDUP_TTL_MS = 10 * 60 * 1000;

export class DiscordBotAdapter implements BotPlatformAdapter {
	readonly platform = 'discord' as const;
	private socket: WebSocket | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private seq: number | null = null;
	private stopRequested = false;
	private botUserId = '';
	private readonly seenMessageIds = new Map<string, number>();

	constructor(private readonly integration: BotIntegrationConfig) {}

	private get token(): string {
		return this.integration.discord?.botToken?.trim() ?? '';
	}

	private hasSeen(messageId: string): boolean {
		const trimmed = messageId.trim();
		if (!trimmed) {
			return false;
		}
		const now = Date.now();
		for (const [id, ts] of this.seenMessageIds) {
			if (now - ts > DEDUP_TTL_MS) {
				this.seenMessageIds.delete(id);
			}
		}
		if (this.seenMessageIds.has(trimmed)) {
			return true;
		}
		this.seenMessageIds.set(trimmed, now);
		return false;
	}

	private async api<T>(url: string, init?: RequestInit): Promise<T> {
		const data = await requestJson<T>(`https://discord.com/api/v10${url}`, {
			method: init?.method,
			headers: {
				authorization: `Bot ${this.token}`,
				'content-type': 'application/json',
				...Object.fromEntries(
					Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key, String(value)])
				),
			},
			body: init?.body,
			timeoutMs: 20_000,
			proxyUrl: resolveIntegrationProxyUrl(this.integration),
		});
		return data;
	}

	private isAllowedChannel(channelId: string): boolean {
		const allowed = this.integration.allowedReplyChatIds?.length
			? this.integration.allowedReplyChatIds
			: (this.integration.discord?.allowedChannelIds ?? []);
		return allowed.length === 0 || allowed.includes(channelId);
	}

	private isAllowedUser(userId: string): boolean {
		const allowed = this.integration.allowedReplyUserIds ?? [];
		return allowed.length === 0 || allowed.includes(userId);
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

	private async downloadAttachment(attachment: DiscordAttachment): Promise<BotInboundAttachment | null> {
		const url = attachment.url || attachment.proxy_url;
		if (!url) {
			return null;
		}
		try {
			const response = await fetch(url, { method: 'GET' });
			if (!response.ok) {
				return null;
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			const tmpDir = path.join(app.getPath('temp'), 'async-bot-discord');
			fs.mkdirSync(tmpDir, { recursive: true });
			const ext = path.extname(attachment.filename || '') || '';
			const localName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
			const target = path.join(tmpDir, localName);
			fs.writeFileSync(target, buffer);
			const isImage = /^image\//.test(String(attachment.content_type ?? ''));
			return {
				kind: isImage ? 'image' : 'file',
				localPath: target,
				name: attachment.filename,
			};
		} catch (error) {
			console.warn('[bots][discord] download failed', error instanceof Error ? error.message : error);
			return null;
		}
	}

	private async collectAttachments(rawList: unknown): Promise<BotInboundAttachment[]> {
		if (!Array.isArray(rawList)) {
			return [];
		}
		const results: BotInboundAttachment[] = [];
		for (const raw of rawList) {
			const attachment = raw as DiscordAttachment;
			if (!attachment?.id || !attachment?.filename) {
				continue;
			}
			const local = await this.downloadAttachment(attachment);
			if (local) {
				results.push(local);
			}
		}
		return results;
	}

	private async connect(onMessage: PlatformMessageHandler): Promise<void> {
		const me = await this.api<{ id?: string }>('/users/@me');
		this.botUserId = String(me.id ?? '').trim();
		const gateway = await this.api<{ url?: string }>('/gateway/bot');
		const gatewayUrl = `${String(gateway.url ?? 'wss://gateway.discord.gg').replace(/\/+$/, '')}/?v=10&encoding=json`;
		this.socket = new WebSocket(gatewayUrl, {
			agent: createProxyAgent(resolveIntegrationProxyUrl(this.integration)),
		});

		this.socket.on('message', (messageData) => {
			const payload = safeJsonParse<DiscordGatewayPayload>(websocketMessageToText(messageData));
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
			const senderId = String(author.id ?? '');
			if (!this.isAllowedUser(senderId)) {
				return;
			}
			const channelId = String(data.channel_id ?? '');
			if (!channelId) {
				return;
			}
			const messageId = String(data.id ?? '');
			if (!messageId || this.hasSeen(messageId)) {
				return;
			}
			const content = String(data.content ?? '');
			const rawAttachments = data.attachments;
			const guildId = data.guild_id ? String(data.guild_id) : '';
			if (guildId && !this.isAllowedChannel(channelId)) {
				return;
			}
			if (guildId && this.integration.discord?.requireMentionInGuilds !== false) {
				const mentions = Array.isArray(data.mentions) ? data.mentions : [];
				const didMention = mentions.some((item) => String((item as { id?: unknown }).id ?? '') === this.botUserId);
				if (!didMention) {
					return;
				}
			}
			const cleaned = this.normalizeText(content);
			if (!cleaned && (!Array.isArray(rawAttachments) || rawAttachments.length === 0)) {
				return;
			}
			void (async () => {
				const attachments = await this.collectAttachments(rawAttachments);
				void onMessage({
					conversationKey: channelId,
					messageId,
					text: cleaned,
					attachments,
					senderId: senderId || undefined,
					senderName: String(author.global_name ?? author.username ?? '').trim() || undefined,
					reply: async (text) => {
						const rendered = renderForPlatform(text, 'discord');
						for (const chunk of splitPlainText(rendered, 1900)) {
							await this.api(`/channels/${channelId}/messages`, {
								method: 'POST',
								body: JSON.stringify({
									content: chunk,
									message_reference: { message_id: messageId },
								}),
							});
						}
					},
					sendTyping: async () => {
						await this.api(`/channels/${channelId}/typing`, { method: 'POST' }).catch(() => {});
					},
				});
			})();
		});

		this.socket.on('error', (error) => {
			if (!this.stopRequested) {
				console.warn('[bots][discord]', error instanceof Error ? error.message : error);
			}
		});

		this.socket.on('close', () => {
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
		this.seenMessageIds.clear();
	}
}
