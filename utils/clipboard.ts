import { Notice } from 'obsidian';
import type { LuaTikzSettings } from '../settings';

export async function writeClipboardText(
	text: string,
	settings: LuaTikzSettings,
): Promise<boolean> {
	if (!settings.enableClipboardCopy) {
		new Notice('Clipboard copy is disabled. Enable it in LuaTikz settings.');
		return false;
	}

	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		new Notice('Could not copy to clipboard.');
		return false;
	}
}
