/**
 * Function plotter: the no-eval expression compiler must handle ordinary
 * math notation (radians) and TikZ-side expressions (\x, degree trig),
 * print valid TikZ math, and the sampler must split runs at poles.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { plot } = await loadSrcModules({
	plot: 'src/visual/functionPlot.ts',
});
const { compileFunction, sampleFunctionRuns } = plot;

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const evaluate = (text, x) => compileFunction(text).evaluate(x);

// --- math-mode compiler (plotter dialog input, radians) ----------------------

assert.ok(close(evaluate('sin(x)', Math.PI / 2), 1), 'sin in radians');
assert.ok(close(evaluate('x^2 - 1', 3), 8));
assert.ok(close(evaluate('2x', 4), 8), 'implicit multiplication');
assert.ok(close(evaluate('x sin(x)', Math.PI / 2), Math.PI / 2));
assert.ok(close(evaluate('e^-x', 1), 1 / Math.E), 'unary exponent');
assert.ok(close(evaluate('sqrt(abs(x))', -4), 2), 'nested calls');
assert.ok(close(evaluate('pi', 0), Math.PI), 'constants');
assert.ok(close(evaluate('-x^2', 2), -4), 'unary minus binds outside ^');
assert.ok(close(evaluate('(x+1)(x-1)', 3), 8), 'parenthesized implicit product');

// Anything that is not pure math is rejected, never evaluated.
assert.equal(compileFunction(''), null);
assert.equal(compileFunction('alert(1)'), null, 'unknown names rejected');
assert.equal(compileFunction('x;1'), null, 'stray characters rejected');
assert.equal(compileFunction('sin()'), null, 'empty call rejected');
assert.equal(compileFunction('x + '), null, 'dangling operator rejected');
assert.equal(compileFunction('y + 1'), null, 'only x is a variable');

// --- TikZ printing (what the plot tool writes) -------------------------------

assert.equal(compileFunction('sin(x)').toTikz(), 'sin(deg(\\x))', 'radian sin → degree world');
assert.equal(compileFunction('x^2 - 1').toTikz(), '\\x^2-1');
assert.equal(compileFunction('0.55*sin(120*x)').toTikz(), '0.55*sin(deg(120*\\x))');
assert.equal(compileFunction('asin(x)').toTikz(), 'rad(asin(\\x))', 'inverse trig back to radians');
assert.equal(compileFunction('(x+1)/(x-1)').toTikz(), '(\\x+1)/(\\x-1)', 'precedence-aware parens');

// --- tikz-mode compiler (parsing plot statements from source) ----------------

{
	const tikz = compileFunction('0.55*sin(120*\\x)', { tikz: true });
	assert.ok(tikz, 'TikZ expression with \\x compiles');
	// pgfmath trig is in degrees: sin(120 * 0.75) = sin(90°) = 1.
	assert.ok(close(tikz.evaluate(0.75), 0.55), 'degree semantics');
	const roundTrip = compileFunction(compileFunction('sin(x)').toTikz(), { tikz: true });
	assert.ok(close(roundTrip.evaluate(Math.PI / 2), 1), 'emitted TikZ evaluates like the radian original');
}

// --- sampler -----------------------------------------------------------------

{
	const runs = sampleFunctionRuns(compileFunction('x^2'), -1, 1, 32);
	assert.equal(runs.length, 1, 'continuous function → one run');
	assert.equal(runs[0].length, 33);
	assert.ok(close(runs[0][0].x, -1) && close(runs[0][0].y, 1));
	assert.ok(close(runs[0][32].x, 1) && close(runs[0][32].y, 1));
}

{
	// 1/x has a pole at 0 (sampled exactly at index 16): two runs.
	const runs = sampleFunctionRuns(compileFunction('1/x'), -1, 1, 32);
	assert.equal(runs.length, 2, 'pole splits the plot');
	assert.ok(runs[0].every(point => point.x < 0));
	assert.ok(runs[1].every(point => point.x > 0));
}

{
	// sqrt is undefined below 0: the run starts at x ≥ 0.
	const runs = sampleFunctionRuns(compileFunction('sqrt(x)'), -2, 2, 32);
	assert.equal(runs.length, 1);
	assert.ok(runs[0][0].x >= 0);
}

{
	// Degenerate ranges produce nothing.
	assert.deepEqual(sampleFunctionRuns(compileFunction('x'), 2, 2, 32), []);
}

console.log('function-plot: ok');
