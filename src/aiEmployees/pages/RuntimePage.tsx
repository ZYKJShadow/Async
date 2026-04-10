import { useMemo, useState } from 'react';
import type { TFunction } from '../../i18n';
import type { RuntimeJson } from '../api/types';
import { IconServerOutline } from '../../icons';

type RuntimeFilter = 'mine' | 'all';

function isOnlineStatus(s: string | undefined): boolean {
	if (!s) return false;
	const x = s.toLowerCase();
	return x === 'online' || x === 'connected' || x === 'active';
}

function formatSeen(iso: string | undefined): string {
	if (!iso) return '—';
	const d = Date.parse(iso);
	if (Number.isNaN(d)) return iso;
	return new Date(d).toLocaleString();
}

export function RuntimePage({ t, runtimes, meUserId }: { t: TFunction; runtimes: RuntimeJson[]; meUserId?: string }) {
	const [filter, setFilter] = useState<RuntimeFilter>('mine');
	const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState('');

	const uniqueOwners = useMemo(() => {
		if (filter !== 'all') return [] as string[];
		const ids = [...new Set(runtimes.map((r) => r.owner_id).filter(Boolean) as string[])];
		return ids;
	}, [filter, runtimes]);

	const filteredRuntimes = useMemo(() => {
		let list = runtimes;
		if (filter === 'mine') {
			list = meUserId ? list.filter((r) => r.owner_id === meUserId) : list;
		}
		if (filter === 'all' && ownerFilter) {
			list = list.filter((r) => r.owner_id === ownerFilter);
		}
		return list;
	}, [runtimes, filter, meUserId, ownerFilter]);

	const effectiveSelectedId =
		selectedId && filteredRuntimes.some((r) => r.id === selectedId) ? selectedId : (filteredRuntimes[0]?.id ?? '');
	const selected = filteredRuntimes.find((r) => r.id === effectiveSelectedId) ?? null;

	const onlineCount = filteredRuntimes.filter((r) => isOnlineStatus(r.status)).length;

	return (
		<div className="ref-ai-employees-runtime-root">
			<div className="ref-ai-employees-runtime-split">
				<aside className="ref-ai-employees-runtime-list-col" aria-label={t('aiEmployees.runtimeListAria')}>
					<div className="ref-ai-employees-runtime-list-head">
						<h2 className="ref-ai-employees-runtime-list-title">{t('aiEmployees.tab.runtimes')}</h2>
						<span className="ref-ai-employees-runtime-online-count">
							{t('aiEmployees.runtimeOnlineCount', { online: String(onlineCount), total: String(filteredRuntimes.length) })}
						</span>
					</div>
					<div className="ref-ai-employees-runtime-filter-row">
						<div className="ref-ai-employees-runtime-pill-group" role="group">
							<button
								type="button"
								className={`ref-ai-employees-runtime-pill ${filter === 'mine' ? 'is-active' : ''}`}
								onClick={() => {
									setFilter('mine');
									setOwnerFilter(null);
								}}
							>
								{t('aiEmployees.runtimeFilterMine')}
							</button>
							<button
								type="button"
								className={`ref-ai-employees-runtime-pill ${filter === 'all' ? 'is-active' : ''}`}
								onClick={() => {
									setFilter('all');
									setOwnerFilter(null);
								}}
							>
								{t('aiEmployees.runtimeFilterAll')}
							</button>
						</div>
						{filter === 'all' && uniqueOwners.length > 1 ? (
							<select
								className="ref-settings-native-select ref-ai-employees-runtime-owner-select"
								value={ownerFilter ?? ''}
								onChange={(e) => setOwnerFilter(e.target.value || null)}
								aria-label={t('aiEmployees.runtimeOwnerFilter')}
							>
								<option value="">{t('aiEmployees.runtimeAllOwners')}</option>
								{uniqueOwners.map((oid) => (
									<option key={oid} value={oid}>
										{oid.length > 12 ? `${oid.slice(0, 10)}…` : oid}
									</option>
								))}
							</select>
						) : null}
					</div>
					{filteredRuntimes.length === 0 ? (
						<div className="ref-ai-employees-runtime-empty">
							<IconServerOutline className="ref-ai-employees-runtime-empty-icon" aria-hidden />
							<p className="ref-ai-employees-runtime-empty-title">
								{filter === 'mine' ? t('aiEmployees.runtimeEmptyMine') : t('aiEmployees.runtimeEmpty')}
							</p>
							<p className="ref-ai-employees-runtime-empty-hint">{t('aiEmployees.runtimeEmptyHint')}</p>
						</div>
					) : (
						<ul className="ref-ai-employees-runtime-items">
							{filteredRuntimes.map((r) => {
								const on = isOnlineStatus(r.status);
								return (
									<li key={r.id}>
										<button
											type="button"
											className={`ref-ai-employees-runtime-item ${r.id === effectiveSelectedId ? 'is-active' : ''}`}
											onClick={() => setSelectedId(r.id)}
										>
											<div className="ref-ai-employees-runtime-item-main">
												<div className="ref-ai-employees-runtime-item-name">{r.name ?? r.id.slice(0, 8)}</div>
												<div className="ref-ai-employees-runtime-item-sub">
													{r.runtime_mode ?? r.provider ?? '—'}
												</div>
											</div>
											<span
												className={`ref-ai-employees-runtime-status-dot ${on ? 'is-online' : ''}`}
												title={r.status ?? ''}
												aria-hidden
											/>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</aside>
				<div className="ref-ai-employees-runtime-detail-col">
					{selected ? (
						<>
							<div className="ref-ai-employees-runtime-detail-head">
								<div className="ref-ai-employees-runtime-detail-title-row">
									<h2 className="ref-ai-employees-runtime-detail-title">{selected.name ?? selected.id.slice(0, 8)}</h2>
									<span
										className={`ref-ai-employees-runtime-detail-badge ${isOnlineStatus(selected.status) ? 'is-online' : ''}`}
									>
										{selected.status ?? '—'}
									</span>
								</div>
							</div>
							<div className="ref-ai-employees-runtime-detail-body">
								<dl className="ref-ai-employees-runtime-detail-grid">
									<div>
										<dt>{t('aiEmployees.runtimeDetailMode')}</dt>
										<dd>{selected.runtime_mode ?? '—'}</dd>
									</div>
									<div>
										<dt>{t('aiEmployees.runtimeDetailProvider')}</dt>
										<dd>{selected.provider ?? '—'}</dd>
									</div>
									<div>
										<dt>{t('aiEmployees.runtimeDetailOwner')}</dt>
										<dd>{selected.owner_id ? (selected.owner_id.length > 14 ? `${selected.owner_id.slice(0, 12)}…` : selected.owner_id) : '—'}</dd>
									</div>
									<div>
										<dt>{t('aiEmployees.runtimeDetailLastSeen')}</dt>
										<dd>{formatSeen(selected.last_seen_at ?? selected.updated_at)}</dd>
									</div>
									{selected.device_info ? (
										<div className="ref-ai-employees-runtime-detail-span2">
											<dt>{t('aiEmployees.runtimeDetailDevice')}</dt>
											<dd>{selected.device_info}</dd>
										</div>
									) : null}
									<div className="ref-ai-employees-runtime-detail-span2">
										<dt>{t('aiEmployees.runtimeDetailId')}</dt>
										<dd className="ref-ai-employees-runtime-mono">{selected.id}</dd>
									</div>
								</dl>
							</div>
						</>
					) : (
						<div className="ref-ai-employees-runtime-detail-empty">
							<IconServerOutline className="ref-ai-employees-runtime-detail-empty-icon" aria-hidden />
							<p>{t('aiEmployees.runtimePick')}</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
