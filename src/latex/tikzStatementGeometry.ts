import { parseAllNumericCoordinates, type TikzCoordinate } from '../utils/coordinatePick';

/**
 * Approximate geometry for the drawing statements of a TikZ block, used to map
 * a point picked in the rendered preview back to the line that drew it.
 *
 * The model is deliberately shallow: explicit numeric coordinates, `--`-style
 * connectors, `rectangle`/`grid`, `circle`/`ellipse`, and picture-level
 * `scale`. Anything it cannot understand simply yields no shapes, in which case
 * the statement is never matched (the feature degrades to doing nothing rather
 * than highlighting the wrong line).
 */

/** Commands that begin a drawing statement terminated by `;`. */
const STATEMENT_COMMANDS = new Set([
	'draw',
	'path',
	'fill',
	'filldraw',
	'shade',
	'shadedraw',
	'pattern',
	'node',
	'coordinate',
	'pic',
	'clip',
]);

const FILLING_COMMANDS = new Set(['fill', 'filldraw', 'shade', 'shadedraw', 'pattern']);

/** Half-extent assumed for a bare node/coordinate anchor, in cm. */
const ANCHOR_RADIUS_CM = 0.25;

export type TikzShape =
	| { kind: 'point'; at: TikzCoordinate }
	| { kind: 'segment'; a: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'rect'; a: TikzCoordinate; b: TikzCoordinate; filled: boolean }
	| { kind: 'circle'; center: TikzCoordinate; radius: number; filled: boolean };

export interface TikzStatement {
	/** 0-based line index within the block source. */
	startLine: number;
	/** 0-based line index within the block source, inclusive. */
	endLine: number;
	shapes: TikzShape[];
}

export interface TikzGeometryMap {
	statements: TikzStatement[];
	/** Bounding box of every shape, in TikZ cm; null when nothing was parsed. */
	bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/* -------------------------------------------------------------------------- */
/* statement scanning                                                          */
/* -------------------------------------------------------------------------- */

function skipComment(source: string, index: number): number {
	let cursor = index;
	while (cursor < source.length && source[cursor] !== '\n') {
		cursor++;
	}
	return cursor;
}

function isCommentStart(source: string, index: number): boolean {
	return source[index] === '%' && (index === 0 || source[index - 1] !== '\\');
}

/** Index just past the `;` that ends the statement starting at `index`. */
function scanToSemicolon(source: string, index: number): number {
	let depth = 0;
	let cursor = index;

	while (cursor < source.length) {
		if (isCommentStart(source, cursor)) {
			cursor = skipComment(source, cursor);
			continue;
		}

		const char = source[cursor];
		if (char === '\\') {
			cursor += 2;
			continue;
		}
		if (char === '{' || char === '[') {
			depth++;
		} else if (char === '}' || char === ']') {
			depth = Math.max(0, depth - 1);
		} else if (char === ';' && depth === 0) {
			return cursor + 1;
		}
		cursor++;
	}

	return source.length;
}

interface RawStatement {
	command: string;
	from: number;
	to: number;
}

function scanStatements(source: string): RawStatement[] {
	const statements: RawStatement[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		if (isCommentStart(source, cursor)) {
			cursor = skipComment(source, cursor);
			continue;
		}

		if (source[cursor] !== '\\') {
			cursor++;
			continue;
		}

		const match = /^\\([a-zA-Z]+)/.exec(source.slice(cursor));
		if (!match) {
			cursor += 2;
			continue;
		}

		if (!STATEMENT_COMMANDS.has(match[1])) {
			cursor += match[0].length;
			continue;
		}

		const to = scanToSemicolon(source, cursor + match[0].length);
		statements.push({ command: match[1], from: cursor, to });
		cursor = to;
	}

	return statements;
}

/* -------------------------------------------------------------------------- */
/* lengths and picture scale                                                   */
/* -------------------------------------------------------------------------- */

const UNIT_TO_CM: Record<string, number> = {
	cm: 1,
	mm: 0.1,
	pt: 1 / 28.452756,
	bp: 1 / 28.346457,
	in: 2.54,
	em: 0.35,
	ex: 0.2,
};

/** Parse a TikZ length such as `0.5`, `5pt`, `3mm` into cm (cm is the default). */
export function parseLengthCm(raw: string): number | null {
	const match = raw.trim().match(/^(-?\d*\.?\d+)\s*([a-z]*)$/i);
	if (!match) {
		return null;
	}
	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value)) {
		return null;
	}
	const unit = match[2].toLowerCase();
	if (!unit) {
		return value;
	}
	const factor = UNIT_TO_CM[unit];
	return factor === undefined ? null : value * factor;
}

export interface PictureScale {
	x: number;
	y: number;
}

/** Uniform/axis scale declared on `\begin{tikzpicture}[...]`, defaulting to 1. */
export function parsePictureScale(source: string): PictureScale {
	const options = source.match(/\\begin\s*\{tikzpicture\}\s*\[([^\]]*)\]/);
	if (!options) {
		return { x: 1, y: 1 };
	}

	const readKey = (key: string): number | null => {
		const match = options[1].match(new RegExp(`(?:^|[,\\s])${key}\\s*=\\s*(-?\\d*\\.?\\d+)`));
		if (!match) {
			return null;
		}
		const value = Number.parseFloat(match[1]);
		return Number.isFinite(value) && value !== 0 ? value : null;
	};

	const uniform = readKey('scale') ?? 1;
	return {
		x: readKey('xscale') ?? uniform,
		y: readKey('yscale') ?? uniform,
	};
}

/* -------------------------------------------------------------------------- */
/* shape extraction                                                            */
/* -------------------------------------------------------------------------- */

const RECT_CONNECTOR_RE = /\b(?:rectangle|grid)\b/;
const LINE_CONNECTOR_RE = /--|\.\.|\bto\b|\bedge\b|\|-|-\|/;
const CYCLE_RE = /\bcycle\b/;

function optionsOf(body: string): string {
	const match = body.match(/^\\[a-zA-Z]+\s*\[([^\]]*)\]/);
	return match ? match[1] : '';
}

function isFilled(command: string, body: string): boolean {
	if (FILLING_COMMANDS.has(command)) {
		return true;
	}
	const options = optionsOf(body);
	return /(?:^|[,\s])fill\s*=/.test(options) || /(?:^|[,\s])fill(?:\s*,|\s*$)/.test(options);
}

function add(a: TikzCoordinate, b: TikzCoordinate): TikzCoordinate {
	return { x: a.x + b.x, y: a.y + b.y };
}

/** Radius in cm for a `circle`/`ellipse` operator written at `offset`. */
function radiusFromOperator(body: string, offset: number): number | null {
	const rest = body.slice(offset);
	const bracket = rest.match(/^\s*\[([^\]]*)\]/);
	if (bracket) {
		const radius = bracket[1].match(/(?:x\s+)?radius\s*=\s*([^,\]]+)/);
		return radius ? parseLengthCm(radius[1]) : null;
	}

	const paren = rest.match(/^\s*\(([^)]*)\)/);
	if (!paren) {
		return null;
	}

	const parts = paren[1].split(/\band\b/);
	const lengths = parts.map(part => parseLengthCm(part)).filter((value): value is number =>
		value !== null);
	if (!lengths.length) {
		return null;
	}
	return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}

function parseShapes(command: string, body: string, scale: PictureScale): TikzShape[] {
	const spans = parseAllNumericCoordinates(body);
	if (!spans.length) {
		return [];
	}

	const scaled = spans.map(span => ({
		...span,
		coord: { x: span.coord.x * scale.x, y: span.coord.y * scale.y },
	}));

	const filled = isFilled(command, body);
	const shapes: TikzShape[] = [];
	const resolved: TikzCoordinate[] = [];

	let pen: TikzCoordinate = { x: 0, y: 0 };
	let previous: TikzCoordinate | null = null;

	for (let index = 0; index < scaled.length; index++) {
		const span = scaled[index];
		const prefix = body.slice(Math.max(0, span.from - 2), span.from);

		let point: TikzCoordinate;
		if (prefix.endsWith('++')) {
			point = add(pen, span.coord);
			pen = point;
		} else if (prefix.endsWith('+')) {
			point = add(pen, span.coord);
		} else {
			point = span.coord;
			pen = point;
		}
		resolved.push(point);

		if (previous) {
			const connector = body.slice(scaled[index - 1].to, span.from);
			if (RECT_CONNECTOR_RE.test(connector)) {
				shapes.push({ kind: 'rect', a: previous, b: point, filled });
			} else if (LINE_CONNECTOR_RE.test(connector)) {
				shapes.push({ kind: 'segment', a: previous, b: point });
			}
		}
		previous = point;
	}

	for (const match of body.matchAll(/\b(?:circle|ellipse)\b/g)) {
		const at = match.index ?? 0;
		let centerIndex = -1;
		for (let index = 0; index < scaled.length; index++) {
			if (scaled[index].to <= at) {
				centerIndex = index;
			}
		}
		if (centerIndex < 0) {
			continue;
		}
		const radius = radiusFromOperator(body, at + match[0].length);
		if (radius === null || radius <= 0) {
			continue;
		}
		const axisScale = (Math.abs(scale.x) + Math.abs(scale.y)) / 2;
		shapes.push({
			kind: 'circle',
			center: resolved[centerIndex],
			radius: radius * axisScale,
			filled,
		});
	}

	const tail = body.slice(scaled[scaled.length - 1].to);
	if (CYCLE_RE.test(tail) && resolved.length > 2) {
		shapes.push({ kind: 'segment', a: resolved[resolved.length - 1], b: resolved[0] });
	}

	if (!shapes.length) {
		shapes.push({ kind: 'point', at: resolved[0] });
	}

	return shapes;
}

/* -------------------------------------------------------------------------- */
/* distances                                                                   */
/* -------------------------------------------------------------------------- */

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

function distanceToRect(
	p: TikzCoordinate,
	a: TikzCoordinate,
	b: TikzCoordinate,
	filled: boolean,
): number {
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);

	const outside = Math.hypot(
		Math.max(minX - p.x, 0, p.x - maxX),
		Math.max(minY - p.y, 0, p.y - maxY),
	);
	if (filled || outside > 0) {
		return outside;
	}

	return Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y);
}

function distanceToShape(shape: TikzShape, p: TikzCoordinate): number {
	switch (shape.kind) {
		case 'point':
			return Math.max(0, Math.hypot(p.x - shape.at.x, p.y - shape.at.y) - ANCHOR_RADIUS_CM);
		case 'segment':
			return distanceToSegment(p, shape.a, shape.b);
		case 'rect':
			return distanceToRect(p, shape.a, shape.b, shape.filled);
		case 'circle': {
			const distance = Math.hypot(p.x - shape.center.x, p.y - shape.center.y);
			return shape.filled
				? Math.max(0, distance - shape.radius)
				: Math.abs(distance - shape.radius);
		}
	}
}

export function distanceToStatement(statement: TikzStatement, p: TikzCoordinate): number {
	let best = Number.POSITIVE_INFINITY;
	for (const shape of statement.shapes) {
		best = Math.min(best, distanceToShape(shape, p));
		if (best === 0) {
			return 0;
		}
	}
	return best;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

function lineIndexAt(lineStarts: number[], offset: number): number {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (lineStarts[mid] <= offset) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return low;
}

function shapeBounds(statements: TikzStatement[]): TikzGeometryMap['bounds'] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	const include = (point: TikzCoordinate, pad = 0) => {
		minX = Math.min(minX, point.x - pad);
		minY = Math.min(minY, point.y - pad);
		maxX = Math.max(maxX, point.x + pad);
		maxY = Math.max(maxY, point.y + pad);
	};

	for (const statement of statements) {
		for (const shape of statement.shapes) {
			switch (shape.kind) {
				case 'point':
					include(shape.at);
					break;
				case 'segment':
				case 'rect':
					include(shape.a);
					include(shape.b);
					break;
				case 'circle':
					include(shape.center, shape.radius);
					break;
			}
		}
	}

	if (!Number.isFinite(minX)) {
		return null;
	}
	return { minX, minY, maxX, maxY };
}

/** Parse the drawing statements of a TikZ block body into hoverable geometry. */
export function buildTikzGeometryMap(blockSource: string): TikzGeometryMap {
	const scale = parsePictureScale(blockSource);

	const lineStarts = [0];
	for (let index = 0; index < blockSource.length; index++) {
		if (blockSource[index] === '\n') {
			lineStarts.push(index + 1);
		}
	}

	const statements: TikzStatement[] = [];
	for (const raw of scanStatements(blockSource)) {
		const body = blockSource.slice(raw.from, raw.to);
		const shapes = parseShapes(raw.command, body, scale);
		if (!shapes.length) {
			continue;
		}
		statements.push({
			startLine: lineIndexAt(lineStarts, raw.from),
			endLine: lineIndexAt(lineStarts, Math.max(raw.from, raw.to - 1)),
			shapes,
		});
	}

	return { statements, bounds: shapeBounds(statements) };
}

/**
 * Sanity check that the parsed geometry lands where the compiled picture did.
 * Guards against transforms this parser does not model (scoped `scale`, shifts,
 * changed `x`/`y` unit vectors) silently highlighting the wrong statement.
 */
export function geometryFitsPicture(
	map: TikzGeometryMap,
	picture: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
	if (!map.bounds) {
		return false;
	}
	const tolerance = Math.max(picture.maxX - picture.minX, picture.maxY - picture.minY) * 0.6 + 0.5;
	const dx = (map.bounds.minX + map.bounds.maxX) / 2 - (picture.minX + picture.maxX) / 2;
	const dy = (map.bounds.minY + map.bounds.maxY) / 2 - (picture.minY + picture.maxY) / 2;
	return Math.hypot(dx, dy) <= tolerance;
}

/** Closest statement to `point`, or null when nothing is within `toleranceCm`. */
export function findStatementAt(
	map: TikzGeometryMap,
	point: TikzCoordinate,
	toleranceCm: number,
): TikzStatement | null {
	let best: TikzStatement | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const statement of map.statements) {
		const distance = distanceToStatement(statement, point);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = statement;
		}
	}

	return bestDistance <= toleranceCm ? best : null;
}
