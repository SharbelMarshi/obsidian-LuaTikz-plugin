import fs from 'node:fs';

const required = [
	'vendor/node-tikzjax/dist/index.js',
	'vendor/node-tikzjax/dist/bootstrap.js',
	'vendor/tex/core.dump.gz',
	'vendor/tex/tex.wasm.gz',
	'vendor/tex/tex_files.tar.gz',
];

let failed = false;

for (const item of required) {
	if (!fs.existsSync(item)) {
		console.error(`Missing required TikZJax runtime file/folder: ${item}`);
		failed = true;
	}
}

if (failed) {
	process.exit(1);
}

console.log('TikZJax vendor files found.');
