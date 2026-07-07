import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import LuaTikzPlugin from '../main';
import {
	DEFAULT_SETTINGS,
	type DarkModeStyle,
	type LuaTikzRenderEngine,
	type LuaTikzSettings,
	type SemicolonReminderMode,
} from './settingsModel';
import { TEST_RENDER_SOURCE, checkEnvironment } from '../utils/environmentCheck';
import { migrateDarkModeStyle } from '../utils/darkMode';
import { isMobileApp } from '../utils/platform';
import { shouldClearRenderCacheOnSettingChange } from '../utils/settingsCache';
import { asBoolean, asNumber, asString, isRecord } from '../utils/guards';

function parseRenderEngine(value: unknown): LuaTikzRenderEngine | undefined {
	return value === 'lualatex' || value === 'tikzjax' ? value : undefined;
}

function parseOutputFormat(value: unknown): LuaTikzSettings['outputFormat'] | undefined {
	return value === 'svg' || value === 'png' ? value : undefined;
}

function parseDarkModeStyle(value: unknown): DarkModeStyle | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	return migrateDarkModeStyle(value);
}

function parseSemicolonReminderMode(value: unknown): SemicolonReminderMode | undefined {
	return value === 'off' || value === 'hint' || value === 'auto-append' ? value : undefined;
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
	const darkModeStyle = parseDarkModeStyle(data.darkModeStyle);
	if (darkModeStyle) {
		parsed.darkModeStyle = darkModeStyle;
	}
	parsed.starterBlockOnNewFence = asBoolean(
		data.starterBlockOnNewFence,
		DEFAULT_SETTINGS.starterBlockOnNewFence,
	);
	parsed.enableStructuralLint = asBoolean(
		data.enableStructuralLint,
		DEFAULT_SETTINGS.enableStructuralLint,
	);
	const semicolonReminderMode = parseSemicolonReminderMode(data.semicolonReminderMode);
	if (semicolonReminderMode) {
		parsed.semicolonReminderMode = semicolonReminderMode;
	}
	parsed.autoCloseBrackets = asBoolean(
		data.autoCloseBrackets,
		DEFAULT_SETTINGS.autoCloseBrackets,
	);

	return parsed;
}

export class LuaTikzSettingTab extends PluginSettingTab {
	plugin: LuaTikzPlugin;
	private rendererChoicesContainer: HTMLElement | null = null;
	private environmentStatusEl: HTMLElement | null = null;

	constructor(app: App, plugin: LuaTikzPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('luatikz-settings');

		const rendererSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(rendererSection)
			.setName('Renderer')
			.setHeading();
		this.rendererChoicesContainer = rendererSection;
		this.renderRendererChoices(rendererSection);

		const environmentSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(environmentSection)
			.setName('Environment')
			.setHeading();
		this.environmentStatusEl = environmentSection.createDiv({ cls: 'luatikz-environment-status luatikz-muted' });
		void this.renderEnvironmentStatus();

		new Setting(environmentSection)
			.setName('Test render')
			.setDesc('Compile a small sample diagram with the current renderer settings.')
			.addButton(button => button
				.setButtonText('Run test')
				.setClass('luatikz-soft-button')
				.onClick(() => {
					void this.runTestRender();
				}));

		const lualatexSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(lualatexSection)
			.setName('Local LuaLaTeX')
			.setHeading();

		new Setting(lualatexSection)
			.setName('Allow local LuaLaTeX execution')
			.setDesc('Explicitly allow the plugin to run lualatex on your machine.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLocalShellRenderer)
				.onChange(async value => {
					await this.persistSetting('enableLocalShellRenderer', value);
					void this.renderEnvironmentStatus();
				}));

		new Setting(lualatexSection)
			.setName('LuaLaTeX path')
			.setDesc('Direct path to the lualatex executable.')
			.addText(text => text
				.setPlaceholder('/Library/TeX/texbin/lualatex')
				.setValue(this.plugin.settings.lualatexPath)
				.onChange(async value => {
					await this.persistSetting('lualatexPath', value);
					void this.renderEnvironmentStatus();
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

		const preambleSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(preambleSection)
			.setName('Extra preamble')
			.setHeading();

		new Setting(preambleSection)
			.setName('LaTeX preamble')
			.setDesc('Additional trusted LaTeX inserted before \\begin{document}. LuaLaTeX uses the full preamble. TikZJax keeps TikZ/macros and removes font/localization-only lines.')
			.addTextArea(text => {
				text.inputEl.rows = 8;
				text.setPlaceholder(String.raw`\usepackage{physics}`)
					.setValue(this.plugin.settings.extraPreamble)
					.onChange(async value => {
						await this.persistSetting('extraPreamble', value);
					});
			});

		const appearanceSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(appearanceSection)
			.setName('Appearance')
			.setHeading();

		new Setting(appearanceSection)
			.setName('Dark mode handling')
			.setDesc('Auto-invert changes only near-black strokes (colors stay intact). Brightness boost lightly lifts the whole diagram.')
			.addDropdown(dropdown => dropdown
				.addOptions({
					'auto-invert': 'Selective SVG inversion (recommended)',
					'brightness-boost': 'Brightness boost',
					none: 'No adjustment',
				})
				.setValue(this.plugin.settings.darkModeStyle)
				.onChange(async value => {
					await this.persistSetting('darkModeStyle', value);
				}));

		const editorSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(editorSection)
			.setName('Editor')
			.setHeading();

		new Setting(editorSection)
			.setName('Starter block on new fence')
			.setDesc('Insert a blank tikzpicture when you open a new ```tikz block.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.starterBlockOnNewFence)
				.onChange(async value => {
					await this.persistSetting('starterBlockOnNewFence', value);
				}));

		new Setting(editorSection)
			.setName('Structural lint')
			.setDesc('Show warnings for unmatched environments, braces, and missing libraries inside TikZ blocks.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableStructuralLint)
				.onChange(async value => {
					await this.persistSetting('enableStructuralLint', value);
				}));

		new Setting(editorSection)
			.setName('Semicolon reminder')
			.setDesc('Hint or auto-append ; when pressing Enter on unfinished \\draw/\\path lines.')
			.addDropdown(dropdown => dropdown
				.addOptions({ off: 'Off', hint: 'Hint (recommended)', 'auto-append': 'Auto-append' })
				.setValue(this.plugin.settings.semicolonReminderMode)
				.onChange(async value => {
					await this.persistSetting('semicolonReminderMode', value);
				}));

		new Setting(editorSection)
			.setName('Auto-close brackets')
			.setDesc('Automatically close {, [, and $ while typing in the editor.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCloseBrackets)
				.onChange(async value => {
					await this.persistSetting('autoCloseBrackets', value);
				}));

		const cacheSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(cacheSection)
			.setName('Cache')
			.setHeading();

		new Setting(cacheSection)
			.setName('Enable cache')
			.setDesc('Reuse recent render results in memory and on disk between sessions.')
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
	}

	private async renderEnvironmentStatus(): Promise<void> {
		if (!this.environmentStatusEl) {
			return;
		}

		const report = await checkEnvironment(this.plugin.settings);
		this.environmentStatusEl.empty();

		this.environmentStatusEl.createEl('p', { text: report.summary });

		const list = this.environmentStatusEl.createEl('ul', { cls: 'luatikz-environment-list' });
		for (const tool of [report.lualatex, report.pdftocairo]) {
			const item = list.createEl('li');
			const status = tool.found ? 'Found' : 'Missing';
			item.setText(`${tool.label}: ${status}${tool.path ? ` (${tool.path})` : ''}`);
			if (!tool.found && tool.installHint) {
				item.createEl('div', {
					cls: 'luatikz-environment-hint',
					text: tool.installHint,
				});
			}
		}
	}

	private async runTestRender(): Promise<void> {
		new Notice('Running LuaTikz test render…');
		const result = await this.plugin.renderer.renderToSvg(TEST_RENDER_SOURCE);
		if (result.ok) {
			new Notice(`Test render succeeded (${result.engine ?? this.plugin.settings.renderEngine}).`);
			return;
		}

		new Notice(`Test render failed: ${result.error ?? 'Unknown error'}`);
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
		} else if (settingKey === 'darkModeStyle') {
			const darkModeStyle = parseDarkModeStyle(value);
			if (darkModeStyle) {
				this.plugin.settings.darkModeStyle = darkModeStyle;
			}
		} else if (settingKey === 'semicolonReminderMode') {
			const mode = parseSemicolonReminderMode(value);
			if (mode) {
				this.plugin.settings.semicolonReminderMode = mode;
			}
		} else if (settingKey === 'timeoutMs') {
			this.plugin.settings.timeoutMs = asNumber(value, DEFAULT_SETTINGS.timeoutMs);
		} else if (settingKey === 'lualatexPath' || settingKey === 'extraPreamble') {
			this.plugin.settings[settingKey] = asString(value, DEFAULT_SETTINGS[settingKey]);
		} else if (
			settingKey === 'enableLocalShellRenderer'
			|| settingKey === 'showInstallNotice'
			|| settingKey === 'cacheEnabled'
			|| settingKey === 'inlineLivePreviewEnabledByDefault'
			|| settingKey === 'starterBlockOnNewFence'
			|| settingKey === 'enableStructuralLint'
			|| settingKey === 'autoCloseBrackets'
		) {
			this.plugin.settings[settingKey] = asBoolean(value, DEFAULT_SETTINGS[settingKey]);
		}

		await this.plugin.saveData(this.plugin.settings);
		if (shouldClearRenderCacheOnSettingChange(settingKey)) {
			this.plugin.renderer.clearCache();
		}
	}

	private refreshRendererChoices(): void {
		if (!this.rendererChoicesContainer) {
			return;
		}

		this.rendererChoicesContainer.querySelector('.luatikz-renderer-choices')?.remove();
		this.renderRendererChoices(this.rendererChoicesContainer);
	}

	private renderRendererChoices(container: HTMLElement): void {
		const choices = container.createDiv({ cls: 'luatikz-renderer-choices' });
		const engines: Array<{ id: LuaTikzRenderEngine; title: string; desc: string }> = [
			{
				id: 'lualatex',
				title: 'Local LuaLaTeX engine',
				desc: isMobileApp
					? 'Desktop only. On mobile, LuaTikZ uses TikZJax automatically.'
					: 'Recommended. Requires shell execution and temporary files.',
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
				if (engine.id === 'lualatex' && isMobileApp) {
					new Notice('Local LuaLaTeX is available on desktop Obsidian only.');
					return;
				}
				void this.persistSetting('renderEngine', engine.id).then(() => {
					this.refreshRendererChoices();
				});
			});
		}
	}
}

export { DEFAULT_SETTINGS, type LuaTikzSettings, type LuaTikzRenderEngine } from './settingsModel';
