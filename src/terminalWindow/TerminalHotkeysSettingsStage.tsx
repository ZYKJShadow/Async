import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from '../i18n';
import { TERMINAL_HOTKEY_IDS, defaultPlatformHotkeysTable, type TerminalHotkeyId } from './terminalHotkeyDefaults';
import { readHotkeyPlatform } from './terminalHotkeyPlatform';
import { getHotkeysConfigRecursiveStatic } from './terminalHotkeyMatcher';
import type { TerminalAppSettings, TerminalHotkeysUserMap } from './terminalSettings';
import { mergeResolvedTerminalHotkeysMap } from './terminalSettings';
import { TerminalHotkeyInputModal } from './TerminalHotkeyInputModal';

type Props = {
	t: TFunction;
	settings: TerminalAppSettings;
	onPatchSettings(partial: Partial<TerminalAppSettings>): void;
};

function duplicateBindingLowercases(resolvedBranch: Record<string, unknown>): Set<string> {
	const flat = getHotkeysConfigRecursiveStatic(resolvedBranch);
	const all: string[] = [];
	for (const id of Object.keys(flat)) {
		for (const seq of flat[id]) {
			for (const s of seq) {
				all.push(s.toLowerCase());
			}
		}
	}
	const dup = new Set<string>();
	const count = new Map<string, number>();
	for (const x of all) {
		count.set(x, (count.get(x) ?? 0) + 1);
	}
	for (const [k, v] of count) {
		if (v > 1) {
			dup.add(k);
		}
	}
	return dup;
}

type CaptureState = {
	actionId: TerminalHotkeyId;
	mode: 'add' | 'edit';
	editIndex?: number;
};

function IconSearchHotkeys() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
		</svg>
	);
}

export const TerminalHotkeysSettingsStage = memo(function TerminalHotkeysSettingsStage({
	t,
	settings,
	onPatchSettings,
}: Props) {
	const platform = readHotkeyPlatform();
	const defaults = useMemo(() => defaultPlatformHotkeysTable(platform), [platform]);
	const resolvedBranch = useMemo(() => mergeResolvedTerminalHotkeysMap(settings), [settings]);
	const duplicateIds = useMemo(() => duplicateBindingLowercases(resolvedBranch), [resolvedBranch]);

	const [hotkeyFilter, setHotkeyFilter] = useState('');
	const [capture, setCapture] = useState<CaptureState | null>(null);
	const captureRef = useRef<CaptureState | null>(null);
	captureRef.current = capture;

	const patchHotkeys = useCallback(
		(next: TerminalHotkeysUserMap) => {
			onPatchSettings({ hotkeys: next });
		},
		[onPatchSettings]
	);

	const removeBindingAt = useCallback(
		(id: TerminalHotkeyId, index: number) => {
			const current = [...(settings.hotkeys[id] ?? defaults[id])];
			current.splice(index, 1);
			const next = { ...settings.hotkeys, [id]: current };
			patchHotkeys(next);
		},
		[defaults, patchHotkeys, settings.hotkeys]
	);

	const applyCapturedChordsFor = useCallback(
		(cap: CaptureState, chords: string[]) => {
			const joined = chords.length ? chords.map((c) => c.trim()).filter(Boolean).join('$#!') : '';
			if (!joined) {
				return;
			}
			const id = cap.actionId;
			const base = [...(settings.hotkeys[id] ?? defaults[id])];
			if (cap.mode === 'add') {
				if (base.includes(joined)) {
					return;
				}
				patchHotkeys({ ...settings.hotkeys, [id]: [...base, joined] });
				return;
			}
			const idx = cap.editIndex ?? 0;
			const next = [...base];
			next[idx] = joined;
			patchHotkeys({ ...settings.hotkeys, [id]: next });
		},
		[defaults, patchHotkeys, settings.hotkeys]
	);

	const onModalClose = useCallback(
		(result: string[] | null) => {
			const prev = captureRef.current;
			setCapture(null);
			if (prev && result !== null && result.length) {
				applyCapturedChordsFor(prev, result);
			}
		},
		[applyCapturedChordsFor]
	);

	const resetAll = useCallback(() => {
		patchHotkeys({});
	}, [patchHotkeys]);

	const hotkeyFilterFn = useCallback(
		(id: TerminalHotkeyId, query: string): boolean => {
			if (!query.trim()) {
				return true;
			}
			const q = query.toLowerCase();
			const name = t(`app.universalTerminalSettings.hotkeys.actions.${id}` as never);
			const bindings = (settings.hotkeys[id] ?? defaults[id]).join(' ');
			const hay = `${name} ${id} ${bindings}`.toLowerCase();
			return hay.includes(q);
		},
		[defaults, settings.hotkeys, t]
	);

	return (
		<div className="ref-uterm-settings-page ref-uterm-hotkeys-page">
			<div className="ref-uterm-settings-page-head">
				<div>
					<h2 className="ref-uterm-settings-page-title">{t('app.universalTerminalSettings.hotkeys.title')}</h2>
					<p className="ref-uterm-settings-page-copy">{t('app.universalTerminalSettings.hotkeys.lead')}</p>
				</div>
			</div>

			<div className="ref-uterm-hotkeys-search-wrap">
				<span className="ref-uterm-hotkeys-search-ico" aria-hidden>
					<IconSearchHotkeys />
				</span>
				<input
					type="search"
					className="ref-uterm-hotkeys-search-input"
					placeholder={t('app.universalTerminalSettings.hotkeys.searchPlaceholder')}
					value={hotkeyFilter}
					onChange={(e) => setHotkeyFilter(e.target.value)}
					aria-label={t('app.universalTerminalSettings.hotkeys.searchPlaceholder')}
				/>
			</div>

			<div className="ref-uterm-hotkeys-table">
				{TERMINAL_HOTKEY_IDS.map((id) => {
					if (!hotkeyFilterFn(id, hotkeyFilter)) {
						return null;
					}
					const bindings = settings.hotkeys[id] ?? defaults[id];
					const desc = t(`app.universalTerminalSettings.hotkeys.actions.${id}` as never);
					return (
						<div key={id} className="ref-uterm-hotkeys-row">
							<div className="ref-uterm-hotkeys-row-name">
								<span className="ref-uterm-hotkeys-row-label">{desc}</span>
								<span className="ref-uterm-hotkeys-row-id">({id})</span>
							</div>
							<div className="ref-uterm-hotkeys-row-input">
								<div className="ref-uterm-multi-hotkey-host">
									{bindings.map((binding, index) => {
										const parts = binding.split('$#!');
										const dup = duplicateIds.has(binding.toLowerCase());
										return (
											<div
												key={`${id}-${index}-${binding}`}
												className={`ref-uterm-multi-hotkey-item${dup ? ' is-duplicate' : ''}`}
											>
												<button
													type="button"
													className="ref-uterm-multi-hotkey-body"
													onClick={() => setCapture({ actionId: id, mode: 'edit', editIndex: index })}
												>
													{parts.map((part, pi) => (
														<span key={`${pi}-${part}`} className="ref-uterm-multi-hotkey-stroke">
															{part}
														</span>
													))}
												</button>
												<button
													type="button"
													className="ref-uterm-multi-hotkey-remove"
													aria-label={t('app.universalTerminalSettings.hotkeys.removeBinding')}
													onClick={() => removeBindingAt(id, index)}
												>
													×
												</button>
											</div>
										);
									})}
									<button type="button" className="ref-uterm-multi-hotkey-add" onClick={() => setCapture({ actionId: id, mode: 'add' })}>
										{t('app.universalTerminalSettings.hotkeys.addEllipsis')}
									</button>
								</div>
							</div>
						</div>
					);
				})}
			</div>

			<div className="ref-uterm-hotkeys-footer">
				<button type="button" className="ref-uterm-btn-secondary" onClick={resetAll}>
					{t('app.universalTerminalSettings.hotkeys.resetAll')}
				</button>
			</div>

			<TerminalHotkeyInputModal open={capture !== null} onClose={onModalClose} t={t} />
		</div>
	);
});
