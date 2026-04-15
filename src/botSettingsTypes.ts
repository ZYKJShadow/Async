export type BotComposerMode = 'agent' | 'ask' | 'plan' | 'team';

export type BotPlatform = 'feishu' | 'telegram' | 'discord' | 'slack';

export type TelegramBotConfig = {
	botToken?: string;
	allowedChatIds?: string[];
	requireMentionInGroups?: boolean;
};

export type SlackBotConfig = {
	botToken?: string;
	appToken?: string;
	allowedChannelIds?: string[];
};

export type DiscordBotConfig = {
	botToken?: string;
	allowedChannelIds?: string[];
	requireMentionInGuilds?: boolean;
};

export type FeishuBotConfig = {
	appId?: string;
	appSecret?: string;
	encryptKey?: string;
	verificationToken?: string;
	allowedChatIds?: string[];
};

export type BotIntegrationConfig = {
	id: string;
	name: string;
	platform: BotPlatform;
	enabled?: boolean;
	defaultModelId?: string;
	defaultMode?: BotComposerMode;
	defaultWorkspaceRoot?: string;
	workspaceRoots?: string[];
	systemPrompt?: string;
	telegram?: TelegramBotConfig;
	slack?: SlackBotConfig;
	discord?: DiscordBotConfig;
	feishu?: FeishuBotConfig;
};

export function createEmptyBotIntegration(): BotIntegrationConfig {
	return {
		id:
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name: '',
		platform: 'telegram',
		enabled: false,
		defaultMode: 'agent',
		workspaceRoots: [],
		telegram: {
			requireMentionInGroups: true,
			allowedChatIds: [],
		},
		slack: {
			allowedChannelIds: [],
		},
		discord: {
			allowedChannelIds: [],
			requireMentionInGuilds: true,
		},
		feishu: {
			allowedChatIds: [],
		},
	};
}

