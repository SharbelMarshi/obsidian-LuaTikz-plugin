/**
 * RenderDiskCache semantics, against the real src module over an in-memory
 * fake vault adapter.
 *
 * The regression this pins: clear() used to reset only in-memory state and
 * set loaded=false — the next get() re-read index.json from disk and restored
 * every entry, so the "Clear cache" button and settings-change invalidation
 * silently did nothing for the 7-day TTL.
 */
import assert from 'node:assert/strict';
import { loadSrcModules, OBSIDIAN_STUB } from './loadSrc.mjs';

const { cache } = await loadSrcModules(
	{ cache: 'src/utils/renderCache.ts' },
	{ stubs: { obsidian: OBSIDIAN_STUB } },
);
const { RenderDiskCache, buildRenderCacheKey } = cache;

/** In-memory DataAdapter over a Map<path, string|ArrayBuffer>. */
function fakeApp() {
	const files = new Map();
	const folders = new Set();
	const adapter = {
		async exists(path) { return files.has(path) || folders.has(path); },
		async mkdir(path) { folders.add(path); },
		async read(path) {
			if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
			return files.get(path);
		},
		async write(path, data) { files.set(path, data); },
		async readBinary(path) {
			if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
			return files.get(path);
		},
		async writeBinary(path, data) { files.set(path, data); },
		async remove(path) { files.delete(path); },
	};
	return { app: { vault: { adapter, configDir: '.obsidian' } }, files, folders };
}

const SETTINGS = { cacheEnabled: true, outputFormat: 'svg' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
const okResult = () => ({ ok: true, engine: 'lualatex', svg: SVG, svgText: SVG, dataUrl: 'data:image/svg+xml;base64,x' });

const CACHE_DIR = '.obsidian/plugins/luatikz/.luatikz-cache';
const svgAssets = files => [...files.keys()].filter(p => p.endsWith('.svg'));

// --- invalidateCache() actually clears the disk ----------------------------

{
	const { app, files } = fakeApp();
	const disk = new RenderDiskCache(app, 'luatikz');

	await disk.set('key-a', okResult(), SETTINGS);
	await disk.set('key-b', okResult(), SETTINGS);
	assert.equal(svgAssets(files).length, 2, 'assets not written');
	assert.ok(files.has(`${CACHE_DIR}/index.json`), 'index not written');

	await disk.invalidateCache();

	assert.equal(svgAssets(files).length, 0, 'invalidateCache left asset files on disk');
	const index = JSON.parse(files.get(`${CACHE_DIR}/index.json`));
	assert.deepEqual(index.entries, {}, 'index.json still lists entries');

	// The regression assertion: get() after clearing must NOT resurrect the
	// entry from a stale index.
	assert.equal(await disk.get('key-a'), null, 'entry survived invalidateCache');
	assert.equal(await disk.get('key-b'), null);
}

// --- a second session sees the invalidation --------------------------------

{
	const { app, files } = fakeApp();
	const first = new RenderDiskCache(app, 'luatikz');
	await first.set('key-a', okResult(), SETTINGS);
	await first.invalidateCache();

	// New instance over the same "disk": nothing to restore.
	const second = new RenderDiskCache(app, 'luatikz');
	assert.equal(await second.get('key-a'), null, 'a fresh instance restored cleared entries');
	assert.equal(svgAssets(files).length, 0);
}

// --- dispose() keeps the disk (unload must not wipe a week of renders) -----

{
	const { app, files } = fakeApp();
	const disk = new RenderDiskCache(app, 'luatikz');
	await disk.set('key-a', okResult(), SETTINGS);

	disk.dispose();

	assert.equal(svgAssets(files).length, 1, 'dispose must not delete disk assets');
	// Same instance reloads from disk on demand — the entry is still served.
	const restored = await disk.get('key-a');
	assert.ok(restored, 'disk entry lost after dispose');
	assert.equal(restored.svgText, SVG);
}

// --- memory layer is LRU-capped --------------------------------------------

{
	const { app } = fakeApp();
	const disk = new RenderDiskCache(app, 'luatikz');
	const CAP = 128; // CACHE_MAX_ENTRIES in renderCache.ts

	for (let i = 0; i < CAP + 10; i++) {
		await disk.set(`key-${i}`, okResult(), SETTINGS);
	}
	// Private field, asserted via reflection: the cap is the whole point.
	const memory = disk.memory ?? Object.values(disk).find(v => v instanceof Map && v.size > 0);
	assert.ok(memory instanceof Map, 'could not locate memory map');
	assert.ok(memory.size <= CAP, `memory map grew to ${memory.size}, cap is ${CAP}`);
}

// --- cache key: plugin version participates --------------------------------

{
	const settings = {
		lualatexPath: '', extraPreamble: '', customPreamble: '', mainFont: '',
		hebrewFont: '', arabicFont: '', timeoutMs: 15000, outputFormat: 'svg',
		darkModeStyle: 'auto-invert',
	};
	const a = buildRenderCacheKey('lualatex', 'src', settings, false, '1.8.2');
	const b = buildRenderCacheKey('lualatex', 'src', settings, false, '1.8.3');
	assert.notEqual(a, b, 'a release must invalidate the previous version\'s entries');
	assert.equal(a, buildRenderCacheKey('lualatex', 'src', settings, false, '1.8.2'), 'key must be stable');
}

console.log('test-render-cache: ok');
