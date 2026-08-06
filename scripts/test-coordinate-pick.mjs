/**
 * Coordinate-pick math and calibration, against the real src module.
 *
 * Lines 1-107 of the previous version re-implemented six functions that are
 * real exports of the very module the file bundled further down — the "math
 * OK" line covered nothing shipped. Everything now imports from src.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { pick } = await loadSrcModules({ pick: 'src/utils/coordinatePick.ts' });
const {
	PT_PER_CM,
	svgUserSpaceToTikzCm,
	formatTikzCoordinate,
	applyShiftConstraint,
	parseLastNumericCoordinate,
	computeOrthogonalClosePoint,
} = pick;

// --- unit conversion and formatting ----------------------------------------

const origin = svgUserSpaceToTikzCm(0, 0);
assert.equal(formatTikzCoordinate(origin), '(0.00, 0.00)');

const oneCm = svgUserSpaceToTikzCm(PT_PER_CM, 0);
assert.ok(Math.abs(oneCm.x - 1) < 0.001, `expected ~1cm x, got ${oneCm.x}`);

const up = svgUserSpaceToTikzCm(0, -PT_PER_CM);
assert.ok(Math.abs(up.y - 1) < 0.001, `expected ~1cm y, got ${up.y}`);

// --- shift constraint -------------------------------------------------------

const anchor = { x: 1, y: 2 };
const verticalPick = applyShiftConstraint(
	{ x: 3, y: 5 },
	anchor,
	{ x: 10, y: 100 },
	{ x: 10, y: 20 },
);
assert.equal(verticalPick.x, 1);
assert.equal(verticalPick.y, 5);

const horizontalPick = applyShiftConstraint(
	{ x: 4, y: 2.1 },
	anchor,
	{ x: 100, y: 22 },
	{ x: 10, y: 20 },
);
assert.equal(horizontalPick.x, 4);
assert.equal(horizontalPick.y, 2);

// Without an anchor the pick passes through untouched.
assert.deepEqual(applyShiftConstraint({ x: 3, y: 5 }, null, { x: 0, y: 0 }, null), { x: 3, y: 5 });

// --- coordinate parsing -----------------------------------------------------

assert.deepEqual(parseLastNumericCoordinate('\\draw (1.00, 2.00) -- '), { x: 1, y: 2 });
assert.equal(parseLastNumericCoordinate('\\draw -- '), null);

// --- orthogonal close -------------------------------------------------------

const rect = [
	{ x: 0.54, y: -3.09 },
	{ x: 7.0, y: -3.09 },
	{ x: 7.0, y: -0.96 },
	{ x: 2.04, y: -0.96 },
];
assert.deepEqual(computeOrthogonalClosePoint(rect), { x: 0.54, y: -0.96 });

const verticalFirst = [
	{ x: 1, y: 1 },
	{ x: 1, y: 5 },
	{ x: 4, y: 5 },
	{ x: 3, y: 2 },
];
assert.deepEqual(computeOrthogonalClosePoint(verticalFirst), { x: 4, y: 1 });

assert.equal(computeOrthogonalClosePoint([{ x: 0, y: 0 }, { x: 1, y: 1 }]), null, 'fewer than 3 points');

console.log('coordinate-pick: math OK');

// --- calibration ------------------------------------------------------------

// sidecar parsing (format written by the LaTeX calibration hook)
const sidecar = '-0.2pt,-0.2pt,85.55823pt,57.10548pt\n';
const bbox = pick.parseBBoxSidecar(sidecar);
assert.deepEqual(bbox, { minX: -0.2, minY: -0.2, maxX: 85.55823, maxY: 57.10548 });
assert.equal(pick.parseBBoxSidecar(''), null);
assert.equal(pick.parseBBoxSidecar('garbage'), null);

// attribute injection
const injected = pick.injectTikzBBoxAttribute('<svg xmlns="x" width="10"><path/></svg>', sidecar);
assert.ok(injected.startsWith(`<svg ${pick.LUATIKZ_BBOX_ATTR}="-0.2 -0.2 85.55823 57.10548"`), injected);
assert.equal(pick.injectTikzBBoxAttribute('<svg/>', 'garbage'), '<svg/>');
// idempotent: never double-inject
assert.equal(pick.injectTikzBBoxAttribute(injected, sidecar), injected);

// marker fill matching (pdftocairo output form), tolerant of rounding
assert.ok(pick.fillMatchesMarker('rgb(25.099182%, 50.19989%, 74.899292%)', pick.CAL_MARKER_MIN_RGB));
assert.ok(pick.fillMatchesMarker('rgb(74.899292%, 50.19989%, 25.099182%)', pick.CAL_MARKER_MAX_RGB));
assert.ok(!pick.fillMatchesMarker('rgb(0%, 0%, 0%)', pick.CAL_MARKER_MIN_RGB));
assert.ok(!pick.fillMatchesMarker('none', pick.CAL_MARKER_MIN_RGB));

// end-to-end mapping using values measured from a real lualatex+pdftocairo render
// of \draw (0,0) grid (3,2); marker centers in SVG user space, identity client transform.
const cal = {
	bbox,
	minClient: { x: 5.2793, y: 61.209 },
	maxClient: { x: 89.5313, y: 4.9102 },
};
const atOrigin = pick.calibratedClientToTikzCm(cal, 5.476688, 61.012237);
assert.ok(Math.abs(atOrigin.x) < 0.005 && Math.abs(atOrigin.y) < 0.005, JSON.stringify(atOrigin));
const atCorner = pick.calibratedClientToTikzCm(cal, 89.33297, 5.10805);
assert.ok(Math.abs(atCorner.x - 3) < 0.005 && Math.abs(atCorner.y - 2) < 0.005, JSON.stringify(atCorner));

// round trip through the inverse projection
const projected = pick.calibratedTikzCmToClient(cal, { x: 1.5, y: 1 });
const roundTrip = pick.calibratedClientToTikzCm(cal, projected.x, projected.y);
assert.ok(Math.abs(roundTrip.x - 1.5) < 1e-9 && Math.abs(roundTrip.y - 1) < 1e-9);

// degenerate axis: a picture that is a single horizontal rule reuses the x scale
const flat = {
	bbox: { minX: 0, minY: -0.2, maxX: 85.35831, maxY: 0.2 },
	minClient: { x: 10, y: 100 },
	maxClient: { x: 95.03, y: 99.6 },
};
const flatPick = pick.calibratedClientToTikzCm(flat, 52.515, 100);
assert.ok(Math.abs(flatPick.x - 1.5) < 0.01, JSON.stringify(flatPick));

// fully degenerate calibration returns null instead of NaN coordinates
const broken = {
	bbox: { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 },
	minClient: { x: 10, y: 10 },
	maxClient: { x: 10, y: 10 },
};
assert.equal(pick.calibratedClientToTikzCm(broken, 10, 10), null);

console.log('coordinate-pick: calibration OK');
