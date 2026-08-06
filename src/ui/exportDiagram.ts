import { Notice } from 'obsidian';
import { encodeUtf8Base64 } from '../utils/base64Utils';

export type DiagramExportFormat = 'svg' | 'png';

export interface ExportableDiagram {
	/** SVG markup when the render produced vector output. */
	svgText?: string;
	/** Whatever the renderer handed back — `data:image/png` when output format is PNG. */
	dataUrl?: string;
}

/** SVG user units are TeX pt; CSS px are 1/96 in, hence 96/72. */
const PT_TO_PX = 96 / 72;
/** Extra oversampling so exported bitmaps stay crisp when scaled up. */
const PNG_SCALE = 2;
const PNG_MAX_EDGE = 4000;

function triggerDownload(blob: Blob, filename: string, activeDocument: Document): void {
	const url = URL.createObjectURL(blob);
	// Created on the caller's document, not the global one, so downloads still
	// work from a popout window.
	const link = activeDocument.body.createEl('a', {
		cls: 'tikzjax-hebrew-local-download-link',
		href: url,
		attr: { download: filename },
	});
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

export function downloadSvg(
	svgText: string,
	activeDocument: Document,
	filename = 'tikz-diagram.svg',
): void {
	triggerDownload(
		new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }),
		filename,
		activeDocument,
	);
}

function parseSvgUserSize(svgText: string): { width: number; height: number } | null {
	const viewBox = svgText.match(/viewBox\s*=\s*"([^"]+)"/i);
	if (viewBox) {
		const parts = viewBox[1].trim().split(/[\s,]+/).map(Number.parseFloat);
		if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
			return { width: parts[2], height: parts[3] };
		}
	}

	const width = svgText.match(/\bwidth\s*=\s*"([\d.]+)/i);
	const height = svgText.match(/\bheight\s*=\s*"([\d.]+)/i);
	if (!width || !height) {
		return null;
	}
	const w = Number.parseFloat(width[1]);
	const h = Number.parseFloat(height[1]);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
		return null;
	}
	return { width: w, height: h };
}

function pngCanvasSize(userWidth: number, userHeight: number): { width: number; height: number } {
	let width = Math.max(1, Math.round(userWidth * PT_TO_PX * PNG_SCALE));
	let height = Math.max(1, Math.round(userHeight * PT_TO_PX * PNG_SCALE));
	const longest = Math.max(width, height);
	if (longest > PNG_MAX_EDGE) {
		const shrink = PNG_MAX_EDGE / longest;
		width = Math.max(1, Math.round(width * shrink));
		height = Math.max(1, Math.round(height * shrink));
	}
	return { width, height };
}

function loadSvgImage(svgText: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Could not rasterize the diagram SVG.'));
		image.src = `data:image/svg+xml;base64,${encodeUtf8Base64(svgText)}`;
	});
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(blob => {
			if (blob) {
				resolve(blob);
				return;
			}
			reject(new Error('Could not encode the diagram as PNG.'));
		}, 'image/png');
	});
}

/** Rasterize SVG markup to a transparent-background PNG blob. */
export async function svgToPngBlob(
	svgText: string,
	activeDocument: Document,
): Promise<Blob> {
	const size = parseSvgUserSize(svgText);
	if (!size) {
		throw new Error('Diagram SVG has no usable size.');
	}

	const image = await loadSvgImage(svgText);
	const { width, height } = pngCanvasSize(size.width, size.height);
	// Created through the element-level createEl helper on the *active*
	// document's body (the global helper would build it in the main document
	// and break export from a popout window), then detached: the canvas is
	// only an off-screen rasterization surface.
	const canvas = activeDocument.body.createEl('canvas');
	canvas.remove();
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas 2D context is unavailable.');
	}
	context.drawImage(image, 0, 0, width, height);

	return canvasToPngBlob(canvas);
}

function dataUrlToBlob(dataUrl: string): Blob | null {
	const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
	if (!match) {
		return null;
	}
	const binary = atob(match[2]);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new Blob([bytes], { type: match[1] });
}

/** Download the diagram in `format`, reporting the outcome via a Notice. */
export async function exportDiagram(
	diagram: ExportableDiagram,
	format: DiagramExportFormat,
	activeDocument: Document,
	basename = 'tikz-diagram',
): Promise<void> {
	const { svgText, dataUrl } = diagram;

	if (format === 'svg') {
		if (!svgText) {
			new Notice('This diagram was rendered as a bitmap — only PNG export is available.');
			return;
		}
		downloadSvg(svgText, activeDocument, `${basename}.svg`);
		new Notice('SVG exported.');
		return;
	}

	if (!svgText) {
		const blob = dataUrl?.startsWith('data:image/png') ? dataUrlToBlob(dataUrl) : null;
		if (!blob) {
			new Notice('Nothing to export as PNG.');
			return;
		}
		triggerDownload(blob, `${basename}.png`, activeDocument);
		new Notice('PNG exported.');
		return;
	}

	try {
		const blob = await svgToPngBlob(svgText, activeDocument);
		triggerDownload(blob, `${basename}.png`, activeDocument);
		new Notice('PNG exported.');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`PNG export failed: ${message}`);
	}
}
