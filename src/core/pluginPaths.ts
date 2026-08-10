import { normalizePath, type App } from 'obsidian';
import { desktopFsExists, desktopFsReadText } from '../desktop/lualatexShell';

export function getPluginDir(app: App, pluginId: string): string {
	return normalizePath(`${app.vault.configDir}/plugins/${pluginId}`);
}

export function getPluginTempDir(app: App, pluginId: string): string {
	return normalizePath(`${getPluginDir(app, pluginId)}/.luatikz-temp`);
}

export function getPluginCacheDir(app: App, pluginId: string): string {
	return normalizePath(`${getPluginDir(app, pluginId)}/.luatikz-cache`);
}

export function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter as {
		basePath?: string;
		getBasePath?: () => string;
	};

	if (typeof adapter.basePath === 'string' && adapter.basePath.length > 0) {
		return adapter.basePath;
	}

	if (typeof adapter.getBasePath === 'function') {
		const resolved = adapter.getBasePath();
		if (typeof resolved === 'string' && resolved.length > 0) {
			return resolved;
		}
	}

	return null;
}

export function getDesktopFsPath(app: App, adapterPath: string): string | null {
	const normalized = normalizePath(adapterPath);
	const adapter = app.vault.adapter as {
		getFullPath?: (path: string) => string;
	};

	if (typeof adapter.getFullPath === 'function') {
		try {
			return adapter.getFullPath(normalized);
		} catch {
			// fall through
		}
	}

	const basePath = getVaultBasePath(app);
	if (!basePath) {
		return null;
	}

	const posix = `${basePath.replace(/\\/g, '/').replace(/\/+$/, '')}/${normalized}`;
	return posix.replace(/\/+/g, '/');
}

export async function ensureAdapterFolderExists(app: App, folderPath: string): Promise<void> {
	const normalized = normalizePath(folderPath);
	if (await app.vault.adapter.exists(normalized)) {
		return;
	}

	const parts = normalized.split('/').filter(part => part.length > 0);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await app.vault.adapter.exists(current))) {
			await app.vault.adapter.mkdir(current);
		}
	}
}

export async function ensurePluginTempFsDir(
	app: App,
	pluginId: string,
): Promise<{ ok: true; workDir: string } | { ok: false; error: string }> {
	const pluginAdapterDir = getPluginDir(app, pluginId);
	const tempAdapterDir = getPluginTempDir(app, pluginId);

	try {
		await ensureAdapterFolderExists(app, pluginAdapterDir);
		await ensureAdapterFolderExists(app, tempAdapterDir);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: `Could not create LuaTikz temp directory: ${message}`,
		};
	}

	const workDir = getDesktopFsPath(app, tempAdapterDir);
	if (!workDir) {
		return {
			ok: false,
			error: 'Local LuaLaTeX rendering requires desktop filesystem access.',
		};
	}

	return { ok: true, workDir };
}

export async function adapterOrDesktopExists(app: App, adapterPath: string): Promise<boolean> {
	if (await app.vault.adapter.exists(adapterPath)) {
		return true;
	}
	const fsPath = getDesktopFsPath(app, adapterPath);
	return fsPath ? desktopFsExists(fsPath) : false;
}

export async function readAdapterLogTail(
	app: App,
	adapterPath: string,
	maxChars = 8000,
): Promise<string> {
	if (await app.vault.adapter.exists(adapterPath)) {
		const log = await app.vault.adapter.read(adapterPath);
		return log.length <= maxChars ? log : `...(truncated)...\n${log.slice(-maxChars)}`;
	}

	const fsPath = getDesktopFsPath(app, adapterPath);
	if (fsPath) {
		return desktopFsReadText(fsPath, maxChars);
	}
	return '';
}

/**
 * Depth-first recursive delete of a folder's contents and the folder itself.
 * adapter.list() is one level deep, so the old single-pass version left any
 * nested subdirectory (and everything in it) behind, silently, forever.
 */
export async function removeAdapterFolder(app: App, folderPath: string): Promise<void> {
	const adapter = app.vault.adapter;
	if (!(await adapter.exists(folderPath))) {
		return;
	}

	const listing = await adapter.list(folderPath);
	for (const file of listing.files) {
		try {
			await adapter.remove(file);
		} catch {
			// ignore cleanup errors
		}
	}
	for (const folder of listing.folders) {
		await removeAdapterFolder(app, folder);
	}
	try {
		await adapter.rmdir(folderPath, false);
	} catch {
		// ignore cleanup errors
	}
}

export async function clearPluginTempFsDir(app: App, pluginId: string): Promise<void> {
	const tempAdapterDir = getPluginTempDir(app, pluginId);
	await removeAdapterFolder(app, tempAdapterDir);

	try {
		await ensureAdapterFolderExists(app, tempAdapterDir);
	} catch {
		// ignore re-create errors after clear
	}
}

/**
 * Age-gated sweep of leftover compile job dirs for the startup path.
 *
 * The old startup cleanup wiped the whole temp dir on layout-ready under the
 * assumption that "no compile can be running this early" — false: restored
 * panes whose disk-cache entry was evicted start compiling immediately, and
 * the sweep deleted their job dirs mid-compile ("….tex not found" until a
 * manual re-render). Only entries older than `olderThanMs` — genuine
 * leftovers of a crashed session — are removed now.
 */
export async function sweepStalePluginTempFsDirs(
	app: App,
	pluginId: string,
	olderThanMs = 10 * 60 * 1000,
): Promise<void> {
	const adapter = app.vault.adapter;
	const tempAdapterDir = getPluginTempDir(app, pluginId);
	try {
		if (!(await adapter.exists(tempAdapterDir))) {
			return;
		}
		const listing = await adapter.list(tempAdapterDir);
		const now = Date.now();
		const isStale = async (path: string): Promise<boolean> => {
			try {
				const stat = await adapter.stat(path);
				return !stat || now - (stat.mtime || stat.ctime || 0) > olderThanMs;
			} catch {
				return false;
			}
		};
		for (const folder of listing.folders) {
			if (await isStale(folder)) {
				await removeAdapterFolder(app, folder);
			}
		}
		for (const file of listing.files) {
			if (await isStale(file)) {
				try {
					await adapter.remove(file);
				} catch {
					// ignore cleanup errors
				}
			}
		}
	} catch {
		// best-effort housekeeping
	}
}
