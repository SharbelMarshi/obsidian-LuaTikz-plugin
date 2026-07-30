import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { Text } from '@codemirror/state';

const outDir = mkdtempSync(join(tmpdir(), 'luatikz-fence-'));
const outFile = join(outDir, 'tikzFenceStarter.mjs');
buildSync({
	entryPoints: ['src/editor/tikzFenceStarter.ts'],
	bundle: true,
	format: 'esm',
	outfile: outFile,
	logLevel: 'silent',
});
const { findStarterLine } = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

/**
 * Replay pressing Enter: `before` is the doc, `insert` goes in at `at`, and the
 * result is the changed range the update listener sees.
 */
function afterInsert(before, at, insert) {
	const doc = Text.of(`${before.slice(0, at)}${insert}${before.slice(at)}`.split('\n'));
	return { doc, fromB: at, toB: at + insert.length };
}

// Obsidian auto-closes the fence, so Enter is pressed with ``` already below.
{
	const { doc, fromB, toB } = afterInsert('```tikz\n```', 7, '\n');
	assert.equal(findStarterLine(doc, fromB, toB), 2, 'blank line between fences');
}

// Same for the luatikz alias, and with an info string after the language.
{
	const { doc, fromB, toB } = afterInsert('```luatikz center\n```', 17, '\n');
	assert.equal(findStarterLine(doc, fromB, toB), 2);
}

// No auto-close: the fence line is the last line in the note.
{
	const { doc, fromB, toB } = afterInsert('```tikz', 7, '\n');
	assert.equal(findStarterLine(doc, fromB, toB), 2, 'fence at end of doc');
}

// Some setups insert the newline and the closing fence in one change.
{
	const { doc, fromB, toB } = afterInsert('```tikz', 7, '\n\n```');
	assert.equal(findStarterLine(doc, fromB, toB), 2, 'multi-line insertion');
}

// Fence in the middle of a note, with text following the block.
{
	const before = 'intro\n```tikz\n```\noutro';
	const { doc, fromB, toB } = afterInsert(before, 13, '\n');
	assert.equal(findStarterLine(doc, fromB, toB), 3);
}

// Never fires for a fence that already has a body.
{
	const before = '```tikz\n\\draw (0,0) -- (1,1);\n```';

	const opened = afterInsert(before, 7, '\n');
	assert.equal(findStarterLine(opened.doc, opened.fromB, opened.toB), null, 'body follows');

	const inside = afterInsert(before, 28, '\n');
	assert.equal(findStarterLine(inside.doc, inside.fromB, inside.toB), null, 'inside the body');
}

// Other languages are left alone.
{
	const { doc, fromB, toB } = afterInsert('```python\n```', 9, '\n');
	assert.equal(findStarterLine(doc, fromB, toB), null);
}

// A newline elsewhere in the note is not a fence opening.
{
	const { doc, fromB, toB } = afterInsert('hello world', 5, '\n');
	assert.equal(findStarterLine(doc, fromB, toB), null);
}

// The starter body this inserts must not re-trigger the listener.
{
	const before = '```tikz\n\\begin{tikzpicture}\n\n\\end{tikzpicture}\n```';
	const doc = Text.of(before.split('\n'));
	assert.equal(findStarterLine(doc, 8, before.length), null, 'no insertion loop');
}

console.log('fence-starter: fixtures OK');
