import {
	createContext,
	useContext,
	useMemo,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
} from 'react';
import type { useSettings } from '../hooks/useSettings';
import type { useWorkspaceManager } from '../hooks/useWorkspaceManager';
import { useGitIntegration } from '../hooks/useGitIntegration';
import type { AppAppearanceSettings } from '../appearanceSettings';
import type { AppColorMode, ThemeTransitionOrigin } from '../colorMode';
import type { AppLocale, TFunction } from '../i18n';
import type { ShellLayoutMode } from './shellLayoutStorage';

type SettingsHook = ReturnType<typeof useSettings>;

/** 主题 / i18n / shell 与索引等（与 Git / 工作区 / 模型设置解耦，便于子树按需订阅） */
export type AppShellChromeValue = {
	shell: Window['asyncShell'];
	t: TFunction;
	setLocale: (locale: AppLocale) => void;
	locale: AppLocale;
	ipcOk: string;
	setIpcOk: Dispatch<SetStateAction<string>>;
	layoutPinnedBySurface: boolean;
	appSurface: ShellLayoutMode | undefined;
	shellLayoutStorageKey: string;
	sidebarLayoutStorageKey: string;
	colorMode: AppColorMode;
	setColorMode: Dispatch<SetStateAction<AppColorMode>>;
	appearanceSettings: AppAppearanceSettings;
	setAppearanceSettings: Dispatch<SetStateAction<AppAppearanceSettings>>;
	effectiveScheme: 'light' | 'dark';
	setTransitionOrigin: (origin?: ThemeTransitionOrigin) => void;
	monacoChromeTheme: 'void-light' | 'void-dark';
};

export type AppShellWorkspaceValue = ReturnType<typeof useWorkspaceManager>;

export type AppShellGitValue = ReturnType<typeof useGitIntegration>;

/** 回调与 setter：引用在 fullStatus 前后保持稳定，仅订阅此层的组件不会在 Git 大对象更新时重渲 */
export type AppShellGitActionsValue = Pick<
	AppShellGitValue,
	'refreshGit' | 'onGitBranchListFresh' | 'setGitActionError' | 'setGitBranchPickerOpen'
>;

/** 分支/列表/可用性等中等体积状态 */
export type AppShellGitMetaValue = Pick<
	AppShellGitValue,
	| 'gitBranch'
	| 'gitLines'
	| 'gitStatusOk'
	| 'gitBranchList'
	| 'gitBranchListCurrent'
	| 'diffLoading'
	| 'gitActionError'
	| 'treeEpoch'
	| 'gitBranchPickerOpen'
>;

/** 工作区路径状态与 diff 预览等大对象 */
export type AppShellGitFilesValue = Pick<
	AppShellGitValue,
	'gitPathStatus' | 'gitChangedPaths' | 'diffPreviews' | 'diffTotals' | 'loadGitDiffPreviews'
>;

export type AppShellSettingsValue = Pick<
	SettingsHook,
	| 'modelProviders'
	| 'defaultModel'
	| 'modelEntries'
	| 'enabledModelIds'
	| 'thinkingByModelId'
	| 'setThinkingByModelId'
	| 'providerIdentity'
	| 'setProviderIdentity'
	| 'hasSelectedModel'
	| 'modelPickerItems'
	| 'modelPillLabel'
	| 'agentCustomization'
	| 'setAgentCustomization'
	| 'refreshWorkspaceDiskSkills'
	| 'mergedAgentCustomization'
	| 'onChangeMergedAgentCustomization'
	| 'editorSettings'
	| 'setEditorSettings'
	| 'mcpServers'
	| 'setMcpServers'
	| 'mcpStatuses'
	| 'setMcpStatuses'
	| 'settingsPageOpen'
	| 'setSettingsPageOpen'
	| 'settingsInitialNav'
	| 'settingsOpenPending'
	| 'onPickDefaultModel'
	| 'onChangeModelEntries'
	| 'onChangeModelProviders'
	| 'onRefreshMcpStatuses'
	| 'onStartMcpServer'
	| 'onStopMcpServer'
	| 'onRestartMcpServer'
	| 'applyLoadedSettings'
	| 'teamSettings'
	| 'setTeamSettings'
	| 'botIntegrations'
	| 'setBotIntegrations'
> & { openSettingsPageBase: SettingsHook['openSettingsPage'] };

export type AppShellFoundationMerged = AppShellChromeValue &
	AppShellWorkspaceValue &
	AppShellGitValue &
	AppShellSettingsValue;

const AppShellChromeContext = createContext<AppShellChromeValue | null>(null);
const AppShellWorkspaceContext = createContext<AppShellWorkspaceValue | null>(null);
const AppShellGitActionsContext = createContext<AppShellGitActionsValue | null>(null);
const AppShellGitMetaContext = createContext<AppShellGitMetaValue | null>(null);
const AppShellGitFilesContext = createContext<AppShellGitFilesValue | null>(null);
const AppShellSettingsContext = createContext<AppShellSettingsValue | null>(null);

export function useAppShellChrome(): AppShellChromeValue {
	const v = useContext(AppShellChromeContext);
	if (!v) {
		throw new Error('useAppShellChrome: missing provider');
	}
	return v;
}

export function useAppShellWorkspace(): AppShellWorkspaceValue {
	const v = useContext(AppShellWorkspaceContext);
	if (!v) {
		throw new Error('useAppShellWorkspace: missing provider');
	}
	return v;
}

export function useAppShellGitActions(): AppShellGitActionsValue {
	const v = useContext(AppShellGitActionsContext);
	if (!v) {
		throw new Error('useAppShellGitActions: missing provider');
	}
	return v;
}

export function useAppShellGitMeta(): AppShellGitMetaValue {
	const v = useContext(AppShellGitMetaContext);
	if (!v) {
		throw new Error('useAppShellGitMeta: missing provider');
	}
	return v;
}

export function useAppShellGitFiles(): AppShellGitFilesValue {
	const v = useContext(AppShellGitFilesContext);
	if (!v) {
		throw new Error('useAppShellGitFiles: missing provider');
	}
	return v;
}

/** 合并订阅；仅适合仍需全量 Git 的叶组件，避免在根工作区组件上使用。 */
export function useAppShellGit(): AppShellGitValue {
	const actions = useAppShellGitActions();
	const meta = useAppShellGitMeta();
	const files = useAppShellGitFiles();
	return useMemo(
		(): AppShellGitValue => ({
			...actions,
			...meta,
			...files,
		}),
		[actions, meta, files]
	);
}

export function useAppShellSettings(): AppShellSettingsValue {
	const v = useContext(AppShellSettingsContext);
	if (!v) {
		throw new Error('useAppShellSettings: missing provider');
	}
	return v;
}

/**
 * Git 状态挂在 Workspace 之下，避免 fullStatus 等更新时整棵根 App 重跑。
 * 拆成 Actions / Meta / Files 三层：Actions 的 Context value 在 fullStatus 前后保持同一引用，仅订阅 Actions 的子树可跳过 reconcile。
 */
function AppShellGitContextBridge(props: { settings: AppShellSettingsValue; children: ReactNode }) {
	const { settings, children } = props;
	const { shell } = useAppShellChrome();
	const { workspace } = useAppShellWorkspace();
	const {
		gitBranch,
		gitLines,
		gitPathStatus,
		gitChangedPaths,
		gitStatusOk,
		gitBranchList,
		gitBranchListCurrent,
		diffPreviews,
		diffLoading,
		gitActionError,
		setGitActionError,
		treeEpoch,
		gitBranchPickerOpen,
		setGitBranchPickerOpen,
		diffTotals,
		refreshGit,
		loadGitDiffPreviews,
		onGitBranchListFresh,
	} = useGitIntegration(shell, workspace);

	const gitActionsValue = useMemo(
		(): AppShellGitActionsValue => ({
			refreshGit,
			onGitBranchListFresh,
			setGitActionError,
			setGitBranchPickerOpen,
		}),
		[refreshGit, onGitBranchListFresh, setGitActionError, setGitBranchPickerOpen]
	);

	const gitMetaValue = useMemo(
		(): AppShellGitMetaValue => ({
			gitBranch,
			gitLines,
			gitStatusOk,
			gitBranchList,
			gitBranchListCurrent,
			diffLoading,
			gitActionError,
			treeEpoch,
			gitBranchPickerOpen,
		}),
		[
			gitBranch,
			gitLines,
			gitStatusOk,
			gitBranchList,
			gitBranchListCurrent,
			diffLoading,
			gitActionError,
			treeEpoch,
			gitBranchPickerOpen,
		]
	);

	const gitFilesValue = useMemo(
		(): AppShellGitFilesValue => ({
			gitPathStatus,
			gitChangedPaths,
			diffPreviews,
			diffTotals,
			loadGitDiffPreviews,
		}),
		[gitPathStatus, gitChangedPaths, diffPreviews, diffTotals, loadGitDiffPreviews]
	);

	return (
		<AppShellGitActionsContext.Provider value={gitActionsValue}>
			<AppShellGitMetaContext.Provider value={gitMetaValue}>
				<AppShellGitFilesContext.Provider value={gitFilesValue}>
					<AppShellSettingsContext.Provider value={settings}>{children}</AppShellSettingsContext.Provider>
				</AppShellGitFilesContext.Provider>
			</AppShellGitMetaContext.Provider>
		</AppShellGitActionsContext.Provider>
	);
}

export function AppShellProviders(props: {
	chrome: AppShellChromeValue;
	workspace: AppShellWorkspaceValue;
	settings: AppShellSettingsValue;
	children: ReactNode;
}) {
	const { chrome, workspace, settings, children } = props;
	return (
		<AppShellChromeContext.Provider value={chrome}>
			<AppShellWorkspaceContext.Provider value={workspace}>
				<AppShellGitContextBridge settings={settings}>{children}</AppShellGitContextBridge>
			</AppShellWorkspaceContext.Provider>
		</AppShellChromeContext.Provider>
	);
}
