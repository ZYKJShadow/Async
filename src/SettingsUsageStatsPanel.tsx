import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Area,
	AreaChart,
	CartesianGrid,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { useI18n } from './i18n';
import type { UsageStatsAgentDay, UsageStatsGetResponse, UsageStatsTokenEvent } from './ipcTypes';
import type { UserLlmProvider, UserModelEntry } from './modelCatalog';
import { providerDisplayLabel } from './modelCatalog';

type ShellApi = NonNullable<Window['asyncShell']>;

type Props = {
	shell: ShellApi | null;
	modelEntries: UserModelEntry[];
	modelProviders: UserLlmProvider[];
};

const TOP_MODELS = 8;
const USAGE_TABLE_PAGE_SIZE = 100;
const HEAT_LEVELS = 5;

function formatDayKeyLocal(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

function parseDayKeyLocal(key: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
	if (!m) {
		return null;
	}
	const y = Number(m[1]);
	const mo = Number(m[2]) - 1;
	const day = Number(m[3]);
	const d = new Date(y, mo, day);
	return Number.isNaN(d.getTime()) ? null : d;
}

function mondayOfWeek(d: Date): Date {
	const x = startOfLocalDay(new Date(d));
	const dow = (x.getDay() + 6) % 7;
	x.setDate(x.getDate() - dow);
	return x;
}

function totalLines(bucket?: UsageStatsAgentDay): number {
	if (!bucket) {
		return 0;
	}
	return bucket.add + bucket.del;
}

function eventTotalTokens(e: UsageStatsTokenEvent): number {
	return (e.input ?? 0) + (e.output ?? 0) + (e.cacheRead ?? 0) + (e.cacheWrite ?? 0);
}

/** 英文 K / M / B 缩写（用于图表轴、表格展示） */
function formatTokensAbbrev(n: number): string {
	if (!Number.isFinite(n) || n <= 0) {
		return '0';
	}
	const x = Math.round(n);
	if (x < 1000) {
		return String(x);
	}
	if (x < 1_000_000) {
		const v = x / 1000;
		const s = v >= 10 ? v.toFixed(0) : v.toFixed(1);
		return `${s.replace(/\.0$/, '')}K`;
	}
	if (x < 1_000_000_000) {
		const v = x / 1_000_000;
		const s = v >= 10 ? v.toFixed(0) : v.toFixed(1);
		return `${s.replace(/\.0$/, '')}M`;
	}
	const v = x / 1_000_000_000;
	const s = v >= 10 ? v.toFixed(0) : v.toFixed(1);
	return `${s.replace(/\.0$/, '')}B`;
}

function daysBetween(a: Date, b: Date): number {
	return Math.round((startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime()) / 86_400_000);
}

function isNextCalendarDay(prev: Date, cur: Date): boolean {
	const n = new Date(prev);
	n.setDate(n.getDate() + 1);
	return formatDayKeyLocal(n) === formatDayKeyLocal(cur);
}

function heatLevelForCount(n: number, thresholds: number[]): number {
	if (n <= 0) {
		return 0;
	}
	for (let i = 0; i < thresholds.length; i++) {
		if (n <= thresholds[i]!) {
			return i + 1;
		}
	}
	return HEAT_LEVELS - 1;
}

function buildHeatThresholds(counts: number[]): number[] {
	const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
	if (nz.length === 0) {
		return [1, 4, 12, 40];
	}
	const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * (nz.length - 1)))];
	return [q(0.25), q(0.5), q(0.75), q(1)].map((v, i, arr) => (i > 0 && v <= arr[i - 1]! ? arr[i - 1]! + 1 : v));
}

type HeatCell = { key: string; count: number; level: number; inDataRange: boolean };

function buildHeatmapGrid(
	agentLineByDay: Record<string, UsageStatsAgentDay>,
	thresholds: number[],
	localeTag: string
): { weeks: HeatCell[][]; monthLabels: string[]; colCount: number } {
	const today = startOfLocalDay(new Date());
	const dataStart = new Date(today);
	dataStart.setDate(dataStart.getDate() - 364);
	const gridStart = mondayOfWeek(dataStart);
	const gridEnd = new Date(mondayOfWeek(today));
	gridEnd.setDate(gridEnd.getDate() + 6);

	const colCount = Math.max(1, Math.floor(daysBetween(gridStart, gridEnd) / 7) + 1);
	const weeks: HeatCell[][] = Array.from({ length: colCount }, () =>
		Array.from({ length: 7 }, () => ({ key: '', count: 0, level: 0, inDataRange: false }))
	);

	for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
		const key = formatDayKeyLocal(d);
		const inDataRange = d >= dataStart && d <= today;
		const count = inDataRange ? totalLines(agentLineByDay[key]) : 0;
		const level = inDataRange ? heatLevelForCount(count, thresholds) : 0;
		const col = Math.floor(daysBetween(gridStart, mondayOfWeek(d)) / 7);
		const row = (d.getDay() + 6) % 7;
		if (col >= 0 && col < colCount) {
			weeks[col]![row] = { key, count, level, inDataRange };
		}
	}

	const monthLabels: string[] = [];
	for (let c = 0; c < colCount; c++) {
		const monday = new Date(gridStart);
		monday.setDate(monday.getDate() + c * 7);
		const label = monday.toLocaleDateString(localeTag, { month: 'short' });
		const prev = c > 0 ? monthLabels[c - 1] : '';
		monthLabels.push(label !== prev ? label : '');
	}

	return { weeks, monthLabels, colCount };
}

function displayForStatsModelId(rawId: string, displayByEntryId: Map<string, string>, t: (k: string) => string): string {
	if (rawId === '__other__') {
		return t('settings.usage.otherModels');
	}
	if (!rawId) {
		return t('settings.usage.none');
	}
	return displayByEntryId.get(rawId) ?? rawId;
}

function modeLabel(t: (k: string) => string, mode?: string): string {
	switch (mode) {
		case 'agent':
			return t('settings.usage.mode.agent');
		case 'plan':
			return t('settings.usage.mode.plan');
		case 'ask':
			return t('settings.usage.mode.ask');
		case 'debug':
			return t('settings.usage.mode.debug');
		default:
			return mode ?? '—';
	}
}

export function SettingsUsageStatsPanel({ shell, modelEntries, modelProviders }: Props) {
	const { t, locale } = useI18n();
	const statsModelDisplayById = useMemo(() => {
		const m = new Map<string, string>();
		for (const e of modelEntries) {
			const base = e.displayName?.trim() || e.requestName?.trim() || e.id;
			const prov = providerDisplayLabel(e.providerId, modelProviders).trim();
			m.set(e.id, prov ? `${base} (${prov})` : base);
		}
		return m;
	}, [modelEntries, modelProviders]);
	const [settingsUsage, setSettingsUsage] = useState<{ enabled: boolean; dataDir: string }>({
		enabled: false,
		dataDir: '',
	});
	const [data, setData] = useState<UsageStatsGetResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [periodDays, setPeriodDays] = useState<1 | 7 | 30>(30);
	const [selectDirBeforeEnableHint, setSelectDirBeforeEnableHint] = useState(false);

	const loadSettingsUsage = useCallback(async () => {
		if (!shell) {
			return;
		}
		try {
			const s = (await shell.invoke('settings:get')) as {
				usageStats?: { enabled?: boolean; dataDir?: string | null };
			};
			const u = s.usageStats;
			const dataDir = typeof u?.dataDir === 'string' ? u.dataDir : '';
			setSettingsUsage({
				enabled: !!u?.enabled,
				dataDir,
			});
			if (dataDir.trim()) {
				setSelectDirBeforeEnableHint(false);
			}
		} catch {
			/* ignore */
		}
	}, [shell]);

	useEffect(() => {
		void loadSettingsUsage();
	}, [loadSettingsUsage]);

	const refresh = useCallback(async () => {
		if (!shell) {
			setData(null);
			return;
		}
		setLoading(true);
		try {
			const r = (await shell.invoke('usageStats:get')) as UsageStatsGetResponse;
			setData(r);
		} catch {
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [shell]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const pickDataDir = useCallback(async () => {
		if (!shell) {
			return;
		}
		try {
			const r = (await shell.invoke('usageStats:pickDirectory')) as { ok?: boolean; path?: string };
			if (r?.ok && r.path) {
				await shell.invoke('settings:set', {
					usageStats: {
						enabled: settingsUsage.enabled,
						dataDir: r.path,
					},
				});
				setSelectDirBeforeEnableHint(false);
				await loadSettingsUsage();
				void refresh();
			}
		} catch {
			/* preload / main may reject; avoid unhandled rejection */
		}
	}, [shell, settingsUsage.enabled, loadSettingsUsage, refresh]);

	const onToggleEnabled = useCallback(
		async (enabled: boolean) => {
			if (!shell) {
				return;
			}
			const dir = settingsUsage.dataDir.trim();
			if (enabled && !dir) {
				setSelectDirBeforeEnableHint(true);
				return;
			}
			setSelectDirBeforeEnableHint(false);
			await shell.invoke('settings:set', {
				usageStats: {
					enabled,
					dataDir: dir || null,
				},
			});
			await loadSettingsUsage();
			void refresh();
		},
		[shell, settingsUsage.dataDir, loadSettingsUsage, refresh]
	);

	const agentLineByDay = data?.ok ? data.agentLineByDay : {};

	const heatCounts = useMemo(() => Object.values(agentLineByDay).map((b) => totalLines(b)), [agentLineByDay]);
	const thresholds = useMemo(() => buildHeatThresholds(heatCounts), [heatCounts]);
	const localeTag = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
	const { weeks, monthLabels, colCount } = useMemo(
		() => buildHeatmapGrid(agentLineByDay, thresholds, localeTag),
		[agentLineByDay, thresholds, localeTag]
	);

	const lineSummary = useMemo(() => {
		let total = 0;
		let bestDay = '';
		let bestDayVal = 0;
		const byMonth = new Map<string, number>();
		const activeDates: Date[] = [];

		for (const [key, bucket] of Object.entries(agentLineByDay)) {
			const n = totalLines(bucket);
			if (n <= 0) {
				continue;
			}
			total += n;
			if (n > bestDayVal) {
				bestDayVal = n;
				bestDay = key;
			}
			const p = parseDayKeyLocal(key);
			if (p) {
				activeDates.push(p);
				const mk = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
				byMonth.set(mk, (byMonth.get(mk) ?? 0) + n);
			}
		}

		let bestMonth = '';
		let bestMonthVal = 0;
		for (const [mk, v] of byMonth) {
			if (v > bestMonthVal) {
				bestMonthVal = v;
				bestMonth = mk;
			}
		}

		activeDates.sort((a, b) => a.getTime() - b.getTime());
		let longest = 0;
		let run = 0;
		let prev: Date | null = null;
		for (const d of activeDates) {
			if (prev && isNextCalendarDay(prev, d)) {
				run++;
			} else {
				run = 1;
			}
			longest = Math.max(longest, run);
			prev = d;
		}

		let current = 0;
		for (let i = 0; i < 400; i++) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			const k = formatDayKeyLocal(d);
			if (totalLines(agentLineByDay[k]) > 0) {
				current++;
			} else {
				break;
			}
		}

		const fmtMonth =
			bestMonth && parseDayKeyLocal(`${bestMonth}-01`)
				? new Date(
						Number(bestMonth.slice(0, 4)),
						Number(bestMonth.slice(5, 7)) - 1,
						1
					).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'long' })
				: '';
		const fmtBestDay =
			bestDay && parseDayKeyLocal(bestDay)
				? new Date(
						Number(bestDay.slice(0, 4)),
						Number(bestDay.slice(5, 7)) - 1,
						Number(bestDay.slice(8, 10))
					).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
						year: 'numeric',
						month: 'short',
						day: 'numeric',
					})
				: '';

		return {
			total,
			bestMonth: fmtMonth,
			bestDay: fmtBestDay,
			longest,
			current,
		};
	}, [agentLineByDay, locale]);

	const tokenEvents = data?.ok ? data.tokenEvents : [];
	const { rangeStart, rangeEnd } = useMemo(() => {
		const end = startOfLocalDay(new Date());
		end.setHours(23, 59, 59, 999);
		const start = new Date(end);
		start.setDate(start.getDate() - (periodDays - 1));
		start.setHours(0, 0, 0, 0);
		return { rangeStart: start, rangeEnd: end };
	}, [periodDays]);

	const filteredEvents = useMemo(
		() => tokenEvents.filter((e) => e.at >= rangeStart.getTime() && e.at <= rangeEnd.getTime()),
		[tokenEvents, rangeStart, rangeEnd]
	);

	const chartModels = useMemo(() => {
		const totals = new Map<string, number>();
		for (const e of filteredEvents) {
			const id = e.modelId || 'unknown';
			totals.set(id, (totals.get(id) ?? 0) + eventTotalTokens(e));
		}
		const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
		const top = sorted.slice(0, TOP_MODELS).map(([id]) => id);
		const topSet = new Set(top);
		return { top, topSet };
	}, [filteredEvents]);

	const chartRows = useMemo(() => {
		const dayKeys: string[] = [];
		for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
			dayKeys.push(formatDayKeyLocal(d));
		}
		const perDayModel = new Map<string, Map<string, number>>();
		for (const k of dayKeys) {
			perDayModel.set(k, new Map());
		}
		for (const e of filteredEvents) {
			const dk = formatDayKeyLocal(new Date(e.at));
			const bucket = perDayModel.get(dk);
			if (!bucket) {
				continue;
			}
			const mid = chartModels.topSet.has(e.modelId) ? e.modelId : '__other__';
			bucket.set(mid, (bucket.get(mid) ?? 0) + eventTotalTokens(e));
		}
		const modelCols = [...chartModels.top];
		if (filteredEvents.some((e) => !chartModels.topSet.has(e.modelId))) {
			modelCols.push('__other__');
		}
		let cum = Object.fromEntries(modelCols.map((m) => [m, 0])) as Record<string, number>;
		const rows = dayKeys.map((dk) => {
			const dayMap = perDayModel.get(dk) ?? new Map();
			const row: Record<string, string | number> = { day: dk };
			for (const m of modelCols) {
				const add = dayMap.get(m) ?? 0;
				cum[m] = (cum[m] ?? 0) + add;
				row[m] = cum[m]!;
			}
			return row;
		});
		return { rows, modelCols };
	}, [filteredEvents, rangeStart, rangeEnd, chartModels]);

	const chartColors = useMemo(
		() => [
			'var(--ref-usage-chart-0)',
			'var(--ref-usage-chart-1)',
			'var(--ref-usage-chart-2)',
			'var(--ref-usage-chart-3)',
			'var(--ref-usage-chart-4)',
			'var(--ref-usage-chart-5)',
			'var(--ref-usage-chart-6)',
			'var(--ref-usage-chart-7)',
			'var(--ref-usage-chart-8)',
		],
		[]
	);

	const exportCsv = useCallback(() => {
		const header = ['isoTime', 'mode', 'model', 'input', 'output', 'cacheRead', 'cacheWrite', 'total'];
		const lines = [header.join(',')];
		for (const e of [...filteredEvents].sort((a, b) => a.at - b.at)) {
			const total = eventTotalTokens(e);
			const row = [
				new Date(e.at).toISOString(),
				JSON.stringify(e.mode ?? ''),
				JSON.stringify(displayForStatsModelId(e.modelId, statsModelDisplayById, t)),
				String(e.input ?? 0),
				String(e.output ?? 0),
				String(e.cacheRead ?? 0),
				String(e.cacheWrite ?? 0),
				String(total),
			];
			lines.push(row.join(','));
		}
		const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `usage-tokens-${formatDayKeyLocal(new Date())}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}, [filteredEvents, statsModelDisplayById, t]);

	const [usageTablePage, setUsageTablePage] = useState(0);

	const tableRowsAll = useMemo(() => [...filteredEvents].sort((a, b) => b.at - a.at), [filteredEvents]);

	useEffect(() => {
		setUsageTablePage(0);
	}, [filteredEvents, periodDays]);

	const usageTablePageCount = Math.max(1, Math.ceil(tableRowsAll.length / USAGE_TABLE_PAGE_SIZE));
	const effectiveUsageTablePage = Math.min(usageTablePage, usageTablePageCount - 1);
	const tableRowsPaged = useMemo(() => {
		const start = effectiveUsageTablePage * USAGE_TABLE_PAGE_SIZE;
		return tableRowsAll.slice(start, start + USAGE_TABLE_PAGE_SIZE);
	}, [tableRowsAll, effectiveUsageTablePage]);

	if (!shell) {
		return (
			<div className="ref-settings-panel ref-settings-usage">
				<p className="ref-settings-lead">{t('settings.usage.noShell')}</p>
			</div>
		);
	}

	const showDashboard = data?.ok === true;

	return (
		<div className="ref-settings-panel ref-settings-usage">
			<p className="ref-settings-lead">{t('settings.usage.lead')}</p>

			<section className="ref-settings-usage-setup" aria-label={t('settings.usage.enableToggle')}>
				<label className="ref-settings-usage-enable-row">
					<input
						type="checkbox"
						checked={settingsUsage.enabled}
						onChange={(e) => void onToggleEnabled(e.target.checked)}
					/>
					<span>{t('settings.usage.enableToggle')}</span>
				</label>
				<div className="ref-settings-usage-dir-row">
					<span className="ref-settings-usage-dir-label">{t('settings.usage.dataDirLabel')}</span>
					<code className="ref-settings-usage-dir-path">{settingsUsage.dataDir.trim() || t('settings.usage.none')}</code>
					<button type="button" className="ref-settings-usage-pick-dir" onClick={() => void pickDataDir()}>
						{t('settings.usage.pickDataDir')}
					</button>
				</div>
				<p className="ref-settings-usage-muted ref-settings-usage-file-hint">{t('settings.usage.dataFileHint')}</p>
				{selectDirBeforeEnableHint ? (
					<p className="ref-settings-usage-warn">{t('settings.usage.selectDirBeforeEnable')}</p>
				) : null}
				{settingsUsage.enabled && !settingsUsage.dataDir.trim() ? (
					<p className="ref-settings-usage-warn">{t('settings.usage.needDirectory')}</p>
				) : null}
				{!settingsUsage.enabled ? <p className="ref-settings-usage-muted">{t('settings.usage.disabledState')}</p> : null}
			</section>

			<div className="ref-settings-usage-toolbar">
				<button type="button" className="ref-settings-usage-refresh" onClick={() => void refresh()} disabled={loading}>
					{t('settings.usage.reload')}
				</button>
			</div>

			{showDashboard ? (
				<>
				<p className="ref-settings-usage-muted">
					{t('settings.usage.dataDirLabel')}: <code className="ref-settings-usage-mono">{data.dataDir}</code>
				</p>

			<section className="ref-settings-usage-section" aria-label={t('settings.usage.agentLinesTitle')}>
				<h2 className="ref-settings-usage-h2">{t('settings.usage.agentLinesTitle')}</h2>
				<p className="ref-settings-usage-muted">{t('settings.usage.agentLinesSubtitle')}</p>
				<div className="ref-settings-usage-big-num" aria-live="polite">
					{lineSummary.total.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')}
				</div>
				<div className="ref-settings-usage-big-label">{t('settings.usage.totalLineEdits')}</div>

				<div className="ref-settings-usage-heat-head">
					<div className="ref-settings-usage-months" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
						{monthLabels.map((lab, i) => (
							<span key={i} className="ref-settings-usage-month-lab">
								{lab}
							</span>
						))}
					</div>
				</div>
				<div className="ref-settings-usage-heat-wrap">
					<div className="ref-settings-usage-dow">
						<span>M</span>
						<span />
						<span>W</span>
						<span />
						<span>F</span>
						<span />
						<span />
					</div>
					<div className="ref-settings-usage-grid" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
						{weeks.map((col, ci) => (
							<div key={ci} className="ref-settings-usage-week">
								{col.map((cell, ri) => (
									<div
										key={ri}
										className={`ref-settings-usage-cell ref-settings-usage-cell--lv${cell.level}`}
										title={
											cell.key
												? `${cell.key}: +${agentLineByDay[cell.key]?.add ?? 0} / -${agentLineByDay[cell.key]?.del ?? 0} (${cell.count})`
												: ''
										}
									/>
								))}
							</div>
						))}
					</div>
				</div>
				<div className="ref-settings-usage-legend">
					<span>{t('settings.usage.fewer')}</span>
					{[0, 1, 2, 3, 4].map((lv) => (
						<span key={lv} className={`ref-settings-usage-legend-sq ref-settings-usage-cell--lv${lv}`} />
					))}
					<span>{t('settings.usage.more')}</span>
				</div>
				<div className="ref-settings-usage-kpis">
					<div>
						<div className="ref-settings-usage-kpi-label">{t('settings.usage.mostActiveMonth')}</div>
						<div className="ref-settings-usage-kpi-val">{lineSummary.bestMonth || t('settings.usage.none')}</div>
					</div>
					<div>
						<div className="ref-settings-usage-kpi-label">{t('settings.usage.mostActiveDay')}</div>
						<div className="ref-settings-usage-kpi-val">{lineSummary.bestDay || t('settings.usage.none')}</div>
					</div>
					<div>
						<div className="ref-settings-usage-kpi-label">{t('settings.usage.longestStreak')}</div>
						<div className="ref-settings-usage-kpi-val">
							{lineSummary.longest > 0 ? t('settings.usage.streakDays', { n: String(lineSummary.longest) }) : t('settings.usage.none')}
						</div>
					</div>
					<div>
						<div className="ref-settings-usage-kpi-label">{t('settings.usage.currentStreak')}</div>
						<div className="ref-settings-usage-kpi-val">
							{lineSummary.current > 0 ? t('settings.usage.streakDays', { n: String(lineSummary.current) }) : t('settings.usage.none')}
						</div>
					</div>
				</div>
			</section>

			<section className="ref-settings-usage-section" aria-label={t('settings.usage.tokensTitle')}>
				<h2 className="ref-settings-usage-h2">{t('settings.usage.tokensTitle')}</h2>
				<p className="ref-settings-usage-muted">{t('settings.usage.tokensSubtitle')}</p>
				<div className="ref-settings-usage-tok-toolbar">
					<div className="ref-settings-usage-seg">
						{([1, 7, 30] as const).map((d) => (
							<button
								key={d}
								type="button"
								className={periodDays === d ? 'is-active' : ''}
								onClick={() => setPeriodDays(d)}
							>
								{d === 1 ? t('settings.usage.period1d') : d === 7 ? t('settings.usage.period7d') : t('settings.usage.period30d')}
							</button>
						))}
					</div>
					<button type="button" className="ref-settings-usage-csv" onClick={exportCsv}>
						{t('settings.usage.exportCsv')}
					</button>
				</div>
				<div className="ref-settings-usage-chart-meta">
					<span>
						{rangeStart.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')} —{' '}
						{rangeEnd.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')}
					</span>
					<span className="ref-settings-usage-muted">
						{t('settings.usage.chartByModel')} · {t('settings.usage.metricTokens')} · {t('settings.usage.cumulative')}
					</span>
				</div>
				<div className="ref-settings-usage-chart-wrap">
					{chartRows.rows.length > 0 && chartRows.modelCols.length > 0 ? (
						<ResponsiveContainer width="100%" height={280}>
							<AreaChart data={chartRows.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
								<CartesianGrid stroke="var(--ref-usage-chart-grid)" strokeDasharray="3 3" />
								<XAxis dataKey="day" tick={{ fill: 'var(--ref-usage-chart-axis)', fontSize: 11 }} tickLine={false} />
								<YAxis
									tick={{ fill: 'var(--ref-usage-chart-axis)', fontSize: 11 }}
									tickLine={false}
									width={52}
									tickFormatter={(v) => formatTokensAbbrev(Number(v))}
								/>
								<Tooltip
									content={({ active, payload, label }) => {
										if (!active || !payload?.length) {
											return null;
										}
										return (
											<div className="ref-settings-usage-chart-tooltip">
												<div className="ref-settings-usage-chart-tooltip-label">{label}</div>
												<ul className="ref-settings-usage-chart-tooltip-list">
													{payload.map((p) => (
														<li key={String(p.dataKey)} className="ref-settings-usage-chart-tooltip-row">
															<span
																className="ref-settings-usage-chart-tooltip-swatch"
																style={{ background: p.color as string }}
															/>
															<span className="ref-settings-usage-chart-tooltip-name">{p.name}</span>
															<span className="ref-settings-usage-chart-tooltip-val">
																{formatTokensAbbrev(Number(p.value))}
															</span>
														</li>
													))}
												</ul>
											</div>
										);
									}}
								/>
								<Legend wrapperStyle={{ fontSize: 12, color: 'var(--ref-usage-chart-axis)' }} />
								{chartRows.modelCols.map((mid, idx) => (
									<Area
										key={mid}
										type="monotone"
										dataKey={mid}
										name={displayForStatsModelId(mid, statsModelDisplayById, t)}
										stackId="1"
										stroke={chartColors[idx % chartColors.length]}
										fill={chartColors[idx % chartColors.length]}
										fillOpacity={0.35}
									/>
								))}
							</AreaChart>
						</ResponsiveContainer>
					) : (
						<div className="ref-settings-usage-empty-chart">{t('settings.usage.none')}</div>
					)}
				</div>

				<div className="ref-settings-usage-table-wrap">
					<table className="ref-settings-usage-table">
						<thead>
							<tr>
								<th>{t('settings.usage.tableDate')}</th>
								<th>{t('settings.usage.tableMode')}</th>
								<th>{t('settings.usage.tableModel')}</th>
								<th>{t('settings.usage.tableInput')}</th>
								<th>{t('settings.usage.tableOutput')}</th>
								<th>{t('settings.usage.tableTokens')}</th>
							</tr>
						</thead>
						<tbody>
							{tableRowsPaged.map((e, i) => {
								const inN = e.input ?? 0;
								const outN = e.output ?? 0;
								const totN = eventTotalTokens(e);
								return (
									<tr key={`${e.at}-${effectiveUsageTablePage * USAGE_TABLE_PAGE_SIZE + i}`}>
										<td>{new Date(e.at).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')}</td>
										<td>{modeLabel(t, e.mode)}</td>
										<td className="ref-settings-usage-mono" title={e.modelId}>
											{displayForStatsModelId(e.modelId, statsModelDisplayById, t)}
										</td>
										<td title={inN.toLocaleString()}>{formatTokensAbbrev(inN)}</td>
										<td title={outN.toLocaleString()}>{formatTokensAbbrev(outN)}</td>
										<td title={totN.toLocaleString()}>{formatTokensAbbrev(totN)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				{tableRowsAll.length > 0 ? (
					<div className="ref-settings-usage-table-pager" role="navigation" aria-label={t('settings.usage.tablePagerAria')}>
						<span className="ref-settings-usage-table-pager-info">
							{t('settings.usage.tablePageRange', {
								from: String(effectiveUsageTablePage * USAGE_TABLE_PAGE_SIZE + 1),
								to: String(Math.min((effectiveUsageTablePage + 1) * USAGE_TABLE_PAGE_SIZE, tableRowsAll.length)),
								total: String(tableRowsAll.length),
							})}
						</span>
						<div className="ref-settings-usage-table-pager-btns">
							<button
								type="button"
								className="ref-settings-usage-pager-btn"
								disabled={effectiveUsageTablePage <= 0}
								onClick={() => setUsageTablePage(effectiveUsageTablePage - 1)}
							>
								{t('settings.usage.prevPage')}
							</button>
							<button
								type="button"
								className="ref-settings-usage-pager-btn"
								disabled={effectiveUsageTablePage >= usageTablePageCount - 1}
								onClick={() => setUsageTablePage(effectiveUsageTablePage + 1)}
							>
								{t('settings.usage.nextPage')}
							</button>
						</div>
					</div>
				) : null}
			</section>
				</>
			) : null}
		</div>
	);
}
