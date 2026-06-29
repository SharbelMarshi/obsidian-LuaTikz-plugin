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

export function getTikzJaxTexFileNames(): string[] {
	return Object.keys(TIKZJAX_TEX_ASSETS_BASE64);
}

export function writeBundledTikzJaxTexToDir(texDir: string): void {
	fs.mkdirSync(texDir, { recursive: true });

	for (const [fileName, encoded] of Object.entries(TIKZJAX_TEX_ASSETS_BASE64) as [string, string][]) {
		const targetPath = path.join(texDir, fileName);
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

	setTikzJaxTexDir(texDir);
	return { ok: true, texDir };
}

export function bundledTikzJaxTexAssetFingerprint(): string {
	return createHash('sha256')
		.update(TIKZJAX_TEX_ASSET_HASH)
		.digest('hex')
		.slice(0, 16);
}
