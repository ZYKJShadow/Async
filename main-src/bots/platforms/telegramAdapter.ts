import { app, session, type Session } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type { BotInboundAttachment, BotPlatformAdapter, PlatformMessageHandler } from './common.js';
import { electronProxyRulesFromUrl, resolveIntegrationProxyUrl, splitPlainText } from './common.js';
import { renderForPlatform } from './platformMarkdown.js';

type TelegramUpdate = {
	update_id: number;
	message?: TelegramMessage;
};

type TelegramPhotoSize = {
	file_id: string;
	file_unique_id: string;
	width?: number;
	height?: number;
	file_size?: number;
};

type TelegramDocument = {
	file_id: string;
	file_unique_id: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
};

type TelegramMessage = {
	message_id: number;
	message_thread_id?: number;
	text?: string;
	caption?: string;
	chat: { id: number; type: string };
	from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
	photo?: TelegramPhotoSize[];
	document?: TelegramDocument;
};

const DEDUP_TTL_MS = 10 * 60 * 1000;

export class TelegramBotAdapter implements BotPlatformAdapter {
	readonly platform = 'telegram' as const;
	private abortController: AbortController | null = null;
	private offset = 0;
	private botUsername = '';
	private stopRequested = false;
	private readonly sessionPartition: string;
	private electronSession: Session | null = null;
	private readonly seenMessageIds = new Map<number, number>();

	constructor(private readonly integration: BotIntegrationConfig) {
		this.sessionPartition = `async-bot-telegram-${integration.id}`;
	}

	private get token(): string {
		return this.integration.telegram?.botToken?.trim() ?? '';
	}

	private async getElectronSession(): Promise<Session> {
		if (this.electronSession) {
			return this.electronSession;
		}
		const ses = session.fromPartition(this.sessionPartition);
		const proxyUrl = resolveIntegrationProxyUrl(this.integration);
		if (proxyUrl) {
			await ses.setProxy({
				mode: 'fixed_servers',
				proxyRules: electronProxyRulesFromUrl(proxyUrl),
			});
		} else {
			await ses.setProxy({ mode: 'direct' });
		}
		try {
			await ses.closeAllConnections();
		} catch {
			/* ignore */
		}
		this.electronSession = ses;
		return ses;
	}

	private async api<T>(method: string, body?: Record<string, unknown>): Promise<T> {
		const ses = await this.getElectronSession();
		const response = await ses.fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
			method: body ? 'POST' : 'GET',
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: this.abortController?.signal,
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

	private hasSeen(messageId: number): boolean {
		const now = Date.now();
		for (const [id, ts] of this.seenMessageIds) {
			if (now - ts > DEDUP_TTL_MS) {
				this.seenMessageIds.delete(id);
			}
		}
		if (this.seenMessageIds.has(messageId)) {
			return true;
		}
		this.seenMessageIds.set(messageId, now);
		return false;
	}

	private async downloadFile(fileId: string, suggestedName: string): Promise<string | null> {
		try {
			const file = await this.api<{ file_path?: string }>('getFile', { file_id: fileId });
			const relPath = String(file.file_path ?? '').trim();
			if (!relPath) {
				return null;
			}
			const ses = await this.getElectronSession();
			const response = await ses.fetch(`https://api.telegram.org/file/bot${this.token}/${relPath}`, {
				method: 'GET',
				signal: this.abortController?.signal,
			});
			if (!response.ok) {
				return null;
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			const tmpDir = path.join(app.getPath('temp'), 'async-bot-telegram');
			fs.mkdirSync(tmpDir, { recursive: true });
			const ext = path.extname(relPath) || path.extname(suggestedName) || '';
			const localName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
			const target = path.join(tmpDir, localName);
			fs.writeFileSync(target, buffer);
			return target;
		} catch (error) {
			console.warn('[bots][telegram] download failed', error instanceof Error ? error.message : error);
			return null;
		}
	}

	private async collectAttachments(message: TelegramMessage): Promise<BotInboundAttachment[]> {
		const attachments: BotInboundAttachment[] = [];
		if (message.photo && message.photo.length > 0) {
			const largest = [...message.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
			const local = await this.downloadFile(largest.file_id, 'photo.jpg');
			if (local) {
				attachments.push({ kind: 'image', localPath: local });
			}
		}
		if (message.document) {
			const doc = message.document;
			const local = await this.downloadFile(doc.file_id, doc.file_name || 'document');
			if (local) {
				const isImage = /^image\//.test(String(doc.mime_type ?? ''));
				attachments.push({
					kind: isImage ? 'image' : 'file',
					localPath: local,
					name: doc.file_name,
				});
			}
		}
		return attachments;
	}

	async start(onMessage: PlatformMessageHandler): Promise<void> {
		if (!this.token) {
			return;
		}
		this.stopRequested = false;
		const controller = new AbortController();
		this.abortController = controller;
		const me = await this.api<{ username?: string }>('getMe');
		this.botUsername = String(me.username ?? '').trim();

		void (async () => {
			while (!controller.signal.aborted) {
				try {
					const ses = await this.getElectronSession();
					const response = await ses.fetch(`https://api.telegram.org/bot${this.token}/getUpdates`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							timeout: 30,
							offset: this.offset,
							allowed_updates: ['message'],
						}),
						signal: controller.signal,
					});
					if (!response.ok) {
						throw new Error(`Telegram API getUpdates failed: ${response.status}`);
					}
					const updates = (await response.json()) as { ok?: boolean; result?: TelegramUpdate[]; description?: string };
					if (!updates.ok) {
						throw new Error(updates.description || 'Telegram API getUpdates failed');
					}
					for (const update of updates.result ?? []) {
						this.offset = Math.max(this.offset, update.update_id + 1);
						const message = update.message;
						if (!message || message.from?.is_bot) {
							continue;
						}
						if (this.hasSeen(message.message_id)) {
							continue;
						}
						const chatId = String(message.chat.id);
						const senderId = message.from?.id != null ? String(message.from.id) : '';
						if (!this.isAllowedUser(senderId)) {
							continue;
						}
						if (message.chat.type !== 'private' && !this.isAllowedChat(chatId)) {
							continue;
						}
						const textSource = message.text ?? message.caption ?? '';
						const cleaned = this.cleanIncomingText(message, textSource);
						const attachments = await this.collectAttachments(message);
						if (!cleaned && attachments.length === 0) {
							continue;
						}
						const threadKey = message.message_thread_id ? `${chatId}:${message.message_thread_id}` : chatId;
						await onMessage({
							conversationKey: threadKey,
							messageId: String(message.message_id),
							text: cleaned,
							attachments,
							senderId: senderId || undefined,
							senderName: message.from?.username || message.from?.first_name,
							sendTyping: async () => {
								await this.api('sendChatAction', {
									chat_id: message.chat.id,
									action: 'typing',
									...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
								}).catch(() => {});
							},
							reply: async (text) => {
								const rendered = renderForPlatform(text, 'telegram');
								for (const chunk of splitPlainText(rendered, 3500)) {
									await this.api('sendMessage', {
										chat_id: message.chat.id,
										text: chunk,
										parse_mode: 'MarkdownV2',
										reply_to_message_id: message.message_id,
										...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
									}).catch(async () => {
										await this.api('sendMessage', {
											chat_id: message.chat.id,
											text: chunk,
											reply_to_message_id: message.message_id,
											...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
										});
									});
								}
							},
						});
					}
				} catch (error) {
					if (controller.signal.aborted || this.stopRequested) {
						break;
					}
					console.warn('[bots][telegram]', error instanceof Error ? error.message : error);
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}
			}
		})();
	}

	private isAllowedChat(chatId: string): boolean {
		const allowed = this.integration.allowedReplyChatIds?.length
			? this.integration.allowedReplyChatIds
			: (this.integration.telegram?.allowedChatIds ?? []);
		return allowed.length === 0 || allowed.includes(chatId);
	}

	private isAllowedUser(userId: string): boolean {
		const allowed = this.integration.allowedReplyUserIds ?? [];
		return allowed.length === 0 || allowed.includes(userId);
	}

	private cleanIncomingText(message: TelegramMessage, raw: string): string {
		const trimmed = String(raw ?? '').trim();
		if (!trimmed) {
			return '';
		}
		if (message.chat.type === 'private') {
			return trimmed;
		}
		if (this.integration.telegram?.requireMentionInGroups === false) {
			return trimmed;
		}
		if (!this.botUsername) {
			return '';
		}
		const mention = `@${this.botUsername.toLowerCase()}`;
		const lowered = trimmed.toLowerCase();
		if (!lowered.includes(mention)) {
			return '';
		}
		return trimmed.replace(new RegExp(`@${this.botUsername}\\b`, 'ig'), '').trim();
	}

	async stop(): Promise<void> {
		this.stopRequested = true;
		this.abortController?.abort();
		this.abortController = null;
		if (this.electronSession) {
			try {
				await this.electronSession.closeAllConnections();
			} catch {
				/* ignore */
			}
		}
		this.electronSession = null;
		this.seenMessageIds.clear();
	}
}
