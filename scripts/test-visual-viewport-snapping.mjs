/**
 * Viewport math (empty-picture workspace, fit, zoom, pan, pinch) and
 * snapping (grid + object points, in TikZ cm, never raw pixels).
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { viewport, snapping, pick } = await loadSrcModules({
	viewport: 'src/visual/editorViewport.ts',
	snapping: 'src/visual/snapping.ts',
	pick: 'src/utils/coordinatePick.ts',
});

const { PT_PER_CM } = pick;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// --- stable workspace for empty pictures -------------------------------------

const empty = viewport.viewBoxFromCmBounds(viewport.DEFAULT_VIEWPORT_CM);
close(empty.w, 12 * PT_PER_CM);
close(empty.h, 8 * PT_PER_CM);
close(empty.x, -6 * PT_PER_CM);
// Y flips: the top of the box is +4 cm.
close(empty.y, -4 * PT_PER_CM);

// Fitting a null bounds (nothing drawn) falls back to the same workspace.
const fitted = viewport.fitViewBox(null, 1.5);
assert.ok(fitted.w >= 12 * PT_PER_CM - 1e-6);
close(fitted.w / fitted.h, 1.5);

// Fitting real bounds adds the margin and respects the minimum span.
const tight = viewport.fitViewBox({ minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 }, 1);
assert.ok(tight.w >= 4 * PT_PER_CM - 1e-6, 'tiny diagram must not collapse the canvas');

// --- zoom keeps the focus point fixed ----------------------------------------

const box = { x: 0, y: 0, w: 300, h: 200 };
const focus = { x: 100, y: 50 };
const zoomed = viewport.zoomViewBox(box, 2, focus);
close(zoomed.w, 150);
close(zoomed.h, 100);
// The focus point keeps its relative position.
close((focus.x - zoomed.x) / zoomed.w, (focus.x - box.x) / box.w);
close((focus.y - zoomed.y) / zoomed.h, (focus.y - box.y) / box.h);

// Clamping: absurd zoom levels are reined in.
const tiny = viewport.zoomViewBox(box, 1e9, focus);
assert.ok(tiny.w >= viewport.MIN_VIEWBOX_SPAN_PT - 1e-9);
const huge = viewport.zoomViewBox(box, 1e-9, focus);
assert.ok(huge.w <= viewport.MAX_VIEWBOX_SPAN_PT + 1e-9);

// --- pan ----------------------------------------------------------------------

const panned = viewport.panViewBox(box, 50, -20, 2); // 2 px per pt
close(panned.x, -25);
close(panned.y, 10);
close(panned.w, box.w);

// --- pinch --------------------------------------------------------------------

const pinch = {
	baseBox: { x: 0, y: 0, w: 300, h: 200 },
	baseDistance: 100,
	baseFocus: { x: 150, y: 100 },
};
// Doubling the finger distance halves the visible span (zoom in 2x).
const pinched = viewport.pinchViewBox(pinch, 200, { x: 400, y: 300 }, { x: 400, y: 300 }, 2);
close(pinched.w, 150);
close(pinched.h, 100);
// The pinch midpoint (baseFocus) keeps its relative position when fingers stay put.
close((pinch.baseFocus.x - pinched.x) / pinched.w, 0.5);

// Moving the midpoint pans the zoomed box.
const dragged = viewport.pinchViewBox(pinch, 100, { x: 410, y: 300 }, { x: 400, y: 300 }, 2);
close(dragged.w, 300);
close(dragged.x, -5); // 10 px right at 2 px/pt = 5 pt left shift of the box

// --- grid line positions ------------------------------------------------------

const lines = viewport.gridLinePositions({ x: 0, y: -2 * PT_PER_CM, w: 2 * PT_PER_CM, h: 2 * PT_PER_CM }, 0.5);
assert.deepEqual(lines.xs, [0, 0.5, 1, 1.5, 2]);
assert.deepEqual(lines.ys, [0, 0.5, 1, 1.5, 2]);

// --- snapping -----------------------------------------------------------------

const context = {
	gridStepCm: 0.5,
	snapToGrid: true,
	snapToObjects: true,
	candidates: [{ x: 1.02, y: 1.02 }],
	toleranceCm: 0.15,
};

// Object points win over the grid.
const objectSnap = snapping.snapPoint({ x: 1.05, y: 1.05 }, context);
assert.equal(objectSnap.kind, 'object');
assert.deepEqual(objectSnap.point, { x: 1.02, y: 1.02 });

// Grid snap catches nearby points…
const gridSnap = snapping.snapPoint({ x: 2.04, y: 0.96 }, context);
assert.equal(gridSnap.kind, 'grid');
assert.deepEqual(gridSnap.point, { x: 2, y: 1 });

// …but not points beyond tolerance.
const noSnap = snapping.snapPoint({ x: 2.3, y: 0.7 }, context);
assert.equal(noSnap.kind, 'none');

// Toggles are honored.
assert.equal(
	snapping.snapPoint({ x: 2.04, y: 0.96 }, { ...context, snapToGrid: false, snapToObjects: false }).kind,
	'none',
);

// Axis constraint picks the dominant direction.
assert.deepEqual(snapping.axisConstrain({ x: 3, y: 0.2 }, { x: 0, y: 0 }), { x: 3, y: 0 });
assert.deepEqual(snapping.axisConstrain({ x: 0.2, y: 3 }, { x: 0, y: 0 }), { x: 0, y: 3 });

// Translation snapping lands the reference point on the grid exactly.
const delta = snapping.snapTranslation({ x: 1, y: 1 }, 0.46, 0.04, context);
close(delta.dx, 0.5);
close(delta.dy, 0);

console.log('visual-viewport-snapping: ok');
