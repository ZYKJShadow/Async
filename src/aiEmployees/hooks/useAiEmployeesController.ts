import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
	applyAppearanceSettingsToDom,
	defaultAppearanceSettings,
	nativeWindowChromeFromAppearance,
	type AppAppearanceSettings,
} from '../../appearanceSettings';
import { readPrefersDark, readStoredColorMode, resolveEffectiveScheme } from '../../colorMode';
import { hideBootSplash } from '../../bootSplash';
import type { AiEmployeesSettings, AiEmployeeCatalogEntry, AiOrchestrationRun } from '../../../shared/aiEmployeesSettings';
import { DEFAULT_API, DEFAULT_WS, normConn } from '../domain/connection';
import { pickWorkspaceId, resolveMappedWorkspace } from '../domain/workspacePaths';
import {
	approveGitForRun,
	createDraftRun,
	emptyOrchestrationState,
	upsertRun,
} from '../domain/orchestration';
import { buildModelOptions } from '../adapters/modelAdapter';
import { formatOrchestrationCommitMessage, requestCommitToBranch } from '../adapters/gitAdapter';
import {
	type AiEmployeesConnection,
	AiEmployeesApiError,
	apiGetMe,
	apiListAgents,
	apiListIssues,
	apiListRuntimes,
	apiListSkills,
	apiListWorkspaces,
} from '../api/client';
import {
	apiGetBootstrapStatus,
	apiListOrgEmployees,
	apiListPromptTemplates,
	apiPostBootstrapReset,
} from '../api/orgClient';
import type { OrgBootstrapStatus, OrgEmployee, OrgPromptTemplate } from '../api/orgTypes';
import { AiEmployeesWsClient } from '../api/ws';
import type { AgentJson, IssueJson, RuntimeJson, SkillJson } from '../api/types';
import { onboardingBlocksDashboard, resolveOnboardingStep, type AiEmployeesOnboardingStep } from '../domain/bootstrap';
import type { AiEmployeesSessionPhase, LocalModelEntry } from '../sessionTypes';

type Shell = NonNullable<Window['asyncShell']>;

export type AiEmployeesTabId = 'communication' | 'agents' | 'orchestrator' | 'connection';

export function useAiEmployeesController() {
	const shell = window.asyncShell as Shell | undefined;

	const [appearanceSettings, setAppearanceSettings] = useState<AppAppearanceSettings>(() => defaultAppearanceSettings());
	const [localRoot, setLocalRoot] = useState<string | null>(null);
	const [aiSettings, setAiSettings] = useState<AiEmployeesSettings>({});
	const [tab, setTab] = useState<AiEmployeesTabId>('communication');
	const [workspaceId, setWorkspaceId] = useState<string>('');
	const [workspaces, setWorkspaces] = useState<{ id: string; name?: string }[]>([]);
	const [issues, setIssues] = useState<IssueJson[]>([]);
	const [agents, setAgents] = useState<AgentJson[]>([]);
	const [skills, setSkills] = useState<SkillJson[]>([]);
	const [runtimes, setRuntimes] = useState<RuntimeJson[]>([]);
	const [meLabel, setMeLabel] = useState('');
	const [meProfile, setMeProfile] = useState<{ name?: string; email?: string; id?: string }>({});
	const [sessionPhase, setSessionPhase] = useState<AiEmployeesSessionPhase>('bootstrapping');
	const [localModels, setLocalModels] = useState<{
		entries: LocalModelEntry[];
		enabledIds: string[];
		defaultModelId?: string;
	}>({ entries: [], enabledIds: [] });
	const [loadErr, setLoadErr] = useState<string | null>(null);
	const [wsLog, setWsLog] = useState<string[]>([]);
	const [taskEvents, setTaskEvents] = useState<string[]>([]);
	const [bootstrapStatus, setBootstrapStatus] = useState<OrgBootstrapStatus | null>(null);
	const [onboardingStep, setOnboardingStep] = useState<AiEmployeesOnboardingStep>('company');
	const [orgEmployees, setOrgEmployees] = useState<OrgEmployee[]>([]);
	const [promptTemplates, setPromptTemplates] = useState<OrgPromptTemplate[]>([]);
	const [onboardingErr, setOnboardingErr] = useState<string | null>(null);
	const [holdSetupDuringBootstrap, setHoldSetupDuringBootstrap] = useState(false);
	const wsRef = useRef<AiEmployeesWsClient | null>(null);

	useEffect(() => {
		hideBootSplash();
	}, []);

	const prefersDark = useSyncExternalStore(
		(onStoreChange) => {
			const mq = window.matchMedia('(prefers-color-scheme: dark)');
			mq.addEventListener('change', onStoreChange);
			return () => mq.removeEventListener('change', onStoreChange);
		},
		readPrefersDark,
		readPrefersDark
	);
	const effectiveScheme = useMemo(
		() => resolveEffectiveScheme(readStoredColorMode(), prefersDark),
		[prefersDark]
	);

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
		if (!shell) {
			return;
		}
		void (async () => {
			const [wsRaw, raw] = await Promise.all([shell.invoke('workspace:get'), shell.invoke('settings:get')]);
			const root = (wsRaw as { root?: string | null }).root ?? null;
			setLocalRoot(root);
			const r = raw as {
				ui?: Partial<AppAppearanceSettings>;
				aiEmployees?: AiEmployeesSettings;
				models?: { entries?: Array<{ id?: string; displayName?: string }>; enabledIds?: string[] };
				defaultModel?: string;
			};
			if (r?.ui) {
				setAppearanceSettings((prev) => ({ ...prev, ...r.ui }));
			}
			if (r?.aiEmployees) {
				setAiSettings(r.aiEmployees);
				const id = resolveMappedWorkspace(root, r.aiEmployees.workspaceMap);
				if (id) {
					setWorkspaceId(id);
				}
			}
			const entries = (r?.models?.entries ?? [])
				.filter((e): e is { id: string; displayName: string } => typeof e?.id === 'string' && typeof e?.displayName === 'string')
				.map((e) => ({ id: e.id, displayName: e.displayName }));
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

	const fetchWorkspacePayload = useCallback(async (c: AiEmployeesConnection, wid: string) => {
		const [iss, ag, sk, rt] = await Promise.all([
			apiListIssues(c, wid),
			apiListAgents(c, wid),
			apiListSkills(c, wid),
			apiListRuntimes(c, wid),
		]);
		setIssues(iss);
		setAgents(ag);
		setSkills(sk);
		setRuntimes(rt);
	}, []);

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
			setLoadErr((prev) => prev ?? msg);
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
			const list = await apiListIssues(normConn(aiSettings), wid);
			setIssues(list);
		} catch (e) {
			setLoadErr(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, sessionPhase, workspaceId]);

	const refreshAgentsOnly = useCallback(async () => {
		const wid = workspaceId;
		if (!wid || sessionPhase !== 'ready') {
			return;
		}
		try {
			const list = await apiListAgents(normConn(aiSettings), wid);
			setAgents(list);
		} catch (e) {
			setLoadErr(e instanceof Error ? e.message : String(e));
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
			setLoadErr(e instanceof Error ? e.message : String(e));
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
			setLoadErr(e instanceof Error ? e.message : String(e));
		}
	}, [aiSettings, sessionPhase, workspaceId]);

	const refreshData = useCallback(
		async (connOverride?: AiEmployeesConnection, settingsOverride?: AiEmployeesSettings) => {
			const c = connOverride ?? normConn(aiSettings);
			const s = settingsOverride ?? aiSettings;
			setLoadErr(null);
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
					setAgents([]);
					setSkills([]);
					setRuntimes([]);
					setBootstrapStatus(null);
					setOrgEmployees([]);
					setSessionPhase('no_workspace');
					return;
				}
				const mapId = resolveMappedWorkspace(localRoot, s.workspaceMap);
				const wid = pickWorkspaceId(mapped, workspaceId, s.lastRemoteWorkspaceId, mapId);
				setWorkspaceId(wid);
				await fetchWorkspacePayload(c, wid);
				await applyWorkspaceBootstrap(c, wid, mapped.length);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				setLoadErr(msg);
				setWorkspaces([]);
				setWorkspaceId('');
				setIssues([]);
				setAgents([]);
				setSkills([]);
				setRuntimes([]);
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
			setLoadErr(null);
		} catch (e) {
			setLoadErr(e instanceof Error ? e.message : String(e));
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
			if (eventType.startsWith('workspace:') || eventType.startsWith('member:') || eventType.startsWith('project:')) {
				void softRefreshPayload();
			}
		},
		[refreshAgentsOnly, refreshIssuesOnly, refreshRuntimesOnly, refreshSkillsOnly, softRefreshPayload]
	);

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
				setTaskEvents((l) => [`task:progress ${JSON.stringify(p).slice(0, 100)}`, ...l].slice(0, 30));
				void refreshAgentsOnly();
			}),
			client.on('task:dispatch', () => void refreshAgentsOnly()),
			client.on('task:completed', () => void refreshAgentsOnly()),
			client.on('task:failed', () => void refreshAgentsOnly()),
			client.on('task:message', (p) => {
				setTaskEvents((l) => [`task:message ${JSON.stringify(p).slice(0, 100)}`, ...l].slice(0, 30));
			}),
		];
		client.connect();
		return () => {
			for (const u of unsubs) {
				u();
			}
			client.disconnect();
			wsRef.current = null;
		};
	}, [conn, sessionPhase, workspaceId, routeWsEventToRefresh, softRefreshPayload, refreshAgentsOnly]);

	const modelOptions = useMemo(() => buildModelOptions(localModels), [localModels]);
	const modelOptionIdSet = useMemo(() => new Set(modelOptions.map((m) => m.id)), [modelOptions]);

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

	const clearLoadErr = useCallback(() => {
		setLoadErr(null);
	}, []);

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
		setAgents([]);
		setSkills([]);
		setRuntimes([]);
		setBootstrapStatus(null);
		setOrgEmployees([]);
		setOnboardingStep('pick_workspace');
		setOnboardingErr(null);
		setLoadErr(null);
	}, []);

	const pickWorkspaceAndRefresh = useCallback(
		async (id: string) => {
			setWorkspaceId(id);
			if (!id) {
				setIssues([]);
				setAgents([]);
				setSkills([]);
				setRuntimes([]);
				return;
			}
			const c = normConn(aiSettings);
			await fetchWorkspacePayload(c, id);
			await applyWorkspaceBootstrap(c, id, workspaces.length);
			setLoadErr(null);
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
				setAgents([]);
				setSkills([]);
				setRuntimes([]);
				return;
			}
			if (sessionPhase === 'ready' || sessionPhase === 'onboarding') {
				void pickWorkspaceAndRefresh(id).catch((e) => {
					setLoadErr(e instanceof Error ? e.message : String(e));
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

	const orchestration = useMemo(
		() => aiSettings.orchestration ?? emptyOrchestrationState(),
		[aiSettings.orchestration]
	);

	const createOrchestrationRun = useCallback((goal: string, targetBranch: string) => {
		setAiSettings((prev) => {
			const orch = prev.orchestration ?? emptyOrchestrationState();
			const base = createDraftRun(goal, targetBranch || undefined, new Date().toISOString(), crypto.randomUUID());
			const run: AiOrchestrationRun = { ...base, status: 'running' };
			const next = { ...prev, orchestration: upsertRun(orch, run) };
			void shell?.invoke('settings:set', { aiEmployees: next });
			return next;
		});
	}, [shell]);

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
		workspaceId,
		workspaces,
		issues,
		agents,
		skills,
		runtimes,
		meLabel,
		meProfile,
		sessionPhase,
		holdSetupDuringBootstrap,
		localModels,
		loadErr,
		clearLoadErr,
		wsLog,
		taskEvents,
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
		approveOrchestrationGit,
		employeeCatalog: aiSettings.employeeCatalog ?? [],
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
