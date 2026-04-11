import { useEffect, useRef, useState } from 'react';

export type FilterOption = { value: string; label: string };

export function FilterDropdown({
	label,
	options,
	selected,
	onChange,
	badgeCount,
}: {
	label: string;
	options: FilterOption[];
	selected: Set<string>;
	onChange: (next: Set<string>) => void;
	badgeCount?: number;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [open]);

	const toggle = (value: string) => {
		const next = new Set(selected);
		if (next.has(value)) {
			next.delete(value);
		} else {
			next.add(value);
		}
		onChange(next);
	};

	return (
		<div className="ref-ai-employees-filter-dd" ref={rootRef}>
			<button type="button" className="ref-ai-employees-filter-dd-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
				<span>{label}</span>
				{(badgeCount ?? selected.size) > 0 ? <span className="ref-ai-employees-filter-dd-badge">{badgeCount ?? selected.size}</span> : null}
			</button>
			{open ? (
				<div className="ref-ai-employees-filter-dd-panel" role="listbox">
					{options.length === 0 ? (
						<p className="ref-ai-employees-muted ref-ai-employees-filter-dd-empty">—</p>
					) : (
						options.map((opt) => (
							<label key={opt.value} className="ref-ai-employees-filter-dd-row">
								<input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
								<span>{opt.label}</span>
							</label>
						))
					)}
				</div>
			) : null}
		</div>
	);
}
