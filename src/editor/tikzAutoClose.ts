import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

const CLOSE_PAIRS: Record<string, string> = {
	'{': '}',
	'[': ']',
	'(': ')',
	'$': '$',
};

export function closeBracketsKeymapExtension(getEnabled: () => boolean): Extension {
	return Prec.highest(keymap.of([{
		key: 'Backspace',
		run(view) {
			if (!getEnabled()) {
				return false;
			}
			const { state } = view;
			const pos = state.selection.main.head;
			if (pos < 2) {
				return false;
			}
			const before = state.doc.sliceString(pos - 1, pos);
			const after = state.doc.sliceString(pos, pos + 1);
			const expected = CLOSE_PAIRS[before];
			if (expected && after === expected) {
				view.dispatch({
					changes: { from: pos - 1, to: pos + 1 },
					selection: { anchor: pos - 1 },
				});
				return true;
			}
			return false;
		},
	}]));
}

export function autoCloseBracketsExtension(getEnabled: () => boolean): Extension {
	return keymap.of(Object.entries(CLOSE_PAIRS).map(([open, close]) => ({
		key: open,
		run(view) {
			if (!getEnabled()) {
				return false;
			}
			const { state } = view;
			const sel = state.selection.main;
			if (!sel.empty) {
				return false;
			}
			view.dispatch({
				changes: { from: sel.head, insert: open + close },
				selection: { anchor: sel.head + 1 },
			});
			return true;
		},
	})));
}

export function tikzAutoCloseExtension(getEnabled: () => boolean): Extension {
	return [
		autoCloseBracketsExtension(getEnabled),
		closeBracketsKeymapExtension(getEnabled),
	];
}
