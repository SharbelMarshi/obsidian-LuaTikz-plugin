import { App, Modal, Setting } from 'obsidian';
import { cheatSheetEntries, TIKZ_TEMPLATE_CATALOG } from '../latex/tikzSnippets';
import type { MarkdownView } from 'obsidian';
import { getCurrentTikzBlock } from '../editor/inlinePreview';

export class TikzHelperCheatsheetModal extends Modal {
	private filter = '';

	constructor(
		app: App,
		private readonly onInsert: (snippet: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('luatikz-cheatsheet-modal');

		contentEl.createEl('h2', { text: 'TikZ helper reference' });

		new Setting(contentEl)
			.setName('Search')
			.addText(text => {
				text.setPlaceholder('Filter helpers…')
					.setValue(this.filter)
					.onChange(value => {
						this.filter = value;
						this.renderList(listContainer);
					});
			});

		const listContainer = contentEl.createDiv({ cls: 'luatikz-cheatsheet-list' });
		this.renderList(listContainer);
	}

	private renderList(container: HTMLElement): void {
		container.empty();
		const lower = this.filter.toLowerCase();

		for (const entry of cheatSheetEntries()) {
			if (lower && !entry.label.toLowerCase().includes(lower)
				&& !entry.detail.toLowerCase().includes(lower)) {
				continue;
			}

			const row = container.createDiv({ cls: 'luatikz-cheatsheet-row' });
			row.createEl('strong', { text: entry.label });
			row.createEl('div', { cls: 'luatikz-muted', text: entry.detail });
			row.createEl('code', { cls: 'luatikz-cheatsheet-snippet', text: entry.body.split('\n')[0] });

			row.addEventListener('click', () => {
				void navigator.clipboard.writeText(entry.body);
				this.onInsert(entry.body);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class TikzTemplatePickerModal extends Modal {
	constructor(
		app: App,
		private readonly onPick: (body: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('luatikz-template-picker-modal');
		contentEl.createEl('h2', { text: 'Insert TikZ template' });

		for (const template of TIKZ_TEMPLATE_CATALOG) {
			const row = contentEl.createDiv({ cls: 'luatikz-template-row' });
			row.createEl('strong', { text: template.name });
			row.addEventListener('click', () => {
				this.onPick(template.body);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function insertAtCursorInTikzBlock(view: MarkdownView, text: string): void {
	const editor = view.editor;
	const block = getCurrentTikzBlock(editor);
	if (block) {
		editor.replaceSelection(text);
		return;
	}

	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	if (line.trim().startsWith('```')) {
		editor.replaceRange(`\n${text}\n`, { line: cursor.line + 1, ch: 0 });
		return;
	}

	const fence = '```tikz\n';
	editor.replaceSelection(`${fence}${text}\n\`\`\``);
}

export function openHelperCheatsheet(app: App, view: MarkdownView | null): void {
	if (!view) {
		return;
	}
	new TikzHelperCheatsheetModal(app, snippet => {
		insertAtCursorInTikzBlock(view, snippet);
	}).open();
}

export function openTemplatePicker(app: App, view: MarkdownView | null): void {
	if (!view) {
		return;
	}
	new TikzTemplatePickerModal(app, body => {
		insertAtCursorInTikzBlock(view, body);
	}).open();
}

export function insertTemplateById(app: App, view: MarkdownView | null, id: string): void {
	const template = TIKZ_TEMPLATE_CATALOG.find(entry => entry.id === id);
	if (!template || !view) {
		return;
	}
	insertAtCursorInTikzBlock(view, template.body);
}
