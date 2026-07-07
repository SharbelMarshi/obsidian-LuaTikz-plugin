export type LatexAutofixKind =
	| 'append-semicolon'
	| 'append-closing-brace'
	| 'append-opening-brace'
	| 'append-math-delimiter'
	| 'insert-end-tikzpicture'
	| 'fix-typo'
	| 'fill-option-value';

export interface LatexAutofix {
	kind: LatexAutofixKind;
	label: string;
	replacement?: string;
	optionKey?: string;
	optionValue?: string;
}

const TIKZ_STATEMENT_RE = /^\\(draw|path|fill|filldraw|node|coordinate|clip|shade|pic|matrix|scope|begin)\b/;

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

export function isTikzStatementMissingSemicolon(lineContent: string): boolean {
	const trimmed = lineContent.trim();
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
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
		}
	}
	return depth;
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
): LatexAutofix | null {
	const haystack = [summary, rawLog ?? ''].join('\n');
	if (!lineContent?.trim()) {
		if (logMentionsMissingEndTikzpicture(haystack)) {
			return {
				kind: 'insert-end-tikzpicture',
				label: 'Insert \\end{tikzpicture}',
			};
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

	if (logMentionsMissingSemicolon(haystack)
		|| (isTikzStatementMissingSemicolon(trimmedLine) && /missing|inserted|syntax|forgot|giving up/i.test(haystack))) {
		if (!trimmedLine.endsWith(';')) {
			return {
				kind: 'append-semicolon',
				label: 'Add missing semicolon (;)',
			};
		}
	}

	if (logMentionsMissingClosingBrace(haystack)) {
		const balance = braceBalance(trimmedLine);
		if (balance > 0) {
			return {
				kind: 'append-closing-brace',
				label: 'Add missing closing brace (})',
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

	if (logMentionsMissingMathDelimiter(haystack) && unescapedDollarCount(trimmedLine) % 2 === 1) {
		return {
			kind: 'append-math-delimiter',
			label: 'Add missing math delimiter ($)',
		};
	}

	return null;
}

export function applyAutofixToLine(lineContent: string, autofix: LatexAutofix): string {
	switch (autofix.kind) {
		case 'append-semicolon':
			return lineContent.replace(/\s*$/, ';');
		case 'append-closing-brace': {
			const balance = Math.max(1, braceBalance(lineContent.trimEnd()));
			return lineContent.replace(/\s*$/, '}'.repeat(balance));
		}
		case 'append-opening-brace':
			return `{${lineContent}`;
		case 'append-math-delimiter':
			return lineContent.replace(/\s*$/, '$');
		case 'fix-typo':
			return autofix.replacement ?? lineContent;
		case 'fill-option-value': {
			const key = autofix.optionKey;
			const value = autofix.optionValue;
			if (!key || !value || value === '?') {
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
