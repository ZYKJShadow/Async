/** 内置浏览器指纹伪装：未填写的字段不注入，由页面使用真实值（主进程与渲染进程共用）。 */

export type BrowserFingerprintSpoofSettings = {
	platform?: string;
	/** 逗号分隔，如 `zh-CN, zh, en` */
	languages?: string;
	hardwareConcurrency?: number;
	deviceMemory?: number;
	screenWidth?: number;
	screenHeight?: number;
	/** availHeight = screenHeight - offset，默认 40（任务栏占位） */
	availHeightOffset?: number;
	devicePixelRatio?: number;
	colorDepth?: number;
	timezone?: string;
	/** 与 `Date.prototype.getTimezoneOffset()` 一致（分钟） */
	timezoneOffsetMinutes?: number;
	webglVendor?: string;
	webglRenderer?: string;
	canvasNoiseSeed?: number;
	audioNoiseSeed?: number;
	/** `default` 不改动；`block` 禁用 RTCPeerConnection */
	webrtcPolicy?: 'default' | 'block';
	/**
	 * 是否在存在任意伪装字段时隐藏 `navigator.webdriver`。
	 * 未设置时为 `true`（与其它伪装一起启用时默认隐藏）。
	 */
	maskWebdriver?: boolean;
};

const NUM = (v: unknown, min: number, max: number): number | undefined => {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	if (!Number.isFinite(n)) {
		return undefined;
	}
	const x = Math.floor(n);
	if (x < min || x > max) {
		return undefined;
	}
	return x;
};

export function normalizeBrowserFingerprintSpoof(raw?: unknown): BrowserFingerprintSpoofSettings {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const o = raw as Record<string, unknown>;
	const webrtcRaw = String(o.webrtcPolicy ?? o.webrtc_policy ?? '').trim().toLowerCase();
	const webrtcPolicy = webrtcRaw === 'block' ? 'block' : undefined;
	const maskRaw = o.maskWebdriver ?? o.mask_webdriver;
	let maskWebdriver: boolean | undefined;
	if (maskRaw === true || maskRaw === 'true') {
		maskWebdriver = true;
	} else if (maskRaw === false || maskRaw === 'false') {
		maskWebdriver = false;
	}
	const platform = String(o.platform ?? '').trim();
	const languages = String(o.languages ?? o.language ?? '').trim();
	const timezone = String(o.timezone ?? '').trim();
	const webglVendor = String(o.webglVendor ?? o.webgl_vendor ?? '').trim();
	const webglRenderer = String(o.webglRenderer ?? o.webgl_renderer ?? '').trim();

	const out: BrowserFingerprintSpoofSettings = {};
	if (platform) {
		out.platform = platform;
	}
	if (languages) {
		out.languages = languages;
	}
	const hc = NUM(o.hardwareConcurrency ?? o.hardware_concurrency, 1, 128);
	if (hc != null) {
		out.hardwareConcurrency = hc;
	}
	const dm = NUM(o.deviceMemory ?? o.device_memory, 1, 128);
	if (dm != null) {
		out.deviceMemory = dm;
	}
	const sw = NUM(o.screenWidth ?? o.screen_width, 320, 16384);
	if (sw != null) {
		out.screenWidth = sw;
	}
	const sh = NUM(o.screenHeight ?? o.screen_height, 240, 16384);
	if (sh != null) {
		out.screenHeight = sh;
	}
	const aho = NUM(o.availHeightOffset ?? o.avail_height_offset ?? o.screenAvailHeightOffset, 0, 500);
	if (aho != null) {
		out.availHeightOffset = aho;
	}
	const dpr = typeof o.devicePixelRatio === 'number' ? o.devicePixelRatio : Number(o.device_pixel_ratio);
	if (Number.isFinite(dpr) && dpr >= 0.5 && dpr <= 4) {
		out.devicePixelRatio = dpr;
	}
	const cd = NUM(o.colorDepth ?? o.color_depth, 8, 48);
	if (cd != null) {
		out.colorDepth = cd;
	}
	if (timezone) {
		out.timezone = timezone;
	}
	const tzOff = NUM(o.timezoneOffsetMinutes ?? o.timezone_offset_minutes, -840, 840);
	if (tzOff != null) {
		out.timezoneOffsetMinutes = tzOff;
	}
	if (webglVendor) {
		out.webglVendor = webglVendor;
	}
	if (webglRenderer) {
		out.webglRenderer = webglRenderer;
	}
	const cn = NUM(o.canvasNoiseSeed ?? o.canvas_noise_seed, 1, 0x7fffffff);
	if (cn != null) {
		out.canvasNoiseSeed = cn;
	}
	const an = NUM(o.audioNoiseSeed ?? o.audio_noise_seed, 1, 0x7fffffff);
	if (an != null) {
		out.audioNoiseSeed = an;
	}
	if (webrtcPolicy) {
		out.webrtcPolicy = webrtcPolicy;
	}
	if (maskWebdriver !== undefined) {
		out.maskWebdriver = maskWebdriver;
	}
	return out;
}

export function isBrowserFingerprintSpoofEmpty(fp: BrowserFingerprintSpoofSettings): boolean {
	return Object.keys(fp).length === 0;
}

export type FingerprintInjectPatch = {
	platform?: string;
	languages?: string[];
	hardwareConcurrency?: number;
	deviceMemory?: number;
	screenWidth?: number;
	screenHeight?: number;
	availHeightOffset?: number;
	devicePixelRatio?: number;
	colorDepth?: number;
	timezone?: string;
	timezoneOffsetMinutes?: number;
	webglVendor?: string;
	webglRenderer?: string;
	canvasNoiseSeed?: number;
	audioNoiseSeed?: number;
	webrtcPolicy?: 'block';
	maskWebdriver?: boolean;
};

export function fingerprintSettingsToInjectPatch(fp: BrowserFingerprintSpoofSettings): FingerprintInjectPatch | null {
	if (isBrowserFingerprintSpoofEmpty(fp)) {
		return null;
	}
	const patch: FingerprintInjectPatch = {};
	if (fp.platform) {
		patch.platform = fp.platform;
	}
	if (fp.languages) {
		const languages = fp.languages
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (languages.length) {
			patch.languages = languages;
		}
	}
	if (fp.hardwareConcurrency != null) {
		patch.hardwareConcurrency = fp.hardwareConcurrency;
	}
	if (fp.deviceMemory != null) {
		patch.deviceMemory = fp.deviceMemory;
	}
	if (fp.screenWidth != null) {
		patch.screenWidth = fp.screenWidth;
	}
	if (fp.screenHeight != null) {
		patch.screenHeight = fp.screenHeight;
	}
	if (fp.availHeightOffset != null) {
		patch.availHeightOffset = fp.availHeightOffset;
	}
	if (fp.devicePixelRatio != null) {
		patch.devicePixelRatio = fp.devicePixelRatio;
	}
	if (fp.colorDepth != null) {
		patch.colorDepth = fp.colorDepth;
	}
	if (fp.timezone) {
		patch.timezone = fp.timezone;
	}
	if (fp.timezoneOffsetMinutes != null) {
		patch.timezoneOffsetMinutes = fp.timezoneOffsetMinutes;
	}
	if (fp.webglVendor) {
		patch.webglVendor = fp.webglVendor;
	}
	if (fp.webglRenderer) {
		patch.webglRenderer = fp.webglRenderer;
	}
	if (fp.canvasNoiseSeed != null) {
		patch.canvasNoiseSeed = fp.canvasNoiseSeed;
	}
	if (fp.audioNoiseSeed != null) {
		patch.audioNoiseSeed = fp.audioNoiseSeed;
	}
	if (fp.webrtcPolicy === 'block') {
		patch.webrtcPolicy = 'block';
	}
	const mask =
		fp.maskWebdriver === false ? false : fp.maskWebdriver === true ? true : !isBrowserFingerprintSpoofEmpty(fp);
	patch.maskWebdriver = mask;
	return Object.keys(patch).length ? patch : null;
}
