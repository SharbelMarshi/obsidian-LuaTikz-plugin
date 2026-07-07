import assert from 'node:assert/strict';

const PT_PER_CM = 28.452756;

function ptToCm(pt) {
	return pt / PT_PER_CM;
}

function svgUserSpaceToTikzCm(svgX, svgY) {
	return { x: ptToCm(svgX), y: ptToCm(-svgY) };
}

function formatTikzCoordinate(coord, decimals = 2) {
	return `(${coord.x.toFixed(decimals)}, ${coord.y.toFixed(decimals)})`;
}

function applyShiftConstraint(picked, anchor, client, anchorClient) {
	if (!anchor || !anchorClient) return picked;
	const dx = Math.abs(client.x - anchorClient.x);
	const dy = Math.abs(client.y - anchorClient.y);
	if (dy > dx) {
		return { x: anchor.x, y: picked.y };
	}
	return { x: picked.x, y: anchor.y };
}

const origin = svgUserSpaceToTikzCm(0, 0);
assert.equal(formatTikzCoordinate(origin), '(0.00, 0.00)');

const oneCm = svgUserSpaceToTikzCm(PT_PER_CM, 0);
assert.ok(Math.abs(oneCm.x - 1) < 0.001, `expected ~1cm x, got ${oneCm.x}`);

const up = svgUserSpaceToTikzCm(0, -PT_PER_CM);
assert.ok(Math.abs(up.y - 1) < 0.001, `expected ~1cm y, got ${up.y}`);

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

function parseLastNumericCoordinate(text) {
	let last = null;
	const re = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
	for (const match of text.matchAll(re)) {
		last = { x: Number.parseFloat(match[1]), y: Number.parseFloat(match[2]) };
	}
	return last;
}

const source = '\\draw (1.00, 2.00) -- ';
assert.deepEqual(parseLastNumericCoordinate(source), { x: 1, y: 2 });
assert.equal(parseLastNumericCoordinate('\\draw -- '), null);

function computeOrthogonalClosePoint(points) {
	if (points.length < 3) return null;
	const p0 = points[0];
	const pPrev = points[points.length - 2];
	const pLast = points[points.length - 1];
	const AXIS_EPS = 1e-4;
	const isHorizontal = (a, b) => Math.abs(a.y - b.y) < AXIS_EPS;
	const isVertical = (a, b) => Math.abs(a.x - b.x) < AXIS_EPS;
	if (isHorizontal(pPrev, pLast)) return { x: p0.x, y: pPrev.y };
	if (isVertical(pPrev, pLast)) return { x: pPrev.x, y: p0.y };
	const p1 = points[1];
	if (isHorizontal(p0, p1)) return { x: p0.x, y: pPrev.y };
	if (isVertical(p0, p1)) return { x: pPrev.x, y: p0.y };
	return null;
}

const rect = [
	{ x: 0.54, y: -3.09 },
	{ x: 7.0, y: -3.09 },
	{ x: 7.0, y: -0.96 },
	{ x: 2.04, y: -0.96 },
];
const closed = computeOrthogonalClosePoint(rect);
assert.deepEqual(closed, { x: 0.54, y: -0.96 });

const verticalFirst = [
	{ x: 1, y: 1 },
	{ x: 1, y: 5 },
	{ x: 4, y: 5 },
	{ x: 3, y: 2 },
];
const closedVertical = computeOrthogonalClosePoint(verticalFirst);
assert.deepEqual(closedVertical, { x: 4, y: 1 });

console.log('coordinate-pick: math OK');
