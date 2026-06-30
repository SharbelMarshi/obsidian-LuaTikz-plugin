#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredFiles = [
	'generated/tikzjaxTexAssets.ts',
	'main.js',
	'manifest.json',
	'styles.css',
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
		'TIKZJAX_TEX_ASSETS_BASE64',
		'__LUATIKZ_TEX_DIR',
		'tex2svg',
	];
	for (const marker of markers) {
		if (!mainJs.includes(marker)) {
			console.error(`main.js is missing bundled TikZJax marker: ${marker}`);
			failed = true;
		}
	}

	const sizeMb = fs.statSync(mainJsPath).size / (1024 * 1024);
	if (sizeMb < 5) {
		console.error(`main.js looks too small for bundled TikZJax (${sizeMb.toFixed(2)} MB).`);
		failed = true;
	}
}

if (failed) {
	process.exit(1);
}

console.log('Bundled TikZJax build artifacts verified.');
