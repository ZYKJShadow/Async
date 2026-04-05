/// <reference types="vite/client" />

export interface AsyncShellAPI {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	subscribeChat(callback: (payload: unknown) => void): () => void;
	/** 窗口移动 / 缩放时触发，用于重算 fixed 浮层锚点 */
	subscribeLayout?(callback: () => void): () => void;
	subscribeThemeMode?(callback: (payload: unknown) => void): () => void;
	/** 工作区目录内文件在磁盘上增删改（外部编辑器保存等），主进程经 chokidar 防抖后广播 */
	subscribeWorkspaceFsTouched?(callback: () => void): () => void;
	/** PTY 终端输出（按 session id 区分） */
	subscribeTerminalPtyData?(callback: (id: string, data: string) => void): () => void;
	subscribeTerminalPtyExit?(callback: (id: string, code: unknown) => void): () => void;
}
declare global {
	interface Window {
		asyncShell?: AsyncShellAPI;
		/** 调试：标签/删除等（见 tabCloseDebug.ts） */
		__voidShellTabCloseLog?: Array<{ iso: string; tag: string; detail: Record<string, unknown> }>;
	}
}

export {};
