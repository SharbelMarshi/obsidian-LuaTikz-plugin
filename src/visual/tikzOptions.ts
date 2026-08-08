import { TIKZ_COLOR_NAMES } from './tikzColors';
import type { DashStyle, ObjectStyle } from './sceneTypes';

/**
 * Lossless handling of TikZ option lists (`[...]` contents).
 *
 * Options are split into top-level comma tokens; style edits replace or insert
 * individual tokens and leave every unrecognized token untouched and in
 * order, so custom user styles (`my style`, `decorate`, …) survive round
 * trips through the visual editor.
 */

export interface OptionToken {
	text: string;
	/** Offsets within the options text. */
	from: number;
	to: number;
}

/** Split at top-level commas, respecting `{}`, `[]`, and `()` nesting. */
export function splitOptionTokens(options: string): OptionToken[] {
	const tokens: OptionToken[] = [];
	let depth = 0;
	let start = 0;

	const push = (from: number, to: number) => {
		const text = options.slice(from, to);
		const trimmedStart = from + (text.length - text.trimStart().length);
		const trimmedEnd = to - (text.length - text.trimEnd().length);
		if (trimmedEnd > trimmedStart) {
			tokens.push({
				text: options.slice(trimmedStart, trimmedEnd),
				from: trimmedStart,
				to: trimmedEnd,
			});
		}
	};

	for (let index = 0; index < options.length; index++) {
		const char = options[index];
		if (char === '{' || char === '[' || char === '(') {
			depth++;
		} else if (char === '}' || char === ']' || char === ')') {
			depth = Math.max(0, depth - 1);
		} else if (char === ',' && depth === 0) {
			push(start, index);
			start = index + 1;
		}
	}
	push(start, options.length);
	return tokens;
}

const ARROW_TOKEN_RE = /^(?:[<>|o*[\]]|latex|stealth|to)*\s*-\s*(?:[<>|o*[\]]|latex|stealth|to)*$/i;
const LINE_WIDTH_TOKENS = new Set([
	'ultra thin', 'very thin', 'thin', 'semithick', 'thick', 'very thick', 'ultra thick',
]);
const DASH_TOKENS = new Set([
	'dashed', 'dotted', 'densely dashed', 'densely dotted', 'loosely dashed',
	'loosely dotted', 'solid',
]);

export { TIKZ_COLOR_NAMES } from './tikzColors';

const COLOR_NAME_SET = new Set<string>(TIKZ_COLOR_NAMES);

function isColorExpression(token: string): boolean {
	const [base] = token.split('!');
	return COLOR_NAME_SET.has(base.trim());
}

function isArrowToken(token: string): boolean {
	return token.includes('-') && !token.includes('=') && ARROW_TOKEN_RE.test(token);
}

export interface ParsedOptionStyle extends ObjectStyle {
	/** Raw arrow token when it is one this editor cannot regenerate (`-latex`). */
	rawArrowToken?: string;
}

function keyValue(token: string): { key: string; value: string } | null {
	const eq = token.indexOf('=');
	if (eq < 0) {
		return null;
	}
	return { key: token.slice(0, eq).trim(), value: token.slice(eq + 1).trim() };
}

/** Extract the style attributes this editor's UI understands. */
export function parseOptionStyle(options: string): ParsedOptionStyle {
	const style: ParsedOptionStyle = {};
	for (const token of splitOptionTokens(options)) {
		const text = token.text;
		const kv = keyValue(text);
		if (kv) {
			switch (kv.key) {
				case 'color':
				case 'draw':
					if (kv.value) {
						style.strokeColor = kv.value;
					}
					break;
				case 'fill':
					style.fillColor = kv.value;
					break;
				case 'opacity':
					style.opacity = Number.parseFloat(kv.value);
					break;
				case 'anchor':
					style.anchor = kv.value;
					break;
			}
			continue;
		}
		if (isArrowToken(text)) {
			if (text === '->' || text === '<-' || text === '<->' || text === '-') {
				style.arrows = text === '-' ? '' : text;
			} else {
				style.rawArrowToken = text;
			}
			continue;
		}
		if (LINE_WIDTH_TOKENS.has(text)) {
			style.lineWidth = text === 'thin' ? 'thin'
				: text === 'thick' ? 'thick'
					: text === 'very thick' ? 'very thick'
						: 'default';
			continue;
		}
		if (DASH_TOKENS.has(text)) {
			style.dash = text.includes('dashed') ? 'dashed'
				: text.includes('dotted') ? 'dotted'
					: 'solid';
			continue;
		}
		if (text === 'rounded corners' || text.startsWith('rounded corners=')) {
			style.roundedCorners = true;
			continue;
		}
		if (text === 'fill') {
			style.fillColor = 'black';
			continue;
		}
		if (isColorExpression(text)) {
			style.strokeColor = text;
		}
	}
	return style;
}

export interface StyleEdit {
	strokeColor?: string | null;
	fillColor?: string | null;
	lineWidth?: ObjectStyle['lineWidth'] | null;
	dash?: DashStyle | null;
	arrows?: ObjectStyle['arrows'] | null;
	opacity?: number | null;
	roundedCorners?: boolean | null;
	anchor?: string | null;
	fontSize?: ObjectStyle['fontSize'] | null;
}

type TokenClass =
	| 'arrow' | 'lineWidth' | 'dash' | 'stroke' | 'fill' | 'opacity'
	| 'rounded' | 'anchor' | 'fontSize' | 'other';

function classifyToken(text: string): TokenClass {
	const kv = keyValue(text);
	if (kv) {
		if (kv.key === 'color' || kv.key === 'draw') {
			return 'stroke';
		}
		if (kv.key === 'fill') {
			return 'fill';
		}
		if (kv.key === 'opacity') {
			return 'opacity';
		}
		if (kv.key === 'anchor') {
			return 'anchor';
		}
		if (kv.key === 'rounded corners') {
			return 'rounded';
		}
		if (kv.key === 'font') {
			return 'fontSize';
		}
		return 'other';
	}
	if (isArrowToken(text)) {
		return 'arrow';
	}
	if (LINE_WIDTH_TOKENS.has(text)) {
		return 'lineWidth';
	}
	if (DASH_TOKENS.has(text)) {
		return 'dash';
	}
	if (text === 'rounded corners') {
		return 'rounded';
	}
	if (text === 'fill') {
		return 'fill';
	}
	if (isColorExpression(text)) {
		return 'stroke';
	}
	return 'other';
}

const FONT_SIZE_COMMANDS: Record<'small' | 'normal' | 'large', string> = {
	small: '\\small',
	normal: '\\normalsize',
	large: '\\large',
};

function editTokens(edit: StyleEdit): Array<{ cls: TokenClass; token: string | null }> {
	const out: Array<{ cls: TokenClass; token: string | null }> = [];
	if (edit.arrows !== undefined) {
		out.push({ cls: 'arrow', token: edit.arrows ? edit.arrows : null });
	}
	if (edit.lineWidth !== undefined) {
		out.push({
			cls: 'lineWidth',
			token: edit.lineWidth && edit.lineWidth !== 'default' ? edit.lineWidth : null,
		});
	}
	if (edit.dash !== undefined) {
		out.push({ cls: 'dash', token: edit.dash && edit.dash !== 'solid' ? edit.dash : null });
	}
	if (edit.strokeColor !== undefined) {
		// Named colors and mixes work as bare tokens; anything else (inline
		// xcolor RGB expressions) must be written as `draw=…` to stay valid.
		const stroke = edit.strokeColor
			? (edit.strokeColor.startsWith('{') ? `draw=${edit.strokeColor}` : edit.strokeColor)
			: null;
		out.push({ cls: 'stroke', token: stroke });
	}
	if (edit.fillColor !== undefined) {
		out.push({ cls: 'fill', token: edit.fillColor ? `fill=${edit.fillColor}` : null });
	}
	if (edit.opacity !== undefined) {
		out.push({
			cls: 'opacity',
			token: edit.opacity !== null && edit.opacity < 1 ? `opacity=${edit.opacity}` : null,
		});
	}
	if (edit.roundedCorners !== undefined) {
		out.push({ cls: 'rounded', token: edit.roundedCorners ? 'rounded corners' : null });
	}
	if (edit.anchor !== undefined) {
		out.push({ cls: 'anchor', token: edit.anchor ? `anchor=${edit.anchor}` : null });
	}
	if (edit.fontSize !== undefined) {
		out.push({
			cls: 'fontSize',
			token: edit.fontSize === 'small' || edit.fontSize === 'large'
				? `font=${FONT_SIZE_COMMANDS[edit.fontSize]}`
				: null,
		});
	}
	return out;
}

/**
 * Apply a style edit to an options string, replacing recognized tokens in
 * place and appending new ones, while preserving unknown tokens verbatim.
 */
export function applyStyleEdit(options: string, edit: StyleEdit): string {
	const edits = editTokens(edit);
	if (!edits.length) {
		return options;
	}

	const tokens = splitOptionTokens(options);
	const replacedClasses = new Set<TokenClass>();
	const result: string[] = [];

	for (const token of tokens) {
		const cls = classifyToken(token.text);
		const pending = edits.find(entry => entry.cls === cls);
		if (!pending) {
			result.push(token.text);
			continue;
		}
		if (!replacedClasses.has(cls)) {
			replacedClasses.add(cls);
			if (pending.token !== null) {
				result.push(pending.token);
			}
			continue;
		}
		// A second token of the same class (e.g. `red, draw=blue`) is dropped so
		// the edit has one unambiguous winner.
	}

	for (const pending of edits) {
		if (!replacedClasses.has(pending.cls) && pending.token !== null) {
			result.push(pending.token);
		}
	}

	return result.join(', ');
}
