import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { isInsideTikzFence } from './tikzFenceContext';

/** Bare \\draw (etc.) line — auto-append trailing semicolon for Obsidian LP stability. */
const START_DRAW_CMD_RE = /^\\(?:draw|path|fill|filldraw|node)\b\s*$/;

function maybeAppendDrawSemicolon(update: ViewUpdate): void {
	if (!update.docChanged) {
		return;
	}

	const { state, view } = update;
	const head = state.selection.main.head;
	if (!isInsideTikzFence(state.doc, head)) {
		return;
	}

	const line = state.doc.lineAt(head);
	if (!START_DRAW_CMD_RE.test(line.text)) {
		return;
	}

	const insert = line.text.endsWith(' ') ? ';' : ' ;';
	view.dispatch({
		changes: { from: line.to, insert },
		selection: { anchor: line.to + insert.length - 2 },
	});
}

export function tikzDrawStarterSemicolonExtension(): Extension {
	return EditorView.updateListener.of(maybeAppendDrawSemicolon);
}
