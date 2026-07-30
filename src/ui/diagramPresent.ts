import { Menu } from 'obsidian';
import type { LuaTikzSettings } from '../settings/settingsModel';
import type { RenderImageResult } from '../core/types';
import type { PreparedTikzSource } from '../core/tikzSource';
import { applyDiagramAlign } from '../utils/diagramAlign';
import { applyDarkPresentationClass } from '../utils/darkMode';
import { applyRtlToContainer } from '../utils/rtl';
import { exportDiagram, type DiagramExportFormat, type ExportableDiagram } from './exportDiagram';

export interface PresentErrorOptions {
	source?: string;
	noteLine?: number;
	blockLine?: number;
	onJumpToLine?: (noteLine: number) => void;
	onRetry?: () => void;
	extraCls?: string;
	/** Plain-language explanation shown between the title and the buttons. */
	hint?: string;
}

export interface PresentDiagramOptions {
	isDarkTheme?: boolean;
}

const EXPORT_FORMATS: { format: DiagramExportFormat; label: string; icon: string }[] = [
	{ format: 'svg', label: 'SVG', icon: 'file-code' },
	{ format: 'png', label: 'PNG', icon: 'image' },
];

/**
 * "Export" primary button (SVG) plus a caret that opens the format menu.
 * Rendered as one visual unit so the caret reads as part of the button.
 */
function appendExportControl(
	toolbar: HTMLElement,
	diagram: ExportableDiagram,
	activeDocument: Document,
): void {
	const group = toolbar.createDiv({ cls: 'luatikz-export-split' });

	const run = (format: DiagramExportFormat) => {
		void exportDiagram(diagram, format, activeDocument);
	};

	const defaultFormat: DiagramExportFormat = diagram.svgText ? 'svg' : 'png';

	const exportButton = group.createEl('button', {
		text: 'Export',
		cls: 'tikzjax-hebrew-local-toolbar-button luatikz-soft-button luatikz-export-main',
	});
	exportButton.setAttr('aria-label', `Export as ${defaultFormat.toUpperCase()}`);
	exportButton.addEventListener('click', () => run(defaultFormat));

	const caret = group.createEl('button', {
		text: '▾',
		cls: 'tikzjax-hebrew-local-toolbar-button luatikz-soft-button luatikz-export-caret',
	});
	caret.setAttr('aria-label', 'Choose export format');
	caret.addEventListener('click', (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		const menu = new Menu();
		for (const { format, label, icon } of EXPORT_FORMATS) {
			menu.addItem(item => item
				.setTitle(label)
				.setIcon(icon)
				.onClick(() => run(format)));
		}
		menu.showAtMouseEvent(event);
	});
}

export function appendTikzError(
	parent: HTMLElement,
	message: string,
	details?: string,
	options: PresentErrorOptions = {},
): void {
	const {
		onRetry,
		extraCls,
		source,
		noteLine,
		blockLine,
		onJumpToLine,
		hint,
	} = options;

	const displayLine = blockLine ?? noteLine;

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

	if (hint) {
		errorEl.createDiv({
			cls: 'tikzjax-hebrew-local-error-hint',
			text: hint,
		});
	}

	const buttonRow = errorEl.createDiv({
		cls: 'tikzjax-hebrew-local-error-button-row',
	});

	if (noteLine !== undefined && onJumpToLine) {
		const jumpButton = buttonRow.createEl('button', {
			text: displayLine !== undefined ? `Go to line ${displayLine}` : 'Go to error line',
			cls: 'tikzjax-hebrew-local-error-button luatikz-soft-button luatikz-jump-line-button',
		});
		jumpButton.addEventListener('click', () => {
			onJumpToLine(noteLine);
		});
	}

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

export function presentTikzFailure(
	el: HTMLElement,
	result: RenderImageResult,
	options: PresentErrorOptions = {},
): void {
	el.empty();
	appendTikzError(
		el,
		result.error ?? 'Render failed.',
		result.rawLog,
		{
			...options,
			noteLine: result.noteLine ?? options.noteLine,
			blockLine: result.userLine ?? options.blockLine,
			hint: result.hint ?? options.hint,
		},
	);
}

export function presentTikzDiagram(
	el: HTMLElement,
	prepared: PreparedTikzSource,
	result: RenderImageResult,
	settings: LuaTikzSettings,
	options: PresentDiagramOptions = {},
): void {
	const { dataUrl, svgText } = result;
	if (!result.ok || !dataUrl) {
		return;
	}

	const isDarkTheme = options.isDarkTheme ?? false;
	const { renderSource, diagramAlign } = prepared;

	el.empty();
	const block = el.createDiv({ cls: 'tikzjax-hebrew-local-block luatikz-output-card' });
	applyRtlToContainer(block, renderSource);

	const toolbar = block.createDiv({ cls: 'tikzjax-hebrew-local-toolbar' });

	appendExportControl(toolbar, { svgText, dataUrl }, el.ownerDocument);

	const container = block.createDiv({ cls: 'tikzjax-hebrew-local-output' });
	applyRtlToContainer(container, renderSource);
	applyDiagramAlign(container, diagramAlign);
	applyDarkPresentationClass(container, settings.darkModeStyle, isDarkTheme);

	if (svgText && settings.renderEngine === 'tikzjax') {
		const svgHost = container.createDiv({ cls: 'luatikz-tikzjax-host' });
		applyDarkPresentationClass(svgHost, settings.darkModeStyle, isDarkTheme);
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgText, 'image/svg+xml');
		const svgEl = doc.documentElement;
		if (svgEl.instanceOf(SVGSVGElement)) {
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
