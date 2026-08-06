import { formatTikzCoordinate, type TikzCoordinate } from '../utils/coordinatePick';
import { UNIT_TO_CM } from '../latex/tikzStatementGeometry';
import { applyStyleEdit, type StyleEdit } from './tikzOptions';
import { applySourcePatches } from './sourcePatches';
import { statementInsertionPoint } from './tikzSceneParser';
import type {
	CoordinateToken,
	LengthToken,
	NumberToken,
	ObjectStyle,
	SceneNodeObject,
	SceneObject,
	ScenePathObject,
	ScenePicture,
	SourcePatch,
	TikzScene,
} from './sceneTypes';

/**
 * TikZ generation and minimal-patch computation for visual edits.
 *
 * Every function here returns either statement text (for newly drawn objects)
 * or {@link SourcePatch} lists targeting only the coordinate/length/option
 * tokens that actually changed — surrounding formatting, comments, and any
 * unsupported syntax stay byte-identical.
 */

/** Format a number for TikZ output: up to `decimals`, no trailing zeros. */
export function formatTikzNumber(value: number, decimals = 2): string {
	const scale = 10 ** decimals;
	const rounded = Math.round(value * scale) / scale;
	const normalized = Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? 0 : rounded;
	return String(normalized);
}

/** `(x, y)` in the same shape the coordinate picker inserts. */
export function formatPoint(point: TikzCoordinate): string {
	return formatTikzCoordinate(point);
}

/** Convert a cm value into a length literal in `unit` (empty unit = cm). */
export function cmToLengthValue(cm: number, unit: string): number {
	const factor = unit ? UNIT_TO_CM[unit] : 1;
	if (!factor) {
		return cm;
	}
	return cm / factor;
}

function round2(value: number): number {
	const rounded = Math.round(value * 100) / 100;
	return Object.is(rounded, -0) ? 0 : rounded;
}

/* -------------------------------------------------------------------------- */
/* statement generation                                                        */
/* -------------------------------------------------------------------------- */

/** `[...]` prefix for a generated statement; empty string when no options. */
export function buildOptionsPrefix(style: ObjectStyle, extraTokens: string[] = []): string {
	const edit: StyleEdit = {};
	if (style.arrows) {
		edit.arrows = style.arrows;
	}
	if (style.strokeColor && style.strokeColor !== 'black') {
		edit.strokeColor = style.strokeColor;
	}
	if (style.fillColor) {
		edit.fillColor = style.fillColor;
	}
	if (style.lineWidth && style.lineWidth !== 'default') {
		edit.lineWidth = style.lineWidth;
	}
	if (style.dash && style.dash !== 'solid') {
		edit.dash = style.dash;
	}
	if (style.opacity !== undefined && style.opacity < 1) {
		edit.opacity = style.opacity;
	}
	if (style.roundedCorners) {
		edit.roundedCorners = true;
	}
	if (style.anchor) {
		edit.anchor = style.anchor;
	}
	if (style.fontSize && style.fontSize !== 'normal') {
		edit.fontSize = style.fontSize;
	}
	const merged = applyStyleEdit(extraTokens.join(', '), edit);
	return merged ? `[${merged}]` : '';
}

export function generateLine(
	a: TikzCoordinate,
	b: TikzCoordinate,
	style: ObjectStyle,
): string {
	return `\\draw${buildOptionsPrefix(style)} ${formatPoint(a)} -- ${formatPoint(b)};`;
}

export function generatePolyline(
	points: readonly TikzCoordinate[],
	closed: boolean,
	style: ObjectStyle,
): string {
	const parts = points.map(formatPoint);
	const path = parts.join(' -- ');
	return `\\draw${buildOptionsPrefix(style)} ${path}${closed ? ' -- cycle' : ''};`;
}

export function generateRectangle(
	a: TikzCoordinate,
	b: TikzCoordinate,
	style: ObjectStyle,
): string {
	return `\\draw${buildOptionsPrefix(style)} ${formatPoint(a)} rectangle ${formatPoint(b)};`;
}

export function generateCircle(
	center: TikzCoordinate,
	radiusCm: number,
	style: ObjectStyle,
): string {
	return `\\draw${buildOptionsPrefix(style)} ${formatPoint(center)} circle[radius=${formatTikzNumber(radiusCm)}cm];`;
}

export function generateEllipse(
	center: TikzCoordinate,
	rxCm: number,
	ryCm: number,
	style: ObjectStyle,
): string {
	return `\\draw${buildOptionsPrefix(style)} ${formatPoint(center)} ellipse[x radius=${formatTikzNumber(rxCm)}cm, y radius=${formatTikzNumber(ryCm)}cm];`;
}

export function generateArc(
	start: TikzCoordinate,
	startAngle: number,
	endAngle: number,
	radiusCm: number,
	style: ObjectStyle,
): string {
	return `\\draw${buildOptionsPrefix(style)} ${formatPoint(start)} arc[start angle=${formatTikzNumber(startAngle, 1)}, end angle=${formatTikzNumber(endAngle, 1)}, radius=${formatTikzNumber(radiusCm)}cm];`;
}

export function generateGridPath(
	a: TikzCoordinate,
	b: TikzCoordinate,
	stepCm: number,
	style: ObjectStyle,
): string {
	const prefix = buildOptionsPrefix(style, [`step=${formatTikzNumber(stepCm)}cm`]);
	return `\\draw${prefix} ${formatPoint(a)} grid ${formatPoint(b)};`;
}

export function generateNode(
	at: TikzCoordinate,
	text: string,
	math: boolean,
	style: ObjectStyle,
): string {
	const body = math ? `$${text}$` : text;
	return `\\node${buildOptionsPrefix(style)} at ${formatPoint(at)} {${body}};`;
}

/** Multi-segment cubic path: `(p0) .. controls (c) and (c) .. (p1) …`. */
export function generateCurvePath(
	points: readonly TikzCoordinate[],
	controls: ReadonlyArray<{ c1: TikzCoordinate; c2: TikzCoordinate }>,
	style: ObjectStyle,
): string {
	if (points.length < 2 || controls.length !== points.length - 1) {
		throw new Error('generateCurvePath: mismatched points/controls');
	}
	const parts: string[] = [formatPoint(points[0])];
	for (let index = 0; index < controls.length; index++) {
		const { c1, c2 } = controls[index];
		parts.push(
			`.. controls ${formatPoint(c1)} and ${formatPoint(c2)} .. ${formatPoint(points[index + 1])}`,
		);
	}
	return `\\draw${buildOptionsPrefix(style)}\n  ${parts.join('\n  ')};`;
}

/** Regular polygon vertices, flat-bottom orientation. */
export function polygonPoints(
	center: TikzCoordinate,
	radiusCm: number,
	sides: number,
): TikzCoordinate[] {
	const points: TikzCoordinate[] = [];
	const startAngle = Math.PI / 2;
	for (let index = 0; index < sides; index++) {
		const angle = startAngle + (2 * Math.PI * index) / sides;
		points.push({
			x: round2(center.x + radiusCm * Math.cos(angle)),
			y: round2(center.y + radiusCm * Math.sin(angle)),
		});
	}
	return points;
}

/** Star vertices alternating outer/inner radius. */
export function starPoints(
	center: TikzCoordinate,
	outerCm: number,
	innerRatio: number,
	spikes: number,
): TikzCoordinate[] {
	const points: TikzCoordinate[] = [];
	const startAngle = Math.PI / 2;
	for (let index = 0; index < spikes * 2; index++) {
		const radius = index % 2 === 0 ? outerCm : outerCm * innerRatio;
		const angle = startAngle + (Math.PI * index) / spikes;
		points.push({
			x: round2(center.x + radius * Math.cos(angle)),
			y: round2(center.y + radius * Math.sin(angle)),
		});
	}
	return points;
}

/** Diamond (rhombus) vertices from center and half-extents. */
export function diamondPoints(
	center: TikzCoordinate,
	rxCm: number,
	ryCm: number,
): TikzCoordinate[] {
	return [
		{ x: round2(center.x), y: round2(center.y + ryCm) },
		{ x: round2(center.x + rxCm), y: round2(center.y) },
		{ x: round2(center.x), y: round2(center.y - ryCm) },
		{ x: round2(center.x - rxCm), y: round2(center.y) },
	];
}

/* -------------------------------------------------------------------------- */
/* patch builders                                                              */
/* -------------------------------------------------------------------------- */

/** Rewrite one coordinate token so it resolves to `target` (pre-scale cm). */
export function coordinateTokenPatch(
	token: CoordinateToken,
	target: TikzCoordinate,
	/** Pen position the token's `+`/`++` prefix is measured from. */
	base: TikzCoordinate,
): SourcePatch {
	const value = token.prefix === ''
		? target
		: { x: target.x - base.x, y: target.y - base.y };
	return {
		oldSpan: token.span,
		replacement: formatPoint({ x: round2(value.x), y: round2(value.y) }),
	};
}

export function lengthTokenPatch(token: LengthToken, newCm: number): SourcePatch {
	return {
		oldSpan: token.valueSpan,
		replacement: formatTikzNumber(cmToLengthValue(newCm, token.unit)),
	};
}

export function numberTokenPatch(token: NumberToken, value: number): SourcePatch {
	return {
		oldSpan: token.valueSpan,
		replacement: formatTikzNumber(value, 1),
	};
}

/**
 * Translate a whole object. Only absolute coordinate tokens move; `+`/`++`
 * tokens are translation-invariant and stay untouched, which keeps the patch
 * minimal and the relative structure of the path intact.
 */
export function translateObjectPatches(
	object: SceneObject,
	dxCm: number,
	dyCm: number,
): SourcePatch[] {
	if (object.type === 'locked') {
		return [];
	}
	const patches: SourcePatch[] = [];
	const moveToken = (token: CoordinateToken) => {
		if (token.prefix !== '') {
			return;
		}
		patches.push({
			oldSpan: token.span,
			replacement: formatPoint({
				x: round2(token.x + dxCm),
				y: round2(token.y + dyCm),
			}),
		});
	};

	if (object.type === 'node') {
		moveToken(object.at);
		return patches;
	}

	for (const element of object.elements) {
		if (element.kind === 'coord') {
			moveToken(element.coord);
		} else if (element.kind === 'curveTo') {
			moveToken(element.c1);
			if (element.c2) {
				moveToken(element.c2);
			}
		}
	}
	return patches;
}

/** Patch replacing the node's text body. */
export function nodeTextPatch(object: SceneNodeObject, newText: string): SourcePatch | null {
	if (!object.textSpan) {
		return null;
	}
	return { oldSpan: object.textSpan, replacement: newText };
}

/**
 * Apply a style edit to a statement, patching its existing `[...]` group or
 * inserting a fresh one right after the command name.
 */
export function styleEditPatches(
	source: string,
	object: SceneObject,
	edit: StyleEdit,
): SourcePatch[] {
	if (object.type === 'locked') {
		return [];
	}
	if (object.optionsSpan) {
		const current = source.slice(object.optionsSpan.from, object.optionsSpan.to);
		const next = applyStyleEdit(current, edit);
		if (next === current) {
			return [];
		}
		return [{ oldSpan: object.optionsSpan, replacement: next }];
	}
	const merged = applyStyleEdit('', edit);
	if (!merged) {
		return [];
	}
	const commandMatch = /^\\[a-zA-Z@]+/.exec(source.slice(object.span.from));
	const insertAt = object.span.from + (commandMatch ? commandMatch[0].length : 1);
	return [{ oldSpan: { from: insertAt, to: insertAt }, replacement: `[${merged}]` }];
}

/**
 * Delete a statement. When it sits alone on its line(s) the whole lines go,
 * including the trailing newline, so no blank line is left behind.
 */
export function deleteObjectPatches(source: string, object: SceneObject): SourcePatch[] {
	let { from, to } = object.span;
	const lineStart = source.lastIndexOf('\n', from - 1) + 1;
	const before = source.slice(lineStart, from);
	const lineEndIndex = source.indexOf('\n', Math.max(to - 1, 0));
	const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
	const after = source.slice(to, lineEnd);

	if (!before.trim() && !after.trim()) {
		from = lineStart;
		to = lineEndIndex < 0 ? source.length : lineEnd + 1;
	}
	return [{ oldSpan: { from, to }, replacement: '' }];
}

/** Statement text of `object` translated by (dx, dy), for duplication. */
export function translatedStatementText(
	source: string,
	object: SceneObject,
	dxCm: number,
	dyCm: number,
): string {
	const statement = source.slice(object.span.from, object.span.to);
	const patches = translateObjectPatches(object, dxCm, dyCm).map(patch => ({
		oldSpan: {
			from: patch.oldSpan.from - object.span.from,
			to: patch.oldSpan.to - object.span.from,
		},
		replacement: patch.replacement,
	}));
	const applied = applySourcePatches(statement, patches);
	return applied.kind === 'success' ? applied.source : statement;
}

/** Insert a copy of `object`, offset by (dx, dy), right below it. */
export function duplicateObjectPatches(
	source: string,
	object: SceneObject,
	dxCm = 0.5,
	dyCm = -0.5,
): SourcePatch[] {
	const copy = translatedStatementText(source, object, dxCm, dyCm);
	const lineStart = source.lastIndexOf('\n', object.span.from - 1) + 1;
	const indentMatch = /^[ \t]*/.exec(source.slice(lineStart, object.span.from));
	const indent = indentMatch ? indentMatch[0] : '';
	const lineEndIndex = source.indexOf('\n', Math.max(object.span.to - 1, 0));
	const insertAt = lineEndIndex < 0 ? source.length : lineEndIndex;
	return [{
		oldSpan: { from: insertAt, to: insertAt },
		replacement: `\n${indent}${copy}`,
	}];
}

/** Insert a freshly generated statement at the end of `picture`. */
export function insertStatementPatches(
	scene: TikzScene,
	picture: ScenePicture,
	statementText: string,
): SourcePatch[] {
	const point = statementInsertionPoint(scene, picture);
	const indented = statementText
		.split('\n')
		.map((line, index) => (index === 0 ? line : `${point.indent}${line}`))
		.join('\n');
	const replacement = point.needsLeadingNewline
		? `\n${point.indent}${indented}\n`
		: `${point.indent}${indented}\n`;
	return [{ oldSpan: { from: point.offset, to: point.offset }, replacement }];
}

/* -------------------------------------------------------------------------- */
/* pen-position helpers (bases for relative-coordinate patches)                */
/* -------------------------------------------------------------------------- */

/**
 * Pen position (pre-scale) in effect *before* each element index; used to
 * convert an absolute drag target back into a `+`/`++` relative value.
 */
export function penPositionsBefore(object: ScenePathObject): TikzCoordinate[] {
	const positions: TikzCoordinate[] = [];
	let pen: TikzCoordinate = { x: 0, y: 0 };
	for (const element of object.elements) {
		positions.push(pen);
		if (element.kind === 'coord' && element.coord.prefix !== '+') {
			pen = element.coord.resolved;
		}
	}
	return positions;
}
