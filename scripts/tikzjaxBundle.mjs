// Shared esbuild pieces for bundling the TikZJax (node-tikzjax) pipeline so
// it runs without a Node.js runtime — mobile Obsidian only has a webview.
// Used by esbuild.config.mjs (plugin build) and test-tikzjax-mobile-sim.mjs.
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);

const utilShimPath = require.resolve("./nodeUtilShim.js");
const punycodePath = require.resolve("punycode/");

/**
 * Polyfills for the few Node built-ins (and svgo's node build) that remain in
 * the bundle's mobile-reachable graph after the node-tikzjax dist patches.
 */
export const NODE_POLYFILLS = {
	events: require.resolve("events/events.js"),
	"node:events": require.resolve("events/events.js"),
	util: utilShimPath,
	"node:util": utilShimPath,
	buffer: require.resolve("buffer/"),
	"node:buffer": require.resolve("buffer/"),
	process: require.resolve("process/browser"),
	"node:process": require.resolve("process/browser"),
	svgo: require.resolve("svgo/dist/svgo.browser.js"),
	fflate: require.resolve("fflate/browser"),
	path: require.resolve("path-browserify"),
	"node:path": require.resolve("path-browserify"),
	assert: require.resolve("assert/"),
	"node:assert": require.resolve("assert/"),
	stream: require.resolve("stream-browserify"),
	"node:stream": require.resolve("stream-browserify"),
	string_decoder: require.resolve("string_decoder/"),
	"node:string_decoder": require.resolve("string_decoder/"),
	os: require.resolve("os-browserify/browser.js"),
	"node:os": require.resolve("os-browserify/browser.js"),
};

export const nodePolyfillPlugin = {
	name: "node-polyfills",
	setup(build) {
		for (const [moduleName, resolvedPath] of Object.entries(NODE_POLYFILLS)) {
			const pattern = new RegExp(`^${moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
			build.onResolve({ filter: pattern }, () => ({ path: resolvedPath }));
		}
	},
};

export const punycodeAliasPlugin = {
	name: "punycode-alias",
	setup(build) {
		build.onResolve({ filter: /^punycode\/$/ }, () => ({
			path: punycodePath,
		}));
		build.onResolve({ filter: /^punycode$/ }, () => ({
			path: punycodePath,
		}));
	},
};

const TIKZJAX_DIST_PATCHES = {
	"bootstrap.js": require.resolve("./tikzjax-bootstrap-patch.cjs"),
	"dvi2svg.js": require.resolve("./tikzjax-dvi2svg-patch.cjs"),
};

/**
 * Swap node-tikzjax's Node-only dist modules for webview-safe replacements:
 * bootstrap.js (fs/zlib/tar-fs/memfs -> bundled base64 assets + fflate + a
 * minimal tar reader) and dvi2svg.js (jsdom/crypto -> the real DOM + FNV hash).
 */
export const tikzjaxDistPatchPlugin = {
	name: "tikzjax-dist-patch",
	setup(build) {
		build.onLoad({ filter: /node-tikzjax[\\/]dist[\\/](?:bootstrap|dvi2svg)\.js$/ }, async (args) => {
			const baseName = args.path.split(/[\\/]/).pop();
			const replacement = TIKZJAX_DIST_PATCHES[baseName];
			const contents = await fs.promises.readFile(replacement, "utf8");
			return { contents, loader: "js", resolveDir: path.dirname(args.path) };
		});
	},
};

/**
 * Bundled deps (dvi2html, svgo) reference the bare Buffer/process globals,
 * which the mobile webview does not provide; inject polyfill-backed bindings.
 */
export const globalsInjectPath = require.resolve("./bundleGlobalsShim.js");

/**
 * Node built-ins that stay external: they are desktop-only concerns (reached
 * via Electron's window.require or never on the mobile code path).
 */
const NODE_ONLY_EXTERNAL = new Set([
	'fs',
	'crypto',
	'http',
	'https',
	'net',
	'tls',
	'child_process',
	'dgram',
	'dns',
	'cluster',
	'worker_threads',
	'perf_hooks',
	'v8',
	'module',
	'repl',
	'readline',
	'inspector',
	'trace_events',
	'async_hooks',
	'http2',
	'wasi',
	'diagnostics_channel',
]);

export const externalBuiltins = builtinModules.filter((name) => {
	if (name === 'punycode') {
		return false;
	}
	if (name === 'fs' || name.startsWith('fs/')) {
		return true;
	}
	if (NODE_ONLY_EXTERNAL.has(name)) {
		return true;
	}
	if (name.startsWith('_http_') || name.startsWith('_tls_')) {
		return true;
	}
	return false;
});

/** Everything a TikZJax-capable bundle needs, ready to spread into esbuild options. */
export const tikzjaxBundleOptions = {
	plugins: [nodePolyfillPlugin, punycodeAliasPlugin, tikzjaxDistPatchPlugin],
	inject: [globalsInjectPath],
};
