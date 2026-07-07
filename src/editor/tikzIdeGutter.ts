import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	WidgetType,
	type ViewUpdate,
} from '@codemirror/view';

interface TikzBlockRange {
	from: number;
	to: number;
	startLine: number;
	endLine: number;
}

const OPEN_FENCE_RE = /^```(?:tikz|luatikz)\b.*$/;
const FENCE_LINE_RE = /^```/;
const TIKZPICTURE_BEGIN_RE = /\\begin\{tikzpicture\}/;
const TIKZPICTURE_END_RE = /\\end\{tikzpicture\}/;

function isFenceLine(text: string): boolean {
	return FENCE_LINE_RE.test(text.trim());
}

function findFencedTikzRanges(doc: EditorView['state']['doc']): TikzBlockRange[] {
	const ranges: TikzBlockRange[] = [];
	let openLine: number | null = null;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const line = doc.line(lineNumber);
		const trimmed = line.text.trim();

		if (openLine === null) {
			if (OPEN_FENCE_RE.test(trimmed)) {
				openLine = lineNumber;
			}
			continue;
		}

		if (trimmed === '```') {
			const contentStartLine = openLine + 1;
			const contentEndLine = lineNumber - 1;
			if (contentEndLine >= contentStartLine) {
				ranges.push({
					from: doc.line(contentStartLine).from,
					to: doc.line(contentEndLine).to,
					startLine: contentStartLine,
					endLine: contentEndLine,
				});
			}
			openLine = null;
		}
	}

	return ranges;
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

function findTikzBlockRanges(doc: EditorView['state']['doc']): TikzBlockRange[] {
	const fenced = findFencedTikzRanges(doc);
	const standaloneTikzpicture = findTikzpictureRanges(doc).filter(
		tikzpicture => !fenced.some(fence => rangeContains(fence, tikzpicture)),
	);
	return [...fenced, ...standaloneTikzpicture];
}

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
		const span = document.createElement('span');
		span.className = 'luatikz-inline-line-number';
		span.textContent = String(this.lineNumber);
		span.setAttribute('aria-hidden', 'true');
		return span;
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

function buildTikzIdeDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;

	for (const range of findTikzBlockRanges(doc)) {
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

const tikzIdeDecorationsPlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet = Decoration.none;

	update(update: ViewUpdate): void {
		if (!update.docChanged && !update.viewportChanged) {
			return;
		}
		this.decorations = buildTikzIdeDecorations(update.view);
	}
}, {
	decorations: value => value.decorations,
});

const tikzActiveLinePlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet = Decoration.none;

	update(update: ViewUpdate): void {
		if (!update.selectionSet && !update.docChanged) {
			return;
		}

		const ranges = findTikzBlockRanges(update.state.doc);
		const head = update.state.selection.main.head;
		const block = blockForPos(ranges, head);
		if (!block) {
			this.decorations = Decoration.none;
			return;
		}

		const line = update.state.doc.lineAt(head);
		this.decorations = Decoration.set([
			Decoration.line({ class: 'luatikz-ide-active-line' }).range(line.from),
		]);
	}
}, {
	decorations: value => value.decorations,
});

const tikzEnvPairPlugin = ViewPlugin.fromClass(class {
	decorations: DecorationSet = Decoration.none;

	update(update: ViewUpdate): void {
		if (!update.selectionSet && !update.docChanged) {
			return;
		}

		const ranges = findTikzBlockRanges(update.state.doc);
		const head = update.state.selection.main.head;
		const block = blockForPos(ranges, head);
		if (!block) {
			this.decorations = Decoration.none;
			return;
		}

		const line = update.state.doc.lineAt(head);
		const lineText = line.text;
		const beginMatch = lineText.match(/\\begin\{([^}]+)\}/);
		const endMatch = lineText.match(/\\end\{([^}]+)\}/);
		if (!beginMatch && !endMatch) {
			this.decorations = Decoration.none;
			return;
		}

		const blockSource = update.state.doc.sliceString(block.from, block.to);
		const lineIndexInBlock = line.number - block.startLine;
		const isBegin = !!beginMatch;
		const matchedLine = findMatchingEnvLineInBlock(blockSource, lineIndexInBlock, isBegin);
		if (matchedLine === null) {
			this.decorations = Decoration.none;
			return;
		}

		const matchedDocLine = block.startLine + matchedLine;
		const matchedFrom = update.state.doc.line(matchedDocLine).from;
		this.decorations = Decoration.set([
			Decoration.line({ class: 'luatikz-ide-env-pair' }).range(matchedFrom),
			Decoration.line({ class: 'luatikz-ide-env-pair' }).range(line.from),
		]);
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
					return isBegin ? begin.line : i;
				}
				stack.splice(idx, 1);
			}
		}
	}

	return null;
}

export function tikzIdeExtension(): Extension {
	return [
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
