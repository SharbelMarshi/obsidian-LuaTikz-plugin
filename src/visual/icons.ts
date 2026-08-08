import { SVG_NS } from './sceneSvg';

/**
 * Inline stroke icons for the visual editor toolbar (24x24 viewBox, styled
 * via `currentColor`). Self-contained on purpose: no icon font, no dependency
 * on Obsidian's icon registry, renders identically on desktop and mobile and
 * under jsdom in tests.
 *
 * Icons are stored as structured shape lists and built with `createElementNS`
 * — never `innerHTML` — so no markup string ever reaches the DOM parser.
 */

type IconShape =
	| { tag: 'path'; d: string }
	| { tag: 'circle'; cx: number; cy: number; r: number }
	| { tag: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
	| { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const p = (d: string): IconShape => ({ tag: 'path', d });

/** Identity helper: enforces the shape type while keeping literal key names
 * (the repo's esbuild predates the `satisfies` operator). */
const defineIcons = <T extends Record<string, readonly IconShape[]>>(icons: T): T => icons;

export const EDITOR_ICONS = defineIcons({
	select: [p('M4 3l7.5 17 2.4-7.1L21 10.5z')],
	pan: [p('M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3')],
	line: [p('M5 19L19 5')],
	arrow: [p('M6 18L18 6M10 6h8v8')],
	path: [p('M3 19l5.5-9 4.5 4.5L21 5')],
	bezier: [
		p('M3 19C8 5 16 21 21 6'),
		{ tag: 'circle', cx: 3, cy: 19, r: 1.4 },
		{ tag: 'circle', cx: 21, cy: 6, r: 1.4 },
	],
	freehand: [p('M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z')],
	rect: [{ tag: 'rect', x: 4, y: 6, width: 16, height: 12 }],
	'rounded-rect': [{ tag: 'rect', x: 4, y: 6, width: 16, height: 12, rx: 4 }],
	triangle: [p('M12 4l9 16H3z')],
	shapes: [
		p('M8.2 3L13.4 11.5H3z'),
		{ tag: 'rect', x: 3, y: 14, width: 7, height: 7 },
		{ tag: 'circle', cx: 17.2, cy: 17.2, r: 4.3 },
	],
	circle: [{ tag: 'circle', cx: 12, cy: 12, r: 8 }],
	ellipse: [{ tag: 'ellipse', cx: 12, cy: 12, rx: 9, ry: 6 }],
	arc: [p('M5 19A14 14 0 0 1 19 5')],
	'grid-path': [p('M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16')],
	diamond: [p('M12 3l7 9-7 9-7-9z')],
	polygon: [p('M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z')],
	star: [p('M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 5.9-5.3-3-5.3 3 1.2-5.9L3.4 9.3l6-.7z')],
	text: [p('M5 5h14M12 5v14M9 19h6')],
	math: [p('M18 5H6l7 7-7 7h12')],
	plot: [p('M3 3v18h18'), p('M5 17c2.5-9 4.5-9 7-2s4.5 7 7-2')],
	objects: [p('M12 2l9 5-9 5-9-5z'), p('M3 12l9 5 9-5'), p('M3 17l9 5 9-5')],
	undo: [p('M9 14L4 9l5-5'), p('M4 9h9a7 7 0 0 1 7 7v3')],
	redo: [p('M15 14l5-5-5-5'), p('M20 9h-9a7 7 0 0 0-7 7v3')],
	duplicate: [
		{ tag: 'rect', x: 9, y: 9, width: 11, height: 11, rx: 2 },
		p('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'),
	],
	delete: [p('M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6')],
	style: [
		p('M12 22a10 10 0 1 1 10-10c0 2-1.5 3.5-3.5 3.5H16A2.5 2.5 0 0 0 13.5 18v1c0 1.7-.6 3-1.5 3z'),
		{ tag: 'circle', cx: 7.5, cy: 10.5, r: 1 },
		{ tag: 'circle', cx: 12, cy: 7, r: 1 },
		{ tag: 'circle', cx: 16.5, cy: 10.5, r: 1 },
	],
	source: [p('M8 18l-6-6 6-6M16 6l6 6-6 6')],
	done: [p('M4 12l6 6L20 6')],
	grid: [p('M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16')],
	snap: [p('M7 3v7a5 5 0 0 0 10 0V3'), p('M4 3h6M14 3h6M9 21l3-3 3 3')],
	finger: [
		p('M9 11V5a1.7 1.7 0 0 1 3.4 0v6'),
		p('M12.4 11l3.8 1.3a2.4 2.4 0 0 1 1.5 3l-1 3.2A4.2 4.2 0 0 1 12.7 21h-1.2a4.2 4.2 0 0 1-3.5-1.9L5 15'),
	],
	fit: [p('M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3')],
	'zoom-in': [
		{ tag: 'circle', cx: 11, cy: 11, r: 7 },
		p('M21 21l-4.5-4.5M8 11h6M11 8v6'),
	],
	'zoom-out': [
		{ tag: 'circle', cx: 11, cy: 11, r: 7 },
		p('M21 21l-4.5-4.5M8 11h6'),
	],
});

export type EditorIconName = keyof typeof EDITOR_ICONS;

/** Build the icon `<svg>` from its shape list. */
export function iconEl(doc: Document, name: EditorIconName): SVGSVGElement | null {
	const shapes = EDITOR_ICONS[name];
	if (!shapes?.length) {
		return null;
	}
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('luatikz-ve-icon');
	for (const shape of shapes) {
		const el = doc.createElementNS(SVG_NS, shape.tag);
		for (const [key, value] of Object.entries(shape)) {
			if (key !== 'tag') {
				el.setAttribute(key, String(value));
			}
		}
		svg.appendChild(el);
	}
	return svg;
}
