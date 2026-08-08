import type { TikzCoordinate } from '../utils/coordinatePick';
import { UNIT_TO_CM } from '../latex/tikzStatementGeometry';
import { splitOptionTokens } from './tikzOptions';
import type { PictureTransform } from './sceneTypes';

/**
 * Affine picture transforms for the visual editor.
 *
 * TikZ processes transform options left to right, each concatenating onto the
 * current transformation — so for `[scale=2, rotate=30]` a point is rotated
 * first, then scaled: display = M_scale(M_rotate(p)). The editor mirrors this
 * exactly for `scale`/`xscale`/`yscale`/`rotate`/`xslant`/`yslant`/
 * `shift`/`xshift`/`yshift`, which makes every statement in such pictures
 * fully editable: geometry maps through the transform for display, and edits
 * map back through its inverse. Options that redefine the coordinate system
 * itself (`cm=`, `x=`, `y=`, `z=`, `transform …`, `… around`) stay
 * unsupported and lock the picture's statements to source-only.
 */

export const IDENTITY_TRANSFORM: PictureTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** result(p) = outer(inner(p)). */
export function composeTransforms(
	outer: PictureTransform,
	inner: PictureTransform,
): PictureTransform {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
		ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
	};
}

export function applyToPoint(t: PictureTransform, p: TikzCoordinate): TikzCoordinate {
	return {
		x: t.a * p.x + t.c * p.y + t.tx,
		y: t.b * p.x + t.d * p.y + t.ty,
	};
}

/** Linear part only — for direction/delta vectors, where translation cancels. */
export function applyLinear(t: PictureTransform, p: TikzCoordinate): TikzCoordinate {
	return {
		x: t.a * p.x + t.c * p.y,
		y: t.b * p.x + t.d * p.y,
	};
}

export function invertTransform(t: PictureTransform): PictureTransform | null {
	const det = t.a * t.d - t.b * t.c;
	if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
		return null;
	}
	const a = t.d / det;
	const b = -t.b / det;
	const c = -t.c / det;
	const d = t.a / det;
	return {
		a, b, c, d,
		tx: -(a * t.tx + c * t.ty),
		ty: -(b * t.tx + d * t.ty),
	};
}

/** Length scale of the display x axis (image of the unit x vector). */
export function colXScale(t: PictureTransform): number {
	return Math.hypot(t.a, t.b);
}

/** Length scale of the display y axis (image of the unit y vector). */
export function colYScale(t: PictureTransform): number {
	return Math.hypot(t.c, t.d);
}

/** Area-preserving average length scale; exact for uniform scale + rotation. */
export function uniformScale(t: PictureTransform): number {
	return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
}

/** Rotation the transform applies to the x axis, in degrees CCW. */
export function rotationDeg(t: PictureTransform): number {
	return (Math.atan2(t.b, t.a) * 180) / Math.PI;
}

/** True when axis-aligned boxes stay axis-aligned (no rotation/slant). */
export function isAxisAligned(t: PictureTransform): boolean {
	return t.b === 0 && t.c === 0;
}

/* -------------------------------------------------------------------------- */
/* option parsing                                                              */
/* -------------------------------------------------------------------------- */

const NUMBER_RE = /^(-?\d*\.?\d+)$/;

function parseNumber(value: string): number | null {
	const match = NUMBER_RE.exec(value.trim());
	if (!match) {
		return null;
	}
	const parsed = Number.parseFloat(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
}

/** `xshift`/`yshift` length: bare numbers are pt in TikZ, units convert. */
function parseShiftLengthCm(value: string): number | null {
	const match = /^(-?\d*\.?\d+)\s*([a-z]*)$/i.exec(value.trim());
	if (!match) {
		return null;
	}
	const parsed = Number.parseFloat(match[1]);
	if (!Number.isFinite(parsed)) {
		return null;
	}
	const unit = match[2].toLowerCase() || 'pt';
	const factor = UNIT_TO_CM[unit];
	return factor === undefined ? null : parsed * factor;
}

function rotationMatrix(deg: number): PictureTransform {
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

function translation(point: TikzCoordinate): PictureTransform {
	return { ...IDENTITY_TRANSFORM, tx: point.x, ty: point.y };
}

/** outer-shift ∘ inner ∘ back-shift — for `… around={value:(x,y)}` options. */
function aroundPoint(inner: PictureTransform, center: TikzCoordinate): PictureTransform {
	return composeTransforms(
		translation(center),
		composeTransforms(inner, translation({ x: -center.x, y: -center.y })),
	);
}

const HAS_UNIT_RE = /[a-z]/i;
const AROUND_VALUE_RE = /^\{?\s*(-?\d*\.?\d+)\s*:\s*(\(.*\))\s*\}?$/;

export interface PictureTransformResult {
	/** Null when an option makes the mapping unreliable. */
	transform: PictureTransform | null;
	/** The offending option token, for the lock explanation. */
	offending: string | null;
}

/**
 * Build the affine transform declared by a tikzpicture's option list.
 *
 * TikZ resolves a coordinate (a, b) as a·x⃗ + b·y⃗ through the unit vectors
 * (settable via `x=`/`y=`), then applies the transformation matrix built by
 * the transform options in written order — mirrored here as matrix ∘ units.
 * Non-transform options are ignored; transform options this editor cannot
 * mirror (`cm=`, `transform canvas`, unparsable values) make the whole
 * picture source-only and are reported for the user-facing message.
 */
export function parsePictureTransform(optionsText: string): PictureTransformResult {
	let matrix = IDENTITY_TRANSFORM;
	let xvec: TikzCoordinate = { x: 1, y: 0 };
	let yvec: TikzCoordinate = { x: 0, y: 1 };

	/** xyz coordinate (a, b) in canvas cm under the current unit vectors. */
	const evalCoordinate = (a: number, b: number): TikzCoordinate => ({
		x: a * xvec.x + b * yvec.x,
		y: a * xvec.y + b * yvec.y,
	});

	/** `( … , … )` value: unit-bearing components are lengths, bare pairs are
	 * xyz coordinates under the current vectors. */
	const parseCoordinateValue = (value: string): TikzCoordinate | null => {
		const inner = value.trim().replace(/^\{|\}$/g, '').trim();
		const pair = /^\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/.exec(inner);
		if (!pair) {
			return null;
		}
		if (HAS_UNIT_RE.test(pair[1]) || HAS_UNIT_RE.test(pair[2])) {
			const x = parseShiftLengthCm(pair[1]);
			const y = parseShiftLengthCm(pair[2]);
			return x !== null && y !== null ? { x, y } : null;
		}
		const a = parseNumber(pair[1]);
		const b = parseNumber(pair[2]);
		return a !== null && b !== null ? evalCoordinate(a, b) : null;
	};

	/** `x=`/`y=` value: a length (along the axis) or a coordinate pair. */
	const parseUnitVector = (value: string, axis: 'x' | 'y'): TikzCoordinate | null => {
		const inner = value.trim().replace(/^\{|\}$/g, '').trim();
		if (inner.startsWith('(')) {
			return parseCoordinateValue(inner);
		}
		const length = parseShiftLengthCm(inner);
		if (length === null) {
			return null;
		}
		return axis === 'x' ? { x: length, y: 0 } : { x: 0, y: length };
	};

	for (const token of splitOptionTokens(optionsText)) {
		const text = token.text;
		const eq = text.indexOf('=');
		const key = (eq >= 0 ? text.slice(0, eq) : text).trim();
		const value = eq >= 0 ? text.slice(eq + 1).trim() : '';

		// Coordinate-system overrides beyond the affine model (`transform
		// shape` only affects node content, never coordinates — ignored).
		if (key === 'cm' || key === 'shift only'
			|| (key.startsWith('transform') && key !== 'transform shape')) {
			return { transform: null, offending: text };
		}

		let step: PictureTransform | null | undefined;
		switch (key) {
			case 'x':
			case 'y': {
				const vector = parseUnitVector(value, key);
				if (!vector) {
					return { transform: null, offending: text };
				}
				if (key === 'x') {
					xvec = vector;
				} else {
					yvec = vector;
				}
				break;
			}
			case 'z':
			case 'transform shape':
				// z only affects three-component coordinates, which lock their
				// statements individually at parse time.
				break;
			case 'scale': {
				const s = parseNumber(value);
				step = s !== null && s !== 0 ? { ...IDENTITY_TRANSFORM, a: s, d: s } : null;
				break;
			}
			case 'xscale': {
				const s = parseNumber(value);
				step = s !== null && s !== 0 ? { ...IDENTITY_TRANSFORM, a: s } : null;
				break;
			}
			case 'yscale': {
				const s = parseNumber(value);
				step = s !== null && s !== 0 ? { ...IDENTITY_TRANSFORM, d: s } : null;
				break;
			}
			case 'rotate': {
				const deg = parseNumber(value);
				step = deg !== null ? rotationMatrix(deg) : null;
				break;
			}
			case 'rotate around': {
				const match = AROUND_VALUE_RE.exec(value);
				const deg = match ? parseNumber(match[1]) : null;
				const center = match ? parseCoordinateValue(match[2]) : null;
				step = deg !== null && center ? aroundPoint(rotationMatrix(deg), center) : null;
				break;
			}
			case 'scale around': {
				const match = AROUND_VALUE_RE.exec(value);
				const s = match ? parseNumber(match[1]) : null;
				const center = match ? parseCoordinateValue(match[2]) : null;
				step = s !== null && s !== 0 && center
					? aroundPoint({ ...IDENTITY_TRANSFORM, a: s, d: s }, center)
					: null;
				break;
			}
			case 'xslant': {
				const k = parseNumber(value);
				step = k !== null ? { ...IDENTITY_TRANSFORM, c: k } : null;
				break;
			}
			case 'yslant': {
				const k = parseNumber(value);
				step = k !== null ? { ...IDENTITY_TRANSFORM, b: k } : null;
				break;
			}
			case 'shift': {
				const coordinate = parseCoordinateValue(value);
				step = coordinate ? translation(coordinate) : null;
				break;
			}
			case 'xshift': {
				const length = parseShiftLengthCm(value);
				step = length !== null ? { ...IDENTITY_TRANSFORM, tx: length } : null;
				break;
			}
			case 'yshift': {
				const length = parseShiftLengthCm(value);
				step = length !== null ? { ...IDENTITY_TRANSFORM, ty: length } : null;
				break;
			}
			default:
				step = undefined;
		}

		if (step === null) {
			// A recognized transform key with a value we cannot parse.
			return { transform: null, offending: text };
		}
		if (step) {
			matrix = composeTransforms(matrix, step);
		}
	}

	const units: PictureTransform = {
		a: xvec.x, b: xvec.y, c: yvec.x, d: yvec.y, tx: 0, ty: 0,
	};
	return { transform: composeTransforms(matrix, units), offending: null };
}
