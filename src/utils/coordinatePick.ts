/** Standard TeX pt per cm (approximate). */
export const PT_PER_CM = 28.452756;

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

/** Project a TikZ cm coordinate onto screen pixels for axis detection. */
export function tikzCoordinateToClient(
	svg: SVGSVGElement,
	coord: TikzCoordinate,
): ClientPoint | null {
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

export function screenPointToSvgUserSpace(
	svg: SVGSVGElement,
	clientX: number,
	clientY: number,
): TikzCoordinate | null {
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
