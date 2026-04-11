import type { TransitionEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TFunction } from '../../i18n';
import { IconChevron, IconCloseSmall, IconEye, IconPencil, IconWindowMaximize, IconWindowMinimize } from '../../icons';
import { VoidSelect } from '../../VoidSelect';
import type { AgentJson, CreateIssuePayload, IssueJson, ProjectJson, WorkspaceMemberJson } from '../api/types';
import { normalizeIssueStatus } from './IssueStatusChip';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import { assigneeVoidOptions, issueProjectVoidOptions, parentIssueVoidOptions } from '../voidSelectOptions';
import { CreateIssueDueDatePicker, dueLocalStringToIso } from './CreateIssueDueDatePicker';

const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'] as const;
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
const PRI_KEYS = ['urgent', 'high', 'medium', 'low', 'none'] as const;

function issueStatusDisplayLabel(t: TFunction, status: string): string {
	const ns = normalizeIssueStatus(status);
	const key = `aiEmployees.boardColumn.${ns}` as const;
	const tr = t(key);
	return tr === key ? ns.replace(/_/g, ' ') : tr;
}

function normalizePriority(raw: string): (typeof PRI_KEYS)[number] {
	return PRI_KEYS.includes(raw as (typeof PRI_KEYS)[number]) ? (raw as (typeof PRI_KEYS)[number]) : 'none';
}

function priorityDisplayParts(priority: string, t: TFunction): { mark: string; label: string } {
	const p = normalizePriority(priority);
	const label =
		p === 'urgent'
			? t('aiEmployees.issuesHub.priorityUrgent')
			: p === 'high'
				? t('aiEmployees.issuesHub.priorityHigh')
				: p === 'medium'
					? t('aiEmployees.issuesHub.priorityMedium')
					: p === 'low'
						? t('aiEmployees.issuesHub.priorityLow')
						: t('aiEmployees.issuesHub.priorityNone');
	const mark = p === 'none' ? '—' : p === 'urgent' ? 'U' : p === 'high' ? 'H' : p === 'medium' ? 'M' : p === 'low' ? 'L' : '?';
	return { mark, label };
}

function statusVoidLine(t: TFunction, s: string) {
	const ns = normalizeIssueStatus(s);
	return (
		<span className="ref-ai-employees-void-line">
			<span className={`ref-ai-employees-void-line-dot ref-ai-employees-void-line-dot--${ns}`} aria-hidden />
			<span className="ref-ai-employees-void-line-text">{issueStatusDisplayLabel(t, s)}</span>
		</span>
	);
}

function priorityVoidLine(t: TFunction, p: string) {
	const n = normalizePriority(p);
	const { mark, label } = priorityDisplayParts(p, t);
	return (
		<span className="ref-ai-employees-void-line">
			<span className={`ref-ai-employees-void-line-mark ref-ai-employees-void-line-mark--${n}`} aria-hidden>
				{mark}
			</span>
			<span className="ref-ai-employees-void-line-text">{label}</span>
		</span>
	);
}

function formatRootIssuePickerLine(i: IssueJson): string {
	return `${i.identifier ? `${i.identifier} · ` : ''}${i.title}`;
}
const VOID_MENU_TAGGED = 'ref-ai-employees-void-select-menu--tagged';
const VOID_MENU_MIN_W = 232;

type Frontmatter = Record<string, string>;

const DESC_FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseDescriptionFrontmatter(raw: string): { frontmatter: Frontmatter | null; body: string } {
	const match = DESC_FM_RE.exec(raw);
	if (!match) {
		return { frontmatter: null, body: raw };
	}
	const yamlBlock = match[1]!;
	const body = raw.slice(match[0].length);
	const frontmatter: Frontmatter = {};
	for (const line of yamlBlock.split('\n')) {
		const idx = line.indexOf(':');
		if (idx === -1) {
			continue;
		}
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) {
			frontmatter[key] = value;
		}
	}
	return {
		frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null,
		body,
	};
}

function DescriptionFrontmatterCard({ data }: { data: Frontmatter }) {
	return (
		<div className="ref-ai-employees-skill-fm-card ref-ai-employees-create-dialog-desc-fm">
			{Object.entries(data).map(([key, value]) => (
				<div key={key} className="ref-ai-employees-skill-fm-row">
					<span className="ref-ai-employees-skill-fm-key">{key}</span>
					<span className="ref-ai-employees-skill-fm-val">{value}</span>
				</div>
			))}
		</div>
	);
}

export function CreateIssueDialog({
	open,
	t,
	agents,
	members,
	projects = [],
	issues,
	workspaceDisplayName,
	issuesHubVariant = 'workspace',
	onClose,
	onCreate,
}: {
	open: boolean;
	t: TFunction;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	projects?: ProjectJson[];
	issues: IssueJson[];
	/** 工作区名称；用于顶栏面包屑 */
	workspaceDisplayName?: string;
	issuesHubVariant?: 'workspace' | 'my';
	onClose: () => void;
	onCreate: (payload: CreateIssuePayload) => Promise<void | IssueJson>;
}) {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [status, setStatus] = useState<string>('backlog');
	const [priority, setPriority] = useState<string>('none');
	const [assignee, setAssignee] = useState('');
	const [dueDate, setDueDate] = useState('');
	const [parentId, setParentId] = useState('');
	const [projectId, setProjectId] = useState('');
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [descPreview, setDescPreview] = useState(false);
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
			setTitle('');
			setDescription('');
			setStatus('backlog');
			setPriority('none');
			setAssignee('');
			setDueDate('');
			setParentId('');
			setProjectId('');
			setErr(null);
			setExpanded(false);
			setDescPreview(false);
		}
	}, [open]);

	const { frontmatter: descFm, body: descBody } = useMemo(() => parseDescriptionFrontmatter(description), [description]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onClose();
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open, onClose]);

	const rootIssues = useMemo(() => issues.filter((i) => !i.parent_issue_id), [issues]);

	const statusOpts = useMemo(() => STATUSES.map((s) => ({ value: s, label: statusVoidLine(t, s) })), [t]);
	const priorityOpts = useMemo(() => PRIORITIES.map((p) => ({ value: p, label: priorityVoidLine(t, p) })), [t]);
	const assigneeOpts = useMemo(() => {
		return assigneeVoidOptions(t, members, agents).map((o) => {
			if (o.disabled) {
				return { ...o, label: <span className="ref-ai-employees-void-opt-hdr">{o.label}</span> };
			}
			if (!o.value) {
				return { ...o, label: <span className="ref-ai-employees-assignee-opt-none">{o.label}</span> };
			}
			const isAgent = o.value.startsWith('agent:');
			const isMember = o.value.startsWith('member:');
			return {
				...o,
				label: (
					<span className="ref-ai-employees-assignee-opt">
						<span className={`ref-ai-employees-assignee-opt-badge ${isAgent ? 'is-agent' : isMember ? 'is-member' : ''}`}>
							{isAgent ? 'AI' : isMember ? 'M' : '·'}
						</span>
						<span className="ref-ai-employees-assignee-opt-name">{o.label}</span>
					</span>
				),
			};
		});
	}, [t, members, agents]);
	const parentOpts = useMemo(() => {
		return parentIssueVoidOptions(t, rootIssues).map((o) => {
			if (!o.value) {
				return { ...o, label: <span className="ref-ai-employees-parent-opt-none">{o.label}</span> };
			}
			return {
				value: o.value,
				label: (
					<span className="ref-ai-employees-void-line">
						<span className="ref-ai-employees-void-line-text">{o.label}</span>
					</span>
				),
			};
		});
	}, [t, rootIssues]);

	const projectOpts = useMemo(() => {
		return issueProjectVoidOptions(t, projects).map((o) => {
			if (!o.value) {
				return { ...o, label: <span className="ref-ai-employees-parent-opt-none">{o.label}</span> };
			}
			const hit = projects.find((p) => p.id === o.value);
			const line = hit ? (hit.icon ? `${hit.icon} ${hit.title}` : hit.title) : o.label;
			return {
				value: o.value,
				label: (
					<span className="ref-ai-employees-void-line">
						<span className="ref-ai-employees-void-line-text">{line}</span>
					</span>
				),
			};
		});
	}, [t, projects]);

	const crumbWorkspace = useMemo(() => {
		if (issuesHubVariant === 'my') {
			return t('aiEmployees.createIssue.breadcrumbMy');
		}
		const w = workspaceDisplayName?.trim();
		return w || t('aiEmployees.pickWorkspace');
	}, [issuesHubVariant, t, workspaceDisplayName]);

	const submit = useCallback(async () => {
		const tit = title.trim();
		if (!tit) {
			setErr(t('aiEmployees.issueDetail.titleRequired'));
			return;
		}
		setBusy(true);
		setErr(null);
		try {
			const payload: CreateIssuePayload = {
				title: tit,
				description: description.trim() || undefined,
				status,
				priority,
			};
			if (dueDate.trim()) {
				payload.due_date = dueLocalStringToIso(dueDate);
			}
			if (parentId) {
				payload.parent_issue_id = parentId;
			}
			if (assignee) {
				const [typ, id] = assignee.split(':');
				if ((typ === 'member' || typ === 'agent') && id) {
					payload.assignee_type = typ;
					payload.assignee_id = id;
				}
			}
			if (projectId) {
				payload.project_id = projectId;
			}
			await onCreate(payload);
			onClose();
		} catch (e) {
			notifyAiEmployeesRequestFailed(e);
		} finally {
			setBusy(false);
		}
	}, [assignee, description, dueDate, onClose, onCreate, parentId, priority, projectId, status, t, title]);

	const pillClass = 'ref-ai-employees-create-dialog-pill';

	const node = (
		<div
			className={`ref-ai-employees-create-dialog-overlay${overlayVisible ? ' is-visible' : ''}`}
			role="presentation"
			onMouseDown={(e) => e.target === e.currentTarget && onClose()}
			onTransitionEnd={onOverlayTransitionEnd}
		>
			<div
				className={`ref-ai-employees-create-dialog ref-ai-employees-create-dialog--sheet${expanded ? ' is-expanded' : ''}`}
				role="dialog"
				aria-modal
				aria-labelledby="ref-ai-employees-create-dialog-aria-title"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<h2 id="ref-ai-employees-create-dialog-aria-title" className="ref-ai-employees-sr-only">
					{t('aiEmployees.createIssue.title')}
				</h2>

				<div className="ref-ai-employees-create-dialog-head">
					<div className="ref-ai-employees-create-dialog-breadcrumb" aria-hidden>
						<span className="ref-ai-employees-create-dialog-breadcrumb-muted">{crumbWorkspace}</span>
						<IconChevron className="ref-ai-employees-create-dialog-breadcrumb-chev" />
						<span className="ref-ai-employees-create-dialog-breadcrumb-current">{t('aiEmployees.createIssue.breadcrumbNew')}</span>
					</div>
					<div className="ref-ai-employees-create-dialog-head-actions">
						<button
							type="button"
							className="ref-ai-employees-create-dialog-icon-btn"
							title={expanded ? t('aiEmployees.createIssue.collapse') : t('aiEmployees.createIssue.expand')}
							aria-expanded={expanded}
							onClick={() => setExpanded((v) => !v)}
						>
							{expanded ? <IconWindowMinimize className="ref-ai-employees-create-dialog-head-ico" /> : <IconWindowMaximize className="ref-ai-employees-create-dialog-head-ico" />}
						</button>
						<button type="button" className="ref-ai-employees-create-dialog-icon-btn" title={t('common.close')} onClick={onClose}>
							<IconCloseSmall className="ref-ai-employees-create-dialog-head-ico" />
						</button>
					</div>
				</div>

				{err ? (
					<div className="ref-ai-employees-create-dialog-err" role="alert">
						{err}
					</div>
				) : null}

				<div className="ref-ai-employees-create-dialog-title-slot">
					<input
						id="ref-ai-employees-create-dialog-title-input"
						className="ref-ai-employees-create-dialog-title-input"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder={t('aiEmployees.createIssue.placeholderTitle')}
						autoFocus
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								void submit();
							}
						}}
					/>
				</div>

				<div className="ref-ai-employees-create-dialog-body">
					<div className="ref-ai-employees-create-dialog-desc-wrap">
						<div className="ref-ai-employees-create-dialog-desc-toolbar">
							<span className="ref-ai-employees-field-label-muted">{t('aiEmployees.createIssue.descField')}</span>
							<button
								type="button"
								className="ref-ai-employees-create-dialog-desc-mode"
								title={descPreview ? t('app.editorMarkdownSource') : t('app.editorMarkdownPreview')}
								aria-label={t('app.editorMarkdownModeAria')}
								aria-pressed={descPreview}
								onClick={() => setDescPreview((v) => !v)}
							>
								{descPreview ? <IconPencil className="ref-ai-employees-create-dialog-desc-mode-ico" /> : <IconEye className="ref-ai-employees-create-dialog-desc-mode-ico" />}
							</button>
						</div>
						{descPreview ? (
							<div className="ref-ai-employees-create-dialog-desc-preview">
								{descFm ? <DescriptionFrontmatterCard data={descFm} /> : null}
								<div className="ref-ai-employees-skill-md-preview ref-ai-employees-create-dialog-desc-md">
									<ReactMarkdown remarkPlugins={[remarkGfm]}>{descBody.trim() ? descBody : t('aiEmployees.createIssue.descPreviewEmpty')}</ReactMarkdown>
								</div>
							</div>
						) : (
							<textarea
								className="ref-ai-employees-create-dialog-desc"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder={t('aiEmployees.createIssue.placeholderDesc')}
							/>
						)}
					</div>
				</div>

				<div className="ref-ai-employees-create-dialog-toolbar" role="group" aria-label={t('aiEmployees.createIssue.title')}>
					<VoidSelect
						className={pillClass}
						variant="compact"
						menuClassName={VOID_MENU_TAGGED}
						menuMinWidth={VOID_MENU_MIN_W}
						ariaLabel={t('aiEmployees.createIssue.statusField')}
						value={status}
						onChange={setStatus}
						options={statusOpts}
						getTriggerDisplay={(v) => statusVoidLine(t, v)}
					/>
					<VoidSelect
						className={pillClass}
						variant="compact"
						menuClassName={VOID_MENU_TAGGED}
						menuMinWidth={VOID_MENU_MIN_W}
						ariaLabel={t('aiEmployees.createIssue.priorityField')}
						value={priority}
						onChange={setPriority}
						options={priorityOpts}
						getTriggerDisplay={(v) => priorityVoidLine(t, v)}
					/>
					<VoidSelect
						className={pillClass}
						variant="compact"
						menuClassName={VOID_MENU_TAGGED}
						menuMinWidth={VOID_MENU_MIN_W}
						ariaLabel={t('aiEmployees.createIssue.assigneeField')}
						value={assignee}
						onChange={setAssignee}
						options={assigneeOpts}
					/>
					{projects.length > 0 ? (
						<VoidSelect
							className={pillClass}
							variant="compact"
							menuClassName={VOID_MENU_TAGGED}
							menuMinWidth={VOID_MENU_MIN_W}
							ariaLabel={t('aiEmployees.createIssue.projectField')}
							value={projectId}
							onChange={setProjectId}
							options={projectOpts}
							getTriggerDisplay={(v) => (
								<span className="ref-ai-employees-void-line">
									<span className={`ref-ai-employees-void-line-text${v ? '' : ' ref-ai-employees-parent-opt-none'}`}>
										{v ? (projects.find((p) => p.id === v)?.title ?? v) : t('aiEmployees.issueDetail.projectNone')}
									</span>
								</span>
							)}
						/>
					) : null}
					<CreateIssueDueDatePicker t={t} value={dueDate} onChange={setDueDate} disabled={busy} />
					<VoidSelect
						className={pillClass}
						variant="compact"
						menuClassName={VOID_MENU_TAGGED}
						menuMinWidth={VOID_MENU_MIN_W}
						ariaLabel={t('aiEmployees.createIssue.parentField')}
						value={parentId}
						onChange={setParentId}
						options={parentOpts}
						getTriggerDisplay={(v) => (
							<span className="ref-ai-employees-void-line">
								<span className={`ref-ai-employees-void-line-text${v ? '' : ' ref-ai-employees-parent-opt-none'}`}>
									{v
										? (() => {
												const hit = rootIssues.find((i) => i.id === v);
												return hit ? formatRootIssuePickerLine(hit) : v;
											})()
										: t('aiEmployees.issueDetail.assigneeNone')}
								</span>
							</span>
						)}
					/>
				</div>

				<div className="ref-ai-employees-create-dialog-footer">
					<span className="ref-ai-employees-create-dialog-footer-hint">{t('aiEmployees.createIssue.descField')}</span>
					<button
						type="button"
						className="ref-ai-employees-btn ref-ai-employees-btn--primary ref-ai-employees-create-dialog-submit"
						disabled={busy || !title.trim()}
						onClick={() => void submit()}
					>
						{busy ? t('aiEmployees.createIssue.submitting') : t('aiEmployees.createIssue.submit')}
					</button>
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
