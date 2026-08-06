/**
 * Selective dark-mode SVG inversion, against the real src module.
 *
 * The load-bearing case is near-black with *unequal* channels: the old
 * implementation chained `match.replace(channelText, inverted)` per channel,
 * which replaces by substring — the second replace could land inside the
 * first's output and emit an invalid colour (`rgb(2,25,0)` → `rgb(232553,25,0)`).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSrcModules } from './loadSrc.mjs';

const { dm } = await loadSrcModules({ dm: 'src/utils/darkMode.ts' });
const { invertSvgForDarkMode, shouldInvertSvgAtRenderTime } = dm;

function invertValue(value) {
	const svg = `<path fill="${value}"/>`;
	const match = invertSvgForDarkMode(svg).match(/fill="([^"]+)"/);
	return match?.[1];
}

// --- unequal near-black channels (the regression) -------------------------

assert.equal(invertValue('rgb(2,25,0)'), 'rgb(253,230,255)');
assert.equal(invertValue('rgb(19%,9%,1%)'), 'rgb(81%,91%,99%)');
assert.equal(invertValue('rgb(0,0,0)'), 'rgb(255,255,255)');
assert.equal(invertValue('rgb(0%,0%,0%)'), 'rgb(100%,100%,100%)');
assert.equal(invertValue('#000000'), '#ffffff');
assert.equal(invertValue('black'), 'white');

// Colours that are not near-black must pass through untouched.
assert.equal(invertValue('rgb(80%,40%,0%)'), 'rgb(80%,40%,0%)');
assert.equal(invertValue('red'), 'red');
assert.equal(invertValue('none'), 'none');

// --- hyphen-prefixed attributes are not paint -----------------------------

for (const svg of [
	'<rect data-fill="rgb(0,0,0)"/>',
	'<rect data-fill="black"/>',
	'<mask mask-fill="#000000"/>',
]) {
	assert.equal(invertSvgForDarkMode(svg), svg, `must not rewrite: ${svg}`);
}

// style="" rules still invert, including hyphen-guarded.
assert.equal(
	invertSvgForDarkMode('<path style="fill:rgb(0%,0%,0%);stroke:none"/>'),
	'<path style="fill:rgb(100%,100%,100%);stroke:none"/>',
);
assert.equal(
	invertSvgForDarkMode('<path style="stroke:black"/>'),
	'<path style="stroke:white"/>',
);

// --- gate ------------------------------------------------------------------

assert.equal(shouldInvertSvgAtRenderTime('auto-invert', true), true);
assert.equal(shouldInvertSvgAtRenderTime('auto-invert', false), false);
assert.equal(shouldInvertSvgAtRenderTime('none', true), false);
assert.equal(shouldInvertSvgAtRenderTime('brightness-boost', true), false);

// --- real pipeline output --------------------------------------------------
// Every sample the repo ships must come back with no residual near-black and
// with its non-black colours intact. This is the assertion that would catch a
// regression on an actual diagram rather than a synthetic snippet.

const samplesDir = join(process.cwd(), 'samples');
const samples = readdirSync(samplesDir).filter(name => name.endsWith('.svg'));
assert.ok(samples.length > 0, 'no sample SVGs found');

for (const name of samples) {
	const svg = readFileSync(join(samplesDir, name), 'utf8');
	const inverted = invertSvgForDarkMode(svg);
	assert.ok(
		!/(?<![-\w])(?:stroke|fill)="rgb\(0%,\s*0%,\s*0%\)"/i.test(inverted)
		&& !/(?:stroke|fill):\s*rgb\(0%,\s*0%,\s*0%\)/i.test(inverted),
		`${name}: near-black paint survived inversion`,
	);
	// Spot-check that inversion did not mangle the palette wholesale: any
	// colour the gate should ignore must be byte-identical before and after.
	const preserved = svg.match(/rgb\(79[^)]*\)/)?.[0];
	if (preserved) {
		assert.ok(inverted.includes(preserved), `${name}: non-black colour was altered`);
	}
}

console.log('test-dark-invert: ok');
