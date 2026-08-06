import type { App } from 'obsidian';
import { RENDER_IDENTITY_KEYS, type LuaTikzRenderEngine, type LuaTikzSettings } from '../settings/settingsModel';
import type { RenderResult } from '../core/types';
import { ensureAdapterFolderExists, getPluginCacheDir } from '../core/pluginPaths';
import { encodeBytesBase64, decodeBase64 } from './base64Utils';
import { svgDataUrl } from './svgDataUrl';
import { sha256Hex } from './sha256Hex';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 128;

interface CacheIndexEntry {
	createdAt: number;
	engine: LuaTikzRenderEngine;
	outputFormat: 'svg' | 'png';
	assetFile: string;
	kind: 'svg' | 'png';
}

interface CacheIndexFile {
	version: 2;
	entries: Record<string, CacheIndexEntry>;
}

function pngDataUrl(pngBytes: ArrayBuffer): string {
	return `data:image/png;base64,${encodeBytesBase64(pngBytes)}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function buildRenderCacheKey(
	engine: LuaTikzRenderEngine,
	source: string,
	settings: LuaTikzSettings,
	invertDark: boolean,
	pluginVersion: string,
): string {
	return sha256Hex([
		engine,
		':',
		source,
		invertDark ? ':dark' : ':light',
		// The plugin version, so a release that changes the preamble generator
		// self-invalidates instead of serving week-old diagrams built by the
		// previous version's wrapper.
		':',
		pluginVersion,
		// Driven off RENDER_IDENTITY_KEYS so a new render-affecting setting
		// cannot be forgotten here and serve a week-old diagram.
		...RENDER_IDENTITY_KEYS.flatMap(key => [':', String(settings[key])]),
	]);
}

export class RenderDiskCache {
	private memory = new Map<string, RenderResult & { createdAt: number }>();
	private index: CacheIndexFile = { version: 2, entries: {} };
	private cacheAdapterDir: string | null = null;
	private loaded = false;
	private pendingClear: Promise<void> | null = null;

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
	) {}

	/**
	 * Drop in-memory state only; the on-disk cache survives. This is the
	 * unload/disable path — a plugin update must not throw away a week of
	 * rendered diagrams.
	 */
	dispose(): void {
		this.memory.clear();
		this.index = { version: 2, entries: {} };
		this.loaded = false;
		this.cacheAdapterDir = null;
	}

	/**
	 * Delete every cached asset and write an empty index. The old clear()
	 * only reset in-memory state with loaded=false — the next get() then
	 * re-read index.json from disk and restored everything, so the
	 * "Clear cache" button and settings-change invalidation were no-ops.
	 *
	 * Resolves only after the disk is actually clean; ensureLoaded() awaits
	 * pendingClear so a render racing the clear cannot resurrect the old
	 * index mid-delete.
	 */
	async invalidateCache(): Promise<void> {
		const run = async (): Promise<void> => {
			this.memory.clear();
			this.cacheAdapterDir = getPluginCacheDir(this.app, this.pluginId);
			await ensureAdapterFolderExists(this.app, this.cacheAdapterDir);
			// Load the on-disk index first: entries from previous sessions are
			// not in memory but their assets still need deleting.
			await this.loadIndex();
			for (const [key, entry] of Object.entries(this.index.entries)) {
				await this.deleteEntry(key, entry);
			}
			this.index = { version: 2, entries: {} };
			await this.saveIndex();
			this.loaded = true;
		};

		this.pendingClear = run();
		try {
			await this.pendingClear;
		} finally {
			this.pendingClear = null;
		}
	}

	private async ensureLoaded(): Promise<void> {
		if (this.pendingClear) {
			await this.pendingClear;
		}
		if (this.loaded && this.cacheAdapterDir) {
			return;
		}

		this.cacheAdapterDir = getPluginCacheDir(this.app, this.pluginId);
		await ensureAdapterFolderExists(this.app, this.cacheAdapterDir);
		this.loaded = true;
		await this.loadIndex();
		this.pruneExpired();
	}

	/** LRU-capped: the memory layer stores SVG text plus its base64 data URL
	 * (~2.4x the SVG), and it used to grow without bound for the whole session. */
	private rememberInMemory(key: string, value: RenderResult & { createdAt: number }): void {
		if (this.memory.has(key)) {
			this.memory.delete(key);
		}
		this.memory.set(key, value);
		while (this.memory.size > CACHE_MAX_ENTRIES) {
			const oldest = this.memory.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.memory.delete(oldest);
		}
	}

	private indexAdapterPath(): string {
		return `${this.cacheAdapterDir}/index.json`;
	}

	private async loadIndex(): Promise<void> {
		try {
			if (this.cacheAdapterDir && await this.app.vault.adapter.exists(this.indexAdapterPath())) {
				const raw = await this.app.vault.adapter.read(this.indexAdapterPath());
				const parsed = JSON.parse(raw) as CacheIndexFile;
				if (parsed?.version === 2 && parsed.entries) {
					this.index = parsed;
				}
			}
		} catch {
			this.index = { version: 2, entries: {} };
		}
	}

	private async saveIndex(): Promise<void> {
		if (!this.cacheAdapterDir) {
			return;
		}
		const payload = JSON.stringify(this.index, null, 2);
		await this.app.vault.adapter.write(this.indexAdapterPath(), payload);
	}

	private assetAdapterPath(fileName: string): string {
		return `${this.cacheAdapterDir}/${fileName}`;
	}

	private async deleteAsset(fileName: string): Promise<void> {
		if (!this.cacheAdapterDir) {
			return;
		}
		const adapterPath = this.assetAdapterPath(fileName);
		if (await this.app.vault.adapter.exists(adapterPath)) {
			try {
				await this.app.vault.adapter.remove(adapterPath);
			} catch {
				// ignore
			}
		}
	}

	private pruneExpired(): void {
		const now = Date.now();
		for (const [key, entry] of Object.entries(this.index.entries)) {
			if (now - entry.createdAt > CACHE_TTL_MS) {
				void this.deleteEntry(key, entry);
			}
		}
		void this.enforceMaxEntries();
	}

	private async enforceMaxEntries(): Promise<void> {
		const keys = Object.entries(this.index.entries)
			.sort((a, b) => a[1].createdAt - b[1].createdAt)
			.map(([key]) => key);

		while (keys.length > CACHE_MAX_ENTRIES) {
			const oldest = keys.shift();
			if (!oldest) {
				break;
			}
			await this.deleteEntry(oldest, this.index.entries[oldest]);
		}
	}

	private async deleteEntry(key: string, entry: CacheIndexEntry | undefined): Promise<void> {
		if (entry) {
			await this.deleteAsset(entry.assetFile);
		}
		delete this.index.entries[key];
	}

	private async readAsset(entry: CacheIndexEntry): Promise<RenderResult | null> {
		if (!this.cacheAdapterDir) {
			return null;
		}

		const adapterPath = this.assetAdapterPath(entry.assetFile);
		if (!(await this.app.vault.adapter.exists(adapterPath))) {
			return null;
		}

		if (entry.kind === 'svg') {
			const svgText = await this.app.vault.adapter.read(adapterPath);
			return {
				ok: true,
				engine: entry.engine,
				svgText,
				svg: svgText,
				dataUrl: svgDataUrl(svgText),
			};
		}

		const pngBytes = await this.app.vault.adapter.readBinary(adapterPath);
		return {
			ok: true,
			engine: entry.engine,
			dataUrl: pngDataUrl(pngBytes),
		};
	}

	async get(key: string): Promise<RenderResult | null> {
		const memoryHit = this.memory.get(key);
		if (memoryHit) {
			const { createdAt, ...result } = memoryHit;
			if (Date.now() - createdAt <= CACHE_TTL_MS) {
				return result;
			}
			this.memory.delete(key);
		}

		await this.ensureLoaded();

		const entry = this.index.entries[key];
		if (!entry || Date.now() - entry.createdAt > CACHE_TTL_MS) {
			if (entry) {
				await this.deleteEntry(key, entry);
				await this.saveIndex();
			}
			return null;
		}

		const result = await this.readAsset(entry);
		if (!result) {
			await this.deleteEntry(key, entry);
			await this.saveIndex();
			return null;
		}

		this.rememberInMemory(key, { ...result, createdAt: entry.createdAt });
		return result;
	}

	async set(key: string, result: RenderResult, settings: LuaTikzSettings): Promise<void> {
		if (!result.ok || !result.dataUrl) {
			return;
		}

		const createdAt = Date.now();
		this.rememberInMemory(key, { ...result, createdAt });

		await this.ensureLoaded();
		if (!settings.cacheEnabled) {
			return;
		}

		const svgText = result.svgText ?? result.svg;
		let assetFile = '';
		let kind: CacheIndexEntry['kind'] = 'svg';

		if (settings.outputFormat === 'png' && result.dataUrl.startsWith('data:image/png;base64,')) {
			assetFile = `${key}.png`;
			kind = 'png';
			const base64 = result.dataUrl.slice('data:image/png;base64,'.length);
			await this.app.vault.adapter.writeBinary(
				this.assetAdapterPath(assetFile),
				toArrayBuffer(decodeBase64(base64)),
			);
		} else if (svgText) {
			assetFile = `${key}.svg`;
			kind = 'svg';
			await this.app.vault.adapter.write(this.assetAdapterPath(assetFile), svgText);
		} else {
			return;
		}

		if (this.index.entries[key]) {
			await this.deleteEntry(key, this.index.entries[key]);
		}

		this.index.entries[key] = {
			createdAt,
			engine: result.engine,
			outputFormat: settings.outputFormat,
			assetFile,
			kind,
		};

		await this.enforceMaxEntries();
		await this.saveIndex();
	}
}
