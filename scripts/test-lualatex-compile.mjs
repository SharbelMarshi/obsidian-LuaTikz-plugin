/**
 * End-to-end compiles through the real wrapper. Skips when LuaLaTeX is not
 * installed, so contributors without a TeX distribution can still run the suite.
 *
 * The load-bearing case is "every font chain misses": that is the Linux/Windows
 * bug where a hardcoded macOS font name aborted every render, and it is the one
 * thing unit tests cannot prove.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const LUALATEX_CANDIDATES = [
	'/Library/TeX/texbin/lualatex',
	'/usr/local/bin/lualatex',
	'/usr/bin/lualatex',
];

function findLuaLatex() {
	for (const candidate of LUALATEX_CANDIDATES) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	try {
		return execFileSync('which', ['lualatex'], { stdio: 'pipe' }).toString().trim() || null;
	} catch {
		return null;
	}
}

const lualatex = findLuaLatex();
if (!lualatex) {
	console.log('lualatex-compile: skipped (LuaLaTeX not installed)');
	process.exit(0);
}

const outDir = mkdtempSync(join(tmpdir(), 'luatikz-compile-'));
for (const [entry, name] of [
	['src/core/tikzSource.ts', 'tikzSource'],
	['src/latex/latexErrorMapping.ts', 'latexErrorMapping'],
]) {
	buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(outDir, `${name}.mjs`), logLevel: 'silent' });
}
const { buildLatexDocument, prepareTikzRenderSource } = await import(pathToFileURL(join(outDir, 'tikzSource.mjs')).href);
const { formatLatexErrorWithLineMapping } = await import(pathToFileURL(join(outDir, 'latexErrorMapping.mjs')).href);
rmSync(outDir, { recursive: true, force: true });

function compile(tex) {
	const work = mkdtempSync(join(tmpdir(), 'luatikz-job-'));
	writeFileSync(join(work, 'job.tex'), tex);
	try {
		execFileSync(lualatex, ['-interaction=nonstopmode', '-halt-on-error', 'job.tex'], {
			cwd: work,
			stdio: 'pipe',
			timeout: 120000,
		});
		return { ok: existsSync(join(work, 'job.pdf')), log: '' };
	} catch (error) {
		return { ok: false, log: `${error.stdout ?? ''}${error.stderr ?? ''}` };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

const wrap = (src, options = {}) =>
	buildLatexDocument(prepareTikzRenderSource(src).renderSource, options);

const PLAIN = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,1);\n\\node at (1,1) {Hello};\n\\end{tikzpicture}';
const HEBREW = '\\begin{tikzpicture}\n\\node at (0,0) {\\he{שלום}};\n\\end{tikzpicture}';
const ARABIC = '\\begin{tikzpicture}\n\\node at (0,0) {\\ar{مرحبا}};\n\\end{tikzpicture}';

for (const [label, src, options] of [
	['plain diagram', PLAIN, {}],
	['hebrew macro', HEBREW, {}],
	['arabic macro', ARABIC, {}],
	['custom preamble', PLAIN, { customPreamble: '\\documentclass[tikz,border=5pt]{standalone}\n\\usepackage{tikz}' }],
	['extra preamble', PLAIN, { extraPreamble: '\\usepackage{amsfonts}' }],
	// The reported bug: on Linux none of the configured fonts exist.
	['no font available at all', PLAIN, { mainFont: 'No Such Font ZZ' }],
	['no font available + hebrew', HEBREW, { mainFont: 'No Such Font ZZ', hebrewFont: 'No Such Hebrew ZZ' }],
	// Reported: a library list spread over several lines was left in the body,
	// where \usetikzlibrary is illegal.
	['multi-line \\usetikzlibrary', [
		'\\usetikzlibrary{',
		'backgrounds,',
		'fit, intersections,',
		'decorations.markings,',
		'matrix,',
		'patterns,',
		'groupplots }',
		'\\begin{tikzpicture}',
		'\\node[draw, fill=white] (a) at (0,0) {A};',
		'\\begin{scope}[on background layer]',
		'\\node[fit=(a), draw, dashed] {};',
		'\\end{scope}',
		'\\end{tikzpicture}',
	].join('\n'), {}],
]) {
	const result = compile(wrap(src, options).tex);
	assert.ok(result.ok, `${label} must compile — ${(result.log.split('\n').find(l => l.startsWith('!')) ?? '').slice(0, 120)}`);
}

// Control: without the \IfFontExistsTF guard, a missing font really does abort.
// If this ever compiles, the guard above is proving nothing.
{
	const unguarded = [
		'\\documentclass[tikz,border=5pt]{standalone}',
		'\\usepackage{fontspec}',
		'\\setmainfont{No Such Font ZZ}',
		'\\usepackage{tikz}',
		'\\begin{document}',
		'\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}',
		'\\end{document}',
		'',
	].join('\n');
	const result = compile(unguarded);
	assert.equal(result.ok, false, 'unguarded missing font should abort — the guard is what fixes it');
	assert.ok(result.log.includes('cannot be found'), 'expected the fontspec "cannot be found" error');
}

// Error line numbers must survive the offset refactor, against real compiler output.
for (const [label, src, expectedLine] of [
	['undefined control sequence, body line 2', '\\begin{tikzpicture}\n\\notacommand\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}', 2],
	['undefined control sequence, body line 4', '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\draw (1,1) -- (2,2);\n\\bogusmacro\n\\end{tikzpicture}', 4],
	// An unclosed brace swallows \end{tikzpicture}, so TeX itself only notices
	// on the following line — reporting line 4 here is faithful, not a bug.
	['unclosed brace surfaces on body line 4', '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\node at (2,2) {oops;\n\\end{tikzpicture}', 4],
]) {
	const doc = wrap(src);
	const result = compile(doc.tex);
	assert.equal(result.ok, false, `${label}: expected a compile failure`);
	const mapped = formatLatexErrorWithLineMapping(result.log, doc.body, doc.userLineOffset);
	assert.equal(mapped.userLine, expectedLine, `${label}: reported line ${mapped.userLine}`);
}

console.log('lualatex-compile: 8 documents compiled, guard control + 3 line mappings OK');
