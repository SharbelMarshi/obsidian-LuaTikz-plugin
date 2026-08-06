import { App, Modal, Setting } from 'obsidian';
import type { MarkdownView } from 'obsidian';
import { CATEGORY_PICKER, snippetCompletionsForCategory, type TikzSnippetCategory } from '../latex/tikzSnippets';
import { insertAtCursorInTikzBlock } from '../ui/tikzHelperCheatsheet';
import { getCurrentTikzBlock } from './inlinePreview';

export class PlotFromFunctionModal extends Modal {
	constructor(
		app: App,
		private readonly onInsert: (body: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Insert plot from function' });

		let fn = 'sin(x)';
		new Setting(contentEl)
			.setName('Function f(x)')
			.setDesc('Use x as the variable; trig functions need deg(x) in PGFPlots.')
			.addText(text => text
				.setValue(fn)
				.onChange(value => { fn = value; }));

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Insert')
				.setCta()
				.onClick(() => {
					const expr = fn.includes('deg(') ? fn : fn.replace(/\bx\b/g, 'deg(x)');
					const body = String.raw`\pgfplotsset{compat=1.18}
\begin{axis}[domain=0:360, samples=100, grid=major]
\addplot {${expr}};
\end{axis}`;
					this.onInsert(body);
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class CategoryPickerModal extends Modal {
	constructor(
		app: App,
		private readonly onPick: (category: TikzSnippetCategory) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'What can I use here?' });

		for (const cat of CATEGORY_PICKER) {
			const row = contentEl.createDiv({ cls: 'luatikz-category-row' });
			row.createEl('strong', { text: cat.label });
			row.addEventListener('click', () => {
				this.onPick(cat.id);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class SnippetListModal extends Modal {
	constructor(
		app: App,
		private readonly category: TikzSnippetCategory,
		private readonly onInsert: (body: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: `Insert: ${this.category}` });

		for (const completion of snippetCompletionsForCategory(this.category)) {
			const row = contentEl.createDiv({ cls: 'luatikz-snippet-row' });
			row.createEl('strong', { text: completion.label ?? '' });
			if (completion.detail) {
				row.createDiv({ cls: 'luatikz-muted', text: String(completion.detail) });
			}
			row.addEventListener('click', () => {
				const body = typeof completion.apply === 'string'
					? completion.apply
					: completion.label ?? '';
				this.onInsert(body);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function formatTikzBlock(source: string): string {
	const lines = source.split('\n');
	const formatted: string[] = [];
	let depth = 0;

	for (const raw of lines) {
		const trimmed = raw.trim();
		if (!trimmed) {
			formatted.push('');
			continue;
		}

		if (/^\\end\{/.test(trimmed)) {
			depth = Math.max(0, depth - 1);
		}

		formatted.push(`${'\t'.repeat(depth)}${trimmed}`);

		if (/^\\begin\{/.test(trimmed)) {
			depth++;
		}
	}

	return formatted.join('\n');
}

export function wrapSelectionInNode(view: MarkdownView): void {
	const editor = view.editor;
	const sel = editor.getSelection();
	editor.replaceSelection(`\\node{${sel}}`);
}

export function wrapSelectionInMath(view: MarkdownView): void {
	const editor = view.editor;
	const sel = editor.getSelection();
	editor.replaceSelection(`$${sel}$`);
}

export function runFormatTikzBlock(view: MarkdownView | null): void {
	if (!view) {
		return;
	}
	const block = getCurrentTikzBlock(view.editor);
	if (!block) {
		return;
	}
	const formatted = formatTikzBlock(block.source);
	view.editor.replaceRange(
		formatted,
		{ line: block.startLine + 1, ch: 0 },
		{ line: block.endLine, ch: 0 },
	);
}

export function openPlotWizard(app: App, view: MarkdownView | null): void {
	if (!view) {
		return;
	}
	new PlotFromFunctionModal(app, body => {
		insertAtCursorInTikzBlock(view, body);
	}).open();
}

export function openCategoryPicker(app: App, view: MarkdownView | null): void {
	if (!view) {
		return;
	}
	new CategoryPickerModal(app, category => {
		new SnippetListModal(app, category, snippet => {
			insertAtCursorInTikzBlock(view, snippet);
		}).open();
	}).open();
}
