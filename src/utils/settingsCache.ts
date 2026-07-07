import type { LuaTikzSettings } from '../settings/settingsModel';

const RENDER_CACHE_KEYS = new Set<keyof LuaTikzSettings>([
	'renderEngine',
	'lualatexPath',
	'extraPreamble',
	'timeoutMs',
	'outputFormat',
	'darkModeStyle',
	'enableLocalShellRenderer',
]);

export function shouldClearRenderCacheOnSettingChange(key: keyof LuaTikzSettings): boolean {
	return RENDER_CACHE_KEYS.has(key);
}
