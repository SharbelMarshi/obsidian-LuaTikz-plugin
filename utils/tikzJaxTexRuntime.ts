import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { App } from 'obsidian';
import {
	TIKZJAX_TEX_ASSET_HASH,
	TIKZJAX_TEX_RUNTIME_DIR,
	TIKZJAX_TEX_RUNTIME_FILES,
	type TikzJaxTexRuntimeFile,
} from '../generated/tikzjaxTexAssets';
import {
	getDesktopFsPath,
	getPluginFsDir,
	getPluginTempDir,
	ensureAdapterFolderExists,
} from '../pluginPaths';
import { setTikzJaxTexDir } from './tikzJaxGlobal';

const TEX_SUBDIR = 'tikzjax-tex';
const HASH_FILE = '.luatikz-tex-hash';

function isTikzJaxTexRuntimeFile(value: string): value is TikzJaxTexRuntimeFile {
	return (TIKZJAX_TEX_RUNTIME_FILES as readonly string[]).includes(value);
}

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

function readAssetHashFile(hashPath: string): string | null {
	if (!fs.existsSync(hashPath)) {
		return null;
	}

	try {
		const storedHash = fs.readFileSync(hashPath, 'utf8').trim();
		return storedHash.length > 0 ? storedHash : null;
	} catch {
		return null;
	}
}

export function getTikzJaxTexFileNames(): readonly TikzJaxTexRuntimeFile[] {
	return TIKZJAX_TEX_RUNTIME_FILES;
}

function resolveBundledRuntimeDir(expectedHash: string): string | null {
	const candidate = path.join(process.cwd(), TIKZJAX_TEX_RUNTIME_DIR);
	if (hasRuntimeFilesAt(candidate, expectedHash)) {
		return candidate;
	}

	return null;
}

function hasRuntimeFilesAt(runtimeDir: string, expectedHash: string): boolean {
	return runtimeDirIsCurrent(runtimeDir, expectedHash);
}

function resolveInstalledRuntimeDir(app: App, pluginId: string, expectedHash: string): string | null {
	const pluginDir = getPluginFsDir(app, pluginId);
	if (!pluginDir) {
		return null;
	}

	const packagedDir = path.join(pluginDir, TIKZJAX_TEX_RUNTIME_DIR);
	if (hasRuntimeFilesAt(packagedDir, expectedHash)) {
		return packagedDir;
	}

	if (hasRuntimeFilesAt(pluginDir, expectedHash)) {
		return pluginDir;
	}

	return null;
}

function runtimeDirIsCurrent(runtimeDir: string, expectedHash: string): boolean {
	const storedHash = readAssetHashFile(path.join(runtimeDir, HASH_FILE));
	if (storedHash !== expectedHash) {
		return false;
	}

	return TIKZJAX_TEX_RUNTIME_FILES.every(fileName => fs.existsSync(path.join(runtimeDir, fileName)));
}

function copyRuntimeDir(sourceDir: string, targetDir: string, expectedHash: string): void {
	fs.mkdirSync(targetDir, { recursive: true });

	for (const fileName of TIKZJAX_TEX_RUNTIME_FILES) {
		if (!isTikzJaxTexRuntimeFile(fileName)) {
			continue;
		}

		const sourcePath = safeJoin(sourceDir, fileName);
		const targetPath = safeJoin(targetDir, fileName);
		const nextBytes = fs.readFileSync(sourcePath);
		if (fs.existsSync(targetPath)) {
			const currentBytes = fs.readFileSync(targetPath);
			if (currentBytes.equals(nextBytes)) {
				continue;
			}
		}
		fs.writeFileSync(targetPath, nextBytes);
	}

	const hashPath = safeJoin(targetDir, HASH_FILE);
	fs.writeFileSync(hashPath, `${expectedHash}\n`, 'utf8');
}

export async function ensureTikzJaxTexExtracted(
	app: App,
	pluginId: string,
): Promise<{ ok: true; texDir: string } | { ok: false; error: string }> {
	const expectedHash = TIKZJAX_TEX_ASSET_HASH;
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

	const sourceDir = resolveInstalledRuntimeDir(app, pluginId, expectedHash)
		?? resolveBundledRuntimeDir(expectedHash);
	if (!sourceDir) {
		return {
			ok: false,
			error: 'TikZJax runtime files are missing from the installed plugin folder.',
		};
	}

	try {
		if (!runtimeDirIsCurrent(texDir, expectedHash)) {
			copyRuntimeDir(sourceDir, texDir, expectedHash);
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
		.update(TIKZJAX_TEX_ASSET_HASH)
		.digest('hex')
		.slice(0, 16);
}
