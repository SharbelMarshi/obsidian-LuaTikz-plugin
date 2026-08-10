/**
 * Painter flood fill: regions bounded by arbitrary strokes must resolve to
 * closed contour loops (with holes), clicks in open space must report the
 * leak instead of fabricating a region, and the traced polygons must stay
 * close to the true region outline.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { floodFill, sceneGeometry, parser } = await loadSrcModules({
	floodFill: 'src/visual/floodFill.ts',
	sceneGeometry: 'src/visual/sceneGeometry.ts',
	parser: 'src/visual/tikzSceneParser.ts',
});

const { floodFillRegion } = floodFill;
const { resolveSceneGeometry } = sceneGeometry;
const { parseTikzScene } = parser;

function geometriesOf(source) {
	return resolveSceneGeometry(parseTikzScene(source));
}

function polygonContains(loop, point) {
	let inside = false;
	for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
		const a = loop[i];
		const b = loop[j];
		if ((a.y > point.y) !== (b.y > point.y)
			&& point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
			inside = !inside;
		}
	}
	return inside;
}

// --- click inside a rectangle ----------------------------------------------

{
	const geometries = geometriesOf('\\draw (0, 0) rectangle (4, 3);');
	const outcome = floodFillRegion(geometries, { x: 2, y: 1.5 });
	assert.equal(outcome.kind, 'region', 'rectangle interior must flood to a region');
	const { region } = outcome;
	assert.equal(region.loops.length, 1, 'a plain rectangle has one contour');
	assert.ok(
		Math.abs(region.areaCm2 - 12) < 1.2,
		`rectangle area ~12cm², got ${region.areaCm2}`,
	);
	const loop = region.loops[0];
	assert.ok(loop.length >= 4 && loop.length <= 12,
		`simplified rectangle contour should be a handful of points, got ${loop.length}`);
	assert.ok(polygonContains(loop, { x: 2, y: 1.5 }), 'contour must contain the click');
	for (const vertex of loop) {
		assert.ok(vertex.x > -0.3 && vertex.x < 4.3 && vertex.y > -0.3 && vertex.y < 3.3,
			'contour must hug the rectangle');
	}
}

// --- click outside every shape ----------------------------------------------

{
	const geometries = geometriesOf('\\draw (0, 0) rectangle (4, 3);');
	const outcome = floodFillRegion(geometries, { x: 6, y: 5 });
	assert.equal(outcome.kind, 'open', 'outside the rectangle the flood must leak');
}

// --- circle split by a chord: fill one half only ----------------------------

{
	const geometries = geometriesOf([
		'\\draw (0, 0) circle[radius=2cm];',
		'\\draw (-2, 0) -- (2, 0);',
	].join('\n'));
	const outcome = floodFillRegion(geometries, { x: 0, y: 1 });
	assert.equal(outcome.kind, 'region', 'upper half disc must flood');
	const { region } = outcome;
	const halfDisc = (Math.PI * 4) / 2;
	assert.ok(
		Math.abs(region.areaCm2 - halfDisc) < 0.9,
		`half disc area ~${halfDisc.toFixed(2)}, got ${region.areaCm2.toFixed(2)}`,
	);
	assert.ok(polygonContains(region.loops[0], { x: 0, y: 1 }));
	assert.ok(!polygonContains(region.loops[0], { x: 0, y: -1 }),
		'lower half must stay outside the traced region');
}

// --- ring: hole contour appears ---------------------------------------------

{
	const geometries = geometriesOf([
		'\\draw (0, 0) circle[radius=2cm];',
		'\\draw (0, 0) circle[radius=0.8cm];',
	].join('\n'));
	const outcome = floodFillRegion(geometries, { x: 1.4, y: 0 });
	assert.equal(outcome.kind, 'region', 'annulus must flood');
	const { region } = outcome;
	assert.equal(region.loops.length, 2, 'annulus needs outer + hole contours');
	const ringArea = Math.PI * (4 - 0.64);
	assert.ok(
		Math.abs(region.areaCm2 - ringArea) < 1.4,
		`ring area ~${ringArea.toFixed(2)}, got ${region.areaCm2.toFixed(2)}`,
	);
	assert.ok(!polygonContains(region.loops[1], { x: 1.4, y: 0 }),
		'hole loop must not contain the clicked point');
	assert.ok(polygonContains(region.loops[1], { x: 0, y: 0 }),
		'hole loop must wrap the inner circle');
}

// --- click exactly on a stroke ----------------------------------------------

{
	const geometries = geometriesOf('\\draw (0, 0) rectangle (4, 3);');
	const outcome = floodFillRegion(geometries, { x: 2, y: 0 });
	// Clicking on the bottom edge nudges to a nearby open cell — either side
	// is acceptable, but it must not fail outright.
	assert.ok(outcome.kind === 'region' || outcome.kind === 'open',
		'a click on a stroke resolves via the nudge');
}

// --- freehand-like open shape with a big gap leaks --------------------------

{
	const geometries = geometriesOf('\\draw (0, 0) -- (4, 0) -- (4, 3) -- (0.5, 3);');
	const outcome = floodFillRegion(geometries, { x: 2, y: 1.5 });
	assert.equal(outcome.kind, 'open', 'an unclosed outline must leak');
}

// --- region bounded by two overlapping shapes -------------------------------

{
	const geometries = geometriesOf([
		'\\draw (0, 0) rectangle (3, 3);',
		'\\draw (1.5, 1.5) circle[radius=1.8cm];',
	].join('\n'));
	// The circle bulges past the rectangle's edges, so its arc cuts each
	// corner off: click a corner sliver inside the rect, outside the circle.
	const outcome = floodFillRegion(geometries, { x: 0.12, y: 0.12 });
	assert.equal(outcome.kind, 'region', 'rect-corner sliver must flood');
	assert.ok(outcome.region.areaCm2 < 2, 'sliver must be small');
}

console.log('visual-floodfill: ok');
