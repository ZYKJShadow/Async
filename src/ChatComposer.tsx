import {
	type Dispatch,
	type KeyboardEvent,
	type RefObject,
	type SetStateAction,
	useContext,
} from 'react';
import { ComposerGitBranchRow, type ComposerContextMeterState } from './ComposerGitBranchRow';
import { ComposerActionsContext } from './ComposerActionsContext';
import { ComposerModeIcon, composerModeLabel, type ComposerMode } from './ComposerPlusMenu';
import { ComposerRichInput } from './ComposerRichInput';
import { type ComposerSegment } from './composerSegments';
import { useI18n } from './i18n';
import {
	IconArrowUp,
	IconChevron,
	IconImageOutline,
	IconMic,
	IconStop,
} from './icons';
import { type AtComposerSlot } from './useComposerAtMention';

export type ComposerAnchorSlot = 'hero' | 'bottom' | 'inline';

type ComposerRef = RefObject<HTMLDivElement | null>;

interface ChatComposerProps {
	slot: ComposerAnchorSlot;
	variant?: 'stacked' | 'editor-hero';
	segments: ComposerSegment[];
	setSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	canSend: boolean;
	extraClass?: string;
	showGitBranchRow?: boolean;
	/** 当前模型在设置中配置了上下文窗口时显示 Git 行左侧圆环 */
	composerContextMeter?: ComposerContextMeterState | null;
	composerRichHeroRef: ComposerRef;
	composerRichBottomRef: ComposerRef;
	composerRichInlineRef: ComposerRef;
	plusAnchorHeroRef: ComposerRef;
	plusAnchorBottomRef: ComposerRef;
	plusAnchorInlineRef: ComposerRef;
	modelPillHeroRef: ComposerRef;
	modelPillBottomRef: ComposerRef;
	modelPillInlineRef: ComposerRef;
	composerMode: ComposerMode;
	hasConversation: boolean;
	composerPlaceholder: string;
	followUpComposerPlaceholder: string;
	plusMenuOpen: boolean;
	modelPickerOpen: boolean;
	modelPillLabel: string;
	awaitingReply: boolean;
	resendFromUserIndex: number | null;
	composerGitBranchAnchorRef: RefObject<HTMLButtonElement | null>;
	/** 打开 Git 分支菜单前关闭 + / 模型选择（稳定回调，避免 git 更新带动 composer props 失效） */
	onBeforeToggleGitBranchPicker?: () => void;
	setPlusMenuAnchorSlot: (slot: ComposerAnchorSlot) => void;
	setModelPickerOpen: Dispatch<SetStateAction<boolean>>;
	setPlusMenuOpen: Dispatch<SetStateAction<boolean>>;
	setModelPickerAnchorSlot: (slot: ComposerAnchorSlot) => void;
	/** 未传时尝试使用 ComposerActionsContext（App 根已提供） */
	onAbort?: () => void;
	onSend?: () => void;
	onNewThread?: () => void;
	onExplorerOpenFile?: (rel: string) => void;
	persistComposerAttachments: (files: File[]) => Promise<string[]>;
	syncComposerOverlays: (root: HTMLElement, slot: AtComposerSlot) => void;
	setResendFromUserIndex: Dispatch<SetStateAction<number | null>>;
	setInlineResendSegments: Dispatch<SetStateAction<ComposerSegment[]>>;
	slashCommandKeyDown: (e: KeyboardEvent<HTMLDivElement>) => boolean;
	atMentionKeyDown: (e: KeyboardEvent<HTMLDivElement>) => boolean;
}

export function ChatComposer({
	slot,
	variant = 'stacked',
	segments,
	setSegments,
	canSend,
	extraClass,
	showGitBranchRow = true,
	composerContextMeter = null,
	composerRichHeroRef,
	composerRichBottomRef,
	composerRichInlineRef,
	plusAnchorHeroRef,
	plusAnchorBottomRef,
	plusAnchorInlineRef,
	modelPillHeroRef,
	modelPillBottomRef,
	modelPillInlineRef,
	composerMode,
	hasConversation,
	composerPlaceholder,
	followUpComposerPlaceholder,
	plusMenuOpen,
	modelPickerOpen,
	modelPillLabel,
	awaitingReply,
	resendFromUserIndex,
	composerGitBranchAnchorRef,
	onBeforeToggleGitBranchPicker,
	setPlusMenuAnchorSlot,
	setModelPickerOpen,
	setPlusMenuOpen,
	setModelPickerAnchorSlot,
	onAbort,
	onSend,
	onNewThread,
	onExplorerOpenFile,
	persistComposerAttachments,
	syncComposerOverlays,
	setResendFromUserIndex,
	setInlineResendSegments,
	slashCommandKeyDown,
	atMentionKeyDown,
}: ChatComposerProps) {
	const { t } = useI18n();
	const injected = useContext(ComposerActionsContext);
	const onSendFn = injected?.onSend ?? onSend;
	const onAbortFn = injected?.onAbort ?? onAbort;
	const onNewThreadFn = injected?.onNewThread ?? onNewThread;
	const onExplorerOpenFileFn = injected?.onExplorerOpenFile ?? onExplorerOpenFile;
	if (!onSendFn || !onAbortFn || !onNewThreadFn || !onExplorerOpenFileFn) {
		throw new Error('ChatComposer requires onSend/onAbort/onNewThread/onExplorerOpenFile or ComposerActionsProvider');
	}
	const isHero = variant === 'editor-hero';
	const richRef =
		slot === 'hero'
			? composerRichHeroRef
			: slot === 'bottom'
				? composerRichBottomRef
				: composerRichInlineRef;
	const plusRef =
		slot === 'hero'
			? plusAnchorHeroRef
			: slot === 'bottom'
				? plusAnchorBottomRef
				: plusAnchorInlineRef;
	const modelRef =
		slot === 'hero'
			? modelPillHeroRef
			: slot === 'bottom'
				? modelPillBottomRef
				: modelPillInlineRef;
	const isBottomSlot = slot === 'bottom';
	const showModelPicker = composerMode !== 'team';
	const inputPlaceholder =
		isBottomSlot && hasConversation ? followUpComposerPlaceholder : composerPlaceholder;

	const onComposerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (slashCommandKeyDown(e)) return;
		if (atMentionKeyDown(e)) return;
		if (e.key === 'Escape' && resendFromUserIndex !== null && slot === 'inline') {
			e.preventDefault();
			setResendFromUserIndex(null);
			setInlineResendSegments([]);
			return;
		}
		if (e.key === 'Tab' && e.shiftKey) {
			e.preventDefault();
			onNewThreadFn();
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSendFn();
		}
	};

	const capsule = (
		<div
			className={[
				'ref-capsule',
				isHero ? 'ref-capsule--editor-rail-hero' : 'ref-capsule--stacked-chat',
				extraClass,
			]
				.filter(Boolean)
				.join(' ')}
		>
			<div className={isHero ? 'ref-composer-hero-body' : 'ref-composer-stacked-body'}>
				<ComposerRichInput
					innerRef={richRef}
					segments={segments}
					onSegmentsChange={setSegments}
					className={isHero ? 'ref-capsule-input' : 'ref-capsule-input ref-capsule-input--stacked-chat'}
					placeholder={inputPlaceholder}
					onFilePreview={(rel) => onExplorerOpenFileFn(rel)}
					onComposerAttachFiles={persistComposerAttachments}
					onRichInput={(root) => syncComposerOverlays(root, slot)}
					onRichSelect={(root) => syncComposerOverlays(root, slot)}
					onKeyDown={onComposerKeyDown}
				/>
			</div>
			<div className={isHero ? 'ref-capsule-bar ref-capsule-bar--editor-rail' : 'ref-capsule-bar ref-capsule-bar--stacked'}>
				<div className={isHero ? 'ref-editor-rail-bar-left' : 'ref-capsule-bar-start'}>
					<div className="ref-plus-anchor ref-editor-rail-mode-cluster" ref={plusRef}>
						<button
							type="button"
							className={`ref-mode-chip ref-mode-chip--${composerMode} ref-mode-chip--opens-menu is-active`}
							aria-expanded={plusMenuOpen}
							aria-haspopup="menu"
							title={t('app.addPlusTitle')}
							aria-label={t('app.addPlusAria')}
							onClick={() => {
								setPlusMenuAnchorSlot(slot);
								setModelPickerOpen(false);
								setPlusMenuOpen((open) => !open);
							}}
						>
							<ComposerModeIcon mode={composerMode} className="ref-mode-chip-ico" />
							<span className="ref-mode-chip-label">{composerModeLabel(composerMode, t)}</span>
							<IconChevron className="ref-mode-chip-menu-chev" />
						</button>
					</div>
					{showModelPicker ? (
						<div className="ref-model-pill-anchor" ref={modelRef}>
							<button
								type="button"
								className="ref-model-pill"
								aria-expanded={modelPickerOpen}
								aria-haspopup="listbox"
								onClick={() => {
									setModelPickerAnchorSlot(slot);
									setPlusMenuOpen(false);
									setModelPickerOpen((open) => !open);
								}}
							>
								<span className="ref-model-name">{modelPillLabel}</span>
								<IconChevron className="ref-model-chev" />
							</button>
						</div>
					) : null}
				</div>
				{isHero ? <div className="ref-capsule-bar-spacer" /> : null}
				<div className={isHero ? 'ref-editor-rail-bar-right' : 'ref-capsule-bar-end'}>
					{isHero ? (
						<button
							type="button"
							className="ref-mic-btn"
							disabled
							title={t('app.comingSoon')}
							aria-label={t('app.comingSoon')}
						>
							<IconImageOutline className="ref-mic-btn-svg" />
						</button>
					) : null}
					<button
						type="button"
						className="ref-mic-btn"
						disabled
						title={t('app.voiceSoonTitle')}
						aria-label={t('app.voiceSoonAria')}
					>
						<IconMic className="ref-mic-btn-svg" />
					</button>
					<button
						type="button"
						className={`ref-send-btn ${awaitingReply ? 'is-stop' : ''}`}
						title={awaitingReply ? t('app.stopGeneration') : t('app.send')}
						aria-label={awaitingReply ? t('app.stopGeneration') : t('app.send')}
						disabled={!awaitingReply && !canSend}
						onClick={() => (awaitingReply ? onAbortFn() : onSendFn())}
					>
						{awaitingReply ? <IconStop className="ref-send-icon" /> : <IconArrowUp className="ref-send-icon" />}
					</button>
				</div>
			</div>
		</div>
	);

	if (slot !== 'bottom' || !showGitBranchRow) {
		return capsule;
	}

	return (
		<div className="ref-composer-stack-with-branch">
			{capsule}
			<ComposerGitBranchRow
				ref={composerGitBranchAnchorRef}
				onBeforeToggleGitBranchPicker={onBeforeToggleGitBranchPicker}
				contextMeter={composerContextMeter}
			/>
		</div>
	);
}
