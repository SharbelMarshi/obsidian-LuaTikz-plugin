#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedAssetsPath = path.join(projectRoot, 'generated/tikzjaxTexAssets.ts');
const sourceTexDir = path.join(projectRoot, 'node_modules/node-tikzjax/tex');

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

const mod = require('node-tikzjax');
const tex2svg = mod.default ?? mod;

const texPackages = {
	tikz: '',
	amsmath: '',
	amsfonts: '',
	amssymb: '',
};

const tikzLibraries =
	'arrows.meta,positioning,calc,decorations.pathmorphing,decorations.pathreplacing,patterns,shapes.geometric,circuits.logic.US';

function normalizeUnicodeForTikzJax(source) {
	return source
		.replace(/\u2212/g, '-')
		.replace(/\u00D7/g, '\\times ')
		.replace(/\u00B7/g, '\\cdot ')
		.replace(/\u03A9/g, '\\Omega ')
		.replace(/\u2126/g, '\\Omega ')
		.replace(/\u03C9/g, '\\omega ')
		.replace(/\u03BC/g, '\\mu ')
		.replace(/\u03C0/g, '\\pi ')
		.replace(/\u03B1/g, '\\alpha ')
		.replace(/\u03B2/g, '\\beta ')
		.replace(/\u03B3/g, '\\gamma ')
		.replace(/\u03B4/g, '\\delta ')
		.replace(/\u03B8/g, '\\theta ')
		.replace(/\u03BB/g, '\\lambda ')
		.replace(/\u03C3/g, '\\sigma ')
		.replace(/\\ohm\b/g, '\\Omega ');
}

function wrapTikzJaxBody(body) {
	return ['\\begin{document}', body, '\\end{document}'].join('\n');
}

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

async function renderSource(source) {
	const body = source.includes('\\begin{tikzpicture}')
		? source
		: `\\begin{tikzpicture}\n${source}\n\\end{tikzpicture}`;
	const input = wrapTikzJaxBody(body);
	const svg = await tex2svg(input, { showConsole: false, texPackages, tikzLibraries });
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

(async () => {
	if (typeof mod.load === 'function') {
		await mod.load();
	}

	const omegaTest = String.raw`$R_1 = 21.71\,\Omega$`;
	const normalized = wrapTikzJaxBody(
		`\\begin{tikzpicture}\\node {${omegaTest}};\\end{tikzpicture}`,
	);
	if (!normalized.includes('\\Omega')) {
		throw new Error('TikZJax normalization corrupted \\Omega.');
	}

	await renderSource(String.raw`\begin{tikzpicture}
\node {$R_1 = 21.71\,\Omega$};
\node at (0,-0.7) {$\omega = 2\pi f$};
\node at (0,-1.4) {$\theta,\lambda,\mu,\alpha,\beta$};
\end{tikzpicture}`).then(svg =>
		assertNoCorruption('Test 1 (LaTeX math)', svg, ['\u00AC', '\u00BC'], ['\u03A9', '21', '71']),
	);

	const unicodeSource = normalizeUnicodeForTikzJax([
		'\\begin{tikzpicture}',
		'\\node {$R = 10\u2126$};',
		'\\node at (0,-0.7) {$\\omega = 2\u03C0f$};',
		'\\end{tikzpicture}',
	].join('\n'));
	if (!unicodeSource.includes('\\Omega') || !unicodeSource.includes('\\pi')) {
		throw new Error('Unicode sanitizer failed.');
	}
	await renderSource(unicodeSource).then(svg =>
		assertNoCorruption('Test 2 (Unicode input)', svg, ['\u00AC'], ['\u03A9']),
	);

	await renderSource(String.raw`\begin{tikzpicture}
\draw (0,0) to node[above] {$R_1=21.71\,\Omega$} (3,0);
\end{tikzpicture}`).then(svg =>
		assertNoCorruption('Test 3 (edge label)', svg, ['\u00AC'], ['\u03A9']),
	);

	await renderSource(String.raw`\begin{tikzpicture}
\draw[->] (0,0) -- (3,0) node[right] {$x$};
\draw[->] (0,0) -- (0,2) node[above] {$y$};
\draw[blue, thick] (0,0) circle (1cm);
\node at (1.5,1.5) {TikZJax bundled};
\end{tikzpicture}`).then(svg => {
		if (!svg.includes('<svg')) {
			throw new Error('Bundled TikZJax smoke test did not return SVG.');
		}
		console.log('Test 4 (bundled smoke): OK');
	});

	console.log('All TikZJax symbol tests passed.');
})().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
