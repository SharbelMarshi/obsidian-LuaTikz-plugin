import { normalizePath, type App, type DataAdapter } from 'obsidian';
import {
	TIKZJAX_TEX_ASSET_HASH,
} from '../../generated/tikzjaxTexAssets';
import {
	ensureAdapterFolderExists,
	getDesktopFsPath,
	getPluginDir,
} from '../core/pluginPaths';
import { isMobileApp } from './platform';
import { setTikzJaxTexDir } from './tikzJaxGlobal';
import { decodeBase64, nodeFs, nodePath } from './desktopNode';
import {
	readBundledAssetBase64,
	TIKZJAX_BUNDLED_ASSET_NAMES,
	type TikzJaxBundledAssetName,
} from './tikzJaxAssets';

const CACHE_TEX_SUBDIR = 'tikzjax-tex';
const HASH_FILE = '.luatikz-tex-hash';

function getCacheTexAdapterDir(app: App, pluginId: string): string {
	return normalizePath(`${getPluginDir(app, pluginId)}/${CACHE_TEX_SUBDIR}`);
}

function readHashFromFs(texDir: string): string | null {
	const fs = nodeFs();
	const hashPath = nodePath().join(texDir, HASH_FILE);
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
	const fs = nodeFs();
	const path = nodePath();
	return TIKZJAX_BUNDLED_ASSET_NAMES.every(fileName => fs.existsSync(path.join(texDir, fileName)));
}

async function texDirHasAssetsAdapter(adapter: DataAdapter, texAdapterDir: string): Promise<boolean> {
	for (const fileName of TIKZJAX_BUNDLED_ASSET_NAMES) {
		if (!(await adapter.exists(`${texAdapterDir}/${fileName}`))) {
			return false;
		}
	}
	return true;
}

function bundledAssetBytes(fileName: TikzJaxBundledAssetName): Uint8Array {
	return decodeBase64(readBundledAssetBase64(fileName));
}

function writeTexDirFs(targetDir: string): void {
	const fs = nodeFs();
	const path = nodePath();
	fs.mkdirSync(targetDir, { recursive: true });
	for (const fileName of TIKZJAX_BUNDLED_ASSET_NAMES) {
		fs.writeFileSync(path.join(targetDir, fileName), bundledAssetBytes(fileName));
	}
	fs.writeFileSync(path.join(targetDir, HASH_FILE), `${TIKZJAX_TEX_ASSET_HASH}\n`, 'utf8');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function writeTexDirAdapter(app: App, targetAdapterDir: string): Promise<void> {
	await ensureAdapterFolderExists(app, targetAdapterDir);
	const adapter = app.vault.adapter;

	for (const fileName of TIKZJAX_BUNDLED_ASSET_NAMES) {
		await adapter.writeBinary(
			`${targetAdapterDir}/${fileName}`,
			toArrayBuffer(bundledAssetBytes(fileName)),
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
			return nodePath().join(basePath, texAdapterDir);
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
