import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePath, type App } from 'obsidian';
import type { LuaTikzRenderEngine, LuaTikzSettings } from '../settings/settingsModel';
import type { RenderResult } from '../core/types';
import { getPluginCacheDir, getPluginDir } from '../core/pluginPaths';
import { isMobileApp } from './platform';

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

function svgDataUrl(svgText: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf8').toString('base64')}`;
}

function pngDataUrl(pngBytes: ArrayBuffer): string {
	return `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`;
}

export function buildRenderCacheKey(
	engine: LuaTikzRenderEngine,
	source: string,
	settings: LuaTikzSettings,
	invertDark: boolean,
): string {
	return createHash('sha256')
		.update(engine)
		.update(':')
		.update(source)
		.update(invertDark ? ':dark' : ':light')
		.update(':')
		.update(settings.lualatexPath)
		.update(':')
		.update(settings.extraPreamble)
		.update(':')
		.update(String(settings.timeoutMs))
		.update(':')
		.update(settings.outputFormat)
		.update(':')
		.update(settings.darkModeStyle)
		.digest('hex');
}

export class RenderDiskCache {
	private memory = new Map<string, RenderResult & { createdAt: number }>();
	private index: CacheIndexFile = { version: 2, entries: {} };
	private cacheDir: string | null = null;
	private cacheAdapterDir: string | null = null;
	private loaded = false;

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
	) {}

	clear(): void {
		this.memory.clear();
		this.index = { version: 2, entries: {} };
		if (this.cacheDir && fs.existsSync(this.cacheDir)) {
			try {
				fs.rmSync(this.cacheDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
		this.loaded = false;
		this.cacheDir = null;
		this.cacheAdapterDir = null;
	}

	private async ensureLoaded(): Promise<string | null> {
		if (this.loaded && (this.cacheDir || this.cacheAdapterDir)) {
			return this.cacheDir;
		}

		this.cacheAdapterDir = normalizePath(`${getPluginDir(this.app, this.pluginId)}/.luatikz-cache`);
		this.cacheDir = getPluginCacheDir(this.app, this.pluginId);

		if (this.cacheDir) {
			fs.mkdirSync(this.cacheDir, { recursive: true });
		} else if (isMobileApp) {
			const parts = this.cacheAdapterDir.split('/').filter(Boolean);
			let current = '';
			for (const part of parts) {
				current = current ? `${current}/${part}` : part;
				if (!(await this.app.vault.adapter.exists(current))) {
					await this.app.vault.adapter.mkdir(current);
				}
			}
		} else {
			return null;
		}

		this.loaded = true;
		await this.loadIndex();
		this.pruneExpired();
		return this.cacheDir;
	}

	private indexAdapterPath(): string {
		return `${this.cacheAdapterDir}/index.json`;
	}

	private indexFsPath(): string | null {
		return this.cacheDir ? path.join(this.cacheDir, 'index.json') : null;
	}

	private async loadIndex(): Promise<void> {
		try {
			if (this.cacheDir) {
				const indexPath = this.indexFsPath();
				if (indexPath && fs.existsSync(indexPath)) {
					const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as CacheIndexFile;
					if (parsed?.version === 2 && parsed.entries) {
						this.index = parsed;
						return;
					}
				}
			}

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
		const payload = JSON.stringify(this.index, null, 2);
		if (this.cacheDir) {
			const indexPath = this.indexFsPath();
			if (indexPath) {
				fs.writeFileSync(indexPath, payload, 'utf8');
			}
		}
		if (this.cacheAdapterDir) {
			await this.app.vault.adapter.write(this.indexAdapterPath(), payload);
		}
	}

	private assetAdapterPath(fileName: string): string {
		return `${this.cacheAdapterDir}/${fileName}`;
	}

	private async deleteAsset(fileName: string): Promise<void> {
		if (this.cacheDir) {
			const filePath = path.join(this.cacheDir, fileName);
			if (fs.existsSync(filePath)) {
				try {
					fs.rmSync(filePath);
				} catch {
					// ignore
				}
			}
		}
		if (this.cacheAdapterDir && await this.app.vault.adapter.exists(this.assetAdapterPath(fileName))) {
			try {
				await this.app.vault.adapter.remove(this.assetAdapterPath(fileName));
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
		if (entry.kind === 'svg') {
			let svgText: string | null = null;
			if (this.cacheDir) {
				const filePath = path.join(this.cacheDir, entry.assetFile);
				if (fs.existsSync(filePath)) {
					svgText = fs.readFileSync(filePath, 'utf8');
				}
			}
			if (!svgText && this.cacheAdapterDir) {
				const adapterPath = this.assetAdapterPath(entry.assetFile);
				if (await this.app.vault.adapter.exists(adapterPath)) {
					svgText = await this.app.vault.adapter.read(adapterPath);
				}
			}
			if (!svgText) {
				return null;
			}
			return {
				ok: true,
				engine: entry.engine,
				svgText,
				svg: svgText,
				dataUrl: svgDataUrl(svgText),
			};
		}

		let pngBytes: ArrayBuffer | null = null;
		if (this.cacheDir) {
			const filePath = path.join(this.cacheDir, entry.assetFile);
			if (fs.existsSync(filePath)) {
				pngBytes = Uint8Array.from(fs.readFileSync(filePath)).buffer;
			}
		}
		if (!pngBytes && this.cacheAdapterDir) {
			const adapterPath = this.assetAdapterPath(entry.assetFile);
			if (await this.app.vault.adapter.exists(adapterPath)) {
				pngBytes = await this.app.vault.adapter.readBinary(adapterPath);
			}
		}
		if (!pngBytes) {
			return null;
		}

		return {
			ok: true,
			engine: entry.engine,
			dataUrl: pngDataUrl(pngBytes),
		};
	}

	async get(key: string): Promise<RenderResult | null> {
		const memoryHit = this.memory.get(key);
		if (memoryHit && Date.now() - memoryHit.createdAt <= CACHE_TTL_MS) {
			const { createdAt: _createdAt, ...result } = memoryHit;
			return result;
		}
		if (memoryHit) {
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

		this.memory.set(key, { ...result, createdAt: entry.createdAt });
		return result;
	}

	async set(key: string, result: RenderResult, settings: LuaTikzSettings): Promise<void> {
		if (!result.ok || !result.dataUrl) {
			return;
		}

		const createdAt = Date.now();
		this.memory.set(key, { ...result, createdAt });

		await this.ensureLoaded();
		if (!settings.cacheEnabled) {
			return;
		}

		const svgText = result.svgText ?? result.svg;
		let assetFile = '';
		let kind: CacheIndexEntry['kind'] = 'svg';

		if (settings.outputFormat === 'png' && result.pngPath && this.cacheDir && fs.existsSync(result.pngPath)) {
			assetFile = `${key}.png`;
			kind = 'png';
			const bytes = fs.readFileSync(result.pngPath);
			if (this.cacheDir) {
				fs.writeFileSync(path.join(this.cacheDir, assetFile), bytes);
			}
			if (this.cacheAdapterDir) {
				await this.app.vault.adapter.writeBinary(this.assetAdapterPath(assetFile), Uint8Array.from(bytes).buffer);
			}
		} else if (svgText) {
			assetFile = `${key}.svg`;
			kind = 'svg';
			if (this.cacheDir) {
				fs.writeFileSync(path.join(this.cacheDir, assetFile), svgText, 'utf8');
			}
			if (this.cacheAdapterDir) {
				await this.app.vault.adapter.write(this.assetAdapterPath(assetFile), svgText);
			}
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
