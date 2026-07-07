import { MarkdownRenderChild, MarkdownView, Notice, Plugin } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { formatExecError } from './core/commandResolver';
import { InstallNoticeModal } from './ui/installNoticeModal';
import { InlinePreviewManager } from './editor/inlinePreview';
import { latexAutocompleteExtension } from './editor/latexAutocomplete';
import { tikzIdeExtension } from './editor/tikzIdeGutter';
import { tikzErrorHighlightExtension } from './editor/tikzErrorHighlight';
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

function migrateLegacySettings(raw: unknown, parsed: Partial<LuaTikzSettings>): LuaTikzSettings {
	const merged = Object.assign({}, DEFAULT_SETTINGS, parsed) as LuaTikzSettings;
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

function flattenExtensions(...extensions: Extension[]): Extension[] {
	const flat: Extension[] = [];
	for (const extension of extensions) {
		if (Array.isArray(extension)) {
			flat.push(...extension);
			continue;
		}
		flat.push(extension);
	}
	return flat;
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
	renderer!: TikzRenderer;
	private inlinePreview!: InlinePreviewManager;
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
		this.inlinePreview.refreshForThemeChange();
	}

	async onload(): Promise<void> {
		try {
			await this.loadSettings();
			this.addSettingTab(new LuaTikzSettingTab(this.app, this));

			this.renderer = new TikzRenderer(
				this.app,
				this.manifest.id,
				isObsidianDarkMode,
				() => this.settings,
			);
			this.inlinePreview = new InlinePreviewManager(
				() => this.app.workspace.getActiveViewOfType(MarkdownView),
				this.renderer,
				() => this.settings,
				isObsidianDarkMode,
				this.app,
			);

			this.registerEditorExtension(flattenExtensions(
				latexAutocompleteExtension(),
				tikzIdeExtension(),
				tikzErrorHighlightExtension(),
				tikzFenceStarterExtension(() => this.settings.starterBlockOnNewFence),
				tikzStructuralLintExtension(() => this.settings.enableStructuralLint),
				tikzSemicolonReminderExtension(() => this.settings.semicolonReminderMode),
				tikzAutoCloseExtension(() => this.settings.autoCloseBrackets),
				tikzDrawStarterSemicolonExtension(),
				tikzCcycleExtension(),
			));

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
					insertTemplateById(this.app, view, 'blank-tikzpicture');
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-flowchart',
				name: 'Insert TikZ template: flowchart (3 boxes)',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(this.app, view, 'flowchart-3');
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-axis',
				name: 'Insert TikZ template: empty PGFPlots axis',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(this.app, view, 'empty-axis');
				},
			});

			this.addCommand({
				id: 'insert-tikz-template-logic',
				name: 'Insert TikZ template: logic circuit starter',
				callback: () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					insertTemplateById(this.app, view, 'logic-circuit');
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
				this.inlinePreview.scheduleUpdate();
			}));

			this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
				this.inlinePreview.scheduleUpdate(0);
			}));

			this.registerDomEvent(activeDocument, 'selectionchange', () => {
				this.inlinePreview.syncVisibility();
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

			if (!isMobileApp && this.settings.inlineLivePreviewEnabledByDefault) {
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
		this.inlinePreview.disable();
		this.inlinePreview.clearTimer();
		this.renderer.clearCache();
	}

	async loadSettings() {
		const raw: unknown = await this.loadData();
		const parsed = parseSettings(raw);
		this.settings = migrateLegacySettings(raw, parsed);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	registerTikzCodeBlock(language: string) {
		this.registerMarkdownCodeBlockProcessor(language, async (source, el, ctx) => {
			el.addClass('luatikz-render-wrapper');
			const prepared = prepareTikzBlock(source);
			presentLoadingState(el, prepared, source);

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
							source: prepared.renderSource,
							isDarkTheme: isDarkThemeNow,
						});
						return;
					}

					const result = await renderPreparedTikz(this.renderer, prepared, errorContext);
					const errorHandlers = buildErrorHandlers(this.app, ctx.sourcePath, result);
					if (!result.ok || !result.dataUrl) {
						const retry = result.timedOut
							? () => {
								presentLoadingState(el, prepared, source);
								void render();
							}
							: undefined;

						presentTikzBlock(el, prepared, result, this.settings, {
							source: prepared.renderSource,
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
						source,
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
		if (isMobileApp) {
			new Notice('Inline live preview is available on desktop Obsidian.');
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
