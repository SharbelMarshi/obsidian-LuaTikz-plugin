// Simulates mobile Obsidian for the TikZJax pipeline: bundles node-tikzjax
// with the exact same esbuild plugins as main.js, then runs it in an
// environment where the bundle cannot require ANY Node built-in module and
// the only DOM is a webview-like one (jsdom standing in for the webview).
// If this renders SVG, the pipeline has no hidden Node dependencies left.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Module, { builtinModules, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { externalBuiltins, tikzjaxBundleOptions } from './tikzjaxBundle.mjs';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. Bundle a harness that exports tex2svg, with the same plugins as main.js.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luatikz-mobile-sim-'));
const bundleFile = path.join(outDir, 'harness.cjs');

await esbuild.build({
	stdin: {
		contents: "module.exports = require('node-tikzjax');\n",
		resolveDir: projectRoot,
		loader: 'js',
	},
	outfile: bundleFile,
	bundle: true,
	...tikzjaxBundleOptions,
	external: externalBuiltins,
	format: 'cjs',
	target: 'es2020',
	platform: 'node',
	logLevel: 'silent',
	absWorkingDir: projectRoot,
});

// 2. The bundle must not contain Node-only requires on the TikZJax path.
const bundleText = fs.readFileSync(bundleFile, 'utf8');
for (const forbidden of ['require("jsdom")', 'require("tar-fs")', 'require("memfs")', 'require("fs")', 'require("zlib")', 'require("vm")', 'require("crypto")', 'require("worker_threads")']) {
	assert.ok(!bundleText.includes(forbidden), `mobile bundle must not contain ${forbidden}`);
}

// 3. Webview-like globals: a real DOM (jsdom stands in) and the bundled assets.
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const texDir = path.join(projectRoot, 'node_modules/node-tikzjax/tex');
dom.window.__LUATIKZ_TEX_ASSET_BASE64 = {
	'core.dump.gz': fs.readFileSync(path.join(texDir, 'core.dump.gz')).toString('base64'),
	'tex.wasm.gz': fs.readFileSync(path.join(texDir, 'tex.wasm.gz')).toString('base64'),
	'tex_files.tar.gz': fs.readFileSync(path.join(texDir, 'tex_files.tar.gz')).toString('base64'),
};

// 4. Block every Node built-in for requires that originate from the harness
//    bundle — exactly what mobile Obsidian does to plugin code.
const blocked = new Set();
for (const name of builtinModules) {
	blocked.add(name);
	blocked.add(`node:${name}`);
}
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
	if (blocked.has(request) && parent && parent.filename === bundleFile) {
		throw new Error(`Cannot find module '${request}' (Node built-ins do not exist on mobile)`);
	}
	return originalLoad.call(this, request, parent, isMain);
};

// 5. Render a TikZ picture end to end.
try {
	const tikzjax = require(bundleFile);
	const tex2svg = tikzjax.default ?? tikzjax;
	const source = [
		'\\begin{document}',
		'\\begin{tikzpicture}',
		'\\draw (0,0) circle (1in) node {mobile};',
		'\\draw (0,0) grid (3,2);',
		'\\end{tikzpicture}',
		'\\end{document}',
	].join('\n');

	const svg = await tex2svg(source, {
		showConsole: false,
		texPackages: { tikz: '' },
	});

	assert.ok(typeof svg === 'string' && svg.includes('<svg'), 'tex2svg must return SVG markup');
	assert.ok(svg.includes('</svg>'), 'SVG output must be complete');
	console.log(`tikzjax-mobile-sim: rendered ${svg.length} bytes of SVG with all Node built-ins blocked OK`);
} finally {
	Module._load = originalLoad;
	delete globalThis.window;
	delete globalThis.document;
	fs.rmSync(outDir, { recursive: true, force: true });
}
