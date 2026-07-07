import * as fs from 'fs';
import * as path from 'path';
import { normalizePath, type App, type DataAdapter } from 'obsidian';
import {
	TIKZJAX_TEX_ASSET_HASH,
	TIKZJAX_TEX_ASSETS_BASE64,
} from '../../generated/tikzjaxTexAssets';
import {
	ensureAdapterFolderExists,
	getDesktopFsPath,
	getPluginDir,
} from '../core/pluginPaths';
import { isMobileApp } from './platform';
import { setTikzJaxTexDir } from './tikzJaxGlobal';

type TikzJaxAssetName = 'core.dump.gz' | 'tex.wasm.gz' | 'tex_files.tar.gz';

const CACHE_TEX_SUBDIR = 'tikzjax-tex';
const HASH_FILE = '.luatikz-tex-hash';

const TIKZJAX_ASSET_NAMES: readonly TikzJaxAssetName[] = [
	'core.dump.gz',
	'tex.wasm.gz',
	'tex_files.tar.gz',
];

function getCacheTexAdapterDir(app: App, pluginId: string): string {
	return normalizePath(`${getPluginDir(app, pluginId)}/${CACHE_TEX_SUBDIR}`);
}

function readHashFromFs(texDir: string): string | null {
	const hashPath = path.join(texDir, HASH_FILE);
	if (!fs.existsSync(hashPath)) {
		return null;
	}

	try {
		return fs.readFileSync(hashPath, 'utf8').trim();
	} catch {
		return null;
	}
}

async function readHashFromAdapter(adapter: DataAdapter, texAdapterDir: string): Promise<string | null> {
	const hashPath = `${texAdapterDir}/${HASH_FILE}`;
	if (!(await adapter.exists(hashPath))) {
		return null;
	}

	try {
		return (await adapter.read(hashPath)).trim();
	} catch {
		return null;
	}
}

function texDirHasAssetsFs(texDir: string): boolean {
	return TIKZJAX_ASSET_NAMES.every(fileName => fs.existsSync(path.join(texDir, fileName)));
}

async function texDirHasAssetsAdapter(adapter: DataAdapter, texAdapterDir: string): Promise<boolean> {
	for (const fileName of TIKZJAX_ASSET_NAMES) {
		if (!(await adapter.exists(`${texAdapterDir}/${fileName}`))) {
			return false;
		}
	}
	return true;
}

function bundledAssetBytes(fileName: TikzJaxAssetName): Uint8Array {
	const encoded = TIKZJAX_TEX_ASSETS_BASE64[fileName];
	if (typeof encoded !== 'string' || encoded.length === 0) {
		throw new Error(`Missing bundled TikZJax asset: ${fileName}`);
	}

	return Uint8Array.from(Buffer.from(encoded, 'base64'));
}

function writeTexDirFs(targetDir: string): void {
	fs.mkdirSync(targetDir, { recursive: true });
	for (const fileName of TIKZJAX_ASSET_NAMES) {
		fs.writeFileSync(path.join(targetDir, fileName), bundledAssetBytes(fileName));
	}
	fs.writeFileSync(path.join(targetDir, HASH_FILE), `${TIKZJAX_TEX_ASSET_HASH}\n`, 'utf8');
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function writeTexDirAdapter(app: App, targetAdapterDir: string): Promise<void> {
	await ensureAdapterFolderExists(app, targetAdapterDir);
	const adapter = app.vault.adapter;

	for (const fileName of TIKZJAX_ASSET_NAMES) {
		await adapter.writeBinary(
			`${targetAdapterDir}/${fileName}`,
			toArrayBuffer(Buffer.from(TIKZJAX_TEX_ASSETS_BASE64[fileName], 'base64')),
		);
	}

	await adapter.write(`${targetAdapterDir}/${HASH_FILE}`, `${TIKZJAX_TEX_ASSET_HASH}\n`);
}

function resolveTexDirFromAdapter(app: App, texAdapterDir: string): string | null {
	const desktopPath = getDesktopFsPath(app, texAdapterDir);
	if (desktopPath) {
		return desktopPath;
	}

	const adapter = app.vault.adapter as DataAdapter & {
		getFullPath?: (normalizedPath: string) => string;
		getBasePath?: () => string;
	};

	if (typeof adapter.getFullPath === 'function') {
		try {
			return adapter.getFullPath(texAdapterDir);
		} catch {
			// fall through
		}
	}

	if (typeof adapter.getBasePath === 'function') {
		const basePath = adapter.getBasePath();
		if (basePath) {
			return path.join(basePath, texAdapterDir);
		}
	}

	return texAdapterDir;
}

export async function ensureTikzJaxTexExtracted(
	app: App,
	pluginId: string,
): Promise<{ ok: true; texDir: string } | { ok: false; error: string }> {
	const cacheTexAdapterDir = getCacheTexAdapterDir(app, pluginId);

	try {
		await ensureAdapterFolderExists(app, getPluginDir(app, pluginId));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: `Could not prepare TikZJax directories: ${message}`,
		};
	}

	const adapter = app.vault.adapter;
	const desktopCacheDir = getDesktopFsPath(app, cacheTexAdapterDir);
	const cacheHash = desktopCacheDir
		? readHashFromFs(desktopCacheDir)
		: await readHashFromAdapter(adapter, cacheTexAdapterDir);
	const cacheHasAssets = desktopCacheDir
		? texDirHasAssetsFs(desktopCacheDir)
		: await texDirHasAssetsAdapter(adapter, cacheTexAdapterDir);
	const cacheReady = cacheHasAssets && cacheHash === TIKZJAX_TEX_ASSET_HASH;

	if (!cacheReady) {
		try {
			if (desktopCacheDir) {
				writeTexDirFs(desktopCacheDir);
			} else {
				await writeTexDirAdapter(app, cacheTexAdapterDir);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				error: `Could not extract bundled TikZJax TeX files: ${message}`,
			};
		}
	}

	const texDir = desktopCacheDir ?? resolveTexDirFromAdapter(app, cacheTexAdapterDir);
	if (!texDir) {
		return {
			ok: false,
			error: isMobileApp
				? 'TikZJax could not resolve a TeX directory on this device.'
				: 'TikZJax requires filesystem access.',
		};
	}

	setTikzJaxTexDir(texDir);
	return { ok: true, texDir };
}
