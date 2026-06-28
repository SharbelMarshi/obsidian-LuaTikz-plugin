import { Editor, MarkdownView } from 'obsidian';
import { appendTikzError } from './diagramView';
import type { TikzRenderer } from './renderer';
import { tidyTikzSource } from './tikzSource';
import type { TikzBlock } from './types';

export function getCurrentTikzBlock(editor: Editor): TikzBlock | null {
	const cursor = editor.getCursor();
	let startLine = -1;

	for (let line = cursor.line; line >= 0; line--) {
		const text = editor.getLine(line).trim();
		if (text.startsWith('```tikz')) {
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

	constructor(
		private readonly getActiveMarkdownView: () => MarkdownView | null,
		private readonly renderer: TikzRenderer,
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
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}

	scheduleUpdate(delay = 800): void {
		if (!this.enabled) {
			return;
		}
		this.clearTimer();
		this.timer = window.setTimeout(() => {
			void this.updateFromActiveEditor();
		}, delay);
	}

	clearTimer(): void {
		if (this.timer) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private hide(): void {
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}

	private containerEl(view: MarkdownView): HTMLElement {
		const activeDocument = view.containerEl.ownerDocument;
		if (this.container && activeDocument.body.contains(this.container)) {
			return this.container;
		}
		this.container = view.containerEl.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview',
		});
		return this.container;
	}

	private showMessage(view: MarkdownView, message: string): void {
		const el = this.containerEl(view);
		el.empty();
		el.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview-message',
			text: message,
		});
	}

	private showImage(view: MarkdownView, dataUrl: string): void {
		const el = this.containerEl(view);
		el.empty();
		const output = el.createDiv({ cls: 'tikzjax-hebrew-local-output' });
		const img = output.createEl('img');
		img.setAttr('src', dataUrl);
		img.setAttr('alt', 'TikZ diagram');
		img.addClass('tikzjax-hebrew-local-image');
	}

	private showError(view: MarkdownView, message: string, details?: string, onRetry?: () => void): void {
		appendTikzError(
			this.containerEl(view),
			message,
			details,
			onRetry,
			'tikzjax-hebrew-local-inline-preview-error',
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
			this.containerEl(view).empty();
		}

		this.showError(view, result.error ?? 'Render failed.', result.rawLog, retry);
	}
}
