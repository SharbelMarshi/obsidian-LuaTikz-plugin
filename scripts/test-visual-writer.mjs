/**
 * TikZ generation and minimal-patch editing: every visual operation must
 * produce native, readable TikZ and touch only the characters it has to.
 *
 * The round-trip half of the file is the important one: statements the
 * editor generates must parse back into editable objects, and patched
 * sources must stay byte-identical outside the edited tokens — comments,
 * indentation, and unsupported statements included.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { writer, parser, patcher, options } = await loadSrcModules({
	writer: 'src/visual/tikzWriter.ts',
	parser: 'src/visual/tikzSceneParser.ts',
	patcher: 'src/visual/sourcePatches.ts',
	options: 'src/visual/tikzOptions.ts',
});

const { parseTikzScene, insertionPicture } = parser;
const { applySourcePatches } = patcher;

// --- statement generation ---------------------------------------------------

assert.equal(
	writer.generateLine({ x: 0, y: 0 }, { x: 3, y: 2 }, {}),
	'\\draw (0.00, 0.00) -- (3.00, 2.00);',
);
assert.equal(
	writer.generateLine({ x: 0, y: 0 }, { x: 3, y: 2 }, { arrows: '->' }),
	'\\draw[->] (0.00, 0.00) -- (3.00, 2.00);',
);
assert.equal(
	writer.generateRectangle({ x: 1, y: 1 }, { x: 2, y: 3 }, { roundedCorners: true }),
	'\\draw[rounded corners] (1.00, 1.00) rectangle (2.00, 3.00);',
);
assert.equal(
	writer.generateCircle({ x: 2, y: 2 }, 1, {}),
	'\\draw (2.00, 2.00) circle[radius=1cm];',
);
assert.equal(
	writer.generateEllipse({ x: 2, y: 2 }, 2, 1, {}),
	'\\draw (2.00, 2.00) ellipse[x radius=2cm, y radius=1cm];',
);
assert.equal(
	writer.generateArc({ x: 1, y: 0 }, 0, 90, 1.5, {}),
	'\\draw (1.00, 0.00) arc[start angle=0, end angle=90, radius=1.5cm];',
);
assert.equal(
	writer.generateGridPath({ x: 0, y: 0 }, { x: 4, y: 3 }, 1, {}),
	'\\draw[step=1cm] (0.00, 0.00) grid (4.00, 3.00);',
);
assert.equal(
	writer.generateNode({ x: 2, y: 1 }, '\\alpha', true, {}),
	'\\node at (2.00, 1.00) {$\\alpha$};',
);
assert.equal(
	writer.generateNode({ x: 2, y: 1 }, 'label', false, { anchor: 'west' }),
	'\\node[anchor=west] at (2.00, 1.00) {label};',
);
assert.equal(
	writer.generatePolyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true, {}),
	'\\draw (0.00, 0.00) -- (1.00, 0.00) -- (1.00, 1.00) -- cycle;',
);

const curve = writer.generateCurvePath(
	[{ x: 0, y: 0 }, { x: 4, y: 0 }],
	[{ c1: { x: 1, y: 2 }, c2: { x: 3, y: 2 } }],
	{},
);
assert.match(curve, /\.\. controls \(1\.00, 2\.00\) and \(3\.00, 2\.00\) \.\. \(4\.00, 0\.00\);/);

// Shape helpers produce closed native paths.
assert.equal(writer.diamondPoints({ x: 0, y: 0 }, 1, 2).length, 4);
assert.equal(writer.polygonPoints({ x: 0, y: 0 }, 1, 6).length, 6);
assert.equal(writer.starPoints({ x: 0, y: 0 }, 1, 0.5, 5).length, 10);

// Everything the editor generates must round-trip into an editable object.
for (const statement of [
	writer.generateLine({ x: 0, y: 0 }, { x: 3, y: 2 }, { arrows: '->', strokeColor: 'red' }),
	writer.generateRectangle({ x: 1, y: 1 }, { x: 2, y: 3 }, {}),
	writer.generateCircle({ x: 2, y: 2 }, 1.25, {}),
	writer.generateEllipse({ x: 0, y: 0 }, 2, 1, {}),
	writer.generateArc({ x: 1, y: 0 }, 0, 90, 1.5, {}),
	writer.generateGridPath({ x: 0, y: 0 }, { x: 4, y: 3 }, 0.5, {}),
	writer.generateNode({ x: 2, y: 1 }, 'x^2', true, {}),
	curve,
	writer.generatePolyline(writer.starPoints({ x: 0, y: 0 }, 2, 0.5, 5), true, {}),
]) {
	const roundTrip = parseTikzScene(`\\begin{tikzpicture}\n${statement}\n\\end{tikzpicture}`);
	assert.equal(roundTrip.objects.length, 1, statement);
	assert.notEqual(roundTrip.objects[0].type, 'locked', `not editable: ${statement}`);
}

// --- option handling --------------------------------------------------------

assert.deepEqual(
	options.splitOptionTokens('->, thick, fill=red!20, my style={a,b}').map(t => t.text),
	['->', 'thick', 'fill=red!20', 'my style={a,b}'],
);

const parsedStyle = options.parseOptionStyle('->, very thick, dashed, blue!50, fill=red, opacity=0.5');
assert.equal(parsedStyle.arrows, '->');
assert.equal(parsedStyle.lineWidth, 'very thick');
assert.equal(parsedStyle.dash, 'dashed');
assert.equal(parsedStyle.strokeColor, 'blue!50');
assert.equal(parsedStyle.fillColor, 'red');
assert.equal(parsedStyle.opacity, 0.5);

// Unknown tokens survive a style edit untouched and in order.
assert.equal(
	options.applyStyleEdit('decorate, my style, ->, thick', { arrows: '<->', dash: 'dotted' }),
	'decorate, my style, <->, thick, dotted',
);
// Clearing a property removes its token without touching the rest.
assert.equal(
	options.applyStyleEdit('red, dashed', { dash: null }),
	'red',
);

// --- minimal patches --------------------------------------------------------

const body = [
	'\\begin{tikzpicture}',
	'  % important comment',
	'  \\draw[->] (0,0) -- (3,2); % trailing note',
	'  \\foreach \\x in {1,2} \\draw (\\x,0) circle[radius=2pt];',
	'  \\node at (1,1) {hi};',
	'\\end{tikzpicture}',
].join('\n');
const scene = parseTikzScene(body);
const line = scene.objects[0];
const node = scene.objects[2];

// Translating touches only the two coordinate tokens.
const movePatches = writer.translateObjectPatches(line, 0.5, -0.5);
assert.equal(movePatches.length, 2);
const moved = applySourcePatches(body, movePatches);
assert.equal(moved.kind, 'success');
assert.ok(moved.source.includes('\\draw[->] (0.50, -0.50) -- (3.50, 1.50); % trailing note'));
// Everything outside the statement is byte-identical.
assert.ok(moved.source.includes('  % important comment'));
assert.ok(moved.source.includes('\\foreach \\x in {1,2} \\draw (\\x,0) circle[radius=2pt];'));

// Relative coordinates are translation-invariant.
const relScene = parseTikzScene('\\draw (1,1) -- ++(2,0);');
const relPatches = writer.translateObjectPatches(relScene.objects[0], 1, 1);
assert.equal(relPatches.length, 1);
assert.equal(
	applySourcePatches(relScene.source, relPatches).source,
	'\\draw (2.00, 2.00) -- ++(2,0);',
);

// Endpoint edit rewrites one token; a ++ token gets the delta from its base.
const endpoints = relScene.objects[0].elements.filter(element => element.kind === 'coord');
const relPatch = writer.coordinateTokenPatch(endpoints[1].coord, { x: 4, y: 2 }, { x: 1, y: 1 });
assert.equal(
	applySourcePatches(relScene.source, [relPatch]).source,
	'\\draw (1,1) -- ++(3.00, 1.00);',
);

// Length token edits preserve the written unit.
const circleScene = parseTikzScene('\\draw (0,0) circle[radius=10pt];');
const circleEl = circleScene.objects[0].elements.find(element => element.kind === 'circle');
const radiusPatch = writer.lengthTokenPatch(circleEl.radius, 1);
const patchedCircle = applySourcePatches(circleScene.source, [radiusPatch]).source;
assert.match(patchedCircle, /radius=28\.45pt/);

const bareScene = parseTikzScene('\\draw (0,0) circle[radius=1];');
const bareEl = bareScene.objects[0].elements.find(element => element.kind === 'circle');
assert.equal(
	applySourcePatches(bareScene.source, [writer.lengthTokenPatch(bareEl.radius, 2.5)]).source,
	'\\draw (0,0) circle[radius=2.5];',
);

// Style edits patch the existing bracket in place, or insert a new one.
const styled = applySourcePatches(body, writer.styleEditPatches(body, line, { strokeColor: 'red' }));
assert.ok(styled.source.includes('\\draw[->, red] (0,0) -- (3,2);'));
const noOptScene = parseTikzScene('\\draw (0,0) -- (1,1);');
const inserted = applySourcePatches(
	noOptScene.source,
	writer.styleEditPatches(noOptScene.source, noOptScene.objects[0], { dash: 'dashed' }),
);
assert.equal(inserted.source, '\\draw[dashed] (0,0) -- (1,1);');

// Node text patch.
const textPatch = writer.nodeTextPatch(node, '$\\beta$');
assert.ok(applySourcePatches(body, [textPatch]).source.includes('{$\\beta$}'));

// Deleting removes the whole line when the statement is alone on it.
const deleted = applySourcePatches(body, writer.deleteObjectPatches(body, node));
assert.ok(!deleted.source.includes('\\node'));
assert.ok(!/\n\s*\n\s*\\end\{tikzpicture\}/.test(deleted.source), 'left a blank line behind');

// Duplication inserts a shifted copy below, matching indentation.
const dup = applySourcePatches(body, writer.duplicateObjectPatches(body, node, 0.5, -0.5));
assert.ok(dup.source.includes('  \\node at (1,1) {hi};\n  \\node at (1.50, 0.50) {hi};'));

// Insertion lands before \end{tikzpicture} with surrounding lines intact.
const insertPatches = writer.insertStatementPatches(
	scene, insertionPicture(scene), '\\draw (9, 9) -- (8, 8);',
);
const withInsert = applySourcePatches(body, insertPatches).source;
assert.ok(withInsert.includes('  \\node at (1,1) {hi};\n  \\draw (9, 9) -- (8, 8);\n\\end{tikzpicture}'));

// penPositionsBefore feeds relative-token bases.
const penScene = parseTikzScene('\\draw (1,1) -- ++(2,0) -- ++(0,3);');
const bases = writer.penPositionsBefore(penScene.objects[0]);
const coordIndexes = penScene.objects[0].elements
	.map((element, index) => (element.kind === 'coord' ? index : -1))
	.filter(index => index >= 0);
assert.deepEqual(bases[coordIndexes[1]], { x: 1, y: 1 });
assert.deepEqual(bases[coordIndexes[2]], { x: 3, y: 1 });

console.log('visual-writer: ok');
