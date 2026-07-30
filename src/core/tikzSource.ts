import { getUserSourceLineOffset } from '../latex/latexErrorMapping';
import { SIMPLE_TIKZ_HELPERS } from '../latex/simpleShapes';
import {
	parseDiagramAlign,
	stripDiagramAlignDirective,
	type DiagramAlign,
} from '../utils/diagramAlign';
import { prepareGridForRender } from '../utils/diagramGrid';
import { CAL_MARKER_MAX_RGB, CAL_MARKER_MIN_RGB } from '../utils/coordinatePick';
import { containsArabicContent, containsHebrewContent } from '../utils/rtlDetection';
import type { LuaTikzSettings } from '../settings/settingsModel';

const DOCUMENTCLASS_LINE = '\\documentclass[tikz,border=5pt]{standalone}';

/**
 * Font fallback chains, tried in order via `\IfFontExistsTF`. Hardcoding a
 * single macOS font here used to make every render fail on Linux, even for
 * diagrams with no RTL content at all.
 *
 * TeX Gyre Termes is metrically identical to Times New Roman and ships with
 * TeX Live / MiKTeX, so it is available wherever LuaLaTeX is and existing
 * diagrams keep their appearance. If a whole chain misses, nothing is emitted
 * for that script and the compile still succeeds.
 */
const DEFAULT_MAIN_FONT_CHAIN: readonly string[] = ['TeX Gyre Termes'];
const DEFAULT_HEBREW_FONT_CHAIN: readonly string[] = [
	'Noto Serif Hebrew',
	'David CLM',
	'Frank Ruehl CLM',
];
const DEFAULT_ARABIC_FONT_CHAIN: readonly string[] = [
	'Noto Sans Arabic',
	'Geeza Pro',
	'Amiri',
];

const FONT_NAME_MAX_LENGTH = 100;

/**
 * Font names come from settings, so they are pasted straight into
 * `\setmainfont{...}`. Illegal characters are *removed* rather than escaped —
 * an escaped `\%` would not match a real font anyway, and removing `\` and
 * braces makes preamble injection impossible. Control characters matter most:
 * a newline would change the wrapper's line count and silently shift every
 * LaTeX error line number.
 */
export function sanitizeFontName(raw: string): string {
	return raw
		.replace(/[\u0000-\u001F\u007F]/g, ' ')
		.replace(/[\\{}%#$&_~^[\],=]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, FONT_NAME_MAX_LENGTH)
		.trim();
}

/** User override (sanitized) first, then the defaults as fallbacks. */
function resolveFontChain(override: string | undefined, defaults: readonly string[]): string[] {
	const cleaned = sanitizeFontName(override ?? '');
	const chain = cleaned ? [cleaned, ...defaults] : [...defaults];
	return chain.filter((name, index) => chain.indexOf(name) === index);
}

/**
 * Fold a chain into exactly ONE line:
 *   \IfFontExistsTF{A}{<body A>}{\IfFontExistsTF{B}{<body B>}{}}
 * One line per chain keeps the preamble's line count independent of how many
 * fallbacks are configured, which the error line mapping depends on.
 */
function emitFontChainLine(
	chain: readonly string[],
	body: (font: string) => string,
): string {
	return chain.reduceRight(
		(fallback, font) => `\\IfFontExistsTF{${font}}{${body(font)}}{${fallback}}`,
		'',
	);
}

function hebrewFontBody(font: string): string {
	return ['\\hebrewfont', '\\hebrewfontsf', '\\hebrewfonttt']
		.map(family => `\\newfontfamily${family}[Script=Hebrew]{${font}}`)
		.join('');
}

function formatXcolorRgb(rgb: readonly [number, number, number]): string {
	return rgb.join(',');
}

/**
 * Coordinate-pick calibration: each picture appends its bounding box (TeX pt)
 * to \jobname.luatikzbbox and drops two nearly invisible marker dots on the
 * bbox corners. The renderer reads the sidecar file; the click-to-coordinate
 * code locates the dots by their fill colors to map screen px -> TikZ cm.
 * `overlay` + `\pgftransformreset` keep the dots from disturbing the bbox or
 * being displaced by user-level picture transforms such as scale=2.
 */
const CALIBRATION_PREAMBLE = `\\definecolor{luatikzcalmin}{rgb}{${formatXcolorRgb(CAL_MARKER_MIN_RGB)}}
\\definecolor{luatikzcalmax}{rgb}{${formatXcolorRgb(CAL_MARKER_MAX_RGB)}}
\\makeatletter
\\newwrite\\luatikz@bboxout
\\immediate\\openout\\luatikz@bboxout=\\jobname.luatikzbbox\\relax
\\AtEndDocument{\\immediate\\closeout\\luatikz@bboxout}
\\tikzset{every picture/.append style={execute at end picture={%
\\immediate\\write\\luatikz@bboxout{\\the\\pgf@picminx,\\the\\pgf@picminy,\\the\\pgf@picmaxx,\\the\\pgf@picmaxy}%
\\begin{scope}[overlay]%
\\pgftransformreset
\\fill[luatikzcalmin,fill opacity=0.01] (\\pgf@picminx,\\pgf@picminy) circle [radius=0.2pt];
\\fill[luatikzcalmax,fill opacity=0.01] (\\pgf@picmaxx,\\pgf@picmaxy) circle [radius=0.2pt];
\\end{scope}%
}}}
\\makeatother
`;

/** Split a multi-line constant into individual lines so the array stays 1:1 with the output. */
function constantLines(block: string): string[] {
	return block.replace(/\n$/, '').split('\n');
}

const TIKZ_STACK_LINES: readonly string[] = [
	'\\usepackage{tikz}',
	'\\usetikzlibrary{arrows.meta,positioning,calc,shapes,decorations.pathmorphing,shapes.gates.logic.US}',
	'\\usepackage{amsmath}',
	'\\usepackage{amssymb}',
	'\\usepackage{circuitikz}',
	'\\usepackage{pgfplots}',
	'\\pgfplotsset{compat=1.18}',
];

/** Which RTL scripts a source actually uses. Per script: a Hebrew-only diagram
 * must not pull in the Arabic gloss, which minimal TeX installs lack. */
export interface RtlUsage {
	hebrew: boolean;
	arabic: boolean;
}

export function detectRtlUsage(source: string): RtlUsage {
	return {
		hebrew: containsHebrewContent(source),
		arabic: containsArabicContent(source),
	};
}

export interface LatexWrapperOptions {
	extraPreamble?: string;
	/** Replaces the generated preamble entirely when non-empty. */
	customPreamble?: string;
	mainFont?: string;
	hebrewFont?: string;
	arabicFont?: string;
}

/** Single place that maps settings onto wrapper options, so no caller can forget a field. */
export function latexWrapperOptionsFromSettings(
	settings: Pick<LuaTikzSettings,
		'extraPreamble' | 'customPreamble' | 'mainFont' | 'hebrewFont' | 'arabicFont'>,
): LatexWrapperOptions {
	return {
		extraPreamble: settings.extraPreamble,
		customPreamble: settings.customPreamble,
		mainFont: settings.mainFont,
		hebrewFont: settings.hebrewFont,
		arabicFont: settings.arabicFont,
	};
}

interface PrefixInput {
	options: LatexWrapperOptions;
	packages: readonly string[];
	libraries: readonly string[];
	rtl: RtlUsage;
}

/** The managed font + language block, emitted only for the scripts in use. */
function fontAndLanguageLines(options: LatexWrapperOptions, rtl: RtlUsage): string[] {
	const lines = ['\\usepackage{fontspec}'];

	lines.push(emitFontChainLine(
		resolveFontChain(options.mainFont, DEFAULT_MAIN_FONT_CHAIN),
		font => `\\setmainfont{${font}}`,
	));

	if (!rtl.hebrew && !rtl.arabic) {
		return lines;
	}

	lines.push('\\usepackage{polyglossia}', '\\setmainlanguage{english}');
	if (rtl.hebrew) {
		lines.push('\\setotherlanguage{hebrew}');
	}
	if (rtl.arabic) {
		lines.push('\\setotherlanguage{arabic}');
	}

	// Font families come after \setotherlanguage — polyglossia's documented order.
	if (rtl.hebrew) {
		lines.push(emitFontChainLine(
			resolveFontChain(options.hebrewFont, DEFAULT_HEBREW_FONT_CHAIN),
			hebrewFontBody,
		));
	}
	if (rtl.arabic) {
		lines.push(emitFontChainLine(
			resolveFontChain(options.arabicFont, DEFAULT_ARABIC_FONT_CHAIN),
			font => `\\newfontfamily\\arabicfont[Script=Arabic]{${font}}`,
		));
	}

	return lines;
}

/**
 * \he and \ar are always defined so the line count is constant and a stray
 * macro degrades to plain text instead of erroring out.
 */
function rtlMacroLines(rtl: RtlUsage): string[] {
	return [
		rtl.hebrew
			? '\\newcommand{\\he}[1]{\\texthebrew{#1}}'
			: '\\newcommand{\\he}[1]{#1}',
		rtl.arabic
			? '\\newcommand{\\ar}[1]{\\textarabic{#1}}'
			: '\\newcommand{\\ar}[1]{#1}',
	];
}

const LOADS_TIKZ_RE = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*(?:tikz|pgfplots|circuitikz)[^}]*\}/;

/**
 * The user owns this text; nothing is escaped. Only conflicts with the
 * machinery the plugin always appends are repaired: a second \begin{document}
 * would abort the compile, and CALIBRATION_PREAMBLE uses \tikzset and
 * \pgf@picminx so *something* has to load TikZ.
 */
export function sanitizeCustomPreamble(raw: string): string[] {
	// Blanked in place, never collapsed, so the user's own line numbers hold.
	const cleaned = raw
		.replace(/\\begin\{document\}/g, '')
		.replace(/\\end\{document\}/g, '');

	const lines = constantLines(cleaned);
	if (!/\\documentclass/.test(cleaned)) {
		lines.unshift(DOCUMENTCLASS_LINE);
	}
	if (!LOADS_TIKZ_RE.test(cleaned)) {
		lines.push('\\usepackage{tikz}');
	}
	return lines;
}

function buildWrapperPrefixLines(input: PrefixInput): string[] {
	const { options, packages, libraries, rtl } = input;
	const custom = options.customPreamble?.trim() ?? '';
	const lines: string[] = [];

	if (custom) {
		lines.push(...sanitizeCustomPreamble(custom));
		lines.push(...packages, ...libraries);
	} else {
		lines.push(DOCUMENTCLASS_LINE);
		lines.push(...fontAndLanguageLines(options, rtl));
		lines.push(...packages);
		lines.push(...TIKZ_STACK_LINES);
		lines.push(...libraries);
		lines.push(...rtlMacroLines(rtl));
		lines.push(...constantLines(SIMPLE_TIKZ_HELPERS));
	}

	const extra = options.extraPreamble?.trim() ?? '';
	if (extra) {
		lines.push(...constantLines(extra));
	}

	// Always ours, in both modes: coordinate picking depends on it.
	lines.push(...constantLines(CALIBRATION_PREAMBLE));
	lines.push('\\begin{document}');

	return lines;
}

const LATEX_WRAPPER_SUFFIX = `
\\end{document}
`;

export interface WrappedLatexDocument {
	/** Exactly what gets written to disk. */
	tex: string;
	/** Lines of `tex` preceding the user's body. Only valid for THIS tex. */
	userLineOffset: number;
	/** Body as embedded (hoisted commands blanked in place, line count preserved). */
	body: string;
	features: { hebrew: boolean; arabic: boolean; customPreamble: boolean };
}

/**
 * Build the .tex and report where the user's body starts, together.
 *
 * These used to be two exported functions (`wrapLatexSource` and
 * `getUserSourceLineOffsetForExtraPreamble`) that the renderer called
 * separately and that had to agree. They no longer can disagree: there is no
 * way to obtain an offset without the document it belongs to.
 */
export function buildLatexDocument(
	source: string,
	options: LatexWrapperOptions = {},
): WrappedLatexDocument {
	const { packages, libraries, body } = extractUserPreamble(stripUserDocumentPreamble(source));
	const rtl = detectRtlUsage(source);
	const prefix = `${buildWrapperPrefixLines({ options, packages, libraries, rtl }).join('\n')}\n`;

	return {
		tex: prefix + body + LATEX_WRAPPER_SUFFIX,
		// From the joined string, never from lines.length: SIMPLE_TIKZ_HELPERS
		// and CALIBRATION_PREAMBLE are multi-line, so a slot count under-reports.
		userLineOffset: getUserSourceLineOffset(prefix),
		body,
		features: {
			hebrew: rtl.hebrew,
			arabic: rtl.arabic,
			customPreamble: !!options.customPreamble?.trim(),
		},
	};
}

/**
 * The managed preamble with both RTL scripts on, for the settings "Load
 * current preamble" button. Stops before the calibration block, which the
 * plugin always appends and the user cannot usefully edit.
 */
export function buildManagedPreamblePreview(options: LatexWrapperOptions = {}): string {
	const lines = buildWrapperPrefixLines({
		options: { ...options, customPreamble: '', extraPreamble: '' },
		packages: [],
		libraries: [],
		rtl: { hebrew: true, arabic: true },
	});
	const calibrationStart = lines.indexOf(constantLines(CALIBRATION_PREAMBLE)[0]);
	return lines.slice(0, calibrationStart === -1 ? lines.length : calibrationStart).join('\n');
}

export function tidyTikzSource(tikzSource: string): string {
	return tikzSource
		.replaceAll('&nbsp;', '')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.join('\n');
}

export interface PreparedTikzSource {
	renderSource: string;
	diagramAlign: DiagramAlign;
}

export function prepareTikzRenderSource(source: string): PreparedTikzSource {
	const tidied = tidyTikzSource(source);
	const stripped = stripDiagramAlignDirective(tidied);
	return {
		renderSource: prepareGridForRender(stripped),
		diagramAlign: parseDiagramAlign(tidied),
	};
}

/**
 * Drop wrapper-level commands the fixed preamble already provides. Matches are
 * blanked in place (never collapsed) so body line numbers keep matching the
 * user's note for LaTeX error mapping.
 */
function stripUserDocumentPreamble(source: string): string {
	let cleanedSource = source;

	cleanedSource = cleanedSource.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\begin\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\end\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setotherlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}/g, '');

	return cleanedSource;
}

export interface ExtractedUserPreamble {
	/** \usepackage lines, hoisted before circuitikz/pgfplots so user options load first. */
	packages: string[];
	/** \usetikzlibrary / \usepgfplotslibrary / \usegdlibrary, hoisted after all packages. */
	libraries: string[];
	/** Source with hoisted commands blanked in place (line count preserved). */
	body: string;
}

const HOISTED_COMMANDS = [
	'usepackage',
	'usetikzlibrary',
	'usepgfplotslibrary',
	'usegdlibrary',
] as const;

const HOISTED_COMMAND_RE = new RegExp(`^\\\\(${HOISTED_COMMANDS.join('|')})\\b`);

/**
 * Package names people reach for inside `\usetikzlibrary`. TikZ hard-errors on
 * an unknown library ("I did not find the tikz library ..."), and the wrapper
 * preamble already loads every one of these, so they are simply dropped.
 */
const PACKAGES_MISTAKEN_FOR_LIBRARIES = new Set([
	'pgfplots',
	'pgf',
	'tikz',
	'circuitikz',
	'amsmath',
	'amssymb',
	'xcolor',
	'graphicx',
	'standalone',
	'fontspec',
]);

/**
 * PGFPlots ships these as `tikzlibrarypgfplots.<name>.code.tex`, reachable only
 * through `\usepgfplotslibrary`; `\usetikzlibrary{<name>}` errors out. Names
 * that do work through both (dateplot, external, fillbetween, colorbrewer) are
 * deliberately absent so they keep loading the way the user wrote them.
 */
const PGFPLOTS_ONLY_LIBRARIES = new Set([
	'groupplots',
	'colormaps',
	'patchplots',
	'polar',
	'smithchart',
	'statistics',
	'units',
	'ternary',
	'contourlua',
]);

function formatLibraryCommand(command: string, names: readonly string[]): string[] {
	return names.length ? [`\\${command}{${names.join(',')}}`] : [];
}

/**
 * Rewrite a hoisted `\usetikzlibrary` so a stray package or PGFPlots library
 * name cannot abort the whole compile. Other library commands pass through.
 */
export function normalizeUserLibraryCommand(command: string): string[] {
	const match = command.match(/^\\usetikzlibrary\s*\{([^}]*)\}$/);
	if (!match) {
		return [command];
	}

	const tikzLibraries: string[] = [];
	const pgfplotsLibraries: string[] = [];

	for (const raw of match[1].split(',')) {
		const name = raw.trim();
		if (!name || PACKAGES_MISTAKEN_FOR_LIBRARIES.has(name)) {
			continue;
		}
		if (PGFPLOTS_ONLY_LIBRARIES.has(name)) {
			pgfplotsLibraries.push(name);
			continue;
		}
		tikzLibraries.push(name);
	}

	return [
		...formatLibraryCommand('usetikzlibrary', tikzLibraries),
		...formatLibraryCommand('usepgfplotslibrary', pgfplotsLibraries),
	];
}

/** Index just past a balanced `{...}` or `[...]` group starting at `index`, or -1. */
function scanBalancedGroup(source: string, index: number, open: string, close: string): number {
	if (source[index] !== open) {
		return -1;
	}
	let depth = 0;
	for (let cursor = index; cursor < source.length; cursor++) {
		const char = source[cursor];
		if (char === '\\') {
			cursor++;
			continue;
		}
		if (char === open) {
			depth++;
		} else if (char === close) {
			depth--;
			if (depth === 0) {
				return cursor + 1;
			}
		}
	}
	return -1;
}

function skipWhitespace(source: string, index: number): number {
	let cursor = index;
	while (cursor < source.length && /\s/.test(source[cursor])) {
		cursor++;
	}
	return cursor;
}

/** Same line count, so body line numbers keep matching the user's note. */
function blankPreservingLines(text: string): string {
	return '\n'.repeat((text.match(/\n/g) ?? []).length);
}

/**
 * Pull preamble-only commands out of the user's source so packages such as
 * tikz-cd or tikz-3dplot actually load (they used to be stripped entirely).
 *
 * Scans the whole source rather than line by line, because the argument list is
 * commonly spread over several lines:
 *
 *     \usetikzlibrary{
 *       backgrounds,
 *       fit, intersections,
 *     }
 *
 * Commented-out commands are left untouched, and each hoisted command is
 * replaced by the newlines it spanned so the body's line numbering is intact.
 */
export function extractUserPreamble(source: string): ExtractedUserPreamble {
	const packages: string[] = [];
	const libraries: string[] = [];
	const out: string[] = [];

	let cursor = 0;
	while (cursor < source.length) {
		const char = source[cursor];

		if (char === '%' && (cursor === 0 || source[cursor - 1] !== '\\')) {
			const lineEnd = source.indexOf('\n', cursor);
			const stop = lineEnd === -1 ? source.length : lineEnd;
			out.push(source.slice(cursor, stop));
			cursor = stop;
			continue;
		}

		if (char !== '\\') {
			out.push(char);
			cursor++;
			continue;
		}

		const match = HOISTED_COMMAND_RE.exec(source.slice(cursor));
		if (!match) {
			// Skip the escaped character so \\% or \{ cannot be misread.
			out.push(source.slice(cursor, cursor + 2));
			cursor += 2;
			continue;
		}

		let scan = skipWhitespace(source, cursor + match[0].length);
		if (source[scan] === '[') {
			const optionsEnd = scanBalancedGroup(source, scan, '[', ']');
			if (optionsEnd === -1) {
				out.push(source.slice(cursor, cursor + 2));
				cursor += 2;
				continue;
			}
			scan = skipWhitespace(source, optionsEnd);
		}

		const argEnd = scanBalancedGroup(source, scan, '{', '}');
		if (argEnd === -1) {
			out.push(source.slice(cursor, cursor + 2));
			cursor += 2;
			continue;
		}

		const command = source.slice(cursor, argEnd);
		if (match[1] === 'usepackage') {
			packages.push(collapseCommandWhitespace(command));
		} else {
			libraries.push(...normalizeUserLibraryCommand(collapseCommandWhitespace(command)));
		}
		out.push(blankPreservingLines(command));
		cursor = argEnd;
	}

	return { packages, libraries, body: out.join('') };
}

/** Fold a hoisted command onto one preamble line; the offset depends on it. */
function collapseCommandWhitespace(command: string): string {
	return command.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

