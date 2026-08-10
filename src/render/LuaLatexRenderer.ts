import { normalizePath, type App } from 'obsidian';
import {
	clearPluginTempFsDir,
	adapterOrDesktopExists,
	ensureAdapterFolderExists,
	ensurePluginTempFsDir,
	getDesktopFsPath,
	getPluginTempDir,
	readAdapterLogTail,
	removeAdapterFolder,
} from '../core/pluginPaths';
import {
	RenderTimeoutError,
	desktopFsReadBinary,
	desktopFsReadText,
	formatExecError,
	resolveLuaLatex,
	resolvePdfToCairo,
	spawnWithTimeout,
} from '../desktop/lualatexShell';
import {
	formatLatexErrorWithLineMapping,
	createNoteLineMapper,
	buildLatexErrorTitle,
} from '../latex/latexErrorMapping';
import { RENDER_IDENTITY_KEYS, type LuaTikzSettings } from '../settings/settingsModel';
import { buildLatexDocument, latexWrapperOptionsFromSettings } from '../core/tikzSource';
import type { RenderRequest, RenderResult } from '../core/types';
import { encodeBytesBase64 } from '../utils/base64Utils';
import { sha256Hex } from '../utils/sha256Hex';
import { sanitizeCacheFilename, validateLualatexPath, asString } from '../utils/guards';
import { LruTtlCache } from '../utils/lruTtlCache';
import { svgDataUrl } from '../utils/svgDataUrl';
import { injectTikzBBoxAttribute } from '../utils/coordinatePick';

const CACHE_MAX = 32;
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Monotonic job-dir suffix; see the comment at the use site. */
let jobCounter = 0;

interface CompileDebugInfo {
	lualatexPath: string;
	workDir: string;
	inputFile: string;
	features?: { hebrew: boolean; arabic: boolean; customPreamble: boolean };
}

// No dark/light component: this cache stores the un-inverted compiler output,
// and RendererManager applies dark-mode inversion after every render() call.
function cacheKey(source: string, settings: LuaTikzSettings): string {
	return sha256Hex([
		source,
		// See renderCache.ts: driven off the shared list so font/preamble
		// changes always invalidate rather than serving a stale SVG.
		...RENDER_IDENTITY_KEYS.map(key => String(settings[key])),
	]);
}

/** Which conditional preamble blocks were active — makes the RTL gate visible in bug reports. */
function formatPreambleFeatures(features: CompileDebugInfo['features']): string | null {
	if (!features) {
		return null;
	}
	const active = [
		features.hebrew ? 'hebrew' : null,
		features.arabic ? 'arabic' : null,
		features.customPreamble ? 'custom preamble' : null,
	].filter(Boolean);
	return `Preamble: ${active.length ? active.join(', ') : 'default (no RTL)'}`;
}

function formatCompileDebugLog(debug: CompileDebugInfo, body: string): string {
	return [
		'Renderer: LuaLaTeX',
		`LuaLaTeX path: ${debug.lualatexPath}`,
		`Working directory: ${debug.workDir}`,
		`Input file: ${debug.inputFile}`,
		formatPreambleFeatures(debug.features),
		'',
		body,
	].filter(line => line !== null).join('\n');
}

async function resolvePngAdapterPath(
	app: App,
	jobAdapterDir: string,
	jobId: string,
): Promise<string | null> {
	const candidates = [
		normalizePath(`${jobAdapterDir}/${jobId}.png`),
		normalizePath(`${jobAdapterDir}/${jobId}-1.png`),
	];
	for (const candidate of candidates) {
		if (await adapterOrDesktopExists(app, candidate)) {
			return candidate;
		}
	}
	return null;
}

async function readArtifactText(app: App, adapterPath: string): Promise<string> {
	if (await app.vault.adapter.exists(adapterPath)) {
		return app.vault.adapter.read(adapterPath);
	}
	const fsPath = getDesktopFsPath(app, adapterPath);
	return fsPath ? desktopFsReadText(fsPath, Number.POSITIVE_INFINITY) : '';
}

async function readArtifactBinary(app: App, adapterPath: string): Promise<ArrayBuffer | null> {
	if (await app.vault.adapter.exists(adapterPath)) {
		return app.vault.adapter.readBinary(adapterPath);
	}
	const fsPath = getDesktopFsPath(app, adapterPath);
	const bytes = fsPath ? desktopFsReadBinary(fsPath) : null;
	if (!bytes) {
		return null;
	}
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isSvgOutput(text: string): boolean {
	return text.includes('<svg');
}

export class LuaLatexRenderer {
	private cache = new LruTtlCache<string>(CACHE_MAX, CACHE_TTL_MS);

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
	) {}

	clearCache(): void {
		this.cache.clear();
		void clearPluginTempFsDir(this.app, this.pluginId);
	}

	async render(request: RenderRequest): Promise<RenderResult> {
		const { settings, normalizedSource, errorContext } = request;

		if (!settings.enableLocalShellRenderer) {
			return {
				ok: false,
				engine: 'lualatex',
				error: 'Local LuaLaTeX rendering is disabled. Enable "Allow local LuaLaTeX execution" in LuaTikz settings.',
			};
		}

		const pathValidation = validateLualatexPath(settings.lualatexPath);
		if (pathValidation) {
			return { ok: false, engine: 'lualatex', error: pathValidation };
		}

		const key = cacheKey(normalizedSource, settings);
		if (settings.cacheEnabled) {
			const svgText = this.cache.get(key);
			if (svgText !== null) {
				return {
					ok: true,
					engine: 'lualatex',
					svg: svgText,
					svgText,
					dataUrl: svgDataUrl(svgText),
				};
			}
		}

		return this.compile(normalizedSource, settings, errorContext, key);
	}

	private latexError(
		rawError: string,
		source: string,
		userLineOffset: number,
		errorContext: RenderRequest['errorContext'],
		timedOut = false,
		debug?: CompileDebugInfo,
	): RenderResult {
		const block = errorContext?.block;
		const noteLineMapper = block
			? createNoteLineMapper(block, errorContext?.editor)
			: undefined;

		const mapped = formatLatexErrorWithLineMapping(
			rawError,
			source,
			userLineOffset,
			noteLineMapper,
			errorContext?.editor,
		);

		const body = timedOut
			? rawError
			: [mapped.message, rawError].filter(Boolean).join('\n\n');

		return {
			ok: false,
			engine: 'lualatex',
			error: timedOut ? 'Timed out.' : buildLatexErrorTitle(mapped),
			hint: timedOut ? undefined : mapped.hint,
			rawLog: debug ? formatCompileDebugLog(debug, body) : body,
			userLine: mapped.userLine,
			noteLine: mapped.noteLine,
			lineContent: mapped.lineContent,
			autofix: mapped.autofix,
			timedOut,
		};
	}

	private remember(key: string, svgText: string): void {
		this.cache.set(key, svgText);
	}

	private async compile(
		source: string,
		settings: LuaTikzSettings,
		errorContext: RenderRequest['errorContext'],
		key: string,
		attempt = 0,
	): Promise<RenderResult> {
		const tempDirResult = await ensurePluginTempFsDir(this.app, this.pluginId);
		if (!tempDirResult.ok) {
			return {
				ok: false,
				engine: 'lualatex',
				error: asString(tempDirResult.error, 'Could not create LuaTikz temp directory.'),
			};
		}

		// The counter keeps concurrent compiles of the *same* source in
		// separate directories: with a purely key-derived name, two in-flight
		// compiles shared a job dir and the first one's cleanup deleted the
		// other's .tex/.pdf mid-compile ("No PDF produced.").
		const safeId = sanitizeCacheFilename(key.slice(0, 16));
		const jobId = `luatikz-${safeId}-${++jobCounter}`;
		const jobAdapterDir = normalizePath(`${getPluginTempDir(this.app, this.pluginId)}/${jobId}`);
		await ensureAdapterFolderExists(this.app, jobAdapterDir);

		const workDir = getDesktopFsPath(this.app, jobAdapterDir);
		if (!workDir) {
			return {
				ok: false,
				engine: 'lualatex',
				error: 'Local LuaLaTeX rendering requires desktop filesystem access.',
			};
		}

		const texFileName = `${jobId}.tex`;
		const pdfFileName = `${jobId}.pdf`;
		const svgFileName = `${jobId}.svg`;
		const logAdapterPath = normalizePath(`${jobAdapterDir}/${jobId}.log`);
		const texAdapterPath = normalizePath(`${jobAdapterDir}/${texFileName}`);
		const pdfAdapterPath = normalizePath(`${jobAdapterDir}/${pdfFileName}`);
		const svgAdapterPath = normalizePath(`${jobAdapterDir}/${svgFileName}`);
		const bboxAdapterPath = normalizePath(`${jobAdapterDir}/${jobId}.luatikzbbox`);

		const lualatex = await resolveLuaLatex(settings.lualatexPath);
		if (!lualatex) {
			return {
				ok: false,
				engine: 'lualatex',
				error: 'LuaLaTeX not found.',
				rawLog: `Expected at ${settings.lualatexPath}\nCheck: which lualatex`,
			};
		}

		// Built once: every error below reports lines against the tex actually
		// written to disk, so the offset cannot drift from the document.
		const doc = buildLatexDocument(source, latexWrapperOptionsFromSettings(settings));

		const debugInfo: CompileDebugInfo = {
			lualatexPath: lualatex,
			workDir,
			inputFile: texFileName,
			features: doc.features,
		};

		try {
			await this.app.vault.adapter.write(texAdapterPath, doc.tex);

			// The input we just wrote disappearing mid-compile is never a LaTeX
			// error — something external (a temp-dir sweep racing this compile,
			// a sync tool, OS cleanup) removed the job dir. One automatic retry
			// in a fresh directory self-heals instead of sticking the block in
			// a "….tex not found" error until the user forces a re-render.
			const retryIfInputVanished = async (): Promise<RenderResult | null> => {
				if (attempt === 0 && !(await adapterOrDesktopExists(this.app, texAdapterPath))) {
					return this.compile(source, settings, errorContext, key, attempt + 1);
				}
				return null;
			};

			try {
				await spawnWithTimeout(lualatex, [
					'-interaction=nonstopmode',
					'-halt-on-error',
					texFileName,
				], { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }, settings.timeoutMs);
			} catch (err) {
				if (!(err instanceof RenderTimeoutError)) {
					const retried = await retryIfInputVanished();
					if (retried) {
						return retried;
					}
				}
				const logTail = await readAdapterLogTail(this.app, logAdapterPath);
				const raw = [formatExecError(err), logTail && `\n--- log ---\n${logTail}`]
					.filter(Boolean)
					.join('\n');
				return this.latexError(raw, source, doc.userLineOffset, errorContext, err instanceof RenderTimeoutError, debugInfo);
			}

			if (!(await adapterOrDesktopExists(this.app, pdfAdapterPath))) {
				const retried = await retryIfInputVanished();
				if (retried) {
					return retried;
				}
				const logTail = await readAdapterLogTail(this.app, logAdapterPath);
				const raw = logTail
					? `No PDF produced.\n--- log ---\n${logTail}`
					: 'No PDF produced.';
				return this.latexError(raw, source, doc.userLineOffset, errorContext, false, debugInfo);
			}

			if (settings.outputFormat === 'png') {
				const pdftocairo = await resolvePdfToCairo();
				if (!pdftocairo) {
					return {
						ok: false,
						engine: 'lualatex',
						error: 'pdftocairo not found.',
						rawLog: formatCompileDebugLog(debugInfo, 'Install: brew install poppler'),
					};
				}

				try {
					await spawnWithTimeout(pdftocairo, ['-png', pdfFileName, jobId], {
						cwd: workDir,
						maxBuffer: 30 * 1024 * 1024,
					}, settings.timeoutMs);
				} catch (err) {
					return this.latexError(
						formatExecError(err),
						source,
						doc.userLineOffset,
						errorContext,
						err instanceof RenderTimeoutError,
						debugInfo,
					);
				}

				const pngAdapterPath = await resolvePngAdapterPath(this.app, jobAdapterDir, jobId);
				if (!pngAdapterPath) {
					return this.latexError(
						'No PNG produced.',
						source,
						doc.userLineOffset,
						errorContext,
						false,
						debugInfo,
					);
				}

				const pngBytes = await readArtifactBinary(this.app, pngAdapterPath);
				if (!pngBytes) {
					return this.latexError(
						'No PNG produced.',
						source,
						doc.userLineOffset,
						errorContext,
						false,
						debugInfo,
					);
				}
				const dataUrl = `data:image/png;base64,${encodeBytesBase64(pngBytes)}`;
				return { ok: true, engine: 'lualatex', dataUrl };
			}

			const pdftocairo = await resolvePdfToCairo();
			if (!pdftocairo) {
				return {
					ok: false,
					engine: 'lualatex',
					error: 'pdftocairo not found.',
					rawLog: formatCompileDebugLog(debugInfo, 'Install: brew install poppler'),
				};
			}

			let svgText = '';
			let pdftocairoStderr = '';
			try {
				const { stdout, stderr } = await spawnWithTimeout(
					pdftocairo,
					['-svg', pdfFileName, '-'],
					{ cwd: workDir, maxBuffer: 30 * 1024 * 1024 },
					settings.timeoutMs,
				);
				svgText = stdout;
				pdftocairoStderr = stderr;
			} catch (err) {
				return this.latexError(
					formatExecError(err),
					source,
					doc.userLineOffset,
					errorContext,
					err instanceof RenderTimeoutError,
					debugInfo,
				);
			}

			if (!isSvgOutput(svgText)) {
				svgText = await readArtifactText(this.app, svgAdapterPath);
			}

			if (!isSvgOutput(svgText)) {
				const details = [pdftocairoStderr, 'No SVG produced.'].filter(Boolean).join('\n');
				return this.latexError(
					details,
					source,
					doc.userLineOffset,
					errorContext,
					false,
					debugInfo,
				);
			}
			// Dark-mode inversion happens once in RendererManager, for every
			// engine — inverting here as well would double-invert.
			try {
				const bboxSidecar = await readArtifactText(this.app, bboxAdapterPath);
				svgText = injectTikzBBoxAttribute(svgText, bboxSidecar);
			} catch {
				// calibration is best-effort; picking falls back to uncalibrated math
			}

			if (settings.cacheEnabled) {
				this.remember(key, svgText);
			}

			return {
				ok: true,
				engine: 'lualatex',
				svg: svgText,
				svgText,
				dataUrl: svgDataUrl(svgText),
			};
		} finally {
			try {
				await removeAdapterFolder(this.app, jobAdapterDir);
			} catch {
				// ignore
			}
		}
	}
}
