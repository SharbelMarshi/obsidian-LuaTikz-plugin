import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import LuaTikzPlugin from './main';
import {
	DEFAULT_SETTINGS,
	type LuaTikzRenderEngine,
	type LuaTikzSettings,
} from './settingsModel';
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
		containerEl.addClass('luatikz-settings');

		const rendererSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		rendererSection.createEl('h3', { text: 'Renderer' });
		rendererSection.createEl('p', {
			cls: 'luatikz-muted',
			text: 'Local LuaLaTeX is recommended for full package support. TikZJax avoids shell execution but supports fewer packages.',
		});
		this.renderRendererChoices(rendererSection);

		const lualatexSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		lualatexSection.createEl('h3', { text: 'Local LuaLaTeX' });

		new Setting(lualatexSection)
			.setName('Allow local LuaLaTeX execution')
			.setDesc('Explicitly allow the plugin to run lualatex on your machine.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLocalShellRenderer)
				.onChange(async value => {
					await this.persistSetting('enableLocalShellRenderer', value);
				}));

		new Setting(lualatexSection)
			.setName('LuaLaTeX path')
			.setDesc('Direct path to the lualatex executable.')
			.addText(text => text
				.setPlaceholder('/Library/TeX/texbin/lualatex')
				.setValue(this.plugin.settings.lualatexPath)
				.onChange(async value => {
					await this.persistSetting('lualatexPath', value);
				}));

		new Setting(lualatexSection)
			.setName('Timeout (ms)')
			.addText(text => text
				.setValue(String(this.plugin.settings.timeoutMs))
				.onChange(async value => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isFinite(parsed)) {
						await this.persistSetting('timeoutMs', parsed);
					}
				}));

		new Setting(lualatexSection)
			.setName('Output format')
			.addDropdown(dropdown => dropdown
				.addOptions({ svg: 'SVG', png: 'PNG' })
				.setValue(this.plugin.settings.outputFormat)
				.onChange(async value => {
					await this.persistSetting('outputFormat', value);
				}));

		const cacheSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		cacheSection.createEl('h3', { text: 'Cache' });

		new Setting(cacheSection)
			.setName('Enable cache')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.cacheEnabled)
				.onChange(async value => {
					await this.persistSetting('cacheEnabled', value);
				}));

		new Setting(cacheSection)
			.setName('Clear cache')
			.setDesc('Remove cached render results and temporary build files.')
			.addButton(button => button
				.setButtonText('Clear cache')
				.setClass('luatikz-soft-button')
				.onClick(() => {
					this.plugin.renderer.clearCache();
					new Notice('LuaTikz cache cleared.');
				}));

		const clipboardSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		clipboardSection.createEl('h3', { text: 'Clipboard' });

		new Setting(clipboardSection)
			.setName('Enable clipboard copy actions')
			.setDesc('Copy actions write rendered output to the clipboard. The plugin does not read from the clipboard.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableClipboardCopy)
				.onChange(async value => {
					await this.persistSetting('enableClipboardCopy', value);
				}));
	}

	private async persistSetting(key: string, value: unknown): Promise<void> {
		if (!(key in DEFAULT_SETTINGS)) {
			return;
		}

		const settingKey = key as keyof LuaTikzSettings;
		if (settingKey === 'renderEngine') {
			const renderEngine = parseRenderEngine(value);
			if (renderEngine) {
				this.plugin.settings.renderEngine = renderEngine;
			}
		} else if (settingKey === 'outputFormat') {
			const outputFormat = parseOutputFormat(value);
			if (outputFormat) {
				this.plugin.settings.outputFormat = outputFormat;
			}
		} else if (settingKey === 'timeoutMs') {
			this.plugin.settings.timeoutMs = asNumber(value, DEFAULT_SETTINGS.timeoutMs);
		} else if (settingKey === 'lualatexPath' || settingKey === 'extraPreamble') {
			this.plugin.settings[settingKey] = asString(value, DEFAULT_SETTINGS[settingKey]);
		} else if (
			settingKey === 'enableLocalShellRenderer'
			|| settingKey === 'showInstallNotice'
			|| settingKey === 'enableClipboardCopy'
			|| settingKey === 'cacheEnabled'
			|| settingKey === 'inlineLivePreviewEnabledByDefault'
		) {
			this.plugin.settings[settingKey] = asBoolean(value, DEFAULT_SETTINGS[settingKey]);
		}

		await this.plugin.saveSettings();
	}

	private renderRendererChoices(container: HTMLElement): void {
		const choices = container.createDiv({ cls: 'luatikz-renderer-choices' });
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
			const card = choices.createDiv({ cls: 'luatikz-renderer-choice' });
			if (this.plugin.settings.renderEngine === engine.id) {
				card.addClass('luatikz-renderer-choice-active');
			}
			card.createEl('strong', { text: engine.title });
			card.createEl('p', { cls: 'luatikz-muted', text: engine.desc });
			card.addEventListener('click', () => {
				void this.persistSetting('renderEngine', engine.id).then(() => {
					this.display();
				});
			});
		}
	}
}

export { DEFAULT_SETTINGS, type LuaTikzSettings, type LuaTikzRenderEngine } from './settingsModel';
