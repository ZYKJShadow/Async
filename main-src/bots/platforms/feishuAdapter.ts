import * as lark from '@larksuiteoapi/node-sdk';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotPlatformAdapter, PlatformMessageHandler, StreamReplyCallbacks } from './common.js';
import { createJsonHttpInstance, createProxyAgent, resolveIntegrationProxyUrl, splitPlainText } from './common.js';
import { FeishuCardKitClient, FeishuStreamingSession } from './feishuCardKit.js';

const FEISHU_MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;

type FeishuSenderId = {
	open_id?: string;
	user_id?: string;
	union_id?: string;
};

type FeishuSender = {
	sender_id?: FeishuSenderId;
	sender_type?: string;
};

type FeishuMessage = {
	message_id?: string;
	chat_id?: string;
	chat_type?: string;
	message_type?: string;
	content?: unknown;
};

function parseFeishuText(raw: unknown): string {
	try {
		const parsed = JSON.parse(String(raw ?? '')) as { text?: string };
		return String(parsed.text ?? '').trim();
	} catch {
		return '';
	}
}

function collectSenderIds(raw: { open_id?: string; user_id?: string; union_id?: string } | undefined): string[] {
	const ids = [raw?.open_id, raw?.user_id, raw?.union_id]
		.map((value) => String(value ?? '').trim())
		.filter(Boolean);
	return [...new Set(ids)];
}

export function buildFeishuReplyPayload(messageId: string, text: string) {
	return {
		path: { message_id: messageId },
		data: {
			content: JSON.stringify({ text }),
			msg_type: 'text',
		},
	};
}

export function extractFeishuMessageEvent(
	raw: unknown
): { sender?: FeishuSender; message?: FeishuMessage } | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const root = raw as { event?: unknown; sender?: FeishuSender; message?: FeishuMessage };
	const payload =
		root.event && typeof root.event === 'object'
			? (root.event as { sender?: FeishuSender; message?: FeishuMessage })
			: root;
	return {
		sender: payload.sender,
		message: payload.message,
	};
}

export class FeishuBotAdapter implements BotPlatformAdapter {
	private wsClient: lark.WSClient | null = null;
	private client: lark.Client | null = null;
	private cardKitClient: FeishuCardKitClient | null = null;
	private readonly recentMessageIds = new Map<string, number>();

	constructor(private readonly integration: BotIntegrationConfig) {}

	private isAllowedChat(chatId: string): boolean {
		const allowed = this.integration.allowedReplyChatIds?.length
			? this.integration.allowedReplyChatIds
			: (this.integration.feishu?.allowedChatIds ?? []);
		return allowed.length === 0 || allowed.includes(chatId);
	}

	private isAllowedUser(userIds: string[]): boolean {
		const allowed = this.integration.allowedReplyUserIds ?? [];
		return allowed.length === 0 || userIds.some((userId) => allowed.includes(userId));
	}

	private shouldProcessMessage(messageId: string): boolean {
		const trimmed = messageId.trim();
		if (!trimmed) {
			return true;
		}
		const now = Date.now();
		for (const [knownId, ts] of this.recentMessageIds.entries()) {
			if (now - ts > FEISHU_MESSAGE_DEDUP_TTL_MS) {
				this.recentMessageIds.delete(knownId);
			}
		}
		if (this.recentMessageIds.has(trimmed)) {
			return false;
		}
		this.recentMessageIds.set(trimmed, now);
		return true;
	}

	async start(onMessage: PlatformMessageHandler): Promise<void> {
		const appId = this.integration.feishu?.appId?.trim() ?? '';
		const appSecret = this.integration.feishu?.appSecret?.trim() ?? '';
		if (!appId || !appSecret) {
			return;
		}
		const proxyUrl = resolveIntegrationProxyUrl(this.integration);
		const httpInstance = createJsonHttpInstance(proxyUrl);
		const proxyAgent = createProxyAgent(proxyUrl);
		this.client = new lark.Client({ appId, appSecret, httpInstance });

		const encryptKey = this.integration.feishu?.encryptKey?.trim() || undefined;
		const eventDispatcher = new lark.EventDispatcher({
			...(encryptKey ? { encryptKey } : {}),
		});

		const useStreamingCard = this.integration.feishu?.streamingCard !== false;
		if (useStreamingCard) {
			this.cardKitClient = new FeishuCardKitClient({ appId, appSecret, proxyUrl });
		}

		eventDispatcher.register({
			'im.message.receive_v1': async (data) => {
				const event = extractFeishuMessageEvent(data);
				const message = event?.message;
				if (!message || message.message_type !== 'text') {
					return;
				}
				const chatId = String(message.chat_id ?? '').trim();
				const senderIds = collectSenderIds(event?.sender?.sender_id);
				const senderId = senderIds[0] ?? '';
				if (!this.isAllowedUser(senderIds)) {
					return;
				}
				const chatType = String(message.chat_type ?? '').trim().toLowerCase();
				const isGroupChat = chatType !== '' && chatType !== 'p2p';
				if (isGroupChat && !this.isAllowedChat(chatId)) {
					return;
				}
				const text = parseFeishuText(message.content);
				if (!text) {
					return;
				}

				const messageId = String(message.message_id ?? '');
				if (!this.shouldProcessMessage(messageId)) {
					return;
				}

				// Build streaming callbacks if CardKit is enabled
				let streamReply: StreamReplyCallbacks | undefined;
				if (this.cardKitClient) {
					const session = new FeishuStreamingSession(this.cardKitClient);
					streamReply = {
						onStart: async () => {
							await session.start(chatId, messageId);
						},
						onDelta: async (fullText) => {
							if (session.isFailed) return;
							session.update(fullText);
						},
						onToolStatus: (name, state) => {
							if (session.isFailed) return;
							session.setToolStatus(name, state);
						},
						onDone: async (fullText) => {
							if (session.isFailed) {
								// Fallback to plain text
								await this.replyPlainText(messageId, fullText);
								return;
							}
							await session.close(fullText);
						},
						onError: async (error) => {
							if (session.isActive) {
								await session.close(`❌ ${error}`);
							} else {
								await this.replyPlainText(messageId, `❌ ${error}`);
							}
						},
					};
				}

				void onMessage({
					conversationKey: chatId,
					text,
					senderId: senderId || undefined,
					senderName: String(event?.sender?.sender_type ?? '').trim() || undefined,
					reply: async (replyText) => {
						await this.replyPlainText(messageId, replyText);
					},
					streamReply,
				}).catch((error) => {
					console.warn('[bots][feishu] async message handling failed', error instanceof Error ? error.message : error);
				});
			},
		});

		this.wsClient = new lark.WSClient({
			appId,
			appSecret,
			appType: lark.AppType.SelfBuild,
			httpInstance,
			agent: proxyAgent,
		});
		this.wsClient.start({ eventDispatcher });
	}

	private async replyPlainText(messageId: string, text: string): Promise<void> {
		if (!this.client) return;
		for (const chunk of splitPlainText(text, 8000)) {
			await this.client.im.message.reply(buildFeishuReplyPayload(messageId, chunk));
		}
	}

	async stop(): Promise<void> {
		this.wsClient?.stop();
		this.wsClient = null;
		this.client = null;
		this.cardKitClient = null;
		this.recentMessageIds.clear();
	}
}
