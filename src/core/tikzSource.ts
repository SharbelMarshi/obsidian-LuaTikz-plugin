import { getUserSourceLineOffset } from '../latex/latexErrorMapping';
import { SIMPLE_TIKZ_HELPERS } from '../latex/simpleShapes';
import {
	parseDiagramAlign,
	stripDiagramAlignDirective,
	type DiagramAlign,
} from '../utils/diagramAlign';
import { prepareGridForRender } from '../utils/diagramGrid';

const DOCUMENTCLASS_LINE = '\\documentclass[tikz,border=5pt]{standalone}\n';

/** Internal defaults for LuaLaTeX RTL/English rendering — not user-configurable. */
const DEFAULT_HEBREW_FONT = 'David CLM';
const DEFAULT_ARABIC_FONT = 'Geeza Pro';
const DEFAULT_ENGLISH_FONT = 'Times New Roman';

function escapeLatexFontName(fontName: string): string {
	return fontName.replace(/\\/g, '\\\\').replace(/[{}]/g, '');
}

function buildLatexWrapperPrefix(extraPreamble = ''): string {
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

\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,positioning,calc,shapes,decorations.pathmorphing,shapes.gates.logic.US}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{circuitikz}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}

\\newcommand{\\he}[1]{\\texthebrew{#1}}
\\newcommand{\\ar}[1]{\\textarabic{#1}}
${SIMPLE_TIKZ_HELPERS}
${extraPreamble.trim() ? `${extraPreamble.trim()}\n` : ''}\\begin{document}
`;
}

const LATEX_WRAPPER_SUFFIX = `
\\end{document}
`;

export function getUserSourceLineOffsetForExtraPreamble(extraPreamble = ''): number {
	return getUserSourceLineOffset(buildLatexWrapperPrefix(extraPreamble));
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

function stripUserDocumentPreamble(source: string): string {
	let cleanedSource = source;

	cleanedSource = cleanedSource.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\pgfplotsset\{[^}]*\}/g, '');
	cleanedSource = cleanedSource.replace(/\\begin\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\end\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setotherlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}/g, '');

	return cleanedSource.trim();
}

export function wrapLatexSource(source: string, extraPreamble = ''): string {
	return buildLatexWrapperPrefix(extraPreamble) + stripUserDocumentPreamble(source) + LATEX_WRAPPER_SUFFIX;
}

