import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

const OPEN_FENCE_RE = /^```(?:tikz|luatikz)\b.*$/;
const STARTER_BODY = String.raw`\begin{tikzpicture}

\end{tikzpicture}`;

export function tikzFenceStarterExtension(getEnabled: () => boolean): Extension {
	return EditorView.updateListener.of(update => {
		if (!getEnabled() || !update.docChanged) {
			return;
		}

		for (const tr of update.transactions) {
			if (!tr.docChanged) {
				continue;
			}

			tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
				const inserted = update.state.doc.sliceString(fromB, toB);
				if (!inserted.includes('\n')) {
					return;
				}

				const line = update.state.doc.lineAt(fromB);
				const prevLineNumber = line.number - 1;
				if (prevLineNumber < 1) {
					return;
				}

				const prevLine = update.state.doc.line(prevLineNumber);
				if (!OPEN_FENCE_RE.test(prevLine.text.trim())) {
					return;
				}

				const nextLineNumber = line.number + 1;
				if (nextLineNumber > update.state.doc.lines) {
					insertStarter(update.view, line.from);
					return;
				}

				const nextLine = update.state.doc.line(nextLineNumber);
				if (nextLine.text.trim() === '```' || nextLine.text.trim() === '') {
					insertStarter(update.view, line.from);
				}
			});
		}
	});
}

function insertStarter(view: EditorView, pos: number): void {
	const line = view.state.doc.lineAt(pos);
	if (line.text.trim().length > 0) {
		return;
	}

	view.dispatch({
		changes: { from: line.from, to: line.to, insert: STARTER_BODY },
		selection: { anchor: line.from + '\\begin{tikzpicture}\n'.length },
	});
}
