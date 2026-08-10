/**
 * VisualTikzEditor mounted in jsdom: DOM structure, tools, drawing through
 * the real gesture router, selection/move/delete, snapping, touch pan and
 * pinch, stylus priority, source-panel sync, compile-result handling, and
 * listener cleanup.
 *
 * jsdom has no SVG geometry, so the test installs a real affine CTM on the
 * canvas element derived from its viewBox and a fixed 900x600 rect. That
 * makes `clientPointToTikzCoordinate` — the same conversion the coordinate
 * picker uses — run its production math end to end, which is exactly the
 * "one conversion formula everywhere" property the feature depends on.
 */
import assert from 'node:assert/strict';
import { loadSrcModules, installObsidianDomHelpers, OBSIDIAN_STUB } from './loadSrc.mjs';

let JSDOM;
try {
	({ JSDOM } = await import('jsdom'));
} catch {
	console.log('visual-editor-dom: skipped (jsdom not installed)');
	process.exit(0);
}

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const { window } = dom;
installObsidianDomHelpers(window);

for (const key of [
	'window', 'document', 'HTMLElement', 'Element', 'Node', 'SVGElement',
	'SVGSVGElement', 'KeyboardEvent', 'Event', 'MutationObserver',
	'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
]) {
	Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}

const { editor: editorModule, patcher, pick, sceneSvg, colors } = await loadSrcModules(
	{
		editor: 'src/visual/visualEditor.ts',
		patcher: 'src/visual/sourcePatches.ts',
		pick: 'src/utils/coordinatePick.ts',
		sceneSvg: 'src/visual/sceneSvg.ts',
		colors: 'src/visual/tikzColors.ts',
	},
	{ external: ['@codemirror/commands'], stubs: { obsidian: OBSIDIAN_STUB } },
);
const { VisualTikzEditor } = editorModule;
const { applySourcePatches } = patcher;
const { PT_PER_CM } = pick;
const { underlayCalibrationTransform } = sceneSvg;

/* --- SVG geometry stub ------------------------------------------------------ */

const RECT = { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600, x: 0, y: 0 };

function parseViewBox(svg) {
	const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '0 0 1 1').split(' ').map(Number);
	return { x, y, w, h };
}

function installSvgGeometry(svg) {
	svg.getBoundingClientRect = () => ({ ...RECT });
	svg.createSVGPoint = () => ({
		x: 0,
		y: 0,
		matrixTransform(m) {
			return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f };
		},
	});
	svg.getScreenCTM = () => {
		const vb = parseViewBox(svg);
		const scale = RECT.width / vb.w;
		const matrix = {
			a: scale, b: 0, c: 0, d: scale,
			e: RECT.left - vb.x * scale,
			f: RECT.top - vb.y * scale,
			inverse() {
				return {
					a: 1 / this.a, b: 0, c: 0, d: 1 / this.d,
					e: -this.e / this.a, f: -this.f / this.d,
					inverse: this.inverse,
				};
			},
		};
		return matrix;
	};
}

/** Client pixel position of a TikZ cm coordinate under the stubbed CTM. */
function cmToClient(svg, cm) {
	const vb = parseViewBox(svg);
	const scale = RECT.width / vb.w;
	return {
		x: RECT.left + (cm.x * PT_PER_CM - vb.x) * scale,
		y: RECT.top + (-cm.y * PT_PER_CM - vb.y) * scale,
	};
}

/* --- host ------------------------------------------------------------------- */

function makeEditor(initialBody) {
	const state = { body: initialBody, applyCalls: 0, compiles: 0, exits: 0, undos: 0, redos: 0 };
	const host = {
		getBlock: () => ({
			source: state.body,
			startLine: 0,
			endLine: state.body.split('\n').length + 1,
		}),
		applyPatches: (expected, patches) => {
			if (expected !== state.body) {
				return false;
			}
			const result = applySourcePatches(state.body, patches);
			if (result.kind !== 'success') {
				return false;
			}
			state.body = result.source;
			state.applyCalls += 1;
			return true;
		},
		requestCompile: () => { state.compiles += 1; },
		requestExit: () => { state.exits += 1; },
		undo: () => { state.undos += 1; },
		redo: () => { state.redos += 1; },
	};
	const container = window.document.createElement('div');
	window.document.body.appendChild(container);
	const editor = new VisualTikzEditor(host, container, initialBody);
	const svg = editor.root.querySelector('svg.luatikz-ve-canvas');
	installSvgGeometry(svg);
	return { editor, state, svg, container };
}

const mouse = (id, cm, svg, extra = {}) => ({
	pointerId: id,
	pointerType: 'mouse',
	button: 0,
	clientX: cmToClient(svg, cm).x,
	clientY: cmToClient(svg, cm).y,
	...extra,
});
const touchAt = (id, cm, svg) => ({
	pointerId: id,
	pointerType: 'touch',
	clientX: cmToClient(svg, cm).x,
	clientY: cmToClient(svg, cm).y,
});
const penAt = (id, cm, svg) => ({
	pointerId: id,
	pointerType: 'pen',
	pressure: 0.6,
	clientX: cmToClient(svg, cm).x,
	clientY: cmToClient(svg, cm).y,
});

const EMPTY = '\\begin{tikzpicture}\n\\end{tikzpicture}';

/* --- DOM structure and accessibility ---------------------------------------- */

{
	const { editor } = makeEditor(EMPTY);
	const toolbar = editor.root.querySelector('.luatikz-ve-toolbar');
	assert.ok(toolbar);
	assert.equal(toolbar.getAttribute('role'), 'toolbar');
	const toolButtons = editor.root.querySelectorAll('.luatikz-ve-tool-btn');
	assert.equal(toolButtons.length, 13,
		'primary tools (incl. paint) + the Shapes and Circuit menu buttons');
	for (const btn of toolButtons) {
		assert.ok(btn.getAttribute('aria-label'), 'icon buttons need aria-label');
		assert.ok(btn.hasAttribute('aria-pressed'));
		assert.ok(btn.querySelector('svg.luatikz-ve-icon'), `tool button without icon: ${btn.getAttribute('aria-label')}`);
	}
	// All shape tools live in the Shapes menu, triangle included.
	const shapeItems = editor.root.querySelectorAll(
		'.luatikz-ve-shape-menu:not(.luatikz-ve-circuit-menu) .luatikz-ve-shape-item',
	);
	assert.equal(shapeItems.length, 10, 'all shape tools in the menu');
	const shapeTools = [...shapeItems].map(item => item.dataset.tool);
	assert.ok(shapeTools.includes('triangle'), 'triangle tool present');
	// The menu opens from its button, picking an item activates the tool.
	const shapesBtn = editor.root.querySelector('.luatikz-ve-shapes-btn');
	assert.ok(shapesBtn, 'Shapes menu button present');
	assert.ok(editor.root.querySelector('.luatikz-ve-shape-menu').classList.contains('luatikz-ve-hidden'));
	shapesBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(editor.shapeMenuOpen, true, 'menu opens');
	editor.root.querySelector('[data-tool="triangle"]').dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(editor.tool, 'triangle', 'menu item activates the tool');
	assert.equal(editor.shapeMenuOpen, false, 'menu closes after picking');
	assert.equal(shapesBtn.getAttribute('aria-pressed'), 'true', 'Shapes button reflects the active shape');
	// Done keeps a readable text label; the icon-only buttons carry tooltips.
	assert.equal(editor.root.querySelector('.luatikz-ve-done').textContent, 'Done');
	assert.ok(editor.root.querySelector('.luatikz-ve-undo svg'), 'action buttons use icons');
	assert.ok(editor.root.querySelector('.luatikz-ve-done'), 'Done stays visible');
	assert.equal(editor.root.getAttribute('dir'), 'ltr', 'editor UI must not inherit RTL');
	assert.ok(editor.root.querySelector('[role="status"]'), 'aria-live status area');
	// The canvas is an interactive inline SVG — also the mobile surface.
	assert.equal(editor.root.querySelector('.luatikz-ve-canvas').tagName.toLowerCase(), 'svg');
	// Empty picture still gets the stable default workspace (12x8 cm, aspect-fit).
	const vb = editor.currentViewBox;
	assert.ok(vb.w >= 12 * PT_PER_CM - 1e-6, `unusably small canvas: ${vb.w}`);
	editor.destroy();
}

/* --- keyboard tool selection -------------------------------------------------- */

{
	const { editor } = makeEditor(EMPTY);
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
	assert.equal(editor.tool, 'line');
	const lineBtn = editor.root.querySelector('[data-tool="line"]');
	assert.equal(lineBtn.getAttribute('aria-pressed'), 'true');
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
	assert.equal(editor.tool, 'freehand');
	editor.destroy();
}

/* --- drawing: line with grid snapping, one undo step -------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	editor.setTool('line');
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 1.02, y: 0.97 }, svg));
	// Pointer movement must not write anything.
	router.handlePointerMove(mouse(1, { x: 2, y: 1.5 }, svg));
	router.handlePointerMove(mouse(1, { x: 2.5, y: 1.8 }, svg));
	assert.equal(state.applyCalls, 0, 'moves must not touch the document');
	assert.equal(state.compiles, 0, 'moves must not compile');
	router.handlePointerUp(mouse(1, { x: 2.98, y: 2.04 }, svg));

	assert.equal(state.applyCalls, 1, 'one gesture = one transaction');
	assert.equal(state.compiles, 1, 'compile scheduled after the commit');
	// Grid snapping (0.5 cm default) makes the endpoints exact.
	assert.ok(state.body.includes('\\draw (1.00, 1.00) -- (3.00, 2.00);'), state.body);
	// The new object is selected.
	assert.equal(editor.selectionIds.length, 1);
	editor.destroy();
}

/* --- arrow, rectangle, circle ------------------------------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	editor.setTool('arrow');
	router.handlePointerDown(mouse(1, { x: 0, y: 0 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 0 }, svg));
	assert.ok(state.body.includes('\\draw[->] (0.00, 0.00) -- (2.00, 0.00);'), state.body);

	editor.setTool('rect');
	router.handlePointerDown(mouse(2, { x: 0, y: 1 }, svg));
	router.handlePointerUp(mouse(2, { x: 2, y: 3 }, svg));
	assert.ok(state.body.includes('rectangle (2.00, 3.00);'), state.body);

	editor.setTool('circle');
	router.handlePointerDown(mouse(3, { x: -2, y: -2 }, svg));
	router.handlePointerUp(mouse(3, { x: -1, y: -2 }, svg));
	assert.ok(state.body.includes('circle[radius=1cm];'), state.body);
	editor.destroy();
}

/* --- freehand ------------------------------------------------------------------ */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	editor.setTool('freehand');
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 0, y: 0 }, svg));
	for (let i = 1; i <= 30; i++) {
		router.handlePointerMove(mouse(1, { x: i / 6, y: Math.sin(i / 6) }, svg));
	}
	assert.equal(state.applyCalls, 0);
	router.handlePointerUp(mouse(1, { x: 5, y: Math.sin(5) }, svg));
	assert.equal(state.applyCalls, 1);
	assert.match(state.body, /\.\. controls /, 'freehand must fit Béziers');
	editor.destroy();
}

/* --- select, move, delete, duplicate ------------------------------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (1,1) -- (3,2);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');

	// Click the segment midpoint to select.
	router.handlePointerDown(mouse(1, { x: 2, y: 1.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 1.5 }, svg));
	assert.deepEqual(editor.selectionIds, ['p0:s0']);

	// Drag to move by (+0.5, 0): snapped translation, one transaction.
	router.handlePointerDown(mouse(2, { x: 2, y: 1.5 }, svg));
	router.handlePointerMove(mouse(2, { x: 2.52, y: 1.51 }, svg));
	router.handlePointerUp(mouse(2, { x: 2.52, y: 1.51 }, svg));
	assert.ok(state.body.includes('(1.50, 1.00) -- (3.50, 2.00)'), state.body);
	assert.equal(state.applyCalls, 1);

	// Selection survives the resync.
	assert.deepEqual(editor.selectionIds, ['p0:s0']);

	// Duplicate, then delete both.
	editor.duplicateSelection();
	assert.equal((state.body.match(/\\draw/g) ?? []).length, 2);

	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
	assert.equal((state.body.match(/\\draw/g) ?? []).length, 1, 'delete removes the selection');

	// Cmd+Backspace (macOS delete) must also delete the selection.
	router.handlePointerDown(mouse(3, { x: 3, y: 1 }, svg));
	router.handlePointerUp(mouse(3, { x: 3, y: 1 }, svg));
	assert.equal(editor.selectionIds.length, 1, 'remaining duplicate is selectable');
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', {
		key: 'Backspace', metaKey: true, bubbles: true,
	}));
	assert.equal((state.body.match(/\\draw/g) ?? []).length, 0, 'Cmd+Backspace deletes the selection');
	editor.destroy();
}

/* --- marquee (box) selection ----------------------------------------------------- */

{
	const body = [
		'\\begin{tikzpicture}',
		'\\draw (1,1) -- (2,2);',
		'\\draw (4,-1) circle[radius=0.5cm];',
		'\\end{tikzpicture}',
	].join('\n');
	const { editor, state, svg } = makeEditor(body);
	editor.setTool('select');
	const router = editor.gestureRouter;

	// A box fully containing the line (but not the circle) selects only it.
	router.handlePointerDown(mouse(1, { x: 0.5, y: 0.5 }, svg));
	router.handlePointerMove(mouse(1, { x: 2.5, y: 2.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 2.5, y: 2.5 }, svg));
	assert.deepEqual(editor.selectionIds, ['p0:s0'], 'fully contained object must be selected');

	// A box fully containing both selects both.
	router.handlePointerDown(mouse(2, { x: 0, y: -2.5 }, svg));
	router.handlePointerMove(mouse(2, { x: 5.5, y: 3 }, svg));
	router.handlePointerUp(mouse(2, { x: 5.5, y: 3 }, svg));
	assert.equal(editor.selectionIds.length, 2);

	// A box only partially covering the circle must not select it. (Starts
	// outside every shape: starting inside a selected shape would move it.)
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	router.handlePointerDown(mouse(3, { x: 3.3, y: -1.9 }, svg));
	router.handlePointerMove(mouse(3, { x: 4.2, y: -0.2 }, svg));
	router.handlePointerUp(mouse(3, { x: 4.2, y: -0.2 }, svg));
	assert.deepEqual(editor.selectionIds, [], 'partially covered objects stay unselected');

	// A plain tap inside the circle's hollow interior selects it.
	router.handlePointerDown(mouse(4, { x: 4, y: -1 }, svg));
	router.handlePointerUp(mouse(4, { x: 4, y: -1 }, svg));
	assert.deepEqual(editor.selectionIds, ['p0:s1'], 'tap inside a shape must select it');

	// Dragging from inside the selected circle moves it (snapped by 0.5).
	router.handlePointerDown(mouse(5, { x: 4, y: -1 }, svg));
	router.handlePointerMove(mouse(5, { x: 4.52, y: -0.48 }, svg));
	router.handlePointerUp(mouse(5, { x: 4.52, y: -0.48 }, svg));
	assert.ok(
		state.body.includes('(4.50, -0.50) circle'),
		`interior drag must move the selected shape: ${state.body}`,
	);
	editor.destroy();
}

/* --- locked ghosts must not block box selection ----------------------------------- */

{
	// A scope keeps its statements source-only (with a ghost); `to[bend left]`
	// itself is editable since the circuit tools landed.
	const body = [
		'\\begin{tikzpicture}',
		'\\begin{scope}',
		'\\draw (0,0) -- (6,0);',
		'\\end{scope}',
		'\\draw (1,1) -- (2,2);',
		'\\end{tikzpicture}',
	].join('\n');
	const { editor, state, svg } = makeEditor(body);
	editor.setTool('select');
	const router = editor.gestureRouter;

	// Start the box right on the locked ghost's geometry: the drag must still
	// become a box selection and pick up the editable line inside it.
	router.handlePointerDown(mouse(1, { x: 3, y: 0.02 }, svg));
	router.handlePointerMove(mouse(1, { x: 0.5, y: 2.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 0.5, y: 2.5 }, svg));
	assert.deepEqual(editor.selectionIds, ['p0:s1'], 'marquee must work from a locked ghost');

	// A plain tap on the ghost selects it and explains its limits…
	router.handlePointerDown(mouse(2, { x: 3, y: 0.02 }, svg));
	router.handlePointerUp(mouse(2, { x: 3, y: 0.02 }, svg));
	assert.deepEqual(editor.selectionIds, ['p0:s0']);
	assert.match(
		editor.root.querySelector('[role="status"]').textContent,
		/Source panel/,
	);

	// …and Delete removes it like any other selected object.
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
	assert.ok(!state.body.includes('(0,0) -- (6,0)'), 'delete must remove source-only statements too');
	assert.ok(state.body.includes('(1,1) -- (2,2)'), 'other statements stay untouched');
	editor.destroy();
}

/* --- endpoint (handle) editing -------------------------------------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (1,1) -- (3,2);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');
	router.handlePointerDown(mouse(1, { x: 2, y: 1.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 1.5 }, svg));

	// Grab the (3,2) endpoint handle and drag it to (4,3).
	router.handlePointerDown(mouse(2, { x: 3, y: 2 }, svg));
	router.handlePointerMove(mouse(2, { x: 3.98, y: 3.02 }, svg));
	router.handlePointerUp(mouse(2, { x: 3.98, y: 3.02 }, svg));
	assert.ok(state.body.includes('(1,1) -- (4.00, 3.00)'), state.body);
	editor.destroy();
}

/* --- transformed pictures: drag maps back through the inverse -------------------- */

{
	// rotate=90 displays (1,0)--(2,0) vertically at x=0; dragging the line
	// 0.5 to the right on screen must translate the SOURCE by (0, -0.5).
	const body = '\\begin{tikzpicture}[rotate=90]\n\\draw (1,0) -- (2,0);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');

	router.handlePointerDown(mouse(1, { x: 0, y: 1.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 0, y: 1.5 }, svg));
	assert.equal(editor.selectionIds.length, 1, 'rotated-picture object must be selectable');

	router.handlePointerDown(mouse(2, { x: 0, y: 1.5 }, svg));
	router.handlePointerMove(mouse(2, { x: 0.52, y: 1.51 }, svg));
	router.handlePointerUp(mouse(2, { x: 0.52, y: 1.51 }, svg));
	assert.ok(
		state.body.includes('(1.00, -0.50) -- (2.00, -0.50)'),
		`rotated drag must inverse-map the delta: ${state.body}`,
	);
	editor.destroy();
}

{
	// scale=2 displays (1,1)--(2,1) at (2,2)--(4,2); a 0.5 display drag is a
	// 0.25 source translation.
	const body = '\\begin{tikzpicture}[scale=2]\n\\draw (1,1) -- (2,1);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');

	router.handlePointerDown(mouse(1, { x: 3, y: 2 }, svg));
	router.handlePointerUp(mouse(1, { x: 3, y: 2 }, svg));
	router.handlePointerDown(mouse(2, { x: 3, y: 2 }, svg));
	router.handlePointerMove(mouse(2, { x: 3.52, y: 2.01 }, svg));
	router.handlePointerUp(mouse(2, { x: 3.52, y: 2.01 }, svg));
	assert.ok(
		state.body.includes('(1.25, 1.00) -- (2.25, 1.00)'),
		`scaled drag must divide the delta by the scale: ${state.body}`,
	);
	editor.destroy();
}

/* --- triangle tool ---------------------------------------------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	editor.setTool('triangle');
	router.handlePointerDown(mouse(1, { x: 2, y: 2 }, svg));
	router.handlePointerMove(mouse(1, { x: 2, y: 3 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 3 }, svg));
	assert.ok(state.body.includes('-- cycle'), `triangle closes: ${state.body}`);
	const pairs = state.body.match(/\(-?\d+\.\d+, -?\d+\.\d+\)/g) ?? [];
	assert.equal(pairs.length, 3, `triangle has three vertices: ${state.body}`);
	assert.ok(state.body.includes('(2.00, 3.00)'), 'apex at the drag end');
	editor.destroy();
}

/* --- Hebrew auto-wrap in text nodes ---------------------------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	const typeNode = (text, at) => {
		editor.setTool('text');
		router.handlePointerDown(mouse(9, at, svg));
		router.handlePointerUp(mouse(9, at, svg));
		const input = editor.root.querySelector('.luatikz-ve-text-input-field');
		input.value = text;
		input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	};

	typeNode('שלום עולם', { x: 1, y: 1 });
	assert.ok(state.body.includes('{\\he{שלום עולם}}'), `hebrew wrapped: ${state.body}`);

	typeNode('abc שלום def', { x: 2, y: 2 });
	assert.ok(state.body.includes('{abc \\he{שלום} def}'), `mixed runs wrapped individually: ${state.body}`);

	typeNode('\\he{שלום} כבר עטוף', { x: 3, y: 3 });
	assert.ok(
		state.body.includes('{\\he{שלום} כבר עטוף}'),
		`manually wrapped text is left alone: ${state.body}`,
	);

	typeNode('plain latin', { x: 0.5, y: 0.5 });
	assert.ok(state.body.includes('{plain latin}'), 'latin text untouched');
	editor.destroy();
}

/* --- freehand hold-to-snap -------------------------------------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	editor.setTool('freehand');
	router.handlePointerDown(penAt(1, { x: 0, y: 0 }, svg));
	for (let index = 1; index <= 20; index++) {
		router.handlePointerMove(penAt(1, {
			x: (3 * index) / 20,
			y: index % 2 ? 0.02 : -0.02,
		}, svg));
	}
	// The hold timer would fire this after FREEHAND_HOLD_MS of stillness.
	assert.equal(editor.recognizeFreehandNow(), true, 'wobbly straight stroke recognized');
	router.handlePointerUp(penAt(1, { x: 3, y: 0 }, svg));
	assert.match(
		state.body,
		/\\draw \(0\.00, 0\.00\) -- \(3\.00, -?0\.02\);/,
		`stroke snapped to a clean line: ${state.body}`,
	);
	assert.ok(!state.body.includes('controls'), 'no freehand bezier once snapped');
	editor.destroy();
}

/* --- function plotter ------------------------------------------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	editor.setTool('plot');
	router.handlePointerDown(mouse(1, { x: 1, y: 1 }, svg));
	router.handlePointerUp(mouse(1, { x: 1, y: 1 }, svg));
	const overlay = editor.root.querySelector('.luatikz-ve-plot-input');
	assert.ok(overlay, 'plot dialog opens');
	const inputs = overlay.querySelectorAll('input');
	inputs[0].value = 'x^2';
	inputs[1].value = '-1';
	inputs[2].value = '1';
	overlay.querySelector('.luatikz-ve-text-confirm').dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.ok(
		state.body.includes('\\draw[domain=-1:1, samples=120, smooth] plot (\\x, {\\x^2});'),
		`plot committed as native TikZ plot: ${state.body}`,
	);
	const plotObject = editor.currentScene.objects.find(object => object.type === 'path');
	assert.ok(plotObject, 'plot parses back as an editable path object');
	assert.equal(plotObject.elements[0].kind, 'plot');
	assert.deepEqual(plotObject.plotDomain, { from: -1, to: 1 });

	// Dragging the curve writes a shift option — expression and domain stay
	// exactly as written.
	editor.setTool('select');
	router.handlePointerDown(mouse(2, { x: 0, y: 0 }, svg));
	router.handlePointerMove(mouse(2, { x: 0.52, y: 0.01 }, svg));
	router.handlePointerUp(mouse(2, { x: 0.52, y: 0.01 }, svg));
	assert.ok(
		state.body.includes('shift={(0.50, 0.00)}'),
		`plot drag adds a shift option: ${state.body}`,
	);
	assert.ok(state.body.includes('plot (\\x, {\\x^2})'), 'expression untouched by the drag');
	editor.destroy();
}

/* --- rotation --------------------------------------------------------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (1,0) -- (3,0);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');
	router.handlePointerDown(mouse(1, { x: 2, y: 0 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 0 }, svg));
	assert.equal(editor.selectionIds.length, 1);

	// The rotate grip sits 26 px above the selection's top edge. The editor
	// derives px→cm from its internal viewBox (the svg attribute lags in
	// jsdom because rAF never flushes), so compute the offset from that.
	const gripOffsetCm = 26 / ((RECT.width / editor.currentViewBox.w) * PT_PER_CM);
	const grip = { x: 2, y: gripOffsetCm };
	// Dragging the grip a quarter turn (shift snaps to 15° steps).
	router.handlePointerDown(mouse(2, grip, svg));
	router.handlePointerMove(mouse(2, { x: 2 - gripOffsetCm, y: 0 }, svg, { shiftKey: true }));
	router.handlePointerUp(mouse(2, { x: 2 - gripOffsetCm, y: 0 }, svg, { shiftKey: true }));
	assert.ok(
		state.body.includes('(2.00, -1.00) -- (2.00, 1.00)'),
		`line rotated 90° about its center: ${state.body}`,
	);
	editor.destroy();
}

{
	// Rectangles cannot express their own rotation: the statement is
	// rewritten as a closed polyline through the rotated corners.
	const body = '\\begin{tikzpicture}\n\\draw[thick] (0,0) rectangle (2,1);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');
	router.handlePointerDown(mouse(1, { x: 1, y: 1 }, svg));
	router.handlePointerUp(mouse(1, { x: 1, y: 1 }, svg));
	assert.equal(editor.selectionIds.length, 1, 'rectangle selected via its edge');

	const gripOffsetCm = 26 / ((RECT.width / editor.currentViewBox.w) * PT_PER_CM);
	const grip = { x: 1, y: 1 + gripOffsetCm };
	const radius = 0.5 + gripOffsetCm;
	router.handlePointerDown(mouse(2, grip, svg));
	router.handlePointerMove(mouse(2, { x: 1 - radius, y: 0.5 }, svg, { shiftKey: true }));
	router.handlePointerUp(mouse(2, { x: 1 - radius, y: 0.5 }, svg, { shiftKey: true }));
	assert.ok(!state.body.includes('rectangle'), `rectangle became a polyline: ${state.body}`);
	assert.ok(state.body.includes('[thick]'), 'options survive the rewrite');
	assert.ok(state.body.includes('-- cycle'), 'polyline closes');
	// 90° CCW about (1, 0.5): (0,0) → (1.5, -0.5); (2,1) → (0.5, 1.5).
	assert.ok(state.body.includes('(1.50, -0.50)'), state.body);
	assert.ok(state.body.includes('(0.50, 1.50)'), state.body);
	editor.destroy();
}

/* --- stacked objects: repeated tap cycles through candidates ---------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,0);\n\\draw (0,0) -- (2,0);\n\\end{tikzpicture}';
	const { editor, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	editor.setTool('select');
	const tap = () => {
		router.handlePointerDown(mouse(1, { x: 1, y: 0 }, svg));
		router.handlePointerUp(mouse(1, { x: 1, y: 0 }, svg));
	};
	tap();
	const first = editor.selectionIds[0];
	tap();
	const second = editor.selectionIds[0];
	assert.notEqual(second, first, 'repeated tap selects the object underneath');
	tap();
	assert.equal(editor.selectionIds[0], first, 'third tap cycles back to the top');
	editor.destroy();
}

/* --- objects panel: list, hide/show, delete --------------------------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);\n\\end{tikzpicture}';
	const { editor, state } = makeEditor(body);
	editor.togglePanel('objects', true);
	let rows = editor.root.querySelectorAll('.luatikz-ve-object-row');
	assert.equal(rows.length, 2, 'both statements listed');

	// Untick the first row: the statement is commented out with %~ markers,
	// disappears from the scene, but stays listed as a hidden row.
	rows[0].querySelector('.luatikz-ve-object-visible')
		.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('%~\\draw (0,0) -- (1,0);'), `hidden via marker: ${state.body}`);
	assert.equal(editor.currentScene.objects.length, 1, 'hidden object leaves the scene');
	rows = editor.root.querySelectorAll('.luatikz-ve-object-row');
	assert.equal(rows.length, 2, 'hidden object still listed');
	assert.ok(rows[1].classList.contains('is-hidden'), 'hidden row marked');

	// Tick it back: the marker is stripped and the object returns.
	rows[1].querySelector('.luatikz-ve-object-visible')
		.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(!state.body.includes('%~'), `restored: ${state.body}`);
	assert.equal(editor.currentScene.objects.length, 2);

	// Row click selects; the delete button removes the statement.
	rows = editor.root.querySelectorAll('.luatikz-ve-object-row');
	rows[0].querySelector('.luatikz-ve-object-label')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(editor.selectionIds.length, 1, 'row click selects the object');
	rows = editor.root.querySelectorAll('.luatikz-ve-object-row');
	rows[1].querySelector('.luatikz-ve-object-delete')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.ok(!state.body.includes('(0,1) -- (1,1)'), `deleted from the panel: ${state.body}`);
	assert.equal(editor.currentScene.objects.length, 1);
	editor.destroy();
}

/* --- style updates through the properties panel --------------------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (1,1) -- (3,2);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 2, y: 1.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 1.5 }, svg));

	const redSwatch = editor.root.querySelector(
		'.luatikz-ve-props-colorrow .luatikz-ve-swatch[data-color="red"]',
	);
	redSwatch.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.ok(state.body.includes('\\draw[red] (1,1) -- (3,2);'), state.body);

	// The custom color input writes a readable xcolor mix (`a!p!b`), never
	// the inline {rgb,…} form, and the mix approximates the picked color.
	const customInput = editor.root.querySelector(
		'.luatikz-ve-props-colorrow .luatikz-ve-swatch-custom',
	);
	customInput.value = '#123456';
	customInput.dispatchEvent(new window.Event('change', { bubbles: true }));
	const colorMatch = state.body.match(/\\draw\[(?:draw=)?([^\],]+)\] \(1,1\) -- \(3,2\);/);
	assert.ok(colorMatch, `custom color written into options: ${state.body}`);
	assert.ok(!colorMatch[1].includes('{'), `mix syntax, not inline rgb: ${colorMatch[1]}`);
	assert.match(colorMatch[1], /^[a-z]+(!\d+(![a-z]+)?)*$/, colorMatch[1]);
	const writtenRgb = colors.tikzColorToRgb(colorMatch[1]);
	const colorError = Math.hypot(writtenRgb[0] - 18, writtenRgb[1] - 52, writtenRgb[2] - 86);
	assert.ok(colorError < 45, `mix approximates #123456 (${colorMatch[1]}, off by ${colorError.toFixed(1)})`);

	// A locked-only selection disables the style controls.
	const lockedBody = '\\begin{tikzpicture}\n\\begin{scope}\n\\draw (0,0) -- (6,0);\n\\end{scope}\n\\end{tikzpicture}';
	const second = makeEditor(lockedBody);
	second.editor.setTool('select');
	second.editor.gestureRouter.handlePointerDown(mouse(1, { x: 3, y: 0.02 }, second.svg));
	second.editor.gestureRouter.handlePointerUp(mouse(1, { x: 3, y: 0.02 }, second.svg));
	assert.equal(second.editor.selectionIds.length, 1, 'tap must select the locked ghost');
	const lockedSwatch = second.editor.root.querySelector(
		'.luatikz-ve-props-colorrow .luatikz-ve-swatch[data-color="red"]',
	);
	assert.equal(lockedSwatch.disabled, true, 'locked selection must disable style swatches');
	second.editor.destroy();
	editor.destroy();
}

/* --- gradients, patterns, shades, and arrow tips through the panel --------------- */

function propsControlByLabel(editor, label) {
	for (const row of editor.root.querySelectorAll('.luatikz-ve-props-row')) {
		const labelEl = row.querySelector('.luatikz-ve-props-label');
		if (labelEl && labelEl.textContent === label) {
			return row.querySelector('select, input');
		}
	}
	return null;
}

{
	const body = '\\begin{tikzpicture}\n\\draw (0,0) rectangle (2,2);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 1, y: 2 }, svg));
	router.handlePointerUp(mouse(1, { x: 1, y: 2 }, svg));
	assert.equal(editor.selectionIds.length, 1, 'rectangle selected');

	// Vertical gradient from the Fill style select.
	const fillStyle = propsControlByLabel(editor, 'Fill style');
	assert.ok(fillStyle, 'Fill style select present');
	fillStyle.value = 'vertical';
	fillStyle.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.match(state.body, /\\draw\[top color=[^,\]]+, bottom color=[^\]]+\] \(0,0\) rectangle \(2,2\);/,
		`gradient written: ${state.body}`);

	// The contextual gradient rows only show for gradient modes.
	const fromRow = propsControlByLabel(editor, 'From color').closest('.luatikz-ve-props-row');
	assert.ok(!fromRow.classList.contains('luatikz-ve-hidden'), 'gradient rows visible');

	// Switching to a pattern replaces the gradient, loads the library, and —
	// for the editor's wide default — declares the pattern in the fence.
	fillStyle.value = 'pattern';
	fillStyle.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('pattern=north east lines wide'), `pattern written: ${state.body}`);
	assert.ok(!state.body.includes('top color='), 'gradient replaced by pattern');
	assert.ok(state.body.startsWith('\\usetikzlibrary{patterns}'),
		`patterns library auto-loaded: ${state.body}`);
	assert.ok(state.body.includes('\\pgfdeclarepatternformonly{north east lines wide}'),
		`wide-lines declaration auto-inserted: ${state.body}`);
	assert.ok(fromRow.classList.contains('luatikz-ve-hidden'), 'gradient rows hide for patterns');

	// The editor's own "diagonal stripes" pattern brings its declaration along.
	const patternSelect = propsControlByLabel(editor, 'Pattern');
	patternSelect.value = 'diagonal stripes';
	patternSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('pattern=diagonal stripes'),
		`diagonal stripes written: ${state.body}`);
	assert.ok(state.body.includes('\\pgfdeclarepatternformonly{diagonal stripes}'),
		`stripes declaration auto-inserted: ${state.body}`);
	assert.equal(state.body.match(/pgfdeclarepatternformonly\{diagonal stripes\}/g).length, 1,
		'stripes declaration inserted once');
	// Re-applying does not duplicate the declaration or the library line.
	patternSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.equal(state.body.match(/pgfdeclarepatternformonly\{diagonal stripes\}/g).length, 1,
		'stripes declaration stays single after re-apply');
	assert.equal(state.body.match(/pgfdeclarepatternformonly\{north east lines wide\}/g).length, 1,
		'wide-lines declaration stays single');
	assert.equal(state.body.match(/\\usetikzlibrary\{patterns\}/g).length, 1,
		'library line stays single');

	// Back to solid: pattern tokens go away again.
	fillStyle.value = 'solid';
	fillStyle.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(!state.body.includes('pattern='), `solid clears the pattern: ${state.body}`);
	editor.destroy();
}

{
	const body = '\\begin{tikzpicture}\n\\draw (1,1) -- (3,2);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 2, y: 1.5 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 1.5 }, svg));

	// Stroke "None" writes draw=none; picking a color afterwards replaces it.
	const noneSwatch = editor.root.querySelector(
		'.luatikz-ve-props-colorrow .luatikz-ve-swatch-none',
	);
	assert.ok(noneSwatch, 'stroke row offers a None swatch');
	noneSwatch.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.ok(state.body.includes('\\draw[draw=none]'), `no-outline written: ${state.body}`);
	assert.ok(noneSwatch.classList.contains('is-active'), 'None swatch reflects selection');

	// Shade slider: red + lighten writes an xcolor shade of the base color.
	const redSwatch = editor.root.querySelector(
		'.luatikz-ve-props-colorrow .luatikz-ve-swatch[data-color="red"]',
	);
	redSwatch.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.ok(state.body.includes('\\draw[red]'), state.body);
	assert.ok(!state.body.includes('draw=none'), `picking a color clears draw=none: ${state.body}`);
	const shadeSlider = editor.root.querySelector('.luatikz-ve-props-shade');
	shadeSlider.value = '40';
	shadeSlider.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('\\draw[red!60]'), `lighter shade written: ${state.body}`);
	shadeSlider.value = '-40';
	shadeSlider.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('\\draw[red!60!black]'), `darker shade written: ${state.body}`);

	// Arrow tip select writes an arrows.meta spec and keeps it on direction edits.
	const tipSelect = propsControlByLabel(editor, 'Arrow tip');
	tipSelect.value = 'Stealth';
	tipSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('-{Stealth}'), `tip spec written: ${state.body}`);
	const arrowsSelect = propsControlByLabel(editor, 'Arrows');
	arrowsSelect.value = '<->';
	arrowsSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.ok(state.body.includes('{Stealth}-{Stealth}'), `direction keeps tip: ${state.body}`);
	editor.destroy();
}

/* --- circuit components menu ------------------------------------------------------ */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;

	// The Circuit button opens its menu; picking Resistor activates the tool.
	const circuitBtn = editor.root.querySelector('.luatikz-ve-circuit-btn');
	assert.ok(circuitBtn, 'Circuit menu button present');
	circuitBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(editor.circuitMenuOpen, true, 'circuit menu opens');
	const items = editor.root.querySelectorAll('[data-component]');
	assert.ok(items.length >= 13, `all components listed, got ${items.length}`);
	editor.root.querySelector('[data-component="resistor"]')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(editor.tool, 'circuit', 'component item activates the circuit tool');
	assert.equal(editor.circuitMenuOpen, false, 'menu closes after picking');

	// A translucent preview follows the cursor before the drop.
	svg.dispatchEvent(new window.MouseEvent('pointermove', {
		clientX: cmToClient(svg, { x: 1, y: 0 }).x,
		clientY: cmToClient(svg, { x: 1, y: 0 }).y,
		bubbles: true,
	}));
	editor.renderNow();
	assert.ok(editor.root.querySelector('.luatikz-ve-circuit-preview'),
		'hover shows the component preview');

	// A single click drops the bipole (2cm span centered on the click) as a
	// native circuitikz statement — no drag needed.
	router.handlePointerDown(mouse(1, { x: 1, y: 0 }, svg));
	router.handlePointerUp(mouse(1, { x: 1, y: 0 }, svg));
	assert.ok(state.body.includes('\\draw (0.00, 0.00) to[R] (2.00, 0.00);'),
		`resistor written: ${state.body}`);
	assert.equal(editor.currentScene.objects.filter(object => object.type === 'locked').length, 0,
		'placed component stays editable');

	// The endpoints are draggable like any line (tap the lead wire).
	editor.setTool('select');
	router.handlePointerDown(mouse(2, { x: 0.3, y: 0 }, svg));
	router.handlePointerUp(mouse(2, { x: 0.3, y: 0 }, svg));
	assert.equal(editor.selectionIds.length, 1, 'component selectable');
	router.handlePointerDown(mouse(3, { x: 2, y: 0 }, svg));
	router.handlePointerMove(mouse(3, { x: 3.02, y: 0.98 }, svg));
	router.handlePointerUp(mouse(3, { x: 3.02, y: 0.98 }, svg));
	assert.ok(state.body.includes('to[R] (3.00, 1.00);'),
		`endpoint drag rewrites only the coordinate: ${state.body}`);

	// A voltage source drops as the american (+/−) form and brings the
	// version-safe sign-rotation setting with it, once.
	editor.root.querySelector('.luatikz-ve-circuit-btn')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	editor.root.querySelector('[data-component="voltage-source"]')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	router.handlePointerDown(mouse(4, { x: 1, y: -1 }, svg));
	router.handlePointerUp(mouse(4, { x: 1, y: -1 }, svg));
	assert.ok(state.body.includes('to[american voltage source] (2.00, -1.00);'),
		`voltage source: ${state.body}`);
	assert.ok(state.body.includes('\\ctikzset{sources/symbol/sign rotation/.initial=auto}'),
		`sign-rotation setting inserted: ${state.body}`);
	router.handlePointerDown(mouse(6, { x: 1, y: -3 }, svg));
	router.handlePointerUp(mouse(6, { x: 1, y: -3 }, svg));
	assert.equal(state.body.match(/sign rotation/g).length, 1,
		'sign-rotation setting inserted once');

	editor.root.querySelector('.luatikz-ve-circuit-btn')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	editor.root.querySelector('[data-component="ground"]')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	router.handlePointerDown(mouse(5, { x: 1, y: -2 }, svg));
	router.handlePointerUp(mouse(5, { x: 1, y: -2 }, svg));
	assert.ok(state.body.includes('\\node[ground] at (1.00, -2.00) {};'),
		`ground node placed: ${state.body}`);

	// The junction dot and the rectangular resistor variant.
	editor.root.querySelector('.luatikz-ve-circuit-btn')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	editor.root.querySelector('[data-component="dot"]')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	router.handlePointerDown(mouse(7, { x: 2, y: -2 }, svg));
	router.handlePointerUp(mouse(7, { x: 2, y: -2 }, svg));
	assert.ok(state.body.includes('\\node[circ] at (2.00, -2.00) {};'),
		`junction dot placed: ${state.body}`);

	editor.root.querySelector('.luatikz-ve-circuit-btn')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	editor.root.querySelector('[data-component="resistor-box"]')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	router.handlePointerDown(mouse(8, { x: 1, y: -4 }, svg));
	router.handlePointerUp(mouse(8, { x: 1, y: -4 }, svg));
	assert.ok(state.body.includes('to[generic] (2.00, -4.00);'),
		`box resistor placed: ${state.body}`);
	editor.destroy();
}

/* --- painter tool ---------------------------------------------------------------- */

{
	// Clicking inside a closed shape fills the shape itself.
	const body = '\\begin{tikzpicture}\n\\draw (0,0) rectangle (2,2);\n\\end{tikzpicture}';
	const { editor, state, svg } = makeEditor(body);
	const router = editor.gestureRouter;
	// Pick a red fill with nothing selected: the painter uses the defaults.
	const fillRed = editor.root.querySelectorAll(
		'.luatikz-ve-props-colorrow',
	)[1].querySelector('.luatikz-ve-swatch[data-color="red"]');
	fillRed.dispatchEvent(new window.Event('click', { bubbles: true }));

	editor.setTool('paint');
	router.handlePointerDown(mouse(1, { x: 1, y: 1 }, svg));
	router.handlePointerUp(mouse(1, { x: 1, y: 1 }, svg));
	assert.ok(state.body.includes('\\draw[fill=red] (0,0) rectangle (2,2);'),
		`painter fills the matching shape: ${state.body}`);

	// Clicking outside every shape changes nothing.
	const before = state.body;
	router.handlePointerDown(mouse(1, { x: 6, y: 6 }, svg));
	router.handlePointerUp(mouse(1, { x: 6, y: 6 }, svg));
	assert.equal(state.body, before, 'open region leaves the source alone');
	editor.destroy();
}

{
	// A region bounded by several strokes becomes a traced \fill path,
	// inserted before the strokes so they stay painted on top.
	const body = [
		'\\begin{tikzpicture}',
		'\\draw (0,0) circle[radius=2cm];',
		'\\draw (-2,0) -- (2,0);',
		'\\end{tikzpicture}',
	].join('\n');
	const { editor, state, svg } = makeEditor(body);
	editor.setTool('paint');
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 0, y: 1 }, svg));
	router.handlePointerUp(mouse(1, { x: 0, y: 1 }, svg));
	assert.match(state.body, /\\fill[^;]* -- cycle;/s, `traced fill written: ${state.body}`);
	assert.ok(state.body.indexOf('\\fill') < state.body.indexOf('circle['),
		'fill inserted before the strokes that bound it');
	const reparsed = editor.currentScene;
	assert.equal(reparsed.objects.filter(object => object.type === 'locked').length, 0,
		'traced fill parses back editable');
	// The painted statement is selected for immediate restyling.
	assert.equal(editor.selectionIds.length, 1, 'painted region selected');
	editor.destroy();
}

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	editor.setTool('path');
	for (const cm of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]) {
		router.handlePointerDown(mouse(9, cm, svg));
		router.handlePointerUp(mouse(9, cm, svg));
	}
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	assert.ok(
		state.body.includes('(0.00, 0.00) -- (1.00, 0.00) -- (1.00, 1.00);'),
		state.body,
	);

	editor.setTool('bezier');
	for (const cm of [{ x: 2, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 0 }]) {
		router.handlePointerDown(mouse(9, cm, svg));
		router.handlePointerUp(mouse(9, cm, svg));
	}
	editor.commitClickDraft(false);
	assert.match(state.body, /controls[^;]*controls/s, 'bezier path with chained segments');

	// Escape cancels a draft without writing.
	const writesBefore = state.applyCalls;
	editor.setTool('path');
	router.handlePointerDown(mouse(9, { x: 5, y: 5 }, svg));
	router.handlePointerUp(mouse(9, { x: 5, y: 5 }, svg));
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	router.handlePointerDown(mouse(9, { x: 5.5, y: 5 }, svg));
	router.handlePointerUp(mouse(9, { x: 5.5, y: 5 }, svg));
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	assert.equal(state.applyCalls, writesBefore, 'cancelled drafts must not write');
	editor.destroy();
}

/* --- text node tool -------------------------------------------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	const router = editor.gestureRouter;
	editor.setTool('math');
	router.handlePointerDown(mouse(1, { x: 2, y: 1 }, svg));
	router.handlePointerUp(mouse(1, { x: 2, y: 1 }, svg));
	const input = editor.root.querySelector('.luatikz-ve-text-input-field');
	assert.ok(input, 'text input overlay must open');
	input.value = '\\alpha';
	input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	assert.ok(state.body.includes('\\node at (2.00, 1.00) {$\\alpha$};'), state.body);
	editor.destroy();
}

/* --- touch: pan (finger draw off), pinch zoom, finger draw on --------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	editor.setTool('line');
	const router = editor.gestureRouter;
	assert.equal(editor.fingerDraw, false, 'finger draw must be off by default');

	// One-finger touch pans and creates nothing.
	const before = editor.currentViewBox;
	router.handlePointerDown(touchAt(10, { x: 0, y: 0 }, svg));
	router.handlePointerMove(touchAt(10, { x: 1, y: 0 }, svg));
	router.handlePointerUp(touchAt(10, { x: 1, y: 0 }, svg));
	assert.equal(state.applyCalls, 0, 'one finger must not draw');
	assert.ok(editor.currentViewBox.x < before.x, 'one finger must pan');

	// Two fingers pinch-zoom.
	const prePinch = editor.currentViewBox;
	router.handlePointerDown(touchAt(11, { x: -1, y: 0 }, svg));
	router.handlePointerDown(touchAt(12, { x: 1, y: 0 }, svg));
	router.handlePointerMove(touchAt(12, { x: 3, y: 0 }, svg));
	router.handlePointerUp(touchAt(11, { x: -1, y: 0 }, svg));
	router.handlePointerUp(touchAt(12, { x: 3, y: 0 }, svg));
	assert.ok(editor.currentViewBox.w < prePinch.w, 'pinch out must zoom in');

	// Finger draw on: one finger draws.
	const toggle = editor.root.querySelector('.luatikz-ve-finger-toggle');
	toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(editor.fingerDraw, true);
	assert.equal(toggle.getAttribute('aria-pressed'), 'true');
	router.handlePointerDown(touchAt(13, { x: 0, y: 0 }, svg));
	router.handlePointerUp(touchAt(13, { x: 1.5, y: 0 }, svg));
	assert.equal(state.applyCalls, 1, 'finger draw must draw');
	editor.destroy();
}

/* --- stylus draws even with finger draw off; palm ignored -------------------------- */

{
	const { editor, state, svg } = makeEditor(EMPTY);
	editor.setTool('line');
	const router = editor.gestureRouter;
	router.handlePointerDown(penAt(20, { x: 0, y: 0 }, svg), 1000);
	// Palm contact while the pen is down: no pan, no draw.
	const vbDuring = editor.currentViewBox;
	router.handlePointerDown(touchAt(21, { x: 2, y: 2 }, svg), 1050);
	router.handlePointerMove(touchAt(21, { x: 3, y: 2 }, svg));
	assert.deepEqual(editor.currentViewBox, vbDuring, 'palm must not pan');
	router.handlePointerUp(penAt(20, { x: 2, y: 1 }, svg), 1400);
	assert.equal(state.applyCalls, 1, 'pen stroke must commit');
	assert.ok(state.body.includes('\\draw (0.00, 0.00) -- (2.00, 1.00);'), state.body);
	editor.destroy();
}

/* --- unsupported source preserved through edits ------------------------------------ */

{
	const body = [
		'\\begin{tikzpicture}',
		'  % keep me',
		'  \\foreach \\x in {1,...,3} \\draw (\\x,0) circle[radius=2pt];',
		'  \\begin{scope}',
		'  \\draw (0,1) -- (1,2);',
		'  \\end{scope}',
		'  \\draw (0,0) to[bend left] (2,2);',
		'\\end{tikzpicture}',
	].join('\n');
	const { editor, state, svg } = makeEditor(body);
	editor.renderNow();
	// Locked statements render as ghosts, not editable objects.
	assert.ok(editor.root.querySelector('.luatikz-ve-ghost'), 'locked ghost missing');

	editor.setTool('line');
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 4, y: 4 }, svg));
	router.handlePointerUp(mouse(1, { x: 5, y: 4 }, svg));
	assert.ok(state.body.includes('\\foreach \\x in {1,...,3} \\draw (\\x,0) circle[radius=2pt];'));
	assert.ok(state.body.includes('\\draw (0,0) to[bend left] (2,2);'));
	assert.ok(state.body.includes('% keep me'));
	assert.ok(state.body.includes('(4.00, 4.00) -- (5.00, 4.00)'));
	editor.destroy();
}

/* --- source panel sync --------------------------------------------------------------- */

{
	const body = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
	const { editor, state } = makeEditor(body);
	editor.togglePanel('source', true);
	const textarea = editor.root.querySelector('.luatikz-ve-source-text');
	assert.equal(textarea.value, body);

	// Typing in the panel writes through (debounced) as a minimal diff.
	textarea.value = body.replace('(1,1)', '(2,2)');
	textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
	await new Promise(resolve => setTimeout(resolve, 700));
	assert.ok(state.body.includes('(2,2)'), state.body);
	assert.equal(editor.currentScene.source, state.body, 'scene must follow the panel');

	// External change (e.g. undo in the Markdown editor) refreshes the panel.
	state.body = body;
	editor.syncFromBlock({ source: body, startLine: 0, endLine: 4 });
	assert.equal(textarea.value, body);
	editor.destroy();
}

/* --- source panel: syntax colors + hover/selection tints ------------------------------ */

{
	const body = '\\begin{tikzpicture}\n\\draw (1,1) -- (3,2);\n\\draw (4,-1) circle[radius=0.5cm];\n\\end{tikzpicture}';
	const { editor, svg } = makeEditor(body);
	editor.togglePanel('source', true);
	const pre = editor.root.querySelector('.luatikz-ve-source-highlight');
	assert.ok(pre, 'highlight mirror must exist');
	assert.ok(pre.querySelector('.luatikz-tzk-command'), 'commands must be tinted');
	assert.ok(pre.querySelector('.luatikz-tzk-number'), 'numbers must be tinted');
	// The mirror text matches the textarea text exactly (plus trailing filler).
	const textarea = editor.root.querySelector('.luatikz-ve-source-text');
	assert.equal(pre.textContent.replace(/\n$/, ''), textarea.value);

	// Hovering the line on the canvas tints its statement in the panel.
	editor.setTool('select');
	svg.dispatchEvent(new window.MouseEvent('pointermove', {
		clientX: cmToClient(svg, { x: 2, y: 1.5 }).x,
		clientY: cmToClient(svg, { x: 2, y: 1.5 }).y,
		bubbles: true,
	}));
	const hovered = [...pre.querySelectorAll('.luatikz-tzk-hover')]
		.map(span => span.textContent).join('');
	assert.equal(hovered, '\\draw (1,1) -- (3,2);', 'hover must highlight the exact statement');
	assert.ok(svg.classList.contains('is-hover-object'));

	// Moving to empty canvas clears the tint.
	svg.dispatchEvent(new window.MouseEvent('pointermove', {
		clientX: cmToClient(svg, { x: -4, y: -3 }).x,
		clientY: cmToClient(svg, { x: -4, y: -3 }).y,
		bubbles: true,
	}));
	assert.equal(pre.querySelectorAll('.luatikz-tzk-hover').length, 0);

	// Selecting the circle tints it persistently.
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 4.5, y: -1 }, svg));
	router.handlePointerUp(mouse(1, { x: 4.5, y: -1 }, svg));
	const selected = [...pre.querySelectorAll('.luatikz-tzk-selected')]
		.map(span => span.textContent).join('');
	assert.equal(selected, '\\draw (4,-1) circle[radius=0.5cm];');
	editor.destroy();
}

/* --- compile results: last-good retained, error surfaced ------------------------------ */

{
	const { editor } = makeEditor(EMPTY);
	const card = editor.root.querySelector('.luatikz-ve-compiled');
	editor.setCompileResult({ ok: true, dataUrl: 'data:image/svg+xml,ok' }, false);
	assert.ok(card.classList.contains('has-output'));
	const img = card.querySelector('img');
	assert.equal(img.getAttribute('src'), 'data:image/svg+xml,ok');

	// While recompiling: indicator on, last-good stays visible.
	editor.setCompileResult(null, true);
	assert.ok(card.classList.contains('is-rendering'));
	assert.equal(img.getAttribute('src'), 'data:image/svg+xml,ok');

	// Failure: error class, last-good image still shown.
	editor.setCompileResult({ ok: false, error: 'Undefined control sequence', userLine: 2 }, false);
	assert.ok(card.classList.contains('has-error'));
	assert.equal(img.getAttribute('src'), 'data:image/svg+xml,ok', 'last good output must remain');
	const diagnostics = editor.root.querySelector('.luatikz-ve-source-diagnostics');
	assert.match(diagnostics.textContent, /Undefined control sequence/);
	editor.destroy();
}

/* --- compiled underlay: real diagram embedded in the canvas --------------------------- */

{
	const { editor, svg } = makeEditor(EMPTY);
	const compiledSvg = [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" width="120pt" height="90pt"',
		' data-luatikz-bbox="-10 -20 30 20">',
		'<path fill="rgb(25.1%, 50.2%, 74.9%)" d="M5 80 l2 0"/>',
		'<path fill="rgb(74.9%, 50.2%, 25.1%)" d="M110 5 l2 0"/>',
		'<path d="M0 0 L50 50" stroke="black"/>',
		'</svg>',
	].join('');

	editor.setCompileResult({ ok: true, dataUrl: 'data:x', svgText: compiledSvg }, false);
	const layer = editor.root.querySelector('.luatikz-ve-layer-compiled');
	const nested = layer.querySelector('svg');
	assert.ok(nested, 'compiled SVG must embed into the canvas');
	assert.ok(svg.classList.contains('has-underlay'));
	// 1:1 embed: placed at its own viewBox coordinates in canvas user units.
	assert.equal(nested.getAttribute('x'), '0');
	assert.equal(nested.getAttribute('y'), '0');
	assert.equal(nested.getAttribute('width'), '120');
	assert.equal(nested.getAttribute('height'), '90');

	// Re-setting the same output must not duplicate the embed.
	editor.setCompileResult({ ok: true, dataUrl: 'data:x', svgText: compiledSvg }, false);
	assert.equal(layer.querySelectorAll(':scope > g').length, 1);

	// A failing recompile keeps the last-good underlay on the canvas.
	editor.setCompileResult({ ok: false, error: 'boom' }, false);
	assert.ok(layer.querySelector('svg'), 'underlay must survive a failed compile');
	assert.ok(svg.classList.contains('has-underlay'));
	editor.destroy();
}

// Circuit glyphs are approximations: once the underlay contains their
// statement the wireframe must hide entirely (the grey ghost behind the
// compiled symbol) — but a freshly dropped component stays visible until
// its own compile lands.
{
	const body = [
		'\\begin{tikzpicture}',
		'\\draw (0,0) to[R] (2,0);',
		'\\draw (0,1) -- (2,1);',
		'\\end{tikzpicture}',
	].join('\n');
	const { editor, svg } = makeEditor(body);
	const underlay = version => [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" width="120pt" height="90pt"',
		' data-luatikz-bbox="-10 -20 30 20">',
		`<path d="M0 ${version} L50 50" stroke="black"/>`,
		'</svg>',
	].join('');

	editor.setCompileResult({ ok: true, dataUrl: 'data:x', svgText: underlay(0) }, false);
	editor.renderNow();
	const groupFor = id => editor.root.querySelector(`.luatikz-ve-layer-objects [data-luatikz-object-id="${id}"]`)
		?? editor.root.querySelector(`[data-luatikz-object-id="${id}"]`);
	assert.ok(groupFor('p0:s0').classList.contains('luatikz-ve-object-approx'),
		'compiled circuit wireframe must be marked approximate');
	assert.ok(!groupFor('p0:s1').classList.contains('luatikz-ve-object-approx'),
		'plain lines keep the normal dimmed wireframe');

	// Drop a new component: not yet in the underlay → wireframe stays.
	editor.root.querySelector('.luatikz-ve-circuit-btn')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	editor.root.querySelector('[data-component="capacitor"]')
		.dispatchEvent(new window.Event('click', { bubbles: true }));
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 1, y: -1 }, svg));
	router.handlePointerUp(mouse(1, { x: 1, y: -1 }, svg));
	editor.renderNow();
	const fresh = editor.currentScene.objects.find(object =>
		object.type === 'path' && object.options.includes('C') === false
		&& editor.currentScene.source.slice(object.span.from, object.span.to).includes('to[C]'))
		?? editor.currentScene.objects[editor.currentScene.objects.length - 1];
	assert.ok(!groupFor(fresh.id).classList.contains('luatikz-ve-object-approx'),
		'freshly placed component keeps its wireframe until its compile lands');

	// The next compile includes it → the wireframe hides.
	editor.setCompileResult({ ok: true, dataUrl: 'data:x', svgText: underlay(1) }, false);
	editor.renderNow();
	assert.ok(groupFor(fresh.id).classList.contains('luatikz-ve-object-approx'),
		'after its compile the approximate wireframe hides');
	editor.destroy();
}

// Output without the calibration bbox (TikZJax on mobile) must NOT embed:
// a 1:1 embed lands at arbitrary coordinates and shows every object twice
// (the iPad "everything I draw is duplicated beside itself" bug).
{
	const { editor, svg } = makeEditor(EMPTY);
	const tikzjaxSvg = [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-72 -72 144 144" width="144" height="144">',
		'<path d="M0 0 L50 50" stroke="black"/>',
		'</svg>',
	].join('');
	editor.setCompileResult({ ok: true, dataUrl: 'data:x', svgText: tikzjaxSvg }, false);
	const layer = editor.root.querySelector('.luatikz-ve-layer-compiled');
	assert.equal(layer.querySelector('svg'), null, 'uncalibratable output must not embed');
	assert.ok(!svg.classList.contains('has-underlay'), 'wireframe stays authoritative');
	editor.destroy();
}

// Marker-calibration math: measured marker centers map onto the bbox corners.
{
	const bbox = { minX: -10, minY: -20, maxX: 30, maxY: 20 };
	const t = underlayCalibrationTransform(bbox, { x: 0, y: 45 }, { x: 20, y: 25 });
	assert.ok(t);
	// min marker → (bbox.minX, -bbox.minY) = (-10, 20)
	assert.ok(Math.abs(t.s * 0 + t.tx - -10) < 1e-9);
	assert.ok(Math.abs(t.s * 45 + t.ty - 20) < 1e-9);
	// max marker → (bbox.maxX, -bbox.maxY) = (30, -20)
	assert.ok(Math.abs(t.s * 20 + t.tx - 30) < 1e-9);
	assert.ok(Math.abs(t.s * 25 + t.ty - -20) < 1e-9);
	// Degenerate measurements refuse instead of exploding.
	assert.equal(underlayCalibrationTransform(bbox, { x: 5, y: 5 }, { x: 5, y: 5 }), null);
}

/* --- undo/redo wiring ------------------------------------------------------------------ */

{
	const { editor, state } = makeEditor(EMPTY);
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
	assert.equal(state.undos, 1);
	editor.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
	assert.equal(state.redos, 1);
	const undoBtn = editor.root.querySelector('.luatikz-ve-undo');
	undoBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(state.undos, 2);
	editor.destroy();
}

/* --- Done button and cleanup ------------------------------------------------------------ */

{
	const { editor, state, svg, container } = makeEditor(EMPTY);
	const done = editor.root.querySelector('.luatikz-ve-done');
	done.dispatchEvent(new window.Event('click', { bubbles: true }));
	assert.equal(state.exits, 1);

	// Destroy detaches the DOM and disables all listeners and gestures.
	const router = editor.gestureRouter;
	router.handlePointerDown(mouse(1, { x: 0, y: 0 }, svg));
	editor.destroy();
	assert.equal(container.querySelector('.luatikz-visual-editor'), null, 'root must be removed');
	assert.equal(router.mode, 'idle', 'destroy must cancel active gestures');
	const writes = state.applyCalls;
	router.handlePointerUp(mouse(1, { x: 2, y: 0 }, svg));
	assert.equal(state.applyCalls, writes, 'no writes after destroy');
	editor.destroy(); // Second destroy is a no-op, not a crash.
}

console.log('visual-editor-dom: ok');
