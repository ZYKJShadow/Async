/// <reference types="vite/client" />
import type * as React from 'react';

export interface AsyncShellAPI {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	setUnreadBadgeCount?(count: number): Promise<unknown>;
	getPathForFile?(file: File): string | null;
	subscribeChat(callback: (payload: unknown) => void): () => void;
	/** 缁愭褰涚粔璇插З / 缂傗晜鏂侀弮鎯靶曢崣鎴礉閻劋绨柌宥囩暬 fixed 濞搭喖鐪伴柨姘卞仯 */
	subscribeLayout?(callback: () => void): () => void;
	subscribeThemeMode?(callback: (payload: unknown) => void): () => void;
	/** 瀹搞儰缍旈崠铏规窗瑜版洖鍞撮弬鍥︽閸︺劎顥嗛惄妯圭瑐婢х偛鍨归弨鐧哥礄婢舵牠鍎寸紓鏍帆閸ｃ劋绻氱€涙鐡戦敍澶涚礉娑撴槒绻樼粙瀣病 chokidar 闂冨弶濮堥崥搴＄畭閹?*/
	subscribeWorkspaceFsTouched?(callback: () => void): () => void;
	/** 瀹搞儰缍旈崠鐑樻瀮娴犲墎鍌ㄥ鏇㈩浕濞嗏€冲弿闁插繑澹傞幓蹇撶暚閹存劧绱欐稉搴＄秼閸撳秶鐛ラ崣?root 濮ｆ柨顕悽杈吂闂冨懏鏌熺€瑰本鍨氶敍?*/
	subscribeWorkspaceFileIndexReady?(callback: (workspaceRootNorm: string) => void): () => void;
	/** 瀹告彃鐣ㄧ憗鍛絻娴犺泛褰夐崠鏍电礄鐎瑰顥婇妴浣稿祻鏉炲鈧礁鎯庨崑婧库偓浣稿瀼閹广垺褰冩禒鍓佹窗瑜版洩绱?*/
	subscribePluginsChanged?(callback: () => void): () => void;
	/** PTY 缂佸牏顏潏鎾冲毉閿涘牊瀵?session id 閸栧搫鍨庨敍?*/
	/** webview 鐠囬攱鐪伴幍鎾崇磻閺傛壆鐛ラ崣锝忕礄閻㈠彉瀵屾潻娑氣柤 web-contents-created 闁解晛鐡欐潪顒€褰傞敍?*/
	subscribeBrowserNewWindow?(callback: (payload: { url: string; disposition?: string }) => void): () => void;
	/** 娑撴槒绻樼粙瀣祮閸欐垹绮伴崘鍛枂濞村繗顫嶉崳銊╂桨閺夎法娈戦幒褍鍩楅崨鎴掓姢 */
	subscribeBrowserControl?(callback: (payload: unknown) => void): () => void;
	/** 閸忋劏鍏樼紒鍫㈩伂娴兼俺鐦芥潏鎾冲毉閿涘牐娉曠粣妤€褰涢崗鍙橀煩閿涙稖顓归梼鍛倵閹靛秳绱伴獮鎸庢尡閿?*/
	subscribeTerminalSessionData?(callback: (id: string, data: string, seq: number) => void): () => void;
	subscribeTerminalSessionAuthPrompt?(
		callback: (
			id: string,
			prompt: { prompt: string; kind: 'password' | 'passphrase'; seq: number } | null
		) => void
	): () => void;
	subscribeTerminalSessionExit?(callback: (id: string, code: unknown) => void): () => void;
	subscribeTerminalSessionListChanged?(callback: () => void): () => void;
	/** 閺屻儴顕楅崗銊ㄥ厴缂佸牏顏拋鍓х枂妞ら潧褰查弰鍓с仛閻ㄥ嫬鍞寸純?Shell / 鏉╃偞甯村Ο鈩冩緲 */
	/** 娑撴槒绻樼粙瀣嚞濮瑰倷瀵岀粣妤€褰涢幍鎾崇磻鐠佸墽鐤嗛獮璺哄瀼閹广垹鍩岄幐鍥х暰娓氀勭埉妞ょ櫢绱欐俊鍌欑矤閻欘剛鐝涘ù蹇氼潔閸ｃ劎鐛ラ崣锝呮暅鐠у嚖绱?*/
	subscribeOpenSettingsNav?(callback: (nav: string) => void): () => void;
	subscribeComposerAppendDraft?(callback: (payload: { text?: string } | string) => void): () => void;
	subscribeTrayCommand?(callback: (payload: { command?: string }) => void): () => void;
	/** 閼奉亜濮╅弴瀛樻煀閻樿埖鈧焦甯归柅渚婄礄checking / available / downloading / downloaded / error 缁涘绱?*/
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
		/** 鐠嬪啳鐦敍姘垼缁?閸掔娀娅庣粵澶涚礄鐟?tabCloseDebug.ts閿?*/
		__voidShellTabCloseLog?: Array<{ iso: string; tag: string; detail: Record<string, unknown> }>;
	}
}

export {};
