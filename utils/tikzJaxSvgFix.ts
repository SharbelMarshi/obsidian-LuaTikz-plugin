/** Repair TikZJax SVG text nodes when TeX math fonts map to wrong Unicode glyphs. */

const CMMI10_GLYPH_MAP: Record<string, string> = {
	'\u00B5': '\u03B8',
	'\u00B8': '\u03BB',
	'\u00B9': '\u03BC',
	'\u00AE': '\u03B1',
	'\u00AF': '\u03B2',
	'\u00B0': '\u03B3',
	'\u00B1': '\u03B4',
	'\u00BE': '\u03C3',
	'\u0021': '\u03C9',
	'\u00BC': '\u03C0',
	'\u003A': '.',
};

const CMR10_GLYPH_MAP: Record<string, string> = {
	'\u00AC': '\u03A9',
};

const CMSY10_GLYPH_MAP: Record<string, string> = {
	'\u00A1': '-',
	'\u2212': '-',
	'\u2219': '\u2264',
	'\u00A3': '\u00D7',
	'\u00A2': '\u00B7',
	'\u00A7': '\u00B1',
	'\u0031': '\u221E',
};

const GLYPH_MAPS: Record<string, Record<string, string>> = {
	cmmi10: CMMI10_GLYPH_MAP,
	cmr10: CMR10_GLYPH_MAP,
	cmsy10: CMSY10_GLYPH_MAP,
};

const MATH_FONT_FAMILIES = new Set(['cmmi10', 'cmr10', 'cmsy10']);

function replaceMappedGlyphs(content: string, table: Record<string, string>): string {
	let result = content;
	for (const [bad, good] of Object.entries(table)) {
		if (result.includes(bad)) {
			result = result.replaceAll(bad, good);
		}
	}
	return result;
}

function fixTextContent(family: string, content: string): string {
	const table = GLYPH_MAPS[family];
	if (!table) {
		return content;
	}
	return replaceMappedGlyphs(content, table);
}

function fixTextNode(full: string, family: string, attrs: string, content: string): string {
	const mapped = fixTextContent(family, content);
	if (mapped === content) {
		return full;
	}

	const nextAttrs = attrs.includes('font-family=')
		? attrs.replace(/font-family="[^"]+"/, 'font-family="Cambria Math, STIX Two Math, serif"')
		: `${attrs} font-family="Cambria Math, STIX Two Math, serif"`;

	return `<text${nextAttrs}>${mapped}</text>`;
}

/** Fix common corrupted math symbols in TikZJax SVG output. */
export function fixTikzJaxSvgGlyphs(svgInput: unknown): string {
	if (typeof svgInput !== 'string') {
		return '';
	}

	return svgInput.replace(
		/<text\b([^>]*\bfont-family="(cmmi10|cmr10|cmsy10)")([^>]*)>([^<]*)<\/text>/g,
		(full: string, beforeFamily: string, family: string, afterFamily: string, content: string) => {
			if (!MATH_FONT_FAMILIES.has(family)) {
				return full;
			}
			return fixTextNode(full, family, `${beforeFamily}${afterFamily}`, content);
		},
	);
}

export function finalizeTikzJaxSvg(svgInput: unknown): string {
	return fixTikzJaxSvgGlyphs(svgInput);
}
