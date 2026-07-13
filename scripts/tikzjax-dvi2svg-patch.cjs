'use strict';

// Build-time replacement for node-tikzjax/dist/dvi2svg.js (wired up in
// esbuild.config.mjs). The original spun up jsdom (Node-only, drags in
// vm/http/net/tls) just to get a scratch document, and node:crypto for an id
// hash. Obsidian always runs in a real DOM (desktop Electron and the mobile
// webview), so use a detached scratch document instead; `svgo` resolves to
// its pure-browser build via the bundler. Behavior matches the original.

Object.defineProperty(exports, '__esModule', { value: true });
exports.hashCode = exports.dvi2svg = void 0;

const dvi2html_1 = require('@prinsss/dvi2html');
const svgo_1 = require('svgo');
const { Buffer } = require('buffer');

function createScratchDocument() {
	if (typeof document !== 'undefined' && document.implementation) {
		return document.implementation.createHTMLDocument('');
	}
	throw new Error('TikZJax needs a DOM environment to post-process SVG output.');
}

/**
 * Converts a DVI file to an SVG string.
 *
 * @param dvi The buffer containing the DVI file.
 * @param options The options.
 * @returns The SVG string.
 */
async function dvi2svg(dvi, options = {}) {
	let html = '';
	async function* streamBuffer() {
		yield Buffer.from(dvi);
		return;
	}
	await (0, dvi2html_1.dvi2html)(streamBuffer(), {
		write(chunk) {
			html = html + chunk.toString();
		},
	});
	// Patch: Assign unique IDs to SVG elements to avoid conflicts when inlining multiple SVGs.
	const ids = html.match(/\bid="pgf[^"]*"/g);
	if (ids) {
		// Sort the ids from longest to shortest.
		ids.sort((a, b) => b.length - a.length);
		const hash = hashCode(html);
		for (const id of ids) {
			const pgfIdString = id.replace(/id="pgf(.*)"/, '$1');
			html = html.replaceAll('pgf' + pgfIdString, `pgf${hash}${pgfIdString}`);
		}
	}
	// Patch: Fixes symbols stored in the SOFT HYPHEN character (e.g. \Omega, \otimes) not being rendered.
	// Replaces soft hyphens with ¬
	html = html.replaceAll('&#173;', '&#172;');
	// The DOM may fail to parse the generated SVG if the graph is too complex.
	// In this case, we can skip the sanitization step and return the raw SVG.
	if (options.disableSanitize) {
		return html;
	}
	// Fix errors in the generated HTML using a detached scratch document.
	const scratch = createScratchDocument();
	const range = scratch.createRange();
	range.selectNodeContents(scratch.body);
	const container = range.createContextualFragment(html);
	const svg = container.querySelector('svg');
	if (options.embedFontCss) {
		const defs = scratch.createElement('defs');
		const style = scratch.createElement('style');
		const fontCssUrl = options.fontCssUrl ?? 'https://cdn.jsdelivr.net/npm/node-tikzjax@latest/css/fonts.css';
		style.textContent = `@import url('${fontCssUrl}');`;
		defs.appendChild(style);
		svg.prepend(defs);
	}
	if (options.disableOptimize) {
		return svg.outerHTML;
	}
	const optimizedSvg = (0, svgo_1.optimize)(svg.outerHTML, {
		plugins: [
			{
				name: 'preset-default',
				params: {
					overrides: {
						// Don't use the "cleanupIDs" plugin
						// To avoid problems with duplicate IDs ("a", "b", ...)
						// when inlining multiple svgs with IDs
						cleanupIds: false,
					},
				},
			},
		],
	});
	return optimizedSvg.data;
}
exports.dvi2svg = dvi2svg;

/**
 * A helper function to generate a unique ID prefix for each rendered SVG.
 * FNV-1a is plenty here — the hash only namespaces pgf ids per render —
 * and it avoids pulling in node:crypto, which mobile does not have.
 *
 * @param str The string to hash.
 * @returns The hash of the string.
 */
function hashCode(str) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}
exports.hashCode = hashCode;
