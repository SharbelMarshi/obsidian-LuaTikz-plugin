import type { TikzCoordinate } from '../utils/coordinatePick';

/**
 * Snapping for the visual editor. All math is in TikZ cm — never raw pixels —
 * so snapped output lands on exact coordinates like `(1, 0.5)` regardless of
 * zoom. Pixel feel is preserved by the caller converting its px tolerance to
 * cm with the current zoom before calling in.
 */

export interface SnapContext {
	gridStepCm: number;
	snapToGrid: boolean;
	snapToObjects: boolean;
	/** Endpoints/centers of other objects. */
	candidates: readonly TikzCoordinate[];
	/** Snap radius in cm (converted from px by the caller). */
	toleranceCm: number;
}

export interface SnapResult {
	point: TikzCoordinate;
	kind: 'none' | 'object' | 'grid';
	/** The candidate that captured the point, for drawing a snap indicator. */
	target: TikzCoordinate | null;
}

function roundTo(value: number, step: number): number {
	return Math.round(value / step) * step;
}

/** Snap a raw pointer position: object points win over the grid. */
export function snapPoint(raw: TikzCoordinate, context: SnapContext): SnapResult {
	if (context.snapToObjects) {
		let best: TikzCoordinate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const candidate of context.candidates) {
			const distance = Math.hypot(raw.x - candidate.x, raw.y - candidate.y);
			if (distance <= context.toleranceCm && distance < bestDistance) {
				bestDistance = distance;
				best = candidate;
			}
		}
		if (best) {
			return { point: { ...best }, kind: 'object', target: best };
		}
	}

	if (context.snapToGrid && context.gridStepCm > 0) {
		const snapped = {
			x: roundTo(raw.x, context.gridStepCm),
			y: roundTo(raw.y, context.gridStepCm),
		};
		if (
			Math.hypot(raw.x - snapped.x, raw.y - snapped.y) <= context.toleranceCm
		) {
			return { point: snapped, kind: 'grid', target: null };
		}
	}

	return { point: raw, kind: 'none', target: null };
}

/**
 * Constrain `point` to the horizontal or vertical axis through `anchor`,
 * whichever is closer to the pointer (Shift-drag behavior, in cm).
 */
export function axisConstrain(
	point: TikzCoordinate,
	anchor: TikzCoordinate,
): TikzCoordinate {
	const dx = Math.abs(point.x - anchor.x);
	const dy = Math.abs(point.y - anchor.y);
	if (dy > dx) {
		return { x: anchor.x, y: point.y };
	}
	return { x: point.x, y: anchor.y };
}

/** Snap a translation delta so a reference point lands on the grid. */
export function snapTranslation(
	reference: TikzCoordinate,
	rawDx: number,
	rawDy: number,
	context: SnapContext,
): { dx: number; dy: number } {
	const moved = { x: reference.x + rawDx, y: reference.y + rawDy };
	const snapped = snapPoint(moved, context);
	if (snapped.kind === 'none') {
		return { dx: rawDx, dy: rawDy };
	}
	return { dx: snapped.point.x - reference.x, dy: snapped.point.y - reference.y };
}
