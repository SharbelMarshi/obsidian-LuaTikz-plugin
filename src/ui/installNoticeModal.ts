import { App, Modal } from 'obsidian';
import type LuaTikzPlugin from '../main';
import { checkEnvironment } from '../utils/environmentCheck';
import { isMobileApp } from '../utils/platform';

export class InstallNoticeModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: LuaTikzPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText('LuaTikz setup');
		contentEl.empty();
		contentEl.addClass('luatikz-install-notice');

		contentEl.createEl('p', {
			cls: 'luatikz-install-message',
			text: isMobileApp
				? 'LuaTikZ on mobile uses the TikZJax renderer for TikZ diagrams.'
				: 'LuaTikZ uses the LuaLaTeX engine by default for full TikZ support. Checking your environment…',
		});

		const statusEl = contentEl.createDiv({ cls: 'luatikz-install-environment luatikz-muted' });
		const buttonRow = contentEl.createDiv({ cls: 'luatikz-install-buttons' });

		buttonRow.createEl('button', {
			cls: 'mod-cta luatikz-soft-button',
			text: 'Open settings',
		}).addEventListener('click', () => {
			void this.openSettings();
		});

		buttonRow.createEl('button', {
			cls: 'luatikz-soft-button',
			text: 'Dismiss',
		}).addEventListener('click', () => {
			void this.dismissNotice().then(() => this.close());
		});

		void checkEnvironment(this.plugin.settings).then(report => {
			statusEl.empty();
			statusEl.createEl('p', { text: report.summary });

			const list = statusEl.createEl('ul', { cls: 'luatikz-environment-list' });
			for (const tool of [report.lualatex, report.pdftocairo]) {
				const item = list.createEl('li');
				item.setText(`${tool.label}: ${tool.found ? 'found' : 'missing'}${tool.path ? ` (${tool.path})` : ''}`);
				if (!tool.found && tool.installHint) {
					item.createEl('div', {
						cls: 'luatikz-environment-hint',
						text: tool.installHint,
					});
				}
			}

			if (!report.readyForLuaLatex && !isMobileApp) {
				statusEl.createEl('p', {
					text: 'You can switch to the TikZJax renderer in settings if you do not want to install a local TeX distribution.',
				});
			}
			if (isMobileApp) {
				statusEl.createEl('p', {
					text: 'TikZJax is enabled automatically on mobile. Local LuaLaTeX is desktop-only.',
				});
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async openSettings(): Promise<void> {
		await this.dismissNotice();
		this.close();

		const appWithSetting = this.app as App & {
			setting?: { open: () => void; openTabById: (id: string) => void };
		};
		appWithSetting.setting?.open();
		appWithSetting.setting?.openTabById(this.plugin.manifest.id);
	}

	private async dismissNotice(): Promise<void> {
		this.plugin.settings.showInstallNotice = false;
		await this.plugin.saveData(this.plugin.settings);
	}
}
