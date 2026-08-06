/**
 * Mounts the real IDE-gutter extension in a real CodeMirror view (jsdom).
 *
 * Guards three regressions:
 * 1. A standalone \begin{tikzpicture} *above* a ```tikz fence produced block
 *    ranges out of document order; the RangeSetBuilder threw and CodeMirror
 *    silently disabled the plugin — no line numbers for the session.
 * 2. The three ViewPlugins had no constructors, so a freshly opened note had
 *    no gutter until the first edit or scroll.
 * 3. The \begin/\end pair highlight returned the cursor's own line in both
 *    branches, so the partner line was never highlighted (and fixing that
 *    exposed an unsorted Decoration.set that would then throw).
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

let JSDOM;
try {
	({ JSDOM } = await import('jsdom'));
} catch {
	console.log('test-ide-gutter: skipped (jsdom not installed)');
	process.exit(0);
}

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const { window } = dom;
for (const key of [
	'window', 'document', 'HTMLElement', 'Element', 'Node', 'Range', 'DocumentFragment',
	'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
	'DOMRect', 'Text', 'CharacterData', 'SVGElement',
]) {
	Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.createSpan = opts => {
	const el = window.document.createElement('span');
	if (opts?.cls) el.className = opts.cls;
	if (opts?.text) el.textContent = opts.text;
	if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
	return el;
};

const { gutter } = await loadSrcModules(
	{ gutter: 'src/editor/tikzIdeGutter.ts' },
	{ external: ['@codemirror/state', '@codemirror/view'] },
);
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');

function mount(doc, anchor) {
	const crashes = [];
	const realError = console.error;
	console.error = (...args) => { crashes.push(args.map(String).join(' ')); };

	const container = window.document.body.appendChild(window.document.createElement('div'));
	const view = new EditorView({
		state: EditorState.create({
			doc,
			selection: anchor !== undefined ? { anchor } : undefined,
			extensions: gutter.tikzIdeExtension(),
		}),
		parent: container,
	});

	console.error = realError;
	return {
		view,
		crashes,
		lineNumbers: () => container.querySelectorAll('.luatikz-inline-line-number').length,
		envPairLines: () => [...container.querySelectorAll('.luatikz-ide-env-pair')],
		destroy: () => { view.destroy(); container.remove(); },
	};
}

// --- 1: standalone tikzpicture ABOVE a fence must not kill the plugin ------

const standaloneAboveFence = [
	'\\begin{tikzpicture}',
	'\\draw (0,0) -- (1,1);',
	'\\end{tikzpicture}',
	'',
	'some prose',
	'',
	'```tikz',
	'\\begin{tikzpicture}',
	'\\draw (2,2) -- (3,3);',
	'\\end{tikzpicture}',
	'```',
].join('\n');

{
	const m = mount(standaloneAboveFence);
	assert.deepEqual(m.crashes, [], 'plugin crashed on standalone-above-fence document');
	// 2: seeded on mount — no dispatch has happened yet.
	assert.ok(m.lineNumbers() > 0, 'no line numbers on first paint');
	m.destroy();
}

// --- 3: env-pair highlights BOTH lines of the pair -------------------------

const scopedDoc = [
	'```tikz',
	'\\begin{tikzpicture}',
	'\\begin{scope}',
	'\\draw (0,0) -- (1,1);',
	'\\end{scope}',
	'\\end{tikzpicture}',
	'```',
].join('\n');

{
	// Anchor on the \begin{scope} line (line 3, 1-based).
	const lines = scopedDoc.split('\n');
	const anchorBegin = lines.slice(0, 2).join('\n').length + 1; // start of line 3
	const m = mount(scopedDoc, anchorBegin);
	assert.deepEqual(m.crashes, [], 'plugin crashed with cursor on \\begin{scope}');
	const pair = m.envPairLines();
	assert.equal(pair.length, 2, `expected 2 env-pair lines, got ${pair.length}`);
	const texts = pair.map(el => el.textContent);
	assert.ok(texts.some(t => t.includes('\\begin{scope}')), 'begin line not highlighted');
	assert.ok(texts.some(t => t.includes('\\end{scope}')), 'end (partner) line not highlighted');
	m.destroy();
}

{
	// Anchor on the \end{scope} line — partner precedes the cursor, which is
	// the ordering that used to require the unsorted-Decoration.set fix.
	const lines = scopedDoc.split('\n');
	const anchorEnd = lines.slice(0, 4).join('\n').length + 1; // start of line 5
	const m = mount(scopedDoc, anchorEnd);
	assert.deepEqual(m.crashes, [], 'plugin crashed with cursor on \\end{scope}');
	const texts = m.envPairLines().map(el => el.textContent);
	assert.equal(texts.length, 2);
	assert.ok(texts.some(t => t.includes('\\begin{scope}')), 'partner (begin) line not highlighted');
	m.destroy();
}

// --- prose documents get no gutter -----------------------------------------

{
	const m = mount('just some prose\n\nwith multiple lines\n');
	assert.deepEqual(m.crashes, []);
	assert.equal(m.lineNumbers(), 0, 'prose must not get line numbers');
	m.destroy();
}

console.log('test-ide-gutter: ok');
