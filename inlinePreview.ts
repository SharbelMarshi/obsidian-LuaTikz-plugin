import { Editor, MarkdownView } from 'obsidian';
import { appendTikzError } from './diagramView';
import type { TikzRenderer } from './renderer';
import type { LuaTikzSettings } from './settingsModel';
import { tidyTikzSource } from './tikzSource';
import type { TikzBlock } from './types';
import { applyRtlToContainer } from './utils/rtl';

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

export class InlinePreviewManager {
	enabled = false;
	private container: HTMLElement | null = null;
	private timer: number | null = null;
	private lastGoodDataUrl: string | null = null;
	private lastSource: string | null = null;
	private renderToken = 0;
	private previewWidth = DEFAULT_PREVIEW_WIDTH;
	private previewHeight = DEFAULT_PREVIEW_HEIGHT;
	private resizeListenersAttached = false;

	constructor(
		private readonly getActiveMarkdownView: () => MarkdownView | null,
		private readonly renderer: TikzRenderer,
		private readonly getSettings: () => LuaTikzSettings,
	) {}

	enable(initialDelayMs = 0): void {
		this.enabled = true;
		this.scheduleUpdate(initialDelayMs);
	}

	disable(): void {
		this.enabled = false;
		this.lastGoodDataUrl = null;
		this.lastSource = null;
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

	syncVisibility(): void {
		if (!this.enabled) {
			return;
		}

		const view = this.getActiveMarkdownView();
		const block = view ? getCurrentTikzBlock(view.editor) : null;
		if (!view || !block) {
			this.hide();
			this.lastSource = null;
			return;
		}

		const source = tidyTikzSource(block.source);
		if (!source.trim()) {
			this.showMessage(view, 'Nothing to render.');
			return;
		}

		if (source === this.lastSource && this.lastGoodDataUrl) {
			this.showImage(view, this.lastGoodDataUrl);
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
		const view = this.getActiveMarkdownView();
		return !!view && !!getCurrentTikzBlock(view.editor);
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
		this.container.createDiv({ cls: 'tikzjax-hebrew-local-inline-preview-body' });
		return this.container;
	}

	private previewBody(view: MarkdownView): HTMLElement {
		const shell = this.ensureContainer(view);
		const body = shell.querySelector('.tikzjax-hebrew-local-inline-preview-body');
		if (body instanceof HTMLElement) {
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

	private showImage(view: MarkdownView, dataUrl: string): void {
		const body = this.previewBody(view);
		body.empty();
		const output = body.createDiv({
			cls: 'tikzjax-hebrew-local-output tikzjax-hebrew-local-inline-preview-output',
		});
		const img = output.createEl('img');
		img.setAttr('src', dataUrl);
		img.setAttr('alt', 'TikZ diagram');
		img.addClass('tikzjax-hebrew-local-image tikzjax-hebrew-local-inline-preview-image');
	}

	private showError(
		view: MarkdownView,
		message: string,
		details?: string,
		onRetry?: () => void,
		source?: string,
	): void {
		appendTikzError(
			this.previewBody(view),
			message,
			details,
			onRetry,
			'tikzjax-hebrew-local-inline-preview-error',
			source,
			this.getSettings(),
		);
	}

	async updateFromActiveEditor(): Promise<void> {
		if (!this.enabled) {
			return;
		}

		const view = this.getActiveMarkdownView();
		if (!view) {
			this.hide();
			return;
		}

		const block = getCurrentTikzBlock(view.editor);
		if (!block) {
			this.hide();
			return;
		}

		const source = tidyTikzSource(block.source);
		if (!source.trim()) {
			this.showMessage(view, 'Nothing to render.');
			return;
		}

		if (source === this.lastSource && this.lastGoodDataUrl) {
			this.showImage(view, this.lastGoodDataUrl);
			return;
		}

		const token = ++this.renderToken;
		if (!this.lastGoodDataUrl) {
			this.showMessage(view, 'Rendering…');
		}

		const result = await this.renderer.renderToSvg(source, {
			block,
			editor: view.editor,
		});

		if (token !== this.renderToken) {
			return;
		}

		if (result.ok && result.dataUrl) {
			this.lastSource = source;
			this.lastGoodDataUrl = result.dataUrl;
			this.showImage(view, result.dataUrl);
			return;
		}

		const retry = result.timedOut
			? () => {
				this.lastSource = null;
				void this.updateFromActiveEditor();
			}
			: undefined;

		if (this.lastGoodDataUrl) {
			this.showImage(view, this.lastGoodDataUrl);
		} else {
			this.previewBody(view).empty();
		}

		this.showError(view, result.error ?? 'Render failed.', result.rawLog, retry, source);
	}
}
