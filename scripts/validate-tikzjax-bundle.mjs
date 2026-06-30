#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredFiles = [
	'main.js',
	'tikzjax.js',
	'manifest.json',
	'styles.css',
	'generated/tikzjaxTexAssets.ts',
	'tikzjax-tex/.luatikz-tex-hash',
	'tikzjax-tex/core.dump.gz',
	'tikzjax-tex/tex.wasm.gz',
	'tikzjax-tex/tex_files.tar.gz',
];

let failed = false;

for (const item of requiredFiles) {
	const filePath = path.join(projectRoot, item);
	if (!fs.existsSync(filePath)) {
		console.error(`Missing required build artifact: ${item}`);
		failed = true;
	}
}

const mainJsPath = path.join(projectRoot, 'main.js');
if (fs.existsSync(mainJsPath)) {
	const mainJs = fs.readFileSync(mainJsPath, 'utf8');
	const markers = [
		'__LUATIKZ_TEX_DIR',
		'tex2svg',
	];
	for (const marker of markers) {
		if (!mainJs.includes(marker)) {
			console.error(`main.js is missing bundled plugin marker: ${marker}`);
			failed = true;
		}
	}

	if (mainJs.includes('TIKZJAX_TEX_ASSETS_BASE64')) {
		console.error('main.js still inlines TikZJax TeX assets. Split runtime assets out of main.js.');
		failed = true;
	}

	const sizeMb = fs.statSync(mainJsPath).size / (1024 * 1024);
	if (sizeMb >= 5) {
		console.error(`main.js must be smaller than 5 MB (current: ${sizeMb.toFixed(2)} MB).`);
		failed = true;
	}
}

const tikzjaxJsPath = path.join(projectRoot, 'tikzjax.js');
if (fs.existsSync(tikzjaxJsPath)) {
	const sizeMb = fs.statSync(tikzjaxJsPath).size / (1024 * 1024);
	if (sizeMb >= 5) {
		console.error(`tikzjax.js must be smaller than 5 MB (current: ${sizeMb.toFixed(2)} MB).`);
		failed = true;
	}
}

if (failed) {
	process.exit(1);
}

console.log('Bundled TikZJax build artifacts verified.');
