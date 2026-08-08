import {
	CAL_MARKER_MAX_RGB,
	CAL_MARKER_MIN_RGB,
	clientPointToTikzCoordinate,
	fillMatchesMarker,
	PT_PER_CM,
	type TikzCoordinate,
} from '../utils/coordinatePick';
import type { TikzBlock, RenderImageResult } from '../core/types';
import { parseTikzScene, insertionPicture } from './tikzSceneParser';
import {
	containmentHit,
	hitTestCandidates,
	hitTestHandles,
	hitTestScene,
	pointInsideGeometry,
	resolveLockedGhosts,
	resolveObjectGeometry,
	resolveSceneGeometry,
	sceneBounds,
	snapCandidates,
	withGhostPrimitives,
	type ObjectGeometry,
	type ObjectHandle,
	type ScenePrimitive,
} from './sceneGeometry';
import {
	DEFAULT_VIEWPORT_CM,
	fitViewBox,
	formatViewBox,
	matchAspect,
	panViewBox,
	pinchViewBox,
	viewBoxFromCmBounds,
	zoomViewBox,
	type PinchState,
	type ViewBox,
} from './editorViewport';
import {
	buildCompiledUnderlay,
	renderGhostGroup,
	renderGridLayer,
	renderObjectGroup,
	renderSelectionOverlay,
	svgEl,
	cmToPt,
	underlayCalibrationTransform,
	type CompiledUnderlay,
	type RenderContext,
} from './sceneSvg';
import { GestureRouter, type PointerLike } from './pointerGestures';
import { iconEl, type EditorIconName } from './icons';
import { buildHighlightSegments, type HighlightRange } from './tikzHighlight';
import { axisConstrain, snapPoint, snapTranslation, type SnapContext } from './snapping';
import {
	appendFreehandPoint,
	createFreehandDraft,
	freehandPreviewSegments,
	generateFreehandStatement,
	FREEHAND_SMOOTHING_DEFAULT_PX,
	type FreehandDraft,
} from './freehand';
import {
	buildOptionsPrefix,
	coordinateTokenPatch,
	deleteObjectPatches,
	duplicateObjectPatches,
	formatPoint,
	numberTokenPatch,
	generateArc,
	generateCircle,
	generateCurvePath,
	generateEllipse,
	generateGridPath,
	generateLine,
	generateNode,
	generatePolyline,
	generateRectangle,
	diamondPoints,
	insertStatementPatches,
	lengthTokenPatch,
	penPositionsBefore,
	polygonPoints,
	starPoints,
	styleEditPatches,
	translateObjectPatches,
	translatedStatementText,
} from './tikzWriter';
import { catmullRomToBezier } from './freehand';
import { parseOptionStyle, type StyleEdit } from './tikzOptions';
import {
	hexToTikzColor,
	rgbToHex,
	tikzColorToRgb,
	TIKZ_COLOR_NAMES,
	XCOLOR_RGB,
} from './tikzColors';
import {
	applyLinear,
	applyToPoint,
	colXScale,
	colYScale,
	invertTransform,
	rotationDeg,
	uniformScale,
} from './pictureTransform';
import { recognizeStroke, type RecognizedShape } from './shapeRecognition';
import { compileFunction, sampleFunctionRuns } from './functionPlot';
import type {
	EditorToolId,
	ObjectStyle,
	PictureTransform,
	SceneNodeObject,
	SceneObject,
	ScenePathObject,
	SourcePatch,
	TikzScene,
} from './sceneTypes';

/**
 * The expanded Edit-mode surface of the floating preview: a complete visual
 * TikZ editor working against the active fence as its only source of truth.
 *
 * The InlinePreviewManager owns the lifecycle (enter/exit, sizing, compile
 * scheduling, writing patches into the Markdown editor); this class owns the
 * canvas, tools, panels, and all pointer/keyboard interaction. Interaction
 * never triggers a LaTeX compile — the canvas updates immediately from local
 * scene geometry, and the authoritative compiled preview refreshes through
 * the host's existing debounced pipeline after each committed change.
 */

export interface VisualEditorHost {
	/** Current fence body + location; null when the block disappeared. */
	getBlock(): TikzBlock | null;
	/**
	 * Apply patches (computed against `expectedBody`) to the fence as one
	 * undoable transaction. Returns false when the body changed underneath.
	 */
	applyPatches(expectedBody: string, patches: SourcePatch[]): boolean;
	/** Schedule the authoritative debounced recompile. */
	requestCompile(): void;
	/** Leave edit mode (Done). */
	requestExit(): void;
	undo(): void;
	redo(): void;
}

interface ToolButtonSpec {
	tool: EditorToolId;
	label: string;
	icon: EditorIconName;
	key?: string;
}

const TOOL_BUTTONS: ToolButtonSpec[] = [
	{ tool: 'select', label: 'Select', icon: 'select', key: 'V' },
	{ tool: 'pan', label: 'Pan', icon: 'pan', key: 'H' },
	{ tool: 'line', label: 'Line', icon: 'line', key: 'L' },
	{ tool: 'arrow', label: 'Arrow', icon: 'arrow', key: 'A' },
	{ tool: 'path', label: 'Path', icon: 'path', key: 'P' },
	{ tool: 'bezier', label: 'Bézier', icon: 'bezier', key: 'B' },
	{ tool: 'freehand', label: 'Freehand', icon: 'freehand', key: 'F' },
	{ tool: 'text', label: 'Text node', icon: 'text', key: 'T' },
	{ tool: 'math', label: 'Math node', icon: 'math' },
	{ tool: 'plot', label: 'Function plot', icon: 'plot' },
];

/** Shape tools grouped behind the single Shapes menu button. */
const SHAPE_TOOL_BUTTONS: ToolButtonSpec[] = [
	{ tool: 'rect', label: 'Rectangle', icon: 'rect', key: 'R' },
	{ tool: 'rounded-rect', label: 'Rounded rectangle', icon: 'rounded-rect' },
	{ tool: 'triangle', label: 'Triangle', icon: 'triangle' },
	{ tool: 'circle', label: 'Circle', icon: 'circle', key: 'C' },
	{ tool: 'ellipse', label: 'Ellipse', icon: 'ellipse', key: 'E' },
	{ tool: 'arc', label: 'Arc', icon: 'arc' },
	{ tool: 'diamond', label: 'Diamond', icon: 'diamond' },
	{ tool: 'polygon', label: 'Polygon', icon: 'polygon' },
	{ tool: 'star', label: 'Star', icon: 'star' },
	{ tool: 'grid-path', label: 'Grid path', icon: 'grid-path' },
];


const KEY_TO_TOOL: Record<string, EditorToolId> = {
	v: 'select', h: 'pan', l: 'line', a: 'arrow', p: 'path', b: 'bezier',
	f: 'freehand', r: 'rect', c: 'circle', e: 'ellipse', t: 'text',
};

type DragShapeTool =
	| 'line' | 'arrow' | 'rect' | 'rounded-rect' | 'triangle' | 'circle'
	| 'ellipse' | 'arc' | 'grid-path' | 'diamond' | 'polygon' | 'star';

type ActiveGesture =
	| { kind: 'shape'; tool: DragShapeTool; start: TikzCoordinate; current: TikzCoordinate; shift: boolean }
	| { kind: 'freehand'; draft: FreehandDraft; recognized: RecognizedShape | null }
	| { kind: 'pen-click' }
	| {
		kind: 'move';
		start: TikzCoordinate;
		delta: { dx: number; dy: number };
		objectIds: string[];
		moved: boolean;
		/** Every object under the pointer at drag start, best match first. */
		candidates: string[];
		/** The candidate that was (or became) selected on pointer-down. */
		hitId: string | null;
		/** True when the hit was already the sole selection — a repeated tap
		 * then cycles to the next candidate underneath. */
		wasSelected: boolean;
	}
	| {
		kind: 'handle';
		objectId: string;
		handle: ObjectHandle;
		current: TikzCoordinate;
		shift: boolean;
	}
	| {
		kind: 'rotate';
		pivot: TikzCoordinate;
		/** Pointer angle at drag start, radians. */
		startAngle: number;
		/** Accumulated rotation, degrees CCW. */
		angleDeg: number;
	}
	| {
		kind: 'marquee';
		start: TikzCoordinate;
		current: TikzCoordinate;
		additive: boolean;
		/**
		 * Object under the pointer at drag start (a locked ghost, or a shape
		 * whose hollow interior was grabbed); selected on a tap without drag.
		 */
		tapCandidate: string | null;
	}
	| null;

const CLICK_DRAG_THRESHOLD_CM = 0.06;
const GRID_STEPS = [0.1, 0.25, 0.5, 1, 2];

/** Hold the pointer still this long at the end of a freehand stroke to snap
 * the stroke into the recognized shape. */
export const FREEHAND_HOLD_MS = 600;

/** Hebrew runs (letters plus internal spaces), including presentation forms. */
const HEBREW_RUN_RE =
	/[֐-׿יִ-ﭏ](?:[֐-׿יִ-ﭏ\s]*[֐-׿יִ-ﭏ])?/g;

/**
 * Wrap every Hebrew run in `\he{…}` so RTL text renders without the user
 * knowing the macro. Text that already uses `\he{` is left alone — the user
 * has taken manual control.
 */
export function wrapHebrewRuns(text: string): string {
	if (text.includes('\\he{')) {
		return text;
	}
	return text.replace(HEBREW_RUN_RE, run => `\\he{${run}}`);
}

/**
 * A statement hidden by the Objects panel: every line commented out with a
 * `%~` marker, so it survives in the source (and in git) but neither compiles
 * nor renders. `text` is the statement with the markers stripped.
 */
export interface HiddenObjectEntry {
	from: number;
	to: number;
	text: string;
}

const HIDDEN_LINE_RE = /^(\s*)%~(.*)$/;

/** Find `%~`-marked statements; consecutive lines group until a `;`. */
export function scanHiddenObjects(source: string): HiddenObjectEntry[] {
	const entries: HiddenObjectEntry[] = [];
	let current: { from: number; to: number; parts: string[] } | null = null;
	const flush = () => {
		if (current) {
			entries.push({ from: current.from, to: current.to, text: current.parts.join('\n') });
			current = null;
		}
	};
	let offset = 0;
	for (const line of source.split('\n')) {
		const match = HIDDEN_LINE_RE.exec(line);
		if (match) {
			const content = match[1] + match[2];
			if (!current) {
				current = { from: offset, to: offset + line.length, parts: [content] };
			} else {
				current.to = offset + line.length;
				current.parts.push(content);
			}
			if (match[2].trimEnd().endsWith(';')) {
				flush();
			}
		} else {
			flush();
		}
		offset += line.length + 1;
	}
	flush();
	return entries;
}

/** Stroke/fill color picker: named swatches plus a free color input. */
interface ColorControl {
	/** Reflect a TikZ color expression (or null for default/none) in the UI. */
	set(value: string | null | undefined): void;
	setDisabled(disabled: boolean): void;
}

export class VisualTikzEditor {
	readonly root: HTMLElement;

	private readonly doc: Document;
	/** From the canvas's own window so jsdom accepts the listener signals. */
	private readonly ac: AbortController;

	private scene: TikzScene;
	private geometries: ObjectGeometry[] = [];
	private ghosts = new Map<string, ScenePrimitive[]>();
	private selection = new Set<string>();

	tool: EditorToolId = 'select';
	fingerDraw = false;
	gridOn = true;
	snapOn = true;
	gridStepCm = 0.5;
	private styleDefaults: ObjectStyle = {};
	private polygonSides = 5;
	private starSpikes = 5;
	private freehandSmoothingPx = FREEHAND_SMOOTHING_DEFAULT_PX;

	private viewBox: ViewBox;
	private pinch: PinchState | null = null;
	private pinchStartMidpoint = { x: 0, y: 0 };
	private pinchStartPxPerPt = 1;
	private panLast: { x: number; y: number } | null = null;

	private gesture: ActiveGesture = null;
	private freehandHoldTimer: number | null = null;
	private freehandHoldAnchor: TikzCoordinate | null = null;
	/** Multi-click path/bezier draft, persists across clicks. */
	private clickDraft: { tool: 'path' | 'bezier'; points: TikzCoordinate[]; hover: TikzCoordinate | null } | null = null;
	private pendingSync: TikzBlock | null = null;

	private readonly router: GestureRouter;

	// DOM
	private svg!: SVGSVGElement;
	private layerGrid!: SVGGElement;
	private layerCompiled!: SVGGElement;
	private layerGhost!: SVGGElement;
	private layerObjects!: SVGGElement;
	private layerDraft!: SVGGElement;
	private layerOverlay!: SVGGElement;
	private canvasWrap!: HTMLElement;
	private toolButtons = new Map<EditorToolId, HTMLButtonElement>();
	private shapesButton!: HTMLButtonElement;
	private shapesButtonIconName: EditorIconName = 'shapes';
	private shapeMenu!: HTMLElement;
	private shapeMenuItems = new Map<EditorToolId, HTMLButtonElement>();
	private propsPanel!: HTMLElement;
	private objectsPanel!: HTMLElement;
	private objectsList!: HTMLElement;
	private sourcePanel!: HTMLElement;
	private sourceTextarea!: HTMLTextAreaElement;
	private sourceHighlightCode!: HTMLElement;
	private sourceHighlightPre!: HTMLElement;
	private sourceDiagnostics!: HTMLElement;
	private lastHighlightKey = '';
	private hoveredObjectId: string | null = null;
	private statusEl!: HTMLElement;
	private finishButton!: HTMLButtonElement;
	private compiledCard!: HTMLElement;
	private compiledImg!: HTMLImageElement;
	private textInputOverlay: HTMLElement | null = null;

	private renderQueued = false;
	private dirtyScene = true;
	private dirtyView = true;
	private dirtyOverlay = true;
	private rafHandle: number | null = null;
	private sourceEditTimer: number | null = null;
	private resizeObserver: ResizeObserver | null = null;

	private clipboard: string[] = [];
	private destroyed = false;
	private underlayText: string | null = null;
	private underlayBoundsCm: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

	constructor(
		private readonly host: VisualEditorHost,
		container: HTMLElement,
		initialBody: string,
	) {
		this.doc = container.ownerDocument;
		const win = this.doc.defaultView;
		this.ac = new (win?.AbortController ?? AbortController)();
		this.scene = parseTikzScene(initialBody);
		this.viewBox = viewBoxFromCmBounds(DEFAULT_VIEWPORT_CM);
		this.root = this.buildDom(container);
		this.setTool('select');
		this.togglePanel('props', false);
		this.togglePanel('objects', false);
		this.togglePanel('source', false);
		this.router = new GestureRouter(this.buildGestureHost(), {
			fingerDraw: () => this.fingerDraw,
			panToolActive: () => this.tool === 'pan',
		});
		this.attachCanvasListeners();
		this.attachKeyboard();
		this.rebuildFromScene();
		this.fitView();
		this.observeResize();
		this.requestRender();
	}

	/* ---------------------------------------------------------------------- */
	/* DOM construction                                                        */
	/* ---------------------------------------------------------------------- */

	private el<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		cls?: string,
		parent?: HTMLElement,
	): HTMLElementTagNameMap[K] {
		// Obsidian's createEl helper when available (it always is inside the
		// app); plain DOM otherwise (jsdom in tests).
		const host = parent ?? this.doc.body;
		if (typeof host.createEl === 'function') {
			const node = host.createEl(tag, cls ? { cls } : undefined);
			if (!parent) {
				node.remove();
			}
			return node;
		}
		const node = this.doc.createElement(tag);
		if (cls) {
			node.className = cls;
		}
		if (parent) {
			parent.appendChild(node);
		}
		return node;
	}

	private button(
		parent: HTMLElement,
		label: string,
		cls: string,
		onClick: () => void,
		options: { toggle?: boolean; title?: string; icon?: EditorIconName } = {},
	): HTMLButtonElement {
		const btn = this.el('button', `luatikz-ve-btn ${cls}`, parent);
		btn.type = 'button';
		const icon = options.icon ? iconEl(this.doc, options.icon) : null;
		if (icon) {
			btn.appendChild(icon);
			btn.classList.add('luatikz-ve-btn-icon');
		} else {
			btn.textContent = label;
		}
		btn.setAttribute('aria-label', options.title ?? label);
		btn.title = options.title ?? label;
		if (options.toggle) {
			btn.setAttribute('aria-pressed', 'false');
		}
		btn.addEventListener('click', onClick, { signal: this.ac.signal });
		return btn;
	}

	private buildDom(container: HTMLElement): HTMLElement {
		const root = this.el('div', 'luatikz-visual-editor');
		root.setAttribute('role', 'region');
		root.setAttribute('aria-label', 'Visual TikZ editor');
		root.setAttribute('dir', 'ltr');
		root.tabIndex = 0;
		container.appendChild(root);

		// Toolbar -------------------------------------------------------------
		const toolbar = this.el('div', 'luatikz-ve-toolbar', root);
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', 'Drawing tools');
		const toolGroup = this.el('div', 'luatikz-ve-toolgroup', toolbar);
		for (const spec of TOOL_BUTTONS) {
			// The Shapes menu button sits between the drawing tools and the
			// text tools.
			if (spec.tool === 'text') {
				this.buildShapeMenu(toolbar, toolGroup);
			}
			const btn = this.button(
				toolGroup,
				spec.label,
				'luatikz-ve-tool-btn',
				() => this.setTool(spec.tool),
				{
					toggle: true,
					icon: spec.icon,
					title: spec.key ? `${spec.label} (${spec.key})` : spec.label,
				},
			);
			btn.dataset.tool = spec.tool;
			this.toolButtons.set(spec.tool, btn);
		}

		const actionGroup = this.el('div', 'luatikz-ve-actiongroup', toolbar);
		this.button(actionGroup, 'Undo', 'luatikz-ve-undo', () => this.host.undo(), { icon: 'undo', title: 'Undo (Ctrl/Cmd+Z)' });
		this.button(actionGroup, 'Redo', 'luatikz-ve-redo', () => this.host.redo(), { icon: 'redo', title: 'Redo (Ctrl/Cmd+Shift+Z)' });
		this.button(actionGroup, 'Duplicate', 'luatikz-ve-duplicate', () => this.duplicateSelection(), { icon: 'duplicate', title: 'Duplicate selection (Ctrl/Cmd+D)' });
		this.button(actionGroup, 'Delete', 'luatikz-ve-delete', () => this.deleteSelection(), { icon: 'delete', title: 'Delete selection (Del)' });
		this.button(actionGroup, 'Style', 'luatikz-ve-props-toggle', () => this.togglePanel('props'), { toggle: true, icon: 'style', title: 'Style panel' });
		this.button(actionGroup, 'Objects', 'luatikz-ve-objects-toggle', () => this.togglePanel('objects'), { toggle: true, icon: 'objects', title: 'Objects panel' });
		this.button(actionGroup, 'Source', 'luatikz-ve-source-toggle', () => this.togglePanel('source'), { toggle: true, icon: 'source', title: 'TikZ source panel' });
		this.button(actionGroup, 'Done', 'luatikz-ve-done mod-cta', () => this.host.requestExit(), { title: 'Return to preview (Done)' });

		// Main area ------------------------------------------------------------
		const main = this.el('div', 'luatikz-ve-main', root);

		this.propsPanel = this.el('div', 'luatikz-ve-props', main);
		this.propsPanel.setAttribute('aria-label', 'Style and properties');
		this.buildPropsPanel();

		this.canvasWrap = this.el('div', 'luatikz-ve-canvas-wrap', main);
		this.svg = svgEl(this.doc, 'svg', {
			class: 'luatikz-ve-canvas',
			preserveAspectRatio: 'xMidYMid slice',
		});
		this.svg.setAttribute('viewBox', formatViewBox(this.viewBox));
		this.canvasWrap.appendChild(this.svg);
		this.layerGrid = svgEl(this.doc, 'g', { class: 'luatikz-ve-layer-grid' });
		this.layerCompiled = svgEl(this.doc, 'g', { class: 'luatikz-ve-layer-compiled' });
		this.layerGhost = svgEl(this.doc, 'g', { class: 'luatikz-ve-layer-ghost' });
		this.layerObjects = svgEl(this.doc, 'g', { class: 'luatikz-ve-layer-objects' });
		this.layerDraft = svgEl(this.doc, 'g', { class: 'luatikz-ve-layer-draft' });
		this.layerOverlay = svgEl(this.doc, 'g', { class: 'luatikz-ve-layer-overlay' });
		this.svg.append(
			this.layerGrid, this.layerCompiled, this.layerGhost,
			this.layerObjects, this.layerDraft, this.layerOverlay,
		);

		this.compiledCard = this.el('div', 'luatikz-ve-compiled', this.canvasWrap);
		this.compiledCard.setAttribute('aria-label', 'Compiled preview');
		this.compiledImg = this.el('img', 'luatikz-ve-compiled-img', this.compiledCard);
		this.compiledImg.alt = 'Compiled TikZ output';

		this.objectsPanel = this.el('div', 'luatikz-ve-objects', main);
		this.objectsPanel.setAttribute('aria-label', 'Objects in the diagram');
		this.el('div', 'luatikz-ve-objects-title', this.objectsPanel).textContent = 'Objects';
		this.objectsList = this.el('div', 'luatikz-ve-objects-list', this.objectsPanel);

		this.sourcePanel = this.el('div', 'luatikz-ve-source', main);
		this.sourcePanel.setAttribute('aria-label', 'TikZ source');
		// Textarea for input; a mirrored <pre> behind it carries the colors
		// and the hover/selection tints.
		const sourceEditor = this.el('div', 'luatikz-ve-source-editor', this.sourcePanel);
		this.sourceHighlightPre = this.el('pre', 'luatikz-ve-source-highlight', sourceEditor);
		this.sourceHighlightPre.setAttribute('aria-hidden', 'true');
		this.sourceHighlightCode = this.el('code', undefined, this.sourceHighlightPre);
		this.sourceTextarea = this.el('textarea', 'luatikz-ve-source-text', sourceEditor);
		this.sourceTextarea.spellcheck = false;
		this.sourceTextarea.setAttribute('wrap', 'off');
		this.sourceTextarea.setAttribute('aria-label', 'TikZ source of the active fence');
		this.sourceDiagnostics = this.el('div', 'luatikz-ve-source-diagnostics', this.sourcePanel);
		this.sourceTextarea.addEventListener('input', () => {
			this.renderSourceHighlight();
			this.onSourcePanelInput();
		}, { signal: this.ac.signal });
		this.sourceTextarea.addEventListener('scroll', () => {
			this.sourceHighlightPre.scrollTop = this.sourceTextarea.scrollTop;
			this.sourceHighlightPre.scrollLeft = this.sourceTextarea.scrollLeft;
		}, { signal: this.ac.signal });

		// Status bar -----------------------------------------------------------
		const statusbar = this.el('div', 'luatikz-ve-statusbar', root);
		const gridBtn = this.button(statusbar, 'Grid', 'luatikz-ve-grid-toggle', () => {
			this.gridOn = !this.gridOn;
			gridBtn.setAttribute('aria-pressed', String(this.gridOn));
			gridBtn.classList.toggle('is-active', this.gridOn);
			this.dirtyView = true;
			this.requestRender();
		}, { toggle: true, icon: 'grid', title: 'Toggle grid' });
		gridBtn.setAttribute('aria-pressed', 'true');
		gridBtn.classList.add('is-active');

		const snapBtn = this.button(statusbar, 'Snap', 'luatikz-ve-snap-toggle', () => {
			this.snapOn = !this.snapOn;
			snapBtn.setAttribute('aria-pressed', String(this.snapOn));
			snapBtn.classList.toggle('is-active', this.snapOn);
		}, { toggle: true, icon: 'snap', title: 'Toggle snapping' });
		snapBtn.setAttribute('aria-pressed', 'true');
		snapBtn.classList.add('is-active');

		const stepSelect = this.el('select', 'luatikz-ve-grid-step', statusbar);
		stepSelect.setAttribute('aria-label', 'Grid interval in centimeters');
		for (const step of GRID_STEPS) {
			const option = this.el('option', undefined, stepSelect);
			option.value = String(step);
			option.textContent = `${step} cm`;
			if (step === this.gridStepCm) {
				option.selected = true;
			}
		}
		stepSelect.addEventListener('change', () => {
			const value = Number.parseFloat(stepSelect.value);
			if (Number.isFinite(value) && value > 0) {
				this.gridStepCm = value;
				this.dirtyView = true;
				this.requestRender();
			}
		}, { signal: this.ac.signal });

		const fingerBtn = this.button(statusbar, 'Finger draw', 'luatikz-ve-finger-toggle', () => {
			this.fingerDraw = !this.fingerDraw;
			fingerBtn.setAttribute('aria-pressed', String(this.fingerDraw));
			fingerBtn.classList.toggle('is-active', this.fingerDraw);
			this.announce(this.fingerDraw
				? 'Finger draw on: one finger draws, two fingers pan and zoom.'
				: 'Finger draw off: one finger pans, two fingers pinch zoom.');
		}, { toggle: true, icon: 'finger', title: 'One-finger touch drawing' });

		this.button(statusbar, 'Zoom out', 'luatikz-ve-zoom-out', () => this.zoomBy(1 / 1.25), { icon: 'zoom-out', title: 'Zoom out' });
		this.button(statusbar, 'Zoom in', 'luatikz-ve-zoom-in', () => this.zoomBy(1.25), { icon: 'zoom-in', title: 'Zoom in' });
		this.button(statusbar, 'Fit', 'luatikz-ve-fit', () => {
			this.fitView();
			this.requestRender();
		}, { icon: 'fit', title: 'Fit diagram' });

		this.finishButton = this.button(statusbar, '✓ Finish path', 'luatikz-ve-finish', () => this.commitClickDraft(false), { title: 'Finish the current path (Enter)' });
		this.finishButton.classList.add('luatikz-ve-hidden');

		this.statusEl = this.el('div', 'luatikz-ve-status', statusbar);
		this.statusEl.setAttribute('role', 'status');
		this.statusEl.setAttribute('aria-live', 'polite');

		return root;
	}

	/** One toolbar button for every shape tool, expanding into a menu. */
	private buildShapeMenu(toolbar: HTMLElement, toolGroup: HTMLElement): void {
		this.shapesButton = this.button(
			toolGroup,
			'Shapes',
			'luatikz-ve-tool-btn luatikz-ve-shapes-btn',
			() => this.toggleShapeMenu(),
			{ toggle: true, icon: 'shapes', title: 'Shapes' },
		);
		this.shapesButton.setAttribute('aria-haspopup', 'menu');
		this.shapesButton.setAttribute('aria-expanded', 'false');

		this.shapeMenu = this.el('div', 'luatikz-ve-shape-menu luatikz-ve-hidden', toolbar);
		this.shapeMenu.setAttribute('role', 'menu');
		this.shapeMenu.setAttribute('aria-label', 'Shape tools');
		for (const spec of SHAPE_TOOL_BUTTONS) {
			const item = this.el('button', 'luatikz-ve-shape-item', this.shapeMenu);
			item.type = 'button';
			item.setAttribute('role', 'menuitemradio');
			item.setAttribute('aria-checked', 'false');
			const icon = iconEl(this.doc, spec.icon);
			if (icon) {
				item.appendChild(icon);
			}
			this.el('span', 'luatikz-ve-shape-item-label', item).textContent = spec.label;
			item.title = spec.key ? `${spec.label} (${spec.key})` : spec.label;
			item.dataset.tool = spec.tool;
			item.addEventListener('click', () => this.setTool(spec.tool), { signal: this.ac.signal });
			this.shapeMenuItems.set(spec.tool, item);
		}

		// Any pointer press outside the menu and its button dismisses it.
		this.doc.addEventListener('pointerdown', event => {
			if (this.shapeMenuOpen
				&& event.target instanceof this.doc.defaultView!.Node
				&& !this.shapeMenu.contains(event.target)
				&& !this.shapesButton.contains(event.target)) {
				this.toggleShapeMenu(false);
			}
		}, { signal: this.ac.signal, capture: true });
	}

	get shapeMenuOpen(): boolean {
		return !this.shapeMenu.classList.contains('luatikz-ve-hidden');
	}

	toggleShapeMenu(force?: boolean): void {
		const open = force ?? !this.shapeMenuOpen;
		this.shapeMenu.classList.toggle('luatikz-ve-hidden', !open);
		this.shapesButton.setAttribute('aria-expanded', String(open));
		if (open) {
			this.shapeMenu.style.left = `${this.shapesButton.offsetLeft}px`;
		}
	}

	private propsControls: {
		stroke?: ColorControl;
		fill?: ColorControl;
		width?: HTMLSelectElement;
		dash?: HTMLSelectElement;
		arrows?: HTMLSelectElement;
		opacity?: HTMLInputElement;
		rounded?: HTMLInputElement;
		nodeText?: HTMLInputElement;
		sides?: HTMLInputElement;
		smoothing?: HTMLInputElement;
	} = {};

	private propsScopeEl: HTMLElement | null = null;

	private propsSelect(
		parent: HTMLElement,
		label: string,
		values: Array<[string, string]>,
		onChange: (value: string) => void,
	): HTMLSelectElement {
		const row = this.el('label', 'luatikz-ve-props-row', parent);
		this.el('span', 'luatikz-ve-props-label', row).textContent = label;
		const select = this.el('select', 'luatikz-ve-props-select', row);
		for (const [value, text] of values) {
			const option = this.el('option', undefined, select);
			option.value = value;
			option.textContent = text;
		}
		select.addEventListener('change', () => onChange(select.value), { signal: this.ac.signal });
		return select;
	}

	/**
	 * A color row: a clear swatch (default/none), every base TikZ color as a
	 * clickable swatch, and a free `<input type=color>` that writes an inline
	 * xcolor RGB expression for colors outside the named set.
	 */
	private propsColorRow(
		parent: HTMLElement,
		label: string,
		clearLabel: string,
		onChange: (value: string | null) => void,
	): ColorControl {
		const row = this.el('div', 'luatikz-ve-props-row luatikz-ve-props-colorrow', parent);
		this.el('span', 'luatikz-ve-props-label', row).textContent = label;
		const grid = this.el('div', 'luatikz-ve-swatches', row);
		const swatches = new Map<string, HTMLButtonElement>();

		const clearBtn = this.el('button', 'luatikz-ve-swatch luatikz-ve-swatch-clear', grid);
		clearBtn.type = 'button';
		clearBtn.title = clearLabel;
		clearBtn.setAttribute('aria-label', `${label}: ${clearLabel}`);

		const custom = this.el('input', 'luatikz-ve-swatch-custom', grid);
		custom.type = 'color';
		custom.title = 'Custom color';
		custom.setAttribute('aria-label', `${label}: custom color`);

		const setActive = (active: string | null) => {
			clearBtn.classList.toggle('is-active', active === null);
			for (const [name, btn] of swatches) {
				btn.classList.toggle('is-active', active === name);
			}
			custom.classList.toggle('is-active', active === '__custom__');
		};

		clearBtn.addEventListener('click', () => {
			setActive(null);
			onChange(null);
		}, { signal: this.ac.signal });

		for (const name of TIKZ_COLOR_NAMES) {
			const btn = this.el('button', 'luatikz-ve-swatch', grid);
			btn.type = 'button';
			btn.title = name;
			btn.dataset.color = name;
			btn.setAttribute('aria-label', `${label}: ${name}`);
			const rgb = XCOLOR_RGB[name];
			btn.style.setProperty('--luatikz-swatch', rgbToHex(rgb));
			btn.addEventListener('click', () => {
				setActive(name);
				onChange(name);
			}, { signal: this.ac.signal });
			swatches.set(name, btn);
			grid.appendChild(btn);
		}
		// Keep the custom input as the last cell of the grid.
		grid.appendChild(custom);
		custom.addEventListener('change', () => {
			const color = hexToTikzColor(custom.value);
			if (color) {
				setActive(swatches.has(color) ? color : '__custom__');
				onChange(color);
			}
		}, { signal: this.ac.signal });

		return {
			set: value => {
				if (!value) {
					setActive(null);
					return;
				}
				if (swatches.has(value)) {
					setActive(value);
					return;
				}
				const rgb = tikzColorToRgb(value);
				if (rgb) {
					custom.value = rgbToHex(rgb);
					setActive('__custom__');
				} else {
					setActive(null);
				}
			},
			setDisabled: disabled => {
				clearBtn.disabled = disabled;
				custom.disabled = disabled;
				for (const btn of swatches.values()) {
					btn.disabled = disabled;
				}
			},
		};
	}

	private buildPropsPanel(): void {
		const panel = this.propsPanel;
		this.el('div', 'luatikz-ve-props-title', panel).textContent = 'Style';
		this.propsScopeEl = this.el('div', 'luatikz-ve-props-scope', panel);

		this.propsControls.stroke = this.propsColorRow(panel, 'Stroke', 'Default',
			value => this.applyStyle({ strokeColor: value }));
		this.propsControls.fill = this.propsColorRow(panel, 'Fill', 'None',
			value => this.applyStyle({ fillColor: value }));
		this.propsControls.width = this.propsSelect(panel, 'Width', [
			['default', 'Default'], ['thin', 'Thin'], ['thick', 'Thick'], ['very thick', 'Very thick'],
		], value => this.applyStyle({ lineWidth: value as ObjectStyle['lineWidth'] }));
		this.propsControls.dash = this.propsSelect(panel, 'Dash', [
			['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'],
		], value => this.applyStyle({ dash: value as StyleEdit['dash'] }));
		this.propsControls.arrows = this.propsSelect(panel, 'Arrows', [
			['', 'None'], ['->', 'End →'], ['<-', 'Start ←'], ['<->', 'Both ↔'],
		], value => this.applyStyle({ arrows: value as StyleEdit['arrows'] }));

		const opacityRow = this.el('label', 'luatikz-ve-props-row', panel);
		this.el('span', 'luatikz-ve-props-label', opacityRow).textContent = 'Opacity';
		const opacity = this.el('input', 'luatikz-ve-props-opacity', opacityRow);
		opacity.type = 'range';
		opacity.min = '0.1';
		opacity.max = '1';
		opacity.step = '0.1';
		opacity.value = '1';
		opacity.addEventListener('change', () => {
			this.applyStyle({ opacity: Number.parseFloat(opacity.value) });
		}, { signal: this.ac.signal });
		this.propsControls.opacity = opacity;

		const roundedRow = this.el('label', 'luatikz-ve-props-row', panel);
		const rounded = this.el('input', undefined, roundedRow);
		rounded.type = 'checkbox';
		this.el('span', 'luatikz-ve-props-label', roundedRow).textContent = 'Rounded corners';
		rounded.addEventListener('change', () => {
			this.applyStyle({ roundedCorners: rounded.checked });
		}, { signal: this.ac.signal });
		this.propsControls.rounded = rounded;

		const textRow = this.el('label', 'luatikz-ve-props-row luatikz-ve-props-node-text', panel);
		this.el('span', 'luatikz-ve-props-label', textRow).textContent = 'Node text';
		const nodeText = this.el('input', 'luatikz-ve-props-text', textRow);
		nodeText.type = 'text';
		nodeText.addEventListener('change', () => this.applyNodeText(nodeText.value), { signal: this.ac.signal });
		this.propsControls.nodeText = nodeText;

		const sidesRow = this.el('label', 'luatikz-ve-props-row', panel);
		this.el('span', 'luatikz-ve-props-label', sidesRow).textContent = 'Polygon sides / star points';
		const sides = this.el('input', 'luatikz-ve-props-sides', sidesRow);
		sides.type = 'number';
		sides.min = '3';
		sides.max = '12';
		sides.value = String(this.polygonSides);
		sides.addEventListener('change', () => {
			const value = Number.parseInt(sides.value, 10);
			if (Number.isFinite(value) && value >= 3 && value <= 12) {
				this.polygonSides = value;
				this.starSpikes = value;
			}
		}, { signal: this.ac.signal });
		this.propsControls.sides = sides;

		const smoothingRow = this.el('label', 'luatikz-ve-props-row', panel);
		this.el('span', 'luatikz-ve-props-label', smoothingRow).textContent = 'Freehand smoothing';
		const smoothing = this.el('input', 'luatikz-ve-props-smoothing', smoothingRow);
		smoothing.type = 'range';
		smoothing.min = '2';
		smoothing.max = '32';
		smoothing.step = '1';
		smoothing.value = String(this.freehandSmoothingPx);
		smoothing.addEventListener('change', () => {
			const value = Number.parseFloat(smoothing.value);
			if (Number.isFinite(value)) {
				this.freehandSmoothingPx = value;
			}
		}, { signal: this.ac.signal });
		this.propsControls.smoothing = smoothing;
	}

	/* ---------------------------------------------------------------------- */
	/* lifecycle                                                               */
	/* ---------------------------------------------------------------------- */

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.router.cancelActive();
		this.clearFreehandHold();
		this.closeTextInput(false);
		if (this.rafHandle !== null) {
			const win = this.doc.defaultView;
			win?.cancelAnimationFrame(this.rafHandle);
			this.rafHandle = null;
		}
		if (this.sourceEditTimer !== null) {
			const win = this.doc.defaultView;
			win?.clearTimeout(this.sourceEditTimer);
			this.sourceEditTimer = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.ac.abort();
		this.root.remove();
	}

	private observeResize(): void {
		const win = this.doc.defaultView;
		if (!win || typeof win.ResizeObserver !== 'function') {
			return;
		}
		this.resizeObserver = new win.ResizeObserver(() => {
			const rect = this.canvasWrap.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				this.viewBox = matchAspect(this.viewBox, rect.width / rect.height);
				this.dirtyView = true;
				this.requestRender();
			}
		});
		this.resizeObserver.observe(this.canvasWrap);
	}

	/** Re-read the fence body (after external edits, undo, or our own write). */
	syncFromBlock(block: TikzBlock): void {
		if (this.gesture || this.router.mode !== 'idle') {
			this.pendingSync = block;
			return;
		}
		if (block.source === this.scene.source) {
			return;
		}
		this.scene = parseTikzScene(block.source);
		this.rebuildFromScene();
		this.requestRender();
	}

	private flushPendingSync(): void {
		if (!this.pendingSync) {
			return;
		}
		const block = this.pendingSync;
		this.pendingSync = null;
		this.syncFromBlock(block);
	}

	private rebuildFromScene(): void {
		this.geometries = resolveSceneGeometry(this.scene);
		this.ghosts = resolveLockedGhosts(this.scene);
		// Fold ghost primitives into locked geometries so hit testing, fit,
		// and marquee bounds see them.
		this.geometries = this.geometries.map(geometry => {
			if (geometry.object.type !== 'locked') {
				return geometry;
			}
			const ghost = this.ghosts.get(geometry.object.id);
			return ghost ? withGhostPrimitives(geometry, ghost) : geometry;
		});
		const alive = new Set(this.scene.objects.map(object => object.id));
		for (const id of [...this.selection]) {
			if (!alive.has(id)) {
				this.selection.delete(id);
			}
		}
		this.dirtyScene = true;
		this.dirtyOverlay = true;
		this.hoveredObjectId = null;
		if (this.doc.activeElement !== this.sourceTextarea) {
			this.sourceTextarea.value = this.scene.source;
		}
		this.renderSourceHighlight();
		this.renderDiagnostics();
		this.updatePropsFromSelection();
		this.refreshObjectsPanel();
	}

	/** Compiled result from the authoritative pipeline (or an error). */
	setCompileResult(result: RenderImageResult | null, rendering: boolean): void {
		this.compiledCard.classList.toggle('is-rendering', rendering);
		if (result?.ok && result.dataUrl) {
			this.compiledImg.src = result.dataUrl;
			this.compiledCard.classList.remove('has-error');
			this.compiledCard.classList.add('has-output');
			if (result.svgText) {
				this.updateUnderlay(result.svgText);
			}
		} else if (result && !result.ok) {
			this.compiledCard.classList.add('has-error');
			const message = result.error ?? 'Render failed';
			this.announce(`Compile error: ${message}`);
			this.renderDiagnostics(message, result.userLine);
		}
	}

	/**
	 * Refresh the compiled background layer. The user draws on top of the
	 * real diagram; the wireframe object layer dims to an affordance and the
	 * approximate ghosts disappear entirely while an underlay is present.
	 */
	private updateUnderlay(svgText: string): void {
		if (svgText === this.underlayText) {
			return;
		}
		const firstUnderlay = this.underlayText === null;
		const built = buildCompiledUnderlay(this.doc, svgText);
		this.layerCompiled.textContent = '';
		if (!built || !built.bbox) {
			// Output without the calibration bbox (TikZJax on mobile) cannot
			// be aligned to the canvas coordinate system — a 1:1 embed lands
			// at arbitrary DVI coordinates and reads as a duplicate of every
			// object beside the wireframe. Skip the underlay entirely; the
			// compiled card still shows the real render.
			this.underlayText = built ? svgText : null;
			this.underlayBoundsCm = null;
			this.svg.classList.remove('has-underlay');
			return;
		}
		this.layerCompiled.appendChild(built.wrapper);
		this.underlayText = svgText;
		this.underlayBoundsCm = built.bbox
			? {
				minX: built.bbox.minX / PT_PER_CM,
				minY: built.bbox.minY / PT_PER_CM,
				maxX: built.bbox.maxX / PT_PER_CM,
				maxY: built.bbox.maxY / PT_PER_CM,
			}
			: null;
		this.svg.classList.add('has-underlay');
		this.alignUnderlay(built);
		// The first compiled output can reveal the diagram's true extent;
		// refit unless the user is mid-gesture.
		if (firstUnderlay && !this.gesture && this.router.mode === 'idle' && !this.clickDraft) {
			this.fitView();
		}
		this.requestRender();
	}

	/**
	 * Exact placement for LuaLaTeX output: measure the calibration markers'
	 * on-screen centers, convert them into canvas user space through the same
	 * CTM path the coordinate picker uses, and solve the uniform transform
	 * that puts them on the bbox corners they mark. Alignment is measured
	 * once per compile and is zoom-invariant (the underlay lives inside the
	 * canvas user space). SVGs without markers (TikZJax) keep the 1:1 embed,
	 * matching the assumption the mobile pick fallback already makes.
	 */
	private alignUnderlay(underlay: CompiledUnderlay): void {
		if (!underlay.bbox) {
			return;
		}
		try {
			underlay.wrapper.removeAttribute('transform');
			let minCenter: { x: number; y: number } | null = null;
			let maxCenter: { x: number; y: number } | null = null;
			for (const path of Array.from(underlay.nested.querySelectorAll('path[fill]'))) {
				const fill = path.getAttribute('fill') ?? '';
				const isMin = !minCenter && fillMatchesMarker(fill, CAL_MARKER_MIN_RGB);
				const isMax = !maxCenter && fillMatchesMarker(fill, CAL_MARKER_MAX_RGB);
				if (!isMin && !isMax) {
					continue;
				}
				const rect = path.getBoundingClientRect();
				const cm = this.clientToCm(rect.left + rect.width / 2, rect.top + rect.height / 2);
				if (!cm) {
					continue;
				}
				const center = { x: cm.x * PT_PER_CM, y: -cm.y * PT_PER_CM };
				if (isMin) {
					minCenter = center;
				} else {
					maxCenter = center;
				}
				if (minCenter && maxCenter) {
					break;
				}
			}
			if (!minCenter || !maxCenter) {
				return;
			}
			const transform = underlayCalibrationTransform(underlay.bbox, minCenter, maxCenter);
			if (transform) {
				underlay.wrapper.setAttribute(
					'transform',
					`translate(${transform.tx} ${transform.ty}) scale(${transform.s})`,
				);
			}
		} catch {
			// No layout engine (jsdom) or detached canvas: keep the 1:1 embed.
		}
	}

	/* ---------------------------------------------------------------------- */
	/* view                                                                    */
	/* ---------------------------------------------------------------------- */

	private aspect(): number {
		const rect = this.canvasWrap.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1.5;
	}

	private pxPerPt(): number {
		const rect = this.svg.getBoundingClientRect();
		return rect.width > 0 ? rect.width / this.viewBox.w : 1;
	}

	fitView(): void {
		const scene = sceneBounds(this.geometries);
		const compiled = this.underlayBoundsCm;
		let bounds = scene ?? compiled;
		if (scene && compiled) {
			bounds = {
				minX: Math.min(scene.minX, compiled.minX),
				minY: Math.min(scene.minY, compiled.minY),
				maxX: Math.max(scene.maxX, compiled.maxX),
				maxY: Math.max(scene.maxY, compiled.maxY),
			};
		}
		this.viewBox = fitViewBox(bounds, this.aspect());
		this.dirtyView = true;
	}

	private zoomBy(factor: number): void {
		const focus = {
			x: this.viewBox.x + this.viewBox.w / 2,
			y: this.viewBox.y + this.viewBox.h / 2,
		};
		this.viewBox = zoomViewBox(this.viewBox, factor, focus);
		this.dirtyView = true;
		this.requestRender();
	}

	private clientToCm(clientX: number, clientY: number): TikzCoordinate | null {
		return clientPointToTikzCoordinate(this.svg, clientX, clientY);
	}

	private pxToCm(px: number): number {
		return px / Math.max(this.pxPerPt() * PT_PER_CM, 1e-6);
	}

	/* ---------------------------------------------------------------------- */
	/* rendering                                                               */
	/* ---------------------------------------------------------------------- */

	private requestRender(): void {
		if (this.renderQueued || this.destroyed) {
			return;
		}
		this.renderQueued = true;
		const win = this.doc.defaultView;
		if (!win || typeof win.requestAnimationFrame !== 'function') {
			this.renderQueued = false;
			this.renderNow();
			return;
		}
		this.rafHandle = win.requestAnimationFrame(() => {
			this.rafHandle = null;
			this.renderQueued = false;
			this.renderNow();
		});
	}

	private renderContext(): RenderContext {
		return { doc: this.doc, pxPerPt: this.pxPerPt() };
	}

	renderNow(): void {
		if (this.destroyed) {
			return;
		}
		const context = this.renderContext();
		if (this.dirtyView) {
			this.svg.setAttribute('viewBox', formatViewBox(this.viewBox));
			if (this.gridOn) {
				renderGridLayer(context, this.layerGrid, this.viewBox, this.gridStepCm);
			} else {
				this.layerGrid.textContent = '';
			}
			// Handle/hairline sizes depend on zoom.
			this.dirtyScene = true;
			this.dirtyOverlay = true;
			this.dirtyView = false;
		}
		if (this.dirtyScene) {
			this.layerObjects.textContent = '';
			this.layerGhost.textContent = '';
			for (const geometry of this.geometries) {
				if (geometry.object.type === 'locked') {
					const primitives = this.ghosts.get(geometry.object.id);
					if (primitives) {
						this.layerGhost.appendChild(
							renderGhostGroup(context, geometry.object.id, primitives),
						);
					}
					continue;
				}
				this.layerObjects.appendChild(renderObjectGroup(context, geometry));
			}
			this.dirtyScene = false;
		}
		if (this.dirtyOverlay) {
			this.renderOverlay(context);
			this.dirtyOverlay = false;
		}
	}

	private selectedGeometries(): ObjectGeometry[] {
		return this.geometries.filter(geometry => this.selection.has(geometry.object.id));
	}

	private renderOverlay(context: RenderContext): void {
		const selected = this.selectedGeometries();
		const handles = this.tool === 'select'
			? selected.flatMap(geometry => geometry.handles)
			: [];
		renderSelectionOverlay(
			context, this.layerOverlay, selected, handles,
			this.rotateHandleInfo()?.grip ?? null,
		);
		this.renderDraft(context);
	}

	/**
	 * Rotation grip above the selection: position plus the pivot (selection
	 * center). Null when the Select tool is inactive or nothing rotatable is
	 * selected.
	 */
	private rotateHandleInfo(): { grip: TikzCoordinate; pivot: TikzCoordinate } | null {
		if (this.tool !== 'select') {
			return null;
		}
		const selected = this.selectedGeometries()
			.filter(geometry => geometry.object.type !== 'locked' && geometry.bounds);
		if (!selected.length) {
			return null;
		}
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const geometry of selected) {
			const bounds = geometry.bounds!;
			minX = Math.min(minX, bounds.minX);
			minY = Math.min(minY, bounds.minY);
			maxX = Math.max(maxX, bounds.maxX);
			maxY = Math.max(maxY, bounds.maxY);
		}
		const pivot = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
		return {
			pivot,
			grip: { x: pivot.x, y: maxY + this.pxToCm(26) },
		};
	}

	private draftPrimitives(): ScenePrimitive[] {
		const gesture = this.gesture;
		const primitives: ScenePrimitive[] = [];
		if (this.clickDraft) {
			const { points, hover } = this.clickDraft;
			const all = hover ? [...points, hover] : points;
			if (this.clickDraft.tool === 'path') {
				for (let index = 1; index < all.length; index++) {
					primitives.push({ kind: 'segment', a: all[index - 1], b: all[index] });
				}
			} else if (all.length >= 2) {
				let previous = all[0];
				for (const segment of catmullRomToBezier(all)) {
					primitives.push({ kind: 'bezier', a: previous, c1: segment.c1, c2: segment.c2, b: segment.to });
					previous = segment.to;
				}
			}
			for (const point of points) {
				primitives.push({ kind: 'circle', center: point, rx: 0.05, ry: 0.05 });
			}
			return primitives;
		}
		if (!gesture) {
			return primitives;
		}
		if (gesture.kind === 'freehand') {
			if (gesture.recognized) {
				return this.recognizedPrimitives(gesture.recognized);
			}
			for (const segment of freehandPreviewSegments(
				gesture.draft, this.freehandSmoothingPx, this.pxToCm(1),
			)) {
				if (segment.kind === 'line') {
					primitives.push({ kind: 'segment', a: segment.from, b: segment.to });
				} else {
					primitives.push({ kind: 'bezier', a: segment.from, c1: segment.c1, c2: segment.c2, b: segment.to });
				}
			}
			return primitives;
		}
		if (gesture.kind === 'marquee') {
			primitives.push({ kind: 'rect', a: gesture.start, b: gesture.current });
			return primitives;
		}
		if (gesture.kind === 'shape') {
			const { tool, start } = gesture;
			const current = gesture.shift && (tool === 'line' || tool === 'arrow')
				? axisConstrain(gesture.current, start)
				: gesture.current;
			switch (tool) {
				case 'line':
				case 'arrow':
					primitives.push({ kind: 'segment', a: start, b: current });
					break;
				case 'rect':
				case 'rounded-rect':
				case 'grid-path':
					primitives.push({ kind: 'rect', a: start, b: current });
					break;
				case 'circle': {
					const radius = Math.hypot(current.x - start.x, current.y - start.y);
					primitives.push({ kind: 'circle', center: start, rx: radius, ry: radius });
					break;
				}
				case 'ellipse':
				case 'diamond': {
					const rx = Math.abs(current.x - start.x);
					const ry = Math.abs(current.y - start.y);
					if (tool === 'ellipse') {
						primitives.push({ kind: 'circle', center: start, rx, ry });
					} else {
						const points = diamondPoints(start, rx || 0.01, ry || 0.01);
						for (let index = 0; index < points.length; index++) {
							primitives.push({
								kind: 'segment',
								a: points[index],
								b: points[(index + 1) % points.length],
							});
						}
					}
					break;
				}
				case 'triangle':
				case 'polygon':
				case 'star': {
					const radius = Math.hypot(current.x - start.x, current.y - start.y);
					if (radius > 1e-3) {
						const points = tool === 'triangle'
							? polygonPoints(start, radius, 3)
							: tool === 'polygon'
								? polygonPoints(start, radius, this.polygonSides)
								: starPoints(start, radius, 0.5, this.starSpikes);
						for (let index = 0; index < points.length; index++) {
							primitives.push({
								kind: 'segment',
								a: points[index],
								b: points[(index + 1) % points.length],
							});
						}
					}
					break;
				}
				case 'arc': {
					const arc = this.arcFromChord(start, current);
					if (arc) {
						primitives.push({
							kind: 'arc',
							center: arc.center,
							radius: arc.radius,
							startDeg: arc.startAngle,
							endDeg: arc.endAngle,
						});
					}
					break;
				}
			}
		}
		return primitives;
	}

	private renderDraft(context: RenderContext): void {
		this.layerDraft.textContent = '';
		const primitives = this.draftPrimitives();
		if (!primitives.length) {
			return;
		}
		const group = svgEl(this.doc, 'g', { class: 'luatikz-ve-draft' });
		const strokePt = Math.max(0.4, 1 / Math.max(context.pxPerPt, 1e-6));
		group.setAttribute('stroke-width', String(strokePt));
		group.setAttribute('fill', 'none');
		for (const primitive of primitives) {
			const el = this.primitiveForDraft(context, primitive);
			if (el) {
				group.appendChild(el);
			}
		}
		this.layerDraft.appendChild(group);
	}

	private primitiveForDraft(context: RenderContext, primitive: ScenePrimitive): SVGElement | null {
		const geometry: ObjectGeometry = {
			object: { id: '__draft__', pictureIndex: 0, span: { from: 0, to: 0 }, type: 'locked', reason: '', command: null },
			primitives: [primitive],
			handles: [],
			filled: false,
			bounds: null,
		};
		const group = renderGhostGroup(context, '__draft__', geometry.primitives);
		group.classList.remove('luatikz-ve-ghost');
		group.classList.add('luatikz-ve-draft-shape');
		return group;
	}

	/* ---------------------------------------------------------------------- */
	/* tools and selection                                                     */
	/* ---------------------------------------------------------------------- */

	setTool(tool: EditorToolId): void {
		if (this.clickDraft && tool !== this.clickDraft.tool) {
			this.cancelClickDraft();
		}
		this.tool = tool;
		for (const [id, btn] of this.toolButtons) {
			const active = id === tool;
			btn.classList.toggle('is-active', active);
			btn.setAttribute('aria-pressed', String(active));
		}
		const shapeSpec = SHAPE_TOOL_BUTTONS.find(spec => spec.tool === tool);
		this.shapesButton.classList.toggle('is-active', !!shapeSpec);
		this.shapesButton.setAttribute('aria-pressed', String(!!shapeSpec));
		// The Shapes button adopts the active shape's icon.
		const iconName: EditorIconName = shapeSpec ? shapeSpec.icon : 'shapes';
		if (iconName !== this.shapesButtonIconName) {
			this.shapesButtonIconName = iconName;
			this.shapesButton.querySelector('svg')?.remove();
			const icon = iconEl(this.doc, iconName);
			if (icon) {
				this.shapesButton.insertBefore(icon, this.shapesButton.firstChild);
			}
		}
		for (const [id, item] of this.shapeMenuItems) {
			const active = id === tool;
			item.classList.toggle('is-active', active);
			item.setAttribute('aria-checked', String(active));
		}
		this.toggleShapeMenu(false);
		this.svg.classList.toggle('is-pan-tool', tool === 'pan');
		this.dirtyOverlay = true;
		this.requestRender();
		this.announce(`${tool} tool`);
	}

	get selectionIds(): string[] {
		return [...this.selection];
	}

	private setSelection(ids: Iterable<string>): void {
		this.selection = new Set(ids);
		this.dirtyOverlay = true;
		this.updatePropsFromSelection();
		this.renderSourceHighlight();
		this.refreshObjectsPanel();
		this.requestRender();
	}

	private updatePropsFromSelection(): void {
		const controls = this.propsControls;
		const selected = this.selectedGeometries();
		const editable = selected.filter(geometry => geometry.object.type !== 'locked');
		const lockedOnly = selected.length > 0 && editable.length === 0;

		if (this.propsScopeEl) {
			this.propsScopeEl.textContent = selected.length === 0
				? 'No selection — sets the style for new objects.'
				: lockedOnly
					? 'Source-only statement — style it in the Source panel.'
					: `Editing ${editable.length} selected object${editable.length === 1 ? '' : 's'}.`;
		}
		controls.stroke?.setDisabled(lockedOnly);
		controls.fill?.setDisabled(lockedOnly);
		for (const control of [
			controls.width, controls.dash, controls.arrows,
			controls.opacity, controls.rounded, controls.nodeText,
		]) {
			if (control) {
				control.disabled = lockedOnly;
			}
		}

		const first = editable[0]?.object;
		// With a selection the panel mirrors its first editable object; with
		// none it mirrors the defaults that edits would change.
		const style = first && first.type !== 'locked'
			? parseOptionStyle(first.options)
			: selected.length ? {} : { ...this.styleDefaults };
		controls.stroke?.set(style.strokeColor ?? null);
		controls.fill?.set(style.fillColor ?? null);
		if (controls.width) {
			controls.width.value = style.lineWidth ?? 'default';
		}
		if (controls.dash) {
			controls.dash.value = style.dash ?? 'solid';
		}
		if (controls.arrows) {
			controls.arrows.value = style.arrows ?? '';
		}
		if (controls.opacity) {
			controls.opacity.value = String(style.opacity ?? 1);
		}
		if (controls.rounded) {
			controls.rounded.checked = !!style.roundedCorners;
		}
		if (controls.nodeText) {
			controls.nodeText.value = first && first.type === 'node' ? first.text : '';
		}
	}

	/* ---------------------------------------------------------------------- */
	/* committing changes                                                      */
	/* ---------------------------------------------------------------------- */

	/** Apply patches to the fence, resync, and schedule the compile. */
	private commitPatches(patches: SourcePatch[]): boolean {
		if (!patches.length) {
			return false;
		}
		const ok = this.host.applyPatches(this.scene.source, patches);
		if (!ok) {
			this.announce('Edit skipped: the source changed underneath.');
			const block = this.host.getBlock();
			if (block) {
				this.scene = parseTikzScene(block.source);
				this.rebuildFromScene();
				this.requestRender();
			}
			return false;
		}
		const block = this.host.getBlock();
		if (block) {
			this.scene = parseTikzScene(block.source);
			this.rebuildFromScene();
		}
		this.requestRender();
		this.host.requestCompile();
		return true;
	}

	/** Insert a generated statement and select the resulting object. */
	private commitNewStatement(statementText: string): void {
		const picture = insertionPicture(this.scene);
		const patches = insertStatementPatches(this.scene, picture, statementText);
		const beforeIds = new Set(this.scene.objects.map(object => object.id));
		if (this.commitPatches(patches)) {
			const added = this.scene.objects.filter(object =>
				object.pictureIndex === picture.index && !beforeIds.has(object.id));
			const last = added[added.length - 1]
				?? this.scene.objects[this.scene.objects.length - 1];
			if (last) {
				this.setSelection([last.id]);
			}
		}
	}

	deleteSelection(): void {
		// Every selected object can be deleted — including source-only ones:
		// deletion is span-based, needs no understanding of the statement, and
		// is one normal undo step.
		const selected = this.selectedGeometries();
		if (!selected.length) {
			return;
		}
		const patches = selected.flatMap(geometry =>
			deleteObjectPatches(this.scene.source, geometry.object));
		this.setSelection([]);
		this.commitPatches(patches);
		this.announce(`Deleted ${selected.length} object${selected.length === 1 ? '' : 's'}.`);
	}

	duplicateSelection(): void {
		const selected = this.selectedGeometries()
			.filter(geometry => geometry.object.type !== 'locked');
		if (!selected.length) {
			return;
		}
		const patches = selected.flatMap(geometry =>
			duplicateObjectPatches(this.scene.source, geometry.object));
		this.commitPatches(patches);
		this.announce('Duplicated selection.');
	}

	copySelection(): void {
		const selected = this.selectedGeometries()
			.filter(geometry => geometry.object.type !== 'locked');
		if (!selected.length) {
			return;
		}
		this.clipboard = selected.map(geometry =>
			this.scene.source.slice(geometry.object.span.from, geometry.object.span.to));
		const fragment = this.clipboard.join('\n');
		const win = this.doc.defaultView;
		void win?.navigator?.clipboard?.writeText?.(fragment)?.catch(() => {
			// System clipboard is best-effort; the internal buffer always works.
		});
		this.announce(`Copied ${selected.length} object${selected.length === 1 ? '' : 's'} as TikZ.`);
	}

	pasteClipboard(): void {
		if (!this.clipboard.length) {
			return;
		}
		const scratchScene = parseTikzScene(this.clipboard.join('\n'));
		const shifted = scratchScene.objects
			.filter(object => object.type !== 'locked')
			.map(object => translatedStatementText(scratchScene.source, object, 0.5, -0.5));
		const texts = shifted.length ? shifted : this.clipboard;
		// One insert = one undo step, however many objects were copied.
		this.commitNewStatement(texts.map(text => text.trim()).join('\n'));
	}

	private applyStyle(edit: StyleEdit): void {
		const selected = this.selectedGeometries()
			.filter(geometry => geometry.object.type !== 'locked');
		if (!selected.length) {
			// With nothing selected the panel sets defaults for new objects.
			this.mergeStyleDefaults(edit);
			return;
		}
		const patches = selected.flatMap(geometry =>
			styleEditPatches(this.scene.source, geometry.object, edit));
		this.commitPatches(patches);
	}

	private mergeStyleDefaults(edit: StyleEdit): void {
		const defaults = this.styleDefaults;
		if (edit.strokeColor !== undefined) {
			defaults.strokeColor = edit.strokeColor ?? undefined;
		}
		if (edit.fillColor !== undefined) {
			defaults.fillColor = edit.fillColor ?? undefined;
		}
		if (edit.lineWidth !== undefined) {
			defaults.lineWidth = edit.lineWidth ?? undefined;
		}
		if (edit.dash !== undefined) {
			defaults.dash = edit.dash ?? undefined;
		}
		if (edit.arrows !== undefined) {
			defaults.arrows = edit.arrows ?? undefined;
		}
		if (edit.opacity !== undefined) {
			defaults.opacity = edit.opacity ?? undefined;
		}
		if (edit.roundedCorners !== undefined) {
			defaults.roundedCorners = edit.roundedCorners ?? undefined;
		}
	}

	private applyNodeText(text: string): void {
		const selected = this.selectedGeometries();
		const node = selected.find(geometry => geometry.object.type === 'node');
		if (!node) {
			return;
		}
		const object = node.object as SceneNodeObject;
		if (!object.textSpan) {
			return;
		}
		// Math bodies keep their $…$ untouched; plain text gets Hebrew runs
		// wrapped in \he{} automatically.
		const replacement = text.includes('$') ? text : wrapHebrewRuns(text);
		this.commitPatches([{ oldSpan: object.textSpan, replacement }]);
	}

	/* ---------------------------------------------------------------------- */
	/* snapping                                                                */
	/* ---------------------------------------------------------------------- */

	private snapContext(excludeObjectId?: string): SnapContext {
		return {
			gridStepCm: this.gridStepCm,
			snapToGrid: this.snapOn,
			snapToObjects: this.snapOn,
			candidates: snapCandidates(this.geometries, excludeObjectId),
			toleranceCm: this.pxToCm(8),
		};
	}

	private snapDrawPoint(raw: TikzCoordinate, shift: boolean, anchor?: TikzCoordinate): TikzCoordinate {
		let point = raw;
		if (shift && anchor) {
			point = axisConstrain(point, anchor);
		}
		return snapPoint(point, this.snapContext()).point;
	}

	/* ---------------------------------------------------------------------- */
	/* gesture host                                                            */
	/* ---------------------------------------------------------------------- */

	private buildGestureHost() {
		return {
			onToolStart: (pointer: PointerLike) => this.toolStart(pointer),
			onToolMove: (pointer: PointerLike) => this.toolMove(pointer),
			onToolEnd: (pointer: PointerLike) => this.toolEnd(pointer),
			onToolCancel: () => this.toolCancel(),
			onPanStart: (pointer: PointerLike) => {
				this.panLast = { x: pointer.clientX, y: pointer.clientY };
				this.svg.classList.add('is-panning');
			},
			onPanMove: (pointer: PointerLike) => {
				if (!this.panLast) {
					return;
				}
				const dx = pointer.clientX - this.panLast.x;
				const dy = pointer.clientY - this.panLast.y;
				this.panLast = { x: pointer.clientX, y: pointer.clientY };
				this.viewBox = panViewBox(this.viewBox, dx, dy, this.pxPerPt());
				this.dirtyView = true;
				this.requestRender();
			},
			onPanEnd: () => {
				this.panLast = null;
				this.svg.classList.remove('is-panning');
				this.flushPendingSync();
			},
			onPinchStart: (a: PointerLike, b: PointerLike) => {
				const rect = this.svg.getBoundingClientRect();
				const midX = (a.clientX + b.clientX) / 2;
				const midY = (a.clientY + b.clientY) / 2;
				this.pinchStartMidpoint = { x: midX, y: midY };
				this.pinchStartPxPerPt = this.pxPerPt();
				this.pinch = {
					baseBox: { ...this.viewBox },
					baseDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
					baseFocus: {
						x: this.viewBox.x + ((midX - rect.left) / Math.max(rect.width, 1)) * this.viewBox.w,
						y: this.viewBox.y + ((midY - rect.top) / Math.max(rect.height, 1)) * this.viewBox.h,
					},
				};
			},
			onPinchMove: (a: PointerLike, b: PointerLike) => {
				if (!this.pinch) {
					return;
				}
				const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
				const midpoint = {
					x: (a.clientX + b.clientX) / 2,
					y: (a.clientY + b.clientY) / 2,
				};
				this.viewBox = pinchViewBox(
					this.pinch, distance, midpoint, this.pinchStartMidpoint, this.pinchStartPxPerPt,
				);
				this.dirtyView = true;
				this.requestRender();
			},
			onPinchEnd: () => {
				this.pinch = null;
				this.flushPendingSync();
			},
			capturePointer: (pointerId: number) => {
				try {
					this.svg.setPointerCapture(pointerId);
				} catch {
					// jsdom and detached nodes have no pointer capture.
				}
			},
			releasePointer: (pointerId: number) => {
				try {
					this.svg.releasePointerCapture(pointerId);
				} catch {
					// Already released.
				}
			},
		};
	}

	private hitToleranceCm(pointerType: string): number {
		return this.pxToCm(pointerType === 'touch' ? 14 : 7);
	}

	private toolStart(pointer: PointerLike): void {
		this.root.focus({ preventScroll: true });
		const point = this.clientToCm(pointer.clientX, pointer.clientY);
		if (!point) {
			return;
		}

		if (this.tool === 'select') {
			this.selectStart(pointer, point);
			return;
		}
		if (this.tool === 'text' || this.tool === 'math' || this.tool === 'plot') {
			this.gesture = { kind: 'pen-click' };
			return;
		}
		if (this.tool === 'path' || this.tool === 'bezier') {
			this.gesture = { kind: 'pen-click' };
			return;
		}
		if (this.tool === 'freehand') {
			this.gesture = {
				kind: 'freehand',
				draft: createFreehandDraft(point, this.pxToCm(1), pointer.pressure ?? 0.5),
				recognized: null,
			};
			this.armFreehandHold(point);
			this.dirtyOverlay = true;
			this.requestRender();
			return;
		}
		const start = this.snapDrawPoint(point, false);
		this.gesture = {
			kind: 'shape',
			tool: this.tool as DragShapeTool,
			start,
			current: start,
			shift: !!pointer.shiftKey,
		};
		this.dirtyOverlay = true;
		this.requestRender();
	}

	private selectStart(pointer: PointerLike, point: TikzCoordinate): void {
		const tolerance = this.hitToleranceCm(pointer.pointerType);
		const rotateInfo = this.rotateHandleInfo();
		if (rotateInfo && Math.hypot(point.x - rotateInfo.grip.x, point.y - rotateInfo.grip.y)
			< Math.max(tolerance, this.pxToCm(12))) {
			this.gesture = {
				kind: 'rotate',
				pivot: rotateInfo.pivot,
				startAngle: Math.atan2(point.y - rotateInfo.pivot.y, point.x - rotateInfo.pivot.x),
				angleDeg: 0,
			};
			return;
		}
		const selectedHandles = this.selectedGeometries().flatMap(geometry => geometry.handles);
		const handle = hitTestHandles(selectedHandles, point, Math.max(tolerance, this.pxToCm(10)));
		if (handle) {
			const objectId = handle.id.split(':').slice(0, 2).join(':');
			this.gesture = {
				kind: 'handle',
				objectId,
				handle,
				current: handle.posCm,
				shift: !!pointer.shiftKey,
			};
			return;
		}

		// Editable objects win over locked ghosts occupying the same spot.
		const candidateSet = hitTestCandidates(this.geometries, point, tolerance);
		const cycleIds = [...candidateSet.stroke, ...candidateSet.contained]
			.map(geometry => geometry.object.id);
		const hit = candidateSet.stroke[0]
			?? hitTestScene(this.geometries, point, tolerance, { includeLocked: true });
		if (hit && hit.object.type !== 'locked') {
			const id = hit.object.id;
			const wasSelected = !pointer.shiftKey && this.selection.size === 1 && this.selection.has(id);
			if (pointer.shiftKey) {
				const next = new Set(this.selection);
				if (next.has(id)) {
					next.delete(id);
				} else {
					next.add(id);
				}
				this.setSelection(next);
			} else if (!this.selection.has(id)) {
				this.setSelection([id]);
			}
			this.gesture = {
				kind: 'move',
				start: point,
				delta: { dx: 0, dy: 0 },
				objectIds: [...this.selection].filter(objectId =>
					this.geometries.find(geometry => geometry.object.id === objectId)?.object.type !== 'locked'),
				moved: false,
				candidates: cycleIds,
				hitId: id,
				wasSelected,
			};
			return;
		}

		// Grabbing the inside of an already-selected shape moves the selection
		// instead of starting a box selection over it.
		if (!pointer.shiftKey) {
			const insideSelected = this.selectedGeometries().some(geometry =>
				geometry.object.type !== 'locked' && pointInsideGeometry(point, geometry));
			if (insideSelected) {
				const soleId = this.selection.size === 1 ? [...this.selection][0] : null;
				this.gesture = {
					kind: 'move',
					start: point,
					delta: { dx: 0, dy: 0 },
					objectIds: [...this.selection].filter(objectId =>
						this.geometries.find(geometry => geometry.object.id === objectId)?.object.type !== 'locked'),
					moved: false,
					candidates: cycleIds,
					hitId: soleId,
					wasSelected: soleId !== null,
				};
				return;
			}
		}

		// Empty canvas, a locked ghost, or a shape's hollow interior: a drag
		// becomes a box selection; a plain tap (no drag) selects what is under
		// the pointer — including a shape grabbed by its interior — and
		// explains the lock for locked ghosts.
		const contained = hit
			?? containmentHit(this.geometries, point)
			?? containmentHit(this.geometries, point, { includeLocked: true });
		this.gesture = {
			kind: 'marquee',
			start: point,
			current: point,
			additive: !!pointer.shiftKey,
			tapCandidate: contained ? contained.object.id : null,
		};
		if (!pointer.shiftKey && !contained) {
			this.setSelection([]);
		}
	}

	private toolMove(pointer: PointerLike): void {
		const gesture = this.gesture;
		if (!gesture) {
			return;
		}
		const point = this.clientToCm(pointer.clientX, pointer.clientY);
		if (!point) {
			return;
		}
		switch (gesture.kind) {
			case 'shape':
				gesture.current = this.snapDrawPoint(point, !!pointer.shiftKey, gesture.start);
				gesture.shift = !!pointer.shiftKey;
				break;
			case 'freehand': {
				appendFreehandPoint(gesture.draft, point, pointer.pressure ?? 0.5);
				// A real move re-arms the hold-to-snap timer and discards any
				// already-recognized shape — the user was not done after all.
				const anchor = this.freehandHoldAnchor;
				if (!anchor || Math.hypot(point.x - anchor.x, point.y - anchor.y) > this.pxToCm(9)) {
					this.armFreehandHold(point);
					if (gesture.recognized) {
						gesture.recognized = null;
						this.announce('Shape snap cancelled — keep drawing.');
					}
				}
				break;
			}
			case 'move': {
				const raw = { dx: point.x - gesture.start.x, dy: point.y - gesture.start.y };
				if (!gesture.moved
					&& Math.hypot(raw.dx, raw.dy) < CLICK_DRAG_THRESHOLD_CM) {
					return;
				}
				gesture.moved = true;
				const reference = this.moveReferencePoint(gesture.objectIds);
				gesture.delta = reference
					? snapTranslation(reference, raw.dx, raw.dy, this.snapContext())
					: raw;
				this.applyMovePreview(gesture.objectIds, gesture.delta);
				return;
			}
			case 'handle': {
				const snapped = this.snapDrawPoint(point, !!pointer.shiftKey, gesture.handle.posCm);
				gesture.current = snapped;
				this.applyHandlePreview(gesture);
				return;
			}
			case 'rotate': {
				const angle = Math.atan2(point.y - gesture.pivot.y, point.x - gesture.pivot.x);
				let deg = ((angle - gesture.startAngle) * 180) / Math.PI;
				while (deg > 180) {
					deg -= 360;
				}
				while (deg < -180) {
					deg += 360;
				}
				if (pointer.shiftKey) {
					deg = Math.round(deg / 15) * 15;
				}
				gesture.angleDeg = deg;
				this.applyRotatePreview(gesture);
				this.announce(`Rotate ${Math.round(deg)}°`);
				return;
			}
			case 'marquee':
				gesture.current = point;
				break;
			case 'pen-click':
				return;
		}
		this.dirtyOverlay = true;
		this.requestRender();
	}

	private moveReferencePoint(objectIds: string[]): TikzCoordinate | null {
		for (const id of objectIds) {
			const geometry = this.geometries.find(entry => entry.object.id === id);
			const vertex = geometry?.handles.find(handle => handle.kind === 'vertex');
			if (vertex) {
				return vertex.posCm;
			}
		}
		// Handle-less objects (native plots) snap by their bounds corner.
		for (const id of objectIds) {
			const geometry = this.geometries.find(entry => entry.object.id === id);
			if (geometry?.bounds) {
				return { x: geometry.bounds.minX, y: geometry.bounds.minY };
			}
		}
		return null;
	}

	private applyMovePreview(objectIds: string[], delta: { dx: number; dy: number }): void {
		const dxPt = delta.dx * PT_PER_CM;
		const dyPt = -delta.dy * PT_PER_CM;
		for (const id of objectIds) {
			const group = this.layerObjects.querySelector(`[data-luatikz-object-id="${id}"]`);
			group?.setAttribute('transform', `translate(${dxPt} ${dyPt})`);
			group?.classList.add('is-live');
		}
		this.layerOverlay.setAttribute('transform', `translate(${dxPt} ${dyPt})`);
	}

	private clearMovePreview(): void {
		for (const group of Array.from(this.layerObjects.children)) {
			group.removeAttribute('transform');
			group.classList.remove('is-live');
		}
		this.layerOverlay.removeAttribute('transform');
	}

	/** Live rotation preview: SVG rotate about the pivot (pt space, y down). */
	private applyRotatePreview(
		gesture: Extract<NonNullable<ActiveGesture>, { kind: 'rotate' }>,
	): void {
		const cx = gesture.pivot.x * PT_PER_CM;
		const cy = -gesture.pivot.y * PT_PER_CM;
		const transform = `rotate(${-gesture.angleDeg} ${cx} ${cy})`;
		for (const id of this.selection) {
			const group = this.layerObjects.querySelector(`[data-luatikz-object-id="${id}"]`);
			group?.setAttribute('transform', transform);
			group?.classList.add('is-live');
		}
		this.layerOverlay.setAttribute('transform', transform);
	}

	private applyHandlePreview(gesture: Extract<NonNullable<ActiveGesture>, { kind: 'handle' }>): void {
		const geometry = this.geometries.find(entry => entry.object.id === gesture.objectId);
		if (!geometry || geometry.object.type === 'locked') {
			return;
		}
		const preview = this.previewObjectWithHandle(geometry.object, gesture.handle, gesture.current);
		if (!preview) {
			return;
		}
		const picture = this.scene.pictures[geometry.object.pictureIndex];
		const previewGeometry = resolveObjectGeometry(preview, picture);
		const context = this.renderContext();
		const old = this.layerObjects.querySelector(
			`[data-luatikz-object-id="${gesture.objectId}"]`,
		);
		const fresh = renderObjectGroup(context, previewGeometry);
		fresh.classList.add('is-live');
		if (old) {
			old.replaceWith(fresh);
		} else {
			this.layerObjects.appendChild(fresh);
		}
		renderSelectionOverlay(context, this.layerOverlay, [previewGeometry], previewGeometry.handles);
	}

	/** Display point → the picture's source coordinates (inverse transform). */
	private toPictureSpace(transform: PictureTransform, point: TikzCoordinate): TikzCoordinate {
		const inverse = invertTransform(transform);
		return inverse ? applyToPoint(inverse, point) : point;
	}

	/** Clone the object with one dragged token updated (display-only). */
	private previewObjectWithHandle(
		object: SceneObject,
		handle: ObjectHandle,
		target: TikzCoordinate,
	): SceneObject | null {
		const picture = this.scene.pictures[object.pictureIndex];
		let source = this.toPictureSpace(picture.transform, target);
		if (object.type === 'path' && object.optionShift) {
			source = { x: source.x - object.optionShift.x, y: source.y - object.optionShift.y };
		}
		if (object.type === 'node') {
			return {
				...object,
				at: { ...object.at, resolved: source },
			};
		}
		if (object.type !== 'path') {
			return null;
		}
		const elements = object.elements.map((element, index) => {
			if (index !== handle.elementIndex) {
				return element;
			}
			if (element.kind === 'coord' && handle.token === 'coord') {
				return { ...element, coord: { ...element.coord, resolved: source } };
			}
			if (element.kind === 'curveTo' && handle.token === 'c1') {
				return { ...element, c1: { ...element.c1, resolved: source } };
			}
			if (element.kind === 'curveTo' && handle.token === 'c2' && element.c2) {
				return { ...element, c2: { ...element.c2, resolved: source } };
			}
			if (element.kind === 'circle' && handle.token === 'radius') {
				const geometry = this.geometries.find(entry => entry.object.id === object.id);
				const center = geometry?.handles
					.filter(h => h.kind === 'vertex' && h.elementIndex < handle.elementIndex)
					.pop();
				if (!center) {
					return element;
				}
				const scaleAvg = uniformScale(picture.transform) || 1;
				const displayRadius = Math.hypot(target.x - center.posCm.x, target.y - center.posCm.y);
				const cm = Math.max(displayRadius / scaleAvg, 0.02);
				return {
					...element,
					radius: { ...element.radius, cm },
					yRadius: element.yRadius ? { ...element.yRadius, cm } : null,
				};
			}
			return element;
		});
		return { ...object, elements };
	}

	private toolEnd(pointer: PointerLike): void {
		const gesture = this.gesture;
		this.gesture = null;
		const point = this.clientToCm(pointer.clientX, pointer.clientY);

		if (!gesture) {
			this.flushPendingSync();
			return;
		}

		switch (gesture.kind) {
			case 'shape': {
				const current = point
					? this.snapDrawPoint(point, !!pointer.shiftKey || gesture.shift, gesture.start)
					: gesture.current;
				this.commitShape(gesture.tool, gesture.start, current);
				break;
			}
			case 'freehand': {
				this.clearFreehandHold();
				if (gesture.recognized) {
					this.commitRecognizedShape(gesture.recognized);
					break;
				}
				const transform = insertionPicture(this.scene).transform;
				const draft = {
					...gesture.draft,
					points: gesture.draft.points.map(sample => ({
						...sample,
						...this.toPictureSpace(transform, sample),
					})),
				};
				const statement = generateFreehandStatement(
					draft,
					this.freehandSmoothingPx,
					this.pxToCm(1) / (uniformScale(transform) || 1),
					this.styleDefaults,
				);
				if (statement) {
					this.commitNewStatement(statement);
					this.announce('Freehand stroke added.');
				}
				break;
			}
			case 'move': {
				this.clearMovePreview();
				// A repeated tap on the same spot digs through stacked
				// objects: select the next candidate under the pointer.
				if (!gesture.moved && gesture.wasSelected && gesture.hitId
					&& gesture.candidates.length > 1) {
					const index = gesture.candidates.indexOf(gesture.hitId);
					const next = gesture.candidates[(index + 1) % gesture.candidates.length];
					if (next && next !== gesture.hitId) {
						this.setSelection([next]);
						const position = gesture.candidates.indexOf(next) + 1;
						this.announce(`Selected object ${position} of ${gesture.candidates.length} under the pointer — tap again for the next one.`);
					}
					break;
				}
				if (gesture.moved
					&& (Math.abs(gesture.delta.dx) > 1e-6 || Math.abs(gesture.delta.dy) > 1e-6)) {
					const patches: SourcePatch[] = [];
					for (const id of gesture.objectIds) {
						const geometry = this.geometries.find(entry => entry.object.id === id);
						if (!geometry) {
							continue;
						}
						const picture = this.scene.pictures[geometry.object.pictureIndex];
						const inverse = invertTransform(picture.transform);
						const delta = inverse
							? applyLinear(inverse, { x: gesture.delta.dx, y: gesture.delta.dy })
							: { x: gesture.delta.dx, y: gesture.delta.dy };
						patches.push(...translateObjectPatches(geometry.object, delta.x, delta.y));
					}
					this.commitPatches(patches);
				}
				break;
			}
			case 'handle':
				this.commitHandleDrag(gesture);
				break;
			case 'rotate': {
				this.clearMovePreview();
				if (Math.abs(gesture.angleDeg) > 0.5) {
					this.rotateSelection(gesture.angleDeg, gesture.pivot);
				}
				break;
			}
			case 'marquee': {
				const minX = Math.min(gesture.start.x, gesture.current.x);
				const maxX = Math.max(gesture.start.x, gesture.current.x);
				const minY = Math.min(gesture.start.y, gesture.current.y);
				const maxY = Math.max(gesture.start.y, gesture.current.y);
				const dragged = maxX - minX > CLICK_DRAG_THRESHOLD_CM
					|| maxY - minY > CLICK_DRAG_THRESHOLD_CM;
				if (dragged) {
					// Box selection: an object joins only when its whole
					// bounds sit inside the box.
					const inside = this.geometries.filter(geometry =>
						geometry.object.type !== 'locked'
						&& geometry.bounds
						&& geometry.bounds.minX >= minX - 1e-6
						&& geometry.bounds.maxX <= maxX + 1e-6
						&& geometry.bounds.minY >= minY - 1e-6
						&& geometry.bounds.maxY <= maxY + 1e-6);
					const next = gesture.additive ? new Set(this.selection) : new Set<string>();
					for (const geometry of inside) {
						next.add(geometry.object.id);
					}
					this.setSelection(next);
				} else if (gesture.tapCandidate) {
					const id = gesture.tapCandidate;
					const target = this.geometries.find(geometry => geometry.object.id === id);
					if (gesture.additive) {
						const next = new Set(this.selection);
						if (next.has(id)) {
							next.delete(id);
						} else {
							next.add(id);
						}
						this.setSelection(next);
					} else {
						this.setSelection([id]);
					}
					if (target && target.object.type === 'locked') {
						this.announce(`${target.object.reason}. You can delete it, or edit it in the Source panel.`);
					}
				} else if (!gesture.additive) {
					this.setSelection([]);
				}
				break;
			}
			case 'pen-click': {
				if (!point) {
					break;
				}
				if (this.tool === 'text' || this.tool === 'math') {
					this.openTextInput(this.snapDrawPoint(point, false), this.tool === 'math');
				} else if (this.tool === 'plot') {
					this.openPlotInput(point);
				} else if (this.tool === 'path' || this.tool === 'bezier') {
					this.clickDraftAddPoint(this.snapDrawPoint(point, !!pointer.shiftKey, this.clickDraft?.points.at(-1)));
				}
				break;
			}
		}
		this.dirtyOverlay = true;
		this.requestRender();
		this.flushPendingSync();
	}

	private toolCancel(): void {
		const gesture = this.gesture;
		this.gesture = null;
		this.clearFreehandHold();
		if (gesture?.kind === 'move' || gesture?.kind === 'rotate') {
			this.clearMovePreview();
		}
		if (gesture?.kind === 'handle') {
			// Restore the untouched object rendering.
			this.dirtyScene = true;
		}
		this.dirtyOverlay = true;
		this.requestRender();
		this.flushPendingSync();
	}

	private commitShape(tool: DragShapeTool, start: TikzCoordinate, end: TikzCoordinate): void {
		const size = Math.hypot(end.x - start.x, end.y - start.y);
		if (size < CLICK_DRAG_THRESHOLD_CM) {
			return;
		}
		// The user draws in display space; the statement is written in the
		// insertion picture's own coordinates so scale/rotate/shift options
		// re-place it exactly where it was drawn.
		const transform = insertionPicture(this.scene).transform;
		const toSource = (point: TikzCoordinate) => this.toPictureSpace(transform, point);
		const lengthScale = uniformScale(transform) || 1;
		const style = this.styleDefaults;
		let statement: string | null = null;
		switch (tool) {
			case 'line':
				statement = generateLine(toSource(start), toSource(end), { ...style, arrows: style.arrows ?? '' });
				break;
			case 'arrow':
				statement = generateLine(toSource(start), toSource(end), { ...style, arrows: style.arrows || '->' });
				break;
			case 'rect':
				statement = generateRectangle(toSource(start), toSource(end), style);
				break;
			case 'rounded-rect':
				statement = generateRectangle(toSource(start), toSource(end), { ...style, roundedCorners: true });
				break;
			case 'circle':
				statement = generateCircle(toSource(start), size / lengthScale, style);
				break;
			case 'ellipse': {
				const rx = Math.abs(end.x - start.x) / (colXScale(transform) || 1);
				const ry = Math.abs(end.y - start.y) / (colYScale(transform) || 1);
				if (rx > 1e-3 && ry > 1e-3) {
					statement = generateEllipse(toSource(start), rx, ry, style);
				}
				break;
			}
			case 'arc': {
				const arc = this.arcFromChord(start, end);
				if (arc) {
					const rotation = rotationDeg(transform);
					statement = generateArc(
						toSource(start),
						arc.startAngle - rotation,
						arc.endAngle - rotation,
						arc.radius / lengthScale,
						style,
					);
				}
				break;
			}
			case 'grid-path':
				statement = generateGridPath(toSource(start), toSource(end), Math.max(this.gridStepCm, 0.25), style);
				break;
			case 'diamond': {
				const rx = Math.abs(end.x - start.x);
				const ry = Math.abs(end.y - start.y);
				if (rx > 1e-3 && ry > 1e-3) {
					statement = generatePolyline(diamondPoints(start, rx, ry).map(toSource), true, style);
				}
				break;
			}
			case 'triangle':
				statement = generatePolyline(polygonPoints(start, size, 3).map(toSource), true, style);
				break;
			case 'polygon':
				statement = generatePolyline(polygonPoints(start, size, this.polygonSides).map(toSource), true, style);
				break;
			case 'star':
				statement = generatePolyline(starPoints(start, size, 0.5, this.starSpikes).map(toSource), true, style);
				break;
		}
		if (statement) {
			this.commitNewStatement(statement);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* rotation                                                                */
	/* ---------------------------------------------------------------------- */

	/**
	 * Rotate the selection by `thetaDeg` CCW around `pivot` (display cm) by
	 * rewriting coordinate tokens: each point maps display→rotated→back
	 * through the picture transform, so rotation works inside transformed
	 * pictures too. Arcs rotate via their angle tokens; `rectangle` paths
	 * become explicit closed polylines (an axis-aligned rectangle cannot
	 * represent its own rotation).
	 */
	private rotateSelection(thetaDeg: number, pivot: TikzCoordinate): void {
		const rad = (thetaDeg * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const patches: SourcePatch[] = [];
		let skipped = 0;

		for (const geometry of this.selectedGeometries()) {
			const object = geometry.object;
			if (object.type === 'locked') {
				skipped++;
				continue;
			}
			const picture = this.scene.pictures[object.pictureIndex];
			const transform = picture.transform;
			const inverse = invertTransform(transform);
			const mapPoint = (source: TikzCoordinate): TikzCoordinate => {
				const display = applyToPoint(transform, source);
				const rotated = {
					x: pivot.x + (display.x - pivot.x) * cos - (display.y - pivot.y) * sin,
					y: pivot.y + (display.x - pivot.x) * sin + (display.y - pivot.y) * cos,
				};
				return inverse ? applyToPoint(inverse, rotated) : rotated;
			};

			if (object.type === 'node') {
				patches.push(coordinateTokenPatch(object.at, mapPoint(object.at.resolved), { x: 0, y: 0 }));
				continue;
			}
			if (object.elements.some(element => element.kind === 'plot')) {
				// A plot's shape lives in its expression; rotation cannot be
				// expressed by rewriting coordinates.
				skipped++;
				continue;
			}
			if (object.elements.some(element => element.kind === 'rectangleTo' || element.kind === 'gridTo')) {
				const rewritten = this.rotatedRectStatement(object, mapPoint);
				if (rewritten) {
					patches.push({ oldSpan: object.span, replacement: rewritten });
				} else {
					skipped++;
				}
				continue;
			}
			const bases = penPositionsBefore(object);
			object.elements.forEach((element, index) => {
				const base = mapPoint(bases[index] ?? { x: 0, y: 0 });
				if (element.kind === 'coord') {
					patches.push(coordinateTokenPatch(element.coord, mapPoint(element.coord.resolved), base));
				} else if (element.kind === 'curveTo') {
					patches.push(coordinateTokenPatch(element.c1, mapPoint(element.c1.resolved), base));
					if (element.c2) {
						patches.push(coordinateTokenPatch(element.c2, mapPoint(element.c2.resolved), base));
					}
				} else if (element.kind === 'arc') {
					patches.push(numberTokenPatch(element.startAngle, element.startAngle.value + thetaDeg));
					patches.push(numberTokenPatch(element.endAngle, element.endAngle.value + thetaDeg));
				}
			});
		}

		if (patches.length && this.commitPatches(patches)) {
			this.announce(`Rotated by ${Math.round(thetaDeg)}°${skipped ? ` (${skipped} object${skipped === 1 ? '' : 's'} skipped)` : ''}.`);
		} else if (skipped) {
			this.announce('Selection could not be rotated — grids and source-only objects stay as they are.');
		}
	}

	/** `(a) rectangle (b)` rewritten as the rotated closed polyline. */
	private rotatedRectStatement(
		object: ScenePathObject,
		mapPoint: (point: TikzCoordinate) => TikzCoordinate,
	): string | null {
		const elements = object.elements;
		if (elements.length !== 3
			|| elements[0].kind !== 'coord'
			|| elements[1].kind !== 'rectangleTo'
			|| elements[2].kind !== 'coord') {
			return null;
		}
		const a = elements[0].coord.resolved;
		const b = elements[2].coord.resolved;
		const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]
			.map(mapPoint)
			.map(point => ({
				x: Math.round(point.x * 100) / 100,
				y: Math.round(point.y * 100) / 100,
			}));
		const options = object.options ? `[${object.options}]` : '';
		const command = object.command ?? 'draw';
		return `\\${command}${options} ${corners.map(formatPoint).join(' -- ')} -- cycle;`;
	}

	/* ---------------------------------------------------------------------- */
	/* freehand hold-to-snap                                                   */
	/* ---------------------------------------------------------------------- */

	private armFreehandHold(anchor: TikzCoordinate): void {
		this.freehandHoldAnchor = anchor;
		const win = this.doc.defaultView;
		if (!win) {
			return;
		}
		if (this.freehandHoldTimer !== null) {
			win.clearTimeout(this.freehandHoldTimer);
		}
		this.freehandHoldTimer = win.setTimeout(() => {
			this.freehandHoldTimer = null;
			this.recognizeFreehandNow();
		}, FREEHAND_HOLD_MS);
	}

	private clearFreehandHold(): void {
		if (this.freehandHoldTimer !== null) {
			this.doc.defaultView?.clearTimeout(this.freehandHoldTimer);
			this.freehandHoldTimer = null;
		}
		this.freehandHoldAnchor = null;
	}

	/**
	 * Try to snap the in-flight freehand stroke into a clean shape. Fired by
	 * the hold timer; also callable directly (tests). Returns whether a shape
	 * was recognized.
	 */
	recognizeFreehandNow(): boolean {
		const gesture = this.gesture;
		if (!gesture || gesture.kind !== 'freehand') {
			return false;
		}
		const shape = recognizeStroke(gesture.draft.points, this.pxToCm(8));
		if (!shape) {
			return false;
		}
		gesture.recognized = shape;
		this.announce(`${shape.kind === 'polygon' && shape.points.length === 3 ? 'triangle' : shape.kind} detected — release to keep it, move to keep drawing.`);
		this.dirtyOverlay = true;
		this.requestRender();
		return true;
	}

	private recognizedPrimitives(shape: RecognizedShape): ScenePrimitive[] {
		switch (shape.kind) {
			case 'line':
				return [{ kind: 'segment', a: shape.a, b: shape.b }];
			case 'rect':
				return [{ kind: 'rect', a: shape.a, b: shape.b }];
			case 'circle':
				return [{ kind: 'circle', center: shape.center, rx: shape.radius, ry: shape.radius }];
			case 'ellipse':
				return [{ kind: 'circle', center: shape.center, rx: shape.rx, ry: shape.ry }];
			case 'polygon':
				return shape.points.map((point, index) => ({
					kind: 'segment' as const,
					a: point,
					b: shape.points[(index + 1) % shape.points.length],
				}));
		}
	}

	private commitRecognizedShape(shape: RecognizedShape): void {
		const transform = insertionPicture(this.scene).transform;
		const toSource = (point: TikzCoordinate) => this.toPictureSpace(transform, point);
		const lengthScale = uniformScale(transform) || 1;
		const style = this.styleDefaults;
		let statement: string | null = null;
		switch (shape.kind) {
			case 'line':
				statement = generateLine(toSource(shape.a), toSource(shape.b), { ...style, arrows: style.arrows ?? '' });
				break;
			case 'rect':
				statement = generateRectangle(toSource(shape.a), toSource(shape.b), style);
				break;
			case 'circle':
				statement = generateCircle(toSource(shape.center), shape.radius / lengthScale, style);
				break;
			case 'ellipse':
				statement = generateEllipse(
					toSource(shape.center),
					shape.rx / (colXScale(transform) || 1),
					shape.ry / (colYScale(transform) || 1),
					style,
				);
				break;
			case 'polygon':
				statement = generatePolyline(shape.points.map(toSource), true, style);
				break;
		}
		if (statement) {
			this.commitNewStatement(statement);
			this.announce(`Freehand stroke snapped to ${shape.kind}.`);
		}
	}

	/** Arc through a dragged chord with a fixed 90° counter-clockwise sweep. */
	private arcFromChord(
		a: TikzCoordinate,
		b: TikzCoordinate,
	): { center: TikzCoordinate; radius: number; startAngle: number; endAngle: number } | null {
		const chord = Math.hypot(b.x - a.x, b.y - a.y);
		if (chord < 1e-3) {
			return null;
		}
		const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const normal = { x: (a.y - b.y) / chord, y: (b.x - a.x) / chord };
		const half = chord / 2;
		const center = { x: mid.x + normal.x * half, y: mid.y + normal.y * half };
		const radius = chord / Math.SQRT2;
		const startAngle = (Math.atan2(a.y - center.y, a.x - center.x) * 180) / Math.PI;
		return { center, radius, startAngle, endAngle: startAngle + 90 };
	}

	private commitHandleDrag(
		gesture: Extract<NonNullable<ActiveGesture>, { kind: 'handle' }>,
	): void {
		const geometry = this.geometries.find(entry => entry.object.id === gesture.objectId);
		if (!geometry || geometry.object.type === 'locked') {
			return;
		}
		const object = geometry.object;
		const picture = this.scene.pictures[object.pictureIndex];
		let source = this.toPictureSpace(picture.transform, gesture.current);
		if (object.type === 'path' && object.optionShift) {
			source = { x: source.x - object.optionShift.x, y: source.y - object.optionShift.y };
		}

		if (object.type === 'node') {
			this.commitPatches([coordinateTokenPatch(object.at, source, { x: 0, y: 0 })]);
			return;
		}
		if (object.type !== 'path') {
			return;
		}
		const element = object.elements[gesture.handle.elementIndex];
		if (!element) {
			this.dirtyScene = true;
			this.requestRender();
			return;
		}
		const bases = penPositionsBefore(object);
		const base = bases[gesture.handle.elementIndex] ?? { x: 0, y: 0 };
		if (element.kind === 'coord' && gesture.handle.token === 'coord') {
			this.commitPatches([coordinateTokenPatch(element.coord, source, base)]);
			return;
		}
		if (element.kind === 'curveTo' && gesture.handle.token === 'c1') {
			this.commitPatches([coordinateTokenPatch(element.c1, source, base)]);
			return;
		}
		if (element.kind === 'curveTo' && gesture.handle.token === 'c2' && element.c2) {
			this.commitPatches([coordinateTokenPatch(element.c2, source, base)]);
			return;
		}
		if (element.kind === 'circle' && gesture.handle.token === 'radius') {
			// Radius handle sits on the rim; new radius = display distance to
			// the center, mapped back through the picture's length scale.
			const centerHandle = geometry.handles
				.filter(handle => handle.kind === 'vertex' && handle.elementIndex < gesture.handle.elementIndex)
				.pop();
			const center = centerHandle?.posCm ?? { x: 0, y: 0 };
			const displayRadius = Math.hypot(gesture.current.x - center.x, gesture.current.y - center.y);
			const radius = displayRadius / (uniformScale(picture.transform) || 1);
			if (radius > 0.02) {
				this.commitPatches([lengthTokenPatch(element.radius, radius)]);
			}
			return;
		}
		this.dirtyScene = true;
		this.requestRender();
	}

	/* ---------------------------------------------------------------------- */
	/* click-draft (path / bézier)                                             */
	/* ---------------------------------------------------------------------- */

	private clickDraftAddPoint(point: TikzCoordinate): void {
		if (!this.clickDraft) {
			this.clickDraft = {
				tool: this.tool === 'bezier' ? 'bezier' : 'path',
				points: [point],
				hover: null,
			};
			this.finishButton.classList.remove('luatikz-ve-hidden');
			this.announce('Path started. Click to add points; Finish or double-click to commit; near the first point closes it.');
		} else {
			const first = this.clickDraft.points[0];
			if (
				this.clickDraft.points.length >= 3
				&& Math.hypot(point.x - first.x, point.y - first.y) < this.pxToCm(12)
			) {
				this.commitClickDraft(true);
				return;
			}
			this.clickDraft.points.push(point);
		}
		this.dirtyOverlay = true;
		this.requestRender();
	}

	commitClickDraft(closed: boolean): void {
		const draft = this.clickDraft;
		this.clickDraft = null;
		this.finishButton.classList.add('luatikz-ve-hidden');
		if (!draft || draft.points.length < 2) {
			this.dirtyOverlay = true;
			this.requestRender();
			return;
		}
		const transform = insertionPicture(this.scene).transform;
		const toSource = (point: TikzCoordinate) => this.toPictureSpace(transform, point);
		if (draft.tool === 'path') {
			this.commitNewStatement(generatePolyline(draft.points.map(toSource), closed, this.styleDefaults));
		} else {
			const segments = catmullRomToBezier(draft.points);
			this.commitNewStatement(generateCurvePath(
				draft.points.map(toSource),
				segments.map(segment => ({ c1: toSource(segment.c1), c2: toSource(segment.c2) })),
				this.styleDefaults,
			));
		}
		this.dirtyOverlay = true;
		this.requestRender();
	}

	private cancelClickDraft(): void {
		this.clickDraft = null;
		this.finishButton.classList.add('luatikz-ve-hidden');
		this.dirtyOverlay = true;
		this.requestRender();
	}

	/* ---------------------------------------------------------------------- */
	/* text input overlay                                                      */
	/* ---------------------------------------------------------------------- */

	private openTextInput(
		at: TikzCoordinate,
		math: boolean,
		existing?: SceneNodeObject,
	): void {
		this.closeTextInput(false);
		const overlay = this.el('div', 'luatikz-ve-text-input', this.canvasWrap);
		const input = this.el('input', 'luatikz-ve-text-input-field', overlay);
		input.type = 'text';
		input.setAttribute('aria-label', math ? 'Math node text' : 'Text node text');
		input.placeholder = math ? 'e.g. \\alpha^2' : 'Node text';
		if (existing) {
			input.value = existing.text.replace(/^\$|\$$/g, '');
		}
		const confirm = this.el('button', 'luatikz-ve-btn luatikz-ve-text-confirm', overlay);
		confirm.type = 'button';
		confirm.textContent = 'OK';
		confirm.setAttribute('aria-label', 'Confirm text');

		const pt = cmToPt(at);
		const rect = this.svg.getBoundingClientRect();
		const wrapRect = this.canvasWrap.getBoundingClientRect();
		const scale = this.pxPerPt();
		const left = rect.left - wrapRect.left + (pt.x - this.viewBox.x) * scale;
		const top = rect.top - wrapRect.top + (pt.y - this.viewBox.y) * scale;
		overlay.style.left = `${Math.max(4, Math.min(left, wrapRect.width - 180))}px`;
		overlay.style.top = `${Math.max(4, Math.min(top, wrapRect.height - 44))}px`;

		const commit = () => {
			const value = input.value.trim();
			this.closeTextInput(false);
			if (!value) {
				return;
			}
			if (existing && existing.textSpan) {
				const isMathBody = math || /^\$.*\$$/.test(existing.text);
				const body = isMathBody ? `$${value}$` : wrapHebrewRuns(value);
				this.commitPatches([{ oldSpan: existing.textSpan, replacement: body }]);
			} else {
				const transform = insertionPicture(this.scene).transform;
				this.commitNewStatement(generateNode(
					this.toPictureSpace(transform, at),
					math ? value : wrapHebrewRuns(value),
					math,
					this.styleDefaults,
				));
			}
		};

		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeTextInput(false);
			}
			event.stopPropagation();
		}, { signal: this.ac.signal });
		confirm.addEventListener('click', commit, { signal: this.ac.signal });

		this.textInputOverlay = overlay;
		input.focus();
	}

	private closeTextInput(commit: boolean): void {
		void commit;
		if (this.textInputOverlay) {
			this.textInputOverlay.remove();
			this.textInputOverlay = null;
		}
	}

	/**
	 * Function plotter: f(x) plus a domain — the curve is committed as an
	 * ordinary editable Bézier path, so it drags and restyles like anything
	 * else. Discontinuities split the plot into separate paths.
	 */
	private openPlotInput(at: TikzCoordinate): void {
		this.closeTextInput(false);
		const overlay = this.el('div', 'luatikz-ve-text-input luatikz-ve-plot-input', this.canvasWrap);
		const fnInput = this.el('input', 'luatikz-ve-text-input-field', overlay);
		fnInput.type = 'text';
		fnInput.placeholder = 'f(x) — e.g. sin(x)';
		fnInput.setAttribute('aria-label', 'Function of x');
		const fromInput = this.el('input', 'luatikz-ve-plot-range', overlay);
		fromInput.type = 'number';
		fromInput.value = '-2';
		fromInput.setAttribute('aria-label', 'Domain start');
		const toInput = this.el('input', 'luatikz-ve-plot-range', overlay);
		toInput.type = 'number';
		toInput.value = '2';
		toInput.setAttribute('aria-label', 'Domain end');
		const confirm = this.el('button', 'luatikz-ve-btn luatikz-ve-text-confirm', overlay);
		confirm.type = 'button';
		confirm.textContent = 'Plot';
		confirm.setAttribute('aria-label', 'Insert the plot');

		const rect = this.svg.getBoundingClientRect();
		const wrapRect = this.canvasWrap.getBoundingClientRect();
		const pt = cmToPt(at);
		const scale = this.pxPerPt();
		const left = rect.left - wrapRect.left + (pt.x - this.viewBox.x) * scale;
		const top = rect.top - wrapRect.top + (pt.y - this.viewBox.y) * scale;
		overlay.style.left = `${Math.max(4, Math.min(left, wrapRect.width - 260))}px`;
		overlay.style.top = `${Math.max(4, Math.min(top, wrapRect.height - 44))}px`;

		const commit = () => {
			const fn = compileFunction(fnInput.value);
			if (!fn) {
				this.announce('Could not read the function — try e.g. sin(x), x^2 - 1, or exp(-x).');
				return;
			}
			const from = Number.parseFloat(fromInput.value);
			const to = Number.parseFloat(toInput.value);
			if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
				this.announce('The range needs two different finite numbers.');
				return;
			}
			// Sampling is only used to find the finite sub-domains (poles,
			// sqrt of negatives); the committed source is a native TikZ plot
			// that the compiler evaluates at full resolution.
			const runs = sampleFunctionRuns(fn, from, to, 48);
			if (!runs.length) {
				this.announce('The function has no finite values in that range.');
				return;
			}
			this.closeTextInput(false);
			const expr = fn.toTikz();
			const styleOptions = buildOptionsPrefix(this.styleDefaults);
			const styleInner = styleOptions ? `${styleOptions.slice(1, -1)}, ` : '';
			const round = (value: number) => Math.round(value * 100) / 100;
			const statements = runs.map(run => {
				const a = round(run[0].x);
				const b = round(run[run.length - 1].x);
				return `\\draw[${styleInner}domain=${a}:${b}, samples=120, smooth] plot (\\x, {${expr}});`;
			});
			this.commitNewStatement(statements.join('\n'));
			this.announce(`Plotted ${fnInput.value.trim()} from ${Math.min(from, to)} to ${Math.max(from, to)}.`);
		};

		const keyHandler = (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.closeTextInput(false);
			}
			event.stopPropagation();
		};
		fnInput.addEventListener('keydown', keyHandler, { signal: this.ac.signal });
		fromInput.addEventListener('keydown', keyHandler, { signal: this.ac.signal });
		toInput.addEventListener('keydown', keyHandler, { signal: this.ac.signal });
		confirm.addEventListener('click', commit, { signal: this.ac.signal });

		this.textInputOverlay = overlay;
		fnInput.focus();
	}

	/* ---------------------------------------------------------------------- */
	/* canvas + keyboard listeners                                             */
	/* ---------------------------------------------------------------------- */

	private attachCanvasListeners(): void {
		const signal = this.ac.signal;
		this.svg.addEventListener('pointerdown', event => {
			if (this.textInputOverlay) {
				this.closeTextInput(false);
			}
			event.preventDefault();
			this.router.handlePointerDown(event);
		}, { signal });
		this.svg.addEventListener('pointermove', event => {
			if (this.clickDraft && this.router.mode === 'idle') {
				const point = this.clientToCm(event.clientX, event.clientY);
				if (point) {
					this.clickDraft.hover = this.snapDrawPoint(point, event.shiftKey, this.clickDraft.points.at(-1));
					this.dirtyOverlay = true;
					this.requestRender();
				}
			}
			if (this.router.mode === 'idle' && !this.gesture && !this.clickDraft) {
				this.updateHoverObject(event.clientX, event.clientY);
			}
			this.router.handlePointerMove(event);
		}, { signal });
		this.svg.addEventListener('pointerleave', () => {
			// Keep the last hover tint in the source panel so the user can
			// carry the pointer over to read the highlighted statement; only
			// the canvas cursor affordance resets.
			this.svg.classList.remove('is-hover-object');
		}, { signal });
		this.svg.addEventListener('pointerup', event => {
			this.router.handlePointerUp(event);
		}, { signal });
		this.svg.addEventListener('pointercancel', event => {
			this.router.handlePointerCancel(event);
		}, { signal });
		this.svg.addEventListener('lostpointercapture', () => {
			// Safety net: a capture lost outside up/cancel must not leave a
			// half-finished gesture behind.
			if (this.router.mode !== 'idle' && !this.gesture) {
				this.router.cancelActive();
			}
		}, { signal });
		this.svg.addEventListener('wheel', event => {
			event.preventDefault();
			const rect = this.svg.getBoundingClientRect();
			const focus = {
				x: this.viewBox.x + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * this.viewBox.w,
				y: this.viewBox.y + ((event.clientY - rect.top) / Math.max(rect.height, 1)) * this.viewBox.h,
			};
			const intensity = event.ctrlKey ? 0.01 : 0.002;
			const factor = Math.exp(-event.deltaY * intensity);
			this.viewBox = zoomViewBox(this.viewBox, factor, focus);
			this.dirtyView = true;
			this.requestRender();
		}, { signal, passive: false });
		this.svg.addEventListener('dblclick', event => {
			event.preventDefault();
			if (this.clickDraft) {
				this.commitClickDraft(false);
				return;
			}
			const point = this.clientToCm(event.clientX, event.clientY);
			if (!point) {
				return;
			}
			const hit = hitTestScene(this.geometries, point, this.hitToleranceCm('mouse'));
			if (hit && hit.object.type === 'node') {
				const object = hit.object;
				const isMath = /^\s*\$.*\$\s*$/.test(object.text);
				this.setSelection([object.id]);
				this.openTextInput(
					applyToPoint(
						this.scene.pictures[object.pictureIndex].transform,
						object.at.resolved,
					),
					isMath,
					object,
				);
			}
		}, { signal });
	}

	private isTextEntryTarget(target: EventTarget | null): boolean {
		if (!target || !(target instanceof this.doc.defaultView!.HTMLElement)) {
			return false;
		}
		const tag = target.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
	}

	private attachKeyboard(): void {
		this.root.addEventListener('keydown', event => {
			if (this.isTextEntryTarget(event.target)) {
				return;
			}
			const meta = event.metaKey || event.ctrlKey;
			const key = event.key;

			if (meta && (key === 'z' || key === 'Z')) {
				event.preventDefault();
				if (event.shiftKey) {
					this.host.redo();
				} else {
					this.host.undo();
				}
				return;
			}
			if (meta && (key === 'd' || key === 'D')) {
				event.preventDefault();
				this.duplicateSelection();
				return;
			}
			if (meta && (key === 'c' || key === 'C')) {
				event.preventDefault();
				this.copySelection();
				return;
			}
			if (meta && (key === 'v' || key === 'V')) {
				event.preventDefault();
				this.pasteClipboard();
				return;
			}
			// Before the meta bail-out: on macOS "delete" is Cmd+Backspace for
			// many users, and plain Backspace/Delete must keep working too.
			if (key === 'Delete' || key === 'Backspace') {
				event.preventDefault();
				this.deleteSelection();
				return;
			}
			if (meta) {
				return;
			}

			if (key === 'Escape') {
				event.preventDefault();
				if (this.shapeMenuOpen) {
					this.toggleShapeMenu(false);
				} else if (this.textInputOverlay) {
					this.closeTextInput(false);
				} else if (this.clickDraft) {
					this.cancelClickDraft();
				} else if (this.router.mode !== 'idle') {
					this.router.cancelActive();
					this.toolCancel();
				} else if (this.selection.size) {
					this.setSelection([]);
				}
				return;
			}
			if (key === 'Enter' && this.clickDraft) {
				event.preventDefault();
				this.commitClickDraft(false);
				return;
			}
			if ((key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')
				&& this.selection.size) {
				event.preventDefault();
				const step = event.shiftKey ? 1 : 0.1;
				const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
				const dy = key === 'ArrowDown' ? -step : key === 'ArrowUp' ? step : 0;
				const patches: SourcePatch[] = [];
				for (const geometry of this.selectedGeometries()) {
					if (geometry.object.type === 'locked') {
						continue;
					}
					const picture = this.scene.pictures[geometry.object.pictureIndex];
					const inverse = invertTransform(picture.transform);
					const delta = inverse ? applyLinear(inverse, { x: dx, y: dy }) : { x: dx, y: dy };
					patches.push(...translateObjectPatches(geometry.object, delta.x, delta.y));
				}
				this.commitPatches(patches);
				return;
			}
			const tool = KEY_TO_TOOL[key.toLowerCase()];
			if (tool && !event.altKey) {
				event.preventDefault();
				this.setTool(tool);
			}
		}, { signal: this.ac.signal });
	}

	/* ---------------------------------------------------------------------- */
	/* panels                                                                  */
	/* ---------------------------------------------------------------------- */

	togglePanel(panel: 'props' | 'source' | 'objects', force?: boolean): void {
		const target = panel === 'props' ? this.propsPanel
			: panel === 'objects' ? this.objectsPanel
				: this.sourcePanel;
		const toggle = this.root.querySelector<HTMLButtonElement>(`.luatikz-ve-${panel}-toggle`);
		const open = force ?? target.classList.contains('luatikz-ve-hidden');
		target.classList.toggle('luatikz-ve-hidden', !open);
		toggle?.setAttribute('aria-pressed', String(open));
		toggle?.classList.toggle('is-active', open);
		if (panel === 'source' && open) {
			this.sourceTextarea.value = this.scene.source;
			this.lastHighlightKey = '';
			this.renderSourceHighlight();
		}
		if (panel === 'objects' && open) {
			this.refreshObjectsPanel();
		}
	}

	get sourcePanelOpen(): boolean {
		return !this.sourcePanel.classList.contains('luatikz-ve-hidden');
	}

	get propsPanelOpen(): boolean {
		return !this.propsPanel.classList.contains('luatikz-ve-hidden');
	}

	get objectsPanelOpen(): boolean {
		return !this.objectsPanel.classList.contains('luatikz-ve-hidden');
	}

	/* ---------------------------------------------------------------------- */
	/* objects panel                                                           */
	/* ---------------------------------------------------------------------- */

	private objectLabel(text: string): string {
		const flat = text.replace(/\s+/g, ' ').trim();
		return flat.length > 34 ? `${flat.slice(0, 34)}…` : flat;
	}

	refreshObjectsPanel(): void {
		if (!this.objectsList || !this.objectsPanelOpen) {
			return;
		}
		this.objectsList.textContent = '';
		for (const object of this.scene.objects) {
			this.appendObjectRow(object);
		}
		for (const hidden of scanHiddenObjects(this.scene.source)) {
			this.appendHiddenRow(hidden);
		}
		if (!this.objectsList.childElementCount) {
			this.el('div', 'luatikz-ve-objects-empty', this.objectsList).textContent = 'Nothing drawn yet.';
		}
	}

	private appendObjectRow(object: SceneObject): void {
		const row = this.el('div', 'luatikz-ve-object-row', this.objectsList);
		if (this.selection.has(object.id)) {
			row.classList.add('is-selected');
		}
		const visible = this.el('input', 'luatikz-ve-object-visible', row);
		visible.type = 'checkbox';
		visible.checked = true;
		visible.setAttribute('aria-label', 'Visible — untick to hide');
		visible.addEventListener('change', () => this.hideObject(object), { signal: this.ac.signal });
		const label = this.el('button', 'luatikz-ve-object-label', row);
		label.type = 'button';
		label.textContent = this.objectLabel(
			this.scene.source.slice(object.span.from, object.span.to),
		);
		label.title = 'Select this object';
		label.addEventListener('click', () => this.setSelection([object.id]), { signal: this.ac.signal });
		const remove = this.button(row, 'Delete', 'luatikz-ve-object-delete', () => {
			this.selection.delete(object.id);
			this.commitPatches(deleteObjectPatches(this.scene.source, object));
			this.announce('Deleted 1 object.');
		}, { icon: 'delete', title: 'Delete this object' });
		remove.classList.add('luatikz-ve-btn-icon');
	}

	private appendHiddenRow(hidden: HiddenObjectEntry): void {
		const row = this.el('div', 'luatikz-ve-object-row is-hidden', this.objectsList);
		const visible = this.el('input', 'luatikz-ve-object-visible', row);
		visible.type = 'checkbox';
		visible.checked = false;
		visible.setAttribute('aria-label', 'Hidden — tick to show');
		visible.addEventListener('change', () => {
			this.commitPatches([{ oldSpan: { from: hidden.from, to: hidden.to }, replacement: hidden.text }]);
			this.announce('Object visible again.');
		}, { signal: this.ac.signal });
		const label = this.el('span', 'luatikz-ve-object-label is-muted', row);
		label.textContent = this.objectLabel(hidden.text);
		this.button(row, 'Delete', 'luatikz-ve-object-delete', () => {
			let to = hidden.to;
			if (this.scene.source[to] === '\n') {
				to += 1;
			}
			this.commitPatches([{ oldSpan: { from: hidden.from, to }, replacement: '' }]);
			this.announce('Hidden object deleted.');
		}, { icon: 'delete', title: 'Delete this hidden object' });
	}

	/** Comment the statement out with `%~` markers — hidden but preserved. */
	private hideObject(object: SceneObject): void {
		const text = this.scene.source.slice(object.span.from, object.span.to);
		const replacement = text.split('\n').map(line => `%~${line}`).join('\n');
		this.selection.delete(object.id);
		this.commitPatches([{ oldSpan: { ...object.span }, replacement }]);
		this.announce('Object hidden — tick it in the Objects panel to bring it back.');
	}

	private onSourcePanelInput(): void {
		const win = this.doc.defaultView;
		if (!win) {
			return;
		}
		if (this.sourceEditTimer !== null) {
			win.clearTimeout(this.sourceEditTimer);
		}
		this.sourceEditTimer = win.setTimeout(() => {
			this.sourceEditTimer = null;
			this.commitSourcePanel();
		}, 500);
	}

	/** Write the source panel's content back as one minimal diff patch. */
	private commitSourcePanel(): void {
		const next = this.sourceTextarea.value;
		const previous = this.scene.source;
		if (next === previous) {
			return;
		}
		let prefix = 0;
		const maxPrefix = Math.min(previous.length, next.length);
		while (prefix < maxPrefix && previous[prefix] === next[prefix]) {
			prefix++;
		}
		let suffix = 0;
		while (
			suffix < maxPrefix - prefix
			&& previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
		) {
			suffix++;
		}
		const patch: SourcePatch = {
			oldSpan: { from: prefix, to: previous.length - suffix },
			replacement: next.slice(prefix, next.length - suffix),
		};
		this.commitPatches([patch]);
	}

	/**
	 * Repaint the source panel's highlight mirror: syntax colors always, plus
	 * hover/selection tints when the panel text matches the parsed scene
	 * (they are span-based and would land on wrong characters otherwise).
	 */
	private renderSourceHighlight(): void {
		if (!this.sourcePanelOpen) {
			return;
		}
		const value = this.sourceTextarea.value;
		const ranges: HighlightRange[] = [];
		if (value === this.scene.source) {
			for (const id of this.selection) {
				const object = this.scene.objects.find(entry => entry.id === id);
				if (object) {
					ranges.push({ from: object.span.from, to: object.span.to, cls: 'luatikz-tzk-selected' });
				}
			}
			if (this.hoveredObjectId && !this.selection.has(this.hoveredObjectId)) {
				const object = this.scene.objects.find(entry => entry.id === this.hoveredObjectId);
				if (object) {
					ranges.push({ from: object.span.from, to: object.span.to, cls: 'luatikz-tzk-hover' });
				}
			}
		}
		const key = `${value} ${ranges.map(range => `${range.from}:${range.to}:${range.cls}`).join(',')}`;
		if (key === this.lastHighlightKey) {
			return;
		}
		this.lastHighlightKey = key;
		// Rebuild as text nodes and spans — never via markup strings.
		this.sourceHighlightCode.textContent = '';
		for (const segment of buildHighlightSegments(value, ranges)) {
			if (!segment.classes.length) {
				this.sourceHighlightCode.appendChild(this.doc.createTextNode(segment.text));
				continue;
			}
			const span = this.el('span', segment.classes.join(' '), this.sourceHighlightCode);
			span.textContent = segment.text;
		}
		this.sourceHighlightCode.appendChild(this.doc.createTextNode('\n'));
	}

	/** Track the object under an idle pointer and tint its source range. */
	private updateHoverObject(clientX: number, clientY: number): void {
		const point = this.clientToCm(clientX, clientY);
		const hit = point
			? hitTestScene(this.geometries, point, this.hitToleranceCm('mouse'), { includeLocked: true })
				?? containmentHit(this.geometries, point, { includeLocked: true })
			: null;
		const id = hit ? hit.object.id : null;
		if (id === this.hoveredObjectId) {
			return;
		}
		this.hoveredObjectId = id;
		this.svg.classList.toggle('is-hover-object', !!id && this.tool === 'select');
		this.renderSourceHighlight();
		if (id) {
			this.scrollSourceRangeIntoView(id);
		}
	}

	/** Keep the hovered statement visible in the source panel. */
	private scrollSourceRangeIntoView(objectId: string): void {
		if (!this.sourcePanelOpen || this.doc.activeElement === this.sourceTextarea) {
			return;
		}
		const object = this.scene.objects.find(entry => entry.id === objectId);
		if (!object || this.sourceTextarea.value !== this.scene.source) {
			return;
		}
		const area = this.sourceTextarea;
		if (!area.clientHeight) {
			return;
		}
		const line = this.scene.source.slice(0, object.span.from).split('\n').length - 1;
		const win = this.doc.defaultView;
		const lineHeightRaw = win
			? Number.parseFloat(win.getComputedStyle(area).lineHeight)
			: NaN;
		const lineHeight = Number.isFinite(lineHeightRaw) && lineHeightRaw > 0 ? lineHeightRaw : 16;
		const top = line * lineHeight;
		if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - lineHeight * 2) {
			area.scrollTop = Math.max(0, top - area.clientHeight / 2);
			this.sourceHighlightPre.scrollTop = area.scrollTop;
		}
	}

	private renderDiagnostics(compileError?: string, compileLine?: number): void {
		this.sourceDiagnostics.textContent = '';
		for (const diagnostic of this.scene.diagnostics) {
			const row = this.el('div', `luatikz-ve-diagnostic is-${diagnostic.severity}`, this.sourceDiagnostics);
			row.textContent = diagnostic.message;
		}
		if (compileError) {
			const row = this.el('div', 'luatikz-ve-diagnostic is-error', this.sourceDiagnostics);
			row.textContent = compileLine !== undefined
				? `Line ${compileLine}: ${compileError}`
				: compileError;
		}
	}

	announce(message: string): void {
		if (this.statusEl) {
			this.statusEl.textContent = message;
		}
	}

	/* Test hooks ------------------------------------------------------------ */

	get currentScene(): TikzScene {
		return this.scene;
	}

	get currentViewBox(): ViewBox {
		return { ...this.viewBox };
	}

	get gestureRouter(): GestureRouter {
		return this.router;
	}
}
