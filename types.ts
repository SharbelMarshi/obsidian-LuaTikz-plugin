import type { Editor } from 'obsidian';

export interface RenderImageResult {
	ok: boolean;
	dataUrl?: string;
	svgText?: string;
	error?: string;
	rawLog?: string;
	userLine?: number;
	noteLine?: number;
	lineContent?: string;
	timedOut?: boolean;
}

export interface TikzBlock {
	source: string;
	startLine: number;
	endLine: number;
}

export interface RenderErrorContext {
	block?: TikzBlock;
	editor?: Editor;
}
