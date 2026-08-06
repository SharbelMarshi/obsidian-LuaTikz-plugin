import { EditorView } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import { OPEN_FENCE_RE } from './tikzFences';
const STARTER_BODY = String.raw`\begin{tikzpicture}

\end{tikzpicture}`;
const CURSOR_OFFSET = '\\begin{tikzpicture}\n'.length;

/**
 * Line number of the blank body line of a freshly opened tikz fence, or null.
 *
 * Obsidian auto-closes the fence while you type the backticks, so pressing
 * Enter after ```` ```tikz ```` inserts into a doc that already has the closing
 * fence. The inserted range therefore starts at the end of the fence line and
 * can span several lines, which is why every touched line is checked rather
 * than just the one holding the range start.
 */
export function findStarterLine(doc: Text, fromB: number, toB: number): number | null {
	const first = doc.lineAt(fromB).number;
	const last = doc.lineAt(Math.min(toB, doc.length)).number;

	for (let number = first; number <= last; number++) {
		if (number < 2 || doc.line(number).text.trim().length > 0) {
			continue;
		}
		if (!OPEN_FENCE_RE.test(doc.line(number - 1).text.trim())) {
			continue;
		}
		if (number === doc.lines) {
			return number;
		}
		const next = doc.line(number + 1).text.trim();
		if (next === '```' || next === '') {
			return number;
		}
	}

	return null;
}

export function tikzFenceStarterExtension(getEnabled: () => boolean): Extension {
	return EditorView.updateListener.of(update => {
		if (!getEnabled() || !update.docChanged) {
			return;
		}

		let starterLine: number | null = null;

		for (const tr of update.transactions) {
			if (!tr.docChanged || starterLine !== null) {
				continue;
			}

			tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
				if (starterLine !== null) {
					return;
				}
				if (!update.state.doc.sliceString(fromB, toB).includes('\n')) {
					return;
				}
				starterLine = findStarterLine(update.state.doc, fromB, toB);
			});
		}

		if (starterLine === null) {
			return;
		}

		// Dispatching from inside an update listener is not allowed; defer and
		// re-check, since the doc may have moved on by the time this runs.
		const line = starterLine;
		window.setTimeout(() => insertStarter(update.view, line), 0);
	});
}

function insertStarter(view: EditorView, lineNumber: number): void {
	const { doc } = view.state;
	if (lineNumber < 2 || lineNumber > doc.lines) {
		return;
	}

	const line = doc.line(lineNumber);
	if (line.text.trim().length > 0) {
		return;
	}
	if (!OPEN_FENCE_RE.test(doc.line(lineNumber - 1).text.trim())) {
		return;
	}

	// Only when the caret landed on the blank line, so pasting a whole block
	// elsewhere in the note never rewrites it.
	const { head } = view.state.selection.main;
	if (head < line.from || head > line.to) {
		return;
	}

	view.dispatch({
		changes: { from: line.from, to: line.to, insert: STARTER_BODY },
		selection: { anchor: line.from + CURSOR_OFFSET },
	});
}
