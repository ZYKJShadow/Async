import type { BotIntegrationConfig, BotComposerMode } from '../botSettingsTypes.js';
import type { ShellSettings } from '../settingsStore.js';
import { extractBotReplyImagePaths, extractBotReplyText } from '../../src/agentStructuredMessage.js';
import {
	createBotWorkspaceLspManager,
	createInitialBotSession,
	getAvailableBotModels,
	runBotOrchestratorTurn,
	type BotSessionState,
} from './botRuntime.js';
import { DiscordBotAdapter } from './platforms/discordAdapter.js';
import { FeishuBotAdapter } from './platforms/feishuAdapter.js';
import type {
	BotPlatformAdapter,
	BotStreamChannel,
	PlatformInboundEnvelope,
	PlatformMessageHandler,
} from './platforms/common.js';
import { looksLikeCancelIntent, parseBotSlashCommand } from './platforms/common.js';
import { renderForPlatform } from './platforms/platformMarkdown.js';
import { SlackBotAdapter } from './platforms/slackAdapter.js';
import { TelegramBotAdapter } from './platforms/telegramAdapter.js';
import {
	deleteBotSession,
	deleteIntegrationSessions,
	readBotSession,
	writeBotSession,
} from './botSessionStore.js';
import * as path from 'node:path';

function looksLikeImagePath(filePath: string): boolean {
	return /\.(png|jpe?g|webp|gif|bmp|ico|tiff?)$/i.test(path.extname(filePath));
}

function createAdapter(integration: BotIntegrationConfig): BotPlatformAdapter | null {
	switch (integration.platform) {
		case 'telegram':
			return new TelegramBotAdapter(integration);
		case 'slack':
			return new SlackBotAdapter(integration);
		case 'discord':
			return new DiscordBotAdapter(integration);
		case 'feishu':
			return new FeishuBotAdapter(integration);
		default:
			return null;
	}
}

function sessionMapKey(integrationId: string, conversationKey: string): string {
	return `${integrationId}::${conversationKey}`;
}

type ActiveTurn = {
	abort: AbortController;
	startedAt: number;
};

class BotController {
	private readonly adapters = new Map<string, BotPlatformAdapter>();
	private readonly adapterFingerprints = new Map<string, string>();
	private readonly sessions = new Map<string, BotSessionState>();
	private readonly sessionTails = new Map<string, Promise<void>>();
	private readonly activeTurns = new Map<string, ActiveTurn>();
	private readonly lspManager: ReturnType<typeof createBotWorkspaceLspManager>;

	constructor(private readonly getSettings: () => ShellSettings) {
		this.lspManager = createBotWorkspaceLspManager(getSettings);
	}

	private clearIntegrationState(integrationId: string): void {
		for (const key of [...this.sessions.keys()]) {
			if (key.startsWith(`${integrationId}::`)) {
				this.sessions.delete(key);
			}
		}
		for (const key of [...this.sessionTails.keys()]) {
			if (key.startsWith(`${integrationId}::`)) {
				this.sessionTails.delete(key);
			}
		}
		for (const [key, turn] of [...this.activeTurns.entries()]) {
			if (key.startsWith(`${integrationId}::`)) {
				turn.abort.abort();
				this.activeTurns.delete(key);
			}
		}
		deleteIntegrationSessions(integrationId);
	}

	private loadOrCreateSession(
		integration: BotIntegrationConfig,
		settings: ShellSettings,
		envelope: PlatformInboundEnvelope
	): BotSessionState {
		const key = sessionMapKey(integration.id, envelope.conversationKey);
		const inMemory = this.sessions.get(key);
		if (inMemory) {
			return inMemory;
		}
		const persisted = readBotSession({ integrationId: integration.id, conversationKey: envelope.conversationKey });
		if (persisted) {
			this.sessions.set(key, persisted);
			return persisted;
		}
		const session = createInitialBotSession(
			integration,
			settings,
			envelope.conversationKey,
			envelope.senderId,
			envelope.senderName
		);
		this.sessions.set(key, session);
		return session;
	}

	private persistSession(integration: BotIntegrationConfig, session: BotSessionState): void {
		writeBotSession(
			{ integrationId: integration.id, conversationKey: session.conversationKey },
			session
		);
	}

	private formatStatus(session: BotSessionState): string {
		return [
			`workspace: ${session.workspaceRoot ?? '(none)'}`,
			`model: ${session.modelId || '(unset)'}`,
			`mode: ${session.mode}`,
			`leader turns cached: ${Math.floor((session.leaderMessages?.length ?? 0) / 2)}`,
		].join('\n');
	}

	private async handleSlashCommand(
		integration: BotIntegrationConfig,
		envelope: PlatformInboundEnvelope,
		settings: ShellSettings
	): Promise<boolean> {
		const command = parseBotSlashCommand(envelope.text);
		if (!command) {
			return false;
		}
		const key = sessionMapKey(integration.id, envelope.conversationKey);
		const session = this.loadOrCreateSession(integration, settings, envelope);

		const reply = async (text: string) => {
			await envelope.reply(renderForPlatform(text, integration.platform));
		};

		switch (command.kind) {
			case 'stop': {
				const active = this.activeTurns.get(key);
				if (active) {
					active.abort.abort();
					this.activeTurns.delete(key);
					await reply('已中止当前任务。');
				} else {
					await reply('当前没有正在运行的任务。');
				}
				return true;
			}
			case 'reset': {
				session.leaderMessages = [];
				session.leaderSummary = undefined;
				session.leaderSummaryCoversCount = undefined;
				session.threadIdsByWorkspace = {};
				this.persistSession(integration, session);
				await reply('已清空会话上下文。');
				return true;
			}
			case 'help': {
				await reply(
					[
						'可用命令：',
						'/stop 中止当前任务',
						'/reset 清空当前对话上下文',
						'/status 显示当前 model / workspace / mode',
						'/model <id> 切换模型',
						'/workspace <path|none> 切换工作区',
						'/mode <agent|ask|plan|team> 切换 worker 模式',
					].join('\n')
				);
				return true;
			}
			case 'status': {
				await reply(this.formatStatus(session));
				return true;
			}
			case 'model': {
				const target = command.value.trim();
				if (!target) {
					await reply('用法：/model <model_id>');
					return true;
				}
				const models = getAvailableBotModels(settings);
				const match = models.find(
					(item) => item.id === target || item.label === target
				);
				if (!match) {
					await reply(`未知模型：${target}`);
					return true;
				}
				session.modelId = match.id;
				this.persistSession(integration, session);
				await reply(`已切换模型：${match.label}`);
				return true;
			}
			case 'workspace': {
				const target = command.value.trim();
				if (!target) {
					await reply('用法：/workspace <path|none>');
					return true;
				}
				if (target.toLowerCase() === 'none') {
					session.workspaceRoot = null;
					this.persistSession(integration, session);
					await reply('已清空当前工作区。');
					return true;
				}
				const resolved = path.resolve(target);
				session.workspaceRoot = resolved;
				this.persistSession(integration, session);
				await reply(`已切换工作区：${resolved}`);
				return true;
			}
			case 'mode': {
				const mode = command.value.trim().toLowerCase() as BotComposerMode;
				if (!['agent', 'ask', 'plan', 'team'].includes(mode)) {
					await reply('用法：/mode <agent|ask|plan|team>');
					return true;
				}
				session.mode = mode;
				this.persistSession(integration, session);
				await reply(`已切换 worker 模式：${mode}`);
				return true;
			}
			default:
				return false;
		}
	}

	private async handleInbound(
		integration: BotIntegrationConfig,
		message: PlatformInboundEnvelope
	): Promise<void> {
		const settings = this.getSettings();
		const key = sessionMapKey(integration.id, message.conversationKey);

		if (await this.handleSlashCommand(integration, message, settings)) {
			return;
		}

		const active = this.activeTurns.get(key);
		if (active && looksLikeCancelIntent(message.text)) {
			active.abort.abort();
			this.activeTurns.delete(key);
			await message.reply('已中止上一个任务。').catch(() => {});
			return;
		}

		const session = this.loadOrCreateSession(integration, settings, message);

		const run = async () => {
			const ac = new AbortController();
			this.activeTurns.set(key, { abort: ac, startedAt: Date.now() });

			let typingTimer: ReturnType<typeof setInterval> | null = null;
			if (message.sendTyping) {
				const ping = () => {
					message.sendTyping?.().catch(() => {});
				};
				ping();
				typingTimer = setInterval(ping, 4000);
			}

			const stream = message.streamReply;
			if (stream) {
				await stream.onStart().catch(() => {});
			}

			try {
				const text = await runBotOrchestratorTurn({
					settings: this.getSettings(),
					integration,
					session,
					inbound: message,
					workspaceLspManager: this.lspManager,
					signal: ac.signal,
					onLeaderMessagesPersist: (next) => this.persistSession(integration, next),
					onStreamDelta: stream
						? (fullText: string, channel?: BotStreamChannel) => {
								stream.onDelta(fullText, channel).catch(() => {});
						  }
						: undefined,
					onTodoUpdate: stream
						? (todos) => {
								stream.onTodoUpdate(todos);
						  }
						: undefined,
					onSendAttachment:
						message.replyImage || message.replyFile
							? async (filePath) => {
									if (looksLikeImagePath(filePath) && message.replyImage) {
										await message.replyImage(filePath);
										return `已发送图片：${filePath}`;
									}
									if (message.replyFile) {
										await message.replyFile(filePath);
										return `已发送文件：${filePath}`;
									}
									if (message.replyImage) {
										await message.replyImage(filePath);
										return `已发送图片：${filePath}`;
									}
									throw new Error('当前平台不支持发送附件。');
							  }
							: undefined,
					onToolStatus: stream
						? (name, state, detail) => {
								stream.onToolStatus(name, state, detail);
						  }
						: undefined,
				});
				const displayText = extractBotReplyText(text || '');
				const imagePaths = extractBotReplyImagePaths(text || '');
				if (stream) {
					await stream!.onDone(displayText || '已完成，但没有返回可展示的文本结果。');
				} else {
					if (displayText) {
						await message.reply(renderForPlatform(displayText, integration.platform));
					}
				}
				if (message.replyImage && imagePaths.length > 0) {
					for (const imagePath of imagePaths) {
						await message.replyImage(imagePath).catch((error) => {
							console.warn('[bots] send image failed', error instanceof Error ? error.message : error);
						});
					}
				}
				if (!stream && !displayText && imagePaths.length === 0) {
					await message.reply('已完成，但没有返回可展示的文本结果。');
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				const aborted = ac.signal.aborted;
				if (aborted) {
					return;
				}
				if (stream) {
					await stream!.onError(msg).catch(() => {});
				} else {
					await message.reply(`机器人执行失败：${msg}`);
				}
			} finally {
				if (typingTimer) {
					clearInterval(typingTimer);
				}
				if (this.activeTurns.get(key)?.abort === ac) {
					this.activeTurns.delete(key);
				}
			}
		};

		const tail = this.sessionTails.get(key) ?? Promise.resolve();
		const next = tail
			.catch(() => {})
			.then(run)
			.finally(() => {
				if (this.sessionTails.get(key) === next) {
					this.sessionTails.delete(key);
				}
			});
		this.sessionTails.set(key, next);
		await next;
	}

	async syncFromSettings(settings: ShellSettings): Promise<void> {
		const nextIntegrations = new Map(
			(settings.bots?.integrations ?? [])
				.filter((integration) => integration.enabled)
				.map((integration) => [integration.id, integration])
		);

		for (const [id, adapter] of [...this.adapters.entries()]) {
			if (!nextIntegrations.has(id)) {
				await adapter.stop().catch(() => {});
				this.adapters.delete(id);
				this.adapterFingerprints.delete(id);
				this.clearIntegrationState(id);
			}
		}

		for (const [id, integration] of nextIntegrations.entries()) {
			const fingerprint = JSON.stringify(integration);
			const existingFingerprint = this.adapterFingerprints.get(id);
			if (this.adapters.has(id) && existingFingerprint === fingerprint) {
				continue;
			}
			if (this.adapters.has(id)) {
				await this.adapters.get(id)?.stop().catch(() => {});
				this.adapters.delete(id);
				this.adapterFingerprints.delete(id);
			}
			this.clearIntegrationState(id);
			const adapter = createAdapter(integration);
			if (!adapter) {
				continue;
			}
			const handler: PlatformMessageHandler = async (message) => {
				await this.handleInbound(integration, message);
			};
			const started = await adapter.start(handler).then(
				() => true,
				(error) => {
				console.warn('[bots] start adapter failed', integration.platform, error instanceof Error ? error.message : error);
					return false;
				}
			);
			if (started) {
				this.adapters.set(id, adapter);
				this.adapterFingerprints.set(id, fingerprint);
			}
		}
	}

	async dispose(): Promise<void> {
		for (const turn of this.activeTurns.values()) {
			turn.abort.abort();
		}
		this.activeTurns.clear();
		for (const adapter of this.adapters.values()) {
			await adapter.stop().catch(() => {});
		}
		this.adapters.clear();
		this.adapterFingerprints.clear();
		await this.lspManager.dispose().catch(() => {});
	}
}

let controller: BotController | null = null;

export function initBotController(getSettings: () => ShellSettings): void {
	if (!controller) {
		controller = new BotController(getSettings);
	}
}

export async function syncBotControllerFromSettings(settings: ShellSettings): Promise<void> {
	if (!controller) {
		return;
	}
	await controller.syncFromSettings(settings);
}

export async function disposeBotController(): Promise<void> {
	if (!controller) {
		return;
	}
	await controller.dispose();
	controller = null;
}

export { deleteBotSession };
