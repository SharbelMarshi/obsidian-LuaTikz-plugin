#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginId = process.env.LUATIKZ_PLUGIN_ID ?? 'luatikz';

const defaultVault = path.join(
	process.env.HOME ?? '',
	'Library/Mobile Documents/iCloud~md~obsidian/Documents',
);

const vaultBase = process.env.OBSIDIAN_VAULT ?? defaultVault;
const destDir = path.join(vaultBase, '.obsidian', 'plugins', pluginId);

const releaseFiles = ['main.js', 'tikzjax.js', 'manifest.json', 'styles.css'];
const runtimeDir = path.join(projectRoot, 'tikzjax-tex');

for (const fileName of releaseFiles) {
	const sourcePath = path.join(projectRoot, fileName);
	if (!fs.existsSync(sourcePath)) {
		console.error(`Missing build artifact: ${fileName}`);
		console.error('Run npm run build first.');
		process.exit(1);
	}
}

if (!fs.existsSync(runtimeDir)) {
	console.error('Missing TikZJax runtime folder: tikzjax-tex/');
	console.error('Run npm run build first.');
	process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

for (const fileName of releaseFiles) {
	fs.copyFileSync(
		path.join(projectRoot, fileName),
		path.join(destDir, fileName),
	);
}

const destRuntimeDir = path.join(destDir, 'tikzjax-tex');
fs.rmSync(destRuntimeDir, { recursive: true, force: true });
fs.cpSync(runtimeDir, destRuntimeDir, { recursive: true });

console.log(`Installed LuaTikz to ${destDir}`);
console.log('Copied: main.js, tikzjax.js, manifest.json, styles.css, tikzjax-tex/');
