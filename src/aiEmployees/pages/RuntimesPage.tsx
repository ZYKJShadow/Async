import type { RuntimeJson } from '../api/types';

export function RuntimesPage({ runtimes }: { runtimes: RuntimeJson[] }) {
	return (
		<ul className="ref-ai-employees-list">
			{runtimes.map((r) => (
				<li key={r.id} className="ref-ai-employees-list-row">
					<strong>{r.name ?? r.id.slice(0, 8)}</strong>
					<span className="ref-ai-employees-muted">{r.status ?? '—'}</span>
				</li>
			))}
		</ul>
	);
}
