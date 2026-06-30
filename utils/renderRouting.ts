import type { LuaTikzSettings } from '../settingsModel';
import { validateLualatexPath } from './guards';
import { containsArabicContent } from './rtlDetection';

export const ARABIC_REQUIRES_LUALATEX_ERROR =
	'Arabic RTL text requires Local LuaLaTeX. TikZJax cannot reliably shape Arabic text. Enable Local LuaLaTeX in LuaTikz settings.';

export function canUseLocalLuaLatex(settings: LuaTikzSettings): boolean {
	if (!settings.enableLocalShellRenderer) {
		return false;
	}
	return validateLualatexPath(settings.lualatexPath) === null;
}

/** When TikZJax is selected, decide whether to fall back, error, or proceed. */
export function resolveTikzJaxDispatch(
	source: string,
	settings: LuaTikzSettings,
): 'tikzjax' | 'lualatex-fallback' | 'arabic-error' {
	if (!containsArabicContent(source)) {
		return 'tikzjax';
	}
	if (canUseLocalLuaLatex(settings)) {
		return 'lualatex-fallback';
	}
	return 'arabic-error';
}
