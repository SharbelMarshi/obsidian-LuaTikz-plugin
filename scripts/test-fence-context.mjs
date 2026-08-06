/**
 * Fence-context predicates, against the real src module.
 *
 * These predicates run from update listeners on every document change in
 * every markdown file; they were rewritten from a whole-prefix regex scan to
 * a backwards line scan. This pins the semantics across the rewrite.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { ctx } = await loadSrcModules(
	{ ctx: 'src/editor/tikzFenceContext.ts' },
	{ external: ['@codemirror/state', '@codemirror/view'] },
);
const { Text } = await import('@codemirror/state');

const doc = lines => Text.of(lines);
const posAt = (text, needle, offset = 0) => text.indexOf(needle) + offset;

// --- isInsideTikzFence -------------------------------------------------------

{
	const md = ['# note', '```tikz', '\\draw (0,0);', '```', 'after'].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, '\\draw')), true, 'inside an open tikz fence');
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, 'after')), false, 'after the closing fence');
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, '# note')), false, 'before the fence');
}

{
	// Another language's fence does not count.
	const md = ['```latex', '\\draw (0,0);', '```'].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, '\\draw')), false, 'latex fence is not a tikz fence');
}

{
	// Two fences: position inside the second resolves to the second.
	const md = ['```tikz', 'a;', '```', 'prose', '```latex', 'b;', '```'].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, 'b;')), false, 'closed earlier tikz fence must not leak');
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, 'prose')), false);
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, 'a;')), true);
}

{
	// The old prefix-regex implementation matched fence markers mid-line
	// (inline code); the line-anchored scan must not.
	const md = ['prose with `` ```tikz `` inline code', 'more prose'].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzFence(d, posAt(md, 'more')), false, 'inline code is not a fence');
}

// --- isInsideTikzEditingContext ---------------------------------------------

{
	const md = ['\\begin{tikzpicture}', '\\draw (0,0);', '\\end{tikzpicture}', 'after'].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzEditingContext(d, posAt(md, '\\draw')), true, 'inside an open environment');
	assert.equal(ctx.isInsideTikzEditingContext(d, posAt(md, 'after')), false, 'after \\end');
}

{
	// Nested pictures: closing the inner one keeps the outer open.
	const md = [
		'\\begin{tikzpicture}',
		'\\begin{tikzpicture}',
		'\\end{tikzpicture}',
		'still inside outer',
	].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzEditingContext(d, posAt(md, 'still')), true, 'outer environment is still open');
}

{
	// A closed pair above the cursor does not put prose "inside".
	const md = ['\\begin{tikzpicture}\\end{tikzpicture}', 'prose'].join('\n');
	const d = doc(md.split('\n'));
	assert.equal(ctx.isInsideTikzEditingContext(d, posAt(md, 'prose')), false, 'one-line closed pair leaked');
}

console.log('test-fence-context: ok');
