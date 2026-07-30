import { RENDER_IDENTITY_KEYS, type LuaTikzSettings } from '../settings/settingsModel';

const RENDER_CACHE_KEYS = new Set<keyof LuaTikzSettings>([
	...RENDER_IDENTITY_KEYS,
	'renderEngine',
	'enableLocalShellRenderer',
]);

export function shouldClearRenderCacheOnSettingChange(key: keyof LuaTikzSettings): boolean {
	return RENDER_CACHE_KEYS.has(key);
}
