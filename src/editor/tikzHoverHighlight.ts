import type { Editor } from 'obsidian';
import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { getEditorViewWithExtension } from './editorViewAccess';

/** Inclusive 1-based CodeMirror line range for the statement under the pointer. */
export interface TikzHoverRange {
	fromLine: number;
	toLine: number;
}

export const setTikzHoverHighlight = StateEffect.define<TikzHoverRange | null>();

/** Live hover range; cleared on every edit so a stale range can never linger. */
const tikzHoverRangeField = StateField.define<TikzHoverRange | null>({
	create: () => null,
	update(range, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setTikzHoverHighlight)) {
				return effect.value;
			}
		}
		return tr.docChanged ? null : range;
	},
});

function buildHoverDecorations(range: TikzHoverRange | null, doc: Text): DecorationSet {
	if (!range) {
		return Decoration.none;
	}

	const from = Math.max(1, range.fromLine);
	const to = Math.min(doc.lines, range.toLine);
	if (to < from) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	for (let line = from; line <= to; line++) {
		builder.add(doc.line(line).from, doc.line(line).from, Decoration.line({
			class: 'luatikz-hover-line-highlight',
		}));
	}
	return builder.finish();
}

const tikzHoverDecorationsField = StateField.define<DecorationSet>({
	create: state => buildHoverDecorations(state.field(tikzHoverRangeField), state.doc),
	update(decorations, tr) {
		const range = tr.state.field(tikzHoverRangeField);
		if (range === tr.startState.field(tikzHoverRangeField) && !tr.docChanged) {
			return decorations;
		}
		return buildHoverDecorations(range, tr.state.doc);
	},
	provide: field => EditorView.decorations.from(field),
});

function hasHoverExtension(view: EditorView): boolean {
	try {
		view.state.field(tikzHoverRangeField);
		return true;
	} catch {
		return false;
	}
}

function getEditorView(editor: Editor): EditorView | null {
	return getEditorViewWithExtension(editor, hasHoverExtension);
}

function sameRange(a: TikzHoverRange | null, b: TikzHoverRange | null): boolean {
	if (!a || !b) {
		return a === b;
	}
	return a.fromLine === b.fromLine && a.toLine === b.toLine;
}

/** Highlight `range`, or clear the highlight when it is null. Redundant calls are dropped. */
export function showTikzHoverHighlight(editor: Editor, range: TikzHoverRange | null): void {
	const view = getEditorView(editor);
	if (!view || sameRange(view.state.field(tikzHoverRangeField), range)) {
		return;
	}
	view.dispatch({ effects: [setTikzHoverHighlight.of(range)] });
}

export function clearTikzHoverHighlight(editor: Editor): void {
	showTikzHoverHighlight(editor, null);
}

// Styling lives in styles.css: a baseTheme selector is prefixed with the base
// theme class, which sits on the same element as .cm-editor, so the usual
// ".cm-editor .cm-line" form never matches.
export function tikzHoverHighlightExtension(): Extension[] {
	return [tikzHoverRangeField, tikzHoverDecorationsField];
}
