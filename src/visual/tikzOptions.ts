import { TIKZ_COLOR_NAMES } from './tikzColors';
import type {
	ArrowTipKind,
	DashStyle,
	ObjectStyle,
	PatternStyle,
	ShadingStyle,
} from './sceneTypes';

/**
 * Lossless handling of TikZ option lists (`[...]` contents).
 *
 * Options are split into top-level comma tokens; style edits replace or insert
 * individual tokens and leave every unrecognized token untouched and in
 * order, so custom user styles (`my style`, `decorate`, …) survive round
 * trips through the visual editor.
 */

export interface OptionToken {
	text: string;
	/** Offsets within the options text. */
	from: number;
	to: number;
}

/** Split at top-level commas, respecting `{}`, `[]`, and `()` nesting. */
export function splitOptionTokens(options: string): OptionToken[] {
	const tokens: OptionToken[] = [];
	let depth = 0;
	let start = 0;

	const push = (from: number, to: number) => {
		const text = options.slice(from, to);
		const trimmedStart = from + (text.length - text.trimStart().length);
		const trimmedEnd = to - (text.length - text.trimEnd().length);
		if (trimmedEnd > trimmedStart) {
			tokens.push({
				text: options.slice(trimmedStart, trimmedEnd),
				from: trimmedStart,
				to: trimmedEnd,
			});
		}
	};

	for (let index = 0; index < options.length; index++) {
		const char = options[index];
		if (char === '{' || char === '[' || char === '(') {
			depth++;
		} else if (char === '}' || char === ']' || char === ')') {
			depth = Math.max(0, depth - 1);
		} else if (char === ',' && depth === 0) {
			push(start, index);
			start = index + 1;
		}
	}
	push(start, options.length);
	return tokens;
}

const ARROW_TOKEN_RE =
	/^(?:[<>|o*[\]]|latex|stealth|to|\{[a-zA-Z ']+\})*\s*-\s*(?:[<>|o*[\]]|latex|stealth|to|\{[a-zA-Z ']+\})*$/i;
const LINE_WIDTH_TOKENS = new Set([
	'ultra thin', 'very thin', 'thin', 'semithick', 'thick', 'very thick', 'ultra thick',
]);
const DASH_TOKENS = new Set([
	'dashed', 'dotted', 'densely dashed', 'densely dotted', 'loosely dashed',
	'loosely dotted', 'solid',
]);

export { TIKZ_COLOR_NAMES } from './tikzColors';

/** Arrow tip shapes offered by the editor, in panel display order. */
export const ARROW_TIP_KINDS: readonly ArrowTipKind[] = [
	'default', 'Stealth', 'Latex', 'Triangle', 'Circle', 'Square',
	'Diamond', 'Bar', 'Hooks',
];

/**
 * The editor's own patterns, declared per fence with
 * `\pgfdeclarepatternformonly` the first time each is used (next to the
 * auto-inserted `\usetikzlibrary{patterns}`): bold 45° stripes, and
 * wider-spaced diagonal lines (4.5pt tiles vs the library's cramped 3pt —
 * pgf errors on redeclaring the library names, hence the `wide` variants).
 * Tile geometry is mirrored by the canvas preview and the TikZJax defs
 * injection in src/utils/tikzJaxSvgFix.ts.
 */
export const EDITOR_PATTERN_DECLARATIONS: Record<string, string> = {
	'diagonal stripes':
		'\\pgfdeclarepatternformonly{diagonal stripes}'
		+ '{\\pgfqpoint{-1pt}{-1pt}}{\\pgfqpoint{7pt}{7pt}}{\\pgfqpoint{6pt}{6pt}}'
		+ '{\\pgfsetlinewidth{2.5pt}\\pgfpathmoveto{\\pgfqpoint{-2pt}{-2pt}}'
		+ '\\pgfpathlineto{\\pgfqpoint{8pt}{8pt}}\\pgfusepath{stroke}}',
	'north east lines wide':
		'\\pgfdeclarepatternformonly{north east lines wide}'
		+ '{\\pgfqpoint{-1pt}{-1pt}}{\\pgfqpoint{5.5pt}{5.5pt}}{\\pgfqpoint{4.5pt}{4.5pt}}'
		+ '{\\pgfsetlinewidth{0.4pt}\\pgfpathmoveto{\\pgfqpoint{0pt}{0pt}}'
		+ '\\pgfpathlineto{\\pgfqpoint{4.6pt}{4.6pt}}\\pgfusepath{stroke}}',
	'north west lines wide':
		'\\pgfdeclarepatternformonly{north west lines wide}'
		+ '{\\pgfqpoint{-1pt}{-1pt}}{\\pgfqpoint{5.5pt}{5.5pt}}{\\pgfqpoint{4.5pt}{4.5pt}}'
		+ '{\\pgfsetlinewidth{0.4pt}\\pgfpathmoveto{\\pgfqpoint{0pt}{4.5pt}}'
		+ '\\pgfpathlineto{\\pgfqpoint{4.6pt}{-0.1pt}}\\pgfusepath{stroke}}',
};

/** Fill patterns offered by the editor, in panel display order: the editor's
 * wider diagonals and stripes first, then the TikZ `patterns` library. */
export const PATTERN_NAMES = [
	'north east lines wide', 'north west lines wide', 'diagonal stripes',
	'horizontal lines', 'vertical lines',
	'grid', 'crosshatch', 'dots', 'crosshatch dots', 'fivepointed stars',
	'sixpointed stars', 'bricks', 'checkerboard',
] as const;

const COLOR_NAME_SET = new Set<string>(TIKZ_COLOR_NAMES);

function isColorExpression(token: string): boolean {
	const [base] = token.split('!');
	return COLOR_NAME_SET.has(base.trim());
}

function isArrowToken(token: string): boolean {
	return token.includes('-') && !token.includes('=') && ARROW_TOKEN_RE.test(token);
}

const TIP_KIND_SET = new Set<string>(ARROW_TIP_KINDS);

/** Legacy pgf tip names mapped onto their arrows.meta counterparts. */
const LEGACY_TIP_NAMES: Record<string, ArrowTipKind> = {
	latex: 'Latex',
	stealth: 'Stealth',
};

interface ArrowSpec {
	arrows: NonNullable<ObjectStyle['arrows']>;
	tip: ArrowTipKind;
}

/** One side of an arrow token → its tip kind; null when not representable. */
function parseTipSide(side: string, role: 'start' | 'end'): ArrowTipKind | null {
	const trimmed = side.trim();
	const directionGlyph = role === 'start' ? '<' : '>';
	if (trimmed === '' || trimmed === directionGlyph || trimmed.toLowerCase() === 'to') {
		return 'default';
	}
	const braced = /^\{([a-zA-Z ']+)\}$/.exec(trimmed);
	const name = braced ? braced[1].trim() : trimmed;
	if (TIP_KIND_SET.has(name)) {
		return name as ArrowTipKind;
	}
	const legacy = LEGACY_TIP_NAMES[name.toLowerCase()];
	return legacy ?? null;
}

/**
 * Interpret an arrow token (`->`, `-{Stealth}`, `{Latex}-{Latex}`, `-latex`)
 * as a direction plus tip shape. Returns null for specs outside that model
 * (`->>`, `o-o`, mismatched tips) — those stay raw and untouched.
 */
export function parseArrowSpec(token: string): ArrowSpec | null {
	const split = /^([^-]*)-([^-]*)$/.exec(token.trim());
	if (!split) {
		return null;
	}
	const startRaw = split[1].trim();
	const endRaw = split[2].trim();
	const start = parseTipSide(startRaw, 'start');
	const end = parseTipSide(endRaw, 'end');
	if (start === null || end === null) {
		return null;
	}
	const startActive = startRaw !== '';
	const endActive = endRaw !== '';
	if (startActive && endActive && start !== end) {
		return null;
	}
	if (!startActive && !endActive) {
		return { arrows: '', tip: 'default' };
	}
	return {
		arrows: startActive && endActive ? '<->' : startActive ? '<-' : '->',
		tip: startActive ? start : end,
	};
}

/** Arrow token for a direction + tip pair; null when there is no arrow. */
export function composeArrowToken(
	arrows: ObjectStyle['arrows'],
	tip: ArrowTipKind,
): string | null {
	if (!arrows) {
		return null;
	}
	if (tip === 'default') {
		return arrows;
	}
	const spec = `{${tip}}`;
	return arrows === '<->' ? `${spec}-${spec}` : arrows === '<-' ? `${spec}-` : `-${spec}`;
}

export interface ParsedOptionStyle extends ObjectStyle {
	/** Raw arrow token when it is one this editor cannot regenerate (`o-o`). */
	rawArrowToken?: string;
}

function keyValue(token: string): { key: string; value: string } | null {
	const eq = token.indexOf('=');
	if (eq < 0) {
		return null;
	}
	return { key: token.slice(0, eq).trim(), value: token.slice(eq + 1).trim() };
}

/** Extract the style attributes this editor's UI understands. */
export function parseOptionStyle(options: string): ParsedOptionStyle {
	const style: ParsedOptionStyle = {};
	const shadingKeys: Partial<Record<
		'top' | 'bottom' | 'left' | 'right' | 'inner' | 'outer' | 'ball', string
	>> = {};
	let shadingAngle: number | undefined;
	for (const token of splitOptionTokens(options)) {
		const text = token.text;
		const kv = keyValue(text);
		if (kv) {
			switch (kv.key) {
				case 'color':
				case 'draw':
					if (kv.value) {
						style.strokeColor = kv.value;
					}
					break;
				case 'fill':
					style.fillColor = kv.value;
					break;
				case 'opacity':
					style.opacity = Number.parseFloat(kv.value);
					break;
				case 'anchor':
					style.anchor = kv.value;
					break;
				case 'top color':
					shadingKeys.top = kv.value;
					break;
				case 'bottom color':
					shadingKeys.bottom = kv.value;
					break;
				case 'left color':
					shadingKeys.left = kv.value;
					break;
				case 'right color':
					shadingKeys.right = kv.value;
					break;
				case 'inner color':
					shadingKeys.inner = kv.value;
					break;
				case 'outer color':
					shadingKeys.outer = kv.value;
					break;
				case 'ball color':
					shadingKeys.ball = kv.value;
					break;
				case 'shading angle': {
					const angle = Number.parseFloat(kv.value);
					if (Number.isFinite(angle)) {
						shadingAngle = angle;
					}
					break;
				}
				case 'pattern':
					style.pattern = { ...style.pattern, name: kv.value };
					break;
				case 'pattern color':
					style.pattern = { name: style.pattern?.name ?? '', color: kv.value };
					break;
			}
			continue;
		}
		if (isArrowToken(text)) {
			const spec = parseArrowSpec(text);
			if (spec) {
				style.arrows = spec.arrows;
				if (spec.tip !== 'default') {
					style.arrowTip = spec.tip;
				}
			} else {
				style.rawArrowToken = text;
			}
			continue;
		}
		if (LINE_WIDTH_TOKENS.has(text)) {
			style.lineWidth = text === 'thin' ? 'thin'
				: text === 'thick' ? 'thick'
					: text === 'very thick' ? 'very thick'
						: 'default';
			continue;
		}
		if (DASH_TOKENS.has(text)) {
			style.dash = text.includes('dashed') ? 'dashed'
				: text.includes('dotted') ? 'dotted'
					: 'solid';
			continue;
		}
		if (text === 'rounded corners' || text.startsWith('rounded corners=')) {
			style.roundedCorners = true;
			continue;
		}
		if (text === 'fill') {
			style.fillColor = 'black';
			continue;
		}
		if (isColorExpression(text)) {
			style.strokeColor = text;
		}
	}
	if (style.pattern && !style.pattern.name) {
		delete style.pattern;
	}
	if (shadingKeys.ball !== undefined) {
		style.shading = { kind: 'ball', from: shadingKeys.ball || 'blue', to: '' };
	} else if (shadingKeys.inner !== undefined || shadingKeys.outer !== undefined) {
		style.shading = {
			kind: 'radial',
			from: shadingKeys.inner ?? 'white',
			to: shadingKeys.outer ?? 'black',
		};
	} else if (shadingKeys.left !== undefined || shadingKeys.right !== undefined) {
		style.shading = {
			kind: 'horizontal',
			from: shadingKeys.left ?? 'white',
			to: shadingKeys.right ?? 'black',
		};
	} else if (shadingKeys.top !== undefined || shadingKeys.bottom !== undefined) {
		style.shading = {
			kind: 'vertical',
			from: shadingKeys.top ?? 'white',
			to: shadingKeys.bottom ?? 'black',
		};
	}
	if (style.shading && shadingAngle !== undefined) {
		style.shading.angle = shadingAngle;
	}
	return style;
}

export interface StyleEdit {
	strokeColor?: string | null;
	fillColor?: string | null;
	lineWidth?: ObjectStyle['lineWidth'] | null;
	dash?: DashStyle | null;
	arrows?: ObjectStyle['arrows'] | null;
	/** Tip shape; combined with the direction into one arrow token. */
	arrowTip?: ArrowTipKind | null;
	/** Setting a shading clears solid fill and pattern tokens (and back). */
	shading?: ShadingStyle | null;
	pattern?: PatternStyle | null;
	opacity?: number | null;
	roundedCorners?: boolean | null;
	anchor?: string | null;
	fontSize?: ObjectStyle['fontSize'] | null;
}

type TokenClass =
	| 'arrow' | 'lineWidth' | 'dash' | 'stroke' | 'fill' | 'opacity'
	| 'rounded' | 'anchor' | 'fontSize'
	| 'shadingTop' | 'shadingBottom' | 'shadingLeft' | 'shadingRight'
	| 'shadingInner' | 'shadingOuter' | 'shadingBall' | 'shadingMiddle'
	| 'shadingAngle' | 'shadeFlag' | 'patternName' | 'patternColor'
	| 'other';

const SHADING_CLASSES: readonly TokenClass[] = [
	'shadingTop', 'shadingBottom', 'shadingLeft', 'shadingRight',
	'shadingInner', 'shadingOuter', 'shadingBall', 'shadingMiddle',
	'shadingAngle', 'shadeFlag',
];

const SHADING_KEY_CLASSES: Record<string, TokenClass> = {
	'top color': 'shadingTop',
	'bottom color': 'shadingBottom',
	'left color': 'shadingLeft',
	'right color': 'shadingRight',
	'inner color': 'shadingInner',
	'outer color': 'shadingOuter',
	'ball color': 'shadingBall',
	'middle color': 'shadingMiddle',
	'shading angle': 'shadingAngle',
	shading: 'shadeFlag',
};

function classifyToken(text: string): TokenClass {
	const kv = keyValue(text);
	if (kv) {
		if (kv.key === 'color' || kv.key === 'draw') {
			return 'stroke';
		}
		if (kv.key === 'fill') {
			return 'fill';
		}
		if (kv.key === 'opacity') {
			return 'opacity';
		}
		if (kv.key === 'anchor') {
			return 'anchor';
		}
		if (kv.key === 'rounded corners') {
			return 'rounded';
		}
		if (kv.key === 'font') {
			return 'fontSize';
		}
		if (kv.key === 'pattern') {
			return 'patternName';
		}
		if (kv.key === 'pattern color') {
			return 'patternColor';
		}
		const shadingClass = SHADING_KEY_CLASSES[kv.key];
		if (shadingClass) {
			return shadingClass;
		}
		return 'other';
	}
	if (isArrowToken(text)) {
		return 'arrow';
	}
	if (LINE_WIDTH_TOKENS.has(text)) {
		return 'lineWidth';
	}
	if (DASH_TOKENS.has(text)) {
		return 'dash';
	}
	if (text === 'rounded corners') {
		return 'rounded';
	}
	if (text === 'fill') {
		return 'fill';
	}
	if (text === 'shade') {
		return 'shadeFlag';
	}
	if (isColorExpression(text)) {
		return 'stroke';
	}
	return 'other';
}

const FONT_SIZE_COMMANDS: Record<'small' | 'normal' | 'large', string> = {
	small: '\\small',
	normal: '\\normalsize',
	large: '\\large',
};

const formatShadingAngle = (angle: number): string =>
	String(Math.round(angle * 100) / 100);

/** Tokens for a shading, with every other shading key cleared. */
function shadingTokens(
	shading: ShadingStyle | null,
): Array<{ cls: TokenClass; token: string | null }> {
	const tokens = new Map<TokenClass, string | null>();
	for (const cls of SHADING_CLASSES) {
		tokens.set(cls, null);
	}
	if (shading) {
		switch (shading.kind) {
			case 'vertical':
				tokens.set('shadingTop', `top color=${shading.from}`);
				tokens.set('shadingBottom', `bottom color=${shading.to}`);
				break;
			case 'horizontal':
				tokens.set('shadingLeft', `left color=${shading.from}`);
				tokens.set('shadingRight', `right color=${shading.to}`);
				break;
			case 'radial':
				tokens.set('shadingInner', `inner color=${shading.from}`);
				tokens.set('shadingOuter', `outer color=${shading.to}`);
				break;
			case 'ball':
				tokens.set('shadingBall', `ball color=${shading.from}`);
				break;
		}
		if (shading.angle !== undefined && shading.angle !== 0
			&& (shading.kind === 'vertical' || shading.kind === 'horizontal')) {
			tokens.set('shadingAngle', `shading angle=${formatShadingAngle(shading.angle)}`);
		}
	}
	return [...tokens].map(([cls, token]) => ({ cls, token }));
}

function editTokens(
	edit: StyleEdit,
	current: ParsedOptionStyle,
): Array<{ cls: TokenClass; token: string | null }> {
	const map = new Map<TokenClass, string | null>();
	const setToken = (cls: TokenClass, token: string | null) => {
		map.set(cls, token);
	};
	/** Clear a class unless an earlier (primary) rule already claimed it. */
	const clearToken = (cls: TokenClass) => {
		if (!map.has(cls)) {
			map.set(cls, null);
		}
	};
	const out = {
		push: (entry: { cls: TokenClass; token: string | null }) =>
			setToken(entry.cls, entry.token),
	};
	if (edit.arrows !== undefined || edit.arrowTip !== undefined) {
		// Direction and tip live in one token; the half not being edited comes
		// from the current options. Setting a tip on an arrow-less path adds an
		// end arrow — a tip without a direction would not render at all.
		const fallbackArrows = current.arrows ?? (current.rawArrowToken ? '->' : '');
		const arrows = edit.arrows !== undefined ? (edit.arrows ?? '') : fallbackArrows;
		const tip = edit.arrowTip !== undefined
			? (edit.arrowTip ?? 'default')
			: (current.arrowTip ?? 'default');
		const effective = !arrows && edit.arrowTip && tip !== 'default' ? '->' : arrows;
		out.push({ cls: 'arrow', token: composeArrowToken(effective, tip) });
	}
	if (edit.lineWidth !== undefined) {
		out.push({
			cls: 'lineWidth',
			token: edit.lineWidth && edit.lineWidth !== 'default' ? edit.lineWidth : null,
		});
	}
	if (edit.dash !== undefined) {
		out.push({ cls: 'dash', token: edit.dash && edit.dash !== 'solid' ? edit.dash : null });
	}
	if (edit.strokeColor !== undefined) {
		// Named colors and mixes work as bare tokens; `none` (no outline) and
		// anything else (inline xcolor RGB expressions) must be written as
		// `draw=…` to stay valid.
		const stroke = edit.strokeColor
			? (edit.strokeColor === 'none' || edit.strokeColor.startsWith('{')
				? `draw=${edit.strokeColor}`
				: edit.strokeColor)
			: null;
		out.push({ cls: 'stroke', token: stroke });
	}
	if (edit.fillColor !== undefined) {
		out.push({ cls: 'fill', token: edit.fillColor ? `fill=${edit.fillColor}` : null });
		// A solid fill replaces any shading; clearing the fill entirely also
		// drops pattern tokens so "None" really means no fill at all.
		for (const cls of SHADING_CLASSES) {
			clearToken(cls);
		}
		if (!edit.fillColor) {
			clearToken('patternName');
			clearToken('patternColor');
		}
	}
	if (edit.shading !== undefined) {
		for (const entry of shadingTokens(edit.shading)) {
			if (entry.token !== null) {
				setToken(entry.cls, entry.token);
			} else {
				clearToken(entry.cls);
			}
		}
		if (edit.shading) {
			// A gradient is the fill; solid fill and pattern tokens go.
			clearToken('fill');
			clearToken('patternName');
			clearToken('patternColor');
		}
	}
	if (edit.pattern !== undefined) {
		setToken('patternName', edit.pattern ? `pattern=${edit.pattern.name}` : null);
		setToken(
			'patternColor',
			edit.pattern?.color ? `pattern color=${edit.pattern.color}` : null,
		);
		if (edit.pattern) {
			// Patterns draw over a solid fill, so the fill token stays.
			for (const cls of SHADING_CLASSES) {
				clearToken(cls);
			}
		}
	}
	if (edit.opacity !== undefined) {
		out.push({
			cls: 'opacity',
			token: edit.opacity !== null && edit.opacity < 1 ? `opacity=${edit.opacity}` : null,
		});
	}
	if (edit.roundedCorners !== undefined) {
		out.push({ cls: 'rounded', token: edit.roundedCorners ? 'rounded corners' : null });
	}
	if (edit.anchor !== undefined) {
		out.push({ cls: 'anchor', token: edit.anchor ? `anchor=${edit.anchor}` : null });
	}
	if (edit.fontSize !== undefined) {
		out.push({
			cls: 'fontSize',
			token: edit.fontSize === 'small' || edit.fontSize === 'large'
				? `font=${FONT_SIZE_COMMANDS[edit.fontSize]}`
				: null,
		});
	}
	return [...map].map(([cls, token]) => ({ cls, token }));
}

/**
 * Apply a style edit to an options string, replacing recognized tokens in
 * place and appending new ones, while preserving unknown tokens verbatim.
 */
export function applyStyleEdit(options: string, edit: StyleEdit): string {
	const edits = editTokens(edit, parseOptionStyle(options));
	if (!edits.length) {
		return options;
	}

	const tokens = splitOptionTokens(options);
	const replacedClasses = new Set<TokenClass>();
	const result: string[] = [];

	for (const token of tokens) {
		const cls = classifyToken(token.text);
		const pending = edits.find(entry => entry.cls === cls);
		if (!pending) {
			result.push(token.text);
			continue;
		}
		if (!replacedClasses.has(cls)) {
			replacedClasses.add(cls);
			if (pending.token !== null) {
				result.push(pending.token);
			}
			continue;
		}
		// A second token of the same class (e.g. `red, draw=blue`) is dropped so
		// the edit has one unambiguous winner.
	}

	for (const pending of edits) {
		if (!replacedClasses.has(pending.cls) && pending.token !== null) {
			result.push(pending.token);
		}
	}

	return result.join(', ');
}
