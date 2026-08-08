import type { TikzCoordinate } from '../utils/coordinatePick';

/**
 * Shared model for the visual TikZ editor: a parsed "scene" describing the
 * editable objects of a fence body, plus the exact source spans each object
 * occupies so edits can be written back as minimal patches.
 *
 * The model is deliberately conservative. A statement only becomes editable
 * when every coordinate is an explicit numeric pair (absolute, `+`, or `++`)
 * and every path operator is one this editor understands. Everything else is
 * kept as a locked object: preserved byte-for-byte in the source, rendered by
 * the authoritative LuaTikZ pipeline, and shown as a non-editable ghost.
 */

export type FloatingPreviewMode = 'preview' | 'edit';

/** Character offsets into the fence body (end-exclusive). */
export interface SourceSpan {
	from: number;
	to: number;
}

export type CoordinatePrefix = '' | '+' | '++';

/** One `(x, y)` token, optionally prefixed with `+`/`++`. */
export interface CoordinateToken {
	/** Span of the parenthesised pair, excluding any prefix. */
	span: SourceSpan;
	/** Span covering the `+`/`++` prefix; zero-length when absolute. */
	prefixSpan: SourceSpan;
	prefix: CoordinatePrefix;
	/** Raw values exactly as written (pre picture-scale). */
	x: number;
	y: number;
	/** Absolute position after resolving `+`/`++` chains (pre picture-scale). */
	resolved: TikzCoordinate;
}

/** A numeric length literal with its unit preserved (`1`, `2.5cm`, `4pt`). */
export interface LengthToken {
	/** Span of the numeric literal only, so patches keep the unit text. */
	valueSpan: SourceSpan;
	value: number;
	unit: string;
	cm: number;
}

/** A numeric literal without a unit (angles). */
export interface NumberToken {
	valueSpan: SourceSpan;
	value: number;
}

export type PathElement =
	| { kind: 'coord'; coord: CoordinateToken }
	| { kind: 'lineTo' }
	| { kind: 'hvTo' }
	| { kind: 'vhTo' }
	| { kind: 'curveTo'; c1: CoordinateToken; c2: CoordinateToken | null }
	| { kind: 'rectangleTo' }
	| { kind: 'gridTo'; optionsSpan: SourceSpan | null }
	| {
		kind: 'circle';
		radius: LengthToken;
		/** Present for `ellipse` (or two-radius legacy form). */
		yRadius: LengthToken | null;
		span: SourceSpan;
	}
	| {
		kind: 'arc';
		startAngle: NumberToken;
		endAngle: NumberToken;
		radius: LengthToken;
		span: SourceSpan;
	}
	| { kind: 'cycle' }
	/** Native `plot (\x, {expr})` with a pgfmath expression this editor can
	 * evaluate; domain/samples come from the statement options. */
	| { kind: 'plot'; expr: string; exprSpan: SourceSpan; span: SourceSpan }
	/** Anything preserved verbatim inside an otherwise editable path (inline nodes). */
	| { kind: 'raw'; span: SourceSpan };

export interface SceneObjectBase {
	/** Positional id, stable for a given parse: `p<picture>:s<index>`. */
	id: string;
	pictureIndex: number;
	/** Span of the whole statement, including the trailing `;`. */
	span: SourceSpan;
}

export interface ScenePathObject extends SceneObjectBase {
	type: 'path';
	command: string;
	/** Inner text of the leading `[...]`; null when there is none. */
	optionsSpan: SourceSpan | null;
	options: string;
	/** `domain=a:b` from the options — the plot evaluation range. */
	plotDomain: { from: number; to: number } | null;
	/** `samples=n` from the options. */
	plotSamples: number | null;
	/** Statement-level `shift={(x,y)}` option; applied to all geometry and
	 * rewritten (instead of coordinate tokens) when dragging a plot. */
	optionShift: { x: number; y: number } | null;
	elements: PathElement[];
}

export interface SceneNodeObject extends SceneObjectBase {
	type: 'node';
	command: 'node' | 'coordinate';
	optionsSpan: SourceSpan | null;
	options: string;
	name: string | null;
	at: CoordinateToken;
	/** Inner text of the `{...}` body; null for `\coordinate`. */
	textSpan: SourceSpan | null;
	text: string;
}

export interface SceneLockedObject extends SceneObjectBase {
	type: 'locked';
	/** Human-readable reason the statement is not visually editable. */
	reason: string;
	/** Statement command when known (`draw`, `foreach`, …). */
	command: string | null;
}

export type SceneObject = ScenePathObject | SceneNodeObject | SceneLockedObject;

/**
 * Affine picture transform: display = [[a, c], [b, d]] · p + (tx, ty), in
 * TikZ cm with Y up. Built by composing the environment's transform options
 * (`scale`, `rotate`, `shift`, …) in their written order.
 */
export interface PictureTransform {
	a: number;
	b: number;
	c: number;
	d: number;
	tx: number;
	ty: number;
}

export interface ScenePicture {
	index: number;
	/** Offset just after `\begin{tikzpicture}` and its options. */
	bodyFrom: number;
	/** Offset of `\end{tikzpicture}` (or source end for implicit pictures). */
	bodyTo: number;
	/** Inner text of the environment options `[...]`. */
	optionsText: string;
	/** Axis scale from `scale`/`xscale`/`yscale` only; geometry uses `transform`. */
	scale: { x: number; y: number };
	/** Full affine mapping from source coordinates to display cm. */
	transform: PictureTransform;
	/**
	 * False when the picture options change the coordinate system in a way
	 * this editor cannot mirror (`cm=`, unit-vector overrides, …); all
	 * contained objects stay source-only.
	 */
	editable: boolean;
	/** The option token that made the picture non-editable, when one did. */
	lockedOption: string | null;
	/** True when the fence body has no tikzpicture environment at all. */
	implicit: boolean;
}

export interface SceneDiagnostic {
	severity: 'info' | 'warning' | 'error';
	message: string;
	span: SourceSpan | null;
}

export interface TikzScene {
	source: string;
	pictures: ScenePicture[];
	objects: SceneObject[];
	diagnostics: SceneDiagnostic[];
}

/** A minimal replacement of one span of the fence body. */
export interface SourcePatch {
	oldSpan: SourceSpan;
	replacement: string;
}

export type EditorToolId =
	| 'select'
	| 'pan'
	| 'line'
	| 'arrow'
	| 'path'
	| 'bezier'
	| 'freehand'
	| 'rect'
	| 'rounded-rect'
	| 'triangle'
	| 'circle'
	| 'ellipse'
	| 'arc'
	| 'grid-path'
	| 'diamond'
	| 'polygon'
	| 'star'
	| 'text'
	| 'math'
	| 'plot';

export type DashStyle = 'solid' | 'dashed' | 'dotted';

/** Style attributes the properties panel can read and write. */
export interface ObjectStyle {
	strokeColor?: string;
	fillColor?: string;
	lineWidth?: 'thin' | 'default' | 'thick' | 'very thick';
	dash?: DashStyle;
	arrows?: '' | '->' | '<-' | '<->';
	opacity?: number;
	roundedCorners?: boolean;
	anchor?: string;
	fontSize?: '' | 'small' | 'normal' | 'large';
}
