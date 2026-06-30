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

const releaseFiles = ['main.js', 'manifest.json', 'styles.css'];

for (const fileName of releaseFiles) {
	const sourcePath = path.join(projectRoot, fileName);
	if (!fs.existsSync(sourcePath)) {
		console.error(`Missing build artifact: ${fileName}`);
		console.error('Run npm run build first.');
		process.exit(1);
	}
}

fs.mkdirSync(destDir, { recursive: true });

for (const fileName of releaseFiles) {
	fs.copyFileSync(
		path.join(projectRoot, fileName),
		path.join(destDir, fileName),
	);
}

console.log(`Installed LuaTikz to ${destDir}`);
console.log('Copied: main.js, manifest.json, styles.css');
