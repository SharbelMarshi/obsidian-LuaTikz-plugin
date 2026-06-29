import { tidyTikzSource } from './tikzSource';

export type TikzJaxInputMode = 'bare-tikzpicture' | 'full-document' | 'raw';

export interface TikzJaxNormalizedInput {
	tex: string;
	mode: TikzJaxInputMode;
	hebrewNote?: string;
}

const LUALATEX_ONLY_PATTERNS: RegExp[] = [
	/\\usepackage(?:\[[^\]]*\])?\{fontspec\}\n?/g,
	/\\usepackage(?:\[[^\]]*\])?\{polyglossia\}\n?/g,
	/\\usepackage(?:\[[^\]]*\])?\{unicode-math\}\n?/g,
	/\\usepackage(?:\[[^\]]*\])?\{siunitx\}\n?/g,
	/\\setmainlanguage\{[^}]+\}\n?/g,
	/\\setotherlanguage\{[^}]+\}\n?/g,
	/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\setmonofont(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\newcommand\{\\he\}(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
];

const TIKZJAX_UNSUPPORTED_PATTERNS: RegExp[] = [
	/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\begin\{document\}\n?/g,
	/\\end\{document\}\n?/g,
];

export const TIKZJAX_TEX_PACKAGES: Record<string, string> = {
	tikz: '',
	amsmath: '',
	amsfonts: '',
	amssymb: '',
};

export const TIKZJAX_TIKZ_LIBRARIES =
	'arrows.meta,positioning,calc,decorations.pathmorphing,decorations.pathreplacing,patterns,shapes.geometric,circuits.logic.US';

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

function replaceHebrewMacros(source: string): { text: string; converted: boolean } {
	let converted = false;
	const text = source
		.replace(/\\he\{([^}]*)\}/g, (_match, content: string) => {
			converted = true;
			return content;
		})
		.replace(/\\texthebrew\{([^}]*)\}/g, (_match, content: string) => {
			converted = true;
			return content;
		});
	return { text, converted };
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

/**
 * Minimal TikZJax-compatible input. node-tikzjax prepends its own preamble from
 * texPackages/tikzLibraries — pass only a document body, not \\documentclass.
 */
export function normalizeForTikzJax(source: string): TikzJaxNormalizedInput {
	const tidied = tidyTikzSource(source);
	const unicodeNormalized = normalizeUnicodeForTikzJax(tidied);
	const withOhm = normalizeOhmCommands(unicodeNormalized);
	const { text: withoutHebrewMacros, converted: hebrewConverted } = replaceHebrewMacros(withOhm);
	const sanitized = stripPatterns(
		stripPatterns(withoutHebrewMacros, LUALATEX_ONLY_PATTERNS),
		TIKZJAX_UNSUPPORTED_PATTERNS,
	).trim();

	let mode: TikzJaxInputMode;
	let body: string;

	if (/\\documentclass/.test(tidied)) {
		mode = 'full-document';
		body = sanitized;
	} else if (/\\begin\{tikzpicture\}/.test(sanitized)) {
		mode = 'bare-tikzpicture';
		body = sanitized;
	} else {
		mode = 'raw';
		body = `\\begin{tikzpicture}\n${sanitized}\n\\end{tikzpicture}`;
	}

	const tex = [
		'\\begin{document}',
		body,
		'\\end{document}',
	].join('\n');

	assertTikzJaxNormalizationPreservesLatex(source, tex);

	return {
		tex,
		mode,
		hebrewNote: hebrewConverted
			? 'Hebrew \\he{...} macros were converted to plain text. Use Local LuaLaTeX for full Hebrew support.'
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
