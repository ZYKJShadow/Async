import { app, session, type Session } from 'electron';
import FormData from 'form-data';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import type {
	BotInboundAttachment,
	BotPlatformAdapter,
	PlatformMessageHandler,
	StreamReplyCallbacks,
} from './common.js';
import { electronProxyRulesFromUrl, requestJson, resolveIntegrationProxyUrl } from './common.js';
import {
	renderTelegramRichText,
	splitTelegramRichText,
	type TelegramRichText,
} from './platformMarkdown.js';

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
const TELEGRAM_STREAM_MAX_CHARS = 3500;
const TELEGRAM_STREAM_EDIT_DEBOUNCE_MS = 900;

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

	private async uploadReply(
		method: 'sendPhoto' | 'sendDocument',
		fileField: 'photo' | 'document',
		message: TelegramMessage,
		filePath: string
	): Promise<void> {
		const fullPath = String(filePath ?? '').trim();
		if (!fullPath) {
			throw new Error('附件路径为空。');
		}
		if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
			throw new Error('附件不存在，或不是文件。');
		}

		const form = new FormData();
		form.append('chat_id', String(message.chat.id));
		form.append('reply_to_message_id', String(message.message_id));
		if (message.message_thread_id != null) {
			form.append('message_thread_id', String(message.message_thread_id));
		}
		form.append(fileField, fs.createReadStream(fullPath), {
			filename: path.basename(fullPath),
		});

		const response = await requestJson<{ ok?: boolean; result?: { message_id?: number }; description?: string }>(
			`https://api.telegram.org/bot${this.token}/${method}`,
			{
				method: 'POST',
				body: form,
				proxyUrl: resolveIntegrationProxyUrl(this.integration),
				signal: this.abortController?.signal,
			}
		);
		if (!response.ok) {
			throw new Error(response.description || `Telegram API ${method} failed`);
		}
	}

	private async sendTextReply(
		message: TelegramMessage,
		content: TelegramRichText,
		options?: { replyToOriginal?: boolean }
	): Promise<number> {
		const payload: Record<string, unknown> = {
			chat_id: message.chat.id,
			text: content.text,
		};
		if (content.entities.length > 0) {
			payload.entities = content.entities;
		}
		if (message.message_thread_id != null) {
			payload.message_thread_id = message.message_thread_id;
		}
		if (options?.replyToOriginal !== false) {
			payload.reply_to_message_id = message.message_id;
		}
		const result = await this.api<{ message_id?: number }>('sendMessage', payload);
		return Number(result?.message_id ?? 0) || 0;
	}

	private async editTextMessage(
		message: TelegramMessage,
		targetMessageId: number,
		content: TelegramRichText
	): Promise<void> {
		const payload: Record<string, unknown> = {
			chat_id: message.chat.id,
			message_id: targetMessageId,
			text: content.text,
		};
		if (content.entities.length > 0) {
			payload.entities = content.entities;
		}
		await this.api('editMessageText', payload);
	}

	private createStreamReply(message: TelegramMessage): StreamReplyCallbacks {
		let streamMessageId: number | null = null;
		let latestText = '';
		let pendingText = '';
		let flushTimer: ReturnType<typeof setTimeout> | null = null;
		let lastFlushAt = 0;
		const runningTools = new Map<string, string>();

		const summarizeRunningTools = (): string => {
			if (runningTools.size === 0) {
				return '';
			}
			const items = Array.from(runningTools.entries())
				.slice(-3)
				.map(([name, detail]) => `- ${name}${detail ? `: ${detail}` : ''}`);
			return ['进行中工具:', ...items].join('\n');
		};

		const buildStreamText = (fullText?: string): TelegramRichText => {
			const base = String(fullText ?? latestText).trim();
			const toolSummary = summarizeRunningTools();
			const combined = base
				? toolSummary
					? `${base}\n\n${toolSummary}`
					: base
				: toolSummary || '处理中，请稍候...';
			const rich = renderTelegramRichText(combined);
			const chunks = splitTelegramRichText(rich, TELEGRAM_STREAM_MAX_CHARS);
			if (chunks.length > 0 && chunks[0]) {
				return chunks[0];
			}
			return { text: '处理中，请稍候...', entities: [] };
		};

		const flush = async (forceText?: string): Promise<void> => {
			if (!streamMessageId) {
				return;
			}
			const nextRich = buildStreamText(forceText);
			if (!nextRich.text || nextRich.text === pendingText) {
				return;
			}
			pendingText = nextRich.text;
			lastFlushAt = Date.now();
			await this.editTextMessage(message, streamMessageId, nextRich).catch(() => {});
		};

		const scheduleFlush = (): void => {
			if (flushTimer) {
				return;
			}
			const delay = Math.max(120, TELEGRAM_STREAM_EDIT_DEBOUNCE_MS - (Date.now() - lastFlushAt));
			flushTimer = setTimeout(() => {
				flushTimer = null;
				void flush();
			}, delay);
		};

		const clearFlushTimer = (): void => {
			if (!flushTimer) {
				return;
			}
			clearTimeout(flushTimer);
			flushTimer = null;
		};

		return {
			onStart: async () => {
				const initial = renderTelegramRichText('处理中，请稍候...');
				streamMessageId = await this.sendTextReply(message, initial);
				pendingText = initial.text;
				lastFlushAt = Date.now();
			},
			onDelta: async (fullText) => {
				latestText = fullText;
				if (!streamMessageId) {
					return;
				}
				if (Date.now() - lastFlushAt >= TELEGRAM_STREAM_EDIT_DEBOUNCE_MS) {
					clearFlushTimer();
					await flush();
					return;
				}
				scheduleFlush();
			},
			onToolStatus: (name, state, detail) => {
				if (state === 'running') {
					runningTools.set(name, String(detail ?? '').trim());
				} else {
					runningTools.delete(name);
				}
				if (streamMessageId) {
					scheduleFlush();
				}
			},
			onTodoUpdate: () => {
				/* Telegram streaming keeps things lightweight; no-op for now. */
			},
			onDone: async (fullText) => {
				clearFlushTimer();
				runningTools.clear();
				const renderedChunks = splitTelegramRichText(renderTelegramRichText(fullText), TELEGRAM_STREAM_MAX_CHARS);
				if (!streamMessageId) {
					for (const chunk of renderedChunks) {
						await this.sendTextReply(message, chunk);
					}
					return;
				}
				if (renderedChunks.length === 0) {
					await this.editTextMessage(message, streamMessageId, renderTelegramRichText('已完成。')).catch(() => {});
					return;
				}
				await this.editTextMessage(message, streamMessageId, renderedChunks[0]!).catch(() => {});
				for (const chunk of renderedChunks.slice(1)) {
					await this.sendTextReply(message, chunk, { replyToOriginal: false }).catch(() => {});
				}
			},
			onError: async (error) => {
				clearFlushTimer();
				const rendered = renderTelegramRichText(`❌ ${error}`);
				if (!streamMessageId) {
					await this.sendTextReply(message, rendered).catch(() => {});
					return;
				}
				await this.editTextMessage(message, streamMessageId, rendered).catch(async () => {
					await this.sendTextReply(message, rendered).catch(() => {});
				});
			},
		};
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
						const threadReplyParams = message.message_thread_id ? { message_thread_id: message.message_thread_id } : {};
						const threadKey = message.message_thread_id ? `${chatId}:${message.message_thread_id}` : chatId;
						const streamReply = this.createStreamReply(message);
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
									...threadReplyParams,
								}).catch(() => {});
							},
							reply: async (text) => {
								const rendered = splitTelegramRichText(renderTelegramRichText(text), TELEGRAM_STREAM_MAX_CHARS);
								for (const [idx, chunk] of rendered.entries()) {
									await this.sendTextReply(
										message,
										chunk,
										{ replyToOriginal: idx === 0 }
									);
								}
							},
							replyImage: async (filePath) => {
								await this.uploadReply('sendPhoto', 'photo', message, filePath);
							},
							replyFile: async (filePath) => {
								await this.uploadReply('sendDocument', 'document', message, filePath);
							},
							streamReply,
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
