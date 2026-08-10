import type { TikzCoordinate } from '../utils/coordinatePick';
import type { ObjectGeometry, ScenePrimitive } from './sceneGeometry';

/**
 * Raster flood fill for the painter tool.
 *
 * The scene's stroke primitives are rasterized onto a coarse barrier grid (in
 * display cm), the clicked cell floods outward 4-connectedly, and the flooded
 * region's outline — outer contour plus any holes — is traced back into
 * closed polygon loops. Working on the raster instead of the vector geometry
 * means *any* arrangement of strokes that visually closes a region can be
 * painted: overlapping shapes, freehand outlines, a circle split by a chord.
 *
 * A region that leaks to the raster border is reported as open rather than
 * guessed at, mirroring what a bitmap bucket tool would do.
 */

export interface FloodFillOptions {
	/** Target raster cell size in display cm. */
	cellCm?: number;
	/** Cap on grid columns/rows; the cell grows to respect it. */
	maxGridDim?: number;
	/** Extra space around the scene bounds kept open for leak detection. */
	marginCm?: number;
}

export interface FloodFillGrid {
	originX: number;
	originY: number;
	cellCm: number;
	cols: number;
	rows: number;
	/** 1 where the region flooded, row-major `j * cols + i`. */
	filled: Uint8Array;
}

export interface FloodFillRegion {
	/** Closed contour loops in display cm, largest (outer) first. */
	loops: TikzCoordinate[][];
	areaCm2: number;
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
	grid: FloodFillGrid;
}

export type FloodFillOutcome =
	| { kind: 'region'; region: FloodFillRegion }
	/** The flood reached the raster border: nothing encloses the point. */
	| { kind: 'open' }
	/** The click landed on a stroke (or outside the scene). */
	| { kind: 'blocked' };

const DEFAULT_CELL_CM = 0.03;
const DEFAULT_MAX_GRID = 480;
const DEFAULT_MARGIN_CM = 0.6;

interface Raster {
	originX: number;
	originY: number;
	cell: number;
	cols: number;
	rows: number;
	barrier: Uint8Array;
}

function markCell(raster: Raster, i: number, j: number): void {
	if (i >= 0 && j >= 0 && i < raster.cols && j < raster.rows) {
		raster.barrier[j * raster.cols + i] = 1;
	}
}

/**
 * Mark every cell the segment passes through (supercover traversal), so the
 * resulting barrier chain is edge-connected and a 4-connected flood can never
 * slip through it diagonally.
 */
function rasterizeSegment(raster: Raster, a: TikzCoordinate, b: TikzCoordinate): void {
	const gx0 = (a.x - raster.originX) / raster.cell;
	const gy0 = (a.y - raster.originY) / raster.cell;
	const gx1 = (b.x - raster.originX) / raster.cell;
	const gy1 = (b.y - raster.originY) / raster.cell;
	let i = Math.floor(gx0);
	let j = Math.floor(gy0);
	const iEnd = Math.floor(gx1);
	const jEnd = Math.floor(gy1);
	const dx = gx1 - gx0;
	const dy = gy1 - gy0;
	const stepI = dx > 0 ? 1 : -1;
	const stepJ = dy > 0 ? 1 : -1;
	const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
	const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
	let tMaxX = dx !== 0
		? (stepI > 0 ? (i + 1 - gx0) : (gx0 - i)) * tDeltaX
		: Number.POSITIVE_INFINITY;
	let tMaxY = dy !== 0
		? (stepJ > 0 ? (j + 1 - gy0) : (gy0 - j)) * tDeltaY
		: Number.POSITIVE_INFINITY;

	markCell(raster, i, j);
	let guard = raster.cols + raster.rows + Math.abs(iEnd - i) + Math.abs(jEnd - j) + 8;
	while ((i !== iEnd || j !== jEnd) && guard-- > 0) {
		if (tMaxX < tMaxY) {
			i += stepI;
			tMaxX += tDeltaX;
		} else {
			j += stepJ;
			tMaxY += tDeltaY;
		}
		markCell(raster, i, j);
	}
}

function rasterizePolyline(raster: Raster, points: readonly TikzCoordinate[]): void {
	for (let index = 1; index < points.length; index++) {
		rasterizeSegment(raster, points[index - 1], points[index]);
	}
}

function bezierPoint(
	t: number,
	a: TikzCoordinate,
	c1: TikzCoordinate,
	c2: TikzCoordinate,
	b: TikzCoordinate,
): TikzCoordinate {
	const u = 1 - t;
	return {
		x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
		y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
	};
}

function sampleCount(lengthCm: number, cell: number): number {
	return Math.max(8, Math.min(720, Math.ceil((lengthCm / cell) * 1.5)));
}

function rasterizePrimitive(raster: Raster, primitive: ScenePrimitive): void {
	switch (primitive.kind) {
		case 'segment':
			rasterizeSegment(raster, primitive.a, primitive.b);
			break;
		case 'bezier': {
			const approxLen = Math.hypot(primitive.c1.x - primitive.a.x, primitive.c1.y - primitive.a.y)
				+ Math.hypot(primitive.c2.x - primitive.c1.x, primitive.c2.y - primitive.c1.y)
				+ Math.hypot(primitive.b.x - primitive.c2.x, primitive.b.y - primitive.c2.y);
			const steps = sampleCount(approxLen, raster.cell);
			const points: TikzCoordinate[] = [];
			for (let step = 0; step <= steps; step++) {
				points.push(bezierPoint(step / steps, primitive.a, primitive.c1, primitive.c2, primitive.b));
			}
			rasterizePolyline(raster, points);
			break;
		}
		case 'rect': {
			const { a, b } = primitive;
			rasterizePolyline(raster, [
				{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y },
				{ x: a.x, y: b.y }, { x: a.x, y: a.y },
			]);
			break;
		}
		case 'grid': {
			// Match the wireframe rendering: outer box plus unit-step lines, so
			// painting inside a grid cell fills exactly that cell.
			const minX = Math.min(primitive.a.x, primitive.b.x);
			const maxX = Math.max(primitive.a.x, primitive.b.x);
			const minY = Math.min(primitive.a.y, primitive.b.y);
			const maxY = Math.max(primitive.a.y, primitive.b.y);
			rasterizePolyline(raster, [
				{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY },
				{ x: minX, y: maxY }, { x: minX, y: minY },
			]);
			for (let x = Math.ceil(minX); x <= maxX; x += 1) {
				rasterizeSegment(raster, { x, y: minY }, { x, y: maxY });
			}
			for (let y = Math.ceil(minY); y <= maxY; y += 1) {
				rasterizeSegment(raster, { x: minX, y }, { x: maxX, y });
			}
			break;
		}
		case 'circle': {
			const steps = sampleCount(2 * Math.PI * Math.max(primitive.rx, primitive.ry), raster.cell);
			const points: TikzCoordinate[] = [];
			for (let step = 0; step <= steps; step++) {
				const angle = (2 * Math.PI * step) / steps;
				points.push({
					x: primitive.center.x + primitive.rx * Math.cos(angle),
					y: primitive.center.y + primitive.ry * Math.sin(angle),
				});
			}
			rasterizePolyline(raster, points);
			break;
		}
		case 'arc': {
			const spanRad = (Math.abs(primitive.endDeg - primitive.startDeg) * Math.PI) / 180;
			const steps = sampleCount(spanRad * primitive.radius, raster.cell);
			const points: TikzCoordinate[] = [];
			for (let step = 0; step <= steps; step++) {
				const angle = ((primitive.startDeg
					+ ((primitive.endDeg - primitive.startDeg) * step) / steps) * Math.PI) / 180;
				points.push({
					x: primitive.center.x + primitive.radius * Math.cos(angle),
					y: primitive.center.y + primitive.radius * Math.sin(angle),
				});
			}
			rasterizePolyline(raster, points);
			break;
		}
		case 'nodeMark':
			// Text is not a paint barrier.
			break;
	}
}

/* -------------------------------------------------------------------------- */
/* contour tracing                                                             */
/* -------------------------------------------------------------------------- */

/** Chain the boundary edges of the filled mask into closed corner loops. */
function traceContours(grid: FloodFillGrid): Array<Array<{ i: number; j: number }>> {
	const { cols, rows, filled } = grid;
	const isFilled = (i: number, j: number): boolean =>
		i >= 0 && j >= 0 && i < cols && j < rows && filled[j * cols + i] === 1;

	// Edge between corners, keyed by its endpoints.
	const cornerKey = (i: number, j: number): number => j * (cols + 1) + i;
	const adjacency = new Map<number, number[]>();
	const addEdge = (a: number, b: number) => {
		const listA = adjacency.get(a);
		if (listA) {
			listA.push(b);
		} else {
			adjacency.set(a, [b]);
		}
		const listB = adjacency.get(b);
		if (listB) {
			listB.push(a);
		} else {
			adjacency.set(b, [a]);
		}
	};

	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			if (!isFilled(i, j)) {
				continue;
			}
			if (!isFilled(i - 1, j)) {
				addEdge(cornerKey(i, j), cornerKey(i, j + 1));
			}
			if (!isFilled(i + 1, j)) {
				addEdge(cornerKey(i + 1, j), cornerKey(i + 1, j + 1));
			}
			if (!isFilled(i, j - 1)) {
				addEdge(cornerKey(i, j), cornerKey(i + 1, j));
			}
			if (!isFilled(i, j + 1)) {
				addEdge(cornerKey(i, j + 1), cornerKey(i + 1, j + 1));
			}
		}
	}

	// Walk unused edges into loops. The used-set stores directed "a->b" pairs;
	// each undirected edge is consumed once.
	const usedEdges = new Set<string>();
	const edgeId = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
	const loops: Array<Array<{ i: number; j: number }>> = [];

	for (const [startCorner, neighbors] of adjacency) {
		for (const firstNeighbor of neighbors) {
			if (usedEdges.has(edgeId(startCorner, firstNeighbor))) {
				continue;
			}
			const loop: number[] = [startCorner];
			let previous = startCorner;
			let current = firstNeighbor;
			usedEdges.add(edgeId(previous, current));
			let guard = adjacency.size * 4 + 8;
			while (current !== startCorner && guard-- > 0) {
				loop.push(current);
				const options = adjacency.get(current) ?? [];
				let next = -1;
				for (const candidate of options) {
					if (candidate !== previous && !usedEdges.has(edgeId(current, candidate))) {
						next = candidate;
						break;
					}
				}
				if (next < 0) {
					break;
				}
				usedEdges.add(edgeId(current, next));
				previous = current;
				current = next;
			}
			if (current === startCorner && loop.length >= 4) {
				loops.push(loop.map(key => ({
					i: key % (cols + 1),
					j: Math.floor(key / (cols + 1)),
				})));
			}
		}
	}
	return loops;
}

/* -------------------------------------------------------------------------- */
/* polygon simplification                                                      */
/* -------------------------------------------------------------------------- */

function dropCollinear(points: TikzCoordinate[]): TikzCoordinate[] {
	if (points.length < 4) {
		return points;
	}
	const out: TikzCoordinate[] = [];
	const count = points.length;
	for (let index = 0; index < count; index++) {
		const prev = points[(index + count - 1) % count];
		const here = points[index];
		const next = points[(index + 1) % count];
		const cross = (here.x - prev.x) * (next.y - here.y) - (here.y - prev.y) * (next.x - here.x);
		const dot = (here.x - prev.x) * (next.x - here.x) + (here.y - prev.y) * (next.y - here.y);
		if (Math.abs(cross) > 1e-9 || dot < 0) {
			out.push(here);
		}
	}
	return out.length >= 3 ? out : points;
}

function rdpChain(points: readonly TikzCoordinate[], epsilon: number): TikzCoordinate[] {
	if (points.length <= 2) {
		return [...points];
	}
	const first = points[0];
	const last = points[points.length - 1];
	let worst = -1;
	let worstDistance = 0;
	const dx = last.x - first.x;
	const dy = last.y - first.y;
	const lengthSq = dx * dx + dy * dy;
	for (let index = 1; index < points.length - 1; index++) {
		const p = points[index];
		let distance: number;
		if (lengthSq < 1e-12) {
			distance = Math.hypot(p.x - first.x, p.y - first.y);
		} else {
			const t = ((p.x - first.x) * dx + (p.y - first.y) * dy) / lengthSq;
			const clamped = Math.max(0, Math.min(1, t));
			distance = Math.hypot(p.x - (first.x + clamped * dx), p.y - (first.y + clamped * dy));
		}
		if (distance > worstDistance) {
			worstDistance = distance;
			worst = index;
		}
	}
	if (worstDistance <= epsilon || worst < 0) {
		return [first, last];
	}
	const left = rdpChain(points.slice(0, worst + 1), epsilon);
	const right = rdpChain(points.slice(worst), epsilon);
	return [...left.slice(0, -1), ...right];
}

/** Simplify a closed loop: collinear merge, then RDP split at far extremes. */
function simplifyLoop(points: TikzCoordinate[], epsilon: number): TikzCoordinate[] {
	const merged = dropCollinear(points);
	if (merged.length <= 4) {
		return merged;
	}
	// Split at the two mutually distant points so RDP endpoints are stable.
	let anchorA = 0;
	let best = 0;
	for (let index = 1; index < merged.length; index++) {
		const d = Math.hypot(merged[index].x - merged[0].x, merged[index].y - merged[0].y);
		if (d > best) {
			best = d;
			anchorA = index;
		}
	}
	let anchorB = 0;
	best = 0;
	for (let index = 0; index < merged.length; index++) {
		const d = Math.hypot(merged[index].x - merged[anchorA].x, merged[index].y - merged[anchorA].y);
		if (d > best) {
			best = d;
			anchorB = index;
		}
	}
	const [from, to] = anchorA < anchorB ? [anchorA, anchorB] : [anchorB, anchorA];
	const chainOne = merged.slice(from, to + 1);
	const chainTwo = [...merged.slice(to), ...merged.slice(0, from + 1)];
	const simplifiedOne = rdpChain(chainOne, epsilon);
	const simplifiedTwo = rdpChain(chainTwo, epsilon);
	const loop = [...simplifiedOne.slice(0, -1), ...simplifiedTwo.slice(0, -1)];
	return loop.length >= 3 ? loop : merged;
}

function shoelaceArea(points: readonly TikzCoordinate[]): number {
	let sum = 0;
	for (let index = 0; index < points.length; index++) {
		const a = points[index];
		const b = points[(index + 1) % points.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

export function floodFillRegion(
	geometries: readonly ObjectGeometry[],
	point: TikzCoordinate,
	options: FloodFillOptions = {},
): FloodFillOutcome {
	const cellTarget = options.cellCm ?? DEFAULT_CELL_CM;
	const maxGridDim = options.maxGridDim ?? DEFAULT_MAX_GRID;
	const margin = options.marginCm ?? DEFAULT_MARGIN_CM;

	let minX = point.x;
	let minY = point.y;
	let maxX = point.x;
	let maxY = point.y;
	let hasBounds = false;
	for (const geometry of geometries) {
		if (!geometry.bounds) {
			continue;
		}
		hasBounds = true;
		minX = Math.min(minX, geometry.bounds.minX);
		minY = Math.min(minY, geometry.bounds.minY);
		maxX = Math.max(maxX, geometry.bounds.maxX);
		maxY = Math.max(maxY, geometry.bounds.maxY);
	}
	if (!hasBounds) {
		return { kind: 'open' };
	}
	minX -= margin;
	minY -= margin;
	maxX += margin;
	maxY += margin;

	const cell = Math.max(cellTarget, (maxX - minX) / maxGridDim, (maxY - minY) / maxGridDim);
	const cols = Math.max(4, Math.ceil((maxX - minX) / cell));
	const rows = Math.max(4, Math.ceil((maxY - minY) / cell));
	const raster: Raster = {
		originX: minX,
		originY: minY,
		cell,
		cols,
		rows,
		barrier: new Uint8Array(cols * rows),
	};

	for (const geometry of geometries) {
		for (const primitive of geometry.primitives) {
			rasterizePrimitive(raster, primitive);
		}
	}

	// Seed cell: the clicked cell, or the nearest open cell a couple of cells
	// away when the click landed exactly on a stroke.
	let seedI = Math.floor((point.x - minX) / cell);
	let seedJ = Math.floor((point.y - minY) / cell);
	if (raster.barrier[seedJ * cols + seedI]) {
		let found = false;
		for (let radius = 1; radius <= 2 && !found; radius++) {
			for (let dj = -radius; dj <= radius && !found; dj++) {
				for (let di = -radius; di <= radius && !found; di++) {
					const i = seedI + di;
					const j = seedJ + dj;
					if (i >= 0 && j >= 0 && i < cols && j < rows && !raster.barrier[j * cols + i]) {
						seedI = i;
						seedJ = j;
						found = true;
					}
				}
			}
		}
		if (!found) {
			return { kind: 'blocked' };
		}
	}

	const filled = new Uint8Array(cols * rows);
	const queue = new Int32Array(cols * rows);
	let head = 0;
	let tail = 0;
	let leaked = false;
	let cellCount = 0;
	const push = (i: number, j: number) => {
		const index = j * cols + i;
		if (filled[index] || raster.barrier[index]) {
			return;
		}
		filled[index] = 1;
		cellCount++;
		queue[tail++] = index;
		if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) {
			leaked = true;
		}
	};
	push(seedI, seedJ);
	while (head < tail && !leaked) {
		const index = queue[head++];
		const i = index % cols;
		const j = Math.floor(index / cols);
		if (i > 0) {
			push(i - 1, j);
		}
		if (i < cols - 1) {
			push(i + 1, j);
		}
		if (j > 0) {
			push(i, j - 1);
		}
		if (j < rows - 1) {
			push(i, j + 1);
		}
	}
	if (leaked) {
		return { kind: 'open' };
	}

	const grid: FloodFillGrid = {
		originX: minX,
		originY: minY,
		cellCm: cell,
		cols,
		rows,
		filled,
	};

	const cornerLoops = traceContours(grid);
	const epsilon = cell * 1.4;
	const minHoleArea = cell * cell * 8;
	const loops: TikzCoordinate[][] = [];
	let outerIndex = -1;
	let outerArea = 0;
	for (const cornerLoop of cornerLoops) {
		const cmLoop = cornerLoop.map(corner => ({
			x: minX + corner.i * cell,
			y: minY + corner.j * cell,
		}));
		const simplified = simplifyLoop(cmLoop, epsilon);
		const area = shoelaceArea(simplified);
		loops.push(simplified);
		if (area > outerArea) {
			outerArea = area;
			outerIndex = loops.length - 1;
		}
	}
	const kept = loops.filter((loop, index) =>
		index === outerIndex || shoelaceArea(loop) >= minHoleArea);
	if (!kept.length || outerIndex < 0) {
		return { kind: 'blocked' };
	}
	// Outer loop first, then holes.
	const outer = loops[outerIndex];
	const ordered = [outer, ...kept.filter(loop => loop !== outer)];

	let regionMinX = Number.POSITIVE_INFINITY;
	let regionMinY = Number.POSITIVE_INFINITY;
	let regionMaxX = Number.NEGATIVE_INFINITY;
	let regionMaxY = Number.NEGATIVE_INFINITY;
	for (const vertex of outer) {
		regionMinX = Math.min(regionMinX, vertex.x);
		regionMinY = Math.min(regionMinY, vertex.y);
		regionMaxX = Math.max(regionMaxX, vertex.x);
		regionMaxY = Math.max(regionMaxY, vertex.y);
	}

	return {
		kind: 'region',
		region: {
			loops: ordered,
			areaCm2: cellCount * cell * cell,
			bounds: { minX: regionMinX, minY: regionMinY, maxX: regionMaxX, maxY: regionMaxY },
			grid,
		},
	};
}
