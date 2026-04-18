import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../i18n';

type Props = {
	t: TFunction;
	kind: 'password' | 'passphrase';
	prompt: string;
	sessionTitle: string;
	profileName: string;
	onCancel(): void;
	onSubmit(value: string, remember: boolean): void;
};

export function TerminalAuthPromptModal({
	t,
	kind,
	prompt,
	sessionTitle,
	profileName,
	onCancel,
	onSubmit,
}: Props) {
	const [value, setValue] = useState('');
	const [remember, setRemember] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onCancel();
				return;
			}
			if (event.key === 'Enter' && value.length > 0) {
				event.preventDefault();
				onSubmit(value, kind === 'password' && remember);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [kind, onCancel, onSubmit, remember, value]);

	const hasValue = value.length > 0;

	const modal = (
		<div className="ref-uterm-auth-modal-backdrop" role="presentation" onClick={onCancel}>
			<div
				className="ref-uterm-auth-modal"
				role="dialog"
				aria-modal="true"
				aria-label={t('app.universalTerminalAuthPromptTitle')}
				onClick={(event) => event.stopPropagation()}
			>
				<div className="ref-uterm-auth-modal-head">
					<div>
						<div className="ref-uterm-auth-modal-kicker">{t('app.universalTerminalWindowTitle')}</div>
						<h3 className="ref-uterm-auth-modal-title">{t('app.universalTerminalAuthPromptTitle')}</h3>
						<p className="ref-uterm-auth-modal-copy">{t('app.universalTerminalAuthPromptCopy')}</p>
					</div>
					<button type="button" className="ref-uterm-auth-modal-close" onClick={onCancel} aria-label={t('common.close')}>
						×
					</button>
				</div>

				<div className="ref-uterm-auth-modal-body">
					<div className="ref-uterm-auth-modal-meta">
						<div className="ref-uterm-auth-modal-meta-row">
							<span className="ref-uterm-auth-modal-meta-label">{t('app.universalTerminalAuthPromptSession')}</span>
							<span className="ref-uterm-auth-modal-meta-value">{sessionTitle}</span>
						</div>
						<div className="ref-uterm-auth-modal-meta-row">
							<span className="ref-uterm-auth-modal-meta-label">{t('app.universalTerminalAuthPromptProfile')}</span>
							<span className="ref-uterm-auth-modal-meta-value">{profileName}</span>
						</div>
					</div>

					<div className="ref-uterm-auth-modal-prompt">{prompt}</div>

					<input
						ref={inputRef}
						type="password"
						className="ref-uterm-auth-modal-input"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						placeholder={
							kind === 'passphrase'
								? t('app.universalTerminalAuthPromptPassphrasePlaceholder')
								: t('app.universalTerminalAuthPromptPasswordPlaceholder')
						}
					/>

					{kind === 'password' ? (
						<label className="ref-uterm-auth-modal-remember">
							<input
								type="checkbox"
								checked={remember}
								onChange={(event) => setRemember(event.target.checked)}
							/>
							<span>{t('app.universalTerminalAuthPromptRemember')}</span>
						</label>
					) : null}
				</div>

				<div className="ref-uterm-auth-modal-foot">
					<button type="button" className="ref-uterm-auth-modal-btn is-ghost" onClick={onCancel}>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						className="ref-uterm-auth-modal-btn is-primary"
						onClick={() => onSubmit(value, kind === 'password' && remember)}
						disabled={!hasValue}
					>
						{t('common.continue')}
					</button>
				</div>
			</div>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(modal, document.body) : null;
}
