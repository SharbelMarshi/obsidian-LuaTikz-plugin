import { Notice } from 'obsidian';
import type { RenderImageResult } from './types';

function downloadSvg(
	svgText: string,
	activeDocument: Document,
	filename = 'tikz-diagram.svg',
): void {
	const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = activeDocument.createElement('a');
	link.href = url;
	link.download = filename;
	link.classList.add('tikzjax-hebrew-local-download-link');
	activeDocument.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

export function appendTikzError(
	parent: HTMLElement,
	message: string,
	details?: string,
	onRetry?: () => void,
	extraCls?: string,
): void {
	const cls = extraCls
		? `tikzjax-hebrew-local-error ${extraCls}`
		: 'tikzjax-hebrew-local-error';

	const errorEl = parent.createDiv({ cls });
	errorEl.createDiv({
		cls: 'tikzjax-hebrew-local-error-title',
		text: message,
	});

	if (!details && !onRetry) {
		return;
	}

	const buttonRow = errorEl.createDiv({
		cls: 'tikzjax-hebrew-local-error-button-row',
	});

	if (onRetry) {
		const retryButton = buttonRow.createEl('button', {
			text: 'Retry',
			cls: 'tikzjax-hebrew-local-error-button',
		});
		retryButton.addEventListener('click', onRetry);
	}

	if (!details) {
		return;
	}

	const copyButton = buttonRow.createEl('button', {
		text: 'Copy error',
		cls: 'tikzjax-hebrew-local-error-button',
	});

	copyButton.addEventListener('click', () => {
		void navigator.clipboard.writeText(details).then(() => {
			new Notice('Error copied.');
		}).catch(() => {
			new Notice('Could not copy error.');
		});
	});

	const toggleButton = buttonRow.createEl('button', {
		text: 'Show log',
		cls: 'tikzjax-hebrew-local-error-button',
	});

	const detailsEl = errorEl.createEl('pre', {
		cls: 'tikzjax-hebrew-local-error-details',
	});

	detailsEl.setText(details);
	detailsEl.addClass('tikzjax-hebrew-local-error-details-hidden');

	toggleButton.addEventListener('click', () => {
		const hidden = detailsEl.hasClass('tikzjax-hebrew-local-error-details-hidden');
		detailsEl.toggleClass('tikzjax-hebrew-local-error-details-hidden', !hidden);
		toggleButton.setText(hidden ? 'Hide log' : 'Show log');
	});
}

export function showTikzError(
	el: HTMLElement,
	message: string,
	details?: string,
	onRetry?: () => void,
): void {
	el.empty();
	appendTikzError(el, message, details, onRetry);
}

export function renderTikzDiagram(el: HTMLElement, result: RenderImageResult): void {
	const { dataUrl, svgText } = result;
	if (!result.ok || !dataUrl || !svgText) {
		return;
	}

	el.empty();
	const block = el.createDiv({ cls: 'tikzjax-hebrew-local-block' });

	const toolbar = block.createDiv({ cls: 'tikzjax-hebrew-local-toolbar' });

	const exportButton = toolbar.createEl('button', {
		text: 'Export SVG',
		cls: 'tikzjax-hebrew-local-toolbar-button',
	});
	exportButton.addEventListener('click', () => {
		downloadSvg(svgText, el.ownerDocument);
		new Notice('SVG exported.');
	});

	const copyButton = toolbar.createEl('button', {
		text: 'Copy SVG',
		cls: 'tikzjax-hebrew-local-toolbar-button',
	});
	copyButton.addEventListener('click', () => {
		void navigator.clipboard.writeText(svgText).then(() => {
			new Notice('SVG copied.');
		}).catch(() => {
			new Notice('Could not copy SVG.');
		});
	});

	const container = block.createDiv({ cls: 'tikzjax-hebrew-local-output' });
	const img = container.createEl('img');
	img.setAttr('src', dataUrl);
	img.setAttr('alt', 'TikZ diagram');
	img.addClass('tikzjax-hebrew-local-image');
}
