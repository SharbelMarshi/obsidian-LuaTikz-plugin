import type { Editor } from 'obsidian';
import type { LuaTikzRenderEngine, LuaTikzSettings } from './settingsModel';

export interface RenderImageResult {
	ok: boolean;
	dataUrl?: string;
	svgText?: string;
	pngPath?: string;
	html?: string;
	error?: string;
	rawLog?: string;
	userLine?: number;
	noteLine?: number;
	lineContent?: string;
	timedOut?: boolean;
	engine?: LuaTikzRenderEngine;
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

export interface RenderRequest {
	source: string;
	normalizedSource: string;
	settings: LuaTikzSettings;
	containerEl?: HTMLElement;
	errorContext?: RenderErrorContext;
	invertDark?: boolean;
}

export interface RenderResult {
	ok: boolean;
	html?: string;
	svg?: string;
	svgText?: string;
	dataUrl?: string;
	pngPath?: string;
	error?: string;
	rawLog?: string;
	userLine?: number;
	noteLine?: number;
	lineContent?: string;
	timedOut?: boolean;
	engine: LuaTikzRenderEngine;
}

export function renderResultToImageResult(result: RenderResult): RenderImageResult {
	return {
		ok: result.ok,
		dataUrl: result.dataUrl,
		svgText: result.svgText ?? result.svg,
		pngPath: result.pngPath,
		html: result.html,
		error: result.error,
		rawLog: result.rawLog,
		userLine: result.userLine,
		noteLine: result.noteLine,
		lineContent: result.lineContent,
		timedOut: result.timedOut,
		engine: result.engine,
	};
}
