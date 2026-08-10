/**
 * TikZ/xcolor color handling shared by the visual editor's canvas renderer
 * and its style panel.
 *
 * Two families of expressions are supported:
 * - named colors and `!` mixes (`red`, `blue!30`, `red!50!blue`) — also what
 *   the custom color picker writes, via a nearest-mix search, and
 * - inline xcolor RGB values in the `{rgb,255:red,R;green,G;blue,B}` form
 *   (parsed for backward compatibility; never written anymore).
 */

/** Colors TikZ understands without any library, in panel display order. */
export const TIKZ_COLOR_NAMES = [
	'black', 'gray', 'darkgray', 'lightgray', 'white', 'red', 'orange',
	'yellow', 'lime', 'green', 'olive', 'teal', 'cyan', 'blue', 'violet',
	'purple', 'magenta', 'pink', 'brown',
] as const;

export const XCOLOR_RGB: Record<string, [number, number, number]> = {
	black: [0, 0, 0],
	white: [255, 255, 255],
	red: [255, 0, 0],
	green: [0, 255, 0],
	blue: [0, 0, 255],
	cyan: [0, 255, 255],
	magenta: [255, 0, 255],
	yellow: [255, 255, 0],
	orange: [255, 128, 0],
	purple: [191, 0, 64],
	brown: [191, 128, 64],
	gray: [128, 128, 128],
	grey: [128, 128, 128],
	darkgray: [64, 64, 64],
	darkgrey: [64, 64, 64],
	lightgray: [191, 191, 191],
	lightgrey: [191, 191, 191],
	pink: [255, 191, 191],
	lime: [191, 255, 0],
	olive: [128, 128, 0],
	teal: [0, 128, 128],
	violet: [128, 0, 128],
};

function mix(
	a: [number, number, number],
	b: [number, number, number],
	pct: number,
): [number, number, number] {
	const t = Math.max(0, Math.min(100, pct)) / 100;
	return [
		a[0] * t + b[0] * (1 - t),
		a[1] * t + b[1] * (1 - t),
		a[2] * t + b[2] * (1 - t),
	];
}

const INLINE_RGB_RE = /^\{?\s*rgb\s*,\s*(\d+(?:\.\d+)?)\s*:\s*red\s*,\s*(\d+(?:\.\d+)?)\s*;\s*green\s*,\s*(\d+(?:\.\d+)?)\s*;\s*blue\s*,\s*(\d+(?:\.\d+)?)\s*\}?$/i;

const clamp255 = (value: number): number => Math.max(0, Math.min(255, value));

/**
 * Resolve a TikZ color expression to sRGB, or null when the expression uses
 * syntax (or color names) this editor does not model.
 */
export function tikzColorToRgb(expression: string): [number, number, number] | null {
	const trimmed = expression.trim();
	const inline = INLINE_RGB_RE.exec(trimmed);
	if (inline) {
		const denominator = Number.parseFloat(inline[1]);
		if (!Number.isFinite(denominator) || denominator <= 0) {
			return null;
		}
		const scale = 255 / denominator;
		return [
			clamp255(Number.parseFloat(inline[2]) * scale),
			clamp255(Number.parseFloat(inline[3]) * scale),
			clamp255(Number.parseFloat(inline[4]) * scale),
		];
	}
	const parts = trimmed.split('!').map(part => part.trim());
	let rgb = XCOLOR_RGB[parts[0]];
	if (!rgb) {
		return null;
	}
	for (let index = 1; index < parts.length; index += 2) {
		const pct = Number.parseFloat(parts[index]);
		if (!Number.isFinite(pct)) {
			return null;
		}
		const other = XCOLOR_RGB[parts[index + 1] ?? 'white'];
		if (!other) {
			return null;
		}
		rgb = mix(rgb, other, pct);
	}
	return rgb;
}

/**
 * Approximate CSS color for a TikZ color expression. Unknown expressions fall
 * back to the theme text color so the object stays visible; the compiled
 * preview shows the real color. Plain black also maps to the theme text color
 * for dark-mode legibility.
 */
export function tikzColorToCss(expression: string | undefined): string {
	if (!expression) {
		return 'var(--text-normal)';
	}
	const rgb = tikzColorToRgb(expression);
	if (!rgb) {
		return 'var(--text-normal)';
	}
	if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) {
		return 'var(--text-normal)';
	}
	return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

export function rgbToHex(rgb: [number, number, number]): string {
	const part = (value: number): string =>
		Math.round(clamp255(value)).toString(16).padStart(2, '0');
	return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) {
		return null;
	}
	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Perceptually weighted sRGB distance (0 ≈ identical, ~765 max). */
function colorDistance(a: [number, number, number], b: [number, number, number]): number {
	const dr = a[0] - b[0];
	const dg = a[1] - b[1];
	const db = a[2] - b[2];
	return Math.sqrt(0.299 * dr * dr * 3 + 0.587 * dg * dg * 3 + 0.114 * db * db * 3);
}

/** `p` for the point on segment base→top closest to target (0–100). */
function projectMix(
	target: [number, number, number],
	top: [number, number, number],
	base: [number, number, number],
): number {
	const dx = top[0] - base[0];
	const dy = top[1] - base[1];
	const dz = top[2] - base[2];
	const lengthSq = dx * dx + dy * dy + dz * dz;
	if (lengthSq === 0) {
		return 100;
	}
	const t = ((target[0] - base[0]) * dx + (target[1] - base[1]) * dy + (target[2] - base[2]) * dz)
		/ lengthSq;
	return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

interface ColorCandidate {
	expression: string;
	rgb: [number, number, number];
	/** Lower reads better in source: name < a!p < a!p!b < chained. */
	complexity: number;
}

/** Format `top!p!base`, collapsing the trivial forms. */
function mixExpression(top: string, p: number, base: string): { text: string; complexity: number } {
	if (p >= 100) {
		return { text: top, complexity: 1 };
	}
	if (p <= 0) {
		return { text: base, complexity: 1 };
	}
	if (base === 'white') {
		// xcolor shorthand: `red!40` mixes toward white.
		return { text: `${top}!${p}`, complexity: 2 };
	}
	return { text: `${top}!${p}!${base}`, complexity: 3 };
}

/**
 * Readable TikZ/xcolor expression closest to an arbitrary RGB value: a plain
 * name when one is close, otherwise a mix (`cyan!75`, `cyan!75!black`, or a
 * chained `a!p!b!q!black`/`!q!white` for interior colors). Never falls back
 * to inline `{rgb,…}` syntax — every renderer understands `!` mixes, and the
 * source stays human-readable.
 */
export function rgbToTikzExpression(rgb: [number, number, number]): string {
	const names = TIKZ_COLOR_NAMES as readonly string[];
	const candidates: ColorCandidate[] = [];

	for (const top of names) {
		candidates.push({ expression: top, rgb: XCOLOR_RGB[top], complexity: 1 });
		for (const base of names) {
			if (base === top) {
				continue;
			}
			const p = projectMix(rgb, XCOLOR_RGB[top], XCOLOR_RGB[base]);
			const mixed = mix(XCOLOR_RGB[top], XCOLOR_RGB[base], p);
			const formatted = mixExpression(top, p, base);
			candidates.push({ expression: formatted.text, rgb: mixed, complexity: formatted.complexity });
		}
	}

	candidates.sort((a, b) => colorDistance(a.rgb, rgb) - colorDistance(b.rgb, rgb));
	const bestPairs = candidates.slice(0, 8);

	// Interior colors (e.g. desaturated tones) need a lightness chain:
	// (a!p!b)!q!black or !q!white.
	for (const candidate of bestPairs.slice()) {
		if (candidate.complexity >= 4) {
			continue;
		}
		for (const anchor of ['black', 'white'] as const) {
			const q = projectMix(rgb, candidate.rgb, XCOLOR_RGB[anchor]);
			if (q >= 100 || q <= 0) {
				continue;
			}
			const chained = anchor === 'white' && !candidate.expression.includes('!')
				? `${candidate.expression}!${q}`
				: `${candidate.expression}!${q}!${anchor}`;
			bestPairs.push({
				expression: chained,
				rgb: mix(candidate.rgb, XCOLOR_RGB[anchor], q),
				complexity: 4,
			});
		}
	}

	let best = bestPairs[0];
	let bestDistance = colorDistance(best.rgb, rgb);
	for (const candidate of bestPairs) {
		const distance = colorDistance(candidate.rgb, rgb);
		if (distance < bestDistance - 1e-9) {
			best = candidate;
			bestDistance = distance;
		}
	}
	// Prefer the simplest expression that is not meaningfully worse.
	for (const candidate of bestPairs) {
		const distance = colorDistance(candidate.rgb, rgb);
		if (candidate.complexity < best.complexity && distance <= bestDistance + 6) {
			best = candidate;
			bestDistance = Math.min(bestDistance, distance);
		}
	}
	return best.expression;
}

/**
 * Append a light/dark shade to a color expression: positive `shade` mixes
 * toward white (`red!60`), negative toward black (`red!60!black`), 0 returns
 * the base unchanged. Works on mix expressions too — a base ending in a bare
 * percentage (`red!75`, xcolor's toward-white shorthand) is completed to
 * `red!75!white` first so the appended pair keeps the color!pct!color
 * alternation every renderer parses.
 */
export function applyColorShade(base: string, shade: number): string {
	const clamped = Math.round(Math.max(-95, Math.min(95, shade)));
	const trimmed = base.trim();
	if (!clamped || !trimmed) {
		return trimmed;
	}
	const parts = trimmed.split('!');
	const normalized = parts.length % 2 === 0 ? `${trimmed}!white` : trimmed;
	return clamped > 0
		? `${normalized}!${100 - clamped}`
		: `${normalized}!${100 + clamped}!black`;
}

/**
 * Inverse of {@link applyColorShade} for the simple forms the shade slider
 * writes: `base!p` → shade `100-p`, `base!p!black` → shade `-(100-p)`.
 * Anything else is its own base with shade 0.
 */
export function splitColorShade(expression: string): { base: string; shade: number } {
	const trimmed = expression.trim();
	const dark = /^(.+)!(\d{1,3})!black$/.exec(trimmed);
	if (dark) {
		const pct = Number.parseInt(dark[2], 10);
		if (pct > 0 && pct < 100) {
			return { base: dark[1], shade: -(100 - pct) };
		}
	}
	const light = /^(.+)!(\d{1,3})$/.exec(trimmed);
	if (light) {
		const pct = Number.parseInt(light[2], 10);
		if (pct > 0 && pct < 100) {
			return { base: light[1], shade: 100 - pct };
		}
	}
	return { base: trimmed, shade: 0 };
}

/**
 * TikZ color expression for a picker hex value: the named color when one
 * matches exactly, otherwise the closest readable `!` mix expression.
 */
export function hexToTikzColor(hex: string): string | null {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return null;
	}
	return rgbToTikzExpression(rgb);
}
