import type { TikzCoordinate } from '../utils/coordinatePick';

/**
 * Freehand shape recognition for the hold-to-snap gesture: when the user
 * finishes a stroke and holds the pointer still, the stroke is matched
 * against primitive shapes and — on a hit — replaced by the clean shape.
 *
 * Recognition is deliberately geometric and threshold-based (no ML): corner
 * detection via Ramer–Douglas–Peucker, then straightness / rectangularity /
 * roundness tests with tolerances relative to the stroke's size, so the same
 * hand-wobble forgiveness applies at every zoom level.
 */

export type RecognizedShape =
	| { kind: 'line'; a: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'rect'; a: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'circle'; center: TikzCoordinate; radius: number }
	| { kind: 'ellipse'; center: TikzCoordinate; rx: number; ry: number }
	/** Closed polyline through the detected corners (triangle, diamond, …). */
	| { kind: 'polygon'; points: TikzCoordinate[] };

function distanceToSegment(p: TikzCoordinate, a: TikzCoordinate, b: TikzCoordinate): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) {
		return Math.hypot(p.x - a.x, p.y - a.y);
	}
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker on plain coordinates. */
function simplify(points: readonly TikzCoordinate[], toleranceCm: number): TikzCoordinate[] {
	if (points.length <= 2) {
		return [...points];
	}
	const keep = new Array<boolean>(points.length).fill(false);
	keep[0] = true;
	keep[points.length - 1] = true;
	const spans: Array<[number, number]> = [[0, points.length - 1]];
	while (spans.length) {
		const [first, last] = spans.pop() as [number, number];
		let worst = -1;
		let worstIndex = -1;
		for (let index = first + 1; index < last; index++) {
			const deviation = distanceToSegment(points[index], points[first], points[last]);
			if (deviation > worst) {
				worst = deviation;
				worstIndex = index;
			}
		}
		if (worstIndex > 0 && worst > toleranceCm) {
			keep[worstIndex] = true;
			spans.push([first, worstIndex], [worstIndex, last]);
		}
	}
	return points.filter((_, index) => keep[index]);
}

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function boundsOf(points: readonly TikzCoordinate[]): Bounds {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return { minX, minY, maxX, maxY };
}

/** Mean absolute deviation of the normalized radius from 1 (ellipse fit). */
function ellipseDeviation(
	points: readonly TikzCoordinate[],
	center: TikzCoordinate,
	rx: number,
	ry: number,
): number {
	if (rx < 1e-6 || ry < 1e-6) {
		return Number.POSITIVE_INFINITY;
	}
	let total = 0;
	for (const point of points) {
		const nx = (point.x - center.x) / rx;
		const ny = (point.y - center.y) / ry;
		total += Math.abs(Math.hypot(nx, ny) - 1);
	}
	return total / points.length;
}

/** Max distance from any sample to the closed polygon through `corners`. */
function polygonDeviation(
	points: readonly TikzCoordinate[],
	corners: readonly TikzCoordinate[],
): number {
	let worst = 0;
	for (const point of points) {
		let best = Number.POSITIVE_INFINITY;
		for (let index = 0; index < corners.length; index++) {
			const a = corners[index];
			const b = corners[(index + 1) % corners.length];
			best = Math.min(best, distanceToSegment(point, a, b));
		}
		worst = Math.max(worst, best);
	}
	return worst;
}

/** Angle of an edge folded into [0°, 90°] distance from the nearest axis. */
function axisAngleDeg(a: TikzCoordinate, b: TikzCoordinate): number {
	const deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90;
	return Math.min(deg, 90 - deg);
}

/**
 * Match a freehand stroke against line / rect / triangle / polygon /
 * circle / ellipse. `toleranceCm` is the base hand-wobble allowance (already
 * zoom-adjusted by the caller); most thresholds scale with the stroke size.
 * Returns null when nothing fits — the stroke stays freehand.
 */
export function recognizeStroke(
	points: readonly TikzCoordinate[],
	toleranceCm: number,
): RecognizedShape | null {
	if (points.length < 8) {
		return null;
	}
	const bounds = boundsOf(points);
	const diag = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
	if (diag < Math.max(0.4, toleranceCm * 4)) {
		return null;
	}

	const first = points[0];
	const last = points[points.length - 1];
	const closed = Math.hypot(last.x - first.x, last.y - first.y)
		< Math.max(diag * 0.22, toleranceCm * 2);

	if (!closed) {
		// Straight-line test: every sample near the first→last chord.
		let worst = 0;
		for (const point of points) {
			worst = Math.max(worst, distanceToSegment(point, first, last));
		}
		return worst < Math.max(toleranceCm * 1.5, diag * 0.045)
			? { kind: 'line', a: first, b: last }
			: null;
	}

	// Corner detection on the closed stroke. The tolerance scales with size
	// so a hand-drawn triangle keeps 3 corners and a circle keeps many.
	const corners = simplify(points, Math.max(diag * 0.055, toleranceCm));
	if (corners.length >= 2
		&& Math.hypot(
			corners[corners.length - 1].x - corners[0].x,
			corners[corners.length - 1].y - corners[0].y,
		) < Math.max(diag * 0.22, toleranceCm * 2)) {
		corners.pop();
	}
	const cornerCount = corners.length;

	const center = {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	};
	const rx = (bounds.maxX - bounds.minX) / 2;
	const ry = (bounds.maxY - bounds.minY) / 2;
	const roundness = ellipseDeviation(points, center, rx, ry);

	if (cornerCount === 3) {
		return { kind: 'polygon', points: corners };
	}
	if (cornerCount === 4) {
		const axisAligned = corners.every((corner, index) =>
			axisAngleDeg(corner, corners[(index + 1) % corners.length]) < 15);
		if (axisAligned) {
			return {
				kind: 'rect',
				a: { x: bounds.minX, y: bounds.minY },
				b: { x: bounds.maxX, y: bounds.maxY },
			};
		}
		return { kind: 'polygon', points: corners };
	}

	// Five or more corners: a clean round stroke wins over a polygon; a
	// deliberate pentagon/hexagon (flat edges, radius dipping at edge
	// midpoints) fits the polygon better.
	if (cornerCount >= 5) {
		const polyFit = polygonDeviation(points, corners);
		if (roundness < 0.09 && roundness * Math.max(rx, ry) < polyFit * 2) {
			if (Math.abs(rx - ry) < 0.2 * Math.max(rx, ry)) {
				return { kind: 'circle', center, radius: (rx + ry) / 2 };
			}
			return { kind: 'ellipse', center, rx, ry };
		}
		if (cornerCount <= 10) {
			return { kind: 'polygon', points: corners };
		}
	}
	return null;
}
