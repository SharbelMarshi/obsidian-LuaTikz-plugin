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

const requiredInProject = [
	'main.js',
	'manifest.json',
	'styles.css',
	'vendor/node-tikzjax/dist/index.js',
	'vendor/tex',
];

for (const item of requiredInProject) {
	const sourcePath = path.join(projectRoot, item);
	if (!fs.existsSync(sourcePath)) {
		console.error(`Missing build artifact: ${item}`);
		console.error('Run npm run build first.');
		process.exit(1);
	}
}

fs.mkdirSync(destDir, { recursive: true });

for (const fileName of ['main.js', 'manifest.json', 'styles.css']) {
	fs.copyFileSync(
		path.join(projectRoot, fileName),
		path.join(destDir, fileName),
	);
}

const destVendor = path.join(destDir, 'vendor');
fs.rmSync(destVendor, { recursive: true, force: true });
fs.cpSync(path.join(projectRoot, 'vendor'), destVendor, { recursive: true });

console.log(`Installed LuaTikz to ${destDir}`);
console.log('Copied: main.js, manifest.json, styles.css, vendor/');

const installedEntry = path.join(destDir, 'vendor/node-tikzjax/dist/index.js');
const installedTex = path.join(destDir, 'vendor/tex');
if (fs.existsSync(installedEntry) && fs.existsSync(installedTex)) {
	console.log('Installed TikZJax runtime verified.');
} else {
	console.error('Installed TikZJax runtime verification failed.');
	process.exit(1);
}
