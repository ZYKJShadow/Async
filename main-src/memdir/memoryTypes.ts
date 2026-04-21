export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'session';

export const MEMORY_FRONTMATTER_EXAMPLE = [
	'---',
	'name: Example memory',
	'description: One-line summary of what this memory contains',
	'type: project',
	'---',
];

export function parseMemoryType(raw: string | undefined): MemoryType | undefined {
	switch ((raw ?? '').trim().toLowerCase()) {
		case 'user':
		case 'feedback':
		case 'project':
		case 'reference':
		case 'session':
			return raw!.trim().toLowerCase() as MemoryType;
		default:
			return undefined;
	}
}

export const TYPES_SECTION_INDIVIDUAL = [
	'## Memory types',
	'- `user`: Stable preferences about how the user likes to work with you.',
	'- `feedback`: Repeatedly observed behaviors to continue or avoid.',
	'- `project`: Important project-specific decisions, architecture, conventions, or constraints.',
	'- `reference`: Reusable facts, locations, commands, or gotchas that save future time.',
	'- `session`: High-level summary of a completed conversation or complex task, for cross-session recall.',
];

export const WHAT_NOT_TO_SAVE_SECTION = [
	'## What not to save',
	'- Do not save secrets, tokens, passwords, or private credentials.',
	'- Do not save information that is derivable from the current codebase state alone.',
	'- Do not create duplicates when an existing memory file can be updated instead.',
];

export const WHEN_TO_ACCESS_SECTION = [
	'## When to access memory',
	'- Read `MEMORY.md` first for orientation.',
	'- Open topic files when the current task clearly relates to them.',
	'- Prefer updating an existing memory file over creating a near-duplicate.',
];
