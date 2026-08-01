export type LatexAutofixKind =
	| 'append-semicolon'
	| 'append-closing-brace'
	| 'append-opening-brace'
	| 'append-math-delimiter'
	| 'wrap-in-math'
	| 'insert-end-tikzpicture'
	| 'fix-typo'
	| 'fill-option-value';

export interface LatexAutofix {
	kind: LatexAutofixKind;
	label: string;
	replacement?: string;
	optionKey?: string;
	optionValue?: string;
	/**
	 * Lines to move from the line LaTeX blamed to the line actually at fault,
	 * negative for earlier. TeX reports where it gave up, which for a missing
	 * `;` or `}` is usually one or more lines past the mistake. Resolved by
	 * formatLatexErrorWithLineMapping, so nothing downstream ever sees it.
	 */
	lineDelta?: number;
}

/** The render-source lines around the failure, for fixes that relocate. */
export interface LatexAutofixContext {
	lines: string[];
	/** 0-based index into `lines` of the line LaTeX blamed. */
	lineIndex: number;
}

/**
 * Path commands, which TikZ requires to end in `;`. Deliberately excludes
 * \begin and \end: an environment takes no semicolon, and treating
 * \begin{tikzpicture} as an unterminated statement offered to append a `;`
 * that breaks the picture.
 */
const TIKZ_STATEMENT_RE =
	/^\\(draw|path|fill|filldraw|shadedraw|node|coordinate|clip|shade|pic|matrix|useasboundingbox)\b/;

const ENVIRONMENT_BOUNDARY_RE = /^\\(begin|end)\b/;

interface TypoRule {
	test: RegExp;
	replace: (line: string) => string;
	label: string;
}

const TYPO_RULES: TypoRule[] = [
	{
		test: /\\begn\{tikzpicture\}/,
		replace: line => line.replace(/\\begn\{tikzpicture\}/g, '\\begin{tikzpicture}'),
		label: 'Fix \\begin{tikzpicture} typo',
	},
	{
		test: /\\beign\{tikzpicture\}/,
		replace: line => line.replace(/\\beign\{tikzpicture\}/g, '\\begin{tikzpicture}'),
		label: 'Fix \\begin{tikzpicture} typo',
	},
	{
		test: /\\begin\{tikzpictur[^}]*\}/,
		replace: line => line.replace(/\\begin\{tikzpictur[^}]*\}/g, '\\begin{tikzpicture}'),
		label: 'Fix \\begin{tikzpicture} typo',
	},
	{
		test: /\\end\{tikzpictur[^}]*\}/,
		replace: line => line.replace(/\\end\{tikzpictur[^}]*\}/g, '\\end{tikzpicture}'),
		label: 'Fix \\end{tikzpicture} typo',
	},
	{
		test: /\\end\{tikzpciture\}/,
		replace: line => line.replace(/\\end\{tikzpciture\}/g, '\\end{tikzpicture}'),
		label: 'Fix \\end{tikzpicture} typo',
	},
	{
		test: /\\tikzpciture/,
		replace: line => line.replace(/\\tikzpciture/g, '\\tikzpicture'),
		label: 'Fix \\tikzpicture typo',
	},
];

/** Drop a trailing `% comment`, honouring an escaped `\%`. */
function stripComment(line: string): string {
	let escaped = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			escaped = true;
			continue;
		}
		if (ch === '%') {
			return line.slice(0, i);
		}
	}
	return line;
}

/** True when the code on this line is a TikZ statement left without its `;`. */
export function isTikzStatementMissingSemicolon(lineContent: string): boolean {
	const trimmed = stripComment(lineContent).trim();
	if (!trimmed || trimmed.endsWith(';')) {
		return false;
	}
	return TIKZ_STATEMENT_RE.test(trimmed);
}

function braceBalance(line: string): number {
	let depth = 0;
	let escaped = false;
	for (const ch of line) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			escaped = true;
			continue;
		}
		// An unescaped % comments out the rest, braces included.
		if (ch === '%') {
			break;
		}
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
		}
	}
	return depth;
}

function isSkippableLine(line: string): boolean {
	const trimmed = line.trim();
	return !trimmed || trimmed.startsWith('%');
}

/**
 * Last line of a TikZ statement that is never terminated with `;`, at or
 * before the line LaTeX blamed. TeX only notices at the *next* statement, so
 * the blamed line is usually a well-formed one.
 *
 * Scans the whole block rather than walking backwards: `\draw (0,0)` followed
 * by `-- (2,2);` is a perfectly good multi-line statement, and looking only at
 * the preceding line cannot tell that apart from one left open.
 *
 * Returns a 0-based index into `lines`, or null when every statement is
 * closed — in which case suggesting a semicolon would be a guess.
 */
function findStatementMissingSemicolon(context: LatexAutofixContext): number | null {
	const { lines, lineIndex } = context;
	const unterminated: number[] = [];
	let openLast = -1;

	const closeOpenStatement = () => {
		if (openLast !== -1) {
			unterminated.push(openLast);
			openLast = -1;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		if (isSkippableLine(lines[i])) {
			continue;
		}
		const code = stripComment(lines[i]).trim();
		if (!code) {
			continue;
		}

		const startsStatement = TIKZ_STATEMENT_RE.test(code);
		// A new statement, or an environment boundary, ends whatever came
		// before it — and if that had no `;`, this is where one was needed.
		if (startsStatement || ENVIRONMENT_BOUNDARY_RE.test(code)) {
			closeOpenStatement();
		}

		if (openLast === -1 && !startsStatement) {
			continue;
		}

		openLast = code.endsWith(';') ? -1 : i;
	}
	closeOpenStatement();

	for (let i = unterminated.length - 1; i >= 0; i--) {
		if (unterminated[i] <= lineIndex) {
			return unterminated[i];
		}
	}
	return null;
}

/** First line at or before the blamed one that leaves a brace open. */
function findLineWithOpenBrace(context: LatexAutofixContext): number | null {
	const { lines, lineIndex } = context;
	for (let i = Math.min(lineIndex, lines.length - 1); i >= 0; i--) {
		if (isSkippableLine(lines[i])) {
			continue;
		}
		if (braceBalance(lines[i]) > 0) {
			return i;
		}
	}
	return null;
}

function unescapedDollarCount(line: string): number {
	let count = 0;
	let escaped = false;
	for (const ch of line) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			escaped = true;
			continue;
		}
		if (ch === '$') {
			count++;
		}
	}
	return count;
}

function matchBrace(line: string, openIndex: number): number {
	let depth = 0;
	for (let i = openIndex; i < line.length; i++) {
		const ch = line[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return i + 1;
			}
		}
	}
	return -1;
}

/** Index of the first ^ or _ that is not escaped and not already inside $…$. */
function findBareMathShift(line: string): number {
	let inMath = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === '%') {
			break;
		}
		if (ch === '$') {
			inMath = !inMath;
			continue;
		}
		if (!inMath && (ch === '^' || ch === '_')) {
			return i;
		}
	}
	return -1;
}

const MATH_TOKEN_STOPS = new Set([' ', '\t', '{', '}', '[', ']', '(', ')', ',', ';', '$', '=']);

/**
 * Wrap the smallest sensible span around a bare ^ or _ in `$…$`.
 * `\node at (0,0) {x^2};` becomes `\node at (0,0) {$x^2$};`.
 */
export function wrapBareMathInLine(line: string): string | null {
	const shift = findBareMathShift(line);
	if (shift === -1) {
		return null;
	}

	let start = shift;
	while (start > 0 && !MATH_TOKEN_STOPS.has(line[start - 1])) {
		start--;
	}

	let end = shift + 1;
	if (line[end] === '{') {
		const close = matchBrace(line, end);
		if (close === -1) {
			return null;
		}
		end = close;
	} else {
		while (end < line.length && !MATH_TOKEN_STOPS.has(line[end])) {
			end++;
		}
	}

	const token = line.slice(start, end);
	if (!token.trim() || token.includes('$')) {
		return null;
	}

	return `${line.slice(0, start)}$${token}$${line.slice(end)}`;
}

function logMentionsMissingSemicolon(text: string): boolean {
	const lower = text.toLowerCase();
	return lower.includes('missing ;')
		|| lower.includes('missing semicolon')
		|| lower.includes('expected `;`')
		|| lower.includes('expected ;')
		|| lower.includes('forgot a semicolon')
		|| lower.includes('forget a semicolon')
		|| lower.includes('giving up on this path')
		|| (lower.includes('missing') && lower.includes(';'));
}

function logMentionsMissingClosingBrace(text: string): boolean {
	const lower = text.toLowerCase();
	return lower.includes('missing }')
		|| lower.includes('missing closing brace')
		|| (lower.includes('missing') && lower.includes('} inserted'));
}

/**
 * TikZ rarely says "missing }". An unclosed brace inside a node swallows the
 * following `\end{tikzpicture}` and surfaces as a bogus environment error, a
 * runaway argument, or a group-level complaint instead.
 */
function logMentionsBraceTrouble(text: string): boolean {
	const lower = text.toLowerCase();
	return logMentionsMissingClosingBrace(text)
		|| lower.includes('runaway argument')
		|| lower.includes('missing \\endgroup')
		|| lower.includes('missing \\endcsname')
		|| /environment\s+\S+\s+undefined/.test(lower)
		|| (lower.includes('\\begin{tikzpicture}') && lower.includes('ended by'));
}

function logMentionsMissingOpeningBrace(text: string): boolean {
	const lower = text.toLowerCase();
	return lower.includes('missing {')
		|| lower.includes('missing brace {')
		|| (lower.includes('missing') && lower.includes('{ inserted'));
}

function logMentionsMissingMathDelimiter(text: string): boolean {
	const lower = text.toLowerCase();
	return lower.includes('missing $')
		|| lower.includes('missing $ inserted')
		|| lower.includes('expected $');
}

function logMentionsMissingEndTikzpicture(text: string): boolean {
	const lower = text.toLowerCase();
	return lower.includes('ended by \\end{document}')
		&& lower.includes('tikzpicture');
}

function detectTypoFix(lineContent: string): LatexAutofix | null {
	for (const rule of TYPO_RULES) {
		if (!rule.test.test(lineContent)) {
			continue;
		}
		const replacement = rule.replace(lineContent);
		if (replacement === lineContent) {
			continue;
		}
		return {
			kind: 'fix-typo',
			label: rule.label,
			replacement,
		};
	}
	return null;
}

export function suggestLatexAutofix(
	summary: string,
	lineContent?: string,
	rawLog?: string,
	context?: LatexAutofixContext,
): LatexAutofix | null {
	const haystack = [summary, rawLog ?? ''].join('\n');
	const semicolonSuspected = logMentionsMissingSemicolon(haystack);

	if (!lineContent?.trim()) {
		if (logMentionsMissingEndTikzpicture(haystack)) {
			return {
				kind: 'insert-end-tikzpicture',
				label: 'Insert \\end{tikzpicture}',
			};
		}
		if (semicolonSuspected && context) {
			const target = findStatementMissingSemicolon(context);
			if (target !== null) {
				return {
					kind: 'append-semicolon',
					label: 'Add missing semicolon (;)',
					lineDelta: target - context.lineIndex,
				};
			}
		}
		return null;
	}

	const typoFix = detectTypoFix(lineContent);
	if (typoFix) {
		return typoFix;
	}

	const trimmedLine = lineContent.trimEnd();

	if (logMentionsMissingEndTikzpicture(haystack)) {
		return {
			kind: 'insert-end-tikzpicture',
			label: 'Insert \\end{tikzpicture}',
		};
	}

	const braceSuspected = logMentionsBraceTrouble(haystack);
	const mathSuspected = logMentionsMissingMathDelimiter(haystack);

	// Ahead of the semicolon heuristic: a line that leaves a brace open while
	// the log complains about braces is unambiguous, whereas almost any TikZ
	// statement without a trailing `;` looks like a semicolon candidate.
	if (braceSuspected && braceBalance(trimmedLine) > 0) {
		return {
			kind: 'append-closing-brace',
			label: 'Add missing closing brace (})',
		};
	}

	if (mathSuspected) {
		// An odd count means a `$` was opened and never closed; an even count
		// with a bare ^ or _ means the whole span needs wrapping instead.
		if (unescapedDollarCount(trimmedLine) % 2 === 1) {
			return {
				kind: 'append-math-delimiter',
				label: 'Add missing math delimiter ($)',
			};
		}
		const wrapped = wrapBareMathInLine(trimmedLine);
		if (wrapped && wrapped !== trimmedLine) {
			return {
				kind: 'wrap-in-math',
				label: 'Wrap in math mode ($…$)',
				replacement: wrapped,
			};
		}
	}

	// The heuristic arm only applies when the log points nowhere more specific:
	// nearly every TikZ statement is "a statement without a trailing ;" while
	// TeX is mid-recovery from an unrelated brace or math failure.
	const semicolonHeuristic = !semicolonSuspected
		&& !braceSuspected
		&& !mathSuspected
		&& isTikzStatementMissingSemicolon(trimmedLine)
		&& /missing|inserted|syntax|forgot|giving up/i.test(haystack);

	if (semicolonSuspected || semicolonHeuristic) {
		// Only ever append to a line that is a TikZ statement left open —
		// blindly trusting the blamed line used to put the `;` after
		// \end{tikzpicture}.
		if (isTikzStatementMissingSemicolon(trimmedLine)) {
			return {
				kind: 'append-semicolon',
				label: 'Add missing semicolon (;)',
			};
		}
		if (context) {
			const target = findStatementMissingSemicolon(context);
			if (target !== null) {
				return {
					kind: 'append-semicolon',
					label: 'Add missing semicolon (;)',
					lineDelta: target - context.lineIndex,
				};
			}
		}
	}

	if (braceSuspected && context) {
		const target = findLineWithOpenBrace(context);
		if (target !== null) {
			return {
				kind: 'append-closing-brace',
				label: 'Add missing closing brace (})',
				lineDelta: target - context.lineIndex,
			};
		}
	}

	if (logMentionsMissingOpeningBrace(haystack)) {
		const balance = braceBalance(trimmedLine);
		if (balance < 0) {
			return {
				kind: 'append-opening-brace',
				label: 'Add missing opening brace ({)',
			};
		}
	}

	return null;
}

export function applyAutofixToLine(lineContent: string, autofix: LatexAutofix): string {
	switch (autofix.kind) {
		case 'append-semicolon':
			return lineContent.replace(/\s*$/, ';');
		case 'append-closing-brace': {
			const code = lineContent.trimEnd();
			const braces = '}'.repeat(Math.max(1, braceBalance(code)));
			// A trailing `;` terminates the statement, so the brace closes
			// before it. Appending after would swallow the semicolon into the
			// node text and leave the statement itself unterminated.
			if (code.endsWith(';')) {
				return `${code.slice(0, -1)}${braces};`;
			}
			return `${code}${braces}`;
		}
		case 'append-opening-brace':
			return `{${lineContent}`;
		case 'append-math-delimiter':
			return lineContent.replace(/\s*$/, '$');
		case 'fix-typo':
		case 'wrap-in-math':
			return autofix.replacement ?? lineContent;
		case 'fill-option-value': {
			const key = autofix.optionKey;
			const value = autofix.optionValue;
			if (!key || !value) {
				return lineContent;
			}
			const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const replaced = lineContent.replace(
				new RegExp(`(${keyPattern})\\s*=\\s*[^,\\]\\}\\)]*`),
				`$1=${value}`,
			);
			if (replaced !== lineContent) {
				return replaced;
			}
			return lineContent.replace(
				new RegExp(`(${keyPattern})\\s*=\\s*(?=[,\\]\\}\\)]|$)`),
				`$1=${value}`,
			);
		}
		case 'insert-end-tikzpicture':
			return lineContent;
		default:
			return lineContent;
	}
}
