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
	hitTestHandles,
	hitTestScene,
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
import { buildHighlightHtml, type HighlightRange } from './tikzHighlight';
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
	coordinateTokenPatch,
	deleteObjectPatches,
	duplicateObjectPatches,
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
import type {
	EditorToolId,
	ObjectStyle,
	SceneNodeObject,
	SceneObject,
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
	{ tool: 'rect', label: 'Rectangle', icon: 'rect', key: 'R' },
	{ tool: 'rounded-rect', label: 'Rounded rectangle', icon: 'rounded-rect' },
	{ tool: 'circle', label: 'Circle', icon: 'circle', key: 'C' },
	{ tool: 'ellipse', label: 'Ellipse', icon: 'ellipse', key: 'E' },
	{ tool: 'arc', label: 'Arc', icon: 'arc' },
	{ tool: 'grid-path', label: 'Grid path', icon: 'grid-path' },
	{ tool: 'diamond', label: 'Diamond', icon: 'diamond' },
	{ tool: 'polygon', label: 'Polygon', icon: 'polygon' },
	{ tool: 'star', label: 'Star', icon: 'star' },
	{ tool: 'text', label: 'Text node', icon: 'text', key: 'T' },
	{ tool: 'math', label: 'Math node', icon: 'math' },
];

const KEY_TO_TOOL: Record<string, EditorToolId> = {
	v: 'select', h: 'pan', l: 'line', a: 'arrow', p: 'path', b: 'bezier',
	f: 'freehand', r: 'rect', c: 'circle', e: 'ellipse', t: 'text',
};

type DragShapeTool =
	| 'line' | 'arrow' | 'rect' | 'rounded-rect' | 'circle' | 'ellipse'
	| 'arc' | 'grid-path' | 'diamond' | 'polygon' | 'star';

type ActiveGesture =
	| { kind: 'shape'; tool: DragShapeTool; start: TikzCoordinate; current: TikzCoordinate; shift: boolean }
	| { kind: 'freehand'; draft: FreehandDraft }
	| { kind: 'pen-click' }
	| {
		kind: 'move';
		start: TikzCoordinate;
		delta: { dx: number; dy: number };
		objectIds: string[];
		moved: boolean;
	}
	| {
		kind: 'handle';
		objectId: string;
		handle: ObjectHandle;
		current: TikzCoordinate;
		shift: boolean;
	}
	| {
		kind: 'marquee';
		start: TikzCoordinate;
		current: TikzCoordinate;
		additive: boolean;
		/** Locked object under the pointer at drag start; selected on a tap. */
		lockedCandidate: string | null;
	}
	| null;

const CLICK_DRAG_THRESHOLD_CM = 0.06;
const GRID_STEPS = [0.1, 0.25, 0.5, 1, 2];

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
	private propsPanel!: HTMLElement;
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
		const win = this.doc.defaultView as (Window & typeof globalThis) | null;
		this.ac = new (win?.AbortController ?? AbortController)();
		this.scene = parseTikzScene(initialBody);
		this.viewBox = viewBoxFromCmBounds(DEFAULT_VIEWPORT_CM);
		this.root = this.buildDom(container);
		this.setTool('select');
		this.togglePanel('props', false);
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

	private propsControls: {
		stroke?: HTMLSelectElement;
		fill?: HTMLSelectElement;
		width?: HTMLSelectElement;
		dash?: HTMLSelectElement;
		arrows?: HTMLSelectElement;
		opacity?: HTMLInputElement;
		rounded?: HTMLInputElement;
		nodeText?: HTMLInputElement;
		sides?: HTMLInputElement;
		smoothing?: HTMLInputElement;
	} = {};

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

	private buildPropsPanel(): void {
		const panel = this.propsPanel;
		this.el('div', 'luatikz-ve-props-title', panel).textContent = 'Style';

		const colorValues: Array<[string, string]> = [
			['', 'Default'], ['black', 'Black'], ['red', 'Red'], ['blue', 'Blue'],
			['green', 'Green'], ['orange', 'Orange'], ['purple', 'Purple'],
			['teal', 'Teal'], ['gray', 'Gray'], ['brown', 'Brown'],
		];
		this.propsControls.stroke = this.propsSelect(panel, 'Stroke', colorValues,
			value => this.applyStyle({ strokeColor: value || null }));
		this.propsControls.fill = this.propsSelect(panel, 'Fill', [['', 'None'], ...colorValues.slice(1)],
			value => this.applyStyle({ fillColor: value || null }));
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
		if (!built) {
			this.underlayText = null;
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
		renderSelectionOverlay(context, this.layerOverlay, selected, handles);
		this.renderDraft(context);
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
				case 'polygon':
				case 'star': {
					const radius = Math.hypot(current.x - start.x, current.y - start.y);
					if (radius > 1e-3) {
						const points = tool === 'polygon'
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
		this.requestRender();
	}

	private updatePropsFromSelection(): void {
		const selected = this.selectedGeometries();
		const first = selected[0]?.object;
		const controls = this.propsControls;
		if (!first || first.type === 'locked') {
			if (controls.nodeText) {
				controls.nodeText.value = '';
			}
			return;
		}
		const style = parseOptionStyle(first.options);
		if (controls.stroke) {
			controls.stroke.value = style.strokeColor && [...controls.stroke.options].some(o => o.value === style.strokeColor)
				? style.strokeColor
				: '';
		}
		if (controls.fill) {
			controls.fill.value = style.fillColor && [...controls.fill.options].some(o => o.value === style.fillColor)
				? style.fillColor
				: '';
		}
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
			controls.nodeText.value = first.type === 'node' ? first.text : '';
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
		// Locked statements are never deleted — the editor must not destroy
		// source it cannot rebuild.
		const selected = this.selectedGeometries()
			.filter(geometry => geometry.object.type !== 'locked');
		if (!selected.length) {
			if (this.selection.size) {
				this.announce('Locked objects are source-only; edit them in the source panel.');
			}
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
		this.commitPatches([{ oldSpan: object.textSpan, replacement: text }]);
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
		if (this.tool === 'text' || this.tool === 'math') {
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
			};
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
		const hit = hitTestScene(this.geometries, point, tolerance)
			?? hitTestScene(this.geometries, point, tolerance, { includeLocked: true });
		if (hit && hit.object.type !== 'locked') {
			const id = hit.object.id;
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
			};
			return;
		}

		// Empty canvas or a locked ghost: always allow a box selection. A
		// plain tap (no drag) on the ghost selects it and explains the lock.
		this.gesture = {
			kind: 'marquee',
			start: point,
			current: point,
			additive: !!pointer.shiftKey,
			lockedCandidate: hit ? hit.object.id : null,
		};
		if (!pointer.shiftKey && !hit) {
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
			case 'freehand':
				appendFreehandPoint(gesture.draft, point, pointer.pressure ?? 0.5);
				break;
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

	/** Clone the object with one dragged token updated (display-only). */
	private previewObjectWithHandle(
		object: SceneObject,
		handle: ObjectHandle,
		target: TikzCoordinate,
	): SceneObject | null {
		const picture = this.scene.pictures[object.pictureIndex];
		const preScale = {
			x: target.x / (picture.scale.x || 1),
			y: target.y / (picture.scale.y || 1),
		};
		if (object.type === 'node') {
			return {
				...object,
				at: { ...object.at, resolved: preScale },
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
				return { ...element, coord: { ...element.coord, resolved: preScale } };
			}
			if (element.kind === 'curveTo' && handle.token === 'c1') {
				return { ...element, c1: { ...element.c1, resolved: preScale } };
			}
			if (element.kind === 'curveTo' && handle.token === 'c2' && element.c2) {
				return { ...element, c2: { ...element.c2, resolved: preScale } };
			}
			if (element.kind === 'circle' && handle.token === 'radius') {
				const geometry = this.geometries.find(entry => entry.object.id === object.id);
				const center = geometry?.handles
					.filter(h => h.kind === 'vertex' && h.elementIndex < handle.elementIndex)
					.pop();
				if (!center) {
					return element;
				}
				const scaleAvg = (Math.abs(picture.scale.x) + Math.abs(picture.scale.y)) / 2 || 1;
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
				const statement = generateFreehandStatement(
					gesture.draft,
					this.freehandSmoothingPx,
					this.pxToCm(1),
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
				if (gesture.moved
					&& (Math.abs(gesture.delta.dx) > 1e-6 || Math.abs(gesture.delta.dy) > 1e-6)) {
					const patches: SourcePatch[] = [];
					for (const id of gesture.objectIds) {
						const geometry = this.geometries.find(entry => entry.object.id === id);
						if (!geometry) {
							continue;
						}
						const picture = this.scene.pictures[geometry.object.pictureIndex];
						patches.push(...translateObjectPatches(
							geometry.object,
							gesture.delta.dx / (picture.scale.x || 1),
							gesture.delta.dy / (picture.scale.y || 1),
						));
					}
					this.commitPatches(patches);
				}
				break;
			}
			case 'handle':
				this.commitHandleDrag(gesture);
				break;
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
				} else if (gesture.lockedCandidate) {
					const locked = this.geometries.find(geometry =>
						geometry.object.id === gesture.lockedCandidate);
					this.setSelection([gesture.lockedCandidate]);
					if (locked && locked.object.type === 'locked') {
						this.announce(`Locked object: ${locked.object.reason}. It stays in the source.`);
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
		if (gesture?.kind === 'move') {
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
		const style = this.styleDefaults;
		let statement: string | null = null;
		switch (tool) {
			case 'line':
				statement = generateLine(start, end, { ...style, arrows: style.arrows ?? '' });
				break;
			case 'arrow':
				statement = generateLine(start, end, { ...style, arrows: style.arrows || '->' });
				break;
			case 'rect':
				statement = generateRectangle(start, end, style);
				break;
			case 'rounded-rect':
				statement = generateRectangle(start, end, { ...style, roundedCorners: true });
				break;
			case 'circle':
				statement = generateCircle(start, size, style);
				break;
			case 'ellipse': {
				const rx = Math.abs(end.x - start.x);
				const ry = Math.abs(end.y - start.y);
				if (rx > 1e-3 && ry > 1e-3) {
					statement = generateEllipse(start, rx, ry, style);
				}
				break;
			}
			case 'arc': {
				const arc = this.arcFromChord(start, end);
				if (arc) {
					statement = generateArc(start, arc.startAngle, arc.endAngle, arc.radius, style);
				}
				break;
			}
			case 'grid-path':
				statement = generateGridPath(start, end, Math.max(this.gridStepCm, 0.25), style);
				break;
			case 'diamond': {
				const rx = Math.abs(end.x - start.x);
				const ry = Math.abs(end.y - start.y);
				if (rx > 1e-3 && ry > 1e-3) {
					statement = generatePolyline(diamondPoints(start, rx, ry), true, style);
				}
				break;
			}
			case 'polygon':
				statement = generatePolyline(polygonPoints(start, size, this.polygonSides), true, style);
				break;
			case 'star':
				statement = generatePolyline(starPoints(start, size, 0.5, this.starSpikes), true, style);
				break;
		}
		if (statement) {
			this.commitNewStatement(statement);
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
		const preScale = {
			x: gesture.current.x / (picture.scale.x || 1),
			y: gesture.current.y / (picture.scale.y || 1),
		};

		if (object.type === 'node') {
			this.commitPatches([coordinateTokenPatch(object.at, preScale, { x: 0, y: 0 })]);
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
			this.commitPatches([coordinateTokenPatch(element.coord, preScale, base)]);
			return;
		}
		if (element.kind === 'curveTo' && gesture.handle.token === 'c1') {
			this.commitPatches([coordinateTokenPatch(element.c1, preScale, base)]);
			return;
		}
		if (element.kind === 'curveTo' && gesture.handle.token === 'c2' && element.c2) {
			this.commitPatches([coordinateTokenPatch(element.c2, preScale, base)]);
			return;
		}
		if (element.kind === 'circle' && gesture.handle.token === 'radius') {
			// Radius handle sits on the +x rim; new radius = distance to center.
			const centerHandle = geometry.handles
				.filter(handle => handle.kind === 'vertex' && handle.elementIndex < gesture.handle.elementIndex)
				.pop();
			const center = centerHandle?.posCm ?? { x: 0, y: 0 };
			const radius = Math.hypot(gesture.current.x - center.x, gesture.current.y - center.y);
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
		if (draft.tool === 'path') {
			this.commitNewStatement(generatePolyline(draft.points, closed, this.styleDefaults));
		} else {
			const segments = catmullRomToBezier(draft.points);
			this.commitNewStatement(generateCurvePath(
				draft.points,
				segments.map(segment => ({ c1: segment.c1, c2: segment.c2 })),
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
				const body = math || /^\$.*\$$/.test(existing.text) ? `$${value}$` : value;
				this.commitPatches([{ oldSpan: existing.textSpan, replacement: body }]);
			} else {
				this.commitNewStatement(generateNode(at, value, math, this.styleDefaults));
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
					{
						x: object.at.resolved.x * this.scene.pictures[object.pictureIndex].scale.x,
						y: object.at.resolved.y * this.scene.pictures[object.pictureIndex].scale.y,
					},
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
			if (meta) {
				return;
			}

			if (key === 'Escape') {
				event.preventDefault();
				if (this.textInputOverlay) {
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
			if (key === 'Delete' || key === 'Backspace') {
				event.preventDefault();
				this.deleteSelection();
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
					patches.push(...translateObjectPatches(
						geometry.object,
						dx / (picture.scale.x || 1),
						dy / (picture.scale.y || 1),
					));
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

	togglePanel(panel: 'props' | 'source', force?: boolean): void {
		const target = panel === 'props' ? this.propsPanel : this.sourcePanel;
		const toggle = this.root.querySelector<HTMLButtonElement>(
			panel === 'props' ? '.luatikz-ve-props-toggle' : '.luatikz-ve-source-toggle',
		);
		const open = force ?? target.classList.contains('luatikz-ve-hidden');
		target.classList.toggle('luatikz-ve-hidden', !open);
		toggle?.setAttribute('aria-pressed', String(open));
		toggle?.classList.toggle('is-active', open);
		if (panel === 'source' && open) {
			this.sourceTextarea.value = this.scene.source;
			this.lastHighlightKey = '';
			this.renderSourceHighlight();
		}
	}

	get sourcePanelOpen(): boolean {
		return !this.sourcePanel.classList.contains('luatikz-ve-hidden');
	}

	get propsPanelOpen(): boolean {
		return !this.propsPanel.classList.contains('luatikz-ve-hidden');
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
		this.sourceHighlightCode.innerHTML = `${buildHighlightHtml(value, ranges)}\n`;
	}

	/** Track the object under an idle pointer and tint its source range. */
	private updateHoverObject(clientX: number, clientY: number): void {
		const point = this.clientToCm(clientX, clientY);
		const hit = point
			? hitTestScene(this.geometries, point, this.hitToleranceCm('mouse'), { includeLocked: true })
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
