import { CODEX_ORIGINATOR } from '../../src/providerIdentitySettings.js';

/**
 * CLIProxyAPI fingerprints Codex OAuth traffic as Codex TUI, including a
 * pinned macOS/iTerm token even when the proxy itself is running elsewhere.
 */
export function buildCodexUserAgent(buildVersion: string): string {
	return `${CODEX_ORIGINATOR}/${buildVersion} (Mac OS 26.3.1; arm64) iTerm.app/3.6.9 (${CODEX_ORIGINATOR}; ${buildVersion})`;
}
