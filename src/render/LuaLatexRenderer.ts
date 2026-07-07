import { normalizePath, type App } from 'obsidian';
import {
	clearPluginTempFsDir,
	ensureAdapterFolderExists,
	ensurePluginTempFsDir,
	getDesktopFsPath,
	getPluginTempDir,
	readAdapterLogTail,
	removeAdapterFolder,
} from '../core/pluginPaths';
import {
	RenderTimeoutError,
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
import type { LuaTikzSettings } from '../settings/settingsModel';
import { getUserSourceLineOffsetForExtraPreamble, wrapLatexSource } from '../core/tikzSource';
import type { RenderRequest, RenderResult } from '../core/types';
import { encodeUtf8Base64, encodeBytesBase64 } from '../utils/base64Utils';
import { sha256Hex } from '../utils/sha256Hex';
import { sanitizeCacheFilename, validateLualatexPath, firstMapKey, asString } from '../utils/guards';
import { invertSvgForDarkMode } from '../utils/darkMode';

const CACHE_MAX = 32;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
	svgText: string;
	createdAt: number;
}

interface CompileDebugInfo {
	lualatexPath: string;
	workDir: string;
	inputFile: string;
}

function cacheKey(source: string, invertDark: boolean, settings: LuaTikzSettings): string {
	return sha256Hex([
		source,
		invertDark ? ':dark' : ':light',
		settings.lualatexPath,
		settings.extraPreamble,
		settings.darkModeStyle,
		String(settings.timeoutMs),
	]);
}

function svgDataUrl(svgText: string): string {
	return `data:image/svg+xml;base64,${encodeUtf8Base64(svgText)}`;
}

function formatCompileDebugLog(debug: CompileDebugInfo, body: string): string {
	return [
		'Renderer: LuaLaTeX',
		`LuaLaTeX path: ${debug.lualatexPath}`,
		`Working directory: ${debug.workDir}`,
		`Input file: ${debug.inputFile}`,
		'',
		body,
	].join('\n');
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
		if (await app.vault.adapter.exists(candidate)) {
			return candidate;
		}
	}
	return null;
}

export class LuaLatexRenderer {
	private cache = new Map<string, CacheEntry>();

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
		private readonly isDarkTheme: () => boolean,
	) {}

	clearCache(): void {
		this.cache.clear();
		void clearPluginTempFsDir(this.app, this.pluginId);
	}

	async render(request: RenderRequest): Promise<RenderResult> {
		const { settings, normalizedSource, errorContext } = request;
		const invertDark = request.invertDark ?? this.isDarkTheme();

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

		const key = cacheKey(normalizedSource, invertDark, settings);
		if (settings.cacheEnabled) {
			const hit = this.cache.get(key);
			if (hit && Date.now() - hit.createdAt <= CACHE_TTL_MS) {
				this.cache.delete(key);
				this.cache.set(key, hit);
				const svgText = hit.svgText;
				return {
					ok: true,
					engine: 'lualatex',
					svg: svgText,
					svgText,
					dataUrl: svgDataUrl(svgText),
				};
			}
			if (hit) {
				this.cache.delete(key);
			}
		}

		return this.compile(normalizedSource, settings, errorContext, invertDark, key);
	}

	private latexError(
		rawError: string,
		source: string,
		settings: LuaTikzSettings,
		errorContext: RenderRequest['errorContext'],
		timedOut = false,
		debug?: CompileDebugInfo,
	): RenderResult {
		const block = errorContext?.block;
		const lineOffset = getUserSourceLineOffsetForExtraPreamble(settings.extraPreamble);
		const noteLineMapper = block
			? createNoteLineMapper(block, errorContext?.editor)
			: undefined;

		const mapped = formatLatexErrorWithLineMapping(
			rawError,
			source,
			lineOffset,
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
			errorSummary: mapped.summary,
			rawLog: debug ? formatCompileDebugLog(debug, body) : body,
			userLine: mapped.userLine,
			noteLine: mapped.noteLine,
			lineContent: mapped.lineContent,
			autofix: mapped.autofix,
			timedOut,
		};
	}

	private remember(key: string, svgText: string): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		this.cache.set(key, { svgText, createdAt: Date.now() });
		while (this.cache.size > CACHE_MAX) {
			const oldestKey = firstMapKey(this.cache);
			if (typeof oldestKey !== 'string') {
				break;
			}
			this.cache.delete(oldestKey);
		}
	}

	private async compile(
		source: string,
		settings: LuaTikzSettings,
		errorContext: RenderRequest['errorContext'],
		invertDark: boolean,
		key: string,
	): Promise<RenderResult> {
		const tempDirResult = await ensurePluginTempFsDir(this.app, this.pluginId);
		if (!tempDirResult.ok) {
			return {
				ok: false,
				engine: 'lualatex',
				error: asString(tempDirResult.error, 'Could not create LuaTikz temp directory.'),
			};
		}

		const safeId = sanitizeCacheFilename(key.slice(0, 16));
		const jobId = `luatikz-${safeId}`;
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

		const lualatex = await resolveLuaLatex(settings.lualatexPath);
		if (!lualatex) {
			return {
				ok: false,
				engine: 'lualatex',
				error: 'LuaLaTeX not found.',
				rawLog: `Expected at ${settings.lualatexPath}\nCheck: which lualatex`,
			};
		}

		const debugInfo: CompileDebugInfo = {
			lualatexPath: lualatex,
			workDir,
			inputFile: texFileName,
		};

		try {
			await this.app.vault.adapter.write(
				texAdapterPath,
				wrapLatexSource(source, settings.extraPreamble),
			);

			try {
				await spawnWithTimeout(lualatex, [
					'-interaction=nonstopmode',
					'-halt-on-error',
					texFileName,
				], { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }, settings.timeoutMs);
			} catch (err) {
				const logTail = await readAdapterLogTail(this.app, logAdapterPath);
				const raw = [formatExecError(err), logTail && `\n--- log ---\n${logTail}`]
					.filter(Boolean)
					.join('\n');
				return this.latexError(raw, source, settings, errorContext, err instanceof RenderTimeoutError, debugInfo);
			}

			if (!(await this.app.vault.adapter.exists(pdfAdapterPath))) {
				const logTail = await readAdapterLogTail(this.app, logAdapterPath);
				const raw = logTail
					? `No PDF produced.\n--- log ---\n${logTail}`
					: 'No PDF produced.';
				return this.latexError(raw, source, settings, errorContext, false, debugInfo);
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
						settings,
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
						settings,
						errorContext,
						false,
						debugInfo,
					);
				}

				const pngBytes = await this.app.vault.adapter.readBinary(pngAdapterPath);
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

			try {
				await spawnWithTimeout(pdftocairo, ['-svg', pdfFileName, svgFileName], {
					cwd: workDir,
					maxBuffer: 30 * 1024 * 1024,
				}, settings.timeoutMs);
			} catch (err) {
				return this.latexError(
					formatExecError(err),
					source,
					settings,
					errorContext,
					err instanceof RenderTimeoutError,
					debugInfo,
				);
			}

			if (!(await this.app.vault.adapter.exists(svgAdapterPath))) {
				return this.latexError(
					'No SVG produced.',
					source,
					settings,
					errorContext,
					false,
					debugInfo,
				);
			}

			let svgText = await this.app.vault.adapter.read(svgAdapterPath);
			if (invertDark) {
				svgText = invertSvgForDarkMode(svgText);
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
