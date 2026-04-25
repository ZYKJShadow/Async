import type { AgentSkill } from './agentSettingsTypes';

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
		allowedReplyChatIds: [],
		allowedReplyUserIds: [],
		skills: [],
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
			streamingCard: true,
		},
	};
}
