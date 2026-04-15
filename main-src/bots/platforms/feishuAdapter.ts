import * as lark from '@larksuiteoapi/node-sdk';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotPlatformAdapter, PlatformMessageHandler } from './common.js';
import { splitPlainText } from './common.js';

function parseFeishuText(raw: unknown): string {
	try {
		const parsed = JSON.parse(String(raw ?? '')) as { text?: string };
		return String(parsed.text ?? '').trim();
	} catch {
		return '';
	}
}

export class FeishuBotAdapter implements BotPlatformAdapter {
	private wsClient: lark.ws.Client | null = null;
	private client: lark.Client | null = null;

	constructor(private readonly integration: BotIntegrationConfig) {}

	async start(onMessage: PlatformMessageHandler): Promise<void> {
		const appId = this.integration.feishu?.appId?.trim() ?? '';
		const appSecret = this.integration.feishu?.appSecret?.trim() ?? '';
		if (!appId || !appSecret) {
			return;
		}
		this.client = new lark.Client({ appId, appSecret });
		this.wsClient = new lark.ws.Client({
			appId,
			appSecret,
			appType: lark.AppType.SelfBuild,
			...(this.integration.feishu?.encryptKey?.trim()
				? { encryptKey: this.integration.feishu?.encryptKey?.trim() }
				: {}),
		});

		this.wsClient.eventDispatcher.register({
			'*.im.message.receive_v1': async (data) => {
				const event = data?.event;
				const message = event?.message;
				if (!message || message.message_type !== 'text') {
					return;
				}
				const chatId = String(message.chat_id ?? '').trim();
				const allowed = this.integration.feishu?.allowedChatIds ?? [];
				if (allowed.length > 0 && !allowed.includes(chatId)) {
					return;
				}
				const text = parseFeishuText(message.content);
				if (!text) {
					return;
				}
				await onMessage({
					conversationKey: chatId,
					text,
					senderId: String(event?.sender?.sender_id?.open_id ?? '').trim() || undefined,
					senderName: String(event?.sender?.sender_type ?? '').trim() || undefined,
					reply: async (replyText) => {
						if (!this.client) {
							return;
						}
						for (const chunk of splitPlainText(replyText, 8000)) {
							await this.client.im.message.reply({
								params: { message_id: String(message.message_id ?? '') },
								data: {
									content: JSON.stringify({ text: chunk }),
									msg_type: 'text',
								},
							});
						}
					},
				});
			},
		});

		this.wsClient.start();
	}

	async stop(): Promise<void> {
		this.wsClient?.stop();
		this.wsClient = null;
		this.client = null;
	}
}

