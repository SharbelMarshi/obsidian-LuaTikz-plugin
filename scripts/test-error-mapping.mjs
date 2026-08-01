/**
 * Error summarising and autofix suggestion, against the real src/ modules.
 *
 * These assertions used to run against a private re-implementation living in
 * this file, which is why they stayed green while the shipped
 * suggestLatexAutofix produced nothing for most real LuaLaTeX output.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { mapping, autofix } = await loadSrcModules({
	mapping: 'src/latex/latexErrorMapping.ts',
	autofix: 'src/latex/latexAutofix.ts',
});
const { extractUsefulLatexError, buildLatexErrorTitle } = mapping;
const { suggestLatexAutofix, applyAutofixToLine, wrapBareMathInLine } = autofix;

const sampleLog = `! Missing ; inserted.
<inserted text>
                ;
l.37 \\draw (0,0) -- (1,1)
`;

const summary = extractUsefulLatexError(sampleLog);
assert.equal(summary, 'Missing semicolon (;)');
assert.equal(buildLatexErrorTitle({ summary, userLine: 4, noteLine: 37 }), 'Missing semicolon (;) (line 4)');

// --- semicolon ------------------------------------------------------------

const semicolonFix = suggestLatexAutofix(summary, '\\draw (0,0) -- (1,1)', sampleLog);
assert.ok(semicolonFix, 'no fix for a statement missing its semicolon');
assert.equal(semicolonFix.kind, 'append-semicolon');
assert.equal(applyAutofixToLine('\\draw (0,0) -- (1,1)', semicolonFix), '\\draw (0,0) -- (1,1);');

const pgfLog = `! Package tikz Error: Giving up on this path. Did you forget a semicolon?.
l.4 \\coordinate (C) at (3.0,1.15)
`;
assert.equal(extractUsefulLatexError(pgfLog), 'Missing semicolon (;)');
const pgfFix = suggestLatexAutofix(extractUsefulLatexError(pgfLog), '\\coordinate (C) at (3.0,1.15)', pgfLog);
assert.ok(pgfFix);
assert.equal(pgfFix.kind, 'append-semicolon');

// TeX blames the *next* statement, so the fix has to walk back to the real
// culprit instead of appending to a line that is already fine.
const relocLines = ['\\begin{tikzpicture}', '\\draw (0,0) -- (2,2)', '\\draw (0,2) -- (2,0);', '\\end{tikzpicture}'];
const relocated = suggestLatexAutofix(summary, relocLines[2], pgfLog, { lines: relocLines, lineIndex: 2 });
assert.ok(relocated, 'no fix when TeX blames the following statement');
assert.equal(relocated.kind, 'append-semicolon');
assert.equal(relocated.lineDelta, -1, 'fix must point one line back at the open statement');

// A multi-line statement takes the semicolon on its last line.
const contLines = ['\\begin{tikzpicture}', '\\draw (0,0)', '  -- (2,2)', '\\draw (0,2) -- (2,0);'];
const continuation = suggestLatexAutofix(summary, contLines[3], pgfLog, { lines: contLines, lineIndex: 3 });
assert.ok(continuation);
assert.equal(continuation.lineDelta, -1, 'should target the last line of the open statement');

// \end{tikzpicture} is not a statement: appending a semicolon there was the
// old behaviour and produced invalid TikZ.
const endLines = ['\\begin{tikzpicture}', '\\draw (0,0) -- (2,2);', '\\end{tikzpicture}'];
const atEnd = suggestLatexAutofix(summary, '\\end{tikzpicture}', pgfLog, { lines: endLines, lineIndex: 2 });
assert.equal(atEnd, null, 'must not offer to append a semicolon after \\end{tikzpicture}');

// ...but when the last statement really is open, the fix targets it rather
// than the \end line TeX blamed.
const lastOpen = ['\\begin{tikzpicture}', '\\draw (0,0) -- (2,2)', '\\end{tikzpicture}'];
const beforeEnd = suggestLatexAutofix(summary, '\\end{tikzpicture}', pgfLog, { lines: lastOpen, lineIndex: 2 });
assert.ok(beforeEnd, 'no fix for an unterminated final statement');
assert.equal(beforeEnd.lineDelta, -1, 'fix must move off the \\end line onto the open \\draw');

// \begin{tikzpicture} takes no semicolon at all.
assert.equal(
	suggestLatexAutofix(summary, '\\begin{tikzpicture}', '! Missing ; inserted.'),
	null,
	'must not offer a semicolon on \\begin{tikzpicture}',
);

// A properly terminated multi-line statement is not "open".
const closedMultiline = ['\\begin{tikzpicture}', '\\draw (0,0)', '  -- (2,0)', '  -- (2,2);', '\\end{tikzpicture}'];
assert.equal(
	suggestLatexAutofix(summary, '  -- (2,0)', '! Missing ; inserted.', { lines: closedMultiline, lineIndex: 2 }),
	null,
	'a multi-line statement that ends in ; is not missing one',
);

// A trailing comment must not read as a missing semicolon.
assert.equal(
	suggestLatexAutofix(summary, '\\draw (0,0) -- (1,1); % done', '! Missing ; inserted.'),
	null,
	'a commented line ending in ; is terminated',
);

// --- braces ---------------------------------------------------------------

const braceFix = suggestLatexAutofix('Missing closing brace }', '\\node {foo', '! Missing } inserted.');
assert.ok(braceFix);
assert.equal(braceFix.kind, 'append-closing-brace');
assert.equal(applyAutofixToLine('\\node {foo', braceFix), '\\node {foo}');

// The brace closes *inside* the statement: appending after the trailing `;`
// would make the semicolon part of the node text and leave the path open.
assert.equal(
	applyAutofixToLine('\\node at (0,0) {hello;', braceFix),
	'\\node at (0,0) {hello};',
);

// TikZ reports an unclosed node brace as a bogus environment error.
const scopeLog = '! LaTeX Error: Environment scope undefined.\nl.202 \\end{tikzpicture}';
const braceLines = ['\\begin{tikzpicture}', '\\node at (0,0) {hello;', '\\end{tikzpicture}'];
const relocatedBrace = suggestLatexAutofix(
	'LaTeX Error: Environment scope undefined.',
	'\\end{tikzpicture}',
	scopeLog,
	{ lines: braceLines, lineIndex: 2 },
);
assert.ok(relocatedBrace, 'no fix for an unclosed brace reported as an environment error');
assert.equal(relocatedBrace.kind, 'append-closing-brace');
assert.equal(relocatedBrace.lineDelta, -1);

// A commented-out brace must not count towards the balance.
assert.equal(
	suggestLatexAutofix('Missing closing brace }', '\\draw (0,0); % note {', '! Missing } inserted.'),
	null,
);

// --- math -----------------------------------------------------------------

const unclosed = suggestLatexAutofix('Missing $ inserted', '\\node {$x', '! Missing $ inserted.');
assert.ok(unclosed);
assert.equal(unclosed.kind, 'append-math-delimiter');

// The common case: no $ at all, so a whole span needs wrapping.
const bareMath = suggestLatexAutofix('Missing $ inserted', '\\node at (0,0) {x^2};', '! Missing $ inserted.');
assert.ok(bareMath, 'no fix for a bare superscript');
assert.equal(bareMath.kind, 'wrap-in-math');
assert.equal(applyAutofixToLine('\\node at (0,0) {x^2};', bareMath), '\\node at (0,0) {$x^2$};');

assert.equal(wrapBareMathInLine('\\node at (0,0) {a_{ij}};'), '\\node at (0,0) {$a_{ij}$};');
assert.equal(wrapBareMathInLine('\\node at (0,0) {$x^2$};'), null, 'already in math mode');
assert.equal(wrapBareMathInLine('\\draw (0,0) -- (1,1);'), null, 'nothing to wrap');

// --- typo -----------------------------------------------------------------

const typoFix = suggestLatexAutofix('Undefined control sequence', '\\begn{tikzpicture}', '');
assert.ok(typoFix);
assert.equal(typoFix.kind, 'fix-typo');
assert.equal(applyAutofixToLine('\\begn{tikzpicture}', typoFix), '\\begin{tikzpicture}');

console.log('test-error-mapping: ok');
