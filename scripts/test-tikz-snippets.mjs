import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/latex/tikzSnippets.ts', 'utf8');
const catalogSection = source.split('TIKZ_TEMPLATE_CATALOG')[0];
const bodies = [
	...catalogSection.matchAll(/body:\s*'((?:\\.|[^'\\])*)'/g),
].map(m => m[1]);

assert.ok(bodies.length >= 20, `expected >= 20 snippet bodies, got ${bodies.length}`);

let failed = 0;
for (const body of bodies) {
	if (!body.includes('${')) {
		console.error('Missing tab stop in snippet body:', body.slice(0, 40));
		failed++;
	}
}

console.log(`tikz-snippets: ${bodies.length} catalog bodies OK`);
process.exit(failed > 0 ? 1 : 0);
