import { editorEditorField, type Editor } from 'obsidian';
import type { EditorView } from '@codemirror/view';

/**
 * Resolve the CodeMirror view behind an Obsidian Editor that actually carries
 * the extension identified by `hasExtension`.
 *
 * Returns null when neither the direct view nor the linked one has it. The
 * error-highlight copy of this helper used to fall back to the direct view
 * anyway, which let effects be dispatched into a view with no field to
 * receive them; the hover copy's null semantics are the correct ones and are
 * now the only ones.
 */
export function getEditorViewWithExtension(
	editor: Editor,
	hasExtension: (view: EditorView) => boolean,
): EditorView | null {
	const direct = (editor as Editor & { cm?: EditorView }).cm;
	if (!direct?.state || typeof direct.dispatch !== 'function') {
		return null;
	}
	if (hasExtension(direct)) {
		return direct;
	}
	try {
		const linked = direct.state.field(editorEditorField) as EditorView | undefined;
		if (linked && hasExtension(linked)) {
			return linked;
		}
	} catch {
		// Fall through: this editor has no such extension attached.
	}
	return null;
}
