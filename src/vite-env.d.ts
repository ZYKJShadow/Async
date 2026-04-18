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
	/** 已安装插件变化（安装、卸载、启停、切换插件目录） */
	subscribePluginsChanged?(callback: () => void): () => void;
	/** PTY 终端输出（按 session id 区分） */
	subscribeTerminalPtyData?(callback: (id: string, data: string) => void): () => void;
	subscribeTerminalPtyExit?(callback: (id: string, code: unknown) => void): () => void;
	/** webview 请求打开新窗口（由主进程 web-contents-created 钩子转发） */
	subscribeBrowserNewWindow?(callback: (payload: { url: string; disposition?: string }) => void): () => void;
	/** 主进程转发给内置浏览器面板的控制命令 */
	subscribeBrowserControl?(callback: (payload: unknown) => void): () => void;
	/** 全能终端会话输出（跨窗口共享；订阅后才会广播） */
	subscribeTerminalSessionData?(callback: (id: string, data: string, seq: number) => void): () => void;
	subscribeTerminalSessionAuthPrompt?(
		callback: (
			id: string,
			prompt: { prompt: string; kind: 'password' | 'passphrase'; seq: number } | null
		) => void
	): () => void;
	subscribeTerminalSessionExit?(callback: (id: string, code: unknown) => void): () => void;
	subscribeTerminalSessionListChanged?(callback: () => void): () => void;
	/** 查询全能终端设置页可显示的内置 Shell / 连接模板 */
	/** 主进程请求主窗口打开设置并切换到指定侧栏项（如从独立浏览器窗口唤起） */
	subscribeOpenSettingsNav?(callback: (nav: string) => void): () => void;
}
declare global {
interface AsyncShellWebviewElement extends HTMLElement {
		canGoBack(): boolean;
		canGoForward(): boolean;
		capturePage(): Promise<{
			toDataURL(): string;
			getSize(): { width: number; height: number };
		}>;
		executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
		getWebContentsId(): number;
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
			webview: React.DetailedHTMLProps<React.WebViewHTMLAttributes<AsyncShellWebviewElement>, AsyncShellWebviewElement>;
		}
	}

	interface Window {
		asyncShell?: AsyncShellAPI;
		/** 调试：标签/删除等（见 tabCloseDebug.ts） */
		__voidShellTabCloseLog?: Array<{ iso: string; tag: string; detail: Record<string, unknown> }>;
	}
}

export {};
