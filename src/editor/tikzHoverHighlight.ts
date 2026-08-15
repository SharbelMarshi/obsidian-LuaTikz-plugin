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

/**
 * Hover range plus its decorations, in a *single* field.
 *
 * These used to be two fields, with the decorations field reading the range
 * field through `tr.startState.field(...)`. That is unsafe: when the plugin
 * is installed into an already-open editor, the transaction that adds the
 * extensions has a `startState` that predates them, so the lookup threw
 * "RangeError: Field is not present in this state" — during `onload`, which
 * Obsidian reports as the whole plugin failing to load. (The same read in
 * `create` carried the sibling hazard of depending on field ordering.)
 *
 * One field cannot race its own installation: `update` only ever touches its
 * previous value and the transaction, never another field or `startState`.
 */
interface TikzHoverState {
	range: TikzHoverRange | null;
	decorations: DecorationSet;
}

const EMPTY_HOVER_STATE: TikzHoverState = { range: null, decorations: Decoration.none };

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

const tikzHoverField = StateField.define<TikzHoverState>({
	create: () => EMPTY_HOVER_STATE,
	update(value, tr) {
		// An explicit effect wins even on an edit; otherwise an edit clears a
		// stale range so it can never linger over shifted text.
		let range = value.range;
		let fromEffect = false;
		for (const effect of tr.effects) {
			if (effect.is(setTikzHoverHighlight)) {
				range = effect.value;
				fromEffect = true;
				break;
			}
		}
		if (!fromEffect && tr.docChanged) {
			range = null;
		}
		if (range === value.range && !tr.docChanged) {
			return value;
		}
		return { range, decorations: buildHoverDecorations(range, tr.state.doc) };
	},
	provide: field => EditorView.decorations.from(field, value => value.decorations),
});

function hasHoverExtension(view: EditorView): boolean {
	try {
		view.state.field(tikzHoverField);
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
	if (!view || sameRange(view.state.field(tikzHoverField).range, range)) {
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
	return [tikzHoverField];
}
