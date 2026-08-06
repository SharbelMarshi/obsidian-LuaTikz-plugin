import { SVG_NS } from './sceneSvg';

/**
 * Inline stroke icons for the visual editor toolbar (24x24 viewBox, styled
 * via `currentColor`). Self-contained on purpose: no icon font, no dependency
 * on Obsidian's icon registry, renders identically on desktop and mobile and
 * under jsdom in tests. Shapes follow the familiar Lucide look.
 */

export const EDITOR_ICONS = {
	select: '<path d="M4 3l7.5 17 2.4-7.1L21 10.5z"/>',
	pan: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
	line: '<path d="M5 19L19 5"/>',
	arrow: '<path d="M6 18L18 6M10 6h8v8"/>',
	path: '<path d="M3 19l5.5-9 4.5 4.5L21 5"/>',
	bezier: '<path d="M3 19C8 5 16 21 21 6"/><circle cx="3" cy="19" r="1.4"/><circle cx="21" cy="6" r="1.4"/>',
	freehand: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
	rect: '<rect x="4" y="6" width="16" height="12"/>',
	'rounded-rect': '<rect x="4" y="6" width="16" height="12" rx="4"/>',
	circle: '<circle cx="12" cy="12" r="8"/>',
	ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6"/>',
	arc: '<path d="M5 19A14 14 0 0 1 19 5"/>',
	'grid-path': '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
	diamond: '<path d="M12 3l7 9-7 9-7-9z"/>',
	polygon: '<path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/>',
	star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 5.9-5.3-3-5.3 3 1.2-5.9L3.4 9.3l6-.7z"/>',
	text: '<path d="M5 5h14M12 5v14M9 19h6"/>',
	math: '<path d="M18 5H6l7 7-7 7h12"/>',
	undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/>',
	redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9h-9a7 7 0 0 0-7 7v3"/>',
	duplicate: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
	delete: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
	style: '<path d="M12 22a10 10 0 1 1 10-10c0 2-1.5 3.5-3.5 3.5H16A2.5 2.5 0 0 0 13.5 18v1c0 1.7-.6 3-1.5 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
	source: '<path d="M8 18l-6-6 6-6M16 6l6 6-6 6"/>',
	done: '<path d="M4 12l6 6L20 6"/>',
	grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
	snap: '<path d="M7 3v7a5 5 0 0 0 10 0V3"/><path d="M4 3h6M14 3h6M9 21l3-3 3 3"/>',
	finger: '<path d="M9 11V5a1.7 1.7 0 0 1 3.4 0v6"/><path d="M12.4 11l3.8 1.3a2.4 2.4 0 0 1 1.5 3l-1 3.2A4.2 4.2 0 0 1 12.7 21h-1.2a4.2 4.2 0 0 1-3.5-1.9L5 15"/>',
	fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
	'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M8 11h6M11 8v6"/>',
	'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M8 11h6"/>',
} as const;

export type EditorIconName = keyof typeof EDITOR_ICONS;

/** Build the icon `<svg>`; returns null when the markup fails to parse. */
export function iconEl(doc: Document, name: EditorIconName): SVGSVGElement | null {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('luatikz-ve-icon');
	try {
		svg.innerHTML = EDITOR_ICONS[name];
	} catch {
		return null;
	}
	return svg.firstChild ? svg : null;
}
