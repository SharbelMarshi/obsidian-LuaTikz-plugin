/**
 * Freehand pipeline: capture spacing, endpoint-stable smoothing, distance
 * simplification, Catmull-Rom Bézier fitting, and the generated TikZ.
 *
 * The last block is the contract that matters most: a freehand stroke must
 * come out as a readable `.. controls ..` path that the scene parser accepts
 * back as an editable object — not a giant polyline of raw pointer samples.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { freehand, parser } = await loadSrcModules({
	freehand: 'src/visual/freehand.ts',
	parser: 'src/visual/tikzSceneParser.ts',
});

const pxToCm = 0.02; // 50 px per cm

// --- capture ----------------------------------------------------------------

const draft = freehand.createFreehandDraft({ x: 0, y: 0 }, pxToCm, 0.7);
assert.equal(draft.points.length, 1);
assert.equal(draft.points[0].pressure, 0.7);

// Points closer than the live spacing are dropped…
assert.equal(freehand.appendFreehandPoint(draft, { x: 0.001, y: 0 }), false);
assert.equal(draft.points.length, 1);
// …and far-enough points kept, with pressure preserved for later use.
assert.equal(freehand.appendFreehandPoint(draft, { x: 0.5, y: 0.1 }, 0.9), true);
assert.equal(draft.points[1].pressure, 0.9);

// --- smoothing keeps endpoints ---------------------------------------------

const noisy = [
	{ x: 0, y: 0, pressure: 0.5 },
	{ x: 1, y: 0.4, pressure: 0.5 },
	{ x: 2, y: -0.4, pressure: 0.5 },
	{ x: 3, y: 0, pressure: 0.5 },
];
const smoothed = freehand.smoothFreehandPoints(noisy);
assert.deepEqual({ x: smoothed[0].x, y: smoothed[0].y }, { x: 0, y: 0 });
assert.deepEqual({ x: smoothed.at(-1).x, y: smoothed.at(-1).y }, { x: 3, y: 0 });
assert.ok(Math.abs(smoothed[1].y) < 0.4, 'interior noise must shrink');

// --- simplification ---------------------------------------------------------

const dense = [];
for (let i = 0; i <= 100; i++) {
	dense.push({ x: i / 10, y: Math.sin(i / 10), pressure: 0.5 });
}
const simplified = freehand.simplifyFreehandPoints(dense, 0.5);
assert.ok(simplified.length < dense.length / 3, `too many points kept: ${simplified.length}`);
assert.deepEqual(simplified[0], dense[0]);
assert.deepEqual(simplified.at(-1), dense.at(-1));

// --- Bézier fitting ---------------------------------------------------------

const segments = freehand.catmullRomToBezier([
	{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 },
]);
assert.equal(segments.length, 2);
assert.deepEqual(segments[0].to, { x: 1, y: 1 });
assert.deepEqual(segments[1].to, { x: 2, y: 0 });

// Preview: a two-point stroke stays a straight line…
const short = freehand.createFreehandDraft({ x: 0, y: 0 }, pxToCm);
freehand.appendFreehandPoint(short, { x: 2, y: 0 });
const shortPreview = freehand.freehandPreviewSegments(short, 10, pxToCm);
assert.ok(shortPreview.every(segment => segment.kind === 'line'));

// …while a long stroke previews as chained Béziers.
const long = freehand.createFreehandDraft({ x: 0, y: 0 }, pxToCm);
for (let i = 1; i <= 40; i++) {
	freehand.appendFreehandPoint(long, { x: i / 5, y: Math.sin(i / 5) });
}
const longPreview = freehand.freehandPreviewSegments(long, 10, pxToCm);
assert.ok(longPreview.length >= 2);
assert.ok(longPreview.every(segment => segment.kind === 'bezier'));
for (let i = 1; i < longPreview.length; i++) {
	assert.deepEqual(longPreview[i].from, longPreview[i - 1].to, 'segments must chain');
}

// --- generated TikZ ---------------------------------------------------------

// Degenerate strokes produce nothing rather than junk statements.
const dot = freehand.createFreehandDraft({ x: 0, y: 0 }, pxToCm);
assert.equal(freehand.generateFreehandStatement(dot, 10, pxToCm), null);

const statement = freehand.generateFreehandStatement(long, 10, pxToCm, { strokeColor: 'red' });
assert.ok(statement.startsWith('\\draw[red]'));
assert.match(statement, /\.\. controls \(-?[\d.]+, -?[\d.]+\) and \(-?[\d.]+, -?[\d.]+\) \.\./);
assert.ok(statement.endsWith(';'));

// The sample count stays tamed: nothing like one command per pointer event.
const controlCount = (statement.match(/controls/g) ?? []).length;
assert.ok(controlCount <= long.points.length, 'more segments than samples');
assert.ok(controlCount >= 2, 'over-simplified to a single segment');

// The generated stroke parses back as an editable path with curve elements.
const scene = parser.parseTikzScene(`\\begin{tikzpicture}\n${statement}\n\\end{tikzpicture}`);
assert.equal(scene.objects.length, 1);
assert.equal(scene.objects[0].type, 'path');
assert.ok(scene.objects[0].elements.some(element => element.kind === 'curveTo'));

// Higher smoothing tolerance yields fewer segments (the setting does something).
const rough = freehand.generateFreehandStatement(long, 32, pxToCm);
const roughCount = (rough.match(/controls/g) ?? []).length;
assert.ok(roughCount <= controlCount, `smoothing had no effect: ${roughCount} vs ${controlCount}`);

console.log('visual-freehand: ok');
