import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { App } from 'obsidian';
import {
	clearPluginTempFsDir,
	ensurePluginTempFsDir,
} from '../pluginPaths';
import {
	RenderTimeoutError,
	formatExecError,
	readLogTail,
	resolveLuaLatex,
	resolvePdfToCairo,
	spawnWithTimeout,
} from '../commandResolver';
import {
	formatLatexErrorWithLineMapping,
	mapTidiedLineToNoteLine,
} from '../latexErrorMapping';
import type { LuaTikzSettings } from '../settingsModel';
import { getUserSourceLineOffsetForExtraPreamble, wrapLatexSource } from '../tikzSource';
import type { RenderRequest, RenderResult } from '../types';
import { sanitizeCacheFilename, validateLualatexPath, firstMapKey } from '../utils/guards';

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
	return createHash('sha256')
		.update(source)
		.update(invertDark ? ':dark' : ':light')
		.update(settings.lualatexPath)
		.update(settings.extraPreamble)
		.update(String(settings.timeoutMs))
		.digest('hex');
}

function svgDataUrl(svgText: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf8').toString('base64')}`;
}

function invertSvgForDarkMode(svg: string): string {
	return svg
		.replaceAll('rgb(0%,0%,0%)', 'rgb(100%,100%,100%)')
		.replace(/rgb[(]0%,[ \t]*0%,[ \t]*0%[)]/g, 'rgb(100%,100%,100%)')
		.replace(/rgb[(]0,[ \t]*0,[ \t]*0[)]/g, 'rgb(255,255,255)')
		.replace(/#000000(?![0-9a-f])/gi, '#ffffff')
		.replace(/#000(?![0-9a-f])/gi, '#fff')
		.replace(/stroke:[ \t]*black/gi, 'stroke:white')
		.replace(/fill:[ \t]*black/gi, 'fill:white')
		.replace(/stroke="black"/gi, 'stroke="white"')
		.replace(/fill="black"/gi, 'fill="white"');
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

function resolvePngOutputPath(workDir: string, jobId: string): string | null {
	const candidates = [
		path.join(workDir, `${jobId}.png`),
		path.join(workDir, `${jobId}-1.png`),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
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
		const editor = errorContext?.editor;
		const lineOffset = getUserSourceLineOffsetForExtraPreamble(settings.extraPreamble);
		const noteLineMapper = block && editor
			? (userLine: number) => mapTidiedLineToNoteLine(
				block.startLine,
				block.endLine,
				line => editor.getLine(line),
				userLine,
			)
			: undefined;

		const mapped = formatLatexErrorWithLineMapping(
			rawError,
			source,
			lineOffset,
			noteLineMapper,
		);

		const body = timedOut
			? rawError
			: [mapped.message, rawError].filter(Boolean).join('\n\n');

		return {
			ok: false,
			engine: 'lualatex',
			error: timedOut ? 'Timed out.' : 'LuaLaTeX failed to compile this diagram.',
			rawLog: debug ? formatCompileDebugLog(debug, body) : body,
			userLine: mapped.userLine,
			noteLine: mapped.noteLine,
			lineContent: mapped.lineContent,
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
			const errorMessage: string = tempDirResult.error;
			return {
				ok: false,
				engine: 'lualatex',
				error: errorMessage,
			};
		}

		const workRoot = tempDirResult.workDir;
		fs.mkdirSync(workRoot, { recursive: true });

		const safeId = sanitizeCacheFilename(key.slice(0, 16));
		const jobId = `luatikz-${safeId}`;
		const workDir = fs.mkdtempSync(path.join(workRoot, `${jobId}-`));
		const texFileName = `${jobId}.tex`;
		const pdfFileName = `${jobId}.pdf`;
		const svgFileName = `${jobId}.svg`;
		const logPath = path.join(workDir, `${jobId}.log`);
		const texPath = path.join(workDir, texFileName);
		const pdfPath = path.join(workDir, pdfFileName);
		const svgPath = path.join(workDir, svgFileName);

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
			fs.writeFileSync(texPath, wrapLatexSource(source, settings.extraPreamble), 'utf8');

			try {
				await spawnWithTimeout(lualatex, [
					'-interaction=nonstopmode',
					'-halt-on-error',
					texFileName,
				], { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }, settings.timeoutMs);
			} catch (err) {
				const logTail = readLogTail(logPath);
				const raw = [formatExecError(err), logTail && `\n--- log ---\n${logTail}`]
					.filter(Boolean)
					.join('\n');
				return this.latexError(raw, source, settings, errorContext, err instanceof RenderTimeoutError, debugInfo);
			}

			if (!fs.existsSync(pdfPath)) {
				const logTail = readLogTail(logPath);
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

				const pngPath = resolvePngOutputPath(workDir, jobId);
				if (!pngPath) {
					return this.latexError(
						'No PNG produced.',
						source,
						settings,
						errorContext,
						false,
						debugInfo,
					);
				}

				const pngData = fs.readFileSync(pngPath);
				const dataUrl = `data:image/png;base64,${pngData.toString('base64')}`;
				return { ok: true, engine: 'lualatex', pngPath, dataUrl };
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

			if (!fs.existsSync(svgPath)) {
				return this.latexError(
					'No SVG produced.',
					source,
					settings,
					errorContext,
					false,
					debugInfo,
				);
			}

			let svgText = fs.readFileSync(svgPath, 'utf8');
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
				fs.rmSync(workDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	}
}
