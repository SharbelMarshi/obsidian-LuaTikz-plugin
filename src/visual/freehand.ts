import type { TikzCoordinate } from '../utils/coordinatePick';
import type { ObjectStyle } from './sceneTypes';
import { buildOptionsPrefix, formatPoint } from './tikzWriter';

/**
 * Freehand stroke pipeline: capture → smooth → simplify → Bézier fit →
 * readable TikZ `.. controls ..` output.
 *
 * Adapted from the tikz-editor project by Dominik Peters
 * (https://github.com/DominikPeters/tikz-editor,
 * packages/app/src/ui/canvas-panel/freehand-tool.ts), MIT License,
 * Copyright (c) 2026 Dominik Peters. See THIRD-PARTY-NOTICES.md.
 *
 * All geometry here is in TikZ cm. Screen-space tolerances are converted by
 * the caller using the current zoom, so the same pixel feel applies at every
 * zoom level. Pointer pressure is captured alongside each sample so a later
 * variable-width representation stays possible, but it does not affect the
 * generated path today.
 */

/** Minimum on-screen spacing between kept samples, in CSS px. */
export const FREEHAND_LIVE_POINT_SPACING_PX = 6;
export const FREEHAND_MIN_POINTS = 3;
export const FREEHAND_SMOOTHING_MIN_PX = 2;
export const FREEHAND_SMOOTHING_MAX_PX = 32;
export const FREEHAND_SMOOTHING_DEFAULT_PX = 10;

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

/** Distance-based simplification: keep points at least `toleranceCm` apart. */
export function simplifyFreehandPoints(
	points: readonly FreehandSample[],
	toleranceCm: number,
): FreehandSample[] {
	if (points.length <= 2) {
		return [...points];
	}
	const toleranceSq = toleranceCm * toleranceCm;
	const simplified: FreehandSample[] = [points[0]];
	let lastKept = points[0];
	for (let index = 1; index < points.length - 1; index++) {
		const point = points[index];
		if (distanceSquared(lastKept, point) >= toleranceSq) {
			simplified.push(point);
			lastKept = point;
		}
	}
	const last = points[points.length - 1];
	if (distanceSquared(simplified[simplified.length - 1], last) > 0) {
		simplified.push(last);
	}
	return simplified;
}

/** Catmull-Rom spline through the points, as cubic Bézier segments. */
export function catmullRomToBezier(
	points: readonly TikzCoordinate[],
): FreehandBezierSegment[] {
	if (points.length < 2) {
		return [];
	}
	const segments: FreehandBezierSegment[] = [];
	for (let index = 0; index < points.length - 1; index++) {
		const p0 = index === 0 ? points[index] : points[index - 1];
		const p1 = points[index];
		const p2 = points[index + 1];
		const p3 = index + 2 < points.length ? points[index + 2] : p2;
		segments.push({
			c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
			c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
			to: p2,
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

/** Segments for the live in-progress stroke preview. */
export function freehandPreviewSegments(
	draft: FreehandDraft,
	smoothingPx: number,
	pxToCm: number,
): FreehandPreviewSegment[] {
	const toleranceCm = clampSmoothingPx(smoothingPx) * Math.max(pxToCm, 1e-6);
	const cleaned = simplifyFreehandPoints(smoothFreehandPoints(draft.points), toleranceCm);

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
	const toleranceCm = clampSmoothingPx(smoothingPx) * Math.max(pxToCm, 1e-6);
	const simplified = simplifyFreehandPoints(smoothFreehandPoints(draft.points), toleranceCm);

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
