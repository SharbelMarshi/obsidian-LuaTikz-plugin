/** Repair TikZJax SVG text nodes when TeX math fonts map to wrong Unicode glyphs. */

const PLAIN_TEXT_FONT_FAMILY = 'Latin Modern Roman, Computer Modern, serif';

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

const MATH_FONT_FAMILIES = new Set(['cmmi10', 'cmr10', 'cmsy10', 'lmr10', 'lmss10', 'lmtt10']);

const STANDALONE_BACKGROUND_FILLS = [
	/fill="rgb\(100%,100%,100%\)"/i,
	/fill="rgb\(100\.0%,100\.0%,100\.0%\)"/i,
	/fill="#ffffff"/i,
	/fill="#fff"/i,
	/fill="white"/i,
];

function isPlainTextLabel(content: string): boolean {
	return /^[\x20-\x7E]+$/.test(content.trim());
}

function replaceMappedGlyphs(content: string, table: Record<string, string>): string {
	let result = content;
	for (const [bad, good] of Object.entries(table)) {
		if (result.includes(bad)) {
			result = result.replaceAll(bad, good);
		}
	}
	return result;
}

function setFontFamily(attrs: string, family: string): string {
	if (attrs.includes('font-family=')) {
		return attrs.replace(/font-family="[^"]+"/, `font-family="${family}"`);
	}
	return `${attrs} font-family="${family}"`;
}

function fixTextContent(family: string, content: string): string {
	const table = GLYPH_MAPS[family];
	if (!table) {
		return content;
	}
	return replaceMappedGlyphs(content, table);
}

function fixTextNode(full: string, family: string, attrs: string, content: string): string {
	if (isPlainTextLabel(content)) {
		const nextAttrs = setFontFamily(attrs, PLAIN_TEXT_FONT_FAMILY);
		return `<text${nextAttrs}>${content}</text>`;
	}

	const mapped = fixTextContent(family, content);
	if (mapped === content) {
		return full;
	}

	const nextAttrs = setFontFamily(attrs, 'Cambria Math, STIX Two Math, serif');
	return `<text${nextAttrs}>${mapped}</text>`;
}

/** Remove the full-canvas white background rect from standalone TikZJax SVG output. */
export function stripStandaloneBackgroundRect(svgInput: string): string {
	const svgMatch = svgInput.match(/^(\s*<svg\b[^>]*>)(\s*)([\s\S]*)$/i);
	if (!svgMatch) {
		return svgInput;
	}

	const [, openTag, leadingSpace, remainder] = svgMatch;
	const rectMatch = remainder.match(
		/^<rect\b([^>]*)\/?>(\s*)([\s\S]*)$/i,
	);
	if (!rectMatch) {
		return svgInput;
	}

	const [, rectAttrs, afterRectSpace, afterRect] = rectMatch;
	if (!STANDALONE_BACKGROUND_FILLS.some(pattern => pattern.test(rectAttrs))) {
		return svgInput;
	}

	return `${openTag}${leadingSpace}${afterRectSpace}${afterRect}`;
}

/** Fix common corrupted math symbols in TikZJax SVG output. */
export function fixTikzJaxSvgGlyphs(svgInput: unknown): string {
	if (typeof svgInput !== 'string') {
		return '';
	}

	return svgInput.replace(
		/<text\b([^>]*)>([^<]*)<\/text>/g,
		(full: string, attrs: string, content: string) => {
			const familyMatch = attrs.match(/\bfont-family="([^"]+)"/);
			const family = familyMatch?.[1] ?? '';
			if (!MATH_FONT_FAMILIES.has(family)) {
				return full;
			}
			return fixTextNode(full, family, attrs, content);
		},
	);
}

/**
 * Tile geometry of the TikZ `patterns` library, ported from
 * pgflibrarypatterns.code.tex (declaration order = pattern number, and the
 * library always loads from the default TikZJax preamble before any user
 * code, so numbers 1–12 are stable). Units are TeX pt; the referencing
 * groups flip Y, so tiles use PGF's own Y-up coordinates verbatim. Stroke
 * tiles leave `fill="none"` and inherit the stroke color from the `<use>`
 * instance; fill tiles do the reverse.
 */
const PGF_PATTERN_TILES: Record<number, { width: number; height: number; body: string }> = {
	1: { width: 100, height: 3, body: '<path d="M0 .5h100" fill="none" stroke-width=".4"/>' },
	2: { width: 3, height: 100, body: '<path d="M.5 0v100" fill="none" stroke-width=".4"/>' },
	3: { width: 3, height: 3, body: '<path d="M-1 -1L4 4" fill="none" stroke-width=".4"/>' },
	4: { width: 3, height: 3, body: '<path d="M-1 4L4 -1" fill="none" stroke-width=".4"/>' },
	5: { width: 3, height: 3, body: '<path d="M0 0v3M0 0h3" fill="none" stroke-width=".4"/>' },
	6: { width: 3, height: 3, body: '<path d="M-1 -1L4 4M-1 4L4 -1" fill="none" stroke-width=".4"/>' },
	7: { width: 3, height: 3, body: '<circle r=".5" stroke="none"/>' },
	8: {
		width: 3, height: 3,
		body: '<circle r=".5" stroke="none"/><circle cx="1.5" cy="1.5" r=".5" stroke="none"/>',
	},
	9: {
		width: 8.536, height: 8.536,
		body: '<path d="M5.551 3.724L0.139 3.724L4.517 0.543L2.845 5.69L1.173 0.543Z"'
			+ ' fill-rule="nonzero" stroke="none"/>',
	},
	10: {
		width: 8.536, height: 8.536,
		body: '<path d="M5.309 4.268L0.381 4.268L2.845 0ZM5.309 1.423L2.845 5.69L0.381 1.423Z"'
			+ ' fill-rule="nonzero" stroke="none"/>',
	},
	11: {
		width: 11.381, height: 11.381,
		body: '<path d="M0 2.845h11.381M0 8.536h11.381M2.845 0v2.845M8.536 2.845v5.691M2.845 8.536v2.845"'
			+ ' fill="none" stroke-width=".8"/>',
	},
	12: {
		width: 11.381, height: 11.381,
		body: '<path d="M0 0h5.691v5.691H0zM5.691 5.691h5.69v5.69h-5.69z" stroke="none"/>',
	},
};

/**
 * Tiles for the editor's own per-fence patterns (declared with
 * `\pgfdeclarepatternformonly` — see EDITOR_PATTERN_DECLARATIONS in
 * src/visual/tikzOptions.ts, whose geometry these mirror). Unlike the
 * library patterns their pgf numbers are assigned dynamically, so they are
 * matched from the fence source instead of by fixed number.
 */
const EDITOR_PATTERN_TILES: Record<string, { width: number; height: number; body: string }> = {
	'diagonal stripes': {
		width: 6, height: 6,
		body: '<path d="M-2 -2L8 8" fill="none" stroke-width="2.5"/>',
	},
	'north east lines wide': {
		width: 4.5, height: 4.5,
		body: '<path d="M-1 -1L5.5 5.5" fill="none" stroke-width=".4"/>',
	},
	'north west lines wide': {
		width: 4.5, height: 4.5,
		body: '<path d="M-1 5.5L5.5 -1" fill="none" stroke-width=".4"/>',
	},
};

/**
 * Fence-declared pattern names, in declaration order, restricted to the ones
 * actually used: their pgf numbers are assigned in exactly this order, so the
 * sorted dangling non-library numbers pair with this list one to one.
 */
function usedFencePatternNames(sourceText: string): string[] {
	const names: string[] = [];
	for (const match of sourceText.matchAll(/\\pgfdeclarepatternformonly\{([^}]*)\}/g)) {
		if (sourceText.includes(`pattern=${match[1]}`)) {
			names.push(match[1]);
		}
	}
	return names;
}

/**
 * node-tikzjax's DVI converter drops dvisvgm `rawdef` specials, so pattern
 * fills reference `#pgfpatN`/`#pgfsymN` tiles that were never emitted and
 * render as nothing. Re-create the missing definitions for the standard
 * `patterns` library (fixed numbers 1–12) and for the editor's per-fence
 * patterns (dynamic numbers, matched against `sourceText`), so patterned
 * fills look the same as under LuaLaTeX.
 */
export function injectPgfPatternDefs(svgInput: string, sourceText?: string): string {
	if (!svgInput.includes('#pgfpat')) {
		return svgInput;
	}
	const referenced = new Set<number>();
	for (const match of svgInput.matchAll(/#pgfpat(\d+)/g)) {
		referenced.add(Number.parseInt(match[1], 10));
	}
	const missing = [...referenced].filter(n =>
		PGF_PATTERN_TILES[n] && !svgInput.includes(`id="pgfpat${n}"`));
	const unknown = [...referenced]
		.filter(n => !PGF_PATTERN_TILES[n] && !svgInput.includes(`id="pgfpat${n}"`))
		.sort((a, b) => a - b);

	const tiles = missing.sort((a, b) => a - b)
		.map(n => ({ n, tile: PGF_PATTERN_TILES[n] }));
	const fenceNames = sourceText ? usedFencePatternNames(sourceText) : [];
	if (unknown.length && unknown.length === fenceNames.length) {
		for (let index = 0; index < unknown.length; index++) {
			const tile = EDITOR_PATTERN_TILES[fenceNames[index]];
			if (tile) {
				tiles.push({ n: unknown[index], tile });
			}
		}
	}
	if (!tiles.length) {
		return svgInput;
	}
	const defs = tiles.map(({ n, tile }) =>
		`<pattern id="pgfpat${n}" patternUnits="userSpaceOnUse"`
		+ ` width="${tile.width}" height="${tile.height}"/>`
		+ `<symbol id="pgfsym${n}" overflow="visible">${tile.body}</symbol>`).join('');
	return svgInput.replace(/(<svg\b[^>]*>)/i, `$1<defs>${defs}</defs>`);
}

export function finalizeTikzJaxSvg(svgInput: unknown, sourceText?: string): string {
	const glyphFixed = fixTikzJaxSvgGlyphs(svgInput);
	return injectPgfPatternDefs(stripStandaloneBackgroundRect(glyphFixed), sourceText);
}
