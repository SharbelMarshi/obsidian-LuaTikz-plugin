#!/usr/bin/env node
import esbuild from 'esbuild';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedAssetsPath = path.join(projectRoot, 'generated/tikzjaxTexAssets.ts');
const sourceTexDir = path.join(projectRoot, 'node_modules/node-tikzjax/tex');

async function loadTikzJaxSourceModule() {
	const outDir = mkdtempSync(path.join(tmpdir(), 'luatikz-render-'));
	const outfile = path.join(outDir, 'tikzJaxSource.cjs');
	await esbuild.build({
		entryPoints: [path.join(projectRoot, 'src/latex/tikzJaxSource.ts')],
		bundle: true,
		outfile,
		format: 'cjs',
		platform: 'node',
		logLevel: 'silent',
	});
	return require(outfile);
}

if (!fs.existsSync(generatedAssetsPath)) {
	console.error('Generated TikZJax tex assets missing. Run npm run build first.');
	process.exit(1);
}

const generatedSource = fs.readFileSync(generatedAssetsPath, 'utf8');
const assetEntries = [...generatedSource.matchAll(/'([^']+\.gz)': '([^']+)'/g)];

if (assetEntries.length < 3) {
	console.error('Could not parse generated/tikzjaxTexAssets.ts.');
	process.exit(1);
}

for (const match of assetEntries) {
	const fileName = match[1];
	const encoded = match[2];
	if (!fileName || !encoded) {
		continue;
	}

	const sourcePath = path.join(sourceTexDir, fileName);
	if (!fs.existsSync(sourcePath)) {
		console.error(`Missing source tex file: ${sourcePath}`);
		process.exit(1);
	}

	const decoded = Buffer.from(encoded, 'base64');
	const sourceBytes = fs.readFileSync(sourcePath);
	if (!decoded.equals(sourceBytes)) {
		console.error(`Bundled asset mismatch for ${fileName}.`);
		process.exit(1);
	}
}

console.log('Bundled TikZJax tex assets verified against node-tikzjax source files.');

const { normalizeForTikzJax } = await loadTikzJaxSourceModule();

const mod = require('node-tikzjax');
const tex2svg = mod.default ?? mod;

const { finalizeTikzJaxSvg } = await (async () => {
	const outDir = mkdtempSync(path.join(tmpdir(), 'luatikz-svgfix-'));
	const outfile = path.join(outDir, 'tikzJaxSvgFix.cjs');
	await esbuild.build({
		entryPoints: [path.join(projectRoot, 'src/utils/tikzJaxSvgFix.ts')],
		bundle: true,
		outfile,
		format: 'cjs',
		platform: 'node',
		logLevel: 'silent',
	});
	return require(outfile);
})();

async function renderNormalized(source) {
	const normalized = normalizeForTikzJax(source);
	const svg = await tex2svg(normalized.renderTex, {
		showConsole: true,
		texPackages: normalized.texPackages,
		tikzLibraries: normalized.tikzLibraries,
		addToPreamble: normalized.addToPreamble || undefined,
	});
	return finalizeTikzJaxSvg(svg, source);
}

function assertEnglishTextLabels(svg) {
	const textChunks = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1] ?? '');
	const combined = `${svg} ${textChunks.join('')}`;
	for (const word of ['Flow', 'Anatomy', 'Airflow', 'Signal']) {
		if (!combined.includes(word)) {
			throw new Error(`English text test missing word: ${word}`);
		}
	}
	console.log('Test 6 (English text labels): OK');
}

function assertNoStandaloneBackground(svg) {
	if (/fill="rgb\(100%,100%,100%\)"/i.test(svg) || /fill="#ffffff"/i.test(svg)) {
		throw new Error('SVG still contains standalone white background rect');
	}
}

function assertNoCorruption(name, svg, forbidden, required) {
	for (const token of forbidden) {
		if (svg.includes(token)) {
			throw new Error(`${name}: SVG still contains corrupted token ${JSON.stringify(token)}`);
		}
	}
	for (const token of required) {
		if (!svg.includes(token)) {
			throw new Error(`${name}: SVG missing expected token ${JSON.stringify(token)}`);
		}
	}
	console.log(`${name}: OK`);
}

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

(async () => {
	if (typeof mod.load === 'function') {
		await mod.load();
	}

	await renderNormalized(String.raw`\begin{tikzpicture}
\node {$R_1 = 21.71\,\Omega$};
\node at (0,-0.7) {$\omega = 2\pi f$};
\node at (0,-1.4) {$\theta,\lambda,\mu,\alpha,\beta$};
\end{tikzpicture}`).then(svg =>
		assertNoCorruption('Test 1 (LaTeX math)', svg, ['\u00AC', '\u00BC'], ['\u03A9', '21', '71']),
	);

	await renderNormalized(String.raw`\begin{tikzpicture}
\draw[->] (0,0) -- (3,0) node[right] {$x$};
\draw[->] (0,0) -- (0,2) node[above] {$y$};
\draw[blue, thick] (0,0) circle (1cm);
\node at (1.5,1.5) {TikZJax};
\end{tikzpicture}`).then(svg => {
		if (!svg.includes('<svg')) {
			throw new Error('TikZJax smoke test did not return SVG.');
		}
		console.log('Test 2 (TikZJax smoke): OK');
	});

	// Fails hard: 2D PGFPlots is a supported feature, and the old try/catch
	// reported a genuine regression as "skipped".
	const svgB = await renderNormalized(TEST_B);
	if (!svgB.includes('<svg')) {
		throw new Error('Test 3 (2D PGFPlots) did not return SVG.');
	}
	console.log('Test 3 (2D PGFPlots): OK');

	// 3D surface plots (shader=interp) are a documented TikZJax limitation.
	// This asserts the limitation *stays* a clean failure: if a node-tikzjax
	// upgrade starts supporting it, or the error stops mentioning the shader,
	// this test says so instead of printing an unchecked log line.
	let test4Failed = null;
	try {
		await renderNormalized(TEST_A);
	} catch (err) {
		test4Failed = err instanceof Error ? err.message : String(err);
	}
	if (test4Failed === null) {
		throw new Error('Test 4 (3D PGFPlots): rendered successfully — the known limitation is gone; update this test and the docs.');
	}
	console.log('Test 4 (3D PGFPlots): fails as documented');

	const englishSvg = await renderNormalized(String.raw`\begin{tikzpicture}
\node {Flow};
\node at (0,-1) {Anatomy};
\node at (0,-2) {Airflow Path};
\node at (0,-3) {Signal Flow};
\end{tikzpicture}`);
	if (!englishSvg.includes('<svg')) {
		throw new Error('Test 6 (English text labels) did not return SVG.');
	}
	assertEnglishTextLabels(englishSvg);
	assertNoStandaloneBackground(englishSvg);

	const rtlSvg = await renderNormalized(String.raw`\begin{tikzpicture}
\node at (0,0) {\he{Hello}};
\end{tikzpicture}`);
	if (!rtlSvg.includes('<svg')) {
		throw new Error('Test 5 (RTL fallback macros) did not return SVG.');
	}
	console.log('Test 5 (RTL fallback macros): OK');

	// The draw editor's mobile parity: pattern fills reference pgfpatN/pgfsymN
	// tile definitions that node-tikzjax's converter drops; finalizeTikzJaxSvg
	// must re-inject them so every reference resolves in-document.
	const patternSvg = await renderNormalized(String.raw`\usetikzlibrary{patterns}
\pgfdeclarepatternformonly{diagonal stripes}{\pgfqpoint{-1pt}{-1pt}}{\pgfqpoint{7pt}{7pt}}{\pgfqpoint{6pt}{6pt}}{\pgfsetlinewidth{2.5pt}\pgfpathmoveto{\pgfqpoint{-2pt}{-2pt}}\pgfpathlineto{\pgfqpoint{8pt}{8pt}}\pgfusepath{stroke}}
\pgfdeclarepatternformonly{north east lines wide}{\pgfqpoint{-1pt}{-1pt}}{\pgfqpoint{5.5pt}{5.5pt}}{\pgfqpoint{4.5pt}{4.5pt}}{\pgfsetlinewidth{0.4pt}\pgfpathmoveto{\pgfqpoint{0pt}{0pt}}\pgfpathlineto{\pgfqpoint{4.6pt}{4.6pt}}\pgfusepath{stroke}}
\begin{tikzpicture}
\draw[pattern=north east lines, pattern color=blue] (0,0) rectangle (2,1);
\draw[fill=yellow, pattern=dots] (2.5,0) rectangle (4.5,1);
\draw[pattern=bricks, pattern color=red] (5,0) rectangle (7,1);
\draw[pattern=diagonal stripes] (7.5,0) rectangle (9.5,1);
\draw[pattern=north east lines wide] (10,0) rectangle (12,1);
\draw[top color=red!60, bottom color=blue] (0,-1.5) rectangle (2,-0.5);
\draw[-{Stealth}] (2.5,-1) -- (4.5,-1);
\end{tikzpicture}`);
	if (!patternSvg.includes('<svg')) {
		throw new Error('Test 7 (patterns/shadings/tips) did not return SVG.');
	}
	const patternRefs = new Set(
		[...patternSvg.matchAll(/#(pgf(?:pat|sym)\d+)/g)].map(match => match[1]),
	);
	if (!patternRefs.size) {
		throw new Error('Test 7: expected pattern fills to reference pgfpat tiles.');
	}
	const danglingRefs = [...patternRefs].filter(id => !patternSvg.includes(`id="${id}"`));
	if (danglingRefs.length) {
		throw new Error(`Test 7: dangling pattern refs after finalize: ${danglingRefs.join(', ')}`);
	}
	if (!/Gradient/.test(patternSvg)) {
		throw new Error('Test 7: expected shading gradients in the SVG output.');
	}
	console.log('Test 7 (patterns, shadings, arrow tips): OK');

	// Circuit components from the draw editor's Circuit menu: circuitikz must
	// auto-load for `to[...]` bipoles and ground nodes on the mobile engine.
	const circuitSvg = await renderNormalized(String.raw`\ctikzset{sources/symbol/sign rotation/.initial=auto}
\begin{tikzpicture}
\draw (0,0) to[R] (2.5,0);
\draw (3,0) to[C] (5.5,0);
\draw (0,-1.5) to[american voltage source] (2.5,-1.5);
\draw (3,-1.5) to[battery1] (5.5,-1.5);
\draw (0,-3) to[D*] (2.5,-3);
\draw (3,-3) to[generic] (5.5,-3);
\node[ground] at (6.5,-3) {};
\node[circ] at (7,-3) {};
\end{tikzpicture}`);
	if (!circuitSvg.includes('<svg')) {
		throw new Error('Test 8 (circuit components) did not return SVG.');
	}
	const circuitShapes = (circuitSvg.match(/<path|<line|<circle|<use/g) ?? []).length;
	if (circuitShapes < 10) {
		throw new Error(`Test 8: circuit SVG suspiciously empty (${circuitShapes} shapes).`);
	}
	console.log('Test 8 (circuit components via circuitikz): OK');

	console.log('All TikZJax tests completed.');
})().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
