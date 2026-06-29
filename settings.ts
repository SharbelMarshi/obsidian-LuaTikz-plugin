import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
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

	override update(): void {
		this.containerEl.addClass('luatikz-settings-root');
		super.update();
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof LuaTikzSettings>[] {
		return [
			{
				type: 'group',
				heading: 'LuaTikz',
				cls: 'luatikz-glass-header',
				items: [
					{
						name: 'About LuaTikz',
						desc: 'Render TikZ diagrams with local LuaLaTeX or TikZJax.',
					},
				],
			},
			{
				type: 'group',
				heading: 'Renderer',
				cls: 'luatikz-glass-section luatikz-glass-card',
				items: [
					{
						name: 'Renderer choices',
						desc: 'Local LuaLaTeX is recommended for full package support. TikZJax avoids shell execution but supports fewer packages.',
						searchable: false,
						render: (setting) => {
							this.renderRendererChoices(setting);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Local LuaLaTeX',
				cls: 'luatikz-glass-section luatikz-glass-card',
				items: [
					{
						name: 'Allow local LuaLaTeX execution',
						desc: 'Explicitly allow the plugin to run lualatex on your machine.',
						control: {
							type: 'toggle',
							key: 'enableLocalShellRenderer',
						},
					},
					{
						name: 'LuaLaTeX path',
						desc: 'Direct path to the lualatex executable.',
						control: {
							type: 'text',
							key: 'lualatexPath',
							placeholder: '/Library/TeX/texbin/lualatex',
						},
					},
					{
						name: 'Timeout (ms)',
						control: {
							type: 'number',
							key: 'timeoutMs',
						},
					},
					{
						name: 'Output format',
						control: {
							type: 'dropdown',
							key: 'outputFormat',
							options: {
								svg: 'SVG',
								png: 'PNG',
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Cache',
				cls: 'luatikz-glass-section luatikz-glass-card',
				items: [
					{
						name: 'Enable cache',
						control: {
							type: 'toggle',
							key: 'cacheEnabled',
						},
					},
					{
						name: 'Clear cache',
						desc: 'Remove cached render results and temporary build files.',
						action: () => {
							this.plugin.renderer.clearCache();
							new Notice('LuaTikz cache cleared.');
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Clipboard',
				cls: 'luatikz-glass-section luatikz-glass-card',
				items: [
					{
						name: 'Enable clipboard copy actions',
						desc: 'Copy actions write rendered output to the clipboard. The plugin does not read from the clipboard.',
						control: {
							type: 'toggle',
							key: 'enableClipboardCopy',
						},
					},
				],
			},
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
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

	private renderRendererChoices(setting: Setting): void {
		setting.settingEl.addClass('luatikz-renderer-setting');
		setting.setDesc('Local LuaLaTeX is recommended for full package support. TikZJax avoids shell execution but supports fewer packages.');
		const choices = setting.controlEl.createDiv({ cls: 'luatikz-renderer-choices' });
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
				void this.setControlValue('renderEngine', engine.id).then(() => {
					this.update();
				});
			});
		}
	}
}

export { DEFAULT_SETTINGS, type LuaTikzSettings, type LuaTikzRenderEngine } from './settingsModel';
