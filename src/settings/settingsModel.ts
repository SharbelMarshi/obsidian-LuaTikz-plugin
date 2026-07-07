export type LuaTikzRenderEngine = 'lualatex' | 'tikzjax';
export type DarkModeStyle = 'auto-invert' | 'brightness-boost' | 'none';

export type SemicolonReminderMode = 'off' | 'hint' | 'auto-append';

export interface LuaTikzSettings {
	renderEngine: LuaTikzRenderEngine;
	lualatexPath: string;
	enableLocalShellRenderer: boolean;
	showInstallNotice: boolean;
	outputFormat: 'svg' | 'png';
	timeoutMs: number;
	cacheEnabled: boolean;
	extraPreamble: string;
	inlineLivePreviewEnabledByDefault: boolean;
	darkModeStyle: DarkModeStyle;
	starterBlockOnNewFence: boolean;
	enableStructuralLint: boolean;
	semicolonReminderMode: SemicolonReminderMode;
	autoCloseBrackets: boolean;
}

export const DEFAULT_SETTINGS: LuaTikzSettings = {
	renderEngine: 'lualatex',
	lualatexPath: '/Library/TeX/texbin/lualatex',
	enableLocalShellRenderer: true,
	showInstallNotice: true,
	outputFormat: 'svg',
	timeoutMs: 15000,
	cacheEnabled: true,
	extraPreamble: '',
	inlineLivePreviewEnabledByDefault: true,
	darkModeStyle: 'auto-invert',
	starterBlockOnNewFence: true,
	enableStructuralLint: true,
	semicolonReminderMode: 'hint',
	autoCloseBrackets: true,
};
