import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
	type AppColorMode,
	type ThemeTransitionOrigin,
	writeStoredColorMode,
} from '../colorMode';
import type { AppLocale } from '../i18n';
import type { AppAppearanceSettings } from '../appearanceSettings';
import type { ShellLayoutMode } from '../app/shellLayoutStorage';
import type {
	AgentCustomization,
	TeamSettings,
} from '../agentSettingsTypes';
import type { BotIntegrationConfig } from '../botSettingsTypes';
import type { EditorSettings } from '../EditorSettingsPanel';
import type { McpServerConfig } from '../mcpTypes';
import type {
	UserLlmProvider,
	UserModelEntry,
} from '../modelCatalog';
import type { ProviderIdentitySettings } from '../providerIdentitySettings';
import type { ThinkingLevel } from '../ipcTypes';

export type LayoutWindowAvailability = Record<ShellLayoutMode, boolean>;

export type UseSettingsPersistenceParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;

	// color mode + transition
	setTransitionOrigin: (origin?: ThemeTransitionOrigin) => void;
	setColorMode: Dispatch<SetStateAction<AppColorMode>>;

	// layout-window availability
	setLayoutWindowAvailability: Dispatch<SetStateAction<LayoutWindowAvailability>>;
	workspace: string | null;

	// settings page UI
	setSettingsPageOpen: Dispatch<SetStateAction<boolean>>;

	// settings persistence inputs
	locale: AppLocale;
	providerIdentity: ProviderIdentitySettings;
	defaultModel: string;
	modelProviders: UserLlmProvider[];
	modelEntries: UserModelEntry[];
	enabledModelIds: string[];
	thinkingByModelId: Record<string, ThinkingLevel>;
	agentCustomization: AgentCustomization;
	editorSettings: EditorSettings;
	teamSettings: TeamSettings;
	botIntegrations: BotIntegrationConfig[];
	setBotIntegrations: Dispatch<SetStateAction<BotIntegrationConfig[]>>;
	mcpServers: McpServerConfig[];
	colorMode: AppColorMode;
	appearanceSettings: AppAppearanceSettings;
	layoutMode: ShellLayoutMode;
	layoutPinnedBySurface: boolean;
};

export type UseSettingsPersistenceResult = {
	onPersistLanguage: (loc: AppLocale) => Promise<void>;
	onChangeColorMode: (next: AppColorMode, origin?: ThemeTransitionOrigin) => Promise<void>;
	refreshLayoutWindowAvailability: () => Promise<void>;
	persistSettings: () => Promise<void>;
	onChangeBotIntegrations: (next: BotIntegrationConfig[]) => void;
	closeSettingsPage: () => Promise<void>;
};

/**
 * 设置项的 IPC 持久化与窗口可用性探测。
 *
 * 行为与原 App.tsx 完全一致：
 *  - colorMode 写入同时写 localStorage、IPC 与 transition origin（用户驱动 vs 系统驱动）；
 *  - persistSettings 把所有 settings slice 一次性写入 main 进程；
 *  - layout window availability 在 mount / workspace 变化 / window focus / visibilitychange 时刷新；
 *  - closeSettingsPage 先 persist 再关闭面板（finally 保证关）。
 */
export function useSettingsPersistence(
	params: UseSettingsPersistenceParams
): UseSettingsPersistenceResult {
	const {
		shell,
		setTransitionOrigin,
		setColorMode,
		setLayoutWindowAvailability,
		workspace,
		setSettingsPageOpen,
		locale,
		providerIdentity,
		defaultModel,
		modelProviders,
		modelEntries,
		enabledModelIds,
		thinkingByModelId,
		agentCustomization,
		editorSettings,
		teamSettings,
		botIntegrations,
		setBotIntegrations,
		mcpServers,
		colorMode,
		appearanceSettings,
		layoutMode,
		layoutPinnedBySurface,
	} = params;

	const onPersistLanguage = useCallback(
		async (loc: AppLocale) => {
			if (!shell) {
				return;
			}
			await shell.invoke('settings:set', { language: loc });
		},
		[shell]
	);

	const onChangeColorMode = useCallback(
		async (next: AppColorMode, origin?: ThemeTransitionOrigin) => {
			setTransitionOrigin(origin);
			setColorMode(next);
			writeStoredColorMode(next);
			if (shell) {
				try {
					await shell.invoke('settings:set', { ui: { colorMode: next } });
				} catch (e) {
					console.error('Failed to persist color mode:', e);
				}
			}
		},
		[shell, setTransitionOrigin, setColorMode]
	);

	const refreshLayoutWindowAvailability = useCallback(async () => {
		if (!shell) {
			setLayoutWindowAvailability({ agent: false, editor: false });
			return;
		}
		try {
			const [agentResult, editorResult] = await Promise.all([
				shell.invoke('app:windowSurfaceStatus', 'agent'),
				shell.invoke('app:windowSurfaceStatus', 'editor'),
			]);
			const parseExists = (value: unknown) => {
				if (!value || typeof value !== 'object') {
					return false;
				}
				const result = value as { ok?: boolean; exists?: boolean };
				return !!(result.ok && result.exists);
			};
			setLayoutWindowAvailability({
				agent: parseExists(agentResult),
				editor: parseExists(editorResult),
			});
		} catch {
			setLayoutWindowAvailability({ agent: false, editor: false });
		}
	}, [shell, setLayoutWindowAvailability]);

	useEffect(() => {
		void refreshLayoutWindowAvailability();
	}, [refreshLayoutWindowAvailability, workspace]);

	useEffect(() => {
		const handleFocus = () => {
			void refreshLayoutWindowAvailability();
		};
		const handleVisibilityChange = () => {
			if (!document.hidden) {
				void refreshLayoutWindowAvailability();
			}
		};
		window.addEventListener('focus', handleFocus);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			window.removeEventListener('focus', handleFocus);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [refreshLayoutWindowAvailability]);

	const persistSettings = useCallback(async () => {
		if (!shell) {
			return;
		}
		await shell.invoke('settings:set', {
			language: locale,
			openAI: { apiKey: undefined, baseURL: undefined, proxyUrl: undefined },
			anthropic: { apiKey: undefined, baseURL: undefined },
			gemini: { apiKey: undefined },
			providerIdentity,
			defaultModel,
			models: {
				providers: modelProviders,
				entries: modelEntries,
				enabledIds: enabledModelIds,
				thinkingByModelId,
			},
			agent: {
				importThirdPartyConfigs: true,
				rules: agentCustomization.rules ?? [],
				skills: agentCustomization.skills ?? [],
				subagents: agentCustomization.subagents ?? [],
				commands: agentCustomization.commands ?? [],
				shellPermissionMode: agentCustomization.shellPermissionMode,
				confirmShellCommands: agentCustomization.confirmShellCommands,
				skipSafeShellCommandsConfirm: agentCustomization.skipSafeShellCommandsConfirm,
				confirmWritesBeforeExecute: agentCustomization.confirmWritesBeforeExecute,
				maxConsecutiveMistakes: agentCustomization.maxConsecutiveMistakes,
				mistakeLimitEnabled: agentCustomization.mistakeLimitEnabled,
				backgroundForkAgent: agentCustomization.backgroundForkAgent,
				toolPermissionRules: agentCustomization.toolPermissionRules ?? [],
				shouldAvoidPermissionPrompts: agentCustomization.shouldAvoidPermissionPrompts,
				memoryExtraction: agentCustomization.memoryExtraction,
			},
			editor: editorSettings,
			team: teamSettings,
			bots: { integrations: botIntegrations },
			mcp: { servers: mcpServers },
			ui: {
				colorMode,
				fontPreset: appearanceSettings.uiFontPreset,
				uiFontPreset: appearanceSettings.uiFontPreset,
				codeFontPreset: appearanceSettings.codeFontPreset,
				themePresetId: appearanceSettings.themePresetId,
				accentColor: appearanceSettings.accentColor,
				backgroundColor: appearanceSettings.backgroundColor,
				foregroundColor: appearanceSettings.foregroundColor,
				translucentSidebar: appearanceSettings.translucentSidebar,
				contrast: appearanceSettings.contrast,
				usePointerCursors: appearanceSettings.usePointerCursors,
				uiFontSize: appearanceSettings.uiFontSize,
				codeFontSize: appearanceSettings.codeFontSize,
				...(layoutPinnedBySurface ? {} : { layoutMode }),
			},
		});
	}, [
		shell,
		modelProviders,
		defaultModel,
		modelEntries,
		enabledModelIds,
		thinkingByModelId,
		providerIdentity,
		agentCustomization,
		editorSettings,
		locale,
		mcpServers,
		teamSettings,
		botIntegrations,
		colorMode,
		appearanceSettings,
		layoutMode,
		layoutPinnedBySurface,
	]);

	const onChangeBotIntegrations = useCallback(
		(next: BotIntegrationConfig[]) => {
			setBotIntegrations(next);
			if (!shell) {
				return;
			}
			void shell.invoke('settings:set', {
				bots: { integrations: next },
			});
		},
		[shell, setBotIntegrations]
	);

	/** 离开设置页时写入磁盘（返回、点遮罩、Esc 等） */
	const closeSettingsPage = useCallback(async () => {
		try {
			await persistSettings();
		} catch (e) {
			console.error('Failed to persist settings:', e);
		} finally {
			setSettingsPageOpen(false);
		}
	}, [persistSettings, setSettingsPageOpen]);

	return {
		onPersistLanguage,
		onChangeColorMode,
		refreshLayoutWindowAvailability,
		persistSettings,
		onChangeBotIntegrations,
		closeSettingsPage,
	};
}
