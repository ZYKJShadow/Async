/**
 * Feishu CardKit v1 流式卡片客户端。
 *
 * 参考：
 * - 创建卡片实体: POST /cardkit/v1/cards
 * - 更新组件: PUT /cardkit/v1/cards/:card_id/elements/:element_id
 * - 关闭流式模式: PATCH /cardkit/v1/cards/:card_id/settings
 */

import * as path from 'node:path';
import { requestJson } from './common.js';
import type { BotStreamChannel, BotTodoListItem } from './common.js';

type CardTextObject = {
	tag: 'plain_text';
	content: string;
};

export type CardElement = {
	tag: string;
	element_id: string;
	[key: string]: unknown;
};

export type CardKitSchema = {
	schema: '2.0';
	config: {
		streaming_mode: boolean;
		summary: { content: string };
		streaming_config?: {
			print_frequency_ms: { default: number };
			print_step: { default: number };
		};
	};
	body: {
		direction?: 'vertical';
		padding?: string;
		elements: CardElement[];
	};
};

type ApiResponse = {
	code: number;
	msg: string;
	data?: Record<string, unknown>;
};

type SessionPhase = 'running' | 'done' | 'error' | 'aborted';

type InlineImageEntry = {
	sourceKey: string;
	imageKey: string;
	title: string;
};

export type ToolStatusEntry = {
	name: string;
	state: 'running' | 'completed' | 'error';
	detail?: string;
	updatedAt: number;
};

const ELEMENT_IDS = {
	status: 'status',
	progress: 'progress',
	todo: 'todo',
	output: 'output',
} as const;

const IMAGE_ELEMENT_IDS = ['image_1', 'image_2', 'image_3', 'image_4'] as const;
const STATUS_THROTTLE_MS = 160;
const CONTENT_THROTTLE_MS = 420;
const MAX_RECENT_TOOL_STATUSES = 6;
const MAX_VISIBLE_TODOS = 8;
const MAX_RUNNING_OUTPUT_CHARS = 4200;
const MAX_FINAL_OUTPUT_CHARS = 16000;

function trimText(value: unknown): string {
	return String(value ?? '').trim();
}

function normalizePathKey(filePath: string): string {
	const trimmed = trimText(filePath);
	if (!trimmed) {
		return '';
	}
	try {
		return path.resolve(trimmed).replace(/\\/g, '/').toLowerCase();
	} catch {
		return trimmed.replace(/\\/g, '/').toLowerCase();
	}
}

function buildPlainText(content: string): CardTextObject {
	return {
		tag: 'plain_text',
		content: content || '图片',
	};
}

function buildMarkdownElement(elementId: string, content: string): CardElement {
	return {
		tag: 'markdown',
		element_id: elementId,
		content,
	};
}

function buildImageElement(elementId: string, image: InlineImageEntry): CardElement {
	return {
		tag: 'img',
		element_id: elementId,
		img_key: image.imageKey,
		alt: buildPlainText(image.title),
		title: buildPlainText(image.title),
		scale_type: 'fit_horizontal',
		preview: true,
		transparent: false,
		corner_radius: '8px',
		margin: '8px 0 0 0',
	};
}

function serializeElement(element: CardElement): string {
	return JSON.stringify(element);
}

function stateLabel(state: ToolStatusEntry['state']): string {
	switch (state) {
		case 'running':
			return '进行中';
		case 'completed':
			return '已完成';
		case 'error':
			return '失败';
		default:
			return '处理中';
	}
}

function stripMarkdownImageSyntax(text: string): string {
	return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt) => `[图片${trimText(alt) ? `：${trimText(alt)}` : ''}]`);
}

function normalizeRenderedText(text: string): string {
	return stripMarkdownImageSyntax(String(text ?? '').replace(/\r\n/g, '\n').trim());
}

function truncateStart(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}
	return {
		text: `${text.slice(0, maxChars)}\n\n_卡片内已截断，完整内容较长。_`,
		truncated: true,
	};
}

function truncateTail(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}
	return {
		text: `…\n${text.slice(-maxChars)}\n\n_为减少刷新，流式阶段仅展示最新片段。_`,
		truncated: true,
	};
}

export class FeishuCardKitClient {
	private readonly appId: string;
	private readonly appSecret: string;
	private readonly apiBase: string;
	private readonly proxyUrl?: string;

	private tokenValue = '';
	private tokenExpiresAt = 0;
	private refreshPromise: Promise<string> | null = null;

	constructor(opts: { appId: string; appSecret: string; proxyUrl?: string; apiBase?: string }) {
		this.appId = opts.appId;
		this.appSecret = opts.appSecret;
		this.proxyUrl = opts.proxyUrl;
		this.apiBase = opts.apiBase ?? 'https://open.feishu.cn/open-apis';
	}

	async createCard(cardJson: CardKitSchema): Promise<string> {
		const res = await this.api('POST', '/cardkit/v1/cards', {
			type: 'card_json',
			data: JSON.stringify(cardJson),
		});
		const cardId = res.data?.card_id;
		if (typeof cardId !== 'string') {
			throw new Error(`CardKit createCard: missing card_id (code=${res.code}, msg=${res.msg})`);
		}
		return cardId;
	}

	async updateElementContent(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
		await this.api('PUT', `/cardkit/v1/cards/${cardId}/elements/${elementId}/content`, {
			content,
			sequence,
			uuid: `s_${cardId}_${sequence}`,
		});
	}

	async updateElement(cardId: string, elementId: string, element: CardElement, sequence: number): Promise<void> {
		await this.api('PUT', `/cardkit/v1/cards/${cardId}/elements/${elementId}`, {
			element: JSON.stringify(element),
			sequence,
			uuid: `e_${cardId}_${elementId}_${sequence}`,
		});
	}

	async closeStreaming(cardId: string, summary: string, sequence: number): Promise<void> {
		await this.api('PATCH', `/cardkit/v1/cards/${cardId}/settings`, {
			settings: JSON.stringify({
				config: { streaming_mode: false, summary: { content: summary } },
			}),
			sequence,
			uuid: `c_${cardId}_${sequence}`,
		});
	}

	async sendCardMessage(chatId: string, cardId: string, replyMessageId?: string): Promise<string> {
		const content = JSON.stringify({ type: 'card', data: { card_id: cardId } });
		let res: ApiResponse;
		if (replyMessageId) {
			res = await this.api('POST', `/im/v1/messages/${replyMessageId}/reply`, {
				msg_type: 'interactive',
				content,
			});
		} else {
			res = await this.api('POST', '/im/v1/messages?receive_id_type=chat_id', {
				receive_id: chatId,
				msg_type: 'interactive',
				content,
			});
		}
		const messageId = res.data?.message_id;
		if (typeof messageId !== 'string') {
			throw new Error(`CardKit sendCardMessage: missing message_id (code=${res.code}, msg=${res.msg})`);
		}
		return messageId;
	}

	private async getToken(): Promise<string> {
		if (this.tokenExpiresAt - Date.now() > 300_000) {
			return this.tokenValue;
		}
		if (this.refreshPromise) {
			return this.refreshPromise;
		}
		this.refreshPromise = this.refreshToken();
		try {
			return await this.refreshPromise;
		} finally {
			this.refreshPromise = null;
		}
	}

	private async refreshToken(): Promise<string> {
		const data = await requestJson<{
			code: number;
			msg: string;
			tenant_access_token?: string;
			expire?: number;
		}>(`${this.apiBase}/auth/v3/tenant_access_token/internal`, {
			method: 'POST',
			body: { app_id: this.appId, app_secret: this.appSecret },
			proxyUrl: this.proxyUrl,
		});
		if (data.code !== 0 || !data.tenant_access_token) {
			throw new Error(`CardKit token error: ${data.msg} (code=${data.code})`);
		}
		this.tokenValue = data.tenant_access_token;
		this.tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000;
		return this.tokenValue;
	}

	private async api(method: string, urlPath: string, body: Record<string, unknown>, retry = 0): Promise<ApiResponse> {
		const token = await this.getToken();
		const res = await requestJson<ApiResponse>(`${this.apiBase}${urlPath}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body,
			proxyUrl: this.proxyUrl,
		});
		if (res.code === 99991663 && retry < 1) {
			this.tokenValue = '';
			this.tokenExpiresAt = 0;
			return this.api(method, urlPath, body, retry + 1);
		}
		if (res.code !== 0) {
			throw new Error(`CardKit API ${method} ${urlPath}: ${res.msg} (code=${res.code})`);
		}
		return res;
	}
}

export class FeishuStreamingSession {
	private readonly client: FeishuCardKitClient;
	private readonly uploadImage?: (filePath: string) => Promise<string>;

	private cardId = '';
	private sequence = 0;
	private currentText = '';
	private currentChannel: BotStreamChannel = 'leader';
	private phase: SessionPhase = 'running';
	private finalErrorMessage = '';
	private closed = false;
	private closing = false;
	private failed = false;
	private startPromise: Promise<void> | null = null;
	private queue: Promise<void> = Promise.resolve();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushTimerDueAt = 0;
	private dirty = false;
	private activityLog: ToolStatusEntry[] = [];
	private runningActivities = new Map<string, ToolStatusEntry>();
	private todos: BotTodoListItem[] = [];
	private inlineImages: InlineImageEntry[] = [];
	private imageUploads = new Map<string, Promise<InlineImageEntry | null>>();
	private lastRenderedByElement = new Map<string, string>();

	constructor(
		client: FeishuCardKitClient,
		opts?: {
			uploadImage?: (filePath: string) => Promise<string>;
		}
	) {
		this.client = client;
		this.uploadImage = opts?.uploadImage;
	}

	get isFailed(): boolean {
		return this.failed;
	}

	get isActive(): boolean {
		return this.cardId !== '' && !this.closed && !this.closing && !this.failed;
	}

	async start(chatId: string, replyMessageId?: string): Promise<void> {
		if (this.startPromise) {
			return await this.startPromise;
		}
		this.startPromise = (async () => {
			try {
				const initialElements = this.buildRenderedElements();
				const cardJson: CardKitSchema = {
					schema: '2.0',
					config: {
						streaming_mode: true,
						summary: { content: '生成中...' },
						streaming_config: {
							print_frequency_ms: { default: 50 },
							print_step: { default: 5 },
						},
					},
					body: {
						direction: 'vertical',
						padding: '12px 12px 12px 12px',
						elements: initialElements,
					},
				};

				this.cardId = await this.client.createCard(cardJson);
				await this.client.sendCardMessage(chatId, this.cardId, replyMessageId);
				this.sequence = 0;
				for (const element of initialElements) {
					this.lastRenderedByElement.set(element.element_id, serializeElement(element));
				}
				if (this.dirty && !this.closed && !this.closing) {
					this.scheduleFlush('status');
				}
			} catch (error) {
				this.failed = true;
				console.warn('[feishu-cardkit] streaming session start failed:', error instanceof Error ? error.message : error);
			}
		})();
		await this.startPromise;
	}

	update(fullText: string, channel: BotStreamChannel = 'leader'): void {
		if (this.closed || this.closing || this.failed) {
			return;
		}
		this.currentText = fullText;
		this.currentChannel = channel;
		this.scheduleFlush('content');
	}

	setToolStatus(name: string, state: 'running' | 'completed' | 'error', detail?: string): void {
		if (this.closed || this.closing || this.failed) {
			return;
		}
		const cleanDetail = trimText(detail) || undefined;
		const now = Date.now();
		const existing = this.runningActivities.get(name);
		if (state === 'running') {
			if (existing) {
				existing.state = 'running';
				existing.detail = cleanDetail ?? existing.detail;
				existing.updatedAt = now;
			} else {
				const entry: ToolStatusEntry = {
					name,
					state,
					detail: cleanDetail,
					updatedAt: now,
				};
				this.activityLog.push(entry);
				this.runningActivities.set(name, entry);
			}
		} else if (existing) {
			existing.state = state;
			existing.detail = cleanDetail ?? existing.detail;
			existing.updatedAt = now;
			this.runningActivities.delete(name);
		} else {
			this.activityLog.push({
				name,
				state,
				detail: cleanDetail,
				updatedAt: now,
			});
		}
		this.scheduleFlush('status');
	}

	setTodos(todos: BotTodoListItem[]): void {
		if (this.closed || this.closing || this.failed) {
			return;
		}
		this.todos = todos.map((todo) => ({
			content: trimText(todo.content),
			status:
				todo.status === 'completed' || todo.status === 'in_progress' || todo.status === 'pending'
					? todo.status
					: 'pending',
			activeForm: trimText(todo.activeForm) || undefined,
		})).filter((todo) => todo.content);
		this.scheduleFlush('status');
	}

	async attachImage(filePath: string, title?: string): Promise<boolean> {
		if (this.closed || this.closing || this.failed || !this.uploadImage) {
			return false;
		}
		const sourceKey = normalizePathKey(filePath);
		if (!sourceKey) {
			return false;
		}
		if (this.inlineImages.some((image) => image.sourceKey === sourceKey)) {
			return true;
		}
		let pending = this.imageUploads.get(sourceKey);
		if (!pending) {
			if (this.inlineImages.length >= IMAGE_ELEMENT_IDS.length) {
				return false;
			}
			pending = this.uploadInlineImage(sourceKey, filePath, title);
			this.imageUploads.set(sourceKey, pending);
		}
		const uploaded = await pending.catch(() => null);
		return uploaded != null;
	}

	async close(finalText?: string): Promise<void> {
		await this.finish('done', finalText);
	}

	async fail(error: string): Promise<void> {
		await this.finish('error', error);
	}

	async abort(reason?: string): Promise<void> {
		await this.finish('aborted', reason);
	}

	private async finish(phase: SessionPhase, payload?: string): Promise<void> {
		if (this.closed || this.closing) {
			return;
		}
		this.closing = true;
		this.phase = phase;
		if (phase === 'done') {
			if (payload !== undefined) {
				this.currentText = payload;
			}
		} else if (phase === 'error') {
			this.finalErrorMessage = trimText(payload) || '执行失败。';
			if (!trimText(this.currentText)) {
				this.currentText = `❌ ${this.finalErrorMessage}`;
			}
		} else if (phase === 'aborted' && !trimText(this.currentText)) {
			this.currentText = trimText(payload) || '已按指令暂停当前任务。';
		}
		if (this.startPromise) {
			await this.startPromise;
		}
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
			this.flushTimerDueAt = 0;
		}
		await this.queue;
		try {
			if (!this.cardId) {
				this.closed = true;
				return;
			}
			this.dirty = false;
			await this.flushRenderedElements();
			this.sequence += 1;
			await this.client.closeStreaming(this.cardId, this.buildSummary(), this.sequence);
		} catch (error) {
			console.warn('[feishu-cardkit] close error:', error instanceof Error ? error.message : error);
		} finally {
			this.closed = true;
		}
	}

	private async uploadInlineImage(sourceKey: string, filePath: string, title?: string): Promise<InlineImageEntry | null> {
		try {
			const imageKey = await this.uploadImage?.(filePath);
			if (!imageKey) {
				return null;
			}
			if (this.inlineImages.some((image) => image.sourceKey === sourceKey)) {
				return this.inlineImages.find((image) => image.sourceKey === sourceKey) ?? null;
			}
			if (this.inlineImages.length >= IMAGE_ELEMENT_IDS.length) {
				return null;
			}
			const entry: InlineImageEntry = {
				sourceKey,
				imageKey,
				title: trimText(title) || path.basename(filePath) || '图片',
			};
			this.inlineImages.push(entry);
			this.scheduleFlush('status');
			return entry;
		} catch (error) {
			console.warn('[feishu-cardkit] image upload failed:', error instanceof Error ? error.message : error);
			return null;
		} finally {
			this.imageUploads.delete(sourceKey);
		}
	}

	private scheduleFlush(kind: 'status' | 'content'): void {
		this.dirty = true;
		if (!this.cardId || this.closed || this.closing || this.failed) {
			return;
		}
		const delay = kind === 'status' ? STATUS_THROTTLE_MS : CONTENT_THROTTLE_MS;
		const dueAt = Date.now() + delay;
		if (this.flushTimer && this.flushTimerDueAt <= dueAt) {
			return;
		}
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
		}
		this.flushTimerDueAt = dueAt;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flushTimerDueAt = 0;
			void this.enqueueFlush();
		}, delay);
	}

	private async enqueueFlush(): Promise<void> {
		this.queue = this.queue
			.then(async () => {
				if (!this.cardId || this.closed || this.failed || !this.dirty) {
					return;
				}
				this.dirty = false;
				await this.flushRenderedElements();
			})
			.catch((error) => {
				console.warn('[feishu-cardkit] update error:', error instanceof Error ? error.message : error);
			})
			.finally(() => {
				if (this.dirty && !this.closed && !this.closing && !this.failed) {
					this.scheduleFlush('status');
				}
			});
		await this.queue;
	}

	private async flushRenderedElements(): Promise<void> {
		if (!this.cardId) {
			return;
		}
		for (const element of this.buildRenderedElements()) {
			const serialized = serializeElement(element);
			if (this.lastRenderedByElement.get(element.element_id) === serialized) {
				continue;
			}
			this.sequence += 1;
			await this.client.updateElement(this.cardId, element.element_id, element, this.sequence);
			this.lastRenderedByElement.set(element.element_id, serialized);
		}
	}

	private buildRenderedElements(): CardElement[] {
		const elements: CardElement[] = [
			buildMarkdownElement(ELEMENT_IDS.status, this.buildStatusMarkdown()),
			buildMarkdownElement(ELEMENT_IDS.progress, this.buildProgressMarkdown()),
			buildMarkdownElement(ELEMENT_IDS.todo, this.buildTodoMarkdown()),
			buildMarkdownElement(ELEMENT_IDS.output, this.buildOutputMarkdown()),
		];
		for (let index = 0; index < IMAGE_ELEMENT_IDS.length; index += 1) {
			const elementId = IMAGE_ELEMENT_IDS[index]!;
			const image = this.inlineImages[index];
			elements.push(image ? buildImageElement(elementId, image) : buildMarkdownElement(elementId, ''));
		}
		return elements;
	}

	private buildStatusMarkdown(): string {
		const lines: string[] = [];
		if (this.phase === 'done') {
			lines.push('**已完成**');
			lines.push('本轮处理已经结束。');
		} else if (this.phase === 'error') {
			lines.push('**执行出错**');
			if (this.finalErrorMessage) {
				lines.push(`错误：${this.finalErrorMessage}`);
			}
		} else if (this.phase === 'aborted') {
			lines.push('**已暂停**');
			lines.push('当前执行已按用户指令停止。');
		} else {
			lines.push('**处理中**');
			lines.push(this.currentChannel === 'worker' ? '协作 Agent 正在参与当前回复。' : '主 Agent 正在处理当前请求。');
			lines.push('发送 `/pause` 可随时停止当前任务。');
		}
		const current = this.describeCurrentActivity();
		if (current) {
			lines.push(`当前动作：${current}`);
		}
		return lines.join('\n');
	}

	private buildProgressMarkdown(): string {
		const lines = ['**进展**'];
		const current = this.getLatestRunningActivity();
		const recent = this.activityLog
			.filter((entry) => entry !== current)
			.slice(-MAX_RECENT_TOOL_STATUSES)
			.reverse();

		if (current) {
			lines.push(`- [当前] ${this.describeToolEntry(current)}`);
		}
		for (const entry of recent) {
			lines.push(`- [${stateLabel(entry.state)}] ${this.describeToolEntry(entry)}`);
		}
		if (lines.length === 1) {
			lines.push(`- ${this.describeIdleProgress()}`);
		}
		return lines.join('\n');
	}

	private buildTodoMarkdown(): string {
		if (this.todos.length === 0) {
			return '';
		}
		const lines = ['**待办**'];
		for (const todo of this.todos.slice(0, MAX_VISIBLE_TODOS)) {
			const label =
				todo.status === 'in_progress' && trimText(todo.activeForm)
					? trimText(todo.activeForm)
					: todo.content;
			const prefix =
				todo.status === 'completed'
					? '[已完成]'
					: todo.status === 'in_progress'
						? '[进行中]'
						: '[待处理]';
			lines.push(`- ${prefix} ${label}`);
		}
		return lines.join('\n');
	}

	private buildOutputMarkdown(): string {
		const normalized = normalizeRenderedText(this.currentText);
		const title =
			this.phase === 'done'
				? '**最终回复**'
				: this.phase === 'error'
					? '**错误输出**'
					: this.phase === 'aborted'
						? '**已暂停内容**'
						: '**回复预览**';
		if (!normalized) {
			if (this.phase === 'running') {
				return `${title}\n结果会随着处理推进逐步出现在这里。`;
			}
			if (this.phase === 'aborted') {
				return `${title}\n已按指令暂停，尚未产出可展示的正文。`;
			}
			if (this.phase === 'error') {
				return `${title}\n${this.finalErrorMessage || '执行失败。'}`;
			}
			return `${title}\n本轮没有返回可展示的文本结果。`;
		}
		const rendered =
			this.phase === 'running'
				? truncateTail(normalized, MAX_RUNNING_OUTPUT_CHARS)
				: truncateStart(normalized, MAX_FINAL_OUTPUT_CHARS);
		return `${title}\n${rendered.text}`;
	}

	private buildSummary(): string {
		if (this.phase === 'aborted') {
			return '已暂停';
		}
		if (this.phase === 'error') {
			return `执行出错：${this.finalErrorMessage || '请查看卡片内容'}`.slice(0, 80);
		}
		const text = normalizeRenderedText(this.currentText);
		if (text) {
			return text.length > 80 ? `${text.slice(0, 80)}...` : text;
		}
		const current = this.describeCurrentActivity();
		if (current) {
			return current.length > 80 ? `${current.slice(0, 80)}...` : current;
		}
		return this.phase === 'done' ? '已完成' : '处理中';
	}

	private getLatestRunningActivity(): ToolStatusEntry | null {
		for (let index = this.activityLog.length - 1; index >= 0; index -= 1) {
			const entry = this.activityLog[index];
			if (entry?.state === 'running') {
				return entry;
			}
		}
		return null;
	}

	private describeCurrentActivity(): string {
		const running = this.getLatestRunningActivity();
		if (running) {
			return trimText(running.detail) || running.name;
		}
		if (this.phase === 'running' && trimText(this.currentText)) {
			return this.currentChannel === 'worker' ? '协作 Agent 正在整理结果' : '正在整理回复';
		}
		if (this.phase === 'running') {
			return '正在读取上下文并思考下一步';
		}
		const latest = this.activityLog[this.activityLog.length - 1];
		if (latest) {
			return trimText(latest.detail) || latest.name;
		}
		return '';
	}

	private describeToolEntry(entry: ToolStatusEntry): string {
		const detail = trimText(entry.detail);
		if (detail) {
			return detail;
		}
		return `\`${entry.name}\``;
	}

	private describeIdleProgress(): string {
		if (this.phase === 'done') {
			return '最终结果已整理完成。';
		}
		if (this.phase === 'error') {
			return '执行过程中发生错误。';
		}
		if (this.phase === 'aborted') {
			return '本轮处理已暂停。';
		}
		return trimText(this.currentText) ? '正在整理输出。' : '正在读取上下文并分析请求。';
	}
}
