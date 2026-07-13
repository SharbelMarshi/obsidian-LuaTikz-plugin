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
	const sizeMb = fs.statSync(mainJsPath).size / (1024 * 1024);

	if (!mainJs.includes('__LUATIKZ_TEX_ASSET_BASE64')) {
		console.error('main.js is missing the bundled TikZJax asset hook marker: __LUATIKZ_TEX_ASSET_BASE64');
		failed = true;
	}

	// These would crash mobile Obsidian (no Node runtime) if the TikZJax
	// pipeline ever pulled them back in via jsdom/tar-fs/memfs.
	for (const forbidden of ['require("jsdom")', 'require("tar-fs")', 'require("memfs")', 'require("vm")']) {
		if (mainJs.includes(forbidden)) {
			console.error(`main.js contains a Node-only dependency that breaks mobile: ${forbidden}`);
			failed = true;
		}
	}

	if (!mainJs.includes('tex2svg')) {
		console.error('main.js is missing bundled TikZJax marker: tex2svg');
		failed = true;
	}

	if (sizeMb < 5) {
		console.error(`main.js looks too small for bundled TikZJax (${sizeMb.toFixed(2)} MB).`);
		failed = true;
	}
}

if (failed) {
	process.exit(1);
}

console.log('Bundled TikZJax build artifacts verified.');
