import type { SkillJson } from '../api/types';

export function SkillsPage({ skills }: { skills: SkillJson[] }) {
	return (
		<ul className="ref-ai-employees-list">
			{skills.map((s) => (
				<li key={s.id} className="ref-ai-employees-list-row">
					<strong>{s.name}</strong>
				</li>
			))}
		</ul>
	);
}
