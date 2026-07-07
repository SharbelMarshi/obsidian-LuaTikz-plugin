import { Platform } from 'obsidian';
import type { LuaTikzRenderEngine, LuaTikzSettings } from '../settings/settingsModel';

export const isMobileApp = Platform.isMobileApp;

/** Mobile always uses TikZJax; desktop respects user choice. */
export function resolveRenderEngine(settings: LuaTikzSettings): LuaTikzRenderEngine {
	if (isMobileApp) {
		return 'tikzjax';
	}
	return settings.renderEngine;
}
