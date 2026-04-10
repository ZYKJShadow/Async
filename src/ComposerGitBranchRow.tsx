import { forwardRef, useCallback } from 'react';
import { AgentCommandPermissionDropdown, type CommandPermissionMode } from './AgentCommandPermissionDropdown';
import { getShellPermissionMode, shellPermissionModeToAgentPatch } from './shellPermissionMode';
import {
	useAppShellChrome,
	useAppShellGitActions,
	useAppShellGitMeta,
	useAppShellSettings,
} from './app/appShellContexts';
import {
	classifyGitUnavailableReason,
	gitBranchTriggerTitle,
	type GitUnavailableReason,
} from './gitAvailability';
import { ComposerContextMeter } from './ComposerContextMeter';
import { IconChevron, IconGitSCM } from './icons';

export type ComposerContextMeterState = {
	maxTokens: number;
	usedEstimate: number;
	/** 未在设置中填写上下文窗口，UI 使用默认 200K */
	isDefaultMax: boolean;
};

export type ComposerGitBranchRowProps = {
	/** 打开分支菜单前关闭 + / 模型浮层（与原先 App 内联行为一致） */
	onBeforeToggleGitBranchPicker?: () => void;
	/** 当前模型在设置中填写了上下文窗口时由 ChatComposer 传入 */
	contextMeter?: ComposerContextMeterState | null;
};

/**
 * 输入区 Git 分支行：订阅 Git Meta / Settings，不经过 App 的 sharedComposerProps，
 * 避免 fullStatus 等更新时整份 composer props 引用失效。
 */
export const ComposerGitBranchRow = forwardRef<HTMLButtonElement, ComposerGitBranchRowProps>(
	function ComposerGitBranchRow({ onBeforeToggleGitBranchPicker, contextMeter }, ref) {
		const { shell, t } = useAppShellChrome();
		const { gitBranch, gitLines, gitStatusOk, gitBranchPickerOpen } = useAppShellGitMeta();
		const { setGitBranchPickerOpen } = useAppShellGitActions();
		const { agentCustomization, setAgentCustomization } = useAppShellSettings();

		const gitUnavailableReason: GitUnavailableReason = gitStatusOk
			? 'none'
			: classifyGitUnavailableReason(gitLines[0]);
		const commandPermissionMode: CommandPermissionMode = getShellPermissionMode(agentCustomization);

		const onChangeCommandPermissionMode = useCallback(
			async (mode: CommandPermissionMode) => {
				const patch = shellPermissionModeToAgentPatch(mode);
				setAgentCustomization((prev) => ({ ...prev, ...patch }));
				if (!shell) {
					return;
				}
				await shell.invoke('settings:set', { agent: patch });
			},
			[shell, setAgentCustomization]
		);

		return (
			<div className="ref-composer-git-branch-row">
				<span title={t('agent.commandPermission.settingsHint')}>
					<AgentCommandPermissionDropdown
						value={commandPermissionMode}
						onChange={(mode) => void onChangeCommandPermissionMode(mode)}
						alwaysLabel={t('agent.commandPermission.always')}
						rulesLabel={t('agent.commandPermission.rules')}
						askEveryTimeLabel={t('agent.commandPermission.askEvery')}
						ariaLabel={t('agent.commandPermission.aria')}
						disabled={!shell}
					/>
				</span>
				<div className="ref-composer-git-branch-trailing">
					{contextMeter ? (
						<ComposerContextMeter
							maxTokens={contextMeter.maxTokens}
							usedEstimate={contextMeter.usedEstimate}
							isDefaultMax={contextMeter.isDefaultMax}
							t={t}
						/>
					) : null}
					<button
						ref={ref}
						type="button"
						className="ref-composer-git-branch-trigger"
						title={gitBranchTriggerTitle(t, gitStatusOk, gitUnavailableReason)}
						aria-label={`${t('app.tabGit')}: ${gitBranch}`}
						aria-expanded={gitBranchPickerOpen}
						aria-haspopup="dialog"
						disabled={!gitStatusOk}
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onBeforeToggleGitBranchPicker?.();
							if (!gitStatusOk) {
								return;
							}
							setGitBranchPickerOpen((o) => !o);
						}}
					>
						<IconGitSCM className="ref-composer-git-branch-ico" aria-hidden />
						<span className="ref-composer-git-branch-name">{gitBranch}</span>
						<IconChevron className="ref-composer-git-branch-chev" aria-hidden />
					</button>
				</div>
			</div>
		);
	}
);
