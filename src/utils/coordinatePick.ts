/** Standard TeX pt per cm (approximate). */
export const PT_PER_CM = 28.452756;

/** Attribute injected on the rendered SVG root carrying the picture bbox in TeX pt. */
export const LUATIKZ_BBOX_ATTR = 'data-luatikz-bbox';

/**
 * Fill colors of the calibration markers drawn at the picture bbox corners.
 * Values are xcolor rgb components; each channel stays >= 0.2 so dark-mode
 * inversion (which only rewrites near-black colors) never touches them.
 */
export const CAL_MARKER_MIN_RGB: readonly [number, number, number] = [0.251, 0.502, 0.749];
export const CAL_MARKER_MAX_RGB: readonly [number, number, number] = [0.749, 0.502, 0.251];

const CAL_MARKER_TOLERANCE_PCT = 1.5;

export interface TikzCoordinate {
	x: number;
	y: number;
}

export function ptToCm(pt: number): number {
	return pt / PT_PER_CM;
}

/** Convert SVG user-space coords (Y down) to TikZ cm (Y up). */
export function svgUserSpaceToTikzCm(svgX: number, svgY: number): TikzCoordinate {
	return {
		x: ptToCm(svgX),
		y: ptToCm(-svgY),
	};
}

export function formatTikzCoordinate(coord: TikzCoordinate, decimals = 2): string {
	return `(${coord.x.toFixed(decimals)}, ${coord.y.toFixed(decimals)})`;
}

export interface ClientPoint {
	x: number;
	y: number;
}

/** With Shift held, snap axis using screen movement (vertical → same x, horizontal → same y). */
export function applyShiftConstraint(
	picked: TikzCoordinate,
	anchor: TikzCoordinate | null,
	client: ClientPoint,
	anchorClient: ClientPoint | null,
): TikzCoordinate {
	if (!anchor || !anchorClient) {
		return picked;
	}
	const dx = Math.abs(client.x - anchorClient.x);
	const dy = Math.abs(client.y - anchorClient.y);
	if (dy > dx) {
		return { x: anchor.x, y: picked.y };
	}
	return { x: picked.x, y: anchor.y };
}

/** TikZ path line missing trailing semicolon (coordinate pick prepends one). */
export const INCOMPLETE_DRAW_LINE_RE = /^\\(?:draw|path|fill|filldraw|node)\b.*[^;]\s*$/;

const NUMERIC_COORD_PAIR_RE = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;

const AXIS_EPS = 1e-4;

export interface NumericCoordinateSpan {
	coord: TikzCoordinate;
	from: number;
	to: number;
}

/** Every explicit numeric `(x, y)` pair in `text` with its span offsets. */
export function parseAllNumericCoordinates(text: string): NumericCoordinateSpan[] {
	const spans: NumericCoordinateSpan[] = [];
	for (const match of text.matchAll(NUMERIC_COORD_PAIR_RE)) {
		const from = match.index ?? 0;
		const x = Number.parseFloat(match[1]);
		const y = Number.parseFloat(match[2]);
		if (Number.isFinite(x) && Number.isFinite(y)) {
			spans.push({ coord: { x, y }, from, to: from + match[0].length });
		}
	}
	return spans;
}

function isHorizontal(a: TikzCoordinate, b: TikzCoordinate): boolean {
	return Math.abs(a.y - b.y) < AXIS_EPS;
}

function isVertical(a: TikzCoordinate, b: TikzCoordinate): boolean {
	return Math.abs(a.x - b.x) < AXIS_EPS;
}

/**
 * Orthogonal closing corner for a path ending in `cycle` (typed as `ccycle`).
 * Replaces the last picked point so edges meet at 90° back to the start.
 */
export function computeOrthogonalClosePoint(points: TikzCoordinate[]): TikzCoordinate | null {
	if (points.length < 3) {
		return null;
	}

	const p0 = points[0];
	const pPrev = points[points.length - 2];
	const pLast = points[points.length - 1];

	if (isHorizontal(pPrev, pLast)) {
		return { x: p0.x, y: pPrev.y };
	}
	if (isVertical(pPrev, pLast)) {
		return { x: pPrev.x, y: p0.y };
	}

	const p1 = points[1];
	if (isHorizontal(p0, p1)) {
		return { x: p0.x, y: pPrev.y };
	}
	if (isVertical(p0, p1)) {
		return { x: pPrev.x, y: p0.y };
	}

	return null;
}

/** Last explicit numeric `(x, y)` pair in text (e.g. already written in the block). */
export function parseLastNumericCoordinate(text: string): TikzCoordinate | null {
	let last: TikzCoordinate | null = null;
	for (const match of text.matchAll(NUMERIC_COORD_PAIR_RE)) {
		const x = Number.parseFloat(match[1]);
		const y = Number.parseFloat(match[2]);
		if (Number.isFinite(x) && Number.isFinite(y)) {
			last = { x, y };
		}
	}
	return last;
}

export function tikzCmToSvgPt(cmX: number, cmY: number): { x: number; y: number } {
	return { x: cmX * PT_PER_CM, y: -cmY * PT_PER_CM };
}

/** Picture bounding box in TeX pt (TikZ canvas space, Y up). */
export interface TikzPtBBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Parse the `.luatikzbbox` sidecar written during compile ("<min x>pt,<min y>pt,<max x>pt,<max y>pt" per picture). */
export function parseBBoxSidecar(text: string): TikzPtBBox | null {
	const line = text
		.split('\n')
		.map(entry => entry.trim())
		.find(Boolean);
	if (!line) {
		return null;
	}
	const match = line.match(
		/^(-?[\d.]+)pt,(-?[\d.]+)pt,(-?[\d.]+)pt,(-?[\d.]+)pt$/,
	);
	if (!match) {
		return null;
	}
	const [minX, minY, maxX, maxY] = match.slice(1).map(Number.parseFloat);
	if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
		return null;
	}
	return { minX, minY, maxX, maxY };
}

/** Stamp the picture bbox onto the SVG root so coordinate picking can calibrate later. */
export function injectTikzBBoxAttribute(svgText: string, sidecarText: string): string {
	const bbox = parseBBoxSidecar(sidecarText);
	if (!bbox || svgText.includes(LUATIKZ_BBOX_ATTR)) {
		return svgText;
	}
	const value = `${bbox.minX} ${bbox.minY} ${bbox.maxX} ${bbox.maxY}`;
	return svgText.replace(/<svg\b/, `<svg ${LUATIKZ_BBOX_ATTR}="${value}"`);
}

export function parseBBoxAttribute(svg: SVGSVGElement): TikzPtBBox | null {
	const raw = svg.getAttribute(LUATIKZ_BBOX_ATTR);
	if (!raw) {
		return null;
	}
	const parts = raw.trim().split(/\s+/).map(Number.parseFloat);
	if (parts.length !== 4 || !parts.every(Number.isFinite)) {
		return null;
	}
	const [minX, minY, maxX, maxY] = parts;
	return { minX, minY, maxX, maxY };
}

/** Does an SVG fill attribute (`rgb(25.1%, 50.2%, 74.9%)` style) match a marker color? */
export function fillMatchesMarker(
	fill: string,
	target: readonly [number, number, number],
): boolean {
	const match = fill.match(
		/^rgb\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i,
	);
	if (!match) {
		return false;
	}
	for (let channel = 0; channel < 3; channel++) {
		const actual = Number.parseFloat(match[channel + 1]);
		if (!Number.isFinite(actual) || Math.abs(actual - target[channel] * 100) > CAL_MARKER_TOLERANCE_PCT) {
			return false;
		}
	}
	return true;
}

export interface PickCalibration {
	bbox: TikzPtBBox;
	/** Client-space center of the marker at (bbox.minX, bbox.minY). */
	minClient: ClientPoint;
	/** Client-space center of the marker at (bbox.maxX, bbox.maxY). */
	maxClient: ClientPoint;
}

/** Ignore near-degenerate axes (e.g. a picture that is a single horizontal rule). */
const CAL_MIN_EXTENT_PT = 0.5;

function elementClientCenter(el: Element): ClientPoint {
	const rect = el.getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function findCalibrationMarkers(
	svg: SVGSVGElement,
): { min: ClientPoint; max: ClientPoint } | null {
	let min: ClientPoint | null = null;
	let max: ClientPoint | null = null;
	for (const path of Array.from(svg.querySelectorAll('path[fill]'))) {
		const fill = path.getAttribute('fill') ?? '';
		if (!min && fillMatchesMarker(fill, CAL_MARKER_MIN_RGB)) {
			min = elementClientCenter(path);
		} else if (!max && fillMatchesMarker(fill, CAL_MARKER_MAX_RGB)) {
			max = elementClientCenter(path);
		}
		if (min && max) {
			return { min, max };
		}
	}
	return null;
}

/** Read the bbox attribute + locate marker dots; null when this SVG has no calibration data. */
export function getPickCalibration(svg: SVGSVGElement): PickCalibration | null {
	const bbox = parseBBoxAttribute(svg);
	if (!bbox) {
		return null;
	}
	const markers = findCalibrationMarkers(svg);
	if (!markers) {
		return null;
	}
	return { bbox, minClient: markers.min, maxClient: markers.max };
}

function calibrationScales(cal: PickCalibration): { sx: number; sy: number } | null {
	const bboxW = cal.bbox.maxX - cal.bbox.minX;
	const bboxH = cal.bbox.maxY - cal.bbox.minY;
	// Client Y grows downward while TikZ Y grows upward, hence min.y - max.y.
	const sxRaw = bboxW > CAL_MIN_EXTENT_PT ? (cal.maxClient.x - cal.minClient.x) / bboxW : NaN;
	const syRaw = bboxH > CAL_MIN_EXTENT_PT ? (cal.minClient.y - cal.maxClient.y) / bboxH : NaN;
	// preserveAspectRatio keeps scaling uniform, so either axis can stand in for the other.
	const sx = Number.isFinite(sxRaw) && sxRaw > 0 ? sxRaw : syRaw;
	const sy = Number.isFinite(syRaw) && syRaw > 0 ? syRaw : sxRaw;
	if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
		return null;
	}
	return { sx, sy };
}

/** Map a client-space point to TikZ cm using marker calibration. */
export function calibratedClientToTikzCm(
	cal: PickCalibration,
	clientX: number,
	clientY: number,
): TikzCoordinate | null {
	const scales = calibrationScales(cal);
	if (!scales) {
		return null;
	}
	const xPt = cal.bbox.minX + (clientX - cal.minClient.x) / scales.sx;
	const yPt = cal.bbox.minY + (cal.minClient.y - clientY) / scales.sy;
	return { x: ptToCm(xPt), y: ptToCm(yPt) };
}

/** Inverse of calibratedClientToTikzCm. */
export function calibratedTikzCmToClient(
	cal: PickCalibration,
	coord: TikzCoordinate,
): ClientPoint | null {
	const scales = calibrationScales(cal);
	if (!scales) {
		return null;
	}
	const xPt = coord.x * PT_PER_CM;
	const yPt = coord.y * PT_PER_CM;
	return {
		x: cal.minClient.x + (xPt - cal.bbox.minX) * scales.sx,
		y: cal.minClient.y - (yPt - cal.bbox.minY) * scales.sy,
	};
}

/** Project a TikZ cm coordinate onto screen pixels for axis detection. */
export function tikzCoordinateToClient(
	svg: SVGSVGElement,
	coord: TikzCoordinate,
): ClientPoint | null {
	const calibration = getPickCalibration(svg);
	if (calibration) {
		const projected = calibratedTikzCmToClient(calibration, coord);
		if (projected) {
			return projected;
		}
	}
	const pt = svg.createSVGPoint();
	const svgPt = tikzCmToSvgPt(coord.x, coord.y);
	pt.x = svgPt.x;
	pt.y = svgPt.y;
	const ctm = svg.getScreenCTM();
	if (!ctm) {
		return null;
	}
	const screen = pt.matrixTransform(ctm);
	return { x: screen.x, y: screen.y };
}

/**
 * Map a click to TikZ cm. Prefers bbox+marker calibration (exact for LuaLaTeX
 * renders); falls back to treating SVG user space as TeX pt from the origin.
 */
export function clientPointToTikzCoordinate(
	svg: SVGSVGElement,
	clientX: number,
	clientY: number,
): TikzCoordinate | null {
	const calibration = getPickCalibration(svg);
	if (calibration) {
		const picked = calibratedClientToTikzCm(calibration, clientX, clientY);
		if (picked) {
			return picked;
		}
	}
	const point = svg.createSVGPoint();
	point.x = clientX;
	point.y = clientY;
	const ctm = svg.getScreenCTM();
	if (!ctm) {
		return null;
	}
	const transformed = point.matrixTransform(ctm.inverse());
	return svgUserSpaceToTikzCm(transformed.x, transformed.y);
}
