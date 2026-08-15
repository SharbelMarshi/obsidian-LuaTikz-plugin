/**
 * Editor extensions must survive being installed into an ALREADY-OPEN editor.
 *
 * The regression this pins: `tikzHoverHighlight` used to be two StateFields,
 * where the decorations field read the range field through
 * `tr.startState.field(...)`. Obsidian installs plugin extensions into open
 * editors by dispatching a reconfiguration (`StateEffect.appendConfig`), and
 * in that transaction `startState` predates the plugin — so the lookup threw
 *
 *     RangeError: Field is not present in this state
 *
 * inside `registerEditorExtension` → `updateOptions()` → `dispatchTransactions`,
 * which Obsidian reports as LuaTikZ failing to load entirely. Creating a state
 * with the extensions already present (a fresh editor) did NOT reproduce it,
 * which is why it only bit users who had notes open when the plugin loaded.
 *
 * These tests exercise the whole registered extension set, so any future
 * extension with the same cross-field hazard fails here instead of in Obsidian.
 */
import assert from 'node:assert/strict';
import { loadSrcModules, OBSIDIAN_STUB } from './loadSrc.mjs';

const CM_EXTERNALS = [
	'@codemirror/state',
	'@codemirror/view',
	'@codemirror/autocomplete',
	'@codemirror/lint',
	'@codemirror/commands',
];

const mods = await loadSrcModules(
	{
		autocomplete: 'src/editor/latexAutocomplete.ts',
		ide: 'src/editor/tikzIdeGutter.ts',
		errorHighlight: 'src/editor/tikzErrorHighlight.ts',
		hoverHighlight: 'src/editor/tikzHoverHighlight.ts',
		fenceStarter: 'src/editor/tikzFenceStarter.ts',
		structuralLint: 'src/editor/tikzStructuralLint.ts',
		semicolonReminder: 'src/editor/tikzSemicolonReminder.ts',
		autoClose: 'src/editor/tikzAutoClose.ts',
		drawStarter: 'src/editor/tikzDrawStarterSemicolon.ts',
		ccycle: 'src/editor/tikzCcycleExtension.ts',
	},
	{ external: CM_EXTERNALS, stubs: { obsidian: OBSIDIAN_STUB } },
);

const { EditorState, StateEffect } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');

// Mirrors main.ts's registerEditorExtension([...]) call site.
const allEditorExtensions = () => [
	mods.autocomplete.latexAutocompleteExtension(),
	mods.ide.tikzIdeExtension(),
	...mods.errorHighlight.tikzErrorHighlightExtension(),
	...mods.hoverHighlight.tikzHoverHighlightExtension(),
	mods.fenceStarter.tikzFenceStarterExtension(() => true),
	mods.structuralLint.tikzStructuralLintExtension(() => true),
	mods.semicolonReminder.tikzSemicolonReminderExtension(() => 'hint'),
	mods.autoClose.tikzAutoCloseExtension(() => true),
	mods.drawStarter.tikzDrawStarterSemicolonExtension(),
	mods.ccycle.tikzCcycleExtension(),
];

const DOC = [
	'Some prose.',
	'',
	'```tikz',
	'\\draw (0,0) -- (1,1);',
	'```',
	'',
].join('\n');

const edit = state => state.update({ changes: { from: 0, insert: 'x' } }).state;

// --- the reported crash: plugin loads while a note is already open ----------

{
	// An editor that exists before the plugin loads.
	const before = EditorState.create({ doc: DOC });

	// registerEditorExtension → updateOptions() reconfigures it. This threw.
	let after;
	assert.doesNotThrow(() => {
		after = before.update({
			effects: StateEffect.appendConfig.of(allEditorExtensions()),
		}).state;
	}, 'installing the extensions into an open editor must not throw');

	// …and the editor must keep working afterwards.
	assert.doesNotThrow(() => edit(after), 'editing after the install must not throw');
}

// --- a fresh editor created with the extensions already present ------------

{
	let state;
	assert.doesNotThrow(() => {
		state = EditorState.create({ doc: DOC, extensions: allEditorExtensions() });
	}, 'creating an editor with the extensions must not throw');
	assert.doesNotThrow(() => edit(state), 'editing a freshly configured editor must not throw');
}

// --- install and edit in the SAME transaction ------------------------------

{
	const before = EditorState.create({ doc: DOC });
	assert.doesNotThrow(() => {
		before.update({
			effects: StateEffect.appendConfig.of(allEditorExtensions()),
			changes: { from: 0, insert: 'x' },
		}).state;
	}, 'a reconfigure carrying a doc change must not throw');
}

// --- disable then re-enable the plugin ------------------------------------

{
	const state = EditorState.create({ doc: DOC, extensions: allEditorExtensions() });
	assert.doesNotThrow(() => {
		const off = state.update({ effects: StateEffect.reconfigure.of([]) }).state;
		const on = off.update({ effects: StateEffect.appendConfig.of(allEditorExtensions()) }).state;
		edit(on);
	}, 'unload/reload of the plugin must not throw');
}

// --- hover highlight still behaves ----------------------------------------

{
	const { setTikzHoverHighlight } = mods.hoverHighlight;
	const state = EditorState.create({ doc: DOC, extensions: allEditorExtensions() });

	// The field provides decorations through the EditorView.decorations facet;
	// read them back off the facet, which needs no DOM. Function-valued inputs
	// are view plugins we cannot evaluate headlessly and are skipped.
	const decorationCount = s => {
		let count = 0;
		for (const source of s.facet(EditorView.decorations)) {
			if (typeof source === 'function') {
				continue;
			}
			source.between(0, s.doc.length, () => { count++; });
		}
		return count;
	};

	const highlighted = state.update({
		effects: setTikzHoverHighlight.of({ fromLine: 3, toLine: 4 }),
	}).state;
	assert.ok(decorationCount(highlighted) >= 2, 'hovering must decorate the statement lines');

	// An edit clears a stale hover range so it cannot linger over moved text.
	const edited = highlighted.update({ changes: { from: 0, insert: 'x' } }).state;
	assert.equal(decorationCount(edited), 0, 'an edit must clear the hover highlight');

	// A redundant clear is a no-op rather than a crash.
	assert.doesNotThrow(() => {
		edited.update({ effects: setTikzHoverHighlight.of(null) }).state;
	});
}

console.log('editor-extension-lifecycle: ok');
