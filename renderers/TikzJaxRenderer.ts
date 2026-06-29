import { createHash } from 'crypto';
import type { App } from 'obsidian';
import {
	loadRequiredModule,
	resolveTikzJaxRuntime,
} from '../pluginPaths';
import type { LuaTikzSettings } from '../settingsModel';
import {
	formatTikzJaxInputMode,
	normalizeForTikzJax,
	sanitizeTikzJaxPreamble,
	TIKZJAX_TEX_PACKAGES,
	TIKZJAX_TIKZ_LIBRARIES,
} from '../tikzJaxSource';
import type { RenderRequest, RenderResult } from '../types';
import { setTikzJaxTexDir } from '../utils/guards';
import { finalizeTikzJaxSvg } from '../utils/tikzJaxSvgFix';

const CACHE_MAX = 32;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
	svgText: string;
	createdAt: number;
}

type Tex2SvgFn = (
	input: string,
	options?: {
		showConsole?: boolean;
		texPackages?: Record<string, string>;
		tikzLibraries?: string;
		addToPreamble?: string;
	},
) => Promise<string>;

type TikzJaxModule = {
	default?: Tex2SvgFn;
	load?: () => Promise<void>;
};

interface TikzJaxDebugInfo {
	entryPath: string;
	texPath: string;
	inputMode: string;
	normalizedSource: string;
}

let renderQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
	const next = renderQueue.then(task, task);
	renderQueue = next.then((): undefined => undefined, (): undefined => undefined);
	return next;
}

function cacheKey(source: string, settings: LuaTikzSettings): string {
	return createHash('sha256')
		.update(source)
		.update(settings.extraPreamble)
		.digest('hex');
}

function svgDataUrl(svgText: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf8').toString('base64')}`;
}

function isTex2SvgFn(value: unknown): value is Tex2SvgFn {
	return typeof value === 'function';
}

function readTex2SvgExport(moduleValue: unknown): Tex2SvgFn | null {
	if (isTex2SvgFn(moduleValue)) {
		return moduleValue;
	}

	if (!moduleValue || typeof moduleValue !== 'object') {
		return null;
	}

	const record = moduleValue as TikzJaxModule;
	if (isTex2SvgFn(record.default)) {
		return record.default;
	}

	return null;
}

function formatTikzJaxDebugLog(
	debug: TikzJaxDebugInfo,
	body: string,
): string {
	return [
		'Renderer: TikZJax',
		`TikZJax entry: ${debug.entryPath}`,
		`TeX path: ${debug.texPath}`,
		`Input mode: ${debug.inputMode}`,
		'Normalized source:',
		debug.normalizedSource,
		'',
		body,
	].join('\n');
}

async function captureConsoleLogs<T>(
	task: () => Promise<T>,
): Promise<{ result: T; logs: string }> {
	const lines: string[] = [];
	const originalLog = console.log.bind(console);

	console.log = (...args: unknown[]) => {
		lines.push(args.map(arg => String(arg)).join(' '));
		originalLog(...args);
	};

	try {
		const result = await task();
		return { result, logs: lines.join('\n') };
	} finally {
		console.log = originalLog;
	}
}

function validateSvgOutput(svg: unknown): svg is string {
	return typeof svg === 'string' && svg.includes('<svg');
}

export class TikzJaxRenderer {
	private cache = new Map<string, CacheEntry>();
	private tex2svg: Tex2SvgFn | null = null;
	private loadError: string | null = null;
	private loadErrorLog: string | null = null;
	private runtimePaths: { entryPath: string; texPath: string } | null = null;
	private loadPromise: Promise<Tex2SvgFn | null> | null = null;

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
	) {}

	clearCache(): void {
		this.cache.clear();
		this.tex2svg = null;
		this.loadError = null;
		this.loadErrorLog = null;
		this.runtimePaths = null;
		this.loadPromise = null;
	}

	private async ensureLoaded(): Promise<Tex2SvgFn | null> {
		if (this.tex2svg) {
			return this.tex2svg;
		}
		if (this.loadError) {
			return null;
		}

		if (!this.loadPromise) {
			this.loadPromise = this.loadModule().finally(() => {
				this.loadPromise = null;
			});
		}

		return this.loadPromise;
	}

	private async loadModule(): Promise<Tex2SvgFn | null> {
		const runtime = resolveTikzJaxRuntime(this.app, this.pluginId);
		if (!runtime.ok) {
			this.loadError = runtime.error;
			this.loadErrorLog = runtime.rawLog ?? runtime.error;
			return null;
		}

		this.runtimePaths = runtime.paths;

		try {
			setTikzJaxTexDir(runtime.paths.texPath);
			const moduleValue = loadRequiredModule(runtime.paths.entryPath) as TikzJaxModule;
			if (typeof moduleValue.load === 'function') {
				await moduleValue.load();
			}

			const fn = readTex2SvgExport(moduleValue);
			if (!fn) {
				this.loadError = 'TikZJax runtime is missing.';
				this.loadErrorLog = 'TikZJax module loaded but tex2svg export is missing.';
				return null;
			}

			this.tex2svg = fn;
			return fn;
		} catch (err) {
			this.loadError = 'TikZJax runtime is missing.';
			this.loadErrorLog = err instanceof Error ? err.message : String(err);
			return null;
		}
	}

	async render(request: RenderRequest): Promise<RenderResult> {
		return runExclusive(() => this.renderInternal(request));
	}

	private async renderInternal(request: RenderRequest): Promise<RenderResult> {
		const { settings, normalizedSource } = request;
		const key = cacheKey(normalizedSource, settings);

		if (settings.cacheEnabled) {
			const hit = this.cache.get(key);
			if (hit && Date.now() - hit.createdAt <= CACHE_TTL_MS) {
				this.cache.delete(key);
				this.cache.set(key, hit);
				return {
					ok: true,
					engine: 'tikzjax',
					svg: hit.svgText,
					svgText: hit.svgText,
					dataUrl: svgDataUrl(hit.svgText),
				};
			}
			if (hit) {
				this.cache.delete(key);
			}
		}

		const tex2svg = await this.ensureLoaded();
		if (!tex2svg || !this.runtimePaths) {
			return {
				ok: false,
				engine: 'tikzjax',
				error: this.loadError ?? 'TikZJax renderer is unavailable.',
				rawLog: this.loadErrorLog ?? [
					'The plugin release must include:',
					'vendor/node-tikzjax/',
					'vendor/tex/',
					'',
					'Switch to Local LuaLaTeX or reinstall a release that bundles TikZJax.',
				].join('\n'),
			};
		}

		const normalized = normalizeForTikzJax(normalizedSource);
		const sanitizedPreamble = sanitizeTikzJaxPreamble(settings.extraPreamble);
		const debugInfo: TikzJaxDebugInfo = {
			entryPath: this.runtimePaths.entryPath,
			texPath: this.runtimePaths.texPath,
			inputMode: formatTikzJaxInputMode(normalized.mode),
			normalizedSource: normalized.tex,
		};

		let consoleLogs = '';

		try {
			const { result: svgText, logs } = await captureConsoleLogs(async () =>
				tex2svg(normalized.tex, {
					showConsole: true,
					texPackages: TIKZJAX_TEX_PACKAGES,
					tikzLibraries: TIKZJAX_TIKZ_LIBRARIES,
					addToPreamble: sanitizedPreamble || undefined,
				}),
			);
			consoleLogs = logs;
			const fixedSvg = finalizeTikzJaxSvg(svgText);

			if (!validateSvgOutput(fixedSvg)) {
				const logBody = [
					normalized.hebrewNote,
					consoleLogs && `TikZJax console:\n${consoleLogs}`,
					'Raw TikZJax error:',
					'TikZJax did not return SVG output.',
				].filter(Boolean).join('\n\n');

				return {
					ok: false,
					engine: 'tikzjax',
					error: 'TikZJax failed to render this diagram.',
					rawLog: formatTikzJaxDebugLog(debugInfo, logBody),
				};
			}

			if (settings.cacheEnabled) {
				this.cache.set(key, { svgText: fixedSvg, createdAt: Date.now() });
				while (this.cache.size > CACHE_MAX) {
					const oldestKey = this.cache.keys().next().value;
					if (typeof oldestKey !== 'string') {
						break;
					}
					this.cache.delete(oldestKey);
				}
			}

			return {
				ok: true,
				engine: 'tikzjax',
				svg: fixedSvg,
				svgText: fixedSvg,
				dataUrl: svgDataUrl(fixedSvg),
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const logBody = [
				normalized.hebrewNote,
				logsFromError(err),
				consoleLogs && `TikZJax console:\n${consoleLogs}`,
				'Raw TikZJax error:',
				message,
			].filter(Boolean).join('\n\n');

			return {
				ok: false,
				engine: 'tikzjax',
				error: 'TikZJax failed to render this diagram.',
				rawLog: formatTikzJaxDebugLog(debugInfo, logBody),
			};
		}
	}
}

function logsFromError(err: unknown): string | undefined {
	if (!(err instanceof Error)) {
		return undefined;
	}
	const record = err as Error & { stdout?: string; stderr?: string };
	const parts = [record.stdout, record.stderr].filter(Boolean);
	return parts.length > 0 ? parts.join('\n') : undefined;
}
