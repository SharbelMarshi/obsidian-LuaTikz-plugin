export type LuaTikzRenderEngine = 'lualatex' | 'tikzjax';

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
};
