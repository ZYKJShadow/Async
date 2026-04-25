import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	getSettings,
	patchSettings,
	type UserLlmProvider,
} from '../../settingsStore.js';
import { syncBotControllerFromSettings } from '../../bots/botController.js';
import { testBotIntegrationConnection } from '../../bots/botConnectivity.js';
import type { BotIntegrationConfig } from '../../botSettingsTypes.js';
import { discoverProviderModels } from '../../llm/providerModelDiscovery.js';
import { getBuiltinTeamCatalogPayload } from '../../agent/builtinTeamCatalog.js';

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
		return await discoverProviderModels({
			id: provider.id,
			displayName: provider.displayName,
			paradigm: provider.paradigm,
			apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : undefined,
			baseURL: typeof provider.baseURL === 'string' ? provider.baseURL : undefined,
			proxyUrl: typeof provider.proxyUrl === 'string' ? provider.proxyUrl : undefined,
		});
	});

	ipcMain.handle('settings:testBotConnection', async (_e, rawIntegration: unknown) => {
		const integration = rawIntegration as BotIntegrationConfig | null | undefined;
		if (!integration || typeof integration !== 'object' || typeof integration.id !== 'string' || typeof integration.platform !== 'string') {
			return { ok: false as const, message: 'Invalid bot integration payload.' };
		}
		const lang = getSettings().language === 'en' ? 'en' : 'zh-CN';
		return await testBotIntegrationConnection(integration, lang);
	});

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
