'use strict';

// Build-time replacement for node-tikzjax/dist/bootstrap.js (wired up in
// esbuild.config.mjs). The original reads its TeX assets from disk with
// fs/zlib and untars them into memfs via tar-fs — none of which exist on
// mobile Obsidian. This version reads the same .gz assets from a global the
// plugin installs (base64 copies bundled into main.js), gunzips them with
// fflate (pure JS), and serves the tarball contents from a plain Map.
// The public API (load / tex / getTexPreamble / dumpMemfs) is unchanged.

Object.defineProperty(exports, '__esModule', { value: true });
exports.dumpMemfs = exports.getTexPreamble = exports.tex = exports.load = void 0;

const { gunzipSync } = require('fflate');
const { Buffer } = require('buffer');
const library = require('./library');

// The cached unzipped data of file `core.dump.gz`.
let coredump;
// The cached unzipped data of file `tex.wasm.gz`.
let bytecode;
// TeX support files from `tex_files.tar.gz`, keyed by path relative to the archive root.
let texFiles;

function decodeBase64(encoded) {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function readAssetBytes(name) {
	const root = typeof window !== 'undefined' ? window : globalThis;
	const assets = root.__LUATIKZ_TEX_ASSET_BASE64;
	const encoded = assets ? assets[name] : undefined;
	if (typeof encoded !== 'string' || encoded.length === 0) {
		throw new Error(
			`TikZJax asset "${name}" is unavailable; the plugin did not install its bundled TeX assets.`,
		);
	}
	return gunzipSync(decodeBase64(encoded));
}

function readTarString(bytes, offset, length) {
	let end = offset;
	const max = offset + length;
	while (end < max && bytes[end] !== 0) {
		end++;
	}
	let text = '';
	for (let i = offset; i < end; i++) {
		text += String.fromCharCode(bytes[i]);
	}
	return text;
}

/** Minimal ustar reader: regular files only (no links/PAX; the asset tarball has none). */
function parseTarEntries(bytes) {
	const files = new Map();
	let offset = 0;
	while (offset + 512 <= bytes.length) {
		const name = readTarString(bytes, offset, 100);
		if (!name) {
			// Zero-filled block marks the end of the archive.
			break;
		}
		const size = Number.parseInt(readTarString(bytes, offset + 124, 12).trim() || '0', 8) || 0;
		const typeFlag = bytes[offset + 156];
		const magic = readTarString(bytes, offset + 257, 6);
		const prefix = magic.indexOf('ustar') === 0 ? readTarString(bytes, offset + 345, 155) : '';
		offset += 512;
		const data = bytes.subarray(offset, offset + size);
		offset += Math.ceil(size / 512) * 512;
		// '0' (0x30) or NUL = regular file; skip directories and anything exotic.
		if (typeFlag === 0 || typeFlag === 0x30) {
			let path = prefix ? `${prefix}/${name}` : name;
			path = path.replace(/^\.\//, '').replace(/^\/+/, '');
			files.set(path, data);
		}
	}
	return files;
}

/**
 * Load necessary files into memory.
 */
async function load() {
	if (!coredump) {
		coredump = readAssetBytes('core.dump.gz');
	}
	if (!bytecode) {
		bytecode = readAssetBytes('tex.wasm.gz');
	}
	if (!texFiles) {
		texFiles = parseTarEntries(readAssetBytes('tex_files.tar.gz'));
	}
}
exports.load = load;

/**
 * Read a TeX support file. The engine asks for `/tex_files/<name>` (the
 * directory the original code extracted the tarball into).
 */
async function readTexFileFromMemory(name) {
	const key = String(name).replace(/^\/+/, '').replace(/^tex_files\//, '');
	const data = texFiles.get(key) ?? texFiles.get(`tex_files/${key}`);
	if (!data) {
		throw new Error(`ENOENT: no such file or directory, open '${name}'`);
	}
	return Buffer.from(data);
}

/**
 * Run the TeX engine to compile TeX source code.
 *
 * @param input The TeX source code.
 * @returns The generated DVI file.
 */
async function tex(input, options = {}) {
	// Set up the tex input file.
	const preamble = getTexPreamble(options);
	input = preamble + input;
	if (options.showConsole) {
		library.setShowConsole();
		console.log('TikZJax: Rendering input:');
		console.log(input);
	}
	// Write the tex input file into the in-memory filesystem.
	library.writeFileSync('input.tex', Buffer.from(input));
	// Copy the coredump into the memory.
	const memory = new WebAssembly.Memory({ initial: library.pages, maximum: library.pages });
	const buffer = new Uint8Array(memory.buffer, 0, library.pages * 65536);
	buffer.set(coredump.slice(0));
	library.setMemory(memory.buffer);
	library.setInput(' input.tex \n\\end\n');
	// Set the file loader to read files from the in-memory tarball.
	library.setFileLoader(readTexFileFromMemory);
	// Set up the WebAssembly TeX engine.
	const wasm = await WebAssembly.instantiate(bytecode, {
		library: library,
		env: { memory: memory },
	});
	// Execute TeX and extract the generated DVI file.
	await library.executeAsync(wasm.instance.exports);
	try {
		const dvi = Buffer.from(library.readFileSync('input.dvi'));
		// Clean up the library for the next run.
		library.deleteEverything();
		return dvi;
	} catch (e) {
		library.deleteEverything();
		throw new Error('TeX engine render failed. Set `options.showConsole` to `true` to see logs.');
	}
}
exports.tex = tex;

/**
 * Get preamble of the TeX input file.
 */
function getTexPreamble(options = {}) {
	let texPackages = options.texPackages ?? {};
	const preamble = Object.entries(texPackages).reduce((usePackageString, thisPackage) => {
		usePackageString +=
			'\\usepackage' + (thisPackage[1] ? `[${thisPackage[1]}]` : '') + `{${thisPackage[0]}}`;
		return usePackageString;
	}, '') +
		(options.tikzLibraries ? `\\usetikzlibrary{${options.tikzLibraries}}` : '') +
		(options.addToPreamble || '') +
		(options.tikzOptions ? `[${options.tikzOptions}]` : '') +
		'\n';
	return preamble;
}
exports.getTexPreamble = getTexPreamble;

/**
 * Dump the in-memory TeX file map for debugging.
 */
function dumpMemfs() {
	return texFiles;
}
exports.dumpMemfs = dumpMemfs;
