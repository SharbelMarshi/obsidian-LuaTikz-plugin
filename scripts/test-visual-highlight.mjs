/**
 * Source-panel syntax highlighting: token classification, HTML escaping, and
 * the range-splitting that weaves hover/selection tints through the tokens.
 * Reconstructing the exact input from the emitted spans is the key check —
 * a lossy tokenizer would desynchronize the color mirror from the textarea.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { highlight } = await loadSrcModules({ highlight: 'src/visual/tikzHighlight.ts' });
const { tokenizeTikz, buildHighlightHtml } = highlight;

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

// --- HTML output ------------------------------------------------------------

const html = buildHighlightHtml('\\draw (0,0) -- (1,1); % a<b & c');
assert.match(html, /<span class="luatikz-tzk-command">\\draw<\/span>/);
assert.match(html, /luatikz-tzk-comment/);
assert.ok(html.includes('a&lt;b &amp; c'), 'HTML must be escaped');
assert.ok(!html.includes('<b '), 'raw angle brackets must never pass through');

// Stripping tags reproduces the escaped source exactly (mirror stays aligned).
const stripped = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
assert.equal(stripped, '\\draw (0,0) -- (1,1); % a<b & c');

// --- range tints ------------------------------------------------------------

const body = '\\draw (0,0) -- (1,1);\n\\draw (2,2) -- (3,3);';
const second = body.indexOf('\\draw', 1);
const ranged = buildHighlightHtml(body, [
	{ from: second, to: body.length, cls: 'luatikz-tzk-hover' },
]);
// Every character of the second statement carries the tint; none of the first.
const hoverText = [...ranged.matchAll(/<span class="[^"]*luatikz-tzk-hover[^"]*">([^<]*)<\/span>/g)]
	.map(match => match[1])
	.join('')
	.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
assert.equal(hoverText, '\\draw (2,2) -- (3,3);');

// A range boundary inside a token splits it without losing characters.
const midToken = buildHighlightHtml('12345', [{ from: 2, to: 4, cls: 'x' }]);
const midStripped = midToken.replace(/<[^>]+>/g, '');
assert.equal(midStripped, '12345');
assert.match(midToken, /<span class="luatikz-tzk-number x">34<\/span>/);

console.log('visual-highlight: ok');
