import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { App } from 'obsidian';
import {
	TIKZJAX_TEX_ASSET_HASH,
	TIKZJAX_TEX_ASSETS_BASE64,
} from '../generated/tikzjaxTexAssets';
import { getDesktopFsPath, getPluginTempDir, ensureAdapterFolderExists } from '../pluginPaths';
import { setTikzJaxTexDir } from './tikzJaxGlobal';

const TEX_SUBDIR = 'tikzjax-tex';
const HASH_FILE = '.luatikz-tex-hash';
const TIKZJAX_TEX_ASSETS: Record<string, string> = TIKZJAX_TEX_ASSETS_BASE64;

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
	return Object.keys(TIKZJAX_TEX_ASSETS);
}

export function writeBundledTikzJaxTexToDir(texDir: string): void {
	fs.mkdirSync(texDir, { recursive: true });

	for (const fileName of Object.keys(TIKZJAX_TEX_ASSETS)) {
		const encoded = TIKZJAX_TEX_ASSETS[fileName];
		if (typeof encoded !== 'string') {
			continue;
		}

		const targetPath = safeJoin(texDir, fileName);
		const nextBytes = Buffer.from(encoded, 'base64');
		if (fs.existsSync(targetPath)) {
			const currentBytes = fs.readFileSync(targetPath);
			if (currentBytes.equals(nextBytes)) {
				continue;
			}
		}
		fs.writeFileSync(targetPath, nextBytes);
	}

	fs.writeFileSync(path.join(texDir, HASH_FILE), TIKZJAX_TEX_ASSET_HASH, 'utf8');
}

function texDirIsCurrent(texDir: string): boolean {
	const hashPath = path.join(texDir, HASH_FILE);
	if (!fs.existsSync(hashPath)) {
		return false;
	}

	try {
		const storedHash = fs.readFileSync(hashPath, 'utf8').trim();
		if (storedHash !== TIKZJAX_TEX_ASSET_HASH) {
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
	const assetHash: string = TIKZJAX_TEX_ASSET_HASH;
	return createHash('sha256')
		.update(assetHash)
		.digest('hex')
		.slice(0, 16);
}
