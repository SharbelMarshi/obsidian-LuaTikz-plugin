import { App, Editor, MarkdownView, Notice, type EditorPosition } from 'obsidian';
import { isolateHistory } from '@codemirror/commands';
import { presentTikzFailure } from '../ui/diagramPresent';
import type { TikzRenderer } from '../render';
import type { LuaTikzSettings } from '../settings/settingsModel';
import { prepareTikzBlock, renderPreparedTikz, buildErrorHandlers } from '../core/tikzPipeline';
import type { TikzBlock } from '../core/types';
import { applyDiagramAlign, type DiagramAlign } from '../utils/diagramAlign';
import { applyDarkPresentationClass } from '../utils/darkMode';
import { clearTikzErrorHighlight } from './tikzErrorHighlight';
import { clearTikzHoverHighlight, showTikzHoverHighlight } from './tikzHoverHighlight';
import { showTikzErrorHighlightFromResult } from './editorNavigation';
import { applyRtlToContainer } from '../utils/rtl';
import { formatTikzCoordinate, clientPointToTikzCoordinate, applyShiftConstraint, INCOMPLETE_DRAW_LINE_RE, parseLastNumericCoordinate, tikzCoordinateToClient, parseBBoxAttribute, ptToCm } from '../utils/coordinatePick';
import {
	buildTikzGeometryMap,
	findStatementAt,
	geometryFitsPicture,
	type TikzGeometryMap,
} from '../latex/tikzStatementGeometry';
import { isMobileApp } from '../utils/platform';
import { VisualTikzEditor, type VisualEditorHost } from '../visual/visualEditor';
import { bodyOffsetToPosition } from '../visual/sourcePatches';
import type { FloatingPreviewMode, SourcePatch } from '../visual/sceneTypes';

const RENDER_DEBOUNCE_MS = 200;
/** Pointer slack, in screen px, for deciding what the pointer is over. */
const HOVER_TOLERANCE_PX = 10;
const MIN_PREVIEW_WIDTH = 160;
const MIN_PREVIEW_HEIGHT = 120;
const DEFAULT_PREVIEW_WIDTH = 520;
const DEFAULT_PREVIEW_HEIGHT = 360;

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

type PreviewBoxCss = {
	left?: string;
	top?: string;
	right?: string;
	width?: string;
	height?: string;
};

function applyPreviewBoxCss(container: HTMLElement, props: PreviewBoxCss): void {
	container.addClass('luatikz-inline-preview-sized');
	container.setCssProps({
		...(props.left !== undefined ? { '--luatikz-preview-left': props.left } : {}),
		...(props.top !== undefined ? { '--luatikz-preview-top': props.top } : {}),
		...(props.right !== undefined ? { '--luatikz-preview-right': props.right } : {}),
		...(props.width !== undefined ? { '--luatikz-preview-width': props.width } : {}),
		...(props.height !== undefined ? { '--luatikz-preview-height': props.height } : {}),
	});
}

/** HOVER_TOLERANCE_PX expressed in TikZ cm at the preview's current zoom. */
function hoverToleranceCm(svgEl: SVGSVGElement, clientX: number, clientY: number): number {
	const origin = clientPointToTikzCoordinate(svgEl, clientX, clientY);
	const offset = clientPointToTikzCoordinate(svgEl, clientX + HOVER_TOLERANCE_PX, clientY);
	if (!origin || !offset) {
		return 0.2;
	}
	return Math.max(0.05, Math.abs(offset.x - origin.x));
}

export function getCurrentTikzBlock(editor: Editor): TikzBlock | null {
	const cursor = editor.getCursor();
	let startLine = -1;

	for (let line = cursor.line; line >= 0; line--) {
		const text = editor.getLine(line).trim();
		if (text.startsWith('```tikz') || text.startsWith('```luatikz')) {
			startLine = line;
			break;
		}
		if (text === '```') {
			return null;
		}
	}

	if (startLine === -1) {
		return null;
	}

	let endLine = -1;
	for (let line = startLine + 1; line < editor.lineCount(); line++) {
		if (editor.getLine(line).trim() === '```') {
			endLine = line;
			break;
		}
	}

	if (endLine === -1 || cursor.line <= startLine || cursor.line >= endLine) {
		return null;
	}

	return {
		source: editor.getRange(
			{ line: startLine + 1, ch: 0 },
			{ line: endLine, ch: 0 },
		),
		startLine,
		endLine,
	};
}

function revalidateTikzBlock(editor: Editor, block: TikzBlock): TikzBlock | null {
	if (block.startLine < 0 || block.endLine >= editor.lineCount()) {
		return null;
	}
	const open = editor.getLine(block.startLine).trim();
	if (!open.startsWith('```tikz') && !open.startsWith('```luatikz')) {
		return null;
	}
	if (editor.getLine(block.endLine).trim() !== '```') {
		return null;
	}
	return {
		startLine: block.startLine,
		endLine: block.endLine,
		source: editor.getRange(
			{ line: block.startLine + 1, ch: 0 },
			{ line: block.endLine, ch: 0 },
		),
	};
}

function isCursorInsideBlock(editor: Editor, block: TikzBlock): boolean {
	const cursor = editor.getCursor();
	return cursor.line > block.startLine && cursor.line < block.endLine;
}

/** Current block when cursor is inside; otherwise reuse pin only during transient focus loss. */
export function resolveTikzBlock(
	editor: Editor,
	pinned: TikzBlock | null,
	allowPinnedFallback = false,
): TikzBlock | null {
	const current = getCurrentTikzBlock(editor);
	if (current) {
		return current;
	}
	if (!pinned || !allowPinnedFallback) {
		return null;
	}
	if (!isCursorInsideBlock(editor, pinned)) {
		return null;
	}
	return revalidateTikzBlock(editor, pinned);
}

export class InlinePreviewManager {
	enabled = false;
	/** 'preview' is the compact floating preview; 'edit' the expanded editor. */
	mode: FloatingPreviewMode = 'preview';
	private container: HTMLElement | null = null;
	private timer: number | null = null;
	private lastGoodDataUrl: string | null = null;
	private lastGoodSvgText: string | null = null;
	private lastRenderSource: string | null = null;
	private pinnedBlock: TikzBlock | null = null;
	private pinnedFilePath: string | null = null;
	private savedInsertCursor: EditorPosition | null = null;
	private previewInteractionActive = false;
	private renderToken = 0;
	private previewWidth = DEFAULT_PREVIEW_WIDTH;
	private previewHeight = DEFAULT_PREVIEW_HEIGHT;
	private resizeListenersAttached = false;
	private geometryMapSource: string | null = null;
	private geometryMap: TikzGeometryMap | null = null;
	private hoverFrame: number | null = null;
	private visualEditor: VisualTikzEditor | null = null;
	private editButton: HTMLElement | null = null;

	constructor(
		private readonly getActiveMarkdownView: () => MarkdownView | null,
		private readonly renderer: TikzRenderer,
		private readonly getSettings: () => LuaTikzSettings,
		private readonly isDarkTheme: () => boolean,
		private readonly app: App,
	) {}

	enable(initialDelayMs = 0): void {
		this.enabled = true;
		this.scheduleUpdate(initialDelayMs);
	}

	disable(): void {
		this.exitEditMode({ skipRerender: true });
		this.clearHoverHighlight();
		this.enabled = false;
		this.lastGoodDataUrl = null;
		this.lastGoodSvgText = null;
		this.lastRenderSource = null;
		this.pinnedBlock = null;
		this.pinnedFilePath = null;
		this.savedInsertCursor = null;
		this.previewInteractionActive = false;
		this.clearTimer();
		this.hide();
	}

	private clearHoverHighlight(): void {
		if (this.hoverFrame !== null) {
			window.cancelAnimationFrame(this.hoverFrame);
			this.hoverFrame = null;
		}
		const view = this.getViewForPreview();
		if (view) {
			clearTikzHoverHighlight(view.editor);
		}
	}

	scheduleUpdate(renderDelay = RENDER_DEBOUNCE_MS): void {
		if (!this.enabled) {
			return;
		}

		this.syncVisibility();

		if (!this.isInTikzBlock()) {
			this.clearTimer();
			return;
		}

		this.clearTimer();
		this.timer = window.setTimeout(() => {
			void this.updateFromActiveEditor();
		}, renderDelay);
	}

	/** Force a fresh render after Obsidian light/dark mode changes. */
	refreshForThemeChange(): void {
		if (!this.enabled) {
			return;
		}
		this.lastGoodDataUrl = null;
		this.lastGoodSvgText = null;
		this.lastRenderSource = null;
		this.scheduleUpdate(0);
	}

	syncVisibility(): void {
		if (!this.enabled) {
			return;
		}

		const view = this.getViewForPreview();
		if (!view) {
			if (this.pinnedBlock && this.container && this.isTransientSession()) {
				return;
			}
			this.hide();
			this.clearPin();
			return;
		}

		if (this.mode === 'edit') {
			// The visual editor owns the container body; nothing to redraw here.
			return;
		}

		const block = this.resolveBlock(view);
		if (!block) {
			this.hide();
			this.clearPin();
			return;
		}

		const prepared = prepareTikzBlock(block.source);
		if (!prepared.renderSource.trim()) {
			this.showMessage(view, 'Nothing to render.');
			return;
		}

		if (prepared.renderSource === this.lastRenderSource && this.lastGoodDataUrl) {
			this.showOutput(view, prepared.diagramAlign);
			return;
		}

		if (!this.lastGoodDataUrl && !this.container) {
			this.showMessage(view, 'Rendering…');
		}
	}

	clearTimer(): void {
		if (this.timer) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private isInTikzBlock(): boolean {
		const view = this.getViewForPreview();
		if (view) {
			return !!this.resolveBlock(view);
		}
		return !!this.pinnedBlock && this.isTransientSession();
	}

	private isTransientSession(): boolean {
		// Edit mode keeps the block pinned no matter where focus goes: the
		// user is interacting with the canvas, not the Markdown cursor.
		return this.mode === 'edit' || this.previewInteractionActive || this.isOverlayOpen();
	}

	private isOverlayOpen(): boolean {
		return !!activeDocument.querySelector('.prompt, .suggestion-container, .modal-container');
	}

	private isCursorInsidePinnedBlock(editor: Editor): boolean {
		if (!this.pinnedBlock) {
			return false;
		}
		return isCursorInsideBlock(editor, this.pinnedBlock);
	}

	private getViewForPreview(): MarkdownView | null {
		const active = this.getActiveMarkdownView();
		if (active) {
			return active;
		}
		if (!this.pinnedFilePath) {
			return null;
		}
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const { view } = leaf;
			if (view instanceof MarkdownView && view.file?.path === this.pinnedFilePath) {
				return view;
			}
		}
		return null;
	}

	private clearPin(): void {
		this.pinnedBlock = null;
		this.pinnedFilePath = null;
		this.savedInsertCursor = null;
		this.lastRenderSource = null;
		this.previewInteractionActive = false;
	}

	private resolveBlock(view: MarkdownView): TikzBlock | null {
		const current = getCurrentTikzBlock(view.editor);
		if (current) {
			this.pinnedBlock = current;
			this.pinnedFilePath = view.file?.path ?? null;
			this.savedInsertCursor = view.editor.getCursor();
			return current;
		}
		if (!this.pinnedBlock || view.file?.path !== this.pinnedFilePath) {
			return null;
		}

		const cursorInside = this.isCursorInsidePinnedBlock(view.editor);
		const transient = this.isTransientSession();
		if (!cursorInside && !transient) {
			return null;
		}

		const revived = revalidateTikzBlock(view.editor, this.pinnedBlock);
		if (!revived) {
			this.clearPin();
			return null;
		}
		this.pinnedBlock = revived;
		return revived;
	}

	private hide(): void {
		if (this.container) {
			this.exitEditMode({ skipRerender: true });
			this.clearHoverHighlight();
			this.container.remove();
			this.container = null;
			this.editButton = null;
			this.resizeListenersAttached = false;
		}
	}

	private applyDefaultSize(container: HTMLElement): void {
		applyPreviewBoxCss(container, {
			width: `${this.previewWidth}px`,
			height: `${this.previewHeight}px`,
		});
	}

	private attachResizeHandles(container: HTMLElement): void {
		if (this.resizeListenersAttached) {
			return;
		}

		for (const direction of RESIZE_DIRECTIONS) {
			const handle = container.createDiv({
				cls: `tikzjax-inline-resize-handle tikzjax-inline-resize-${direction}`,
			});
			handle.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.beginResize(event, direction, container);
			});
		}

		this.resizeListenersAttached = true;
	}

	private beginResize(
		event: MouseEvent,
		direction: ResizeDirection,
		container: HTMLElement,
	): void {
		const parent = container.offsetParent as HTMLElement | null;
		if (!parent) {
			return;
		}

		const parentRect = parent.getBoundingClientRect();
		const rect = container.getBoundingClientRect();
		const startLeft = rect.left - parentRect.left;
		const startTop = rect.top - parentRect.top;

		applyPreviewBoxCss(container, {
			right: 'auto',
			left: `${startLeft}px`,
			top: `${startTop}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});

		const start = {
			x: event.clientX,
			y: event.clientY,
			left: startLeft,
			top: startTop,
			width: rect.width,
			height: rect.height,
		};

		const onMove = (moveEvent: MouseEvent) => {
			const dx = moveEvent.clientX - start.x;
			const dy = moveEvent.clientY - start.y;

			let left = start.left;
			let top = start.top;
			let width = start.width;
			let height = start.height;

			if (direction.includes('e')) {
				width = start.width + dx;
			}
			if (direction.includes('w')) {
				width = start.width - dx;
				left = start.left + dx;
			}
			if (direction.includes('s')) {
				height = start.height + dy;
			}
			if (direction.includes('n')) {
				height = start.height - dy;
				top = start.top + dy;
			}

			width = Math.max(MIN_PREVIEW_WIDTH, width);
			height = Math.max(MIN_PREVIEW_HEIGHT, height);

			if (direction.includes('w')) {
				left = start.left + start.width - width;
			}
			if (direction.includes('n')) {
				top = start.top + start.height - height;
			}

			applyPreviewBoxCss(container, {
				left: `${left}px`,
				top: `${top}px`,
				width: `${width}px`,
				height: `${height}px`,
			});

			this.previewWidth = width;
			this.previewHeight = height;
		};

		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	private ensureContainer(view: MarkdownView): HTMLElement {
		const ownerDoc = view.containerEl.ownerDocument;
		if (this.container && ownerDoc.body.contains(this.container)) {
			return this.container;
		}

		this.container = view.containerEl.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview luatikz-glass-card',
		});
		this.applyDefaultSize(this.container);
		this.attachResizeHandles(this.container);
		this.attachPreviewInteractionHandlers(this.container);
		this.attachEditButton(this.container);
		this.container.createDiv({ cls: 'tikzjax-hebrew-local-inline-preview-body' });
		return this.container;
	}

	/** Unobtrusive Edit toggle shown on the compact preview. */
	private attachEditButton(container: HTMLElement): void {
		const button = container.createEl('button', {
			cls: 'luatikz-preview-edit-btn',
			text: 'Edit',
		});
		button.setAttr('type', 'button');
		button.setAttr('aria-label', 'Edit diagram visually');
		button.setAttr('title', 'Edit diagram visually');
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.enterEditMode();
		});
		this.editButton = button;
	}

	private attachPreviewInteractionHandlers(container: HTMLElement): void {
		container.addEventListener('mousedown', (event) => {
			if (this.mode === 'edit' || !this.isPickSurfaceEvent(event)) {
				return;
			}
			this.previewInteractionActive = true;
			const view = this.getViewForPreview();
			if (view) {
				this.prepareCoordinatePick(view);
			}
			const onUp = () => {
				this.previewInteractionActive = false;
				window.removeEventListener('mouseup', onUp);
				this.syncVisibility();
			};
			window.addEventListener('mouseup', onUp);
		});
	}

	private isPickSurfaceEvent(event: Event): boolean {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return false;
		}
		return !!target.closest('.luatikz-pick-surface, .luatikz-inline-svg-host');
	}

	/** Append trailing semicolon on incomplete \\draw lines; keep cursor for coordinate insert. */
	private prepareCoordinatePick(view: MarkdownView): void {
		const editor = view.editor;
		const cursor = this.savedInsertCursor ?? editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		if (!INCOMPLETE_DRAW_LINE_RE.test(lineText.trim())) {
			this.savedInsertCursor = cursor;
			editor.setCursor(cursor);
			return;
		}
		const lineEnd = { line: cursor.line, ch: lineText.length };
		editor.replaceRange(';', lineEnd, lineEnd);
		this.savedInsertCursor = cursor;
		editor.setCursor(cursor);
	}

	private showOutput(view: MarkdownView, diagramAlign: DiagramAlign = 'center'): void {
		const useSvg = !isMobileApp && !!this.lastGoodSvgText;

		if (useSvg) {
			this.showSvg(view, this.lastGoodSvgText!, diagramAlign);
			return;
		}
		if (this.lastGoodDataUrl) {
			this.showImage(view, this.lastGoodDataUrl, diagramAlign);
		}
	}

	private previewBody(view: MarkdownView): HTMLElement {
		const shell = this.ensureContainer(view);
		const body = shell.querySelector('.tikzjax-hebrew-local-inline-preview-body');
		if (body?.instanceOf(HTMLElement)) {
			return body;
		}

		return shell.createDiv({ cls: 'tikzjax-hebrew-local-inline-preview-body' });
	}

	private showMessage(view: MarkdownView, message: string): void {
		const body = this.previewBody(view);
		body.empty();
		const messageEl = body.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview-message',
			text: message,
		});
		applyRtlToContainer(messageEl, message);
	}

	private showImage(view: MarkdownView, dataUrl: string, diagramAlign: DiagramAlign = 'center'): void {
		const settings = this.getSettings();
		const body = this.previewBody(view);
		body.empty();
		body.removeClass('luatikz-pick-mode');
		const output = body.createDiv({
			cls: 'tikzjax-hebrew-local-output tikzjax-hebrew-local-inline-preview-output',
		});
		applyDiagramAlign(output, diagramAlign);
		applyDarkPresentationClass(output, settings.darkModeStyle, this.isDarkTheme());
		const img = output.createEl('img');
		img.setAttr('src', dataUrl);
		img.setAttr('alt', 'TikZ diagram');
		img.addClass('tikzjax-hebrew-local-image tikzjax-hebrew-local-inline-preview-image');
	}

	private showSvg(view: MarkdownView, svgText: string, diagramAlign: DiagramAlign = 'center'): void {
		const settings = this.getSettings();
		const body = this.previewBody(view);
		body.empty();
		body.addClass('luatikz-pick-mode');
		const output = body.createDiv({
			cls: 'tikzjax-hebrew-local-output tikzjax-hebrew-local-inline-preview-output luatikz-pick-surface',
		});
		applyDiagramAlign(output, diagramAlign);
		applyDarkPresentationClass(output, settings.darkModeStyle, this.isDarkTheme());

		const parser = new DOMParser();
		const doc = parser.parseFromString(svgText, 'image/svg+xml');
		const svgEl = doc.documentElement;
		if (!svgEl.instanceOf(SVGSVGElement)) {
			output.setText('Invalid SVG.');
			return;
		}

		svgEl.setAttribute('width', '100%');
		svgEl.setAttribute('height', '100%');
		svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

		const host = output.createDiv({ cls: 'luatikz-inline-svg-host luatikz-pick-mode' });
		host.appendChild(svgEl);
		this.attachHoverHighlight(host, svgEl);

		const handlePick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();

			const picked = clientPointToTikzCoordinate(svgEl, event.clientX, event.clientY);
			if (!picked) {
				return;
			}

			const block = this.resolveBlock(view);
			const insertAt = this.savedInsertCursor ?? view.editor.getCursor();

			let coord = picked;
			if (event.shiftKey && block) {
				const textBefore = view.editor.getRange(
					{ line: block.startLine + 1, ch: 0 },
					insertAt,
				);
				const anchor = parseLastNumericCoordinate(textBefore);
				const anchorClient = anchor ? tikzCoordinateToClient(svgEl, anchor) : null;
				if (anchor && anchorClient) {
					coord = applyShiftConstraint(
						picked,
						anchor,
						{ x: event.clientX, y: event.clientY },
						anchorClient,
					);
				}
			}

			const formatted = formatTikzCoordinate(coord);

			view.editor.replaceRange(formatted, insertAt, insertAt);
			const afterInsert = {
				line: insertAt.line,
				ch: insertAt.ch + formatted.length,
			};
			this.savedInsertCursor = afterInsert;
			view.editor.setCursor(afterInsert);
			view.editor.focus();

			const suffix = event.shiftKey ? ' (axis constrained)' : '';
			new Notice(`Inserted ${formatted}${suffix} — approximate TikZ cm`);
		};

		output.addEventListener('mousedown', (event) => {
			event.preventDefault();
			this.prepareCoordinatePick(view);
			if (this.savedInsertCursor) {
				view.editor.setCursor(this.savedInsertCursor);
			}
		});

		output.addEventListener('click', handlePick);
	}

	private getGeometryMap(blockSource: string): TikzGeometryMap {
		if (this.geometryMapSource !== blockSource || !this.geometryMap) {
			this.geometryMap = buildTikzGeometryMap(blockSource);
			this.geometryMapSource = blockSource;
		}
		return this.geometryMap;
	}

	/** Highlight the statement the pointer is over while it moves across the preview. */
	private attachHoverHighlight(host: HTMLElement, svgEl: SVGSVGElement): void {
		host.addEventListener('mousemove', (event: MouseEvent) => {
			const { clientX, clientY } = event;
			if (this.hoverFrame !== null) {
				return;
			}
			this.hoverFrame = window.requestAnimationFrame(() => {
				this.hoverFrame = null;
				this.updateHoverHighlight(svgEl, clientX, clientY);
			});
		});

		host.addEventListener('mouseleave', () => {
			this.clearHoverHighlight();
		});
	}

	private updateHoverHighlight(svgEl: SVGSVGElement, clientX: number, clientY: number): void {
		const view = this.getViewForPreview();
		if (!view) {
			return;
		}

		const block = this.resolveBlock(view);
		const point = block ? clientPointToTikzCoordinate(svgEl, clientX, clientY) : null;
		if (!block || !point) {
			clearTikzHoverHighlight(view.editor);
			return;
		}

		const map = this.getGeometryMap(block.source);
		if (!map.statements.length) {
			clearTikzHoverHighlight(view.editor);
			return;
		}

		const pictureBBox = parseBBoxAttribute(svgEl);
		if (pictureBBox && !geometryFitsPicture(map, {
			minX: ptToCm(pictureBBox.minX),
			minY: ptToCm(pictureBBox.minY),
			maxX: ptToCm(pictureBBox.maxX),
			maxY: ptToCm(pictureBBox.maxY),
		})) {
			clearTikzHoverHighlight(view.editor);
			return;
		}

		const statement = findStatementAt(
			map,
			point,
			hoverToleranceCm(svgEl, clientX, clientY),
		);
		if (!statement) {
			clearTikzHoverHighlight(view.editor);
			return;
		}

		// Block source line 0 is the editor line after the opening fence, and
		// CodeMirror line numbers are 1-based.
		const firstBodyLine = block.startLine + 2;
		showTikzHoverHighlight(view.editor, {
			fromLine: firstBodyLine + statement.startLine,
			toLine: firstBodyLine + statement.endLine,
		});
	}

	private showError(
		view: MarkdownView,
		result: Parameters<typeof presentTikzFailure>[1],
		onRetry?: () => void,
	): void {
		const sourcePath = view.file?.path;
		const errorHandlers = buildErrorHandlers(this.app, sourcePath, result);
		presentTikzFailure(this.previewBody(view), result, {
			onRetry,
			extraCls: 'tikzjax-hebrew-local-inline-preview-error',
			...errorHandlers,
		});
		showTikzErrorHighlightFromResult(this.app, sourcePath, result);
	}

	/* ---------------------------------------------------------------------- */
	/* edit mode                                                               */
	/* ---------------------------------------------------------------------- */

	/** Expand the floating preview into the full visual editor. */
	enterEditMode(): void {
		if (this.mode === 'edit' || !this.enabled) {
			return;
		}
		const view = this.getViewForPreview();
		if (!view) {
			return;
		}
		const block = this.resolveBlock(view);
		if (!block) {
			new Notice('Place the cursor inside a tikz fence to edit it visually.');
			return;
		}

		this.clearHoverHighlight();
		this.mode = 'edit';
		const container = this.ensureContainer(view);
		const compactRect = container.getBoundingClientRect();
		container.addClass('luatikz-edit-mode');
		this.editButton?.addClass('luatikz-ve-hidden');

		const body = this.previewBody(view);
		body.empty();
		body.removeClass('luatikz-pick-mode');

		this.visualEditor = new VisualTikzEditor(this.buildVisualHost(), body, block.source);
		applyDarkPresentationClass(
			this.visualEditor.root,
			this.getSettings().darkModeStyle,
			this.isDarkTheme(),
		);
		if (this.lastGoodDataUrl && this.lastRenderSource) {
			this.visualEditor.setCompileResult(
				{ ok: true, dataUrl: this.lastGoodDataUrl, svgText: this.lastGoodSvgText ?? undefined },
				false,
			);
		}
		this.animateModeTransition(container, compactRect);
		// Kick a compile so the authoritative card fills in.
		this.scheduleUpdate(0);
	}

	/** Collapse back to the compact preview. */
	exitEditMode(options: { skipRerender?: boolean } = {}): void {
		if (this.mode !== 'edit') {
			return;
		}
		this.mode = 'preview';
		const fullRect = this.container?.getBoundingClientRect() ?? null;
		this.visualEditor?.destroy();
		this.visualEditor = null;
		if (this.container) {
			this.container.removeClass('luatikz-edit-mode');
			this.editButton?.removeClass('luatikz-ve-hidden');
			if (fullRect && !options.skipRerender) {
				this.animateModeTransition(this.container, fullRect);
			}
		}
		if (!options.skipRerender) {
			this.lastRenderSource = null;
			this.scheduleUpdate(0);
		}
	}

	/**
	 * FLIP transition between the compact preview box and the expanded
	 * editor: the container visually grows out of (or shrinks back into) the
	 * floating preview, making it read as the same window changing size.
	 * Skipped when the platform lacks the Web Animations API or the user
	 * prefers reduced motion.
	 */
	private animateModeTransition(container: HTMLElement, fromRect: DOMRect): void {
		const win = container.ownerDocument.defaultView;
		if (!win || typeof container.animate !== 'function') {
			return;
		}
		if (win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
			return;
		}
		const toRect = container.getBoundingClientRect();
		if (!toRect.width || !toRect.height || !fromRect.width || !fromRect.height) {
			return;
		}
		const dx = fromRect.left - toRect.left;
		const dy = fromRect.top - toRect.top;
		const sx = fromRect.width / toRect.width;
		const sy = fromRect.height / toRect.height;
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1
			&& Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
			return;
		}
		try {
			container.animate(
				[
					{
						transformOrigin: 'top left',
						transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
					},
					{ transformOrigin: 'top left', transform: 'none' },
				],
				{ duration: 240, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
			);
		} catch {
			// Older WebViews: the mode switch simply happens without motion.
		}
	}

	/** Recompute the pinned block's end fence after our own body edits. */
	private refreshPinnedBlockAfterEdit(editor: Editor): void {
		if (!this.pinnedBlock) {
			return;
		}
		const startLine = this.pinnedBlock.startLine;
		if (startLine < 0 || startLine >= editor.lineCount()) {
			return;
		}
		const open = editor.getLine(startLine).trim();
		if (!open.startsWith('```tikz') && !open.startsWith('```luatikz')) {
			return;
		}
		for (let line = startLine + 1; line < editor.lineCount(); line++) {
			if (editor.getLine(line).trim() === '```') {
				this.pinnedBlock = {
					startLine,
					endLine: line,
					source: editor.getRange(
						{ line: startLine + 1, ch: 0 },
						{ line, ch: 0 },
					),
				};
				return;
			}
		}
	}

	private currentEditBlock(): TikzBlock | null {
		const view = this.getViewForPreview();
		if (!view || !this.pinnedBlock) {
			return null;
		}
		const revived = revalidateTikzBlock(view.editor, this.pinnedBlock);
		if (revived) {
			this.pinnedBlock = revived;
		}
		return revived;
	}

	private buildVisualHost(): VisualEditorHost {
		return {
			getBlock: () => this.currentEditBlock(),
			applyPatches: (expectedBody, patches) => this.applyVisualPatches(expectedBody, patches),
			requestCompile: () => this.scheduleUpdate(),
			requestExit: () => this.exitEditMode(),
			undo: () => {
				const view = this.getViewForPreview();
				if (!view) {
					return;
				}
				view.editor.undo();
				this.refreshPinnedBlockAfterEdit(view.editor);
				const block = this.currentEditBlock();
				if (block) {
					this.visualEditor?.syncFromBlock(block);
				}
				this.scheduleUpdate();
			},
			redo: () => {
				const view = this.getViewForPreview();
				if (!view) {
					return;
				}
				view.editor.redo();
				this.refreshPinnedBlockAfterEdit(view.editor);
				const block = this.currentEditBlock();
				if (block) {
					this.visualEditor?.syncFromBlock(block);
				}
				this.scheduleUpdate();
			},
		};
	}

	/**
	 * Write visual-editor patches into the fence as one history-isolated
	 * transaction. Refuses to write when the fence body no longer matches what
	 * the patches were computed against.
	 */
	private applyVisualPatches(expectedBody: string, patches: SourcePatch[]): boolean {
		const view = this.getViewForPreview();
		if (!view || !this.pinnedBlock || !patches.length) {
			return false;
		}
		const editor = view.editor;
		const block = revalidateTikzBlock(editor, this.pinnedBlock);
		if (!block || block.source !== expectedBody) {
			return false;
		}
		this.pinnedBlock = block;

		const sorted = [...patches].sort((a, b) => a.oldSpan.from - b.oldSpan.from);
		const bodyBaseLine = block.startLine + 1;
		const toPos = (offset: number): EditorPosition => {
			const pos = bodyOffsetToPosition(expectedBody, offset);
			return { line: bodyBaseLine + pos.line, ch: pos.ch };
		};

		const applied = this.dispatchIsolated(editor, block, sorted)
			|| this.dispatchViaTransaction(editor, sorted, toPos);
		if (!applied) {
			return false;
		}

		this.refreshPinnedBlockAfterEdit(editor);
		return true;
	}

	/** Preferred path: CodeMirror dispatch with an isolated history step. */
	private dispatchIsolated(
		editor: Editor,
		block: TikzBlock,
		patches: SourcePatch[],
	): boolean {
		const cm = (editor as Editor & { cm?: import('@codemirror/view').EditorView }).cm;
		if (!cm?.state || typeof cm.dispatch !== 'function') {
			return false;
		}
		try {
			const bodyDocLine = block.startLine + 2;
			if (bodyDocLine > cm.state.doc.lines) {
				return false;
			}
			const base = cm.state.doc.line(bodyDocLine).from;
			// Verify the doc really contains the body where we think it is.
			const end = base + block.source.length;
			if (end > cm.state.doc.length
				|| cm.state.doc.sliceString(base, end) !== block.source) {
				return false;
			}
			cm.dispatch({
				changes: patches.map(patch => ({
					from: base + patch.oldSpan.from,
					to: base + patch.oldSpan.to,
					insert: patch.replacement,
				})),
				annotations: isolateHistory.of('full'),
			});
			return true;
		} catch {
			return false;
		}
	}

	/** Fallback path: Obsidian's editor transaction API. */
	private dispatchViaTransaction(
		editor: Editor,
		patches: SourcePatch[],
		toPos: (offset: number) => EditorPosition,
	): boolean {
		try {
			editor.transaction({
				changes: patches.map(patch => ({
					from: toPos(patch.oldSpan.from),
					to: toPos(patch.oldSpan.to),
					text: patch.replacement,
				})),
			});
			return true;
		} catch {
			return false;
		}
	}

	async updateFromActiveEditor(): Promise<void> {
		if (!this.enabled) {
			return;
		}

		const view = this.getViewForPreview();
		if (!view) {
			if (this.pinnedBlock && this.container && this.isTransientSession()) {
				return;
			}
			this.hide();
			return;
		}

		const block = this.resolveBlock(view);
		if (!block) {
			if (this.mode === 'edit') {
				// The fence disappeared entirely (file switch, fence deleted).
				this.exitEditMode({ skipRerender: true });
			}
			this.hide();
			return;
		}

		if (this.mode === 'edit') {
			this.visualEditor?.syncFromBlock(block);
		}

		const prepared = prepareTikzBlock(block.source);
		if (!prepared.renderSource.trim()) {
			if (this.mode === 'edit') {
				this.visualEditor?.setCompileResult(null, false);
				return;
			}
			this.showMessage(view, 'Nothing to render.');
			return;
		}

		if (prepared.renderSource === this.lastRenderSource && this.lastGoodDataUrl) {
			if (this.mode === 'edit') {
				this.visualEditor?.setCompileResult(
					{ ok: true, dataUrl: this.lastGoodDataUrl, svgText: this.lastGoodSvgText ?? undefined },
					false,
				);
				return;
			}
			this.showOutput(view, prepared.diagramAlign);
			return;
		}

		const token = ++this.renderToken;
		if (this.mode === 'edit') {
			this.visualEditor?.setCompileResult(null, true);
		} else if (!this.lastGoodDataUrl) {
			this.showMessage(view, 'Rendering…');
		}

		const result = await renderPreparedTikz(this.renderer, prepared, {
			block,
			editor: view.editor,
		});

		if (token !== this.renderToken) {
			return;
		}

		if (result.ok && result.dataUrl) {
			this.lastRenderSource = prepared.renderSource;
			this.lastGoodDataUrl = result.dataUrl;
			this.lastGoodSvgText = result.svgText ?? null;
			clearTikzErrorHighlight(view.editor);
			if (this.mode === 'edit') {
				this.visualEditor?.setCompileResult(result, false);
				return;
			}
			this.showOutput(view, prepared.diagramAlign);
			return;
		}

		if (this.mode === 'edit') {
			// Keep the editable scene and the last-good compiled output; surface
			// the error text and highlight the offending source line.
			this.visualEditor?.setCompileResult(result, false);
			const sourcePath = view.file?.path;
			showTikzErrorHighlightFromResult(this.app, sourcePath, result);
			return;
		}

		const retry = result.timedOut
			? () => {
				this.lastRenderSource = null;
				void this.updateFromActiveEditor();
			}
			: undefined;

		if (this.lastGoodDataUrl || this.lastGoodSvgText) {
			this.showOutput(view, prepared.diagramAlign);
			return;
		}

		this.showError(view, result, retry);
	}
}
