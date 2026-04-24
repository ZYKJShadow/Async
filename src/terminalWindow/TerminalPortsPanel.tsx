import { memo, useEffect, useState } from 'react';
import type { TFunction } from '../i18n';
import type { TerminalPortForward, TerminalProfile } from './terminalSettings';

type PortCheckStatus = 'checking' | 'listening' | 'closed' | 'remote-unchecked' | 'unknown';

type Props = {
	t: TFunction;
	profile: TerminalProfile;
	onClose(): void;
	onCopy(text: string): void;
	onOpenSettings(): void;
};

export const TerminalPortsPanel = memo(function TerminalPortsPanel({ t, profile, onClose, onCopy, onOpenSettings }: Props) {
	const forwards = profile.sshForwardedPorts ?? [];
	const [statusById, setStatusById] = useState<Record<string, PortCheckStatus>>({});

	useEffect(() => {
		let cancelled = false;
		setStatusById(Object.fromEntries(forwards.map((forward) => [forward.id, 'checking' as PortCheckStatus])));
		void Promise.allSettled(
			forwards.map(async (forward) => {
				try {
					const result = (await window.asyncShell?.invoke('term:portCheck', forward)) as
						| { ok: true; status: PortCheckStatus }
						| { ok: false }
						| undefined;
					return [forward.id, result?.ok ? result.status : 'unknown'] as const;
				} catch {
					return [forward.id, 'unknown'] as const;
				}
			})
		).then((results) => {
			if (!cancelled) {
				const entries = [];
				for (const r of results) {
					if (r.status === 'fulfilled') {
						entries.push(r.value);
					}
				}
				setStatusById(Object.fromEntries(entries));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [forwards]);
	return (
		<aside className="ref-uterm-ports-panel" aria-label={t('app.universalTerminalPorts.title')}>
			<div className="ref-uterm-ports-head">
				<div>
					<div className="ref-uterm-ports-kicker">{t('app.universalTerminalToolbarPorts')}</div>
					<h2 className="ref-uterm-ports-title">{t('app.universalTerminalPorts.title')}</h2>
				</div>
				<button type="button" className="ref-uterm-ports-close" onClick={onClose}>
					{t('common.close')}
				</button>
			</div>
			{forwards.length ? (
				<div className="ref-uterm-ports-list">
					{forwards.map((forward) => {
						const summary = formatForwardSummary(forward);
						const status = statusById[forward.id] ?? 'unknown';
						return (
							<div key={forward.id} className="ref-uterm-port-card">
								<div className="ref-uterm-port-card-main">
									<div className="ref-uterm-port-badge-row">
										<span className="ref-uterm-port-badge">{t(`app.universalTerminalPorts.type.${forward.type}`)}</span>
										<span className={`ref-uterm-port-status is-${status}`}>{t(`app.universalTerminalPorts.status.${status}`)}</span>
									</div>
									<strong className="ref-uterm-port-summary">{summary}</strong>
									{forward.description ? <span className="ref-uterm-port-description">{forward.description}</span> : null}
								</div>
								<button type="button" className="ref-uterm-port-copy" onClick={() => onCopy(summary)}>
									{t('app.universalTerminalPorts.copy')}
								</button>
							</div>
						);
					})}
				</div>
			) : (
				<div className="ref-uterm-ports-empty">
					<p>{t('app.universalTerminalPorts.empty')}</p>
					<button type="button" className="ref-uterm-ports-settings" onClick={onOpenSettings}>
						{t('app.universalTerminalPorts.configure')}
					</button>
				</div>
			)}
		</aside>
	);
});

function formatForwardSummary(forward: TerminalPortForward): string {
	const source = `${forward.host || '127.0.0.1'}:${forward.port}`;
	if (forward.type === 'dynamic') {
		return `SOCKS ${source}`;
	}
	const target = `${forward.targetAddress || '127.0.0.1'}:${forward.targetPort}`;
	return `${source} ? ${target}`;
}
