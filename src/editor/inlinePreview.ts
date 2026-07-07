import { App, Editor, MarkdownView, Notice, type EditorPosition } from 'obsidian';
import { presentTikzFailure } from '../ui/diagramPresent';
import type { TikzRenderer } from '../render';
import type { LuaTikzSettings } from '../settings/settingsModel';
import { prepareTikzBlock, renderPreparedTikz, buildErrorHandlers } from '../core/tikzPipeline';
import type { TikzBlock } from '../core/types';
import { applyDiagramAlign, type DiagramAlign } from '../utils/diagramAlign';
import { applyDarkPresentationClass } from '../utils/darkMode';
import { clearTikzErrorHighlight } from './tikzErrorHighlight';
import { showTikzErrorHighlightFromResult } from './editorNavigation';
import { applyRtlToContainer } from '../utils/rtl';
import { formatTikzCoordinate, screenPointToSvgUserSpace, applyShiftConstraint, INCOMPLETE_DRAW_LINE_RE, parseLastNumericCoordinate, tikzCoordinateToClient } from '../utils/coordinatePick';
import { isMobileApp } from '../utils/platform';

const RENDER_DEBOUNCE_MS = 200;
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
	private container: HTMLElement | null = null;
	private timer: number | null = null;
	private lastGoodDataUrl: string | null = null;
	private lastGoodSvgText: string | null = null;
	private lastRenderSource: string | null = null;
	private lastDiagramAlign: DiagramAlign = 'center';
	private pinnedBlock: TikzBlock | null = null;
	private pinnedFilePath: string | null = null;
	private savedInsertCursor: EditorPosition | null = null;
	private previewInteractionActive = false;
	private renderToken = 0;
	private previewWidth = DEFAULT_PREVIEW_WIDTH;
	private previewHeight = DEFAULT_PREVIEW_HEIGHT;
	private resizeListenersAttached = false;

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
		return this.previewInteractionActive || this.isOverlayOpen();
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
			this.container.remove();
			this.container = null;
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
		const activeDocument = view.containerEl.ownerDocument;
		if (this.container && activeDocument.body.contains(this.container)) {
			return this.container;
		}

		this.container = view.containerEl.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview luatikz-glass-card',
		});
		this.applyDefaultSize(this.container);
		this.attachResizeHandles(this.container);
		this.attachPreviewInteractionHandlers(this.container);
		this.container.createDiv({ cls: 'tikzjax-hebrew-local-inline-preview-body' });
		return this.container;
	}

	private attachPreviewInteractionHandlers(container: HTMLElement): void {
		container.addEventListener('mousedown', (event) => {
			if (!this.isPickSurfaceEvent(event)) {
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
		this.lastDiagramAlign = diagramAlign;

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

		const handlePick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();

			const picked = screenPointToSvgUserSpace(svgEl, event.clientX, event.clientY);
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

	private showError(
		view: MarkdownView,
		result: Parameters<typeof presentTikzFailure>[1],
		preparedSource: string,
		onRetry?: () => void,
	): void {
		const sourcePath = view.file?.path;
		const errorHandlers = buildErrorHandlers(this.app, sourcePath, result);
		presentTikzFailure(this.previewBody(view), result, {
			source: preparedSource,
			onRetry,
			extraCls: 'tikzjax-hebrew-local-inline-preview-error',
			...errorHandlers,
		});
		showTikzErrorHighlightFromResult(this.app, sourcePath, result);
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
			this.hide();
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

		const token = ++this.renderToken;
		if (!this.lastGoodDataUrl) {
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
			this.showOutput(view, prepared.diagramAlign);
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

		this.showError(view, result, prepared.renderSource, retry);
	}
}
