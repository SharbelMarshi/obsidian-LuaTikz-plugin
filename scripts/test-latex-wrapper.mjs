import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const outDir = mkdtempSync(join(tmpdir(), 'luatikz-wrapper-'));

async function load(entry, name) {
	const outfile = join(outDir, `${name}.mjs`);
	buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile, logLevel: 'silent' });
	return import(pathToFileURL(outfile).href);
}

const wrapper = await load('src/core/tikzSource.ts', 'tikzSource');
const mapping = await load('src/latex/latexErrorMapping.ts', 'latexErrorMapping');
const model = await load('src/settings/settingsModel.ts', 'settingsModel');
rmSync(outDir, { recursive: true, force: true });

const {
	buildLatexDocument,
	buildManagedPreamblePreview,
	sanitizeFontName,
	detectRtlUsage,
} = wrapper;
const { formatLatexErrorWithLineMapping } = mapping;
const { DEFAULT_SETTINGS, STRING_SETTING_KEYS, RENDER_IDENTITY_KEYS } = model;

/* ============================================================ the invariant */

/**
 * The bug this guards: `wrapLatexSource` and
 * `getUserSourceLineOffsetForExtraPreamble` used to be separate exports that
 * the renderer called at two sites and that had to agree. When they didn't,
 * every LaTeX error line number shifted silently. Now one call returns both,
 * and this asserts the body really does start where the offset says.
 */
const SOURCES = {
	plain: '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}',
	hebrewUnicode: '\\begin{tikzpicture}\n\\node at (0,0) {שלום};\n\\end{tikzpicture}',
	hebrewMacro: '\\begin{tikzpicture}\n\\node at (0,0) {\\he{shalom}};\n\\end{tikzpicture}',
	arabicUnicode: '\\begin{tikzpicture}\n\\node at (0,0) {مرحبا};\n\\end{tikzpicture}',
	arabicMacro: '\\begin{tikzpicture}\n\\node at (0,0) {\\ar{marhaba}};\n\\end{tikzpicture}',
	mixed: '\\begin{tikzpicture}\n\\node at (0,0) {\\he{a} \\ar{b}};\n\\end{tikzpicture}',
	hoisted: '\\usepackage{tikz-cd}\n\\usetikzlibrary{groupplots}\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}',
	strippedPreamble: '\\documentclass{article}\n\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}\n\\end{document}',
	multiline: '\\begin{tikzpicture}\n\\draw (0,0)\n  -- (2,0)\n  -- (2,2);\n\\end{tikzpicture}',
};

const OPTION_MATRIX = [
	{},
	{ mainFont: 'Latin Modern Roman' },
	{ hebrewFont: 'Frank Ruehl CLM', arabicFont: 'Amiri' },
	{ mainFont: 'Evil\nFont' },
	{ mainFont: 'X}\\usepackage{shellesc}{' },
	{ mainFont: '100% Bad #Font' },
	{ extraPreamble: '\\usepackage{physics}' },
	{ extraPreamble: '\\usepackage{a}\n\\usepackage{b}\n\\usepackage{c}' },
	{ customPreamble: '\\documentclass[tikz]{standalone}\n\\usepackage{tikz}' },
	{ customPreamble: '\\usepackage{tikz}\n\\setmainfont{Whatever}' },
	{ customPreamble: '\\usepackage{tikz}', extraPreamble: '\\usepackage{physics}' },
];

let invariantChecks = 0;
for (const [label, src] of Object.entries(SOURCES)) {
	for (const options of OPTION_MATRIX) {
		const doc = buildLatexDocument(src, options);
		const texLines = doc.tex.split('\n');
		const bodyLines = doc.body.split('\n');
		assert.deepEqual(
			texLines.slice(doc.userLineOffset, doc.userLineOffset + bodyLines.length),
			bodyLines,
			`${label} / ${JSON.stringify(options)}: body must start at tex line ${doc.userLineOffset + 1}`,
		);
		invariantChecks++;
	}
}

// End to end through the real mapper: proves the reported line number is
// correct, not merely self-consistent.
{
	const doc = buildLatexDocument(SOURCES.multiline);
	const mapped = formatLatexErrorWithLineMapping(
		`! Missing ; inserted.\nl.${doc.userLineOffset + 3} whatever\n`,
		doc.body,
		doc.userLineOffset,
	);
	assert.equal(mapped.userLine, 3);
	assert.equal(mapped.lineContent, doc.body.split('\n')[2]);
}

/* ================================================== platform safety (bugs) */

const MACOS_ONLY = ['David CLM', 'Geeza Pro', 'Times New Roman'];

{
	const tex = buildLatexDocument(SOURCES.plain).tex;
	assert.ok(!tex.includes('polyglossia'), 'no polyglossia without RTL');
	assert.ok(!tex.includes('\\setotherlanguage'), 'no language glosses without RTL');
	assert.ok(!tex.includes('\\newfontfamily'), 'no script fonts without RTL');
	for (const font of MACOS_ONLY) {
		assert.ok(!tex.includes(font), `${font} must not appear for a plain diagram`);
	}
	assert.ok(tex.includes('\\IfFontExistsTF{TeX Gyre Termes}{\\setmainfont{TeX Gyre Termes}}{}'));
	assert.ok(tex.includes('\\newcommand{\\he}[1]{#1}'), 'he degrades to identity');
	assert.ok(tex.includes('\\newcommand{\\ar}[1]{#1}'), 'ar degrades to identity');
}

// Every font declaration anywhere, in any configuration, must be guarded.
for (const src of Object.values(SOURCES)) {
	for (const options of OPTION_MATRIX) {
		if (options.customPreamble) {
			continue; // the user owns that text
		}
		for (const line of buildLatexDocument(src, options).tex.split('\n')) {
			if (/\\setmainfont|\\newfontfamily/.test(line)) {
				assert.ok(
					line.startsWith('\\IfFontExistsTF{'),
					`unguarded font declaration: ${line.slice(0, 90)}`,
				);
			}
		}
	}
}

/* ====================================================== RTL truth table */

const rtlCase = src => {
	const tex = buildLatexDocument(src).tex;
	return {
		hebrew: tex.includes('\\setotherlanguage{hebrew}'),
		arabic: tex.includes('\\setotherlanguage{arabic}'),
		polyglossia: tex.includes('\\usepackage{polyglossia}'),
	};
};

assert.deepEqual(rtlCase(SOURCES.plain), { hebrew: false, arabic: false, polyglossia: false });
assert.deepEqual(rtlCase(SOURCES.hebrewMacro), { hebrew: true, arabic: false, polyglossia: true });
assert.deepEqual(rtlCase(SOURCES.hebrewUnicode), { hebrew: true, arabic: false, polyglossia: true });
assert.deepEqual(rtlCase(SOURCES.arabicMacro), { hebrew: false, arabic: true, polyglossia: true });
assert.deepEqual(rtlCase(SOURCES.arabicUnicode), { hebrew: false, arabic: true, polyglossia: true });
assert.deepEqual(rtlCase(SOURCES.mixed), { hebrew: true, arabic: true, polyglossia: true });

// A Hebrew-only diagram must not pull in the Arabic gloss (missing on minimal installs).
{
	const tex = buildLatexDocument(SOURCES.hebrewMacro).tex;
	assert.ok(!tex.includes('arabicfont'), 'no Arabic font family for a Hebrew-only diagram');
	assert.ok(tex.includes('\\newcommand{\\he}[1]{\\texthebrew{#1}}'));
	assert.ok(tex.includes('\\newcommand{\\ar}[1]{#1}'), 'unused ar still defined, as identity');
	assert.ok(tex.includes('Noto Serif Hebrew') && tex.includes('David CLM'), 'full chain emitted');
}

assert.deepEqual(detectRtlUsage(SOURCES.plain), { hebrew: false, arabic: false });
assert.deepEqual(detectRtlUsage(SOURCES.mixed), { hebrew: true, arabic: true });

/* ========================================================= font chains */

{
	// A user override is tried first, then the defaults — a bad name cannot brick rendering.
	const tex = buildLatexDocument(SOURCES.plain, { mainFont: 'Nonexistent Face' }).tex;
	const line = tex.split('\n').find(l => l.includes('setmainfont'));
	assert.ok(line.startsWith('\\IfFontExistsTF{Nonexistent Face}'), 'override first');
	assert.ok(line.includes('TeX Gyre Termes'), 'default still reachable as fallback');
	assert.ok(!line.includes('\n'));
}

{
	// Chain length must not change the preamble line count.
	const a = buildLatexDocument(SOURCES.hebrewMacro, {}).userLineOffset;
	const b = buildLatexDocument(SOURCES.hebrewMacro, { hebrewFont: 'Some Other Face' }).userLineOffset;
	assert.equal(a, b, 'an extra fallback must not shift the offset');
}

/* ==================================================== sanitizeFontName */

assert.equal(sanitizeFontName('Noto Serif Hebrew'), 'Noto Serif Hebrew');
assert.equal(sanitizeFontName('TeX Gyre Termes'), 'TeX Gyre Termes');
assert.equal(sanitizeFontName('Frank Ruehl CLM'), 'Frank Ruehl CLM');
assert.equal(sanitizeFontName('A\nB'), 'A B', 'newlines would shift the preamble line count');
assert.equal(sanitizeFontName('  spaced   out  '), 'spaced out');
assert.equal(sanitizeFontName(''), '');
assert.equal(sanitizeFontName('   '), '');
// Hyphens are legitimate in font names and must survive.
assert.equal(sanitizeFontName('IBM Plex Sans Arabic-Bold'), 'IBM Plex Sans Arabic-Bold');

for (const hostile of [
	'X}\\usepackage{shellesc}{',
	'100% comment',
	'a\r\nb',
	'$math$',
	'under_score',
	'Font[Scale=2]',
]) {
	const cleaned = sanitizeFontName(hostile);
	assert.ok(!/[\\{}%#$&_~^[\],=]/.test(cleaned), `structural chars survived: ${cleaned}`);
	assert.ok(!/[\r\n]/.test(cleaned), `newline survived: ${JSON.stringify(cleaned)}`);
}

assert.equal(sanitizeFontName('x'.repeat(500)).length, 100, 'length is capped');

/* ==================================================== custom preamble */

{
	const doc = buildLatexDocument(SOURCES.plain, {
		customPreamble: '\\documentclass[tikz]{standalone}\n\\usepackage{tikz}\n\\setmainfont{Whatever}',
	});
	assert.ok(!doc.tex.includes('TeX Gyre Termes'), 'managed fonts are replaced');
	assert.ok(!doc.tex.includes('circuitikz'), 'managed package stack is replaced');
	assert.ok(doc.tex.includes('\\setmainfont{Whatever}'), 'user text survives verbatim');
	assert.equal(doc.features.customPreamble, true);
}

// Machinery the plugin always appends, in both modes.
for (const options of [{}, { customPreamble: '\\usepackage{tikz}' }]) {
	const tex = buildLatexDocument(SOURCES.plain, options).tex;
	assert.ok(tex.includes('luatikzcalmin'), 'calibration block always present');
	assert.equal(tex.split('\\begin{document}').length - 1, 1, 'exactly one \\begin{document}');
	assert.equal(tex.split('\\end{document}').length - 1, 1, 'exactly one \\end{document}');
}

{
	// A user's own \begin{document} would abort the compile — it is neutralized.
	const tex = buildLatexDocument(SOURCES.plain, {
		customPreamble: '\\usepackage{tikz}\n\\begin{document}\n\\end{document}',
	}).tex;
	assert.equal(tex.split('\\begin{document}').length - 1, 1);
}

{
	// CALIBRATION_PREAMBLE uses \tikzset, so something must load TikZ.
	const tex = buildLatexDocument(SOURCES.plain, { customPreamble: '\\usepackage{amsmath}' }).tex;
	assert.ok(tex.includes('\\documentclass'), 'documentclass auto-injected');
	assert.ok(tex.includes('\\usepackage{tikz}'), 'tikz auto-injected');
}

{
	const tex = buildLatexDocument(SOURCES.plain, { customPreamble: '\\usepackage{pgfplots}' }).tex;
	assert.equal(tex.split('\\usepackage{tikz}').length - 1, 0, 'pgfplots already loads tikz');
}

/* ============================================ managed preamble preview */

{
	const preview = buildManagedPreamblePreview();
	assert.ok(preview.includes('\\documentclass'));
	assert.ok(preview.includes('TeX Gyre Termes'));
	assert.ok(preview.includes('\\setotherlanguage{hebrew}'), 'preview shows both scripts');
	assert.ok(preview.includes('\\setotherlanguage{arabic}'));
	assert.ok(!preview.includes('luatikzcalmin'), 'machinery excluded — user cannot edit it');
	assert.ok(!preview.includes('\\begin{document}'), 'appended by the plugin');

	// Round-trip: loading the preview must still produce a usable document.
	const doc = buildLatexDocument(SOURCES.plain, { customPreamble: preview });
	assert.ok(doc.tex.includes('luatikzcalmin'));
	assert.equal(doc.tex.split('\\begin{document}').length - 1, 1);
	assert.ok(doc.tex.includes('TeX Gyre Termes'));
}

/* ==================================================== settings plumbing */

/**
 * Guards the persistSetting bug class: a free-text setting missing from
 * STRING_SETTING_KEYS passes `key in DEFAULT_SETTINGS` but hits no assignment
 * branch, so it is silently dropped on save. Enum-valued settings are exempt
 * because they have their own parse branches — but a NEW string setting has to
 * be classified as one or the other before this passes.
 */
const ENUM_SETTING_KEYS = ['renderEngine', 'outputFormat', 'darkModeStyle', 'semicolonReminderMode'];

for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
	if (typeof value !== 'string') {
		continue;
	}
	assert.ok(
		STRING_SETTING_KEYS.includes(key) || ENUM_SETTING_KEYS.includes(key),
		`"${key}" is a string setting but is in neither STRING_SETTING_KEYS nor the enum list `
		+ '— persistSetting would drop it on save',
	);
}

for (const key of ['customPreamble', 'mainFont', 'hebrewFont', 'arabicFont']) {
	assert.ok(key in DEFAULT_SETTINGS, `${key} missing from DEFAULT_SETTINGS`);
	assert.ok(STRING_SETTING_KEYS.includes(key), `${key} not persisted`);
	assert.ok(RENDER_IDENTITY_KEYS.includes(key), `${key} must invalidate the render caches`);
}

console.log(`latex-wrapper: ${invariantChecks} offset-invariant cases + fixtures OK`);
