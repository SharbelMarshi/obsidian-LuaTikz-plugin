import type { App } from 'obsidian';
import type { TikzRenderer } from '../render';
import type { PreparedTikzSource } from './tikzSource';
import { prepareTikzRenderSource } from './tikzSource';
import type { RenderErrorContext, RenderImageResult } from './types';
import { presentTikzDiagram, presentTikzFailure, type PresentErrorOptions } from '../ui/diagramPresent';
import type { LuaTikzSettings } from '../settings/settingsModel';
import { applyDiagramAlign } from '../utils/diagramAlign';
import { jumpToTikzError } from '../editor/editorNavigation';
import { applyRtlToContainer } from '../utils/rtl';
import {
	validateTikzRenderSource,
	validationErrorToRenderResult,
} from '../latex/tikzSourceValidation';

export interface PresentBlockOptions extends PresentErrorOptions {
	isDarkTheme?: boolean;
}

/** Stage 1: normalize source and extract Obsidian-only metadata. */
export function prepareTikzBlock(source: string): PreparedTikzSource {
	return prepareTikzRenderSource(source);
}

/** Stage 2: render prepared TikZ source through the configured engine. */
export async function renderPreparedTikz(
	renderer: TikzRenderer,
	prepared: PreparedTikzSource,
	errorContext?: RenderErrorContext,
): Promise<RenderImageResult> {
	const validationError = validateTikzRenderSource(
		prepared.renderSource,
		errorContext?.block,
		errorContext?.editor,
	);
	if (validationError) {
		return validationErrorToRenderResult(validationError);
	}

	return renderer.renderToSvg(prepared.renderSource, errorContext);
}

export function presentLoadingState(
	el: HTMLElement,
	prepared: PreparedTikzSource,
	rawSource: string,
): HTMLElement {
	el.empty();
	const loading = el.createDiv({
		cls: 'tikzjax-hebrew-local-output luatikz-glass-card',
		text: 'Rendering…',
	});
	applyRtlToContainer(loading, rawSource);
	applyDiagramAlign(loading, prepared.diagramAlign);
	return loading;
}

/** Stage 3: present rendered output or errors in the DOM. */
export function presentTikzBlock(
	el: HTMLElement,
	prepared: PreparedTikzSource,
	result: RenderImageResult,
	settings: LuaTikzSettings,
	options: PresentBlockOptions = {},
): void {
	if (!result.ok || !result.dataUrl) {
		presentTikzFailure(el, result, {
			...options,
			source: options.source ?? prepared.renderSource,
		});
		return;
	}

	presentTikzDiagram(el, prepared, result, settings, {
		isDarkTheme: options.isDarkTheme,
	});
}

export function buildErrorHandlers(
	app: App,
	sourcePath: string | undefined,
	result: RenderImageResult,
): Pick<PresentErrorOptions, 'onJumpToLine'> {
	if (!sourcePath || result.noteLine === undefined) {
		return {};
	}

	const jumpOptions = {
		noteLine: result.noteLine,
		autofix: result.autofix,
		markColumnStart: result.markColumnStart,
		markColumnEnd: result.markColumnEnd,
	};

	return {
		onJumpToLine: () => {
			void jumpToTikzError(app, sourcePath, { ...jumpOptions, focus: true });
		},
	};
}
