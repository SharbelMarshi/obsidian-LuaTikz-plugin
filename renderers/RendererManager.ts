import type { App } from 'obsidian';
import type { LuaTikzSettings } from '../settingsModel';
import type { RenderErrorContext, RenderImageResult, RenderRequest, RenderResult } from '../types';
import { renderResultToImageResult } from '../types';
import { LuaLatexRenderer } from './LuaLatexRenderer';
import { TikzJaxRenderer } from './TikzJaxRenderer';

export class RendererManager {
	private luaLatexRenderer: LuaLatexRenderer;
	private tikzJaxRenderer: TikzJaxRenderer;
	private inFlight = new Map<string, Promise<RenderResult>>();

	constructor(
		app: App,
		pluginId: string,
		private readonly isDarkTheme: () => boolean,
		private getSettings: () => LuaTikzSettings,
	) {
		this.luaLatexRenderer = new LuaLatexRenderer(app, pluginId, isDarkTheme);
		this.tikzJaxRenderer = new TikzJaxRenderer(app, pluginId);
	}

	clearCache(): void {
		this.cache.clear();
		this.luaLatexRenderer.clearCache();
		this.tikzJaxRenderer.clearCache();
		this.inFlight.clear();
	}

	private cache = new Map<string, { result: RenderResult; createdAt: number }>();

	async render(
		source: string,
		errorContext?: RenderErrorContext,
	): Promise<RenderResult> {
		const settings = this.getSettings();
		const normalizedSource = source;
		const invertDark = this.isDarkTheme();
		const cacheKey = `${settings.renderEngine}:${normalizedSource}:${invertDark}:${settings.cacheEnabled}`;

		if (settings.cacheEnabled) {
			const hit = this.cache.get(cacheKey);
			if (hit && Date.now() - hit.createdAt <= 30 * 60 * 1000) {
				return hit.result;
			}
		}

		const pending = this.inFlight.get(cacheKey);
		if (pending !== undefined) {
			return pending;
		}

		const request: RenderRequest = {
			source,
			normalizedSource,
			settings,
			errorContext,
			invertDark,
		};

		const renderPromise = this.dispatch(request).finally(() => {
			this.inFlight.delete(cacheKey);
		});

		this.inFlight.set(cacheKey, renderPromise);
		const result = await renderPromise;

		if (result.ok && settings.cacheEnabled) {
			this.cache.set(cacheKey, { result, createdAt: Date.now() });
		}

		return result;
	}

	async renderToSvg(
		source: string,
		errorContext?: RenderErrorContext,
	): Promise<RenderImageResult> {
		return renderResultToImageResult(await this.render(source, errorContext));
	}

	private dispatch(request: RenderRequest): Promise<RenderResult> {
		if (request.settings.renderEngine === 'tikzjax') {
			return this.tikzJaxRenderer.render(request);
		}
		return this.luaLatexRenderer.render(request);
	}
}

/** Backward-compatible alias */
export { RendererManager as TikzRenderer };
