import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against decorations that render invisibly.
 *
 * EditorView.baseTheme prefixes each selector with the base theme class, and
 * that class sits on the *same* element as .cm-editor. So a natural-looking
 * ".cm-editor .cm-line.foo" becomes ".ͼ1 .cm-editor .cm-line.foo", which needs
 * a .cm-editor nested inside the editor root — there isn't one, and the rule
 * silently never matches. Bare selectors (".cm-line.foo") are fine, as is
 * anything anchored with "&".
 */
const EDITOR_DIR = 'src/editor';
const DECORATION_CLASS_RE = /Decoration\.(?:line|mark)\(\{\s*class:\s*'([^']+)'/g;
const THEME_SELECTOR_RE = /^\s*'([^']+)':\s*\{/gm;

const styles = readFileSync('styles.css', 'utf8');
const sources = readdirSync(EDITOR_DIR)
	.filter(file => file.endsWith('.ts'))
	.map(file => ({ file, text: readFileSync(join(EDITOR_DIR, file), 'utf8') }));

/** A baseTheme selector that CodeMirror's prefixing will make unmatchable. */
function isDeadThemeSelector(selector) {
	const index = selector.indexOf('.cm-editor');
	if (index === -1) {
		return false;
	}
	// "&.cm-editor ..." resolves onto the root itself, so it still matches.
	return selector[index - 1] !== '&';
}

for (const { file, text } of sources) {
	for (const match of text.matchAll(THEME_SELECTOR_RE)) {
		assert.ok(
			!isDeadThemeSelector(match[1]),
			`${file}: baseTheme selector "${match[1]}" can never match — the base theme `
			+ 'class is on the same element as .cm-editor. Use a bare selector, prefix '
			+ 'with "&", or move the rule to styles.css.',
		);
	}
}

const classes = [];
for (const { file, text } of sources) {
	for (const match of text.matchAll(DECORATION_CLASS_RE)) {
		for (const className of match[1].split(/\s+/).filter(Boolean)) {
			classes.push({ className, file, text });
		}
	}
}

assert.ok(classes.length >= 3, `expected to find decoration classes, got ${classes.length}`);

for (const { className, file, text } of classes) {
	const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const styled = new RegExp(`\\.${escaped}\\b[^{]*\\{`).test(styles)
		|| new RegExp(`'[^']*\\.${escaped}\\b[^']*':\\s*\\{`).test(text);
	assert.ok(
		styled,
		`${file} decorates with .${className}, but neither styles.css nor its own `
		+ 'baseTheme has a rule for it — the decoration would be invisible.',
	);
}

console.log(`decoration-styles: ${classes.length} decoration classes styled OK`);
