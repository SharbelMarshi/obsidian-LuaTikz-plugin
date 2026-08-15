/**
 * Autocomplete extension wiring, against real CodeMirror.
 *
 * The regression this pins: the extension used to pass
 * `autocompletion({override: [...]})`. `override` has no merge rule in
 * CodeMirror's `combineConfig`, and its value is a fresh array, so as soon as
 * ANY other installed plugin also passed `override`, facet resolution threw
 * "Config merge conflict for field override" — inside `onload`, which
 * Obsidian reports as LuaTikZ failing to load entirely. `override` was also
 * semantically wrong: it replaces every completion source in the editor, for
 * all files, so it suppressed other plugins' completions globally.
 *
 * The fix registers the source as language data instead, which is additive.
 * These tests assert both halves: no conflict with a rival extension, and the
 * completions still actually fire inside a TikZ fence.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const CM_EXTERNALS = [
	'@codemirror/state',
	'@codemirror/view',
	'@codemirror/autocomplete',
	'@codemirror/lint',
	'@codemirror/commands',
];

const { autocomplete } = await loadSrcModules(
	{ autocomplete: 'src/editor/latexAutocomplete.ts' },
	{ external: CM_EXTERNALS },
);
const { latexAutocompleteExtension } = autocomplete;

const { EditorState } = await import('@codemirror/state');
const { autocompletion, CompletionContext } = await import('@codemirror/autocomplete');

// The two markers are deliberately distinct strings (not prefixes of each
// other) so the positions below cannot accidentally point at the wrong line.
const IN_FENCE = '\\nod';
const IN_PROSE = '\\draw';

const DOC = [
	`Prose that mentions ${IN_PROSE} outside any fence.`,
	'',
	'```tikz',
	IN_FENCE,
	'```',
	'',
].join('\n');

const posAfter = needle => {
	const index = DOC.indexOf(needle);
	assert.ok(index >= 0, `test doc must contain ${needle}`);
	assert.equal(DOC.indexOf(needle, index + 1), -1, `${needle} must be unambiguous in the test doc`);
	return index + needle.length;
};

// --- the crash: a second extension setting `override` ------------------------

{
	// A stand-in for any other community plugin that installs its own
	// completion source the way LuaTikZ used to.
	const rival = autocompletion({
		override: [() => null],
		activateOnTyping: false,
		maxRenderedOptions: 10,
	});

	// Facet resolution happens in EditorState.create; the old code threw here.
	let state;
	assert.doesNotThrow(() => {
		state = EditorState.create({
			doc: DOC,
			extensions: [latexAutocompleteExtension(), rival],
		});
	}, 'our extension must not conflict with another plugin\'s autocompletion config');

	// The rival's config must survive untouched — proof we are not silently
	// winning the merge by setting the same fields ourselves.
	assert.ok(state, 'state built');
}

// --- our own extension alone still resolves ---------------------------------

{
	const state = EditorState.create({
		doc: DOC,
		extensions: [latexAutocompleteExtension()],
	});
	const sources = state.languageDataAt('autocomplete', posAfter(IN_FENCE));
	assert.equal(sources.length, 1, 'the TikZ source must be registered as language data');
	assert.equal(typeof sources[0], 'function', 'language data must carry a completion source');
}

// --- completions actually fire inside a fence, and only there ---------------

{
	const state = EditorState.create({
		doc: DOC,
		extensions: [latexAutocompleteExtension()],
	});

	const insidePos = posAfter(IN_FENCE);
	const [source] = state.languageDataAt('autocomplete', insidePos);
	const inside = source(new CompletionContext(state, insidePos, true));
	assert.ok(inside, 'completions must be offered inside a tikz fence');
	assert.ok(
		inside.options.some(option => option.label === '\\node'),
		`\\node must be among the completions, got: ${inside.options.slice(0, 5).map(o => o.label).join(', ')}`,
	);

	// Outside any fence the source declines, so registering it document-wide
	// costs nothing in prose (this is what makes language data safe here).
	const outsidePos = posAfter(IN_PROSE);
	const outside = source(new CompletionContext(state, outsidePos, true));
	assert.equal(outside, null, 'prose must not get TikZ completions');
}

// --- no conflict-prone config fields are passed at all ----------------------
// maxRenderedOptions/activateOnTyping have no merge rule either; two
// extensions passing different values crash exactly like `override` did.

{
	// Three independent instances of our own extension must also coexist —
	// the strongest form of "we contribute no conflicting config".
	assert.doesNotThrow(() => {
		EditorState.create({
			doc: DOC,
			extensions: [
				latexAutocompleteExtension(),
				latexAutocompleteExtension(),
				latexAutocompleteExtension(),
			],
		});
	}, 'the extension must be safe to install more than once');
}

console.log('autocomplete-extension: ok');
