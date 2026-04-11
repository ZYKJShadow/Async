import { useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { TFunction } from '../../i18n';
import { IconPlus, IconSparkles } from '../../icons';
import type { AiEmployeesConnection } from '../api/client';
import { apiCreateSkill, apiDeleteSkill, apiGetSkill, apiImportSkillFromUrl, apiUpdateSkill } from '../api/client';
import type { SkillFileJson, SkillJson } from '../api/types';
import { CreateSkillDialog } from '../components/CreateSkillDialog';

type LocalFile = { path: string; content: string; id?: string };

const MAIN_PATH = 'SKILL.md';

function filesToLocal(files: SkillFileJson[] | undefined, mainContent: string): LocalFile[] {
	const extras = (files ?? []).filter((f) => f.path !== MAIN_PATH);
	const main = { path: MAIN_PATH, content: mainContent };
	return [main, ...extras.map((f) => ({ path: f.path, content: f.content, id: f.id }))];
}

export function SkillsPage({
	t,
	conn,
	workspaceId,
	skills,
	colorScheme,
	onRefreshSkills,
}: {
	t: TFunction;
	conn: AiEmployeesConnection;
	workspaceId: string;
	skills: SkillJson[];
	colorScheme: 'light' | 'dark';
	onRefreshSkills: () => void | Promise<void>;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [localFiles, setLocalFiles] = useState<LocalFile[]>([{ path: MAIN_PATH, content: '' }]);
	const [activePath, setActivePath] = useState(MAIN_PATH);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);

	const activeContent = localFiles.find((f) => f.path === activePath)?.content ?? '';

	const setActiveContent = useCallback(
		(value: string | undefined) => {
			const v = value ?? '';
			setLocalFiles((prev) => prev.map((f) => (f.path === activePath ? { ...f, content: v } : f)));
		},
		[activePath]
	);

	const loadDetail = useCallback(
		async (id: string) => {
			setBusy(true);
			setErr(null);
			try {
				const s = await apiGetSkill(conn, workspaceId, id);
				setSelectedId(s.id);
				setName(s.name);
				setDescription(s.description ?? '');
				const main = s.content ?? '';
				setLocalFiles(filesToLocal(s.files, main));
				setActivePath(MAIN_PATH);
			} catch (e) {
				setErr(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
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
			setErr(e instanceof Error ? e.message : String(e));
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
			await onRefreshSkills();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const addFile = () => {
		const base = 'extra.md';
		let path = base;
		let n = 1;
		while (localFiles.some((f) => f.path === path)) {
			n += 1;
			path = `extra-${n}.md`;
		}
		setLocalFiles((prev) => [...prev, { path, content: '' }]);
		setActivePath(path);
	};

	const removeFile = (path: string) => {
		if (path === MAIN_PATH) {
			return;
		}
		setLocalFiles((prev) => prev.filter((f) => f.path !== path));
		if (activePath === path) {
			setActivePath(MAIN_PATH);
		}
	};

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
						<>
							<div className="ref-ai-employees-skills-meta">
								<label className="ref-ai-employees-skills-meta-field">
									<span>{t('aiEmployees.skills.name')}</span>
									<input className="ref-ai-employees-input" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
								</label>
								<label className="ref-ai-employees-skills-meta-field">
									<span>{t('aiEmployees.skills.description')}</span>
									<input className="ref-ai-employees-input" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
								</label>
							</div>
							<div className="ref-ai-employees-skills-files-editor">
								<div className="ref-ai-employees-skills-file-tree">
									<div className="ref-ai-employees-skills-file-tree-head">{t('aiEmployees.skills.mainFile')}</div>
									<ul>
										{localFiles.map((f) => (
											<li key={f.path}>
												<button
													type="button"
													className={`ref-ai-employees-skills-file-tab ${activePath === f.path ? 'is-active' : ''}`}
													onClick={() => setActivePath(f.path)}
												>
													{f.path}
												</button>
												{f.path !== MAIN_PATH ? (
													<button type="button" className="ref-ai-employees-skills-file-del" onClick={() => removeFile(f.path)} title={t('aiEmployees.skills.deleteFile')}>
														×
													</button>
												) : null}
											</li>
										))}
									</ul>
									<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost ref-ai-employees-btn--sm" onClick={addFile}>
										{t('aiEmployees.skills.addFile')}
									</button>
								</div>
								<div className="ref-ai-employees-skills-monaco-wrap">
									<Editor
										height="100%"
										language="markdown"
										theme={colorScheme === 'dark' ? 'vs-dark' : 'light'}
										value={activeContent}
										onChange={(v) => setActiveContent(v)}
										options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 13 }}
									/>
								</div>
							</div>
							<div className="ref-ai-employees-skills-actions">
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--primary" disabled={busy} onClick={() => void save()}>
									{t('aiEmployees.skills.save')}
								</button>
								<button type="button" className="ref-ai-employees-btn ref-ai-employees-btn--ghost" disabled={busy} onClick={() => void del()}>
									{t('aiEmployees.skills.delete')}
								</button>
							</div>
						</>
					)}
				</div>
			</div>
			<CreateSkillDialog open={createOpen} t={t} onClose={() => setCreateOpen(false)} onCreate={handleCreateFromModal} onImport={handleImportFromModal} />
		</div>
	);
}
