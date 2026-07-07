import { editorEditorField, type Editor } from 'obsidian';
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	WidgetType,
	type ViewUpdate,
} from '@codemirror/view';
import type { LatexAutofix } from '../latex/latexAutofix';

export interface TikzErrorHighlightRange {
	lineFrom: number;
	lineTo: number;
	markFrom: number;
	markTo: number;
	autofix?: LatexAutofix;
}

export const setTikzErrorHighlight = StateEffect.define<TikzErrorHighlightRange | null>();

const tikzErrorHighlightMeta = StateField.define<TikzErrorHighlightRange | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setTikzErrorHighlight)) {
				return effect.value;
			}
		}
		return value;
	},
});

const autofixHandlers = new WeakMap<EditorView, () => void>();

class TikzAutofixPopupWidget extends WidgetType {
	constructor(
		private readonly title: string,
		private readonly view: EditorView,
	) {
		super();
	}

	override eq(other: TikzAutofixPopupWidget): boolean {
		return other.title === this.title;
	}

	override toDOM(): HTMLElement {
		const popup = activeDocument.createElement('div');
		popup.className = 'luatikz-autofix-popup';

		const label = activeDocument.createElement('span');
		label.className = 'luatikz-autofix-popup-label';
		label.textContent = 'LuaTikZ';

		const button = activeDocument.createElement('button');
		button.type = 'button';
		button.className = 'luatikz-autofix-popup-fix';
		button.textContent = 'Fix';
		button.title = this.title;
		button.addEventListener('mousedown', (event: MouseEvent) => {
			event.preventDefault();
		});
		button.addEventListener('click', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			autofixHandlers.get(this.view)?.();
		});

		popup.appendChild(label);
		popup.appendChild(button);
		return popup;
	}
}

function buildErrorDecorations(
	highlight: TikzErrorHighlightRange | null,
	view?: EditorView,
): DecorationSet {
	if (!highlight) {
		return Decoration.none;
	}

	const { lineFrom, markFrom, markTo, autofix } = highlight;
	const builder = new RangeSetBuilder<Decoration>();
	builder.add(lineFrom, lineFrom, Decoration.line({
		class: 'luatikz-error-line-highlight',
	}));

	if (markTo > markFrom) {
		builder.add(markFrom, markTo, Decoration.mark({
			class: 'luatikz-error-mark-highlight',
		}));
	}

	if (autofix && view && autofixHandlers.has(view)) {
		builder.add(
			markFrom,
			markFrom,
			Decoration.widget({
				widget: new TikzAutofixPopupWidget(autofix.label, view),
				side: 1,
			}),
		);
	}

	return builder.finish();
}

const tikzErrorDecorationsField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		let highlight: TikzErrorHighlightRange | null | undefined;
		for (const effect of tr.effects) {
			if (effect.is(setTikzErrorHighlight)) {
				highlight = effect.value;
			}
		}

		if (highlight !== undefined) {
			if (highlight === null) {
				return Decoration.none;
			}
			return buildErrorDecorations(highlight);
		}

		if (tr.docChanged && decorations !== Decoration.none) {
			return Decoration.none;
		}

		return decorations.map(tr.changes);
	},
	provide: field => EditorView.decorations.from(field),
});

const tikzErrorWidgetPlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet = Decoration.none;

	constructor(private readonly view: EditorView) {}

	update(update: ViewUpdate): void {
		const highlightChanged = update.transactions.some(tr =>
			tr.effects.some(effect => effect.is(setTikzErrorHighlight)),
		);
		if (!highlightChanged && !update.docChanged) {
			return;
		}

		const highlight = update.state.field(tikzErrorHighlightMeta);
		this.decorations = buildErrorDecorations(highlight, update.view);
	}

	destroy(): void {
		autofixHandlers.delete(this.view);
	}
}, {
	decorations: value => value.decorations,
});

function editorHasHighlightExtension(view: EditorView): boolean {
	try {
		view.state.field(tikzErrorHighlightMeta);
		return true;
	} catch {
		return false;
	}
}

function getEditorView(editor: Editor): EditorView | null {
	const direct = (editor as Editor & { cm?: EditorView }).cm;
	if (direct?.state && typeof direct.dispatch === 'function') {
		if (editorHasHighlightExtension(direct)) {
			return direct;
		}
		try {
			const linked = direct.state.field(editorEditorField) as EditorView | undefined;
			if (linked && editorHasHighlightExtension(linked)) {
				return linked;
			}
		} catch {
			// Fall through to direct view.
		}
		return direct;
	}

	return null;
}

export function computeErrorMarkRange(
	lineText: string,
	lineFrom: number,
	options?: { autofix?: LatexAutofix; markColumnStart?: number; markColumnEnd?: number },
): { from: number; to: number } {
	if (options?.markColumnStart !== undefined && options?.markColumnEnd !== undefined) {
		const start = Math.max(lineFrom, lineFrom + options.markColumnStart);
		const end = Math.max(start, lineFrom + options.markColumnEnd);
		return { from: start, to: end };
	}

	const trimmed = lineText.trimEnd();
	if (!trimmed) {
		return { from: lineFrom, to: lineFrom + lineText.length };
	}

	const trimmedEnd = lineFrom + trimmed.length;
	if (options?.autofix?.kind === 'append-semicolon'
		|| options?.autofix?.kind === 'append-closing-brace'
		|| options?.autofix?.kind === 'append-math-delimiter') {
		const insertAt = Math.max(lineFrom, trimmedEnd);
		return { from: insertAt, to: lineFrom + lineText.length };
	}

	if (options?.autofix?.kind === 'append-opening-brace') {
		return { from: lineFrom, to: Math.min(lineFrom + 1, lineFrom + lineText.length) };
	}

	if (options?.autofix?.kind === 'fill-option-value') {
		const key = options.autofix.optionKey;
		if (key) {
			const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const match = trimmed.match(new RegExp(`${keyPattern}\\s*=\\s*[^,\\]\\}\\)]*`));
			if (match && match.index !== undefined) {
				const start = lineFrom + match.index;
				const end = start + match[0].length;
				return { from: start, to: end };
			}
		}
	}

	const highlightStart = Math.max(lineFrom, trimmedEnd - Math.min(12, trimmed.length));
	return { from: highlightStart, to: lineFrom + lineText.length };
}

export interface HighlightTikzErrorOptions {
	autofix?: LatexAutofix;
	onApplyAutofix?: () => void;
	focus?: boolean;
	markColumnStart?: number;
	markColumnEnd?: number;
}

export function highlightTikzErrorInEditor(
	editor: Editor,
	noteLine: number,
	options: HighlightTikzErrorOptions = {},
): void {
	const cm = getEditorView(editor);
	if (!cm) {
		return;
	}

	const lineNumber = noteLine;
	if (lineNumber < 1 || lineNumber > cm.state.doc.lines) {
		return;
	}

	const line = cm.state.doc.line(lineNumber);
	const { from: markFrom, to: markTo } = computeErrorMarkRange(line.text, line.from, {
		autofix: options.autofix,
		markColumnStart: options.markColumnStart,
		markColumnEnd: options.markColumnEnd,
	});

	if (options.autofix && options.onApplyAutofix) {
		autofixHandlers.set(cm, options.onApplyAutofix);
	} else {
		autofixHandlers.delete(cm);
	}

	const highlight: TikzErrorHighlightRange = {
		lineFrom: line.from,
		lineTo: line.to,
		markFrom,
		markTo,
		autofix: options.autofix,
	};

	const dispatchSpec: {
		effects: ReturnType<typeof setTikzErrorHighlight.of>[];
		selection?: { anchor: number; head: number };
		scrollIntoView?: boolean;
	} = {
		effects: [setTikzErrorHighlight.of(highlight)],
	};

	if (options.focus !== false) {
		dispatchSpec.selection = { anchor: markFrom, head: markTo };
		dispatchSpec.scrollIntoView = true;
	}

	cm.dispatch(dispatchSpec);

	// Rebuild widget decorations after handler registration.
	window.requestAnimationFrame(() => {
		if (!editorHasHighlightExtension(cm)) {
			return;
		}
		const current = cm.state.field(tikzErrorHighlightMeta);
		if (!current) {
			return;
		}
		cm.dispatch({ effects: [setTikzErrorHighlight.of({ ...current })] });
	});
}

export function clearTikzErrorHighlight(editor: Editor): void {
	const cm = getEditorView(editor);
	if (!cm || !editorHasHighlightExtension(cm)) {
		return;
	}
	autofixHandlers.delete(cm);
	cm.dispatch({ effects: [setTikzErrorHighlight.of(null)] });
}

export function replaceEditorLine(editor: Editor, noteLine: number, nextLine: string): void {
	const line = noteLine - 1;
	const current = editor.getLine(line);
	editor.replaceRange(
		nextLine,
		{ line, ch: 0 },
		{ line, ch: current.length },
	);
}

const tikzErrorHighlightTheme = EditorView.baseTheme({
	'.cm-editor .cm-line.luatikz-error-line-highlight': {
		backgroundColor: 'rgba(255, 80, 80, 0.18)',
	},
	'.cm-editor .luatikz-error-mark-highlight': {
		backgroundColor: 'rgba(255, 80, 80, 0.42)',
		borderRadius: '2px',
	},
	'&.cm-focused .cm-editor .cm-line.luatikz-error-line-highlight': {
		backgroundColor: 'rgba(255, 80, 80, 0.22)',
	},
	'.luatikz-autofix-popup': {
		position: 'absolute',
		top: '-1.85em',
		zIndex: '20',
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		padding: '2px 6px',
		borderRadius: '8px',
		border: '1px solid var(--background-modifier-border)',
		background: 'var(--background-primary)',
		boxShadow: '0 4px 14px rgba(0, 0, 0, 0.18)',
	},
	'.luatikz-autofix-popup-label': {
		fontSize: '0.68em',
		fontWeight: '600',
		color: 'var(--text-muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.04em',
	},
	'.luatikz-autofix-popup-fix': {
		padding: '2px 10px',
		borderRadius: '6px',
		border: '1px solid rgba(80, 180, 120, 0.55)',
		background: 'rgba(80, 180, 120, 0.18)',
		color: 'var(--text-normal)',
		fontSize: '0.78em',
		fontWeight: '600',
		cursor: 'pointer',
	},
	'.luatikz-autofix-popup-fix:hover': {
		background: 'rgba(80, 180, 120, 0.32)',
	},
});

export function tikzErrorHighlightExtension(): Extension[] {
	return [
		tikzErrorHighlightMeta,
		tikzErrorDecorationsField,
		tikzErrorWidgetPlugin,
		EditorView.updateListener.of(update => {
			if (!update.docChanged) {
				return;
			}
			if (update.state.field(tikzErrorHighlightMeta) === null) {
				return;
			}
			autofixHandlers.delete(update.view);
			update.view.dispatch({ effects: [setTikzErrorHighlight.of(null)] });
		}),
		tikzErrorHighlightTheme,
	];
}
