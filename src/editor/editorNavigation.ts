import { type App, MarkdownView, Notice, TFile, type Editor } from 'obsidian';
import type { RenderImageResult } from '../core/types';
import {
	clearTikzErrorHighlight,
	highlightTikzErrorInEditor,
	replaceEditorLine,
} from './tikzErrorHighlight';
import { applyAutofixToLine, type LatexAutofix } from '../latex/latexAutofix';

export interface TikzEditorErrorLocation {
	noteLine: number;
	autofix?: LatexAutofix;
	markColumnStart?: number;
	markColumnEnd?: number;
}

function applyAutofixAtNoteLine(editor: Editor, noteLine: number, autofix: LatexAutofix): boolean {
	const lineIndex = noteLine - 1;
	const currentLine = editor.getLine(lineIndex);

	if (autofix.kind === 'insert-end-tikzpicture') {
		const insertAt = { line: lineIndex, ch: currentLine.length };
		editor.replaceRange('\n\\end{tikzpicture}', insertAt, insertAt);
		return true;
	}

	const nextLine = applyAutofixToLine(currentLine, autofix);
	if (nextLine === currentLine) {
		return false;
	}

	replaceEditorLine(editor, noteLine, nextLine);
	return true;
}

export interface JumpToTikzErrorOptions extends TikzEditorErrorLocation {
	focus?: boolean;
}

/** The markdown leaf currently showing `sourcePath`, if any. */
function findMarkdownLeafView(app: App, sourcePath: string): MarkdownView | null {
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === sourcePath) {
			return view;
		}
	}
	return null;
}

async function openMarkdownEditor(
	app: App,
	sourcePath: string,
): Promise<{ view: MarkdownView; editor: Editor } | null> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) {
		return null;
	}

	const existingView = findMarkdownLeafView(app, sourcePath);
	const leaf = existingView?.leaf ?? app.workspace.getLeaf(false);
	await leaf.openFile(file);
	app.workspace.setActiveLeaf(leaf, { focus: true });

	const view = leaf.view;
	if (!(view instanceof MarkdownView)) {
		return null;
	}

	return { view, editor: view.editor };
}

function buildHighlightOptions(
	options: TikzEditorErrorLocation & { focus?: boolean },
	onApplyAutofix?: () => void,
) {
	return {
		autofix: options.autofix,
		onApplyAutofix,
		focus: options.focus,
		markColumnStart: options.markColumnStart,
		markColumnEnd: options.markColumnEnd,
	};
}

export async function showTikzErrorInEditor(
	app: App,
	sourcePath: string | undefined,
	location: TikzEditorErrorLocation,
	options: { focus?: boolean } = {},
): Promise<void> {
	if (!sourcePath || location.noteLine === undefined) {
		return;
	}

	const focus = options.focus ?? false;
	const existingView = findMarkdownLeafView(app, sourcePath);
	const opened = existingView
		? { view: existingView, editor: existingView.editor }
		: (focus ? await openMarkdownEditor(app, sourcePath) : null);

	if (!opened) {
		return;
	}

	const applyAutofix = location.autofix
		? () => {
			void applyTikzErrorAutofix(app, sourcePath, location);
		}
		: undefined;

	highlightTikzErrorInEditor(opened.editor, location.noteLine, buildHighlightOptions(
		{ ...location, focus },
		applyAutofix,
	));

	if (focus) {
		opened.editor.focus();
	}
}

export async function jumpToTikzError(
	app: App,
	sourcePath: string,
	options: JumpToTikzErrorOptions,
): Promise<void> {
	const { noteLine } = options;
	if (!Number.isFinite(noteLine) || noteLine < 1) {
		return;
	}

	const opened = await openMarkdownEditor(app, sourcePath);
	if (!opened) {
		return;
	}

	const { editor } = opened;
	const applyAutofix = options.autofix
		? () => {
			void applyTikzErrorAutofix(app, sourcePath, options);
		}
		: undefined;

	highlightTikzErrorInEditor(editor, noteLine, buildHighlightOptions(
		{ ...options, focus: options.focus ?? true },
		applyAutofix,
	));
	editor.focus();
}

export async function applyTikzErrorAutofix(
	app: App,
	sourcePath: string,
	options: JumpToTikzErrorOptions,
): Promise<boolean> {
	const { noteLine, autofix } = options;
	if (!autofix || !Number.isFinite(noteLine) || noteLine < 1) {
		return false;
	}

	const opened = await openMarkdownEditor(app, sourcePath);
	if (!opened) {
		return false;
	}

	const { editor } = opened;
	if (!applyAutofixAtNoteLine(editor, noteLine, autofix)) {
		// Say so rather than leaving a Fix button that appears to do nothing.
		new Notice('LuaTikz: could not apply this fix automatically.');
		return false;
	}
	clearTikzErrorHighlight(editor);
	editor.focus();
	new Notice(autofix.label);
	return true;
}

export function clearTikzErrorHighlightForPath(app: App, sourcePath: string): void {
	const view = findMarkdownLeafView(app, sourcePath);
	if (view) {
		clearTikzErrorHighlight(view.editor);
	}
}

export function showTikzErrorHighlightFromResult(
	app: App,
	sourcePath: string | undefined,
	result: RenderImageResult,
): void {
	if (!sourcePath || result.noteLine === undefined) {
		return;
	}

	const location = {
		noteLine: result.noteLine,
		autofix: result.autofix,
		markColumnStart: result.markColumnStart,
		markColumnEnd: result.markColumnEnd,
	};

	// Deferred a frame: the code block processor is still writing into the DOM,
	// and dispatching into CodeMirror from inside that pass fights the update.
	window.requestAnimationFrame(() => {
		void showTikzErrorInEditor(app, sourcePath, location, { focus: false });
	});
}
