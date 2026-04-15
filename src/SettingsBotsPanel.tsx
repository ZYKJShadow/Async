import { useMemo } from 'react';
import { createEmptyBotIntegration, type BotComposerMode, type BotIntegrationConfig, type BotPlatform } from './botSettingsTypes';
import type { UserModelEntry } from './modelCatalog';
import { useI18n } from './i18n';
import { VoidSelect } from './VoidSelect';

type Props = {
	value: BotIntegrationConfig[];
	onChange: (next: BotIntegrationConfig[]) => void;
	modelEntries: UserModelEntry[];
};

const PLATFORM_OPTIONS: Array<{ value: BotPlatform; labelZh: string; labelEn: string }> = [
	{ value: 'telegram', labelZh: 'Telegram', labelEn: 'Telegram' },
	{ value: 'slack', labelZh: 'Slack', labelEn: 'Slack' },
	{ value: 'discord', labelZh: 'Discord', labelEn: 'Discord' },
	{ value: 'feishu', labelZh: '飞书', labelEn: 'Feishu' },
];

const MODE_OPTIONS: BotComposerMode[] = ['agent', 'ask', 'plan', 'team'];

function linesFromText(raw: string): string[] {
	return raw
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function textFromLines(lines: string[] | undefined): string {
	return (lines ?? []).join('\n');
}

function ensurePlatformShape(item: BotIntegrationConfig, platform: BotPlatform): BotIntegrationConfig {
	const next: BotIntegrationConfig = {
		...item,
		platform,
		telegram: item.telegram ?? { requireMentionInGroups: true, allowedChatIds: [] },
		slack: item.slack ?? { allowedChannelIds: [] },
		discord: item.discord ?? { allowedChannelIds: [], requireMentionInGuilds: true },
		feishu: item.feishu ?? { allowedChatIds: [] },
	};
	if (platform === 'telegram' && next.telegram?.requireMentionInGroups === undefined) {
		next.telegram = { ...(next.telegram ?? {}), requireMentionInGroups: true };
	}
	if (platform === 'discord' && next.discord?.requireMentionInGuilds === undefined) {
		next.discord = { ...(next.discord ?? {}), requireMentionInGuilds: true };
	}
	return next;
}

export function SettingsBotsPanel({ value, onChange, modelEntries }: Props) {
	const { locale } = useI18n();
	const zh = locale !== 'en';
	const modelOptions = useMemo(
		() =>
			[{ value: '', label: zh ? '未设置' : 'Not set' }].concat(
				modelEntries.map((item) => ({
					value: item.id,
					label: item.displayName.trim() || item.requestName || item.id,
				}))
			),
		[modelEntries, zh]
	);

	const updateOne = (id: string, patch: Partial<BotIntegrationConfig>) => {
		onChange(value.map((item) => (item.id === id ? { ...item, ...patch } : item)));
	};

	const removeOne = (id: string) => {
		onChange(value.filter((item) => item.id !== id));
	};

	return (
		<div className="ref-settings-panel">
			<p className="ref-settings-lead">
				{zh
					? '为飞书、Telegram、Discord、Slack 配置外部机器人入口。机器人会先通过会话控制工具切换工作区/模型/模式，再调用 Async 内部执行链路完成任务。'
					: 'Configure external bot entries for Feishu, Telegram, Discord, and Slack. Bots first switch workspace/model/mode through session tools, then call Async to execute the real task.'}
			</p>
			<p className="ref-settings-proxy-hint">
				{zh
					? '当前版本的 bot 会话控制要求模型支持工具调用，因此这里建议使用 OpenAI 兼容或 Anthropic 模型。'
					: 'The current bot bridge requires a tool-capable model, so OpenAI-compatible and Anthropic models are recommended here.'}
			</p>
			<div style={{ display: 'grid', gap: 16 }}>
				{value.map((item, index) => {
					const current = ensurePlatformShape(item, item.platform);
					const platformLabel =
						PLATFORM_OPTIONS.find((option) => option.value === current.platform)?.[zh ? 'labelZh' : 'labelEn'] ??
						current.platform;
					return (
						<section
							key={current.id}
							style={{
								border: '1px solid var(--vscode-input-border)',
								borderRadius: 16,
								padding: 16,
								display: 'grid',
								gap: 14,
								background: 'var(--vscode-editorWidget-background)',
							}}
						>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
								<div>
									<div style={{ fontSize: 12, opacity: 0.7 }}>
										{zh ? `机器人 #${index + 1}` : `Bot #${index + 1}`}
									</div>
									<strong>{current.name.trim() || `${platformLabel} bot`}</strong>
								</div>
								<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
									<label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
										<input
											type="checkbox"
											checked={current.enabled !== false}
											onChange={(event) => updateOne(current.id, { enabled: event.target.checked })}
										/>
										<span>{zh ? '启用' : 'Enabled'}</span>
									</label>
									<button type="button" className="ref-settings-add-model" onClick={() => removeOne(current.id)}>
										{zh ? '删除' : 'Remove'}
									</button>
								</div>
							</div>

							<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
								<label className="ref-settings-field">
									<span>{zh ? '显示名称' : 'Display name'}</span>
									<input
										type="text"
										value={current.name}
										onChange={(event) => updateOne(current.id, { name: event.target.value })}
										placeholder={zh ? '例如：研发群机器人' : 'Example: Engineering Bot'}
									/>
								</label>
								<label className="ref-settings-field">
									<span>{zh ? '平台' : 'Platform'}</span>
									<VoidSelect
										value={current.platform}
										onChange={(next) =>
											updateOne(current.id, ensurePlatformShape(current, next as BotPlatform))
										}
										options={PLATFORM_OPTIONS.map((option) => ({
											value: option.value,
											label: zh ? option.labelZh : option.labelEn,
										}))}
										ariaLabel={zh ? '机器人平台' : 'Bot platform'}
									/>
								</label>
								<label className="ref-settings-field">
									<span>{zh ? '默认模型' : 'Default model'}</span>
									<VoidSelect
										value={current.defaultModelId ?? ''}
										onChange={(next) => updateOne(current.id, { defaultModelId: String(next ?? '') })}
										options={modelOptions}
										ariaLabel={zh ? '默认模型' : 'Default model'}
									/>
								</label>
								<label className="ref-settings-field">
									<span>{zh ? '默认模式' : 'Default mode'}</span>
									<VoidSelect
										value={current.defaultMode ?? 'agent'}
										onChange={(next) => updateOne(current.id, { defaultMode: next as BotComposerMode })}
										options={MODE_OPTIONS.map((mode) => ({ value: mode, label: mode }))}
										ariaLabel={zh ? '默认模式' : 'Default mode'}
									/>
								</label>
							</div>

							<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
								<label className="ref-settings-field">
									<span>{zh ? '默认工作区' : 'Default workspace'}</span>
									<input
										type="text"
										value={current.defaultWorkspaceRoot ?? ''}
										onChange={(event) => updateOne(current.id, { defaultWorkspaceRoot: event.target.value })}
										placeholder={zh ? '绝对路径，例如 D:\\Projects\\Repo' : 'Absolute path, e.g. D:\\Projects\\Repo'}
									/>
								</label>
								<label className="ref-settings-field">
									<span>{zh ? '附加可访问工作区（每行一个）' : 'Additional workspace roots (one per line)'}</span>
									<textarea
										value={textFromLines(current.workspaceRoots)}
										onChange={(event) => updateOne(current.id, { workspaceRoots: linesFromText(event.target.value) })}
										placeholder={zh ? '留空时仍会自动合并最近打开过的工作区' : 'Recent workspaces are still added automatically when this is empty'}
									/>
								</label>
							</div>

							<label className="ref-settings-field">
								<span>{zh ? '额外系统提示（可选）' : 'Extra system prompt (optional)'}</span>
								<textarea
									value={current.systemPrompt ?? ''}
									onChange={(event) => updateOne(current.id, { systemPrompt: event.target.value })}
									placeholder={zh ? '补充机器人身份、回复风格、禁用项等要求' : 'Add persona, response style, or operating rules for this bot'}
								/>
							</label>

							{current.platform === 'telegram' ? (
								<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
									<label className="ref-settings-field">
										<span>Bot Token</span>
										<input
											type="password"
											value={current.telegram?.botToken ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													telegram: { ...(current.telegram ?? {}), botToken: event.target.value },
												})
											}
											placeholder="123456:ABC..."
										/>
									</label>
									<label className="ref-settings-field">
										<span>{zh ? '允许的 Chat ID（每行一个）' : 'Allowed chat IDs (one per line)'}</span>
										<textarea
											value={textFromLines(current.telegram?.allowedChatIds)}
											onChange={(event) =>
												updateOne(current.id, {
													telegram: { ...(current.telegram ?? {}), allowedChatIds: linesFromText(event.target.value) },
												})
											}
										/>
									</label>
									<label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
										<input
											type="checkbox"
											checked={current.telegram?.requireMentionInGroups !== false}
											onChange={(event) =>
												updateOne(current.id, {
													telegram: { ...(current.telegram ?? {}), requireMentionInGroups: event.target.checked },
												})
											}
										/>
										<span>{zh ? '群聊中必须显式 @ 机器人' : 'Require @mention in group chats'}</span>
									</label>
								</div>
							) : null}

							{current.platform === 'slack' ? (
								<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
									<label className="ref-settings-field">
										<span>Bot Token</span>
										<input
											type="password"
											value={current.slack?.botToken ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													slack: { ...(current.slack ?? {}), botToken: event.target.value },
												})
											}
											placeholder="xoxb-..."
										/>
									</label>
									<label className="ref-settings-field">
										<span>App Token</span>
										<input
											type="password"
											value={current.slack?.appToken ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													slack: { ...(current.slack ?? {}), appToken: event.target.value },
												})
											}
											placeholder="xapp-..."
										/>
									</label>
									<label className="ref-settings-field">
										<span>{zh ? '允许的 Channel ID（每行一个）' : 'Allowed channel IDs (one per line)'}</span>
										<textarea
											value={textFromLines(current.slack?.allowedChannelIds)}
											onChange={(event) =>
												updateOne(current.id, {
													slack: { ...(current.slack ?? {}), allowedChannelIds: linesFromText(event.target.value) },
												})
											}
										/>
									</label>
								</div>
							) : null}

							{current.platform === 'discord' ? (
								<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
									<label className="ref-settings-field">
										<span>Bot Token</span>
										<input
											type="password"
											value={current.discord?.botToken ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													discord: { ...(current.discord ?? {}), botToken: event.target.value },
												})
											}
											placeholder="Bot token"
										/>
									</label>
									<label className="ref-settings-field">
										<span>{zh ? '允许的 Channel ID（每行一个）' : 'Allowed channel IDs (one per line)'}</span>
										<textarea
											value={textFromLines(current.discord?.allowedChannelIds)}
											onChange={(event) =>
												updateOne(current.id, {
													discord: { ...(current.discord ?? {}), allowedChannelIds: linesFromText(event.target.value) },
												})
											}
										/>
									</label>
									<label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
										<input
											type="checkbox"
											checked={current.discord?.requireMentionInGuilds !== false}
											onChange={(event) =>
												updateOne(current.id, {
													discord: { ...(current.discord ?? {}), requireMentionInGuilds: event.target.checked },
												})
											}
										/>
										<span>{zh ? '服务器频道中必须显式提及机器人' : 'Require mention in guild channels'}</span>
									</label>
								</div>
							) : null}

							{current.platform === 'feishu' ? (
								<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
									<label className="ref-settings-field">
										<span>App ID</span>
										<input
											type="text"
											value={current.feishu?.appId ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													feishu: { ...(current.feishu ?? {}), appId: event.target.value },
												})
											}
										/>
									</label>
									<label className="ref-settings-field">
										<span>App Secret</span>
										<input
											type="password"
											value={current.feishu?.appSecret ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													feishu: { ...(current.feishu ?? {}), appSecret: event.target.value },
												})
											}
										/>
									</label>
									<label className="ref-settings-field">
										<span>{zh ? 'Encrypt Key（可选）' : 'Encrypt key (optional)'}</span>
										<input
											type="password"
											value={current.feishu?.encryptKey ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													feishu: { ...(current.feishu ?? {}), encryptKey: event.target.value },
												})
											}
										/>
									</label>
									<label className="ref-settings-field">
										<span>{zh ? 'Verification Token（可选）' : 'Verification token (optional)'}</span>
										<input
											type="password"
											value={current.feishu?.verificationToken ?? ''}
											onChange={(event) =>
												updateOne(current.id, {
													feishu: { ...(current.feishu ?? {}), verificationToken: event.target.value },
												})
											}
										/>
									</label>
									<label className="ref-settings-field">
										<span>{zh ? '允许的 Chat ID（每行一个）' : 'Allowed chat IDs (one per line)'}</span>
										<textarea
											value={textFromLines(current.feishu?.allowedChatIds)}
											onChange={(event) =>
												updateOne(current.id, {
													feishu: { ...(current.feishu ?? {}), allowedChatIds: linesFromText(event.target.value) },
												})
											}
										/>
									</label>
								</div>
							) : null}
						</section>
					);
				})}
			</div>

			<div style={{ marginTop: 16 }}>
				<button
					type="button"
					className="ref-settings-add-model"
					onClick={() => onChange([...value, createEmptyBotIntegration()])}
				>
					{zh ? '新增机器人接入' : 'Add bot integration'}
				</button>
			</div>
		</div>
	);
}

