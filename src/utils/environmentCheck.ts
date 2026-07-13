import { resolveLuaLatex, resolvePdfToCairo } from '../core/commandResolver';
import type { LuaTikzSettings } from '../settings/settingsModel';

export interface ToolCheckResult {
	found: boolean;
	path: string | null;
	label: string;
	installHint?: string;
}

export interface EnvironmentReport {
	lualatex: ToolCheckResult;
	pdftocairo: ToolCheckResult;
	platform: NodeJS.Platform;
	summary: string;
	readyForLuaLatex: boolean;
}

function macInstallHints(): { poppler: string; tex: string } {
	return {
		poppler: 'brew install poppler',
		tex: 'Install MacTeX from https://tug.org/mactex/ or run: brew install --cask mactex',
	};
}

function linuxInstallHints(): { poppler: string; tex: string } {
	return {
		poppler: 'sudo apt install poppler-utils  (Debian/Ubuntu) or your distro equivalent',
		tex: 'Install TeX Live: sudo apt install texlive-full',
	};
}

function windowsInstallHints(): { poppler: string; tex: string } {
	return {
		poppler: 'Install poppler for Windows and add pdftocairo to PATH',
		tex: 'Install MiKTeX or TeX Live for Windows',
	};
}

/**
 * Read the platform from the runtime global rather than the bare `process`
 * identifier: the bundle injects a browser process shim for mobile, and this
 * desktop-only check must keep seeing Electron's real process object.
 */
function desktopPlatform(): NodeJS.Platform {
	const runtimeProcess = (globalThis as { process?: { platform?: NodeJS.Platform } }).process;
	return runtimeProcess?.platform ?? 'darwin';
}

function hintsForPlatform(): { poppler: string; tex: string } {
	switch (desktopPlatform()) {
		case 'darwin':
			return macInstallHints();
		case 'win32':
			return windowsInstallHints();
		default:
			return linuxInstallHints();
	}
}

export async function checkEnvironment(settings: LuaTikzSettings): Promise<EnvironmentReport> {
	const hints = hintsForPlatform();
	const lualatexPath = await resolveLuaLatex(settings.lualatexPath);
	const pdftocairoPath = await resolvePdfToCairo();

	const lualatex: ToolCheckResult = {
		label: 'LuaLaTeX',
		found: lualatexPath !== null,
		path: lualatexPath,
		installHint: lualatexPath ? undefined : hints.tex,
	};

	const pdftocairo: ToolCheckResult = {
		label: 'pdftocairo',
		found: pdftocairoPath !== null,
		path: pdftocairoPath,
		installHint: pdftocairoPath ? undefined : hints.poppler,
	};

	const readyForLuaLatex = lualatex.found && pdftocairo.found;
	const summary = readyForLuaLatex
		? 'Local LuaLaTeX rendering is ready.'
		: [
			lualatex.found ? null : 'LuaLaTeX is missing.',
			pdftocairo.found ? null : 'pdftocairo is missing (needed for SVG/PNG export).',
			'You can still use the TikZJax renderer without a local TeX install.',
		].filter(Boolean).join(' ');

	return {
		lualatex,
		pdftocairo,
		platform: desktopPlatform(),
		summary,
		readyForLuaLatex,
	};
}

export const TEST_RENDER_SOURCE = String.raw`\begin{tikzpicture}
\draw (0,0) circle (0.8);
\node at (0,0) {OK};
\end{tikzpicture}`;
