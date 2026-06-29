import { MarkdownView, Notice, Plugin } from 'obsidian';
import { renderTikzDiagram, showTikzError } from './diagramView';
import { InstallNoticeModal } from './installNoticeModal';
import { InlinePreviewManager } from './inlinePreview';
import { latexAutocompleteExtension } from './latexAutocomplete';
import { formatExecError } from './commandResolver';
import { TikzRenderer } from './renderer';
import {
	DEFAULT_SETTINGS,
	LuaTikzSettingTab,
	parseSettings,
	type LuaTikzSettings,
} from './settings';
import { tidyTikzSource } from './tikzSource';
import { applyRtlToContainer } from './utils/rtl';
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
	return merged;
}

export default class LuaTikzPlugin extends Plugin {
	settings: LuaTikzSettings = DEFAULT_SETTINGS;
	renderer!: TikzRenderer;
	private inlinePreview!: InlinePreviewManager;

	async onload() {
		await this.loadSettings();

		this.renderer = new TikzRenderer(
			this.app,
			this.manifest.id,
			() => activeDocument.body.classList.contains('theme-dark'),
			() => this.settings,
		);
		this.inlinePreview = new InlinePreviewManager(
			() => this.app.workspace.getActiveViewOfType(MarkdownView),
			this.renderer,
			() => this.settings,
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
			this.inlinePreview.scheduleUpdate(0);
		}));

		this.registerDomEvent(activeDocument, 'selectionchange', () => {
			this.inlinePreview.syncVisibility();
		});

		this.addSettingTab(new LuaTikzSettingTab(this.app, this));
		this.addSyntaxHighlighting();
		this.registerTikzCodeBlock('tikz');
		this.registerTikzCodeBlock('luatikz');

		if (this.settings.showInstallNotice) {
			this.app.workspace.onLayoutReady(() => {
				new InstallNoticeModal(this.app, this).open();
			});
		}

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
		const raw: unknown = await this.loadData();
		const parsed = parseSettings(raw);
		this.settings = migrateLegacySettings(raw, parsed);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.renderer.clearCache();
	}

	registerTikzCodeBlock(language: string) {
		this.registerMarkdownCodeBlockProcessor(language, async (source, el) => {
			el.empty();
			const loading = el.createDiv({
				cls: 'tikzjax-hebrew-local-output luatikz-glass-card',
				text: 'Rendering…',
			});
			applyRtlToContainer(loading, source);

			const render = async () => {
				try {
					const cleaned = tidyTikzSource(source);
					if (!cleaned.trim()) {
						showTikzError(el, 'Nothing to render.', undefined, undefined, cleaned, this.settings);
						return;
					}

					const result = await this.renderer.renderToSvg(cleaned);
					if (!result.ok || !result.dataUrl) {
						const retry = result.timedOut
							? () => {
								el.empty();
								el.createDiv({
									cls: 'tikzjax-hebrew-local-output luatikz-glass-card',
									text: 'Rendering…',
								});
								void render();
							}
							: undefined;
						showTikzError(
							el,
							result.error ?? 'Render failed.',
							result.rawLog,
							retry,
							cleaned,
							this.settings,
						);
						return;
					}

					renderTikzDiagram(el, result, cleaned, this.settings);
				} catch (err) {
					showTikzError(el, 'Render failed.', formatExecError(err), undefined, source, this.settings);
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
