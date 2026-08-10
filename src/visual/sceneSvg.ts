import {
	PT_PER_CM,
	parseBBoxAttribute,
	type TikzCoordinate,
	type TikzPtBBox,
} from '../utils/coordinatePick';
import { parseOptionStyle } from './tikzOptions';
import { applyColorShade, tikzColorToCss } from './tikzColors';
import type { ObjectGeometry, ObjectHandle, ScenePrimitive } from './sceneGeometry';
import { gridLinePositions, type ViewBox } from './editorViewport';
import type { ArrowTipKind, PatternStyle, ShadingStyle } from './sceneTypes';

export { tikzColorToCss } from './tikzColors';

/**
 * Immediate-mode SVG rendering of the editor scene.
 *
 * This is deliberately *not* a TikZ renderer — it is a fast, approximate
 * wireframe used only for interaction. The authoritative appearance always
 * comes from the existing LuaTikZ/TikZJax pipeline, shown alongside the
 * canvas. Canvas user units are TeX pt with Y down, matching the compiled
 * SVG's convention, so TikZ line widths in pt map 1:1 to stroke widths.
 *
 * Built with vanilla DOM so the module runs unchanged under jsdom in tests.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

const HANDLE_SIZE_PX = 12;
const MIN_STROKE_PX = 1;

export interface RenderContext {
	doc: Document;
	/** Current screen scale, used to keep hairlines and handles visible. */
	pxPerPt: number;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
	const el = doc.createElementNS(SVG_NS, tag);
	for (const [key, value] of Object.entries(attrs)) {
		el.setAttribute(key, value);
	}
	return el;
}

export function cmToPt(point: TikzCoordinate): { x: number; y: number } {
	return { x: point.x * PT_PER_CM, y: -point.y * PT_PER_CM };
}

const fmt = (value: number): string => String(Math.round(value * 1000) / 1000);

const LINE_WIDTH_PT: Record<string, number> = {
	'ultra thin': 0.1,
	'very thin': 0.2,
	thin: 0.4,
	semithick: 0.6,
	thick: 0.8,
	'very thick': 1.2,
	'ultra thick': 1.6,
};

export function optionsToStrokeWidthPt(options: string): number {
	const explicit = options.match(/line width\s*=\s*([\d.]+)\s*(pt|mm|cm)?/);
	if (explicit) {
		const value = Number.parseFloat(explicit[1]);
		const unit = explicit[2] ?? 'pt';
		if (Number.isFinite(value)) {
			return unit === 'cm' ? value * PT_PER_CM : unit === 'mm' ? value * PT_PER_CM / 10 : value;
		}
	}
	for (const [token, width] of Object.entries(LINE_WIDTH_PT)) {
		if (options.includes(token)) {
			return width;
		}
	}
	return 0.4;
}

/* -------------------------------------------------------------------------- */
/* primitives                                                                  */
/* -------------------------------------------------------------------------- */

function arcPathD(primitive: Extract<ScenePrimitive, { kind: 'arc' }>): string {
	const startRad = (primitive.startDeg * Math.PI) / 180;
	const endRad = (primitive.endDeg * Math.PI) / 180;
	const start = cmToPt({
		x: primitive.center.x + primitive.radius * Math.cos(startRad),
		y: primitive.center.y + primitive.radius * Math.sin(startRad),
	});
	const end = cmToPt({
		x: primitive.center.x + primitive.radius * Math.cos(endRad),
		y: primitive.center.y + primitive.radius * Math.sin(endRad),
	});
	const radiusPt = primitive.radius * PT_PER_CM;
	const delta = primitive.endDeg - primitive.startDeg;
	const largeArc = Math.abs(delta) > 180 ? 1 : 0;
	// TikZ angles are counter-clockwise in Y-up space; SVG sweep=0 is
	// counter-clockwise in its Y-down space when delta is positive.
	const sweep = delta > 0 ? 0 : 1;
	return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(radiusPt)} ${fmt(radiusPt)} 0 ${largeArc} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;
}

export function primitiveToSvg(
	context: RenderContext,
	primitive: ScenePrimitive,
): SVGElement | null {
	const { doc } = context;
	switch (primitive.kind) {
		case 'segment': {
			const a = cmToPt(primitive.a);
			const b = cmToPt(primitive.b);
			return svgEl(doc, 'line', {
				x1: fmt(a.x), y1: fmt(a.y), x2: fmt(b.x), y2: fmt(b.y),
			});
		}
		case 'bezier': {
			const a = cmToPt(primitive.a);
			const c1 = cmToPt(primitive.c1);
			const c2 = cmToPt(primitive.c2);
			const b = cmToPt(primitive.b);
			return svgEl(doc, 'path', {
				d: `M ${fmt(a.x)} ${fmt(a.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(b.x)} ${fmt(b.y)}`,
			});
		}
		case 'rect': {
			const a = cmToPt(primitive.a);
			const b = cmToPt(primitive.b);
			return svgEl(doc, 'rect', {
				x: fmt(Math.min(a.x, b.x)),
				y: fmt(Math.min(a.y, b.y)),
				width: fmt(Math.abs(b.x - a.x)),
				height: fmt(Math.abs(b.y - a.y)),
			});
		}
		case 'grid': {
			const group = svgEl(doc, 'g');
			const minX = Math.min(primitive.a.x, primitive.b.x);
			const maxX = Math.max(primitive.a.x, primitive.b.x);
			const minY = Math.min(primitive.a.y, primitive.b.y);
			const maxY = Math.max(primitive.a.y, primitive.b.y);
			const step = 1;
			for (let x = Math.ceil(minX); x <= maxX; x += step) {
				const top = cmToPt({ x, y: maxY });
				const bottom = cmToPt({ x, y: minY });
				group.appendChild(svgEl(doc, 'line', {
					x1: fmt(top.x), y1: fmt(top.y), x2: fmt(bottom.x), y2: fmt(bottom.y),
				}));
			}
			for (let y = Math.ceil(minY); y <= maxY; y += step) {
				const left = cmToPt({ x: minX, y });
				const right = cmToPt({ x: maxX, y });
				group.appendChild(svgEl(doc, 'line', {
					x1: fmt(left.x), y1: fmt(left.y), x2: fmt(right.x), y2: fmt(right.y),
				}));
			}
			const a = cmToPt({ x: minX, y: maxY });
			group.appendChild(svgEl(doc, 'rect', {
				x: fmt(a.x),
				y: fmt(a.y),
				width: fmt((maxX - minX) * PT_PER_CM),
				height: fmt((maxY - minY) * PT_PER_CM),
			}));
			return group;
		}
		case 'circle': {
			const center = cmToPt(primitive.center);
			return svgEl(doc, 'ellipse', {
				cx: fmt(center.x),
				cy: fmt(center.y),
				rx: fmt(primitive.rx * PT_PER_CM),
				ry: fmt(primitive.ry * PT_PER_CM),
			});
		}
		case 'arc':
			return svgEl(doc, 'path', { d: arcPathD(primitive) });
		case 'nodeMark': {
			const at = cmToPt(primitive.at);
			const isMath = /^\s*\$.*\$\s*$/.test(primitive.text);
			const label = isMath
				? primitive.text.replace(/^\s*\$|\$\s*$/g, '')
				: primitive.text;
			const text = svgEl(doc, 'text', {
				x: fmt(at.x),
				y: fmt(at.y),
				'text-anchor': 'middle',
				'dominant-baseline': 'central',
				'font-size': '10',
			});
			if (isMath) {
				text.setAttribute('font-style', 'italic');
			}
			text.textContent = label || '·';
			return text;
		}
	}
}

/* -------------------------------------------------------------------------- */
/* arrowheads                                                                  */
/* -------------------------------------------------------------------------- */

function arrowheadAt(
	context: RenderContext,
	tip: TikzCoordinate,
	fromDirection: TikzCoordinate,
	color: string,
	widthPt: number,
	tipKind: ArrowTipKind = 'default',
): SVGElement | null {
	const length = Math.hypot(fromDirection.x, fromDirection.y);
	if (length < 1e-6) {
		return null;
	}
	const ux = fromDirection.x / length;
	const uy = fromDirection.y / length;
	// Head length in cm: 3pt base plus growth with line width.
	const sizeCm = (3 + widthPt * 2.5) / PT_PER_CM;
	// Point `back` along the shaft and `side` across it, both scaled by sizeCm.
	const at = (back: number, side: number): { x: number; y: number } => cmToPt({
		x: tip.x - ux * sizeCm * back - uy * sizeCm * side,
		y: tip.y - uy * sizeCm * back + ux * sizeCm * side,
	});
	const point = (back: number, side: number): string => {
		const p = at(back, side);
		return `${fmt(p.x)} ${fmt(p.y)}`;
	};
	const filled = (d: string): SVGElement => svgEl(context.doc, 'path', {
		d, fill: color, stroke: 'none',
	});
	const stroked = (d: string): SVGElement => svgEl(context.doc, 'path', {
		d,
		fill: 'none',
		stroke: color,
		'stroke-width': fmt(Math.max(widthPt, 0.6)),
	});

	switch (tipKind) {
		case 'Stealth':
			return filled(
				`M ${point(0, 0)} L ${point(1, 0.5)} L ${point(0.62, 0)} L ${point(1, -0.5)} Z`,
			);
		case 'Latex':
			return filled(
				`M ${point(0, 0)} L ${point(1.3, 0.4)} L ${point(1.3, -0.4)} Z`,
			);
		case 'Triangle':
			return filled(
				`M ${point(0, 0)} L ${point(1.1, 0.62)} L ${point(1.1, -0.62)} Z`,
			);
		case 'Circle': {
			const center = at(0.45, 0);
			return svgEl(context.doc, 'circle', {
				cx: fmt(center.x),
				cy: fmt(center.y),
				r: fmt(sizeCm * 0.45 * PT_PER_CM),
				fill: color,
				stroke: 'none',
			});
		}
		case 'Square':
			return filled(
				`M ${point(0, 0.45)} L ${point(0, -0.45)} L ${point(0.9, -0.45)} L ${point(0.9, 0.45)} Z`,
			);
		case 'Diamond':
			return filled(
				`M ${point(0, 0)} L ${point(0.6, 0.45)} L ${point(1.2, 0)} L ${point(0.6, -0.45)} Z`,
			);
		case 'Bar':
			return stroked(`M ${point(0, 0.55)} L ${point(0, -0.55)}`);
		case 'Hooks':
			return stroked(
				`M ${point(0.6, 0.6)} C ${point(0.1, 0.6)}, ${point(-0.12, 0.35)}, ${point(0, 0)}`
				+ ` C ${point(-0.12, -0.35)}, ${point(0.1, -0.6)}, ${point(0.6, -0.6)}`,
			);
		default:
			return filled(
				`M ${point(0, 0)} L ${point(1, 0.45)} L ${point(1, -0.45)} Z`,
			);
	}
}

function endpointDirections(
	primitives: readonly ScenePrimitive[],
): { start: { at: TikzCoordinate; dir: TikzCoordinate } | null; end: { at: TikzCoordinate; dir: TikzCoordinate } | null } {
	let start: { at: TikzCoordinate; dir: TikzCoordinate } | null = null;
	let end: { at: TikzCoordinate; dir: TikzCoordinate } | null = null;
	for (const primitive of primitives) {
		if (primitive.kind === 'segment') {
			if (!start) {
				start = {
					at: primitive.a,
					dir: { x: primitive.a.x - primitive.b.x, y: primitive.a.y - primitive.b.y },
				};
			}
			end = {
				at: primitive.b,
				dir: { x: primitive.b.x - primitive.a.x, y: primitive.b.y - primitive.a.y },
			};
		} else if (primitive.kind === 'bezier') {
			if (!start) {
				start = {
					at: primitive.a,
					dir: { x: primitive.a.x - primitive.c1.x, y: primitive.a.y - primitive.c1.y },
				};
			}
			end = {
				at: primitive.b,
				dir: { x: primitive.b.x - primitive.c2.x, y: primitive.b.y - primitive.c2.y },
			};
		}
	}
	return { start, end };
}

/* -------------------------------------------------------------------------- */
/* fill paint: gradients and patterns                                          */
/* -------------------------------------------------------------------------- */

/** Sanitize an object id (`p0:s1`) into an SVG id fragment. */
const defsId = (objectId: string, suffix: string): string =>
	`luatikz-ve-${objectId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${suffix}`;

/** Approximate SVG gradient for a TikZ shading. */
function shadingDef(doc: Document, id: string, shading: ShadingStyle): SVGElement {
	const stop = (offset: string, cssColor: string): SVGElement =>
		svgEl(doc, 'stop', { offset, 'stop-color': cssColor });
	if (shading.kind === 'radial' || shading.kind === 'ball') {
		const gradient = svgEl(doc, 'radialGradient', {
			id, cx: '0.5', cy: '0.5', r: '0.5',
		});
		if (shading.kind === 'ball') {
			gradient.setAttribute('fx', '0.35');
			gradient.setAttribute('fy', '0.35');
			gradient.appendChild(stop('0%', tikzColorToCss(applyColorShade(shading.from, 70))));
			gradient.appendChild(stop('60%', tikzColorToCss(shading.from)));
			gradient.appendChild(stop('100%', tikzColorToCss(applyColorShade(shading.from, -40))));
		} else {
			gradient.appendChild(stop('0%', tikzColorToCss(shading.from)));
			gradient.appendChild(stop('100%', tikzColorToCss(shading.to)));
		}
		return gradient;
	}
	const vertical = shading.kind === 'vertical';
	const gradient = svgEl(doc, 'linearGradient', {
		id,
		x1: '0', y1: '0',
		x2: vertical ? '0' : '1',
		y2: vertical ? '1' : '0',
	});
	if (shading.angle) {
		// TikZ rotates shadings counter-clockwise; canvas Y points down.
		gradient.setAttribute('gradientTransform', `rotate(${fmt(-shading.angle)}, 0.5, 0.5)`);
	}
	gradient.appendChild(stop('0%', tikzColorToCss(shading.from)));
	gradient.appendChild(stop('100%', tikzColorToCss(shading.to)));
	return gradient;
}

/** Tile line/dot work for each pattern the editor offers. */
const PATTERN_TILES: Record<string, { w: number; h: number; d: string; dots?: boolean; lw?: number }> = {
	'horizontal lines': { w: 4, h: 4, d: 'M0 2H4' },
	'vertical lines': { w: 4, h: 4, d: 'M2 0V4' },
	'north east lines': { w: 4, h: 4, d: 'M0 4L4 0M-1 1L1 -1M3 5L5 3' },
	'north west lines': { w: 4, h: 4, d: 'M0 0L4 4M3 -1L5 1M-1 3L1 5' },
	'north east lines wide': { w: 4.5, h: 4.5, d: 'M0 4.5L4.5 0M-1 1L1 -1M3.5 5.5L5.5 3.5' },
	'north west lines wide': { w: 4.5, h: 4.5, d: 'M0 0L4.5 4.5M3.5 -1L5.5 1M-1 3.5L1 5.5' },
	'diagonal stripes': { w: 6, h: 6, d: 'M0 6L6 0M-2 2L2 -2M4 8L8 4', lw: 2.5 },
	grid: { w: 4, h: 4, d: 'M0 2H4M2 0V4' },
	crosshatch: { w: 4, h: 4, d: 'M0 4L4 0M0 0L4 4' },
	dots: { w: 3.5, h: 3.5, d: 'M1.75 1.75', dots: true },
	'crosshatch dots': { w: 2.6, h: 2.6, d: 'M1.3 1.3', dots: true },
	'fivepointed stars': {
		w: 6, h: 6,
		d: 'M3 1l0.6 1.3 1.5 0.1-1.1 1 0.35 1.4L3 4.1l-1.35 0.7L2 3.4 0.9 2.4l1.5-0.1z',
	},
	'sixpointed stars': {
		w: 6, h: 6,
		d: 'M3 1l0.9 1.5H5.6L4.75 4 5.6 5.5H3.9L3 7 2.1 5.5H0.4L1.25 4 0.4 2.5h1.7z',
	},
	bricks: { w: 8, h: 4, d: 'M0 1H8M0 3H8M2 1V3M6 3V5M6 -1V1' },
	checkerboard: { w: 4, h: 4, d: 'M0 0H2V2H0zM2 2H4V4H2z' },
};

/** Approximate SVG pattern tile for a `patterns`-library fill. */
function patternDef(doc: Document, id: string, pattern: PatternStyle): SVGElement {
	const colorCss = tikzColorToCss(pattern.color ?? 'black');
	const tile = PATTERN_TILES[pattern.name] ?? PATTERN_TILES['north east lines'];
	const el = svgEl(doc, 'pattern', {
		id,
		width: String(tile.w),
		height: String(tile.h),
		patternUnits: 'userSpaceOnUse',
	});
	const solid = pattern.name === 'fivepointed stars' || pattern.name === 'sixpointed stars'
		|| pattern.name === 'checkerboard';
	if (tile.dots) {
		const center = /^M([\d.]+) ([\d.]+)$/.exec(tile.d);
		el.appendChild(svgEl(doc, 'circle', {
			cx: center ? center[1] : '2',
			cy: center ? center[2] : '2',
			r: '0.5',
			fill: colorCss,
		}));
	} else {
		el.appendChild(svgEl(doc, 'path', {
			d: tile.d,
			fill: solid ? colorCss : 'none',
			stroke: solid ? 'none' : colorCss,
			'stroke-width': String(tile.lw ?? 0.4),
		}));
	}
	return el;
}

/**
 * One `path` covering the object's segment/bezier chains as closed subpaths,
 * used to paint fills for polygons, freehand outlines, and `\fill` paths that
 * individual stroke primitives cannot express.
 */
function closedFillPathD(primitives: readonly ScenePrimitive[]): string | null {
	let d = '';
	let cursor: TikzCoordinate | null = null;
	let count = 0;
	for (const primitive of primitives) {
		if (primitive.kind !== 'segment' && primitive.kind !== 'bezier') {
			continue;
		}
		const a = cmToPt(primitive.a);
		if (!cursor
			|| Math.abs(cursor.x - primitive.a.x) > 1e-6
			|| Math.abs(cursor.y - primitive.a.y) > 1e-6) {
			d += `${d ? ' Z ' : ''}M ${fmt(a.x)} ${fmt(a.y)}`;
		}
		const b = cmToPt(primitive.b);
		if (primitive.kind === 'segment') {
			d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
		} else {
			const c1 = cmToPt(primitive.c1);
			const c2 = cmToPt(primitive.c2);
			d += ` C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(b.x)} ${fmt(b.y)}`;
		}
		cursor = primitive.b;
		count++;
	}
	if (count < 2) {
		return null;
	}
	return `${d} Z`;
}

/* -------------------------------------------------------------------------- */
/* objects                                                                     */
/* -------------------------------------------------------------------------- */

/** Render one object as a `<g data-luatikz-object-id=…>`. */
export function renderObjectGroup(
	context: RenderContext,
	geometry: ObjectGeometry,
): SVGGElement {
	const { doc } = context;
	const group = svgEl(doc, 'g');
	group.setAttribute('data-luatikz-object-id', geometry.object.id);
	group.classList.add('luatikz-ve-object');

	const locked = geometry.object.type === 'locked';
	const options = geometry.object.type === 'locked' ? '' : geometry.object.options;
	const style = parseOptionStyle(options);
	// `draw=none` suppresses the outline (and its arrow tips); node text keeps
	// its own color, which `draw=none` does not touch in TikZ either.
	const strokeNone = style.strokeColor === 'none';
	const strokeCss = strokeNone ? 'none' : tikzColorToCss(style.strokeColor);
	const textCss = strokeNone ? tikzColorToCss(undefined) : strokeCss;
	const widthPt = optionsToStrokeWidthPt(options);
	const strokePt = Math.max(widthPt, MIN_STROKE_PX / Math.max(context.pxPerPt, 1e-6));

	const pathCommand = geometry.object.type === 'path' ? geometry.object.command : null;
	const isFillCommand = pathCommand === 'fill' || pathCommand === 'filldraw';
	const strokeVisible = pathCommand !== 'fill' && pathCommand !== 'path' && !strokeNone;

	// Fill paint layers: a gradient or solid color first, a pattern tile on
	// top (TikZ draws `fill=` and `pattern=` as two stacked fill actions).
	const defs = svgEl(doc, 'defs');
	const fillPaints: string[] = [];
	if (style.shading) {
		const id = defsId(geometry.object.id, 'shading');
		defs.appendChild(shadingDef(doc, id, style.shading));
		fillPaints.push(`url(#${id})`);
	} else if (style.fillColor !== undefined || isFillCommand) {
		const fallback = style.strokeColor && !strokeNone ? style.strokeColor : 'black';
		fillPaints.push(tikzColorToCss(style.fillColor ?? fallback));
	}
	if (style.pattern) {
		const id = defsId(geometry.object.id, 'pattern');
		defs.appendChild(patternDef(doc, id, style.pattern));
		fillPaints.push(`url(#${id})`);
	}
	if (defs.childNodes.length) {
		group.appendChild(defs);
	}

	group.setAttribute('stroke', strokeVisible ? strokeCss : 'none');
	group.setAttribute('stroke-width', fmt(strokePt));
	group.setAttribute('fill', 'none');
	group.setAttribute('stroke-linecap', 'round');
	group.setAttribute('stroke-linejoin', 'round');
	if (style.dash === 'dashed') {
		group.setAttribute('stroke-dasharray', `${fmt(strokePt * 6)} ${fmt(strokePt * 4)}`);
	} else if (style.dash === 'dotted') {
		group.setAttribute('stroke-dasharray', `${fmt(strokePt)} ${fmt(strokePt * 3)}`);
	}
	if (style.opacity !== undefined && Number.isFinite(style.opacity)) {
		group.setAttribute('opacity', String(style.opacity));
	}
	if (locked) {
		group.classList.add('luatikz-ve-object-locked');
	}

	// Fill layers go first so every stroke stays visible on top of them.
	if (fillPaints.length) {
		const fillTargets = new Set(['rect', 'circle']);
		const pathD = closedFillPathD(geometry.primitives);
		for (const paint of fillPaints) {
			if (pathD) {
				group.appendChild(svgEl(doc, 'path', {
					d: pathD,
					fill: paint,
					'fill-rule': 'evenodd',
					'fill-opacity': '0.85',
					stroke: 'none',
				}));
			}
			for (const primitive of geometry.primitives) {
				if (!fillTargets.has(primitive.kind)) {
					continue;
				}
				const el = primitiveToSvg(context, primitive);
				if (el) {
					el.setAttribute('fill', paint);
					el.setAttribute('fill-opacity', '0.85');
					el.setAttribute('stroke', 'none');
					group.appendChild(el);
				}
			}
		}
	}

	for (const primitive of geometry.primitives) {
		const el = primitiveToSvg(context, primitive);
		if (!el) {
			continue;
		}
		if (primitive.kind === 'nodeMark') {
			el.setAttribute('fill', textCss);
			el.setAttribute('stroke', 'none');
		}
		group.appendChild(el);
	}

	const arrows = !strokeNone && (style.arrows || (style.rawArrowToken ? '->' : undefined));
	const tipKind = style.arrowTip ?? 'default';
	if (arrows) {
		const { start, end } = endpointDirections(geometry.primitives);
		if ((arrows === '->' || arrows === '<->') && end) {
			const head = arrowheadAt(context, end.at, end.dir, strokeCss, widthPt, tipKind);
			if (head) {
				group.appendChild(head);
			}
		}
		if ((arrows === '<-' || arrows === '<->') && start) {
			const head = arrowheadAt(context, start.at, start.dir, strokeCss, widthPt, tipKind);
			if (head) {
				group.appendChild(head);
			}
		}
	}

	return group;
}

/** Ghost group for a locked statement's approximate geometry. */
export function renderGhostGroup(
	context: RenderContext,
	objectId: string,
	primitives: readonly ScenePrimitive[],
): SVGGElement {
	const group = svgEl(context.doc, 'g');
	group.setAttribute('data-luatikz-object-id', objectId);
	group.classList.add('luatikz-ve-ghost');
	const strokePt = Math.max(0.4, MIN_STROKE_PX / Math.max(context.pxPerPt, 1e-6));
	group.setAttribute('stroke-width', fmt(strokePt));
	group.setAttribute('fill', 'none');
	for (const primitive of primitives) {
		const el = primitiveToSvg(context, primitive);
		if (el) {
			group.appendChild(el);
		}
	}
	return group;
}

/* -------------------------------------------------------------------------- */
/* grid and overlay                                                            */
/* -------------------------------------------------------------------------- */

export function renderGridLayer(
	context: RenderContext,
	layer: SVGGElement,
	viewBox: ViewBox,
	stepCm: number,
): void {
	layer.textContent = '';
	const { xs, ys } = gridLinePositions(viewBox, stepCm);
	const top = viewBox.y;
	const bottom = viewBox.y + viewBox.h;
	const left = viewBox.x;
	const right = viewBox.x + viewBox.w;
	for (const x of xs) {
		const xPt = x * PT_PER_CM;
		const isAxis = Math.abs(x) < 1e-9;
		layer.appendChild(svgEl(context.doc, 'line', {
			x1: fmt(xPt), y1: fmt(top), x2: fmt(xPt), y2: fmt(bottom),
			class: isAxis ? 'luatikz-ve-grid-axis' : 'luatikz-ve-grid-line',
		}));
	}
	for (const y of ys) {
		const yPt = -y * PT_PER_CM;
		const isAxis = Math.abs(y) < 1e-9;
		layer.appendChild(svgEl(context.doc, 'line', {
			x1: fmt(left), y1: fmt(yPt), x2: fmt(right), y2: fmt(yPt),
			class: isAxis ? 'luatikz-ve-grid-axis' : 'luatikz-ve-grid-line',
		}));
	}
}

/* -------------------------------------------------------------------------- */
/* compiled underlay                                                           */
/* -------------------------------------------------------------------------- */

export interface CompiledUnderlay {
	wrapper: SVGGElement;
	nested: SVGSVGElement;
	/** Picture bbox in TeX pt (Y-up) when the compiled SVG carries one. */
	bbox: TikzPtBBox | null;
}

/**
 * Embed the authoritative compiled SVG inside the canvas as a background
 * layer, so the user draws on top of the *real* diagram — including every
 * construct the wireframe renderer cannot model (plots, decorations, styled
 * nodes, …).
 *
 * The embed is 1:1: the nested `<svg>` keeps its own viewBox and is placed at
 * those same coordinates in canvas user units. For SVGs whose user space is
 * TeX pt from the TikZ origin (the assumption the existing mobile pick
 * fallback already relies on) that alone aligns it; LuaLaTeX output is then
 * corrected exactly via its calibration markers (see
 * {@link underlayCalibrationTransform}).
 */
export function buildCompiledUnderlay(doc: Document, svgText: string): CompiledUnderlay | null {
	const ParserCtor = doc.defaultView?.DOMParser ?? DOMParser;
	let parsed: Document;
	try {
		parsed = new ParserCtor().parseFromString(svgText, 'image/svg+xml');
	} catch {
		return null;
	}
	const rootEl = parsed.documentElement;
	if (!rootEl || rootEl.nodeName.toLowerCase() !== 'svg') {
		return null;
	}
	const nested = doc.importNode(rootEl, true) as unknown as SVGSVGElement;

	const vbParts = (nested.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/)
		.map(Number.parseFloat);
	let box: { x: number; y: number; w: number; h: number } | null =
		vbParts.length === 4 && vbParts.every(Number.isFinite)
			? { x: vbParts[0], y: vbParts[1], w: vbParts[2], h: vbParts[3] }
			: null;
	if (!box) {
		const w = Number.parseFloat(nested.getAttribute('width') ?? '');
		const h = Number.parseFloat(nested.getAttribute('height') ?? '');
		if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
			return null;
		}
		box = { x: 0, y: 0, w, h };
		nested.setAttribute('viewBox', `0 0 ${w} ${h}`);
	}
	nested.setAttribute('x', String(box.x));
	nested.setAttribute('y', String(box.y));
	nested.setAttribute('width', String(box.w));
	nested.setAttribute('height', String(box.h));
	nested.removeAttribute('style');

	const wrapper = svgEl(doc, 'g', { class: 'luatikz-ve-underlay' });
	wrapper.appendChild(nested);
	return { wrapper, nested, bbox: parseBBoxAttribute(nested) };
}

/**
 * Uniform scale + translation mapping the measured calibration-marker centers
 * (in canvas user pt, Y down) onto the picture bbox corners they mark. The
 * min marker sits at TikZ (bbox.minX, bbox.minY), the max marker at
 * (bbox.maxX, bbox.maxY); canvas Y is the negated TikZ Y.
 */
export function underlayCalibrationTransform(
	bbox: TikzPtBBox,
	minCenter: { x: number; y: number },
	maxCenter: { x: number; y: number },
): { s: number; tx: number; ty: number } | null {
	const target1 = { x: bbox.minX, y: -bbox.minY };
	const target2 = { x: bbox.maxX, y: -bbox.maxY };
	const dx = maxCenter.x - minCenter.x;
	const dy = maxCenter.y - minCenter.y;
	const sx = Math.abs(dx) > 1e-6 ? (target2.x - target1.x) / dx : NaN;
	const sy = Math.abs(dy) > 1e-6 ? (target2.y - target1.y) / dy : NaN;
	const s = Number.isFinite(sx) && sx > 0 ? sx : sy;
	if (!Number.isFinite(s) || s <= 0) {
		return null;
	}
	return {
		s,
		tx: target1.x - s * minCenter.x,
		ty: target1.y - s * minCenter.y,
	};
}

/** Selection outlines + drag handles, sized in screen px regardless of zoom. */
export function renderSelectionOverlay(
	context: RenderContext,
	layer: SVGGElement,
	selected: readonly ObjectGeometry[],
	handles: readonly ObjectHandle[],
	rotateHandle: { x: number; y: number } | null = null,
): void {
	layer.textContent = '';
	const px = 1 / Math.max(context.pxPerPt, 1e-6);
	const handlePt = HANDLE_SIZE_PX * px;

	for (const geometry of selected) {
		if (!geometry.bounds) {
			continue;
		}
		const a = cmToPt({ x: geometry.bounds.minX, y: geometry.bounds.maxY });
		const b = cmToPt({ x: geometry.bounds.maxX, y: geometry.bounds.minY });
		layer.appendChild(svgEl(context.doc, 'rect', {
			x: fmt(a.x - 4 * px),
			y: fmt(a.y - 4 * px),
			width: fmt(b.x - a.x + 8 * px),
			height: fmt(b.y - a.y + 8 * px),
			class: 'luatikz-ve-selection-box',
			'stroke-width': fmt(px),
			'stroke-dasharray': `${fmt(4 * px)} ${fmt(3 * px)}`,
			fill: 'none',
		}));
	}

	if (rotateHandle) {
		// Stem from the selection's top edge up to the rotation grip.
		const grip = cmToPt(rotateHandle);
		layer.appendChild(svgEl(context.doc, 'line', {
			x1: fmt(grip.x),
			y1: fmt(grip.y + 14 * px),
			x2: fmt(grip.x),
			y2: fmt(grip.y),
			class: 'luatikz-ve-rotate-stem',
			'stroke-width': fmt(px),
		}));
		layer.appendChild(svgEl(context.doc, 'circle', {
			cx: fmt(grip.x),
			cy: fmt(grip.y),
			r: fmt(handlePt * 0.65),
			class: 'luatikz-ve-handle luatikz-ve-handle-rotate',
			'stroke-width': fmt(px),
		}));
	}

	for (const handle of handles) {
		const at = cmToPt(handle.posCm);
		if (handle.kind === 'control') {
			layer.appendChild(svgEl(context.doc, 'circle', {
				cx: fmt(at.x),
				cy: fmt(at.y),
				r: fmt(handlePt / 2),
				class: 'luatikz-ve-handle luatikz-ve-handle-control',
				'data-luatikz-handle-id': handle.id,
				'stroke-width': fmt(px),
			}));
		} else {
			layer.appendChild(svgEl(context.doc, 'rect', {
				x: fmt(at.x - handlePt / 2),
				y: fmt(at.y - handlePt / 2),
				width: fmt(handlePt),
				height: fmt(handlePt),
				class: `luatikz-ve-handle luatikz-ve-handle-${handle.kind}`,
				'data-luatikz-handle-id': handle.id,
				'stroke-width': fmt(px),
			}));
		}
	}
}
