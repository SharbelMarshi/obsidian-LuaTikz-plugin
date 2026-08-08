/**
 * Freehand shape recognition: synthetic wobbly strokes must snap to the
 * intended primitive — line, triangle, rectangle, circle — and small or
 * ambiguous scribbles must stay unrecognized.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { recognition } = await loadSrcModules({
	recognition: 'src/visual/shapeRecognition.ts',
});
const { recognizeStroke } = recognition;

const TOLERANCE = 0.1;

/** Deterministic pseudo-noise so failures reproduce. */
function noise(index, amplitude) {
	return Math.sin(index * 12.9898) * amplitude;
}

/** Sample the closed polygon perimeter with per-point wobble. */
function strokeAlongPolygon(vertices, samplesPerEdge, wobble) {
	const points = [];
	for (let edge = 0; edge < vertices.length; edge++) {
		const a = vertices[edge];
		const b = vertices[(edge + 1) % vertices.length];
		for (let step = 0; step < samplesPerEdge; step++) {
			const t = step / samplesPerEdge;
			points.push({
				x: a.x + (b.x - a.x) * t + noise(points.length, wobble),
				y: a.y + (b.y - a.y) * t + noise(points.length + 7, wobble),
			});
		}
	}
	points.push({ ...points[0] });
	return points;
}

// --- line --------------------------------------------------------------------

{
	const points = [];
	for (let index = 0; index <= 24; index++) {
		const t = index / 24;
		points.push({ x: 4 * t, y: t + noise(index, 0.03) });
	}
	const shape = recognizeStroke(points, TOLERANCE);
	assert.equal(shape?.kind, 'line', 'straight wobbly stroke → line');
	assert.deepEqual(shape.a, points[0]);
	assert.deepEqual(shape.b, points[points.length - 1]);
}

// --- triangle ----------------------------------------------------------------

{
	const vertices = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }];
	const shape = recognizeStroke(strokeAlongPolygon(vertices, 20, 0.04), TOLERANCE);
	assert.equal(shape?.kind, 'polygon', 'triangle stroke → polygon');
	assert.equal(shape.points.length, 3, 'three corners');
	for (const vertex of vertices) {
		assert.ok(
			shape.points.some(corner => Math.hypot(corner.x - vertex.x, corner.y - vertex.y) < 0.4),
			`corner near (${vertex.x}, ${vertex.y})`,
		);
	}
}

// --- axis-aligned rectangle --------------------------------------------------

{
	const vertices = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
	const shape = recognizeStroke(strokeAlongPolygon(vertices, 16, 0.04), TOLERANCE);
	assert.equal(shape?.kind, 'rect', 'rectangle stroke → rect');
	assert.ok(Math.abs(shape.a.x - 0) < 0.2 && Math.abs(shape.b.x - 4) < 0.2);
	assert.ok(Math.abs(shape.a.y - 0) < 0.2 && Math.abs(shape.b.y - 2) < 0.2);
}

// --- circle ------------------------------------------------------------------

{
	const points = [];
	for (let index = 0; index <= 64; index++) {
		const angle = (2 * Math.PI * index) / 64;
		const radius = 2 + noise(index, 0.05);
		points.push({ x: 1 + radius * Math.cos(angle), y: 1 + radius * Math.sin(angle) });
	}
	const shape = recognizeStroke(points, TOLERANCE);
	assert.equal(shape?.kind, 'circle', 'round stroke → circle');
	assert.ok(Math.abs(shape.radius - 2) < 0.15, `radius ≈ 2, got ${shape.radius}`);
	assert.ok(Math.hypot(shape.center.x - 1, shape.center.y - 1) < 0.15);
}

// --- guards ------------------------------------------------------------------

{
	// Tiny strokes never snap (accidental taps).
	const tiny = [];
	for (let index = 0; index <= 12; index++) {
		tiny.push({ x: index * 0.01, y: 0 });
	}
	assert.equal(recognizeStroke(tiny, TOLERANCE), null, 'tiny strokes stay freehand');

	// A curved open stroke is not a line.
	const bow = [];
	for (let index = 0; index <= 24; index++) {
		const t = index / 24;
		bow.push({ x: 4 * t, y: Math.sin(t * Math.PI) * 1.5 });
	}
	assert.equal(recognizeStroke(bow, TOLERANCE), null, 'a deep bow is not a line');
}

console.log('shape-recognition: ok');
