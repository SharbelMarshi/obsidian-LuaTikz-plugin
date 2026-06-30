import { createHash } from 'crypto';
import type { App } from 'obsidian';
import type { LuaTikzSettings } from '../settingsModel';
import {
	formatTikzJaxInputMode,
	normalizeForTikzJax,
	sanitizeTikzJaxPreamble,
	tikzJaxRenderErrorMessage,
} from '../tikzJaxSource';
import type { RenderRequest, RenderResult } from '../types';
import { firstMapKey, isCallable, isRecord } from '../utils/guards';
import { finalizeTikzJaxSvg } from '../utils/tikzJaxSvgFix';
import { ensureTikzJaxTexExtracted } from '../utils/tikzJaxTexRuntime';

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
	texDir: string;
	inputMode: string;
	normalizedSource: string;
}

let renderQueue: Promise<unknown> = Promise.resolve();
let tikzJaxModulePromise: Promise<unknown> | null = null;

async function loadTikzJaxModule(): Promise<unknown> {
	if (tikzJaxModulePromise === null) {
		tikzJaxModulePromise = import('node-tikzjax');
	}
	return tikzJaxModulePromise;
}

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
	return asTex2SvgFn(moduleValue) ?? (isRecord(moduleValue) ? asTex2SvgFn(moduleValue.default) : null);
}

function formatTikzJaxDebugLog(
	debug: TikzJaxDebugInfo,
	body: string,
): string {
	return [
		'Renderer: TikZJax',
		`TeX path: ${debug.texDir}`,
		`Input mode: ${debug.inputMode}`,
		'Normalized source:',
		debug.normalizedSource,
		'',
		body,
	].join('\n');
}

function stringifyConsoleArgs(args: readonly unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === 'string') {
				return arg;
			}
			if (arg instanceof Error) {
				return arg.stack ?? arg.message;
			}
			try {
				return JSON.stringify(arg);
			} catch {
				return String(arg);
			}
		})
		.join(' ');
}

async function captureConsoleOutput<T>(
	task: () => Promise<T>,
): Promise<{ result: T; logs: string }> {
	const captured: string[] = [];
	const originalLog: typeof console.log = console.log.bind(console);
	const originalWarn: typeof console.warn = console.warn.bind(console);
	const originalError: typeof console.error = console.error.bind(console);

	console.log = (...args: unknown[]): void => {
		captured.push(stringifyConsoleArgs(args));
		originalLog(...args);
	};
	console.warn = (...args: unknown[]): void => {
		captured.push(stringifyConsoleArgs(args));
		originalWarn(...args);
	};
	console.error = (...args: unknown[]): void => {
		captured.push(stringifyConsoleArgs(args));
		originalError(...args);
	};

	try {
		const result = await task();
		return { result, logs: captured.join('\n') };
	} finally {
		console.log = originalLog;
		console.warn = originalWarn;
		console.error = originalError;
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
	private texDir: string | null = null;
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
		this.texDir = null;
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
		try {
			const texResult = await ensureTikzJaxTexExtracted(this.app, this.pluginId);
			if (!texResult.ok) {
				this.loadError = 'TikZJax failed to initialize.';
				const errorMessage: string = texResult.error;
				this.loadErrorLog = errorMessage;
				return null;
			}

			this.texDir = texResult.texDir;

			const moduleValue = await loadTikzJaxModule();
			if (isRecord(moduleValue)) {
				const load = moduleValue.load;
				if (isCallable(load)) {
					await load();
				}
			}

			const exportValue = isRecord(moduleValue)
				? moduleValue.default ?? moduleValue
				: moduleValue;
			const fn = readTex2SvgExport(exportValue);
			if (!fn) {
				this.loadError = 'TikZJax failed to initialize.';
				this.loadErrorLog = 'Bundled TikZJax module did not export tex2svg.';
				return null;
			}

			this.tex2svg = fn;
			return fn;
		} catch (err) {
			this.loadError = 'TikZJax failed to initialize.';
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
		if (!tex2svg || !this.texDir) {
			return {
				ok: false,
				engine: 'tikzjax',
				error: this.loadError ?? 'TikZJax failed to initialize.',
				rawLog: this.loadErrorLog ?? 'Bundled TikZJax runtime could not be loaded.',
			};
		}

		const sanitizedPreamble = sanitizeTikzJaxPreamble(settings.extraPreamble);
		const normalized = normalizeForTikzJax(normalizedSource, sanitizedPreamble);
		const debugInfo: TikzJaxDebugInfo = {
			texDir: this.texDir,
			inputMode: formatTikzJaxInputMode(normalized.mode),
			normalizedSource: normalized.tex,
		};

		let consoleLogs = '';
		const renderErrorMessage = tikzJaxRenderErrorMessage(normalizedSource);

		try {
			const { result: svgText, logs } = await captureConsoleOutput(async () =>
				tex2svg(normalized.renderTex, {
					showConsole: true,
					texPackages: normalized.texPackages,
					tikzLibraries: normalized.tikzLibraries,
					addToPreamble: normalized.addToPreamble || undefined,
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
					error: renderErrorMessage,
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
				error: renderErrorMessage,
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
