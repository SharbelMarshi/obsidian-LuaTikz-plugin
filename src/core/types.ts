import type { Editor } from 'obsidian';
import type { LuaTikzRenderEngine, LuaTikzSettings } from '../settings/settingsModel';
import type { LatexAutofix } from '../latex/latexAutofix';

export interface RenderImageResult {
	ok: boolean;
	dataUrl?: string;
	svgText?: string;
	pngPath?: string;
	html?: string;
	error?: string;
	errorSummary?: string;
	/** Plain-language explanation of the failure, shown under the error title. */
	hint?: string;
	rawLog?: string;
	userLine?: number;
	noteLine?: number;
	lineContent?: string;
	autofix?: LatexAutofix;
	markColumnStart?: number;
	markColumnEnd?: number;
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
	errorSummary?: string;
	/** Plain-language explanation of the failure, shown under the error title. */
	hint?: string;
	rawLog?: string;
	userLine?: number;
	noteLine?: number;
	lineContent?: string;
	autofix?: LatexAutofix;
	markColumnStart?: number;
	markColumnEnd?: number;
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
		errorSummary: result.errorSummary,
		hint: result.hint,
		rawLog: result.rawLog,
		userLine: result.userLine,
		noteLine: result.noteLine,
		lineContent: result.lineContent,
		autofix: result.autofix,
		markColumnStart: result.markColumnStart,
		markColumnEnd: result.markColumnEnd,
		timedOut: result.timedOut,
		engine: result.engine,
	};
}
