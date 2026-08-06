/**
 * Snippet and template catalogs, imported as values from the real src module.
 *
 * The previous version read the file as *text* and regex-scraped `body:`
 * literals; its `split('TIKZ_TEMPLATE_CATALOG')[0]` silently dropped the six
 * template bodies, its only assertion was `body.includes('${')`, and it
 * printed its "OK" line before checking the failure count.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { snippets } = await loadSrcModules({ snippets: 'src/latex/tikzSnippets.ts' });
const { TIKZ_SNIPPET_CATALOG, TIKZ_TEMPLATE_CATALOG, COMMAND_LIBRARY_MAP, CATEGORY_PICKER } = snippets;

function balanced(body, open, close) {
	let depth = 0;
	let escaped = false;
	for (const ch of body) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			escaped = true;
			continue;
		}
		if (ch === open) depth++;
		if (ch === close) depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
}

function environmentsMatch(body) {
	const stack = [];
	for (const match of body.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
		if (match[1] === 'begin') {
			stack.push(match[2]);
		} else if (stack.pop() !== match[2]) {
			return false;
		}
	}
	return stack.length === 0;
}

// --- snippet catalog --------------------------------------------------------

assert.ok(TIKZ_SNIPPET_CATALOG.length >= 20, `expected >= 20 snippets, got ${TIKZ_SNIPPET_CATALOG.length}`);

const snippetLabels = new Set();
for (const entry of TIKZ_SNIPPET_CATALOG) {
	const where = `snippet ${JSON.stringify(entry.label)}`;
	assert.ok(entry.label?.trim(), 'snippet without a label');
	assert.ok(!snippetLabels.has(entry.label), `duplicate label: ${entry.label}`);
	snippetLabels.add(entry.label);
	assert.ok(entry.body?.trim(), `${where}: empty body`);
	assert.ok(entry.body.includes('${'), `${where}: no tab stop`);
	assert.ok(balanced(entry.body, '{', '}'), `${where}: unbalanced braces`);
	assert.ok(balanced(entry.body, '[', ']'), `${where}: unbalanced brackets`);
	assert.ok(environmentsMatch(entry.body), `${where}: mismatched \\begin/\\end`);
}

// --- template catalog (the six entries the old test silently skipped) -------

assert.ok(TIKZ_TEMPLATE_CATALOG.length >= 4, `expected >= 4 templates, got ${TIKZ_TEMPLATE_CATALOG.length}`);

const templateIds = new Set();
for (const template of TIKZ_TEMPLATE_CATALOG) {
	const where = `template ${JSON.stringify(template.id)}`;
	assert.ok(template.id?.trim() && template.name?.trim(), 'template without id/name');
	assert.ok(!templateIds.has(template.id), `duplicate template id: ${template.id}`);
	templateIds.add(template.id);
	assert.ok(template.body?.trim(), `${where}: empty body`);
	assert.ok(balanced(template.body, '{', '}'), `${where}: unbalanced braces`);
	assert.ok(environmentsMatch(template.body), `${where}: mismatched \\begin/\\end`);
}

// The command palette inserts these ids directly; a typo means a silent no-op.
for (const id of ['blank-tikzpicture', 'flowchart-3', 'empty-axis', 'logic-circuit']) {
	assert.ok(templateIds.has(id), `template id referenced by a command is missing: ${id}`);
}

// --- library map and categories ---------------------------------------------

for (const [command, libraries] of Object.entries(COMMAND_LIBRARY_MAP)) {
	assert.ok(Array.isArray(libraries) && libraries.length > 0, `no libraries for ${command}`);
}

// The picker is a curated subset of categories; every entry it offers must
// resolve to at least one snippet, or the modal shows an empty list.
const usedCategories = new Set(TIKZ_SNIPPET_CATALOG.map(entry => entry.category));
for (const entry of CATEGORY_PICKER) {
	assert.ok(usedCategories.has(entry.id), `category picker offers ${entry.id} but no snippet has it`);
}
for (const entry of TIKZ_SNIPPET_CATALOG) {
	assert.ok(typeof entry.category === 'string' && entry.category.length > 0,
		`snippet ${entry.label} has no category`);
}

console.log(`tikz-snippets: ${TIKZ_SNIPPET_CATALOG.length} snippets + ${TIKZ_TEMPLATE_CATALOG.length} templates OK`);
