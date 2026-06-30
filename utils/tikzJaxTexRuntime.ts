import { createHash } from 'crypto';
import { Buffer } from 'buffer';
// fs is required to extract bundled TikZJax TeX runtime bytes into the plugin temp folder.
import * as fs from 'fs';
import * as path from 'path';
import type { App } from 'obsidian';
import {
	TIKZJAX_TEX_ASSET_HASH,
	TIKZJAX_TEX_ASSETS_BASE64,
} from '../generated/tikzjaxTexAssets';
import { getDesktopFsPath, getPluginTempDir, ensureAdapterFolderExists } from '../pluginPaths';
import { setTikzJaxTexDir } from './tikzJaxGlobal';

type TikzJaxAssetName = 'core.dump.gz' | 'tex.wasm.gz' | 'tex_files.tar.gz';

interface TikzJaxBundledAsset {
	readonly fileName: TikzJaxAssetName;
	readonly base64: string;
	readonly sha256?: string;
}

interface RawTikzJaxAsset {
	readonly fileName?: unknown;
	readonly base64?: unknown;
	readonly sha256?: unknown;
}

const TEX_SUBDIR = 'tikzjax-tex';
const HASH_FILE = '.luatikz-tex-hash';

const TIKZJAX_ASSET_NAMES: readonly TikzJaxAssetName[] = [
	'core.dump.gz',
	'tex.wasm.gz',
	'tex_files.tar.gz',
];

const isTikzJaxAssetName = (value: string): value is TikzJaxAssetName =>
	value === 'core.dump.gz' || value === 'tex.wasm.gz' || value === 'tex_files.tar.gz';

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

const getBundledTikzJaxAssetHash = (): string => {
	const rawHash: unknown = TIKZJAX_TEX_ASSET_HASH;
	if (!isNonEmptyString(rawHash)) {
		throw new Error('Invalid TikZJax asset hash.');
	}
	const assetHash: string = rawHash;
	return assetHash;
};

const normalizeAsset = (raw: unknown): TikzJaxBundledAsset => {
	if (typeof raw !== 'object' || raw === null) {
		throw new Error('Invalid TikZJax asset entry.');
	}
	const record = raw as RawTikzJaxAsset;
	if (!isNonEmptyString(record.fileName) || !isTikzJaxAssetName(record.fileName)) {
		throw new Error('Invalid TikZJax asset filename.');
	}
	if (!isNonEmptyString(record.base64)) {
		throw new Error(`Invalid TikZJax asset data for ${record.fileName}.`);
	}
	if (record.sha256 !== undefined && !isNonEmptyString(record.sha256)) {
		throw new Error(`Invalid TikZJax asset hash for ${record.fileName}.`);
	}
	return {
		fileName: record.fileName,
		base64: record.base64,
		sha256: record.sha256,
	};
};

const loadBundledAssets = (): readonly TikzJaxBundledAsset[] => {
	const importedAssets: unknown = TIKZJAX_TEX_ASSETS_BASE64;
	if (typeof importedAssets !== 'object' || importedAssets === null) {
		throw new Error('Invalid TikZJax bundled assets module.');
	}
	const record = importedAssets as Record<string, unknown>;
	return TIKZJAX_ASSET_NAMES.map(fileName =>
		normalizeAsset({ fileName, base64: record[fileName] }),
	);
};

const BUNDLED_TEX_ASSETS: readonly TikzJaxBundledAsset[] = loadBundledAssets();

const decodeBase64 = (base64: string): Uint8Array => {
	const buffer = Buffer.from(base64, 'base64');
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
};

function safeJoin(baseDir: string, relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, '/');
	if (
		normalized.startsWith('/')
		|| normalized.includes('../')
		|| normalized === '..'
	) {
		throw new Error(`Unsafe TikZJax asset path: ${relativePath}`);
	}

	return path.join(baseDir, normalized);
}

export function getTikzJaxTexFileNames(): string[] {
	return TIKZJAX_ASSET_NAMES.map(name => name);
}

export function writeBundledTikzJaxTexToDir(texDir: string): void {
	fs.mkdirSync(texDir, { recursive: true });

	for (const asset of BUNDLED_TEX_ASSETS) {
		const targetPath = safeJoin(texDir, asset.fileName);
		const nextBytes = decodeBase64(asset.base64);
		if (fs.existsSync(targetPath)) {
			const currentBytes = fs.readFileSync(targetPath);
			if (currentBytes.equals(nextBytes)) {
				continue;
			}
		}
		fs.writeFileSync(targetPath, nextBytes);
	}

	fs.writeFileSync(path.join(texDir, HASH_FILE), `${getBundledTikzJaxAssetHash()}\n`, 'utf8');
}

function texDirIsCurrent(texDir: string): boolean {
	const hashPath = path.join(texDir, HASH_FILE);
	if (!fs.existsSync(hashPath)) {
		return false;
	}

	try {
		const storedHash = fs.readFileSync(hashPath, 'utf8').trim();
		if (storedHash !== getBundledTikzJaxAssetHash()) {
			return false;
		}
	} catch {
		return false;
	}

	return getTikzJaxTexFileNames().every(fileName => fs.existsSync(path.join(texDir, fileName)));
}

export async function ensureTikzJaxTexExtracted(
	app: App,
	pluginId: string,
): Promise<{ ok: true; texDir: string } | { ok: false; error: string }> {
	const tempAdapterDir = getPluginTempDir(app, pluginId);
	const texAdapterDir = `${tempAdapterDir}/${TEX_SUBDIR}`;

	try {
		await ensureAdapterFolderExists(app, tempAdapterDir);
		await ensureAdapterFolderExists(app, texAdapterDir);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: `Could not create TikZJax temp directory: ${message}`,
		};
	}

	const texDir = getDesktopFsPath(app, texAdapterDir);
	if (!texDir) {
		return {
			ok: false,
			error: 'TikZJax requires desktop filesystem access.',
		};
	}

	try {
		if (!texDirIsCurrent(texDir)) {
			writeBundledTikzJaxTexToDir(texDir);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: `Could not extract bundled TikZJax TeX files: ${message}`,
		};
	}

	const activeWindow = typeof window !== 'undefined' ? window : undefined;
	if (activeWindow) {
		setTikzJaxTexDir(texDir, activeWindow);
	}

	return { ok: true, texDir };
}

export function bundledTikzJaxTexAssetFingerprint(): string {
	return createHash('sha256')
		.update(getBundledTikzJaxAssetHash())
		.digest('hex')
		.slice(0, 16);
}
