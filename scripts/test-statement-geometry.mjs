import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const outDir = mkdtempSync(join(tmpdir(), 'luatikz-geometry-'));
const outFile = join(outDir, 'tikzStatementGeometry.mjs');
buildSync({
	entryPoints: ['src/latex/tikzStatementGeometry.ts'],
	bundle: true,
	format: 'esm',
	outfile: outFile,
	logLevel: 'silent',
});
const geometry = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const { buildTikzGeometryMap, findStatementAt, geometryFitsPicture, parseLengthCm, parsePictureScale } = geometry;

// Body of a ```tikz block: line 0 is \begin{tikzpicture}.
const BLOCK = String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,0);
\draw[->] (0,1) -- (2,1);
\draw[red] (3,0) circle (0.5);
\node at (1,2) {Hello};
\fill[blue] (4,0) rectangle (5,1);
\draw (0,-1) -- (1,-2) -- (2,-1);
\end{tikzpicture}`;

const map = buildTikzGeometryMap(BLOCK);
assert.equal(map.statements.length, 6, 'one statement per drawing command');
assert.deepEqual(
	map.statements.map(s => s.startLine),
	[1, 2, 3, 4, 5, 6],
);

function lineAt(x, y, tolerance = 0.2) {
	const found = findStatementAt(map, { x, y }, tolerance);
	return found ? found.startLine : null;
}

// on the ink of each statement
assert.equal(lineAt(1, 0), 1, 'midpoint of the first segment');
assert.equal(lineAt(1, 1), 2, 'midpoint of the arrow segment');
assert.equal(lineAt(3, 0.5), 3, 'top of the circle');
assert.equal(lineAt(3.5, 0), 3, 'right of the circle');
assert.equal(lineAt(1, 2), 4, 'the node anchor');
assert.equal(lineAt(4.5, 0.5), 5, 'inside the filled rectangle');
assert.equal(lineAt(1, -2), 6, 'the polyline vertex');

// an unstroked circle interior is not part of the statement
assert.equal(lineAt(3, 0), null, 'centre of an unfilled circle is empty space');

// nothing matches far away from every shape
assert.equal(lineAt(20, 20), null, 'far from the picture');

// the arrow tip sits past the segment end but still belongs to its own line
assert.equal(lineAt(2.05, 1), 2, 'arrow head near (2,1)');

// picture-level scale
assert.deepEqual(parsePictureScale(String.raw`\begin{tikzpicture}[scale=2]`), { x: 2, y: 2 });
assert.deepEqual(
	parsePictureScale(String.raw`\begin{tikzpicture}[xscale=3, yscale=0.5]`),
	{ x: 3, y: 0.5 },
);
assert.deepEqual(parsePictureScale(String.raw`\begin{tikzpicture}`), { x: 1, y: 1 });

const scaled = buildTikzGeometryMap(String.raw`\begin{tikzpicture}[scale=2]
\draw (0,0) -- (1,0);
\end{tikzpicture}`);
assert.equal(findStatementAt(scaled, { x: 2, y: 0 }, 0.2)?.startLine, 1, 'scaled endpoint');
assert.equal(findStatementAt(scaled, { x: 3, y: 0 }, 0.2), null, 'past the scaled endpoint');

// relative coordinates
const relative = buildTikzGeometryMap(String.raw`\begin{tikzpicture}
\draw (1,1) -- ++(2,0) -- ++(0,2);
\end{tikzpicture}`);
assert.equal(findStatementAt(relative, { x: 3, y: 2 }, 0.2)?.startLine, 1, '++ chain');
assert.equal(findStatementAt(relative, { x: 2, y: 3 }, 0.2), null, 'not a mirror of the chain');

// multi-line statements cover every line they span
const wrapped = buildTikzGeometryMap(String.raw`\begin{tikzpicture}
\draw (0,0)
  -- (2,0)
  -- (2,2);
\end{tikzpicture}`);
assert.equal(wrapped.statements.length, 1);
assert.equal(wrapped.statements[0].startLine, 1);
assert.equal(wrapped.statements[0].endLine, 3);

// comments never start a statement
const commented = buildTikzGeometryMap(String.raw`\begin{tikzpicture}
% \draw (9,9) -- (9,0);
\draw (0,0) -- (1,0);
\end{tikzpicture}`);
assert.equal(commented.statements.length, 1);
assert.equal(commented.statements[0].startLine, 2);

// statements without parseable coordinates are skipped rather than guessed at
const symbolic = buildTikzGeometryMap(String.raw`\begin{tikzpicture}
\node (a) [right of=b] {x};
\end{tikzpicture}`);
assert.equal(symbolic.statements.length, 0);
assert.equal(symbolic.bounds, null);

// lengths
assert.equal(parseLengthCm('0.5'), 0.5);
assert.equal(parseLengthCm('3mm'), 0.30000000000000004);
assert.ok(Math.abs(parseLengthCm('28.452756pt') - 1) < 1e-6);
assert.equal(parseLengthCm('nonsense'), null);

// picture-fit guard
assert.equal(geometryFitsPicture(map, { minX: -0.2, minY: -2.2, maxX: 5.2, maxY: 2.4 }), true);
assert.equal(geometryFitsPicture(map, { minX: 40, minY: 40, maxX: 41, maxY: 41 }), false);
assert.equal(geometryFitsPicture(symbolic, { minX: 0, minY: 0, maxX: 1, maxY: 1 }), false);

console.log('statement-geometry: fixtures OK');
