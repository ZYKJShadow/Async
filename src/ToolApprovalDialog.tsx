import { createPortal } from 'react-dom';

export type ToolApprovalPayload = {
	approvalId: string;
	toolName: string;
	command?: string;
	path?: string;
};

type Props = {
	open: boolean;
	payload: ToolApprovalPayload | null;
	onAllow: () => void;
	onDeny: () => void;
	title: string;
	allowLabel: string;
	denyLabel: string;
};

export function ToolApprovalDialog({ open, payload, onAllow, onDeny, title, allowLabel, denyLabel }: Props) {
	if (!open || !payload) {
		return null;
	}

	const body =
		payload.toolName === 'execute_command'
			? payload.command ?? ''
			: payload.path
				? `${payload.toolName}: ${payload.path}`
				: payload.toolName;

	return createPortal(
		<div
			className="ref-tool-approval-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="ref-tool-approval-title"
		>
			<div className="ref-tool-approval-backdrop" onClick={onDeny} aria-hidden />
			<div className="ref-tool-approval-card">
				<h2 id="ref-tool-approval-title" className="ref-tool-approval-title">
					{title}
				</h2>
				<pre className="ref-tool-approval-body">{body}</pre>
				<div className="ref-tool-approval-actions">
					<button type="button" className="ref-tool-approval-btn ref-tool-approval-btn--deny" onClick={onDeny}>
						{denyLabel}
					</button>
					<button type="button" className="ref-tool-approval-btn ref-tool-approval-btn--allow" onClick={onAllow}>
						{allowLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
}
