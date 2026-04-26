/**
 * Git remote URL helpers used by the commit modal to drive "Create PR" links.
 *
 * Supports:
 *  - https URLs with optional `.git` suffix
 *  - SSH-shorthand `git@host:owner/repo(.git)`
 *  - SSH URLs `ssh://git@host[:port]/owner/repo(.git)`
 *  - Stripping basic-auth segments and trailing slashes
 *
 * Recognised hosts (for compare-url shape):
 *   github.com, gitlab.com, bitbucket.org, codeberg.org, gitea.com,
 *   plus any *.gitlab.* / *.bitbucket.* / *.gitea.* / self-hosted Forgejo (treated as GitHub-shape unless host contains "gitlab"/"bitbucket").
 *
 * For unknown hosts we fall back to a GitHub-shape compare URL — most self-hosted Gitea/Forgejo
 * forks accept the same `/compare/A...B` path.
 */

export type ParsedRemote = {
	/** Web base URL of the repository, without trailing slash. e.g. `https://github.com/owner/repo` */
	webUrl: string;
	host: string;
	owner: string;
	repo: string;
	provider: 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'unknown';
};

const PROVIDER_PATTERNS: Array<{ test: (host: string) => boolean; provider: ParsedRemote['provider'] }> = [
	{ test: (h) => h === 'github.com' || h.endsWith('.github.com'), provider: 'github' },
	{ test: (h) => h === 'gitlab.com' || h.includes('gitlab'), provider: 'gitlab' },
	{ test: (h) => h === 'bitbucket.org' || h.includes('bitbucket'), provider: 'bitbucket' },
	{ test: (h) => h.includes('gitea') || h.includes('codeberg') || h.includes('forgejo'), provider: 'gitea' },
];

function detectProvider(host: string): ParsedRemote['provider'] {
	const h = host.toLowerCase();
	for (const { test, provider } of PROVIDER_PATTERNS) {
		if (test(h)) {
			return provider;
		}
	}
	return 'unknown';
}

function stripDotGit(p: string): string {
	return p.replace(/\.git$/i, '').replace(/\/+$/, '');
}

export function parseGitRemoteUrl(remoteUrl: string): ParsedRemote | null {
	const raw = String(remoteUrl ?? '').trim();
	if (!raw) {
		return null;
	}

	// SSH shorthand: git@host:owner/repo(.git)
	const sshShort = /^[\w.-]+@([^:\s]+):(.+)$/.exec(raw);
	if (sshShort) {
		const host = sshShort[1] ?? '';
		const tail = stripDotGit(sshShort[2] ?? '');
		const segments = tail.split('/').filter(Boolean);
		if (segments.length < 2 || !host) {
			return null;
		}
		const owner = segments[0]!;
		const repo = segments[segments.length - 1]!;
		return {
			host,
			owner,
			repo,
			webUrl: `https://${host}/${segments.join('/')}`,
			provider: detectProvider(host),
		};
	}

	// http(s)://, ssh://, git://
	let parsed: URL | null = null;
	try {
		parsed = new URL(raw);
	} catch {
		parsed = null;
	}
	if (!parsed) {
		return null;
	}
	const host = parsed.host || parsed.hostname;
	if (!host) {
		return null;
	}
	const path = stripDotGit(parsed.pathname.replace(/^\/+/, ''));
	const segments = path.split('/').filter(Boolean);
	if (segments.length < 2) {
		return null;
	}
	const owner = segments[0]!;
	const repo = segments[segments.length - 1]!;
	const webHost = host.replace(/:\d+$/, '');
	return {
		host: webHost,
		owner,
		repo,
		webUrl: `https://${webHost}/${segments.join('/')}`,
		provider: detectProvider(webHost),
	};
}

/**
 * Build a "create-PR / merge-request" URL for the given branch against the default branch.
 * Returns `null` if the URL cannot be derived (e.g. unparseable remote).
 */
export function buildCompareUrl(
	remoteUrl: string,
	branch: string,
	defaultBranch: string
): string | null {
	const head = encodeURIComponent(String(branch ?? '').trim());
	const base = encodeURIComponent(String(defaultBranch ?? '').trim() || 'main');
	if (!head) {
		return null;
	}
	const parsed = parseGitRemoteUrl(remoteUrl);
	if (!parsed) {
		return null;
	}
	switch (parsed.provider) {
		case 'gitlab':
			return `${parsed.webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${head}&merge_request%5Btarget_branch%5D=${base}`;
		case 'bitbucket':
			return `${parsed.webUrl}/pull-requests/new?source=${head}&dest=${base}`;
		case 'gitea':
			return `${parsed.webUrl}/compare/${base}...${head}`;
		case 'github':
		case 'unknown':
		default:
			return `${parsed.webUrl}/compare/${base}...${head}?expand=1`;
	}
}
