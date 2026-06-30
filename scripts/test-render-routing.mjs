#!/usr/bin/env node
import esbuild from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadModule(entry) {
	const outDir = mkdtempSync(path.join(tmpdir(), 'luatikz-route-'));
	const outfile = path.join(outDir, `${path.basename(entry, '.ts')}.cjs`);
	await esbuild.build({
		entryPoints: [path.join(projectRoot, entry)],
		bundle: true,
		outfile,
		format: 'cjs',
		platform: 'node',
		logLevel: 'silent',
	});
	return require(outfile);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const { resolveTikzJaxDispatch, ARABIC_REQUIRES_LUALATEX_ERROR } = await loadModule('utils/renderRouting.ts');
const { containsArabic, containsArabicContent, containsHebrew, containsRtl } = await loadModule('utils/rtlDetection.ts');

assert(containsHebrew('עברית'), 'Hebrew detection failed');
assert(containsArabic('العربية'), 'Arabic detection failed');
assert(containsArabicContent(String.raw`\ar{العربية}`), 'Arabic macro detection failed');
assert(containsRtl('mixed עברית العربية'), 'RTL detection failed');

const disabledSettings = {
	enableLocalShellRenderer: false,
	lualatexPath: '/Library/TeX/texbin/lualatex',
};

const enabledSettings = {
	enableLocalShellRenderer: true,
	lualatexPath: '/Library/TeX/texbin/lualatex',
};

assert(
	resolveTikzJaxDispatch(String.raw`\node{\ar{العربية}};`, disabledSettings) === 'arabic-error',
	'Arabic with TikZJax and disabled LuaLaTeX must error',
);
assert(
	resolveTikzJaxDispatch(String.raw`\node{\ar{العربية}};`, enabledSettings) === 'lualatex-fallback',
	'Arabic with TikZJax and enabled LuaLaTeX must fall back',
);
assert(
	resolveTikzJaxDispatch(String.raw`\node{Flow};`, enabledSettings) === 'tikzjax',
	'English TikZ must stay on TikZJax',
);
assert(
	ARABIC_REQUIRES_LUALATEX_ERROR.includes('Local LuaLaTeX'),
	'Arabic error message must mention Local LuaLaTeX',
);

console.log('Render routing tests passed.');
