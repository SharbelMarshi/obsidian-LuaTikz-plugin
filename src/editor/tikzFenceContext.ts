import type { EditorView } from '@codemirror/view';
import { TIKZ_FENCE_LANGUAGES, enclosingFenceLine } from './tikzFences';

/** True when `pos` is inside an open ```tikz / ```luatikz fence (before closing ```). */
export function isInsideTikzFence(doc: EditorView['state']['doc'], pos: number): boolean {
	return enclosingFenceLine(doc, pos, TIKZ_FENCE_LANGUAGES) !== null;
}

/**
 * True inside a ```tikz fence or an open `\begin{tikzpicture}` … `\end{tikzpicture}`.
 *
 * Both checks are backwards line scans from the cursor. The old
 * implementation materialised the whole document prefix as a string and
 * regex-scanned it — twice — on every document change in every markdown file.
 */
export function isInsideTikzEditingContext(doc: EditorView['state']['doc'], pos: number): boolean {
	if (isInsideTikzFence(doc, pos)) {
		return true;
	}

	// Walk up counting environment boundaries: a \begin{tikzpicture} that has
	// not been matched by an \end below it (but above the cursor) means open.
	let pendingEnds = 0;
	const currentLine = doc.lineAt(pos).number;
	for (let lineNumber = currentLine; lineNumber >= 1; lineNumber--) {
		const text = doc.line(lineNumber).text;
		if (!text.includes('tikzpicture')) {
			continue;
		}
		const begins = text.match(/\\begin\{tikzpicture\}/g)?.length ?? 0;
		const ends = text.match(/\\end\{tikzpicture\}/g)?.length ?? 0;
		pendingEnds += ends;
		if (begins > pendingEnds) {
			return true;
		}
		pendingEnds -= begins;
	}
	return false;
}
