#!/usr/bin/env node
import esbuild from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadTikzJaxSourceModule() {
	const outDir = mkdtempSync(path.join(tmpdir(), 'luatikz-norm-'));
	const outfile = path.join(outDir, 'tikzJaxSource.cjs');
	await esbuild.build({
		entryPoints: [path.join(projectRoot, 'tikzJaxSource.ts')],
		bundle: true,
		outfile,
		format: 'cjs',
		platform: 'node',
		logLevel: 'silent',
	});
	return require(outfile);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const TEST_A = String.raw`\pgfplotsset{compat=1.18}
\begin{tikzpicture}
\begin{axis}[
width=12cm,
height=8cm,
view={45}{28},
xlabel={$x$},
ylabel={$t$},
zlabel={$u(x,t)$},
domain=0:1,
y domain=0:2,
samples=45,
samples y=35,
colormap/viridis,
mesh/ordering=y varies,
title={Solution of the 1D Heat Equation},
zmin=0,
grid=major
]
\addplot3[
surf,
shader=interp,
]
{exp(-pi^2*y)*sin(deg(pi*x)) + 0.35*exp(-9*pi^2*y)*sin(deg(3*pi*x))};
\end{axis}
\end{tikzpicture}`;

const TEST_B = String.raw`\begin{tikzpicture}
\begin{axis}[
width=12cm,
height=6.5cm,
xlabel={Time},
ylabel={Amplitude},
xmin=0, xmax=6.28,
ymin=-1.6, ymax=1.6,
grid=major,
title={Chord as a Sum of Sine Waves}
]
\addplot[very thick, domain=0:6.28, samples=260]
{0.75*sin(deg(2*x)) + 0.45*sin(deg(2.5*x)) + 0.32*sin(deg(3*x))};
\addplot[dashed, domain=0:6.28, samples=160]
{0.75*sin(deg(2*x))};
\addplot[dotted, domain=0:6.28, samples=160]
{0.45*sin(deg(2.5*x))};
\node[anchor=west] at (axis cs:0.4,1.25) {$C + E + G$};
\end{axis}
\node[align=center] at (6,-1.2) {
A musical chord can be visualized as constructive and destructive interference.
};
\end{tikzpicture}`;

const { normalizeForTikzJax, isAdvancedPgfplotsDiagram } = await loadTikzJaxSourceModule();

const libraryInput = String.raw`\usetikzlibrary{arrows.meta, calc}
\begin{tikzpicture}
\draw[->] (0,0) -- (1,0);
\end{tikzpicture}`;

const libraryNorm = normalizeForTikzJax(libraryInput);
assert(libraryNorm.tex.startsWith('\\documentclass{standalone}'), 'library test must start with documentclass');
assert(!libraryNorm.tex.includes('\\usepackage{pgfplots}'), 'library-only test should not include pgfplots');
assert(!/\\begin\{document\}[\s\S]*\\usetikzlibrary/.test(libraryNorm.tex), 'usetikzlibrary must not remain in document body');
assert(libraryNorm.tex.includes('\\usetikzlibrary{arrows.meta, calc'), 'user libraries must be preserved');

const normA = normalizeForTikzJax(TEST_A);
assert(normA.tex.startsWith('\\documentclass{standalone}'), 'Test A must start with documentclass');
assert(normA.tex.includes('\\usepackage{pgfplots}'), 'Test A must include pgfplots');
assert(normA.tex.indexOf('\\usepackage{pgfplots}') < normA.tex.indexOf('\\begin{document}'), 'pgfplots must be in preamble');
assert(normA.tex.includes('\\pgfplotsset{compat=1.16}'), 'Test A must clamp pgfplots compat to 1.16 for TikZJax');
assert(!normA.tex.includes('compat=1.18'), 'Test A must not keep compat=1.18 in TikZJax output');
assert(normA.usesPgfplots, 'Test A must flag pgfplots usage');
assert(normA.isAdvancedPgfplots, 'Test A must flag advanced pgfplots');
assert(isAdvancedPgfplotsDiagram(TEST_A), 'Test A advanced detector');

const normB = normalizeForTikzJax(TEST_B);
assert(normB.tex.startsWith('\\documentclass{standalone}'), 'Test B must start with documentclass');
assert(normB.tex.includes('\\usepackage{pgfplots}'), 'Test B must include pgfplots');
assert(normB.usesPgfplots, 'Test B must flag pgfplots usage');
assert(!normB.isAdvancedPgfplots, 'Test B must not flag advanced pgfplots');

console.log('TikZJax normalization tests passed.');
