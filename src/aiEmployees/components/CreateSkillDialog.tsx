import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
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
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setTab('create');
			setName('');
			setDescription('');
			setImportUrl('');
			setBusy(false);
			setErr(null);
		}
	}, [open]);

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
		setErr(null);
		try {
			await onCreate(nm, description.trim());
			onClose();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
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
		setErr(null);
		try {
			await onImport(u);
			onClose();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
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
		<div className="ref-ai-employees-create-dialog-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
			<div className="ref-ai-employees-create-dialog ref-ai-employees-skill-create-dialog" role="dialog" aria-modal aria-labelledby="ref-ai-employees-skill-create-title">
				<h2 id="ref-ai-employees-skill-create-title" className="ref-ai-employees-create-dialog-title">
					{t('aiEmployees.skills.modalTitle')}
				</h2>
				<p className="ref-ai-employees-skill-create-desc">{t('aiEmployees.skills.modalDesc')}</p>
				{err ? (
					<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
						{err}
					</div>
				) : null}
				<div className="ref-ai-employees-skill-dialog-tabs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'create'}
						className={`ref-ai-employees-skill-dialog-tab${tab === 'create' ? ' is-active' : ''}`}
						onClick={() => setTab('create')}
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
						onClick={() => setTab('import')}
						disabled={busy}
					>
						<IconDownload className="ref-ai-employees-skill-dialog-tab-icon" />
						{t('aiEmployees.skills.tabImport')}
					</button>
				</div>

				{tab === 'create' ? (
					<div className="ref-ai-employees-skill-dialog-panel">
						<label className="ref-ai-employees-create-dialog-field">
							<span>{t('aiEmployees.skills.name')}</span>
							<input className="ref-ai-employees-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('aiEmployees.skills.namePh')} disabled={busy} />
						</label>
						<label className="ref-ai-employees-create-dialog-field">
							<span>{t('aiEmployees.skills.description')}</span>
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
							<span>{t('aiEmployees.skills.skillUrl')}</span>
							<input
								className="ref-ai-employees-input"
								value={importUrl}
								onChange={(e) => {
									setImportUrl(e.target.value);
									setErr(null);
								}}
								placeholder={t('aiEmployees.skills.skillUrlPh')}
								disabled={busy}
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

	if (!open) {
		return null;
	}
	const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
	return host ? createPortal(node, host) : node;
}
