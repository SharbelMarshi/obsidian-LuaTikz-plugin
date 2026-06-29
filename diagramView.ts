import { Notice } from 'obsidian';
import type { LuaTikzSettings } from './settingsModel';
import type { RenderImageResult } from './types';
import { writeClipboardText } from './utils/clipboard';
import { applyRtlToContainer } from './utils/rtl';

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
	source?: string,
	settings?: LuaTikzSettings,
): void {
	const cls = extraCls
		? `tikzjax-hebrew-local-error luatikz-error-card ${extraCls}`
		: 'tikzjax-hebrew-local-error luatikz-error-card';

	const errorEl = parent.createDiv({ cls });
	errorEl.createDiv({
		cls: 'tikzjax-hebrew-local-error-title',
		text: message,
	});

	if (source) {
		applyRtlToContainer(errorEl, source);
	}

	if (!details && !onRetry) {
		return;
	}

	const buttonRow = errorEl.createDiv({
		cls: 'tikzjax-hebrew-local-error-button-row',
	});

	if (onRetry) {
		const retryButton = buttonRow.createEl('button', {
			text: 'Retry',
			cls: 'tikzjax-hebrew-local-error-button luatikz-soft-button',
		});
		retryButton.addEventListener('click', onRetry);
	}

	if (!details) {
		return;
	}

	const copyButton = buttonRow.createEl('button', {
		text: 'Copy error',
		cls: 'tikzjax-hebrew-local-error-button luatikz-soft-button',
	});

	copyButton.addEventListener('click', () => {
		if (!settings) {
			return;
		}
		void writeClipboardText(details, settings).then((ok) => {
			if (ok) {
				new Notice('Error copied.');
			}
		});
	});

	const toggleButton = buttonRow.createEl('button', {
		text: 'Show log',
		cls: 'tikzjax-hebrew-local-error-button luatikz-soft-button',
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
	source?: string,
	settings?: LuaTikzSettings,
): void {
	el.empty();
	appendTikzError(el, message, details, onRetry, undefined, source, settings);
}

export function renderTikzDiagram(
	el: HTMLElement,
	result: RenderImageResult,
	source: string,
	settings: LuaTikzSettings,
): void {
	const { dataUrl, svgText } = result;
	if (!result.ok || !dataUrl) {
		return;
	}

	el.empty();
	const block = el.createDiv({ cls: 'tikzjax-hebrew-local-block luatikz-output-card' });
	applyRtlToContainer(block, source);

	const toolbar = block.createDiv({ cls: 'tikzjax-hebrew-local-toolbar' });

	const exportButton = toolbar.createEl('button', {
		text: 'Export SVG',
		cls: 'tikzjax-hebrew-local-toolbar-button luatikz-soft-button',
	});
	exportButton.addEventListener('click', () => {
		if (svgText) {
			downloadSvg(svgText, el.ownerDocument);
			new Notice('SVG exported.');
		}
	});

	if (svgText) {
		const copyButton = toolbar.createEl('button', {
			text: 'Copy SVG',
			cls: 'tikzjax-hebrew-local-toolbar-button luatikz-soft-button',
		});
		copyButton.addEventListener('click', () => {
			void writeClipboardText(svgText, settings).then((ok) => {
				if (ok) {
					new Notice('SVG copied.');
				}
			});
		});
	}

	const container = block.createDiv({ cls: 'tikzjax-hebrew-local-output' });
	applyRtlToContainer(container, source);

	if (svgText && settings.renderEngine === 'tikzjax') {
		const svgHost = container.createDiv({ cls: 'luatikz-tikzjax-host' });
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgText, 'image/svg+xml');
		const svgEl = doc.documentElement;
		if (svgEl instanceof SVGSVGElement) {
			svgHost.appendChild(svgEl);
		} else {
			svgHost.setText('Invalid SVG from TikZJax renderer.');
		}
		return;
	}

	const img = container.createEl('img');
	img.setAttr('src', dataUrl);
	img.setAttr('alt', 'TikZ diagram');
	img.addClass('tikzjax-hebrew-local-image');
}
