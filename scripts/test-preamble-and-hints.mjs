import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const outDir = mkdtempSync(join(tmpdir(), 'luatikz-preamble-'));

async function load(entry, name) {
	const outfile = join(outDir, `${name}.mjs`);
	buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile, logLevel: 'silent' });
	return import(pathToFileURL(outfile).href);
}

const source = await load('src/core/tikzSource.ts', 'tikzSource');
const hints = await load('src/latex/latexErrorHints.ts', 'latexErrorHints');
const mapping = await load('src/latex/latexErrorMapping.ts', 'latexErrorMapping');
rmSync(outDir, { recursive: true, force: true });

const { normalizeUserLibraryCommand, wrapLatexSource } = source;
const { hintForLatexError } = hints;
const { extractUsefulLatexError, formatLatexErrorWithLineMapping } = mapping;

/* ---------------------------------------------------------------- libraries */

// `pgfplots` is a package, not a TikZ library; the wrapper already loads it.
assert.deepEqual(normalizeUserLibraryCommand('\\usetikzlibrary{pgfplots}'), []);
assert.deepEqual(
	normalizeUserLibraryCommand('\\usetikzlibrary{pgfplots,calc}'),
	['\\usetikzlibrary{calc}'],
);
assert.deepEqual(normalizeUserLibraryCommand('\\usetikzlibrary{circuitikz}'), []);

// PGFPlots-only libraries have to go through \usepgfplotslibrary.
assert.deepEqual(
	normalizeUserLibraryCommand('\\usetikzlibrary{groupplots}'),
	['\\usepgfplotslibrary{groupplots}'],
);
assert.deepEqual(
	normalizeUserLibraryCommand('\\usetikzlibrary{ calc , groupplots , patterns }'),
	['\\usetikzlibrary{calc,patterns}', '\\usepgfplotslibrary{groupplots}'],
);

// Names that genuinely work as TikZ libraries are left exactly as written.
for (const name of ['dateplot', 'external', 'fillbetween', 'colorbrewer', 'arrows.meta']) {
	assert.deepEqual(
		normalizeUserLibraryCommand(`\\usetikzlibrary{${name}}`),
		[`\\usetikzlibrary{${name}}`],
		`${name} is a real tikz library`,
	);
}

// Other library commands pass through untouched.
assert.deepEqual(
	normalizeUserLibraryCommand('\\usepgfplotslibrary{groupplots}'),
	['\\usepgfplotslibrary{groupplots}'],
);
assert.deepEqual(
	normalizeUserLibraryCommand('\\usegdlibrary{trees}'),
	['\\usegdlibrary{trees}'],
);

// End to end: the bad line disappears from the compiled document.
const wrapped = wrapLatexSource(String.raw`\usetikzlibrary{pgfplots}
\usetikzlibrary{groupplots,calc}
\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`);
assert.ok(!/\\usetikzlibrary\{[^}]*\bpgfplots\b[^}]*\}/.test(wrapped), 'no bogus tikz library');
assert.ok(wrapped.includes('\\usepgfplotslibrary{groupplots}'));
assert.ok(wrapped.includes('\\usetikzlibrary{calc}'));
assert.ok(wrapped.includes('\\usepackage{pgfplots}'), 'package still loaded by the wrapper');

/* -------------------------------------------------------------------- hints */

const dimensionLog = `! Dimension too large.
<recently read> \\pgf@xa
l.190 ...to[out=115, in=65, looseness=0.8] (sensors.north)
`;
assert.equal(extractUsefulLatexError(dimensionLog), 'Dimension too large');

const curvedTo = '(environment.north) to[out=115, in=65, looseness=0.8] (sensors.north);';
const curvedHint = hintForLatexError('Dimension too large', curvedTo);
assert.ok(curvedHint?.includes('1024pt'), 'names the pgf limit');
assert.ok(curvedHint?.includes('x=0.5cm'), 'suggests shrinking the unit vectors');
assert.ok(curvedHint?.includes('scale='), 'warns that scale does not help');

assert.ok(hintForLatexError('Dimension too large', '\\draw (0,0) -- (99999,0);')
	?.includes('16383.99998pt'), 'generic dimension hint');

// bend is the same pgf code path
assert.ok(hintForLatexError('Dimension too large', '\\draw (a) to[bend left=20] (b);')
	?.includes('1024pt'));

const libraryLog = `! Package tikz Error: I did not find the tikz library 'pgfplots'. I looked for
files named tikzlibrarypgfplots.code.tex and pgflibrarypgfplots.code.tex, but n
either could be found in the current texmf trees..
`;
const librarySummary = extractUsefulLatexError(libraryLog);
assert.equal(librarySummary, "Unknown tikz library 'pgfplots'");
const libraryHint = hintForLatexError(librarySummary);
assert.ok(libraryHint?.includes('pgfplots'));
assert.ok(libraryHint?.includes('\\usepgfplotslibrary'));

// unrelated errors get no hint
assert.equal(hintForLatexError('Missing semicolon (;)', '\\draw (0,0) -- (1,1)'), undefined);

// the renderer's path: log -> summary + hint anchored to the offending line
const renderSource = [
	'\\begin{tikzpicture}',
	'\\node (environment) at (0,0) {E};',
	'\\node (sensors) at (40,0) {S};',
	'\\draw[feedback] (environment.north) to[out=115, in=65, looseness=0.8] (sensors.north);',
	'\\end{tikzpicture}',
].join('\n');
const mapped = formatLatexErrorWithLineMapping(
	'! Dimension too large.\n<recently read> \\pgf@xa\nl.104 ...looseness=0.8] (sensors.north)\n',
	renderSource,
	100,
);
assert.equal(mapped.summary, 'Dimension too large');
assert.equal(mapped.userLine, 4, 'points at the curved to');
assert.ok(mapped.hint?.includes('1024pt'), 'hint reaches the render result');


console.log('preamble-and-hints: fixtures OK');
