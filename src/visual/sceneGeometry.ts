import type { TikzCoordinate } from '../utils/coordinatePick';
import { buildTikzGeometryMap } from '../latex/tikzStatementGeometry';
import type {
	CoordinateToken,
	SceneNodeObject,
	SceneObject,
	ScenePathObject,
	ScenePicture,
	TikzScene,
} from './sceneTypes';

/**
 * Resolved display geometry for scene objects: primitives in post-scale TikZ
 * cm (Y up) for the canvas renderer, handle descriptors for the Select tool,
 * and distance-based hit testing shared by mouse and touch (touch needs a
 * bigger tolerance than an SVG element's own hit area provides).
 */

export type ScenePrimitive =
	| { kind: 'segment'; a: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'bezier'; a: TikzCoordinate; c1: TikzCoordinate; c2: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'rect'; a: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'grid'; a: TikzCoordinate; b: TikzCoordinate }
	| { kind: 'circle'; center: TikzCoordinate; rx: number; ry: number }
	| { kind: 'arc'; center: TikzCoordinate; radius: number; startDeg: number; endDeg: number }
	| { kind: 'nodeMark'; at: TikzCoordinate; text: string };

/** A draggable handle bound to one coordinate/length token of the object. */
export interface ObjectHandle {
	id: string;
	kind: 'vertex' | 'control' | 'radius';
	posCm: TikzCoordinate;
	/** Index into elements for paths; -1 for the node `at` token. */
	elementIndex: number;
	/** Which token of the element this handle drags. */
	token: 'coord' | 'c1' | 'c2' | 'at' | 'radius';
}

export interface ObjectGeometry {
	object: SceneObject;
	primitives: ScenePrimitive[];
	handles: ObjectHandle[];
	filled: boolean;
	bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

function scalePoint(point: TikzCoordinate, scale: { x: number; y: number }): TikzCoordinate {
	return { x: point.x * scale.x, y: point.y * scale.y };
}

function avgScale(scale: { x: number; y: number }): number {
	return (Math.abs(scale.x) + Math.abs(scale.y)) / 2;
}

function isFilledObject(object: SceneObject): boolean {
	if (object.type === 'locked') {
		return false;
	}
	if (object.type === 'path' && (object.command === 'fill' || object.command === 'filldraw')) {
		return true;
	}
	const options = object.type === 'path' || object.type === 'node' ? object.options : '';
	return /(?:^|[,\s])fill\s*(?:=|,|$)/.test(options);
}

function resolvePathGeometry(
	object: ScenePathObject,
	picture: ScenePicture,
): { primitives: ScenePrimitive[]; handles: ObjectHandle[] } {
	const scale = picture.scale;
	const primitives: ScenePrimitive[] = [];
	const handles: ObjectHandle[] = [];

	let pen: TikzCoordinate | null = null;
	let subpathStart: TikzCoordinate | null = null;
	let pendingOp:
		| { kind: 'lineTo' | 'hvTo' | 'vhTo' | 'rectangleTo' | 'gridTo' }
		| { kind: 'curveTo'; c1: CoordinateToken; c2: CoordinateToken | null }
		| null = null;

	const pushHandle = (
		kind: ObjectHandle['kind'],
		posCm: TikzCoordinate,
		elementIndex: number,
		token: ObjectHandle['token'],
	) => {
		handles.push({
			id: `${object.id}:${elementIndex}:${token}`,
			kind,
			posCm,
			elementIndex,
			token,
		});
	};

	for (let index = 0; index < object.elements.length; index++) {
		const element = object.elements[index];
		switch (element.kind) {
			case 'coord': {
				const point = scalePoint(element.coord.resolved, scale);
				pushHandle('vertex', point, index, 'coord');
				if (pen && pendingOp) {
					switch (pendingOp.kind) {
						case 'lineTo':
							primitives.push({ kind: 'segment', a: pen, b: point });
							break;
						case 'hvTo': {
							const corner = { x: point.x, y: pen.y };
							primitives.push({ kind: 'segment', a: pen, b: corner });
							primitives.push({ kind: 'segment', a: corner, b: point });
							break;
						}
						case 'vhTo': {
							const corner = { x: pen.x, y: point.y };
							primitives.push({ kind: 'segment', a: pen, b: corner });
							primitives.push({ kind: 'segment', a: corner, b: point });
							break;
						}
						case 'rectangleTo':
							primitives.push({ kind: 'rect', a: pen, b: point });
							break;
						case 'gridTo':
							primitives.push({ kind: 'grid', a: pen, b: point });
							break;
						case 'curveTo': {
							const c1 = scalePoint(pendingOp.c1.resolved, scale);
							const c2 = pendingOp.c2
								? scalePoint(pendingOp.c2.resolved, scale)
								: c1;
							primitives.push({ kind: 'bezier', a: pen, c1, c2, b: point });
							break;
						}
					}
					pendingOp = null;
				} else {
					subpathStart = point;
				}
				if (element.coord.prefix !== '+') {
					pen = point;
				}
				if (!subpathStart) {
					subpathStart = point;
				}
				break;
			}
			case 'lineTo':
			case 'hvTo':
			case 'vhTo':
			case 'rectangleTo':
				pendingOp = { kind: element.kind };
				break;
			case 'gridTo':
				pendingOp = { kind: 'gridTo' };
				break;
			case 'curveTo': {
				pendingOp = { kind: 'curveTo', c1: element.c1, c2: element.c2 };
				pushHandle('control', scalePoint(element.c1.resolved, scale), index, 'c1');
				if (element.c2) {
					pushHandle('control', scalePoint(element.c2.resolved, scale), index, 'c2');
				}
				break;
			}
			case 'circle': {
				if (!pen) {
					break;
				}
				const axis = avgScale(scale);
				const rx = element.radius.cm * (element.yRadius ? Math.abs(scale.x) : axis);
				const ry = element.yRadius
					? element.yRadius.cm * Math.abs(scale.y)
					: element.radius.cm * axis;
				primitives.push({ kind: 'circle', center: pen, rx, ry });
				pushHandle('radius', { x: pen.x + rx, y: pen.y }, index, 'radius');
				break;
			}
			case 'arc': {
				if (!pen) {
					break;
				}
				const radius = element.radius.cm * avgScale(scale);
				const startRad = (element.startAngle.value * Math.PI) / 180;
				const endRad = (element.endAngle.value * Math.PI) / 180;
				const center: TikzCoordinate = {
					x: pen.x - radius * Math.cos(startRad),
					y: pen.y - radius * Math.sin(startRad),
				};
				primitives.push({
					kind: 'arc',
					center,
					radius,
					startDeg: element.startAngle.value,
					endDeg: element.endAngle.value,
				});
				pen = {
					x: center.x + radius * Math.cos(endRad),
					y: center.y + radius * Math.sin(endRad),
				};
				break;
			}
			case 'cycle': {
				if (pen && subpathStart) {
					primitives.push({ kind: 'segment', a: pen, b: subpathStart });
				}
				break;
			}
			case 'raw':
				break;
		}
	}

	return { primitives, handles };
}

function resolveNodeGeometry(
	object: SceneNodeObject,
	picture: ScenePicture,
): { primitives: ScenePrimitive[]; handles: ObjectHandle[] } {
	const at = scalePoint(object.at.resolved, picture.scale);
	return {
		primitives: [{ kind: 'nodeMark', at, text: object.text }],
		handles: [{
			id: `${object.id}:-1:at`,
			kind: 'vertex',
			posCm: at,
			elementIndex: -1,
			token: 'at',
		}],
	};
}

const BOUNDS_SAMPLES = 8;

function primitiveBoundsInto(
	primitive: ScenePrimitive,
	include: (point: TikzCoordinate, pad?: number) => void,
): void {
	switch (primitive.kind) {
		case 'segment':
			include(primitive.a);
			include(primitive.b);
			break;
		case 'bezier':
			// Sample the curve itself: the control-point hull can extend far
			// beyond what is visible, which made box selection feel wrong.
			include(primitive.a);
			include(primitive.b);
			for (let step = 1; step < BOUNDS_SAMPLES; step++) {
				include(bezierPoint(
					step / BOUNDS_SAMPLES,
					primitive.a, primitive.c1, primitive.c2, primitive.b,
				));
			}
			break;
		case 'rect':
		case 'grid':
			include(primitive.a);
			include(primitive.b);
			break;
		case 'circle':
			include(primitive.center, Math.max(primitive.rx, primitive.ry));
			break;
		case 'arc': {
			// Sample the swept range only, not the whole circle.
			const startRad = (primitive.startDeg * Math.PI) / 180;
			const endRad = (primitive.endDeg * Math.PI) / 180;
			for (let step = 0; step <= BOUNDS_SAMPLES; step++) {
				const angle = startRad + ((endRad - startRad) * step) / BOUNDS_SAMPLES;
				include({
					x: primitive.center.x + primitive.radius * Math.cos(angle),
					y: primitive.center.y + primitive.radius * Math.sin(angle),
				});
			}
			break;
		}
		case 'nodeMark':
			include(primitive.at, 0.4);
			break;
	}
}

export function resolveObjectGeometry(
	object: SceneObject,
	picture: ScenePicture,
): ObjectGeometry {
	let resolved: { primitives: ScenePrimitive[]; handles: ObjectHandle[] };
	if (object.type === 'path') {
		resolved = resolvePathGeometry(object, picture);
	} else if (object.type === 'node') {
		resolved = resolveNodeGeometry(object, picture);
	} else {
		resolved = { primitives: [], handles: [] };
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const include = (point: TikzCoordinate, pad = 0) => {
		minX = Math.min(minX, point.x - pad);
		minY = Math.min(minY, point.y - pad);
		maxX = Math.max(maxX, point.x + pad);
		maxY = Math.max(maxY, point.y + pad);
	};
	for (const primitive of resolved.primitives) {
		primitiveBoundsInto(primitive, include);
	}

	return {
		object,
		primitives: resolved.primitives,
		handles: resolved.handles,
		filled: isFilledObject(object),
		bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null,
	};
}

export function resolveSceneGeometry(scene: TikzScene): ObjectGeometry[] {
	return scene.objects.map(object =>
		resolveObjectGeometry(object, scene.pictures[object.pictureIndex]));
}

/** Rebuild a geometry with substitute primitives (locked-object ghosts). */
export function withGhostPrimitives(
	geometry: ObjectGeometry,
	primitives: ScenePrimitive[],
): ObjectGeometry {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const include = (point: TikzCoordinate, pad = 0) => {
		minX = Math.min(minX, point.x - pad);
		minY = Math.min(minY, point.y - pad);
		maxX = Math.max(maxX, point.x + pad);
		maxY = Math.max(maxY, point.y + pad);
	};
	for (const primitive of primitives) {
		primitiveBoundsInto(primitive, include);
	}
	return {
		...geometry,
		primitives,
		bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null,
	};
}

/* -------------------------------------------------------------------------- */
/* distances and hit testing                                                   */
/* -------------------------------------------------------------------------- */

function distanceToSegment(p: TikzCoordinate, a: TikzCoordinate, b: TikzCoordinate): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) {
		return Math.hypot(p.x - a.x, p.y - a.y);
	}
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function bezierPoint(
	t: number,
	a: TikzCoordinate,
	c1: TikzCoordinate,
	c2: TikzCoordinate,
	b: TikzCoordinate,
): TikzCoordinate {
	const mt = 1 - t;
	return {
		x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
		y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
	};
}

const CURVE_SAMPLES = 16;

function distanceToPrimitive(
	point: TikzCoordinate,
	primitive: ScenePrimitive,
	filled: boolean,
): number {
	switch (primitive.kind) {
		case 'segment':
			return distanceToSegment(point, primitive.a, primitive.b);
		case 'bezier': {
			let best = Number.POSITIVE_INFINITY;
			let previous = primitive.a;
			for (let step = 1; step <= CURVE_SAMPLES; step++) {
				const next = bezierPoint(step / CURVE_SAMPLES, primitive.a, primitive.c1, primitive.c2, primitive.b);
				best = Math.min(best, distanceToSegment(point, previous, next));
				previous = next;
			}
			return best;
		}
		case 'rect':
		case 'grid': {
			const minX = Math.min(primitive.a.x, primitive.b.x);
			const maxX = Math.max(primitive.a.x, primitive.b.x);
			const minY = Math.min(primitive.a.y, primitive.b.y);
			const maxY = Math.max(primitive.a.y, primitive.b.y);
			const outside = Math.hypot(
				Math.max(minX - point.x, 0, point.x - maxX),
				Math.max(minY - point.y, 0, point.y - maxY),
			);
			if (filled || outside > 0) {
				return outside;
			}
			return Math.min(point.x - minX, maxX - point.x, point.y - minY, maxY - point.y);
		}
		case 'circle': {
			const rx = Math.max(primitive.rx, 1e-6);
			const ry = Math.max(primitive.ry, 1e-6);
			// Scaled-space approximation: exact for circles, close for ellipses.
			const nx = (point.x - primitive.center.x) / rx;
			const ny = (point.y - primitive.center.y) / ry;
			const radial = Math.sqrt(nx * nx + ny * ny);
			const meanRadius = (rx + ry) / 2;
			if (filled) {
				return Math.max(0, (radial - 1) * meanRadius);
			}
			return Math.abs(radial - 1) * meanRadius;
		}
		case 'arc': {
			let best = Number.POSITIVE_INFINITY;
			const startRad = (primitive.startDeg * Math.PI) / 180;
			const endRad = (primitive.endDeg * Math.PI) / 180;
			let previous: TikzCoordinate | null = null;
			for (let step = 0; step <= CURVE_SAMPLES; step++) {
				const angle = startRad + ((endRad - startRad) * step) / CURVE_SAMPLES;
				const next = {
					x: primitive.center.x + primitive.radius * Math.cos(angle),
					y: primitive.center.y + primitive.radius * Math.sin(angle),
				};
				if (previous) {
					best = Math.min(best, distanceToSegment(point, previous, next));
				}
				previous = next;
			}
			return best;
		}
		case 'nodeMark': {
			const halfWidth = Math.max(0.35, primitive.text.length * 0.09);
			const dx = Math.max(Math.abs(point.x - primitive.at.x) - halfWidth, 0);
			const dy = Math.max(Math.abs(point.y - primitive.at.y) - 0.3, 0);
			return Math.hypot(dx, dy);
		}
	}
}

export function distanceToObject(point: TikzCoordinate, geometry: ObjectGeometry): number {
	let best = Number.POSITIVE_INFINITY;
	for (const primitive of geometry.primitives) {
		best = Math.min(best, distanceToPrimitive(point, primitive, geometry.filled));
		if (best === 0) {
			return 0;
		}
	}
	return best;
}

/**
 * Object under the pointer: the *nearest* object within `toleranceCm`, with a
 * bias toward later statements (they paint on top in TikZ) when distances are
 * comparable. Pure topmost-first-within-tolerance selected an object half the
 * tolerance away over one the pointer was touching.
 */
export function hitTestScene(
	geometries: readonly ObjectGeometry[],
	point: TikzCoordinate,
	toleranceCm: number,
	options: { includeLocked?: boolean } = {},
): ObjectGeometry | null {
	let best: ObjectGeometry | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	const topmostBias = toleranceCm * 0.35;
	for (let index = geometries.length - 1; index >= 0; index--) {
		const geometry = geometries[index];
		if (geometry.object.type === 'locked' && !options.includeLocked) {
			continue;
		}
		const distance = distanceToObject(point, geometry);
		if (distance > toleranceCm) {
			continue;
		}
		// A lower object must beat the current winner by a clear margin.
		if (distance + topmostBias < bestDistance) {
			best = geometry;
			bestDistance = distance;
		}
		if (bestDistance === 0) {
			break;
		}
	}
	return best;
}

/** Handle within `toleranceCm` of `point`, preferring vertices over controls. */
export function hitTestHandles(
	handles: readonly ObjectHandle[],
	point: TikzCoordinate,
	toleranceCm: number,
): ObjectHandle | null {
	let best: ObjectHandle | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const handle of handles) {
		const distance = Math.hypot(point.x - handle.posCm.x, point.y - handle.posCm.y);
		if (distance > toleranceCm) {
			continue;
		}
		const biased = handle.kind === 'control' ? distance + 0.01 : distance;
		if (biased < bestDistance) {
			bestDistance = biased;
			best = handle;
		}
	}
	return best;
}

/** Snap candidates (endpoints and centers) from every editable object. */
export function snapCandidates(
	geometries: readonly ObjectGeometry[],
	excludeObjectId?: string,
): TikzCoordinate[] {
	const candidates: TikzCoordinate[] = [];
	for (const geometry of geometries) {
		if (geometry.object.id === excludeObjectId || geometry.object.type === 'locked') {
			continue;
		}
		for (const handle of geometry.handles) {
			if (handle.kind !== 'control') {
				candidates.push(handle.posCm);
			}
		}
		for (const primitive of geometry.primitives) {
			if (primitive.kind === 'circle') {
				candidates.push(primitive.center);
			} else if (primitive.kind === 'rect') {
				candidates.push({
					x: (primitive.a.x + primitive.b.x) / 2,
					y: (primitive.a.y + primitive.b.y) / 2,
				});
			}
		}
	}
	return candidates;
}

/**
 * Approximate display geometry for locked statements, keyed by object id.
 * Reuses the hover-highlight geometry map so locked `\draw`s still show a
 * ghost outline; statements the shallow parser cannot model simply get none
 * (they remain visible in the authoritative compiled preview).
 */
export function resolveLockedGhosts(scene: TikzScene): Map<string, ScenePrimitive[]> {
	const ghosts = new Map<string, ScenePrimitive[]>();
	const locked = scene.objects.filter(object => object.type === 'locked');
	if (!locked.length) {
		return ghosts;
	}

	const lineStarts = [0];
	for (let index = 0; index < scene.source.length; index++) {
		if (scene.source[index] === '\n') {
			lineStarts.push(index + 1);
		}
	}
	const lineOf = (offset: number): number => {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if (lineStarts[mid] <= offset) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return low;
	};

	const map = buildTikzGeometryMap(scene.source);
	for (const object of locked) {
		const startLine = lineOf(object.span.from);
		const endLine = lineOf(Math.max(object.span.from, object.span.to - 1));
		const primitives: ScenePrimitive[] = [];
		for (const statement of map.statements) {
			if (statement.endLine < startLine || statement.startLine > endLine) {
				continue;
			}
			for (const shape of statement.shapes) {
				switch (shape.kind) {
					case 'point':
						primitives.push({ kind: 'circle', center: shape.at, rx: 0.08, ry: 0.08 });
						break;
					case 'segment':
						primitives.push({ kind: 'segment', a: shape.a, b: shape.b });
						break;
					case 'rect':
						primitives.push({ kind: 'rect', a: shape.a, b: shape.b });
						break;
					case 'circle':
						primitives.push({
							kind: 'circle',
							center: shape.center,
							rx: shape.radius,
							ry: shape.radius,
						});
						break;
				}
			}
		}
		if (primitives.length) {
			ghosts.set(object.id, primitives);
		}
	}
	return ghosts;
}

/** Union bounds of all objects, or null when the scene draws nothing. */
export function sceneBounds(
	geometries: readonly ObjectGeometry[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const geometry of geometries) {
		if (!geometry.bounds) {
			continue;
		}
		minX = Math.min(minX, geometry.bounds.minX);
		minY = Math.min(minY, geometry.bounds.minY);
		maxX = Math.max(maxX, geometry.bounds.maxX);
		maxY = Math.max(maxY, geometry.bounds.maxY);
	}
	return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
