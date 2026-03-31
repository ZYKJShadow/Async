const LOG_KEY = '__voidShellTabCloseLog';

export type VoidShellDebugEntry = {
	iso: string;
	tag: string;
	detail: Record<string, unknown>;
};

/**
 * 渲染进程调试：Electron 里请看「应用窗口」的 DevTools（Ctrl+Shift+I），
 * 终端里跑 main 进程是看不到这些日志的。
 * 控制台执行：`window.__voidShellTabCloseLog` 可看最近记录。
 */
export function voidShellDebugLog(tag: string, detail: Record<string, unknown> = {}): void {
	const entry: VoidShellDebugEntry = { iso: new Date().toISOString(), tag, detail };
	console.warn(`[VoidShell][${tag}]`, detail);
	try {
		const w = window as unknown as Record<string, unknown>;
		const arr = Array.isArray(w[LOG_KEY]) ? (w[LOG_KEY] as VoidShellDebugEntry[]) : [];
		arr.push(entry);
		while (arr.length > 200) {
			arr.shift();
		}
		w[LOG_KEY] = arr;
	} catch {
		/* ignore */
	}
}
