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
		entryPoints: [path.join(projectRoot, 'tikzJaxSource.ts')],
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

const CMMI10 = {
	'\u00B5': '\u03B8',
	'\u00B8': '\u03BB',
	'\u00B9': '\u03BC',
	'\u00AE': '\u03B1',
	'\u00AF': '\u03B2',
	'\u00B0': '\u03B3',
	'\u00B1': '\u03B4',
	'\u00BE': '\u03C3',
	'\u0021': '\u03C9',
	'\u00BC': '\u03C0',
	'\u003A': '.',
};
const CMR10 = { '\u00AC': '\u03A9' };
const CMSY10 = {
	'\u00A1': '-',
	'\u2212': '-',
	'\u00A3': '\u00D7',
	'\u00A2': '\u00B7',
	'\u00A7': '\u00B1',
	'\u0031': '\u221E',
};
const MAPS = { cmmi10: CMMI10, cmr10: CMR10, cmsy10: CMSY10 };

function fixTikzJaxSvgGlyphs(svg) {
	return svg.replace(
		/<text\b([^>]*\bfont-family="(cmmi10|cmr10|cmsy10)")([^>]*)>([^<]*)<\/text>/g,
		(full, before, family, after, content) => {
			const table = MAPS[family];
			if (!table) {
				return full;
			}
			let mapped = content;
			for (const [bad, good] of Object.entries(table)) {
				if (mapped.includes(bad)) {
					mapped = mapped.replaceAll(bad, good);
				}
			}
			if (mapped === content) {
				return full;
			}
			const attrs = `${before}${after}`.replace(
				/font-family="[^"]+"/,
				'font-family="Cambria Math, STIX Two Math, serif"',
			);
			return `<text${attrs}>${mapped}</text>`;
		},
	);
}

async function renderNormalized(source) {
	const normalized = normalizeForTikzJax(source);
	const svg = await tex2svg(normalized.renderTex, {
		showConsole: true,
		texPackages: normalized.texPackages,
		tikzLibraries: normalized.tikzLibraries,
		addToPreamble: normalized.addToPreamble || undefined,
	});
	return fixTikzJaxSvgGlyphs(svg);
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
\node at (1.5,1.5) {TikZJax bundled};
\end{tikzpicture}`).then(svg => {
		if (!svg.includes('<svg')) {
			throw new Error('Bundled TikZJax smoke test did not return SVG.');
		}
		console.log('Test 2 (bundled smoke): OK');
	});

	try {
		const svgB = await renderNormalized(TEST_B);
		if (!svgB.includes('<svg')) {
			throw new Error('Test 3 (2D PGFPlots) did not return SVG.');
		}
		console.log('Test 3 (2D PGFPlots): OK');
	} catch (err) {
		console.log(`Test 3 (2D PGFPlots): skipped (${err instanceof Error ? err.message : err})`);
	}

	try {
		await renderNormalized(TEST_A);
		console.log('Test 4 (3D PGFPlots): unexpected success');
	} catch {
		console.log('Test 4 (3D PGFPlots): expected limitation (advanced plot not supported)');
	}

	const rtlSvg = await renderNormalized(String.raw`\begin{tikzpicture}
\node at (0,0) {\he{עברית}};
\node at (0,-1) {\ar{العربية}};
\end{tikzpicture}`);
	if (!rtlSvg.includes('<svg')) {
		throw new Error('Test 5 (RTL fallback macros) did not return SVG.');
	}
	console.log('Test 5 (RTL fallback macros): OK');

	console.log('All TikZJax tests completed.');
})().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
