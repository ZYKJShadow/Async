import type { TransitionEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import { IconDownload, IconPlus } from '../../icons';

type SkillDialogTab = 'create' | 'import';

export function CreateSkillDialog({
	open,
	t,
	onClose,
	onCreate,
	onImport,
}: {
	open: boolean;
	t: TFunction;
	onClose: () => void;
	onCreate: (name: string, description: string) => Promise<void>;
	onImport: (url: string) => Promise<void>;
}) {
	const [tab, setTab] = useState<SkillDialogTab>('create');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [importUrl, setImportUrl] = useState('');
	const [busy, setBusy] = useState(false);
	const [createErr, setCreateErr] = useState<string | null>(null);
	const [importErr, setImportErr] = useState<string | null>(null);
	const [mounted, setMounted] = useState(open);
	const [overlayVisible, setOverlayVisible] = useState(false);
	const exitFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const enterRafInnerRef = useRef(0);

	useEffect(() => {
		if (open) {
			setMounted(true);
			const raf1 = requestAnimationFrame(() => {
				enterRafInnerRef.current = requestAnimationFrame(() => setOverlayVisible(true));
			});
			return () => {
				cancelAnimationFrame(raf1);
				cancelAnimationFrame(enterRafInnerRef.current);
			};
		}
		setOverlayVisible(false);
	}, [open]);

	useEffect(() => {
		if (!open && mounted) {
			if (exitFallbackTimerRef.current) {
				clearTimeout(exitFallbackTimerRef.current);
			}
			exitFallbackTimerRef.current = setTimeout(() => {
				exitFallbackTimerRef.current = null;
				setMounted(false);
			}, 320);
			return () => {
				if (exitFallbackTimerRef.current) {
					clearTimeout(exitFallbackTimerRef.current);
					exitFallbackTimerRef.current = null;
				}
			};
		}
	}, [open, mounted]);

	const onOverlayTransitionEnd = useCallback((e: TransitionEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget || e.propertyName !== 'opacity') {
			return;
		}
		if (!open) {
			if (exitFallbackTimerRef.current) {
				clearTimeout(exitFallbackTimerRef.current);
				exitFallbackTimerRef.current = null;
			}
			setMounted(false);
		}
	}, [open]);

	useEffect(() => {
		if (open) {
			setTab('create');
			setName('');
			setDescription('');
			setImportUrl('');
			setBusy(false);
			setCreateErr(null);
			setImportErr(null);
		}
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				if (!busy) {
					onClose();
				}
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open, onClose, busy]);

	const detectedSource = useMemo(() => {
		const url = importUrl.trim().toLowerCase();
		if (url.includes('clawhub.ai')) {
			return 'clawhub' as const;
		}
		if (url.includes('skills.sh')) {
			return 'skills.sh' as const;
		}
		return null;
	}, [importUrl]);

	const handleCreate = useCallback(async () => {
		const nm = name.trim();
		if (!nm) {
			return;
		}
		setBusy(true);
		setCreateErr(null);
		try {
			await onCreate(nm, description.trim());
			onClose();
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setBusy(false);
		}
	}, [description, name, onClose, onCreate]);

	const handleImport = useCallback(async () => {
		const u = importUrl.trim();
		if (!u) {
			return;
		}
		setBusy(true);
		setImportErr(null);
		try {
			await onImport(u);
			onClose();
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setBusy(false);
		}
	}, [importUrl, onClose, onImport]);

	const importBusyLabel =
		detectedSource === 'clawhub'
			? t('aiEmployees.skills.importingClawhub')
			: detectedSource === 'skills.sh'
				? t('aiEmployees.skills.importingSkillsSh')
				: t('aiEmployees.skills.importing');

	const node = (
		<div
			className={`ref-ai-employees-create-dialog-overlay${overlayVisible ? ' is-visible' : ''}`}
			role="presentation"
			onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
			onTransitionEnd={onOverlayTransitionEnd}
		>
			<div className="ref-ai-employees-create-dialog ref-ai-employees-skill-create-dialog" role="dialog" aria-modal aria-labelledby="ref-ai-employees-skill-create-title">
				<h2 id="ref-ai-employees-skill-create-title" className="ref-ai-employees-create-dialog-title">
					{t('aiEmployees.skills.modalTitle')}
				</h2>
				<p className="ref-ai-employees-skill-create-desc">{t('aiEmployees.skills.modalDesc')}</p>

				<div className="ref-ai-employees-skill-dialog-tabs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'create'}
						className={`ref-ai-employees-skill-dialog-tab${tab === 'create' ? ' is-active' : ''}`}
						onClick={() => {
							setTab('create');
							setCreateErr(null);
						}}
						disabled={busy}
					>
						<IconPlus className="ref-ai-employees-skill-dialog-tab-icon" />
						{t('aiEmployees.skills.tabCreate')}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'import'}
						className={`ref-ai-employees-skill-dialog-tab${tab === 'import' ? ' is-active' : ''}`}
						onClick={() => {
							setTab('import');
							setImportErr(null);
						}}
						disabled={busy}
					>
						<IconDownload className="ref-ai-employees-skill-dialog-tab-icon" />
						{t('aiEmployees.skills.tabImport')}
					</button>
				</div>

				{tab === 'create' ? (
					<div className="ref-ai-employees-skill-dialog-panel">
						{createErr ? (
							<div className="ref-ai-employees-banner ref-ai-employees-banner--err ref-ai-employees-skill-dialog-tab-err" role="alert">
								{createErr}
							</div>
						) : null}
						<label className="ref-ai-employees-create-dialog-field">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.skills.name')}</span>
							<input
								className="ref-ai-employees-input"
								value={name}
								onChange={(e) => setName(e.target.value)}
								autoFocus
								placeholder={t('aiEmployees.skills.namePh')}
								disabled={busy}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && name.trim()) {
										e.preventDefault();
										void handleCreate();
									}
								}}
							/>
						</label>
						<label className="ref-ai-employees-create-dialog-field">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.skills.description')}</span>
							<input
								className="ref-ai-employees-input"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder={t('aiEmployees.skills.descPh')}
								disabled={busy}
							/>
						</label>
					</div>
				) : (
					<div className="ref-ai-employees-skill-dialog-panel">
						<label className="ref-ai-employees-create-dialog-field">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.skills.skillUrl')}</span>
							<input
								className="ref-ai-employees-input"
								value={importUrl}
								onChange={(e) => {
									setImportUrl(e.target.value);
									setImportErr(null);
								}}
								autoFocus
								placeholder={t('aiEmployees.skills.skillUrlPh')}
								disabled={busy}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && importUrl.trim()) {
										e.preventDefault();
										void handleImport();
									}
								}}
							/>
						</label>
						<p className="ref-ai-employees-skill-import-sources-label">{t('aiEmployees.skills.supportedSources')}</p>
						<div className="ref-ai-employees-skill-import-sources">
							<div className={`ref-ai-employees-skill-import-source${detectedSource === 'clawhub' ? ' is-highlight' : ''}`}>
								<div className="ref-ai-employees-skill-import-source-title">ClawHub</div>
								<div className="ref-ai-employees-skill-import-source-mono">{t('aiEmployees.skills.sourceClawHubSample')}</div>
							</div>
							<div className={`ref-ai-employees-skill-import-source${detectedSource === 'skills.sh' ? ' is-highlight' : ''}`}>
								<div className="ref-ai-employees-skill-import-source-title">Skills.sh</div>
								<div className="ref-ai-employees-skill-import-source-mono">{t('aiEmployees.skills.sourceSkillsShSample')}</div>
							</div>
						</div>
						{importErr ? (
							<div className="ref-ai-employees-skill-import-inline-err" role="alert">
								{importErr}
							</div>
						) : null}
					</div>
				)}

				<div className="ref-ai-employees-create-dialog-actions">
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy} onClick={onClose}>
						{t('common.cancel')}
					</button>
					{tab === 'create' ? (
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy || !name.trim()} onClick={() => void handleCreate()}>
							{busy ? t('aiEmployees.skills.creating') : t('aiEmployees.skills.createSubmit')}
						</button>
					) : (
						<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy || !importUrl.trim()} onClick={() => void handleImport()}>
							{busy ? importBusyLabel : t('aiEmployees.skills.importSubmit')}
						</button>
					)}
				</div>
			</div>
		</div>
	);

	if (!mounted) {
		return null;
	}
	const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
	return host ? createPortal(node, host) : node;
}
