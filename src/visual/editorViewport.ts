import { PT_PER_CM, type ClientPoint, type TikzCoordinate } from '../utils/coordinatePick';

/**
 * Viewport math for the editor canvas.
 *
 * The canvas SVG uses TeX pt user units with Y down — the same convention as
 * the compiled LuaTikZ output — so the existing coordinate-pick conversions
 * (`clientPointToTikzCoordinate`, `tikzCoordinateToClient`) work on it
 * unchanged via the SVG's screen CTM. Everything here manipulates the SVG
 * `viewBox`, which is what pan, zoom, pinch, and fit really are.
 *
 * The viewBox aspect ratio is always locked to the container's, so client↔pt
 * scaling stays uniform and there is no letterboxing to compensate for.
 */

export interface ViewBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface CmBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Stable workspace shown for empty pictures: -6…6 cm × -4…4 cm. Purely a
 * viewport default — it never appears in the generated TikZ.
 */
export const DEFAULT_VIEWPORT_CM: CmBounds = { minX: -6, minY: -4, maxX: 6, maxY: 4 };

export const MIN_VIEWBOX_SPAN_PT = 0.5 * PT_PER_CM;
export const MAX_VIEWBOX_SPAN_PT = 400 * PT_PER_CM;

/** TikZ cm bounds → viewBox (y flips: viewBox top = max cm y). */
export function viewBoxFromCmBounds(bounds: CmBounds): ViewBox {
	return {
		x: bounds.minX * PT_PER_CM,
		y: -bounds.maxY * PT_PER_CM,
		w: (bounds.maxX - bounds.minX) * PT_PER_CM,
		h: (bounds.maxY - bounds.minY) * PT_PER_CM,
	};
}

/** Grow/shrink `box` about its center so `w/h` equals `aspect` (width/height). */
export function matchAspect(box: ViewBox, aspect: number): ViewBox {
	if (!Number.isFinite(aspect) || aspect <= 0) {
		return box;
	}
	const current = box.w / box.h;
	if (Math.abs(current - aspect) < 1e-9) {
		return box;
	}
	if (current < aspect) {
		const w = box.h * aspect;
		return { x: box.x - (w - box.w) / 2, y: box.y, w, h: box.h };
	}
	const h = box.w / aspect;
	return { x: box.x, y: box.y - (h - box.h) / 2, w: box.w, h };
}

/** Fit `bounds` (cm) with a margin, aspect-corrected, clamped to sane spans. */
export function fitViewBox(
	bounds: CmBounds | null,
	aspect: number,
	marginCm = 1,
	minSpanCm = 4,
): ViewBox {
	const target = bounds ?? DEFAULT_VIEWPORT_CM;
	const spanX = Math.max(target.maxX - target.minX, 1e-6);
	const spanY = Math.max(target.maxY - target.minY, 1e-6);
	const centerX = (target.minX + target.maxX) / 2;
	const centerY = (target.minY + target.maxY) / 2;
	const halfX = Math.max(spanX / 2 + marginCm, minSpanCm / 2);
	const halfY = Math.max(spanY / 2 + marginCm, minSpanCm / 2);
	const box = viewBoxFromCmBounds({
		minX: centerX - halfX,
		minY: centerY - halfY,
		maxX: centerX + halfX,
		maxY: centerY + halfY,
	});
	return clampViewBox(matchAspect(box, aspect));
}

export function clampViewBox(box: ViewBox): ViewBox {
	const aspect = box.w / box.h;
	let { w } = box;
	w = Math.max(MIN_VIEWBOX_SPAN_PT, Math.min(MAX_VIEWBOX_SPAN_PT, w));
	const h = w / (Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5);
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Zoom by `factor` (>1 zooms in) keeping the viewBox point `focus` fixed. */
export function zoomViewBox(box: ViewBox, factor: number, focus: ClientPoint): ViewBox {
	const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
	const w = box.w / safeFactor;
	const h = box.h / safeFactor;
	const fx = (focus.x - box.x) / box.w;
	const fy = (focus.y - box.y) / box.h;
	return clampViewBox({
		x: focus.x - fx * w,
		y: focus.y - fy * h,
		w,
		h,
	});
}

/** Pan by a screen-pixel delta, given the current px-per-pt scale. */
export function panViewBox(box: ViewBox, dxPx: number, dyPx: number, pxPerPt: number): ViewBox {
	const scale = Math.max(pxPerPt, 1e-9);
	return {
		x: box.x - dxPx / scale,
		y: box.y - dyPx / scale,
		w: box.w,
		h: box.h,
	};
}

export interface PinchState {
	baseBox: ViewBox;
	baseDistance: number;
	/** Pinch midpoint in viewBox coordinates at gesture start. */
	baseFocus: ClientPoint;
}

/**
 * Two-finger pinch update: scale about the starting midpoint, then translate
 * so the midpoint tracks the fingers. Follows the viewport-effects approach
 * of the tikz-editor reference (MIT, Dominik Peters).
 */
export function pinchViewBox(
	pinch: PinchState,
	currentDistance: number,
	currentMidpointPx: ClientPoint,
	startMidpointPx: ClientPoint,
	pxPerPtAtStart: number,
): ViewBox {
	const ratio = pinch.baseDistance > 1e-6
		? currentDistance / pinch.baseDistance
		: 1;
	const zoomed = zoomViewBox(pinch.baseBox, ratio, pinch.baseFocus);
	const scale = Math.max(pxPerPtAtStart, 1e-9) * (zoomed.w > 0 ? pinch.baseBox.w / zoomed.w : 1);
	return panViewBox(
		zoomed,
		currentMidpointPx.x - startMidpointPx.x,
		currentMidpointPx.y - startMidpointPx.y,
		scale,
	);
}

/** Convert TikZ cm to canvas viewBox coordinates (pt, Y down). */
export function cmToViewBoxPoint(point: TikzCoordinate): ClientPoint {
	return { x: point.x * PT_PER_CM, y: -point.y * PT_PER_CM };
}

/** Grid line positions (cm) covering the viewBox at `stepCm` intervals. */
export function gridLinePositions(
	box: ViewBox,
	stepCm: number,
): { xs: number[]; ys: number[] } {
	const step = Math.max(stepCm, 0.05);
	const minXCm = box.x / PT_PER_CM;
	const maxXCm = (box.x + box.w) / PT_PER_CM;
	const maxYCm = -box.y / PT_PER_CM;
	const minYCm = -(box.y + box.h) / PT_PER_CM;

	const xs: number[] = [];
	const ys: number[] = [];
	const limit = 400;
	const onStep = (value: number): number => {
		const snapped = Math.round(value / step) * step;
		return Object.is(snapped, -0) ? 0 : snapped;
	};
	const startX = Math.ceil(minXCm / step) * step;
	for (let x = startX; x <= maxXCm && xs.length < limit; x += step) {
		xs.push(onStep(x));
	}
	const startY = Math.ceil(minYCm / step) * step;
	for (let y = startY; y <= maxYCm && ys.length < limit; y += step) {
		ys.push(onStep(y));
	}
	return { xs, ys };
}

export function formatViewBox(box: ViewBox): string {
	return `${box.x} ${box.y} ${box.w} ${box.h}`;
}
