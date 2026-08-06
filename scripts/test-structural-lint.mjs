/**
 * Structural lint, against the real src/editor/tikzStructuralLint.ts.
 *
 * The previous version of this file never imported the shipped code: it
 * defined its own private lintBlock and asserted against that copy, so none
 * of the real linter's behaviour — comment skipping, brace depth, unclosed
 * brackets, \usetikzlibrary rewrite actions, empty option keys, the
 * pgfplots/missing-library hints — was ever exercised.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { lint } = await loadSrcModules(
	{ lint: 'src/editor/tikzStructuralLint.ts' },
	{ external: ['@codemirror/state', '@codemirror/view', '@codemirror/lint'] },
);
const { Text } = await import('@codemirror/state');

function diagnosticsFor(markdown, enabled = true) {
	return lint.lintMarkdownDoc(Text.of(markdown.split('\n')), enabled);
}

const FENCE = body => '```tikz\n' + body + '\n```\n';

// --- environments -----------------------------------------------------------

{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);'));
	assert.ok(diags.some(d => d.message === 'Unclosed \\begin{tikzpicture}'), 'missing unclosed-env warning');
}

{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\end{scope}\n\\end{tikzpicture}'));
	assert.ok(diags.some(d => d.message === 'Unmatched \\end{scope}'), 'missing unmatched-end warning');
}

// Balanced nesting is clean — including interleaved scopes the old fake test's
// collect-all-begins-then-all-ends copy would have passed incorrectly.
{
	const diags = diagnosticsFor(FENCE([
		'\\begin{tikzpicture}',
		'\\begin{scope}',
		'\\draw (0,0) -- (1,1);',
		'\\end{scope}',
		'\\begin{scope}',
		'\\draw (2,2) -- (3,3);',
		'\\end{scope}',
		'\\end{tikzpicture}',
	].join('\n')));
	assert.deepEqual(diags.filter(d => d.severity === 'warning'), [], 'balanced envs flagged');
}

// --- braces and brackets ----------------------------------------------------

{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\node at (0,0) {oops;\n\\end{tikzpicture}'));
	assert.ok(diags.some(d => d.message === 'Unclosed brace on this line'), 'missing unclosed-brace hint');
}

{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\node[draw at (0,0) x;\n\\end{tikzpicture}'));
	assert.ok(diags.some(d => d.message === 'Unclosed option bracket ['), 'missing unclosed-bracket hint');
}

// Comment lines are skipped by the real implementation.
{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n% \\begin{scope} {{{\n\\end{tikzpicture}'));
	assert.deepEqual(
		diags.filter(d => d.message.includes('scope') || d.message.includes('brace')),
		[],
		'commented line was linted',
	);
}

// --- empty option keys ------------------------------------------------------

{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\node[align=] at (0,0) {x};\n\\end{tikzpicture}'));
	assert.ok(diags.some(d => d.message === 'Empty option key "align"'), 'missing empty-key warning');
}

// --- \usetikzlibrary rewriting ---------------------------------------------

{
	const diags = diagnosticsFor(FENCE('\\usetikzlibrary{arrows.meta,groupplots}\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}'));
	const rewrite = diags.find(d => d.message.includes('LuaTikz compiles this as'));
	assert.ok(rewrite, 'missing library-rewrite warning');
	assert.ok(rewrite.actions?.length, 'rewrite warning must carry a quick-fix action');
	assert.ok(rewrite.message.includes('usepgfplotslibrary'), 'groupplots must be routed to usepgfplotslibrary');
}

// --- block-level hints ------------------------------------------------------

{
	const diags = diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\begin{axis}\n\\end{axis}\n\\end{tikzpicture}'));
	assert.ok(diags.some(d => d.message.includes('pgfplotsset')), 'missing pgfplots compat hint');
}

// --- the enabled gate and prose ---------------------------------------------

assert.deepEqual(diagnosticsFor(FENCE('\\begin{tikzpicture}\n\\end{scope}'), false), [], 'disabled lint must return nothing');
assert.deepEqual(diagnosticsFor('Just a paragraph with an \\end{scope} in prose.\n'), [], 'prose outside a fence was linted');

// Diagnostic positions land on the offending text.
{
	const doc = FENCE('\\begin{tikzpicture}\n\\node[align=] at (0,0) {x};\n\\end{tikzpicture}');
	const diags = diagnosticsFor(doc);
	const empty = diags.find(d => d.message.startsWith('Empty option key'));
	assert.ok(empty, 'empty-key diagnostic missing');
	const covered = doc.slice(empty.from, empty.to);
	assert.ok(covered.includes('align='), `diagnostic covers ${JSON.stringify(covered)}, expected the align= option`);
}

console.log('test-structural-lint: ok');
