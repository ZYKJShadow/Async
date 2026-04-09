import { useEffect, useRef } from 'react';

export type ToolApprovalPayload = {
	approvalId: string;
	toolName: string;
	command?: string;
	path?: string;
};

type Props = {
	payload: ToolApprovalPayload | null;
	onAllow: () => void;
	onDeny: () => void;
	title: string;
	allowLabel: string;
	denyLabel: string;
};

export function ToolApprovalInlineCard({ payload, onAllow, onDeny, title, allowLabel, denyLabel }: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const denyBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!payload) {
			return;
		}
		rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		queueMicrotask(() => denyBtnRef.current?.focus());
	}, [payload?.approvalId]);

	useEffect(() => {
		if (!payload) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onDeny();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [payload?.approvalId, onDeny]);

	if (!payload) {
		return null;
	}

	const body =
		payload.toolName === 'Bash'
			? (payload.command ?? '')
			: payload.path
				? `${payload.toolName}: ${payload.path}`
				: payload.toolName;

	return (
		<div
			ref={rootRef}
			className="ref-tool-approval-inline"
			role="region"
			aria-labelledby="ref-tool-approval-inline-title"
		>
			<div className="ref-tool-approval-inline-inner">
				<h2 id="ref-tool-approval-inline-title" className="ref-tool-approval-inline-title">
					{title}
				</h2>
				<pre className="ref-tool-approval-inline-body">{body}</pre>
				<div className="ref-tool-approval-inline-actions">
					<button ref={denyBtnRef} type="button" className="ref-tool-approval-btn ref-tool-approval-btn--deny" onClick={onDeny}>
						{denyLabel}
					</button>
					<button type="button" className="ref-tool-approval-btn ref-tool-approval-btn--allow" onClick={onAllow}>
						{allowLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
