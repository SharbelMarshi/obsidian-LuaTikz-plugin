/**
 * Pre-compile option validation, against the real src/ modules.
 *
 * Covers both halves: spotting the bad option, and offering a Fix that
 * actually rewrites the line. A suggestion whose apply step is a no-op renders
 * a button that appears broken, so every autofix here is applied and checked.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { validation, autofix } = await loadSrcModules({
	validation: 'src/latex/tikzSourceValidation.ts',
	autofix: 'src/latex/latexAutofix.ts',
});
const { findOptionEqualIssues, validateTikzRenderSource } = validation;
const { applyAutofixToLine } = autofix;

// --- issue detection ------------------------------------------------------

const emptyAlign = findOptionEqualIssues('\\begin{tikzpicture}[align=]');
assert.equal(emptyAlign.length, 1);
assert.equal(emptyAlign[0].key, 'align');
assert.equal(emptyAlign[0].kind, 'empty');

const emptyOpacity = findOptionEqualIssues('\\node[opacity=, draw] {x};');
assert.equal(emptyOpacity.length, 1);
assert.equal(emptyOpacity[0].key, 'opacity');

assert.equal(findOptionEqualIssues('\\node[align=center, opacity=0.5] {x};').length, 0);

const trailingEmpty = findOptionEqualIssues('\\draw[line width=] (0,0)--(1,1);');
assert.equal(trailingEmpty.length, 1);
assert.equal(trailingEmpty[0].key, 'line width');

const spacedKey = findOptionEqualIssues('\\node[minimum width=] {};');
assert.equal(spacedKey.length, 1);
assert.equal(spacedKey[0].key, 'minimum width');

const invalidAlign = findOptionEqualIssues('\\node[align=top] {};');
assert.equal(invalidAlign.length, 1);
assert.equal(invalidAlign[0].kind, 'invalid');
assert.equal(invalidAlign[0].value, 'top');

// --- the fix has to actually change the line ------------------------------

function firstError(line) {
	return validateTikzRenderSource(['\\begin{tikzpicture}', line, '\\end{tikzpicture}'].join('\n'));
}

for (const [line, expected] of [
	['\\node[align=] at (0,0) {x};', '\\node[align=center] at (0,0) {x};'],
	['\\node[align=middle] at (0,0) {x};', '\\node[align=center] at (0,0) {x};'],
	['\\draw[line width=] (0,0)--(1,1);', '\\draw[line width=1pt] (0,0)--(1,1);'],
	['\\node[opacity=, draw] {x};', '\\node[opacity=1, draw] {x};'],
	['\\node[minimum width=] {};', '\\node[minimum width=1cm] {};'],
]) {
	const error = firstError(line);
	assert.ok(error, `no validation error for ${line}`);
	assert.ok(error.autofix, `no autofix offered for ${line}`);
	const applied = applyAutofixToLine(line, error.autofix);
	assert.notEqual(applied, line, `autofix for ${line} did not change the line`);
	assert.equal(applied, expected);
	// The mark has to cover the option, since the Fix popup anchors to it.
	assert.ok(error.markColumnEnd >= error.markColumnStart);
	assert.equal(line.slice(error.markColumnStart, error.markColumnEnd).includes('='), true);
}

// A key with no unambiguous default gets the error but no button, rather than
// a "Fix" that silently does nothing when clicked.
const unknownKey = firstError('\\node[my custom key=] {x};');
assert.ok(unknownKey, 'unknown key should still be reported');
assert.equal(unknownKey.autofix, undefined, 'unknown key must not offer a no-op fix');

// An invalid (not merely empty) value for a key with no enum is left alone.
assert.equal(firstError('\\node[opacity=0.5] {x};'), null);

console.log('test-source-validation: ok');
