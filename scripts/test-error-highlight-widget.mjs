/**
 * Mounts the real error-highlight extension in a real CodeMirror view and
 * asserts the Fix popup is in the DOM and wired to its handler.
 *
 * This is the regression that motivated the file: buildErrorDecorations added
 * the popup widget *after* the mark decoration covering the same position.
 * RangeSetBuilder wants ranges sorted by `from` then `startSide`, and at equal
 * `from` a widget (startSide 1e8+1) sorts before a mark (startSide 5e8), so
 * the add threw, CodeMirror dropped the view plugin, and the button silently
 * never appeared again. Only the empty-mark-range case still worked, which is
 * why it looked intermittent rather than broken.
 *
 * Those side constants come from whichever CodeMirror Obsidian ships — they
 * are esbuild externals — so this has to be asserted against the real library,
 * not reasoned about.
 */
import assert from 'node:assert/strict';
import { loadSrcModules, OBSIDIAN_STUB } from './loadSrc.mjs';

let JSDOM;
try {
	({ JSDOM } = await import('jsdom'));
} catch {
	console.log('error-highlight-widget: skipped (jsdom not installed)');
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

// The widget builds its DOM with Obsidian's element helpers.
function applyOpts(el, opts = {}) {
	if (opts.cls) el.className = opts.cls;
	if (opts.text) el.textContent = opts.text;
	if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
	return el;
}
globalThis.createDiv = opts => applyOpts(window.document.createElement('div'), opts);
globalThis.createSpan = opts => applyOpts(window.document.createElement('span'), opts);
window.HTMLElement.prototype.createEl = function (tag, opts) {
	const el = applyOpts(window.document.createElement(tag), opts);
	this.appendChild(el);
	return el;
};
window.HTMLElement.prototype.createSpan = function (opts) { return this.createEl('span', opts); };
window.HTMLElement.prototype.createDiv = function (opts) { return this.createEl('div', opts); };
globalThis.activeDocument = window.document;

const { highlight } = await loadSrcModules(
	{ highlight: 'src/editor/tikzErrorHighlight.ts' },
	{ external: ['@codemirror/state', '@codemirror/view'], stubs: { obsidian: OBSIDIAN_STUB } },
);
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');

const DOC = [
	'# note',
	'',
	'```tikz',
	'\\begin{tikzpicture}',
	'\\node[align=] at (0,0) {x};',
	'\\end{tikzpicture}',
	'```',
].join('\n');
const ERROR_NOTE_LINE = 5;

/**
 * Each case gets its own container and its own view, torn down only after the
 * caller has finished with it — the plugin's destroy() drops the autofix
 * handler, so clicking has to happen while the view is still alive.
 */
async function mount(options) {
	const crashes = [];
	const realError = console.error;
	console.error = (...args) => { crashes.push(args.map(String).join(' ')); };

	const container = window.document.body.appendChild(window.document.createElement('div'));
	const view = new EditorView({
		state: EditorState.create({ doc: DOC, extensions: highlight.tikzErrorHighlightExtension() }),
		parent: container,
	});

	let applied = 0;
	highlight.highlightTikzErrorInEditor({ cm: view }, ERROR_NOTE_LINE, {
		onApplyAutofix: () => { applied++; },
		focus: false,
		...options,
	});

	await new Promise(resolve => setTimeout(resolve, 30));
	console.error = realError;

	const popup = container.querySelector('.luatikz-autofix-popup');
	return {
		crashes,
		popup,
		lineHighlight: !!container.querySelector('.luatikz-error-line-highlight'),
		markHighlight: !!container.querySelector('.luatikz-error-mark-highlight'),
		click: () => {
			popup.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
			return applied;
		},
		destroy: () => {
			view.destroy();
			container.remove();
		},
	};
}

const FILL_AUTOFIX = {
	kind: 'fill-option-value',
	label: 'Set align=center',
	optionKey: 'align',
	optionValue: 'center',
};

// Non-empty mark range: the case that used to disable the plugin outright.
const marked = await mount({ autofix: FILL_AUTOFIX, markColumnStart: 6, markColumnEnd: 12 });
assert.deepEqual(marked.crashes, [], 'view plugin must not crash with a non-empty mark range');
assert.ok(marked.lineHighlight, 'error line highlight missing');
assert.ok(marked.markHighlight, 'error mark highlight missing');
assert.ok(marked.popup, 'Fix popup missing for a non-empty mark range');
assert.equal(marked.popup.querySelector('button').textContent, 'Fix');
assert.equal(marked.popup.querySelector('button').getAttribute('title'), 'Set align=center');
assert.equal(marked.click(), 1, 'Fix button did not invoke its handler');
marked.destroy();

// Empty mark range: an append-style fix with nothing to underline.
const empty = await mount({
	autofix: { kind: 'append-semicolon', label: 'Add missing semicolon (;)' },
	markColumnStart: 12,
	markColumnEnd: 12,
});
assert.deepEqual(empty.crashes, [], 'view plugin must not crash with an empty mark range');
assert.ok(empty.popup, 'Fix popup missing for an empty mark range');
assert.equal(empty.markHighlight, false, 'empty range should not paint a mark');
assert.equal(empty.click(), 1, 'Fix button did not invoke its handler');
empty.destroy();

// No autofix: highlight only, and no popup to click.
const bare = await mount({ markColumnStart: 6, markColumnEnd: 12, onApplyAutofix: undefined });
assert.deepEqual(bare.crashes, [], 'view plugin must not crash without an autofix');
assert.ok(bare.lineHighlight, 'error line highlight missing');
assert.equal(bare.popup, null, 'popup must not render without an autofix');
bare.destroy();

console.log('test-error-highlight-widget: ok');
