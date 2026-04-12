import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
	applyAppearanceSettingsToDom,
	defaultAppearanceSettings,
	nativeWindowChromeFromAppearance,
	type AppAppearanceSettings,
} from '../../appearanceSettings';
import {
	APP_UI_STYLE,
	readPrefersDark,
	readStoredColorMode,
	resolveEffectiveScheme,
	writeStoredColorMode,
	type AppColorMode,
} from '../../colorMode';
import type {
	AiCollabMessage,
	AiCollabMessageType,
	AiEmployeesSettings,
	AiEmployeeCatalogEntry,
	AiOrchestrationHandoff,
	AiOrchestrationHandoffStatus,
	AiOrchestrationRun,
	AiOrchestrationTimelineEvent,
	AiSubAgentJob,
} from '../../../shared/aiEmployeesSettings';
import { DEFAULT_API, DEFAULT_WS, normConn } from '../domain/connection';
import { pickWorkspaceId, resolveMappedWorkspace } from '../domain/workspacePaths';
import {
	addHandoffToRunInState,
	addSubAgentJobToRun,
	appendTimelineEventToState,
	approveGitForRun,
	createDraftRun,
	emptyOrchestrationState,
	findRunByTaskId,
	linkTaskToHandoffInState,
	markCollabMessageReadInState,
	setRunIssueInState,
	setHandoffStatusInState,
	updateRunInState,
	updateSubAgentJobInRun,
	upsertRun,
	upsertCollabMessageInState,
} from '../domain/orchestration';
import { employeeHasActiveRunInvolvement, isOrchestrationRunIncomplete } from '../domain/employeeActivityStatus';
import { buildModelOptions } from '../adapters/modelAdapter';
import { formatOrchestrationCommitMessage, requestCommitToBranch } from '../adapters/gitAdapter';
import {
	type AiEmployeesConnection,
	AiEmployeesApiError,
	apiGetMe,
	apiListAgents,
	apiCreateIssue,
	apiCreateProject,
	apiDeleteIssue,
	apiDeleteProject,
	apiListIssues,
	apiListProjects,
	apiListMembers,
	apiListRuntimes,
	apiListSkills,
	apiListTaskMessages,
	apiListTasks,
	apiListWorkspaces,
	apiPatchIssue,
	apiUpdateProject,
	apiPostImReply,
	type ListIssuesQueryOptions,
} from '../api/client';
import {
	apiGetBootstrapStatus,
	apiListOrgEmployees,
	apiListPromptTemplates,
	apiPostBootstrapReset,
} from '../api/orgClient';
import type { OrgBootstrapStatus, OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import { AiEmployeesWsClient } from '../api/ws';
import type {
	AgentJson,
	CreateIssuePayload,
	CreateProjectPayload,
	IssueJson,
	ProjectJson,
	RuntimeJson,
	SkillJson,
	UpdateProjectPayload,
	WorkspaceMemberJson,
} from '../api/types';
import { onboardingBlocksDashboard, resolveOnboardingStep, type AiEmployeesOnboardingStep } from '../domain/bootstrap';
import {
	normalizeTaskEvent,
	taskEventToCollabMessage,
	taskEventToTimelineEvent,
	type NormalizedTaskEvent,
} from '../domain/taskEvents';
import type { AiEmployeesSessionPhase, LocalModelEntry } from '../sessionTypes';
import { resolveEmployeeLocalModelId } from '../adapters/modelAdapter';
import {
	buildCollabHistoryForCeoInRun,
	buildCollabHistoryForEmployee,
	buildCollabHistoryForEmployeeInRun,
} from '../domain/employeeChatHistory';
import type { EmployeeChatHistoryTurn, EmployeeChatInput, TeamMemberSummary } from '../../../shared/aiEmployeesPersona';
import { publishAiEmployeesNetworkError } from '../AiEmployeesNetworkToast';

type Shell = NonNullable<Window['asyncShell']>;

const SUB_AGENT_MAX_CONCURRENCY = 2;

type SubAgentQueueItem =
	| { kind: 'delegated'; jobId: string; runId: string; employeeId: string }
	| { kind: 'colleague'; runId: string; employeeId: string };

type SubAgentCollabAction =
	| {
			tool: 'delegate_task';
			targetEmployeeName: string;
			taskTitle: string;
			taskDescription: string;
			priority: string;
			contextFiles: string[];
	  }
	| {
			tool: 'send_colleague_message';
			targetEmployeeName: string;
			message: string;
	  }
	| {
			tool: 'submit_result';
			summary: string;
			modifiedFiles: string[];
			nextSteps?: string;
	  }
	| {
			tool: 'report_blocker';
			description: string;
			suggestedHelperName?: string;
	  };

type SubAgentIpcOk = {
	ok: true;
	resultText: string;
	toolLog: AiSubAgentJob['toolLog'];
	collabActions: SubAgentCollabAction[];
	durationMs: number;
};

type SubAgentIpcErr = {
	ok: false;
	error: string;
	toolLog: AiSubAgentJob['toolLog'];
	collabActions: SubAgentCollabAction[];
	durationMs: number;
};

type ShellUiLike = Record<string, unknown>;

function pickTerminalSubAgentAction(
	actions: readonly SubAgentCollabAction[]
): Extract<SubAgentCollabAction, { tool: 'submit_result' | 'report_blocker' }> | undefined {
	for (let index = actions.length - 1; index >= 0; index -= 1) {
		const action = actions[index];
		if (action.tool === 'submit_result' || action.tool === 'report_blocker') {
			return action;
		}
	}
	return undefined;
}

function filterFollowUpSubAgentActions(actions: readonly SubAgentCollabAction[]): SubAgentCollabAction[] {
	return actions.filter((action) => action.tool === 'delegate_task' || action.tool === 'send_colleague_message');
}

function hasPendingRunSubAgentWork(
	runId: string,
	queuedItems: readonly SubAgentQueueItem[],
	activeItems: readonly SubAgentQueueItem[]
): boolean {
	return queuedItems.some((item) => item.runId === runId) || activeItems.some((item) => item.runId === runId);
}

function shellUiColorMode(ui: ShellUiLike): AppColorMode | undefined {
	const c = ui.colorMode;
	return c === 'light' || c === 'dark' || c === 'system' ? c : undefined;
}

/** 将 `settings.ui` 中可合并进外观状态的字段拆出（排除布局、侧栏宽度、colorMode 等） */
function appearancePatchFromShellUi(ui: ShellUiLike): Partial<AppAppearanceSettings> {
	const { colorMode: _c, layoutMode: _l, sidebarLayout: _s, fontPreset, ...rest } = ui;
	const patch = { ...rest } as Partial<AppAppearanceSettings>;
	if (
		typeof fontPreset === 'string' &&
		!patch.uiFontPreset &&
		(fontPreset === 'apple' || fontPreset === 'inter' || fontPreset === 'segoe')
	) {
		patch.uiFontPreset = fontPreset as AppAppearanceSettings['uiFontPreset'];
	}
	return patch;
}

/** 供「我的事务」服务端筛选：成员本人 + 组织成员上已关联的远端 Agent 指派 */
function myIssuesListQuery(meUserId: string | undefined, orgEmps: OrgEmployee[] | undefined): ListIssuesQueryOptions | undefined {
	const agentIds = (orgEmps ?? []).map((e) => e.linkedRemoteAgentId).filter((x): x is string => Boolean(x));
	if (!meUserId && agentIds.length === 0) {
		return undefined;
	}
	const q: ListIssuesQueryOptions = {};
	if (meUserId) {
		q.assigneeMemberId = meUserId;
	}
	if (agentIds.length > 0) {
		q.assigneeAgentIds = agentIds;
	}
	return q;
}

export type AiEmployeesTabId = 'inbox' | 'myIssues' | 'issues' | 'projects' | 'agents' | 'skills' | 'activity' | 'connection';
export type ActivityFocusState = {
	runId: string;
	from?: 'inbox' | 'agents';
	employeeId?: string;
};

export function useAiEmployeesController() {
	const shell = window.asyncShell as Shell | undefined;

	const [appearanceSettings, setAppearanceSettings] = useState<AppAppearanceSettings>(() => defaultAppearanceSettings());
	const [colorMode, setColorMode] = useState<AppColorMode>(() => readStoredColorMode());
	const [localRoot, setLocalRoot] = useState<string | null>(null);
	const [aiSettings, setAiSettings] = useState<AiEmployeesSettings>({});
	const aiSettingsRef = useRef(aiSettings);
	aiSettingsRef.current = aiSettings;
	const [tab, setTab] = useState<AiEmployeesTabId>('inbox');
	const [activityFocus, setActivityFocus] = useState<ActivityFocusState | null>(null);
	/** 侧栏「新建任务」等触发：递增后由 IssuesHubPage 打开弹窗 */
	const [createIssueSignal, setCreateIssueSignal] = useState(0);
	const requestCreateIssue = useCallback(() => {
		setTab((prev) => (prev === 'myIssues' ? 'myIssues' : 'issues'));
		setCreateIssueSignal((n) => n + 1);
	}, []);
	const [workspaceId, setWorkspaceId] = useState<string>('');
	const [workspaces, setWorkspaces] = useState<{ id: string; name?: string }[]>([]);
	const [issues, setIssues] = useState<IssueJson[]>([]);
	const [projects, setProjects] = useState<ProjectJson[]>([]);
	const [myIssues, setMyIssues] = useState<IssueJson[]>([]);
	const [agents, setAgents] = useState<AgentJson[]>([]);
	const [skills, setSkills] = useState<SkillJson[]>([]);
	const [runtimes, setRuntimes] = useState<RuntimeJson[]>([]);
	const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberJson[]>([]);
	const [meLabel, setMeLabel] = useState('');
	const [meProfile, setMeProfile] = useState<{ name?: string; email?: string; id?: string }>({});
	const [sessionPhase, setSessionPhase] = useState<AiEmployeesSessionPhase>('bootstrapping');
	const [localModels, setLocalModels] = useState<{
		entries: LocalModelEntry[];
		enabledIds: string[];
		defaultModelId?: string;
	}>({ entries: [], enabledIds: [] });
	/** 最近一次「保存并连接」刷新失败，用于引导页按钮文案（错误详情走 toast） */
	const [connectRefreshFailed, setConnectRefreshFailed] = useState(false);
	const clearConnectRefreshFailed = useCallback(() => setConnectRefreshFailed(false), []);
	const [wsLog, setWsLog] = useState<string[]>([]);
	const [bootstrapStatus, setBootstrapStatus] = useState<OrgBootstrapStatus | null>(null);
	const [onboardingStep, setOnboardingStep] = useState<AiEmployeesOnboardingStep>('company');
	const [orgEmployees, setOrgEmployees] = useState<OrgEmployee[]>([]);
	const [promptTemplates, setPromptTemplates] = useState<OrgPromptTemplate[]>([]);
	const [onboardingErr, setOnboardingErr] = useState<string | null>(null);
	const [holdSetupDuringBootstrap, setHoldSetupDuringBootstrap] = useState(false);
	// Version counters: increment on relevant WS events so consumers can re-fetch.
	const [inboxVersion, setInboxVersion] = useState(0);
	const [chatVersion, setChatVersion] = useState(0);
	const [employeeChatStreaming, setEmployeeChatStreaming] = useState<Record<string, string>>({});
	const [employeeChatError, setEmployeeChatError] = useState<Record<string, string | undefined>>({});
	const pendingEmployeeChatRef = useRef(
		new Map<string, { employeeId: string; runId: string; allowStream: boolean }>()
	);
	const employeeReplyGuardRef = useRef(new Set<string>());
	/** Exclusive guard so only one employee chat stream renders deltas at a time (across runs). */
	const activeStreamOwnerRef = useRef<string | null>(null);
	const requestEmployeeReplyRef = useRef<((employeeId: string, runId: string) => Promise<void>) | null>(null);
	// Streaming-delta throttle: accumulate chunks in a ref, flush to state once per animation frame
	const streamingDeltaBufferRef = useRef<Record<string, string>>({});
	const streamingRafRef = useRef<number | null>(null);
	const flushStreamingDeltas = useCallback(() => {
		streamingRafRef.current = null;
		const buf = streamingDeltaBufferRef.current;
		const keys = Object.keys(buf);
		if (keys.length === 0) return;
		streamingDeltaBufferRef.current = {};
		setEmployeeChatStreaming((prev) => {
			const next = { ...prev };
			for (const id of keys) {
				next[id] = (prev[id] ?? '') + buf[id];
			}
			return next;
		});
	}, []);
	const subAgentQueueRef = useRef<SubAgentQueueItem[]>([]);
	const activeSubAgentCountRef = useRef(0);
	const activeSubAgentItemsRef = useRef<SubAgentQueueItem[]>([]);
	const pendingCeoDigestRunIdsRef = useRef<Set<string>>(new Set());
	const processSubAgentQueueRef = useRef<() => void>(() => {});
	const maybeTriggerPendingCeoDigestsRef = useRef<() => void>(() => {});
	const handleCollabActionRef = useRef<
		((fromEmployeeId: string, runId: string, action: { tool: string; [key: string]: unknown }) => void) | null
	>(null);
	const ceoEmployeeId = useMemo(() => orgEmployees.find((e) => e.isCeo)?.id, [orgEmployees]);
	const wsRef = useRef<AiEmployeesWsClient | null>(null);

	const prefersDark = useSyncExternalStore(
		(onStoreChange) => {
			const mq = window.matchMedia('(prefers-color-scheme: dark)');
			mq.addEventListener('change', onStoreChange);
			return () => mq.removeEventListener('change', onStoreChange);
		},
		readPrefersDark,
		readPrefersDark
	);
	const effectiveScheme = useMemo(() => resolveEffectiveScheme(colorMode, prefersDark), [colorMode, prefersDark]);

	const conn = useMemo(() => normConn(aiSettings), [aiSettings]);

	const persistAiSettings = useCallback(
		(next: AiEmployeesSettings) => {
			setAiSettings(next);
			void shell?.invoke('settings:set', { aiEmployees: next });
		},
		[shell]
	);

	useEffect(() => {
		applyAppearanceSettingsToDom(appearanceSettings, effectiveScheme);
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-ui-style', APP_UI_STYLE);
			document.documentElement.setAttribute('data-color-scheme', effectiveScheme);
		}
		if (!shell) {
			return;
		}
		const c = nativeWindowChromeFromAppearance(appearanceSettings, effectiveScheme);
		void shell.invoke('theme:applyChrome', {
			scheme: effectiveScheme,
			backgroundColor: c.backgroundColor,
			titleBarColor: c.titleBarColor,
			symbolColor: c.symbolColor,
		});
	}, [shell, appearanceSettings, effectiveScheme]);

	useEffect(() => {
		if (!shell?.subscribeThemeMode) {
			return;
		}
		return shell.subscribeThemeMode((payload) => {
			const next = (payload as { colorMode?: unknown } | null)?.colorMode;
			if (next === 'light' || next === 'dark' || next === 'system') {
				setColorMode(next);
				writeStoredColorMode(next);
			}
		});
	}, [shell]);

	useEffect(() => {
		if (!shell?.subscribeAppearanceUi) {
			return;
		}
		return shell.subscribeAppearanceUi((raw) => {
			const ui = (raw as { ui?: ShellUiLike } | null)?.ui;
			if (!ui || typeof ui !== 'object') {
				return;
			}
			const cm = shellUiColorMode(ui);
			if (cm) {
				setColorMode(cm);
				writeStoredColorMode(cm);
			}
			setAppearanceSettings((prev) => ({ ...prev, ...appearancePatchFromShellUi(ui) }));
		});
	}, [shell]);

	useEffect(() => {
		if (!shell) {
			return;
		}
		void (async () => {
			const [wsRaw, raw] = await Promise.all([shell.invoke('workspace:get'), shell.invoke('settings:get')]);
			const root = (wsRaw as { root?: string | null }).root ?? null;
			setLocalRoot(root);
			const r = raw as {
				ui?: ShellUiLike;
				aiEmployees?: AiEmployeesSettings;
				models?: {
					providers?: Array<{ id?: string; displayName?: string }>;
					entries?: Array<{ id?: string; displayName?: string; providerId?: string }>;
					enabledIds?: string[];
				};
				defaultModel?: string;
			};
			if (r?.ui) {
				const ui = r.ui;
				const cm = shellUiColorMode(ui);
				if (cm) {
					setColorMode(cm);
					writeStoredColorMode(cm);
				}
				setAppearanceSettings((prev) => ({ ...prev, ...appearancePatchFromShellUi(ui) }));
			}
			if (r?.aiEmployees) {
				setAiSettings(r.aiEmployees);
				const id = resolveMappedWorkspace(root, r.aiEmployees.workspaceMap);
				if (id) {
					setWorkspaceId(id);
				}
			}
			const providers = Array.isArray(r?.models?.providers) ? r.models.providers : [];
			const providerLabel = new Map<string, string>();
			for (const p of providers) {
				if (typeof p?.id !== 'string') {
					continue;
				}
				const name = typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName.trim() : p.id;
				providerLabel.set(p.id, name);
			}
			const entries = (r?.models?.entries ?? [])
				.filter((e): e is { id: string; displayName: string; providerId?: string } => typeof e?.id === 'string' && typeof e?.displayName === 'string')
				.map((e) => {
					const pid = typeof e.providerId === 'string' ? e.providerId : '';
					const providerDisplayName = pid ? (providerLabel.get(pid) ?? pid) : undefined;
					return { id: e.id, displayName: e.displayName, providerDisplayName };
				});
			setLocalModels({
				entries,
				enabledIds: Array.isArray(r?.models?.enabledIds) ? r.models.enabledIds.filter((x): x is string => typeof x === 'string') : [],
				defaultModelId: typeof r?.defaultModel === 'string' ? r.defaultModel : undefined,
			});
		})();
	}, [shell]);

	useEffect(() => {
		if (!shell?.subscribeAiEmployeesWorkspace) {
			return;
		}
		return shell.subscribeAiEmployeesWorkspace((root) => {
			setLocalRoot(root || null);
			void shell.invoke('settings:get').then((raw) => {
				const r = raw as { aiEmployees?: AiEmployeesSettings };
				const id = resolveMappedWorkspace(root || null, r?.aiEmployees?.workspaceMap);
				if (id) {
					setWorkspaceId(id);
				}
			});
		});
	}, [shell]);

	const fetchWorkspacePayload = useCallback(
		async (c: AiEmployeesConnection, wid: string, opts?: { meUserIdOverride?: string }) => {
			const meUid = opts?.meUserIdOverride ?? meProfile.id;
			const [iss, ag, sk, rt, mem, orgEmps, proj] = await Promise.all([
				apiListIssues(c, wid),
				apiListAgents(c, wid),
				apiListSkills(c, wid),
				apiListRuntimes(c, wid),
				apiListMembers(c, wid).catch(() => []),
				apiListOrgEmployees(c, wid).catch(() => [] as OrgEmployee[]),
				apiListProjects(c, wid).catch(() => [] as ProjectJson[]),
			]);
			const myQ = myIssuesListQuery(meUid, orgEmps);
			const myIss = myQ ? await apiListIssues(c, wid, myQ).catch(() => [] as IssueJson[]) : [];
			setIssues(iss);
			setProjects(proj);
			setMyIssues(myIss);
			setAgents(ag);
			setSkills(sk);
			setRuntimes(rt);
			setWorkspaceMembers(mem);
		},
		[meProfile.id]
	);

	const applyWorkspaceBootstrap = useCallback(async (c: AiEmployeesConnection, wid: string, workspaceListLen: number) => {
		if (!wid) {
			setBootstrapStatus(null);
			if (workspaceListLen > 0) {
				setSessionPhase('onboarding');
				setOnboardingStep('pick_workspace');
			} else {
				setSessionPhase('no_workspace');
			}
			return;
		}
		try {
			const bs = await apiGetBootstrapStatus(c, wid);
			setBootstrapStatus(bs);
			setOnboardingErr(null);
			if (onboardingBlocksDashboard(bs)) {
				setSessionPhase('onboarding');
				setOnboardingStep(resolveOnboardingStep(bs, true));
			} else {
				setSessionPhase('ready');
			}
			try {
				setOrgEmployees(await apiListOrgEmployees(c, wid));
			} catch {
				setOrgEmployees([]);
			}
		} catch (e) {
			if (e instanceof AiEmployeesApiError && e.status === 404) {
				setBootstrapStatus(null);
				setSessionPhase('ready');
				setOrgEmployees([]);
				return;
			}
			const msg = e instanceof Error ? e.message : String(e);
			publishAiEmployeesNetworkError(msg);
			setSessionPhase('ready');
		}
	}, []);

	const syncOnboardingAfterMutation = useCallback(async () => {
		const wid = workspaceId;
		if (!wid) {
			return;
		}
		const c = normConn(aiSettings);
		try {
			const bs = await apiGetBootstrapStatus(c, wid);
			setBootstrapStatus(bs);
			setOnboardingErr(null);
			if (onboardingBlocksDashboard(bs)) {
				setSessionPhase('onboarding');
				setOnboardingStep(resolveOnboardingStep(bs, true));
			} else {
				setSessionPhase('ready');
			}
			try {
				setOrgEmployees(await apiListOrgEmployees(c, wid));
			} catch {
				setOrgEmployees([]);
			}
		} catch (e) {
			setOnboardingErr(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, workspaceId]);

	const loadPromptTemplatesForOnboarding = useCallback(async () => {
		const wid = workspaceId;
		if (!wid) {
			return;
		}
		try {
			const list = await apiListPromptTemplates(normConn(aiSettings), wid);
			setPromptTemplates(list.filter((t) => t.key !== 'ceo'));
		} catch (e) {
			setOnboardingErr(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, workspaceId]);

	const refreshOrgEmployeesList = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase === 'need_connection' || sessionPhase === 'bootstrapping') {
			return;
		}
		try {
			setOrgEmployees(await apiListOrgEmployees(normConn(aiSettings), wid));
		} catch {
			setOrgEmployees([]);
		}
	}, [aiSettings, workspaceId, sessionPhase]);

	const refreshIssuesOnly = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			const c = normConn(aiSettings);
			const orgEmps = await apiListOrgEmployees(c, wid).catch(() => [] as OrgEmployee[]);
			const myQ = myIssuesListQuery(meProfile.id, orgEmps);
			const [list, myList] = await Promise.all([
				apiListIssues(c, wid),
				myQ ? apiListIssues(c, wid, myQ) : Promise.resolve([] as IssueJson[]),
			]);
			setIssues(list);
			setMyIssues(myList);
		} catch (e) {
			publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, meProfile.id, sessionPhase, workspaceId]);

	const refreshAgentsOnly = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			const list = await apiListAgents(normConn(aiSettings), wid);
			setAgents(list);
		} catch (e) {
			publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, sessionPhase, workspaceId]);

	const refreshSkillsOnly = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			const list = await apiListSkills(normConn(aiSettings), wid);
			setSkills(list);
		} catch (e) {
			publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, sessionPhase, workspaceId]);

	const refreshProjectsOnly = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			const list = await apiListProjects(normConn(aiSettings), wid).catch(() => [] as ProjectJson[]);
			setProjects(list);
		} catch (e) {
			publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, sessionPhase, workspaceId]);

	const refreshRuntimesOnly = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			const list = await apiListRuntimes(normConn(aiSettings), wid);
			setRuntimes(list);
		} catch (e) {
			publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, sessionPhase, workspaceId]);

	const refreshData = useCallback(
		async (connOverride?: AiEmployeesConnection, settingsOverride?: AiEmployeesSettings) => {
			const c = connOverride ?? normConn(aiSettings);
			const s = settingsOverride ?? aiSettings;
			setConnectRefreshFailed(false);
			setSessionPhase('bootstrapping');
			try {
				const me = await apiGetMe(c);
				setMeProfile({ name: me.name, email: me.email, id: me.id });
				setMeLabel(me.email ?? me.name ?? me.id ?? '');
				const wsList = await apiListWorkspaces(c);
				const list: unknown[] = Array.isArray(wsList)
					? wsList
					: ((wsList as { workspaces?: unknown[] }).workspaces ?? []);
				const mapped = list
					.filter(
						(w): w is { id: string; name?: string } =>
							typeof w === 'object' && w !== null && 'id' in w && typeof (w as { id: unknown }).id === 'string'
					)
					.map((w) => ({ id: w.id, name: w.name }));
				setWorkspaces(mapped);
				if (mapped.length === 0) {
					setWorkspaceId('');
					setIssues([]);
					setProjects([]);
					setMyIssues([]);
					setAgents([]);
					setSkills([]);
					setRuntimes([]);
					setWorkspaceMembers([]);
					setBootstrapStatus(null);
					setOrgEmployees([]);
					setSessionPhase('no_workspace');
					return;
				}
				const mapId = resolveMappedWorkspace(localRoot, s.workspaceMap);
				const wid = pickWorkspaceId(mapped, workspaceId, s.lastRemoteWorkspaceId, mapId);
				setWorkspaceId(wid);
				await fetchWorkspacePayload(c, wid, { meUserIdOverride: me.id });
				await applyWorkspaceBootstrap(c, wid, mapped.length);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				publishAiEmployeesNetworkError(msg);
				setConnectRefreshFailed(true);
				setWorkspaces([]);
				setWorkspaceId('');
				setIssues([]);
				setProjects([]);
				setMyIssues([]);
				setAgents([]);
				setSkills([]);
				setRuntimes([]);
				setWorkspaceMembers([]);
				setSessionPhase('need_connection');
			}
		},
		[aiSettings, applyWorkspaceBootstrap, fetchWorkspacePayload, localRoot, workspaceId]
	);

	const softRefreshPayload = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			await fetchWorkspacePayload(normConn(aiSettings), wid);
		} catch (e) {
			publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, fetchWorkspacePayload, sessionPhase, workspaceId]);

	const refreshDataRef = useRef(refreshData);
	refreshDataRef.current = refreshData;

	useEffect(() => {
		void refreshDataRef.current();
	}, [conn.apiBaseUrl, conn.wsBaseUrl, conn.token]);

	const lastPersistedWorkspaceRef = useRef<string | null>(null);
	useEffect(() => {
		if ((sessionPhase !== 'ready' && sessionPhase !== 'onboarding') || !workspaceId) {
			return;
		}
		if (lastPersistedWorkspaceRef.current === workspaceId) {
			return;
		}
		lastPersistedWorkspaceRef.current = workspaceId;
		setAiSettings((prev) => {
			const next = { ...prev, lastRemoteWorkspaceId: workspaceId };
			void shell?.invoke('settings:set', { aiEmployees: next });
			return next;
		});
	}, [sessionPhase, workspaceId, shell]);

	useEffect(() => {
		if (sessionPhase === 'need_connection') {
			setTab('connection');
		}
	}, [sessionPhase]);

	const routeWsEventToRefresh = useCallback(
		(eventType: string) => {
			if (eventType.startsWith('issue:') || eventType.startsWith('comment:')) {
				void refreshIssuesOnly();
				return;
			}
			if (eventType.startsWith('agent:')) {
				void refreshAgentsOnly();
				return;
			}
			if (eventType.startsWith('skill:')) {
				void refreshSkillsOnly();
				return;
			}
			if (eventType.startsWith('daemon:')) {
				void refreshRuntimesOnly();
				return;
			}
			if (eventType.startsWith('project:')) {
				void refreshProjectsOnly();
				void refreshIssuesOnly();
				return;
			}
			if (eventType.startsWith('workspace:') || eventType.startsWith('member:')) {
				void softRefreshPayload();
			}
		},
		[refreshAgentsOnly, refreshIssuesOnly, refreshProjectsOnly, refreshRuntimesOnly, refreshSkillsOnly, softRefreshPayload]
	);

	const orchestration = useMemo(
		() => aiSettings.orchestration ?? emptyOrchestrationState(),
		[aiSettings.orchestration]
	);
	const orchestrationRef = useRef(orchestration);
	orchestrationRef.current = orchestration;

	const employeeById = useMemo(() => new Map(orgEmployees.map((employee) => [employee.id, employee])), [orgEmployees]);
	const employeeIdByAgentId = useMemo(() => {
		const map = new Map<string, string>();
		for (const employee of orgEmployees) {
			if (employee.linkedRemoteAgentId) {
				map.set(employee.linkedRemoteAgentId, employee.id);
			}
		}
		return map;
	}, [orgEmployees]);
	const fallbackOwnerEmployeeId = useMemo(
		() => orgEmployees.find((employee) => employee.isCeo)?.id ?? orgEmployees[0]?.id,
		[orgEmployees]
	);
	const taskEvents = useMemo(
		() =>
			orchestration.timelineEvents.map((event) => {
				const stamp = new Date(event.createdAtIso).toLocaleString();
				return `${stamp} · ${event.label}${event.description ? ` — ${event.description}` : ''}`;
			}),
		[orchestration.timelineEvents]
	);

	const employeeDisplayName = useCallback(
		(employeeId?: string) => {
			if (!employeeId) {
				return '';
			}
			return employeeById.get(employeeId)?.displayName ?? employeeId.slice(0, 8);
		},
		[employeeById]
	);

	const modelOptions = useMemo(() => buildModelOptions(localModels), [localModels]);
	const modelOptionIdSet = useMemo(() => new Set(modelOptions.map((m) => m.id)), [modelOptions]);

	const buildChatHistoryForRequest = useCallback(
		(employeeId: string, runId: string, employee: OrgEmployee): EmployeeChatHistoryTurn[] => {
			const msgs = orchestrationRef.current.collabMessages;
			if (runId.startsWith('im:')) {
				return buildCollabHistoryForEmployee(msgs, employeeId);
			}
			if (employee.isCeo) {
				return buildCollabHistoryForCeoInRun(msgs, runId, employeeId);
			}
			return buildCollabHistoryForEmployeeInRun(msgs, runId, employeeId, ceoEmployeeId);
		},
		[ceoEmployeeId]
	);

	const buildEmployeeChatPayload = useCallback(
		(employee: OrgEmployee, runId: string, requestId: string): EmployeeChatInput | null => {
			const employeeId = employee.id;
			const modelId = resolveEmployeeLocalModelId({
				employeeId,
				remoteAgentId: employee.linkedRemoteAgentId ?? undefined,
				agentLocalModelMap: aiSettings.agentLocalModelIdByRemoteAgentId,
				employeeLocalModelMap: aiSettings.employeeLocalModelIdByEmployeeId,
				defaultModelId: localModels.defaultModelId,
				modelOptionIds: modelOptionIdSet,
			});
			if (!modelId) {
				return null;
			}
			const history = buildChatHistoryForRequest(employeeId, runId, employee);
			if (history.length === 0) {
				return null;
			}
			const teamMembers: TeamMemberSummary[] = orgEmployees
				.filter((e) => e.id !== employeeId)
				.map((e) => ({
					id: e.id,
					displayName: e.displayName,
					roleTitle: e.customRoleTitle || e.roleKey,
					jobMission: e.personaSeed?.jobMission,
				}));
			const wsLines: string[] = [];
			if (bootstrapStatus?.companyName) {
				wsLines.push(`Company: ${bootstrapStatus.companyName}`);
			}
			if (projects.length > 0) {
				wsLines.push('Projects in this workspace (you can see and reference these):');
				for (const p of projects) {
					let leadName: string | undefined;
					if (p.lead_type === 'member' && p.lead_id) {
						leadName = workspaceMembers.find((m) => m.user_id === p.lead_id)?.name;
					} else if (p.lead_type === 'agent' && p.lead_id) {
						leadName =
							agents.find((a) => a.id === p.lead_id)?.name ??
							orgEmployees.find((e) => e.linkedRemoteAgentId === p.lead_id)?.displayName;
					}
					const total = p.issue_count ?? 0;
					const done = p.done_count ?? 0;
					const progress = total > 0 ? ` [${done}/${total} issues done]` : ' [no issues yet]';
					const lead = leadName ? `, lead: ${leadName}` : '';
					const bk = p.boundary_kind ?? 'none';
					const bPath = bk === 'local_folder' ? p.boundary_local_path : bk === 'git_repo' ? p.boundary_git_url : null;
					const boundary = bPath ? `, ${bk}: ${bPath}` : '';
					wsLines.push(`  • ${p.icon ?? '📁'} ${p.title}${progress}${lead}${boundary}`);
					if (p.description) {
						wsLines.push(`    ${p.description.slice(0, 120).replace(/\n/g, ' ')}`);
					}
				}
			} else {
				wsLines.push('Projects: none created yet.');
			}
			if (issues.length > 0) {
				wsLines.push('Issues/tasks in this workspace:');
				for (const i of issues.slice(0, 25)) {
					let assigneeName: string | undefined;
					if (i.assignee_type === 'member' && i.assignee_id) {
						assigneeName = workspaceMembers.find((m) => m.user_id === i.assignee_id)?.name;
					} else if (i.assignee_type === 'agent' && i.assignee_id) {
						assigneeName =
							agents.find((a) => a.id === i.assignee_id)?.name ??
							orgEmployees.find((e) => e.linkedRemoteAgentId === i.assignee_id)?.displayName;
					}
					const id = i.identifier ? `${i.identifier} ` : '';
					const proj = projects.find((p) => p.id === i.project_id);
					const projLabel = proj ? ` [${proj.title}]` : '';
					const assigneeLabel = assigneeName ? ` → ${assigneeName}` : '';
					const priority = i.priority && i.priority !== 'none' ? ` (${i.priority})` : '';
					wsLines.push(`  • ${id}${i.title} · ${i.status}${priority}${projLabel}${assigneeLabel}`);
				}
			}
			if (skills.length > 0) {
				wsLines.push(`Available skills: ${skills.map((s) => s.name).join(', ')}`);
			}
			const wsContextSection =
				wsLines.length > 0
					? `IMPORTANT — Workspace context (live data provided by the system):\n` +
						`You CAN see this data. It is injected into your context by the system.\n` +
						`If you previously said you could not see workspace data, that was before this update — disregard that.\n` +
						`Always refer to the information below when asked about projects, issues, tasks, or team status.\n\n` +
						wsLines.join('\n')
					: '';
			const roleTitle = employee.customRoleTitle?.trim() || employee.roleKey || 'team member';
			const basePrompt =
				employee.customSystemPrompt?.trim() || `You are ${employee.displayName || 'AI employee'}, ${roleTitle}.`;
			const injectedSystemPrompt = wsContextSection ? `${basePrompt}\n\n${wsContextSection}` : basePrompt;
			const hasWorkspaceData = projects.length > 0 || issues.length > 0;
			const effectiveHistory = hasWorkspaceData
				? [
						{
							role: 'user' as const,
							content:
								'[System context update] Your workspace data has been synced. Check your system prompt for the latest projects and issues.',
						},
						{
							role: 'assistant' as const,
							content:
								'Understood. I now have access to the current workspace data including projects, issues, and skills. I will refer to this information going forward.',
						},
						...history,
					]
				: history;
			const boundaryLocalPaths = projects
				.filter((p) => p.boundary_kind === 'local_folder' && p.boundary_local_path?.trim())
				.map((p) => p.boundary_local_path!.trim());
			return {
				requestId,
				modelId,
				displayName: employee.displayName,
				roleKey: employee.roleKey,
				customRoleTitle: employee.customRoleTitle,
				customSystemPrompt: injectedSystemPrompt,
				jobMission: employee.personaSeed?.jobMission,
				domainContext: employee.personaSeed?.domainContext,
				communicationNotes: employee.personaSeed?.communicationNotes,
				collaborationRules: employee.personaSeed?.collaborationRules,
				handoffRules: employee.personaSeed?.handoffRules,
				history: effectiveHistory,
				teamMembers,
				boundaryLocalPaths: boundaryLocalPaths.length > 0 ? boundaryLocalPaths : undefined,
				isCeo: employee.isCeo || false,
			};
		},
		[
			aiSettings.agentLocalModelIdByRemoteAgentId,
			aiSettings.employeeLocalModelIdByEmployeeId,
			agents,
			bootstrapStatus?.companyName,
			buildChatHistoryForRequest,
			issues,
			localModels.defaultModelId,
			modelOptionIdSet,
			orgEmployees,
			projects,
			skills,
			workspaceMembers,
		]
	);

	// Debounced disk-write: React state updates immediately, but the IPC write to disk
	// is coalesced so rapid-fire persistOrchestration calls (e.g. during multi-agent delegation)
	// don't create a write storm. The latest state is always persisted within 300ms.
	const orchestrationDiskWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const orchestrationDirtyRef = useRef(false);
	const persistOrchestration = useCallback(
		(updater: (state: ReturnType<typeof emptyOrchestrationState>) => ReturnType<typeof emptyOrchestrationState>) => {
			setAiSettings((prev) => {
				const nextOrchestration = updater(prev.orchestration ?? emptyOrchestrationState());
				const next = { ...prev, orchestration: nextOrchestration };
				orchestrationDirtyRef.current = true;
				// Schedule a single debounced disk write
				if (orchestrationDiskWriteTimerRef.current === null) {
					orchestrationDiskWriteTimerRef.current = setTimeout(() => {
						orchestrationDiskWriteTimerRef.current = null;
						if (orchestrationDirtyRef.current) {
							orchestrationDirtyRef.current = false;
							// Read the latest state from the ref (not the stale `next`)
							void shell?.invoke('settings:set', { aiEmployees: aiSettingsRef.current });
						}
					}, 300);
				}
				return next;
			});
		},
		[shell]
	);

	const appendTimelineEvent = useCallback(
		(state: ReturnType<typeof emptyOrchestrationState>, event: AiOrchestrationTimelineEvent) =>
			appendTimelineEventToState(state, event),
		[]
	);

	const appendCollabMessage = useCallback(
		(state: ReturnType<typeof emptyOrchestrationState>, message: AiCollabMessage) =>
			upsertCollabMessageInState(state, message),
		[]
	);

	/** Resolve an employee by display name (case-insensitive). Used by collab tools. */
	const resolveEmployeeByName = useCallback(
		(name: string): OrgEmployee | undefined => {
			const lower = name.toLowerCase().trim();
			return orgEmployees.find((e) => e.displayName.toLowerCase().trim() === lower);
		},
		[orgEmployees]
	);

	/**
	 * Handle a collaboration action from an employee's agent loop.
	 * These create real orchestration state changes and can trigger follow-up agent runs.
	 */
	const handleCollabAction = useCallback(
		(fromEmployeeId: string, runId: string, action: { tool: string; [key: string]: unknown }) => {
			const nowIso = new Date().toISOString();
			const fromName = employeeById.get(fromEmployeeId)?.displayName ?? fromEmployeeId.slice(0, 8);

			switch (action.tool) {
				case 'delegate_task': {
					const targetName = String(action.targetEmployeeName ?? '');
					const taskTitle = String(action.taskTitle ?? '');
					const taskDesc = String(action.taskDescription ?? '');
					const delegatePriority = String(action.priority ?? 'medium');
					const target = resolveEmployeeByName(targetName);
					if (!target) {
						persistOrchestration((state) =>
							appendCollabMessage(state, {
								id: crypto.randomUUID(),
								runId,
								type: 'status_update',
								fromEmployeeId,
								summary: `Could not find teammate: ${targetName}`,
								body: `Tried to delegate "${taskTitle}" but no teammate named "${targetName}" was found.`,
								createdAtIso: nowIso,
							})
						);
						return;
					}
					const correlationId = crypto.randomUUID();
					const job: AiSubAgentJob = {
						id: correlationId,
						runId,
						employeeId: target.id,
						employeeName: target.displayName,
						taskTitle,
						taskDescription: taskDesc,
						status: 'queued',
						queuedAtIso: nowIso,
						toolLog: [],
					};
					persistOrchestration((state) => {
						let next = addHandoffToRunInState(state, runId, {
							id: correlationId,
							fromEmployeeId,
							toEmployeeId: target.id,
							status: 'in_progress',
							note: `[${delegatePriority}] ${taskTitle}`,
							atIso: nowIso,
						});
						next = appendTimelineEvent(next, {
							id: `handoff:${correlationId}:created`,
							runId,
							type: 'handoff_added',
							label: `${fromName} → ${target.displayName}: ${taskTitle}`,
							description: taskDesc,
							createdAtIso: nowIso,
							handoffId: correlationId,
							employeeId: target.id,
							source: 'local',
						});
						next = addSubAgentJobToRun(next, runId, job);
						next = appendCollabMessage(next, {
							id: correlationId,
							runId,
							type: 'task_assignment',
							fromEmployeeId,
							toEmployeeId: target.id,
							summary: taskTitle,
							body: taskDesc,
							createdAtIso: nowIso,
							subAgentJobId: correlationId,
							cardMeta: {
								status: 'pending',
								handoffId: correlationId,
							},
						});
						return next;
					});
					subAgentQueueRef.current.push({
						kind: 'delegated',
						jobId: correlationId,
						runId,
						employeeId: target.id,
					});
					processSubAgentQueueRef.current();
					break;
				}

				case 'send_colleague_message': {
					const targetName = String(action.targetEmployeeName ?? '');
					const message = String(action.message ?? '');
					const target = resolveEmployeeByName(targetName);
					if (!target || !message) return;
					const messageId = crypto.randomUUID();
					persistOrchestration((state) => {
						let next = appendCollabMessage(state, {
							id: messageId,
							runId,
							type: 'text',
							fromEmployeeId,
							toEmployeeId: target.id,
							summary: `${fromName} → ${target.displayName}: ${message.slice(0, 60)}`,
							body: message,
							createdAtIso: nowIso,
						});
						next = appendTimelineEvent(next, {
							id: `message:${messageId}`,
							runId,
							type: 'message',
							label: `${fromName} → ${target.displayName}`,
							description: message,
							createdAtIso: nowIso,
							employeeId: target.id,
							source: 'local',
						});
						return next;
					});
					subAgentQueueRef.current.push({ kind: 'colleague', runId, employeeId: target.id });
					processSubAgentQueueRef.current();
					break;
				}

				case 'submit_result': {
					const summary = String(action.summary ?? '');
					const modifiedFiles = action.modifiedFiles as string[] | undefined;
					const nextSteps = action.nextSteps ? String(action.nextSteps) : undefined;
					// Find the active handoff for this employee in this run and mark it done
					const orch = orchestrationRef.current;
					const run = orch.runs.find((r) => r.id === runId);
					const activeHandoff = run?.handoffs.find(
						(h) => h.toEmployeeId === fromEmployeeId && h.status === 'in_progress'
					);
					const body = [
						summary,
						modifiedFiles?.length ? `Modified: ${modifiedFiles.join(', ')}` : '',
						nextSteps ? `Next steps: ${nextSteps}` : '',
					].filter(Boolean).join('\n');
					const messageId = crypto.randomUUID();

					persistOrchestration((state) => {
						let next = appendCollabMessage(state, {
							id: messageId,
							runId,
							type: 'result',
							fromEmployeeId,
							summary: `${fromName} completed: ${summary.slice(0, 60)}`,
							body,
							createdAtIso: nowIso,
							cardMeta: {
								status: 'done',
								handoffId: activeHandoff?.id,
							},
						});
						next = appendTimelineEvent(next, {
							id: `message:${messageId}`,
							runId,
							type: 'result',
							label: `${fromName} completed task`,
							description: summary,
							createdAtIso: nowIso,
							employeeId: fromEmployeeId,
							source: 'local',
						});
						// Mark the handoff as done
						if (activeHandoff) {
							next = setHandoffStatusInState(next, runId, activeHandoff.id, 'done', {
								resultSummary: summary,
								atIso: nowIso,
							});
							next = appendTimelineEvent(next, {
								id: `handoff:${activeHandoff.id}:done:${nowIso}`,
								runId,
								type: 'handoff_status',
								label: `Handoff completed by ${fromName}`,
								createdAtIso: nowIso,
								handoffId: activeHandoff.id,
								status: 'done',
								source: 'local',
							});
						}
						return next;
					});
					if (run) {
						const nextPending = run.handoffs.find((h) => h.status === 'pending');
						if (nextPending) {
							subAgentQueueRef.current.push({
								kind: 'colleague',
								runId,
								employeeId: nextPending.toEmployeeId,
							});
							processSubAgentQueueRef.current();
						}
					}
					break;
				}

				case 'report_blocker': {
					const description = String(action.description ?? '');
					const suggestedHelper = action.suggestedHelperName ? String(action.suggestedHelperName) : undefined;
					// Find active handoff and mark blocked
					const orch2 = orchestrationRef.current;
					const run2 = orch2.runs.find((r) => r.id === runId);
					const activeHandoff2 = run2?.handoffs.find(
						(h) => h.toEmployeeId === fromEmployeeId && h.status === 'in_progress'
					);
					const messageId2 = crypto.randomUUID();
					persistOrchestration((state) => {
						let next = appendCollabMessage(state, {
							id: messageId2,
							runId,
							type: 'blocker',
							fromEmployeeId,
							summary: `${fromName} blocked: ${description.slice(0, 60)}`,
							body: suggestedHelper
								? `${description}\n\nSuggested helper: ${suggestedHelper}`
								: description,
							createdAtIso: nowIso,
							cardMeta: {
								status: 'blocked',
								handoffId: activeHandoff2?.id,
							},
						});
						next = appendTimelineEvent(next, {
							id: `message:${messageId2}`,
							runId,
							type: 'message',
							label: `${fromName} is blocked`,
							description,
							createdAtIso: nowIso,
							employeeId: fromEmployeeId,
							source: 'local',
						});
						if (activeHandoff2) {
							next = setHandoffStatusInState(next, runId, activeHandoff2.id, 'blocked', {
								blockedReason: description,
								atIso: nowIso,
							});
						}
						return next;
					});
					// If a helper was suggested, auto-trigger them (staggered)
					if (suggestedHelper) {
						const helper = resolveEmployeeByName(suggestedHelper);
						if (helper) {
							subAgentQueueRef.current.push({ kind: 'colleague', runId, employeeId: helper.id });
							processSubAgentQueueRef.current();
						}
					}
					break;
				}
			}
		},
		[appendCollabMessage, appendTimelineEvent, employeeById, persistOrchestration, resolveEmployeeByName]
	);

	useEffect(() => {
		if (!shell?.subscribeAiEmployeesChat) {
			return;
		}
		const unsub = shell.subscribeAiEmployeesChat((raw) => {
			const p = raw as {
				requestId?: string; kind?: string; delta?: string; text?: string;
				error?: string; toolName?: string; toolSuccess?: boolean;
				isCollabTool?: boolean; toolArgs?: Record<string, unknown>;
				action?: Record<string, unknown>;
			};
			const rid = p.requestId;
			if (!rid) {
				return;
			}
			const meta = pendingEmployeeChatRef.current.get(rid);
			if (!meta) {
				return;
			}
			const { employeeId, runId, allowStream } = meta;
			if (p.kind === 'delta' && p.delta) {
				if (!allowStream) {
					return;
				}
				// Buffer deltas and flush once per animation frame to avoid setState storm
				streamingDeltaBufferRef.current[employeeId] =
					(streamingDeltaBufferRef.current[employeeId] ?? '') + p.delta;
				if (streamingRafRef.current === null) {
					streamingRafRef.current = requestAnimationFrame(flushStreamingDeltas);
				}
				return;
			}
			if (p.kind === 'tool_call' && p.toolName) {
				// Collab tools are handled via collab_action event; file tools are just
				// working activity — do NOT persist to orchestration on every call
				// (that causes a disk-write + React re-render storm when multiple agents run).
				// The meaningful output will arrive in the 'done' text or via submit_result.
				return;
			}
			if (p.kind === 'tool_result') {
				return;
			}
			if (p.kind === 'collab_action' && p.action) {
				// Collaboration tool called — dispatch to orchestration handler
				handleCollabAction(employeeId, runId, p.action as { tool: string; [key: string]: unknown });
				return;
			}
			if (p.kind === 'done') {
				const text = (p.text ?? '').trim();
				pendingEmployeeChatRef.current.delete(rid);
				employeeReplyGuardRef.current.delete(employeeId);
				if (activeStreamOwnerRef.current === rid) {
					activeStreamOwnerRef.current = null;
				}
				setEmployeeChatStreaming((prev) => {
					const next = { ...prev };
					delete next[employeeId];
					return next;
				});
				if (text) {
					const nowIso = new Date().toISOString();
					persistOrchestration((state) => {
						const message: AiCollabMessage = {
							id: crypto.randomUUID(),
							runId,
							type: 'text',
							fromEmployeeId: employeeId,
							summary: text.slice(0, 80),
							body: text,
							createdAtIso: nowIso,
						};
						let next = appendCollabMessage(state, message);
						next = appendTimelineEvent(next, {
							id: `message:${message.id}`,
							runId,
							type: 'message',
							label: message.summary,
							description: message.body,
							createdAtIso: nowIso,
							employeeId,
							source: 'local',
						});
						return next;
					});
				}
				return;
			}
			if (p.kind === 'error') {
				const err = p.error ?? 'Unknown error';
				pendingEmployeeChatRef.current.delete(rid);
				employeeReplyGuardRef.current.delete(employeeId);
				if (activeStreamOwnerRef.current === rid) {
					activeStreamOwnerRef.current = null;
				}
				setEmployeeChatError((prev) => ({ ...prev, [employeeId]: err }));
				setEmployeeChatStreaming((prev) => {
					const next = { ...prev };
					delete next[employeeId];
					return next;
				});
				const nowIso = new Date().toISOString();
				persistOrchestration((state) =>
					appendCollabMessage(state, {
						id: crypto.randomUUID(),
						runId,
						type: 'status_update',
						fromEmployeeId: employeeId,
						summary: 'Reply failed',
						body: err,
						createdAtIso: nowIso,
					})
				);
			}
		});
		return () => {
			unsub();
			if (streamingRafRef.current !== null) {
				cancelAnimationFrame(streamingRafRef.current);
				streamingRafRef.current = null;
			}
		};
	}, [shell, persistOrchestration, appendCollabMessage, appendTimelineEvent, handleCollabAction, employeeById, flushStreamingDeltas]);

	const matchRunForTaskEvent = useCallback(
		(state: ReturnType<typeof emptyOrchestrationState>, event: NormalizedTaskEvent) => {
			if (event.runId) {
				const run = state.runs.find((candidate) => candidate.id === event.runId);
				if (run) {
					return { run, handoff: event.handoffId ? run.handoffs.find((handoff) => handoff.id === event.handoffId) : undefined };
				}
			}
			if (event.handoffId) {
				for (const run of state.runs) {
					const handoff = run.handoffs.find((candidate) => candidate.id === event.handoffId);
					if (handoff) {
						return { run, handoff };
					}
				}
			}
			if (event.taskId) {
				const run = findRunByTaskId(state, event.taskId);
				if (run) {
					return { run, handoff: run.handoffs.find((candidate) => candidate.taskId === event.taskId) };
				}
			}
			if (event.issueId) {
				const run = state.runs.find((candidate) => candidate.issueId === event.issueId);
				if (run) {
					return { run, handoff: event.taskId ? run.handoffs.find((candidate) => candidate.taskId === event.taskId) : undefined };
				}
			}
			const employeeId = event.employeeId ?? (event.agentId ? employeeIdByAgentId.get(event.agentId) : undefined);
			if (!employeeId) {
				return {};
			}
			const candidates = state.runs
				.filter(
					(candidate) =>
						candidate.currentAssigneeEmployeeId === employeeId ||
						candidate.handoffs.some((handoff) => handoff.toEmployeeId === employeeId && handoff.status !== 'done')
				)
				.sort((a, b) => Date.parse(b.lastEventAtIso ?? b.createdAtIso) - Date.parse(a.lastEventAtIso ?? a.createdAtIso));
			const run = candidates[0];
			if (!run) {
				return {};
			}
			return {
				run,
				handoff:
					run.handoffs.find((candidate) => candidate.taskId && candidate.taskId === event.taskId) ??
					run.handoffs.find((candidate) => candidate.toEmployeeId === employeeId && candidate.status !== 'done'),
			};
		},
		[employeeIdByAgentId]
	);

	const applyTaskEventToState = useCallback(
		(state: ReturnType<typeof emptyOrchestrationState>, event: NormalizedTaskEvent) => {
			let next = state;
			let { run, handoff } = matchRunForTaskEvent(next, event);
			const eventEmployeeId = event.employeeId ?? (event.agentId ? employeeIdByAgentId.get(event.agentId) : undefined);

			if (!run) {
				const syntheticRunId = event.runId ?? crypto.randomUUID();
				const syntheticRun: AiOrchestrationRun = {
					...createDraftRun(event.summary || 'Remote task', undefined, event.timestamp, syntheticRunId, {
						status: 'running',
						ownerEmployeeId: fallbackOwnerEmployeeId,
						currentAssigneeEmployeeId: eventEmployeeId,
						statusSummary: event.summary,
						lastEventAtIso: event.timestamp,
						issueId: event.issueId,
					}),
					handoffs:
						eventEmployeeId
							? [
									{
										id: event.handoffId ?? crypto.randomUUID(),
										fromEmployeeId: fallbackOwnerEmployeeId,
										toEmployeeId: eventEmployeeId,
										status:
											event.eventType === 'task:completed'
												? 'done'
												: event.eventType === 'task:failed'
													? 'blocked'
													: 'in_progress',
										note: event.summary,
										atIso: event.timestamp,
										taskId: event.taskId,
										resultSummary: event.eventType === 'task:completed' ? event.summary : undefined,
										blockedReason: event.eventType === 'task:failed' ? event.message ?? event.summary : undefined,
									},
								]
							: [],
				};
				next = upsertRun(next, syntheticRun);
				run = syntheticRun;
				handoff = syntheticRun.handoffs[0];
			}

			if (event.issueId && run.issueId !== event.issueId) {
				next = setRunIssueInState(next, run.id, event.issueId);
			}

			if (event.eventType === 'task:dispatch' && eventEmployeeId && !handoff) {
				const newHandoff: AiOrchestrationHandoff = {
					id: event.handoffId ?? crypto.randomUUID(),
					fromEmployeeId: run.ownerEmployeeId,
					toEmployeeId: eventEmployeeId,
					status: 'in_progress',
					note: event.summary,
					atIso: event.timestamp,
					taskId: event.taskId,
				};
				next = addHandoffToRunInState(next, run.id, newHandoff);
				handoff = newHandoff;
			}

			if (event.taskId && handoff && handoff.taskId !== event.taskId) {
				next = linkTaskToHandoffInState(next, run.id, handoff.id, event.taskId);
			}

			next = updateRunInState(next, run.id, (currentRun) => ({
				...currentRun,
				statusSummary: event.summary,
				lastEventAtIso: event.timestamp,
				currentAssigneeEmployeeId: eventEmployeeId ?? currentRun.currentAssigneeEmployeeId,
				status:
					event.eventType === 'task:completed'
						? currentRun.status
						: event.eventType === 'task:failed'
							? 'running'
							: 'running',
			}));

			if (handoff && (event.eventType === 'task:progress' || event.eventType === 'task:dispatch')) {
				next = setHandoffStatusInState(next, run.id, handoff.id, 'in_progress', {
					taskId: event.taskId,
					atIso: event.timestamp,
				});
			}
			if (handoff && event.eventType === 'task:completed') {
				next = setHandoffStatusInState(next, run.id, handoff.id, 'done', {
					taskId: event.taskId,
					resultSummary: event.message ?? event.summary,
					atIso: event.timestamp,
				});
				next = updateRunInState(next, run.id, (currentRun) => ({
					...currentRun,
					approvalState: currentRun.targetBranch ? 'pending_git' : 'approved',
				}));
			}
			if (handoff && event.eventType === 'task:failed') {
				next = setHandoffStatusInState(next, run.id, handoff.id, 'blocked', {
					taskId: event.taskId,
					blockedReason: event.message ?? event.summary,
					atIso: event.timestamp,
				});
			}

			next = appendTimelineEvent(next, taskEventToTimelineEvent(run.id, event));
			const collabMessage = taskEventToCollabMessage(run.id, event, eventEmployeeId, run.ownerEmployeeId);
			if (collabMessage) {
				next = appendCollabMessage(next, collabMessage);
			}
			return next;
		},
		[appendCollabMessage, appendTimelineEvent, employeeIdByAgentId, fallbackOwnerEmployeeId, matchRunForTaskEvent]
	);

	const recordTaskEvent = useCallback(
		(eventType: string, payload: unknown) => {
			const normalized = normalizeTaskEvent(eventType, payload);
			persistOrchestration((state) => applyTaskEventToState(state, normalized));
		},
		[applyTaskEventToState, persistOrchestration]
	);

	const syncOrchestrationHistory = useCallback(async () => {
		if (!workspaceId || sessionPhase !== 'ready') {
			return;
		}
		const connNow = normConn(aiSettings);
		const runs = orchestration.runs.filter(
			(run) => Boolean(run.issueId) || run.handoffs.some((handoff) => Boolean(handoff.taskId))
		);
		for (const run of runs) {
			try {
				const tasks =
					run.issueId != null
						? await apiListTasks(connNow, workspaceId, { issueId: run.issueId })
						: [];
				for (const task of tasks) {
					recordTaskEvent('task:dispatch', {
						taskId: task.id,
						issueId: task.issue_id,
						agentId: task.agent_id,
						status: task.status,
						summary: task.summary,
						timestamp: task.created_at ?? task.dispatched_at ?? task.started_at ?? task.completed_at,
					});
				}
				const taskIds = new Set<string>([
					...tasks.map((task) => task.id),
					...run.handoffs.map((handoff) => handoff.taskId).filter((taskId): taskId is string => Boolean(taskId)),
				]);
				for (const taskId of taskIds) {
					const messages = await apiListTaskMessages(connNow, workspaceId, taskId);
					for (const message of messages) {
						recordTaskEvent('task:message', {
							taskId: message.task_id,
							message: message.content ?? message.output ?? message.summary,
							summary: message.summary ?? message.type,
							timestamp: message.created_at,
						});
					}
				}
			} catch {
				/* history endpoints are optional during rollout */
			}
		}
	}, [aiSettings, orchestration.runs, recordTaskEvent, sessionPhase, workspaceId]);

	useEffect(() => {
		if (!workspaceId) {
			wsRef.current?.disconnect();
			wsRef.current = null;
			return;
		}
		if (sessionPhase !== 'ready') {
			return;
		}
		const client = new AiEmployeesWsClient(conn, workspaceId);
		wsRef.current = client;
		const unsubs: Array<() => void> = [
			client.onReconnect(() => {
				void softRefreshPayload();
				void syncOrchestrationHistory();
			}),
			client.on('issue:created', (_p, _a) => routeWsEventToRefresh('issue:created')),
			client.on('issue:updated', () => routeWsEventToRefresh('issue:updated')),
			client.on('issue:deleted', () => routeWsEventToRefresh('issue:deleted')),
			client.on('comment:created', (p) => {
				routeWsEventToRefresh('comment:created');
				setWsLog((l) => [`comment:created ${JSON.stringify(p).slice(0, 120)}`, ...l].slice(0, 40));
			}),
			client.on('comment:updated', () => routeWsEventToRefresh('comment:updated')),
			client.on('comment:deleted', () => routeWsEventToRefresh('comment:deleted')),
			client.on('agent:status', (p) => {
				routeWsEventToRefresh('agent:status');
				setWsLog((l) => [`agent:status ${JSON.stringify(p).slice(0, 100)}`, ...l].slice(0, 40));
			}),
			client.on('agent:created', () => routeWsEventToRefresh('agent:created')),
			client.on('agent:archived', () => routeWsEventToRefresh('agent:archived')),
			client.on('agent:restored', () => routeWsEventToRefresh('agent:restored')),
			client.on('skill:created', () => routeWsEventToRefresh('skill:created')),
			client.on('skill:updated', () => routeWsEventToRefresh('skill:updated')),
			client.on('skill:deleted', () => routeWsEventToRefresh('skill:deleted')),
			client.on('daemon:heartbeat', () => routeWsEventToRefresh('daemon:heartbeat')),
			client.on('daemon:register', () => routeWsEventToRefresh('daemon:register')),
			client.on('task:progress', (p) => {
				recordTaskEvent('task:progress', p);
				void refreshAgentsOnly();
			}),
			client.on('task:dispatch', (p) => {
				recordTaskEvent('task:dispatch', p);
				void refreshAgentsOnly();
			}),
			client.on('task:completed', (p) => {
				recordTaskEvent('task:completed', p);
				void refreshAgentsOnly();
			}),
			client.on('task:failed', (p) => {
				recordTaskEvent('task:failed', p);
				void refreshAgentsOnly();
			}),
			client.on('task:message', (p) => {
				recordTaskEvent('task:message', p);
			}),
			// Inbox events — bump version so subscribers re-fetch
			client.on('inbox:new', () => {
				setInboxVersion((v) => v + 1);
			}),
			client.on('inbox:read', () => {
				setInboxVersion((v) => v + 1);
			}),
			client.on('inbox:archived', () => {
				setInboxVersion((v) => v + 1);
			}),
			client.on('inbox:batch-read', () => {
				setInboxVersion((v) => v + 1);
			}),
			client.on('inbox:batch-archived', () => {
				setInboxVersion((v) => v + 1);
			}),
			// Chat events — bump version so subscribers re-fetch
			client.on('chat:message', () => {
				setChatVersion((v) => v + 1);
			}),
			client.on('chat:done', () => {
				setChatVersion((v) => v + 1);
			}),
			// Task approval events — bump inbox so approval requests appear
			client.on('task:approval-requested', () => {
				setInboxVersion((v) => v + 1);
			}),
			client.on('task:approved', () => {
				setInboxVersion((v) => v + 1);
			}),
			client.on('task:rejected', () => {
				setInboxVersion((v) => v + 1);
			}),
			// IM bridge: backend received a message on an employee's bot — generate reply with local model
			client.on('im:message', (p) => {
				const payload = p as {
					employeeId?: string;
					imProvider?: string;
					imChatId?: string;
					sessionId?: string;
					content?: string;
					sender?: string;
				};
				if (!payload.employeeId || !payload.content || !payload.imProvider || !payload.imChatId) {
					return;
				}
				const empId = payload.employeeId;
				const imProvider = payload.imProvider;
				const imChatId = payload.imChatId;
				const sessionId = payload.sessionId;
				const userMessage = payload.content;
				const senderName = payload.sender ?? 'User';

				// Inject user message into orchestration so the local model has context
				const nowIso = new Date().toISOString();
				const runId = `im:${empId}:${imChatId}`;
				persistOrchestration((state) => {
					// Ensure a run exists for this IM conversation
					let next = state;
					if (!next.runs.find((r) => r.id === runId)) {
						next = upsertRun(next, {
							...createDraftRun(`IM: ${senderName}`, undefined, nowIso, runId, {
								status: 'running',
								ownerEmployeeId: empId,
								currentAssigneeEmployeeId: empId,
								lastEventAtIso: nowIso,
							}),
							handoffs: [],
						});
					}
					next = appendCollabMessage(next, {
						id: crypto.randomUUID(),
						runId,
						type: 'text',
						toEmployeeId: empId,
						summary: userMessage.slice(0, 80),
						body: userMessage,
						createdAtIso: nowIso,
					});
					return next;
				});

				// Use the local model to generate a reply, then send it back
				(async () => {
					// Wait a tick for orchestration state to settle
					await new Promise((r) => setTimeout(r, 50));
					await requestEmployeeReplyRef.current?.(empId, runId);

					// After reply is generated (persisted in orchestration), find it and send to backend
					// The reply will be the last message from this employee
					await new Promise((r) => setTimeout(r, 500));
					const msgs = orchestrationRef.current.collabMessages
						.filter((m) => m.fromEmployeeId === empId && m.runId === runId)
						.sort((a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso));
					const lastReply = msgs[0];
					if (lastReply?.body) {
						try {
							await apiPostImReply(normConn(aiSettings), workspaceId, empId, {
								im_provider: imProvider,
								im_chat_id: imChatId,
								content: lastReply.body,
								session_id: sessionId,
							});
						} catch (e) {
							console.error('Failed to send IM reply:', e);
						}
					}
				})();
			}),
		];
		void syncOrchestrationHistory();
		client.connect();
		return () => {
			for (const u of unsubs) {
				u();
			}
			client.disconnect();
			wsRef.current = null;
		};
	}, [conn, sessionPhase, workspaceId, routeWsEventToRefresh, softRefreshPayload, refreshAgentsOnly, recordTaskEvent, syncOrchestrationHistory, persistOrchestration, appendCollabMessage, aiSettings]);

	const requestEmployeeReply = useCallback(
		async (employeeId: string, runId: string) => {
			if (!shell) {
				return;
			}
			if (employeeReplyGuardRef.current.has(employeeId)) {
				return;
			}
			const employee = employeeById.get(employeeId);
			if (!employee) {
				return;
			}
			const modelProbe = resolveEmployeeLocalModelId({
				employeeId,
				remoteAgentId: employee.linkedRemoteAgentId ?? undefined,
				agentLocalModelMap: aiSettings.agentLocalModelIdByRemoteAgentId,
				employeeLocalModelMap: aiSettings.employeeLocalModelIdByEmployeeId,
				defaultModelId: localModels.defaultModelId,
				modelOptionIds: modelOptionIdSet,
			});
			if (!modelProbe) {
				setEmployeeChatError((prev) => ({
					...prev,
					[employeeId]: 'No local model — bind one in Team tab.',
				}));
				const nowIso = new Date().toISOString();
				persistOrchestration((state) =>
					appendCollabMessage(state, {
						id: crypto.randomUUID(),
						runId,
						type: 'status_update',
						fromEmployeeId: employeeId,
						summary: 'No local model',
						body: 'Bind a local model for this teammate in the Team tab.',
						createdAtIso: nowIso,
					})
				);
				return;
			}
			employeeReplyGuardRef.current.add(employeeId);
			const requestId = crypto.randomUUID();
			const payload = buildEmployeeChatPayload(employee, runId, requestId);
			if (!payload) {
				employeeReplyGuardRef.current.delete(employeeId);
				maybeTriggerPendingCeoDigestsRef.current();
				return;
			}
			const isStreamCandidate = runId.startsWith('im:') || employeeId === ceoEmployeeId;
			const allowStream = isStreamCandidate && activeStreamOwnerRef.current === null;
			if (allowStream) {
				activeStreamOwnerRef.current = requestId;
			}
			pendingEmployeeChatRef.current.set(requestId, { employeeId, runId, allowStream });
			setEmployeeChatStreaming((prev) => ({ ...prev, [employeeId]: '' }));
			setEmployeeChatError((prev) => ({ ...prev, [employeeId]: undefined }));

			try {
				const result = (await shell.invoke('aiEmployees:chat', payload)) as {
					ok?: boolean;
					text?: string;
					error?: string;
				};
				if (pendingEmployeeChatRef.current.has(requestId)) {
					pendingEmployeeChatRef.current.delete(requestId);
					employeeReplyGuardRef.current.delete(employeeId);
					if (activeStreamOwnerRef.current === requestId) {
						activeStreamOwnerRef.current = null;
					}
					setEmployeeChatStreaming((prev) => {
						const next = { ...prev };
						delete next[employeeId];
						return next;
					});
					const text = result.text?.trim();
					if (result.ok && text) {
						const nowIso = new Date().toISOString();
						persistOrchestration((state) => {
							const message: AiCollabMessage = {
								id: crypto.randomUUID(),
								runId,
								type: 'text',
								fromEmployeeId: employeeId,
								summary: text.slice(0, 80),
								body: text,
								createdAtIso: nowIso,
							};
							let next = appendCollabMessage(state, message);
							next = appendTimelineEvent(next, {
								id: `message:${message.id}`,
								runId,
								type: 'message',
								label: message.summary,
								description: message.body,
								createdAtIso: nowIso,
								employeeId,
								source: 'local',
							});
							return next;
						});
					} else if (!result.ok && result.error) {
						setEmployeeChatError((prev) => ({ ...prev, [employeeId]: result.error }));
						const nowIso = new Date().toISOString();
						persistOrchestration((state) =>
							appendCollabMessage(state, {
								id: crypto.randomUUID(),
								runId,
								type: 'status_update',
								fromEmployeeId: employeeId,
								summary: 'Reply failed',
								body: result.error ?? '',
								createdAtIso: nowIso,
							})
						);
					}
					maybeTriggerPendingCeoDigestsRef.current();
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				pendingEmployeeChatRef.current.delete(requestId);
				employeeReplyGuardRef.current.delete(employeeId);
				if (activeStreamOwnerRef.current === requestId) {
					activeStreamOwnerRef.current = null;
				}
				setEmployeeChatStreaming((prev) => {
					const next = { ...prev };
					delete next[employeeId];
					return next;
				});
				setEmployeeChatError((prev) => ({ ...prev, [employeeId]: msg }));
				const nowIso = new Date().toISOString();
				persistOrchestration((state) =>
					appendCollabMessage(state, {
						id: crypto.randomUUID(),
						runId,
						type: 'status_update',
						fromEmployeeId: employeeId,
						summary: 'Reply failed',
						body: msg,
						createdAtIso: nowIso,
					})
				);
				maybeTriggerPendingCeoDigestsRef.current();
			}
		},
		[
			shell,
			employeeById,
			aiSettings.agentLocalModelIdByRemoteAgentId,
			aiSettings.employeeLocalModelIdByEmployeeId,
			localModels.defaultModelId,
			modelOptionIdSet,
			persistOrchestration,
			appendCollabMessage,
			appendTimelineEvent,
			buildEmployeeChatPayload,
			ceoEmployeeId,
		]
	);
	requestEmployeeReplyRef.current = requestEmployeeReply;

	const maybeTriggerCeoDigest = useCallback(
		(runId: string) => {
			const ceoId = orgEmployees.find((e) => e.isCeo)?.id;
			if (!ceoId) {
				return;
			}
			const run = orchestrationRef.current.runs.find((r) => r.id === runId);
			if (!run) {
				pendingCeoDigestRunIdsRef.current.delete(runId);
				return;
			}
			const jobs = run.subAgentJobs ?? [];
			const digestTargets = jobs.filter(
				(j) => (j.status === 'done' || j.status === 'error' || j.status === 'blocked') && !j.ceoIngested
			);
			if (digestTargets.length === 0) {
				pendingCeoDigestRunIdsRef.current.delete(runId);
				return;
			}
			if (
				hasPendingRunSubAgentWork(runId, subAgentQueueRef.current, activeSubAgentItemsRef.current) ||
				employeeReplyGuardRef.current.has(ceoId)
			) {
				pendingCeoDigestRunIdsRef.current.add(runId);
				return;
			}
			pendingCeoDigestRunIdsRef.current.delete(runId);
			const block =
				'[Sub-agent results — synthesize a concise update for the boss]\n\n' +
				digestTargets.map((j) => {
						if (j.status === 'done') {
							return `### ${j.employeeName}: ${j.taskTitle}\n${j.resultSummary ?? ''}`;
						}
						const label = j.status === 'blocked' ? 'blocked' : 'failed';
						const detail = j.errorMessage ?? j.resultSummary ?? '';
						return `### ${j.employeeName} (${label}): ${j.taskTitle}\n${detail}`;
					}).join('\n\n');
			const nowIso = new Date().toISOString();
			persistOrchestration((state) => {
				let next = appendCollabMessage(state, {
					id: crypto.randomUUID(),
					runId,
					type: 'status_update',
					summary: 'Team sub-results',
					body: block,
					createdAtIso: nowIso,
					internalOnly: true,
				});
				for (const j of digestTargets) {
					next = updateSubAgentJobInRun(next, runId, j.id, (job) => ({ ...job, ceoIngested: true }));
				}
				return next;
			});
			window.setTimeout(() => {
				void requestEmployeeReplyRef.current?.(ceoId, runId);
			}, 0);
		},
		[appendCollabMessage, orgEmployees, persistOrchestration]
	);

	const maybeTriggerPendingCeoDigests = useCallback(() => {
		for (const runId of [...pendingCeoDigestRunIdsRef.current]) {
			maybeTriggerCeoDigest(runId);
		}
	}, [maybeTriggerCeoDigest]);

	const processSubAgentQueue = useCallback(() => {
		if (!shell) {
			return;
		}
		while (activeSubAgentCountRef.current < SUB_AGENT_MAX_CONCURRENCY && subAgentQueueRef.current.length > 0) {
			const item = subAgentQueueRef.current.shift();
			if (!item) {
				break;
			}
			activeSubAgentCountRef.current++;
			activeSubAgentItemsRef.current.push(item);
			void (async () => {
				const rid = item.runId;
				try {
					const employee = employeeById.get(item.employeeId);
					if (!employee) {
						return;
					}
					if (item.kind === 'delegated') {
						const { jobId, employeeId } = item;
						const markIso = new Date().toISOString();
						persistOrchestration((s) => {
							let next = updateSubAgentJobInRun(s, rid, jobId, (j) => ({
								...j,
								status: 'running',
								startedAtIso: j.startedAtIso ?? markIso,
							}));
							const msg = next.collabMessages.find((m) => m.id === jobId);
							if (msg) {
								next = upsertCollabMessageInState(next, {
									...msg,
									cardMeta: { ...msg.cardMeta, status: 'in_progress', handoffId: jobId },
								});
							}
							return next;
						});
						const requestId = crypto.randomUUID();
						const payload = buildEmployeeChatPayload(employee, rid, requestId);
						if (!payload) {
							const errIso = new Date().toISOString();
							persistOrchestration((s) =>
								updateSubAgentJobInRun(s, rid, jobId, (j) => ({
									...j,
									status: 'error',
									completedAtIso: errIso,
									errorMessage: 'Missing model or empty history for this teammate.',
								}))
							);
							return;
						}
						const raw = (await shell.invoke('aiEmployees:runSubAgent', payload)) as SubAgentIpcOk | SubAgentIpcErr;
						if (raw.ok) {
							const doneIso = new Date().toISOString();
							const terminalAction = pickTerminalSubAgentAction(raw.collabActions);
							const followUpActions = filterFollowUpSubAgentActions(raw.collabActions);
							if (terminalAction?.tool === 'report_blocker') {
								const blockerText = terminalAction.description.trim() || 'Blocked';
								const blockerBody = terminalAction.suggestedHelperName
									? `${blockerText}\n\nSuggested helper: ${terminalAction.suggestedHelperName}`
									: blockerText;
								persistOrchestration((s) => {
									let next = updateSubAgentJobInRun(s, rid, jobId, (j) => ({
										...j,
										status: 'blocked',
										toolLog: raw.toolLog,
										errorMessage: blockerText,
										completedAtIso: doneIso,
									}));
									next = setHandoffStatusInState(next, rid, jobId, 'blocked', {
										blockedReason: blockerText,
										atIso: doneIso,
									});
									const assignMsg = next.collabMessages.find((m) => m.id === jobId);
									if (assignMsg) {
										next = upsertCollabMessageInState(next, {
											...assignMsg,
											cardMeta: { ...assignMsg.cardMeta, status: 'blocked', handoffId: jobId },
										});
									}
									const blockerId = crypto.randomUUID();
									next = appendCollabMessage(next, {
										id: blockerId,
										runId: rid,
										type: 'blocker',
										fromEmployeeId: employeeId,
										toEmployeeId: ceoEmployeeId,
										subAgentJobId: jobId,
										summary: `${employee.displayName} blocked: ${blockerText.slice(0, 60)}`,
										body: blockerBody,
										createdAtIso: doneIso,
										cardMeta: { status: 'blocked', handoffId: jobId },
									});
									next = appendTimelineEvent(next, {
										id: `message:${blockerId}`,
										runId: rid,
										type: 'message',
										label: `${employee.displayName} is blocked`,
										description: blockerText,
										createdAtIso: doneIso,
										employeeId,
										source: 'local',
									});
									return next;
								});
								if (terminalAction.suggestedHelperName) {
									const helper = resolveEmployeeByName(terminalAction.suggestedHelperName);
									if (helper) {
										subAgentQueueRef.current.push({ kind: 'colleague', runId: rid, employeeId: helper.id });
										processSubAgentQueueRef.current();
									}
								}
							} else {
								const summaryText =
									terminalAction?.tool === 'submit_result'
										? terminalAction.summary.trim() || raw.resultText?.trim() || '(completed)'
										: raw.resultText?.trim() || '(completed)';
								const resultBody =
									terminalAction?.tool === 'submit_result'
										? [
												summaryText,
												terminalAction.modifiedFiles.length
													? `Modified: ${terminalAction.modifiedFiles.join(', ')}`
													: '',
												terminalAction.nextSteps ? `Next steps: ${terminalAction.nextSteps}` : '',
											].filter(Boolean).join('\n')
										: summaryText;
								persistOrchestration((s) => {
									let next = updateSubAgentJobInRun(s, rid, jobId, (j) => ({
										...j,
										status: 'done',
										toolLog: raw.toolLog,
										resultSummary: summaryText,
										completedAtIso: doneIso,
									}));
									next = setHandoffStatusInState(next, rid, jobId, 'done', {
										resultSummary: summaryText,
										atIso: doneIso,
									});
									const assignMsg = next.collabMessages.find((m) => m.id === jobId);
									if (assignMsg) {
										next = upsertCollabMessageInState(next, {
											...assignMsg,
											cardMeta: { ...assignMsg.cardMeta, status: 'done', handoffId: jobId },
										});
									}
									const resultId = crypto.randomUUID();
									next = appendCollabMessage(next, {
										id: resultId,
										runId: rid,
										type: 'result',
										fromEmployeeId: employeeId,
										toEmployeeId: ceoEmployeeId,
										subAgentJobId: jobId,
										summary: `${employee.displayName} · ${summaryText.slice(0, 72)}`,
										body: resultBody,
										createdAtIso: doneIso,
										cardMeta: { status: 'done', handoffId: jobId },
									});
									next = appendTimelineEvent(next, {
										id: `message:${resultId}`,
										runId: rid,
										type: 'result',
										label: `${employee.displayName} completed task`,
										description: summaryText,
										createdAtIso: doneIso,
										employeeId,
										source: 'local',
									});
									return next;
								});
							}
							for (const action of followUpActions) {
								handleCollabActionRef.current?.(employeeId, rid, action);
							}
						} else {
							const errIso = new Date().toISOString();
							persistOrchestration((s) => {
								let next = updateSubAgentJobInRun(s, rid, jobId, (j) => ({
									...j,
									status: 'error',
									completedAtIso: errIso,
									errorMessage: raw.error,
									toolLog: raw.toolLog,
								}));
								next = setHandoffStatusInState(next, rid, jobId, 'blocked', {
									blockedReason: raw.error,
									atIso: errIso,
								});
								const assignMsg = next.collabMessages.find((m) => m.id === jobId);
								if (assignMsg) {
									next = upsertCollabMessageInState(next, {
										...assignMsg,
										cardMeta: { ...assignMsg.cardMeta, status: 'blocked', handoffId: jobId },
									});
								}
								return next;
							});
						}
					} else {
						const requestId = crypto.randomUUID();
						const payload = buildEmployeeChatPayload(employee, rid, requestId);
						if (!payload) {
							return;
						}
						const raw = (await shell.invoke('aiEmployees:runSubAgent', payload)) as SubAgentIpcOk | SubAgentIpcErr;
						if (raw.ok) {
							const text = raw.resultText.trim();
							if (text) {
								const nowIso = new Date().toISOString();
								persistOrchestration((s) => {
									const message: AiCollabMessage = {
										id: crypto.randomUUID(),
										runId: rid,
										type: 'text',
										fromEmployeeId: item.employeeId,
										summary: text.slice(0, 80),
										body: text,
										createdAtIso: nowIso,
									};
									let next = appendCollabMessage(s, message);
									next = appendTimelineEvent(next, {
										id: `message:${message.id}`,
										runId: rid,
										type: 'message',
										label: message.summary,
										description: message.body,
										createdAtIso: nowIso,
										employeeId: item.employeeId,
										source: 'local',
									});
									return next;
								});
							}
							for (const action of raw.collabActions) {
								handleCollabActionRef.current?.(item.employeeId, rid, action);
							}
						}
					}
				} finally {
					activeSubAgentCountRef.current -= 1;
					activeSubAgentItemsRef.current = activeSubAgentItemsRef.current.filter((activeItem) => activeItem !== item);
					processSubAgentQueue();
					maybeTriggerCeoDigest(rid);
				}
			})();
		}
	}, [
		appendCollabMessage,
		appendTimelineEvent,
		buildEmployeeChatPayload,
		ceoEmployeeId,
		employeeById,
		maybeTriggerCeoDigest,
		persistOrchestration,
		resolveEmployeeByName,
		shell,
	]);

	useLayoutEffect(() => {
		handleCollabActionRef.current = handleCollabAction;
		processSubAgentQueueRef.current = processSubAgentQueue;
		maybeTriggerPendingCeoDigestsRef.current = maybeTriggerPendingCeoDigests;
	}, [handleCollabAction, maybeTriggerPendingCeoDigests, processSubAgentQueue]);

	const bindAgentLocalModel = useCallback(
		(agentId: string, modelEntryId: string) => {
			const nextMap = { ...(aiSettings.agentLocalModelIdByRemoteAgentId ?? {}), [agentId]: modelEntryId };
			persistAiSettings({ ...aiSettings, agentLocalModelIdByRemoteAgentId: nextMap });
		},
		[aiSettings, persistAiSettings]
	);

	const clearAgentLocalModel = useCallback(
		(agentId: string) => {
			const nextMap = { ...(aiSettings.agentLocalModelIdByRemoteAgentId ?? {}) };
			delete nextMap[agentId];
			persistAiSettings({ ...aiSettings, agentLocalModelIdByRemoteAgentId: nextMap });
		},
		[aiSettings, persistAiSettings]
	);

	const bindEmployeeLocalModel = useCallback(
		(employeeId: string, modelEntryId: string) => {
			const nextMap = { ...(aiSettings.employeeLocalModelIdByEmployeeId ?? {}), [employeeId]: modelEntryId };
			persistAiSettings({ ...aiSettings, employeeLocalModelIdByEmployeeId: nextMap });
		},
		[aiSettings, persistAiSettings]
	);

	const clearEmployeeLocalModel = useCallback(
		(employeeId: string) => {
			const nextMap = { ...(aiSettings.employeeLocalModelIdByEmployeeId ?? {}) };
			delete nextMap[employeeId];
			persistAiSettings({ ...aiSettings, employeeLocalModelIdByEmployeeId: nextMap });
		},
		[aiSettings, persistAiSettings]
	);

	const resetWorkspaceTeamBootstrap = useCallback(async () => {
		const wid = workspaceId;
		if (!wid) {
			return;
		}
		const c = normConn(aiSettings);
		for (const employee of orgEmployees) {
			clearEmployeeLocalModel(employee.id);
		}
		await apiPostBootstrapReset(c, wid);
		await syncOnboardingAfterMutation();
	}, [aiSettings, workspaceId, orgEmployees, clearEmployeeLocalModel, syncOnboardingAfterMutation]);

	const saveConnectionAndReconnect = useCallback(() => {
		const next: AiEmployeesSettings = {
			...aiSettings,
			apiBaseUrl: aiSettings.apiBaseUrl ?? DEFAULT_API,
			wsBaseUrl: aiSettings.wsBaseUrl ?? DEFAULT_WS,
			token: aiSettings.token ?? 'dev',
		};
		persistAiSettings(next);
		setHoldSetupDuringBootstrap(true);
		void refreshData(normConn(next), next).finally(() => {
			setHoldSetupDuringBootstrap(false);
		});
	}, [aiSettings, persistAiSettings, refreshData]);

	const backToWorkspacePicker = useCallback(() => {
		setWorkspaceId('');
		setIssues([]);
		setProjects([]);
		setMyIssues([]);
		setAgents([]);
		setSkills([]);
		setRuntimes([]);
		setWorkspaceMembers([]);
		setBootstrapStatus(null);
		setOrgEmployees([]);
		setOnboardingStep('pick_workspace');
		setOnboardingErr(null);
		setConnectRefreshFailed(false);
	}, []);

	const pickWorkspaceAndRefresh = useCallback(
		async (id: string) => {
			setWorkspaceId(id);
			if (!id) {
				setIssues([]);
				setProjects([]);
				setMyIssues([]);
				setAgents([]);
				setSkills([]);
				setRuntimes([]);
				setWorkspaceMembers([]);
				return;
			}
			const c = normConn(aiSettings);
			await fetchWorkspacePayload(c, id);
			await applyWorkspaceBootstrap(c, id, workspaces.length);
			setConnectRefreshFailed(false);
		},
		[aiSettings, applyWorkspaceBootstrap, fetchWorkspacePayload, workspaces.length]
	);

	const pickLocalWorkspaceFolder = useCallback(async (): Promise<{ ok: boolean }> => {
		if (!shell) {
			return { ok: false };
		}
		const r = (await shell.invoke('workspace:pickFolder')) as { ok?: boolean; path?: string };
		return { ok: Boolean(r.ok && r.path) };
	}, [shell]);

	const onWorkspaceSelectChange = useCallback(
		(id: string) => {
			if (!id) {
				setWorkspaceId('');
				setIssues([]);
				setProjects([]);
				setMyIssues([]);
				setAgents([]);
				setSkills([]);
				setRuntimes([]);
				setWorkspaceMembers([]);
				return;
			}
			if (sessionPhase === 'ready' || sessionPhase === 'onboarding') {
				void pickWorkspaceAndRefresh(id).catch((e) => {
					publishAiEmployeesNetworkError(e instanceof Error ? e.message : String(e));
				});
			} else {
				setWorkspaceId(id);
			}
		},
		[pickWorkspaceAndRefresh, sessionPhase]
	);

	const upsertCatalogEntry = useCallback(
		(entry: AiEmployeeCatalogEntry) => {
			setAiSettings((prev) => {
				const list = [...(prev.employeeCatalog ?? [])];
				const i = list.findIndex((e) => e.id === entry.id);
				if (i >= 0) {
					list[i] = entry;
				} else {
					list.push(entry);
				}
				const next = { ...prev, employeeCatalog: list };
				void shell?.invoke('settings:set', { aiEmployees: next });
				return next;
			});
		},
		[shell]
	);

	const removeCatalogEntry = useCallback(
		(id: string) => {
			setAiSettings((prev) => {
				const list = (prev.employeeCatalog ?? []).filter((e) => e.id !== id);
				const next = { ...prev, employeeCatalog: list };
				void shell?.invoke('settings:set', { aiEmployees: next });
				return next;
			});
		},
		[shell]
	);

	const createOrchestrationRun = useCallback(
		(
			goal: string,
			targetBranch: string,
			options?: {
				ownerEmployeeId?: string;
				initialAssigneeEmployeeId?: string;
				note?: string;
				initialMessage?: string;
				messageType?: AiCollabMessageType;
			}
		): { runId: string; taskAssignmentMessageId?: string } => {
			const nowIso = new Date().toISOString();
			const runId = crypto.randomUUID();
			const ownerEmployeeId = options?.ownerEmployeeId ?? fallbackOwnerEmployeeId;
			const taskAssignmentMessageId = options?.initialMessage?.trim() ? crypto.randomUUID() : undefined;
			persistOrchestration((state) => {
				let next = upsertRun(
					state,
					{
						...createDraftRun(goal, targetBranch || undefined, nowIso, runId, {
							status: 'running',
							ownerEmployeeId,
							currentAssigneeEmployeeId: options?.initialAssigneeEmployeeId,
							statusSummary: goal.trim(),
							lastEventAtIso: nowIso,
						}),
					}
				);
				next = appendTimelineEvent(next, {
					id: `run:${runId}:created`,
					runId,
					type: 'run_created',
					label: 'Run created',
					description: goal.trim(),
					createdAtIso: nowIso,
					employeeId: ownerEmployeeId,
					source: 'local',
				});
				if (options?.initialAssigneeEmployeeId) {
					const handoffId = crypto.randomUUID();
					next = addHandoffToRunInState(next, runId, {
						id: handoffId,
						fromEmployeeId: ownerEmployeeId,
						toEmployeeId: options.initialAssigneeEmployeeId,
						status: 'in_progress',
						note: options.note?.trim() || undefined,
						atIso: nowIso,
					});
					next = appendTimelineEvent(next, {
						id: `handoff:${handoffId}:created`,
						runId,
						type: 'handoff_added',
						label: `Assigned to ${employeeDisplayName(options.initialAssigneeEmployeeId)}`,
						description: options.note?.trim() || undefined,
						createdAtIso: nowIso,
						handoffId,
						employeeId: options.initialAssigneeEmployeeId,
						source: 'local',
					});
					if (options.initialMessage?.trim()) {
						next = appendCollabMessage(next, {
							id: taskAssignmentMessageId!,
							runId,
							type: options.messageType ?? 'task_assignment',
							fromEmployeeId: ownerEmployeeId,
							toEmployeeId: options.initialAssigneeEmployeeId,
							summary: goal.trim(),
							body: options.initialMessage.trim(),
							createdAtIso: nowIso,
						});
					}
				}
				return next;
			});
			return { runId, taskAssignmentMessageId };
		},
		[appendCollabMessage, appendTimelineEvent, employeeDisplayName, fallbackOwnerEmployeeId, persistOrchestration]
	);

	const approveOrchestrationGit = useCallback(
		async (runId: string) => {
			const orch = aiSettings.orchestration ?? emptyOrchestrationState();
			const run = orch.runs.find((r) => r.id === runId);
			if (!run?.targetBranch) {
				return { ok: false as const, error: 'no-branch' };
			}
			const r = await requestCommitToBranch(shell, {
				workspaceRoot: localRoot,
				targetBranch: run.targetBranch,
				message: formatOrchestrationCommitMessage(run),
			});
			if (!r.ok) {
				return r;
			}
			const nextOrch = approveGitForRun(orch, runId);
			persistAiSettings({ ...aiSettings, orchestration: nextOrch });
			return { ok: true as const };
		},
		[aiSettings, localRoot, persistAiSettings, shell]
	);

	const addOrchestrationHandoff = useCallback(
		(runId: string, toEmployeeId: string, note?: string, messageBody?: string) => {
			const nowIso = new Date().toISOString();
			persistOrchestration((orch) => {
				const run = orch.runs.find((candidate) => candidate.id === runId);
				if (!run) {
					return orch;
				}
				const handoff: AiOrchestrationHandoff = {
					id: crypto.randomUUID(),
					fromEmployeeId: run.currentAssigneeEmployeeId ?? run.ownerEmployeeId,
					toEmployeeId,
					status: 'in_progress',
					note: note?.trim() || undefined,
					atIso: nowIso,
				};
				let next = addHandoffToRunInState(orch, runId, handoff);
				next = appendTimelineEvent(next, {
					id: `handoff:${handoff.id}:created`,
					runId,
					type: 'handoff_added',
					label: `Assigned to ${employeeDisplayName(toEmployeeId)}`,
					description: handoff.note,
					createdAtIso: nowIso,
					handoffId: handoff.id,
					employeeId: toEmployeeId,
					source: 'local',
				});
				const collabBody = messageBody?.trim() || note?.trim();
				if (collabBody) {
					const summary = note?.trim() || `Handoff to ${employeeDisplayName(toEmployeeId)}`;
					const messageId = crypto.randomUUID();
					next = appendCollabMessage(next, {
						id: messageId,
						runId,
						type: 'handoff_request',
						fromEmployeeId: handoff.fromEmployeeId,
						toEmployeeId,
						summary,
						body: collabBody,
						createdAtIso: nowIso,
					});
					next = appendTimelineEvent(next, {
						id: `message:${messageId}`,
						runId,
						type: 'message',
						label: summary,
						description: collabBody,
						createdAtIso: nowIso,
						employeeId: toEmployeeId,
						source: 'local',
					});
				}
				return next;
			});
		},
		[appendCollabMessage, appendTimelineEvent, employeeDisplayName, persistOrchestration]
	);

	const setOrchestrationHandoffStatus = useCallback(
		(runId: string, handoffId: string, status: AiOrchestrationHandoffStatus) => {
			const nowIso = new Date().toISOString();
			persistOrchestration((orch) => {
				const next = setHandoffStatusInState(orch, runId, handoffId, status, { atIso: nowIso });
				return appendTimelineEvent(next, {
					id: `handoff:${handoffId}:${status}:${nowIso}`,
					runId,
					type: 'handoff_status',
					label: `Handoff ${status.replace('_', ' ')}`,
					createdAtIso: nowIso,
					handoffId,
					status,
					source: 'local',
				});
			});
		},
		[persistOrchestration, appendTimelineEvent]
	);

	const sendCollabMessage = useCallback(
		(input: {
			runId: string;
			type?: AiCollabMessageType;
			body: string;
			summary?: string;
			fromEmployeeId?: string;
			toEmployeeId?: string;
			taskId?: string;
		}) => {
			const body = input.body.trim();
			if (!body) {
				return;
			}
			const nowIso = new Date().toISOString();
			const message: AiCollabMessage = {
				id: crypto.randomUUID(),
				runId: input.runId,
				type: input.type ?? 'text',
				fromEmployeeId: input.fromEmployeeId,
				toEmployeeId: input.toEmployeeId,
				summary: input.summary?.trim() || body.slice(0, 80),
				body,
				taskId: input.taskId,
				createdAtIso: nowIso,
			};
			persistOrchestration((state) => {
				let next = appendCollabMessage(state, message);
				next = appendTimelineEvent(next, {
					id: `message:${message.id}`,
					runId: message.runId,
					type: 'message',
					label: message.summary,
					description: message.body,
					createdAtIso: nowIso,
					taskId: message.taskId,
					employeeId: message.toEmployeeId,
					source: 'local',
				});
				return next;
			});
			if (input.toEmployeeId) {
				const empId = input.toEmployeeId;
				const rid = input.runId;
				window.setTimeout(() => {
					if (empId === ceoEmployeeId) {
						void requestEmployeeReply(empId, rid);
					} else {
						subAgentQueueRef.current.push({ kind: 'colleague', runId: rid, employeeId: empId });
						processSubAgentQueueRef.current();
					}
				}, 0);
			}
		},
		[appendCollabMessage, appendTimelineEvent, ceoEmployeeId, persistOrchestration, requestEmployeeReply]
	);

	const createGroupChatRun = useCallback(
		(title: string) => {
			const ceoId = orgEmployees.find((e) => e.isCeo)?.id;
			if (!ceoId) {
				return '';
			}
			const goal = title.trim() || 'Conversation';
			const { runId } = createOrchestrationRun(goal, '', { ownerEmployeeId: ceoId });
			return runId;
		},
		[createOrchestrationRun, orgEmployees]
	);

	const markCollabMessageRead = useCallback(
		(messageId: string) => {
			persistOrchestration((state) => markCollabMessageReadInState(state, messageId, new Date().toISOString()));
		},
		[persistOrchestration]
	);

	const listMessagesByEmployee = useCallback(
		(employeeId: string) =>
			orchestration.collabMessages.filter(
				(message) => message.toEmployeeId === employeeId || message.fromEmployeeId === employeeId
			),
		[orchestration.collabMessages]
	);

	const listMessagesByRun = useCallback(
		(runId: string) =>
			orchestration.collabMessages.filter((message) => message.runId === runId && !message.internalOnly),
		[orchestration.collabMessages]
	);

	const listTimelineEventsByRun = useCallback(
		(runId: string) => orchestration.timelineEvents.filter((event) => event.runId === runId),
		[orchestration.timelineEvents]
	);

	const openActivityForRun = useCallback((focus: ActivityFocusState) => {
		setActivityFocus(focus);
		setTab('activity');
	}, []);

	const clearActivityFocus = useCallback(() => {
		setActivityFocus(null);
	}, []);

	const findActiveRunByEmployee = useCallback(
		(employeeId: string) =>
			orchestration.runs
				.filter(isOrchestrationRunIncomplete)
				.filter((run) => employeeHasActiveRunInvolvement(employeeId, run))
				.sort((a, b) => Date.parse(b.lastEventAtIso ?? b.createdAtIso) - Date.parse(a.lastEventAtIso ?? a.createdAtIso))[0],
		[orchestration.runs]
	);

	const createEmployeeRun = useCallback(
		(
			employeeId: string,
			title: string,
			details: string,
			targetBranch: string,
			options?: { assignmentBody?: string }
		) => {
			const employeeName = employeeDisplayName(employeeId);
			const cleanTitle = title.trim();
			const cleanDetails = details.trim();
			const assignmentBody = options?.assignmentBody?.trim();
			const goal = cleanDetails ? `[${employeeName}] ${cleanTitle} — ${cleanDetails}` : `[${employeeName}] ${cleanTitle}`;
			const { runId, taskAssignmentMessageId } = createOrchestrationRun(goal, targetBranch, {
				initialAssigneeEmployeeId: employeeId,
				note: cleanTitle,
				initialMessage: assignmentBody || cleanDetails || cleanTitle,
				messageType: 'task_assignment',
			});
			const wid = workspaceId;
			const emp = employeeById.get(employeeId);
			const agentId = emp?.linkedRemoteAgentId;
			if (wid && agentId && taskAssignmentMessageId) {
				void (async () => {
					try {
						const issue = await apiCreateIssue(normConn(aiSettings), wid, {
							title: cleanTitle,
							description: cleanDetails || undefined,
							assignee_type: 'agent',
							assignee_id: agentId,
							status: 'todo',
						});
						await refreshIssuesOnly();
						persistOrchestration((state) => {
							let next = setRunIssueInState(state, runId, issue.id);
							const msg = next.collabMessages.find((m) => m.id === taskAssignmentMessageId);
							if (msg) {
								next = upsertCollabMessageInState(next, {
									...msg,
									cardMeta: { ...msg.cardMeta, issueId: issue.id, issueTitle: issue.title },
								});
							}
							return next;
						});
					} catch {
						/* 离线或权限失败时忽略，协作消息仍保留 */
					}
				})();
			}
			window.setTimeout(() => {
				void requestEmployeeReply(employeeId, runId);
			}, 0);
			return runId;
		},
		[
			aiSettings,
			createOrchestrationRun,
			employeeById,
			employeeDisplayName,
			persistOrchestration,
			refreshIssuesOnly,
			requestEmployeeReply,
			workspaceId,
		]
	);

	const patchWorkspaceIssue = useCallback(
		async (issueId: string, patch: Record<string, unknown>) => {
			const wid = workspaceId;
			if (!wid) {
				throw new Error('No workspace selected');
			}
			await apiPatchIssue(normConn(aiSettings), wid, issueId, patch);
			await Promise.all([refreshIssuesOnly(), refreshProjectsOnly()]);
		},
		[aiSettings, refreshIssuesOnly, refreshProjectsOnly, workspaceId]
	);

	const createWorkspaceIssue = useCallback(
		async (payload: CreateIssuePayload): Promise<IssueJson> => {
			const wid = workspaceId;
			if (!wid) {
				throw new Error('No workspace selected');
			}
			const issue = await apiCreateIssue(normConn(aiSettings), wid, payload);
			await Promise.all([refreshIssuesOnly(), refreshProjectsOnly()]);
			return issue;
		},
		[aiSettings, refreshIssuesOnly, refreshProjectsOnly, workspaceId]
	);

	const deleteWorkspaceIssue = useCallback(
		async (issueId: string) => {
			const wid = workspaceId;
			if (!wid) {
				throw new Error('No workspace selected');
			}
			await apiDeleteIssue(normConn(aiSettings), wid, issueId);
			await Promise.all([refreshIssuesOnly(), refreshProjectsOnly()]);
		},
		[aiSettings, refreshIssuesOnly, refreshProjectsOnly, workspaceId]
	);

	const createWorkspaceProject = useCallback(
		async (body: CreateProjectPayload): Promise<ProjectJson> => {
			const wid = workspaceId;
			if (!wid) {
				throw new Error('No workspace selected');
			}
			const p = await apiCreateProject(normConn(aiSettings), wid, body);
			await refreshProjectsOnly();
			return p;
		},
		[aiSettings, refreshProjectsOnly, workspaceId]
	);

	const updateWorkspaceProject = useCallback(
		async (projectId: string, body: UpdateProjectPayload): Promise<ProjectJson> => {
			const wid = workspaceId;
			if (!wid) {
				throw new Error('No workspace selected');
			}
			const p = await apiUpdateProject(normConn(aiSettings), wid, projectId, body);
			await refreshProjectsOnly();
			return p;
		},
		[aiSettings, refreshProjectsOnly, workspaceId]
	);

	const deleteWorkspaceProject = useCallback(
		async (projectId: string) => {
			const wid = workspaceId;
			if (!wid) {
				throw new Error('No workspace selected');
			}
			await apiDeleteProject(normConn(aiSettings), wid, projectId);
			await Promise.all([refreshProjectsOnly(), refreshIssuesOnly()]);
		},
		[aiSettings, refreshIssuesOnly, refreshProjectsOnly, workspaceId]
	);

	return {
		shell,
		DEFAULT_API,
		DEFAULT_WS,
		appearanceSettings,
		setAppearanceSettings,
		localRoot,
		aiSettings,
		setAiSettings,
		tab,
		setTab,
		activityFocus,
		openActivityForRun,
		clearActivityFocus,
		createIssueSignal,
		requestCreateIssue,
		workspaceId,
		workspaces,
		issues,
		projects,
		myIssues,
		agents,
		skills,
		runtimes,
		workspaceMembers,
		meLabel,
		meProfile,
		sessionPhase,
		holdSetupDuringBootstrap,
		localModels,
		connectRefreshFailed,
		clearConnectRefreshFailed,
		wsLog,
		taskEvents,
		timelineEvents: orchestration.timelineEvents,
		collabMessages: orchestration.collabMessages,
		conn,
		effectiveScheme,
		persistAiSettings,
		refreshDataRef,
		softRefreshPayload,
		modelOptions,
		modelOptionIdSet,
		bindAgentLocalModel,
		clearAgentLocalModel,
		bindEmployeeLocalModel,
		clearEmployeeLocalModel,
		saveConnectionAndReconnect,
		onWorkspaceSelectChange,
		upsertCatalogEntry,
		removeCatalogEntry,
		orchestration,
		createOrchestrationRun,
		createEmployeeRun,
		createGroupChatRun,
		ceoEmployeeId,
		approveOrchestrationGit,
		addOrchestrationHandoff,
		setOrchestrationHandoffStatus,
		sendCollabMessage,
		markCollabMessageRead,
		listMessagesByEmployee,
		listMessagesByRun,
		listTimelineEventsByRun,
		findActiveRunByEmployee,
		patchWorkspaceIssue,
		createWorkspaceIssue,
		deleteWorkspaceIssue,
		createWorkspaceProject,
		updateWorkspaceProject,
		deleteWorkspaceProject,
		refreshProjectsOnly,
		refreshSkillsOnly,
		employeeCatalog: aiSettings.employeeCatalog ?? [],
		inboxVersion,
		chatVersion,
		employeeChatStreaming,
		employeeChatError,
		bootstrapStatus,
		onboardingStep,
		setOnboardingStep,
		onboardingErr,
		setOnboardingErr,
		promptTemplates,
		orgEmployees,
		syncOnboardingAfterMutation,
		loadPromptTemplatesForOnboarding,
		refreshOrgEmployeesList,
		pickWorkspaceAndRefresh,
		pickLocalWorkspaceFolder,
		backToWorkspacePicker,
		resetWorkspaceTeamBootstrap,
	};
}
