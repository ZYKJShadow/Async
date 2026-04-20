/** 视口边缘留白 */
export const POPOVER_VIEW_MARGIN = 10;
/** 与锚点间距 */
export const POPOVER_GAP = 8;
/**
 * 菜单在视口内希望保持的参考最小高度（实际 minHeight 不超过 maxHeight，避免超出视口）
 */
export const POPOVER_MENU_MIN_HEIGHT = 200;
/** 相对视口高度的硬上限比例 */
export const POPOVER_MAX_VIEWPORT_RATIO = 0.88;

export type PopoverPlacement = 'below' | 'above';

export type ClampedPopoverLayout = {
	placement: PopoverPlacement;
	left: number;
	width: number;
	top?: number;
	bottom?: number;
	maxHeightPx: number;
	minHeightPx: number;
};

export type ClampPopoverOptions = {
	viewportWidth: number;
	viewportHeight: number;
	menuWidth: number;
	/** 内容自然高度：测量 scrollHeight 或合理估算 */
	contentHeight: number;
	/**
	 * 锚点靠近视口底部（如底栏 Composer）时，若上方空间更宽裕则优先向上展开，
	 * 减轻「向下弹出却被窗口裁切」的观感（尤其存在 body zoom / 缩放时）。
	 */
	preferAboveNearViewportBottom?: boolean;
};

/**
 * 优先在锚点下方展开；若下方空间不足且上方更宽裕则向上展开。
 * 最终 maxHeight 不超过可用空间，超出部分由 overflow:auto 滚动。
 */
export function computeClampedPopoverLayout(
	anchorRect: DOMRectReadOnly | DOMRect,
	opts: ClampPopoverOptions
): ClampedPopoverLayout {
	const { viewportWidth: vw, viewportHeight: vh, menuWidth, contentHeight } = opts;
	const r = anchorRect;
	const M = POPOVER_VIEW_MARGIN;
	const G = POPOVER_GAP;

	let left = r.left;
	if (left + menuWidth > vw - M) {
		left = Math.max(M, vw - menuWidth - M);
	}

	const availBelow = Math.max(0, vh - r.bottom - G - M);
	const availAbove = Math.max(0, r.top - G - M);
	const hardCap = Math.max(120, Math.floor(vh * POPOVER_MAX_VIEWPORT_RATIO));
	const desired = Math.min(Math.max(contentHeight, 1), hardCap);

	const needMoreThanBelow = desired > availBelow;
	const aboveIsRoomier = availAbove >= availBelow;
	let useAbove = needMoreThanBelow && aboveIsRoomier;

	if (opts.preferAboveNearViewportBottom && !useAbove) {
		const nearBottom = r.bottom > vh - 320;
		const couldOpenAbove = availAbove >= Math.min(desired, POPOVER_MENU_MIN_HEIGHT);
		if (nearBottom && couldOpenAbove && availAbove >= availBelow) {
			useAbove = true;
		}
	}

	let maxH: number;
	if (useAbove) {
		maxH = Math.max(64, Math.min(desired, availAbove, hardCap));
	} else {
		maxH = Math.max(64, Math.min(desired, availBelow, hardCap));
	}

	const minH = Math.min(POPOVER_MENU_MIN_HEIGHT, maxH);

	if (useAbove) {
		return {
			placement: 'above',
			left,
			width: menuWidth,
			bottom: vh - r.top + G,
			maxHeightPx: maxH,
			minHeightPx: minH,
		};
	}

	return {
		placement: 'below',
		left,
		width: menuWidth,
		top: r.bottom + G,
		maxHeightPx: maxH,
		minHeightPx: minH,
	};
}

/**
 * 将矩形垂直位置限制在视口内（用于小浮层、tooltip）
 */
export function clampVerticalInViewport(
	top: number,
	floatingHeight: number,
	viewportHeight: number,
	margin = POPOVER_VIEW_MARGIN
): number {
	const maxTop = Math.max(margin, viewportHeight - margin - floatingHeight);
	return Math.min(Math.max(margin, top), maxTop);
}

/** Git 分支菜单：头部搜索 + 分区标题 + 底栏约需此高度，低于此则列表会被 flex 压成 0 */
const GIT_BRANCH_POPOVER_CHROME_RESERVE = 168;

/**
 * 右下角 Git 分支菜单：优先在锚点上方展开，菜单右边缘与锚点右对齐。
 * 若上方剩余高度不足以容纳头部+列表+底栏，则改到下方或选上下中 maxHeight 更大的一侧，避免列表高度为 0。
 */
export function computeGitBranchPopoverLayout(
	anchorRect: DOMRectReadOnly | DOMRect,
	opts: { viewportWidth: number; viewportHeight: number; menuWidth: number; contentHeight: number }
): ClampedPopoverLayout {
	const { viewportWidth: vw, viewportHeight: vh, menuWidth, contentHeight } = opts;
	const r = anchorRect;
	const M = POPOVER_VIEW_MARGIN;
	const G = POPOVER_GAP;
	const hardCap = Math.max(120, Math.floor(vh * POPOVER_MAX_VIEWPORT_RATIO));

	let left = r.right - menuWidth;
	if (left < M) {
		left = M;
	}
	if (left + menuWidth > vw - M) {
		left = Math.max(M, vw - menuWidth - M);
	}

	const desired = Math.min(Math.max(contentHeight, 1), hardCap);
	const availBelow = Math.max(0, vh - r.bottom - G - M);
	const availAbove = Math.max(0, r.top - G - M);
	const maxAbove = Math.max(64, Math.min(desired, availAbove, hardCap));
	const maxBelow = Math.max(64, Math.min(desired, availBelow, hardCap));

	/* 默认倾向上方；若上方可用高度连固定 chrome 都撑不住而下方明显更高，则用下方 */
	let useAbove = availAbove >= availBelow || maxAbove >= GIT_BRANCH_POPOVER_CHROME_RESERVE;
	if (maxAbove < GIT_BRANCH_POPOVER_CHROME_RESERVE && maxBelow > maxAbove + 20) {
		useAbove = false;
	}
	if (availAbove < 96 && maxBelow > maxAbove) {
		useAbove = false;
	}

	if (useAbove) {
		return {
			placement: 'above',
			left,
			width: menuWidth,
			bottom: vh - r.top + G,
			maxHeightPx: maxAbove,
			/* 不强制最小高度，避免 minHeight 与 maxHeight 相等时挤没中间列表 */
			minHeightPx: 0,
		};
	}

	return {
		placement: 'below',
		left,
		width: menuWidth,
		top: r.bottom + G,
		maxHeightPx: maxBelow,
		minHeightPx: 0,
	};
}
