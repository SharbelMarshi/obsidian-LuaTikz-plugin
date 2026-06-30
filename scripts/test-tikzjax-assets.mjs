#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedAssetsPath = path.join(projectRoot, 'generated/tikzjaxTexAssets.ts');
const runtimeDir = path.join(projectRoot, 'tikzjax-tex');
const sourceTexDir = path.join(projectRoot, 'node_modules/node-tikzjax/tex');

if (!fs.existsSync(generatedAssetsPath)) {
	console.error('Generated TikZJax tex assets missing. Run npm run build first.');
	process.exit(1);
}

if (!fs.existsSync(runtimeDir)) {
	console.error('TikZJax runtime folder missing. Run npm run build first.');
	process.exit(1);
}

const requiredFiles = ['core.dump.gz', 'tex.wasm.gz', 'tex_files.tar.gz'];
for (const fileName of requiredFiles) {
	const runtimePath = path.join(runtimeDir, fileName);
	const sourcePath = path.join(sourceTexDir, fileName);
	if (!fs.existsSync(runtimePath)) {
		console.error(`Missing runtime tex file: ${runtimePath}`);
		process.exit(1);
	}
	if (!fs.existsSync(sourcePath)) {
		console.error(`Missing source tex file: ${sourcePath}`);
		process.exit(1);
	}

	const runtimeBytes = fs.readFileSync(runtimePath);
	const sourceBytes = fs.readFileSync(sourcePath);
	if (!runtimeBytes.equals(sourceBytes)) {
		console.error(`Runtime asset mismatch for ${fileName}.`);
		process.exit(1);
	}
}

const hashMatch = fs.readFileSync(generatedAssetsPath, 'utf8').match(/TIKZJAX_TEX_ASSET_HASH = '([^']+)'/);
const expectedHash = hashMatch?.[1];
const storedHash = fs.readFileSync(path.join(runtimeDir, '.luatikz-tex-hash'), 'utf8').trim();
if (!expectedHash || storedHash !== expectedHash) {
	console.error('TikZJax runtime hash does not match generated metadata.');
	process.exit(1);
}

const recomputedHash = createHash('sha256')
	.update(requiredFiles.map(fileName => {
		const bytes = fs.readFileSync(path.join(runtimeDir, fileName));
		return `${fileName}:${createHash('sha256').update(bytes).digest('hex')}`;
	}).join('\n'))
	.digest('hex');

if (recomputedHash !== expectedHash) {
	console.error('TikZJax runtime files failed hash verification.');
	process.exit(1);
}

console.log('Bundled TikZJax tex assets verified against node-tikzjax source files.');
