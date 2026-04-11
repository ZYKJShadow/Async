import type { TransitionEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TFunction } from '../../i18n';
import { IconChevron, IconCloseSmall, IconEye, IconPencil, IconWindowMaximize, IconWindowMinimize } from '../../icons';
import { VoidSelect } from '../../VoidSelect';
import { AiEmployeesApiError } from '../api/client';
import type { AgentJson, CreateProjectPayload, ProjectBoundaryKind, WorkspaceMemberJson } from '../api/types';
import { assigneeVoidOptions } from '../voidSelectOptions';
import { notifyAiEmployeesRequestFailed } from '../AiEmployeesNetworkToast';
import {
	isPlausibleGitRemote,
	ProjectBoundaryFields,
	projectBoundaryApiFields,
	testGitBoundaryRemote,
	validateLocalBoundaryPath,
} from './ProjectBoundaryFields';

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

function parseApiErrorMessage(body: string): string | null {
	const raw = body.trim();
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown; detail?: unknown };
		const msg =
			typeof parsed.error === 'string'
				? parsed.error
				: typeof parsed.message === 'string'
					? parsed.message
					: typeof parsed.detail === 'string'
						? parsed.detail
						: null;
		return msg?.trim() || null;
	} catch {
		return raw;
	}
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

const VOID_MENU_TAGGED = 'ref-ai-employees-void-select-menu--tagged';
const VOID_MENU_MIN_W = 232;

export function CreateProjectDialog({
	open,
	t,
	agents,
	members,
	workspaceDisplayName,
	onClose,
	onCreate,
}: {
	open: boolean;
	t: TFunction;
	agents: AgentJson[];
	members: WorkspaceMemberJson[];
	workspaceDisplayName?: string;
	onClose: () => void;
	onCreate: (payload: CreateProjectPayload) => Promise<void>;
}) {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [icon, setIcon] = useState('📁');
	const [lead, setLead] = useState('');
	const [boundaryMode, setBoundaryMode] = useState<ProjectBoundaryKind>('none');
	const [boundaryLocalPath, setBoundaryLocalPath] = useState('');
	const [boundaryGitUrl, setBoundaryGitUrl] = useState('');
	const [boundaryLocalValidation, setBoundaryLocalValidation] = useState<'idle' | 'checking' | 'ok' | 'missing' | 'not_directory' | 'unknown'>('idle');
	const [boundaryGitTestState, setBoundaryGitTestState] = useState<'idle' | 'testing' | 'ok' | 'auth' | 'not_found' | 'network' | 'failed'>('idle');
	const [expanded, setExpanded] = useState(false);
	const [descPreview, setDescPreview] = useState(false);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
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
			setIcon('📁');
			setLead('');
			setBoundaryMode('none');
			setBoundaryLocalPath('');
			setBoundaryGitUrl('');
			setBoundaryLocalValidation('idle');
			setBoundaryGitTestState('idle');
			setExpanded(false);
			setDescPreview(false);
			setBusy(false);
			setErr(null);
		}
	}, [open]);

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

	const { frontmatter: descFm, body: descBody } = useMemo(() => parseDescriptionFrontmatter(description), [description]);

	const leadOpts = useMemo(() => {
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

	const crumb = useMemo(() => {
		const w = workspaceDisplayName?.trim();
		return w || t('aiEmployees.pickWorkspace');
	}, [t, workspaceDisplayName]);

	useEffect(() => {
		if (!open || boundaryMode !== 'local_folder') {
			setBoundaryLocalValidation('idle');
			return;
		}
		const val = boundaryLocalPath.trim();
		if (!val) {
			setBoundaryLocalValidation('idle');
			return;
		}
		setBoundaryLocalValidation('checking');
		let cancelled = false;
		const timer = setTimeout(() => {
			void validateLocalBoundaryPath(val).then((res) => {
				if (cancelled) {
					return;
				}
				setBoundaryLocalValidation(res === 'ok' ? 'ok' : res === 'missing' ? 'missing' : res === 'not_directory' ? 'not_directory' : 'unknown');
			});
		}, 220);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [boundaryLocalPath, boundaryMode, open]);

	useEffect(() => {
		setBoundaryGitTestState('idle');
	}, [boundaryGitUrl, boundaryMode]);

	const handleGitConnectionTest = useCallback(async () => {
		const remote = boundaryGitUrl.trim();
		if (!remote || !isPlausibleGitRemote(remote)) {
			return;
		}
		setBoundaryGitTestState('testing');
		const result = await testGitBoundaryRemote(remote);
		setBoundaryGitTestState(
			result === 'ok'
				? 'ok'
				: result === 'auth'
					? 'auth'
					: result === 'not_found'
						? 'not_found'
						: result === 'network'
							? 'network'
							: 'failed'
		);
	}, [boundaryGitUrl]);

	const submit = useCallback(async () => {
		const tit = title.trim();
		if (!tit) {
			setErr(t('aiEmployees.issueDetail.titleRequired'));
			return;
		}
		if (boundaryMode === 'local_folder' && !boundaryLocalPath.trim()) {
			setErr(t('aiEmployees.projects.boundaryLocalRequired'));
			return;
		}
		if (boundaryMode === 'git_repo') {
			const g = boundaryGitUrl.trim();
			if (!g || !isPlausibleGitRemote(g)) {
				setErr(t('aiEmployees.projects.boundaryGitInvalid'));
				return;
			}
		}
		setBusy(true);
		setErr(null);
		try {
			const payload: CreateProjectPayload = {
				title: tit,
				description: description.trim() || undefined,
				icon: icon.trim() || undefined,
				...projectBoundaryApiFields(boundaryMode, boundaryLocalPath, boundaryGitUrl),
			};
			if (lead) {
				const [typ, id] = lead.split(':');
				if ((typ === 'member' || typ === 'agent') && id) {
					payload.lead_type = typ;
					payload.lead_id = id;
				}
			}
			await onCreate(payload);
			onClose();
		} catch (e) {
			if (e instanceof AiEmployeesApiError && e.status >= 400 && e.status < 500) {
				setErr(parseApiErrorMessage(e.body) ?? t('aiEmployees.projects.createValidationFailed'));
			} else {
				notifyAiEmployeesRequestFailed(e);
				setErr(t('aiEmployees.projects.createNetworkFailed'));
			}
		} finally {
			setBusy(false);
		}
	}, [boundaryGitUrl, boundaryLocalPath, boundaryMode, description, icon, lead, onClose, onCreate, t, title]);

	const pillClass = 'ref-ai-employees-create-dialog-pill';

	const node = (
		<div
			className={`ref-ai-employees-create-dialog-overlay${overlayVisible ? ' is-visible' : ''}`}
			role="presentation"
			onMouseDown={(e) => e.target === e.currentTarget && onClose()}
			onTransitionEnd={onOverlayTransitionEnd}
		>
			<div
				className={`ref-ai-employees-create-dialog ref-ai-employees-create-dialog--sheet ref-ai-employees-create-dialog--project${expanded ? ' is-expanded' : ''}`}
				role="dialog"
				aria-modal
				aria-labelledby="ref-ai-employees-create-project-aria-title"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<h2 id="ref-ai-employees-create-project-aria-title" className="ref-ai-employees-sr-only">
					{t('aiEmployees.projects.createTitle')}
				</h2>

				<div className="ref-ai-employees-create-dialog-head">
					<div className="ref-ai-employees-create-dialog-breadcrumb" aria-hidden>
						<span className="ref-ai-employees-create-dialog-breadcrumb-muted">{crumb}</span>
						<IconChevron className="ref-ai-employees-create-dialog-breadcrumb-chev" />
						<span className="ref-ai-employees-create-dialog-breadcrumb-current">{t('aiEmployees.projects.breadcrumbNew')}</span>
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
					<div className="ref-ai-employees-create-project-title-row">
						<div className="ref-ai-employees-create-project-icon-wrap">
							<input
								className="ref-ai-employees-create-project-icon-input"
								value={icon}
								onChange={(e) => setIcon(e.target.value.slice(0, 8))}
								aria-label={t('aiEmployees.projects.iconField')}
								title={t('aiEmployees.projects.iconField')}
								maxLength={8}
								spellCheck={false}
							/>
						</div>
						<input
							id="ref-ai-employees-create-project-title-input"
							className="ref-ai-employees-create-dialog-title-input"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder={t('aiEmployees.projects.titlePlaceholder')}
							autoFocus
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									void submit();
								}
							}}
						/>
					</div>
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

				<div className="ref-ai-employees-create-project-boundary-slot">
					<ProjectBoundaryFields
						t={t}
						mode={boundaryMode}
						localPath={boundaryLocalPath}
						gitUrl={boundaryGitUrl}
						onModeChange={setBoundaryMode}
						onLocalPathChange={setBoundaryLocalPath}
						onGitUrlChange={setBoundaryGitUrl}
						localValidationState={boundaryLocalValidation}
						onGitConnectionTest={() => void handleGitConnectionTest()}
						gitConnectionTestState={boundaryGitTestState}
					/>
				</div>

				<div className="ref-ai-employees-create-dialog-toolbar" role="group" aria-label={t('aiEmployees.projects.createTitle')}>
					<VoidSelect
						className={pillClass}
						variant="compact"
						menuClassName={VOID_MENU_TAGGED}
						menuMinWidth={VOID_MENU_MIN_W}
						ariaLabel={t('aiEmployees.projects.leadField')}
						value={lead}
						onChange={setLead}
						options={leadOpts}
						getTriggerDisplay={(v) => {
							if (!v) {
								return (
									<span className="ref-ai-employees-assignee-opt">
										<span className="ref-ai-employees-assignee-opt-badge">·</span>
										<span className="ref-ai-employees-assignee-opt-name ref-ai-employees-parent-opt-none">{t('aiEmployees.issueDetail.assigneeNone')}</span>
									</span>
								);
							}
							const hit = leadOpts.find((o) => o.value === v);
							const lab = hit?.label;
							if (lab != null && typeof lab !== 'string') {
								return lab;
							}
							const isAgent = v.startsWith('agent:');
							const isMember = v.startsWith('member:');
							return (
								<span className="ref-ai-employees-assignee-opt">
									<span className={`ref-ai-employees-assignee-opt-badge ${isAgent ? 'is-agent' : isMember ? 'is-member' : ''}`}>
										{isAgent ? 'AI' : isMember ? 'M' : '·'}
									</span>
									<span className="ref-ai-employees-assignee-opt-name">{String(lab ?? v)}</span>
								</span>
							);
						}}
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
						{busy ? t('aiEmployees.projects.creating') : t('aiEmployees.projects.createSubmit')}
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
