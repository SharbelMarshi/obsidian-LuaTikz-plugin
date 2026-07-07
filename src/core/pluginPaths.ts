import { normalizePath, type App } from 'obsidian';

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

/** Absolute filesystem path to the installed plugin folder. */
export function getPluginFsDir(app: App, pluginId: string): string | null {
	const basePath = getVaultBasePath(app);
	if (!basePath) {
		return null;
	}

	return normalizePath(`${basePath}/${app.vault.configDir}/plugins/${pluginId}`);
}

export function getDesktopFsPath(app: App, adapterPath: string): string | null {
	const basePath = getVaultBasePath(app);
	if (!basePath) {
		return null;
	}

	return normalizePath(`${basePath}/${adapterPath}`);
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

async function removeAdapterTree(app: App, folderPath: string): Promise<void> {
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
	for (const folder of [...listing.folders].reverse()) {
		try {
			await adapter.remove(folder);
		} catch {
			// ignore cleanup errors
		}
	}
}

export async function clearPluginTempFsDir(app: App, pluginId: string): Promise<void> {
	const tempAdapterDir = getPluginTempDir(app, pluginId);
	await removeAdapterTree(app, tempAdapterDir);

	try {
		await ensureAdapterFolderExists(app, tempAdapterDir);
	} catch {
		// ignore re-create errors after clear
	}
}
