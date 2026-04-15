export type BotComposerMode = 'agent' | 'ask' | 'plan' | 'team';

export type BotPlatform = 'feishu' | 'telegram' | 'discord' | 'slack';

export type TelegramBotConfig = {
	botToken?: string;
	proxyUrl?: string;
	allowedChatIds?: string[];
	requireMentionInGroups?: boolean;
};

export type SlackBotConfig = {
	botToken?: string;
	appToken?: string;
	proxyUrl?: string;
	allowedChannelIds?: string[];
};

export type DiscordBotConfig = {
	botToken?: string;
	proxyUrl?: string;
	allowedChannelIds?: string[];
	requireMentionInGuilds?: boolean;
};

export type FeishuBotConfig = {
	appId?: string;
	appSecret?: string;
	encryptKey?: string;
	verificationToken?: string;
	proxyUrl?: string;
	allowedChatIds?: string[];
	streamingCard?: boolean;
};

export type BotPermissionPolicy = 'strict' | 'readonly_auto' | 'permissive';

export type BotIntegrationConfig = {
	id: string;
	name: string;
	platform: BotPlatform;
	enabled?: boolean;
	defaultModelId?: string;
	defaultMode?: BotComposerMode;
	defaultWorkspaceRoot?: string;
	workspaceRoots?: string[];
	allowedReplyChatIds?: string[];
	allowedReplyUserIds?: string[];
	systemPrompt?: string;
	permissionPolicy?: BotPermissionPolicy;
	telegram?: TelegramBotConfig;
	slack?: SlackBotConfig;
	discord?: DiscordBotConfig;
	feishu?: FeishuBotConfig;
};
