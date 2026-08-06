/**
 * InlinePreviewManager mode switching: the floating preview must expand into
 * the visual editor in place, keep the block pinned while focus wanders,
 * write visual edits as single transactions into the fence only, survive
 * rerenders and compile failures without dropping out of Edit mode, and
 * collapse cleanly back to the compact preview.
 *
 * Runs the real manager + real visual editor against a scripted Obsidian
 * Editor, so the fence-offset → editor-position mapping is exercised for
 * real — that mapping is where an off-by-one silently corrupts user notes.
 */
import assert from 'node:assert/strict';
import { loadSrcModules, OBSIDIAN_STUB } from './loadSrc.mjs';

let JSDOM;
try {
	({ JSDOM } = await import('jsdom'));
} catch {
	console.log('inline-preview-editmode: skipped (jsdom not installed)');
	process.exit(0);
}

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const { window } = dom;

for (const key of [
	'window', 'document', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'SVGSVGElement',
	'KeyboardEvent', 'Event', 'MutationObserver', 'DOMParser',
	'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
]) {
	Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.activeDocument = window.document;

/* --- Obsidian DOM helper shims ---------------------------------------------- */

function applyOpts(el, opts) {
	if (typeof opts === 'string') {
		el.className = opts;
	} else if (opts) {
		if (opts.cls) el.className = Array.isArray(opts.cls) ? opts.cls.join(' ') : opts.cls;
		if (opts.text) el.textContent = opts.text;
		if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
	}
	return el;
}
const proto = window.HTMLElement.prototype;
proto.createEl = function (tag, opts, cb) {
	const el = applyOpts(window.document.createElement(tag), opts);
	this.appendChild(el);
	cb?.(el);
	return el;
};
proto.createDiv = function (opts, cb) { return this.createEl('div', opts, cb); };
proto.createSpan = function (opts, cb) { return this.createEl('span', opts, cb); };
proto.addClass = function (...cls) { for (const c of cls) this.classList.add(...String(c).split(' ').filter(Boolean)); return this; };
proto.removeClass = function (...cls) { for (const c of cls) this.classList.remove(...String(c).split(' ').filter(Boolean)); return this; };
proto.toggleClass = function (cls, on) { this.classList.toggle(cls, on); return this; };
proto.hasClass = function (cls) { return this.classList.contains(cls); };
proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
proto.setAttr = function (k, v) { this.setAttribute(k, String(v)); return this; };
proto.setText = function (t) { this.textContent = t; return this; };
proto.setCssProps = function (props) { for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v); return this; };
window.Element.prototype.instanceOf = function (cls) { return this instanceof cls; };
globalThis.createDiv = opts => applyOpts(window.document.createElement('div'), opts);
globalThis.createSpan = opts => applyOpts(window.document.createElement('span'), opts);

const { preview } = await loadSrcModules(
	{ preview: 'src/editor/inlinePreview.ts' },
	{
		external: ['@codemirror/state', '@codemirror/view', '@codemirror/commands'],
		stubs: { obsidian: OBSIDIAN_STUB },
	},
);
const { InlinePreviewManager } = preview;

/* --- scripted Obsidian Editor ------------------------------------------------ */

function makeFakeEditor(initialLines, cursor) {
	const state = {
		lines: [...initialLines],
		cursor: { ...cursor },
		transactions: [],
		undoCalls: 0,
		redoCalls: 0,
	};
	const text = () => state.lines.join('\n');
	const offsetOf = pos => {
		let offset = 0;
		for (let line = 0; line < pos.line; line++) {
			offset += state.lines[line].length + 1;
		}
		return offset + pos.ch;
	};
	const editor = {
		getCursor: () => ({ ...state.cursor }),
		setCursor: pos => { state.cursor = { ...pos }; },
		getLine: n => state.lines[n] ?? '',
		lineCount: () => state.lines.length,
		getRange: (from, to) => text().slice(offsetOf(from), offsetOf(to)),
		replaceRange: (insert, from, to) => {
			const doc = text();
			const start = offsetOf(from);
			const end = offsetOf(to ?? from);
			state.lines = (doc.slice(0, start) + insert + doc.slice(end)).split('\n');
		},
		transaction: tx => {
			state.transactions.push(tx);
			const doc = text();
			const changes = [...(tx.changes ?? [])]
				.map(change => ({
					start: offsetOf(change.from),
					end: offsetOf(change.to ?? change.from),
					text: change.text,
				}))
				.sort((a, b) => b.start - a.start);
			let next = doc;
			for (const change of changes) {
				next = next.slice(0, change.start) + change.text + next.slice(change.end);
			}
			state.lines = next.split('\n');
		},
		focus: () => {},
		undo: () => { state.undoCalls += 1; },
		redo: () => { state.redoCalls += 1; },
	};
	return { editor, state, text };
}

/* --- fixture ------------------------------------------------------------------ */

const noteLines = [
	'# Lecture notes',
	'```tikz',
	'\\begin{tikzpicture}',
	'\\draw (0,0) -- (1,1);',
	'\\end{tikzpicture}',
	'```',
	'Prose after the fence.',
];

function makeManager() {
	const { editor, state, text } = makeFakeEditor(noteLines, { line: 3, ch: 0 });
	const containerEl = window.document.createElement('div');
	window.document.body.appendChild(containerEl);
	const view = { containerEl, editor, file: { path: 'note.md' } };

	const renderer = {
		results: [],
		calls: 0,
		renderToSvg() {
			this.calls += 1;
			const next = this.results.shift()
				?? { ok: true, dataUrl: 'data:image/svg+xml,compiled', svgText: '<svg xmlns="http://www.w3.org/2000/svg"/>' };
			return Promise.resolve(next);
		},
	};
	const settings = {
		darkModeStyle: 'none',
		renderEngine: 'lualatex',
	};
	const app = { workspace: { getLeavesOfType: () => [] } };
	const manager = new InlinePreviewManager(
		() => view, renderer, () => settings, () => false, app,
	);
	manager.enabled = true;
	return { manager, view, editorState: state, text, renderer };
}

/* --- entering edit mode -------------------------------------------------------- */

const { manager, view, editorState, text, renderer } = makeManager();

assert.equal(manager.mode, 'preview');
manager.enterEditMode();
assert.equal(manager.mode, 'edit');

const container = view.containerEl.querySelector('.tikzjax-hebrew-local-inline-preview');
assert.ok(container, 'floating preview container must exist');
assert.ok(container.classList.contains('luatikz-edit-mode'), 'container expands via the edit class');
assert.ok(container.querySelector('.luatikz-visual-editor'), 'visual editor mounts inside the same component');
assert.ok(
	container.querySelector('.luatikz-preview-edit-btn').classList.contains('luatikz-ve-hidden'),
	'Edit button hides while editing',
);

// Preview-mode coordinate picking must not arm in edit mode.
container.dispatchEvent(new window.Event('mousedown', { bubbles: true }));
assert.equal(manager.previewInteractionActive, false, 'pick interaction must stay off in edit mode');

// Entering again is a no-op.
const editorInstance = manager.visualEditor;
manager.enterEditMode();
assert.equal(manager.visualEditor, editorInstance);

/* --- visual edits write into the fence only ------------------------------------- */

const body = manager.visualEditor.currentScene.source;
assert.equal(body, '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}\n');

const ok = manager.applyVisualPatches(body, [{
	oldSpan: { from: body.indexOf('(1,1)'), to: body.indexOf('(1,1)') + 5 },
	replacement: '(2.00, 2.00)',
}]);
assert.equal(ok, true);
assert.equal(editorState.transactions.length, 1, 'one patch batch = one transaction');
assert.equal(text().split('\n')[3], '\\draw (0,0) -- (2.00, 2.00);');
// Nothing outside the fence moved.
assert.equal(text().split('\n')[0], '# Lecture notes');
assert.equal(text().split('\n')[6], 'Prose after the fence.');

// Stale-body writes are refused instead of guessing.
assert.equal(
	manager.applyVisualPatches(body, [{ oldSpan: { from: 0, to: 1 }, replacement: 'X' }]),
	false,
	'a mismatched body must refuse the write',
);

/* --- line-count changes keep the pin valid --------------------------------------- */

const body2 = manager.currentEditBlock().source;
const insertAt = body2.indexOf('\\end{tikzpicture}');
manager.applyVisualPatches(body2, [{
	oldSpan: { from: insertAt, to: insertAt },
	replacement: '\\draw (3,3) -- (4,4);\n',
}]);
assert.equal(text().split('\n')[5], '\\end{tikzpicture}');
assert.equal(text().split('\n')[6], '```', 'closing fence must stay a fence');
const revived = manager.currentEditBlock();
assert.ok(revived, 'pin must survive the line shift');
assert.equal(revived.endLine, 6);

/* --- rerender keeps edit mode and feeds the compiled preview ---------------------- */

await manager.updateFromActiveEditor();
assert.equal(manager.mode, 'edit', 'a rerender must not leave edit mode');
assert.equal(manager.visualEditor, editorInstance, 'the editor instance must survive');
const card = container.querySelector('.luatikz-ve-compiled');
assert.ok(card.classList.contains('has-output'));
assert.equal(card.querySelector('img').getAttribute('src'), 'data:image/svg+xml,compiled');

// A failing compile keeps edit mode, the scene, and the last-good output.
renderer.results.push({ ok: false, error: 'Undefined control sequence', userLine: 1 });
manager.lastRenderSource = null; // force a real render
await manager.updateFromActiveEditor();
assert.equal(manager.mode, 'edit');
assert.ok(card.classList.contains('has-error'));
assert.equal(
	card.querySelector('img').getAttribute('src'),
	'data:image/svg+xml,compiled',
	'last good compiled output must remain visible',
);
assert.ok(container.querySelector('.luatikz-visual-editor'), 'editable scene must survive the failure');

/* --- undo host wiring -------------------------------------------------------------- */

manager.visualEditor.root.dispatchEvent(
	new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
);
assert.equal(editorState.undoCalls, 1, 'editor undo must drive CodeMirror history');

/* --- Done: collapse back to the compact preview ------------------------------------- */

manager.exitEditMode();
assert.equal(manager.mode, 'preview');
assert.ok(!container.classList.contains('luatikz-edit-mode'));
assert.equal(container.querySelector('.luatikz-visual-editor'), null, 'editor must be destroyed');
assert.ok(
	!container.querySelector('.luatikz-preview-edit-btn').classList.contains('luatikz-ve-hidden'),
	'Edit button returns in preview mode',
);

// The preview pipeline resumes rendering into the body.
await manager.updateFromActiveEditor();
const previewBody = container.querySelector('.tikzjax-hebrew-local-inline-preview-body');
assert.ok(previewBody.querySelector('svg, img'), 'compact preview must render output again');

/* --- disable() tears edit mode down -------------------------------------------------- */

manager.enterEditMode();
assert.equal(manager.mode, 'edit');
manager.disable();
assert.equal(manager.mode, 'preview');
assert.equal(window.document.querySelector('.luatikz-visual-editor'), null);

console.log('inline-preview-editmode: ok');
