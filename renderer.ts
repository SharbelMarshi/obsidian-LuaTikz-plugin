import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	RenderTimeoutError,
	execFileWithTimeout,
	formatExecError,
	readLogTail,
	resolveLuaLatex,
	resolvePdfToCairo,
} from './commandResolver';
import {
	formatLatexErrorWithLineMapping,
	mapTidiedLineToNoteLine,
} from './latexErrorMapping';
import { USER_SOURCE_LINE_OFFSET, wrapLatexSource } from './tikzSource';
import type { RenderErrorContext, RenderImageResult } from './types';

const RENDER_TIMEOUT_MS = 60_000;
const CACHE_MAX = 32;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
	svgText: string;
	createdAt: number;
}

function cacheKey(source: string, invertDark: boolean): string {
	return createHash('sha256')
		.update(source)
		.update(invertDark ? ':dark' : ':light')
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

export class TikzRenderer {
	private cache = new Map<string, CacheEntry>();
	private inFlight = new Map<string, Promise<RenderImageResult>>();

	constructor(
		private readonly invertInDarkMode: () => boolean,
		private readonly isDarkTheme: () => boolean,
	) {}

	async renderToSvg(
		source: string,
		errorContext?: RenderErrorContext,
	): Promise<RenderImageResult> {
		const invertDark = this.invertInDarkMode() && this.isDarkTheme();
		const key = cacheKey(source, invertDark);

		const hit = this.cache.get(key);
		if (hit && Date.now() - hit.createdAt <= CACHE_TTL_MS) {
			this.cache.delete(key);
			this.cache.set(key, hit);
			return { ok: true, svgText: hit.svgText, dataUrl: svgDataUrl(hit.svgText) };
		}
		if (hit) {
			this.cache.delete(key);
		}

		const pending = this.inFlight.get(key);
		if (pending !== undefined) {
			return pending;
		}

		const renderPromise = this.compile(source, errorContext, invertDark, key)
			.finally(() => this.inFlight.delete(key));

		this.inFlight.set(key, renderPromise);
		return renderPromise;
	}

	clearCache(): void {
		this.cache.clear();
		this.inFlight.clear();
	}

	private latexError(
		rawError: string,
		source: string,
		errorContext?: RenderErrorContext,
		timedOut = false,
	): RenderImageResult {
		const block = errorContext?.block;
		const editor = errorContext?.editor;
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
			USER_SOURCE_LINE_OFFSET,
			noteLineMapper,
		);

		return {
			ok: false,
			error: timedOut ? 'Timed out.' : mapped.message,
			rawLog: rawError,
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
			const nextKey = this.cache.keys().next();
			if (nextKey.done || nextKey.value === undefined) {
				break;
			}
			this.cache.delete(nextKey.value);
		}
	}

	private async compile(
		source: string,
		errorContext: RenderErrorContext | undefined,
		invertDark: boolean,
		key: string,
	): Promise<RenderImageResult> {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-tikz-'));
		const texPath = path.join(tmpDir, 'diagram.tex');
		const pdfPath = path.join(tmpDir, 'diagram.pdf');
		const logPath = path.join(tmpDir, 'diagram.log');
		const svgPath = path.join(tmpDir, 'diagram.svg');

		try {
			fs.writeFileSync(texPath, wrapLatexSource(source), 'utf8');

			const lualatex = await resolveLuaLatex();
			if (!lualatex) {
				return {
					ok: false,
					error: 'LuaLaTeX not found.',
					rawLog: 'Expected at /Library/TeX/texbin/lualatex\nCheck: which lualatex',
				};
			}

			try {
				await execFileWithTimeout(lualatex, [
					'-interaction=nonstopmode',
					'-halt-on-error',
					`-output-directory=${tmpDir}`,
					texPath,
				], { cwd: tmpDir, maxBuffer: 10 * 1024 * 1024 }, RENDER_TIMEOUT_MS);
			} catch (err) {
				const logTail = readLogTail(logPath);
				const raw = [formatExecError(err), logTail && `\n--- log ---\n${logTail}`]
					.filter(Boolean)
					.join('\n');
				return this.latexError(raw, source, errorContext, err instanceof RenderTimeoutError);
			}

			if (!fs.existsSync(pdfPath)) {
				const logTail = readLogTail(logPath);
				if (logTail) {
					return this.latexError(
						`No PDF produced.\n--- log ---\n${logTail}`,
						source,
						errorContext,
					);
				}
				return { ok: false, error: 'No PDF produced.', rawLog: 'LuaLaTeX exited without diagram.pdf.' };
			}

			const pdftocairo = await resolvePdfToCairo();
			if (!pdftocairo) {
				return {
					ok: false,
					error: 'pdftocairo not found.',
					rawLog: 'Install: brew install poppler',
				};
			}

			try {
				await execFileWithTimeout(pdftocairo, ['-svg', pdfPath, svgPath], {
					cwd: tmpDir,
					maxBuffer: 30 * 1024 * 1024,
				}, RENDER_TIMEOUT_MS);
			} catch (err) {
				return this.latexError(
					formatExecError(err),
					source,
					errorContext,
					err instanceof RenderTimeoutError,
				);
			}

			if (!fs.existsSync(svgPath)) {
				return { ok: false, error: 'No SVG produced.', rawLog: `PDF: ${pdfPath}` };
			}

			let svgText = fs.readFileSync(svgPath, 'utf8');
			if (invertDark) {
				svgText = invertSvgForDarkMode(svgText);
			}

			this.remember(key, svgText);
			return { ok: true, svgText, dataUrl: svgDataUrl(svgText) };
		} finally {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	}
}
