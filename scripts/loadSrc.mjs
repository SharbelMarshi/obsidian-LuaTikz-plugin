/**
 * Bundle modules out of src/ and import them, so tests exercise the shipped
 * code instead of a copy of it.
 *
 * The suite used to re-implement the logic it was testing — test-error-mapping
 * had its own private suggestLatexAutofix — which is how a Fix button that
 * never appeared stayed green for several releases.
 *
 * Output lands under node_modules/ on purpose: bare specifiers left external
 * (@codemirror/*) then resolve to the same instances the test itself imports,
 * which instanceof checks inside CodeMirror depend on.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT_ROOT = join(process.cwd(), 'node_modules', '.luatikz-test-build');

export async function loadSrcModules(entries, options = {}) {
	const { external = [], stubs = {} } = options;
	mkdirSync(OUT_ROOT, { recursive: true });

	const stubNames = Object.keys(stubs);
	const plugins = stubNames.length
		? [{
			name: 'luatikz-test-stubs',
			setup(builder) {
				const filter = new RegExp(`^(${stubNames.map(escapeRe).join('|')})$`);
				builder.onResolve({ filter }, args => ({
					path: args.path,
					namespace: 'luatikz-stub',
				}));
				builder.onLoad({ filter: /.*/, namespace: 'luatikz-stub' }, args => ({
					contents: stubs[args.path],
					loader: 'js',
					resolveDir: process.cwd(),
				}));
			},
		}]
		: [];

	const loaded = {};
	for (const [name, entry] of Object.entries(entries)) {
		const outfile = join(OUT_ROOT, `${name}.mjs`);
		await build({
			entryPoints: [entry],
			bundle: true,
			format: 'esm',
			outfile,
			logLevel: 'silent',
			external,
			plugins,
		});
		loaded[name] = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	}
	return loaded;
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Minimal stand-in for the parts of the obsidian runtime src/ imports as values. */
export const OBSIDIAN_STUB = `
import { StateField } from '@codemirror/state';
export const editorEditorField = StateField.define({ create: () => null, update: v => v });
export class Notice { constructor(message) { this.message = message; } }
export class MarkdownView {}
export class TFile {}
export class Menu {}
export class Modal { constructor(app) { this.app = app; } }
export class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; } }
export class MarkdownRenderChild { constructor(containerEl) { this.containerEl = containerEl; } }
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
export class Setting {
	constructor() {}
	setName() { return this; }
	setDesc() { return this; }
	setHeading() { return this; }
	setClass() { return this; }
	addText() { return this; }
	addTextArea() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
	addButton() { return this; }
}
export const normalizePath = p => p.replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/');
export const Platform = { isMobileApp: false };
export const debounce = (fn) => fn;
`;
