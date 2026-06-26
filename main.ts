import {
	Editor,
	MarkdownView,
	Notice,
	Plugin,
} from 'obsidian';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { latexAutocompleteExtension } from "./latexAutocomplete";
import {
	formatLatexErrorWithLineMapping,
	getUserSourceLineOffset,
	mapTidiedLineToNoteLine,
} from "./latexErrorMapping";
import { SIMPLE_TIKZ_HELPERS } from "./simpleShapes";
import { TikzjaxSettingTab } from "./settings";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface TikzjaxPluginSettings {
    invertColorsInDarkMode: boolean;
    inlineLivePreviewEnabledByDefault: boolean;
}

interface RenderImageResult {
	ok: boolean;
	dataUrl?: string;
	svgText?: string;
	error?: string;
	rawLog?: string;
	userLine?: number;
	noteLine?: number;
	lineContent?: string;
}

interface RenderErrorContext {
	block?: TikzBlock;
	editor?: Editor;
}

interface TikzBlock {
	source: string;
	startLine: number;
	endLine: number;
}

const DEFAULT_SETTINGS: TikzjaxPluginSettings = {
    invertColorsInDarkMode: true,
    inlineLivePreviewEnabledByDefault: true,
};

const execFileAsync = promisify(execFile);

const DOCUMENTCLASS_LINE = '\\documentclass[tikz,border=5pt]{standalone}\n';
const LATEX_WRAPPER_PREFIX = `${DOCUMENTCLASS_LINE}\\usepackage{fontspec}
\\usepackage{polyglossia}

\\setmainlanguage{english}
\\setotherlanguage{hebrew}

\\newfontfamily\\hebrewfont[Script=Hebrew]{David CLM}
\\newfontfamily\\hebrewfontsf[Script=Hebrew]{David CLM}
\\newfontfamily\\hebrewfonttt[Script=Hebrew]{David CLM}

\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,positioning,calc,shapes,decorations.pathmorphing,shapes.gates.logic.US}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{circuitikz}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}

\\newcommand{\\he}[1]{\\texthebrew{#1}}
${SIMPLE_TIKZ_HELPERS}
\\begin{document}
`;

const LATEX_WRAPPER_SUFFIX = `
\\end{document}
`;

const USER_SOURCE_LINE_OFFSET = getUserSourceLineOffset(LATEX_WRAPPER_PREFIX);

async function fileExists(filePath: string): Promise<boolean> {
	return fs.existsSync(filePath);
}

async function resolveCommand(commandName: string, candidates: string[]): Promise<string | null> {
	for (const candidate of candidates) {
		if (candidate.includes('/')) {
			if (await fileExists(candidate)) {
				return candidate;
			}
			continue;
		}

		try {
			const { stdout } = await execFileAsync('/usr/bin/which', [candidate]);
			const resolved = stdout.trim();
			if (resolved) {
				return resolved;
			}
		} catch {
			// continue
		}
	}

	return null;
}

async function resolveLuaLatex(): Promise<string | null> {
	return resolveCommand('lualatex', [
		'/Library/TeX/texbin/lualatex',
		'/usr/local/texlive/2025/bin/universal-darwin/lualatex',
		'/usr/local/bin/lualatex',
		'lualatex',
	]);
}

async function resolvePdfToCairo(): Promise<string | null> {
	return resolveCommand('pdftocairo', [
		'/opt/homebrew/bin/pdftocairo',
		'/usr/local/bin/pdftocairo',
		'/usr/bin/pdftocairo',
		'pdftocairo',
	]);
}

function wrapLatexSource(source: string): string {
	let cleanedSource = source;

	// Remove full-document wrappers from old TikZJax-style blocks.
	cleanedSource = cleanedSource.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\pgfplotsset\{[^}]*\}/g, '');
	cleanedSource = cleanedSource.replace(/\\begin\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\end\{document\}/g, '');

	// Remove language/font commands if the note already contains them.
	// The plugin owns the LuaLaTeX preamble.
	cleanedSource = cleanedSource.replace(/\\setmainlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setotherlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}/g, '');

	return LATEX_WRAPPER_PREFIX + cleanedSource.trim() + LATEX_WRAPPER_SUFFIX;
}

function readLogTail(logPath: string, maxChars = 8000): string {
	if (!fs.existsSync(logPath)) {
		return '';
	}

	const log = fs.readFileSync(logPath, 'utf8');
	if (log.length <= maxChars) {
		return log;
	}

	return '...(truncated)...\n' + log.slice(-maxChars);
}

function formatExecError(err: unknown): string {
	if (err instanceof Error) {
		const execErr = err as Error & { stdout?: string; stderr?: string };
		const parts = [execErr.message];
		if (execErr.stdout) {
			parts.push(execErr.stdout);
		}
		if (execErr.stderr) {
			parts.push(execErr.stderr);
		}
		return parts.join('\n');
	}

	return String(err);
}

function getCurrentTikzBlock(editor: Editor): TikzBlock | null {
	const cursor = editor.getCursor();
	const lineCount = editor.lineCount();

	let startLine = -1;

	for (let line = cursor.line; line >= 0; line--) {
		const text = editor.getLine(line).trim();

		if (text.startsWith('```tikz')) {
			startLine = line;
			break;
		}

		if (text === '```') {
			return null;
		}
	}

	if (startLine === -1) {
		return null;
	}

	let endLine = -1;

	for (let line = startLine + 1; line < lineCount; line++) {
		const text = editor.getLine(line).trim();

		if (text === '```') {
			endLine = line;
			break;
		}
	}

	if (endLine === -1) {
		return null;
	}

	if (cursor.line <= startLine || cursor.line >= endLine) {
		return null;
	}

	const source = editor.getRange(
		{ line: startLine + 1, ch: 0 },
		{ line: endLine, ch: 0 }
	);

	return {
		source,
		startLine,
		endLine,
	};
}

export default class TikzjaxHebrewLocalPlugin extends Plugin {
	settings: TikzjaxPluginSettings = DEFAULT_SETTINGS;

	inlinePreviewEnabled = false;
	inlinePreviewContainer: HTMLElement | null = null;
	inlinePreviewTimer: number | null = null;
	inlinePreviewLastGoodDataUrl: string | null = null;
	inlinePreviewLastSource: string | null = null;
	inlinePreviewRenderToken = 0;

	async onload() {
		await this.loadSettings();
		this.registerEditorExtension(latexAutocompleteExtension());

		this.addCommand({
			id: 'toggle-tikz-inline-live-preview',
			name: 'LuaTikZ: Toggle inline live preview',
			callback: () => {
				this.toggleInlineLivePreview();
			},
		});

		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.scheduleInlinePreviewUpdate();
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.scheduleInlinePreviewUpdate();
			})
		);

		this.registerDomEvent(document, 'selectionchange', () => {
			this.scheduleInlinePreviewUpdate();
		});

		this.addSettingTab(new TikzjaxSettingTab(this.app, this));
		this.addSyntaxHighlighting();
		this.registerTikzCodeBlock();

		if (this.settings.inlineLivePreviewEnabledByDefault) {
			this.inlinePreviewEnabled = true;
			this.scheduleInlinePreviewUpdate(500);
		}
	}

	onunload() {
		this.removeSyntaxHighlighting();
		this.disableInlineLivePreview();

		if (this.inlinePreviewTimer) {
			window.clearTimeout(this.inlinePreviewTimer);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	registerTikzCodeBlock() {
		this.registerMarkdownCodeBlockProcessor("tikz", async (source, el) => {
			el.empty();
			const loadingEl = el.createDiv({ cls: 'tikzjax-hebrew-local-output' });
			loadingEl.setText('Rendering TikZ diagram…');
			try {
				const cleanedSource = this.tidyTikzSource(source);

				if (!cleanedSource.trim()) {
					this.showError(el, 'Nothing to render.');
					return;
				}

				await this.renderTikz(cleanedSource, el);
			} catch (err) {
				this.showError(el, 'Render error.', formatExecError(err));
			}
		});
	}

	toggleInlineLivePreview(): void {
		if (this.inlinePreviewEnabled) {
			this.disableInlineLivePreview();
			new Notice('LuaTikZ inline live preview disabled.');
			return;
		}

		this.inlinePreviewEnabled = true;
		new Notice('LuaTikZ inline live preview enabled.');
		this.scheduleInlinePreviewUpdate(0);
	}

	disableInlineLivePreview(): void {
		this.inlinePreviewEnabled = false;
		this.inlinePreviewLastGoodDataUrl = null;
		this.inlinePreviewLastSource = null;

		if (this.inlinePreviewTimer) {
			window.clearTimeout(this.inlinePreviewTimer);
			this.inlinePreviewTimer = null;
		}

		if (this.inlinePreviewContainer) {
			this.inlinePreviewContainer.remove();
			this.inlinePreviewContainer = null;
		}
	}

	scheduleInlinePreviewUpdate(delay = 800): void {
		if (!this.inlinePreviewEnabled) {
			return;
		}

		if (this.inlinePreviewTimer) {
			window.clearTimeout(this.inlinePreviewTimer);
		}

		this.inlinePreviewTimer = window.setTimeout(() => {
			this.updateInlinePreviewFromActiveEditor();
		}, delay);
	}

	private getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	private getOrCreateInlinePreviewContainer(markdownView: MarkdownView): HTMLElement {
		if (this.inlinePreviewContainer && document.body.contains(this.inlinePreviewContainer)) {
			return this.inlinePreviewContainer;
		}

		const container = markdownView.containerEl.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview',
		});

		this.inlinePreviewContainer = container;
		return container;
	}

	private hideInlinePreview(): void {
		if (this.inlinePreviewContainer) {
			this.inlinePreviewContainer.remove();
			this.inlinePreviewContainer = null;
		}
	}

	private showInlineMessage(markdownView: MarkdownView, message: string): void {
		const container = this.getOrCreateInlinePreviewContainer(markdownView);
		container.empty();
		container.createDiv({
			cls: 'tikzjax-hebrew-local-inline-preview-message',
			text: message,
		});
	}

	private showInlineImage(markdownView: MarkdownView, dataUrl: string): void {
		const container = this.getOrCreateInlinePreviewContainer(markdownView);
		container.empty();

		const output = container.createDiv({
			cls: 'tikzjax-hebrew-local-output',
		});

		const img = output.createEl('img');
		img.setAttr('src', dataUrl);
		img.setAttr('alt', 'TikZ diagram');
		img.addClass('tikzjax-hebrew-local-image');
	}

	private showInlineError(markdownView: MarkdownView, message: string, details?: string): void {
		const container = this.getOrCreateInlinePreviewContainer(markdownView);

		const errorEl = container.createDiv({
			cls: 'tikzjax-hebrew-local-error tikzjax-hebrew-local-inline-preview-error',
		});

		const titleEl = errorEl.createDiv({
			cls: 'tikzjax-hebrew-local-error-title',
		});

		titleEl.setText(message);

		if (!details) {
			return;
		}

		const buttonRow = errorEl.createDiv({
			cls: 'tikzjax-hebrew-local-error-button-row',
		});

		const copyButton = buttonRow.createEl('button', {
			text: 'Copy error',
			cls: 'tikzjax-hebrew-local-error-button',
		});

		copyButton.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(details);
				new Notice('LuaTikZ error copied.');
			} catch {
				new Notice('Could not copy error.');
			}
		});

		const button = buttonRow.createEl('button', {
			text: 'Show full error',
			cls: 'tikzjax-hebrew-local-error-button',
		});

		const detailsEl = errorEl.createEl('pre', {
			cls: 'tikzjax-hebrew-local-error-details',
		});

		detailsEl.setText(details);
		detailsEl.style.display = 'none';

		button.addEventListener('click', () => {
			const isHidden = detailsEl.style.display === 'none';
			detailsEl.style.display = isHidden ? 'block' : 'none';
			button.setText(isHidden ? 'Hide full error' : 'Show full error');
		});
	}

	async updateInlinePreviewFromActiveEditor(): Promise<void> {
		if (!this.inlinePreviewEnabled) {
			return;
		}

		const markdownView = this.getActiveMarkdownView();

		if (!markdownView) {
			this.hideInlinePreview();
			return;
		}

		const block = getCurrentTikzBlock(markdownView.editor);

		if (!block) {
			this.hideInlinePreview();
			return;
		}

		const cleanedSource = this.tidyTikzSource(block.source);

		if (!cleanedSource.trim()) {
			this.showInlineMessage(markdownView, 'Nothing to render.');
			return;
		}

		if (cleanedSource === this.inlinePreviewLastSource && this.inlinePreviewLastGoodDataUrl) {
			return;
		}

		const token = ++this.inlinePreviewRenderToken;

		if (!this.inlinePreviewLastGoodDataUrl) {
			this.showInlineMessage(markdownView, 'Rendering TikZ diagram…');
		}

		const result = await this.renderTikzToSvgDataUrl(cleanedSource, {
			block,
			editor: markdownView.editor,
		});

		if (token !== this.inlinePreviewRenderToken) {
			return;
		}

		if (result.ok && result.dataUrl) {
			this.inlinePreviewLastSource = cleanedSource;
			this.inlinePreviewLastGoodDataUrl = result.dataUrl;
			this.showInlineImage(markdownView, result.dataUrl);
			return;
		}

		if (this.inlinePreviewLastGoodDataUrl) {
			this.showInlineImage(markdownView, this.inlinePreviewLastGoodDataUrl);
			this.showInlineError(markdownView, result.error ?? 'Render error.', result.rawLog);
			return;
		}

		const container = this.getOrCreateInlinePreviewContainer(markdownView);
		container.empty();
		this.showInlineError(markdownView, result.error ?? 'Render error.', result.rawLog);
	}

	private buildLatexErrorResult(
		rawError: string,
		tidiedSource: string,
		errorContext?: RenderErrorContext,
	): RenderImageResult {
		const noteLineMapper = errorContext?.block && errorContext.editor
			? (userLine: number) => mapTidiedLineToNoteLine(
				errorContext.block!.startLine,
				errorContext.block!.endLine,
				line => errorContext.editor!.getLine(line),
				userLine,
			)
			: undefined;

		const mapped = formatLatexErrorWithLineMapping(
			rawError,
			tidiedSource,
			USER_SOURCE_LINE_OFFSET,
			noteLineMapper,
		);

		return {
			ok: false,
			error: mapped.message,
			rawLog: rawError,
			userLine: mapped.userLine,
			noteLine: mapped.noteLine,
			lineContent: mapped.lineContent,
		};
	}

	async renderTikzToSvgDataUrl(
		source: string,
		errorContext?: RenderErrorContext,
	): Promise<RenderImageResult> {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-tikz-hebrew-'));
		const texPath = path.join(tmpDir, 'diagram.tex');
		const pdfPath = path.join(tmpDir, 'diagram.pdf');
		const logPath = path.join(tmpDir, 'diagram.log');
		const svgPath = path.join(tmpDir, 'diagram.svg');

		const wrappedSource = wrapLatexSource(source);
		fs.writeFileSync(texPath, wrappedSource, 'utf8');

		const lualatexPath = await resolveLuaLatex();

		if (!lualatexPath) {
			this.cleanupTempDir(tmpDir);
			return {
				ok: false,
				error: 'LuaLaTeX was not found.',
				rawLog: 'On macOS, LuaLaTeX is usually located at:\n/Library/TeX/texbin/lualatex\n\nCheck in Terminal with:\nwhich lualatex',
			};
		}

		try {
			await execFileAsync(lualatexPath, [
				'-interaction=nonstopmode',
				'-halt-on-error',
				`-output-directory=${tmpDir}`,
				texPath,
			], {
				cwd: tmpDir,
				maxBuffer: 10 * 1024 * 1024,
			});
		} catch (err) {
			const logTail = readLogTail(logPath);
			const rawError = [
				formatExecError(err),
				logTail ? '\n--- diagram.log (tail) ---\n' + logTail : '',
			].join('\n');

			const errorResult = this.buildLatexErrorResult(rawError, source, errorContext);
			this.cleanupTempDir(tmpDir);
			return errorResult;
		}

		if (!fs.existsSync(pdfPath)) {
			const logTail = readLogTail(logPath);
			const details = [
				'LuaLaTeX finished but diagram.pdf was not produced.',
			];

			if (logTail) {
				details.push('', '--- diagram.log (tail) ---', logTail);
				const errorResult = this.buildLatexErrorResult(details.join('\n'), source, errorContext);
				this.cleanupTempDir(tmpDir);
				return errorResult;
			}

			this.cleanupTempDir(tmpDir);

			return {
				ok: false,
				error: 'LuaLaTeX finished, but no PDF was produced.',
				rawLog: details.join('\n'),
			};
		}

		const pdftocairoPath = await resolvePdfToCairo();

		if (!pdftocairoPath) {
			this.cleanupTempDir(tmpDir);
			return {
				ok: false,
				error: 'PDF rendered, but SVG conversion is not available.',
				rawLog: `pdftocairo was not found.

Install it with:
brew install poppler

PDF path: ${pdfPath}`,
			};
		}

		try {
			await execFileAsync(pdftocairoPath, [
				'-svg',
				pdfPath,
				svgPath,
			], {
				cwd: tmpDir,
				maxBuffer: 30 * 1024 * 1024,
			});
		} catch (err) {
			this.cleanupTempDir(tmpDir);
			return {
				ok: false,
				error: 'PDF rendered, but SVG conversion failed.',
				rawLog: `PDF path: ${pdfPath}

${formatExecError(err)}`,
			};
		}

		if (!fs.existsSync(svgPath)) {
			this.cleanupTempDir(tmpDir);
			return {
				ok: false,
				error: 'PDF rendered, but no SVG was produced.',
				rawLog: `PDF path: ${pdfPath}`,
			};
		}

		let svgText = fs.readFileSync(svgPath, 'utf8');

		if (this.shouldConvertBlackToWhite()) {
			svgText = this.convertBlackSvgToWhite(svgText);
		}

		const svgBase64 = Buffer.from(svgText, 'utf8').toString('base64');
		this.cleanupTempDir(tmpDir);

		return {
			ok: true,
			dataUrl: `data:image/svg+xml;base64,${svgBase64}`,
			svgText,
		};
	}

	private downloadSvg(svgText: string, filename = 'tikz-diagram.svg'): void {
		const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.style.display = 'none';
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	private createDiagramToolbar(parent: HTMLElement, svgText: string): void {
		const toolbar = parent.createDiv({ cls: 'tikzjax-hebrew-local-toolbar' });

		const exportButton = toolbar.createEl('button', {
			text: 'Export SVG',
			cls: 'tikzjax-hebrew-local-toolbar-button',
		});

		exportButton.addEventListener('click', () => {
			this.downloadSvg(svgText);
			new Notice('TikZ diagram exported as SVG.');
		});

		const copyButton = toolbar.createEl('button', {
			text: 'Copy SVG',
			cls: 'tikzjax-hebrew-local-toolbar-button',
		});

		copyButton.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(svgText);
				new Notice('TikZ SVG copied to clipboard.');
			} catch {
				new Notice('Could not copy SVG.');
			}
		});
	}

	private cleanupTempDir(tmpDir: string): void {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
	private shouldConvertBlackToWhite(): boolean {
    return this.settings.invertColorsInDarkMode &&
        document.body.classList.contains('theme-dark');
	}

	private convertBlackSvgToWhite(svg: string): string {
		return svg
			.replaceAll('rgb(0%,0%,0%)', 'rgb(100%,100%,100%)')
			.replace(new RegExp('rgb[(]0%,[ \\t]*0%,[ \\t]*0%[)]', 'g'), 'rgb(100%,100%,100%)')
			.replace(new RegExp('rgb[(]0,[ \\t]*0,[ \\t]*0[)]', 'g'), 'rgb(255,255,255)')
			.replace(new RegExp('#000000(?![0-9a-f])', 'gi'), '#ffffff')
			.replace(new RegExp('#000(?![0-9a-f])', 'gi'), '#fff')
			.replace(new RegExp('stroke:[ \\t]*black', 'gi'), 'stroke:white')
			.replace(new RegExp('fill:[ \\t]*black', 'gi'), 'fill:white')
			.replace(new RegExp('stroke="black"', 'gi'), 'stroke="white"')
			.replace(new RegExp('fill="black"', 'gi'), 'fill="white"');
		}

	async renderTikz(source: string, el: HTMLElement): Promise<void> {
		const result = await this.renderTikzToSvgDataUrl(source);

		if (!result.ok || !result.dataUrl || !result.svgText) {
			this.showError(el, result.error ?? 'Render error.', result.rawLog);
			return;
		}

		el.empty();
		const block = el.createDiv({ cls: 'tikzjax-hebrew-local-block' });
		this.createDiagramToolbar(block, result.svgText);

		const container = block.createDiv({ cls: 'tikzjax-hebrew-local-output' });
		const img = container.createEl('img');
		img.setAttr('src', result.dataUrl);
		img.setAttr('alt', 'TikZ diagram');
		img.addClass('tikzjax-hebrew-local-image');
	}

	showError(el: HTMLElement, message: string, details?: string): void {
		el.empty();

		const errorEl = el.createDiv({ cls: 'tikzjax-hebrew-local-error' });

		const titleEl = errorEl.createDiv({ cls: 'tikzjax-hebrew-local-error-title' });
		titleEl.setText(message);

		if (!details) {
			return;
		}

		const buttonRow = errorEl.createDiv({
			cls: 'tikzjax-hebrew-local-error-button-row',
		});

		const copyButton = buttonRow.createEl('button', {
			text: 'Copy error',
			cls: 'tikzjax-hebrew-local-error-button',
		});

		copyButton.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(details);
				new Notice('LuaTikZ error copied.');
			} catch {
				new Notice('Could not copy error.');
			}
		});

		const button = buttonRow.createEl('button', {
			text: 'Show full error',
			cls: 'tikzjax-hebrew-local-error-button',
		});

		const detailsEl = errorEl.createEl('pre', {
			cls: 'tikzjax-hebrew-local-error-details',
		});

		detailsEl.setText(details);
		detailsEl.style.display = 'none';

		button.addEventListener('click', () => {
			const isHidden = detailsEl.style.display === 'none';
			detailsEl.style.display = isHidden ? 'block' : 'none';
			button.setText(isHidden ? 'Hide full error' : 'Show full error');
		});
	}

	addSyntaxHighlighting() {
		// @ts-ignore
		window.CodeMirror.modeInfo.push({name: "Tikz", mime: "text/x-latex", mode: "stex"});
	}

	removeSyntaxHighlighting() {
		// @ts-ignore
		window.CodeMirror.modeInfo = window.CodeMirror.modeInfo.filter(el => el.name != "Tikz");
	}

	tidyTikzSource(tikzSource: string) {
		const remove = "&nbsp;";
		tikzSource = tikzSource.replaceAll(remove, "");

		let lines = tikzSource.split("\n");
		lines = lines.map(line => line.trim());
		lines = lines.filter(line => line);

		return lines.join("\n");
	}
}
