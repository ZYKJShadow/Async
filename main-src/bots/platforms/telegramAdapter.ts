import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotPlatformAdapter, PlatformMessageHandler } from './common.js';
import { splitPlainText } from './common.js';

type TelegramUpdate = {
	update_id: number;
	message?: TelegramMessage;
};

type TelegramMessage = {
	message_id: number;
	message_thread_id?: number;
	text?: string;
	chat: { id: number; type: string };
	from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
};

export class TelegramBotAdapter implements BotPlatformAdapter {
	private abortController: AbortController | null = null;
	private offset = 0;
	private botUsername = '';

	constructor(private readonly integration: BotIntegrationConfig) {}

	private get token(): string {
		return this.integration.telegram?.botToken?.trim() ?? '';
	}

	private async api<T>(method: string, body?: Record<string, unknown>): Promise<T> {
		const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
			method: body ? 'POST' : 'GET',
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) {
			throw new Error(`Telegram API ${method} failed: ${response.status}`);
		}
		const data = (await response.json()) as { ok?: boolean; result?: T; description?: string };
		if (!data.ok) {
			throw new Error(data.description || `Telegram API ${method} failed`);
		}
		return data.result as T;
	}

	private isAllowedChat(chatId: string): boolean {
		const allowed = this.integration.telegram?.allowedChatIds ?? [];
		return allowed.length === 0 || allowed.includes(chatId);
	}

	private cleanIncomingText(message: TelegramMessage): string {
		const raw = String(message.text ?? '').trim();
		if (!raw) {
			return '';
		}
		if (message.chat.type === 'private') {
			return raw;
		}
		if (this.integration.telegram?.requireMentionInGroups === false) {
			return raw;
		}
		if (!this.botUsername) {
			return '';
		}
		const mention = `@${this.botUsername.toLowerCase()}`;
		const lowered = raw.toLowerCase();
		if (!lowered.includes(mention)) {
			return '';
		}
		return raw.replace(new RegExp(`@${this.botUsername}\\b`, 'ig'), '').trim();
	}

	async start(onMessage: PlatformMessageHandler): Promise<void> {
		if (!this.token) {
			return;
		}
		this.abortController = new AbortController();
		const me = await this.api<{ username?: string }>('getMe');
		this.botUsername = String(me.username ?? '').trim();

		void (async () => {
			while (!this.abortController?.signal.aborted) {
				try {
					const updates = await this.api<TelegramUpdate[]>('getUpdates', {
						timeout: 30,
						offset: this.offset,
						allowed_updates: ['message'],
					});
					for (const update of updates) {
						this.offset = Math.max(this.offset, update.update_id + 1);
						const message = update.message;
						if (!message?.text || message.from?.is_bot) {
							continue;
						}
						const chatId = String(message.chat.id);
						if (!this.isAllowedChat(chatId)) {
							continue;
						}
						const cleaned = this.cleanIncomingText(message);
						if (!cleaned) {
							continue;
						}
						const threadKey = message.message_thread_id ? `${chatId}:${message.message_thread_id}` : chatId;
						await onMessage({
							conversationKey: threadKey,
							text: cleaned,
							senderId: message.from?.id != null ? String(message.from.id) : undefined,
							senderName: message.from?.username || message.from?.first_name,
							reply: async (text) => {
								for (const chunk of splitPlainText(text, 3500)) {
									await this.api('sendMessage', {
										chat_id: message.chat.id,
										text: chunk,
										reply_to_message_id: message.message_id,
										...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
									});
								}
							},
						});
					}
				} catch (error) {
					console.warn('[bots][telegram]', error instanceof Error ? error.message : error);
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}
			}
		})();
	}

	async stop(): Promise<void> {
		this.abortController?.abort();
		this.abortController = null;
	}
}

