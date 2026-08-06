/**
 * Lightweight TikZ syntax highlighting for the Edit-mode source panel.
 *
 * The panel keeps its plain `<textarea>` for input (reliable on mobile and
 * inside Obsidian) and paints colors on a mirrored `<pre>` behind it, so this
 * module only needs to turn source text into escaped, classed HTML. Ranges —
 * the statement spans of hovered/selected canvas objects — are woven into the
 * same output by splitting tokens at range boundaries.
 */

export type TikzTokenClass =
	| 'comment' | 'command' | 'number' | 'bracket' | 'brace' | 'operator' | 'keyword';

export interface TikzToken {
	text: string;
	cls: TikzTokenClass | null;
	from: number;
	to: number;
}

const COMMAND_RE = /^\\(?:[a-zA-Z@]+\*?|.)/;
const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:pt|cm|mm|in|em|ex|bp)?/;
const OPERATOR_RE = /^(?:--|\.\.|\|-|-\||<->|->|<-|[;:,=|\-+])/;
const WORD_RE = /^[a-zA-Z]+/;

/** Path operators and structure words worth tinting. */
const KEYWORDS = new Set([
	'rectangle', 'circle', 'ellipse', 'arc', 'grid', 'cycle', 'controls',
	'and', 'node', 'coordinate', 'at', 'to', 'edge', 'plot', 'in', 'foreach',
	'cos', 'sin', 'radius', 'angle', 'start', 'end',
]);

export function tokenizeTikz(source: string): TikzToken[] {
	const tokens: TikzToken[] = [];
	let index = 0;

	const push = (length: number, cls: TikzTokenClass | null) => {
		tokens.push({
			text: source.slice(index, index + length),
			cls,
			from: index,
			to: index + length,
		});
		index += length;
	};

	while (index < source.length) {
		const rest = source.slice(index);
		const char = source[index];

		if (char === '%' && source[index - 1] !== '\\') {
			const newline = source.indexOf('\n', index);
			push((newline < 0 ? source.length : newline) - index, 'comment');
			continue;
		}
		if (char === '\\') {
			const match = COMMAND_RE.exec(rest);
			push(match ? match[0].length : 1, 'command');
			continue;
		}
		if (
			(char >= '0' && char <= '9')
			|| ((char === '-' || char === '.') && /\d/.test(source[index + 1] ?? ''))
		) {
			const match = NUMBER_RE.exec(rest);
			if (match) {
				push(match[0].length, 'number');
				continue;
			}
		}
		if (char === '[' || char === ']' || char === '(' || char === ')') {
			push(1, 'bracket');
			continue;
		}
		if (char === '{' || char === '}') {
			push(1, 'brace');
			continue;
		}
		const operator = OPERATOR_RE.exec(rest);
		if (operator) {
			push(operator[0].length, 'operator');
			continue;
		}
		const word = WORD_RE.exec(rest);
		if (word) {
			push(word[0].length, KEYWORDS.has(word[0]) ? 'keyword' : null);
			continue;
		}
		push(1, null);
	}

	return tokens;
}

export interface HighlightRange {
	from: number;
	to: number;
	/** Extra CSS class applied across the range (hover/selection tint). */
	cls: string;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escaped, classed HTML for the mirror layer. */
export function buildHighlightHtml(
	source: string,
	ranges: readonly HighlightRange[] = [],
): string {
	const bounds: number[] = [];
	for (const range of ranges) {
		bounds.push(range.from, range.to);
	}
	bounds.sort((a, b) => a - b);

	const parts: string[] = [];
	for (const token of tokenizeTikz(source)) {
		const cuts = [token.from];
		for (const bound of bounds) {
			if (bound > token.from && bound < token.to) {
				cuts.push(bound);
			}
		}
		cuts.push(token.to);

		for (let cut = 0; cut < cuts.length - 1; cut++) {
			const from = cuts[cut];
			const to = cuts[cut + 1];
			if (to <= from) {
				continue;
			}
			const classes: string[] = [];
			if (token.cls) {
				classes.push(`luatikz-tzk-${token.cls}`);
			}
			for (const range of ranges) {
				if (from >= range.from && to <= range.to) {
					classes.push(range.cls);
				}
			}
			const text = escapeHtml(source.slice(from, to));
			parts.push(classes.length
				? `<span class="${classes.join(' ')}">${text}</span>`
				: text);
		}
	}
	return parts.join('');
}
