import { ipcMain, BrowserWindow, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	getSettings,
	patchSettings,
	updateBotIntegrationFeishuTokens,
	type UserLlmProvider,
	type UserModelEntry,
	type OAuthProviderKind,
	type ProviderOAuthAuthRecord,
} from '../../settingsStore.js';
import { syncBotControllerFromSettings } from '../../bots/botController.js';
import { testBotIntegrationConnection } from '../../bots/botConnectivity.js';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import { discoverProviderModels } from '../../llm/providerModelDiscovery.js';
import {
	cancelActiveProviderOAuthLogin,
	discoverProviderOAuthModels,
	ensureFreshOAuthAuthForRequest,
	fetchProviderOAuthUsageSummary,
	providerOAuthLabel,
	runProviderOAuthLogin,
	type ProviderOAuthDiscoveredModel,
} from '../../llm/providerOAuthLogin.js';
import { getBuiltinTeamCatalogPayload } from '../../agent/builtinTeamCatalog.js';
import { cancelFeishuOauth, runFeishuOauth, FEISHU_OAUTH_CALLBACK_URLS } from '../../bots/platforms/feishu/feishuOauth.js';

function stripSkillFrontmatter(md: string): { body: string; name?: string; description?: string } {
	const t = md.trim();
	if (!t.startsWith('---')) {
		return { body: md };
	}
	const end = t.indexOf('\n---', 3);
	if (end < 0) {
		return { body: md };
	}
	const yamlBlock = t.slice(3, end).trim();
	const body = t.slice(end + 4).trim();
	const meta: Record<string, string> = {};
	for (const line of yamlBlock.split('\n')) {
		const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
		if (m) {
			meta[m[1]!] = (m[2] ?? '').replace(/^["']|["']$/g, '').trim();
		}
	}
	return {
		body,
		name: meta.name || meta.title,
		description: meta.description,
	};
}

function sanitizeSkillSlug(raw: string): string {
	return String(raw ?? '')
		.trim()
		.toLowerCase()
		.replace(/^\.\//, '')
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '');
}

const OAUTH_PROVIDER_DEFAULTS: Record<
	OAuthProviderKind,
	{
		displayName: string;
		modelId: string;
		paradigm: UserLlmProvider['paradigm'];
		maxOutputTokens: number;
		contextWindowTokens: number;
		providerIdentity: NonNullable<UserLlmProvider['providerIdentity']>;
	}
> = {
	codex: {
		displayName: 'Codex (ChatGPT)',
		modelId: 'gpt-5.3-codex',
		paradigm: 'openai-compatible',
		maxOutputTokens: 128_000,
		contextWindowTokens: 400_000,
		providerIdentity: { preset: 'codex' },
	},
	claude: {
		displayName: 'Claude Code',
		modelId: 'claude-sonnet-4-5-20250929',
		paradigm: 'anthropic',
		maxOutputTokens: 64_000,
		contextWindowTokens: 200_000,
		providerIdentity: { preset: 'claude-code' },
	},
	antigravity: {
		displayName: 'Antigravity',
		modelId: 'gemini-3-pro-preview',
		paradigm: 'gemini',
		maxOutputTokens: 65_536,
		contextWindowTokens: 1_048_576,
		providerIdentity: { preset: 'antigravity' },
	},
};

function createOAuthModelEntry(
	providerId: string,
	authProvider: OAuthProviderKind,
	model?: ProviderOAuthDiscoveredModel
): UserModelEntry {
	const defaults = OAUTH_PROVIDER_DEFAULTS[authProvider];
	const requestName = model?.id?.trim() || defaults.modelId;
	return {
		id: randomUUID(),
		providerId,
		displayName: model?.displayName?.trim() || requestName,
		requestName,
		maxOutputTokens: model?.maxOutputTokens ?? defaults.maxOutputTokens,
		contextWindowTokens: model?.contextWindowTokens ?? defaults.contextWindowTokens,
		temperatureMode: 'auto',
	};
}

function oauthLoginDisplayDetail(login: ProviderOAuthAuthRecord): string {
	return (login.email || login.accountId || login.projectId || '').trim();
}

function oauthProviderDisplayName(authProvider: OAuthProviderKind, login: ProviderOAuthAuthRecord): string {
	const defaults = OAUTH_PROVIDER_DEFAULTS[authProvider];
	const detail = oauthLoginDisplayDetail(login);
	return detail ? `${defaults.displayName} (${detail})` : defaults.displayName;
}

function appendOAuthLoginProvider(params: {
	authProvider: OAuthProviderKind;
	providers: UserLlmProvider[];
	entries: UserModelEntry[];
	defaultModel?: string;
	login: ProviderOAuthAuthRecord;
	discoveredModels?: ProviderOAuthDiscoveredModel[];
}): {
	providers: UserLlmProvider[];
	entries: UserModelEntry[];
	providerId: string;
	modelId: string;
	defaultModel: string;
	modelCount: number;
	accountId?: string;
	planType?: string;
	email?: string;
	projectId?: string;
} {
	const defaults = OAUTH_PROVIDER_DEFAULTS[params.authProvider];
	const providerId = randomUUID();
	const discoveredModels = dedupeDiscoveredOAuthModels(params.discoveredModels ?? []);
	const modelEntries =
		discoveredModels.length > 0
			? discoveredModels.map((model) => createOAuthModelEntry(providerId, params.authProvider, model))
			: [createOAuthModelEntry(providerId, params.authProvider)];
	const nextProvider: UserLlmProvider = {
		id: providerId,
		displayName: oauthProviderDisplayName(params.authProvider, params.login),
		paradigm: defaults.paradigm,
		apiKey: params.login.accessToken,
		providerIdentity: defaults.providerIdentity,
		oauthAuth: params.login,
		...(params.authProvider === 'codex'
			? {
					codexAuth: {
						idToken: params.login.idToken ?? '',
						accessToken: params.login.accessToken,
						refreshToken: params.login.refreshToken,
						lastRefreshAt: params.login.lastRefreshAt,
						...(params.login.accountId ? { accountId: params.login.accountId } : {}),
						...(params.login.planType ? { planType: params.login.planType } : {}),
					},
				}
			: {}),
	};
	const providers = [...params.providers, nextProvider];
	const entries = [...params.entries, ...modelEntries];
	const currentDefault = params.defaultModel?.trim() ?? '';
	const preferredModelEntry =
		modelEntries.find((entry) => entry.requestName.trim() === defaults.modelId) ?? modelEntries[0];
	return {
		providers,
		entries,
		providerId,
		modelId: preferredModelEntry?.id ?? '',
		defaultModel: currentDefault || preferredModelEntry?.id || '',
		modelCount: modelEntries.length,
		...(params.login.accountId ? { accountId: params.login.accountId } : {}),
		...(params.login.planType ? { planType: params.login.planType } : {}),
		...(params.login.email ? { email: params.login.email } : {}),
		...(params.login.projectId ? { projectId: params.login.projectId } : {}),
	};
}

function dedupeDiscoveredOAuthModels(models: ProviderOAuthDiscoveredModel[]): ProviderOAuthDiscoveredModel[] {
	const seen = new Set<string>();
	const out: ProviderOAuthDiscoveredModel[] = [];
	for (const model of models) {
		const id = model.id?.trim();
		const key = id.toLowerCase();
		if (!id || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({ ...model, id });
	}
	return out;
}

function mergeEnabledIdsWithEntries(entries: UserModelEntry[], enabledIds: string[] | undefined): string[] {
	const entryIds = entries.map((entry) => entry.id);
	const valid = new Set(entryIds);
	const out: string[] = [];
	for (const id of enabledIds ?? []) {
		if (valid.has(id) && !out.includes(id)) {
			out.push(id);
		}
	}
	for (const id of entryIds) {
		if (!out.includes(id)) {
			out.push(id);
		}
	}
	return out;
}

async function handleProviderOAuthLoginPayload(rawPayload: unknown) {
	try {
		if (!rawPayload || typeof rawPayload !== 'object') {
			return {
				ok: false as const,
				message: 'Provider login requires a settings payload.',
			};
		}
		const payload = rawPayload as {
			provider?: unknown;
			providers?: unknown;
			entries?: unknown;
			defaultModel?: unknown;
			timeoutMs?: unknown;
		};
		const authProvider =
			payload.provider === 'claude' || payload.provider === 'antigravity' || payload.provider === 'codex'
				? payload.provider
				: undefined;
		if (!authProvider) {
			return {
				ok: false as const,
				message: 'Unknown OAuth provider.',
			};
		}
		const current = getSettings();
		const providers = Array.isArray(payload.providers)
			? (payload.providers as UserLlmProvider[])
			: (current.models?.providers ?? []);
		const entries = Array.isArray(payload.entries)
			? (payload.entries as UserModelEntry[])
			: (current.models?.entries ?? []);
		const defaultModel =
			typeof payload.defaultModel === 'string'
				? payload.defaultModel
				: (current.defaultModel ?? '');
		const login = await runProviderOAuthLogin({
			provider: authProvider,
			timeoutMs:
				typeof payload.timeoutMs === 'number' && Number.isFinite(payload.timeoutMs)
					? payload.timeoutMs
					: undefined,
		});
		const discoveredModels =
			authProvider === 'codex' || authProvider === 'claude' || authProvider === 'antigravity'
				? await discoverProviderOAuthModels(login).catch(() => [])
				: [];
		const next = appendOAuthLoginProvider({
			authProvider,
			providers,
			entries,
			defaultModel,
			login,
			discoveredModels,
		});
		patchSettings({
			defaultModel: next.defaultModel,
			models: {
				providers: next.providers,
				entries: next.entries,
				enabledIds: mergeEnabledIdsWithEntries(next.entries, current.models?.enabledIds),
			},
		});
		return { ok: true as const, providerLabel: providerOAuthLabel(authProvider), ...next };
	} catch (error) {
		return {
			ok: false as const,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * `settings:*`、`team:getBuiltinCatalog` IPC：读写 settings、内置 team 目录、
 * provider 模型发现、bot 连接测试、bot skill 文件夹导入。
 * 行为与原 register.ts 一致；颜色模式同步广播 `async-shell:themeMode`。
 */
export function registerSettingsHandlers(): void {
	ipcMain.handle('settings:get', () => getSettings());

	ipcMain.handle('settings:set', (_e, partial: Record<string, unknown>) => {
		const next = patchSettings(partial as Parameters<typeof patchSettings>[0]);
		void syncBotControllerFromSettings(next);
		const syncedColorMode = next.ui?.colorMode;
		if (syncedColorMode === 'light' || syncedColorMode === 'dark' || syncedColorMode === 'system') {
			for (const win of BrowserWindow.getAllWindows()) {
				if (!win.isDestroyed()) {
					win.webContents.send('async-shell:themeMode', { colorMode: syncedColorMode });
				}
			}
		}
		return next;
	});

	ipcMain.handle('team:getBuiltinCatalog', () => getBuiltinTeamCatalogPayload());

	ipcMain.handle('settings:discoverProviderModels', async (_e, rawProvider: unknown) => {
		const provider = rawProvider as Partial<UserLlmProvider> | null | undefined;
		if (
			!provider ||
			typeof provider !== 'object' ||
			typeof provider.id !== 'string' ||
			typeof provider.displayName !== 'string' ||
			typeof provider.paradigm !== 'string'
		) {
			return { ok: false as const, message: 'Invalid provider payload.' };
		}
		if (
			provider.oauthAuth?.provider === 'codex' ||
			provider.oauthAuth?.provider === 'claude' ||
			provider.oauthAuth?.provider === 'antigravity'
		) {
			try {
				const auth = await ensureFreshOAuthAuthForRequest(provider.id, provider.oauthAuth);
				const [models, usage] = await Promise.all([
					discoverProviderOAuthModels(auth),
					fetchProviderOAuthUsageSummary(auth).catch(() => auth.usage),
				]);
				const oauthAuth = usage ? { ...auth, usage } : auth;
				return {
					ok: true as const,
					models,
					oauthAuth,
				};
			} catch (error) {
				return {
					ok: false as const,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}
		return await discoverProviderModels({
			id: provider.id,
			displayName: provider.displayName,
			paradigm: provider.paradigm,
			apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : undefined,
			baseURL: typeof provider.baseURL === 'string' ? provider.baseURL : undefined,
			proxyUrl: typeof provider.proxyUrl === 'string' ? provider.proxyUrl : undefined,
			providerIdentity:
				provider.providerIdentity && typeof provider.providerIdentity === 'object'
					? provider.providerIdentity
					: undefined,
		});
	});

	ipcMain.handle('settings:runProviderOAuthLogin', async (_e, rawPayload: unknown) => {
		return await handleProviderOAuthLoginPayload(rawPayload);
	});

	ipcMain.handle('settings:runCodexLogin', async (_e, rawPayload: unknown) => {
		const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload as Record<string, unknown> : {};
		return await handleProviderOAuthLoginPayload({
			...payload,
			provider: 'codex',
		});
	});

	ipcMain.handle('settings:cancelCodexLogin', () => ({
		ok: cancelActiveProviderOAuthLogin(),
	}));

	ipcMain.handle('settings:cancelProviderOAuthLogin', () => ({
		ok: cancelActiveProviderOAuthLogin(),
	}));

	ipcMain.handle('settings:testBotConnection', async (_e, rawIntegration: unknown) => {
		const integration = rawIntegration as BotIntegrationConfig | null | undefined;
		if (!integration || typeof integration !== 'object' || typeof integration.id !== 'string' || typeof integration.platform !== 'string') {
			return { ok: false as const, message: 'Invalid bot integration payload.' };
		}
		const lang = getSettings().language === 'en' ? 'en' : 'zh-CN';
		return await testBotIntegrationConnection(integration, lang);
	});

	ipcMain.handle('feishu:runOauth', async (_e, payload: unknown) => {
		const integrationId =
			payload && typeof payload === 'object' && typeof (payload as { integrationId?: unknown }).integrationId === 'string'
				? (payload as { integrationId: string }).integrationId
				: '';
		if (!integrationId) {
			return { ok: false as const, error: 'no-integration' as const, message: 'integrationId is required.' };
		}
		const integration = (getSettings().bots?.integrations ?? []).find((i) => i.id === integrationId);
		if (!integration) {
			return { ok: false as const, error: 'no-integration' as const };
		}
		const result = await runFeishuOauth(integration);
		if (result.ok) {
			updateBotIntegrationFeishuTokens(integrationId, result.tokens);
			void syncBotControllerFromSettings(getSettings());
			return {
				ok: true as const,
				expiresAtMs: result.tokens.userAccessTokenExpiresAt,
				openId: result.tokens.userAuthorizedOpenId,
				name: result.tokens.userAuthorizedName,
			};
		}
		return { ok: false as const, error: result.error, message: result.message };
	});

	ipcMain.handle('feishu:cancelOauth', (_e, payload: unknown) => {
		const integrationId =
			payload && typeof payload === 'object' && typeof (payload as { integrationId?: unknown }).integrationId === 'string'
				? (payload as { integrationId: string }).integrationId
				: '';
		if (integrationId) {
			cancelFeishuOauth(integrationId);
		}
		return { ok: true as const };
	});

	ipcMain.handle('feishu:disconnect', (_e, payload: unknown) => {
		const integrationId =
			payload && typeof payload === 'object' && typeof (payload as { integrationId?: unknown }).integrationId === 'string'
				? (payload as { integrationId: string }).integrationId
				: '';
		if (!integrationId) {
			return { ok: false as const };
		}
		const updated = updateBotIntegrationFeishuTokens(integrationId, {
			userAccessToken: '',
			userRefreshToken: '',
			userAccessTokenExpiresAt: 0,
			userAuthorizedOpenId: '',
			userAuthorizedName: '',
		});
		if (updated) {
			void syncBotControllerFromSettings(getSettings());
		}
		return { ok: updated };
	});

	ipcMain.handle('feishu:getCallbackUrls', () => ({ urls: FEISHU_OAUTH_CALLBACK_URLS }));

	ipcMain.handle('settings:importBotSkillFolder', async (event) => {
		try {
			const win = BrowserWindow.fromWebContents(event.sender);
			const options = {
				properties: ['openDirectory'],
			} satisfies Electron.OpenDialogOptions;
			const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
			if (result.canceled || !result.filePaths[0]) {
				return { ok: false as const, canceled: true as const };
			}
			const folderPath = path.resolve(result.filePaths[0]);
			const skillFilePath = path.join(folderPath, 'SKILL.md');
			if (!fs.existsSync(skillFilePath) || !fs.statSync(skillFilePath).isFile()) {
				return {
					ok: false as const,
					error: 'missing-skill-md' as const,
					folderPath,
				};
			}
			const raw = fs.readFileSync(skillFilePath, 'utf8');
			const parsed = stripSkillFrontmatter(raw);
			const folderName = path.basename(folderPath);
			const name = (parsed.name || folderName).trim();
			const slug = sanitizeSkillSlug(parsed.name || folderName);
			const content = parsed.body.trim();
			if (!name || !slug || !content) {
				return {
					ok: false as const,
					error: 'invalid-skill' as const,
					folderPath,
				};
			}
			return {
				ok: true as const,
				skill: {
					name,
					description: (parsed.description || '').trim(),
					slug,
					content,
				},
				folderPath,
				skillFilePath,
			};
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}
