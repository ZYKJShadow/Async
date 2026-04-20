import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TeamExpertConfig, TeamRoleType } from '../settingsStore.js';
import type {
	BuiltinTeamCatalogPayload,
	BuiltinTeamExpertSummary,
} from '../../src/teamBuiltinCatalogTypes.js';

export const BUILTIN_TEAM_REPO_PATH = 'D:\\WebstormProjects\\agency-agents';
export const BUNDLED_BUILTIN_TEAM_REL_PATH = path.join('resources', 'builtin-team', 'agency-agents');

type ParsedBuiltinAgentDoc = {
	name: string;
	description: string;
	body: string;
	category: string;
	sourceRelPath: string;
	sourceKey: string;
	baseName: string;
};

type BuiltinTeamRuntimeExpert = TeamExpertConfig &
	BuiltinTeamExpertSummary & {
		systemPrompt: string;
	};

const SCAN_SKIP_DIRS = new Set([
	'.git',
	'.github',
	'examples',
	'integrations',
	'node_modules',
	'scripts',
]);

function toPosixPath(value: string): string {
	return value.replace(/\\/g, '/');
}

function isExistingDirectory(dirPath: string): boolean {
	try {
		return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function candidateBuiltinTeamRepoPaths(): string[] {
	const candidates: string[] = [];
	const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath.trim() : '';
	if (resourcesPath) {
		candidates.push(path.join(resourcesPath, 'app.asar', BUNDLED_BUILTIN_TEAM_REL_PATH));
		candidates.push(path.join(resourcesPath, BUNDLED_BUILTIN_TEAM_REL_PATH));
		candidates.push(path.join(resourcesPath, 'builtin-team', 'agency-agents'));
	}
	candidates.push(path.resolve(process.cwd(), BUNDLED_BUILTIN_TEAM_REL_PATH));
	candidates.push(path.resolve(BUILTIN_TEAM_REPO_PATH));
	return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

export function resolveBuiltinTeamRepoPath(preferredPath = BUILTIN_TEAM_REPO_PATH): string {
	const preferred = path.resolve(preferredPath);
	const defaultExternal = path.resolve(BUILTIN_TEAM_REPO_PATH);
	const candidates =
		preferred === defaultExternal
			? [...candidateBuiltinTeamRepoPaths(), preferred]
			: [preferred, ...candidateBuiltinTeamRepoPaths()];
	return candidates.find((candidate) => isExistingDirectory(candidate)) ?? preferred;
}

function slugify(value: string): string {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function parseFrontmatterDocument(text: string): { meta: Record<string, string>; body: string } | null {
	if (!text.startsWith('---')) {
		return null;
	}
	const endMarker = '\n---';
	const end = text.indexOf(endMarker, 3);
	if (end < 0) {
		return null;
	}
	const rawMeta = text.slice(3, end).trim();
	const body = text.slice(end + endMarker.length).trim();
	const meta: Record<string, string> = {};
	for (const line of rawMeta.split(/\r?\n/)) {
		const match = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
		if (!match) {
			continue;
		}
		meta[match[1]!] = match[2]!.replace(/^["']|["']$/g, '').trim();
	}
	return { meta, body };
}

function listMarkdownFiles(root: string, currentDir = root): string[] {
	const entries = fs.readdirSync(currentDir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (SCAN_SKIP_DIRS.has(entry.name)) {
				continue;
			}
			files.push(...listMarkdownFiles(root, path.join(currentDir, entry.name)));
			continue;
		}
		if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
			continue;
		}
		files.push(path.join(currentDir, entry.name));
	}
	return files;
}

function readBuiltinAgentDocs(repoPath: string): ParsedBuiltinAgentDoc[] {
	if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
		throw new Error(`Built-in team repository not found: ${repoPath}`);
	}
	const docs: ParsedBuiltinAgentDoc[] = [];
	for (const fullPath of listMarkdownFiles(repoPath)) {
		const relPath = toPosixPath(path.relative(repoPath, fullPath));
		const parsed = parseFrontmatterDocument(fs.readFileSync(fullPath, 'utf8'));
		if (!parsed) {
			continue;
		}
		const name = String(parsed.meta.name ?? '').trim();
		const description = String(parsed.meta.description ?? '').trim();
		const body = String(parsed.body ?? '').trim();
		if (!name || !description || !body) {
			continue;
		}
		docs.push({
			name,
			description,
			body,
			category: toPosixPath(path.dirname(relPath)),
			sourceRelPath: relPath,
			sourceKey: relPath.replace(/\.md$/i, ''),
			baseName: path.basename(relPath, '.md'),
		});
	}
	return docs;
}

function classifyBuiltinRole(doc: ParsedBuiltinAgentDoc): TeamRoleType {
	if (doc.baseName === 'agents-orchestrator') {
		return 'team_lead';
	}
	if (doc.baseName === 'engineering-frontend-developer') {
		return 'frontend';
	}
	if (doc.baseName === 'engineering-backend-architect') {
		return 'backend';
	}
	if (doc.baseName === 'engineering-code-reviewer' || doc.baseName === 'testing-reality-checker') {
		return 'reviewer';
	}
	if (
		doc.category.startsWith('testing') ||
		doc.baseName.includes('qa') ||
		doc.baseName.includes('tester') ||
		/\bqa\b|tester|testing/i.test(doc.name)
	) {
		return 'qa';
	}
	return 'custom';
}

function preferredAssignmentKey(doc: ParsedBuiltinAgentDoc): string {
	switch (doc.baseName) {
		case 'agents-orchestrator':
			return 'team_lead';
		case 'engineering-frontend-developer':
			return 'frontend';
		case 'engineering-backend-architect':
			return 'backend';
		case 'engineering-code-reviewer':
			return 'code_reviewer';
		case 'testing-reality-checker':
			return 'reality_checker';
		default:
			return slugify(doc.baseName);
	}
}

function buildBuiltinExperts(repoPath: string): BuiltinTeamRuntimeExpert[] {
	const docs = readBuiltinAgentDocs(repoPath);
	const usedAssignmentKeys = new Set<string>();
	const experts = docs.map((doc) => {
		const roleType = classifyBuiltinRole(doc);
		const preferredKey = preferredAssignmentKey(doc);
		let assignmentKey = preferredKey;
		if (usedAssignmentKeys.has(assignmentKey)) {
			assignmentKey = slugify(doc.sourceKey);
		}
		usedAssignmentKeys.add(assignmentKey);
		return {
			id: `builtin-${slugify(doc.sourceKey)}`,
			name: doc.name,
			roleType,
			assignmentKey,
			systemPrompt: doc.body,
			summary: doc.description,
			category: doc.category,
			sourceRelPath: doc.sourceRelPath,
			enabled: true,
		};
	});

	const roleOrder: Record<TeamRoleType, number> = {
		team_lead: 0,
		frontend: 1,
		backend: 2,
		qa: 3,
		reviewer: 4,
		custom: 5,
	};

	return experts.sort((left, right) => {
		const roleDiff = roleOrder[left.roleType] - roleOrder[right.roleType];
		if (roleDiff !== 0) {
			return roleDiff;
		}
		return left.name.localeCompare(right.name);
	});
}

export function listBuiltinTeamExperts(repoPath = BUILTIN_TEAM_REPO_PATH): BuiltinTeamRuntimeExpert[] {
	return buildBuiltinExperts(resolveBuiltinTeamRepoPath(repoPath));
}

export function getBuiltinTeamCatalogPayload(repoPath = BUILTIN_TEAM_REPO_PATH): BuiltinTeamCatalogPayload {
	const resolvedRepoPath = resolveBuiltinTeamRepoPath(repoPath);
	try {
		const experts = listBuiltinTeamExperts(resolvedRepoPath);
		return {
			ok: true,
			repoPath: resolvedRepoPath,
			experts: experts.map<BuiltinTeamExpertSummary>((expert) => ({
				id: expert.id,
				name: expert.name,
				roleType: expert.roleType,
				assignmentKey: expert.assignmentKey ?? '',
				summary: expert.summary,
				category: expert.category,
				sourceRelPath: expert.sourceRelPath,
			})),
			loadedAt: Date.now(),
		};
	} catch (error) {
		return {
			ok: false,
			repoPath: resolvedRepoPath,
			experts: [],
			error: error instanceof Error ? error.message : String(error),
			loadedAt: Date.now(),
		};
	}
}
