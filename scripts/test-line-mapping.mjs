/**
 * Render-line -> note-line mapping, against the real src/ modules.
 *
 * The map has to mirror prepareTikzRenderSource exactly: any line that
 * function drops or inserts and this one does not shifts every error
 * highlight below it onto the wrong row.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { mapping, source, align } = await loadSrcModules({
	mapping: 'src/latex/latexErrorMapping.ts',
	source: 'src/core/tikzSource.ts',
	align: 'src/utils/diagramAlign.ts',
});
const { buildRenderToNoteLineMap, createNoteLineMapper } = mapping;
const { prepareTikzRenderSource } = source;
const { prepareBlockLineForRender } = align;

const block = (blockSource, startLine) => ({
	source: blockSource,
	startLine,
	endLine: startLine + blockSource.split('\n').length + 1,
});

/** Every mapped render line must hold the text the render source has there. */
function assertMapAgreesWithRenderSource(blockSource, startLine) {
	const noteLines = blockSource.split('\n');
	const renderLines = prepareTikzRenderSource(blockSource).renderSource.split('\n');
	const map = buildRenderToNoteLineMap(block(blockSource, startLine));

	assert.equal(map.length, renderLines.length,
		`map has ${map.length} entries for ${renderLines.length} render lines`);

	for (let i = 0; i < renderLines.length; i++) {
		const noteLine = map[i];
		if (noteLine === null) {
			continue;
		}
		// Compare the *prepared* note line: prepareBlockLineForRender also
		// rewrites content (it strips align= out of tikzpicture options).
		const noteText = prepareBlockLineForRender(noteLines[noteLine - startLine - 2]);
		assert.equal(noteText.trim(), renderLines[i].trim(),
			`render line ${i + 1} maps to note line ${noteLine}, which reads ${JSON.stringify(noteText)}`);
	}
	return map;
}

const withAlignDirective = [
	'% align=left',
	'\\begin{tikzpicture}',
	'\\draw (0,0) -- (1,1);',
	'\\end{tikzpicture}',
].join('\n');
// blockStartLine 10 = opening ``` fence (0-indexed), so content starts at note line 12.
// "% align=left" is note line 12 but omitted from the render source.
const map = assertMapAgreesWithRenderSource(withAlignDirective, 10);
assert.deepEqual(map, [13, 14, 15], 'align directive must not shift render line numbers');
assert.equal(createNoteLineMapper(block(withAlignDirective, 10))(2), 14,
	'render line 2 should be the \\draw line, not the align directive');

const withAlignOption = [
	'\\begin{tikzpicture}[align=left, scale=1]',
	'\\draw (0,0) -- (1,1);',
].join('\n');
assert.deepEqual(
	assertMapAgreesWithRenderSource(withAlignOption, 4),
	[6, 7],
	'align= in tikzpicture options keeps the same note lines',
);

const withBlanks = [
	'\\begin{tikzpicture}',
	'',
	'\\draw (0,0) -- (1,1);',
	'\\end{tikzpicture}',
].join('\n');
assert.deepEqual(
	assertMapAgreesWithRenderSource(withBlanks, 0),
	[2, 4, 5],
	'blank lines are dropped from the render source',
);

// The grid directive is stripped *and* a \draw[step=...] line is generated in
// its place, so the map needs a null slot or everything below it is off by one.
const withGrid = [
	'% grid=1',
	'\\begin{tikzpicture}',
	'\\draw (0,0) -- (1,1);',
	'\\end{tikzpicture}',
].join('\n');
const gridRender = prepareTikzRenderSource(withGrid).renderSource.split('\n');
assert.ok(gridRender[1].startsWith('\\draw[step=1'), `grid line not injected: ${JSON.stringify(gridRender)}`);
const gridMap = buildRenderToNoteLineMap(block(withGrid, 10));
assert.deepEqual(gridMap, [13, null, 14, 15], 'generated grid line needs an unmapped slot');
assert.equal(createNoteLineMapper(block(withGrid, 10))(3), 14,
	'the \\draw line sits one render line lower once a grid is generated');
assertMapAgreesWithRenderSource(withGrid, 10);

// An explicit grid in the source suppresses generation, so no slot is added.
const withOwnGrid = [
	'% grid=1',
	'\\begin{tikzpicture}',
	'\\draw[step=2] (0,0) grid (4,4);',
	'\\end{tikzpicture}',
].join('\n');
assert.deepEqual(
	assertMapAgreesWithRenderSource(withOwnGrid, 10),
	[13, 14, 15],
	'an existing grid must not add a slot',
);

console.log('test-line-mapping: ok');
