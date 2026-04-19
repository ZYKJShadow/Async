import { useCallback, type MutableRefObject } from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import type { TFunction } from '../i18n';

export type EditActionKind = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

export type UseEditCommandsParams = {
	shell: NonNullable<Window['asyncShell']> | undefined;
	t: TFunction;
	monacoEditorRef: MutableRefObject<MonacoEditorNS.IStandaloneCodeEditor | null>;
	flashComposerAttachErr: (msg: string) => void;
};

export type UseEditCommandsResult = {
	writeClipboardText: (text: string) => Promise<void>;
	readClipboardText: () => Promise<string>;
	runMonacoEditCommand: (kind: EditActionKind) => Promise<boolean>;
	runDomEditCommand: (kind: EditActionKind) => Promise<boolean>;
	executeEditAction: (kind: EditActionKind) => Promise<void>;
};

function isEditableDomTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

/**
 * 全局编辑命令分发：依次尝试 Monaco → DOM 输入框 → 兜底 selection.copy。
 *
 * 行为与 App.tsx 保持一致：
 *  - Monaco 主编辑区只允许 `copy` / `selectAll`（其他视为只读预览）；
 *  - DOM 路径手动处理 `paste`（execCommand 在 input/textarea 不可靠）；
 *  - 任何步骤抛错都通过 `flashComposerAttachErr` 反馈给用户。
 */
export function useEditCommands(params: UseEditCommandsParams): UseEditCommandsResult {
	const { shell, t, monacoEditorRef, flashComposerAttachErr } = params;

	const writeClipboardText = useCallback(
		async (text: string) => {
			if (shell) {
				const r = (await shell.invoke('clipboard:writeText', text)) as { ok?: boolean; error?: string };
				if (!r?.ok) {
					throw new Error(r?.error ?? t('explorer.errClipboard'));
				}
				return;
			}
			await navigator.clipboard.writeText(text);
		},
		[shell, t]
	);

	const readClipboardText = useCallback(async () => {
		if (shell) {
			const r = (await shell.invoke('clipboard:readText')) as { ok?: boolean; error?: string; text?: string };
			if (!r?.ok) {
				throw new Error(r?.error ?? t('explorer.errClipboard'));
			}
			return String(r.text ?? '');
		}
		return navigator.clipboard.readText();
	}, [shell, t]);

	const runMonacoEditCommand = useCallback(
		async (kind: EditActionKind) => {
			if (kind === 'undo' || kind === 'redo' || kind === 'cut' || kind === 'paste') {
				return false;
			}
			const ed = monacoEditorRef.current;
			if (!ed || !(ed.hasTextFocus?.() || ed.hasWidgetFocus?.())) {
				return false;
			}
			ed.focus();
			if (kind === 'selectAll') {
				ed.trigger('menu', kind, null);
				return true;
			}
			const action = ed.getAction('editor.action.clipboardCopyAction');
			if (action) {
				await action.run();
				return true;
			}
			return false;
		},
		[monacoEditorRef]
	);

	const runDomEditCommand = useCallback(
		async (kind: EditActionKind) => {
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || !isEditableDomTarget(active)) {
				return false;
			}
			active.focus();
			if (kind === 'paste') {
				const text = await readClipboardText();
				if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
					const start = active.selectionStart ?? active.value.length;
					const end = active.selectionEnd ?? start;
					active.setRangeText(text, start, end, 'end');
					active.dispatchEvent(new Event('input', { bubbles: true }));
					return true;
				}
				document.execCommand('insertText', false, text);
				return true;
			}
			return document.execCommand(
				kind === 'selectAll' ? 'selectAll' : kind === 'undo' ? 'undo' : kind === 'redo' ? 'redo' : kind
			);
		},
		[readClipboardText]
	);

	const executeEditAction = useCallback(
		async (kind: EditActionKind) => {
			try {
				if (await runMonacoEditCommand(kind)) {
					return;
				}
				if (await runDomEditCommand(kind)) {
					return;
				}
				if (kind === 'copy') {
					const selected = window.getSelection?.()?.toString() ?? '';
					if (selected.trim()) {
						await writeClipboardText(selected);
					}
				}
			} catch (e) {
				flashComposerAttachErr(e instanceof Error ? e.message : String(e));
			}
		},
		[flashComposerAttachErr, runDomEditCommand, runMonacoEditCommand, writeClipboardText]
	);

	return {
		writeClipboardText,
		readClipboardText,
		runMonacoEditCommand,
		runDomEditCommand,
		executeEditAction,
	};
}
