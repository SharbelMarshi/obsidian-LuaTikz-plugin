import { getUserSourceLineOffset } from './latexErrorMapping';
import { SIMPLE_TIKZ_HELPERS } from './simpleShapes';

const DOCUMENTCLASS_LINE = '\\documentclass[tikz,border=5pt]{standalone}\n';

export const LATEX_WRAPPER_PREFIX = `${DOCUMENTCLASS_LINE}\\usepackage{fontspec}
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

export const USER_SOURCE_LINE_OFFSET = getUserSourceLineOffset(LATEX_WRAPPER_PREFIX);

export function tidyTikzSource(tikzSource: string): string {
	return tikzSource
		.replaceAll('&nbsp;', '')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.join('\n');
}

export function wrapLatexSource(source: string): string {
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

	return LATEX_WRAPPER_PREFIX + cleanedSource.trim() + LATEX_WRAPPER_SUFFIX;
}
