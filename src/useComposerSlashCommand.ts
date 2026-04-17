import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentCommand } from './agentSettingsTypes';
import type { TFunction } from './i18n';
import {
	filterSlashMenuEntries,
	getLeadingSlashCommandQuery,
	mergeSlashMenuEntries,
	resolveSlashMenuRow,
	type SlashMenuRowItem,
} from './composerSlashCommands';
import { newSegmentId, type ComposerSegment } from './composerSegments';
import { snapshotDomRect, type CaretRectSnapshot } from './caretRectSnapshot';
import { getCaretRectFromRichRoot, readSegmentsFromRoot, textBeforeCaretForAt } from './composerRichDom';
import type { AtComposerSlot } from './useComposerAtMention';

type RichRefs = {
	hero: React.RefObject<HTMLDivElement | null>;
	bottom: React.RefObject<HTMLDivElement | null>;
	inline: React.RefObject<HTMLDivElement | null>;
};

export function useComposerSlashCommand(
	getSegmentsSetter: (slot: AtComposerSlot) => React.Dispatch<React.SetStateAction<ComposerSegment[]>>,
	richRefs: RichRefs,
	opts: { t: TFunction; userCommands?: AgentCommand[] }
) {
	const slashSlotRef = useRef<AtComposerSlot>('bottom');
	const [slashOpen, setSlashOpen] = useState(false);
	const [slashQuery, setSlashQuery] = useState('');
	const [slashHighlight, setSlashHighlight] = useState(0);
	const [slashCaretRect, setSlashCaretRect] = useState<CaretRectSnapshot | null>(null);
	const lastSlashQueryRef = useRef('');

	const mergedEntries = useMemo(
		() => mergeSlashMenuEntries(opts.userCommands),
		[opts.userCommands]
	);

	const items = useMemo(() => {
		const filtered = filterSlashMenuEntries(mergedEntries, slashQuery);
		return filtered.map((c) => resolveSlashMenuRow(c, opts.t));
	}, [mergedEntries, slashQuery, opts.t]);

	const itemsRef = useRef(items);
	const hiRef = useRef(slashHighlight);
	useEffect(() => {
		itemsRef.current = items;
		hiRef.current = slashHighlight;
	}, [items, slashHighlight]);

	const closeSlashMenu = useCallback(() => {
		lastSlashQueryRef.current = '';
		setSlashOpen(false);
		setSlashCaretRect(null);
	}, []);

	const getRich = useCallback(() => {
		switch (slashSlotRef.current) {
			case 'hero':
				return richRefs.hero.current;
			case 'bottom':
				return richRefs.bottom.current;
			case 'inline':
				return richRefs.inline.current;
			default:
				return null;
		}
	}, [richRefs.hero, richRefs.bottom, richRefs.inline]);

	const syncSlashFromRich = useCallback(
		(root: HTMLElement, slot: AtComposerSlot) => {
			slashSlotRef.current = slot;
			const segs = readSegmentsFromRoot(root);
			if (segs.length !== 1 || segs[0]?.kind !== 'text' || !segs[0].text.startsWith('/')) {
				closeSlashMenu();
				return;
			}
			const firstText = segs[0].text;
			const plainPrefix = textBeforeCaretForAt(root);
			const q = getLeadingSlashCommandQuery(firstText, plainPrefix);
			if (q === null) {
				closeSlashMenu();
				return;
			}
			const prevQ = lastSlashQueryRef.current;
			lastSlashQueryRef.current = q;
			setSlashQuery(q);
			setSlashCaretRect(snapshotDomRect(getCaretRectFromRichRoot(root)));
			setSlashOpen(true);
			if (prevQ !== q) {
				setSlashHighlight(0);
			} else {
				setSlashHighlight((h) => {
					const len = itemsRef.current.length;
					if (len <= 0) return 0;
					return Math.min(Math.max(0, h), len - 1);
				});
			}
		},
		[closeSlashMenu]
	);

	useEffect(() => {
		if (!slashOpen) {
			return;
		}
		let rafFollowUp = 0;
		const reposition = () => {
			const r = getRich();
			if (!r) {
				return;
			}
			const segs = readSegmentsFromRoot(r);
			if (segs.length !== 1 || segs[0]?.kind !== 'text' || !segs[0].text.startsWith('/')) {
				closeSlashMenu();
				return;
			}
			const plainPrefix = textBeforeCaretForAt(r);
			if (getLeadingSlashCommandQuery(segs[0].text, plainPrefix) === null) {
				closeSlashMenu();
				return;
			}
			const rect = getCaretRectFromRichRoot(r);
			const snap = snapshotDomRect(rect);
			if (snap) {
				setSlashCaretRect(snap);
			}
		};
		const scheduleReposition = () => {
			cancelAnimationFrame(rafFollowUp);
			reposition();
			rafFollowUp = requestAnimationFrame(() => {
				rafFollowUp = 0;
				reposition();
			});
		};
		scheduleReposition();
		window.addEventListener('resize', scheduleReposition);
		window.addEventListener('scroll', scheduleReposition, true);
		const richRoot = getRich();
		const roRich =
			typeof ResizeObserver !== 'undefined' && richRoot ? new ResizeObserver(scheduleReposition) : null;
		if (richRoot && roRich) {
			roRich.observe(richRoot);
		}
		const docEl = typeof document !== 'undefined' ? document.documentElement : null;
		const roDoc =
			typeof ResizeObserver !== 'undefined' && docEl ? new ResizeObserver(scheduleReposition) : null;
		if (docEl && roDoc) {
			roDoc.observe(docEl);
		}
		const vv = typeof window !== 'undefined' ? window.visualViewport : null;
		if (vv) {
			vv.addEventListener('resize', scheduleReposition);
			vv.addEventListener('scroll', scheduleReposition);
		}
		const unsubLayout = window.asyncShell?.subscribeLayout?.(scheduleReposition);
		return () => {
			cancelAnimationFrame(rafFollowUp);
			window.removeEventListener('resize', scheduleReposition);
			window.removeEventListener('scroll', scheduleReposition, true);
			roRich?.disconnect();
			roDoc?.disconnect();
			if (vv) {
				vv.removeEventListener('resize', scheduleReposition);
				vv.removeEventListener('scroll', scheduleReposition);
			}
			unsubLayout?.();
		};
	}, [slashOpen, getRich, closeSlashMenu]);

	const applySlashSelection = useCallback(
		(picked: SlashMenuRowItem) => {
			const root = getRich();
			if (!root) {
				closeSlashMenu();
				return;
			}
			const segs = readSegmentsFromRoot(root);
			if (segs.length !== 1 || segs[0]?.kind !== 'text' || !segs[0].text.startsWith('/')) {
				closeSlashMenu();
				return;
			}
			const t = segs[0].text;
			const cmdTok = t.match(/^\/\S*/);
			const cmdLen = cmdTok ? cmdTok[0]!.length : 1;
			const tail = t.slice(cmdLen);
			const setSeg = getSegmentsSetter(slashSlotRef.current);
			if (picked.insert.type === 'chip') {
				setSeg([
					{ id: newSegmentId(), kind: 'command', command: picked.insert.chip },
					{ id: newSegmentId(), kind: 'text', text: tail.replace(/^\s+/, '') },
				]);
			} else if (picked.insert.type === 'text') {
				const rest = tail.replace(/^\s+/, '');
				setSeg([{ id: newSegmentId(), kind: 'text', text: picked.insert.text + rest }]);
			}
			closeSlashMenu();
		},
		[closeSlashMenu, getRich, getSegmentsSetter]
	);

	/** 避免 applySlashSelection 抖动 → handleSlashKeyDown 重建 → sharedComposerProps 连带失效 */
	const applySlashSelectionRef = useRef(applySlashSelection);
	applySlashSelectionRef.current = applySlashSelection;

	const handleSlashKeyDown = useCallback(
		(e: React.KeyboardEvent): boolean => {
			if (!slashOpen) {
				return false;
			}
			const list = itemsRef.current;
			if (list.length === 0) {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					closeSlashMenu();
					return true;
				}
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					return true;
				}
				return false;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSlashHighlight((h) => (h + 1) % list.length);
				return true;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSlashHighlight((h) => (h - 1 + list.length) % list.length);
				return true;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				const hi = hiRef.current;
				const it = list[Math.min(hi, list.length - 1)];
				if (it) {
					applySlashSelectionRef.current(it);
				}
				return true;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closeSlashMenu();
				return true;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				const hi = hiRef.current;
				const it = list[Math.min(hi, list.length - 1)];
				if (it) {
					applySlashSelectionRef.current(it);
				}
				return true;
			}
			return false;
		},
		[slashOpen, closeSlashMenu]
	);

	return {
		slashMenuOpen: slashOpen,
		slashQuery,
		slashMenuItems: items,
		slashMenuHighlight: slashHighlight,
		slashCaretRect,
		syncSlashFromRich,
		setSlashMenuHighlight: setSlashHighlight,
		applySlashSelection,
		handleSlashKeyDown,
		closeSlashMenu,
	};
}
