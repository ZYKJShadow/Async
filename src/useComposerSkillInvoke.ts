import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComposerPlusSkillItem } from './ComposerPlusMenu';
import { snapshotDomRect, type CaretRectSnapshot } from './caretRectSnapshot';
import {
	filterSkillInvokeMenuItems,
	getLeadingSkillInvokeQuery,
	type SkillInvokeMenuItem,
} from './composerSkillInvocations';
import { newSegmentId, type ComposerSegment } from './composerSegments';
import { getCaretRectFromRichRoot, readSegmentsFromRoot, textBeforeCaretForAt } from './composerRichDom';
import type { AtComposerSlot } from './useComposerAtMention';

type RichRefs = {
	hero: React.RefObject<HTMLDivElement | null>;
	bottom: React.RefObject<HTMLDivElement | null>;
	inline: React.RefObject<HTMLDivElement | null>;
};

function getLeadingSkillSegmentText(segs: ComposerSegment[]): string | null {
	if (segs.length !== 1) {
		return null;
	}
	const first = segs[0];
	if (first?.kind !== 'text') {
		return null;
	}
	const { text } = first;
	const isSkillPrefix = text.startsWith('./') || (text.startsWith('/') && !text.startsWith('//'));
	return isSkillPrefix ? text : null;
}

export function useComposerSkillInvoke(
	getSegmentsSetter: (slot: AtComposerSlot) => React.Dispatch<React.SetStateAction<ComposerSegment[]>>,
	richRefs: RichRefs,
	opts: { skills: ComposerPlusSkillItem[] }
) {
	const skillSlotRef = useRef<AtComposerSlot>('bottom');
	const [skillOpen, setSkillOpen] = useState(false);
	const [skillQuery, setSkillQuery] = useState('');
	const [skillHighlight, setSkillHighlight] = useState(0);
	const [skillCaretRect, setSkillCaretRect] = useState<CaretRectSnapshot | null>(null);
	const lastSkillQueryRef = useRef('');

	const items = useMemo(() => filterSkillInvokeMenuItems(opts.skills, skillQuery), [opts.skills, skillQuery]);

	const itemsRef = useRef(items);
	const hiRef = useRef(skillHighlight);
	useEffect(() => {
		itemsRef.current = items;
		hiRef.current = skillHighlight;
	}, [items, skillHighlight]);

	const closeSkillMenu = useCallback(() => {
		lastSkillQueryRef.current = '';
		setSkillOpen(false);
		setSkillCaretRect(null);
	}, []);

	const getRich = useCallback(() => {
		switch (skillSlotRef.current) {
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

	const syncSkillFromRich = useCallback(
		(root: HTMLElement, slot: AtComposerSlot) => {
			skillSlotRef.current = slot;
			const segs = readSegmentsFromRoot(root);
			const firstText = getLeadingSkillSegmentText(segs);
			if (firstText === null) {
				closeSkillMenu();
				return;
			}
			const plainPrefix = textBeforeCaretForAt(root);
			const q = getLeadingSkillInvokeQuery(firstText, plainPrefix);
			if (q === null) {
				closeSkillMenu();
				return;
			}
			const prevQ = lastSkillQueryRef.current;
			lastSkillQueryRef.current = q;
			setSkillQuery(q);
			setSkillCaretRect(snapshotDomRect(getCaretRectFromRichRoot(root)));
			setSkillOpen(true);
			if (prevQ !== q) {
				setSkillHighlight(0);
			} else {
				setSkillHighlight((h) => {
					const len = itemsRef.current.length;
					if (len <= 0) return 0;
					return Math.min(Math.max(0, h), len - 1);
				});
			}
		},
		[closeSkillMenu]
	);

	useEffect(() => {
		if (!skillOpen) {
			return;
		}
		let rafFollowUp = 0;
		const reposition = () => {
			const r = getRich();
			if (!r) {
				return;
			}
			const segs = readSegmentsFromRoot(r);
			const firstText = getLeadingSkillSegmentText(segs);
			if (firstText === null) {
				closeSkillMenu();
				return;
			}
			const plainPrefix = textBeforeCaretForAt(r);
			if (getLeadingSkillInvokeQuery(firstText, plainPrefix) === null) {
				closeSkillMenu();
				return;
			}
			const rect = getCaretRectFromRichRoot(r);
			const snap = snapshotDomRect(rect);
			if (snap) {
				setSkillCaretRect(snap);
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
	}, [skillOpen, getRich, closeSkillMenu]);

	const applySkillSelection = useCallback(
		(picked: SkillInvokeMenuItem) => {
			const root = getRich();
			if (!root) {
				closeSkillMenu();
				return;
			}
			const segs = readSegmentsFromRoot(root);
			const firstText = getLeadingSkillSegmentText(segs);
			if (firstText === null) {
				closeSkillMenu();
				return;
			}
			const skillTok = firstText.match(/^\.\/\S*/) || firstText.match(/^\/\S*/);
			const skillLen = skillTok ? skillTok[0]!.length : (firstText.startsWith('./') ? 2 : 1);
			const tail = firstText.slice(skillLen);
			const setSeg = getSegmentsSetter(skillSlotRef.current);
			setSeg([
				{ id: newSegmentId(), kind: 'skill', slug: picked.slug, name: picked.name },
				{ id: newSegmentId(), kind: 'text', text: tail.replace(/^\s+/, '') },
			]);
			closeSkillMenu();
		},
		[closeSkillMenu, getRich, getSegmentsSetter]
	);

	const applySkillSelectionRef = useRef(applySkillSelection);
	applySkillSelectionRef.current = applySkillSelection;

	const handleSkillKeyDown = useCallback(
		(e: React.KeyboardEvent): boolean => {
			if (!skillOpen) {
				return false;
			}
			const list = itemsRef.current;
			if (list.length === 0) {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					closeSkillMenu();
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
				setSkillHighlight((h) => (h + 1) % list.length);
				return true;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSkillHighlight((h) => (h - 1 + list.length) % list.length);
				return true;
			}
			if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
				e.preventDefault();
				const hi = hiRef.current;
				const it = list[Math.min(hi, list.length - 1)];
				if (it) {
					applySkillSelectionRef.current(it);
				}
				return true;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closeSkillMenu();
				return true;
			}
			return false;
		},
		[skillOpen, closeSkillMenu]
	);

	return {
		skillMenuOpen: skillOpen,
		skillQuery,
		skillMenuItems: items,
		skillMenuHighlight: skillHighlight,
		skillCaretRect,
		syncSkillFromRich,
		setSkillMenuHighlight: setSkillHighlight,
		applySkillSelection,
		handleSkillKeyDown,
		closeSkillMenu,
	};
}
