import type { DarkModeStyle } from '../settings/settingsModel';

const NAMED_DARK_COLORS = new Set([
	'black',
	'#000',
	'#000000',
	'rgb(0,0,0)',
	'rgb(0%,0%,0%)',
]);

function invertRgbPercentTriplet(match: string, r: string, g: string, b: string): string {
	const invert = (value: string) => {
		const parsed = Number.parseFloat(value);
		if (!Number.isFinite(parsed)) {
			return value;
		}
		const inverted = Math.max(0, Math.min(100, 100 - parsed));
		return Number.isInteger(parsed) ? String(inverted) : inverted.toFixed(1);
	};

	return match.replace(r, invert(r)).replace(g, invert(g)).replace(b, invert(b));
}

function invertRgbByteTriplet(match: string, r: string, g: string, b: string): string {
	const invert = (value: string) => {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) {
			return value;
		}
		return String(Math.max(0, Math.min(255, 255 - parsed)));
	};

	return match.replace(r, invert(r)).replace(g, invert(g)).replace(b, invert(b));
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
		return invertRgbPercentTriplet(normalized, percentMatch[1], percentMatch[2], percentMatch[3]);
	}

	const byteMatch = lower.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
	if (byteMatch) {
		return invertRgbByteTriplet(normalized, byteMatch[1], byteMatch[2], byteMatch[3]);
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
			if ((property === 'stroke' || property === 'fill' || property === 'color') && shouldInvertColorValue(value)) {
				return `${property}:${invertColorValue(value)}`;
			}
			return trimmed;
		})
		.filter(Boolean)
		.join(';');
}

/** Post-process SVG: invert only near-black strokes/fills so colors stay intact. */
export function invertSvgForDarkMode(svg: string): string {
	let output = svg
		.replaceAll('rgb(0%,0%,0%)', 'rgb(100%,100%,100%)')
		.replace(/rgb[(]\s*0%\s*,\s*0%\s*,\s*0%\s*[)]/gi, 'rgb(100%,100%,100%)')
		.replace(/rgb[(]\s*0\s*,\s*0\s*,\s*0\s*[)]/g, 'rgb(255,255,255)')
		.replace(/#000000(?![0-9a-f])/gi, '#ffffff')
		.replace(/#000(?![0-9a-f])/gi, '#fff')
		.replace(/stroke:\s*black/gi, 'stroke:white')
		.replace(/fill:\s*black/gi, 'fill:white')
		.replace(/stroke="black"/gi, 'stroke="white"')
		.replace(/fill="black"/gi, 'fill="white"');

	output = output.replace(
		/\b(stroke|fill)="([^"]+)"/gi,
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
