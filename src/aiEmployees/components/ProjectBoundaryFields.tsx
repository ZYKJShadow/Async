import type { TFunction } from '../../i18n';
import type { ProjectBoundaryKind } from '../api/types';

export function normalizeProjectBoundaryKind(raw: string | undefined | null): ProjectBoundaryKind {
	if (raw === 'local_folder' || raw === 'git_repo') {
		return raw;
	}
	return 'none';
}

export function isPlausibleGitRemote(s: string): boolean {
	const t = s.trim().toLowerCase();
	return (
		t.startsWith('https://') ||
		t.startsWith('http://') ||
		t.startsWith('git@') ||
		t.startsWith('ssh://') ||
		t.startsWith('file:')
	);
}

export async function pickLocalDirectoryPath(): Promise<string | null> {
	const sh = window.asyncShell;
	if (!sh) {
		return null;
	}
	const r = (await sh.invoke('usageStats:pickDirectory')) as { ok?: boolean; path?: string };
	return r.ok && typeof r.path === 'string' && r.path.trim() ? r.path.trim() : null;
}

export function projectBoundaryApiFields(
	mode: ProjectBoundaryKind,
	localPath: string,
	gitUrl: string
): { boundary_kind: ProjectBoundaryKind; boundary_local_path: string | null; boundary_git_url: string | null } {
	if (mode === 'none') {
		return { boundary_kind: 'none', boundary_local_path: null, boundary_git_url: null };
	}
	if (mode === 'local_folder') {
		const p = localPath.trim();
		return { boundary_kind: 'local_folder', boundary_local_path: p.length ? p : null, boundary_git_url: null };
	}
	const g = gitUrl.trim();
	return { boundary_kind: 'git_repo', boundary_local_path: null, boundary_git_url: g.length ? g : null };
}

function shortPathDisplay(path: string, max = 52): string {
	const p = path.replace(/\\/g, '/');
	if (p.length <= max) {
		return p;
	}
	return `…${p.slice(-(max - 1))}`;
}

export function ProjectBoundaryFields({
	t,
	mode,
	localPath,
	gitUrl,
	onModeChange,
	onLocalPathChange,
	onGitUrlChange,
	compact,
}: {
	t: TFunction;
	mode: ProjectBoundaryKind;
	localPath: string;
	gitUrl: string;
	onModeChange: (m: ProjectBoundaryKind) => void;
	onLocalPathChange: (path: string) => void;
	onGitUrlChange: (url: string) => void;
	compact?: boolean;
}) {
	const modeBtn = (m: ProjectBoundaryKind, label: string) => (
		<button
			key={m}
			type="button"
			className={`ref-ai-employees-create-project-boundary-pill ${mode === m ? 'is-active' : ''}`}
			onClick={() => {
				onModeChange(m);
				if (m === 'none') {
					onLocalPathChange('');
					onGitUrlChange('');
				} else if (m === 'local_folder') {
					onGitUrlChange('');
				} else {
					onLocalPathChange('');
				}
			}}
		>
			{label}
		</button>
	);

	return (
		<div className={`ref-ai-employees-create-project-boundary${compact ? ' ref-ai-employees-create-project-boundary--compact' : ''}`}>
			<div className="ref-ai-employees-create-project-boundary-head">
				<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.projects.boundaryTitle')}</span>
				<p className="ref-ai-employees-create-project-boundary-hint">{t('aiEmployees.projects.boundaryHint')}</p>
			</div>
			<div className="ref-ai-employees-create-project-boundary-modes" role="radiogroup" aria-label={t('aiEmployees.projects.boundaryTitle')}>
				{modeBtn('none', t('aiEmployees.projects.boundaryNone'))}
				{modeBtn('local_folder', t('aiEmployees.projects.boundaryLocal'))}
				{modeBtn('git_repo', t('aiEmployees.projects.boundaryGit'))}
			</div>
			{mode === 'local_folder' ? (
				<div className="ref-ai-employees-create-project-boundary-local">
					<div className="ref-ai-employees-create-project-boundary-path-row">
						<span className="ref-ai-employees-create-project-boundary-path" title={localPath || undefined}>
							{localPath ? shortPathDisplay(localPath) : t('aiEmployees.projects.boundaryLocalEmpty')}
						</span>
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-btn--sm"
							onClick={() => {
								void (async () => {
									const p = await pickLocalDirectoryPath();
									if (p) {
										onLocalPathChange(p);
									}
								})();
							}}
						>
							{t('aiEmployees.projects.boundaryPickFolder')}
						</button>
					</div>
					<p className="ref-ai-employees-create-project-boundary-note">{t('aiEmployees.projects.boundaryLocalNote')}</p>
				</div>
			) : null}
			{mode === 'git_repo' ? (
				<div className="ref-ai-employees-create-project-boundary-git">
					<input
						className="ref-ai-employees-input"
						type="url"
						value={gitUrl}
						onChange={(e) => onGitUrlChange(e.target.value)}
						placeholder={t('aiEmployees.projects.boundaryGitPlaceholder')}
						autoComplete="off"
						spellCheck={false}
					/>
					<p className="ref-ai-employees-create-project-boundary-note">{t('aiEmployees.projects.boundaryGitNote')}</p>
				</div>
			) : null}
		</div>
	);
}
