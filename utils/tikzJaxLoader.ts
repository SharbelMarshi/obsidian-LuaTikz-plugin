import * as fs from 'fs';
import * as path from 'path';
import type { App } from 'obsidian';
import { getPluginFsDir } from '../pluginPaths';
import { isCallable, isRecord } from './guards';

let tikzJaxModulePromise: Promise<unknown> | null = null;

function requireModule(modulePath: string): unknown {
	// Obsidian loads plugin assets from the install folder via Node require().
	const nodeRequire = require as NodeRequire;
	return nodeRequire(modulePath);
}

function resolveBundledTikzJaxPath(): string | null {
	const candidates = [
		path.join(process.cwd(), 'tikzjax.js'),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
}

export async function loadTikzJaxModule(app: App, pluginId: string): Promise<unknown> {
	if (tikzJaxModulePromise === null) {
		tikzJaxModulePromise = loadTikzJaxModuleInternal(app, pluginId);
	}

	return tikzJaxModulePromise;
}

async function loadTikzJaxModuleInternal(app: App, pluginId: string): Promise<unknown> {
	const pluginDir = getPluginFsDir(app, pluginId);
	const modulePath = pluginDir
		? path.join(pluginDir, 'tikzjax.js')
		: resolveBundledTikzJaxPath();

	if (!modulePath || !fs.existsSync(modulePath)) {
		throw new Error('Bundled TikZJax module (tikzjax.js) was not found.');
	}

	return requireModule(modulePath);
}

export function resetTikzJaxModuleCache(): void {
	tikzJaxModulePromise = null;
}

export async function invokeTikzJaxLoadHook(moduleValue: unknown): Promise<void> {
	if (!isRecord(moduleValue)) {
		return;
	}

	const load = moduleValue.load;
	if (isCallable(load)) {
		await load();
	}
}
