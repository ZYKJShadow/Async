import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../i18n';
import { IconHistory, IconServerOutline, IconSettings, IconTerminal, IconTrash } from '../icons';
import { isBuiltinTerminalProfileId, type TerminalProfile } from './terminalSettings';
import {
	clearRecentTerminalProfileIds,
	readRecentTerminalProfileIds,
} from './terminalProfileSelectorRecents';

type Row =
	| {
			kind: 'profile';
			rowKey: string;
			group: string;
			profile: TerminalProfile;
	  }
	| { kind: 'clearRecent'; rowKey: string; group: string }
	| { kind: 'manage'; rowKey: string; group: string };

type Props = {
	onClose(): void;
	onPickProfile(profileId: string): void;
	onManageProfiles(): void;
	t: TFunction;
	customProfiles: TerminalProfile[];
	displayBuiltinProfiles: TerminalProfile[];
	defaultProfileId: string | undefined;
	/** 最近使用条数上限；0 表示不展示最近分组。 */
	profileSelectorRecentMax: number;
	/** 是否在列表中展示内置配置（最近分组仍可解析已记录的内置 id）。 */
	profileSelectorShowBuiltin: boolean;
	describeTarget(profile: TerminalProfile): string;
};

function mergeProfiles(custom: TerminalProfile[], builtin: TerminalProfile[]): TerminalProfile[] {
	const byId = new Map<string, TerminalProfile>();
	for (const p of custom) {
		byId.set(p.id, p);
	}
	for (const p of builtin) {
		if (!byId.has(p.id)) {
			byId.set(p.id, p);
		}
	}
	const list = [...byId.values()];
	list.sort((a, b) => {
		const da = isBuiltinTerminalProfileId(a.id) ? 1 : 0;
		const db = isBuiltinTerminalProfileId(b.id) ? 1 : 0;
		if (da !== db) {
			return da - db;
		}
		const ga = (a.group?.trim() || '').localeCompare(b.group?.trim() || '');
		if (ga !== 0) {
			return ga;
		}
		return (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' });
	});
	return list;
}

function rowMatchesFilter(
	row: Row,
	terms: string[],
	t: TFunction,
	describeTarget: (p: TerminalProfile) => string
): boolean {
	if (terms.length === 0) {
		return true;
	}
	let hay: string;
	if (row.kind === 'profile') {
		hay = `${row.group} ${row.profile.name} ${describeTarget(row.profile)}`.toLowerCase();
	} else if (row.kind === 'clearRecent') {
		hay = `${row.group} ${t('app.universalTerminalProfileSelector.clearRecent')}`.toLowerCase();
	} else {
		hay = t('app.universalTerminalProfileSelector.manageProfiles').toLowerCase();
	}
	return terms.every((term) => hay.includes(term));
}

export function TerminalProfileSelectorModal({
	onClose,
	onPickProfile,
	onManageProfiles,
	t,
	customProfiles,
	displayBuiltinProfiles,
	defaultProfileId,
	profileSelectorRecentMax,
	profileSelectorShowBuiltin,
	describeTarget,
}: Props) {
	const [filter, setFilter] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const mergedForResolve = useMemo(
		() => mergeProfiles(customProfiles, displayBuiltinProfiles),
		[customProfiles, displayBuiltinProfiles]
	);
	const mergedForList = useMemo(
		() => mergeProfiles(customProfiles, profileSelectorShowBuiltin ? displayBuiltinProfiles : []),
		[customProfiles, displayBuiltinProfiles, profileSelectorShowBuiltin]
	);

	const baseRows = useMemo((): Row[] => {
		const recentLabel = t('app.universalTerminalProfileSelector.groupRecent');
		const recentIds = readRecentTerminalProfileIds();
		const cappedIds =
			profileSelectorRecentMax <= 0 ? [] : recentIds.slice(0, Math.max(0, profileSelectorRecentMax));
		const recentProfiles = cappedIds
			.map((id) => mergedForResolve.find((p) => p.id === id))
			.filter((p): p is TerminalProfile => Boolean(p));

		const rows: Row[] = [];
		for (const profile of recentProfiles) {
			rows.push({
				kind: 'profile',
				rowKey: `recent:${profile.id}`,
				group: recentLabel,
				profile,
			});
		}
		if (recentProfiles.length > 0) {
			rows.push({ kind: 'clearRecent', rowKey: 'clear-recent', group: recentLabel });
		}

		const ungrouped = t('app.universalTerminalProfileSelector.groupUngrouped');
		const builtinGroup = t('app.universalTerminalSettings.profiles.group.builtin');
		for (const profile of mergedForList) {
			const group = isBuiltinTerminalProfileId(profile.id)
				? builtinGroup
				: profile.group?.trim() || ungrouped;
			rows.push({
				kind: 'profile',
				rowKey: `all:${profile.id}`,
				group,
				profile,
			});
		}

		rows.push({
			kind: 'manage',
			rowKey: 'manage',
			group: '',
		});
		return rows;
	}, [mergedForList, mergedForResolve, profileSelectorRecentMax, t]);

	const terms = useMemo(() => filter.trim().toLowerCase().split(/\s+/).filter(Boolean), [filter]);

	const filteredRows = useMemo(() => {
		const next = baseRows.filter((row) => rowMatchesFilter(row, terms, t, describeTarget));
		if (terms.length === 0) {
			return next;
		}
		return next.sort((a, b) => {
			const wa = a.kind === 'manage' ? 10 : a.kind === 'clearRecent' ? -1 : isBuiltinTerminalProfileId(a.profile.id) ? 2 : 1;
			const wb = b.kind === 'manage' ? 10 : b.kind === 'clearRecent' ? -1 : isBuiltinTerminalProfileId(b.profile.id) ? 2 : 1;
			if (wa !== wb) {
				return wa - wb;
			}
			const ga = (a.group || '').localeCompare(b.group || '');
			if (ga !== 0) {
				return ga;
			}
			if (a.kind === 'profile' && b.kind === 'profile') {
				return (a.profile.name || a.profile.id).localeCompare(b.profile.name || b.profile.id, undefined, {
					sensitivity: 'base',
				});
			}
			return 0;
		});
	}, [baseRows, describeTarget, t, terms]);

	useEffect(() => {
		setFilter('');
		setSelectedIndex(0);
		const timer = window.setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		setSelectedIndex((i) => {
			if (filteredRows.length === 0) {
				return 0;
			}
			return Math.max(0, Math.min(i, filteredRows.length - 1));
		});
	}, [filter, filteredRows.length]);

	useEffect(() => {
		if (filteredRows.length === 0) {
			return;
		}
		const el = itemRefs.current[selectedIndex];
		el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}, [filteredRows.length, selectedIndex]);

	const activateRow = useCallback(
		(row: Row) => {
			if (row.kind === 'profile') {
				onPickProfile(row.profile.id);
				onClose();
				return;
			}
			if (row.kind === 'clearRecent') {
				clearRecentTerminalProfileIds();
				onClose();
				return;
			}
			onManageProfiles();
			onClose();
		},
		[onClose, onManageProfiles, onPickProfile]
	);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (filteredRows.length === 0) {
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setSelectedIndex((i) => (i - 1 + filteredRows.length) % filteredRows.length);
			} else if (event.key === 'ArrowDown') {
				event.preventDefault();
				setSelectedIndex((i) => (i + 1) % filteredRows.length);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				const row = filteredRows[selectedIndex];
				if (row) {
					activateRow(row);
				}
			}
		},
		[activateRow, filteredRows, onClose, selectedIndex]
	);

	if (typeof document === 'undefined') {
		return null;
	}

	const hasGroups = baseRows.some((r) => r.group.trim().length > 0);

	const node = (
		<div className="ref-uterm-profile-selector-backdrop" role="presentation" onClick={onClose}>
			<div
				className="ref-uterm-profile-selector"
				role="dialog"
				aria-modal="true"
				aria-label={t('app.universalTerminalProfileSelector.title')}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={onKeyDown}
			>
				<input
					ref={inputRef}
					type="text"
					className="ref-uterm-profile-selector-input"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder={t('app.universalTerminalProfileSelector.placeholder')}
					autoComplete="off"
					spellCheck={false}
				/>
				{filteredRows.length > 0 ? (
					<div className="ref-uterm-profile-selector-list" role="listbox" aria-activedescendant={`uterm-prof-sel-${selectedIndex}`}>
						{filteredRows.map((row, i) => {
							const showGroupHeader =
								hasGroups &&
								(row.group?.trim() ?? '') !== (filteredRows[i - 1]?.group?.trim() ?? '') &&
								Boolean(row.group?.trim());
							const isActive = i === selectedIndex;
							const defaultSuffix =
								row.kind === 'profile' && row.profile.id === defaultProfileId
									? ` · ${t('app.universalTerminalMenu.defaultSuffix')}`
									: '';

							return (
								<div key={row.rowKey} className="ref-uterm-profile-selector-block">
									{showGroupHeader ? (
										<div className="ref-uterm-profile-selector-group" role="presentation">
											{row.group}
										</div>
									) : null}
									<button
										ref={(el) => {
											itemRefs.current[i] = el;
										}}
										type="button"
										id={`uterm-prof-sel-${i}`}
										role="option"
										aria-selected={isActive}
										className={`ref-uterm-profile-selector-row ${row.kind !== 'profile' ? 'ref-uterm-profile-selector-row--action' : ''} ${isActive ? 'is-active' : ''}`}
										onClick={() => activateRow(row)}
										onMouseEnter={() => setSelectedIndex(i)}
									>
										<span className="ref-uterm-profile-selector-row-ico" aria-hidden>
											{row.kind === 'profile' ? (
												row.rowKey.startsWith('recent:') ? (
													<IconHistory className="ref-uterm-profile-selector-row-ico-svg" />
												) : row.profile.kind === 'ssh' ? (
													<IconServerOutline className="ref-uterm-profile-selector-row-ico-svg" />
												) : (
													<IconTerminal className="ref-uterm-profile-selector-row-ico-svg" />
												)
											) : row.kind === 'clearRecent' ? (
												<IconTrash className="ref-uterm-profile-selector-row-ico-svg" />
											) : (
												<IconSettings className="ref-uterm-profile-selector-row-ico-svg" />
											)}
										</span>
										<span className="ref-uterm-profile-selector-row-title">
											{row.kind === 'profile'
												? row.profile.name || t('app.universalTerminalSettings.profiles.untitled')
												: row.kind === 'clearRecent'
													? t('app.universalTerminalProfileSelector.clearRecent')
													: t('app.universalTerminalProfileSelector.manageProfiles')}
										</span>
										{row.kind === 'profile' ? (
											<span className="ref-uterm-profile-selector-row-desc">
												{describeTarget(row.profile)}
												{defaultSuffix}
											</span>
										) : null}
										{isActive ? (
											<span className="ref-uterm-profile-selector-enter-hint" aria-hidden>
												{t('app.universalTerminalProfileSelector.hintEnter')}
											</span>
										) : null}
									</button>
								</div>
							);
						})}
					</div>
				) : (
					<div className="ref-uterm-profile-selector-empty">{t('app.universalTerminalProfileSelector.noMatches')}</div>
				)}
			</div>
		</div>
	);

	return createPortal(node, document.body);
}
