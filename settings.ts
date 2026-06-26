import { App, PluginSettingTab, Setting } from 'obsidian';
import TikzjaxHebrewLocalPlugin from "./main";

export interface TikzjaxPluginSettings {
    invertColorsInDarkMode: boolean;
    inlineLivePreviewEnabledByDefault: boolean;
}

export const DEFAULT_SETTINGS: TikzjaxPluginSettings = {
    invertColorsInDarkMode: true,
    inlineLivePreviewEnabledByDefault: true,
};

export class TikzjaxSettingTab extends PluginSettingTab {
    plugin: TikzjaxHebrewLocalPlugin;

    constructor(app: App, plugin: TikzjaxHebrewLocalPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Invert dark colors in dark mode')
            .setDesc('Invert dark colors in diagrams (e.g. axes, arrows) when in dark mode, so that they are visible.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.invertColorsInDarkMode)
                .onChange(async (value) => {
                    this.plugin.settings.invertColorsInDarkMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable inline live preview by default')
            .setDesc('Automatically show the floating live TikZ preview when the cursor is inside a TikZ block.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.inlineLivePreviewEnabledByDefault)
                .onChange(async (value) => {
                    this.plugin.settings.inlineLivePreviewEnabledByDefault = value;
                    await this.plugin.saveSettings();
                }));
    }
}