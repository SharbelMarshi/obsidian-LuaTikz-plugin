import type { App } from 'obsidian';
import type { LuaTikzSettings } from '../settings/settingsModel';
import type { RenderErrorContext, RenderImageResult, RenderRequest, RenderResult } from '../core/types';
import { renderResultToImageResult } from '../core/types';
import { invertSvgForDarkMode, shouldInvertSvgAtRenderTime } from '../utils/darkMode';
import { svgDataUrl } from '../utils/svgDataUrl';
import { buildRenderCacheKey, RenderDiskCache } from '../utils/renderCache';
import { resolveRenderEngine } from '../utils/platform';
import { LuaLatexRenderer } from './LuaLatexRenderer';
import { TikzJaxRenderer } from './TikzJaxRenderer';
import { ARABIC_REQUIRES_LUALATEX_ERROR, resolveTikzJaxDispatch } from '../utils/renderRouting';

/**
 * Dark-mode inversion happens here, once, for every engine. It used to live
 * inside LuaLatexRenderer only, so TikZJax output — the sole engine on mobile —
 * was never inverted: black ink on a dark theme, with the white backing rect
 * already stripped by finalizeTikzJaxSvg. Applied before the disk-cache write
 * so cached entries are stored post-inversion, matching the cache key's
 * invertDark component.
 */
function applyDarkInversion(result: RenderResult, invertDark: boolean): RenderResult {
	const svgText = result.svgText ?? result.svg;
	if (!invertDark || !result.ok || !svgText) {
		return result;
	}
	const inverted = invertSvgForDarkMode(svgText);
	return {
		...result,
		svg: result.svg !== undefined ? inverted : undefined,
		svgText: inverted,
		dataUrl: svgDataUrl(inverted),
	};
}

export class RendererManager {
	private luaLatexRenderer: LuaLatexRenderer;
	private tikzJaxRenderer: TikzJaxRenderer;
	private diskCache: RenderDiskCache;
	private inFlight = new Map<string, Promise<RenderResult>>();

	constructor(
		app: App,
		pluginId: string,
		private readonly pluginVersion: string,
		private readonly isDarkTheme: () => boolean,
		private getSettings: () => LuaTikzSettings,
	) {
		this.luaLatexRenderer = new LuaLatexRenderer(app, pluginId);
		this.tikzJaxRenderer = new TikzJaxRenderer(app, pluginId);
		this.diskCache = new RenderDiskCache(app, pluginId);
	}

	/** Unload/disable: drop memory and temp files, keep the disk cache. */
	dispose(): void {
		this.diskCache.dispose();
		this.luaLatexRenderer.clearCache();
		this.tikzJaxRenderer.clearCache();
		this.inFlight.clear();
	}

	/** Settings change / Clear-cache button: also delete the on-disk assets. */
	async invalidateCache(): Promise<void> {
		this.luaLatexRenderer.clearCache();
		this.tikzJaxRenderer.clearCache();
		this.inFlight.clear();
		await this.diskCache.invalidateCache();
	}

	async render(
		source: string,
		errorContext?: RenderErrorContext,
	): Promise<RenderResult> {
		const settings = this.getSettings();
		const engine = resolveRenderEngine(settings);
		const normalizedSource = source;
		const invertDark = shouldInvertSvgAtRenderTime(settings.darkModeStyle, this.isDarkTheme());
		const cacheKey = buildRenderCacheKey(engine, normalizedSource, settings, invertDark, this.pluginVersion);

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
			normalizedSource,
			settings: { ...settings, renderEngine: engine },
			errorContext,
			invertDark,
		};

		const renderPromise = this.dispatch(request)
			.then(result => applyDarkInversion(result, invertDark))
			.finally(() => {
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
