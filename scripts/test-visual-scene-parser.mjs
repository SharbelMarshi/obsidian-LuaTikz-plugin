/**
 * Scene parser for the visual editor: editable subset recognition, exact
 * statement spans, safe locking of unsupported syntax, multi-picture and
 * implicit-picture handling, and insertion-point computation.
 *
 * Every assertion runs against the shipped src modules — the parser's span
 * arithmetic is exactly the kind of logic that drifts silently when a test
 * keeps its own copy.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { parser } = await loadSrcModules({ parser: 'src/visual/tikzSceneParser.ts' });
const { parseTikzScene, insertionPicture, statementInsertionPoint } = parser;

// --- editable statements ----------------------------------------------------

const body = `\\begin{tikzpicture}
  % keep this comment
  \\draw[->, thick] (0,0) -- (3,2);
  \\draw (1,1) rectangle (2,3);
  \\draw (2,2) circle[radius=1cm];
  \\draw (2,2) ellipse[x radius=2cm, y radius=1cm];
  \\draw (0,0) arc[start angle=0, end angle=90, radius=1cm];
  \\draw (1,0) arc (0:45:2);
  \\draw (0,0) .. controls (1,2) and (3,2) .. (4,0);
  \\node[anchor=west] (label) at (2,1) {$\\alpha$};
  \\coordinate (origin) at (0,0);
  \\draw (5,5) -- ++(1,0) -- +(0,1) -- cycle;
  \\draw (0,0) -| (2,2);
  \\filldraw[blue] (1,1) circle (2pt);
\\end{tikzpicture}`;

const scene = parseTikzScene(body);
assert.equal(scene.pictures.length, 1);
assert.equal(scene.pictures[0].implicit, false);
assert.equal(scene.pictures[0].editable, true);

const types = scene.objects.map(object => object.type);
assert.deepEqual(types, [
	'path', 'path', 'path', 'path', 'path', 'path', 'path',
	'node', 'node', 'path', 'path', 'path',
]);

// Spans slice back to the exact statement text, including the semicolon.
for (const object of scene.objects) {
	const text = body.slice(object.span.from, object.span.to);
	assert.ok(text.startsWith('\\'), `span start off: ${JSON.stringify(text)}`);
	assert.ok(text.endsWith(';'), `span end off: ${JSON.stringify(text)}`);
}

// Options span excludes the brackets.
const arrow = scene.objects[0];
assert.equal(body.slice(arrow.optionsSpan.from, arrow.optionsSpan.to), '->, thick');

// Coordinate tokens carry resolved absolute positions; ++ chains resolve.
const relPath = scene.objects[9];
const coords = relPath.elements.filter(element => element.kind === 'coord');
assert.deepEqual(coords.map(element => element.coord.prefix), ['', '++', '+']);
assert.deepEqual(coords[1].coord.resolved, { x: 6, y: 5 });
assert.deepEqual(coords[2].coord.resolved, { x: 6, y: 6 });

// Node parse: name, options, at, text span.
const node = scene.objects[7];
assert.equal(node.command, 'node');
assert.equal(node.name, 'label');
assert.equal(node.text, '$\\alpha$');
assert.deepEqual(node.at.resolved, { x: 2, y: 1 });
assert.equal(body.slice(node.textSpan.from, node.textSpan.to), '$\\alpha$');

const coordStmt = scene.objects[8];
assert.equal(coordStmt.command, 'coordinate');
assert.equal(coordStmt.textSpan, null);

// Legacy circle radius keeps its unit out of the value span.
const legacyCircle = scene.objects[11];
const circleEl = legacyCircle.elements.find(element => element.kind === 'circle');
assert.equal(body.slice(circleEl.radius.valueSpan.from, circleEl.radius.valueSpan.to), '2');
assert.equal(circleEl.radius.unit, 'pt');

// Arc via options and via legacy colon form.
const arcOptions = scene.objects[4].elements.find(element => element.kind === 'arc');
assert.equal(arcOptions.startAngle.value, 0);
assert.equal(arcOptions.endAngle.value, 90);
const arcLegacy = scene.objects[5].elements.find(element => element.kind === 'arc');
assert.equal(arcLegacy.endAngle.value, 45);
assert.equal(arcLegacy.radius.cm, 2);

// --- locking, never guessing ------------------------------------------------

const lockedBody = `\\begin{tikzpicture}[cm={1,0,0,1,(0,0)}]
  \\draw (0,0) -- (1,1);
\\end{tikzpicture}
\\begin{tikzpicture}
  \\foreach \\x in {0,1,2} { \\draw (\\x,0) -- (\\x,1); }
  \\draw (0,0) to[bend left] (2,2);
  \\draw (a) -- (b);
  \\draw (0,0) -- (30:1);
  \\begin{scope}[shift={(1,1)}]
    \\draw (0,0) -- (1,0);
  \\end{scope}
  \\tikzset{my/.style={thick}}
  \\draw[my] (0,0) -- (1,0);
\\end{tikzpicture}`;

const lockedScene = parseTikzScene(lockedBody);
assert.equal(lockedScene.pictures.length, 2);
assert.equal(lockedScene.pictures[0].editable, false, 'cm= must lock the picture');

const p0 = lockedScene.objects.filter(object => object.pictureIndex === 0);
assert.equal(p0[0].type, 'locked');
assert.match(p0[0].reason, /"cm=/, 'lock reason must name the offending option');

// Mappable transforms no longer lock: rotate/shift/scale pictures are editable
// and carry the full affine transform.
const rotated = parseTikzScene(
	'\\begin{tikzpicture}[rotate=90]\n\\draw (1,0) -- (2,0);\n\\end{tikzpicture}',
);
assert.equal(rotated.pictures[0].editable, true, 'rotate must stay editable');
assert.equal(rotated.objects[0].type, 'path');
const rt = rotated.pictures[0].transform;
assert.ok(Math.abs(rt.a) < 1e-9 && Math.abs(rt.b - 1) < 1e-9, 'rotate=90 transform');

const shifted = parseTikzScene(
	'\\begin{tikzpicture}[shift={(1,2)}, scale=2]\n\\draw (0,0) -- (1,0);\n\\end{tikzpicture}',
);
assert.equal(shifted.pictures[0].editable, true, 'shift must stay editable');
assert.deepEqual(
	{ tx: shifted.pictures[0].transform.tx, ty: shifted.pictures[0].transform.ty },
	{ tx: 1, ty: 2 },
);
assert.equal(shifted.pictures[0].transform.a, 2);

// Unit-vector overrides are affine too: x=1cm/y=1cm is exactly the default,
// x=0.5cm halves the x axis, and coordinate forms set full columns.
const unitDefault = parseTikzScene(
	'\\begin{tikzpicture}[x=1cm, y=1cm]\n\\draw (0,0) -- (1,0);\n\\end{tikzpicture}',
);
assert.equal(unitDefault.pictures[0].editable, true, 'x=1cm must stay editable');
assert.deepEqual(unitDefault.pictures[0].transform, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
assert.equal(unitDefault.objects[0].type, 'path');

const unitHalf = parseTikzScene(
	'\\begin{tikzpicture}[x=0.5cm, y={(0cm,2cm)}]\n\\draw (0,0) -- (1,0);\n\\end{tikzpicture}',
);
assert.equal(unitHalf.pictures[0].editable, true);
assert.equal(unitHalf.pictures[0].transform.a, 0.5);
assert.equal(unitHalf.pictures[0].transform.d, 2);

// Native function plots are editable path objects: the expression must
// compile under pgfmath semantics, domain/samples/shift come from options.
const plotScene = parseTikzScene(
	'\\begin{tikzpicture}\n\\draw[thick, domain=0:2, samples=40, shift={(1, -0.5)}] plot (\\x, {0.5*sin(deg(\\x))});\n\\end{tikzpicture}',
);
assert.equal(plotScene.objects[0].type, 'path', 'supported plot form is editable');
assert.equal(plotScene.objects[0].elements[0].kind, 'plot');
assert.deepEqual(plotScene.objects[0].plotDomain, { from: 0, to: 2 });
assert.equal(plotScene.objects[0].plotSamples, 40);
assert.deepEqual(plotScene.objects[0].optionShift, { x: 1, y: -0.5 });

const plotLocked = parseTikzScene(
	'\\begin{tikzpicture}\n\\draw plot coordinates {(0,0) (1,1)};\n\\draw plot (\\x, {undefinedfn(\\x)});\n\\end{tikzpicture}',
);
assert.equal(plotLocked.objects[0].type, 'locked', 'coordinate-list plots stay source-only');
assert.equal(plotLocked.objects[1].type, 'locked', 'unknown functions stay source-only');

const rotateAround = parseTikzScene(
	'\\begin{tikzpicture}[rotate around={90:(1,1)}]\n\\draw (1,1) -- (2,1);\n\\end{tikzpicture}',
);
assert.equal(rotateAround.pictures[0].editable, true, 'rotate around must stay editable');
const ra = rotateAround.pictures[0].transform;
// (1,1) is the fixed point of the rotation.
assert.ok(Math.abs(ra.a * 1 + ra.c * 1 + ra.tx - 1) < 1e-9);
assert.ok(Math.abs(ra.b * 1 + ra.d * 1 + ra.ty - 1) < 1e-9);

const p1 = lockedScene.objects.filter(object => object.pictureIndex === 1);
const reasons = p1.map(object => (object.type === 'locked' ? object.reason : 'editable'));
assert.match(reasons[0], /foreach/);
assert.equal(reasons[1], 'path syntax outside the supported subset'); // to[bend left]
assert.equal(reasons[2], 'path syntax outside the supported subset'); // named coords
assert.equal(reasons[3], 'path syntax outside the supported subset'); // polar
assert.match(reasons[4], /scope/);
// The custom user style is preserved and the statement stays editable —
// unknown option tokens are not a reason to lock.
assert.equal(reasons[5], 'editable');

// The foreach span covers the braced body without a trailing semicolon.
const foreachObject = p1[0];
const foreachText = lockedBody.slice(foreachObject.span.from, foreachObject.span.to);
assert.ok(foreachText.startsWith('\\foreach'));
assert.ok(foreachText.trimEnd().endsWith('}'));

// A diagnostic reports the locked statements without failing the parse.
assert.ok(lockedScene.diagnostics.some(diagnostic => /source-only/.test(diagnostic.message)));

// --- implicit picture (no environment) --------------------------------------

const implicitScene = parseTikzScene('\\draw (0,0) -- (1,1);\n');
assert.equal(implicitScene.pictures.length, 1);
assert.equal(implicitScene.pictures[0].implicit, true);
assert.equal(implicitScene.objects.length, 1);
assert.equal(implicitScene.objects[0].type, 'path');

// --- insertion points -------------------------------------------------------

const emptyScene = parseTikzScene('\\begin{tikzpicture}\n\\end{tikzpicture}');
const emptyPoint = statementInsertionPoint(emptyScene, insertionPicture(emptyScene));
assert.equal(emptyScene.source.slice(0, emptyPoint.offset).endsWith('\n'), true);
assert.equal(emptyPoint.needsLeadingNewline, false);

const indented = parseTikzScene('\\begin{tikzpicture}\n    \\draw (0,0) -- (1,1);\n\\end{tikzpicture}');
const indentedPoint = statementInsertionPoint(indented, insertionPicture(indented));
assert.equal(indentedPoint.indent, '    ');

// Insertion goes to the last picture when several exist.
const multi = parseTikzScene([
	'\\begin{tikzpicture}', '\\draw (0,0) -- (1,1);', '\\end{tikzpicture}',
	'middle prose stays untouched',
	'\\begin{tikzpicture}', '\\draw (2,2) -- (3,3);', '\\end{tikzpicture}',
].join('\n'));
assert.equal(multi.pictures.length, 2);
assert.equal(insertionPicture(multi).index, 1);
assert.equal(multi.objects.length, 2);
assert.equal(multi.objects[0].pictureIndex, 0);
assert.equal(multi.objects[1].pictureIndex, 1);

// Picture scale is read from the environment options.
const scaled = parseTikzScene('\\begin{tikzpicture}[scale=2, yscale=0.5]\n\\draw (1,1) -- (2,2);\n\\end{tikzpicture}');
assert.deepEqual(scaled.pictures[0].scale, { x: 2, y: 0.5 });
assert.equal(scaled.pictures[0].editable, true);

console.log('visual-scene-parser: ok');
