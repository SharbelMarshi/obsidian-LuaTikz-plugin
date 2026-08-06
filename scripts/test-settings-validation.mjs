/**
 * Settings parsing and validation, against the real src module.
 *
 * The regression this pins: timeoutMs was persisted with only an isFinite
 * check, so a stored (or typed) 0 / negative value reached setTimeout and
 * every render in the vault failed instantly with "Timed out.".
 */
import assert from 'node:assert/strict';
import { loadSrcModules, OBSIDIAN_STUB } from './loadSrc.mjs';

const { settings } = await loadSrcModules(
	{ settings: 'src/settings/settings.ts' },
	{
		stubs: {
			obsidian: OBSIDIAN_STUB,
			// settings.ts imports the plugin class for its type only, but the
			// bundle would still pull in main.ts and everything behind it.
			'../main': 'export default class LuaTikzPlugin {}',
		},
	},
);
const { parseSettings, clampTimeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS } = settings;

// --- clamp ------------------------------------------------------------------

assert.equal(clampTimeoutMs(0), MIN_TIMEOUT_MS, 'timeout 0 must clamp up');
assert.equal(clampTimeoutMs(-5), MIN_TIMEOUT_MS);
assert.equal(clampTimeoutMs(5), MIN_TIMEOUT_MS, 'a half-typed "5" must not become the timeout');
assert.equal(clampTimeoutMs(15000), 15000, 'sane values pass through');
assert.equal(clampTimeoutMs(99999999), MAX_TIMEOUT_MS, 'huge values must not disable the safety net');

// --- stored data.json goes through the clamp --------------------------------

{
	const parsed = parseSettings({ timeoutMs: 0 });
	assert.equal(parsed.timeoutMs, MIN_TIMEOUT_MS, 'a bricked stored timeout must self-heal on load');
}
{
	const parsed = parseSettings({ timeoutMs: 15000 });
	assert.equal(parsed.timeoutMs, 15000);
}

// --- parseSettings round-trip ----------------------------------------------

{
	const parsed = parseSettings({
		renderEngine: 'tikzjax',
		lualatexPath: '/x/lualatex',
		extraPreamble: '\\usepackage{physics}',
		customPreamble: '',
		mainFont: 'TeX Gyre Termes',
		hebrewFont: '',
		arabicFont: '',
		enableLocalShellRenderer: true,
		outputFormat: 'png',
		timeoutMs: 20000,
		cacheEnabled: false,
		darkModeStyle: 'none',
		semicolonReminderMode: 'auto-append',
		autoCloseBrackets: false,
	});
	assert.equal(parsed.renderEngine, 'tikzjax');
	assert.equal(parsed.lualatexPath, '/x/lualatex');
	assert.equal(parsed.extraPreamble, '\\usepackage{physics}');
	assert.equal(parsed.mainFont, 'TeX Gyre Termes');
	assert.equal(parsed.outputFormat, 'png');
	assert.equal(parsed.cacheEnabled, false);
	assert.equal(parsed.darkModeStyle, 'none');
	assert.equal(parsed.semicolonReminderMode, 'auto-append');
	assert.equal(parsed.autoCloseBrackets, false);
}

// Garbage shapes fall back rather than crash.
assert.deepEqual(parseSettings(null), {});
assert.deepEqual(parseSettings('nonsense'), {});
{
	const parsed = parseSettings({ renderEngine: 'bogus', outputFormat: 42, timeoutMs: 'soon' });
	assert.equal(parsed.renderEngine, undefined, 'unknown engine must not be accepted');
	assert.equal(parsed.outputFormat, undefined);
	assert.equal(parsed.timeoutMs, 15000, 'non-numeric timeout falls back to the default');
}

// Legacy dark-mode style migrates instead of being dropped.
{
	const parsed = parseSettings({ darkModeStyle: 'css-filter' });
	assert.equal(parsed.darkModeStyle, 'auto-invert');
}

// --- migrateLegacySettings (main.ts) ----------------------------------------

const { main } = await loadSrcModules(
	{ main: 'src/main.ts' },
	{
		external: ['@codemirror/state', '@codemirror/view', '@codemirror/autocomplete', '@codemirror/lint', 'node-tikzjax'],
		stubs: {
			obsidian: OBSIDIAN_STUB,
			// Provided by Obsidian at runtime; only the history-isolation
			// annotation is imported.
			'@codemirror/commands': 'export const isolateHistory = { of: value => ({ value }) };',
		},
	},
);
const { migrateLegacySettings } = main;

// Fresh install (null data): defaults apply, and crucially the consent notice
// is shown — it is the UX gate for the local-shell default.
{
	const merged = migrateLegacySettings(null, parseSettings(null));
	assert.equal(merged.enableLocalShellRenderer, true, 'fresh install uses the default');
	assert.equal(merged.showInstallNotice, true, 'fresh install must show the consent notice');
}

// Pre-consent upgrade (data.json without the flag): legacy grandfather path.
{
	const legacy = { lualatexPath: '/x/lualatex' };
	const merged = migrateLegacySettings(legacy, parseSettings(legacy));
	assert.equal(merged.enableLocalShellRenderer, true, 'legacy upgrade keeps local rendering working');
	assert.equal(merged.showInstallNotice, false);
}

// A user who explicitly disabled it stays disabled.
{
	const stored = { enableLocalShellRenderer: false };
	const merged = migrateLegacySettings(stored, parseSettings(stored));
	assert.equal(merged.enableLocalShellRenderer, false, 'an explicit opt-out must survive migration');
}

// Legacy css-filter style migrates through the raw path too.
{
	const stored = { darkModeStyle: 'css-filter', renderEngine: 'lualatex' };
	const merged = migrateLegacySettings(stored, parseSettings(stored));
	assert.equal(merged.darkModeStyle, 'auto-invert');
}

console.log('test-settings-validation: ok');
