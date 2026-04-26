import type { AgentSkill } from './agentSettingsTypes.js';

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
	/**
	 * Optional manually-pasted user_access_token. Required for the task and
	 * member tools (`feishu_*_task`, `get_feishu_users`) — tenant_access_token
	 * cannot read "我负责的" tasks or search the contact directory.
	 */
	userAccessToken?: string;
	/** Refresh token paired with userAccessToken. Used for silent re-issuance. */
	userRefreshToken?: string;
	/** Epoch ms when userAccessToken expires. Refresh kicks in 60s before this. */
	userAccessTokenExpiresAt?: number;
	/** Optional open_id of the authorized user, for display only. */
	userAuthorizedOpenId?: string;
	/** Optional display name of the authorized user, for display only. */
	userAuthorizedName?: string;
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
	skills?: AgentSkill[];
	permissionPolicy?: BotPermissionPolicy;
	telegram?: TelegramBotConfig;
	slack?: SlackBotConfig;
	discord?: DiscordBotConfig;
	feishu?: FeishuBotConfig;
};
