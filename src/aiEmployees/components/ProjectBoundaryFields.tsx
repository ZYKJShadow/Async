import type { TFunction } from '../../i18n';
import type { ProjectBoundaryKind } from '../api/types';
import { notifyAiEmployeesRequestFailed, publishAiEmployeesNetworkError } from '../AiEmployeesNetworkToast';

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
		t.startsWith('ssh://')
	);
}

export function normalizeBoundaryLocalPath(raw: string): string {
	const normalized = raw.trim().replace(/\\/g, '/');
	if (!normalized) {
		return '';
	}
	if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
		return normalized;
	}
	return normalized.replace(/\/+$/, '');
}

export async function pickLocalDirectoryPath(t?: TFunction): Promise<string | null> {
	const sh = window.asyncShell;
	if (!sh) {
		publishAiEmployeesNetworkError(
			t ? t('aiEmployees.projects.boundaryPickerUnavailable') : 'Directory picker is unavailable in this environment.'
		);
		return null;
	}
	try {
		const r = (await sh.invoke('usageStats:pickDirectory')) as { ok?: boolean; path?: string };
		return r.ok && typeof r.path === 'string' && r.path.trim() ? normalizeBoundaryLocalPath(r.path) : null;
	} catch (e) {
		notifyAiEmployeesRequestFailed(e);
		return null;
	}
}

export function projectBoundaryApiFields(
	mode: ProjectBoundaryKind,
	localPath: string,
	gitUrl: string
): { boundary_kind: ProjectBoundaryKind; boundary_local_path?: string; boundary_git_url?: string } {
	if (mode === 'none') {
		return { boundary_kind: 'none' };
	}
	if (mode === 'local_folder') {
		const p = normalizeBoundaryLocalPath(localPath);
		return p ? { boundary_kind: 'local_folder', boundary_local_path: p } : { boundary_kind: 'local_folder' };
	}
	const g = gitUrl.trim();
	return g ? { boundary_kind: 'git_repo', boundary_git_url: g } : { boundary_kind: 'git_repo' };
}

export async function validateLocalBoundaryPath(path: string): Promise<'ok' | 'missing' | 'not_directory' | 'unknown'> {
	const sh = window.asyncShell;
	const p = normalizeBoundaryLocalPath(path);
	if (!p || !sh) {
		return 'unknown';
	}
	try {
		const r = (await sh.invoke('projectBoundary:checkLocalPath', p)) as {
			ok?: boolean;
			exists?: boolean;
			isDirectory?: boolean;
		};
		if (!r?.ok) {
			return 'unknown';
		}
		if (!r.exists) {
			return 'missing';
		}
		return r.isDirectory ? 'ok' : 'not_directory';
	} catch {
		return 'unknown';
	}
}

export async function testGitBoundaryRemote(remote: string): Promise<'ok' | 'auth' | 'not_found' | 'network' | 'failed' | 'invalid'> {
	const sh = window.asyncShell;
	const val = remote.trim();
	if (!val || !isPlausibleGitRemote(val)) {
		return 'invalid';
	}
	if (!sh) {
		return 'failed';
	}
	try {
		const r = (await sh.invoke('projectBoundary:testGitRemote', val)) as {
			ok?: boolean;
			reachable?: boolean;
			code?: string;
		};
		if (!r?.ok) {
			return 'failed';
		}
		if (r.reachable) {
			return 'ok';
		}
		if (r.code === 'auth' || r.code === 'not_found' || r.code === 'network') {
			return r.code;
		}
		return 'failed';
	} catch {
		return 'failed';
	}
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
	localValidationState,
	onGitConnectionTest,
	gitConnectionTestState,
	compact,
}: {
	t: TFunction;
	mode: ProjectBoundaryKind;
	localPath: string;
	gitUrl: string;
	onModeChange: (m: ProjectBoundaryKind) => void;
	onLocalPathChange: (path: string) => void;
	onGitUrlChange: (url: string) => void;
	localValidationState?: 'idle' | 'checking' | 'ok' | 'missing' | 'not_directory' | 'unknown';
	onGitConnectionTest?: () => void;
	gitConnectionTestState?: 'idle' | 'testing' | 'ok' | 'auth' | 'not_found' | 'network' | 'failed';
	compact?: boolean;
}) {
	const normalizedLocal = normalizeBoundaryLocalPath(localPath);
	const gitTrimmed = gitUrl.trim();
	const gitLooksValid = !gitTrimmed || isPlausibleGitRemote(gitTrimmed);

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
									const p = await pickLocalDirectoryPath(t);
									if (p) {
										onLocalPathChange(p);
									}
								})();
							}}
						>
							{t('aiEmployees.projects.boundaryPickFolder')}
						</button>
					</div>
					{normalizedLocal ? (
						<p
							className={`ref-ai-employees-create-project-boundary-validation ${
								localValidationState === 'missing' || localValidationState === 'not_directory'
									? 'is-invalid'
									: localValidationState === 'ok'
										? 'is-valid'
										: 'is-muted'
							}`}
						>
							{localValidationState === 'checking'
								? t('aiEmployees.projects.boundaryLocalChecking')
								: localValidationState === 'missing'
									? t('aiEmployees.projects.boundaryLocalMissing')
									: localValidationState === 'not_directory'
										? t('aiEmployees.projects.boundaryLocalNotDirectory')
										: localValidationState === 'unknown'
											? t('aiEmployees.projects.boundaryLocalUnknown')
											: t('aiEmployees.projects.boundaryLocalLooksValid')}
						</p>
					) : null}
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
					{gitTrimmed ? (
						<p className={`ref-ai-employees-create-project-boundary-validation ${gitLooksValid ? 'is-valid' : 'is-invalid'}`}>
							{gitLooksValid ? t('aiEmployees.projects.boundaryGitLooksValid') : t('aiEmployees.projects.boundaryGitInvalid')}
						</p>
					) : null}
					<div className="ref-ai-employees-create-project-boundary-actions">
						<button
							type="button"
							className="ref-ai-employees-btn ref-ai-employees-btn--secondary ref-ai-employees-btn--sm"
							disabled={!onGitConnectionTest || !gitTrimmed || !gitLooksValid || gitConnectionTestState === 'testing'}
							onClick={() => onGitConnectionTest?.()}
						>
							{gitConnectionTestState === 'testing' ? t('common.loading') : t('aiEmployees.projects.boundaryGitTest')}
						</button>
						{gitConnectionTestState && gitConnectionTestState !== 'idle' && gitConnectionTestState !== 'testing' ? (
							<span
								className={`ref-ai-employees-create-project-boundary-test-result ${
									gitConnectionTestState === 'ok' ? 'is-valid' : 'is-invalid'
								}`}
							>
								{gitConnectionTestState === 'ok'
									? t('aiEmployees.projects.boundaryGitTestOk')
									: gitConnectionTestState === 'auth'
										? t('aiEmployees.projects.boundaryGitTestAuth')
										: gitConnectionTestState === 'not_found'
											? t('aiEmployees.projects.boundaryGitTestNotFound')
											: gitConnectionTestState === 'network'
												? t('aiEmployees.projects.boundaryGitTestNetwork')
												: t('aiEmployees.projects.boundaryGitTestFailed')}
							</span>
						) : null}
					</div>
					<p className="ref-ai-employees-create-project-boundary-note">{t('aiEmployees.projects.boundaryGitNote')}</p>
				</div>
			) : null}
		</div>
	);
}
