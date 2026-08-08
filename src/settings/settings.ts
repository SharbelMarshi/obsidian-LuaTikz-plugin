import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	debounce,
	type SettingDefinitionItem,
	type TextAreaComponent,
} from 'obsidian';
import LuaTikzPlugin from '../main';
import {
	DEFAULT_SETTINGS,
	STRING_SETTING_KEYS,
	type DarkModeStyle,
	type LuaTikzRenderEngine,
	type LuaTikzSettings,
	type SemicolonReminderMode,
} from './settingsModel';
import { TEST_RENDER_SOURCE, checkEnvironment } from '../utils/environmentCheck';
import { clearCommandResolutionCache } from '../desktop/lualatexShell';
import { migrateDarkModeStyle } from '../utils/darkMode';
import { isMobileApp } from '../utils/platform';
import { shouldClearRenderCacheOnSettingChange } from '../utils/settingsCache';
import { asBoolean, asNumber, asString, isRecord } from '../utils/guards';
import { buildManagedPreamblePreview, latexWrapperOptionsFromSettings } from '../core/tikzSource';

/**
 * Below 1 s a mistyped or half-typed value bricks every render ("Timed out."
 * instantly — 0 clamps to ~1 ms in setTimeout); above 10 min the safety net
 * stops being one.
 */
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 600000;

export function clampTimeoutMs(value: number): number {
	return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value));
}

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
	for (const key of STRING_SETTING_KEYS) {
		parsed[key] = asString(data[key], DEFAULT_SETTINGS[key]);
	}
	parsed.enableLocalShellRenderer = asBoolean(
		data.enableLocalShellRenderer,
		DEFAULT_SETTINGS.enableLocalShellRenderer,
	);
	parsed.showInstallNotice = asBoolean(data.showInstallNotice, DEFAULT_SETTINGS.showInstallNotice);
	const outputFormat = parseOutputFormat(data.outputFormat);
	if (outputFormat) {
		parsed.outputFormat = outputFormat;
	}
	parsed.timeoutMs = clampTimeoutMs(asNumber(data.timeoutMs, DEFAULT_SETTINGS.timeoutMs));
	parsed.cacheEnabled = asBoolean(data.cacheEnabled, DEFAULT_SETTINGS.cacheEnabled);
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

/** Text-bearing settings persisted with a trailing debounce: unthrottled,
 * every keystroke wrote data.json, wiped the render cache, and (for the
 * lualatex path) spawned the half-typed path as a process. */
const DEBOUNCED_CONTROL_KEYS = new Set<string>([...STRING_SETTING_KEYS, 'timeoutMs']);

export class LuaTikzSettingTab extends PluginSettingTab {
	plugin: LuaTikzPlugin;
	private rendererChoicesContainer: HTMLElement | null = null;
	private environmentStatusEl: HTMLElement | null = null;
	private customPreambleInput: TextAreaComponent | null = null;
	private debouncedPersists = new Map<string, (value: unknown) => void>();

	constructor(app: App, plugin: LuaTikzPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings for Obsidian 1.13+. When this returns a non-empty
	 * array the app renders the tab from it (and indexes it for settings
	 * search) and `display()` is NOT called — so every definition here must
	 * carry its real control, not just search metadata. `display()` below
	 * stays as the imperative fallback for Obsidian < 1.13.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Renderer',
				items: [
					{
						name: 'Renderer',
						desc: 'Choose between local LuaLaTeX and the bundled TikZJax.',
						aliases: ['engine', 'lualatex', 'tikzjax'],
						render: (setting: Setting) => {
							setting.settingEl.empty();
							this.rendererChoicesContainer = setting.settingEl;
							this.renderRendererChoices(setting.settingEl);
							return () => {
								this.rendererChoicesContainer = null;
							};
						},
					},
					{
						name: 'Environment',
						desc: 'Detected LuaLaTeX and pdftocairo installations.',
						searchable: false,
						render: (setting: Setting) => {
							setting.settingEl.empty();
							this.environmentStatusEl = setting.settingEl.createDiv({
								cls: 'luatikz-environment-status luatikz-muted',
							});
							void this.renderEnvironmentStatus();
							return () => {
								this.environmentStatusEl = null;
							};
						},
					},
					{
						name: 'Test render',
						desc: 'Compile a small sample diagram with the current renderer settings.',
						action: () => {
							void this.runTestRender();
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Local LuaLaTeX',
				items: [
					{
						name: 'Allow local LuaLaTeX execution',
						desc: 'Explicitly allow the plugin to run lualatex on your machine.',
						control: { type: 'toggle', key: 'enableLocalShellRenderer', defaultValue: DEFAULT_SETTINGS.enableLocalShellRenderer },
					},
					{
						name: 'LuaLaTeX path',
						desc: 'Direct path to the lualatex executable.',
						control: { type: 'text', key: 'lualatexPath', placeholder: '/Library/TeX/texbin/lualatex' },
					},
					{
						name: 'Timeout (ms)',
						desc: `Per-render compile timeout, ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS} ms.`,
						control: {
							type: 'number',
							key: 'timeoutMs',
							defaultValue: DEFAULT_SETTINGS.timeoutMs,
							min: MIN_TIMEOUT_MS,
							max: MAX_TIMEOUT_MS,
						},
					},
					{
						name: 'Output format',
						desc: 'SVG conversion pipeline for compiled PDFs.',
						control: {
							type: 'dropdown',
							key: 'outputFormat',
							options: { svg: 'SVG', png: 'PNG' },
							defaultValue: DEFAULT_SETTINGS.outputFormat,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Fonts (LuaLaTeX)',
				items: [
					{
						name: 'Main font',
						desc: 'Override the main text font. Leave blank for the built-in fallback chain; names that are not installed are skipped automatically.',
						aliases: ['fonts'],
						control: { type: 'text', key: 'mainFont', placeholder: 'TeX Gyre Termes' },
					},
					{
						name: 'Hebrew font',
						desc: 'Override the Hebrew fallback chain (loads only when a diagram uses \\he{}).',
						aliases: ['rtl'],
						control: { type: 'text', key: 'hebrewFont', placeholder: 'Noto Serif Hebrew → David CLM → Frank Ruehl CLM' },
					},
					{
						name: 'Arabic font',
						desc: 'Override the Arabic fallback chain (loads only when a diagram uses \\ar{}).',
						aliases: ['rtl'],
						control: { type: 'text', key: 'arabicFont', placeholder: 'Noto Sans Arabic → Geeza Pro → Amiri' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Preamble',
				items: [
					{
						name: 'Extra preamble',
						desc: 'Additional trusted LaTeX appended to the preamble. LuaLaTeX uses the full preamble. TikZJax keeps TikZ/macros and removes font/localization-only lines.',
						control: {
							type: 'textarea',
							key: 'extraPreamble',
							rows: 8,
							placeholder: String.raw`\usepackage{physics}`,
						},
					},
					{
						name: 'Custom preamble',
						desc: 'Replaces the generated preamble entirely (LuaLaTeX only). Fonts, polyglossia and \\he/\\ar become yours to define. Leave empty to use the managed preamble.',
						control: {
							type: 'textarea',
							key: 'customPreamble',
							rows: 16,
							placeholder: 'Empty — using the managed preamble',
						},
					},
					{
						name: 'Load current preamble',
						desc: 'Copy the generated preamble into Custom preamble for editing.',
						action: () => {
							const preamble = buildManagedPreamblePreview(
								latexWrapperOptionsFromSettings(this.plugin.settings),
							);
							void this.persistSetting('customPreamble', preamble).then(() => {
								this.update();
								new Notice('Loaded the generated preamble — it is yours to edit now.');
							});
						},
					},
					{
						name: 'Reset custom preamble',
						desc: 'Clear Custom preamble and return to the managed preamble.',
						action: () => {
							void this.persistSetting('customPreamble', '').then(() => {
								this.update();
								new Notice('Using the managed preamble.');
							});
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Appearance',
				items: [
					{
						name: 'Dark mode handling',
						desc: 'Auto-invert changes only near-black strokes (colors stay intact). Brightness boost lightly lifts the whole diagram.',
						aliases: ['theme', 'invert'],
						control: {
							type: 'dropdown',
							key: 'darkModeStyle',
							options: {
								'auto-invert': 'Selective SVG inversion (recommended)',
								'brightness-boost': 'Brightness boost',
								none: 'No adjustment',
							},
							defaultValue: DEFAULT_SETTINGS.darkModeStyle,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Editor',
				items: [
					{
						name: 'Starter block on new fence',
						desc: 'Insert a blank tikzpicture when you open a new ```tikz block.',
						control: { type: 'toggle', key: 'starterBlockOnNewFence', defaultValue: DEFAULT_SETTINGS.starterBlockOnNewFence },
					},
					{
						name: 'Structural lint',
						desc: 'Show warnings for unmatched environments, braces, and missing libraries inside TikZ blocks.',
						control: { type: 'toggle', key: 'enableStructuralLint', defaultValue: DEFAULT_SETTINGS.enableStructuralLint },
					},
					{
						name: 'Semicolon reminder',
						desc: 'Hint or auto-append ; when pressing Enter on unfinished \\draw/\\path lines.',
						control: {
							type: 'dropdown',
							key: 'semicolonReminderMode',
							options: { off: 'Off', hint: 'Hint (recommended)', 'auto-append': 'Auto-append' },
							defaultValue: DEFAULT_SETTINGS.semicolonReminderMode,
						},
					},
					{
						name: 'Auto-close brackets',
						desc: 'Automatically close {, [, (, and $ while typing inside TikZ blocks.',
						control: { type: 'toggle', key: 'autoCloseBrackets', defaultValue: DEFAULT_SETTINGS.autoCloseBrackets },
					},
				],
			},
			{
				type: 'group',
				heading: 'Cache',
				items: [
					{
						name: 'Enable cache',
						desc: 'Reuse recent render results in memory and on disk between sessions.',
						control: { type: 'toggle', key: 'cacheEnabled', defaultValue: DEFAULT_SETTINGS.cacheEnabled },
					},
					{
						name: 'Clear cache',
						desc: 'Remove cached render results and temporary build files.',
						action: () => {
							void this.plugin.renderer?.invalidateCache().then(() => {
								new Notice('LuaTikz cache cleared.');
							});
						},
					},
				],
			},
		];
	}

	/** Value source for declarative `control` definitions (Obsidian 1.13+). */
	getControlValue(key: string): unknown {
		if (key in DEFAULT_SETTINGS) {
			return this.plugin.settings[key as keyof LuaTikzSettings];
		}
		return undefined;
	}

	/** Persistence for declarative `control` definitions (Obsidian 1.13+). */
	setControlValue(key: string, value: unknown): void {
		if (DEBOUNCED_CONTROL_KEYS.has(key)) {
			let persist = this.debouncedPersists.get(key);
			if (!persist) {
				persist = debounce((debouncedValue: unknown) => {
					void this.applyControlChange(key, debouncedValue);
				}, 500, true);
				this.debouncedPersists.set(key, persist);
			}
			persist(value);
			return;
		}
		void this.applyControlChange(key, value);
	}

	private async applyControlChange(key: string, value: unknown): Promise<void> {
		if (key === 'lualatexPath') {
			clearCommandResolutionCache();
		}
		await this.persistSetting(key, value);
		if (key === 'lualatexPath' || key === 'enableLocalShellRenderer') {
			void this.renderEnvironmentStatus();
		}
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

		// Debounced: unthrottled, every keystroke wrote data.json, wiped the
		// render cache, and spawned the half-typed path as a process.
		const persistLualatexPath = debounce(async (value: string) => {
			clearCommandResolutionCache();
			await this.persistSetting('lualatexPath', value);
			void this.renderEnvironmentStatus();
		}, 500, true);

		new Setting(lualatexSection)
			.setName('LuaLaTeX path')
			.setDesc('Direct path to the lualatex executable.')
			.addText(text => text
				.setPlaceholder('/Library/TeX/texbin/lualatex')
				.setValue(this.plugin.settings.lualatexPath)
				.onChange(value => {
					persistLualatexPath(value);
				}));

		const persistTimeout = debounce(async (value: string) => {
			const parsed = Number.parseInt(value, 10);
			if (Number.isFinite(parsed)) {
				await this.persistSetting('timeoutMs', clampTimeoutMs(parsed));
			}
		}, 500, true);

		new Setting(lualatexSection)
			.setName('Timeout (ms)')
			.setDesc(`Per-render compile timeout, ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS} ms.`)
			.addText(text => text
				.setValue(String(this.plugin.settings.timeoutMs))
				.onChange(value => {
					persistTimeout(value);
				}));

		new Setting(lualatexSection)
			.setName('Output format')
			.addDropdown(dropdown => dropdown
				.addOptions({ svg: 'SVG', png: 'PNG' })
				.setValue(this.plugin.settings.outputFormat)
				.onChange(async value => {
					await this.persistSetting('outputFormat', value);
				}));

		const fontSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(fontSection)
			.setName('Fonts (LuaLaTeX)')
			.setHeading();

		fontSection.createDiv({
			cls: 'luatikz-muted',
			text: 'Leave a field blank to use the built-in fallback chain. Names that are not installed are skipped automatically, and Hebrew/Arabic fonts load only when a diagram uses \\he{} or \\ar{}.',
		});

		const fontFields: { key: 'mainFont' | 'hebrewFont' | 'arabicFont'; name: string; placeholder: string }[] = [
			{ key: 'mainFont', name: 'Main font', placeholder: 'TeX Gyre Termes' },
			{ key: 'hebrewFont', name: 'Hebrew font', placeholder: 'Noto Serif Hebrew → David CLM → Frank Ruehl CLM' },
			{ key: 'arabicFont', name: 'Arabic font', placeholder: 'Noto Sans Arabic → Geeza Pro → Amiri' },
		];

		for (const field of fontFields) {
			const persistFont = debounce(async (value: string) => {
				await this.persistSetting(field.key, value);
			}, 500, true);
			new Setting(fontSection)
				.setName(field.name)
				.addText(text => text
					.setPlaceholder(field.placeholder)
					.setValue(this.plugin.settings[field.key])
					.onChange(value => {
						persistFont(value);
					}));
		}

		const preambleSection = containerEl.createDiv({ cls: 'luatikz-glass-section luatikz-glass-card' });
		new Setting(preambleSection)
			.setName('Preamble')
			.setHeading();

		new Setting(preambleSection)
			.setName('Extra preamble')
			.setDesc('Additional trusted LaTeX appended to the preamble. LuaLaTeX uses the full preamble. TikZJax keeps TikZ/macros and removes font/localization-only lines.')
			.addTextArea(text => {
				text.inputEl.rows = 8;
				const persistExtraPreamble = debounce(async (value: string) => {
					await this.persistSetting('extraPreamble', value);
				}, 500, true);
				text.setPlaceholder(String.raw`\usepackage{physics}`)
					.setValue(this.plugin.settings.extraPreamble)
					.onChange(value => {
						persistExtraPreamble(value);
					});
			});

		new Setting(preambleSection)
			.setName('Custom preamble')
			.setDesc('Replaces the generated preamble entirely (LuaLaTeX only). Fonts, polyglossia and \\he/\\ar become yours to define; the coordinate-pick calibration block and \\begin{document} are always appended by the plugin. Leave empty to use the managed preamble, which keeps improving with each release.')
			.addTextArea(text => {
				this.customPreambleInput = text;
				text.inputEl.rows = 16;
				const persistCustomPreamble = debounce(async (value: string) => {
					await this.persistSetting('customPreamble', value);
				}, 500, true);
				text.setPlaceholder('Empty — using the managed preamble')
					.setValue(this.plugin.settings.customPreamble)
					.onChange(value => {
						persistCustomPreamble(value);
					});
			});

		new Setting(preambleSection)
			.addButton(button => button
				.setButtonText('Load current preamble')
				.setClass('luatikz-soft-button')
				.onClick(async () => {
					const preamble = buildManagedPreamblePreview(
						latexWrapperOptionsFromSettings(this.plugin.settings),
					);
					await this.persistSetting('customPreamble', preamble);
					this.customPreambleInput?.setValue(preamble);
					new Notice('Loaded the generated preamble — it is yours to edit now.');
				}))
			.addButton(button => button
				.setButtonText('Reset to default')
				.setClass('luatikz-soft-button')
				.onClick(async () => {
					await this.persistSetting('customPreamble', '');
					this.customPreambleInput?.setValue('');
					new Notice('Using the managed preamble.');
				}));

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
			.setDesc('Automatically close {, [, (, and $ while typing inside TikZ blocks.')
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
				.onClick(async () => {
					// The Notice fires after the disk assets are actually gone;
					// it used to fire immediately while nothing was deleted.
					await this.plugin.renderer?.invalidateCache();
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
				item.createDiv({
					cls: 'luatikz-environment-hint',
					text: tool.installHint,
				});
			}
		}
	}

	private async runTestRender(): Promise<void> {
		if (!this.plugin.renderer) {
			return;
		}
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
			this.plugin.settings.timeoutMs = clampTimeoutMs(asNumber(value, DEFAULT_SETTINGS.timeoutMs));
		} else if ((STRING_SETTING_KEYS as readonly string[]).includes(settingKey)) {
			const stringKey = settingKey as typeof STRING_SETTING_KEYS[number];
			this.plugin.settings[stringKey] = asString(value, DEFAULT_SETTINGS[stringKey]);
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
			await this.plugin.renderer?.invalidateCache();
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
