import { Prec } from '@codemirror/state';
import { keymap, EditorView, Decoration, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { SemicolonReminderMode } from '../settings/settingsModel';
import { INCOMPLETE_DRAW_LINE_RE } from '../utils/coordinatePick';

class SemicolonHintWidget extends WidgetType {
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'luatikz-semicolon-hint';
		span.textContent = ' ;';
		return span;
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

function semicolonHintPlugin(getMode: () => SemicolonReminderMode) {
	return ViewPlugin.fromClass(class {
		decorations = Decoration.none;

		update(update: ViewUpdate): void {
			if (getMode() !== 'hint') {
				this.decorations = Decoration.none;
				return;
			}
			if (!update.selectionSet && !update.docChanged) {
				return;
			}

			const line = update.state.doc.lineAt(update.state.selection.main.head);
			const text = line.text.trim();
			if (!INCOMPLETE_DRAW_LINE_RE.test(text)) {
				this.decorations = Decoration.none;
				return;
			}

			this.decorations = Decoration.set([
				Decoration.widget({
					widget: new SemicolonHintWidget(),
					side: 1,
				}).range(line.to),
			]);
		}
	}, { decorations: value => value.decorations });
}

export function tikzSemicolonReminderExtension(
	getMode: () => SemicolonReminderMode,
): Extension {
	return [
		Prec.highest(keymap.of([{
			key: 'Enter',
			run(view) {
				const mode = getMode();
				if (mode === 'off') {
					return false;
				}

				const line = view.state.doc.lineAt(view.state.selection.main.head);
				const text = line.text.trim();
				if (!INCOMPLETE_DRAW_LINE_RE.test(text)) {
					return false;
				}

				if (mode === 'auto-append') {
					view.dispatch({
						changes: { from: line.to, insert: ';' },
						selection: { anchor: line.to + 1 },
					});
				}

				return false;
			},
		}])),
		semicolonHintPlugin(getMode),
		EditorView.baseTheme({
			'.luatikz-semicolon-hint': {
				color: 'var(--text-muted)',
				fontSize: '0.85em',
				fontStyle: 'italic',
			},
		}),
	];
}
