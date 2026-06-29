import { App, Modal } from 'obsidian';
import type LuaTikzPlugin from './main';

export class InstallNoticeModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: LuaTikzPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText('LuaTikz');
		contentEl.empty();
		contentEl.addClass('luatikz-install-notice');

		contentEl.createEl('p', {
			cls: 'luatikz-install-message',
			text: 'LuaTikz uses the LuaLaTeX engine by default. Please install a TeX distribution for full rendering support, or use the limited TikZJax renderer. You can adjust your preferences in settings.',
		});

		const buttonRow = contentEl.createDiv({ cls: 'luatikz-install-buttons' });
		buttonRow.createEl('button', {
			cls: 'mod-cta luatikz-soft-button',
			text: 'Open settings',
		}).addEventListener('click', () => {
			void this.openSettings();
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
		await this.plugin.saveSettings();
	}
}
