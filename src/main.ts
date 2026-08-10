import { MarkdownRenderChild, MarkdownView, Notice, Plugin } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { formatExecError, killAllRunningCompiles } from './desktop/lualatexShell';
import { sweepStalePluginTempFsDirs } from './core/pluginPaths';
import { InstallNoticeModal } from './ui/installNoticeModal';
import { InlinePreviewManager } from './editor/inlinePreview';
import { latexAutocompleteExtension } from './editor/latexAutocomplete';
import { tikzIdeExtension } from './editor/tikzIdeGutter';
import { tikzErrorHighlightExtension } from './editor/tikzErrorHighlight';
import { tikzHoverHighlightExtension } from './editor/tikzHoverHighlight';
import { tikzFenceStarterExtension } from './editor/tikzFenceStarter';
import { tikzStructuralLintExtension } from './editor/tikzStructuralLint';
import { tikzSemicolonReminderExtension } from './editor/tikzSemicolonReminder';
import { tikzAutoCloseExtension } from './editor/tikzAutoClose';
import { tikzDrawStarterSemicolonExtension } from './editor/tikzDrawStarterSemicolon';
import { tikzCcycleExtension } from './editor/tikzCcycleExtension';
import {
	openCategoryPicker,
	openPlotWizard,
	runFormatTikzBlock,
	wrapSelectionInMath,
	wrapSelectionInNode,
} from './editor/tikzEditorCommands';
import {
	insertTemplateById,
	openHelperCheatsheet,
	openTemplatePicker,
} from './ui/tikzHelperCheatsheet';
import { TikzRenderer } from './render';
import {
	DEFAULT_SETTINGS,
	LuaTikzSettingTab,
	parseSettings,
	type LuaTikzSettings,
} from './settings/settings';
import {
	buildErrorHandlers,
	prepareTikzBlock,
	presentLoadingState,
	presentTikzBlock,
	renderPreparedTikz,
} from './core/tikzPipeline';
import { migrateDarkModeStyle } from './utils/darkMode';
import { clearTikzErrorHighlightForPath, showTikzErrorHighlightFromResult } from './editor/editorNavigation';
import { isMobileApp } from './utils/platform';
import { isObsidianDarkMode, watchObsidianDarkMode } from './utils/themeWatcher';
import { isRecord } from './utils/guards';

interface CodeMirrorModeInfo {
	name: string;
	mime: string;
	mode: string;
}

function getCodeMirror(): { modeInfo: CodeMirrorModeInfo[] } | null {
	const cm = (window as Window & { CodeMirror?: { modeInfo: unknown } }).CodeMirror;
	if (!cm || !Array.isArray(cm.modeInfo)) {
		return null;
	}
	return cm as { modeInfo: CodeMirrorModeInfo[] };
}

export function migrateLegacySettings(raw: unknown, parsed: Partial<LuaTikzSettings>): LuaTikzSettings {
	const merged: LuaTikzSettings = { ...DEFAULT_SETTINGS, ...parsed };
	if (isRecord(raw) && !('enableLocalShellRenderer' in raw) && !('renderEngine' in raw)) {
		merged.enableLocalShellRenderer = true;
		merged.showInstallNotice = false;
	}
	if (isRecord(raw) && !('darkModeStyle' in raw)) {
		merged.darkModeStyle = DEFAULT_SETTINGS.darkModeStyle;
	} else if (isRecord(raw) && typeof raw.darkModeStyle === 'string') {
		merged.darkModeStyle = migrateDarkModeStyle(raw.darkModeStyle);
	}
	if (isMobileApp) {
		merged.renderEngine = 'tikzjax';
		merged.enableLocalShellRenderer = false;
	}
	return merged;
}

function extensionList(extension: Extension): Extension[] {
	if (Array.isArray(extension)) {
		return extension as Extension[];
	}
	return [extension];
}

class TikzBlockRefresherCleanup extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly unregister: () => void,
	) {
		super(containerEl);
	}

	onunload(): void {
		this.unregister();
	}
}

export default class LuaTikzPlugin extends Plugin {
	settings: LuaTikzSettings = DEFAULT_SETTINGS;
	// Nullable rather than definite-assignment: onload() rethrows on failure,
	// and Obsidian still calls onunload() on the half-constructed plugin — a
	// `renderer!` there meant onunload itself threw and skipped cleanup.
	renderer: TikzRenderer | null = null;
	private inlinePreview: InlinePreviewManager | null = null;
	private tikzBlockRefreshers = new Set<() => void>();

	registerTikzBlockRefresher(refresh: () => void): () => void {
		this.tikzBlockRefreshers.add(refresh);
		return () => {
			this.tikzBlockRefreshers.delete(refresh);
		};
	}

	private refreshDiagramsForThemeChange(): void {
		for (const refresh of this.tikzBlockRefreshers) {
			refresh();
		}
		this.inlinePreview?.refreshForThemeChange();
	}

	async onload(): Promise<void> {
		try {
			await this.loadSettings();
			this.addSettingTab(new LuaTikzSettingTab(this.app, this));

			this.renderer = new TikzRenderer(
				this.app,
				this.manifest.id,
				this.manifest.version,
				isObsidianDarkMode,
				() => this.settings,
			);

			// A compile killed mid-flight (crash, force-quit) leaves its job dir
			// in the vault forever. Restored panes can already be compiling at
			// layout-ready (their cache entry may have been evicted), so only
			// job dirs old enough to be crash leftovers are swept — wiping the
			// whole temp dir here used to delete in-flight inputs and stick
			// blocks in a "….tex not found" error until a manual re-render.
			this.app.workspace.onLayoutReady(() => {
				void sweepStalePluginTempFsDirs(this.app, this.manifest.id);
			});
			this.inlinePreview = new InlinePreviewManager(
				() => this.app.workspace.getActiveViewOfType(MarkdownView),
				this.renderer,
				() => this.settings,
				isObsidianDarkMode,
				this.app,
			);

			this.registerEditorExtension([
				...extensionList(latexAutocompleteExtension()),
				...extensionList(tikzIdeExtension()),
				...tikzErrorHighlightExtension(),
				...tikzHoverHighlightExtension(),
				...extensionList(tikzFenceStarterExtension(() => this.settings.starterBlockOnNewFence)),
				...extensionList(tikzStructuralLintExtension(() => this.settings.enableStructuralLint)),
				...extensionList(tikzSemicolonReminderExtension(() => this.settings.semicolonReminderMode)),
				...extensionList(tikzAutoCloseExtension(() => this.settings.autoCloseBrackets)),
				...extensionList(tikzDrawStarterSemicolonExtension()),
				...extensionList(tikzCcycleExtension()),
			]);

			this.addCommand({
				id: 'toggle-tikz-inline-live-preview',
				name: 'Toggle inline live preview',
				callback: () => this.toggleInlineLivePreview(),
			});

			this.addCommand({
				id: 'open-tikz-helper-reference',
				name: 'Open helper reference',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					openHelperCheatsheet(this.app, view);
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-picker',
				name: 'Insert TikZ template…',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					openTemplatePicker(this.app, view);
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-blank',
				name: 'Insert TikZ template: blank tikzpicture',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(view, 'blank-tikzpicture');
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-flowchart',
				name: 'Insert TikZ template: flowchart (3 boxes)',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(view, 'flowchart-3');
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-axis',
				name: 'Insert TikZ template: empty PGFPlots axis',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(view, 'empty-axis');
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-logic',
				name: 'Insert TikZ template: logic circuit starter',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(view, 'logic-circuit');
				},
			});

			this.addCommand({
				id: 'format-tikz-block',
				name: 'Format TikZ block',
				callback: () => {
					runFormatTikzBlock(this.app.workspace.getActiveViewOfType(MarkdownView));
				},
			});

			this.addCommand({
				id: 'wrap-selection-in-node',
				name: 'Wrap selection in \\node{}',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) wrapSelectionInNode(view);
				},
			});

			this.addCommand({
				id: 'wrap-selection-in-math',
				name: 'Wrap selection in $...$',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) wrapSelectionInMath(view);
				},
			});

			this.addCommand({
				id: 'insert-plot-from-function',
				name: 'Insert plot from function…',
				callback: () => {
					openPlotWizard(this.app, this.app.workspace.getActiveViewOfType(MarkdownView));
				},
			});

			this.addCommand({
				id: 'tikz-category-picker',
				name: 'What can I use here?',
				callback: () => {
					openCategoryPicker(this.app, this.app.workspace.getActiveViewOfType(MarkdownView));
				},
			});

			this.registerEvent(this.app.workspace.on('editor-change', () => {
				this.inlinePreview?.scheduleUpdate();
			}));

			this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
				this.inlinePreview?.scheduleUpdate(0);
			}));

			this.registerDomEvent(activeDocument, 'selectionchange', () => {
				this.inlinePreview?.syncVisibility();
			});

			this.register(watchObsidianDarkMode(() => {
				this.refreshDiagramsForThemeChange();
			}));

			this.addSyntaxHighlighting();
			this.registerTikzCodeBlock('tikz');
			this.registerTikzCodeBlock('luatikz');

			if (this.settings.showInstallNotice) {
				this.app.workspace.onLayoutReady(() => {
					new InstallNoticeModal(this.app, this).open();
				});
			}

			// Enabled on mobile too: the visual Edit mode is a touch feature,
			// and the preview itself renders through TikZJax there.
			if (this.settings.inlineLivePreviewEnabledByDefault) {
				this.inlinePreview.enable(500);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.stack ?? error.message : String(error);
			console.error('LuaTikz failed to load:', message);
			throw error;
		}
	}

	onunload() {
		this.removeSyntaxHighlighting();
		this.inlinePreview?.disable();
		// dispose(), not invalidateCache(): unloading happens on every plugin
		// update, and it must not throw away the on-disk render cache.
		this.renderer?.dispose();
		killAllRunningCompiles();
	}

	async loadSettings() {
		const raw: unknown = await this.loadData();
		const parsed = parseSettings(raw);
		this.settings = migrateLegacySettings(raw, parsed);
	}

	registerTikzCodeBlock(language: string) {
		this.registerMarkdownCodeBlockProcessor(language, async (source, el, ctx) => {
			el.addClass('luatikz-render-wrapper');
			const prepared = prepareTikzBlock(source);
			presentLoadingState(el, prepared);

			const section = ctx.getSectionInfo(el);
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = view?.file?.path === ctx.sourcePath ? view.editor : undefined;
			const errorContext = section
				? {
					block: {
						source,
						startLine: section.lineStart,
						endLine: section.lineEnd,
					},
					editor,
				}
				: undefined;

			const render = async () => {
				const isDarkThemeNow = isObsidianDarkMode();
				try {
					if (!prepared.renderSource.trim()) {
						presentTikzBlock(el, prepared, {
							ok: false,
							error: 'Nothing to render.',
						}, this.settings, {
							isDarkTheme: isDarkThemeNow,
						});
						return;
					}

					if (!this.renderer) {
						return;
					}
					const result = await renderPreparedTikz(this.renderer, prepared, errorContext);
					const errorHandlers = buildErrorHandlers(this.app, ctx.sourcePath, result);
					if (!result.ok || !result.dataUrl) {
						const retry = result.timedOut
							? () => {
								presentLoadingState(el, prepared);
								void render();
							}
							: undefined;

						presentTikzBlock(el, prepared, result, this.settings, {
							...errorHandlers,
							onRetry: retry,
							isDarkTheme: isDarkThemeNow,
						});
						showTikzErrorHighlightFromResult(this.app, ctx.sourcePath, result);
						return;
					}

					presentTikzBlock(el, prepared, result, this.settings, {
						isDarkTheme: isDarkThemeNow,
					});
					if (ctx.sourcePath) {
						clearTikzErrorHighlightForPath(this.app, ctx.sourcePath);
					}
				} catch (err) {
					presentTikzBlock(el, prepared, {
						ok: false,
						error: 'Render failed.',
						rawLog: formatExecError(err),
					}, this.settings, {
						isDarkTheme: isDarkThemeNow,
					});
				}
			};

			const unregisterRefresher = this.registerTikzBlockRefresher(() => {
				void render();
			});
			ctx.addChild(new TikzBlockRefresherCleanup(el, unregisterRefresher));

			await render();
		});
	}

	toggleInlineLivePreview(): void {
		if (!this.inlinePreview) {
			return;
		}
		if (this.inlinePreview.enabled) {
			this.inlinePreview.disable();
			new Notice('Live preview off.');
			return;
		}
		this.inlinePreview.enable(0);
		new Notice('Live preview on.');
	}

	addSyntaxHighlighting() {
		const cm = getCodeMirror();
		if (!cm) {
			return;
		}
		if (!cm.modeInfo.some(entry => entry.name === 'Tikz')) {
			cm.modeInfo.push({ name: 'Tikz', mime: 'text/x-latex', mode: 'stex' });
		}
	}

	removeSyntaxHighlighting() {
		const cm = getCodeMirror();
		if (!cm) {
			return;
		}
		cm.modeInfo = cm.modeInfo.filter(el => el.name !== 'Tikz');
	}
}
