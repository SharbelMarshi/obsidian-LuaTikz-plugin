import { parsePictureScale, parseLengthCm } from '../latex/tikzStatementGeometry';
import type {
	CoordinatePrefix,
	CoordinateToken,
	LengthToken,
	NumberToken,
	PathElement,
	SceneDiagnostic,
	SceneLockedObject,
	SceneNodeObject,
	SceneObject,
	ScenePathObject,
	ScenePicture,
	SourceSpan,
	TikzScene,
} from './sceneTypes';

/**
 * Structural parser for the visual editor.
 *
 * Turns a fence body into a {@link TikzScene}: pictures, statements, and —
 * for the subset of TikZ this editor can safely round-trip — full token spans
 * for every coordinate, radius, and angle so edits patch only those characters
 * and never reformat surrounding source.
 *
 * The guiding rule is "lock, don't guess": any statement containing syntax
 * outside the supported subset is preserved verbatim as a locked object. The
 * lossless span/patch approach follows the tikz-editor project by Dominik
 * Peters (MIT; see THIRD-PARTY-NOTICES.md), with the heavyweight Lezer CST
 * replaced by a focused statement-level scanner in the style of
 * tikzStatementGeometry.ts.
 */

/** Path-producing commands whose statements this editor may edit. */
const EDITABLE_PATH_COMMANDS = new Set(['draw', 'fill', 'filldraw', 'path']);

/** Statement commands recognized by the scanner (superset of editable). */
const STATEMENT_COMMANDS = new Set([
	'draw', 'path', 'fill', 'filldraw', 'shade', 'shadedraw', 'pattern',
	'node', 'coordinate', 'pic', 'clip', 'graph', 'datavisualization',
	'useasboundingbox',
]);

/** Picture options that make coordinate mapping unreliable → lock the picture. */
const LOCKING_PICTURE_OPTION_RE =
	/(?:^|[,\s])(?:rotate|shift|xshift|yshift|xslant|yslant|cm=|x=|y=|z=|transform)/;

const BEGIN_PICTURE_RE = /\\begin\s*\{tikzpicture\}/g;

interface RawStatement {
	command: string | null;
	from: number;
	to: number;
	/** True when the statement lives inside a scope/nested environment. */
	inScope: boolean;
}

function isCommentStart(source: string, index: number): boolean {
	return source[index] === '%' && (index === 0 || source[index - 1] !== '\\');
}

function skipComment(source: string, index: number): number {
	let cursor = index;
	while (cursor < source.length && source[cursor] !== '\n') {
		cursor++;
	}
	return cursor;
}

function skipWhitespaceAndComments(source: string, index: number, end: number): number {
	let cursor = index;
	while (cursor < end) {
		const char = source[cursor];
		if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
			cursor++;
			continue;
		}
		if (isCommentStart(source, cursor)) {
			cursor = skipComment(source, cursor);
			continue;
		}
		break;
	}
	return cursor;
}

/** Index just past the `;` ending the statement, brace/bracket aware. */
function scanToSemicolon(source: string, index: number, end: number): number {
	let depth = 0;
	let cursor = index;
	while (cursor < end) {
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
	return end;
}

/** Index just past a balanced group opened by the bracket at `index`. */
function scanBalancedGroup(source: string, index: number, end: number): number {
	const open = source[index];
	const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : null;
	if (!close) {
		return index;
	}
	let depth = 0;
	let cursor = index;
	while (cursor < end) {
		if (isCommentStart(source, cursor)) {
			cursor = skipComment(source, cursor);
			continue;
		}
		const char = source[cursor];
		if (char === '\\') {
			cursor += 2;
			continue;
		}
		if (char === open) {
			depth++;
		} else if (char === close) {
			depth--;
			if (depth === 0) {
				return cursor + 1;
			}
		}
		cursor++;
	}
	return end;
}

/**
 * End of a `\foreach` statement. Handles both the `\foreach … \draw …;` form
 * (ends at the depth-0 semicolon) and the braced-body form
 * `\foreach … { …; …; }` where no trailing semicolon exists.
 */
function scanForeach(source: string, index: number, end: number): number {
	let cursor = index;
	let lastGroupEnd = -1;
	while (cursor < end) {
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
			cursor = scanBalancedGroup(source, cursor, end);
			lastGroupEnd = cursor;
			continue;
		}
		if (char === ';') {
			return cursor + 1;
		}
		if (char === '\n' && lastGroupEnd > 0) {
			// A braced body already closed and the line ended without `;`.
			const rest = source.slice(lastGroupEnd, cursor).trim();
			if (!rest) {
				return lastGroupEnd;
			}
		}
		cursor++;
	}
	return lastGroupEnd > 0 ? lastGroupEnd : end;
}

/**
 * Scan the statements between `from` and `to`. Scope environments are entered
 * (their statements are found) but everything inside is flagged `inScope`.
 */
function scanStatements(source: string, from: number, to: number): RawStatement[] {
	const statements: RawStatement[] = [];
	let cursor = from;
	let scopeDepth = 0;

	while (cursor < to) {
		if (isCommentStart(source, cursor)) {
			cursor = skipComment(source, cursor);
			continue;
		}
		if (source[cursor] !== '\\') {
			cursor++;
			continue;
		}

		const rest = source.slice(cursor, Math.min(cursor + 64, to));
		const beginScope = /^\\begin\s*\{scope\}/.exec(rest);
		if (beginScope) {
			scopeDepth++;
			cursor += beginScope[0].length;
			continue;
		}
		const endScope = /^\\end\s*\{scope\}/.exec(rest);
		if (endScope) {
			scopeDepth = Math.max(0, scopeDepth - 1);
			cursor += endScope[0].length;
			continue;
		}
		const beginOther = /^\\begin\s*\{([a-zA-Z*]+)\}/.exec(rest);
		if (beginOther) {
			// A nested non-scope environment (axis, …) is one locked statement.
			const envName = beginOther[1].replace(/\*/g, '\\*');
			const endRe = new RegExp(`\\\\end\\s*\\{${envName}\\}`);
			const endMatch = endRe.exec(source.slice(cursor, to));
			const stmtEnd = endMatch ? cursor + endMatch.index + endMatch[0].length : to;
			statements.push({ command: `env:${beginOther[1]}`, from: cursor, to: stmtEnd, inScope: scopeDepth > 0 });
			cursor = stmtEnd;
			continue;
		}

		const match = /^\\([a-zA-Z@]+)/.exec(rest);
		if (!match) {
			cursor += 2;
			continue;
		}
		const command = match[1];

		if (command === 'foreach') {
			const stmtEnd = scanForeach(source, cursor + match[0].length, to);
			statements.push({ command, from: cursor, to: stmtEnd, inScope: scopeDepth > 0 });
			cursor = stmtEnd;
			continue;
		}

		if (STATEMENT_COMMANDS.has(command)) {
			const stmtEnd = scanToSemicolon(source, cursor + match[0].length, to);
			statements.push({ command, from: cursor, to: stmtEnd, inScope: scopeDepth > 0 });
			cursor = stmtEnd;
			continue;
		}

		// Unknown command (\tikzset, \def, …): consume its balanced argument
		// groups so a `;` inside them never starts a bogus statement, but do
		// not model it — untouched source is preserved implicitly.
		cursor += match[0].length;
		let guard = 0;
		while (cursor < to && guard++ < 64) {
			const next = skipWhitespaceAndComments(source, cursor, to);
			const char = source[next];
			if (char === '{' || char === '[') {
				cursor = scanBalancedGroup(source, next, to);
				continue;
			}
			if (char === '=') {
				cursor = next + 1;
				continue;
			}
			if (char === ';') {
				cursor = next + 1;
			}
			break;
		}
	}

	return statements;
}

/* -------------------------------------------------------------------------- */
/* token parsing                                                               */
/* -------------------------------------------------------------------------- */

const NUMBER_RE = /^-?\d*\.?\d+/;

class TokenReader {
	cursor: number;

	constructor(
		readonly source: string,
		from: number,
		readonly end: number,
	) {
		this.cursor = from;
	}

	skipTrivia(): void {
		this.cursor = skipWhitespaceAndComments(this.source, this.cursor, this.end);
	}

	peek(): string {
		return this.source[this.cursor] ?? '';
	}

	/** Try to consume a literal string at the cursor. */
	eat(literal: string): boolean {
		if (this.source.startsWith(literal, this.cursor)) {
			this.cursor += literal.length;
			return true;
		}
		return false;
	}

	/** Try to consume a whole word (keyword followed by a non-letter). */
	eatWord(word: string): boolean {
		if (!this.source.startsWith(word, this.cursor)) {
			return false;
		}
		const after = this.source[this.cursor + word.length] ?? '';
		if (/[a-zA-Z]/.test(after)) {
			return false;
		}
		this.cursor += word.length;
		return true;
	}
}

/** Parse `(x, y)` with optional `+`/`++` prefix at the reader cursor. */
function readCoordinate(reader: TokenReader): Omit<CoordinateToken, 'resolved'> | null {
	reader.skipTrivia();
	const prefixFrom = reader.cursor;
	let prefix: CoordinatePrefix = '';
	if (reader.eat('++')) {
		prefix = '++';
	} else if (reader.eat('+')) {
		prefix = '+';
	}
	reader.skipTrivia();
	const parenFrom = reader.cursor;
	if (!reader.eat('(')) {
		return null;
	}
	const closeIndex = reader.source.indexOf(')', reader.cursor);
	if (closeIndex < 0 || closeIndex >= reader.end) {
		return null;
	}
	const inner = reader.source.slice(reader.cursor, closeIndex);
	const match = /^\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*$/.exec(inner);
	if (!match) {
		return null;
	}
	const x = Number.parseFloat(match[1]);
	const y = Number.parseFloat(match[2]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	reader.cursor = closeIndex + 1;
	return {
		span: { from: parenFrom, to: reader.cursor },
		prefixSpan: { from: prefixFrom, to: prefixFrom + prefix.length },
		prefix,
		x,
		y,
	};
}

/** Parse a number literal, returning its span. */
function readNumber(reader: TokenReader): NumberToken | null {
	reader.skipTrivia();
	const match = NUMBER_RE.exec(reader.source.slice(reader.cursor, reader.end));
	if (!match) {
		return null;
	}
	const value = Number.parseFloat(match[0]);
	if (!Number.isFinite(value)) {
		return null;
	}
	const token: NumberToken = {
		valueSpan: { from: reader.cursor, to: reader.cursor + match[0].length },
		value,
	};
	reader.cursor += match[0].length;
	return token;
}

/** Parse a length literal (`1`, `2.5cm`, `4pt`), keeping the unit out of the span. */
function readLength(reader: TokenReader): LengthToken | null {
	const num = readNumber(reader);
	if (!num) {
		return null;
	}
	const unitMatch = /^[a-z]{0,2}/.exec(reader.source.slice(reader.cursor, reader.end));
	const unit = unitMatch ? unitMatch[0] : '';
	const cm = parseLengthCm(`${num.value}${unit}`);
	if (cm === null) {
		return null;
	}
	reader.cursor += unit.length;
	return { valueSpan: num.valueSpan, value: num.value, unit, cm };
}

interface KeyedLength {
	key: string;
	token: LengthToken;
}

/**
 * Parse the bracket arguments of `circle[...]` / `ellipse[...]` / `arc[...]`.
 * Only `radius`, `x radius`, `y radius`, `start angle`, `end angle` with plain
 * numeric values are supported; anything else fails the parse (→ locked).
 */
function readBracketArgs(
	reader: TokenReader,
): { lengths: KeyedLength[]; numbers: Array<{ key: string; token: NumberToken }>; to: number } | null {
	reader.skipTrivia();
	if (!reader.eat('[')) {
		return null;
	}
	const lengths: KeyedLength[] = [];
	const numbers: Array<{ key: string; token: NumberToken }> = [];
	for (; ;) {
		reader.skipTrivia();
		const keyMatch = /^([a-z ]+?)\s*=\s*/.exec(reader.source.slice(reader.cursor, reader.end));
		if (!keyMatch) {
			return null;
		}
		const key = keyMatch[1].trim();
		reader.cursor += keyMatch[0].length;
		if (key === 'radius' || key === 'x radius' || key === 'y radius') {
			const token = readLength(reader);
			if (!token) {
				return null;
			}
			lengths.push({ key, token });
		} else if (key === 'start angle' || key === 'end angle' || key === 'delta angle') {
			const token = readNumber(reader);
			if (!token) {
				return null;
			}
			numbers.push({ key, token });
		} else {
			return null;
		}
		reader.skipTrivia();
		if (reader.eat(',')) {
			continue;
		}
		if (reader.eat(']')) {
			return { lengths, numbers, to: reader.cursor };
		}
		return null;
	}
}

interface ParsedPath {
	elements: PathElement[];
}

/**
 * Parse the path expression of a statement body (after command + options).
 * Returns null when any token falls outside the supported subset.
 */
function parsePathExpression(
	source: string,
	from: number,
	end: number,
): ParsedPath | null {
	const reader = new TokenReader(source, from, end);
	const elements: PathElement[] = [];

	for (; ;) {
		reader.skipTrivia();
		if (reader.cursor >= end) {
			break;
		}
		const char = reader.peek();

		if (char === ';') {
			reader.cursor++;
			break;
		}

		if (char === '(' || char === '+') {
			const coord = readCoordinate(reader);
			if (!coord) {
				return null;
			}
			elements.push({ kind: 'coord', coord: { ...coord, resolved: { x: 0, y: 0 } } });
			continue;
		}

		if (reader.eat('--')) {
			reader.skipTrivia();
			// `-|` / `|-` style corners spelled as `--` never occur; but the
			// plain `--` may be followed by `cycle`, handled in the next loop turn.
			elements.push({ kind: 'lineTo' });
			continue;
		}
		if (reader.eat('-|')) {
			elements.push({ kind: 'hvTo' });
			continue;
		}
		if (reader.eat('|-')) {
			elements.push({ kind: 'vhTo' });
			continue;
		}

		if (reader.eat('..')) {
			reader.skipTrivia();
			if (!reader.eatWord('controls')) {
				return null;
			}
			const c1 = readCoordinate(reader);
			if (!c1) {
				return null;
			}
			reader.skipTrivia();
			let c2: Omit<CoordinateToken, 'resolved'> | null = null;
			if (reader.eatWord('and')) {
				c2 = readCoordinate(reader);
				if (!c2) {
					return null;
				}
			}
			reader.skipTrivia();
			if (!reader.eat('..')) {
				return null;
			}
			elements.push({
				kind: 'curveTo',
				c1: { ...c1, resolved: { x: 0, y: 0 } },
				c2: c2 ? { ...c2, resolved: { x: 0, y: 0 } } : null,
			});
			continue;
		}

		if (reader.eatWord('rectangle')) {
			elements.push({ kind: 'rectangleTo' });
			continue;
		}

		if (reader.eatWord('grid')) {
			reader.skipTrivia();
			let optionsSpan: SourceSpan | null = null;
			if (reader.peek() === '[') {
				const optFrom = reader.cursor;
				const optTo = scanBalancedGroup(source, reader.cursor, end);
				optionsSpan = { from: optFrom, to: optTo };
				reader.cursor = optTo;
			}
			elements.push({ kind: 'gridTo', optionsSpan });
			continue;
		}

		const circleOpFrom = reader.cursor;
		if (reader.eatWord('circle') || reader.eatWord('ellipse')) {
			const opFrom = circleOpFrom;
			reader.skipTrivia();
			if (reader.peek() === '[') {
				const args = readBracketArgs(reader);
				if (!args || args.numbers.length) {
					return null;
				}
				const radius = args.lengths.find(entry => entry.key === 'radius' || entry.key === 'x radius');
				const yRadius = args.lengths.find(entry => entry.key === 'y radius');
				if (!radius) {
					return null;
				}
				elements.push({
					kind: 'circle',
					radius: radius.token,
					yRadius: yRadius ? yRadius.token : null,
					span: { from: opFrom, to: reader.cursor },
				});
				continue;
			}
			if (reader.eat('(')) {
				// Legacy `circle (1cm)` / `ellipse (1 and 0.5)`.
				const r1 = readLength(reader);
				if (!r1) {
					return null;
				}
				reader.skipTrivia();
				let r2: LengthToken | null = null;
				if (reader.eatWord('and')) {
					r2 = readLength(reader);
					if (!r2) {
						return null;
					}
					reader.skipTrivia();
				}
				if (!reader.eat(')')) {
					return null;
				}
				elements.push({
					kind: 'circle',
					radius: r1,
					yRadius: r2,
					span: { from: opFrom, to: reader.cursor },
				});
				continue;
			}
			return null;
		}

		const arcOpFrom = reader.cursor;
		if (reader.eatWord('arc')) {
			const opFrom = arcOpFrom;
			reader.skipTrivia();
			if (reader.peek() === '[') {
				const args = readBracketArgs(reader);
				if (!args) {
					return null;
				}
				const radius = args.lengths.find(entry => entry.key === 'radius' || entry.key === 'x radius');
				const start = args.numbers.find(entry => entry.key === 'start angle');
				const endAngle = args.numbers.find(entry => entry.key === 'end angle');
				if (!radius || !start || !endAngle || args.numbers.some(entry => entry.key === 'delta angle')) {
					return null;
				}
				elements.push({
					kind: 'arc',
					startAngle: start.token,
					endAngle: endAngle.token,
					radius: radius.token,
					span: { from: opFrom, to: reader.cursor },
				});
				continue;
			}
			if (reader.eat('(')) {
				// Legacy `arc (start:end:radius)`.
				const start = readNumber(reader);
				if (!start) {
					return null;
				}
				reader.skipTrivia();
				if (!reader.eat(':')) {
					return null;
				}
				const endAngle = readNumber(reader);
				if (!endAngle) {
					return null;
				}
				reader.skipTrivia();
				if (!reader.eat(':')) {
					return null;
				}
				const radius = readLength(reader);
				if (!radius) {
					return null;
				}
				reader.skipTrivia();
				if (!reader.eat(')')) {
					return null;
				}
				elements.push({
					kind: 'arc',
					startAngle: start,
					endAngle,
					radius,
					span: { from: opFrom, to: reader.cursor },
				});
				continue;
			}
			return null;
		}

		if (reader.eatWord('cycle')) {
			elements.push({ kind: 'cycle' });
			continue;
		}

		if (reader.eatWord('node')) {
			// Inline node: preserved verbatim. Consume [opts], (name), {text}.
			const rawFrom = reader.cursor - 4;
			let guard = 0;
			let sawBody = false;
			while (guard++ < 8) {
				reader.skipTrivia();
				const next = reader.peek();
				if (next === '[' || next === '(') {
					reader.cursor = scanBalancedGroup(source, reader.cursor, end);
					continue;
				}
				if (next === '{') {
					reader.cursor = scanBalancedGroup(source, reader.cursor, end);
					sawBody = true;
					break;
				}
				const word = /^(?:at|midway|pos\s*=\s*[\d.]+|above|below|left|right)/.exec(
					source.slice(reader.cursor, end),
				);
				if (word) {
					reader.cursor += word[0].length;
					continue;
				}
				break;
			}
			if (!sawBody) {
				return null;
			}
			elements.push({ kind: 'raw', span: { from: rawFrom, to: reader.cursor } });
			continue;
		}

		// `to`, `edge`, `plot`, polar coordinates, named coordinates, calc, …
		return null;
	}

	// Resolve `+`/`++` chains into absolute positions.
	let pen = { x: 0, y: 0 };
	let sawCoord = false;
	for (const element of elements) {
		if (element.kind === 'coord') {
			const token = element.coord;
			if (token.prefix === '++') {
				token.resolved = { x: pen.x + token.x, y: pen.y + token.y };
				pen = token.resolved;
			} else if (token.prefix === '+') {
				token.resolved = { x: pen.x + token.x, y: pen.y + token.y };
			} else {
				token.resolved = { x: token.x, y: token.y };
				pen = token.resolved;
			}
			sawCoord = true;
		} else if (element.kind === 'curveTo') {
			// Control points are absolute or relative to the pen position
			// before the curve target.
			for (const control of [element.c1, element.c2]) {
				if (!control) {
					continue;
				}
				if (control.prefix === '+' || control.prefix === '++') {
					control.resolved = { x: pen.x + control.x, y: pen.y + control.y };
				} else {
					control.resolved = { x: control.x, y: control.y };
				}
			}
		}
	}
	if (!sawCoord) {
		return null;
	}

	const first = elements[0];
	if (first.kind !== 'coord' || first.coord.prefix !== '') {
		// A path must start at an absolute point for edits to be predictable.
		return null;
	}

	return { elements };
}

/* -------------------------------------------------------------------------- */
/* statement parsers                                                           */
/* -------------------------------------------------------------------------- */

/** Read the options `[...]` right after the statement command, if present. */
function readStatementOptions(
	source: string,
	from: number,
	end: number,
): { optionsSpan: SourceSpan | null; options: string; after: number } {
	const cursor = skipWhitespaceAndComments(source, from, end);
	if (source[cursor] !== '[') {
		return { optionsSpan: null, options: '', after: from };
	}
	const groupEnd = scanBalancedGroup(source, cursor, end);
	const optionsSpan = { from: cursor + 1, to: groupEnd - 1 };
	return {
		optionsSpan,
		options: source.slice(optionsSpan.from, optionsSpan.to),
		after: groupEnd,
	};
}

function parsePathStatement(
	source: string,
	raw: RawStatement,
	commandLength: number,
): ScenePathObject | null {
	const bodyFrom = raw.from + 1 + commandLength;
	const { optionsSpan, options, after } = readStatementOptions(source, bodyFrom, raw.to);
	const parsed = parsePathExpression(source, after === bodyFrom ? bodyFrom : after, raw.to);
	if (!parsed) {
		return null;
	}
	return {
		id: '',
		pictureIndex: 0,
		span: { from: raw.from, to: raw.to },
		type: 'path',
		command: raw.command ?? 'draw',
		optionsSpan,
		options,
		elements: parsed.elements,
	};
}

function parseNodeStatement(
	source: string,
	raw: RawStatement,
	commandLength: number,
): SceneNodeObject | null {
	const command = raw.command as 'node' | 'coordinate';
	const reader = new TokenReader(source, raw.from + 1 + commandLength, raw.to);

	let optionsSpan: SourceSpan | null = null;
	let options = '';
	let name: string | null = null;
	let at: Omit<CoordinateToken, 'resolved'> | null = null;

	let guard = 0;
	while (guard++ < 8) {
		reader.skipTrivia();
		const char = reader.peek();
		if (char === '[' && !optionsSpan) {
			const groupEnd = scanBalancedGroup(source, reader.cursor, raw.to);
			optionsSpan = { from: reader.cursor + 1, to: groupEnd - 1 };
			options = source.slice(optionsSpan.from, optionsSpan.to);
			reader.cursor = groupEnd;
			continue;
		}
		if (char === '(' && name === null && at === null) {
			const groupEnd = scanBalancedGroup(source, reader.cursor, raw.to);
			const inner = source.slice(reader.cursor + 1, groupEnd - 1);
			if (/^[a-zA-Z0-9 _:-]*$/.test(inner)) {
				name = inner;
				reader.cursor = groupEnd;
				continue;
			}
			return null;
		}
		if (reader.eatWord('at')) {
			at = readCoordinate(reader);
			if (!at || at.prefix !== '') {
				return null;
			}
			continue;
		}
		break;
	}

	if (!at) {
		return null;
	}

	reader.skipTrivia();
	let textSpan: SourceSpan | null = null;
	let text = '';
	if (command === 'node') {
		if (reader.peek() !== '{') {
			return null;
		}
		const groupEnd = scanBalancedGroup(source, reader.cursor, raw.to);
		textSpan = { from: reader.cursor + 1, to: groupEnd - 1 };
		text = source.slice(textSpan.from, textSpan.to);
		reader.cursor = groupEnd;
	}

	reader.skipTrivia();
	if (reader.peek() !== ';') {
		return null;
	}

	return {
		id: '',
		pictureIndex: 0,
		span: { from: raw.from, to: raw.to },
		type: 'node',
		command,
		optionsSpan,
		options,
		name,
		at: { ...at, resolved: { x: at.x, y: at.y } },
		textSpan,
		text,
	};
}

/* -------------------------------------------------------------------------- */
/* pictures                                                                    */
/* -------------------------------------------------------------------------- */

function scanPictures(source: string): ScenePicture[] {
	const pictures: ScenePicture[] = [];
	BEGIN_PICTURE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = BEGIN_PICTURE_RE.exec(source))) {
		let bodyFrom = match.index + match[0].length;
		const afterBegin = skipWhitespaceAndComments(source, bodyFrom, source.length);
		let optionsText = '';
		if (source[afterBegin] === '[') {
			const groupEnd = scanBalancedGroup(source, afterBegin, source.length);
			optionsText = source.slice(afterBegin + 1, groupEnd - 1);
			bodyFrom = groupEnd;
		}
		const endMatch = /\\end\s*\{tikzpicture\}/.exec(source.slice(bodyFrom));
		const bodyTo = endMatch ? bodyFrom + endMatch.index : source.length;

		// Rebuild a single-line begin so multi-line options still parse.
		const scale = parsePictureScale(
			`\\begin{tikzpicture}[${optionsText.replace(/\n/g, ' ')}]`,
		);
		const editable = !LOCKING_PICTURE_OPTION_RE.test(optionsText);
		pictures.push({
			index: pictures.length,
			bodyFrom,
			bodyTo,
			optionsText,
			scale,
			editable,
			implicit: false,
		});
		BEGIN_PICTURE_RE.lastIndex = bodyTo;
	}

	if (!pictures.length) {
		pictures.push({
			index: 0,
			bodyFrom: 0,
			bodyTo: source.length,
			optionsText: '',
			scale: { x: 1, y: 1 },
			editable: true,
			implicit: true,
		});
	}

	return pictures;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

const COMMAND_NAME_RE = /^\\([a-zA-Z@]+)/;

export function parseTikzScene(source: string): TikzScene {
	const pictures = scanPictures(source);
	const objects: SceneObject[] = [];
	const diagnostics: SceneDiagnostic[] = [];

	for (const picture of pictures) {
		const raws = scanStatements(source, picture.bodyFrom, picture.bodyTo);
		let statementIndex = 0;
		for (const raw of raws) {
			const id = `p${picture.index}:s${statementIndex++}`;
			const lock = (reason: string): SceneLockedObject => ({
				id,
				pictureIndex: picture.index,
				span: { from: raw.from, to: raw.to },
				type: 'locked',
				reason,
				command: raw.command,
			});

			if (!picture.editable) {
				objects.push(lock('picture uses transforms this editor cannot map'));
				continue;
			}
			if (raw.inScope) {
				objects.push(lock('inside a scope environment'));
				continue;
			}
			if (raw.command === 'foreach') {
				objects.push(lock('\\foreach loops are source-only'));
				continue;
			}
			if (raw.command?.startsWith('env:')) {
				objects.push(lock(`nested ${raw.command.slice(4)} environment`));
				continue;
			}

			const commandMatch = COMMAND_NAME_RE.exec(source.slice(raw.from));
			const commandLength = commandMatch ? commandMatch[1].length : 0;

			if (raw.command === 'node' || raw.command === 'coordinate') {
				const node = parseNodeStatement(source, raw, commandLength);
				if (node) {
					node.id = id;
					node.pictureIndex = picture.index;
					objects.push(node);
				} else {
					objects.push(lock('node syntax outside the supported subset'));
				}
				continue;
			}

			if (raw.command && EDITABLE_PATH_COMMANDS.has(raw.command)) {
				const path = parsePathStatement(source, raw, commandLength);
				if (path) {
					path.id = id;
					path.pictureIndex = picture.index;
					objects.push(path);
				} else {
					objects.push(lock('path syntax outside the supported subset'));
				}
				continue;
			}

			objects.push(lock(`\\${raw.command ?? '?'} statements are source-only`));
		}
	}

	const lockedCount = objects.filter(object => object.type === 'locked').length;
	if (lockedCount) {
		diagnostics.push({
			severity: 'info',
			message: `${lockedCount} statement${lockedCount === 1 ? '' : 's'} preserved as source-only (not visually editable).`,
			span: null,
		});
	}

	return { source, pictures, objects, diagnostics };
}

/** The picture that should receive newly drawn objects. */
export function insertionPicture(scene: TikzScene): ScenePicture {
	return scene.pictures[scene.pictures.length - 1];
}

/**
 * Offset + indentation for inserting a new statement at the end of a picture
 * body, matching the indentation of the statement above when there is one.
 */
export function statementInsertionPoint(
	scene: TikzScene,
	picture: ScenePicture,
): { offset: number; indent: string; needsLeadingNewline: boolean } {
	const objectsInPicture = scene.objects.filter(
		object => object.pictureIndex === picture.index,
	);
	const last = objectsInPicture[objectsInPicture.length - 1];

	let indent = '';
	if (last) {
		const lineStart = scene.source.lastIndexOf('\n', last.span.from - 1) + 1;
		const lineIndent = /^[ \t]*/.exec(scene.source.slice(lineStart, last.span.from));
		indent = lineIndent ? lineIndent[0] : '';
	}

	// Insert just before the line that carries \end{tikzpicture} (or at the
	// very end for implicit pictures), after the last existing newline.
	let offset = picture.bodyTo;
	const beforeEnd = scene.source.lastIndexOf('\n', Math.max(0, picture.bodyTo - 1));
	if (beforeEnd >= picture.bodyFrom) {
		const between = scene.source.slice(beforeEnd + 1, picture.bodyTo);
		if (!between.trim()) {
			offset = beforeEnd + 1;
			return { offset, indent, needsLeadingNewline: false };
		}
	}
	return { offset, indent, needsLeadingNewline: true };
}
