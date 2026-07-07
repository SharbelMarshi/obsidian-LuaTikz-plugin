import assert from 'node:assert/strict';

// Mirrors prepareBlockLineForRender / buildRenderToNoteLineMap logic for regression tests.

const ALIGN_LINE_RE = /^\s*(?:%\s*)?align\s*[=:]\s*(left|center|right)\s*$/i;
const TIKZPICTURE_BEGIN_RE = /\\begin\{tikzpicture\}\s*\[([^\]]*)\]/;

function stripAlignFromTikzpictureOptions(source) {
	return source.replace(TIKZPICTURE_BEGIN_RE, (full, options) => {
		const cleaned = options
			.split(',')
			.map(part => part.trim())
			.filter(part => part.length > 0 && !/^align\s*=\s*(left|center|right)$/i.test(part))
			.join(', ');
		if (!cleaned) {
			return '\\begin{tikzpicture}';
		}
		return `\\begin{tikzpicture}[${cleaned}]`;
	});
}

function prepareBlockLineForRender(line) {
	const trimmed = line.replaceAll('&nbsp;', '').trim();
	if (!trimmed) {
		return null;
	}
	if (ALIGN_LINE_RE.test(trimmed)) {
		return null;
	}
	return stripAlignFromTikzpictureOptions(trimmed);
}

function buildRenderToNoteLineMap(blockSource, blockStartLine) {
	const innerLines = blockSource.split('\n');
	const map = [];
	for (let i = 0; i < innerLines.length; i++) {
		const noteLine0 = blockStartLine + 1 + i;
		if (prepareBlockLineForRender(innerLines[i]) === null) {
			continue;
		}
		map.push(noteLine0 + 1);
	}
	return map;
}

const blockSource = [
	'% align=left',
	'\\begin{tikzpicture}',
	'\\draw (0,0) -- (1,1)',
	'\\end{tikzpicture}',
].join('\n');

const map = buildRenderToNoteLineMap(blockSource, 10);
// blockStartLine 10 = opening ``` fence (0-indexed). Content starts at note line 12.
// % align=left is note line 12 but omitted from render; \begin{tikzpicture} is render line 1 -> note 13.
assert.deepEqual(map, [13, 14, 15], 'align directive must not shift render line numbers');

const renderLine2 = map[1];
assert.equal(renderLine2, 14, 'second render line should be the \\draw line, not the align directive');

const withAlignOption = [
	'\\begin{tikzpicture}[align=left, scale=1]',
	'\\draw (0,0) -- (1,1);',
].join('\n');
const map2 = buildRenderToNoteLineMap(withAlignOption, 4);
assert.deepEqual(map2, [6, 7], 'align= in tikzpicture options keeps the same note lines');

console.log('test-line-mapping: ok');
