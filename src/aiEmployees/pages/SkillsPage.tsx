import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from '../../i18n';
import { IconPlus, IconSparkles, IconTrash } from '../../icons';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import type { AiEmployeesConnection } from '../api/client';
import { apiCreateSkill, apiDeleteSkill, apiGetSkill, apiImportSkillFromUrl, apiUpdateSkill } from '../api/client';
import type { SkillFileJson, SkillJson } from '../api/types';
import { CreateSkillDialog } from '../components/CreateSkillDialog';
import { SkillFileTree } from '../components/SkillFileTree';
import { SkillFileViewer } from '../components/SkillFileViewer';

type LocalFile = { path: string; content: string; id?: string };

const MAIN_PATH = 'SKILL.md';

function filesToLocal(files: SkillFileJson[] | undefined, mainContent: string): LocalFile[] {
	const extras = (files ?? []).filter((f) => f.path !== MAIN_PATH);
	const main = { path: MAIN_PATH, content: mainContent };
	return [main, ...extras.map((f) => ({ path: f.path, content: f.content, id: f.id }))];
}

function filesKey(files: LocalFile[]) {
	return JSON.stringify(files.map((f) => ({ path: f.path, content: f.content })));
}

function SkillAddFileDialog({
	t,
	busy,
	existingPaths,
	onClose,
	onAdd,
}: {
	t: TFunction;
	busy: boolean;
	existingPaths: string[];
	onClose: () => void;
	onAdd: (path: string) => void;
}) {
	const [path, setPath] = useState('');
	const duplicate = path.trim().length > 0 && existingPaths.includes(path.trim());

	const node = (
		<div className="ref-ai-employees-create-dialog-overlay is-visible" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
			<div className="ref-ai-employees-create-dialog ref-ai-employees-skill-add-file-dialog" role="dialog" aria-modal aria-labelledby="ref-ai-employees-skill-add-file-title">
				<h2 id="ref-ai-employees-skill-add-file-title" className="ref-ai-employees-create-dialog-title">
					{t('aiEmployees.skills.addFileModalTitle')}
				</h2>
				<p className="ref-ai-employees-skill-create-desc">{t('aiEmployees.skills.addFileModalDesc')}</p>
				<label className="ref-ai-employees-create-dialog-field">
					<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.skills.addFilePathLabel')}</span>
					<input
						className="ref-ai-employees-input ref-ai-employees-input--mono"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder={t('aiEmployees.skills.addFilePathPh')}
						autoFocus
						disabled={busy}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && path.trim() && !duplicate) {
								e.preventDefault();
								onAdd(path.trim());
								onClose();
							}
						}}
					/>
				</label>
				{duplicate ? <p className="ref-ai-employees-skill-add-file-dup">{t('aiEmployees.skills.addFileDuplicate')}</p> : null}
				<div className="ref-ai-employees-create-dialog-actions">
					<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--secondary" disabled={busy} onClick={onClose}>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						className="ref-ai-employees-btn ref-ai-employees-btn--primary"
						disabled={busy || !path.trim() || duplicate}
						onClick={() => {
							onAdd(path.trim());
							onClose();
						}}
					>
						{t('aiEmployees.skills.addFileSubmit')}
					</button>
				</div>
			</div>
		</div>
	);

	const host = typeof document !== 'undefined' ? document.getElementById('ref-ai-employees-inset-modal-host') : null;
	return host ? createPortal(node, host) : node;
}

export function SkillsPage({
	t,
	conn,
	workspaceId,
	skills,
	onRefreshSkills,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	skills: SkillJson[];
	onRefreshSkills: () => void | Promise<void>;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [localFiles, setLocalFiles] = useState<LocalFile[]>([{ path: MAIN_PATH, content: '' }]);
	const [activePath, setActivePath] = useState(MAIN_PATH);
	const [busy, setBusy] = useState(false);
	const [detailLoading, setDetailLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [addFileOpen, setAddFileOpen] = useState(false);
	const [baseline, setBaseline] = useState<{ name: string; description: string; filesKey: string } | null>(null);

	const activeContent = localFiles.find((f) => f.path === activePath)?.content ?? '';

	const setActiveContent = useCallback(
		(value: string | undefined) => {
			const v = value ?? '';
			setLocalFiles((prev) => prev.map((f) => (f.path === activePath ? { ...f, content: v } : f)));
		},
		[activePath]
	);

	const fk = useMemo(() => filesKey(localFiles), [localFiles]);

	const isDirty = useMemo(() => {
		if (!baseline || !selectedId) {
			return false;
		}
		return name.trim() !== baseline.name.trim() || description.trim() !== baseline.description.trim() || fk !== baseline.filesKey;
	}, [baseline, selectedId, name, description, fk]);

	const loadDetail = useCallback(
		async (id: string) => {
			setDetailLoading(true);
			setErr(null);
			try {
				const s = await apiGetSkill(conn, workspaceId, id);
				setSelectedId(s.id);
				const nm = s.name;
				const desc = s.description ?? '';
				const main = s.content ?? '';
				const nextFiles = filesToLocal(s.files, main);
				setName(nm);
				setDescription(desc);
				setLocalFiles(nextFiles);
				setActivePath(MAIN_PATH);
				setBaseline({
					name: nm,
					description: desc,
					filesKey: filesKey(nextFiles),
				});
			} catch (e) {
				notifyAiEmployeesRequestFailed(e);
			} finally {
				setDetailLoading(false);
			}
		},
		[conn, workspaceId]
	);

	useEffect(() => {
		if (skills.length === 0) {
			setSelectedId(null);
			setName('');
			setDescription('');
			setLocalFiles([{ path: MAIN_PATH, content: '' }]);
			setBaseline(null);
			return;
		}
		if (selectedId && !skills.some((s) => s.id === selectedId)) {
			setSelectedId(null);
		}
	}, [skills, selectedId]);

	useEffect(() => {
		if (skills.length > 0 && !selectedId) {
			const first = skills[0];
			if (first) {
				void loadDetail(first.id);
			}
		}
	}, [skills, selectedId, loadDetail]);

	const save = async () => {
		if (!selectedId) {
			return;
		}
		const nm = name.trim();
		if (!nm) {
			setErr(t('aiEmployees.skills.nameRequired'));
			return;
		}
		setBusy(true);
		setErr(null);
		try {
			const main = localFiles.find((f) => f.path === MAIN_PATH)?.content ?? '';
			const extra = localFiles.filter((f) => f.path !== MAIN_PATH).map((f) => ({ path: f.path, content: f.content }));
			await apiUpdateSkill(conn, workspaceId, selectedId, {
				name: nm,
				description: description.trim() || undefined,
				content: main,
				files: extra,
			});
			await onRefreshSkills();
			await loadDetail(selectedId);
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setBusy(false);
		}
	};

	const handleCreateFromModal = async (skillName: string, skillDescription: string) => {
		const nm = skillName.trim();
		const s = await apiCreateSkill(conn, workspaceId, {
			name: nm,
			description: skillDescription.trim() || undefined,
			content: `# ${nm}\n\n`,
			files: [],
		});
		await onRefreshSkills();
		await loadDetail(s.id);
	};

	const handleImportFromModal = async (url: string) => {
		const s = await apiImportSkillFromUrl(conn, workspaceId, url.trim());
		await onRefreshSkills();
		await loadDetail(s.id);
	};

	const del = async () => {
		if (!selectedId) {
			return;
		}
		if (!window.confirm(t('aiEmployees.skills.confirmDelete'))) {
			return;
		}
		setBusy(true);
		setErr(null);
		try {
			await apiDeleteSkill(conn, workspaceId, selectedId);
			setSelectedId(null);
			setName('');
			setDescription('');
			setLocalFiles([{ path: MAIN_PATH, content: '' }]);
			setBaseline(null);
			await onRefreshSkills();
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setBusy(false);
		}
	};

	const handleAddFile = (path: string) => {
		setLocalFiles((prev) => [...prev, { path, content: '' }]);
		setActivePath(path);
	};

	const handleDeleteFile = () => {
		if (activePath === MAIN_PATH) {
			return;
		}
		setLocalFiles((prev) => prev.filter((f) => f.path !== activePath));
		setActivePath(MAIN_PATH);
	};

	const filePaths = useMemo(() => localFiles.map((f) => f.path), [localFiles]);

	return (
		<div className="ref-ai-employees-skills-shell">
			{err ? (
				<div className="ref-ai-employees-banner ref-ai-employees-banner--err" role="alert">
					{err}
				</div>
			) : null}
			<div className="ref-ai-employees-skills-split">
				<aside className="ref-ai-employees-skills-list" aria-label={t('aiEmployees.skills.title')}>
					<div className="ref-ai-employees-skills-list-head">
						<h2 className="ref-ai-employees-skills-list-heading">{t('aiEmployees.skills.title')}</h2>
						<button
							type="button"
							className="ref-ai-employees-skills-list-add"
							title={t('aiEmployees.skills.addSkillTooltip')}
							aria-label={t('aiEmployees.skills.addSkillTooltip')}
							disabled={busy}
							onClick={() => setCreateOpen(true)}
						>
							<IconPlus />
						</button>
					</div>
					{skills.length === 0 ? (
						<div className="ref-ai-employees-skills-empty-state">
							<IconSparkles className="ref-ai-employees-skills-empty-icon" />
							<p className="ref-ai-employees-skills-empty-title">{t('aiEmployees.skills.empty')}</p>
							<p className="ref-ai-employees-skills-empty-sub">{t('aiEmployees.skills.emptySubtitle')}</p>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm" disabled={busy} onClick={() => setCreateOpen(true)}>
								<IconPlus />
								{t('aiEmployees.skills.createSkill')}
							</button>
						</div>
					) : (
						<ul className="ref-ai-employees-skills-list-ul">
							{skills.map((s) => (
								<li key={s.id}>
									<button
										type="button"
										className={`ref-ai-employees-skills-list-btn ${selectedId === s.id ? 'is-active' : ''}`}
										onClick={() => void loadDetail(s.id)}
										disabled={busy}
									>
										<span className="ref-ai-employees-skills-list-btn-icon" aria-hidden>
											<IconSparkles />
										</span>
										<span className="ref-ai-employees-skills-list-btn-text">
											<strong>{s.name}</strong>
											{s.description ? <span className="ref-ai-employees-muted ref-ai-employees-skills-list-desc">{s.description}</span> : null}
										</span>
										{(s.files?.length ?? 0) > 0 ? (
											<span className="ref-ai-employees-skills-file-badge">{t('aiEmployees.skills.filesBadge', { n: s.files!.length })}</span>
										) : null}
									</button>
								</li>
							))}
						</ul>
					)}
				</aside>
				<div className="ref-ai-employees-skills-editor-pane">
					{busy && skills.length > 0 && !selectedId ? (
						<div className="ref-ai-employees-skills-detail-empty">
							<p className="ref-ai-employees-skills-detail-empty-title">{t('common.loading')}</p>
						</div>
					) : !selectedId ? (
						<div className="ref-ai-employees-skills-detail-empty">
							<IconSparkles className="ref-ai-employees-skills-detail-empty-icon" />
							<p className="ref-ai-employees-skills-detail-empty-title">{t('aiEmployees.skills.selectHint')}</p>
							<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm" disabled={busy} onClick={() => setCreateOpen(true)}>
								<IconPlus />
								{t('aiEmployees.skills.createSkill')}
							</button>
						</div>
					) : (
						<div className="ref-ai-employees-skills-detail">
							<div className="ref-ai-employees-skills-detail-head">
								<div className="ref-ai-employees-skills-detail-head-main">
									<div className="ref-ai-employees-skills-detail-ico" aria-hidden>
										<IconSparkles />
									</div>
									<div className="ref-ai-employees-skills-detail-meta-grid">
										<input
											className="ref-ai-employees-input ref-ai-employees-skills-head-input"
											value={name}
											onChange={(e) => setName(e.target.value)}
											disabled={busy || detailLoading}
											placeholder={t('aiEmployees.skills.name')}
											aria-label={t('aiEmployees.skills.name')}
										/>
										<input
											className="ref-ai-employees-input ref-ai-employees-skills-head-input"
											value={description}
											onChange={(e) => setDescription(e.target.value)}
											disabled={busy || detailLoading}
											placeholder={t('aiEmployees.skills.description')}
											aria-label={t('aiEmployees.skills.description')}
										/>
									</div>
								</div>
								<div className="ref-ai-employees-skills-detail-head-actions">
									{isDirty ? (
										<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-btn--sm" disabled={busy || detailLoading} onClick={() => void save()}>
											{busy ? t('aiEmployees.skills.saving') : t('aiEmployees.skills.save')}
										</button>
									) : null}
									<button
										type="button"
										className="ref-ai-employees-skills-detail-del"
										title={t('aiEmployees.skills.delete')}
										aria-label={t('aiEmployees.skills.delete')}
										disabled={busy || detailLoading}
										onClick={() => void del()}
									>
										<IconTrash className="ref-ai-employees-skills-detail-del-ico" />
									</button>
								</div>
							</div>

							<div className="ref-ai-employees-skills-files-editor">
								<div className="ref-ai-employees-skills-file-tree-col">
									<div className="ref-ai-employees-skills-file-tree-toolbar">
										<span className="ref-ai-employees-skills-file-tree-toolbar-label">{t('aiEmployees.skills.filesSection')}</span>
										<div className="ref-ai-employees-skills-file-tree-toolbar-btns">
											<button
												type="button"
												className="ref-ai-employees-skills-file-tree-icon-btn"
												title={t('aiEmployees.skills.addFile')}
												aria-label={t('aiEmployees.skills.addFile')}
												disabled={busy || detailLoading}
												onClick={() => setAddFileOpen(true)}
											>
												<IconPlus />
											</button>
											{activePath !== MAIN_PATH ? (
												<button
													type="button"
													className="ref-ai-employees-skills-file-tree-icon-btn ref-ai-employees-skills-file-tree-icon-btn--danger"
													title={t('aiEmployees.skills.deleteFile')}
													aria-label={t('aiEmployees.skills.deleteFile')}
													disabled={busy || detailLoading}
													onClick={handleDeleteFile}
												>
													<IconTrash />
												</button>
											) : null}
										</div>
									</div>
									<div className="ref-ai-employees-skills-file-tree-scroll">
										{detailLoading ? (
											<div className="ref-ai-employees-skills-skeleton">
												<div className="ref-ai-employees-skills-skeleton-line" />
												<div className="ref-ai-employees-skills-skeleton-line ref-ai-employees-skills-skeleton-line--short" />
												<div className="ref-ai-employees-skills-skeleton-line ref-ai-employees-skills-skeleton-line--medium" />
											</div>
										) : (
											<SkillFileTree filePaths={filePaths} selectedPath={activePath} onSelect={setActivePath} emptyLabel={t('aiEmployees.skills.treeEmpty')} />
										)}
									</div>
								</div>
								<div className="ref-ai-employees-skills-file-viewer-col">
									{detailLoading ? (
										<div className="ref-ai-employees-skills-skeleton ref-ai-employees-skills-skeleton--viewer">
											<div className="ref-ai-employees-skills-skeleton-line" />
											<div className="ref-ai-employees-skills-skeleton-line" />
											<div className="ref-ai-employees-skills-skeleton-line ref-ai-employees-skills-skeleton-line--medium" />
											<div className="ref-ai-employees-skills-skeleton-line" />
										</div>
									) : (
										<SkillFileViewer key={activePath} path={activePath} content={activeContent} onChange={setActiveContent} t={t} />
									)}
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
			<CreateSkillDialog open={createOpen} t={t} onClose={() => setCreateOpen(false)} onCreate={handleCreateFromModal} onImport={handleImportFromModal} />
			{addFileOpen ? (
				<SkillAddFileDialog
					t={t}
					busy={busy}
					existingPaths={filePaths}
					onClose={() => setAddFileOpen(false)}
					onAdd={(p) => {
						handleAddFile(p);
					}}
				/>
			) : null}
		</div>
	);
}
