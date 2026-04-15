import type { BotIntegrationConfig } from '../botSettingsTypes.js';
import type { ShellSettings } from '../settingsStore.js';
import { extractBotReplyText } from '../../src/agentStructuredMessage.js';
import { createBotWorkspaceLspManager, createInitialBotSession, runBotOrchestratorTurn, type BotSessionState } from './botRuntime.js';
import { DiscordBotAdapter } from './platforms/discordAdapter.js';
import { FeishuBotAdapter } from './platforms/feishuAdapter.js';
import type { BotPlatformAdapter, PlatformInboundEnvelope, PlatformMessageHandler } from './platforms/common.js';
import { SlackBotAdapter } from './platforms/slackAdapter.js';
import { TelegramBotAdapter } from './platforms/telegramAdapter.js';

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

class BotController {
	private readonly adapters = new Map<string, BotPlatformAdapter>();
	private readonly adapterFingerprints = new Map<string, string>();
	private readonly sessions = new Map<string, BotSessionState>();
	private readonly sessionTails = new Map<string, Promise<void>>();
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
	}

	private async handleInbound(
		integration: BotIntegrationConfig,
		message: PlatformInboundEnvelope
	): Promise<void> {
		const settings = this.getSettings();
		const key = sessionMapKey(integration.id, message.conversationKey);
		const session =
			this.sessions.get(key) ??
			createInitialBotSession(
				integration,
				settings,
				message.conversationKey,
				message.senderId,
				message.senderName
			);
		this.sessions.set(key, session);

		const run = async () => {
			const ac = new AbortController();
			const stream = message.streamReply;
			let streamStarted = false;
			try {
				const text = await runBotOrchestratorTurn({
					settings: this.getSettings(),
					integration,
					session,
					inbound: message,
					workspaceLspManager: this.lspManager,
					signal: ac.signal,
					onStreamDelta: stream
						? (fullText) => {
								if (!streamStarted) {
									streamStarted = true;
									stream.onStart().catch(() => {});
								}
								stream.onDelta(fullText).catch(() => {});
						  }
						: undefined,
					onToolStatus: stream
						? (name, state) => {
								if (!streamStarted) {
									streamStarted = true;
									stream.onStart().catch(() => {});
								}
								stream.onToolStatus(name, state);
						  }
						: undefined,
				});
				const displayText = extractBotReplyText(text || '');
				if (streamStarted) {
					await stream!.onDone(displayText || '已完成，但没有返回可展示的文本结果。');
				} else {
					await message.reply(displayText || '已完成，但没有返回可展示的文本结果。');
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (streamStarted) {
					await stream!.onError(msg).catch(() => {});
				} else {
					await message.reply(`机器人执行失败：${msg}`);
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
