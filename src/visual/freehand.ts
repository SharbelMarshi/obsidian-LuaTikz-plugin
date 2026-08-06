import type { TikzCoordinate } from '../utils/coordinatePick';
import type { ObjectStyle } from './sceneTypes';
import { buildOptionsPrefix, formatPoint } from './tikzWriter';

/**
 * Freehand stroke pipeline: capture → smooth → simplify → Bézier fit →
 * readable TikZ `.. controls ..` output.
 *
 * Built from three textbook pieces: minimum-spacing sampling during capture,
 * Ramer–Douglas–Peucker simplification (keeps corners, drops redundancy), and
 * a uniform Catmull-Rom spline through the surviving points expressed as
 * cubic Bézier segments.
 *
 * All geometry is in TikZ cm. Screen-space tolerances are converted by the
 * caller using the current zoom, so the same pixel feel applies at every zoom
 * level. Pointer pressure is captured alongside each sample so a later
 * variable-width representation stays possible, but it does not affect the
 * generated path today.
 */

/** Minimum on-screen spacing between kept samples, in CSS px. */
export const FREEHAND_LIVE_POINT_SPACING_PX = 6;
export const FREEHAND_MIN_POINTS = 3;
export const FREEHAND_SMOOTHING_MIN_PX = 2;
export const FREEHAND_SMOOTHING_MAX_PX = 32;
export const FREEHAND_SMOOTHING_DEFAULT_PX = 10;

/** Smoothing px → RDP deviation: half feels comparable to the old spacing. */
const SMOOTHING_TO_DEVIATION = 0.5;

export interface FreehandSample extends TikzCoordinate {
	pressure: number;
}

export interface FreehandDraft {
	points: FreehandSample[];
	/** Minimum distance between kept samples, in cm. */
	minSampleDistanceCm: number;
}

export interface FreehandBezierSegment {
	c1: TikzCoordinate;
	c2: TikzCoordinate;
	to: TikzCoordinate;
}

function distanceSquared(a: TikzCoordinate, b: TikzCoordinate): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

export function createFreehandDraft(
	start: TikzCoordinate,
	pxToCm: number,
	pressure = 0.5,
): FreehandDraft {
	return {
		points: [{ ...start, pressure }],
		minSampleDistanceCm: FREEHAND_LIVE_POINT_SPACING_PX * Math.max(pxToCm, 1e-6),
	};
}

/** Append a sample, dropping points closer than the live spacing. */
export function appendFreehandPoint(
	draft: FreehandDraft,
	point: TikzCoordinate,
	pressure = 0.5,
): boolean {
	const last = draft.points[draft.points.length - 1];
	if (
		last
		&& distanceSquared(last, point)
		< draft.minSampleDistanceCm * draft.minSampleDistanceCm
	) {
		return false;
	}
	draft.points.push({ ...point, pressure });
	return true;
}

/** 3-tap moving average that keeps the endpoints fixed. */
export function smoothFreehandPoints(
	points: readonly FreehandSample[],
): FreehandSample[] {
	if (points.length < 3) {
		return [...points];
	}
	const smoothed: FreehandSample[] = [points[0]];
	for (let index = 1; index < points.length - 1; index++) {
		const prev = points[index - 1];
		const here = points[index];
		const next = points[index + 1];
		smoothed.push({
			x: (prev.x + 2 * here.x + next.x) / 4,
			y: (prev.y + 2 * here.y + next.y) / 4,
			pressure: here.pressure,
		});
	}
	smoothed.push(points[points.length - 1]);
	return smoothed;
}

/** Perpendicular distance from `point` to the line through `a`–`b`. */
function deviationFromChord(
	point: TikzCoordinate,
	a: TikzCoordinate,
	b: TikzCoordinate,
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq < 1e-12) {
		return Math.hypot(point.x - a.x, point.y - a.y);
	}
	return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x)
		/ Math.sqrt(lengthSq);
}

/**
 * Ramer–Douglas–Peucker simplification: keep the endpoints plus every point
 * that deviates more than `toleranceCm` from the chord of its span. Unlike
 * plain resampling this preserves sharp corners exactly.
 */
export function simplifyFreehandPoints(
	points: readonly FreehandSample[],
	toleranceCm: number,
): FreehandSample[] {
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
			const deviation = deviationFromChord(points[index], points[first], points[last]);
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

/**
 * Uniform Catmull-Rom spline through the points, expressed as cubic Bézier
 * segments (control points at one sixth of the neighbor chord — the standard
 * conversion). Endpoints clamp to themselves.
 */
export function catmullRomToBezier(
	points: readonly TikzCoordinate[],
): FreehandBezierSegment[] {
	if (points.length < 2) {
		return [];
	}
	const at = (index: number): TikzCoordinate =>
		points[Math.max(0, Math.min(points.length - 1, index))];
	const segments: FreehandBezierSegment[] = [];
	for (let index = 0; index < points.length - 1; index++) {
		const before = at(index - 1);
		const from = at(index);
		const to = at(index + 1);
		const after = at(index + 2);
		segments.push({
			c1: { x: from.x + (to.x - before.x) / 6, y: from.y + (to.y - before.y) / 6 },
			c2: { x: to.x - (after.x - from.x) / 6, y: to.y - (after.y - from.y) / 6 },
			to,
		});
	}
	return segments;
}

export type FreehandPreviewSegment =
	| { kind: 'line'; from: TikzCoordinate; to: TikzCoordinate }
	| { kind: 'bezier'; from: TikzCoordinate; c1: TikzCoordinate; c2: TikzCoordinate; to: TikzCoordinate };

export function clampSmoothingPx(value: number): number {
	if (!Number.isFinite(value)) {
		return FREEHAND_SMOOTHING_DEFAULT_PX;
	}
	return Math.max(FREEHAND_SMOOTHING_MIN_PX, Math.min(FREEHAND_SMOOTHING_MAX_PX, Math.round(value)));
}

function simplificationToleranceCm(smoothingPx: number, pxToCm: number): number {
	return clampSmoothingPx(smoothingPx) * SMOOTHING_TO_DEVIATION * Math.max(pxToCm, 1e-6);
}

/** Segments for the live in-progress stroke preview. */
export function freehandPreviewSegments(
	draft: FreehandDraft,
	smoothingPx: number,
	pxToCm: number,
): FreehandPreviewSegment[] {
	const cleaned = simplifyFreehandPoints(
		smoothFreehandPoints(draft.points),
		simplificationToleranceCm(smoothingPx, pxToCm),
	);

	if (cleaned.length < FREEHAND_MIN_POINTS) {
		const lines: FreehandPreviewSegment[] = [];
		for (let index = 1; index < cleaned.length; index++) {
			lines.push({ kind: 'line', from: cleaned[index - 1], to: cleaned[index] });
		}
		return lines;
	}

	const segments: FreehandPreviewSegment[] = [];
	let current: TikzCoordinate = cleaned[0];
	for (const segment of catmullRomToBezier(cleaned)) {
		segments.push({ kind: 'bezier', from: current, ...segment });
		current = segment.to;
	}
	return segments;
}

function polylineLength(points: readonly TikzCoordinate[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index++) {
		length += Math.sqrt(distanceSquared(points[index - 1], points[index]));
	}
	return length;
}

const MIN_STROKE_LENGTH_CM = 0.05;

/**
 * Final TikZ statement for a completed stroke, or null when the stroke is too
 * short/degenerate to keep. Short strokes become plain `--` polylines; longer
 * ones a readable multi-segment `.. controls ..` path.
 */
export function generateFreehandStatement(
	draft: FreehandDraft,
	smoothingPx: number,
	pxToCm: number,
	style: ObjectStyle = {},
): string | null {
	const simplified = simplifyFreehandPoints(
		smoothFreehandPoints(draft.points),
		simplificationToleranceCm(smoothingPx, pxToCm),
	);

	if (polylineLength(simplified) <= MIN_STROKE_LENGTH_CM) {
		return null;
	}

	const options = buildOptionsPrefix(style);
	if (simplified.length < FREEHAND_MIN_POINTS) {
		const parts = simplified.map(formatPoint).join(' -- ');
		return `\\draw${options} ${parts};`;
	}

	const segments = catmullRomToBezier(simplified);
	const parts: string[] = [formatPoint(simplified[0])];
	for (const segment of segments) {
		parts.push(
			`.. controls ${formatPoint(segment.c1)} and ${formatPoint(segment.c2)} .. ${formatPoint(segment.to)}`,
		);
	}
	return `\\draw${options}\n  ${parts.join('\n  ')};`;
}
