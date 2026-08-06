/**
 * Auto-close gating and the ccycle caret, against real CodeMirror state.
 *
 * Auto-close used to bind { [ ( $ for the entire editor: typing `(` in prose
 * inserted `()`, `$` inserted `$$` (a display-math fence in Obsidian), and the
 * Backspace pair-delete hijacked ordinary text — all regardless of Obsidian's
 * own auto-pair setting. Every sibling extension gates on the TikZ context;
 * these tests pin that gate.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { autoClose, ccycle } = await loadSrcModules(
	{
		autoClose: 'src/editor/tikzAutoClose.ts',
		ccycle: 'src/editor/tikzCcycleExtension.ts',
	},
	{ external: ['@codemirror/state', '@codemirror/view'] },
);
const { EditorState } = await import('@codemirror/state');
const { keymap } = await import('@codemirror/view');

// Read the bindings back out through the real facet system rather than
// spelunking extension internals.
function keymapHandlers(extension) {
	const state = EditorState.create({ doc: '', extensions: extension });
	return state.facet(keymap).flat();
}

function fakeView(doc, anchor) {
	let state = EditorState.create({ doc, selection: { anchor } });
	return {
		get state() { return state; },
		dispatch(spec) { state = state.update(spec).state; },
	};
}

const PROSE = 'Just a sentence about money $5 and (parens).\n';
const FENCED = '```tikz\n\\begin{tikzpicture}\n\\draw \n\\end{tikzpicture}\n```\n';
const DRAW_LINE_END = FENCED.indexOf('\\draw ') + '\\draw '.length;

const handlers = keymapHandlers(autoClose.tikzAutoCloseExtension(() => true));
assert.ok(handlers.length >= 5, `expected pair + backspace handlers, found ${handlers.length}`);
const openParen = handlers.find(h => h.key === '(');
const dollar = handlers.find(h => h.key === '$');
const backspace = handlers.find(h => h.key === 'Backspace');
assert.ok(openParen && dollar && backspace, 'missing expected key bindings');

// --- prose: every handler must decline -------------------------------------

{
	const view = fakeView(PROSE, 5);
	assert.equal(openParen.run(view), false, '( must not auto-pair in prose');
	assert.equal(dollar.run(view), false, '$ must not auto-pair in prose');
	assert.equal(view.state.doc.toString(), PROSE, 'prose was modified');
}

{
	// Backspace between a pair in prose: default behaviour, not pair-delete.
	const doc = 'a{}b\n';
	const view = fakeView(doc, 2);
	assert.equal(backspace.run(view), false, 'Backspace must not pair-delete in prose');
	assert.equal(view.state.doc.toString(), doc);
}

// --- inside a tikz fence: pairs close, Backspace deletes both ---------------

{
	const view = fakeView(FENCED, DRAW_LINE_END);
	assert.equal(openParen.run(view), true, '( must auto-pair inside a fence');
	const line = view.state.doc.lineAt(DRAW_LINE_END).text;
	assert.ok(line.includes('()'), `pair not inserted: ${JSON.stringify(line)}`);
	assert.equal(view.state.selection.main.head, DRAW_LINE_END + 1, 'caret must sit between the pair');

	assert.equal(backspace.run(view), true, 'Backspace must pair-delete inside a fence');
	assert.equal(view.state.doc.lineAt(DRAW_LINE_END).text, '\\draw ', 'pair not removed');
}

// Disabled setting wins over context.
{
	const disabled = keymapHandlers(autoClose.tikzAutoCloseExtension(() => false));
	const paren = disabled.find(h => h.key === '(');
	const view = fakeView(FENCED, DRAW_LINE_END);
	assert.equal(paren.run(view), false, 'setting off must disable pairing');
}

// --- ccycle: caret lands right after the inserted `cycle` -------------------

{
	// The last coordinate `(1,0)` is reformatted to `(1.00, 0.00)` (+7 chars);
	// the caret math used to ignore that delta and land short.
	const doc = '```tikz\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,0) -- (1,1) -- ccycle\n\\end{tikzpicture}\n```\n';
	const lineStart = doc.indexOf('\\draw');
	const lineText = '\\draw (0,0) -- (1,0) -- (1,1) -- ccycle';
	const head = lineStart + lineText.length;

	let state = EditorState.create({ doc, selection: { anchor: head } });
	const view = {
		get state() { return state; },
		dispatch(spec) { state = state.update(spec).state; },
	};

	// Drive the update listener the way CodeMirror would after typing,
	// reading it back through the real facet.
	const { EditorView } = await import('@codemirror/view');
	const listenerState = EditorState.create({ doc: '', extensions: ccycle.tikzCcycleExtension() });
	const run = listenerState.facet(EditorView.updateListener)[0];
	assert.ok(run, 'could not extract update listener');

	run({ docChanged: true, state, view });

	const newLine = state.doc.lineAt(lineStart).text;
	assert.ok(newLine.endsWith('cycle'), `ccycle not rewritten: ${JSON.stringify(newLine)}`);
	assert.ok(!newLine.includes('ccycle'), 'ccycle text left behind');
	const expectedHead = state.doc.lineAt(lineStart).from + newLine.length;
	assert.equal(
		state.selection.main.head,
		expectedHead,
		`caret at ${state.selection.main.head}, expected ${expectedHead} (end of ${JSON.stringify(newLine)})`,
	);
}

console.log('test-auto-close: ok');
