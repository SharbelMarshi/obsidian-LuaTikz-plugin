import type { DarkModeStyle } from '../settings/settingsModel';

const NAMED_DARK_COLORS = new Set([
	'black',
	'#000',
	'#000000',
	'rgb(0,0,0)',
	'rgb(0%,0%,0%)',
]);

/**
 * Rebuild the rgb() string from the parsed channels. The old form chained
 * `match.replace(r, …)` per channel, which replaces by *substring*: with
 * unequal channels the second replace could land inside the first's output
 * (`rgb(2,25,0)` → `rgb(232553,25,0)`, an invalid colour).
 */
function invertRgbPercentTriplet(r: string, g: string, b: string): string {
	const invert = (value: string) => {
		const parsed = Number.parseFloat(value);
		if (!Number.isFinite(parsed)) {
			return value;
		}
		const inverted = Math.max(0, Math.min(100, 100 - parsed));
		return Number.isInteger(parsed) ? String(inverted) : inverted.toFixed(1);
	};

	return `rgb(${invert(r)}%,${invert(g)}%,${invert(b)}%)`;
}

function invertRgbByteTriplet(r: string, g: string, b: string): string {
	const invert = (value: string) => {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) {
			return value;
		}
		return String(Math.max(0, Math.min(255, 255 - parsed)));
	};

	return `rgb(${invert(r)},${invert(g)},${invert(b)})`;
}

function invertHexColor(hex: string): string {
	const normalized = hex.replace('#', '');
	if (!/^[0-9a-f]{3}$/i.test(normalized) && !/^[0-9a-f]{6}$/i.test(normalized)) {
		return hex;
	}

	const expanded = normalized.length === 3
		? normalized.split('').map(ch => ch + ch).join('')
		: normalized;

	const inverted = expanded
		.match(/.{2}/g)
		?.map(pair => (255 - Number.parseInt(pair, 16)).toString(16).padStart(2, '0'))
		.join('');

	return inverted ? `#${inverted}` : hex;
}

function shouldInvertColorValue(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized || normalized === 'none' || normalized === 'transparent') {
		return false;
	}
	if (NAMED_DARK_COLORS.has(normalized)) {
		return true;
	}
	if (/^#(?:000|000000)$/i.test(normalized)) {
		return true;
	}

	const percentMatch = normalized.match(/^rgb\(\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)$/i);
	if (percentMatch) {
		const [, r, g, b] = percentMatch;
		return Number(r) < 20 && Number(g) < 20 && Number(b) < 20;
	}

	const byteMatch = normalized.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
	if (byteMatch) {
		const [, r, g, b] = byteMatch;
		return Number(r) < 40 && Number(g) < 40 && Number(b) < 40;
	}

	return false;
}

function invertColorValue(value: string): string {
	const normalized = value.trim();
	const lower = normalized.toLowerCase();

	if (lower === 'black') {
		return 'white';
	}
	if (/^#(?:000|000000)$/i.test(lower)) {
		return invertHexColor(lower);
	}
	if (/^#[0-9a-f]{3,6}$/i.test(lower)) {
		return invertHexColor(lower);
	}

	const percentMatch = lower.match(/^rgb\(\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)$/i);
	if (percentMatch) {
		return invertRgbPercentTriplet(percentMatch[1], percentMatch[2], percentMatch[3]);
	}

	const byteMatch = lower.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
	if (byteMatch) {
		return invertRgbByteTriplet(byteMatch[1], byteMatch[2], byteMatch[3]);
	}

	return normalized;
}

function invertStyleAttribute(style: string): string {
	return style
		.split(';')
		.map(rule => {
			const trimmed = rule.trim();
			if (!trimmed) {
				return '';
			}
			const colon = trimmed.indexOf(':');
			if (colon === -1) {
				return trimmed;
			}
			const property = trimmed.slice(0, colon).trim().toLowerCase();
			const value = trimmed.slice(colon + 1).trim();
			if (
				(property === 'stroke' || property === 'fill' || property === 'color'
					|| property === 'stop-color' || property === 'flood-color')
				&& shouldInvertColorValue(value)
			) {
				return `${property}:${invertColorValue(value)}`;
			}
			return trimmed;
		})
		.filter(Boolean)
		.join(';');
}

/**
 * Post-process SVG: invert only near-black strokes/fills so colors stay intact.
 *
 * Every pass is anchored to a paint attribute or style property. The old
 * version also ran blanket value-level replaces (`rgb(0,0,0)` → white anywhere
 * in the document), which rewrote non-paint text — ids, data-* attributes,
 * even visible <text> content that happened to name a colour.
 *
 * (?<![-\w]) rather than \b throughout: a word boundary matches after a
 * hyphen, so \b would treat data-fill="…" and mask-fill="…" as paint.
 */
export function invertSvgForDarkMode(svg: string): string {
	let output = svg.replace(
		/(?<![-\w])(stroke|fill|color|stop-color|flood-color)="([^"]+)"/gi,
		(match, attribute: string, value: string) => {
			if (!shouldInvertColorValue(value)) {
				return match;
			}
			return `${attribute}="${invertColorValue(value)}"`;
		},
	);

	output = output.replace(
		/style="([^"]*)"/gi,
		(match, style: string) => {
			const inverted = invertStyleAttribute(style);
			return inverted === style ? match : `style="${inverted}"`;
		},
	);

	return output;
}

export function shouldInvertSvgAtRenderTime(style: DarkModeStyle, isDarkTheme: boolean): boolean {
	return isDarkTheme && style === 'auto-invert';
}

export function applyDarkPresentationClass(container: HTMLElement, style: DarkModeStyle, isDarkTheme: boolean): void {
	container.toggleClass('luatikz-dark-brightness-boost', isDarkTheme && style === 'brightness-boost');
}

export function migrateDarkModeStyle(value: string | undefined): DarkModeStyle {
	if (value === 'brightness-boost' || value === 'auto-invert' || value === 'none') {
		return value;
	}
	// Legacy css-filter inverted hues; map to selective SVG inversion instead.
	if (value === 'css-filter') {
		return 'auto-invert';
	}
	return 'auto-invert';
}
