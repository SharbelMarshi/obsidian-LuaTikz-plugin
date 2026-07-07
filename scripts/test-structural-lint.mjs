import assert from 'node:assert/strict';

const BEGIN_ENV_RE = /\\begin\{([^}]+)\}/g;
const END_ENV_RE = /\\end\{([^}]+)\}/g;

function lintBlock(source) {
	const diagnostics = [];
	const envStack = [];

	for (const match of source.matchAll(BEGIN_ENV_RE)) {
		envStack.push(match[1]);
	}
	for (const match of source.matchAll(END_ENV_RE)) {
		const env = match[1];
		const idx = envStack.lastIndexOf(env);
		if (idx === -1) {
			diagnostics.push(`unmatched end:${env}`);
		} else {
			envStack.splice(idx, 1);
		}
	}
	for (const env of envStack) {
		diagnostics.push(`unclosed:${env}`);
	}
	return diagnostics;
}

const good = String.raw`\begin{tikzpicture}
\begin{scope}
\end{scope}
\end{tikzpicture}`;

assert.deepEqual(lintBlock(good), []);

const bad = String.raw`\begin{tikzpicture}
\begin{scope}
\end{tikzpicture}`;

assert.ok(lintBlock(bad).includes('unclosed:scope'));

console.log('structural-lint: fixtures OK');
