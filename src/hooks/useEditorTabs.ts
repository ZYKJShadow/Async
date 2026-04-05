import { useRef, useState } from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { type EditorTab } from '../EditorTabBar';

export type EditorPtySession = { id: string; title: string };

export type EditorInlineDiffState = {
	filePath: string;
	originalContent: string;
	diff: string;
	revealLine?: number;
	revealEndLine?: number;
	reviewMode: 'snapshot' | 'readonly';
};

export const EDITOR_TERMINAL_HEIGHT_KEY = 'async:editor-terminal-height-v1';
export const EDITOR_TERMINAL_H_MIN = 120;
export const EDITOR_TERMINAL_H_MAX_RATIO = 0.65;

export function clampEditorTerminalHeight(h: number): number {
	if (typeof window === 'undefined') return Math.max(EDITOR_TERMINAL_H_MIN, Math.round(h));
	const max = Math.max(EDITOR_TERMINAL_H_MIN + 40, Math.floor(window.innerHeight * EDITOR_TERMINAL_H_MAX_RATIO));
	return Math.min(max, Math.max(EDITOR_TERMINAL_H_MIN, Math.round(h)));
}

function readEditorTerminalHeightPx(): number {
	try {
		if (typeof window === 'undefined') return 220;
		const raw = localStorage.getItem(EDITOR_TERMINAL_HEIGHT_KEY);
		if (raw) {
			const n = Number(raw);
			if (Number.isFinite(n) && n > 0) return clampEditorTerminalHeight(n);
		}
	} catch {
		/* ignore */
	}
	return clampEditorTerminalHeight(Math.round(Math.min(window.innerHeight * 0.3, 280)));
}

/**
 * 管理编辑器标签页、文件内容、内联 diff、终端会话状态。
 * Monaco editor ref 也在此持有，供 App.tsx 中的文件操作使用。
 */
export function useEditorTabs() {
	const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const [filePath, setFilePath] = useState('');
	const [editorValue, setEditorValue] = useState('');
	const [editorInlineDiffByPath, setEditorInlineDiffByPath] = useState<
		Record<string, EditorInlineDiffState>
	>({});
	const [saveToastKey, setSaveToastKey] = useState(0);
	const [saveToastVisible, setSaveToastVisible] = useState(false);

	const [editorTerminalVisible, setEditorTerminalVisible] = useState(true);
	const [editorTerminalHeightPx, setEditorTerminalHeightPx] = useState(() =>
		readEditorTerminalHeightPx()
	);
	const [editorTerminalSessions, setEditorTerminalSessions] = useState<EditorPtySession[]>([]);
	const [activeEditorTerminalId, setActiveEditorTerminalId] = useState<string | null>(null);

	const monacoEditorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
	const editorLoadRequestRef = useRef(0);
	/** 打开文件后在 Monaco 中高亮的行范围（1-based，含 end） */
	const pendingEditorHighlightRangeRef = useRef<{ start: number; end: number } | null>(null);

	return {
		openTabs,
		setOpenTabs,
		activeTabId,
		setActiveTabId,
		filePath,
		setFilePath,
		editorValue,
		setEditorValue,
		editorInlineDiffByPath,
		setEditorInlineDiffByPath,
		saveToastKey,
		setSaveToastKey,
		saveToastVisible,
		setSaveToastVisible,
		editorTerminalVisible,
		setEditorTerminalVisible,
		editorTerminalHeightPx,
		setEditorTerminalHeightPx,
		editorTerminalSessions,
		setEditorTerminalSessions,
		activeEditorTerminalId,
		setActiveEditorTerminalId,
		monacoEditorRef,
		editorLoadRequestRef,
		pendingEditorHighlightRangeRef,
	};
}
