import type { Editor } from 'obsidian';
import type { TikzBlock } from '../core/types';
import { prepareBlockLineForRender } from '../utils/diagramAlign';
import { gridInjectionIndex } from '../utils/diagramGrid';
import { suggestLatexAutofix, type LatexAutofix } from './latexAutofix';
import { hintForLatexError } from './latexErrorHints';

export interface MappedLatexError {
	/** Short LaTeX error summary, e.g. "Missing semicolon (;)" */
	summary: string;
	/** Detailed message, often includes line snippet */
	message: string;
	userLine?: number;
	lineContent?: string;
	noteLine?: number;
	autofix?: LatexAutofix;
	/** Plain-language explanation shown under the error title. */
	hint?: string;
}

const LATEX_LINE_PATTERN = /(?:^|\n)\s*l\.(\d+)/;

export function getUserSourceLineOffset(wrapperPrefix: string): number {
	if (!wrapperPrefix) {
		return 0;
	}

	// The prefix ends with '\n', so split() yields a trailing empty element;
	// the user's first line sits at tex line (offset + 1).
	return wrapperPrefix.split('\n').length - 1;
}

export function parseLatexErrorLine(raw: string): number | null {
	const match = raw.match(LATEX_LINE_PATTERN);
	if (!match) {
		return null;
	}

	const line = parseInt(match[1], 10);
	return Number.isFinite(line) ? line : null;
}

function humanizeLatexError(rawLine: string): string {
	const trimmed = rawLine.replace(/^!\s*/, '').trim();
	const lower = trimmed.toLowerCase();

	if (lower.includes('missing ;')) {
		return 'Missing semicolon (;)';
	}
	if (lower.includes('forgot a semicolon') || lower.includes('forget a semicolon')) {
		return 'Missing semicolon (;)';
	}
	if (lower.includes('giving up on this path')) {
		return 'Missing semicolon (;)';
	}
	if (lower.startsWith('undefined control sequence')) {
		const tokenMatch = trimmed.match(/\\[A-Za-z@]+/);
		return tokenMatch ? `Undefined control sequence ${tokenMatch[0]}` : 'Undefined control sequence';
	}
	if (lower.startsWith('missing $ inserted')) {
		return 'Missing $ inserted';
	}
	if (lower.startsWith('missing { inserted')) {
		return 'Missing brace {';
	}
	if (lower.startsWith('missing } inserted')) {
		return 'Missing closing brace }';
	}
	if (lower.includes('ended by \\end{document}') && lower.includes('tikzpicture')) {
		return 'Missing \\end{tikzpicture}';
	}
	if (lower.startsWith('dimension too large')) {
		return 'Dimension too large';
	}
	if (lower.includes('did not find the tikz library')) {
		const nameMatch = trimmed.match(/tikz library '([^']+)'/);
		return nameMatch
			? `Unknown tikz library '${nameMatch[1]}'`
			: 'Unknown tikz library';
	}
	if (lower.includes('runaway argument')) {
		return 'Runaway argument';
	}
	if (lower.includes('fatal error')) {
		return trimmed;
	}

	return trimmed;
}

export function extractUsefulLatexError(raw: string): string {
	const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

	const bangLine = lines.find(line => line.startsWith('! '));
	if (bangLine) {
		return humanizeLatexError(bangLine);
	}

	const usefulLine = lines.find(line =>
		line.includes('Undefined control sequence') ||
		line.includes('Missing') ||
		line.includes('forgot a semicolon') ||
		line.includes('forget a semicolon') ||
		line.includes('Giving up on this path') ||
		line.includes('Runaway argument') ||
		line.includes('Fatal error') ||
		(line.includes('ended by') && line.includes('tikzpicture'))
	);

	if (usefulLine) {
		return humanizeLatexError(usefulLine.startsWith('! ') ? usefulLine : `! ${usefulLine}`);
	}

	return 'Syntax error';
}

export function buildLatexErrorTitle(mapped: MappedLatexError): string {
	const displayLine = mapped.userLine ?? mapped.noteLine;
	if (displayLine !== undefined) {
		return `${mapped.summary} (line ${displayLine})`;
	}
	return mapped.summary;
}

/**
 * Map each render-source line (after tidy + strip align directives) to a 1-based note line.
 * Mirrors prepareTikzRenderSource so error line numbers match the editor.
 */
export function buildRenderToNoteLineMap(block: TikzBlock, editor?: Editor): (number | null)[] {
	const innerLines = block.source.split('\n');
	const rawLines: string[] = [];
	const renderLines: string[] = [];
	const map: (number | null)[] = [];

	for (let i = 0; i < innerLines.length; i++) {
		const noteLine0 = block.startLine + 1 + i;
		const raw = editor?.getLine(noteLine0) ?? innerLines[i] ?? '';
		rawLines.push(raw);
		const prepared = prepareBlockLineForRender(raw);
		if (prepared === null) {
			continue;
		}
		renderLines.push(prepared);
		map.push(noteLine0 + 1);
	}

	// The generated grid line exists only in the render source, so every line
	// below it would otherwise report one line short of where it really is.
	const gridAt = gridInjectionIndex(rawLines.join('\n'), renderLines);
	if (gridAt !== null) {
		map.splice(gridAt, 0, null);
	}

	return map;
}

export function createNoteLineMapper(
	block: TikzBlock,
	editor?: Editor,
): (renderLine: number) => number | null {
	const map = buildRenderToNoteLineMap(block, editor);
	return (renderLine: number) => map[renderLine - 1] ?? null;
}

export function formatLatexErrorWithLineMapping(
	raw: string,
	renderSource: string,
	sourceLineOffset: number,
	noteLineMapper?: (renderLine: number) => number | null,
	editor?: Editor,
): MappedLatexError {
	const summary = extractUsefulLatexError(raw);
	const latexLine = parseLatexErrorLine(raw);

	if (latexLine === null || latexLine <= sourceLineOffset) {
		return { summary, message: summary, hint: hintForLatexError(summary) };
	}

	const blamedLine = latexLine - sourceLineOffset;
	const renderLines = renderSource.split('\n');

	const resolveLineContent = (line: number): string | undefined => {
		const noteLine = noteLineMapper?.(line) ?? undefined;
		if (noteLine !== undefined && editor) {
			return editor.getLine(noteLine - 1)?.trimEnd() ?? renderLines[line - 1]?.trimEnd();
		}
		return renderLines[line - 1]?.trimEnd();
	};

	const suggested = suggestLatexAutofix(summary, resolveLineContent(blamedLine), raw, {
		lines: renderLines,
		lineIndex: blamedLine - 1,
	});

	// A fix that relocates moves the whole reported location with it: the line
	// TeX blamed is where it gave up, not where the mistake is, and the
	// highlight has to land on the line the Fix button will edit.
	const renderLine = suggested?.lineDelta
		? Math.max(1, Math.min(renderLines.length, blamedLine + suggested.lineDelta))
		: blamedLine;

	let autofix: LatexAutofix | undefined;
	if (suggested) {
		const { lineDelta: _resolved, ...rest } = suggested;
		autofix = rest;
	}
	const lineContent = resolveLineContent(renderLine);
	const noteLine = noteLineMapper?.(renderLine) ?? undefined;
	const hint = hintForLatexError(summary, lineContent);
	const snippet = lineContent
		? (lineContent.length > 80 ? `${lineContent.slice(0, 77)}...` : lineContent)
		: summary;

	return {
		summary,
		message: `Line ${renderLine}: ${summary} — ${snippet}`,
		userLine: renderLine,
		lineContent,
		noteLine,
		autofix,
		hint,
	};
}
