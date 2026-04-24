/// <reference types="vite/client" />
import type * as React from 'react';

export interface AsyncShellAPI {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	setUnreadBadgeCount?(count: number): Promise<unknown>;
	getPathForFile?(file: File): string | null;
	subscribeChat(callback: (payload: unknown) => void): () => void;
	/** 绐楀彛绉诲姩 / 缂╂斁鏃惰Е鍙戯紝鐢ㄤ簬閲嶇畻 fixed 娴眰閿氱偣 */
	subscribeLayout?(callback: () => void): () => void;
	subscribeThemeMode?(callback: (payload: unknown) => void): () => void;
	/** 宸ヤ綔鍖虹洰褰曞唴鏂囦欢鍦ㄧ鐩樹笂澧炲垹鏀癸紙澶栭儴缂栬緫鍣ㄤ繚瀛樼瓑锛夛紝涓昏繘绋嬬粡 chokidar 闃叉姈鍚庡箍鎾?*/
	subscribeWorkspaceFsTouched?(callback: () => void): () => void;
	/** 宸ヤ綔鍖烘枃浠剁储寮曢娆″叏閲忔壂鎻忓畬鎴愶紙涓庡綋鍓嶇獥鍙?root 姣斿鐢辫闃呮柟瀹屾垚锛?*/
	subscribeWorkspaceFileIndexReady?(callback: (workspaceRootNorm: string) => void): () => void;
	/** 宸插畨瑁呮彃浠跺彉鍖栵紙瀹夎銆佸嵏杞姐€佸惎鍋溿€佸垏鎹㈡彃浠剁洰褰曪級 */
	subscribePluginsChanged?(callback: () => void): () => void;
	/** PTY 缁堢杈撳嚭锛堟寜 session id 鍖哄垎锛?*/
	/** webview 璇锋眰鎵撳紑鏂扮獥鍙ｏ紙鐢变富杩涚▼ web-contents-created 閽╁瓙杞彂锛?*/
	subscribeBrowserNewWindow?(callback: (payload: { url: string; disposition?: string }) => void): () => void;
	/** 涓昏繘绋嬭浆鍙戠粰鍐呯疆娴忚鍣ㄩ潰鏉跨殑鎺у埗鍛戒护 */
	subscribeBrowserControl?(callback: (payload: unknown) => void): () => void;
	/** 鍏ㄨ兘缁堢浼氳瘽杈撳嚭锛堣法绐楀彛鍏变韩锛涜闃呭悗鎵嶄細骞挎挱锛?*/
	subscribeTerminalSessionData?(callback: (id: string, data: string, seq: number) => void): () => void;
	subscribeTerminalSessionAuthPrompt?(
		callback: (
			id: string,
			prompt: { prompt: string; kind: 'password' | 'passphrase'; seq: number } | null
		) => void
	): () => void;
	subscribeTerminalSessionExit?(callback: (id: string, code: unknown) => void): () => void;
	subscribeTerminalSessionListChanged?(callback: () => void): () => void;
	/** 鏌ヨ鍏ㄨ兘缁堢璁剧疆椤靛彲鏄剧ず鐨勫唴缃?Shell / 杩炴帴妯℃澘 */
	/** 涓昏繘绋嬭姹備富绐楀彛鎵撳紑璁剧疆骞跺垏鎹㈠埌鎸囧畾渚ф爮椤癸紙濡備粠鐙珛娴忚鍣ㄧ獥鍙ｅ敜璧凤級 */
	subscribeOpenSettingsNav?(callback: (nav: string) => void): () => void;
	/** 鑷姩鏇存柊鐘舵€佹帹閫侊紙checking / available / downloading / downloaded / error 绛夛級 */
	subscribeAutoUpdateStatus?(callback: (payload: { state: string } & Record<string, unknown>) => void): () => void;
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
		/** 璋冭瘯锛氭爣绛?鍒犻櫎绛夛紙瑙?tabCloseDebug.ts锛?*/
		__voidShellTabCloseLog?: Array<{ iso: string; tag: string; detail: Record<string, unknown> }>;
	}
}

export {};
