/**
 * Dark-mode inversion must happen in RendererManager, for every engine.
 *
 * It used to live inside LuaLatexRenderer only, so TikZJax output — the sole
 * engine on mobile — was never inverted: with the default 'auto-invert' style
 * and a dark theme, every mobile diagram rendered black-on-dark (the white
 * backing rect is stripped by finalizeTikzJaxSvg). This mounts the real
 * RendererManager with both renderers stubbed to return fixed black SVGs and
 * asserts the manager inverts regardless of which engine produced the result.
 */
import assert from 'node:assert/strict';
import { loadSrcModules, OBSIDIAN_STUB } from './loadSrc.mjs';

const BLACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="rgb(0%,0%,0%)" d="M0 0h1v1z"/></svg>';

const RENDERER_STUB = (engine) => `
export class ${engine === 'tikzjax' ? 'TikzJaxRenderer' : 'LuaLatexRenderer'} {
	constructor() {}
	clearCache() {}
	async render(request) {
		const svgText = ${JSON.stringify(BLACK_SVG)};
		return { ok: true, engine: '${engine}', svg: svgText, svgText, dataUrl: 'data:image/svg+xml;base64,stub' };
	}
}
`;

const { manager } = await loadSrcModules(
	{ manager: 'src/render/RendererManager.ts' },
	{
		stubs: {
			obsidian: OBSIDIAN_STUB,
			'./LuaLatexRenderer': RENDERER_STUB('lualatex'),
			'./TikzJaxRenderer': RENDERER_STUB('tikzjax'),
		},
	},
);

function makeManager({ engine, isDark }) {
	const settings = {
		renderEngine: engine,
		enableLocalShellRenderer: true,
		lualatexPath: '/usr/local/bin/lualatex',
		outputFormat: 'svg',
		timeoutMs: 15000,
		cacheEnabled: false,
		extraPreamble: '',
		customPreamble: '',
		mainFont: '',
		hebrewFont: '',
		arabicFont: '',
		inlineLivePreviewEnabledByDefault: true,
		darkModeStyle: 'auto-invert',
		starterBlockOnNewFence: true,
		enableStructuralLint: true,
		semicolonReminderMode: 'hint',
		autoCloseBrackets: true,
	};
	return new manager.RendererManager({ vault: { adapter: {} } }, 'luatikz', '0.0.0-test', () => isDark, () => settings);
}

const SOURCE = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}';

// The regression: tikzjax engine, dark theme, auto-invert.
{
	const result = await makeManager({ engine: 'tikzjax', isDark: true }).render(SOURCE);
	assert.equal(result.ok, true);
	assert.equal(result.engine, 'tikzjax');
	assert.ok(
		result.svgText.includes('rgb(100%,100%,100%)'),
		`tikzjax output was not inverted for dark mode: ${result.svgText}`,
	);
	assert.ok(!result.svgText.includes('rgb(0%,0%,0%)'), 'black paint survived');
	// The dataUrl must encode the *inverted* SVG, not the renderer's original.
	assert.notEqual(result.dataUrl, 'data:image/svg+xml;base64,stub');
}

// LuaLaTeX keeps working the way it always did.
{
	const result = await makeManager({ engine: 'lualatex', isDark: true }).render(SOURCE);
	assert.equal(result.engine, 'lualatex');
	assert.ok(result.svgText.includes('rgb(100%,100%,100%)'), 'lualatex output lost inversion');
}

// Light theme: nobody inverts.
for (const engine of ['tikzjax', 'lualatex']) {
	const result = await makeManager({ engine, isDark: false }).render(SOURCE);
	assert.ok(result.svgText.includes('rgb(0%,0%,0%)'), `${engine}: light theme must not invert`);
	assert.equal(result.dataUrl, 'data:image/svg+xml;base64,stub', `${engine}: light theme must not touch dataUrl`);
}

// --- dispatch routing --------------------------------------------------------

// Arabic content on the tikzjax engine falls back to LuaLaTeX when local
// execution is available; without it, a hard error rather than broken shaping.
{
	const arabicSource = '\\begin{tikzpicture}\\node {\\ar{مرحبا}};\\end{tikzpicture}';
	const withLocal = await makeManager({ engine: 'tikzjax', isDark: false }).render(arabicSource);
	assert.equal(withLocal.engine, 'lualatex', 'Arabic must fall back to LuaLaTeX');

	const manager = makeManager({ engine: 'tikzjax', isDark: false });
	// Disable the fallback path by mutating the settings the getter returns.
	const settings = manager['getSettings']();
	settings.enableLocalShellRenderer = false;
	const withoutLocal = await manager.render(arabicSource);
	assert.equal(withoutLocal.ok, false, 'Arabic without LuaLaTeX must error');
	assert.ok(withoutLocal.error.includes('Arabic'), withoutLocal.error);
}

// --- in-flight dedupe --------------------------------------------------------

// Two identical renders issued back-to-back share one dispatch. The stubs
// resolve immediately, so instrument via a counting stub instead: re-import
// the manager with renderers that count calls and gate on a manual promise.
{
	let calls = 0;
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const COUNTING_STUB = `
export class LuaLatexRenderer {
	constructor() {}
	clearCache() {}
	async render() {
		globalThis.__luatikzCalls = (globalThis.__luatikzCalls ?? 0) + 1;
		await globalThis.__luatikzGate;
		const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#111"/></svg>';
		return { ok: true, engine: 'lualatex', svg: svgText, svgText, dataUrl: 'data:image/svg+xml;base64,stub' };
	}
}
`;
	globalThis.__luatikzGate = gate;
	globalThis.__luatikzCalls = 0;
	const { manager: counting } = await loadSrcModules(
		{ manager: 'src/render/RendererManager.ts' },
		{
			stubs: {
				obsidian: OBSIDIAN_STUB,
				'./LuaLatexRenderer': COUNTING_STUB,
				'./TikzJaxRenderer': RENDERER_STUB('tikzjax'),
			},
		},
	);
	const settings = {
		renderEngine: 'lualatex', enableLocalShellRenderer: true, lualatexPath: '/x/lualatex',
		outputFormat: 'svg', timeoutMs: 15000, cacheEnabled: false, extraPreamble: '',
		customPreamble: '', mainFont: '', hebrewFont: '', arabicFont: '',
		inlineLivePreviewEnabledByDefault: true, darkModeStyle: 'none',
		starterBlockOnNewFence: true, enableStructuralLint: true,
		semicolonReminderMode: 'hint', autoCloseBrackets: true,
	};
	const mgr = new counting.RendererManager({ vault: { adapter: {} } }, 'luatikz', '0.0.0-test', () => false, () => settings);

	const first = mgr.render(SOURCE);
	const second = mgr.render(SOURCE);
	release();
	const [a, b] = await Promise.all([first, second]);
	calls = globalThis.__luatikzCalls;
	assert.equal(calls, 1, `identical concurrent renders dispatched ${calls} compiles, expected 1`);
	assert.equal(a.svgText, b.svgText);
	delete globalThis.__luatikzGate;
	delete globalThis.__luatikzCalls;
}

console.log('test-render-dark-routing: ok');
