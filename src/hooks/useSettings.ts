import { startTransition, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { SettingsNavId } from '../SettingsPage';
import type { EditorSettings } from '../EditorSettingsPanel';
import { defaultEditorSettings } from '../EditorSettingsPanel';
import type { McpServerConfig, McpServerStatus } from '../mcpTypes';
import {
	coerceDefaultModel,
	mergeEnabledIdsWithAllModels,
	paradigmForModelEntry,
	type UserLlmProvider,
	type UserModelEntry,
} from '../modelCatalog';
import {
	defaultAgentCustomization,
	isWorkspaceDiskImportedSkill,
	mergeSkillsBySlug,
	type TeamSettings,
	type AgentCustomization,
	type AgentRule,
	type AgentSkill,
	type AgentSubagent,
} from '../agentSettingsTypes';
import type { BotIntegrationConfig } from '../botSettingsTypes';
import { coerceThinkingByModelId, type ThinkingLevel } from '../ipcTypes';
import type { ModelPickerItem } from '../ModelPickerDropdown';
import type { TFunction } from '../i18n';
import { getTeamPresetDefaults } from '../teamPresetCatalog';

/* ── Project agent slice ── */

export type ProjectAgentSliceState = {
	rules: AgentRule[];
	skills: AgentSkill[];
	subagents: AgentSubagent[];
};

export const EMPTY_PROJECT_AGENT: ProjectAgentSliceState = { rules: [], skills: [], subagents: [] };

export type LoadedSettingsSnapshot = {
	defaultModel?: string;
	models?: {
		providers?: UserLlmProvider[];
		entries?: UserModelEntry[];
		enabledIds?: string[];
		thinkingByModelId?: Record<string, unknown>;
	};
	agent?: AgentCustomization;
	editor?: Partial<EditorSettings>;
	team?: TeamSettings;
	bots?: {
		integrations?: BotIntegrationConfig[];
	};
};

export function tagProjectOrigin<T extends { origin?: 'user' | 'project' }>(items: T[] | undefined): T[] {
	return (items ?? []).map((x) => ({ ...x, origin: 'project' as const }));
}

/* ── Hook ── */

export function useSettings(
	shell: NonNullable<Window['asyncShell']> | undefined,
	workspace: string | null,
	t: TFunction,
) {
	// ── Model state ──
	const [modelProviders, setModelProviders] = useState<UserLlmProvider[]>([]);
	const [defaultModel, setDefaultModel] = useState('');
	const [modelEntries, setModelEntries] = useState<UserModelEntry[]>([]);
	const [enabledModelIds, setEnabledModelIds] = useState<string[]>([]);
	const [thinkingByModelId, setThinkingByModelId] = useState<Record<string, ThinkingLevel>>({});

	// ── Agent customization ──
	const [agentCustomization, setAgentCustomization] = useState<AgentCustomization>(() => defaultAgentCustomization());
	const [projectAgentSlice, setProjectAgentSlice] = useState<ProjectAgentSliceState>(EMPTY_PROJECT_AGENT);
	const [workspaceDiskSkills, setWorkspaceDiskSkills] = useState<AgentSkill[]>([]);
	const [diskSkillsRefreshTicker, setDiskSkillsRefreshTicker] = useState(0);

	// ── Editor / MCP ──
	const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => defaultEditorSettings());
	const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
	const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
	const [teamSettings, setTeamSettings] = useState<TeamSettings>({
		useDefaults: true,
		presetId: 'engineering',
		experts: [],
		...getTeamPresetDefaults('engineering'),
	});
	const [botIntegrations, setBotIntegrations] = useState<BotIntegrationConfig[]>([]);

	// ── Settings page UI ──
	const [settingsPageOpen, setSettingsPageOpen] = useState(false);
	const [settingsInitialNav, setSettingsInitialNav] = useState<SettingsNavId>('general');
	const [settingsOpenPending, startSettingsOpenTransition] = useTransition();

	// ── Derived ──
	const hasSelectedModel = useMemo(() => defaultModel.trim().length > 0, [defaultModel]);

	const mergedAgentCustomization = useMemo((): AgentCustomization => {
		const baseSkills = [...(agentCustomization.skills ?? []), ...projectAgentSlice.skills];
		const skills =
			workspaceDiskSkills.length > 0 ? mergeSkillsBySlug(baseSkills, workspaceDiskSkills) : baseSkills;
		return {
			...agentCustomization,
			rules: [...(agentCustomization.rules ?? []), ...projectAgentSlice.rules],
			skills,
			subagents: [...(agentCustomization.subagents ?? []), ...projectAgentSlice.subagents],
		};
	}, [agentCustomization, projectAgentSlice, workspaceDiskSkills]);

	const onChangeMergedAgentCustomization = useCallback(
		(next: AgentCustomization) => {
			const ur = next.rules?.filter((r) => (r.origin ?? 'user') !== 'project') ?? [];
			const pr = next.rules?.filter((r) => r.origin === 'project') ?? [];
			const skillsPersist = (next.skills ?? []).filter((s) => !isWorkspaceDiskImportedSkill(s));
			const us = skillsPersist.filter((s) => (s.origin ?? 'user') !== 'project');
			const ps = skillsPersist.filter((s) => s.origin === 'project');
			const ua = next.subagents?.filter((s) => (s.origin ?? 'user') !== 'project') ?? [];
			const pa = next.subagents?.filter((s) => s.origin === 'project') ?? [];
			setAgentCustomization({
				...next,
				rules: ur,
				skills: us,
				subagents: ua,
				commands: next.commands ?? [],
			});
			const proj: ProjectAgentSliceState = { rules: pr, skills: ps, subagents: pa };
			setProjectAgentSlice(proj);
			if (shell && workspace) {
				void shell.invoke('workspaceAgent:set', proj);
			}
		},
		[shell, workspace]
	);

	const modelPickerItems = useMemo((): ModelPickerItem[] => {
		const enabledSet = new Set(enabledModelIds);
		return modelEntries
			.filter((e) => enabledSet.has(e.id) && (e.displayName.trim() || e.requestName.trim()))
			.map((e) => {
				const paradigm = paradigmForModelEntry(e, modelProviders);
				const paradigmLabel = paradigm ? t(`settings.paradigm.${paradigm}`) : '—';
				const provLabel = modelProviders.find((p) => p.id === e.providerId)?.displayName?.trim() ?? '';
				return {
					id: e.id,
					label: e.displayName.trim() || e.requestName,
					description: `${paradigmLabel} · ${e.requestName || t('modelPicker.requestNameMissing')}`,
					providerLabel: provLabel,
				};
			});
	}, [enabledModelIds, modelEntries, modelProviders, t]);

	const modelPillLabel = useMemo(() => {
		if (!defaultModel.trim()) {
			return t('modelPicker.selectModel');
		}
		const e = modelEntries.find((x) => x.id === defaultModel);
		return e ? e.displayName.trim() || e.requestName || defaultModel : defaultModel;
	}, [defaultModel, modelEntries, t]);

	// ── Callbacks ──
	const openSettingsPage = useCallback((nav: SettingsNavId) => {
		startSettingsOpenTransition(() => {
			setSettingsInitialNav(nav);
			setSettingsPageOpen(true);
		});
	}, []);

	const onPickDefaultModel = useCallback(
		async (id: string) => {
			setDefaultModel(id);
			if (shell) {
				await shell.invoke('settings:set', { defaultModel: id });
			}
		},
		[shell]
	);

	const onChangeModelEntries = useCallback((entries: UserModelEntry[]) => {
		setModelEntries(entries);
		setEnabledModelIds((prev) => mergeEnabledIdsWithAllModels(entries, prev));
	}, []);

	const onChangeModelProviders = useCallback((providers: UserLlmProvider[]) => {
		setModelProviders(providers);
	}, []);

	const onRefreshMcpStatuses = useCallback(async () => {
		if (!shell) return;
		const r = (await shell.invoke('mcp:getStatuses')) as { statuses?: McpServerStatus[] } | undefined;
		setMcpStatuses(r?.statuses ?? []);
	}, [shell]);

	const onStartMcpServer = useCallback(async (id: string) => {
		if (!shell) return;
		await shell.invoke('mcp:startServer', id);
		await onRefreshMcpStatuses();
	}, [shell, onRefreshMcpStatuses]);

	const onStopMcpServer = useCallback(async (id: string) => {
		if (!shell) return;
		await shell.invoke('mcp:stopServer', id);
		await onRefreshMcpStatuses();
	}, [shell, onRefreshMcpStatuses]);

	const onRestartMcpServer = useCallback(async (id: string) => {
		if (!shell) return;
		await shell.invoke('mcp:restartServer', id);
		await onRefreshMcpStatuses();
	}, [shell, onRefreshMcpStatuses]);

	const refreshWorkspaceDiskSkills = useCallback(() => {
		setDiskSkillsRefreshTicker((ticker) => ticker + 1);
	}, []);

	const applyLoadedSettings = useCallback((st: LoadedSettingsSnapshot | undefined) => {
		const rawProviders = Array.isArray(st?.models?.providers) ? st.models.providers : [];
		setModelProviders(rawProviders);

		const rawEntries = Array.isArray(st?.models?.entries) ? st.models.entries : [];
		setModelEntries(rawEntries);

		const saneEnabled = mergeEnabledIdsWithAllModels(rawEntries, st?.models?.enabledIds);
		setEnabledModelIds(saneEnabled);
		setDefaultModel(coerceDefaultModel(st?.defaultModel, rawEntries, saneEnabled));
		setThinkingByModelId(coerceThinkingByModelId(st?.models?.thinkingByModelId));

		const defs = defaultAgentCustomization();
		const ag = st?.agent;
		setAgentCustomization({
			...defs,
			...(ag ?? {}),
			importThirdPartyConfigs: true,
			rules: Array.isArray(ag?.rules) ? ag.rules : [],
			skills: Array.isArray(ag?.skills) ? ag.skills : [],
			subagents: Array.isArray(ag?.subagents) ? ag.subagents : [],
			commands: Array.isArray(ag?.commands) ? ag.commands : [],
			shellPermissionMode: ag?.shellPermissionMode ?? defs.shellPermissionMode,
			confirmShellCommands: ag?.confirmShellCommands ?? defs.confirmShellCommands,
			skipSafeShellCommandsConfirm: ag?.skipSafeShellCommandsConfirm ?? defs.skipSafeShellCommandsConfirm,
			confirmWritesBeforeExecute: ag?.confirmWritesBeforeExecute ?? defs.confirmWritesBeforeExecute,
			maxConsecutiveMistakes: ag?.maxConsecutiveMistakes ?? defs.maxConsecutiveMistakes,
			mistakeLimitEnabled: ag?.mistakeLimitEnabled ?? defs.mistakeLimitEnabled,
			backgroundForkAgent: ag?.backgroundForkAgent ?? defs.backgroundForkAgent,
			toolPermissionRules: Array.isArray(ag?.toolPermissionRules) ? ag.toolPermissionRules : [],
			shouldAvoidPermissionPrompts: ag?.shouldAvoidPermissionPrompts ?? defs.shouldAvoidPermissionPrompts,
			memoryExtraction: ag?.memoryExtraction !== undefined ? { ...ag.memoryExtraction } : undefined,
		});

		if (st?.editor) {
			setEditorSettings({ ...defaultEditorSettings(), ...st.editor });
		}
		const presetId = st?.team?.presetId ?? 'engineering';
		const presetDefaults = getTeamPresetDefaults(presetId);
		setTeamSettings({
			useDefaults: st?.team?.useDefaults ?? true,
			presetId,
			experts: Array.isArray(st?.team?.experts) ? st!.team!.experts : [],
			presetExpertSnapshots:
				st?.team?.presetExpertSnapshots && typeof st.team.presetExpertSnapshots === 'object'
					? st.team.presetExpertSnapshots
					: undefined,
			requirePlanApproval: st?.team?.requirePlanApproval ?? presetDefaults.requirePlanApproval,
			enablePreflightReview: st?.team?.enablePreflightReview ?? presetDefaults.enablePreflightReview,
			planReviewer: st?.team?.planReviewer ?? null,
			deliveryReviewer: st?.team?.deliveryReviewer ?? null,
		});
		setBotIntegrations(Array.isArray(st?.bots?.integrations) ? st!.bots!.integrations : []);
	}, []);

	useEffect(() => {
		if (import.meta.env.DEV) {
			console.warn(
				'[VoidShell] 调试：在应用窗口按 Ctrl+Shift+I（macOS：⌥⌘I）打开开发者工具；输入 window.__voidShellTabCloseLog 查看最近记录。'
			);
		}
	}, []);

	useEffect(() => {
		if (!shell || !workspace) {
			setProjectAgentSlice(EMPTY_PROJECT_AGENT);
			return;
		}
		let cancelled = false;
		void (async () => {
			const r = (await shell.invoke('workspaceAgent:get')) as {
				ok?: boolean;
				slice?: { rules?: AgentRule[]; skills?: AgentSkill[]; subagents?: AgentSubagent[] };
			};
			if (cancelled) return;
			const slice = r?.slice;
			startTransition(() => {
				setProjectAgentSlice({
					rules: tagProjectOrigin(slice?.rules),
					skills: tagProjectOrigin(slice?.skills),
					subagents: tagProjectOrigin(slice?.subagents),
				});
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace]);

	useEffect(() => {
		if (!shell || !workspace) {
			setWorkspaceDiskSkills([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const r = (await shell.invoke('workspace:listDiskSkills')) as { ok?: boolean; skills?: AgentSkill[] };
				if (cancelled) return;
				startTransition(() => {
					setWorkspaceDiskSkills(Array.isArray(r?.skills) ? r.skills : []);
				});
			} catch {
				if (!cancelled) {
					setWorkspaceDiskSkills([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [shell, workspace, diskSkillsRefreshTicker]);

	return {
		// Model
		modelProviders, setModelProviders,
		defaultModel, setDefaultModel,
		modelEntries, setModelEntries,
		enabledModelIds, setEnabledModelIds,
		thinkingByModelId, setThinkingByModelId,
		hasSelectedModel,
		modelPickerItems,
		modelPillLabel,
		// Agent
		agentCustomization, setAgentCustomization,
		projectAgentSlice, setProjectAgentSlice,
		workspaceDiskSkills, setWorkspaceDiskSkills,
		diskSkillsRefreshTicker, setDiskSkillsRefreshTicker,
		refreshWorkspaceDiskSkills,
		mergedAgentCustomization,
		onChangeMergedAgentCustomization,
		// Editor / MCP
		editorSettings, setEditorSettings,
		mcpServers, setMcpServers,
		mcpStatuses, setMcpStatuses,
		teamSettings, setTeamSettings,
		botIntegrations, setBotIntegrations,
		// Settings page
		settingsPageOpen, setSettingsPageOpen,
		settingsInitialNav,
		settingsOpenPending,
		openSettingsPage,
		// Callbacks
		onPickDefaultModel,
		onChangeModelEntries,
		onChangeModelProviders,
		onRefreshMcpStatuses,
		onStartMcpServer,
		onStopMcpServer,
		onRestartMcpServer,
		applyLoadedSettings,
	};
}
