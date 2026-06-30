import { tidyTikzSource } from './tikzSource';
import { containsRtlText } from './utils/guards';

export type TikzJaxInputMode = 'bare-tikzpicture' | 'full-document' | 'raw';

export interface TikzJaxNormalizedInput {
	/** Full standalone document shown in debug logs. */
	tex: string;
	/** Input passed to node-tikzjax (document body only; engine supplies document class). */
	renderTex: string;
	texPackages: Record<string, string>;
	tikzLibraries: string;
	addToPreamble: string;
	mode: TikzJaxInputMode;
	hebrewNote?: string;
	usesPgfplots: boolean;
	isAdvancedPgfplots: boolean;
}

const LUALATEX_ONLY_PATTERNS: RegExp[] = [
	/\\usepackage(?:\[[^\]]*\])?\{fontspec\}\s*/g,
	/\\usepackage(?:\[[^\]]*\])?\{polyglossia\}\s*/g,
	/\\usepackage(?:\[[^\]]*\])?\{unicode-math\}\s*/g,
	/\\usepackage(?:\[[^\]]*\])?\{siunitx\}\s*/g,
	/\\setmainlanguage\{[^}]+\}\s*/g,
	/\\setotherlanguage\{[^}]+\}\s*/g,
	/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}\s*/g,
	/\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}\s*/g,
	/\\setmonofont(?:\[[^\]]*\])?\{[^}]+\}\s*/g,
	/\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}\s*/g,
	/\\newcommand\{\\he\}(?:\[[^\]]*\])?\{[^}]+\}\s*/g,
	/\\newcommand\{\\ar\}(?:\[[^\]]*\])?\{[^}]+\}\s*/g,
];

export const TIKZJAX_TEX_PACKAGES: Record<string, string> = {
	tikz: '',
	amsmath: '',
	amsfonts: '',
	amssymb: '',
	pgfplots: '',
};

export const TIKZJAX_DEFAULT_LIBRARIES =
	'arrows.meta, positioning, calc, decorations.pathmorphing, decorations.markings, patterns, shapes.geometric, shapes.gates.logic.US, circuits.logic.US';

/** @deprecated Prefer {@link TIKZJAX_DEFAULT_LIBRARIES} in normalized documents. */
export const TIKZJAX_TIKZ_LIBRARIES = TIKZJAX_DEFAULT_LIBRARIES.replace(/\s+/g, '');

const PGFLOTS_BODY_MARKERS = [
	/\\begin\{axis\}/,
	/\\begin\{semilogxaxis\}/,
	/\\begin\{semilogyaxis\}/,
	/\\begin\{loglogaxis\}/,
	/\\addplot\b/,
	/\\addplot3\b/,
	/\\pgfplotsset\b/,
];

const DEFAULT_PGFLOTS_COMPAT = '\\pgfplotsset{compat=1.16}';

const TIKZJAX_RTL_FALLBACK_MACROS = [
	'\\newcommand{\\he}[1]{#1}',
	'\\newcommand{\\ar}[1]{#1}',
].join('\n');

function clampPgfplotsCompatLine(line: string): string {
	return line.replace(/\\pgfplotsset\{compat=1\.18\}/g, '\\pgfplotsset{compat=1.16}');
}

/** TikZJax-only Unicode → LaTeX mapping. Does not alter existing backslash commands. */
export function normalizeUnicodeForTikzJax(source: string): string {
	return source
		.replace(/\u2212/g, '-')
		.replace(/\u00D7/g, '\\times ')
		.replace(/\u00B7/g, '\\cdot ')
		.replace(/\u03A9/g, '\\Omega ')
		.replace(/\u2126/g, '\\Omega ')
		.replace(/\u03C9/g, '\\omega ')
		.replace(/\u03BC/g, '\\mu ')
		.replace(/\u03C0/g, '\\pi ')
		.replace(/\u03B1/g, '\\alpha ')
		.replace(/\u03B2/g, '\\beta ')
		.replace(/\u03B3/g, '\\gamma ')
		.replace(/\u03B4/g, '\\delta ')
		.replace(/\u03B8/g, '\\theta ')
		.replace(/\u03BB/g, '\\lambda ')
		.replace(/\u03C3/g, '\\sigma ');
}

function stripPatterns(source: string, patterns: RegExp[]): string {
	let cleaned = source;
	for (const pattern of patterns) {
		cleaned = cleaned.replace(pattern, '');
	}
	return cleaned;
}

function sourceUsesRtlMacros(source: string): boolean {
	return /\\he\{/.test(source)
		|| /\\ar\{/.test(source)
		|| /\\texthebrew\{/.test(source)
		|| /\\textarabic\{/.test(source);
}

/** TikZJax cannot shape RTL Unicode; keep macros defined but drop RTL glyph content at render time. */
function sanitizeRtlMacroContentForTikzJax(source: string): string {
	return source
		.replace(/\\he\{([^}]*)\}/g, (match, content: string) =>
			containsRtlText(content) ? '\\he{}' : match)
		.replace(/\\ar\{([^}]*)\}/g, (match, content: string) =>
			containsRtlText(content) ? '\\ar{}' : match)
		.replace(/\\texthebrew\{([^}]*)\}/g, (match, content: string) =>
			containsRtlText(content) ? '\\texthebrew{}' : match)
		.replace(/\\textarabic\{([^}]*)\}/g, (match, content: string) =>
			containsRtlText(content) ? '\\textarabic{}' : match);
}

function normalizeOhmCommands(source: string): string {
	return source.replace(/\\ohm\b/g, '\\Omega ');
}

export function sanitizeTikzJaxPreamble(preamble: string): string {
	const trimmed = preamble.trim();
	if (!trimmed) {
		return '';
	}

	return stripPatterns(trimmed, LUALATEX_ONLY_PATTERNS).trim();
}

export function assertTikzJaxNormalizationPreservesLatex(source: string, tex: string): void {
	const requiredCommands = ['\\Omega', '\\omega', '\\pi', '\\theta', '\\lambda', '\\mu', '\\times', '\\cdot'];
	for (const command of requiredCommands) {
		if (source.includes(command) && !tex.includes(command)) {
			throw new Error(`TikZJax normalization corrupted ${command}.`);
		}
	}
}

export function sourceUsesPgfplots(source: string): boolean {
	return PGFLOTS_BODY_MARKERS.some(pattern => pattern.test(source));
}

export function isAdvancedPgfplotsDiagram(source: string): boolean {
	return /\\addplot3\b/.test(source)
		|| /\bsurf\b/.test(source)
		|| /shader\s*=\s*interp/.test(source);
}

function extractUsetikzlibraryLines(source: string): { lines: string[]; remainder: string } {
	const lines: string[] = [];
	const remainder = source.replace(/\\usetikzlibrary\{[^}]+\}\s*/g, match => {
		lines.push(match.trim());
		return '';
	}).replace(/\n{3,}/g, '\n\n').trim();
	return { lines, remainder };
}

function extractPgfplotssetLines(source: string): { lines: string[]; remainder: string } {
	const lines: string[] = [];
	const remainder = source.replace(/\\pgfplotsset\{[^}]*\}\s*/g, match => {
		lines.push(clampPgfplotsCompatLine(match.trim()));
		return '';
	}).replace(/\n{3,}/g, '\n\n').trim();
	return { lines, remainder };
}

function parseUsetikzlibraryLine(line: string): string[] {
	const match = line.match(/\\usetikzlibrary\{([^}]+)\}/);
	if (!match) {
		return [];
	}
	return match[1].split(',').map(part => part.trim()).filter(Boolean);
}

function mergeUsetikzlibraryLines(lines: string[], defaultLibraries: string): string {
	const libraries = new Set<string>();
	for (const line of lines) {
		for (const library of parseUsetikzlibraryLine(line)) {
			libraries.add(library);
		}
	}
	for (const library of defaultLibraries.split(',')) {
		const trimmed = library.trim();
		if (trimmed) {
			libraries.add(trimmed);
		}
	}
	return `\\usetikzlibrary{${[...libraries].join(', ')}}`;
}

function mergePgfplotssetLines(lines: string[]): string[] {
	const merged = [...lines];
	if (!merged.some(line => /compat\s*=/.test(line))) {
		merged.unshift(DEFAULT_PGFLOTS_COMPAT);
	}
	return merged;
}

function hasUsePackage(source: string, packageName: string): boolean {
	return new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${packageName}\\}`).test(source);
}

function buildStandaloneDocument(
	body: string,
	options: {
		usesPgfplots: boolean;
		usetikzlibraryLines: string[];
		pgfplotssetLines: string[];
		extraPreamble?: string;
		usesRtlMacros?: boolean;
	},
): string {
	const preamble: string[] = [
		'\\documentclass{standalone}',
		'\\usepackage{amsmath}',
		'\\usepackage{amssymb}',
		'\\usepackage{tikz}',
	];

	if (options.usesRtlMacros) {
		preamble.push(TIKZJAX_RTL_FALLBACK_MACROS);
	}

	if (options.usesPgfplots) {
		preamble.push('\\usepackage{pgfplots}');
		preamble.push(...mergePgfplotssetLines(options.pgfplotssetLines));
	}

	preamble.push(mergeUsetikzlibraryLines(options.usetikzlibraryLines, TIKZJAX_DEFAULT_LIBRARIES));

	const extra = sanitizeTikzJaxPreamble(options.extraPreamble ?? '');
	if (extra) {
		preamble.push(extra);
	}

	return [
		...preamble,
		'\\begin{document}',
		body.trim(),
		'\\end{document}',
	].join('\n');
}

function buildRenderPayload(
	body: string,
	options: {
		usesPgfplots: boolean;
		usetikzlibraryLines: string[];
		pgfplotssetLines: string[];
		extraPreamble?: string;
		usesRtlMacros?: boolean;
	},
): Pick<TikzJaxNormalizedInput, 'tex' | 'renderTex' | 'texPackages' | 'tikzLibraries' | 'addToPreamble'> {
	const texPackages: Record<string, string> = {
		tikz: '',
		amsmath: '',
		amssymb: '',
	};
	if (options.usesPgfplots) {
		texPackages.pgfplots = '';
	}

	const addToPreambleParts: string[] = [];
	if (options.usesRtlMacros) {
		addToPreambleParts.push(TIKZJAX_RTL_FALLBACK_MACROS);
	}
	if (options.usesPgfplots) {
		addToPreambleParts.push(...mergePgfplotssetLines(options.pgfplotssetLines));
	}
	const extra = sanitizeTikzJaxPreamble(options.extraPreamble ?? '');
	if (extra) {
		addToPreambleParts.push(extra);
	}

	const libraryNames = options.usetikzlibraryLines
		.flatMap(line => parseUsetikzlibraryLine(line));
	for (const library of TIKZJAX_DEFAULT_LIBRARIES.split(',')) {
		const trimmed = library.trim();
		if (trimmed) {
			libraryNames.push(trimmed);
		}
	}
	const tikzLibraries = [...new Set(libraryNames)].join(',');

	const renderBody = options.usesRtlMacros ? sanitizeRtlMacroContentForTikzJax(body) : body;

	return {
		tex: buildStandaloneDocument(body, options),
		renderTex: [
			'\\begin{document}',
			renderBody.trim(),
			'\\end{document}',
		].join('\n'),
		texPackages,
		tikzLibraries,
		addToPreamble: addToPreambleParts.join('\n'),
	};
}

function processFullDocument(
	source: string,
	extraPreamble?: string,
): {
	displayTex: string;
	body: string;
	usesPgfplots: boolean;
	usetikzlibraryLines: string[];
	pgfplotssetLines: string[];
} {
	const sanitized = stripPatterns(source, LUALATEX_ONLY_PATTERNS).trim();
	const beginMarker = '\\begin{document}';
	const beginIndex = sanitized.indexOf(beginMarker);
	if (beginIndex < 0) {
		const usesPgfplots = sourceUsesPgfplots(sanitized);
		const usesRtlMacros = sourceUsesRtlMacros(sanitized);
		const payload = buildRenderPayload(sanitized, {
			usesPgfplots,
			usetikzlibraryLines: [],
			pgfplotssetLines: [],
			extraPreamble,
			usesRtlMacros,
		});
		return {
			displayTex: payload.tex,
			body: sanitized,
			usesPgfplots,
			usetikzlibraryLines: [],
			pgfplotssetLines: [],
		};
	}

	let preamble = sanitized.slice(0, beginIndex).trim();
	let body = sanitized.slice(beginIndex + beginMarker.length);
	body = body.replace(/\\end\{document\}\s*$/, '').trim();

	const bodyLibraries = extractUsetikzlibraryLines(body);
	body = bodyLibraries.remainder;
	const bodyPgfplots = extractPgfplotssetLines(body);
	body = bodyPgfplots.remainder;

	const preambleLibraries = extractUsetikzlibraryLines(preamble);
	preamble = preambleLibraries.remainder;
	const preamblePgfplots = extractPgfplotssetLines(preamble);
	preamble = preamblePgfplots.remainder;

	const usesPgfplots = sourceUsesPgfplots(sanitized);
	const usetikzlibraryLines = [...preambleLibraries.lines, ...bodyLibraries.lines];
	const pgfplotssetLines = [...preamblePgfplots.lines, ...bodyPgfplots.lines];

	if (!hasUsePackage(preamble, 'tikz')) {
		preamble = `${preamble}\n\\usepackage{tikz}`.trim();
	}
	if (usesPgfplots && !hasUsePackage(preamble, 'pgfplots')) {
		preamble = `${preamble}\n\\usepackage{pgfplots}`.trim();
	}
	if (usesPgfplots) {
		preamble = `${preamble}\n${mergePgfplotssetLines(pgfplotssetLines).join('\n')}`.trim();
	}

	preamble = `${preamble}\n${mergeUsetikzlibraryLines(usetikzlibraryLines, TIKZJAX_DEFAULT_LIBRARIES)}`.trim();

	const extra = sanitizeTikzJaxPreamble(extraPreamble ?? '');
	if (extra) {
		preamble = `${preamble}\n${extra}`.trim();
	}

	if (sourceUsesRtlMacros(sanitized)) {
		preamble = `${preamble}\n${TIKZJAX_RTL_FALLBACK_MACROS}`.trim();
	}

	const displayTex = [
		preamble,
		'\\begin{document}',
		body.trim(),
		'\\end{document}',
	].join('\n');

	return {
		displayTex,
		body,
		usesPgfplots,
		usetikzlibraryLines,
		pgfplotssetLines,
	};
}

function prepareBody(source: string): {
	body: string;
	mode: TikzJaxInputMode;
	usetikzlibraryLines: string[];
	pgfplotssetLines: string[];
} {
	const sanitized = stripPatterns(source, LUALATEX_ONLY_PATTERNS).trim();
	const extractedLibraries = extractUsetikzlibraryLines(sanitized);
	const extractedPgfplots = extractPgfplotssetLines(extractedLibraries.remainder);
	let body = extractedPgfplots.remainder.trim();

	let mode: TikzJaxInputMode;
	if (/\\begin\{tikzpicture\}/.test(body)) {
		mode = 'bare-tikzpicture';
	} else {
		mode = 'raw';
		body = `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
	}

	return {
		body,
		mode,
		usetikzlibraryLines: extractedLibraries.lines,
		pgfplotssetLines: extractedPgfplots.lines,
	};
}

/**
 * Build a complete standalone TeX document for TikZJax logging, plus a render payload
 * compatible with node-tikzjax (which prepends packages and supplies standalone class).
 */
export function normalizeForTikzJax(source: string, extraPreamble = ''): TikzJaxNormalizedInput {
	const tidied = tidyTikzSource(source);
	const unicodeNormalized = normalizeUnicodeForTikzJax(tidied);
	const withOhm = normalizeOhmCommands(unicodeNormalized);
	const usesRtlMacros = sourceUsesRtlMacros(withOhm);

	const usesPgfplots = sourceUsesPgfplots(withOhm);
	const isAdvancedPgfplots = isAdvancedPgfplotsDiagram(withOhm);

	let mode: TikzJaxInputMode;
	let payload: Pick<TikzJaxNormalizedInput, 'tex' | 'renderTex' | 'texPackages' | 'tikzLibraries' | 'addToPreamble'>;

	if (/\\documentclass/.test(tidied) && /\\begin\{document\}/.test(tidied)) {
		mode = 'full-document';
		const processed = processFullDocument(withOhm, extraPreamble);
		const renderPayload = buildRenderPayload(processed.body, {
			usesPgfplots: processed.usesPgfplots,
			usetikzlibraryLines: processed.usetikzlibraryLines,
			pgfplotssetLines: processed.pgfplotssetLines,
			extraPreamble,
			usesRtlMacros,
		});
		payload = {
			...renderPayload,
			tex: processed.displayTex,
		};
	} else {
		const prepared = prepareBody(withOhm);
		mode = prepared.mode;
		payload = buildRenderPayload(prepared.body, {
			usesPgfplots: usesPgfplots || sourceUsesPgfplots(prepared.body),
			usetikzlibraryLines: prepared.usetikzlibraryLines,
			pgfplotssetLines: prepared.pgfplotssetLines,
			extraPreamble,
			usesRtlMacros,
		});
	}

	assertTikzJaxNormalizationPreservesLatex(source, payload.tex);

	if (!payload.tex.includes('\\documentclass')) {
		throw new Error('TikZJax normalization did not produce a document class.');
	}
	if (!payload.tex.includes('\\usepackage{tikz}')) {
		throw new Error('TikZJax normalization did not include tikz package.');
	}
	if (usesPgfplots && !payload.tex.includes('\\usepackage{pgfplots}')) {
		throw new Error('TikZJax normalization did not include pgfplots package.');
	}

	return {
		...payload,
		mode,
		usesPgfplots,
		isAdvancedPgfplots,
		hebrewNote: usesRtlMacros
			? 'RTL \\he{...} and \\ar{...} macros use a limited TikZJax fallback. Use Local LuaLaTeX for real Hebrew or Arabic text shaping.'
			: undefined,
	};
}

export function formatTikzJaxInputMode(mode: TikzJaxInputMode): string {
	switch (mode) {
		case 'bare-tikzpicture':
			return 'bare tikzpicture';
		case 'full-document':
			return 'full document (sanitized)';
		default:
			return 'raw (wrapped in tikzpicture)';
	}
}

export function tikzJaxRenderErrorMessage(source: string, fallback = 'TikZJax failed to render this diagram.'): string {
	if (isAdvancedPgfplotsDiagram(source)) {
		return 'TikZJax could not render this PGFPlots diagram. Advanced PGFPlots/3D plots may require Local LuaLaTeX.';
	}
	return fallback;
}
