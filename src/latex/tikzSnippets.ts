import { snippetCompletion, type Completion } from '@codemirror/autocomplete';

export type TikzSnippetCategory =
	| 'shape'
	| 'text'
	| 'gate'
	| 'wire'
	| 'circuit'
	| 'plot'
	| 'command'
	| 'coord'
	| 'template';

export interface TikzSnippetMeta {
	label: string;
	category: TikzSnippetCategory;
	detail: string;
	body: string;
	libraries?: string[];
	type?: Completion['type'];
}

function snippetFromMeta(meta: TikzSnippetMeta): Completion {
	return snippetCompletion(meta.body, {
		label: meta.label,
		type: meta.type ?? 'function',
		detail: meta.detail,
	});
}

export const TIKZ_SNIPPET_CATALOG: readonly TikzSnippetMeta[] = [
	{ label: '\\begin{tikzpicture}', category: 'command', detail: 'TikZ picture environment', body: '\\begin{tikzpicture}\n${}\n\\end{tikzpicture}' },
	{ label: '\\begin{axis}', category: 'plot', detail: 'PGFPlots axis environment', body: '\\begin{axis}[\n  width=10cm,\n  height=6cm,\n  xlabel={${1:x}},\n  ylabel={${2:y}},\n  grid=major,\n]\n${}\n\\end{axis}', libraries: ['pgfplots'] },
	{ label: '\\node (name)', category: 'command', detail: 'Named empty node at coordinate', body: '\\node (${1:name}) at (${2:0},${3:0}) {};' },
	{ label: '\\Circle(,,)', category: 'shape', detail: 'Circle: center (x,y), radius r (cm)', body: '\\Circle(${1:0},${2:0},${3:1})' },
	{ label: '\\FilledCircle(,,)', category: 'shape', detail: 'Filled circle: center (x,y), radius r', body: '\\FilledCircle(${1:0},${2:0},${3:1})' },
	{ label: '\\Point(,)', category: 'shape', detail: 'Small dot at (x,y)', body: '\\Point(${1:0},${2:0})' },
	{ label: '\\Line(,,,)', category: 'shape', detail: 'Line from (x1,y1) to (x2,y2)', body: '\\Line(${1:0},${2:0},${3:1},${4:1})' },
	{ label: '\\Arrow(,,,)', category: 'shape', detail: 'Arrow from (x1,y1) to (x2,y2)', body: '\\Arrow(${1:0},${2:0},${3:1},${4:1})' },
	{ label: '\\Rect(,,,)', category: 'shape', detail: 'Rectangle: corner (x1,y1) to (x2,y2)', body: '\\Rect(${1:0},${2:0},${3:1},${4:1})' },
	{ label: '\\FilledRect(,,,)', category: 'shape', detail: 'Filled rectangle', body: '\\FilledRect(${1:0},${2:0},${3:1},${4:1})' },
	{ label: '\\Grid(,,,,)', category: 'shape', detail: 'Grid from (x1,y1) to (x2,y2) step s', body: '\\Grid(${1:0},${2:0},${3:3},${4:3},${5:0.5})' },
	{ label: '\\Text(,,)', category: 'text', detail: 'Text node at (x,y)', body: '\\Text(${1:0},${2:0},${3:text})' },
	{ label: '\\TextAbove(,,)', category: 'text', detail: 'Text above (x,y)', body: '\\TextAbove(${1:0},${2:0},${3:text})' },
	{ label: '\\TextBelow(,,)', category: 'text', detail: 'Text below (x,y)', body: '\\TextBelow(${1:0},${2:0},${3:text})' },
	{ label: '\\TextLeft(,,)', category: 'text', detail: 'Text left of (x,y)', body: '\\TextLeft(${1:0},${2:0},${3:text})' },
	{ label: '\\TextRight(,,)', category: 'text', detail: 'Text right of (x,y)', body: '\\TextRight(${1:0},${2:0},${3:text})' },
	{ label: '\\TextRTL(,,)', category: 'text', detail: 'RTL-safe text node at (x,y)', body: '\\TextRTL(${1:0},${2:0},${3:text})' },
	{ label: '\\he{}', category: 'text', detail: 'Hebrew/RTL label wrapper', body: '\\he{${1:text}}' },
	{ label: '\\ar{}', category: 'text', detail: 'Arabic/RTL label wrapper', body: '\\ar{${1:text}}' },
	{ label: '\\ANDgate(,,)', category: 'gate', detail: 'AND gate at (x,y) named id', body: '\\ANDgate(${1:0},${2:0},${3:and1})', libraries: ['shapes.gates.logic.US'] },
	{ label: '\\ORgate(,,)', category: 'gate', detail: 'OR gate at (x,y) named id', body: '\\ORgate(${1:0},${2:0},${3:or1})', libraries: ['shapes.gates.logic.US'] },
	{ label: '\\NOTgate(,,)', category: 'gate', detail: 'NOT gate at (x,y) named id', body: '\\NOTgate(${1:0},${2:0},${3:not1})', libraries: ['shapes.gates.logic.US'] },
	{ label: 'AND chain (2-input)', category: 'gate', detail: 'Two inputs wired to an AND gate', body: '\\node (inA) at (${1:-1},${2:0.5}) {A};\n\\node (inB) at (${1:-1},${3:-0.5}) {B};\n\\ANDgate(${4:1},${5:0},${6:and1})\n\\LogicWire(inA, and1)\n\\LogicWire(inB, and1)', libraries: ['shapes.gates.logic.US'] },
	{ label: '\\LogicWire(,)', category: 'wire', detail: 'Orthogonal wire between nodes a and b', body: '\\LogicWire(${1:a},${2:b})' },
	{ label: '\\LogicWireArrow(,)', category: 'wire', detail: 'Orthogonal wire with arrow', body: '\\LogicWireArrow(${1:a},${2:b})' },
	{ label: '\\Resistor(,,,)', category: 'circuit', detail: 'Resistor symbol at (x,y)', body: '\\Resistor(${1:0},${2:0},${3:1},${4:0.3})' },
	{ label: '\\Capacitor(,,,)', category: 'circuit', detail: 'Capacitor symbol at (x,y)', body: '\\Capacitor(${1:0},${2:0},${3:0.4},${4:0.3})' },
	{ label: '\\ResistorRow(,,,)', category: 'circuit', detail: 'Horizontal row of resistors', body: '\\ResistorRow(${1:0},${2:0},${3:3},${4:1.2})' },
	{ label: 'Plot: sine wave', category: 'plot', detail: 'PGFPlots sine curve', body: '\\pgfplotsset{compat=1.18}\n\\begin{axis}[domain=0:360, samples=100, grid=major]\n\\addplot {sin(deg(x))};\n${}\n\\end{axis}', libraries: ['pgfplots'] },
	{ label: 'Plot: line chart', category: 'plot', detail: 'PGFPlots line with coordinates', body: '\\pgfplotsset{compat=1.18}\n\\begin{axis}[grid=major]\n\\addplot coordinates {(0,0) (1,2) (2,1) (3,3)};\n${}\n\\end{axis}', libraries: ['pgfplots'] },
	{ label: '($(A)!0.5!(B)$)', category: 'coord', detail: 'Midpoint between nodes A and B', body: '($(${1:A})!0.5!(${2:B})$)' },
	{ label: '(A -| B)', category: 'coord', detail: "A's x with B's y", body: '(${1:A} -| ${2:B})' },
	{ label: '(A.north east)', category: 'coord', detail: 'Anchor on node A', body: '(${1:A}.${2:north east})' },
	{ label: '(A) ++(1,0)', category: 'coord', detail: 'Relative offset from A', body: '(${1:A}) ++(${2:1},${3:0})' },
];

export const TIKZ_TEMPLATE_CATALOG: readonly { id: string; name: string; body: string }[] = [
	{
		id: 'blank-tikzpicture',
		name: 'Blank tikzpicture',
		body: '\\begin{tikzpicture}\n\n\\end{tikzpicture}',
	},
	{
		id: 'flowchart-3',
		name: 'Flowchart (3 boxes)',
		body: '\\begin{tikzpicture}[node distance=1.6cm, every node/.style={draw, rounded corners, minimum width=2.2cm, minimum height=0.9cm, align=center}]\n\\node (a) {Step 1};\n\\node (b) [below=of a] {Step 2};\n\\node (c) [below=of b] {Step 3};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n\\end{tikzpicture}',
	},
	{
		id: 'empty-axis',
		name: 'Empty PGFPlots axis',
		body: '\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n\\begin{axis}[\n  width=10cm,\n  height=6cm,\n  xlabel={x},\n  ylabel={y},\n  grid=major,\n]\n\\end{axis}\n\\end{tikzpicture}',
	},
	{
		id: 'logic-circuit',
		name: 'Logic circuit starter',
		body: '\\usetikzlibrary{shapes.gates.logic.US,circuits.logic.US,positioning}\n\\begin{tikzpicture}\n\\node (inA) at (0,0.5) {A};\n\\node (inB) at (0,-0.5) {B};\n\\ANDgate(2,0,and1)\n\\LogicWire(inA,and1)\n\\LogicWire(inB,and1)\n\\end{tikzpicture}',
	},
];

export const COMMAND_LIBRARY_MAP: Record<string, string[]> = {
	'\\ANDgate': ['shapes.gates.logic.US'],
	'\\ORgate': ['shapes.gates.logic.US'],
	'\\NOTgate': ['shapes.gates.logic.US'],
	'\\NANDgate': ['shapes.gates.logic.US'],
	'\\NORgate': ['shapes.gates.logic.US'],
	'\\XORgate': ['shapes.gates.logic.US'],
	'\\XNORgate': ['shapes.gates.logic.US'],
	'\\BUFFERgate': ['shapes.gates.logic.US'],
	'\\addplot': ['pgfplots'],
	'\\begin{axis}': ['pgfplots'],
};

export const NODE_ANCHOR_SUFFIXES = [
	'.center', '.north', '.south', '.east', '.west',
	'.north east', '.north west', '.south east', '.south west',
];

export const CATEGORY_PICKER: readonly { id: TikzSnippetCategory; label: string }[] = [
	{ id: 'shape', label: 'Shape' },
	{ id: 'text', label: 'Text' },
	{ id: 'gate', label: 'Gate' },
	{ id: 'wire', label: 'Wire' },
	{ id: 'circuit', label: 'Circuit' },
	{ id: 'plot', label: 'Plot' },
];

export function snippetCompletionsForCategory(category: TikzSnippetCategory): Completion[] {
	return TIKZ_SNIPPET_CATALOG
		.filter(entry => entry.category === category)
		.map(snippetFromMeta);
}

export function allSnippetCompletions(): Completion[] {
	return TIKZ_SNIPPET_CATALOG.map(snippetFromMeta);
}

export function cheatSheetEntries(): readonly TikzSnippetMeta[] {
	return TIKZ_SNIPPET_CATALOG;
}
