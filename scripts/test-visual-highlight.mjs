/**
 * Source-panel syntax highlighting: token classification and the
 * range-splitting that weaves hover/selection tints through the tokens.
 * Reconstructing the exact input from the emitted segments is the key check —
 * a lossy tokenizer would desynchronize the color mirror from the textarea.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { highlight } = await loadSrcModules({ highlight: 'src/visual/tikzHighlight.ts' });
const { tokenizeTikz, buildHighlightSegments } = highlight;

// --- tokenization -----------------------------------------------------------

const source = '\\draw[->, thick] (0,0) -- (3.5,2) circle[radius=1cm]; % note\n\\node at (1,1) {$x$};';
const tokens = tokenizeTikz(source);

// Tokens must tile the source exactly.
let offset = 0;
for (const token of tokens) {
	assert.equal(token.from, offset, `gap before ${JSON.stringify(token.text)}`);
	assert.equal(token.text, source.slice(token.from, token.to));
	offset = token.to;
}
assert.equal(offset, source.length, 'tokens must cover the whole source');

const byText = text => tokens.find(token => token.text === text);
assert.equal(byText('\\draw').cls, 'command');
assert.equal(byText('\\node').cls, 'command');
assert.equal(byText('% note').cls, 'comment');
assert.equal(byText('circle').cls, 'keyword');
assert.equal(byText('at').cls, 'keyword');
assert.equal(byText('3.5').cls, 'number');
assert.equal(byText('1cm').cls, 'number');
assert.equal(byText('--').cls, 'operator');
assert.equal(byText('->').cls, 'operator');
assert.equal(byText('[').cls, 'bracket');
assert.equal(byText('{').cls, 'brace');
assert.equal(byText('thick').cls, null, 'plain words stay untinted');

// --- segment output ----------------------------------------------------------

const plainSource = '\\draw (0,0) -- (1,1); % a<b & c';
const segments = buildHighlightSegments(plainSource);
assert.ok(segments.some(segment =>
	segment.text === '\\draw' && segment.classes.includes('luatikz-tzk-command')));
assert.ok(segments.some(segment => segment.classes.includes('luatikz-tzk-comment')));
// Text (including markup-hostile characters) passes through verbatim: the
// caller renders segments as text nodes, so nothing needs escaping.
assert.equal(segments.map(segment => segment.text).join(''), plainSource);

// --- range tints ------------------------------------------------------------

const body = '\\draw (0,0) -- (1,1);\n\\draw (2,2) -- (3,3);';
const second = body.indexOf('\\draw', 1);
const ranged = buildHighlightSegments(body, [
	{ from: second, to: body.length, cls: 'luatikz-tzk-hover' },
]);
// Segments still tile the source exactly…
assert.equal(ranged.map(segment => segment.text).join(''), body);
// …and every character of the second statement carries the tint, none of the first.
const hoverText = ranged
	.filter(segment => segment.classes.includes('luatikz-tzk-hover'))
	.map(segment => segment.text)
	.join('');
assert.equal(hoverText, '\\draw (2,2) -- (3,3);');

// A range boundary inside a token splits it without losing characters.
const midToken = buildHighlightSegments('12345', [{ from: 2, to: 4, cls: 'x' }]);
assert.equal(midToken.map(segment => segment.text).join(''), '12345');
assert.ok(midToken.some(segment =>
	segment.text === '34'
	&& segment.classes.includes('luatikz-tzk-number')
	&& segment.classes.includes('x')));

console.log('visual-highlight: ok');
