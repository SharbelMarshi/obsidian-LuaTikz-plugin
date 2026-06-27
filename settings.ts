import { App, PluginSettingTab, Setting } from 'obsidian';
import LuaTikzPlugin from './main';

export interface TikzjaxPluginSettings {
	invertColorsInDarkMode: boolean;
	inlineLivePreviewEnabledByDefault: boolean;
}

export const DEFAULT_SETTINGS: TikzjaxPluginSettings = {
	invertColorsInDarkMode: true,
	inlineLivePreviewEnabledByDefault: true,
};

export class TikzjaxSettingTab extends PluginSettingTab {
	plugin: LuaTikzPlugin;

	constructor(app: App, plugin: LuaTikzPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Invert colors in dark mode')
			.setDesc('Flip black strokes/fills to white when Obsidian is in dark mode.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.invertColorsInDarkMode)
				.onChange(async (value) => {
					this.plugin.settings.invertColorsInDarkMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Live preview by default')
			.setDesc('Show the floating preview when the cursor is inside a tikz block.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.inlineLivePreviewEnabledByDefault)
				.onChange(async (value) => {
					this.plugin.settings.inlineLivePreviewEnabledByDefault = value;
					await this.plugin.saveSettings();
				}));
	}
}
