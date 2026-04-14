/// <reference types="vite/client" />
import type * as React from 'react';

export interface AsyncShellAPI {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	subscribeChat(callback: (payload: unknown) => void): () => void;
	/** 窗口移动 / 缩放时触发，用于重算 fixed 浮层锚点 */
	subscribeLayout?(callback: () => void): () => void;
	subscribeThemeMode?(callback: (payload: unknown) => void): () => void;
	/** 工作区目录内文件在磁盘上增删改（外部编辑器保存等），主进程经 chokidar 防抖后广播 */
	subscribeWorkspaceFsTouched?(callback: () => void): () => void;
	/** 工作区文件索引首次全量扫描完成（与当前窗口 root 比对由订阅方完成） */
	subscribeWorkspaceFileIndexReady?(callback: (workspaceRootNorm: string) => void): () => void;
	/** PTY 终端输出（按 session id 区分） */
	subscribeTerminalPtyData?(callback: (id: string, data: string) => void): () => void;
	subscribeTerminalPtyExit?(callback: (id: string, code: unknown) => void): () => void;
}
declare global {
	interface AsyncShellWebviewElement extends HTMLElement {
		canGoBack(): boolean;
		canGoForward(): boolean;
		goBack(): void;
		goForward(): void;
		getUserAgent(): string;
		reload(): void;
		setUserAgent(userAgent: string): void;
		stop(): void;
		getURL(): string;
		loadURL(url: string, options?: Record<string, unknown>): Promise<void>;
	}

	namespace JSX {
		interface IntrinsicElements {
			webview: React.DetailedHTMLProps<React.HTMLAttributes<AsyncShellWebviewElement>, AsyncShellWebviewElement> & {
				src?: string;
				partition?: string;
				allowpopups?: boolean | 'true' | 'false';
				useragent?: string;
			};
		}
	}

	interface Window {
		asyncShell?: AsyncShellAPI;
		/** 调试：标签/删除等（见 tabCloseDebug.ts） */
		__voidShellTabCloseLog?: Array<{ iso: string; tag: string; detail: Record<string, unknown> }>;
	}
}

export {};
