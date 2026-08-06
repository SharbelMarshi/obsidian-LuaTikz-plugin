import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	WidgetType,
	type ViewUpdate,
} from '@codemirror/view';
import { findFencedTikzRanges } from './tikzFences';

interface TikzBlockRange {
	from: number;
	to: number;
	startLine: number;
	endLine: number;
}

const FENCE_LINE_RE = /^```/;
const TIKZPICTURE_BEGIN_RE = /\\begin\{tikzpicture\}/;
const TIKZPICTURE_END_RE = /\\end\{tikzpicture\}/;

function isFenceLine(text: string): boolean {
	return FENCE_LINE_RE.test(text.trim());
}

function findTikzpictureRanges(doc: EditorView['state']['doc']): TikzBlockRange[] {
	const ranges: TikzBlockRange[] = [];
	let openLine: number | null = null;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const line = doc.line(lineNumber);
		const trimmed = line.text.trim();

		if (openLine === null) {
			if (TIKZPICTURE_BEGIN_RE.test(trimmed)) {
				openLine = lineNumber;
			}
			continue;
		}

		if (TIKZPICTURE_END_RE.test(trimmed)) {
			ranges.push({
				from: doc.line(openLine).from,
				to: line.to,
				startLine: openLine,
				endLine: lineNumber,
			});
			openLine = null;
		}
	}

	return ranges;
}

function rangeContains(outer: TikzBlockRange, inner: TikzBlockRange): boolean {
	return inner.startLine >= outer.startLine && inner.endLine <= outer.endLine;
}

/**
 * Sorted by position and non-overlapping — both are load-bearing. The line
 * decorations built from these ranges feed a RangeSetBuilder, which throws on
 * a decreasing `from`; CodeMirror then drops the whole view plugin and the
 * inline line numbers silently vanish for the session. A standalone
 * \begin{tikzpicture} sitting *above* a ```tikz fence used to produce exactly
 * that ordering.
 */
function findTikzBlockRanges(doc: EditorView['state']['doc']): TikzBlockRange[] {
	const fenced = findFencedTikzRanges(doc);
	const standaloneTikzpicture = findTikzpictureRanges(doc).filter(
		tikzpicture => !fenced.some(fence => rangeContains(fence, tikzpicture)),
	);

	const sorted = [...fenced, ...standaloneTikzpicture].sort((a, b) => a.from - b.from);

	// Partial overlaps (a tikzpicture straddling a fence boundary) would still
	// interleave line decorations; keep the earlier range and drop the rest.
	const disjoint: TikzBlockRange[] = [];
	for (const range of sorted) {
		const previous = disjoint[disjoint.length - 1];
		if (previous && range.startLine <= previous.endLine) {
			continue;
		}
		disjoint.push(range);
	}
	return disjoint;
}

/**
 * Block ranges as state, recomputed only when the document changes. The three
 * plugins below all need the ranges, and each used to rescan the whole
 * document on every cursor move — three O(doc) walks per keystroke in every
 * markdown file.
 */
const tikzBlockRangesField = StateField.define<TikzBlockRange[]>({
	create: state => findTikzBlockRanges(state.doc),
	update(ranges, tr) {
		return tr.docChanged ? findTikzBlockRanges(tr.state.doc) : ranges;
	},
});

function blockForPos(ranges: TikzBlockRange[], pos: number): TikzBlockRange | null {
	for (const range of ranges) {
		if (pos >= range.from && pos <= range.to) {
			return range;
		}
	}
	return null;
}

function lineIndexInRange(rangeStartLine: number, lineNumber: number): number {
	return lineNumber - rangeStartLine + 1;
}

class TikzLineNumberWidget extends WidgetType {
	constructor(private readonly lineNumber: number) {
		super();
	}

	override eq(other: TikzLineNumberWidget): boolean {
		return other.lineNumber === this.lineNumber;
	}

	override toDOM(): HTMLElement {
		return createSpan({
			cls: 'luatikz-inline-line-number',
			text: String(this.lineNumber),
			attr: { 'aria-hidden': 'true' },
		});
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

function buildTikzIdeDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;

	for (const range of view.state.field(tikzBlockRangesField)) {
		for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
			const line = doc.line(lineNumber);
			if (isFenceLine(line.text)) {
				continue;
			}

			builder.add(
				line.from,
				line.from,
				Decoration.line({ class: 'luatikz-ide-code-line' }),
			);

			const index = lineIndexInRange(range.startLine, lineNumber);
			builder.add(
				line.from,
				line.from,
				Decoration.widget({
					widget: new TikzLineNumberWidget(index),
					side: -1,
				}),
			);
		}
	}

	return builder.finish();
}

// Every plugin below seeds its decorations in the constructor: a freshly
// opened note gets no update until the first edit or scroll, so relying on
// update() alone leaves the gutter empty on first paint.
const tikzIdeDecorationsPlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildTikzIdeDecorations(view);
	}

	update(update: ViewUpdate): void {
		if (!update.docChanged && !update.viewportChanged) {
			return;
		}
		this.decorations = buildTikzIdeDecorations(update.view);
	}
}, {
	decorations: value => value.decorations,
});

function computeActiveLineDecorations(state: EditorState): DecorationSet {
	const ranges = state.field(tikzBlockRangesField);
	const head = state.selection.main.head;
	const block = blockForPos(ranges, head);
	if (!block) {
		return Decoration.none;
	}

	const line = state.doc.lineAt(head);
	return Decoration.set([
		Decoration.line({ class: 'luatikz-ide-active-line' }).range(line.from),
	]);
}

const tikzActiveLinePlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = computeActiveLineDecorations(view.state);
	}

	update(update: ViewUpdate): void {
		if (!update.selectionSet && !update.docChanged) {
			return;
		}
		this.decorations = computeActiveLineDecorations(update.state);
	}
}, {
	decorations: value => value.decorations,
});

function computeEnvPairDecorations(state: EditorState): DecorationSet {
	const ranges = state.field(tikzBlockRangesField);
	const head = state.selection.main.head;
	const block = blockForPos(ranges, head);
	if (!block) {
		return Decoration.none;
	}

	const line = state.doc.lineAt(head);
	const lineText = line.text;
	const beginMatch = lineText.match(/\\begin\{([^}]+)\}/);
	const endMatch = lineText.match(/\\end\{([^}]+)\}/);
	if (!beginMatch && !endMatch) {
		return Decoration.none;
	}

	const blockSource = state.doc.sliceString(block.from, block.to);
	const lineIndexInBlock = line.number - block.startLine;
	const isBegin = !!beginMatch;
	const matchedLine = findMatchingEnvLineInBlock(blockSource, lineIndexInBlock, isBegin);
	if (matchedLine === null) {
		return Decoration.none;
	}

	const matchedDocLine = block.startLine + matchedLine;
	const matchedFrom = state.doc.line(matchedDocLine).from;
	// sort=true: the partner line can precede the cursor's line (cursor on an
	// \end), and Decoration.set does not sort by default.
	return Decoration.set([
		Decoration.line({ class: 'luatikz-ide-env-pair' }).range(matchedFrom),
		Decoration.line({ class: 'luatikz-ide-env-pair' }).range(line.from),
	], true);
}

const tikzEnvPairPlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = computeEnvPairDecorations(view.state);
	}

	update(update: ViewUpdate): void {
		if (!update.selectionSet && !update.docChanged) {
			return;
		}
		this.decorations = computeEnvPairDecorations(update.state);
	}
}, {
	decorations: value => value.decorations,
});

function findMatchingEnvLineInBlock(
	source: string,
	cursorLineInBlock: number,
	isBegin: boolean,
): number | null {
	const lines = source.split('\n');
	const stack: { env: string; line: number }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const match of line.matchAll(/\\begin\{([^}]+)\}/g)) {
			stack.push({ env: match[1], line: i });
		}
		for (const match of line.matchAll(/\\end\{([^}]+)\}/g)) {
			const env = match[1];
			const idx = stack.map(entry => entry.env).lastIndexOf(env);
			if (idx !== -1) {
				const begin = stack[idx];
				if (i === cursorLineInBlock || begin.line === cursorLineInBlock) {
					// The *partner* line: from a \begin return its \end and vice
					// versa. This used to be inverted, returning the cursor's own
					// line in both branches, so the pair highlight never showed.
					return isBegin ? i : begin.line;
				}
				stack.splice(idx, 1);
			}
		}
	}

	return null;
}

export function tikzIdeExtension(): Extension {
	return [
		tikzBlockRangesField,
		tikzIdeDecorationsPlugin,
		tikzActiveLinePlugin,
		tikzEnvPairPlugin,
		EditorView.baseTheme({
			'.luatikz-inline-line-number': {
				display: 'inline-block',
				boxSizing: 'border-box',
				minWidth: '2.6em',
				marginRight: '0.35em',
				paddingRight: '0.35em',
				textAlign: 'right',
				color: 'var(--text-muted)',
				fontFamily: 'var(--font-monospace)',
				fontSize: '0.82em',
				userSelect: 'none',
				borderRight: '1px solid var(--background-modifier-border)',
			},
			'.luatikz-ide-code-line': {
				fontFamily: 'var(--font-monospace)',
			},
			'.luatikz-ide-active-line': {
				backgroundColor: 'rgba(var(--color-accent-rgb), 0.08)',
			},
			'.luatikz-ide-env-pair': {
				backgroundColor: 'rgba(var(--color-yellow-rgb), 0.12)',
			},
		}),
	];
}
