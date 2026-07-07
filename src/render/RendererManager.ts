import type { App } from 'obsidian';
import type { LuaTikzSettings } from '../settings/settingsModel';
import type { RenderErrorContext, RenderImageResult, RenderRequest, RenderResult } from '../core/types';
import { renderResultToImageResult } from '../core/types';
import { shouldInvertSvgAtRenderTime } from '../utils/darkMode';
import { buildRenderCacheKey, RenderDiskCache } from '../utils/renderCache';
import { resolveRenderEngine } from '../utils/platform';
import { LuaLatexRenderer } from './LuaLatexRenderer';
import { TikzJaxRenderer } from './TikzJaxRenderer';
import { ARABIC_REQUIRES_LUALATEX_ERROR, resolveTikzJaxDispatch } from '../utils/renderRouting';

export class RendererManager {
	private luaLatexRenderer: LuaLatexRenderer;
	private tikzJaxRenderer: TikzJaxRenderer;
	private diskCache: RenderDiskCache;
	private inFlight = new Map<string, Promise<RenderResult>>();

	constructor(
		app: App,
		pluginId: string,
		private readonly isDarkTheme: () => boolean,
		private getSettings: () => LuaTikzSettings,
	) {
		this.luaLatexRenderer = new LuaLatexRenderer(app, pluginId, isDarkTheme);
		this.tikzJaxRenderer = new TikzJaxRenderer(app, pluginId);
		this.diskCache = new RenderDiskCache(app, pluginId);
	}

	clearCache(): void {
		this.diskCache.clear();
		this.luaLatexRenderer.clearCache();
		this.tikzJaxRenderer.clearCache();
		this.inFlight.clear();
	}

	async render(
		source: string,
		errorContext?: RenderErrorContext,
	): Promise<RenderResult> {
		const settings = this.getSettings();
		const engine = resolveRenderEngine(settings);
		const normalizedSource = source;
		const invertDark = shouldInvertSvgAtRenderTime(settings.darkModeStyle, this.isDarkTheme());
		const cacheKey = buildRenderCacheKey(engine, normalizedSource, settings, invertDark);

		if (settings.cacheEnabled) {
			const hit = await this.diskCache.get(cacheKey);
			if (hit) {
				return hit;
			}
		}

		const pending = this.inFlight.get(cacheKey);
		if (pending !== undefined) {
			return pending;
		}

		const request: RenderRequest = {
			source,
			normalizedSource,
			settings: { ...settings, renderEngine: engine },
			errorContext,
			invertDark,
		};

		const renderPromise = this.dispatch(request).finally(() => {
			this.inFlight.delete(cacheKey);
		});

		this.inFlight.set(cacheKey, renderPromise);
		const result = await renderPromise;

		if (result.ok && settings.cacheEnabled) {
			await this.diskCache.set(cacheKey, result, settings);
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
			const route = resolveTikzJaxDispatch(request.normalizedSource, request.settings);
			if (route === 'lualatex-fallback') {
				return this.luaLatexRenderer.render(request);
			}
			if (route === 'arabic-error') {
				return Promise.resolve({
					ok: false,
					engine: 'tikzjax',
					error: ARABIC_REQUIRES_LUALATEX_ERROR,
				});
			}
			return this.tikzJaxRenderer.render(request);
		}
		return this.luaLatexRenderer.render(request);
	}
}

/** Backward-compatible alias */
export { RendererManager as TikzRenderer };
