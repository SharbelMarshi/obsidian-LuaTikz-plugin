import type { EditorView } from '@codemirror/view';

/**
 * The one definition of "a tikz fence" for every editor extension. Before the
 * extraction the opening-fence regex existed in five places (tikzIdeGutter,
 * tikzFenceStarter, tikzStructuralLint, plus two variants in
 * latexAutocomplete), and the block scanner was duplicated byte-for-byte
 * between tikzIdeGutter and tikzStructuralLint.
 */
export const OPEN_FENCE_RE = /^```(?:tikz|luatikz)\b.*$/;

export interface FencedBlockRange {
	/** Document offset of the first content character. */
	from: number;
	/** Document offset of the last content character. */
	to: number;
	/** 1-based first content line (the line after the opening fence). */
	startLine: number;
	/** 1-based last content line (the line before the closing fence). */
	endLine: number;
	/** Block body exactly as sliced from the document. */
	source: string;
}

/**
 * The fence languages an extension cares about. The completion source
 * deliberately accepts plain LaTeX fences as well; everything else is
 * tikz-only. Kept as an explicit parameter so that divergence stays visible.
 */
export const TIKZ_FENCE_LANGUAGES = ['tikz', 'luatikz'] as const;
export const LATEX_FENCE_LANGUAGES = ['tikz', 'luatikz', 'latex', 'lualatex', 'tex'] as const;

/**
 * The 1-based line number of the open fence enclosing `pos`, or null.
 *
 * A backwards line scan: the nearest fence marker above the cursor decides —
 * an opening fence in `languages` means inside, any other ``` line (a closing
 * fence or another language's opener) means outside. Replaces a forward regex
 * over `doc.sliceString(0, pos)` that materialised the whole prefix on every
 * document change in every markdown file, and that also matched fences
 * mid-line (inline code) because it was not line-anchored.
 */
export function enclosingFenceLine(
	doc: EditorView['state']['doc'],
	pos: number,
	languages: readonly string[],
): number | null {
	const openRe = new RegExp(`^\`\`\`(?:${languages.join('|')})\\b`);
	const currentLine = doc.lineAt(pos).number;

	for (let lineNumber = currentLine; lineNumber >= 1; lineNumber--) {
		const trimmed = doc.line(lineNumber).text.trim();
		if (!trimmed.startsWith('```')) {
			continue;
		}
		// The cursor's own line being a fence marker means the cursor sits on
		// the boundary, not in the content.
		if (lineNumber === currentLine) {
			return null;
		}
		return openRe.test(trimmed) ? lineNumber : null;
	}

	return null;
}

/**
 * Content ranges of every closed ```tikz / ```luatikz fence, in document
 * order. Fences without content (open + close on adjacent lines) are skipped.
 */
export function findFencedTikzRanges(doc: EditorView['state']['doc']): FencedBlockRange[] {
	const ranges: FencedBlockRange[] = [];
	let openLine: number | null = null;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const trimmed = doc.line(lineNumber).text.trim();

		if (openLine === null) {
			if (OPEN_FENCE_RE.test(trimmed)) {
				openLine = lineNumber;
			}
			continue;
		}

		if (trimmed === '```') {
			const startLine = openLine + 1;
			const endLine = lineNumber - 1;
			if (endLine >= startLine) {
				const from = doc.line(startLine).from;
				const to = doc.line(endLine).to;
				ranges.push({
					from,
					to,
					startLine,
					endLine,
					source: doc.sliceString(from, to),
				});
			}
			openLine = null;
		}
	}

	return ranges;
}
