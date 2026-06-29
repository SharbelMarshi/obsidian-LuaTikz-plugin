import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import LuaTikzPlugin from './main';
import { DEFAULT_SETTINGS, type LuaTikzRenderEngine, type LuaTikzSettings } from './settingsModel';
import { asBoolean, asNumber, asString, isRecord } from './utils/guards';

function parseRenderEngine(value: unknown): LuaTikzRenderEngine | undefined {
	return value === 'lualatex' || value === 'tikzjax' ? value : undefined;
}

function parseOutputFormat(value: unknown): LuaTikzSettings['outputFormat'] | undefined {
	return value === 'svg' || value === 'png' ? value : undefined;
}

export function parseSettings(data: unknown): Partial<LuaTikzSettings> {
	if (!isRecord(data)) {
		return {};
	}

	const parsed: Partial<LuaTikzSettings> = {};
	const renderEngine = parseRenderEngine(data.renderEngine);
	if (renderEngine) {
		parsed.renderEngine = renderEngine;
	}
	parsed.lualatexPath = asString(data.lualatexPath, DEFAULT_SETTINGS.lualatexPath);
	parsed.enableLocalShellRenderer = asBoolean(
		data.enableLocalShellRenderer,
		DEFAULT_SETTINGS.enableLocalShellRenderer,
	);
	parsed.showInstallNotice = asBoolean(data.showInstallNotice, DEFAULT_SETTINGS.showInstallNotice);
	parsed.enableClipboardCopy = asBoolean(
		data.enableClipboardCopy,
		DEFAULT_SETTINGS.enableClipboardCopy,
	);
	const outputFormat = parseOutputFormat(data.outputFormat);
	if (outputFormat) {
		parsed.outputFormat = outputFormat;
	}
	parsed.timeoutMs = asNumber(data.timeoutMs, DEFAULT_SETTINGS.timeoutMs);
	parsed.cacheEnabled = asBoolean(data.cacheEnabled, DEFAULT_SETTINGS.cacheEnabled);
	parsed.extraPreamble = asString(data.extraPreamble, DEFAULT_SETTINGS.extraPreamble);
	parsed.inlineLivePreviewEnabledByDefault = asBoolean(
		data.inlineLivePreviewEnabledByDefault,
		DEFAULT_SETTINGS.inlineLivePreviewEnabledByDefault,
	);

	return parsed;
}

export class LuaTikzSettingTab extends PluginSettingTab {
	plugin: LuaTikzPlugin;

	constructor(app: App, plugin: LuaTikzPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('luatikz-settings-root');

		const header = containerEl.createDiv({ cls: 'luatikz-glass-header' });
		header.createEl('h2', { text: 'LuaTikz' });
		header.createEl('p', {
			cls: 'luatikz-muted',
			text: 'Render TikZ diagrams with local LuaLaTeX or TikZJax.',
		});

		this.renderRendererSection(containerEl);
		this.renderLocalLualatexSection(containerEl);
		this.renderCacheSection(containerEl);
		this.renderClipboardSection(containerEl);
	}

	private section(parent: HTMLElement, title: string, description?: string): HTMLElement {
		const section = parent.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		section.createEl('h3', { text: title });
		if (description) {
			section.createEl('p', { cls: 'luatikz-muted', text: description });
		}
		return section;
	}

	private renderRendererSection(parent: HTMLElement): void {
		const section = this.section(
			parent,
			'Renderer',
			'Local LuaLaTeX is recommended for full package support. TikZJax avoids shell execution but supports fewer packages.',
		);

		const choices = section.createDiv({ cls: 'luatikz-renderer-choices' });
		const engines: Array<{ id: LuaTikzRenderEngine; title: string; desc: string }> = [
			{
				id: 'lualatex',
				title: 'Local LuaLaTeX engine',
				desc: 'Recommended. Requires shell execution and temporary files.',
			},
			{
				id: 'tikzjax',
				title: 'TikZJax',
				desc: 'No shell execution. Best for standard TikZ and math labels. For Hebrew, fonts, and advanced packages, use Local LuaLaTeX.',
			},
		];

		for (const engine of engines) {
			const card = choices.createDiv({
				cls: 'luatikz-renderer-choice',
			});
			if (this.plugin.settings.renderEngine === engine.id) {
				card.addClass('luatikz-renderer-choice-active');
			}
			card.createEl('strong', { text: engine.title });
			card.createEl('p', { cls: 'luatikz-muted', text: engine.desc });
			card.addEventListener('click', () => {
				void this.updateSetting('renderEngine', engine.id);
				this.display();
			});
		}
	}

	private renderLocalLualatexSection(parent: HTMLElement): void {
		const section = this.section(
			parent,
			'Local LuaLaTeX',
			'Filesystem and shell access are used only inside the plugin temp/cache directory.',
		);

		new Setting(section)
			.setName('Allow local LuaLaTeX execution')
			.setDesc('Explicitly allow the plugin to run lualatex on your machine.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLocalShellRenderer)
				.onChange(async (value) => {
					await this.updateSetting('enableLocalShellRenderer', value);
				}));

		new Setting(section)
			.setName('LuaLaTeX path')
			.setDesc('Direct path to the lualatex executable.')
			.addText(text => text
				.setPlaceholder('/Library/TeX/texbin/lualatex')
				.setValue(this.plugin.settings.lualatexPath)
				.onChange(async (value) => {
					await this.updateSetting('lualatexPath', value);
				}));

		new Setting(section)
			.setName('Timeout (ms)')
			.addText(text => text
				.setValue(String(this.plugin.settings.timeoutMs))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isFinite(parsed) && parsed > 0) {
						await this.updateSetting('timeoutMs', parsed);
					}
				}));

		new Setting(section)
			.setName('Output format')
			.addDropdown(dropdown => dropdown
				.addOption('svg', 'SVG')
				.addOption('png', 'PNG')
				.setValue(this.plugin.settings.outputFormat)
				.onChange(async (value) => {
					if (value === 'svg' || value === 'png') {
						await this.updateSetting('outputFormat', value);
					}
				}));
	}

	private renderCacheSection(parent: HTMLElement): void {
		const section = this.section(parent, 'Cache');

		new Setting(section)
			.setName('Enable cache')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.cacheEnabled)
				.onChange(async (value) => {
					await this.updateSetting('cacheEnabled', value);
				}));

		new Setting(section)
			.setName('Clear cache')
			.setDesc('Remove cached render results and temporary build files.')
			.addButton(button => button
				.setButtonText('Clear cache')
				.setClass('luatikz-danger-button')
				.onClick(async () => {
					this.plugin.renderer.clearCache();
					new Notice('LuaTikz cache cleared.');
				}));
	}

	private renderClipboardSection(parent: HTMLElement): void {
		const section = this.section(
			parent,
			'Clipboard',
			'Copy actions write rendered output to the clipboard. The plugin does not read from the clipboard.',
		);

		new Setting(section)
			.setName('Enable clipboard copy actions')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableClipboardCopy)
				.onChange(async (value) => {
					await this.updateSetting('enableClipboardCopy', value);
				}));
	}

	private async updateSetting<K extends keyof LuaTikzSettings>(
		key: K,
		value: LuaTikzSettings[K],
	): Promise<void> {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
	}
}

export { DEFAULT_SETTINGS, type LuaTikzSettings, type LuaTikzRenderEngine } from './settingsModel';
