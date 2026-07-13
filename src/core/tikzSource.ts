import { getUserSourceLineOffset } from '../latex/latexErrorMapping';
import { SIMPLE_TIKZ_HELPERS } from '../latex/simpleShapes';
import {
	parseDiagramAlign,
	stripDiagramAlignDirective,
	type DiagramAlign,
} from '../utils/diagramAlign';
import { prepareGridForRender } from '../utils/diagramGrid';
import { CAL_MARKER_MAX_RGB, CAL_MARKER_MIN_RGB } from '../utils/coordinatePick';

const DOCUMENTCLASS_LINE = '\\documentclass[tikz,border=5pt]{standalone}\n';

/** Internal defaults for LuaLaTeX RTL/English rendering — not user-configurable. */
const DEFAULT_HEBREW_FONT = 'David CLM';
const DEFAULT_ARABIC_FONT = 'Geeza Pro';
const DEFAULT_ENGLISH_FONT = 'Times New Roman';

function escapeLatexFontName(fontName: string): string {
	return fontName.replace(/\\/g, '\\\\').replace(/[{}]/g, '');
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

function joinPreambleLines(lines: readonly string[]): string {
	return lines.length ? `${lines.join('\n')}\n` : '';
}

function buildLatexWrapperPrefix(
	extraPreamble = '',
	userPackages: readonly string[] = [],
	userLibraries: readonly string[] = [],
): string {
	const hebrewFont = escapeLatexFontName(DEFAULT_HEBREW_FONT);
	const arabicFont = escapeLatexFontName(DEFAULT_ARABIC_FONT);
	const englishFont = escapeLatexFontName(DEFAULT_ENGLISH_FONT);

	return `${DOCUMENTCLASS_LINE}\\usepackage{fontspec}
\\usepackage{polyglossia}

\\setmainlanguage{english}
\\setotherlanguage{hebrew}
\\setotherlanguage{arabic}

\\setmainfont{${englishFont}}
\\newfontfamily\\hebrewfont[Script=Hebrew]{${hebrewFont}}
\\newfontfamily\\hebrewfontsf[Script=Hebrew]{${hebrewFont}}
\\newfontfamily\\hebrewfonttt[Script=Hebrew]{${hebrewFont}}
\\newfontfamily\\arabicfont[Script=Arabic]{${arabicFont}}

${joinPreambleLines(userPackages)}\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,positioning,calc,shapes,decorations.pathmorphing,shapes.gates.logic.US}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{circuitikz}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}
${joinPreambleLines(userLibraries)}
\\newcommand{\\he}[1]{\\texthebrew{#1}}
\\newcommand{\\ar}[1]{\\textarabic{#1}}
${SIMPLE_TIKZ_HELPERS}
${CALIBRATION_PREAMBLE}${extraPreamble.trim() ? `${extraPreamble.trim()}\n` : ''}\\begin{document}
`;
}

const LATEX_WRAPPER_SUFFIX = `
\\end{document}
`;

export function getUserSourceLineOffsetForExtraPreamble(
	extraPreamble = '',
	source = '',
): number {
	const { packages, libraries } = extractUserPreamble(stripUserDocumentPreamble(source));
	return getUserSourceLineOffset(buildLatexWrapperPrefix(extraPreamble, packages, libraries));
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

const USER_PACKAGE_RE = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]+\}/g;
const USER_LIBRARY_RE = /\\(?:usetikzlibrary|usepgfplotslibrary|usegdlibrary)\s*\{[^}]*\}/g;

/** Code portion of a line, up to the first unescaped %. */
function codePartOfLine(line: string): string {
	for (let index = 0; index < line.length; index++) {
		if (line[index] === '%' && (index === 0 || line[index - 1] !== '\\')) {
			return line.slice(0, index);
		}
	}
	return line;
}

/**
 * Pull preamble-only commands out of the user's source so packages such as
 * tikz-cd or tikz-3dplot actually load (they used to be stripped entirely).
 * Commented-out commands are left untouched.
 */
export function extractUserPreamble(source: string): ExtractedUserPreamble {
	const packages: string[] = [];
	const libraries: string[] = [];

	const body = source
		.split('\n')
		.map(line => {
			const code = codePartOfLine(line);
			if (!code.includes('\\use')) {
				return line;
			}
			let newCode = code.replace(USER_PACKAGE_RE, match => {
				packages.push(match);
				return '';
			});
			newCode = newCode.replace(USER_LIBRARY_RE, match => {
				libraries.push(match);
				return '';
			});
			return newCode === code ? line : newCode + line.slice(code.length);
		})
		.join('\n');

	return { packages, libraries, body };
}

export function wrapLatexSource(source: string, extraPreamble = ''): string {
	const { packages, libraries, body } = extractUserPreamble(stripUserDocumentPreamble(source));
	return buildLatexWrapperPrefix(extraPreamble, packages, libraries) + body + LATEX_WRAPPER_SUFFIX;
}
