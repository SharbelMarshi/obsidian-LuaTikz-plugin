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
import { firstMapKey, isCallable, isRecord, setTikzJaxTexDir } from '../utils/guards';
import { finalizeTikzJaxSvg } from '../utils/tikzJaxSvgFix';

const CACHE_MAX = 32;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
	svgText: string;
	createdAt: number;
}

type Tex2SvgOptions = {
	showConsole?: boolean;
	texPackages?: Record<string, string>;
	tikzLibraries?: string;
	addToPreamble?: string;
};

type Tex2SvgFn = (input: string, options?: Tex2SvgOptions) => Promise<string>;

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

function asTex2SvgFn(value: unknown): Tex2SvgFn | null {
	if (!isCallable(value)) {
		return null;
	}

	return async (input: string, options?: Tex2SvgOptions) => {
		const result: unknown = await value(input, options);
		if (typeof result !== 'string') {
			throw new Error('TikZJax did not return a string.');
		}
		return result;
	};
}

function readTex2SvgExport(moduleValue: unknown): Tex2SvgFn | null {
	const direct = asTex2SvgFn(moduleValue);
	if (direct) {
		return direct;
	}

	if (!isRecord(moduleValue)) {
		return null;
	}

	return asTex2SvgFn(moduleValue.default) ?? asTex2SvgFn(moduleValue.render);
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
		Reflect.apply(originalLog, console, args);
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

		if (this.loadPromise === null) {
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
			const moduleValue: unknown = loadRequiredModule(runtime.paths.entryPath);
			if (isRecord(moduleValue) && isCallable(moduleValue.load)) {
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
					const oldestKey = firstMapKey(this.cache);
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
	if (!isRecord(err)) {
		return undefined;
	}

	const stdout = err.stdout;
	const stderr = err.stderr;
	const parts = [
		typeof stdout === 'string' ? stdout : undefined,
		typeof stderr === 'string' ? stderr : undefined,
	].filter((part): part is string => typeof part === 'string');

	return parts.length > 0 ? parts.join('\n') : undefined;
}
