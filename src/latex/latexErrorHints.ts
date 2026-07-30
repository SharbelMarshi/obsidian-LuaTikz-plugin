/**
 * Explanations for LaTeX errors whose message says nothing about the cause.
 * A hint is advice, never an edit — anything safe to apply automatically
 * belongs in latexAutofix instead.
 */

/**
 * TeX dimensions cap at 16383.99998pt, and pgf's `to` path multiplies the
 * endpoint separation by 16 while sizing the curve's control points
 * (tikzlibrarytopaths.code.tex). Anything beyond 16383.99998/16 pt overflows.
 */
const TO_PATH_LIMIT_PT = 1024;
const TO_PATH_LIMIT_CM = Math.round(TO_PATH_LIMIT_PT / 28.452756);

/** Path options that route through pgf's control-point distance computation. */
const CURVED_TO_RE = /\b(?:to|edge)\b[^;]*\[[^\]]*\b(?:out|in|bend\s+(?:left|right)|bend|looseness|relative)\b/;

function isDimensionTooLarge(summary: string): boolean {
	return /dimension too large/i.test(summary);
}

export function hintForLatexError(summary: string, lineContent?: string): string | undefined {
	const line = lineContent?.trim() ?? '';

	if (isDimensionTooLarge(summary)) {
		if (CURVED_TO_RE.test(line)) {
			return `A curved "to" path (out/in, bend, looseness) overflows TeX's arithmetic once its two endpoints are more than about ${TO_PATH_LIMIT_PT}pt (~${TO_PATH_LIMIT_CM}cm) apart. Shrink the coordinate system on the picture — \\begin{tikzpicture}[x=0.5cm, y=0.5cm] — or give the curve explicit control points (out control=/in control=, or .. controls ... ..). "scale=" does not help: the limit is on the coordinate values, not the final picture size.`;
		}
		return `A length in this statement exceeded TeX's maximum dimension (16383.99998pt ≈ 575cm). Use smaller coordinates, or shrink the unit vectors with \\begin{tikzpicture}[x=0.5cm, y=0.5cm].`;
	}

	const unknownLibrary = summary.match(/tikz library '([^']+)'/);
	if (unknownLibrary) {
		return `"${unknownLibrary[1]}" is not a TikZ library. If it is a package (pgfplots, circuitikz, …) LuaTikz already loads it, so the line can be deleted; PGFPlots libraries such as groupplots load with \\usepgfplotslibrary{...} instead.`;
	}

	return undefined;
}
