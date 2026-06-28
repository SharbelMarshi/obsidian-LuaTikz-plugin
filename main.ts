import { MarkdownView, Notice, Plugin } from 'obsidian';
import { renderTikzDiagram, showTikzError } from './diagramView';
import { InlinePreviewManager } from './inlinePreview';
import { latexAutocompleteExtension } from './latexAutocomplete';
import { formatExecError } from './commandResolver';
import { TikzRenderer } from './renderer';
import {
	DEFAULT_SETTINGS,
	TikzjaxSettingTab,
	type TikzjaxPluginSettings,
} from './settings';
import { tidyTikzSource } from './tikzSource';

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

function parseSettings(data: unknown): Partial<TikzjaxPluginSettings> {
	if (typeof data !== 'object' || data === null) {
		return {};
	}
	const saved = data as Record<string, unknown>;
	const parsed: Partial<TikzjaxPluginSettings> = {};
	if (typeof saved.invertColorsInDarkMode === 'boolean') {
		parsed.invertColorsInDarkMode = saved.invertColorsInDarkMode;
	}
	if (typeof saved.inlineLivePreviewEnabledByDefault === 'boolean') {
		parsed.inlineLivePreviewEnabledByDefault = saved.inlineLivePreviewEnabledByDefault;
	}
	return parsed;
}

export default class LuaTikzPlugin extends Plugin {
	settings: TikzjaxPluginSettings = DEFAULT_SETTINGS;
	private renderer!: TikzRenderer;
	private inlinePreview!: InlinePreviewManager;

	async onload() {
		await this.loadSettings();

		this.renderer = new TikzRenderer(
			() => this.settings.invertColorsInDarkMode,
			() => activeDocument.body.classList.contains('theme-dark'),
		);
		this.inlinePreview = new InlinePreviewManager(
			() => this.app.workspace.getActiveViewOfType(MarkdownView),
			this.renderer,
		);

		this.registerEditorExtension(latexAutocompleteExtension());

		this.addCommand({
			id: 'toggle-tikz-inline-live-preview',
			name: 'Toggle inline live preview',
			callback: () => this.toggleInlineLivePreview(),
		});

		this.registerEvent(this.app.workspace.on('editor-change', () => {
			this.inlinePreview.scheduleUpdate();
		}));

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.inlinePreview.scheduleUpdate();
		}));

		this.registerDomEvent(activeDocument, 'selectionchange', () => {
			this.inlinePreview.scheduleUpdate();
		});

		this.addSettingTab(new TikzjaxSettingTab(this.app, this));
		this.addSyntaxHighlighting();
		this.registerTikzCodeBlock();

		if (this.settings.inlineLivePreviewEnabledByDefault) {
			this.inlinePreview.enable(500);
		}
	}

	onunload() {
		this.removeSyntaxHighlighting();
		this.inlinePreview.disable();
		this.inlinePreview.clearTimer();
		this.renderer.clearCache();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, parseSettings(await this.loadData()));
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.renderer.clearCache();
	}

	registerTikzCodeBlock() {
		this.registerMarkdownCodeBlockProcessor('tikz', async (source, el) => {
			el.empty();
			el.createDiv({ cls: 'tikzjax-hebrew-local-output', text: 'Rendering…' });

			const render = async () => {
				try {
					const cleaned = tidyTikzSource(source);
					if (!cleaned.trim()) {
						showTikzError(el, 'Nothing to render.');
						return;
					}

					const result = await this.renderer.renderToSvg(cleaned);
					if (!result.ok || !result.dataUrl || !result.svgText) {
						const retry = result.timedOut
							? () => {
								el.empty();
								el.createDiv({ cls: 'tikzjax-hebrew-local-output', text: 'Rendering…' });
								void render();
							}
							: undefined;
						showTikzError(el, result.error ?? 'Render failed.', result.rawLog, retry);
						return;
					}

					renderTikzDiagram(el, result);
				} catch (err) {
					showTikzError(el, 'Render failed.', formatExecError(err));
				}
			};

			await render();
		});
	}

	toggleInlineLivePreview(): void {
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
		cm.modeInfo.push({ name: 'Tikz', mime: 'text/x-latex', mode: 'stex' });
	}

	removeSyntaxHighlighting() {
		const cm = getCodeMirror();
		if (!cm) {
			return;
		}
		cm.modeInfo = cm.modeInfo.filter(el => el.name !== 'Tikz');
	}
}
